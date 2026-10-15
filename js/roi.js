// ===== 영역(ROI) 지정 =====
// 오버레이 그리기, 터치/마우스 드래그, 좌표 변환, 영역 확대 미리보기

import { HANDLE_RADIUS, HANDLE_HIT, MIN_ROI_PX, ROI_COLOR, PREVIEW_MAX_W, PREVIEW_MAX_H } from './config.js';

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function round5(v) { return Math.round(v * 100000) / 100000; }

// 커서 모양별 CSS 클래스 (기본 crosshair는 CSS에서 지정)
const CURSOR_CLASSES = {
  'move': 'cursor-move',
  'nwse-resize': 'cursor-nwse',
  'nesw-resize': 'cursor-nesw'
};

// 비율 ROI → 원본 프레임 픽셀 사각형
export function roiToSource(roi, vw, vh) {
  const x = clamp(Math.floor(roi.x * vw), 0, vw - 1);
  const y = clamp(Math.floor(roi.y * vh), 0, vh - 1);
  return {
    x,
    y,
    w: clamp(Math.round(roi.w * vw), 1, vw - x),
    h: clamp(Math.round(roi.h * vh), 1, vh - y)
  };
}

// 프레임을 읽을 수 없는 이유 (읽을 수 있으면 null)
export function frameBlockReason(kiln, camera) {
  if (!kiln) return '가마 없음';
  if (!camera.isFrameReady()) return '카메라 꺼짐';
  if (!kiln.roi) return '영역 지정 안 됨';
  return null;
}

function localToNorm(p, box) {
  return { x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h };
}

// 비율 ROI → 오버레이 CSS px 사각형
function roiToLocal(roi, box) {
  return {
    x: box.x + roi.x * box.w,
    y: box.y + roi.y * box.h,
    w: roi.w * box.w,
    h: roi.h * box.h
  };
}

function clampPoint(p) {
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
}

function rectFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
}

// 터치 위치가 모서리 핸들/영역 내부/바깥 중 어디인지 판정
function hitTest(p, box, roi) {
  if (!roi) return { type: 'none' };
  const r = roiToLocal(roi, box);
  // 각 모서리와, 크기 조정 시 고정될 반대편 모서리(비율 좌표)
  const corners = [
    { x: r.x,       y: r.y,       anchor: { x: roi.x + roi.w, y: roi.y + roi.h }, cursor: 'nwse-resize' },
    { x: r.x + r.w, y: r.y,       anchor: { x: roi.x,         y: roi.y + roi.h }, cursor: 'nesw-resize' },
    { x: r.x,       y: r.y + r.h, anchor: { x: roi.x + roi.w, y: roi.y },         cursor: 'nesw-resize' },
    { x: r.x + r.w, y: r.y + r.h, anchor: { x: roi.x,         y: roi.y },         cursor: 'nwse-resize' }
  ];
  let best = null;
  let bestD = Infinity;
  corners.forEach((c) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < bestD) { bestD = d; best = c; }
  });
  if (bestD <= HANDLE_HIT) return { type: 'corner', anchor: best.anchor, cursor: best.cursor };
  if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { type: 'inside', cursor: 'move' };
  return { type: 'none', cursor: 'crosshair' };
}

/**
 * @param {{ overlay: HTMLCanvasElement, previewCanvas: HTMLCanvasElement, previewPlaceholder: HTMLElement }} els
 * @param {{ camera: object, getKiln: Function, onMessage: Function, onCommit: Function }} deps
 *   onCommit(roi): 드래그가 끝나 새 영역이 확정될 때
 */
export function createRoiEditor(els, deps) {
  const { overlay, previewCanvas, previewPlaceholder } = els;
  const { camera } = deps;
  const overlayCtx = overlay.getContext('2d');
  const previewCtx = previewCanvas.getContext('2d');

  let editable = false;     // 영역 편집 가능 여부 (설정 화면에서만 편집)
  let drag = null;          // 진행 중인 드래그 정보
  let drawQueued = false;   // 오버레이 다시 그리기 예약 여부
  let lastVideoW = 0;       // 영상 해상도 변화 감지용 (회전 시 가로/세로가 바뀜)
  let lastVideoH = 0;

  // object-fit: contain 으로 생기는 여백까지 고려해, 오버레이(CSS px) 안에서 실제 영상이 그려진 사각형을 계산
  function getVideoBox() {
    const cw = overlay.clientWidth;
    const ch = overlay.clientHeight;
    const size = camera.videoSize();
    const vw = size.width;
    const vh = size.height;
    if (!camera.isRunning() || !vw || !vh || !cw || !ch) return null;
    const scale = Math.min(cw / vw, ch / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  // 화면 좌표(clientX/Y) → 오버레이 내부 CSS px
  function clientToLocal(clientX, clientY) {
    const r = overlay.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // 드래그 중이면 임시 영역, 아니면 저장된 영역
  function displayedRoi() {
    if (drag && drag.moved && drag.roi) return drag.roi;
    const k = deps.getKiln();
    return k ? k.roi : null;
  }

  function cancelDrag() {
    drag = null;
  }

  // ===== 오버레이 그리기 =====
  function scheduleDraw() {
    if (drawQueued) return;
    drawQueued = true;
    window.requestAnimationFrame(() => {
      drawQueued = false;
      drawOverlay();
    });
  }

  function drawOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const cw = overlay.clientWidth;
    const ch = overlay.clientHeight;
    const pw = Math.max(1, Math.round(cw * dpr));
    const ph = Math.max(1, Math.round(ch * dpr));
    // 화면 크기/회전이 바뀌면 캔버스 내부 해상도도 맞춤 (선명하게)
    if (overlay.width !== pw) overlay.width = pw;
    if (overlay.height !== ph) overlay.height = ph;

    const ctx = overlayCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const box = getVideoBox();
    const roi = displayedRoi();
    if (!box || !roi) return;

    const r = roiToLocal(roi, box);

    // 영역 바깥을 살짝 어둡게 해서 지정 영역이 눈에 띄게
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fill('evenodd');

    // 테두리: 검은 외곽선 + 노란 선
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ROI_COLOR;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    // 모서리 핸들 (편집 가능할 때만)
    if (editable) {
      const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
      pts.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = ROI_COLOR;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.stroke();
      });
    }

    // 가마 이름 라벨
    const k = deps.getKiln();
    if (k) {
      ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';
      const label = k.name;
      const tw = ctx.measureText(label).width;
      const lx = clamp(r.x, box.x, box.x + box.w - tw - 12);
      const ly = r.y - 28 >= box.y ? r.y - 28 : r.y + r.h + 6;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(lx, ly, tw + 12, 22);
      ctx.fillStyle = ROI_COLOR;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 6, ly + 11);
    }
  }

  // ===== 포인터(터치/마우스) 드래그 =====
  function onPointerDown(e) {
    if (!editable) return;
    if (drag) return; // 두 번째 손가락은 무시
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const k = deps.getKiln();
    if (!k) {
      deps.onMessage('먼저 가마를 추가하세요.', 'error', 4000);
      return;
    }
    const box = getVideoBox();
    if (!box) {
      deps.onMessage('먼저 "카메라 시작"을 눌러 영상을 켜세요.', 'error', 4000);
      return;
    }
    e.preventDefault();

    const local = clientToLocal(e.clientX, e.clientY);
    const p = localToNorm(local, box);
    const hit = hitTest(local, box, k.roi);
    let next;

    if (hit.type === 'corner') {
      // 모서리: 반대편 모서리를 고정하고 크기 조정
      next = { mode: 'resize', anchor: hit.anchor };
    } else if (hit.type === 'inside') {
      // 내부: 이동
      next = { mode: 'move', start: p, orig: { x: k.roi.x, y: k.roi.y, w: k.roi.w, h: k.roi.h } };
    } else {
      // 바깥: 새 영역 그리기
      next = { mode: 'new', anchor: clampPoint(p) };
    }
    next.pointerId = e.pointerId;
    next.roi = null;
    next.moved = false;
    drag = next;

    try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  }

  function onPointerMove(e) {
    const d = drag;
    if (!d) {
      updateHoverCursor(e);
      return;
    }
    if (e.pointerId !== d.pointerId) return;
    e.preventDefault();

    const box = getVideoBox();
    if (!box) return;
    const p = localToNorm(clientToLocal(e.clientX, e.clientY), box);

    if (d.mode === 'move') {
      const nx = clamp(d.orig.x + (p.x - d.start.x), 0, 1 - d.orig.w);
      const ny = clamp(d.orig.y + (p.y - d.start.y), 0, 1 - d.orig.h);
      d.roi = { x: nx, y: ny, w: d.orig.w, h: d.orig.h };
    } else {
      d.roi = rectFromPoints(d.anchor, clampPoint(p));
    }
    d.moved = true;
    scheduleDraw();
    updatePreview();
  }

  function onPointerUp(e) {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    drag = null;
    try { overlay.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }

    const k = deps.getKiln();
    const box = getVideoBox();
    const cancelled = e.type === 'pointercancel';

    if (!cancelled && k && box && d.moved && d.roi) {
      if (d.roi.w * box.w < MIN_ROI_PX || d.roi.h * box.h < MIN_ROI_PX) {
        deps.onMessage('영역이 너무 작습니다. 조금 더 크게 드래그하세요.', 'error', 3000);
      } else {
        deps.onCommit({
          x: round5(d.roi.x),
          y: round5(d.roi.y),
          w: round5(d.roi.w),
          h: round5(d.roi.h)
        });
      }
    }
    scheduleDraw();
  }

  function setCursor(cursor) {
    Object.keys(CURSOR_CLASSES).forEach((key) => {
      overlay.classList.toggle(CURSOR_CLASSES[key], key === cursor);
    });
  }

  // 마우스 사용 시 위치에 따라 커서 모양 변경
  function updateHoverCursor(e) {
    if (e.pointerType !== 'mouse' || !editable) return;
    const k = deps.getKiln();
    const box = getVideoBox();
    let cursor = 'crosshair';
    if (k && box && k.roi) {
      cursor = hitTest(clientToLocal(e.clientX, e.clientY), box, k.roi).cursor;
    }
    setCursor(cursor);
  }

  // 편집 가능 여부 전환. 편집 불가일 때는 영상 위 터치로 화면 스크롤이 되도록 readonly 클래스 지정
  function setEditable(flag) {
    editable = !!flag;
    if (!editable) {
      drag = null;
      setCursor(null);
    }
    overlay.classList.toggle('readonly', !editable);
    scheduleDraw();
  }

  function isEditable() {
    return editable;
  }

  // ===== 영역 확대 미리보기 (주기적으로 호출) =====
  function updatePreview() {
    const size = camera.videoSize();
    const vw = size.width;
    const vh = size.height;

    // 회전 등으로 영상 해상도가 바뀌면 오버레이도 다시 그림
    if (vw !== lastVideoW || vh !== lastVideoH) {
      lastVideoW = vw;
      lastVideoH = vh;
      scheduleDraw();
    }

    const k = deps.getKiln();
    const reason = frameBlockReason(k, camera);
    if (reason) {
      previewCanvas.hidden = true;
      previewPlaceholder.textContent = reason;
      previewPlaceholder.hidden = false;
      return;
    }

    const src = roiToSource(displayedRoi(), vw, vh);

    // 영역 비율을 유지한 채 확대
    const scale = Math.min(PREVIEW_MAX_W / src.w, PREVIEW_MAX_H / src.h);
    const outW = Math.max(1, Math.round(src.w * scale));
    const outH = Math.max(1, Math.round(src.h * scale));

    if (previewCanvas.width !== outW) previewCanvas.width = outW;
    if (previewCanvas.height !== outH) previewCanvas.height = outH;
    try {
      previewCtx.imageSmoothingEnabled = true;
      camera.drawRegion(previewCtx, src, outW, outH);
    } catch (e) {
      return; // 프레임이 아직 준비되지 않은 경우 다음 주기에 다시 시도
    }
    previewCanvas.hidden = false;
    previewPlaceholder.hidden = true;
  }

  return {
    scheduleDraw,
    cancelDrag,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    setEditable,
    isEditable,
    updatePreview
  };
}
