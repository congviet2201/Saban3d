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
  const [hoveredFloorId, setHoveredFloorId] = useState<string | null>(null);
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

  if (!data || !imageBounds.width || !imageBounds.height) {
    return null;
  }

  const { left, top, width, height } = imageBounds;

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
      {/* SVG Layer for Polygons, Leader Lines, & Target Dots */}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="w-full h-full absolute inset-0 overflow-visible"
        style={{ pointerEvents: "none" }}
      >
        {/* 1. Floor Zone Polygons */}
        {interpolatedFloors.map((floor) => {
          if (!floor.visible || floor.opacity <= 0.05 || !floor.points || floor.points.length < 3) return null;
          const pointsString = floor.points.map((pt) => `${pt[0]},${pt[1]}`).join(" ");
          const isHovered = hoveredFloorId === floor.id;
          const isInteractive = !isDragging && floor.visible && floor.opacity > 0.05;

          return (
            <polygon
              key={floor.id}
              points={pointsString}
              className="transition-all duration-200 ease-out"
              style={{
                pointerEvents: isInteractive ? "auto" : "none",
                cursor: "pointer",
                opacity: floor.opacity,
                fill: isHovered ? "rgba(239, 68, 68, 0.35)" : "rgba(239, 68, 68, 0.01)",
                stroke: isHovered ? "#ef4444" : "transparent",
                strokeWidth: isHovered ? 0.003 : 0,
                filter: isHovered ? "drop-shadow(0 0 0.015px rgba(239, 68, 68, 0.8))" : "none",
              }}
              onMouseEnter={() => isInteractive && setHoveredFloorId(floor.id)}
              onMouseLeave={() => setHoveredFloorId(null)}
              onClick={(e) => handleItemClick(floor.id, "floor", floor.name, e)}
            />
          );
        })}

        {/* 2. Point Hotspots Leader Lines & Targets */}
        {interpolatedPoints.map((pt) => {
          if (!pt.visible || pt.opacity <= 0.05) return null;
          const isHovered = hoveredPointId === pt.id;

          return (
            <g key={pt.id} style={{ opacity: pt.opacity }}>
              {/* Leader Line */}
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
              {/* Target Dot Pulsing Outer Ring */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isHovered ? 0.012 : 0.008}
                fill="rgba(239, 68, 68, 0.3)"
                className={isHovered ? "animate-pulse" : ""}
              />
              {/* Target Dot Center Core */}
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

        {/* 3. Floor Name Labels Leader Lines */}
        {interpolatedFloorLabels.map((fl) => {
          if (!fl.visible || fl.opacity <= 0.05) return null;
          const isHovered = hoveredPointId === fl.id;

          return (
            <g key={fl.id} style={{ opacity: fl.opacity }}>
              <line
                x1={fl.x}
                y1={fl.y}
                x2={fl.lx}
                y2={fl.ly}
                stroke={isHovered ? "#f59e0b" : "rgba(245, 158, 11, 0.7)"}
                strokeWidth={isHovered ? 0.0025 : 0.0018}
                className="transition-all duration-200"
              />
              <circle
                cx={fl.x}
                cy={fl.y}
                r={0.004}
                fill="#f59e0b"
                className="transition-all duration-200"
              />
            </g>
          );
        })}
      </svg>

      {/* HTML Overlay Layer for Point Labels & Floor Name Tags */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Point Hotspot Label Cards */}
        {interpolatedPoints.map((pt) => {
          if (!pt.visible || pt.opacity <= 0.05) return null;
          const isHovered = hoveredPointId === pt.id;
          const effectiveOpacity = pt.opacity * (isDragging ? 0.5 : 1.0);

          return (
            <div
              key={pt.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-200"
              style={{
                left: `${pt.lx * 100}%`,
                top: `${pt.ly * 100}%`,
                opacity: effectiveOpacity,
                pointerEvents: isDragging ? "none" : "auto",
              }}
            >
              <button
                type="button"
                onMouseEnter={() => !isDragging && setHoveredPointId(pt.id)}
                onMouseLeave={() => setHoveredPointId(null)}
                onClick={(e) => handleItemClick(pt.id, "point", pt.name, e)}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg border backdrop-blur-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-all duration-200 ${
                  isHovered
                    ? "bg-red-950/90 border-red-400 text-red-100 scale-105 shadow-[0_0_20px_rgba(239,68,68,0.7)]"
                    : "bg-[#03241b]/95 border-red-500/60 text-red-100 shadow-[0_4px_16px_rgba(0,0,0,0.5)] hover:border-red-400 hover:scale-105"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-red-500 group-hover:bg-red-400 animate-pulse" />
                <span>{pt.name}</span>
              </button>
            </div>
          );
        })}

        {/* Floor Name Label Tags */}
        {interpolatedFloorLabels.map((fl) => {
          if (!fl.visible || fl.opacity <= 0.05) return null;
          const isHovered = hoveredPointId === fl.id;
          const effectiveOpacity = fl.opacity * (isDragging ? 0.5 : 1.0);

          return (
            <div
              key={fl.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-200"
              style={{
                left: `${fl.lx * 100}%`,
                top: `${fl.ly * 100}%`,
                opacity: effectiveOpacity,
                pointerEvents: isDragging ? "none" : "auto",
              }}
            >
              <button
                type="button"
                onMouseEnter={() => !isDragging && setHoveredPointId(fl.id)}
                onMouseLeave={() => setHoveredPointId(null)}
                onClick={(e) => handleItemClick(fl.id, "floorLabel", fl.name, e)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border backdrop-blur-md text-[11px] font-mono tracking-wider whitespace-nowrap cursor-pointer transition-all duration-200 ${
                  isHovered
                    ? "bg-amber-950/90 border-amber-400 text-amber-100 scale-105 shadow-[0_0_16px_rgba(245,158,11,0.6)]"
                    : "bg-[#03241b]/90 border-amber-500/50 text-amber-200 shadow-md hover:border-amber-400 hover:scale-105"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>{fl.name}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
