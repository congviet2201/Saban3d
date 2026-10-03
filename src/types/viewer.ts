export interface AnchorViewpoint {
  id: number;
  frame: number;
  label: string;
  name: string;
  azimuthDeg: number;
  description: string;
}

export interface ViewerConfig {
  totalFrames: number;
  initialFrame: number;
  anchorFrames: number[];
  snapThreshold: number;
  snapDurationMs: number;
  maxCacheSize: number;
  dragSensitivity: number;
  imagePathPattern: (frame: number) => string;
}

export type RotationDirection = 'cw' | 'ccw' | 'none';

export interface ImageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  containerWidth: number;
  containerHeight: number;
}

export interface ViewerEngineState {
  currentFrame: number;
  displayFrame: number;
  activeAnchor: AnchorViewpoint | null;
  approachingAnchor: AnchorViewpoint | null;
  proximityDistance: number;
  isDragging: boolean;
  isSnapping: boolean;
  isIdle: boolean;
  direction: RotationDirection;
  loadedFramesCount: number;
  cachedFramesCount: number;
  fps: number;
  isFallback: boolean;
  isReady: boolean;
  imageBounds: ImageBounds;
}

export interface DecodedFrame {
  frame: number;
  image: HTMLImageElement | ImageBitmap | HTMLCanvasElement;
  lastAccessTime: number;
  sizeBytes?: number;
}
