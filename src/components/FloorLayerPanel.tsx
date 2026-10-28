import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { ImageBounds } from "../types/viewer";
import { X } from "lucide-react";

/* ============================================================
   FloorLayerPanel – floor-hover overlay integrated into the
   main 360° React viewer.

   Architecture:
   - A hidden hit-canvas (HIT_W × HIT_H) holds colour-coded
     floor masks for the current frame for pixel hit-testing.
   - A visible overlay canvas (fills the viewer area) draws the
     semi-transparent coloured mask only for the hovered floor.
   - Pointer events are handled on the MAIN viewer canvas (via
     its container div) so they never block the drag controller.
   - A glass side-panel lists floors with toggle switches,
     matching the existing dark/amber design language.
   ============================================================ */

// ---------- Configuration ----------
const OVERLAY_BASE    = "/imageset_layering/overlays";
const OVERLAY_CACHE_MAX = 60; // Expanded to 60 frames to eliminate reloads and latency during rotation

const HOVER_OPACITY = 0.55; // alpha when a floor is hovered
const BASE_OPACITY  = 0;    // hidden otherwise

const HIT_W = 960;
const HIT_H = 540;

// ---------- Data ----------
export interface Floor {
  id: number;
  name: string;
  title: string;
  color: string; // hex
  dir: string;   // overlay subfolder name
  image: string; // section image path in /hover/
}

export const FLOORS: Floor[] = [
  { id: 4, name: "4", title: "Tầng 4", color: "#E1708A", dir: "f4", image: "/hover/T4.png" },
  { id: 3, name: "3", title: "Tầng 3", color: "#E0A93F", dir: "f3", image: "/hover/T3.png" },
  { id: 2, name: "2", title: "Tầng 2", color: "#2FB98C", dir: "f2", image: "/hover/T2.png" },
  { id: 1, name: "1", title: "Tầng 1", color: "#5B8DEF", dir: "f1", image: "/hover/T1.png" },
];

// ---------- Helpers ----------
const pad3 = (n: number) => String(n).padStart(3, "0");

/**
 * Maps 1-based viewer displayFrame (1..120) to 0-indexed overlay mask file index (000..119).
 * Background image sequence: 001.webp .. 120.webp (1-based)
 * Overlay image sequence:    000.png  .. 119.png  (0-based)
 * Exact mathematical alignment: overlayIndex = (displayFrame - 1) % 120
 */
export function displayFrameToOverlayIndex(displayFrame: number, totalFrames: number = 120): number {
  return ((Math.round(displayFrame) - 1) % totalFrames + totalFrames) % totalFrames;
}

function overlayUrl(dir: string, displayFrame: number): string {
  const overlayIndex = displayFrameToOverlayIndex(displayFrame);
  return `${OVERLAY_BASE}/${dir}/${pad3(overlayIndex)}.png`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace("#", "");
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

// Simple LRU overlay cache
type OverlayEntry = Record<number, HTMLImageElement>;
class LruOverlayCache {
  private map = new Map<number, OverlayEntry>();
  constructor(private max: number) {}
  has(frame: number) { return this.map.has(frame); }
  get(frame: number) {
    if (!this.map.has(frame)) return undefined;
    const v = this.map.get(frame)!;
    this.map.delete(frame);
    this.map.set(frame, v);
    return v;
  }
  set(frame: number, entry: OverlayEntry) {
    if (this.map.has(frame)) this.map.delete(frame);
    this.map.set(frame, entry);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

// ---------- Props ----------
interface FloorLayerPanelProps {
  /** Current integer display frame (1-based, 1..120). */
  displayFrame: number;
  /** True while the user is dragging to rotate. */
  isDragging: boolean;
  /** Pixel bounds of the rendered image inside the viewer canvas. */
  imageBounds: ImageBounds;
  /** Ref to the main viewer canvas element (for coordinate mapping). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

// ============================================================
// Component
// ============================================================
export const FloorLayerPanel: React.FC<FloorLayerPanelProps> = ({
  displayFrame,
  isDragging,
  imageBounds,
  canvasRef,
}) => {
  // ---------- State ----------
  const [visible, setVisible] = useState<Record<number, boolean>>({
    1: true, 2: true, 3: true, 4: true,
  });
  const [hoveredFloor, setHoveredFloor]   = useState<number | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [modalFloor, setModalFloor]       = useState<Floor | null>(null);

  // ---------- Canvas refs ----------
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitCanvasRef     = useRef<HTMLCanvasElement | null>(null);
  // Stable refs for values used inside event handlers
  const hoveredFloorRef  = useRef<number | null>(null);
  const selectedFloorRef = useRef<number | null>(null);
  const visibleRef       = useRef(visible);
  const isDraggingRef    = useRef(isDragging);
  const imageBoundsRef   = useRef(imageBounds);
  const displayFrameRef  = useRef(displayFrame);

  useEffect(() => { hoveredFloorRef.current = hoveredFloor; }, [hoveredFloor]);
  useEffect(() => { selectedFloorRef.current = selectedFloor; }, [selectedFloor]);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  useEffect(() => { imageBoundsRef.current = imageBounds; }, [imageBounds]);
  useEffect(() => { displayFrameRef.current = displayFrame; }, [displayFrame]);

  // Pre-load all 4 floor section images for instant latency-free display on hover
  useEffect(() => {
    FLOORS.forEach((f) => {
      const img = new Image();
      img.src = f.image;
    });
  }, []);

  // Synchronize hover state with external triggers
  useEffect(() => {
    const handleFloorHoverEvent = (e: Event) => {
      const customEv = e as CustomEvent<{ floorId: number | null }>;
      if (customEv.detail) {
        setHoveredFloor(customEv.detail.floorId ?? null);
      }
    };
    window.addEventListener("floor:hover", handleFloorHoverEvent);
    return () => window.removeEventListener("floor:hover", handleFloorHoverEvent);
  }, []);

  const closeModal = useCallback(() => {
    setModalFloor(null);
    setSelectedFloor(null);
  }, []);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeModal]);

  // ---------- Overlay image cache (stable singleton) ----------
  const overlayCache = useMemo(() => new LruOverlayCache(OVERLAY_CACHE_MAX), []);

  // ---------- Load overlays for a frame ----------
  const getOverlays = useCallback(
    (frame: number, onLoad?: () => void): OverlayEntry => {
      if (overlayCache.has(frame)) return overlayCache.get(frame)!;
      const entry: OverlayEntry = {};
      let pending = FLOORS.length;
      FLOORS.forEach((f) => {
        const img = new Image();
        img.onload = img.onerror = () => { if (--pending === 0) onLoad?.(); };
        img.src = overlayUrl(f.dir, frame);
        entry[f.id] = img;
      });
      overlayCache.set(frame, entry);
      return entry;
    },
    [overlayCache]
  );

  // ---------- Hit-test ----------
  const hitTest = useCallback(
    (clientX: number, clientY: number): number | null => {
      const hitCanvas = hitCanvasRef.current;
      if (!hitCanvas) return null;
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect  = canvas.getBoundingClientRect();
      const { left: imgLeft, top: imgTop, width: imgW, height: imgH } =
        imageBoundsRef.current;

      // imageBounds is in CSS pixels, relative to the canvas element
      const nx = (clientX - rect.left - imgLeft) / imgW;
      const ny = (clientY - rect.top  - imgTop)  / imgH;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;

      const hx = Math.min(HIT_W - 1, Math.max(0, Math.floor(nx * HIT_W)));
      const hy = Math.min(HIT_H - 1, Math.max(0, Math.floor(ny * HIT_H)));

      let d: Uint8ClampedArray;
      try {
        const hc = hitCanvas.getContext("2d", { willReadFrequently: true })!;
        d = hc.getImageData(hx, hy, 1, 1).data;
      } catch {
        return null;
      }

      if (d[3] < 24) return null;

      let best: number | null = null;
      let bestDist = Infinity;
      const vis = visibleRef.current;
      FLOORS.forEach((f) => {
        if (!vis[f.id]) return;
        const c = hexToRgb(f.color);
        const dist = (c.r - d[0]) ** 2 + (c.g - d[1]) ** 2 + (c.b - d[2]) ** 2;
        if (dist < bestDist) { bestDist = dist; best = f.id; }
      });
      return bestDist < 3600 ? best : null;
    },
    [canvasRef]
  );

  // ---------- Draw overlays ----------
  const renderOverlay = useCallback(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;
    const { left, top, width, height, containerWidth, containerHeight } = imageBounds;
    if (!width || !height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tw = Math.round(containerWidth  * dpr);
    const th = Math.round(containerHeight * dpr);
    if (overlayCanvas.width !== tw || overlayCanvas.height !== th) {
      overlayCanvas.width  = tw;
      overlayCanvas.height = th;
    }

    const oc = overlayCanvas.getContext("2d")!;
    oc.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const hitCanvas = hitCanvasRef.current!;
    const hc = hitCanvas.getContext("2d", { willReadFrequently: true })!;
    hc.clearRect(0, 0, HIT_W, HIT_H);

    const ov = getOverlays(displayFrame, () => renderOverlay());

    FLOORS.forEach((f) => {
      if (!visible[f.id]) return;
      const img = ov[f.id];
      if (!img?.complete || !img.naturalWidth) return;

      // Hit canvas (always full resolution for accurate testing)
      hc.globalAlpha = 1;
      hc.drawImage(img, 0, 0, HIT_W, HIT_H);

      // Visible overlay (for hovered floor or selected floor when not hovering another floor)
      const isTarget = hoveredFloor === f.id || (hoveredFloor == null && selectedFloor === f.id);
      const alpha = isTarget ? HOVER_OPACITY : BASE_OPACITY;
      if (alpha <= 0) return;
      oc.globalAlpha = alpha;
      oc.drawImage(
        img,
        Math.round(left * dpr),
        Math.round(top  * dpr),
        Math.round(width  * dpr),
        Math.round(height * dpr)
      );
    });
    oc.globalAlpha = 1;
  }, [displayFrame, getOverlays, hoveredFloor, selectedFloor, imageBounds, visible]);

  // Trigger redraw whenever these change
  useEffect(() => {
    renderOverlay();
  }, [renderOverlay, displayFrame, imageBounds, hoveredFloor, selectedFloor, visible]);

  // Pre-warm overlay images for current + adjacent frames (±3 frames window for zero-lag rotation)
  useEffect(() => {
    getOverlays(displayFrame, () => renderOverlay());
    for (let d = 1; d <= 3; d++) {
      const prev = ((displayFrame - 1 - d) % 120 + 120) % 120 + 1;
      const next = ((displayFrame - 1 + d) % 120 + 120) % 120 + 1;
      getOverlays(prev);
      getOverlays(next);
    }
  }, [displayFrame, getOverlays, renderOverlay]);

  // ---------- Pointer-event listeners on the MAIN canvas container ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let downPos: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      downPos = { x: e.clientX, y: e.clientY };
    };

    const onMove = (e: PointerEvent | MouseEvent) => {
      if (isDraggingRef.current) {
        setHoveredFloor(null);
        if (canvas) canvas.style.cursor = "";
        return;
      }
      const hit = hitTest(e.clientX, e.clientY);
      setHoveredFloor(hit);
      if (canvas) {
        canvas.style.cursor = hit !== null ? "pointer" : "";
      }
    };

    const onLeave = (e: PointerEvent) => {
      if ((e as PointerEvent).pointerType === "touch") return;
      setHoveredFloor(null);
      downPos = null;
      if (canvas) canvas.style.cursor = "";
    };

    const onUp = (e: PointerEvent) => {
      const start = downPos;
      downPos = null;
      if (!start) return;

      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (dist >= 6) return; // User dragged to rotate, not a click

      const hit = hitTest(e.clientX, e.clientY);
      if (hit !== null) {
        const floor = FLOORS.find((f) => f.id === hit);
        if (floor) {
          setSelectedFloor(floor.id);
          setModalFloor(floor);
          window.dispatchEvent(
            new CustomEvent("floorLayer:click", {
              detail: { id: hit, name: floor.name, title: floor.title, color: floor.color },
              bubbles: true,
            })
          );
          window.dispatchEvent(
            new CustomEvent("hotspot:click", {
              detail: { id: `tang-${hit}`, type: "floor", name: floor.title },
              bubbles: true,
            })
          );
        }
      }
    };

    canvas.addEventListener("pointerdown",  onDown,  { passive: true });
    canvas.addEventListener("mousedown",    onDown as unknown as EventListener, { passive: true });
    canvas.addEventListener("pointermove",  onMove as unknown as EventListener,  { passive: true });
    canvas.addEventListener("mousemove",    onMove as unknown as EventListener, { passive: true });
    canvas.addEventListener("pointerleave", onLeave, { passive: true });
    canvas.addEventListener("mouseleave",   onLeave as unknown as EventListener, { passive: true });
    canvas.addEventListener("pointerup",    onUp,    { passive: true });
    canvas.addEventListener("mouseup",      onUp as unknown as EventListener, { passive: true });

    return () => {
      canvas.removeEventListener("pointerdown",  onDown);
      canvas.removeEventListener("mousedown",    onDown as unknown as EventListener);
      canvas.removeEventListener("pointermove",  onMove as unknown as EventListener);
      canvas.removeEventListener("mousemove",    onMove as unknown as EventListener);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("mouseleave",   onLeave as unknown as EventListener);
      canvas.removeEventListener("pointerup",    onUp);
      canvas.removeEventListener("mouseup",      onUp as unknown as EventListener);
      if (canvas) canvas.style.cursor = "";
    };
  }, [canvasRef, hitTest]);

  // Floor to show in the small section preview
  // Displays only while actively hovering over floor 1, 2, 3, or 4
  const activePreviewFloor = hoveredFloor != null
    ? FLOORS.find((f) => f.id === hoveredFloor)
    : null;

  // ============================================================
  // Render
  // ============================================================
  return (
    <>
      {/* Hidden hit-detection canvas */}
      <canvas
        ref={hitCanvasRef}
        width={HIT_W}
        height={HIT_H}
        style={{ display: "none" }}
        aria-hidden="true"
      />

      {/* Transparent overlay canvas — pointer-events: none so drag passes through */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full select-none"
        style={{
          zIndex: 6,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      />

      {/* ── Floor Section Preview Image on Hover ───────────────
          - Displays proportional preview of corresponding section image (T1, T2, T3, T4)
          - Pinned consistently at top-left so it never obscures the central 360 model
          - Hides on mouse leave unless user has selected that floor
          - Clicking opens the full-size modal
      ──────────────────────────────────────────────────────── */}
      {/* ── Floor Section Preview Image on Hover ───────────────
          - Displays proportional preview of corresponding section image (T1, T2, T3, T4)
          - Shows ONLY the small floor-section image, without a floor-number text label
          - Positioned consistently at top-left
          - Hides on mouse leave
          - Clicking it immediately opens the full-size modal
      ──────────────────────────────────────────────────────── */}
      {!modalFloor && activePreviewFloor && (
        <div
          className="fixed z-40 pointer-events-auto select-none transition-all duration-200 ease-out"
          style={{
            left: "20px",
            top: "76px",
            width: "min(280px, calc(100vw - 40px))",
          }}
        >
          <div
            className="group relative rounded-2xl overflow-hidden p-2 transition-all duration-200 cursor-pointer hover:scale-[1.02] shadow-[0_16px_40px_rgba(0,0,0,0.7),0_0_24px_rgba(0,0,0,0.5)] border border-white/20 hover:border-amber-400/60"
            style={{
              background: "rgba(2, 23, 18, 0.88)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
            onClick={() => {
              setSelectedFloor(activePreviewFloor.id);
              setModalFloor(activePreviewFloor);
            }}
            title="Nhấp để xem ảnh mặt cắt kích thước đầy đủ"
          >
            {/* Preview Image with exact 3000x1688 proportion - ONLY the image, no text labels */}
            <div className="relative rounded-xl overflow-hidden bg-black/40 border border-white/10">
              <img
                src={activePreviewFloor.image}
                alt=""
                className="w-full h-auto block object-contain pointer-events-none transition-transform duration-300 group-hover:scale-105"
                style={{
                  aspectRatio: "3000 / 1688",
                  filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.6))",
                }}
                decoding="async"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Full-Size Floor Section Modal Overlay (Portaled to document.body for top stacking context) ──
          - Displayed immediately on click of floor hover region, side panel, or preview card
          - Uses actual source image (T1, T2, T3, T4)
          - Large centered overlay above 360 viewer (z-[9999])
          - Displays image as large as possible while preserving original aspect ratio (3000x1688)
          - Prevents background viewer interactions while open
          - Clear visible close button, Escape key, and backdrop click closing
          - Quick switcher tabs to jump between all 4 floors
      ──────────────────────────────────────────────────────── */}
      {modalFloor && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-2xl p-2 sm:p-4 md:p-6 select-none transition-all duration-300"
          onClick={closeModal}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`Mặt cắt ${modalFloor.title}`}
        >
          <div
            className="relative flex flex-col w-full max-w-[96vw] max-h-[96vh] bg-[#021712]/95 border border-white/20 rounded-2xl md:rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.9),0_0_40px_rgba(245,158,11,0.25)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 bg-black/40 backdrop-blur-md">
              {/* Left: Floor badge & title */}
              <div className="flex items-center gap-3">
                <span
                  className="w-3.5 h-3.5 rounded-full shadow-[0_0_12px_currentColor]"
                  style={{
                    backgroundColor: modalFloor.color,
                    color: modalFloor.color,
                  }}
                />
                <div>
                  <h2 className="text-sm sm:text-base font-semibold text-white tracking-wide m-0">
                    Mặt cắt chi tiết: {modalFloor.title}
                  </h2>
                </div>
              </div>

              {/* Center: Floor Switcher Tabs */}
              <div className="hidden sm:flex items-center gap-1.5 bg-white/5 p-1 rounded-xl border border-white/10">
                {FLOORS.map((f) => {
                  const isCurrent = modalFloor.id === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setSelectedFloor(f.id);
                        setModalFloor(f);
                      }}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-all duration-150 flex items-center gap-1.5 cursor-pointer ${
                        isCurrent
                          ? "bg-white/20 text-white shadow-md border border-white/20 font-semibold"
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: f.color }}
                      />
                      <span>{f.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* Right: Visible Close button */}
              <button
                type="button"
                onClick={closeModal}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-red-500/30 text-white/90 hover:text-white border border-white/20 hover:border-red-400 transition-all duration-200 cursor-pointer shadow-lg"
                aria-label="Đóng cửa sổ"
                title="Đóng (ESC)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Image Body - Image displayed as large as possible preserving aspect ratio */}
            <div className="relative flex-1 min-h-0 flex items-center justify-center p-2 sm:p-4 bg-black/50 overflow-hidden">
              <img
                src={modalFloor.image}
                alt={`Mặt cắt ${modalFloor.title}`}
                className="max-h-[82vh] max-w-full w-auto h-auto object-contain rounded-xl select-none"
                style={{
                  aspectRatio: "3000 / 1688",
                  filter: "drop-shadow(0 16px 40px rgba(0,0,0,0.8))",
                }}
              />
            </div>

            {/* Modal Footer (Mobile tabs + helper note) */}
            <div className="flex flex-col sm:flex-row items-center justify-between px-4 sm:px-6 py-2 border-t border-white/10 bg-black/30 text-[11px] text-white/50 gap-2">
              {/* Mobile floor tabs */}
              <div className="flex sm:hidden items-center justify-center gap-1.5 w-full">
                {FLOORS.map((f) => {
                  const isCurrent = modalFloor.id === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setSelectedFloor(f.id);
                        setModalFloor(f);
                      }}
                      className={`flex-1 py-1 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1 cursor-pointer ${
                        isCurrent
                          ? "bg-white/20 text-white font-semibold"
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: f.color }}
                      />
                      <span>{f.title}</span>
                    </button>
                  );
                })}
              </div>

              <div className="hidden sm:flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>Nhấp phím <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-white/70 font-mono text-[10px]">ESC</kbd> hoặc vùng ngoài để đóng</span>
              </div>
              <div className="text-white/40">
                Ảnh mặt cắt gốc độ phân giải cao (3000 × 1688)
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
