import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  HotspotsData,
  HotspotClickEventDetail,
  InterpolatedFloor,
  InterpolatedPoint,
} from "../types/hotspot";
import { ImageBounds } from "../types/viewer";
import { interpolateFloor, interpolatePointData, validateHotspotsData } from "../utils/hotspotInterpolation";

interface HotspotOverlayProps {
  displayFrame: number;
  isDragging: boolean;
  imageBounds: ImageBounds;
  dataUrl?: string;
  onHotspotClick?: (event: HotspotClickEventDetail) => void;
}

export const HotspotOverlay: React.FC<HotspotOverlayProps> = ({
  displayFrame,
  isDragging,
  imageBounds,
  dataUrl = "/data/hotspots.json",
  onHotspotClick,
}) => {
  const [data, setData] = useState<HotspotsData | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);

  // Fetch hotspots data from JSON & validate
  useEffect(() => {
    let isMounted = true;
    fetch(dataUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: HotspotsData) => {
        if (isMounted) {
          validateHotspotsData(json);
          setData(json);
        }
      })
      .catch((err) => {
        console.warn("[HotspotOverlay] Failed to load hotspots.json:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [dataUrl]);

  // Dispatch custom event helper
  const handleItemClick = useCallback(
    (id: string, type: "floor" | "point" | "floorLabel", name: string, e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      if (isDragging) return;

      const detail: HotspotClickEventDetail = { id, type, name };

      // Dispatch native window event
      const customEvent = new CustomEvent<HotspotClickEventDetail>("hotspot:click", {
        detail,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(customEvent);

      // Call optional prop handler
      onHotspotClick?.(detail);
    },
    [isDragging, onHotspotClick]
  );

  // Compute interpolated data for current frame
  const interpolatedFloors: InterpolatedFloor[] = useMemo(() => {
    if (!data) return [];
    return data.floors.map((f) => interpolateFloor(f, displayFrame, data.frameCount || 120));
  }, [data, displayFrame]);

  const interpolatedPoints: InterpolatedPoint[] = useMemo(() => {
    if (!data) return [];
    return data.points.map((p) => interpolatePointData(p, displayFrame, data.frameCount || 120));
  }, [data, displayFrame]);

  const interpolatedFloorLabels: InterpolatedPoint[] = useMemo(() => {
    if (!data) return [];
    return data.floorLabels.map((fl) => interpolatePointData(fl, displayFrame, data.frameCount || 120));
  }, [data, displayFrame]);

  // Standardized floor label definitions in canonical building order:
  // - Tum    (top elevation, ~0.26)
  // - Tầng 2 (upper-mid elevation, ~0.39)
  // - Lửng   (lower-mid elevation, ~0.52)
  // - Tầng 1 (ground elevation, ~0.65)
  const standardizedFloors = useMemo(() => {
    const list = [
      { key: "tum", displayName: "Tum", defaultId: "label-tang-tum", fallbackY: 0.26 },
      { key: "2", displayName: "Tầng 2", defaultId: "label-tang-2", fallbackY: 0.39 },
      { key: "lung", displayName: "Lửng", defaultId: "label-tang-lung", fallbackY: 0.52 },
      { key: "1", displayName: "Tầng 1", defaultId: "label-tang-1", fallbackY: 0.65 },
    ];

    return list.map((def, idx) => {
      const match = interpolatedFloorLabels.find((fl) => {
        const idLower = fl.id.toLowerCase();
        const nameLower = fl.name.toLowerCase();
        if (def.key === "tum") return idLower.includes("tum") || nameLower.includes("tum");
        if (def.key === "lung") return idLower.includes("lung") || nameLower.includes("lửng") || nameLower.includes("lung");
        if (def.key === "2") return idLower.includes("2") || nameLower.includes("2");
        if (def.key === "1") return idLower.includes("1") || nameLower.includes("1");
        return false;
      });

      return {
        id: match ? match.id : def.defaultId,
        displayName: def.displayName,
        visible: match ? match.visible : true,
        opacity: match ? match.opacity : 1,
        x: match ? match.x : 0.35,
        y: match ? match.y : def.fallbackY,
        index: idx,
      };
    });
  }, [interpolatedFloorLabels]);

  if (!data || !imageBounds.width || !imageBounds.height) {
    return null;
  }

  const { left, top, width, height } = imageBounds;

  // Geometry constants for standardized floor navigation
  const NAV_LEFT_RATIO = 0.06; // 6% from image left edge
  const NAV_WIDTH_PX = 132;
  const ITEM_HEIGHT_PX = 38;
  const navRightRatio = NAV_LEFT_RATIO + NAV_WIDTH_PX / width;

  return (
    <div
      className="absolute overflow-hidden pointer-events-none select-none transition-opacity duration-200"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {/* SVG Layer for Leader Lines & Target Dots */}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="w-full h-full absolute inset-0 overflow-visible"
        style={{ pointerEvents: "none" }}
      >
        {/* 1. Floor Zone Polygons — transparent click targets */}
        {interpolatedFloors.map((floor) => {
          if (!floor.visible || floor.opacity <= 0.05 || !floor.points || floor.points.length < 3) return null;
          const pointsString = floor.points.map((pt) => `${pt[0]},${pt[1]}`).join(" ");
          const isInteractive = !isDragging && floor.visible && floor.opacity > 0.05;
          const labelId = `label-${floor.id}`;

          return (
            <polygon
              key={floor.id}
              points={pointsString}
              style={{
                pointerEvents: isInteractive ? "auto" : "none",
                cursor: "pointer",
                opacity: floor.opacity,
                fill: "transparent",
                stroke: "transparent",
                strokeWidth: 0,
              }}
              onMouseEnter={() => !isDragging && setHoveredPointId(labelId)}
              onMouseLeave={() => setHoveredPointId(null)}
              onClick={(e) => handleItemClick(floor.id, "floor", floor.name, e)}
            />
          );
        })}

        {/* 2. Point Hotspot Leader Lines & Target Dots */}
        {interpolatedPoints.map((pt) => {
          if (!pt.visible || pt.opacity <= 0.05) return null;
          const isHovered = hoveredPointId === pt.id;

          return (
            <g key={pt.id} style={{ opacity: pt.opacity }}>
              <line
                x1={pt.x}
                y1={pt.y}
                x2={pt.lx}
                y2={pt.ly}
                stroke="#ef4444"
                strokeWidth={isHovered ? 0.003 : 0.002}
                strokeDasharray="0.008 0.004"
                className="transition-all duration-200"
              />
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isHovered ? 0.012 : 0.008}
                fill="rgba(239, 68, 68, 0.3)"
                className={isHovered ? "animate-pulse" : ""}
              />
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isHovered ? 0.006 : 0.004}
                fill="#ef4444"
                stroke="#ffffff"
                strokeWidth={0.001}
                className="transition-all duration-200"
              />
            </g>
          );
        })}

        {/* 3. Floor Name Leader Lines — connecting building targets directly to standardized floor menu items */}
        {standardizedFloors.map((fl) => {
          if (!fl.visible || fl.opacity <= 0.05) return null;
          const isHovered =
            hoveredPointId === fl.id ||
            hoveredPointId === fl.id.replace("label-", "") ||
            hoveredPointId === `label-${fl.id}`;

          return (
            <g key={fl.id} style={{ opacity: fl.opacity }}>
              <line
                x1={fl.x}
                y1={fl.y}
                x2={navRightRatio}
                y2={fl.y}
                stroke={isHovered ? "#f59e0b" : "rgba(245, 158, 11, 0.65)"}
                strokeWidth={isHovered ? 0.0025 : 0.0018}
                strokeDasharray={isHovered ? "none" : "0.008 0.004"}
                className="transition-all duration-200"
              />
              <circle
                cx={fl.x}
                cy={fl.y}
                r={isHovered ? 0.006 : 0.004}
                fill="#f59e0b"
                className="transition-all duration-200"
              />
            </g>
          );
        })}
      </svg>

      {/* HTML Overlay Layer */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Point Hotspot Label Cards */}
        {interpolatedPoints.map((pt) => {
          if (!pt.visible || pt.opacity <= 0.05) return null;
          const isHovered = hoveredPointId === pt.id;
          const effectiveOpacity = pt.opacity * (isDragging ? 0.5 : 1.0);

          return (
            <div
              key={pt.id}
              className="absolute transition-all duration-200"
              style={{
                left: `${pt.lx * 100}%`,
                top: `${pt.ly * 100}%`,
                transform: "translate(-50%, -50%)",
                opacity: effectiveOpacity,
                pointerEvents: isDragging ? "none" : "auto",
              }}
            >
              <button
                type="button"
                onMouseEnter={() => !isDragging && setHoveredPointId(pt.id)}
                onMouseLeave={() => setHoveredPointId(null)}
                onClick={(e) => handleItemClick(pt.id, "point", pt.name, e)}
                className={`
                  flex items-center gap-2 px-3 py-1.5
                  rounded-lg border backdrop-blur-md
                  text-xs font-semibold whitespace-nowrap cursor-pointer
                  transition-all duration-200
                  ${isHovered
                    ? "bg-red-950/90 border-red-400 text-red-100 scale-105 shadow-[0_0_20px_rgba(239,68,68,0.7)]"
                    : "bg-[#03241b]/95 border-red-500/60 text-red-100 shadow-[0_4px_16px_rgba(0,0,0,0.5)] hover:border-red-400 hover:scale-105"
                  }
                `}
              >
                <span className="w-2 h-2 rounded-full bg-red-500 group-hover:bg-red-400 animate-pulse flex-none" />
                <span>{pt.name}</span>
              </button>
            </div>
          );
        })}

        {/* ── Standardized Floor Navigation Hotspots ──────────────────────
            All 4 floor hotspot labels:
              - Tum    (top elevation, ~0.26)
              - Tầng 2 (upper-mid elevation, ~0.39)
              - Lửng   (lower-mid elevation, ~0.52)
              - Tầng 1 (ground elevation, ~0.65)
            Are ordered according to building floor hierarchy (top to bottom)
            and positioned directly at the vertical elevation of each floor,
            all aligned along the exact same left horizontal axis.
        ────────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0 select-none pointer-events-none">
          {standardizedFloors.map((fl) => {
            const isHovered =
              hoveredPointId === fl.id ||
              hoveredPointId === fl.id.replace("label-", "") ||
              hoveredPointId === `label-${fl.id}`;
            const effectiveOpacity = fl.opacity * (isDragging ? 0.45 : 1.0);

            return (
              <div
                key={fl.id}
                className="floor-item-wrapper absolute transition-all duration-150 pointer-events-auto"
                style={{
                  left: `${NAV_LEFT_RATIO * 100}%`,
                  top: `${fl.y * 100}%`,
                  transform: "translateY(-50%)",
                  width: `${NAV_WIDTH_PX}px`,
                  height: `${ITEM_HEIGHT_PX}px`,
                }}
              >
                <button
                  type="button"
                  onMouseEnter={() => !isDragging && setHoveredPointId(fl.id)}
                  onMouseLeave={() => setHoveredPointId(null)}
                  onClick={(e) => handleItemClick(fl.id, "floorLabel", fl.displayName, e)}
                  style={{
                    opacity: effectiveOpacity,
                    pointerEvents: isDragging ? "none" : "auto",
                  }}
                  className={`
                    floor-item w-full h-full group cursor-pointer transition-all duration-150
                    rounded-xl border backdrop-blur-xl
                    ${isHovered
                      ? "bg-amber-950/95 border-amber-400 text-amber-100 shadow-[0_0_16px_rgba(245,158,11,0.6)] scale-105"
                      : "bg-[#03241b]/90 border-amber-500/40 text-amber-200 shadow-md hover:border-amber-400 hover:scale-105"
                    }
                  `}
                >
                  <span className="floor-icon">
                    <span
                      className={`w-2 h-2 rounded-full transition-transform duration-150 ${
                        isHovered
                          ? "bg-amber-300 scale-125 shadow-[0_0_10px_rgba(245,158,11,1)]"
                          : "bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.7)]"
                      }`}
                    />
                  </span>
                  <span className="floor-label text-xs font-semibold tracking-wide font-mono">
                    {fl.displayName}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
