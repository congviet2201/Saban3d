import React, { useRef, useEffect } from "react";
import { ViewerEngine } from "../core/ViewerEngine";
import { ViewerEngineState } from "../types/viewer";
import { HotspotOverlay } from "./HotspotOverlay";

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

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden select-none bg-[#021712]">
      <canvas
        ref={canvasRef}
        className={`w-full h-full block touch-none select-none transition-cursor ${
          state.isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          touchAction: "none",
          WebkitTouchCallout: "none",
          userSelect: "none",
        }}
      />
      {/* Standalone SVG Hotspot Overlay Layer */}
      <HotspotOverlay
        displayFrame={state.displayFrame}
        isDragging={state.isDragging}
        imageBounds={state.imageBounds}
      />
    </div>
  );
};
