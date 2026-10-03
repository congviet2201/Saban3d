import React, { useState } from "react";
import { RotateCcw, Maximize2, Minimize2, Activity, Sparkles } from "lucide-react";
import { AnchorViewpoint } from "../types/viewer";

interface ControlBarProps {
  displayFrame: number;
  totalFrames: number;
  activeAnchor: AnchorViewpoint | null;
  approachingAnchor: AnchorViewpoint | null;
  onResetView: () => void;
  onToggleStats: () => void;
  showStats: boolean;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  displayFrame,
  totalFrames,
  activeAnchor,
  approachingAnchor,
  onResetView,
  onToggleStats,
  showStats,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
        setIsFullscreen(false);
      }
    }
  };

  const currentViewTitle = activeAnchor
    ? `${activeAnchor.label}: ${activeAnchor.name}`
    : approachingAnchor
    ? `Đang tiến tới ${approachingAnchor.label}`
    : "Xoay 360° Tự Do";

  return (
    <header className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none select-none">
      {/* Brand Title: TAV */}
      <div className="flex items-center gap-3.5 pointer-events-auto bg-[#03241b]/85 border border-amber-500/30 backdrop-blur-xl px-4 py-2.5 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all hover:border-amber-500/50">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-600/30 via-emerald-500/20 to-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-extrabold tracking-widest text-amber-100 uppercase font-mono">
              TAV
            </h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40 font-mono font-bold tracking-wide">
              360° MODEL
            </span>
          </div>
          <p className="text-[11px] text-emerald-300/70 font-medium">
            Architectural Interactive Viewer
          </p>
        </div>
      </div>

      {/* Center Viewpoint Readout */}
      <div className="hidden md:flex items-center gap-3 pointer-events-auto bg-[#03241b]/85 border border-amber-500/30 backdrop-blur-xl px-5 py-2 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            activeAnchor
              ? "bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.9)] animate-pulse"
              : "bg-emerald-600"
          }`}
        />
        <span className="text-xs font-semibold text-emerald-100">{currentViewTitle}</span>
        <span className="text-amber-500/40 text-xs">|</span>
        <span className="text-[11px] font-mono text-emerald-300/80">
          FRAME <strong className="text-amber-300 font-bold">{String(displayFrame).padStart(3, "0")}</strong> / {totalFrames}
        </span>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          onClick={onToggleStats}
          title="Toggle Engine Diagnostics"
          className={`p-2.5 rounded-xl border backdrop-blur-xl transition-all flex items-center justify-center shadow-lg ${
            showStats
              ? "bg-amber-500/20 border-amber-400/50 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
              : "bg-[#03241b]/85 border-amber-500/30 text-emerald-200 hover:text-amber-300 hover:border-amber-400/50"
          }`}
        >
          <Activity className="w-4 h-4" />
        </button>

        <button
          onClick={onResetView}
          title="Reset to View 01"
          className="p-2.5 rounded-xl bg-[#03241b]/85 border border-amber-500/30 text-emerald-200 hover:text-amber-300 hover:border-amber-400/50 backdrop-blur-xl transition-all shadow-lg flex items-center justify-center"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          className="p-2.5 rounded-xl bg-[#03241b]/85 border border-amber-500/30 text-emerald-200 hover:text-amber-300 hover:border-amber-400/50 backdrop-blur-xl transition-all shadow-lg flex items-center justify-center"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
};

