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
const OVERLAY_CACHE_MAX = 60; // Expanded to 60 frames to eliminate reloads and latency during rotation

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
  image: string; // section image path in /hover/
}

export const FLOORS: Floor[] = [
  { id: 4, name: "4", color: "#E1708A", dir: "f4", image: "/hover/T4.png" },
  { id: 3, name: "3", color: "#E0A93F", dir: "f3", image: "/hover/T3.png" },
  { id: 2, name: "2", color: "#2FB98C", dir: "f2", image: "/hover/T2.png" },
  { id: 1, name: "1", color: "#5B8DEF", dir: "f1", image: "/hover/T1.png" },
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

  // Pre-load all 4 floor section images for instant latency-free display on hover
  useEffect(() => {
    FLOORS.forEach((f) => {
      const img = new Image();
      img.src = f.image;
    });
  }, []);

  // Synchronize hover state with external triggers (e.g. floor buttons)
  useEffect(() => {
    const handleFloorHoverEvent = (e: Event) => {
      const customEv = e as CustomEvent<{ floorId: number | null; clientX?: number; clientY?: number }>;
      if (customEv.detail) {
        setHoveredFloor(customEv.detail.floorId ?? null);
        if (customEv.detail.clientX != null && customEv.detail.clientY != null) {
          setCursorPos({ x: customEv.detail.clientX, y: customEv.detail.clientY });
        } else if (customEv.detail.floorId == null) {
          setCursorPos(null);
        }
      }
    };
    window.addEventListener("floor:hover", handleFloorHoverEvent);
    return () => window.removeEventListener("floor:hover", handleFloorHoverEvent);
  }, []);

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

      // Visible overlay (only for hovered floor)
      const alpha = hoveredFloor === f.id ? HOVER_OPACITY : BASE_OPACITY;
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
  }, [displayFrame, getOverlays, hoveredFloor, imageBounds, visible]);

  // Trigger redraw whenever these change
  useEffect(() => {
    renderOverlay();
  }, [renderOverlay, displayFrame, imageBounds, hoveredFloor, visible]);

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
        window.dispatchEvent(
          new CustomEvent("hotspot:click", {
            detail: { id: `tang-${hit}`, type: "floor", name: floor.name },
            bubbles: true,
          })
        );
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

  // ---------- Resolve floor section image preview position (keep inside viewport) ----------
  const resolvedCard = useMemo(() => {
    if (hoveredFloor == null) return null;
    const floor = FLOORS.find((f) => f.id === hoveredFloor);
    if (!floor) return null;

    const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
    const vh = typeof window !== "undefined" ? window.innerHeight : 1080;

    // Responsive card size: width up to 380px on desktop, scaling gracefully
    const cardW = Math.min(380, Math.max(260, Math.round(vw * 0.28)));
    const cardH = Math.round(cardW * (1688 / 3000));
    const pad = 20;

    let x: number;
    let y: number;

    // If hovering on right side panel (cursorPos.x > vw - 300) or cursorPos is null:
    if (!cursorPos || cursorPos.x > vw - 300) {
      x = vw - 262 - cardW - 24;
      y = cursorPos ? Math.min(Math.max(72, cursorPos.y - cardH / 2), vh - cardH - 16) : 80;
    } else {
      x = cursorPos.x + pad;
      y = cursorPos.y + pad;

      // Flip horizontally if exceeding right edge
      if (x + cardW > vw - 16) {
        x = cursorPos.x - cardW - pad;
      }
      // Flip vertically if exceeding bottom edge
      if (y + cardH > vh - 16) {
        y = cursorPos.y - cardH - pad;
      }
    }

    x = Math.max(16, Math.min(x, vw - cardW - 16));
    y = Math.max(16, Math.min(y, vh - cardH - 16));

    return {
      image: floor.image,
      color: floor.color,
      x,
      y,
      width: cardW,
      height: cardH,
    };
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
            {hoveredFloorObj ? "Mặt cắt 3D" : "—"}
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
                onMouseEnter={(e) => {
                  if (isDragging) return;
                  setHoveredFloor(floor.id);
                  setCursorPos({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  if (isDragging) return;
                  setCursorPos({ x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={() => {
                  setHoveredFloor(null);
                  setCursorPos(null);
                }}
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

      {/* ── Floor Section Preview Image on Hover ─────────────── */}
      {resolvedCard && (
        <div
          className="fixed z-50 pointer-events-none select-none transition-all duration-200 ease-out"
          style={{
            left: `${resolvedCard.x}px`,
            top: `${resolvedCard.y}px`,
            width: `${resolvedCard.width}px`,
          }}
          aria-hidden="true"
        >
          <div
            className="relative rounded-2xl overflow-hidden p-1.5 transition-transform duration-200 ease-out"
            style={{
              background: "rgba(3, 36, 27, 0.55)",
              border: "1px solid rgba(255, 255, 255, 0.22)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: `0 16px 40px rgba(0, 0, 0, 0.6), 0 0 20px ${resolvedCard.color}40`,
            }}
          >
            <img
              src={resolvedCard.image}
              alt=""
              className="w-full h-auto block select-none pointer-events-none"
              style={{
                aspectRatio: "3000 / 1688",
                objectFit: "contain",
                filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.5))",
              }}
              decoding="async"
            />
          </div>
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
