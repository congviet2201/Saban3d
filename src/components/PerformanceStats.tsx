import React from "react";
import { ViewerEngineState } from "../types/viewer";

interface PerformanceStatsProps {
  state: ViewerEngineState;
  maxCacheSize: number;
}

export const PerformanceStats: React.FC<PerformanceStatsProps> = ({ state, maxCacheSize }) => {
  return (
    <div className="absolute top-20 right-4 z-20 w-64 bg-[#03241b]/90 border border-amber-500/30 backdrop-blur-2xl rounded-2xl p-3.5 shadow-2xl text-[11px] font-mono select-none space-y-2 pointer-events-none">
      <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
        <span className="text-emerald-400 font-semibold uppercase tracking-wider text-[10px]">
          Engine Diagnostics
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
            state.isIdle
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              : state.isSnapping
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
              : "bg-amber-400/20 text-amber-200 border border-amber-400/50"
          }`}
        >
          {state.isIdle ? "IDLE (0% CPU)" : state.isSnapping ? "SNAPPING" : "ROTATING"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-y-1.5 text-emerald-100/90">
        <span className="text-emerald-400/70">Render FPS:</span>
        <span className={`text-right font-bold ${state.fps >= 55 ? "text-emerald-300" : "text-amber-300"}`}>
          {state.isIdle ? "-- (idle)" : `${state.fps} fps`}
        </span>

        <span className="text-emerald-400/70">Frame (Float):</span>
        <span className="text-right text-emerald-200">{state.currentFrame.toFixed(2)}</span>

        <span className="text-emerald-400/70">Display Frame:</span>
        <span className="text-right text-amber-300 font-bold">{state.displayFrame} / 120</span>

        <span className="text-emerald-400/70">Quality:</span>
        <span className={`text-right font-bold ${state.isFallback ? "text-amber-300" : "text-emerald-300"}`}>
          {state.isFallback ? "LQ 540p" : "HQ 1440p"}
        </span>

        <span className="text-emerald-400/70">LQ Preloaded:</span>
        <span className="text-right text-emerald-200">{state.loadedFramesCount} / 120</span>

        <span className="text-emerald-400/70">HQ Cache:</span>
        <span className="text-right text-emerald-200">
          {state.cachedFramesCount} / {maxCacheSize} frames
        </span>

        <span className="text-emerald-400/70">Nearest Anchor:</span>
        <span className="text-right text-emerald-200">
          {state.approachingAnchor ? `Frame ${state.approachingAnchor.frame}` : "None"}
        </span>

        <span className="text-emerald-400/70">Anchor Dist:</span>
        <span className="text-right text-emerald-200">{state.proximityDistance.toFixed(1)} frames</span>

        <span className="text-emerald-400/70">Drag Direction:</span>
        <span className="text-right text-emerald-200 uppercase">{state.direction}</span>

        <span className="text-emerald-400/70">RAF Loop:</span>
        <span className={`text-right font-semibold ${state.isIdle ? "text-emerald-600" : "text-amber-300"}`}>
          {state.isIdle ? "Stopped" : "Active"}
        </span>
      </div>
    </div>
  );
};

