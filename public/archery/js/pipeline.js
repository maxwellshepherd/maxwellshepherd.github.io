// On-device archery scoring pipeline. Mirrors archery_v2/{geometry,locator,refine,decode}.py
// step for step; the Python package is the reference implementation.

export const RING_RADII_MM = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200];
export const TARGET_RADIUS_MM = 200;
export const ARROW_DIAMETER_MM = 4.5; // default shaft diameter for the line-cutter rule
const EXTRAPOLATE_MM = 300;
const TAU = 2 * Math.PI;

// ----------------------------------------------------------------------------- small numerics
function gaussKernel(sigma, truncate = 3.0) {
  const r = Math.floor(truncate * sigma + 0.5);
  const k = new Float64Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += (k[i + r] = Math.exp(-0.5 * (i * i) / (sigma * sigma)));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

// 1-D Gaussian over a strided view; mode 'wrap' or 'nearest' (scipy.ndimage semantics).
function gauss1d(src, n, sigma, mode, get, set) {
  const k = gaussKernel(sigma), r = (k.length - 1) / 2;
  const tmp = new Float64Array(n);
  for (let i = 0; i < n; i++) tmp[i] = get(i);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) {
      let q = i + j;
      if (mode === 'wrap') q = ((q % n) + n) % n;
      else q = q < 0 ? 0 : q >= n ? n - 1 : q;
      acc += k[j + r] * tmp[q];
    }
    set(i, acc);
  }
}

function gaussWrap1d(arr, sigma) {
  const out = Float64Array.from(arr);
  gauss1d(null, arr.length, sigma, 'wrap', (i) => arr[i], (i, v) => (out[i] = v));
  return out;
}

function median(a) {
  const s = Float64Array.from(a).sort();
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

function nanMedian(a) {
  const v = a.filter((x) => Number.isFinite(x));
  return v.length ? median(v) : NaN;
}

// np.interp(x, xp, fp, period=P) for x on integer grid 0..n-1 (xp sorted, within [0,P)).
function periodicInterp(xq, xp, fp, period) {
  const m = xp.length;
  const out = new Float64Array(xq.length);
  // extended arrays with wrap-around neighbours
  const X = new Float64Array(m + 2), F = new Float64Array(m + 2);
  X[0] = xp[m - 1] - period; F[0] = fp[m - 1];
  for (let i = 0; i < m; i++) { X[i + 1] = xp[i]; F[i + 1] = fp[i]; }
  X[m + 1] = xp[0] + period; F[m + 1] = fp[0];
  let j = 0;
  for (let i = 0; i < xq.length; i++) {
    const x = ((xq[i] % period) + period) % period;
    while (j < m && X[j + 1] < x) j++;
    while (j > 0 && X[j] > x) j--;
    const t = (x - X[j]) / Math.max(X[j + 1] - X[j], 1e-12);
    out[i] = F[j] + t * (F[j + 1] - F[j]);
  }
  return out;
}

function fillPeriodic(row) {
  const n = row.length, xp = [], fp = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(row[i])) { xp.push(i); fp.push(row[i]); }
  const idx = new Float64Array(n).map((_, i) => i);
  return periodicInterp(idx, xp, fp, n);
}

// ----------------------------------------------------------------------------- geometry
export class Geometry {
  // center [x,y] (full-res photo px); radiiMm (K); profile: K rows of N angles (source px)
  constructor(center, radiiMm, profile) {
    this.center = center;
    this.radiiMm = Float64Array.from(radiiMm);
    this.profile = profile.map((r) => Float64Array.from(r));
    this.K = this.radiiMm.length;
    this.N = this.profile[0].length;
    this._col = new Float64Array(this.K);
  }

  static fromRingProfiles(center, rings) {
    const n = rings[0].length;
    const prof = [new Float64Array(n), ...rings.map((r) => Float64Array.from(r))];
    prof.push(Float64Array.from(rings[9], (v) => (EXTRAPOLATE_MM * v) / TARGET_RADIUS_MM));
    return new Geometry(center, [0, ...RING_RADII_MM, EXTRAPOLATE_MM], prof);
  }

  toJSON() {
    return { center: this.center, radii_mm: Array.from(this.radiiMm), profile_px: this.profile.map((r) => Array.from(r)) };
  }

  _column(theta) {
    const n = this.N;
    let f = ((theta % TAU) + TAU) % TAU / TAU * n;
    const fl = Math.floor(f);
    const i0 = ((fl % n) + n) % n, i1 = (i0 + 1) % n, w = f - fl;
    for (let k = 0; k < this.K; k++) this._col[k] = (1 - w) * this.profile[k][i0] + w * this.profile[k][i1];
    return this._col;
  }

  // Hot path (warp, ring sampling): interpolate only the two ring rows bracketing r.
  canonicalToSource(xmm, ymm) {
    const r = Math.hypot(xmm, ymm), th = Math.atan2(ymm, xmm);
    const rad = this.radiiMm, n = this.N;
    let lo = 0, hi = this.K - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rad[m] <= r) lo = m; else hi = m - 1; }
    const f = ((th % TAU) + TAU) % TAU / TAU * n, fl = Math.floor(f);
    const i0 = ((fl % n) + n) % n, i1 = (i0 + 1) % n, w = f - fl;
    const a = this.profile[lo], b = this.profile[lo + 1];
    const p0 = (1 - w) * a[i0] + w * a[i1], p1 = (1 - w) * b[i0] + w * b[i1];
    const rho = p0 + ((r - rad[lo]) / Math.max(rad[lo + 1] - rad[lo], 1e-9)) * (p1 - p0);
    if (r === 0) return [this.center[0], this.center[1]];
    return [this.center[0] + rho * (xmm / r), this.center[1] + rho * (ymm / r)];
  }

  sourceToCanonical(x, y) {
    const dx = x - this.center[0], dy = y - this.center[1];
    const rho = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    const r = interpExtrap(rho, this._column(th), this.radiiMm);
    return [r * Math.cos(th), r * Math.sin(th)];
  }

  medianOuterRadius() { return median(this.profile[this.K - 2]); }

  translated(dx, dy) { return new Geometry([this.center[0] + dx, this.center[1] + dy], this.radiiMm, this.profile); }
}

// Linear interpolation with linear extrapolation at both ends (matches _interp_rows).
function interpExtrap(x, xp, fp) {
  const k = xp.length;
  let idx = -1;
  for (let i = 0; i < k; i++) if (xp[i] <= x) idx = i;
  idx = Math.min(Math.max(idx, 0), k - 2);
  const x0 = xp[idx], x1 = xp[idx + 1];
  const t = (x - x0) / Math.max(x1 - x0, 1e-9);
  return fp[idx] + t * (fp[idx + 1] - fp[idx]);
}

export function scoreForRadius(rmm, arrowRadiusMm = ARROW_DIAMETER_MM / 2) {
  const eff = rmm - arrowRadiusMm;
  if (eff > TARGET_RADIUS_MM) return 0;
  return 10 - Math.min(Math.max(Math.ceil(eff / 20) - 1, 0), 9);
}

// ----------------------------------------------------------------------------- image helpers
// RGBA ImageData-like {data, width, height} -> Float32 NCHW (0..255)
export function toNCHW(img) {
  const { data, width: w, height: h } = img;
  const out = new Float32Array(3 * w * h), plane = w * h;
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    out[i] = data[p]; out[plane + i] = data[p + 1]; out[2 * plane + i] = data[p + 2];
  }
  return out;
}

// Bilinear RGB sample, half-pixel coords, edge clamped (refine.bilinear).
function sampleRGB(img, x, y, out) {
  const { data, width: w, height: h } = img;
  x = Math.min(Math.max(x - 0.5, 0), w - 1.0001);
  y = Math.min(Math.max(y - 0.5, 0), h - 1.0001);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const p00 = 4 * (y0 * w + x0), p01 = p00 + 4, p10 = p00 + 4 * w, p11 = p10 + 4;
  for (let c = 0; c < 3; c++) {
    out[c] = (1 - fx) * (1 - fy) * data[p00 + c] + fx * (1 - fy) * data[p01 + c]
      + (1 - fx) * fy * data[p10 + c] + fx * fy * data[p11 + c];
  }
  return out;
}

function lin(v) { // sRGB 0..255 -> linear
  const c = v / 255;
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}
function labF(t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; }
export function rgbToLab(r, g, b, out) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const fx = labF(X), fy = labF(Y), fz = labF(Z);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
  return out;
}

// ----------------------------------------------------------------------------- stage A readout
const LOC_R_NORM = 100;
const LOC_FAIL_MM = 30; // field minimum above this = no target in view
export const ZOOM_BELOW = 0.30; // zoom-in pass when the 200 mm ring radius < this fraction of the frame
export const ZOOM_MARGIN = 1.3; // crop half-size in units of the 200 mm ring radius

function bilinearField(f, w, h, x, y) {
  x = Math.min(Math.max(x - 0.5, 0), w - 1.001);
  y = Math.min(Math.max(y - 0.5, 0), h - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  return (1 - fx) * (1 - fy) * f[i] + fx * (1 - fy) * f[i + 1] + (1 - fx) * fy * f[i + w] + fx * fy * f[i + w + 1];
}

function rayCrossings(f, w, h, c, levels, nAngles, step, maxLen) {
  const T = Math.ceil(maxLen / step);
  const out = levels.map(() => new Float64Array(nAngles).fill(NaN));
  const vals = new Float64Array(T);
  for (let a = 0; a < nAngles; a++) {
    const ang = a * (TAU / nAngles), ca = Math.cos(ang), sa = Math.sin(ang);
    let run = -Infinity;
    for (let j = 0; j < T; j++) {
      const t = j * step, x = c[0] + ca * t, y = c[1] + sa * t;
      const inside = x >= 0 && x <= w && y >= 0 && y <= h;
      const v = inside ? bilinearField(f, w, h, x, y) : Infinity;
      run = Math.max(run, v);
      vals[j] = run;
    }
    levels.forEach((lv, li) => {
      let j = 0;
      while (j < T && !(vals[j] >= lv)) j++;
      if (j >= T || j === 0) return;
      const v0 = vals[j - 1], v1 = vals[j];
      if (!Number.isFinite(v1)) return;
      const frac = Math.min(Math.max((lv - v0) / Math.max(v1 - v0, 1e-6), 0), 1);
      out[li][a] = (j - 1) * step + frac * step;
    });
  }
  return out;
}

function smoothCircular(rows, sigma, k = 7) {
  const out = [];
  for (const row of rows) {
    const n = row.length;
    let good = 0;
    for (const v of row) if (Number.isFinite(v)) good++;
    if (good < n * 0.5) return null;
    const filled = fillPeriodic(row);
    const med = new Float64Array(n), win = new Float64Array(2 * k + 1);
    for (let i = 0; i < n; i++) {
      for (let j = -k; j <= k; j++) win[j + k] = filled[(((i + j) % n) + n) % n];
      med[i] = median(win);
    }
    out.push(gaussWrap1d(med, sigma));
  }
  return out;
}

export function fieldToGeometry(fieldRaw, w, h, scale, nAngles = 360, smooth = 2.0) {
  const field = Float64Array.from(fieldRaw, (v) => v * LOC_R_NORM);
  // blur for a stable argmin (scipy gaussian_filter, sigma 1, nearest)
  const blur = Float64Array.from(field);
  for (let y = 0; y < h; y++) gauss1d(null, w, 1.0, 'nearest', (i) => blur[y * w + i], (i, v) => (blur[y * w + i] = v));
  for (let x = 0; x < w; x++) gauss1d(null, h, 1.0, 'nearest', (i) => blur[i * w + x], (i, v) => (blur[i * w + x] = v));
  let best = 0;
  for (let i = 1; i < blur.length; i++) if (blur[i] < blur[best]) best = i;
  const rmin = blur[best];
  if (rmin > LOC_FAIL_MM) return { geom: null, reason: `no target centre found (min r ${rmin.toFixed(0)} mm)` };
  let c = [(best % w) + 0.5, Math.floor(best / w) + 0.5];
  for (let it = 0; it < 3; it++) {
    const cr = rayCrossings(field, w, h, c, [8, 14], 90, 0.1, 40);
    let nan = 0, sx = 0, sy = 0, m = 0;
    cr.forEach((row) => row.forEach((d, a) => {
      if (!Number.isFinite(d)) { nan++; return; }
      const ang = a * (TAU / 90);
      sx += c[0] + d * Math.cos(ang); sy += c[1] + d * Math.sin(ang); m++;
    }));
    if (nan / 180 > 0.2) break;
    c = [sx / m, sy / m];
  }
  const rings = rayCrossings(field, w, h, c, RING_RADII_MM, nAngles, 0.25, Math.hypot(h, w));
  const sm = smoothCircular(rings, smooth);
  if (!sm) return { geom: null, reason: 'outer rings not visible — fit the whole target face in the photo' };
  for (let a = 0; a < nAngles; a++) {
    let run = 0;
    for (let k = 0; k < sm.length; k++) { run = Math.max(run, Math.max(sm[k][a], 1e-3)); sm[k][a] = run; }
  }
  const geom = Geometry.fromRingProfiles([c[0] / scale, c[1] / scale], sm.map((r) => r.map((v) => v / scale)));
  return { geom, rminMm: rmin };
}

// ----------------------------------------------------------------------------- refinement
const BOUNDARIES_MM = [40, 80, 120, 160];
const STEP_MM = 0.1;
export const WORK_MM_PER_PX = 0.2;

// img: downscaled photo {data,width,height}; scale: img px per full-res px
function polarLab(img, scale, geom, radii, nAngles) {
  const D = radii.length;
  const out = new Float64Array(nAngles * D * 3);
  const rgb = [0, 0, 0], lab = [0, 0, 0];
  for (let a = 0; a < nAngles; a++) {
    const th = a * (TAU / nAngles), ct = Math.cos(th), st = Math.sin(th);
    for (let j = 0; j < D; j++) {
      const p = geom.canonicalToSource(radii[j] * ct, radii[j] * st);
      sampleRGB(img, p[0] * scale, p[1] * scale, rgb);
      rgbToLab(rgb[0], rgb[1], rgb[2], lab);
      const o = 3 * (a * D + j);
      out[o] = lab[0]; out[o + 1] = lab[1]; out[o + 2] = lab[2];
    }
  }
  return out;
}

function smooth2d(f, A, D, sigA, sigR) {
  for (let j = 0; j < D; j++) gauss1d(null, A, sigA, 'wrap', (i) => f[i * D + j], (i, v) => (f[i * D + j] = v));
  for (let a = 0; a < A; a++) gauss1d(null, D, sigR, 'nearest', (i) => f[a * D + i], (i, v) => (f[a * D + i] = v));
}

function snapBoundary(img, scale, geom, rmm, nAngles, hw, minContrast = 0.45) {
  const n = Math.round((hw + 2.0) / STEP_MM), D = 2 * n + 1;
  const d = Float64Array.from({ length: D }, (_, i) => (i - n) * STEP_MM);
  const radii = d.map((v) => rmm + v);
  const lab = polarLab(img, scale, geom, radii, nAngles);
  const inner = [[], [], []], outer = [[], [], []];
  for (let a = 0; a < nAngles; a++) for (let j = 0; j < D; j++) {
    const o = 3 * (a * D + j);
    if (d[j] < -1.5) for (let c = 0; c < 3; c++) inner[c].push(lab[o + c]);
    else if (d[j] > 1.5) for (let c = 0; c < 3; c++) outer[c].push(lab[o + c]);
  }
  const mi = inner.map(median), mo = outer.map(median);
  const ax = [mo[0] - mi[0], mo[1] - mi[1], mo[2] - mi[2]];
  const nn = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
  const res = new Float64Array(nAngles).fill(NaN);
  if (Math.sqrt(nn) < 8.0) return res;
  const f = new Float64Array(nAngles * D);
  for (let i = 0; i < nAngles * D; i++) {
    const o = 3 * i;
    f[i] = ((lab[o] - mi[0]) * ax[0] + (lab[o + 1] - mi[1]) * ax[1] + (lab[o + 2] - mi[2]) * ax[2]) / nn;
  }
  smooth2d(f, nAngles, D, 0.6, 0.25 / STEP_MM);
  const k = Math.round(1.0 / STEP_MM), kh = Math.floor(k / 2);
  const g = new Float64Array(D), cs = new Float64Array(D + 1);
  for (let a = 0; a < nAngles; a++) {
    const row = a * D;
    for (let j = 0; j < D; j++) {
      const gj = j === 0 ? f[row + 1] - f[row] : j === D - 1 ? f[row + D - 1] - f[row + D - 2]
        : 0.5 * (f[row + j + 1] - f[row + j - 1]);
      g[j] = Math.abs(d[j]) > hw ? -1e9 : gj;
    }
    let jm = 0;
    for (let j = 1; j < D; j++) if (g[j] > g[jm]) jm = j;
    jm = Math.min(Math.max(jm, 1), D - 2);
    const l = g[jm - 1], c = g[jm], r = g[jm + 1], den = l - 2 * c + r;
    const off = den < -1e-9 ? Math.min(Math.max(0.5 * (l - r) / den, -0.5), 0.5) : 0;
    const jf = jm + off;
    cs[0] = 0;
    for (let j = 0; j < D; j++) cs[j + 1] = cs[j] + f[row + j];
    const ji = Math.round(jf);
    const clip = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const lo0 = clip(ji - 2 * k, 0, D), lo1 = clip(ji - kh, 1, D);
    const hi0 = clip(ji + kh, 0, D - 1), hi1 = clip(ji + 2 * k, 1, D);
    const lo = (cs[lo1] - cs[lo0]) / Math.max(lo1 - lo0, 1);
    const hi = (cs[hi1] - cs[hi0]) / Math.max(hi1 - hi0, 1);
    if (hi - lo > minContrast) res[a] = d[0] + jf * STEP_MM;
  }
  return res;
}

function cleanOffsets(off, k = 12, tol = 0.6, sigma = 2.0, minValid = 0.4) {
  const n = off.length;
  const frac = (v) => v.reduce((s, x) => s + (Number.isFinite(x) ? 1 : 0), 0) / n;
  if (frac(off) < minValid) return null;
  const win = new Float64Array(2 * k + 1), kept = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = -k; j <= k; j++) win[j + k] = off[(((i + j) % n) + n) % n];
    const m = nanMedian(win);
    kept[i] = Math.abs(off[i] - m) <= tol ? off[i] : NaN;
  }
  if (frac(kept) < minValid) return null;
  return gaussWrap1d(fillPeriodic(kept), sigma);
}

function geometryFromBoundaries(points, nAngles) {
  const radii = Object.keys(points).map(Number).sort((a, b) => a - b);
  const B = radii.length;
  // centre = intercept of centroid_k = c + beta * r_k^2
  let s1 = 0, sr = 0, srr = 0, sx = 0, sy = 0, sxr = 0, syr = 0;
  for (const r of radii) {
    const p = points[r];
    let mx = 0, my = 0;
    for (const q of p) { mx += q[0]; my += q[1]; }
    mx /= p.length; my /= p.length;
    const r2 = r * r;
    s1 += 1; sr += r2; srr += r2 * r2; sx += mx; sy += my; sxr += mx * r2; syr += my * r2;
  }
  const det = s1 * srr - sr * sr;
  const center = [(srr * sx - sr * sxr) / det, (srr * sy - sr * syr) / det];
  const phi = Float64Array.from({ length: nAngles }, (_, i) => i * (TAU / nAngles));
  const known = radii.map((r) => {
    const pts = points[r].map((q) => {
      const dx = q[0] - center[0], dy = q[1] - center[1];
      return [((Math.atan2(dy, dx) % TAU) + TAU) % TAU, Math.hypot(dx, dy)];
    }).sort((u, v) => u[0] - v[0]);
    return periodicInterp(phi, pts.map((q) => q[0]), pts.map((q) => q[1]), TAU);
  });
  const rings = RING_RADII_MM.map((rr) => {
    let hi = 0;
    while (hi < B && radii[hi] < rr) hi++;
    hi = Math.min(Math.max(hi, 1), B - 1);
    const lo = hi - 1, t = (rr - radii[lo]) / (radii[hi] - radii[lo]);
    return Float64Array.from(phi, (_, a) => known[lo][a] + t * (known[hi][a] - known[lo][a]));
  });
  return Geometry.fromRingProfiles(center, rings);
}

export function refineGeometry(img, scale, geom, nAngles = 360, widths = [4.0, 1.5]) {
  const used = [];
  for (const w of widths) {
    const pts = {};
    for (const r of BOUNDARIES_MM) {
      const off = cleanOffsets(snapBoundary(img, scale, geom, r, nAngles, w));
      if (!off) continue;
      pts[r] = Array.from(off, (o, a) => {
        const th = a * (TAU / nAngles), rr = r + o;
        return geom.canonicalToSource(rr * Math.cos(th), rr * Math.sin(th));
      });
    }
    used.push(Object.keys(pts).length);
    if (Object.keys(pts).length < 2) return { geom, refined: false, used };
    geom = geometryFromBoundaries(pts, nAngles);
  }
  return { geom, refined: true, used };
}

// ----------------------------------------------------------------------------- canonical warp
// img: photo downscaled by `scale` (img px per full-res px). Output RGBA ImageData-like.
export function warpCanonical(img, scale, geom, size, extentMm = TARGET_RADIUS_MM) {
  const { data: src, width: w, height: h } = img;
  const out = new Uint8ClampedArray(size * size * 4);
  const step = (2 * extentMm) / size;
  for (let j = 0; j < size; j++) {
    const ymm = (j + 0.5) * step - extentMm;
    for (let i = 0; i < size; i++) {
      const xmm = (i + 0.5) * step - extentMm;
      const p = geom.canonicalToSource(xmm, ymm);
      // OpenCV remap convention (integer pixel centres), BORDER_CONSTANT = 0
      const x = (p[0] + 0.5) * scale - 0.5, y = (p[1] + 0.5) * scale - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const o = 4 * (j * size + i);
      out[o + 3] = 255;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const xx = x0 + dx, yy = y0 + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          acc += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * src[4 * (yy * w + xx) + c];
        }
        out[o + c] = acc;
      }
    }
  }
  return { data: out, width: size, height: size };
}

// ----------------------------------------------------------------------------- decoding
// logits: Float32 (H*W). Returns peaks [{x, y (map coords), conf}] sorted by confidence.
export function findPeaks(logits, w, h, threshold) {
  const prob = new Float32Array(w * h);
  for (let i = 0; i < prob.length; i++) prob[i] = 1 / (1 + Math.exp(-logits[i]));
  const at = (x, y) => prob[Math.min(Math.max(y, 0), h - 1) * w + Math.min(Math.max(x, 0), w - 1)];
  const lp = (x, y) => Math.log(Math.min(Math.max(at(x, y), 1e-6), 1));
  const peaks = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = prob[y * w + x];
    if (v < threshold) continue;
    let isMax = true;
    for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      const nb = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : prob[yy * w + xx];
      if (nb > v) { isMax = false; break; }
    }
    if (!isMax) continue;
    const c = lp(x, y);
    const q = (a, b) => { const den = a - 2 * c + b; return den < -1e-6 ? Math.min(Math.max(0.5 * (a - b) / den, -0.5), 0.5) : 0; };
    peaks.push({ x: x + 0.5 + q(lp(x - 1, y), lp(x + 1, y)), y: y + 0.5 + q(lp(x, y - 1), lp(x, y + 1)), conf: v });
  }
  peaks.sort((a, b) => b.conf - a.conf);
  return { peaks, prob };
}
