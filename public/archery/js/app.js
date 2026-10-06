import * as ort from '../vendor/ort.all.min.mjs';
import {
  RING_RADII_MM, WORK_MM_PER_PX, ZOOM_BELOW, ZOOM_MARGIN, fieldToGeometry, findPeaks, refineGeometry,
  ARROW_DIAMETER_MM, scoreForRadius, toNCHW, warpCanonical,
} from './pipeline.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const CANDIDATE_THRESHOLD = 0.1; // peaks kept for the live threshold slider

const state = {
  cfg: null, loc: null, det: null, backend: '',
  bitmap: null, display: null, W: 0, H: 0,
  geom: null, canon: null, canonCanvas: null, heatCanvas: null,
  arrows: [], thr: 0.3, arrowDia: ARROW_DIAMETER_MM, mode: 'photo', editing: false,
  view: { s: 1, tx: 0, ty: 0 }, timings: {}, name: '',
};

// ----------------------------------------------------------------------------- models
// Use WebGPU only on a hardware adapter: software fallbacks (SwiftShader, llvmpipe) are far
// slower than multi-threaded WASM.
async function hardwareWebGPU() {
  if (!navigator.gpu) return false;
  try {
    const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!ad || ad.isFallbackAdapter || ad.info?.isFallbackAdapter) return false;
    const desc = `${ad.info?.vendor || ''} ${ad.info?.architecture || ''} ${ad.info?.description || ''}`;
    return !/swiftshader|llvmpipe|software|microsoft basic/i.test(desc);
  } catch (_) { return false; }
}

async function loadModels() {
  const cfg = await (await fetch('models/config.json')).json();
  state.cfg = cfg;
  state.thr = cfg.threshold;
  $('thr').value = cfg.threshold;
  $('thr-out').textContent = cfg.threshold.toFixed(2);
  ort.env.wasm.wasmPaths = new URL('../vendor/', import.meta.url).href;
  const threads = Number(params.get('threads')) || (self.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1);
  ort.env.wasm.numThreads = threads;
  const forced = params.get('ep');
  const eps = forced ? [forced] : [...((await hardwareWebGPU()) ? ['webgpu'] : []), 'wasm'];
  let lastErr;
  for (const ep of eps) {
    try {
      // WebGPU runs the fp32 detector; CPU/WASM runs the int8 one (same accuracy, ~3.4x smaller).
      const q = ep === 'wasm' && cfg.detector_int8 && params.get('precision') !== 'fp32';
      const opt = { executionProviders: [ep], graphOptimizationLevel: 'all' };
      const [loc, det] = await Promise.all([
        ort.InferenceSession.create(`models/${cfg.locator}`, opt),
        ort.InferenceSession.create(`models/${q ? cfg.detector_int8 : cfg.detector}`, opt),
      ]);
      Object.assign(state, { loc, det, backend: ep, precision: q ? 'int8' : 'fp32' });
      break;
    } catch (e) { lastErr = e; console.warn(`EP ${ep} failed`, e); }
  }
  if (!state.det) throw lastErr;
  const label = state.backend === 'webgpu' ? 'WebGPU' : `WASM ${state.precision} · ${threads} thread${threads > 1 ? 's' : ''}`;
  $('engine').textContent = `ready · ${label}`;
  $('engine').className = 'chip ok';
  $('device').textContent = `${label} · ${navigator.hardwareConcurrency || '?'} cores`;
}

// ----------------------------------------------------------------------------- imaging
function canvas2d(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

// High-quality downscale by repeated halving (approximates area averaging on every browser).
function rasterize(src, w, h, padW = w, padH = h) {
  let cur = src, cw = src.width, ch = src.height;
  while (cw / 2 >= w * 1.0001 && ch / 2 >= h) {
    const nw = Math.max(Math.round(cw / 2), w), nh = Math.max(Math.round(ch / 2), h);
    const [c, ctx] = canvas2d(nw, nh);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, nw, nh);
    cur = c; cw = nw; ch = nh;
  }
  const [c, ctx] = canvas2d(padW, padH);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, padW, padH);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  return ctx.getImageData(0, 0, padW, padH);
}

async function decode(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) {
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    return await createImageBitmap(img);
  }
}

// Let the UI paint between stages; capped so background tabs (throttled rAF) don't inflate timings.
const nextFrame = () => new Promise((r) => {
  const ch = new MessageChannel(), done = () => { clearTimeout(t); r(); };
  const t = setTimeout(() => { ch.port1.onmessage = done; ch.port2.postMessage(0); }, 40);
  requestAnimationFrame(() => setTimeout(done, 0));
});

// ----------------------------------------------------------------------------- pipeline
const STAGES = [
  ['locator', 'Find target + rings (radius-field CNN)'],
  ['refine', 'Sub-pixel ring snapping'],
  ['warp', 'Metric rectification'],
  ['detector', 'Hole detector CNN'],
  ['decode', 'Peaks + scoring'],
];

function renderStages(active) {
  const li = STAGES.map(([k, label]) => {
    const t = state.timings[k];
    const cls = t != null ? 'done' : k === active ? 'run' : '';
    return `<li class="${cls}"><span>${label}</span><b>${t != null ? `${t.toFixed(0)} ms` : k === active ? '…' : ''}</b></li>`;
  });
  if (state.timings.total != null) li.push(`<li class="total"><span>Total on this device</span><b>${(state.timings.total / 1000).toFixed(2)} s</b></li>`);
  $('stages').innerHTML = li.join('');
}

async function analyze(bitmap, name) {
  const { cfg } = state;
  state.timings = {};
  state.name = name;
  setBusy('Finding the target…');
  const W = bitmap.width, H = bitmap.height;
  let t0 = performance.now(), tStart = t0;
  const lap = async (k, nextLabel, nextKey) => {
    const now = performance.now();
    state.timings[k] = now - t0;
    renderStages(nextKey);
    if (nextLabel) setBusy(nextLabel);
    await nextFrame();
    t0 = performance.now();
  };
  renderStages('locator');
  await nextFrame(); t0 = performance.now(); tStart = t0;

  // Stage A: radius field on a 512 px letterbox, plus a zoom-in pass for distant faces
  const L = cfg.locator_input;
  const locate = async (img, w, h) => {
    const s = L / Math.max(w, h);
    const lb = rasterize(img, Math.round(w * s), Math.round(h * s), L, L);
    const out = await state.loc.run({ image: new ort.Tensor('float32', toNCHW(lb), [1, 3, L, L]) });
    return fieldToGeometry(await out.field.getData(), L / 2, L / 2, s / 2);
  };
  let g0 = await locate(bitmap, W, H);
  if (!g0.geom) throw new Error(g0.reason);
  const R = g0.geom.medianOuterRadius();
  if (R / Math.max(W, H) < ZOOM_BELOW) {
    const half = Math.round(ZOOM_MARGIN * R);
    const x0 = Math.round(g0.geom.center[0]) - half, y0 = Math.round(g0.geom.center[1]) - half;
    const [cc, cctx] = canvas2d(2 * half, 2 * half);
    cctx.fillStyle = '#000'; cctx.fillRect(0, 0, 2 * half, 2 * half);
    cctx.drawImage(bitmap, -x0, -y0);
    const g1 = await locate(cc, 2 * half, 2 * half);
    if (g1.geom) g0 = { ...g1, geom: g1.geom.translated(x0, y0) };
  }
  await lap('locator', 'Snapping rings to sub-pixel…', 'refine');

  // Stage A': sub-pixel colour-boundary snapping at ~0.2 mm/px
  const fullMmPx = 200 / g0.geom.medianOuterRadius();
  const rs = Math.min(1, fullMmPx / WORK_MM_PER_PX);
  const rimg = rasterize(bitmap, Math.round(W * rs), Math.round(H * rs));
  const { geom } = refineGeometry(rimg, rimg.width / W, g0.geom);
  state.geom = geom;
  await lap('refine', 'Rectifying…', 'warp');

  // Stage B: metric canonical warp (prefiltered) + detector
  const S = cfg.canon_size, E = cfg.extent_mm;
  const ratio = (geom.medianOuterRadius() / 200) * ((2 * E) / S);
  const ws = ratio > 1.25 ? 1 / ratio : 1;
  const wimg = rasterize(bitmap, Math.round(W * ws), Math.round(H * ws));
  const canon = warpCanonical(wimg, wimg.width / W, geom, S, E);
  state.canon = canon;
  await lap('warp', 'Detecting arrow holes…', 'detector');

  const heatOut = await state.det.run({ image: new ort.Tensor('float32', toNCHW(canon), [1, 3, S, S]) });
  const logits = await heatOut.heat.getData();
  const [, , hh, hw] = heatOut.heat.dims;
  await lap('detector', 'Scoring…', 'decode');

  const { peaks, prob } = findPeaks(logits, hw, hh, CANDIDATE_THRESHOLD);
  const mmPerCell = (2 * E) / hw;
  state.arrows = peaks.map((p) => ({ xmm: p.x * mmPerCell - E, ymm: p.y * mmPerCell - E, conf: p.conf, manual: false, removed: false }));
  state.arrows.forEach(attachSource);
  buildCanvases(canon, prob, hw, hh);
  state.timings.decode = performance.now() - t0;
  state.timings.total = performance.now() - tStart;
  renderStages();
}

function attachSource(a) {
  const p = state.geom.canonicalToSource(a.xmm, a.ymm);
  a.sx = p[0]; a.sy = p[1];
  a.r = Math.hypot(a.xmm, a.ymm);
  a.score = scoreForRadius(a.r, state.arrowDia / 2);
  a.x = a.r - state.arrowDia / 2 <= 10; // inner-10 (X) by the same line-cutting rule
}

function buildCanvases(canon, prob, hw, hh) {
  const [cc, cctx] = canvas2d(canon.width, canon.height);
  cctx.putImageData(new ImageData(canon.data, canon.width, canon.height), 0, 0);
  state.canonCanvas = cc;
  const [hc, hctx] = canvas2d(hw, hh);
  const im = hctx.createImageData(hw, hh);
  for (let i = 0; i < prob.length; i++) {
    const v = prob[i];
    const [r, g, b] = inferno(v);
    im.data[4 * i] = r; im.data[4 * i + 1] = g; im.data[4 * i + 2] = b;
    im.data[4 * i + 3] = 150 + 105 * Math.sqrt(v); // dim the photo, let detections glow
  }
  hctx.putImageData(im, 0, 0);
  state.heatCanvas = hc;
}

function inferno(t) {
  const stops = [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]];
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), f = x - i;
  return stops[i].map((v, k) => v + f * (stops[i + 1][k] - v));
}

// ----------------------------------------------------------------------------- display
const RING_FILL = { 10: '#f5d33f', 9: '#f5d33f', 8: '#e0453a', 7: '#e0453a', 6: '#3d8bd6', 5: '#3d8bd6', 4: '#222', 3: '#222', 2: '#f0f0f0', 1: '#f0f0f0', 0: '#777' };

function visibleArrows() { return state.arrows.filter((a) => a.manual || (!a.removed && a.conf >= state.thr)); }

function worldSize() {
  return state.mode === 'photo' ? [state.W, state.H] : [state.cfg.canon_size, state.cfg.canon_size];
}

function toWorld(a) {
  if (state.mode === 'photo') return [a.sx, a.sy];
  const k = state.cfg.canon_size / (2 * state.cfg.extent_mm);
  return [(a.xmm + state.cfg.extent_mm) * k, (a.ymm + state.cfg.extent_mm) * k];
}

function worldToMm(x, y) {
  if (state.mode === 'photo') return state.geom.sourceToCanonical(x, y);
  const k = (2 * state.cfg.extent_mm) / state.cfg.canon_size;
  return [x * k - state.cfg.extent_mm, y * k - state.cfg.extent_mm];
}

function pxPerMm() {
  return state.mode === 'photo' ? state.geom.medianOuterRadius() / 200 : state.cfg.canon_size / (2 * state.cfg.extent_mm);
}

function fit() {
  const cv = $('view'), dpr = devicePixelRatio || 1;
  const cw = cv.clientWidth * dpr, ch = cv.clientHeight * dpr;
  let [x0, y0, x1, y1] = [0, 0, ...worldSize()];
  if (state.mode === 'photo' && state.geom) { // frame the target face (outer ring bbox + margin)
    [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 72; i++) {
      const th = (i / 72) * 2 * Math.PI, p = state.geom.canonicalToSource(215 * Math.cos(th), 215 * Math.sin(th));
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
  }
  const s = Math.min(cw / (x1 - x0), ch / (y1 - y0));
  state.view = { s, tx: (cw - s * (x0 + x1)) / 2, ty: (ch - s * (y0 + y1)) / 2 };
  draw();
}

function draw() {
  const cv = $('view'), dpr = devicePixelRatio || 1;
  const cw = Math.round(cv.clientWidth * dpr), ch = Math.round(cv.clientHeight * dpr);
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0c10'; ctx.fillRect(0, 0, cw, ch);
  if (!state.geom) return;
  const { s, tx, ty } = state.view;
  ctx.setTransform(s, 0, 0, s, tx, ty);
  ctx.imageSmoothingQuality = 'high';
  if (state.mode === 'photo') ctx.drawImage(state.display, 0, 0, state.W, state.H);
  else {
    ctx.drawImage(state.canonCanvas, 0, 0);
    if (state.mode === 'heat') {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(state.heatCanvas, 0, 0, state.cfg.canon_size, state.cfg.canon_size);
      ctx.globalAlpha = 1;
    }
  }
  // rings
  ctx.lineWidth = 1.2 / s;
  for (const r of RING_RADII_MM) {
    ctx.strokeStyle = r === 200 ? 'rgba(80,255,160,.9)' : 'rgba(80,255,160,.55)';
    ctx.beginPath();
    if (state.mode === 'photo') {
      for (let i = 0; i <= 180; i++) {
        const th = (i / 180) * 2 * Math.PI, p = state.geom.canonicalToSource(r * Math.cos(th), r * Math.sin(th));
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      }
    } else {
      const k = pxPerMm(), c = state.cfg.canon_size / 2;
      ctx.arc(c, c, r * k, 0, 2 * Math.PI);
    }
    ctx.stroke();
  }
  // arrows
  const rad = Math.max(state.arrowDia / 2 * pxPerMm(), 4 / s);
  const showLabel = rad * s > 9;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.max(rad * 1.05, 6 / s)}px system-ui`;
  for (const a of state.mode === 'heat' ? [] : visibleArrows()) {
    const [x, y] = toWorld(a);
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 2 * Math.PI);
    ctx.fillStyle = RING_FILL[a.score] + 'cc';
    ctx.fill();
    ctx.lineWidth = Math.max(1.8 / s, rad * 0.18);
    ctx.setLineDash(a.manual ? [4 / s, 3 / s] : []);
    ctx.strokeStyle = a.score >= 3 && a.score <= 4 ? '#fff' : '#000';
    ctx.stroke();
    ctx.setLineDash([]);
    if (showLabel) {
      ctx.fillStyle = a.score <= 4 && a.score >= 3 ? '#fff' : '#000';
      ctx.fillText(a.x ? 'X' : a.score === 0 ? 'M' : String(a.score), x, y + rad * 0.05);
    }
  }
}

// ----------------------------------------------------------------------------- stats
function updateStats() {
  const arr = visibleArrows();
  const total = arr.reduce((t, a) => t + a.score, 0);
  $('total').textContent = arr.length ? total : '–';
  $('n-arrows').textContent = arr.length;
  $('avg').textContent = arr.length ? (total / arr.length).toFixed(2) : '–';
  $('n-x').textContent = arr.filter((a) => a.x).length;
  const cats = ['X', 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 'M'];
  const counts = cats.map((c) => arr.filter((a) => (c === 'X' ? a.x : c === 'M' ? a.score === 0 : a.score === c && !a.x)).length);
  const mx = Math.max(1, ...counts);
  $('hist').innerHTML = cats.map((c, i) => {
    const col = c === 'X' ? '#fff2a8' : c === 'M' ? '#777' : RING_FILL[c] === '#222' ? '#555' : RING_FILL[c];
    return `<div class="bar"><b>${counts[i] || ''}</b><i style="height:${(counts[i] / mx) * 62}px;background:${col}"></i>${c}</div>`;
  }).join('');
  drawGroup(arr);
  $('csv').disabled = $('json').disabled = !arr.length;
}

function drawGroup(arr) {
  const cv = $('group'), ctx = cv.getContext('2d'), N = cv.width, k = N / 2 / 205, c = N / 2;
  ctx.clearRect(0, 0, N, N);
  const zones = [[200, '#f0f0f0'], [160, '#222'], [120, '#3d8bd6'], [80, '#e0453a'], [40, '#f5d33f']];
  for (const [r, col] of zones) { ctx.beginPath(); ctx.arc(c, c, r * k, 0, 2 * Math.PI); ctx.fillStyle = col; ctx.fill(); }
  ctx.lineWidth = 1;
  for (const r of RING_RADII_MM) { ctx.beginPath(); ctx.arc(c, c, r * k, 0, 2 * Math.PI); ctx.strokeStyle = r > 120 && r <= 160 ? '#666' : 'rgba(0,0,0,.45)'; ctx.stroke(); }
  for (const a of arr) {
    ctx.beginPath(); ctx.arc(c + a.xmm * k, c + a.ymm * k, Math.max(state.arrowDia / 2 * k, 2.5), 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(20,20,20,.85)'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.stroke();
  }
  const st = $('group-stats');
  if (arr.length < 2) { st.innerHTML = ''; return; }
  const mx = arr.reduce((s, a) => s + a.xmm, 0) / arr.length, my = arr.reduce((s, a) => s + a.ymm, 0) / arr.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const a of arr) { sxx += (a.xmm - mx) ** 2; syy += (a.ymm - my) ** 2; sxy += (a.xmm - mx) * (a.ymm - my); }
  sxx /= arr.length - 1; syy /= arr.length - 1; sxy /= arr.length - 1;
  // 1-sigma covariance ellipse
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(tr * tr / 4 - det), l2 = tr / 2 - Math.sqrt(Math.max(tr * tr / 4 - det, 0));
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  ctx.save(); ctx.translate(c + mx * k, c + my * k); ctx.rotate(ang);
  ctx.beginPath(); ctx.ellipse(0, 0, Math.sqrt(l1) * k, Math.sqrt(Math.max(l2, 0)) * k, 0, 0, 2 * Math.PI);
  ctx.strokeStyle = '#7ee787'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore();
  ctx.strokeStyle = '#7ee787'; ctx.lineWidth = 2.5; ctx.beginPath();
  ctx.moveTo(c + mx * k - 9, c + my * k); ctx.lineTo(c + mx * k + 9, c + my * k);
  ctx.moveTo(c + mx * k, c + my * k - 9); ctx.lineTo(c + mx * k, c + my * k + 9); ctx.stroke();
  const d = arr.map((a) => Math.hypot(a.xmm - mx, a.ymm - my)).sort((a, b) => a - b);
  const r50 = d[Math.floor((d.length - 1) * 0.5)];
  const dir = `${Math.abs(mx).toFixed(1)} mm ${mx >= 0 ? 'right' : 'left'}, ${Math.abs(my).toFixed(1)} mm ${my >= 0 ? 'low' : 'high'}`;
  const meanR = arr.reduce((s, a) => s + a.r, 0) / arr.length;
  st.innerHTML = [
    ['Group centre', dir], ['Mean radius', `${meanR.toFixed(1)} mm`],
    ['R50 (from centre of group)', `${r50.toFixed(1)} mm`], ['σ horiz / vert', `${Math.sqrt(sxx).toFixed(1)} / ${Math.sqrt(syy).toFixed(1)} mm`],
  ].map(([k2, v]) => `<div><span>${k2}</span><b>${v}</b></div>`).join('');
}

// ----------------------------------------------------------------------------- interaction
function setBusy(text) {
  $('busy').classList.toggle('hidden', !text);
  if (text) $('busy-text').textContent = text;
}

async function run(blob, name) {
  try {
    if (!state.det) { setBusy('Loading models…'); await modelsReady; }
    setBusy('Decoding photo…');
    await nextFrame();
    const bitmap = await decode(blob);
    state.bitmap = bitmap; state.W = bitmap.width; state.H = bitmap.height;
    const ds = Math.min(1, 3000 / Math.max(state.W, state.H)); // display copy
    state.display = ds < 1 ? (() => { const im = rasterize(bitmap, Math.round(state.W * ds), Math.round(state.H * ds)); const [c, ctx] = canvas2d(im.width, im.height); ctx.putImageData(im, 0, 0); return c; })() : bitmap;
    state.geom = null;
    $('empty').classList.add('hidden');
    await analyze(bitmap, name);
    setBusy(null);
    fit();
    updateStats();
  } catch (e) {
    console.error(e);
    setBusy(null);
    $('empty').classList.remove('hidden');
    $('empty').querySelector('.big').textContent = `Couldn't score this photo: ${e.message || e}`;
    state.geom = null; draw();
  }
}

function hit(xmm, ymm) {
  const tol = Math.max(4.0, 10 / (state.view.s * pxPerMm()));
  let best = null, bd = tol;
  for (const a of visibleArrows()) {
    const d = Math.hypot(a.xmm - xmm, a.ymm - ymm);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

function setupViewer() {
  const cv = $('view'), pointers = new Map();
  let moved = false, pinch = null;
  const local = (e) => { const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId, local(e)); moved = false; });
  cv.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e), prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.5) moved = true;
      state.view.tx += p[0] - prev[0]; state.view.ty += p[1] - prev[1];
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (pinch) zoomAt(m, d / pinch.d, m[0] - pinch.m[0], m[1] - pinch.m[1]);
      pinch = { d, m }; moved = true;
    }
    draw();
  });
  const up = (e) => {
    if (pointers.size === 1 && !moved && state.editing && state.geom) {
      const [px, py] = local(e), { s, tx, ty } = state.view;
      const [xmm, ymm] = worldToMm((px - tx) / s, (py - ty) / s);
      const a = hit(xmm, ymm);
      if (a) { if (a.manual) state.arrows.splice(state.arrows.indexOf(a), 1); else a.removed = true; }
      else { const n = { xmm, ymm, conf: 1, manual: true, removed: false }; attachSource(n); state.arrows.push(n); }
      draw(); updateStats();
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(local(e), Math.exp(-e.deltaY * 0.0015)); draw(); }, { passive: false });
  new ResizeObserver(() => (state.geom ? fit() : draw())).observe(cv);
}

function zoomAt([x, y], f, dx = 0, dy = 0) {
  const v = state.view;
  v.tx = x - (x - v.tx) * f + dx; v.ty = y - (y - v.ty) * f + dy; v.s *= f;
}

// ----------------------------------------------------------------------------- paste
// Ctrl/⌘+V anywhere on the page, or the Paste buttons (async Clipboard API: needed on phones,
// where there is no paste shortcut). Text pastes (e.g. into the diameter box) pass through.
function pastedName(type) {
  const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return `pasted_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
}

function runPasted(blob) {
  if (!$('busy').classList.contains('hidden')) return toast('Still scoring the last photo…');
  run(blob, pastedName(blob.type));
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

const NO_IMAGE = 'No image on the clipboard. Copy the image itself (right-click → Copy image), not a link or file name.';

function setupPaste() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  $('paste-key').textContent = mac ? '⌘V' : 'Ctrl+V';
  document.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const item = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (item) { e.preventDefault(); runPasted(item.getAsFile()); return; }
    const inField = e.target.closest?.('input, textarea, [contenteditable]');
    if (!inField && items.length) toast(NO_IMAGE);
  });
  const buttons = document.querySelectorAll('.paste-btn');
  if (!navigator.clipboard?.read) { buttons.forEach((b) => b.classList.add('hidden')); return; }
  const pasteFromClipboard = async () => {
    try {
      for (const it of await navigator.clipboard.read()) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) return runPasted(await it.getType(type));
      }
      toast(NO_IMAGE);
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? `Clipboard access was blocked. Press ${$('paste-key').textContent} instead.` : NO_IMAGE);
    }
  };
  buttons.forEach((b) => b.addEventListener('click', pasteFromClipboard));
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
}

function setupControls() {
  const onFile = (e) => { const f = e.target.files[0]; if (f) run(f, f.name); e.target.value = ''; };
  $('file').addEventListener('change', onFile);
  $('file2').addEventListener('change', onFile);
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) run(f, f.name); });
  setupPaste();
  $('mode').addEventListener('click', (e) => {
    const m = e.target.dataset.mode; if (!m) return;
    state.mode = m;
    [...$('mode').children].forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (state.geom) fit();
  });
  $('edit').addEventListener('click', () => { state.editing = !state.editing; $('edit').classList.toggle('on', state.editing); drop.classList.toggle('editing', state.editing); });
  $('fit').addEventListener('click', () => state.geom && fit());
  $('bench').addEventListener('click', benchmark);
  $('thr').addEventListener('input', (e) => { state.thr = Number(e.target.value); $('thr-out').textContent = state.thr.toFixed(2); draw(); updateStats(); });
  $('dia').addEventListener('input', (e) => {
    const d = Number(e.target.value);
    if (!(d >= 1 && d <= 15)) return;
    state.arrowDia = d;
    state.arrows.forEach(attachSource);
    draw(); updateStats();
  });
  $('csv').addEventListener('click', () => {
    const rows = visibleArrows().map((a, i) => [i + 1, a.xmm.toFixed(2), a.ymm.toFixed(2), a.r.toFixed(2), a.x ? 'X' : a.score, a.conf.toFixed(3), a.sx.toFixed(1), a.sy.toFixed(1), a.manual ? 1 : 0].join(','));
    download(`${state.name || 'target'}_arrows.csv`, ['id,x_mm,y_mm,r_mm,score,confidence,photo_x,photo_y,manual', ...rows].join('\n'), 'text/csv');
  });
  $('json').addEventListener('click', () => {
    const arr = visibleArrows();
    download(`${state.name || 'target'}_result.json`, JSON.stringify({
      image: state.name, total: arr.reduce((t, a) => t + a.score, 0), threshold: state.thr, arrow_diameter_mm: state.arrowDia, timings_ms: state.timings, backend: state.backend,
      arrows: arr.map((a) => ({ x_mm: a.xmm, y_mm: a.ymm, r_mm: a.r, score: a.score, x: a.x, conf: a.conf, photo_x: a.sx, photo_y: a.sy, manual: a.manual })),
      geometry: state.geom.toJSON(),
    }, null, 1), 'application/json');
  });
}

async function benchmark() {
  const list = await (await fetch('samples/samples.json')).json();
  const runs = [];
  $('bench').disabled = true;
  for (let rep = 0; rep < 2; rep++) {
    for (const smp of list) {
      $('bench-out').textContent = `Benchmarking ${runs.length + 1}/${2 * list.length}…`;
      await run(await (await fetch(`samples/${smp.file}`)).blob(), smp.file);
      if (rep > 0 || list.length === 1) runs.push({ ...state.timings }); // first pass = warm-up
    }
  }
  const med = (k) => { const v = runs.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const rows = [...STAGES.map(([k, label]) => [label, `${med(k).toFixed(0)} ms`]), ['Median total', `${(med('total') / 1000).toFixed(2)} s`],
    ['Worst total', `${(Math.max(...runs.map((r) => r.total)) / 1000).toFixed(2)} s`]];
  $('bench-out').innerHTML = `<b>${state.backend === 'webgpu' ? 'WebGPU' : 'WASM'}</b> · ${runs.length} photos · ${navigator.userAgent.match(/\(([^)]+)\)/)?.[1] || ''}`
    + `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
  $('bench').disabled = false;
}

async function setupSamples() {
  try {
    const list = await (await fetch('samples/samples.json')).json();
    $('samples').innerHTML = '';
    for (const s of list) {
      const img = document.createElement('img');
      img.src = `samples/${s.thumb}`; img.title = s.title; img.alt = s.title;
      img.addEventListener('click', async () => {
        [...$('samples').children].forEach((x) => x.classList.toggle('on', x === img));
        run(await (await fetch(`samples/${s.file}`)).blob(), s.file);
      });
      $('samples').appendChild(img);
    }
  } catch (_) { document.querySelector('.samples').classList.add('hidden'); }
}

// Hook for automation / headless benchmarking.
window.__arrowscore = { run, state, ready: null };

setupViewer();
setupControls();
setupSamples();
renderStages();
const modelsReady = loadModels().catch((e) => { $('engine').textContent = `model load failed: ${e.message}`; $('engine').className = 'chip err'; throw e; });
window.__arrowscore.ready = modelsReady;
