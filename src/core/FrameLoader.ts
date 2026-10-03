import { FrameCache } from "./FrameCache";
import { RotationDirection } from "../types/viewer";
import {
  FrameTier,
  TOTAL_FRAMES,
  absCircularDistance,
  getFrameUrl,
  toFrameIndex,
} from "./CircularMath";

export type FrameImage = ImageBitmap | HTMLImageElement;

export type FrameLoadedCallback = (frame: number, tier: FrameTier) => void;

export interface FrameLoaderOptions {
  /** Max number of decoded HQ frames kept in memory (each 2560x1440 ≈ 14.7 MB decoded). */
  maxHqCache: number;
  /** Parallel network requests (keep < 6 so HTTP/1.1 dev servers still serve UI requests). */
  concurrency?: number;
  urlResolver?: (frame: number, tier: FrameTier) => string;
}

interface Job {
  key: string;
  frame: number;
  tier: FrameTier;
}

/**
 * Two-tier progressive frame loader.
 *
 *  - LQ tier: every frame is fetched once (≈51 KB each, ≈6 MB total) and kept decoded forever,
 *    so rotation never hits an empty frame after the initial preload.
 *  - HQ tier: only fetched in a small window around the current viewpoint and kept in a bounded
 *    distance-based cache, so memory stays flat regardless of how long the user rotates.
 *
 * Scheduling is priority-driven and re-evaluated every time a slot frees up:
 *    current-frame LQ  >  current-frame HQ (when resting)  >  LQ ordered by distance to view  >  HQ while moving.
 *
 * Decoding happens off the main thread via fetch() -> Blob -> createImageBitmap(), which is the key to
 * avoiding jank: the main thread never runs a synchronous image decode during rotation.
 */
export class FrameLoader {
  private readonly lq: (FrameImage | null)[] = new Array(TOTAL_FRAMES + 1).fill(null);
  private lqLoadedCount = 0;
  private readonly hq: FrameCache;
  private readonly concurrency: number;
  private readonly resolveUrl: (frame: number, tier: FrameTier) => string;

  private queue: Job[] = [];
  private readonly queued = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly failed = new Set<string>();
  private active = 0;

  private viewCenter = 1;
  private isMoving = false;
  private destroyed = false;
  private readonly abort = new AbortController();
  private onLoaded: FrameLoadedCallback | null = null;

  constructor(options: FrameLoaderOptions) {
    this.hq = new FrameCache(options.maxHqCache);
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.resolveUrl = options.urlResolver ?? getFrameUrl;
  }

  public setOnFrameLoaded(callback: FrameLoadedCallback): void {
    this.onLoaded = callback;
  }

  /** Kick off progressive loading starting from the frame that will be shown first. */
  public start(initialFrame: number): void {
    const center = toFrameIndex(initialFrame);
    this.viewCenter = center;
    for (let f = 1; f <= TOTAL_FRAMES; f++) this.enqueue(f, "lq");
    this.enqueue(center, "hq");
    this.pump();
  }

  // ---------------------------------------------------------------------------
  // Read API (synchronous, used by the renderer every frame)
  // ---------------------------------------------------------------------------

  public getHq(frame: number): FrameImage | null {
    const entry = this.hq.get(frame);
    return entry ? (entry.image as FrameImage) : null;
  }

  public getLq(frame: number): FrameImage | null {
    return this.lq[frame] ?? null;
  }

  /** Closest already-decoded LQ frame (used only while the preload is still running). */
  public findNearestLoaded(frame: number): FrameImage | null {
    for (let d = 1; d <= TOTAL_FRAMES / 2; d++) {
      const a = this.lq[toFrameIndex(frame + d)];
      if (a) return a;
      const b = this.lq[toFrameIndex(frame - d)];
      if (b) return b;
    }
    return null;
  }

  public get lqLoaded(): number {
    return this.lqLoadedCount;
  }

  public get hqCached(): number {
    return this.hq.size;
  }

  // ---------------------------------------------------------------------------
  // Viewport-driven HQ scheduling
  // ---------------------------------------------------------------------------

  /**
   * Called whenever the displayed frame changes. Re-centers LQ priorities and requests HQ frames
   * for a small window around the view (biased in the rotation direction while moving).
   * Pending HQ jobs that fell out of the window are dropped so bandwidth isn't wasted.
   */
  public updateView(frame: number, direction: RotationDirection, isMoving: boolean): void {
    if (this.destroyed) return;
    const center = toFrameIndex(frame);
    this.viewCenter = center;
    this.isMoving = isMoving;

    let offsets: number[];
    if (!isMoving) offsets = [0, 1, -1, 2, -2];
    else if (direction === "cw") offsets = [0, 1, 2, 3];
    else if (direction === "ccw") offsets = [0, -1, -2, -3];
    else offsets = [0];

    const wanted = new Set(offsets.map((o) => toFrameIndex(center + o)));

    // Drop stale HQ requests that are no longer near the viewpoint.
    this.queue = this.queue.filter((job) => {
      if (job.tier === "hq" && !wanted.has(job.frame)) {
        this.queued.delete(job.key);
        return false;
      }
      return true;
    });

    for (const f of wanted) {
      if (!this.hq.has(f)) this.enqueue(f, "hq");
    }
    this.pump();
  }

  // ---------------------------------------------------------------------------
  // Queue internals
  // ---------------------------------------------------------------------------

  private enqueue(frame: number, tier: FrameTier): void {
    const key = `${tier}:${frame}`;
    if (this.queued.has(key) || this.inFlight.has(key) || this.failed.has(key)) return;
    if (tier === "lq" && this.lq[frame]) return;
    this.queued.add(key);
    this.queue.push({ key, frame, tier });
  }

  /** Lower score = loaded sooner. Evaluated lazily so priorities always follow the live viewpoint. */
  private score(job: Job): number {
    const d = absCircularDistance(job.frame, this.viewCenter, TOTAL_FRAMES);
    if (job.tier === "lq") return d === 0 ? -1000 : d;
    // HQ: when resting the user is looking closely -> load right after the current LQ.
    // While moving, HQ waits until the nearby LQ ring is done.
    return this.isMoving ? 200 + d : -500 + d;
  }

  private pump(): void {
    while (!this.destroyed && this.active < this.concurrency && this.queue.length > 0) {
      let bestIndex = 0;
      let bestScore = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const s = this.score(this.queue[i]);
        if (s < bestScore) {
          bestScore = s;
          bestIndex = i;
        }
      }
      const job = this.queue.splice(bestIndex, 1)[0];
      this.queued.delete(job.key);
      this.run(job);
    }
  }

  private run(job: Job): void {
    this.active++;
    this.inFlight.add(job.key);

    this.fetchAndDecode(this.resolveUrl(job.frame, job.tier))
      .then((image) => {
        if (this.destroyed) {
          disposeImage(image);
          return;
        }
        if (job.tier === "lq") {
          if (!this.lq[job.frame]) this.lqLoadedCount++;
          this.lq[job.frame] = image;
        } else {
          this.hq.set(job.frame, image, this.viewCenter);
        }
        this.onLoaded?.(job.frame, job.tier);
      })
      .catch(() => {
        if (!this.destroyed) this.failed.add(job.key);
      })
      .finally(() => {
        this.active--;
        this.inFlight.delete(job.key);
        this.pump();
      });
  }

  private async fetchAndDecode(url: string): Promise<FrameImage> {
    if (typeof createImageBitmap === "function") {
      try {
        const res = await fetch(url, { signal: this.abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        // Decodes on a background thread; result is GPU/raster-ready -> drawImage is cheap.
        return await createImageBitmap(blob);
      } catch (err) {
        if (this.destroyed || (err as Error)?.name === "AbortError") throw err;
        // Fall through to <img> path (e.g. very old Safari without Blob support in createImageBitmap).
      }
    }

    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  }

  public destroy(): void {
    this.destroyed = true;
    this.abort.abort();
    this.queue = [];
    this.queued.clear();
    this.inFlight.clear();
    this.failed.clear();
    for (let f = 0; f < this.lq.length; f++) {
      const img = this.lq[f];
      if (img) disposeImage(img);
      this.lq[f] = null;
    }
    this.lqLoadedCount = 0;
    this.hq.clear();
    this.onLoaded = null;
  }
}

function disposeImage(image: FrameImage): void {
  if ("close" in image && typeof image.close === "function") {
    image.close();
  } else if (image instanceof HTMLImageElement) {
    image.src = "";
  }
}
