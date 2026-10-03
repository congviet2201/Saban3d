import { DecodedFrame } from "../types/viewer";
import { absCircularDistance, TOTAL_FRAMES } from "./CircularMath";

export class FrameCache {
  private readonly maxSize: number;
  private readonly frames: Map<number, DecodedFrame> = new Map();

  constructor(maxSize: number = 14) {
    this.maxSize = Math.max(6, maxSize);
  }

  public get(frame: number): DecodedFrame | undefined {
    const entry = this.frames.get(frame);
    if (entry) {
      entry.lastAccessTime = performance.now();
    }
    return entry;
  }

  public has(frame: number): boolean {
    return this.frames.has(frame);
  }

  public set(
    frame: number,
    image: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
    currentViewingFrame: number
  ): void {
    const existing = this.frames.get(frame);
    if (existing && existing.image !== image) {
      this.disposeImage(existing.image);
    }

    if (this.frames.size >= this.maxSize && !this.frames.has(frame)) {
      this.evictFarthest(currentViewingFrame, this.maxSize - 1);
    }

    this.frames.set(frame, {
      frame,
      image,
      lastAccessTime: performance.now(),
    });
  }

  public evictFarthest(currentViewingFrame: number, targetSize: number): void {
    if (this.frames.size <= targetSize) return;

    const keys = Array.from(this.frames.keys());
    keys.sort((a, b) => {
      const distA = absCircularDistance(a, currentViewingFrame, TOTAL_FRAMES);
      const distB = absCircularDistance(b, currentViewingFrame, TOTAL_FRAMES);
      return distB - distA;
    });

    const toRemoveCount = this.frames.size - targetSize;
    for (let i = 0; i < toRemoveCount && i < keys.length; i++) {
      const keyToRemove = keys[i];
      const entry = this.frames.get(keyToRemove);
      if (entry) {
        this.disposeImage(entry.image);
        this.frames.delete(keyToRemove);
      }
    }
  }

  public get size(): number {
    return this.frames.size;
  }

  public getCachedFrames(): number[] {
    return Array.from(this.frames.keys());
  }

  public clear(): void {
    for (const entry of this.frames.values()) {
      this.disposeImage(entry.image);
    }
    this.frames.clear();
  }

  private disposeImage(image: HTMLImageElement | ImageBitmap | HTMLCanvasElement): void {
    if ("close" in image && typeof image.close === "function") {
      image.close();
    } else if (image instanceof HTMLImageElement) {
      image.onload = null;
      image.onerror = null;
      image.src = "";
    }
  }
}
