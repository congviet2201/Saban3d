'use strict';

/* ============================================================
   Trình xem 360° – Phân lớp tòa nhà
   - 120 khung, mỗi khung 3°. Kéo sang trái => ảnh dịch sang trái.
   - Lớp tầng dùng ảnh mask PNG trong suốt (overlays/f1..f4).
   - Giao diện kính lỏng, trung tính.
   ============================================================ */

// ---------------------- Cấu hình ----------------------
const FRAME_COUNT = 120;
const DEG_PER_FRAME = 360 / FRAME_COUNT;      // 3°
const FRAME_DIR = 'frames';
const FRAME_BASE = 10000000;
const FRAME_EXT = 'webp';
const OVERLAY_DIR = 'overlays';

const BASE_OPACITY = 0;                        // ẩn hoàn toàn khi không rê chuột
const HOVER_OPACITY = 0.55;                    // khi rê chuột (bán trong suốt để vẫn thấy tòa nhà)

const HIT_W = 960;                             // canvas dò tầng (nhẹ)
const HIT_H = 540;

const IMG_W = 1920;                            // kích thước ảnh gốc
const IMG_H = 1080;

const FLOORS = [
  { id: 1, name: 'Tầng 1',    color: '#5B8DEF', dir: 'f1' },
  { id: 2, name: 'Tầng 2',    color: '#2FB98C', dir: 'f2' },
  { id: 3, name: 'Tầng lửng', color: '#E0A93F', dir: 'f3' },
  { id: 4, name: 'Tầng tum',  color: '#E1708A', dir: 'f4' },
];
const floorById = {};
FLOORS.forEach(f => { floorById[f.id] = f; });

// ---------------------- Trạng thái ----------------------
let frameFloat = 0;
let currentFrame = 0;
let hoveredFloor = null;
let dragging = false;
let dragMoved = false;
let dragStartX = 0;
let lastX = 0;

const visible = { 1: true, 2: true, 3: true, 4: true };

const baseImages = [];
let baseLoaded = 0;
let ov0Loaded = 0;

const overlayCache = new Map();   // frame -> { floorId: Image }
const OVERLAY_CACHE_MAX = 8;
let currentOverlays = {};
let hitWarned = false;

// ---------------------- DOM ----------------------
const app       = document.querySelector('.app');
const stage     = document.getElementById('stage');
const canvas    = document.getElementById('viewer');
const ctx       = canvas.getContext('2d');
const backdrop  = document.getElementById('backdrop');
const loader    = document.getElementById('loader');
const loaderText = document.getElementById('loaderText');
const toastEl   = document.getElementById('toast');
const floorList = document.getElementById('floorList');
const hoverHint = document.getElementById('hoverHint');
const frameSlider = document.getElementById('frameSlider');
const hudFrame  = document.getElementById('hudFrame');
const hudAngle  = document.getElementById('hudAngle');
const cursorCard = document.getElementById('cursorCard');
const cursorDot  = document.getElementById('cursorDot');
const cursorName = document.getElementById('cursorName');
document.getElementById('hudTotal').textContent = FRAME_COUNT;

// canvas dò tầng (ẩn)
const hitCanvas = document.createElement('canvas');
hitCanvas.width = HIT_W;
hitCanvas.height = HIT_H;
const hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true });

// ---------------------- Tiện ích ----------------------
const pad3 = n => String(n).padStart(3, '0');
const mod = (n, m) => ((n % m) + m) % m;

function frameUrl(i) { return `${FRAME_DIR}/${FRAME_BASE + i}.${FRAME_EXT}`; }
function overlayUrl(dir, i) { return `${OVERLAY_DIR}/${dir}/${pad3(i)}.png`; }

function hexToRgb(hex) {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

// ---------------------- Tải ảnh ----------------------
function preloadBase() {
  for (let i = 0; i < FRAME_COUNT; i++) {
    const img = new Image();
    img.onload = img.onerror = () => {
      baseLoaded++;
      checkLoader();
      if (i === currentFrame) requestRender();
    };
    img.src = frameUrl(i);
    baseImages[i] = img;
  }
}

function getOverlays(frame) {
  frame = mod(frame, FRAME_COUNT);
  if (overlayCache.has(frame)) {
    const entry = overlayCache.get(frame);
    overlayCache.delete(frame);
    overlayCache.set(frame, entry);   // làm mới LRU
    return entry;
  }
  const entry = {};
  FLOORS.forEach(f => {
    const img = new Image();
    img.onload = () => {
      if (frame === 0) { ov0Loaded++; checkLoader(); }
      if (frame === currentFrame) requestRender();
    };
    img.onerror = () => {
      if (frame === 0) { ov0Loaded++; checkLoader(); }
    };
    img.src = overlayUrl(f.dir, frame);
    entry[f.id] = img;
  });
  overlayCache.set(frame, entry);
  while (overlayCache.size > OVERLAY_CACHE_MAX) {
    overlayCache.delete(overlayCache.keys().next().value);
  }
  return entry;
}

function checkLoader() {
  loaderText.textContent = `Đang tải… ${baseLoaded} / ${FRAME_COUNT}`;
  if (baseLoaded >= FRAME_COUNT && ov0Loaded >= FLOORS.length) {
    loader.classList.add('hidden');
    showToast('Sẵn sàng · kéo chuột để xoay 360°');
  }
}

// ---------------------- Dò tầng theo điểm ảnh ----------------------
function updateHitCanvas(ov) {
  hitCtx.clearRect(0, 0, HIT_W, HIT_H);
  FLOORS.forEach(f => {
    if (!visible[f.id]) return;
    const img = ov[f.id];
    if (!img || !img.complete || !img.naturalWidth) return;
    hitCtx.globalAlpha = 1;
    hitCtx.drawImage(img, 0, 0, HIT_W, HIT_H);
  });
}

function hitTest(clientX, clientY) {
  const r = stage.getBoundingClientRect();
  const fit = computeFit(r.width, r.height);
  const nx = (clientX - r.left - fit.x) / fit.w;
  const ny = (clientY - r.top - fit.y) / fit.h;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;

  const hx = Math.min(HIT_W - 1, Math.max(0, Math.floor(nx * HIT_W)));
  const hy = Math.min(HIT_H - 1, Math.max(0, Math.floor(ny * HIT_H)));
  let d;
  try {
    d = hitCtx.getImageData(hx, hy, 1, 1).data;
  } catch (e) {
    if (!hitWarned) {
      hitWarned = true;
      showToast('Không đọc được điểm ảnh khi mở tệp trực tiếp — hãy chạy "node tools/serve.js" để dùng chức năng rê/nhấp tầng.');
    }
    return null;
  }
  if (d[3] < 24) return null;

  let best = null, bestDist = Infinity;
  FLOORS.forEach(f => {
    if (!visible[f.id]) return;
    const c = hexToRgb(f.color);
    const dist = (c.r - d[0]) ** 2 + (c.g - d[1]) ** 2 + (c.b - d[2]) ** 2;
    if (dist < bestDist) { bestDist = dist; best = f.id; }
  });
  return bestDist < 3600 ? best : null;
}

// ---------------------- Render ----------------------
// Khớp ảnh vào khung theo kiểu "contain" (không cắt, không méo).
function computeFit(w, h) {
  const s = Math.min(w / IMG_W, h / IMG_H);
  const fw = IMG_W * s, fh = IMG_H * s;
  return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh };
}

function renderCanvas() {
  const cw = canvas.width, ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  const fit = computeFit(cw, ch);

  const base = baseImages[currentFrame];
  if (base && base.complete && base.naturalWidth) {
    ctx.drawImage(base, fit.x, fit.y, fit.w, fit.h);
  }

  const ov = getOverlays(currentFrame);
  currentOverlays = ov;

  FLOORS.forEach(f => {
    if (!visible[f.id]) return;
    const img = ov[f.id];
    if (!img || !img.complete || !img.naturalWidth) return;
    ctx.globalAlpha = (hoveredFloor === f.id) ? HOVER_OPACITY : BASE_OPACITY;
    ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
  });
  ctx.globalAlpha = 1;

  updateHitCanvas(ov);
}

// Đồng bộ kích thước canvas với khung nhìn (tránh méo ảnh khi toàn màn hình).
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(stage.clientWidth * dpr));
  const h = Math.max(1, Math.round(stage.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

let renderPending = false;
function doRender() {
  currentFrame = mod(Math.round(frameFloat), FRAME_COUNT);

  const url = frameUrl(currentFrame);
  if (backdrop.dataset.src !== url) {
    backdrop.src = url;
    backdrop.dataset.src = url;
  }

  renderCanvas();
  updateHud();
}

function requestRender() {
  if (renderPending) return;
  renderPending = true;
  const run = () => {
    if (!renderPending) return;
    renderPending = false;
    doRender();
  };
  requestAnimationFrame(run);
  setTimeout(run, 34);   // dự phòng nếu rAF bị trì hoãn
}

function setFrameFloat(v) {
  frameFloat = mod(v, FRAME_COUNT);
}

function updateHud() {
  hudFrame.textContent = pad3(currentFrame + 1);
  hudAngle.textContent = (currentFrame * DEG_PER_FRAME).toFixed(0) + '°';
  frameSlider.value = currentFrame;
}

function setHover(floorId) {
  if (hoveredFloor === floorId) return;
  hoveredFloor = floorId;
  hoverHint.textContent = floorId ? floorById[floorId].name : '—';
  stage.classList.toggle('pointing', !!floorId);
  requestRender();
}

// Thẻ tên tầng đi theo con trỏ
function updateCursorCard(clientX, clientY, floorId) {
  if (!floorId) { cursorCard.classList.remove('show'); return; }
  cursorName.textContent = floorById[floorId].name;
  cursorDot.style.background = floorById[floorId].color;
  cursorCard.classList.add('show');

  const pad = 16;
  const w = cursorCard.offsetWidth, h = cursorCard.offsetHeight;
  let x = clientX + pad, y = clientY + pad;
  if (x + w > window.innerWidth - 8) x = clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = clientY - h - pad;
  cursorCard.style.left = Math.max(8, x) + 'px';
  cursorCard.style.top = Math.max(8, y) + 'px';
}

function hideCursorCard() { cursorCard.classList.remove('show'); }

// ---------------------- Danh sách tầng ----------------------
function buildFloorList() {
  FLOORS.forEach(f => {
    const li = document.createElement('li');
    li.className = 'floor-item';
    li.dataset.floor = f.id;
    li.innerHTML =
      `<span class="swatch" style="background:${f.color}"></span>` +
      `<span class="name">${f.name}</span>` +
      `<span class="switch"></span>`;
    li.addEventListener('click', () => toggleFloor(f.id));
    li.addEventListener('mouseenter', () => setHover(f.id));
    li.addEventListener('mouseleave', () => setHover(null));
    floorList.appendChild(li);
  });
}

function toggleFloor(id) {
  visible[id] = !visible[id];
  const li = floorList.querySelector(`[data-floor="${id}"]`);
  if (li) li.classList.toggle('hidden-floor', !visible[id]);
  requestRender();
  showToast(`${floorById[id].name}: ${visible[id] ? 'đang hiện' : 'đã ẩn'}`);
}

// ---------------------- Chức năng mỗi tầng ----------------------
function handleFloorClick(floorId) {
  const floor = floorById[floorId];
  executeFloorFunction(floor);
  showToast(`✔ Đã thực thi chức năng cho ${floor.name}`);
}
function executeFloorFunction(floor) {
  console.log(`[Tầng] Thực thi chức năng cho ${floor.name} (id=${floor.id})`);
}

// ---------------------- Toast ----------------------
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// ---------------------- Tương tác ----------------------
function toNorm(clientX, clientY) {
  const r = stage.getBoundingClientRect();
  return [(clientX - r.left) / r.width, (clientY - r.top) / r.height];
}

stage.addEventListener('pointerdown', e => {
  if (e.button === 2) return;
  try { stage.setPointerCapture(e.pointerId); } catch (err) { /* sự kiện tổng hợp */ }
  dragging = true;
  dragMoved = false;
  dragStartX = e.clientX;
  lastX = e.clientX;
  stage.classList.add('dragging');
});

stage.addEventListener('pointermove', e => {
  if (dragging) {
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (!dragMoved && Math.abs(e.clientX - dragStartX) > 4) {
      dragMoved = true;
      setHover(null);        // ẩn mask khi bắt đầu xoay
      hideCursorCard();
    }
    if (dragMoved) {
      const framesPerPx = FRAME_COUNT / stage.clientWidth;
      setFrameFloat(frameFloat + dx * framesPerPx);
      requestRender();
    }
    return;
  }
  const hit = hitTest(e.clientX, e.clientY);
  setHover(hit);
  updateCursorCard(e.clientX, e.clientY, hit);
});

function endPointer(e) {
  if (!dragging) return;
  stage.classList.remove('dragging');
  dragging = false;
  if (!dragMoved) {
    const hit = hitTest(e.clientX, e.clientY);
    setHover(hit);
    updateCursorCard(e.clientX, e.clientY, hit);
    if (hit) handleFloorClick(hit);
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', () => {
  dragging = false;
  stage.classList.remove('dragging');
});
stage.addEventListener('pointerleave', e => {
  if (dragging) return;
  if (e.pointerType === 'touch') return;   // giữ hiển thị sau khi chạm trên điện thoại
  setHover(null);
  hideCursorCard();
});

// Thanh trượt + nút
frameSlider.addEventListener('input', () => { setFrameFloat(+frameSlider.value); requestRender(); });
document.getElementById('btnPrev').addEventListener('click', () => { setFrameFloat(currentFrame - 1); requestRender(); });
document.getElementById('btnNext').addEventListener('click', () => { setFrameFloat(currentFrame + 1); requestRender(); });

window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') { setFrameFloat(currentFrame - 1); requestRender(); }
  else if (e.key === 'ArrowRight') { setFrameFloat(currentFrame + 1); requestRender(); }
});

// ---------------------- Khởi động ----------------------
function init() {
  buildFloorList();
  resizeCanvas();
  preloadBase();
  getOverlays(0);        // tải trước lớp của khung đầu
  requestRender();
}

window.addEventListener('resize', () => { resizeCanvas(); requestRender(); });

init();

// Móc gỡ lỗi (kiểm thử tự động)
window.__app = {
  get currentFrame() { return currentFrame; },
  get frameFloat() { return frameFloat; },
  get hoveredFloor() { return hoveredFloor; },
  get visible() { return visible; },
  FLOORS,
  setFrameFloat,
  requestRender,
  hitTest,
  toggleFloor,
  handleFloorClick,
};
