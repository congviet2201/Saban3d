import {
  findNearestAnchor,
  easeOutCubic,
  wrapFrame,
  circularDistance,
  TOTAL_FRAMES,
  OFFICIAL_ANCHOR_FRAMES,
} from "./CircularMath";
import { AnchorViewpoint } from "../types/viewer";

export interface SnapState {
  isSnapping: boolean;
  startFrame: number;
  targetFrame: number;
  targetViewpoint: AnchorViewpoint | null;
  startTime: number;
  durationMs: number;
  signedDistance: number;
}

export class SnapController {
  private readonly snapThreshold: number;
  private readonly defaultDurationMs: number;
  private state: SnapState | null = null;
  private onUpdateCallback: ((currentFrame: number, isFinished: boolean) => void) | null = null;

  constructor(snapThreshold: number = 10, defaultDurationMs: number = 320) {
    this.snapThreshold = snapThreshold;
    this.defaultDurationMs = defaultDurationMs;
  }

  public setOnUpdate(callback: (currentFrame: number, isFinished: boolean) => void): void {
    this.onUpdateCallback = callback;
  }

  public evaluateReleaseSnap(currentFrame: number): boolean {
    const { anchorFrame, viewpoint, signedDistance, absDistance } = findNearestAnchor(
      currentFrame,
      OFFICIAL_ANCHOR_FRAMES,
      TOTAL_FRAMES
    );

    if (absDistance <= this.snapThreshold) {
      this.startSnap(currentFrame, anchorFrame, viewpoint, signedDistance);
      return true;
    }

    this.cancel();
    return false;
  }

  public snapTo(
    currentFrame: number,
    targetFrame: number,
    viewpoint: AnchorViewpoint | null = null,
    customDuration?: number
  ): void {
    const signedDist = circularDistance(currentFrame, targetFrame, TOTAL_FRAMES);
    this.startSnap(currentFrame, targetFrame, viewpoint, signedDist, customDuration);
  }

  private startSnap(
    startFrame: number,
    targetFrame: number,
    viewpoint: AnchorViewpoint | null,
    signedDistance: number,
    customDuration?: number
  ): void {
    const distAbs = Math.abs(signedDistance);
    const calculatedDuration = customDuration || Math.min(450, Math.max(250, this.defaultDurationMs + (distAbs - 4) * 8));

    this.state = {
      isSnapping: true,
      startFrame,
      targetFrame,
      targetViewpoint: viewpoint,
      startTime: performance.now(),
      durationMs: calculatedDuration,
      signedDistance,
    };
  }

  public tick(currentTime: number): { currentFrame: number; isComplete: boolean } | null {
    if (!this.state || !this.state.isSnapping) {
      return null;
    }

    const elapsed = currentTime - this.state.startTime;
    const progress = Math.min(1, Math.max(0, elapsed / this.state.durationMs));
    const easedProgress = easeOutCubic(progress);

    const interpolatedFrame = wrapFrame(
      this.state.startFrame + this.state.signedDistance * easedProgress,
      TOTAL_FRAMES
    );

    const isComplete = progress >= 1;

    if (isComplete) {
      const finalFrame = this.state.targetFrame;
      this.state = null;
      if (this.onUpdateCallback) {
        this.onUpdateCallback(finalFrame, true);
      }
      return { currentFrame: finalFrame, isComplete: true };
    }

    if (this.onUpdateCallback) {
      this.onUpdateCallback(interpolatedFrame, false);
    }

    return { currentFrame: interpolatedFrame, isComplete: false };
  }

  public get isSnapping(): boolean {
    return this.state !== null && this.state.isSnapping;
  }

  public get targetViewpoint(): AnchorViewpoint | null {
    return this.state?.targetViewpoint || null;
  }

  public cancel(): void {
    this.state = null;
  }
}
