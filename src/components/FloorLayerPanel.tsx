import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { ImageBounds } from "../types/viewer";

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
const OVERLAY_CACHE_MAX = 10; // frames to keep in memory

const HOVER_OPACITY = 0.55; // alpha when a floor is hovered
const BASE_OPACITY  = 0;    // hidden otherwise

const HIT_W = 960;
const HIT_H = 540;

// ---------- Data ----------
export interface Floor {
  id: number;
  name: string;
  color: string; // hex
  dir: string;   // overlay subfolder name
}

export const FLOORS: Floor[] = [
  { id: 4, name: "Tum",    color: "#E1708A", dir: "f4" },
  { id: 2, name: "Tầng 2", color: "#2FB98C", dir: "f2" },
  { id: 3, name: "Lửng",   color: "#E0A93F", dir: "f3" },
  { id: 1, name: "Tầng 1", color: "#5B8DEF", dir: "f1" },
];

// ---------- Helpers ----------
const pad3 = (n: number) => String(n).padStart(3, "0");

function overlayUrl(dir: string, frame: number): string {
  return `${OVERLAY_BASE}/${dir}/${pad3(frame)}.png`;
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
  const [hoveredFloor, setHoveredFloor] = useState<number | null>(null);
  const [cursorPos, setCursorPos]       = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast]               = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- Canvas refs ----------
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitCanvasRef     = useRef<HTMLCanvasElement | null>(null);
  // Stable refs for values used inside event handlers
  const hoveredFloorRef = useRef<number | null>(null);
  const visibleRef      = useRef(visible);
  const isDraggingRef   = useRef(isDragging);
  const imageBoundsRef  = useRef(imageBounds);
  const displayFrameRef = useRef(displayFrame);

  useEffect(() => { hoveredFloorRef.current = hoveredFloor; }, [hoveredFloor]);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  useEffect(() => { imageBoundsRef.current = imageBounds; }, [imageBounds]);
  useEffect(() => { displayFrameRef.current = displayFrame; }, [displayFrame]);

  // ---------- Overlay image cache (stable singleton) ----------
  const overlayCache = useMemo(() => new LruOverlayCache(OVERLAY_CACHE_MAX), []);

  // ---------- Toast ----------
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

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
    const { left, top, width, height, containerWidth, containerHeight } =
      imageBoundsRef.current;
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

    const frame = displayFrameRef.current;
    const ov    = getOverlays(frame, () => renderOverlay());
    const hov   = hoveredFloorRef.current;
    const vis   = visibleRef.current;

    FLOORS.forEach((f) => {
      if (!vis[f.id]) return;
      const img = ov[f.id];
      if (!img?.complete || !img.naturalWidth) return;

      // Hit canvas (always full resolution for accurate testing)
      hc.globalAlpha = 1;
      hc.drawImage(img, 0, 0, HIT_W, HIT_H);

      // Visible overlay (only for hovered floor)
      const alpha = hov === f.id ? HOVER_OPACITY : BASE_OPACITY;
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
  }, [getOverlays]);

  // Trigger redraw whenever these change
  useEffect(() => {
    renderOverlay();
  }, [renderOverlay, displayFrame, imageBounds, hoveredFloor, visible]);

  // Pre-warm overlay images for current + adjacent frames
  useEffect(() => {
    getOverlays(displayFrame, () => renderOverlay());
    const prev = displayFrame === 1 ? 120 : displayFrame - 1;
    const next = displayFrame === 120 ? 1 : displayFrame + 1;
    getOverlays(prev);
    getOverlays(next);
  }, [displayFrame, getOverlays, renderOverlay]);

  // ---------- Pointer-event listeners on the MAIN canvas container ----------
  // We attach to the main canvas so we never block the drag engine's pointerdown.
  // We listen on pointermove/pointerup at the CANVAS level (not window) to avoid
  // interfering with other elements.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMove = (e: PointerEvent) => {
      if (isDraggingRef.current) {
        setHoveredFloor(null);
        setCursorPos(null);
        return;
      }
      const hit = hitTest(e.clientX, e.clientY);
      setHoveredFloor(hit);
      setCursorPos(hit ? { x: e.clientX, y: e.clientY } : null);
    };

    const onLeave = (e: PointerEvent) => {
      if ((e as PointerEvent).pointerType === "touch") return;
      setHoveredFloor(null);
      setCursorPos(null);
    };

    const onUp = (e: PointerEvent) => {
      if (isDraggingRef.current) return;
      const hit = hitTest(e.clientX, e.clientY);
      if (hit !== null) {
        const floor = FLOORS.find((f) => f.id === hit)!;
        const event = new CustomEvent("floorLayer:click", {
          detail: { id: hit, name: floor.name, color: floor.color },
          bubbles: true,
        });
        window.dispatchEvent(event);
        showToast(`✔ Đã chọn: ${floor.name}`);
      }
    };

    canvas.addEventListener("pointermove",  onMove,  { passive: true });
    canvas.addEventListener("pointerleave", onLeave, { passive: true });
    canvas.addEventListener("pointerup",    onUp,    { passive: true });

    return () => {
      canvas.removeEventListener("pointermove",  onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerup",    onUp);
    };
  }, [canvasRef, hitTest, showToast]);

  // ---------- Floor toggle ----------
  const toggleFloor = useCallback(
    (id: number) => {
      setVisible((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        return next;
      });
      const floor = FLOORS.find((f) => f.id === id)!;
      showToast(`${floor.name}: ${visible[id] ? "đã ẩn" : "đang hiện"}`);
    },
    [visible, showToast]
  );

  // ---------- Resolve cursor card position (keep inside viewport) ----------
  const resolvedCard = useMemo(() => {
    if (!cursorPos || hoveredFloor == null) return null;
    const floor = FLOORS.find((f) => f.id === hoveredFloor);
    if (!floor) return null;
    const pad = 16;
    let x = cursorPos.x + pad;
    let y = cursorPos.y + pad;
    if (x + 160 > window.innerWidth  - 8) x = cursorPos.x - 160 - pad;
    if (y + 40  > window.innerHeight - 8) y = cursorPos.y - 40  - pad;
    return { name: floor.name, color: floor.color, x: Math.max(8, x), y: Math.max(8, y) };
  }, [cursorPos, hoveredFloor]);

  const hoveredFloorObj = hoveredFloor != null
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
          pointerEvents: "none", // pointer events handled on main canvas above
        }}
        aria-hidden="true"
      />

      {/* ── Floor List Side Panel ───────────────────────────── */}
      <aside
        className={[
          "absolute top-[72px] right-4 z-10",
          "w-[262px]",
          "rounded-[20px] border border-white/[0.13]",
          "bg-black/50 backdrop-blur-2xl",
          "shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.10)]",
          "px-3.5 py-3.5",
        ].join(" ")}
        style={{ pointerEvents: "auto" }}
      >
        {/* Header */}
        <div className="flex items-baseline justify-between mb-2.5">
          <span className="text-[11px] uppercase tracking-[1.1px] text-white/55 font-semibold">
            Lớp tầng
          </span>
          <span className="text-[11px] text-white/30 tabular-nums transition-all duration-150">
            {hoveredFloorObj ? hoveredFloorObj.name : "—"}
          </span>
        </div>

        {/* Floor rows */}
        <ul className="list-none m-0 p-0 flex flex-col gap-1">
          {FLOORS.map((floor) => {
            const isOn     = visible[floor.id];
            const isHov    = hoveredFloor === floor.id;
            return (
              <li
                key={floor.id}
                data-floor-id={floor.id}
                className={[
                  "grid grid-cols-[24px_minmax(0,1fr)_34px] items-center gap-2 px-2.5 py-2 rounded-xl border cursor-pointer select-none",
                  "transition-all duration-150",
                  isHov
                    ? "bg-white/10 border-white/18"
                    : "border-transparent hover:bg-white/[0.055] hover:border-white/10",
                  !isOn ? "opacity-40" : "",
                ].join(" ")}
                onClick={() => toggleFloor(floor.id)}
                onMouseEnter={() => !isDragging && setHoveredFloor(floor.id)}
                onMouseLeave={() => setHoveredFloor(null)}
              >
                {/* Swatch in 24px column */}
                <div className="w-6 flex items-center justify-center">
                  <span
                    className="w-3 h-3 rounded-[4px] flex-none"
                    style={{
                      background: floor.color,
                      boxShadow: `0 0 0 1px rgba(255,255,255,0.22), 0 0 12px ${floor.color}55`,
                    }}
                  />
                </div>

                {/* Name left-aligned */}
                <span className="min-w-0 text-[13px] text-white/90 font-medium text-left truncate">
                  {floor.name}
                </span>

                {/* Toggle switch */}
                <span
                  className={[
                    "relative flex-none w-[34px] h-[19px] rounded-full border",
                    "transition-colors duration-200",
                    isOn ? "bg-white/28 border-white/18" : "bg-white/10 border-white/10",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute top-[3px] w-[13px] h-[13px] rounded-full bg-white",
                      "transition-transform duration-200",
                      isOn ? "translate-x-[17px]" : "translate-x-[2px]",
                    ].join(" ")}
                  />
                </span>
              </li>
            );
          })}
        </ul>

        {/* Helper note */}
        <p className="mt-2.5 mx-1 mb-0.5 text-[11px] leading-[1.5] text-white/22 select-none">
          Rê chuột lên ảnh để tô sáng tầng. Nhấp để chọn.
        </p>
      </aside>

      {/* ── Cursor tooltip card ─────────────────────────────── */}
      {resolvedCard && (
        <div
          className="fixed z-40 flex items-center gap-2 px-3 py-1.5 rounded-xl pointer-events-none select-none whitespace-nowrap"
          style={{
            left: resolvedCard.x,
            top:  resolvedCard.y,
            background: "rgba(14,18,24,0.80)",
            border: "1px solid rgba(255,255,255,0.15)",
            backdropFilter: "blur(18px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
          aria-hidden="true"
        >
          <span
            className="w-2.5 h-2.5 rounded-[3px] flex-none"
            style={{
              background: resolvedCard.color,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
            }}
          />
          <span className="text-[12.5px] font-semibold text-white">
            {resolvedCard.name}
          </span>
        </div>
      )}

      {/* ── Toast notification ──────────────────────────────── */}
      {toast && (
        <div
          className="absolute bottom-[90px] left-1/2 -translate-x-1/2 z-30 px-5 py-2.5 rounded-2xl text-[13px] font-semibold text-white pointer-events-none text-center whitespace-nowrap"
          style={{
            background: "rgba(14,18,24,0.78)",
            border: "1px solid rgba(255,255,255,0.13)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </>
  );
};
