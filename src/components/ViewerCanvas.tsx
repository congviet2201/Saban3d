import React, { useRef, useEffect } from "react";
import { ViewerEngine } from "../core/ViewerEngine";
import { ViewerEngineState } from "../types/viewer";
import { HotspotOverlay } from "./HotspotOverlay";
import { FloorLayerPanel } from "./FloorLayerPanel";

interface ViewerCanvasProps {
  engine: ViewerEngine;
  state: ViewerEngineState;
}

export const ViewerCanvas: React.FC<ViewerCanvasProps> = ({ engine, state }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    engine.init(canvas);
    return () => engine.detach();
  }, [engine]);

  const frameNumStr = String(state.displayFrame).padStart(3, "0");

  return (
    <div className="viewer-container panorama-container relative w-full h-full flex items-center justify-center overflow-hidden select-none bg-[#021712]">
      {/* Dynamic ambient backdrop from current 360 frame — eliminates harsh black bars on all screen ratios */}
      <img
        src={`/frames/lq/${frameNumStr}.webp`}
        alt=""
        aria-hidden="true"
        className="absolute inset-[-60px] w-[calc(100%+120px)] h-[calc(100%+120px)] object-cover blur-[50px] saturate-[130%] brightness-[0.38] opacity-95 z-0 pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          background: "radial-gradient(120% 90% at 50% 42%, rgba(2,23,18,0) 40%, rgba(2,23,18,0.70) 100%)",
        }}
      />

      {/* Main 360° render canvas */}
      <canvas
        id="viewer"
        ref={canvasRef}
        className={`relative z-[1] w-full h-full block touch-none select-none transition-cursor ${
          state.isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          touchAction: "none",
          WebkitTouchCallout: "none",
          userSelect: "none",
        }}
      />

      {/* SVG hotspot overlay (floor polygons, point labels, floor name tags) */}
      <HotspotOverlay
        displayFrame={state.displayFrame}
        isDragging={state.isDragging}
        imageBounds={state.imageBounds}
      />

      {/* Floor-layer hover overlay + side panel (imageset_layering integration) */}
      <FloorLayerPanel
        displayFrame={state.displayFrame}
        isDragging={state.isDragging}
        imageBounds={state.imageBounds}
        canvasRef={canvasRef}
      />
    </div>
  );
};
