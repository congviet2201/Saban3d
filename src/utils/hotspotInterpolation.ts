import {
  FloorHotspot,
  PointHotspot,
  FloorLabelHotspot,
  InterpolatedFloor,
  InterpolatedPoint,
  Point2D,
  HotspotsData,
  normalizeFloorKeyframe,
  serializeFloorKeyframe,
} from "../types/hotspot";

const polygonMismatchWarnings = new Set<string>();

/**
 * Given a sorted array of numeric keyframe indices [f0, f1, ..., fN] in 1..frameCount,
 * returns lower frame fA, upper frame fB, and circular interpolation factor t in [0, 1].
 */
export function getCircularInterpolationFactor(
  keyframeFrames: number[],
  currentFrame: number,
  frameCount: number = 120
): { frameA: number; frameB: number; t: number } {
  if (keyframeFrames.length === 0) {
    return { frameA: currentFrame, frameB: currentFrame, t: 0 };
  }
  if (keyframeFrames.length === 1) {
    return { frameA: keyframeFrames[0], frameB: keyframeFrames[0], t: 0 };
  }

  // Normalize currentFrame into 1..frameCount
  const f = ((Math.round(currentFrame) - 1) % frameCount + frameCount) % frameCount + 1;

  // Exact match search
  const exact = keyframeFrames.find((k) => k === f);
  if (exact !== undefined) {
    return { frameA: exact, frameB: exact, t: 0 };
  }

  let fA = keyframeFrames[keyframeFrames.length - 1];
  let fB = keyframeFrames[0];

  for (let i = 0; i < keyframeFrames.length; i++) {
    const kCurr = keyframeFrames[i];
    const kNext = keyframeFrames[(i + 1) % keyframeFrames.length];

    if (kCurr < kNext) {
      if (f >= kCurr && f <= kNext) {
        fA = kCurr;
        fB = kNext;
        break;
      }
    } else {
      // Wrap around timeline (e.g. kCurr = 110, kNext = 10)
      if (f >= kCurr || f <= kNext) {
        fA = kCurr;
        fB = kNext;
        break;
      }
    }
  }

  if (fA === fB) {
    return { frameA: fA, frameB: fB, t: 0 };
  }

  let distAB = fB - fA;
  if (distAB <= 0) distAB += frameCount;

  let distAf = f - fA;
  if (distAf < 0) distAf += frameCount;

  const t = Math.max(0, Math.min(1, distAf / distAB));
  return { frameA: fA, frameB: fB, t };
}

/**
 * Linearly interpolates a floor polygon's vertices and opacity across keyframes.
 * Goes through normalizeFloorKeyframe to handle plain Point2D[] or object keyframes.
 * If vertex counts mismatch between keyframes, holds the nearest keyframe and logs a warning.
 */
export function interpolateFloor(
  floor: FloorHotspot,
  currentFrame: number,
  frameCount: number = 120
): InterpolatedFloor {
  const keys = Object.keys(floor.keyframes)
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  if (keys.length === 0) {
    return { id: floor.id, name: floor.name, points: [], opacity: 0, visible: false };
  }

  const { frameA, frameB, t } = getCircularInterpolationFactor(keys, currentFrame, frameCount);
  const rawA = floor.keyframes[String(frameA)];
  const rawB = floor.keyframes[String(frameB)];

  if (!rawA || !rawB) {
    const rawValid = rawA || rawB;
    if (!rawValid) {
      return { id: floor.id, name: floor.name, points: [], opacity: 0, visible: false };
    }
    const norm = normalizeFloorKeyframe(rawValid);
    const op = norm.visible ? 1 : 0;
    return { id: floor.id, name: floor.name, points: norm.points, opacity: op, visible: op > 0.05 };
  }

  const kfA = normalizeFloorKeyframe(rawA);
  const kfB = normalizeFloorKeyframe(rawB);

  // Compute opacity based on visible flags of neighboring keyframes
  const visA = kfA.visible;
  const visB = kfB.visible;
  let opacity = 1;
  if (visA && visB) {
    opacity = 1;
  } else if (!visA && !visB) {
    opacity = 0;
  } else if (visA && !visB) {
    opacity = 1 - t;
  } else {
    opacity = t;
  }
  const visible = opacity > 0.05;

  const pointsA = kfA.points;
  const pointsB = kfB.points;

  if (pointsA.length !== pointsB.length) {
    const warnKey = `${floor.id}:${frameA}-${frameB}`;
    if (!polygonMismatchWarnings.has(warnKey)) {
      console.warn(
        `[HotspotValidation] Polygon vertex count mismatch for floor "${floor.name}" (${floor.id}) between keyframes ${frameA} (${pointsA.length} vertices) and ${frameB} (${pointsB.length} vertices). Holding nearest keyframe.`
      );
      polygonMismatchWarnings.add(warnKey);
    }
    const nearestPoints = t < 0.5 ? pointsA : pointsB;
    return { id: floor.id, name: floor.name, points: nearestPoints, opacity, visible };
  }

  const interpolatedPoints: Point2D[] = pointsA.map((ptA, i) => {
    const ptB = pointsB[i];
    const x = ptA[0] + (ptB[0] - ptA[0]) * t;
    const y = ptA[1] + (ptB[1] - ptA[1]) * t;
    return [x, y];
  });

  return { id: floor.id, name: floor.name, points: interpolatedPoints, opacity, visible };
}

/**
 * Linearly interpolates point hotspots and floor labels (target x,y + label lx,ly + visibility fade).
 */
export function interpolatePointData(
  item: PointHotspot | FloorLabelHotspot,
  currentFrame: number,
  frameCount: number = 120
): InterpolatedPoint {
  const keys = Object.keys(item.keyframes)
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  if (keys.length === 0) {
    return { id: item.id, name: item.name, x: 0, y: 0, lx: 0, ly: 0, opacity: 0, visible: false };
  }

  const { frameA, frameB, t } = getCircularInterpolationFactor(keys, currentFrame, frameCount);
  const kA = item.keyframes[String(frameA)];
  const kB = item.keyframes[String(frameB)];

  if (!kA || !kB) {
    const valid = kA || kB;
    const vis = valid?.visible ?? true;
    return {
      id: item.id,
      name: item.name,
      x: valid?.x ?? 0,
      y: valid?.y ?? 0,
      lx: valid?.lx ?? 0,
      ly: valid?.ly ?? 0,
      opacity: vis ? 1 : 0,
      visible: vis,
    };
  }

  const x = kA.x + (kB.x - kA.x) * t;
  const y = kA.y + (kB.y - kA.y) * t;
  const lx = kA.lx + (kB.lx - kA.lx) * t;
  const ly = kA.ly + (kB.ly - kA.ly) * t;

  const visA = kA.visible ?? true;
  const visB = kB.visible ?? true;

  let opacity = 1;
  if (visA && visB) {
    opacity = 1;
  } else if (!visA && !visB) {
    opacity = 0;
  } else if (visA && !visB) {
    opacity = 1 - t;
  } else {
    opacity = t;
  }

  const visible = opacity > 0.05;

  return {
    id: item.id,
    name: item.name,
    x,
    y,
    lx,
    ly,
    opacity,
    visible,
  };
}

/**
 * Performs runtime validation on loaded hotspots data.
 * Checks vertex count consistency per floor across keyframes, frame key bounds, and 0..1 coordinate range.
 * Emits console.warn with hotspot id and frame for any issues found.
 */
export function validateHotspotsData(data: HotspotsData): string[] {
  const warnings: string[] = [];
  const frameCount = data.frameCount || 120;

  // 1. Validate Floors
  if (data.floors) {
    for (const floor of data.floors) {
      const keys = Object.keys(floor.keyframes || {});
      let firstCount: number | null = null;
      let firstFrame: string | null = null;

      for (const frameStr of keys) {
        const frameNum = parseInt(frameStr, 10);
        if (isNaN(frameNum) || frameNum < 0 || frameNum > frameCount) {
          const msg = `[HotspotValidation] Floor "${floor.id}" has invalid frame key "${frameStr}" outside range [0, ${frameCount}].`;
          console.warn(msg);
          warnings.push(msg);
        }

        const norm = normalizeFloorKeyframe(floor.keyframes[frameStr]);
        if (firstCount === null) {
          firstCount = norm.points.length;
          firstFrame = frameStr;
        } else if (norm.points.length !== firstCount) {
          const msg = `[HotspotValidation] Floor "${floor.id}" keyframe ${frameStr} vertex count (${norm.points.length}) does not match keyframe ${firstFrame} (${firstCount}).`;
          console.warn(msg);
          warnings.push(msg);
        }

        for (const [x, y] of norm.points) {
          if (x < 0 || x > 1 || y < 0 || y > 1) {
            const msg = `[HotspotValidation] Floor "${floor.id}" frame ${frameStr} has vertex coordinate out of [0, 1] bounds: [${x}, ${y}].`;
            console.warn(msg);
            warnings.push(msg);
          }
        }
      }
    }
  }

  // 2. Validate Points
  if (data.points) {
    for (const pt of data.points) {
      const keys = Object.keys(pt.keyframes || {});
      for (const frameStr of keys) {
        const frameNum = parseInt(frameStr, 10);
        if (isNaN(frameNum) || frameNum < 0 || frameNum > frameCount) {
          const msg = `[HotspotValidation] Point hotspot "${pt.id}" has invalid frame key "${frameStr}" outside range [0, ${frameCount}].`;
          console.warn(msg);
          warnings.push(msg);
        }

        const kf = pt.keyframes[frameStr];
        if (kf) {
          if (kf.x < 0 || kf.x > 1 || kf.y < 0 || kf.y > 1 || kf.lx < 0 || kf.lx > 1 || kf.ly < 0 || kf.ly > 1) {
            const msg = `[HotspotValidation] Point hotspot "${pt.id}" frame ${frameStr} coordinates out of [0, 1] bounds: target (${kf.x}, ${kf.y}), label (${kf.lx}, ${kf.ly}).`;
            console.warn(msg);
            warnings.push(msg);
          }
        }
      }
    }
  }

  // 3. Validate Floor Labels
  if (data.floorLabels) {
    for (const fl of data.floorLabels) {
      const keys = Object.keys(fl.keyframes || {});
      for (const frameStr of keys) {
        const frameNum = parseInt(frameStr, 10);
        if (isNaN(frameNum) || frameNum < 0 || frameNum > frameCount) {
          const msg = `[HotspotValidation] Floor label "${fl.id}" has invalid frame key "${frameStr}" outside range [0, ${frameCount}].`;
          console.warn(msg);
          warnings.push(msg);
        }

        const kf = fl.keyframes[frameStr];
        if (kf) {
          if (kf.x < 0 || kf.x > 1 || kf.y < 0 || kf.y > 1 || kf.lx < 0 || kf.lx > 1 || kf.ly < 0 || kf.ly > 1) {
            const msg = `[HotspotValidation] Floor label "${fl.id}" frame ${frameStr} coordinates out of [0, 1] bounds: target (${kf.x}, ${kf.y}), label (${kf.lx}, ${kf.ly}).`;
            console.warn(msg);
            warnings.push(msg);
          }
        }
      }
    }
  }

  return warnings;
}

/**
 * Editor helper to update the "visible" flag for a floor at a specified keyframe frame.
 * Converts the keyframe to object form if visible is false, or array form if visible is true (default).
 */
export function setFloorKeyframeVisibility(
  floor: FloorHotspot,
  frame: number | string,
  visible: boolean
): FloorHotspot {
  const frameStr = String(frame);
  const currentKeyframe = floor.keyframes[frameStr];
  const normalized = currentKeyframe
    ? normalizeFloorKeyframe(currentKeyframe)
    : { points: [], visible: true, auto: false };

  normalized.visible = visible;

  return {
    ...floor,
    keyframes: {
      ...floor.keyframes,
      [frameStr]: serializeFloorKeyframe(normalized),
    },
  };
}
