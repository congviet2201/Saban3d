import React from "react";
import { ANCHOR_VIEWPOINTS } from "../core/CircularMath";
import { AnchorViewpoint } from "../types/viewer";

interface AnchorPillsProps {
  activeAnchor: AnchorViewpoint | null;
  approachingAnchor: AnchorViewpoint | null;
  proximityDistance: number;
  onSelectAnchor: (frame: number) => void;
}

export const AnchorPills: React.FC<AnchorPillsProps> = ({
  activeAnchor,
  approachingAnchor,
  proximityDistance,
  onSelectAnchor,
}) => {
  return (
    <div className="flex items-center gap-2 p-2 rounded-2xl bg-[#03241b]/90 border border-amber-500/30 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.5)] overflow-x-auto max-w-full no-scrollbar">
      {ANCHOR_VIEWPOINTS.map((anchor) => {
        const isActive = activeAnchor?.frame === anchor.frame;
        const isApproaching =
          approachingAnchor?.frame === anchor.frame && proximityDistance <= 10 && !isActive;

        return (
          <button
            key={anchor.frame}
            onClick={() => onSelectAnchor(anchor.frame)}
            className={`group relative flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap select-none ${
              isActive
                ? "bg-gradient-to-r from-amber-500/30 to-emerald-600/30 text-amber-200 border border-amber-400/60 shadow-[0_0_16px_rgba(245,158,11,0.35)]"
                : isApproaching
                ? "bg-emerald-900/60 text-amber-100 border border-amber-500/40"
                : "text-emerald-200/70 hover:text-amber-200 hover:bg-emerald-800/30 border border-transparent"
            }`}
          >
            {/* Status dot */}
            <span
              className={`w-2 h-2 rounded-full transition-all ${
                isActive
                  ? "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,1)] scale-110"
                  : isApproaching
                  ? "bg-emerald-400"
                  : "bg-emerald-700 group-hover:bg-amber-400/70"
              }`}
            />
            <span className="font-mono text-[10px] text-amber-400/70 group-hover:text-amber-300">
              {String(anchor.id).padStart(2, "0")}
            </span>
            <span className="text-xs font-medium tracking-wide">{anchor.label}</span>
          </button>
        );
      })}
    </div>
  );
};

