import React, { useMemo, useState, useEffect } from "react";
import { ViewerEngine } from "./core/ViewerEngine";
import { ViewerEngineState } from "./types/viewer";
import { ViewerCanvas } from "./components/ViewerCanvas";
import { ControlBar } from "./components/ControlBar";
import { CompassIndicator } from "./components/CompassIndicator";
import { AnchorPills } from "./components/AnchorPills";
import { PerformanceStats } from "./components/PerformanceStats";
import { TOTAL_FRAMES } from "./core/CircularMath";
import { MoveHorizontal } from "lucide-react";

export const App: React.FC = () => {
  // Each decoded HQ frame (2560x1440) costs ~14.7 MB -> keep fewer on low-memory devices.
  const maxCacheSize = useMemo(() => {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return mem !== undefined && mem <= 4 ? 6 : 10;
  }, []);
  // Equal sector splitting: half-distance between 6 anchor frames (120 / 6 / 2 = 10 frames)
  const snapThreshold = 10;

  // Instantiate high performance viewer engine
  const engine = useMemo(
    () => new ViewerEngine(maxCacheSize, snapThreshold),
    [maxCacheSize, snapThreshold]
  );

  const [state, setState] = useState<ViewerEngineState>(() => engine.getState());
  const [showStats, setShowStats] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    // Canvas/network lifecycle is owned by <ViewerCanvas>; here we only subscribe to state.
    return engine.subscribe((newState) => {
      setState(newState);
      if (newState.isDragging) setHasInteracted(true);
    });
  }, [engine]);

  const isPreloading = state.loadedFramesCount < TOTAL_FRAMES;
  const preloadPercent = Math.round((state.loadedFramesCount / TOTAL_FRAMES) * 100);

  const [activeToast, setActiveToast] = useState<string | null>(null);

  useEffect(() => {
    const handleHotspotClick = (e: Event) => {
      const customEv = e as CustomEvent<{ id: string; type: string; name: string }>;
      const { id, type, name } = customEv.detail || {};
      const typeLabel = type === "floor" ? "Tầng" : type === "floorLabel" ? "Nhãn Tầng" : "Điểm Hotspot";
      setActiveToast(`Đã click [${typeLabel}]: ${name} (${id})`);

      setTimeout(() => {
        setActiveToast((current) => (current?.includes(id) ? null : current));
      }, 3000);
    };

    window.addEventListener("hotspot:click", handleHotspotClick);
    return () => window.removeEventListener("hotspot:click", handleHotspotClick);
  }, []);

  return (
    <main className="relative w-screen h-screen bg-[#021712] overflow-hidden select-none flex flex-col justify-between">
      {/* Top Header & Controls */}
      <ControlBar
        displayFrame={state.displayFrame}
        totalFrames={TOTAL_FRAMES}
        activeAnchor={state.activeAnchor}
        approachingAnchor={state.approachingAnchor}
        onResetView={() => engine.resetView()}
        onToggleStats={() => setShowStats((prev) => !prev)}
        showStats={showStats}
      />

      {/* Main 360 Canvas Viewport */}
      <div className="absolute inset-0 z-0">
        <ViewerCanvas engine={engine} state={state} />
      </div>

      {/* Hotspot Click Event Toast Banner */}
      {activeToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl bg-red-950/90 border border-red-500/60 text-red-100 text-xs font-semibold shadow-[0_8px_32px_rgba(239,68,68,0.4)] backdrop-blur-xl animate-bounce">
          {activeToast}
        </div>
      )}

      {/* Initial loading spinner (only until the very first frame is painted) */}
      {!state.isReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="w-10 h-10 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin" />
        </div>
      )}

      {/* Thin background preload progress bar */}
      {isPreloading && state.isReady && (
        <div className="absolute top-0 left-0 right-0 z-30 h-0.5 bg-amber-500/10 pointer-events-none">
          <div
            className="h-full bg-amber-400/80 transition-[width] duration-300 ease-out"
            style={{ width: `${preloadPercent}%` }}
          />
        </div>
      )}

      {/* Realtime Diagnostics HUD */}
      {showStats && <PerformanceStats state={state} maxCacheSize={maxCacheSize} />}

      {/* Subtle First-Time User Interaction Hint */}
      {state.isReady && !hasInteracted && !state.isDragging && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none flex flex-col items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-[#03241b]/90 border border-amber-500/40 backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] text-amber-100 animate-pulse">
          <MoveHorizontal className="w-6 h-6 text-amber-400" />
          <span className="text-xs font-semibold tracking-wide uppercase font-mono">
            Kéo chuột để xoay 360° TAV
          </span>
        </div>
      )}

      {/* Bottom Floating Control Deck: 360° Compass & Anchor Quick Jump */}
      <div className="absolute bottom-6 left-0 right-0 z-20 flex flex-col items-center gap-4 px-4 pointer-events-none select-none">
        {/* Compass Dial HUD */}
        <div className="pointer-events-auto">
          <CompassIndicator
            currentFrame={state.currentFrame}
            displayFrame={state.displayFrame}
            activeAnchor={state.activeAnchor}
            approachingAnchor={state.approachingAnchor}
            proximityDistance={state.proximityDistance}
            onSelectAnchor={(frame) => engine.jumpToAnchor(frame)}
          />
        </div>

        {/* 6 Predefined Anchor Viewpoints Dock */}
        <div className="pointer-events-auto max-w-full">
          <AnchorPills
            activeAnchor={state.activeAnchor}
            approachingAnchor={state.approachingAnchor}
            proximityDistance={state.proximityDistance}
            onSelectAnchor={(frame) => engine.jumpToAnchor(frame)}
          />
        </div>
      </div>
    </main>
  );
};
