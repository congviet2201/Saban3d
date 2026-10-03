import {
  ViewerEngineState,
  RotationDirection,
  ImageBounds,
} from "../types/viewer";
import { FrameLoader, FrameImage } from "./FrameLoader";
import { SnapController } from "./SnapController";
import { InputController } from "./InputController";
import {
  TOTAL_FRAMES,
  INITIAL_FRAME,
  OFFICIAL_ANCHOR_FRAMES,
  ANCHOR_VIEWPOINTS,
  FrameTier,
  wrapFrame,
  toFrameIndex,
  findNearestAnchor,
} from "./CircularMath";

export type StateListener = (state: ViewerEngineState) => void;

const BACKGROUND = "#021712";
const PIXELS_PER_FRAME = 3.5;

/**
 * Performance model:
 *  - Pointer events only mutate numbers; all canvas work happens at most once per animation frame.
 *  - The RAF loop runs only while dragging / snapping / a redraw is pending -> 0% CPU when idle.
 *  - Exactly one drawImage per rendered frame (no crossfade), and it's skipped entirely if the
 *    image to show hasn't changed.
 *  - React state is emitted at most once per animation frame.
 */
export class ViewerEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private loader: FrameLoader | null = null;
  private readonly snapController: SnapController;
  private readonly inputController: InputController;
  private readonly maxHqCache: number;
  private readonly urlResolver?: (frame: number, tier: FrameTier) => string;

  // Viewport State
  private currentFrameFloat = INITIAL_FRAME;
  private displayFrameInt = INITIAL_FRAME;
  private isDragging = false;
  private isSnapping = false;
  private lastDirection: RotationDirection = "none";

  // Render State
  private lastDrawn: FrameImage | null = null;
  private lastDrawnTier: FrameTier | null = null;
  private needsRender = false;
  private forceRedraw = false;
  private stateDirty = false;

  // RAF lifecycle control
  private rafId: number | null = null;
  private frameCount = 0;
  private fps = 60;
  private lastFpsCalcTime = 0;

  // Listeners
  private readonly stateListeners: Set<StateListener> = new Set();
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    maxHqCache: number = 10,
    snapThreshold: number = 10,
    urlResolver?: (frame: number, tier: FrameTier) => string
  ) {
    this.maxHqCache = maxHqCache;
    this.urlResolver = urlResolver;
    this.snapController = new SnapController(snapThreshold, 320);
    this.inputController = new InputController(PIXELS_PER_FRAME);

    this.snapController.setOnUpdate((frame, isFinished) => {
      this.currentFrameFloat = frame;
      this.syncDisplayFrame();

      if (isFinished) {
        this.isSnapping = false;
        this.settle();
      }
    });
  }

  public init(canvas: HTMLCanvasElement): void {
    this.detach();

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });

    this.loader = new FrameLoader({
      maxHqCache: this.maxHqCache,
      concurrency: 4,
      urlResolver: this.urlResolver,
    });

    this.loader.setOnFrameLoaded((frame) => {
      // Only redraw when the new image is relevant to what's on screen.
      if (frame === this.displayFrameInt || this.lastDrawnTier !== "hq") {
        this.needsRender = true;
      }
      this.stateDirty = true;
      this.scheduleFrame();
    });

    this.inputController.attach(canvas, {
      onDragStart: () => {
        this.isDragging = true;
        if (this.snapController.isSnapping) {
          this.snapController.cancel();
          this.isSnapping = false;
        }
        this.lastFpsCalcTime = performance.now();
        this.frameCount = 0;
        this.stateDirty = true;
        this.scheduleFrame();
      },
      onDragMove: (deltaX, _currentX, direction) => {
        this.lastDirection = direction;
        this.currentFrameFloat = wrapFrame(this.currentFrameFloat - deltaX / PIXELS_PER_FRAME, TOTAL_FRAMES);
        this.syncDisplayFrame();
      },
      onDragEnd: () => {
        this.isDragging = false;
        if (this.snapController.evaluateReleaseSnap(this.currentFrameFloat)) {
          this.isSnapping = true;
          this.requestHqForSnapTarget();
          this.scheduleFrame();
        } else {
          this.settle();
        }
        this.stateDirty = true;
        this.scheduleFrame();
      },
    });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas);
    this.handleResize();

    this.loader.start(this.displayFrameInt);
  }

  public subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public getImageBounds(): ImageBounds {
    if (!this.canvas) {
      return { left: 0, top: 0, width: 0, height: 0, containerWidth: 0, containerHeight: 0 };
    }
    const rect = this.canvas.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;
    const aspect = 16 / 9;

    let drawWidth = containerWidth;
    let drawHeight = containerWidth / aspect;

    if (drawHeight > containerHeight) {
      drawHeight = containerHeight;
      drawWidth = containerHeight * aspect;
    }

    const left = (containerWidth - drawWidth) / 2;
    const top = (containerHeight - drawHeight) / 2;

    return { left, top, width: drawWidth, height: drawHeight, containerWidth, containerHeight };
  }

  public getState(): ViewerEngineState {
    const { viewpoint, absDistance } = findNearestAnchor(
      this.currentFrameFloat,
      OFFICIAL_ANCHOR_FRAMES,
      TOTAL_FRAMES
    );

    const isDirectlyOnAnchor = absDistance < 0.2;
    const isIdle = !this.isDragging && !this.isSnapping;

    return {
      currentFrame: this.currentFrameFloat,
      displayFrame: this.displayFrameInt,
      activeAnchor: isDirectlyOnAnchor ? viewpoint : null,
      approachingAnchor: viewpoint,
      proximityDistance: absDistance,
      isDragging: this.isDragging,
      isSnapping: this.isSnapping,
      isIdle,
      direction: this.lastDirection,
      loadedFramesCount: this.loader?.lqLoaded ?? 0,
      cachedFramesCount: this.loader?.hqCached ?? 0,
      fps: this.fps,
      isFallback: this.lastDrawnTier !== "hq",
      isReady: this.lastDrawn !== null,
      imageBounds: this.getImageBounds(),
    };
  }

  public jumpToAnchor(anchorFrame: number): void {
    const viewpoint = ANCHOR_VIEWPOINTS.find((v) => v.frame === anchorFrame) || null;
    this.isSnapping = true;
    this.snapController.snapTo(this.currentFrameFloat, anchorFrame, viewpoint);
    this.requestHqForSnapTarget(anchorFrame);
    this.stateDirty = true;
    this.scheduleFrame();
  }

  public resetView(): void {
    this.jumpToAnchor(INITIAL_FRAME);
  }

  // ---------------------------------------------------------------------------
  // Frame / loading coordination
  // ---------------------------------------------------------------------------

  private syncDisplayFrame(): void {
    const next = toFrameIndex(this.currentFrameFloat);
    if (next !== this.displayFrameInt) {
      this.displayFrameInt = next;
      this.needsRender = true;
      // During a snap the HQ target was already requested; don't churn the queue per frame.
      if (this.isDragging) {
        this.loader?.updateView(next, this.lastDirection, true);
      }
    }
    this.stateDirty = true;
    this.scheduleFrame();
  }

  private requestHqForSnapTarget(target?: number): void {
    const snapTarget =
      target ?? findNearestAnchor(this.currentFrameFloat, OFFICIAL_ANCHOR_FRAMES, TOTAL_FRAMES).anchorFrame;
    this.loader?.updateView(snapTarget, "none", false);
  }

  /** Rotation finished: load HQ around the resting frame and redraw with high-quality smoothing. */
  private settle(): void {
    this.loader?.updateView(this.displayFrameInt, "none", false);
    this.needsRender = true;
    this.forceRedraw = true;
    this.stateDirty = true;
    this.scheduleFrame();
  }

  // ---------------------------------------------------------------------------
  // RAF loop
  // ---------------------------------------------------------------------------

  private scheduleFrame(): void {
    if (this.rafId !== null || !this.canvas) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private readonly tick = (timestamp: number): void => {
    this.rafId = null;

    if (this.isDragging || this.isSnapping) {
      this.frameCount++;
      const elapsed = timestamp - this.lastFpsCalcTime;
      if (elapsed >= 500) {
        this.fps = Math.round((this.frameCount * 1000) / elapsed);
        this.frameCount = 0;
        this.lastFpsCalcTime = timestamp;
      }
    }

    if (this.snapController.isSnapping) {
      this.snapController.tick(timestamp);
    }

    if (this.needsRender) this.render();

    if (this.stateDirty) {
      this.stateDirty = false;
      this.emitState();
    }

    // Keep looping only while an animation is running; dragging is driven by pointer events.
    if (this.snapController.isSnapping) this.scheduleFrame();
  };

  private stopRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private render(): void {
    if (!this.ctx || !this.canvas || !this.loader) return;

    const frame = this.displayFrameInt;
    let image = this.loader.getHq(frame);
    let tier: FrameTier = "hq";
    if (!image) {
      image = this.loader.getLq(frame) ?? this.loader.findNearestLoaded(frame);
      tier = "lq";
    }
    if (!image) return; // nothing decoded yet; the loader callback will trigger a redraw

    this.needsRender = false;
    if (image === this.lastDrawn && !this.forceRedraw) return;

    this.draw(image);
    this.lastDrawn = image;
    this.lastDrawnTier = tier;
    this.forceRedraw = false;
    this.stateDirty = true;
  }

  private draw(image: FrameImage): void {
    const ctx = this.ctx!;
    const canvasWidth = this.canvas!.width;
    const canvasHeight = this.canvas!.height;

    const srcWidth = "naturalWidth" in image ? image.naturalWidth : image.width;
    const srcHeight = "naturalHeight" in image ? image.naturalHeight : image.height;
    if (!srcWidth || !srcHeight) return;

    // "contain" fit, centered
    const scale = Math.min(canvasWidth / srcWidth, canvasHeight / srcHeight);
    const drawWidth = Math.round(srcWidth * scale);
    const drawHeight = Math.round(srcHeight * scale);
    const offsetX = Math.round((canvasWidth - drawWidth) / 2);
    const offsetY = Math.round((canvasHeight - drawHeight) / 2);

    if (offsetX > 0 || offsetY > 0) {
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    const moving = this.isDragging || this.isSnapping;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = moving ? "medium" : "high";
    ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  }

  private handleResize(): void {
    if (!this.canvas || !this.ctx) return;

    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = Math.max(1, Math.round(rect.width * dpr));
    const displayHeight = Math.max(1, Math.round(rect.height * dpr));

    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
      this.ctx.fillStyle = BACKGROUND;
      this.ctx.fillRect(0, 0, displayWidth, displayHeight);
      // Resizing clears the canvas -> redraw synchronously to avoid a blank flash.
      this.needsRender = true;
      this.forceRedraw = true;
      this.render();
    }
  }

  private emitState(): void {
    const state = this.getState();
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  /** Releases canvas, input, network and decoded images but keeps subscribers (safe for React StrictMode remounts). */
  public detach(): void {
    this.stopRaf();
    this.snapController.cancel();
    this.inputController.detach();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.loader?.destroy();
    this.loader = null;
    this.canvas = null;
    this.ctx = null;
    this.lastDrawn = null;
    this.lastDrawnTier = null;
    this.isDragging = false;
    this.isSnapping = false;
  }

  public destroy(): void {
    this.detach();
    this.stateListeners.clear();
  }
}
