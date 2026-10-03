export type Point2D = [number, number];

export interface FloorKeyframeObject {
  points: Point2D[];
  visible?: boolean;
  auto?: boolean;
  confidence?: number;
}

export type FloorKeyframe = Point2D[] | FloorKeyframeObject;

export interface NormalizedFloorKeyframe {
  points: Point2D[];
  visible: boolean;
  auto: boolean;
  confidence?: number;
}

export interface FloorKeyframeData {
  [frame: string]: FloorKeyframe;
}

export interface FloorHotspot {
  id: string;
  name: string;
  keyframes: FloorKeyframeData;
}

export interface PointKeyframe {
  x: number;
  y: number;
  lx: number;
  ly: number;
  visible?: boolean;
  auto?: boolean;
  confidence?: number;
}

export interface PointKeyframeData {
  [frame: string]: PointKeyframe;
}

export interface PointHotspot {
  id: string;
  name: string;
  keyframes: PointKeyframeData;
}

export interface FloorLabelHotspot {
  id: string;
  name: string;
  keyframes: PointKeyframeData;
}

export interface HotspotsData {
  frameCount: number;
  floors: FloorHotspot[];
  points: PointHotspot[];
  floorLabels: FloorLabelHotspot[];
}

export interface InterpolatedFloor {
  id: string;
  name: string;
  points: Point2D[];
  opacity: number;
  visible: boolean;
}

export interface InterpolatedPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  lx: number;
  ly: number;
  opacity: number;
  visible: boolean;
}

export interface HotspotClickEventDetail {
  id: string;
  type: "floor" | "point" | "floorLabel";
  name: string;
}

/**
 * Normalizes any FloorKeyframe (plain Point2D[] or object form) to a canonical NormalizedFloorKeyframe.
 * Default values: visible = true, auto = false.
 */
export function normalizeFloorKeyframe(kf: FloorKeyframe): NormalizedFloorKeyframe {
  if (Array.isArray(kf)) {
    return {
      points: kf,
      visible: true,
      auto: false,
    };
  }
  return {
    points: kf.points || [],
    visible: kf.visible ?? true,
    auto: kf.auto ?? false,
    confidence: kf.confidence,
  };
}

/**
 * Serializes a NormalizedFloorKeyframe for saving to JSON.
 * Returns the plain array form (Point2D[]) if all optional fields equal defaults (visible=true, auto=false, confidence=undefined),
 * to keep the resulting JSON small.
 */
export function serializeFloorKeyframe(nkf: NormalizedFloorKeyframe): FloorKeyframe {
  const isDefaultVisible = nkf.visible !== false;
  const isDefaultAuto = !nkf.auto;
  const isDefaultConfidence = nkf.confidence === undefined;

  if (isDefaultVisible && isDefaultAuto && isDefaultConfidence) {
    return nkf.points;
  }

  const obj: FloorKeyframeObject = {
    points: nkf.points,
  };
  if (!isDefaultVisible) obj.visible = false;
  if (!isDefaultAuto) obj.auto = nkf.auto;
  if (!isDefaultConfidence) obj.confidence = nkf.confidence;

  return obj;
}
