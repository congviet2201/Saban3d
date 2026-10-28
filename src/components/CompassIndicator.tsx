import React from "react";
import { ANCHOR_VIEWPOINTS, frameToAzimuth, TOTAL_FRAMES } from "../core/CircularMath";
import { AnchorViewpoint } from "../types/viewer";

interface CompassIndicatorProps {
  currentFrame: number;
  displayFrame: number;
  activeAnchor: AnchorViewpoint | null;
  approachingAnchor: AnchorViewpoint | null;
  proximityDistance: number;
  onSelectAnchor: (frame: number) => void;
}

export const CompassIndicator: React.FC<CompassIndicatorProps> = ({
  currentFrame,
  displayFrame,
  activeAnchor,
  approachingAnchor,
  proximityDistance,
  onSelectAnchor,
}) => {
  const azimuth = frameToAzimuth(currentFrame, TOTAL_FRAMES);

  // Cardinal direction helper
  const getCardinal = (deg: number): string => {
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
    const index = Math.round(deg / 45) % 8;
    return directions[index];
  };

  const compassSize = 72;
  const radius = 25;
  const center = compassSize / 2;

  return (
    <div className="flex flex-col items-center select-none pb-2">
      <div className="relative group">
        {/* SVG Circular Dial */}
        <svg
          width={compassSize}
          height={compassSize}
          viewBox={`0 0 ${compassSize} ${compassSize}`}
          className="filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
        >
          {/* Outer Ring Background */}
          <circle
            cx={center}
            cy={center}
            r={radius + 5}
            fill="rgba(3, 36, 27, 0.88)"
            stroke="rgba(245, 158, 11, 0.35)"
            strokeWidth="1.2"
            className="backdrop-blur-md"
          />

          {/* 360 Degree Tick Marks */}
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = (i * 15 * Math.PI) / 180;
            const isMajor = i % 6 === 0;
            const tickLength = isMajor ? 3.5 : 2;
            const x1 = center + Math.sin(angle) * (radius - tickLength);
            const y1 = center - Math.cos(angle) * (radius - tickLength);
            const x2 = center + Math.sin(angle) * radius;
            const y2 = center - Math.cos(angle) * radius;

            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isMajor ? "rgba(245, 158, 11, 0.65)" : "rgba(16, 185, 129, 0.35)"}
                strokeWidth={isMajor ? 1.2 : 0.8}
              />
            );
          })}

          {/* Anchor Points Markers on the Circle */}
          {ANCHOR_VIEWPOINTS.map((anchor) => {
            const angleRad = ((anchor.frame - 1) / TOTAL_FRAMES) * 2 * Math.PI;
            const x = center + Math.sin(angleRad) * radius;
            const y = center - Math.cos(angleRad) * radius;

            const isActive = activeAnchor?.frame === anchor.frame;
            const isApproaching = approachingAnchor?.frame === anchor.frame && proximityDistance <= 10;

            return (
              <g
                key={anchor.frame}
                className="cursor-pointer transition-all duration-200"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAnchor(anchor.frame);
                }}
              >
                {/* Proximity Glow ring */}
                {(isActive || isApproaching) && (
                  <circle
                    cx={x}
                    cy={y}
                    r={isActive ? 4.5 : 3.5}
                    fill="none"
                    stroke={isActive ? "#fbbf24" : "rgba(245, 158, 11, 0.6)"}
                    strokeWidth="1"
                    className={isActive ? "animate-pulse-subtle" : ""}
                  />
                )}
                {/* Anchor Dot */}
                <circle
                  cx={x}
                  cy={y}
                  r={isActive ? 2.8 : isApproaching ? 2.2 : 1.6}
                  fill={isActive ? "#fbbf24" : isApproaching ? "#f59e0b" : "rgba(16, 185, 129, 0.7)"}
                  className="transition-all duration-150 hover:r-[3.5px] hover:fill-[#fbbf24]"
                />
              </g>
            );
          })}

          {/* Rotating Compass Heading Needle */}
          <g
            transform={`rotate(${azimuth}, ${center}, ${center})`}
            className="transition-transform duration-75 ease-out"
          >
            {/* North Arrow Needle */}
            <polygon
              points={`${center},${center - radius + 3.5} ${center - 2.5},${center - 4} ${center + 2.5},${center - 4}`}
              fill="#fbbf24"
              className="filter drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]"
            />
            {/* South Tail */}
            <polygon
              points={`${center},${center + radius - 3.5} ${center - 2},${center + 4} ${center + 2},${center + 4}`}
              fill="rgba(16, 185, 129, 0.45)"
            />
            {/* Center Pivot */}
            <circle cx={center} cy={center} r={1.8} fill="#ffffff" />
          </g>
        </svg>

        {/* Central Azimuth Readout Badge */}
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#03241b]/95 border border-amber-500/40 backdrop-blur-md shadow-[0_2px_8px_rgba(0,0,0,0.5)] text-[9px] font-mono whitespace-nowrap text-amber-100">
          <span className="text-amber-300 font-bold">{getCardinal(azimuth)}</span>
          <span className="text-emerald-500/50">|</span>
          <span>{Math.round(azimuth)}°</span>
          <span className="text-emerald-300/60 text-[8px]">({String(displayFrame).padStart(3, "0")})</span>
        </div>
      </div>
    </div>
  );
};

