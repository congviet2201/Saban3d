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
    const fetchUrl = dataUrl.includes("?") ? dataUrl : `${dataUrl}?v=${Date.now()}`;
    fetch(fetchUrl, { cache: "no-store" })
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

  if (!data || !imageBounds.width || !imageBounds.height) {
    return null;
  }

  const { left, top, width, height } = imageBounds;

  // Mandatory Frame 10 enforcement: Point hotspots visible exclusively on Frame 10
  const isFrame10 = displayFrame === 10;

  return (
    <div
      className="absolute pointer-events-none select-none transition-opacity duration-200 z-[20] overflow-visible"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {/* SVG Layer for Floor Polygons (authoritative canvas pixel masks handle 120-frame hover) */}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="w-full h-full absolute inset-0 overflow-visible"
        style={{ pointerEvents: "none" }}
      >
        {interpolatedFloors.map((floor) => {
          if (!floor.visible || floor.opacity <= 0.05 || !floor.points || floor.points.length < 3) return null;
          const pointsString = floor.points.map((pt) => `${pt[0]},${pt[1]}`).join(" ");

          return (
            <polygon
              key={floor.id}
              points={pointsString}
              style={{
                pointerEvents: "none",
                opacity: floor.opacity,
                fill: "transparent",
                stroke: "transparent",
                strokeWidth: 0,
              }}
            />
          );
        })}
      </svg>

      {/* HTML Overlay Layer for Upright Location Pillars */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Four Location Hotspots rendered as Vertical Architectural Pillars — Exclusively visible on Frame 10 */}
        {isFrame10 &&
          interpolatedPoints.map((pt) => {
            if (!pt.visible || pt.opacity <= 0.05) return null;
            const isHovered = hoveredPointId === pt.id;
            const effectiveOpacity = pt.opacity * (isDragging ? 0.4 : 1.0);
            const getHotspotDisplayName = (id: string, name: string): string => {
              const lower = (id + " " + name).toLowerCase();
              if (lower.includes("ban-cong") || lower.includes("ban công") || lower.includes("balcony")) {
                return "Ban công thượng uyển";
              }
              if (lower.includes("ho-boi") || lower.includes("hồ") || lower.includes("bơi") || lower.includes("pool")) {
                return "Hồ bơi";
              }
              if (lower.includes("vuon") || lower.includes("vườn") || lower.includes("nhat") || lower.includes("nhật") || lower.includes("garden")) {
                return "Vườn Nhật";
              }
              if (lower.includes("chinh") || lower.includes("chính") || lower.includes("vao") || lower.includes("vào") || lower.includes("entrance")) {
                return "Lối vào chính";
              }
              return name;
            };
            const displayName = getHotspotDisplayName(pt.id, pt.name);

            const PILLAR_HEIGHT = 68;

            return (
              <div
                key={pt.id}
                className="location-pillar-wrapper absolute transition-all duration-200"
                style={{
                  left: `${pt.x * 100}%`,
                  top: `${pt.y * 100}%`,
                  opacity: effectiveOpacity,
                  pointerEvents: isDragging ? "none" : "auto",
                  zIndex: isHovered ? 30 : 20,
                }}
              >
                {/* 1. Ground Anchor Base (perspective elliptical base plate + glowing core) */}
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none"
                  style={{ width: "36px", height: "18px" }}
                >
                  {/* Subtle ground contact glow */}
                  <div
                    className="absolute inset-0 rounded-[50%] transition-all duration-300"
                    style={{
                      background: isHovered
                        ? "radial-gradient(ellipse at center, rgba(245, 158, 11, 0.45) 0%, rgba(245, 158, 11, 0) 70%)"
                        : "radial-gradient(ellipse at center, rgba(245, 158, 11, 0.25) 0%, rgba(245, 158, 11, 0) 70%)",
                    }}
                  />
                  {/* Elliptical base ring */}
                  <svg
                    width="36"
                    height="18"
                    viewBox="0 0 36 18"
                    className="absolute inset-0 overflow-visible"
                  >
                    <ellipse
                      cx="18"
                      cy="9"
                      rx={isHovered ? 14 : 11}
                      ry={isHovered ? 6 : 4.5}
                      fill="rgba(245, 158, 11, 0.15)"
                      stroke={isHovered ? "#fbbf24" : "rgba(245, 158, 11, 0.7)"}
                      strokeWidth="1.2"
                      className="transition-all duration-200"
                    />
                    <ellipse
                      cx="18"
                      cy="9"
                      rx="4"
                      ry="2"
                      fill="#ffffff"
                      opacity="0.8"
                    />
                  </svg>
                  {/* Anchor pin point */}
                  <span
                    className={`w-1.5 h-1.5 rounded-full z-10 transition-all duration-200 ${
                      isHovered
                        ? "bg-white shadow-[0_0_8px_#ffffff]"
                        : "bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
                    }`}
                  />
                </div>

                {/* 2. Slender Vertical Architectural Pillar Shaft */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 cursor-pointer transition-all duration-200"
                  style={{
                    bottom: 0,
                    width: isHovered ? "3px" : "2px",
                    height: `${PILLAR_HEIGHT}px`,
                    background: isHovered
                      ? "linear-gradient(to top, rgba(245, 158, 11, 0.4) 0%, rgba(251, 191, 36, 0.95) 50%, rgba(255, 255, 255, 1) 100%)"
                      : "linear-gradient(to top, rgba(245, 158, 11, 0.3) 0%, rgba(245, 158, 11, 0.85) 60%, rgba(255, 255, 255, 0.9) 100%)",
                    boxShadow: isHovered
                      ? "0 0 14px rgba(251, 191, 36, 0.85), 0 0 4px rgba(255, 255, 255, 0.9)"
                      : "0 0 8px rgba(245, 158, 11, 0.5)",
                    borderRadius: "2px",
                  }}
                  onMouseEnter={() => !isDragging && setHoveredPointId(pt.id)}
                  onMouseLeave={() => setHoveredPointId(null)}
                  onClick={(e) => handleItemClick(pt.id, "point", displayName, e)}
                >
                  {/* Architectural subtle horizontal collar ribs */}
                  <span className="absolute top-1/3 left-1/2 -translate-x-1/2 w-2 h-[1px] bg-amber-200/90 shadow-[0_0_3px_#fbbf24]" />
                  <span className="absolute top-2/3 left-1/2 -translate-x-1/2 w-2 h-[1px] bg-amber-200/90 shadow-[0_0_3px_#fbbf24]" />
                </div>

                {/* 3. Pillar Capital / Beacon Node (Atop the Shaft) */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 cursor-pointer transition-all duration-200 z-10 flex items-center justify-center"
                  style={{
                    bottom: `${PILLAR_HEIGHT - 3}px`,
                    width: isHovered ? "10px" : "8px",
                    height: isHovered ? "10px" : "8px",
                  }}
                  onMouseEnter={() => !isDragging && setHoveredPointId(pt.id)}
                  onMouseLeave={() => setHoveredPointId(null)}
                  onClick={(e) => handleItemClick(pt.id, "point", displayName, e)}
                >
                  <span
                    className="w-full h-full rotate-45 transition-all duration-200"
                    style={{
                      background: isHovered ? "#ffffff" : "#fbbf24",
                      border: "1px solid rgba(255, 255, 255, 0.9)",
                      boxShadow: isHovered
                        ? "0 0 14px rgba(255, 255, 255, 1), 0 0 20px rgba(245, 158, 11, 0.9)"
                        : "0 0 8px rgba(251, 191, 36, 0.8)",
                    }}
                  />
                </div>

                {/* 4. Architectural Label Card (Centered Directly Above the Pillar) */}
                <button
                  type="button"
                  translate="no"
                  onMouseEnter={() => !isDragging && setHoveredPointId(pt.id)}
                  onMouseLeave={() => setHoveredPointId(null)}
                  onClick={(e) => handleItemClick(pt.id, "point", displayName, e)}
                  className={`
                    notranslate absolute left-1/2 -translate-x-1/2 cursor-pointer select-none
                    flex items-center gap-2 px-3 py-1.5 rounded-xl
                    border backdrop-blur-xl transition-all duration-200 whitespace-nowrap
                    ${isHovered
                      ? "scale-105 bg-[#021a14] border-amber-300 text-white shadow-[0_8px_24px_rgba(0,0,0,0.8),0_0_16px_rgba(245,158,11,0.5)]"
                      : "bg-[#021712]/95 border-amber-500/40 text-amber-100 shadow-[0_6px_20px_rgba(0,0,0,0.6),0_0_12px_rgba(245,158,11,0.2)] hover:border-amber-400 hover:scale-105"
                    }
                  `}
                  style={{
                    bottom: `${PILLAR_HEIGHT + 7}px`,
                  }}
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-none transition-all duration-200 ${
                      isHovered
                        ? "bg-amber-300 scale-125 shadow-[0_0_10px_rgba(251,191,36,1)]"
                        : "bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.8)] animate-pulse"
                    }`}
                  />
                  <span
                    translate="no"
                    className="notranslate text-xs font-semibold tracking-wide font-sans drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                  >
                    {displayName}
                  </span>
                </button>
              </div>
            );
          })}
      </div>
    </div>
  );
};
