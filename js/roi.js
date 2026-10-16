// ===== 영역(ROI) 지정 =====
// 화면 가운데 고정된 가이드 틀에, 영상을 디지털 확대/이동해 숫자를 맞추는 방식.
// 틀·오버레이 그리기, 핀치/드래그 조작, 좌표 변환, 영역 확대 미리보기

import {
  ROI_COLOR, PREVIEW_MAX_W, PREVIEW_MAX_H, DEFAULT_DIGITS, DEFAULT_DIGIT_ASPECT,
  DEFAULT_GUIDE_WIDTH_RATIO, MIN_GUIDE_WIDTH_RATIO, MAX_GUIDE_WIDTH_RATIO, GUIDE_WIDTH_STEP,
  MAX_ROTATION_DEG, ROTATION_STEP_DEG,
  GUIDE_MAX_HEIGHT_RATIO, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP
} from './config.js?v=0.3.7';

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function round3(v) { return Math.round(v * 1000) / 1000; }
function round5(v) { return Math.round(v * 100000) / 100000; }

const ROI_EPS = 0.0002;    // 저장된 영역이 틀과 이 정도 넘게 어긋나면 틀에 맞춰 다시 저장
const SLIDER_MAX = 1000;   // 확대 슬라이더 눈금 수 (배율은 로그 눈금)
const MIN_PINCH_PX = 10;   // 두 손가락 간격이 이보다 좁으면 확대/축소 계산 안 함

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

// 회전각 정리: -15° ~ +15°, 0.5° 단위
export function normalizeRotation(deg) {
  const d = Math.round((isFinite(deg) ? deg : 0) / ROTATION_STEP_DEG) * ROTATION_STEP_DEG;
  return clamp(Math.round(d * 10) / 10, -MAX_ROTATION_DEG, MAX_ROTATION_DEG) || 0;
}

/**
 * 가마 영역(roi + rotationDeg) → 원본 프레임 픽셀 기준 판독 영역
 * roi {x, y, w, h}는 회전 전 사각형(비율)이고, 회전은 그 중심을 기준으로 원본 픽셀 공간에서 적용
 * (화면 표시는 원본 프레임을 같은 비율로 확대/이동만 하므로 화면의 회전각 = 원본 프레임의 회전각).
 * 양수 각도 = 시계 방향 (y축이 아래로 향하는 화면·canvas 기준)
 * 0°면 기존 roiToSource와 같은 정수 사각형 (angle: 0)
 * @returns {{ x, y, w, h, angle, cx, cy, corners: {x, y}[], bounds: {x, y, w, h} }}
 */
export function roiSourceRegion(roi, rotationDeg, vw, vh) {
  const deg = normalizeRotation(rotationDeg);
  if (!deg) {
    const r = roiToSource(roi, vw, vh);
    return Object.assign(r, {
      angle: 0,
      cx: r.x + r.w / 2,
      cy: r.y + r.h / 2,
      corners: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
      bounds: { x: r.x, y: r.y, w: r.w, h: r.h }
    });
  }
  const angle = deg * Math.PI / 180;
  const cx = (roi.x + roi.w / 2) * vw;
  const cy = (roi.y + roi.h / 2) * vh;
  const w = Math.max(1, roi.w * vw);
  const h = Math.max(1, roi.h * vh);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // 좌상 → 우상 → 우하 → 좌하 (회전 전 기준)
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = sx * w / 2;
    const dy = sy * h / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
  // 회전된 영역을 덮는 원본 사각형 (1px 여유, 프레임 안으로 제한)
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const bx = clamp(Math.floor(Math.min.apply(null, xs)) - 1, 0, vw - 1);
  const by = clamp(Math.floor(Math.min.apply(null, ys)) - 1, 0, vh - 1);
  const bounds = {
    x: bx,
    y: by,
    w: clamp(Math.ceil(Math.max.apply(null, xs)) + 1, bx + 1, vw) - bx,
    h: clamp(Math.ceil(Math.max.apply(null, ys)) + 1, by + 1, vh) - by
  };
  return { x: cx - w / 2, y: cy - h / 2, w, h, angle, cx, cy, corners, bounds };
}

// 가마 설정으로 판독 영역 계산
export function kilnSourceRegion(kiln, vw, vh) {
  return roiSourceRegion(kiln.roi, kiln.rotationDeg, vw, vh);
}

// 프레임을 읽을 수 없는 이유 (읽을 수 있으면 null)
export function frameBlockReason(kiln, camera) {
  if (!kiln) return '가마 없음';
  if (!camera.isFrameReady()) return '카메라 꺼짐';
  if (!kiln.roi) return '영역 지정 안 됨';
  return null;
}

// ===== 좌표 계산 =====
// 화면 좌표: 영상 영역(오버레이) 안의 CSS px. 프레임 좌표: video 원본 프레임 기준 비율(0~1)
// 확대/이동 상태 view = { zoom, cx, cy }: 배율 zoom으로 확대한 영상에서 프레임 위치 (cx, cy)가 틀 가운데(= 영상 영역 가운데)에 옴

// object-fit: contain 으로 배율 1일 때 영상이 그려지는 사각형 (위아래/양옆 여백 포함 계산)
export function fitBox(cw, ch, vw, vh) {
  const scale = Math.min(cw / vw, ch / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

// 가이드 틀 크기: 비율 = 자릿수 × 자릿수 폭/높이 비율, 폭은 영상 영역 폭 × widthRatio(가마별 설정), 높이를 넘지 않게
export function guideSize(cw, ch, digits, digitAspect, widthRatio) {
  const ratio = digits * digitAspect;
  let w = cw * clamp(widthRatio || DEFAULT_GUIDE_WIDTH_RATIO, MIN_GUIDE_WIDTH_RATIO, MAX_GUIDE_WIDTH_RATIO);
  let h = w / ratio;
  const maxH = ch * GUIDE_MAX_HEIGHT_RATIO;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

// 틀 회전: 회전각(라디안)과 회전된 틀을 덮는 사각형 크기(bw, bh)를 덧붙임
export function rotateGuide(guide, rotationDeg) {
  const angle = normalizeRotation(rotationDeg) * Math.PI / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return {
    w: guide.w,
    h: guide.h,
    angle,
    bw: guide.w * c + guide.h * s,
    bh: guide.w * s + guide.h * c
  };
}

// 틀(회전했으면 회전된 틀 전체)이 영상 밖으로 나가지 않는 최소 배율
export function minZoom(base, guide) {
  return Math.max(MIN_ZOOM, (guide.bw || guide.w) / base.w, (guide.bh || guide.h) / base.h);
}

// 배율 범위와 이동 범위(회전된 틀까지 영상 안에 있도록 → OCR 영역에 영상 밖 검은 빈 곳이 들어가지 않음) 제한
export function clampView(base, guide, view) {
  const zoom = clamp(isFinite(view.zoom) ? view.zoom : MIN_ZOOM, minZoom(base, guide), MAX_ZOOM);
  const hw = (guide.bw || guide.w) / (base.w * zoom) / 2;
  const hh = (guide.bh || guide.h) / (base.h * zoom) / 2;
  return {
    zoom,
    cx: clamp(isFinite(view.cx) ? view.cx : 0.5, hw, 1 - hw),
    cy: clamp(isFinite(view.cy) ? view.cy : 0.5, hh, 1 - hh)
  };
}

// 확대/이동 상태 → 틀이 가리키는 프레임 영역 (비율)
export function viewToRoi(base, guide, view) {
  const w = Math.min(1, guide.w / (base.w * view.zoom));
  const h = Math.min(1, guide.h / (base.h * view.zoom));
  return {
    x: round5(clamp(view.cx - w / 2, 0, 1 - w)),
    y: round5(clamp(view.cy - h / 2, 0, 1 - h)),
    w: round5(w),
    h: round5(h)
  };
}

// 프레임 영역 → 그 영역이 틀 안에 꼭 맞게 들어오는 확대/이동 상태
export function roiToView(base, guide, roi) {
  return {
    zoom: Math.min(guide.w / (base.w * roi.w), guide.h / (base.h * roi.h)),
    cx: roi.x + roi.w / 2,
    cy: roi.y + roi.h / 2
  };
}

// 확대/이동 상태에서 프레임 전체가 화면에 그려지는 사각형
export function frameRect(cw, ch, base, view) {
  const w = base.w * view.zoom;
  const h = base.h * view.zoom;
  return { x: cw / 2 - view.cx * w, y: ch / 2 - view.cy * h, w, h };
}

function roisDiffer(a, b) {
  return Math.abs(a.x - b.x) > ROI_EPS || Math.abs(a.y - b.y) > ROI_EPS ||
    Math.abs(a.w - b.w) > ROI_EPS || Math.abs(a.h - b.h) > ROI_EPS;
}

// 비율 ROI → 화면 사각형 (frame: 프레임 전체가 그려지는 화면 사각형)
function roiToLocal(roi, frame) {
  return {
    x: frame.x + roi.x * frame.w,
    y: frame.y + roi.y * frame.h,
    w: roi.w * frame.w,
    h: roi.h * frame.h
  };
}

function midpoint(pts) {
  let x = 0;
  let y = 0;
  pts.forEach((p) => { x += p.x; y += p.y; });
  return { x: x / pts.length, y: y / pts.length };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sliderToZoom(v) {
  return MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, v / SLIDER_MAX);
}

function zoomToSlider(z) {
  return Math.round(Math.log(z / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM) * SLIDER_MAX);
}

/**
 * @param {{ video: HTMLVideoElement, overlay: HTMLCanvasElement, previewCanvas: HTMLCanvasElement,
 *   previewPlaceholder: HTMLElement, zoomBar: HTMLElement, zoomInput: HTMLInputElement, zoomValue: HTMLElement,
 *   zoomInBtn: HTMLButtonElement, zoomOutBtn: HTMLButtonElement, zoomResetBtn: HTMLButtonElement,
 *   guideBar: HTMLElement, guideInput: HTMLInputElement, guideValue: HTMLElement,
 *   rotateBar: HTMLElement, rotateInput: HTMLInputElement, rotateValue: HTMLElement,
 *   rotateMinusBtn: HTMLButtonElement, rotatePlusBtn: HTMLButtonElement, rotateResetBtn: HTMLButtonElement }} els
 * @param {{ camera: object, getKiln: Function, onCommit: Function }} deps
 *   onCommit(patch, soon): 확대/이동이 바뀌어 { view, roi }를 가마 설정에 저장할 때 (soon이면 잠시 모았다가 저장)
 */
export function createRoiEditor(els, deps) {
  const { video, overlay, previewCanvas, previewPlaceholder } = els;
  const { camera } = deps;
  const overlayCtx = overlay.getContext('2d');
  const previewCtx = previewCanvas.getContext('2d');

  let editable = false;      // 확대/이동 조작 가능 여부 (영역 버튼으로 켜고 끔)
  let drawQueued = false;    // 오버레이 다시 그리기 예약 여부
  let samples = null;        // 틀 위에 덧그릴 세그먼트 샘플 위치 (판독 보정 중일 때만)
  let shown = null;          // 마지막으로 화면에 적용한 { L, view, frame }
  let gesture = null;        // 진행 중인 핀치/드래그의 기준 { view, mid, dist }
  const pointers = new Map(); // 화면에 닿아 있는 손가락(포인터) id → 화면 좌표
  let lastTransform = '';
  let lastVideoW = 0;        // 영상 해상도 변화 감지용 (회전 시 가로/세로가 바뀜)
  let lastVideoH = 0;

  // 가마의 틀 폭 비율 (저장값이 없으면 기본)
  function guideRatioOf(k) {
    return k && k.guideWidthRatio ? k.guideWidthRatio : DEFAULT_GUIDE_WIDTH_RATIO;
  }

  // 지금 화면 크기·영상 해상도·가마 설정으로 정해지는 배치 (카메라가 꺼져 있으면 null)
  // over: { guideWidthRatio, rotationDeg } 중 주어진 값은 가마에 저장된 값 대신 사용
  function layout(over) {
    const cw = overlay.clientWidth;
    const ch = overlay.clientHeight;
    const size = camera.videoSize();
    if (!camera.isRunning() || !size.width || !size.height || !cw || !ch) return null;
    const k = deps.getKiln();
    const o = over || {};
    const guide = guideSize(cw, ch, k ? k.digits : DEFAULT_DIGITS, k ? k.digitAspect : DEFAULT_DIGIT_ASPECT,
      o.guideWidthRatio || guideRatioOf(k));
    const deg = o.rotationDeg !== undefined ? o.rotationDeg : (k ? k.rotationDeg : 0);
    return {
      cw,
      ch,
      base: fitBox(cw, ch, size.width, size.height),
      guide: rotateGuide(guide, deg)
    };
  }

  // 보여 줄 확대/이동 상태: 저장된 영역이 있으면 그 영역이 틀에 꼭 맞게(화면 크기가 바뀌어도 같은 숫자가 틀 안에),
  // 없으면 저장된 상태, 그것도 없으면 최소 배율·가운데
  function resolveView(L) {
    const k = deps.getKiln();
    let v;
    if (k && k.roi) v = roiToView(L.base, L.guide, k.roi);
    else if (k && k.view) v = k.view;
    else v = { zoom: MIN_ZOOM, cx: 0.5, cy: 0.5 };
    return clampView(L.base, L.guide, v);
  }

  // 확대/이동 상태와 틀이 가리키는 영역을 가마 설정에 저장 (extra: 함께 저장할 항목)
  function commitView(L, view, soon, extra) {
    if (!deps.getKiln()) return;
    deps.onCommit(Object.assign({
      view: { zoom: round3(view.zoom), cx: round5(view.cx), cy: round5(view.cy) },
      roi: viewToRoi(L.base, L.guide, view)
    }, extra), soon);
  }

  function setVideoTransform(tx, ty, zoom) {
    const key = tx.toFixed(2) + '|' + ty.toFixed(2) + '|' + zoom.toFixed(4);
    if (key === lastTransform) return;
    lastTransform = key;
    video.style.setProperty('--view-tx', tx.toFixed(2) + 'px');
    video.style.setProperty('--view-ty', ty.toFixed(2) + 'px');
    video.style.setProperty('--view-zoom', zoom.toFixed(4));
  }

  // 영상에 확대/이동 적용. 저장된 영역이 틀과 어긋나 있으면(이전 방식 영역, 자릿수·틀 비율 변경) 틀에 맞춰 다시 저장
  function applyView() {
    const L = layout();
    if (!L) {
      setVideoTransform(0, 0, 1);
      shown = null;
      updateZoomBar(null);
      return null;
    }
    const view = resolveView(L);
    const k = deps.getKiln();
    if (k && k.roi && (!k.view || roisDiffer(viewToRoi(L.base, L.guide, view), k.roi))) {
      commitView(L, view, true);
    }
    const frame = frameRect(L.cw, L.ch, L.base, view);
    setVideoTransform(frame.x - view.zoom * L.base.x, frame.y - view.zoom * L.base.y, view.zoom);
    shown = { L, view, frame };
    updateZoomBar(shown);
    return shown;
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

    const s = applyView();
    if (!s) return;
    const k = deps.getKiln();
    const hasRoi = !!(k && k.roi);
    // 틀: 영상 영역 가운데 기준으로 회전 (판독 영역 계산과 같은 각도·방향, 양수 = 시계 방향)
    const gw = s.L.guide.w;
    const gh = s.L.guide.h;
    const angle = s.L.guide.angle || 0;
    const gx = cw / 2;
    const gy = ch / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // 틀 기준 좌표(가운데 원점, 회전 전) → 화면 좌표
    const toScreen = (dx, dy) => ({ x: gx + dx * cos - dy * sin, y: gy + dx * sin + dy * cos });
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => toScreen(sx * gw / 2, sy * gh / 2));

    // 틀 바깥을 반투명하게 어둡게 해서 틀 안을 강조
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    corners.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill('evenodd');

    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(angle);

    // 자릿수 칸 구분선
    const digits = k ? k.digits : DEFAULT_DIGITS;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 212, 0, 0.6)';
    ctx.beginPath();
    for (let i = 1; i < digits; i++) {
      const x = angle ? -gw / 2 + gw * i / digits : Math.round(gx - gw / 2 + gw * i / digits) + 0.5 - gx;
      ctx.moveTo(x, -gh / 2);
      ctx.lineTo(x, gh / 2);
    }
    ctx.stroke();

    // 세그먼트 샘플 위치 (켜짐 = 초록, 꺼짐 = 흰색). 확대/이동 중에는 위치가 맞지 않으므로 생략
    if (samples && hasRoi && !gesture) {
      const r = roiToLocal(k.roi, s.frame);
      const rx = r.x + r.w / 2 - gx;
      const ry = r.y + r.h / 2 - gy;
      ctx.lineWidth = 1;
      samples.forEach((q) => {
        ctx.beginPath();
        q.pts.forEach((pt, i) => {
          const x = rx + (pt.x - 0.5) * r.w;
          const y = ry + (pt.y - 0.5) * r.h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = q.on ? 'rgba(40, 220, 90, 0.4)' : 'rgba(255, 255, 255, 0.18)';
        ctx.fill();
        ctx.strokeStyle = q.on ? 'rgba(40, 220, 90, 0.95)' : 'rgba(255, 255, 255, 0.6)';
        ctx.stroke();
      });
    }

    // 테두리: 검은 외곽선 + 노란 선. 영역을 아직 지정하지 않았으면 점선
    ctx.lineJoin = 'round';
    ctx.setLineDash(hasRoi ? [] : [12, 8]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeRect(-gw / 2, -gh / 2, gw, gh);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ROI_COLOR;
    ctx.strokeRect(-gw / 2, -gh / 2, gw, gh);
    ctx.setLineDash([]);
    ctx.restore();

    // 가마 이름 라벨 (회전된 틀을 덮는 사각형 위, 공간이 없으면 아래). 라벨은 회전하지 않음
    if (k) {
      const top = gy - s.L.guide.bh / 2;
      const bottom = gy + s.L.guide.bh / 2;
      ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';
      const label = hasRoi ? k.name : k.name + ' · 영역 지정 안 됨';
      const tw = ctx.measureText(label).width;
      const lx = clamp(gx - s.L.guide.bw / 2, 4, cw - tw - 16);
      const ly = top - 30 >= 4 ? top - 30 : bottom + 8;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(lx, ly, tw + 12, 22);
      ctx.fillStyle = ROI_COLOR;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 6, ly + 11);
    }
  }

  // ===== 확대/이동 =====
  // 화면 갱신 + 저장 (soon이면 잠시 모았다가 저장)
  function setView(L, view, soon, extra) {
    commitView(L, view, soon, extra);
    scheduleDraw();
    updatePreview();
  }

  // 기준 상태 start에서 화면의 점 anchor 아래 있던 프레임 위치가 화면의 점 to 아래로 오도록 배율 zoom으로 확대/이동
  function zoomAround(L, start, anchor, to, zoom) {
    const u = start.cx + (anchor.x - L.cw / 2) / (L.base.w * start.zoom);
    const v = start.cy + (anchor.y - L.ch / 2) / (L.base.h * start.zoom);
    const z = clamp(zoom, minZoom(L.base, L.guide), MAX_ZOOM);
    return clampView(L.base, L.guide, {
      zoom: z,
      cx: u - (to.x - L.cw / 2) / (L.base.w * z),
      cy: v - (to.y - L.ch / 2) / (L.base.h * z)
    });
  }

  // 틀 가운데를 기준으로 배율만 바꿈 (슬라이더, +/- 버튼)
  function zoomTo(zoom, soon) {
    const L = layout();
    if (!L) return;
    const v = resolveView(L);
    setView(L, clampView(L.base, L.guide, { zoom, cx: v.cx, cy: v.cy }), soon);
  }

  function zoomBy(factor) {
    const L = layout();
    if (!L) return;
    zoomTo(resolveView(L).zoom * factor, false);
  }

  // 최소 배율, 가운데
  function resetView() {
    const L = layout();
    if (!L) return;
    setView(L, clampView(L.base, L.guide, { zoom: MIN_ZOOM, cx: 0.5, cy: 0.5 }), false);
  }

  // 틀 크기 변경: 영상 배율과 틀 가운데의 프레임 위치는 그대로 두고 틀만 키우거나 줄여 영역을 다시 계산
  // (틀이 영상 밖으로 나가게 되면 최소 배율·이동 범위에 맞춰 조정)
  function setGuideWidth(ratio, soon) {
    const k = deps.getKiln();
    if (!k) return;
    const r = clamp(Math.round(ratio / GUIDE_WIDTH_STEP) * GUIDE_WIDTH_STEP, MIN_GUIDE_WIDTH_RATIO, MAX_GUIDE_WIDTH_RATIO);
    const next = Math.round(r * 100) / 100;
    const L = layout();
    if (!L) {
      deps.onCommit({ guideWidthRatio: next }, soon);
      scheduleDraw();
      return;
    }
    const view = resolveView(L);
    const L2 = layout({ guideWidthRatio: next });
    setView(L2, clampView(L2.base, L2.guide, view), soon, { guideWidthRatio: next });
  }

  // 틀 회전: 틀 크기 변경과 같이 배율·틀 가운데의 프레임 위치는 그대로 두고 회전각만 바꿔 영역을 다시 계산
  // (회전된 틀이 영상 밖으로 나가게 되면 최소 배율·이동 범위에 맞춰 조정)
  function setRotation(deg, soon) {
    const k = deps.getKiln();
    if (!k) return;
    const next = normalizeRotation(deg);
    const L = layout();
    if (!L) {
      deps.onCommit({ rotationDeg: next }, soon);
      scheduleDraw();
      return;
    }
    const view = resolveView(L);
    const L2 = layout({ rotationDeg: next });
    setView(L2, clampView(L2.base, L2.guide, view), soon, { rotationDeg: next });
  }

  function rotationOf(k) {
    return k ? normalizeRotation(k.rotationDeg) : 0;
  }

  function updateGuideBar() {
    const k = deps.getKiln();
    const pct = Math.round(guideRatioOf(k) * 100);
    els.guideValue.textContent = pct + '%';
    // 슬라이더를 움직이는 중에는 값이 같으므로 건드리지 않음
    if (parseInt(els.guideInput.value, 10) !== pct) els.guideInput.value = String(pct);

    const deg = rotationOf(k);
    els.rotateValue.textContent = (deg > 0 ? '+' : '') + deg.toFixed(1) + '°';
    if (parseFloat(els.rotateInput.value) !== deg) els.rotateInput.value = String(deg);
    els.rotateMinusBtn.disabled = deg <= -MAX_ROTATION_DEG;
    els.rotatePlusBtn.disabled = deg >= MAX_ROTATION_DEG;
  }

  function updateZoomBar(s) {
    updateGuideBar();
    if (!s) {
      els.zoomValue.textContent = '—';
      return;
    }
    const z = s.view.zoom;
    els.zoomValue.textContent = z.toFixed(1) + '배';
    // 슬라이더를 움직이는 중에는 값이 거의 같으므로 건드리지 않음 (손가락 아래에서 튀지 않게)
    if (Math.abs(sliderToZoom(parseFloat(els.zoomInput.value) || 0) - z) > z * 0.01) {
      els.zoomInput.value = String(zoomToSlider(z));
    }
    els.zoomOutBtn.disabled = z <= minZoom(s.L.base, s.L.guide) + 0.001;
    els.zoomInBtn.disabled = z >= MAX_ZOOM - 0.001;
  }

  // ===== 핀치/드래그 (pointer events) =====
  function localPoint(e) {
    const r = overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function activePoints() {
    return Array.from(pointers.values()).slice(0, 2);
  }

  // 손가락 수가 바뀔 때마다 기준(현재 상태, 손가락 중심, 손가락 간격)을 다시 잡아 화면이 튀지 않게 함
  function restartGesture() {
    const pts = activePoints();
    const L = layout();
    if (!pts.length || !L) {
      gesture = null;
      return;
    }
    gesture = {
      view: resolveView(L),
      mid: midpoint(pts),
      dist: pts.length > 1 ? distance(pts[0], pts[1]) : 0
    };
  }

  function onPointerDown(e) {
    if (!editable) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!layout() || !deps.getKiln()) return;
    e.preventDefault();
    pointers.set(e.pointerId, localPoint(e));
    try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    restartGesture();
    overlay.classList.add('grabbing');
  }

  function onPointerMove(e) {
    if (!gesture || !pointers.has(e.pointerId)) return;
    e.preventDefault();
    pointers.set(e.pointerId, localPoint(e));
    const L = layout();
    if (!L) return;
    const pts = activePoints();
    let zoom = gesture.view.zoom;
    if (pts.length > 1 && gesture.dist > MIN_PINCH_PX) {
      zoom *= distance(pts[0], pts[1]) / gesture.dist;
    }
    setView(L, zoomAround(L, gesture.view, gesture.mid, midpoint(pts), zoom), true);
  }

  function onPointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { overlay.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    restartGesture();
    if (!gesture) {
      overlay.classList.remove('grabbing');
      scheduleDraw();
    }
  }

  // 마우스 휠 확대/축소 (PC에서 확인할 때)
  function onWheel(e) {
    if (!editable) return;
    const L = layout();
    if (!L) return;
    e.preventDefault();
    const p = localPoint(e);
    const start = resolveView(L);
    setView(L, zoomAround(L, start, p, p, start.zoom * Math.exp(-e.deltaY * 0.0015)), true);
  }

  function cancelGesture() {
    pointers.clear();
    gesture = null;
    overlay.classList.remove('grabbing');
  }

  // 조작 가능 여부 전환. 조작할 수 없을 때는 영상 위 터치로 화면 스크롤이 되도록 readonly 클래스 지정
  function setEditable(flag) {
    editable = !!flag;
    cancelGesture();
    overlay.classList.toggle('readonly', !editable);
    els.zoomBar.hidden = !editable;
    els.guideBar.hidden = !editable;
    els.rotateBar.hidden = !editable;
    if (editable) {
      // 조작을 시작하면 지금 틀이 가리키는 곳을 바로 영역으로 지정
      const L = layout();
      if (L) commitView(L, resolveView(L), false);
    }
    scheduleDraw();
    updatePreview();
  }

  function isEditable() {
    return editable;
  }

  // 지금 화면에 적용된 확대/이동 상태 (카메라가 꺼져 있으면 null)
  function currentView() {
    return shown ? shown.view : null;
  }

  // 세그먼트 샘플 위치 지정 (null이면 그리지 않음). pts는 영역 기준 비율 좌표
  function setSamples(list) {
    if (!list && !samples) return;
    samples = list;
    scheduleDraw();
  }

  // ===== 영역 확대 미리보기 (주기적으로 호출) =====
  function updatePreview() {
    const size = camera.videoSize();
    const vw = size.width;
    const vh = size.height;

    // 회전 등으로 영상 해상도가 바뀌면 틀과 확대 상태도 다시 계산
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

    // OCR과 같은 영역 (회전했으면 회전 보정한 이미지)
    const src = kilnSourceRegion(k, vw, vh);

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

  function bindEvents() {
    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('pointercancel', onPointerUp);
    overlay.addEventListener('wheel', onWheel, { passive: false });
    // touch-action을 지원하지 않는 구형 iOS 대비: 조작 중에는 영상 위 터치 스크롤/브라우저 확대 차단
    const blockWhileEditing = (e) => { if (editable) e.preventDefault(); };
    overlay.addEventListener('touchmove', blockWhileEditing, { passive: false });
    overlay.addEventListener('gesturestart', blockWhileEditing);
    overlay.addEventListener('gesturechange', blockWhileEditing);
    overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); });

    els.zoomInput.min = '0';
    els.zoomInput.max = String(SLIDER_MAX);
    els.zoomInput.addEventListener('input', () => {
      zoomTo(sliderToZoom(parseFloat(els.zoomInput.value) || 0), true);
    });
    els.zoomInBtn.addEventListener('click', () => zoomBy(ZOOM_STEP));
    els.zoomOutBtn.addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
    els.zoomResetBtn.addEventListener('click', resetView);

    els.guideInput.min = String(Math.round(MIN_GUIDE_WIDTH_RATIO * 100));
    els.guideInput.max = String(Math.round(MAX_GUIDE_WIDTH_RATIO * 100));
    els.guideInput.step = String(Math.round(GUIDE_WIDTH_STEP * 100));
    els.guideInput.addEventListener('input', () => {
      setGuideWidth((parseInt(els.guideInput.value, 10) || 0) / 100, true);
    });

    els.rotateInput.min = String(-MAX_ROTATION_DEG);
    els.rotateInput.max = String(MAX_ROTATION_DEG);
    els.rotateInput.step = String(ROTATION_STEP_DEG);
    els.rotateInput.addEventListener('input', () => {
      setRotation(parseFloat(els.rotateInput.value) || 0, true);
    });
    els.rotateMinusBtn.addEventListener('click', () => setRotation(rotationOf(deps.getKiln()) - ROTATION_STEP_DEG, false));
    els.rotatePlusBtn.addEventListener('click', () => setRotation(rotationOf(deps.getKiln()) + ROTATION_STEP_DEG, false));
    els.rotateResetBtn.addEventListener('click', () => setRotation(0, false));
  }

  bindEvents();

  return {
    scheduleDraw,
    cancelGesture,
    setEditable,
    isEditable,
    currentView,
    setSamples,
    updatePreview
  };
}
