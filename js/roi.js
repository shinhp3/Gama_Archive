// ===== 영역(ROI) 지정 =====
// 오버레이 그리기, 터치/마우스 드래그, 좌표 변환, 영역 확대 미리보기
// 영역은 video 원본 프레임 기준 비율(0~1) 하나만 저장하고, 지정할 때의 방향(roiOrientation: 영상 프레임,
// roiScreen: 화면)을 함께 기억. 화면이 회전해 방향이 달라지면 영역을 숨기고 다시 지정하라고 안내

import { HANDLE_RADIUS, HANDLE_HIT, MIN_ROI_PX, ROI_COLOR, PREVIEW_MAX_W, PREVIEW_MAX_H } from './config.js';

export const ROI_ORIENTATION_CHANGED = '화면 방향이 바뀌었습니다. 영역 버튼을 눌러 영역을 다시 지정해 주세요';
export const NO_ROI = '영역 지정 안 됨';

// 지금 쓸 수 있는 영역이 없을 때 안내 문구
function noRoiMessage(kiln) {
  return (kiln && kiln.roi) ? ROI_ORIENTATION_CHANGED : NO_ROI;
}

/**
 * 기기 화면 방향. iPad의 Split View처럼 창 모양이 바뀌는 경우와 구분하려고 기기 방향 정보를 먼저 사용
 * @returns {'landscape'|'portrait'}
 */
export function screenOrientation() {
  const so = window.screen && window.screen.orientation;
  if (so && typeof so.type === 'string') return so.type.indexOf('portrait') === 0 ? 'portrait' : 'landscape';
  if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90 ? 'landscape' : 'portrait';
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function round5(v) { return Math.round(v * 100000) / 100000; }

// 커서 모양별 CSS 클래스 (기본 crosshair는 CSS에서 지정)
const CURSOR_CLASSES = {
  'move': 'cursor-move',
  'nwse-resize': 'cursor-nwse',
  'nesw-resize': 'cursor-nesw'
};

// ===== 좌표 변환 (모든 화면 표시·잘라내기는 이 함수들을 거침) =====

/**
 * 현재 video 상태로 contain 레이아웃을 매번 새로 계산 (캐시하지 않음)
 * @returns {{ orientation: 'landscape'|'portrait'|null, screen: 'landscape'|'portrait', videoW, videoH,
 *             clientW, clientH, box: {x,y,w,h}|null }}
 *   orientation: 영상 프레임 방향, screen: 화면 방향,
 *   box: video 요소 안에서 실제 영상이 그려진 사각형 (CSS px, 여백 제외)
 */
export function getVideoLayout(video) {
  const videoW = video.videoWidth || 0;
  const videoH = video.videoHeight || 0;
  const clientW = video.clientWidth || 0;
  const clientH = video.clientHeight || 0;
  const orientation = (videoW && videoH) ? (videoW >= videoH ? 'landscape' : 'portrait') : null;
  let box = null;
  if (videoW && videoH && clientW && clientH) {
    const scale = Math.min(clientW / videoW, clientH / videoH);
    const w = videoW * scale;
    const h = videoH * scale;
    box = { x: (clientW - w) / 2, y: (clientH - h) / 2, w, h };
  }
  return { orientation, screen: screenOrientation(), videoW, videoH, clientW, clientH, box };
}

// 드래그/영역을 지정한 때와 지금의 영상·화면 방향이 같은지
function sameView(view, layout) {
  return !!(view && layout && layout.orientation &&
    view.orientation === layout.orientation && view.screen === layout.screen);
}

// 지금 방향에서 쓸 수 있는 영역 (지정할 때와 방향이 다르면 null)
export function activeRoi(kiln, layout) {
  if (!kiln || !kiln.roi) return null;
  return sameView({ orientation: kiln.roiOrientation, screen: kiln.roiScreen }, layout) ? kiln.roi : null;
}

// 영역을 지정한 뒤 화면이 회전해 지금은 쓸 수 없는 상태인지
export function isRoiRotated(kiln, layout) {
  return !!(kiln && kiln.roi && kiln.roiOrientation && layout && layout.orientation && !activeRoi(kiln, layout));
}

// 비율 ROI → 원본 프레임 픽셀 사각형
export function roiToSource(roi, layout) {
  const vw = layout.videoW;
  const vh = layout.videoH;
  const x = clamp(Math.floor(roi.x * vw), 0, vw - 1);
  const y = clamp(Math.floor(roi.y * vh), 0, vh - 1);
  return {
    x,
    y,
    w: clamp(Math.round(roi.w * vw), 1, vw - x),
    h: clamp(Math.round(roi.h * vh), 1, vh - y)
  };
}

// 비율 ROI → 화면(video 요소 내부 CSS px) 사각형
export function roiToScreen(roi, layout) {
  const b = layout.box;
  return { x: b.x + roi.x * b.w, y: b.y + roi.y * b.h, w: roi.w * b.w, h: roi.h * b.h };
}

// 화면(video 요소 내부 CSS px) 점 → 비율 좌표
export function screenToNorm(p, layout) {
  const b = layout.box;
  return { x: (p.x - b.x) / b.w, y: (p.y - b.y) / b.h };
}

/**
 * 판독/미리보기용으로 현재 프레임에서 잘라낼 원본 픽셀 사각형
 * 화면에 표시되는 영역과 항상 같은 값을 사용. 잘라낼 수 없으면 null
 */
export function currentSourceRect(kiln, video) {
  const layout = getVideoLayout(video);
  const roi = activeRoi(kiln, layout);
  if (!roi) return null;
  return roiToSource(roi, layout);
}

// 프레임을 읽을 수 없는 이유 (읽을 수 있으면 null)
export function frameBlockReason(kiln, camera, video) {
  if (!kiln) return '가마 없음';
  if (!camera.isFrameReady()) return '카메라 꺼짐';
  if (!activeRoi(kiln, getVideoLayout(video))) return noRoiMessage(kiln);
  return null;
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
function hitTest(p, layout, roi) {
  if (!roi) return { type: 'none', cursor: 'crosshair' };
  const r = roiToScreen(roi, layout);
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
 * @param {{ video: HTMLVideoElement, overlay: HTMLCanvasElement, previewCanvas: HTMLCanvasElement, previewPlaceholder: HTMLElement }} els
 * @param {{ camera: object, getKiln: Function, onMessage: Function, onCommit: Function }} deps
 *   onCommit(roi, view): 드래그가 끝나 새 영역이 확정될 때. view = { orientation, screen } (지정한 때의 방향)
 */
export function createRoiEditor(els, deps) {
  const { video, overlay, previewCanvas, previewPlaceholder } = els;
  const { camera } = deps;
  const overlayCtx = overlay.getContext('2d');
  const previewCtx = previewCanvas.getContext('2d');

  let editable = false;     // 영역 편집 가능 여부 (영역 버튼으로 켜고 끔)
  let drag = null;          // 진행 중인 드래그 정보
  let drawQueued = false;   // 오버레이 다시 그리기 예약 여부

  // 카메라가 켜져 있고 영상 크기를 알 때만 레이아웃 반환
  function currentLayout() {
    const layout = getVideoLayout(video);
    return (camera.isRunning() && layout.box) ? layout : null;
  }

  // 화면 좌표(clientX/Y) → video 요소 내부 CSS px (오버레이는 video와 같은 위치·크기)
  function clientToLocal(clientX, clientY) {
    const r = overlay.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // 드래그 중이면 임시 영역, 아니면 지금 방향에서 쓸 수 있는 저장된 영역
  function displayedRoi(layout) {
    if (drag && drag.moved && drag.roi && sameView(drag, layout)) return drag.roi;
    return activeRoi(deps.getKiln(), layout);
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

    const layout = currentLayout();
    const k = deps.getKiln();
    if (!layout || !k) return;
    const box = layout.box;
    const roi = displayedRoi(layout);

    // 지정한 뒤 화면이 회전했으면 영역을 숨기고 다시 지정하라는 안내 표시
    if (!roi) {
      if (isRoiRotated(k, layout)) drawNotice(ctx, box, ROI_ORIENTATION_CHANGED);
      return;
    }

    const r = roiToScreen(roi, layout);

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

  // 영상 위쪽 가운데에 안내 문구 (너비에 맞춰 줄바꿈)
  function drawNotice(ctx, box, text) {
    ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';
    const maxW = Math.max(120, box.w - 40);
    const lines = [];
    let line = '';
    text.split(' ').forEach((word) => {
      const test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > maxW) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    const lineH = 22;
    const w = Math.min(maxW, Math.max.apply(null, lines.map((l) => ctx.measureText(l).width))) + 20;
    const h = lines.length * lineH + 12;
    const x = box.x + (box.w - w) / 2;
    const y = box.y + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = ROI_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, box.x + box.w / 2, y + 6 + lineH * i + lineH / 2));
    ctx.textAlign = 'start';
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
    const layout = currentLayout();
    if (!layout) {
      deps.onMessage('먼저 "카메라 시작"을 눌러 영상을 켜세요.', 'error', 4000);
      return;
    }
    e.preventDefault();

    const roi = activeRoi(k, layout);
    const local = clientToLocal(e.clientX, e.clientY);
    const p = screenToNorm(local, layout);
    const hit = hitTest(local, layout, roi);
    let next;

    if (hit.type === 'corner') {
      // 모서리: 반대편 모서리를 고정하고 크기 조정
      next = { mode: 'resize', anchor: hit.anchor };
    } else if (hit.type === 'inside') {
      // 내부: 이동
      next = { mode: 'move', start: p, orig: { x: roi.x, y: roi.y, w: roi.w, h: roi.h } };
    } else {
      // 바깥: 새 영역 그리기
      next = { mode: 'new', anchor: clampPoint(p) };
    }
    next.pointerId = e.pointerId;
    // 드래그 도중 방향이 바뀌면 취소하기 위해 기억
    next.orientation = layout.orientation;
    next.screen = layout.screen;
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

    const layout = currentLayout();
    if (!sameView(d, layout)) return;
    const p = screenToNorm(clientToLocal(e.clientX, e.clientY), layout);

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
    const layout = currentLayout();
    const cancelled = e.type === 'pointercancel';
    // 드래그 도중 화면이 회전했으면 저장하지 않음
    if (!cancelled && k && sameView(d, layout) && d.moved && d.roi) {
      if (d.roi.w * layout.box.w < MIN_ROI_PX || d.roi.h * layout.box.h < MIN_ROI_PX) {
        deps.onMessage('영역이 너무 작습니다. 조금 더 크게 드래그하세요.', 'error', 3000);
      } else {
        deps.onCommit({
          x: round5(d.roi.x),
          y: round5(d.roi.y),
          w: round5(d.roi.w),
          h: round5(d.roi.h)
        }, { orientation: d.orientation, screen: d.screen });
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
    const layout = currentLayout();
    let cursor = 'crosshair';
    if (layout) {
      const roi = activeRoi(deps.getKiln(), layout);
      cursor = hitTest(clientToLocal(e.clientX, e.clientY), layout, roi).cursor;
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

  // ===== 영역 확대 미리보기 =====
  // 화면에 표시된 영역과 같은 변환·같은 영역으로 잘라냄
  function updatePreview() {
    const k = deps.getKiln();
    const layout = getVideoLayout(video);
    const roi = (k && camera.isFrameReady()) ? displayedRoi(layout) : null;
    if (!roi) {
      previewCanvas.hidden = true;
      previewPlaceholder.textContent = frameBlockReason(k, camera, video) || noRoiMessage(k);
      previewPlaceholder.hidden = false;
      return;
    }

    const src = roiToSource(roi, layout);

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
