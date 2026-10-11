import { Engine, TRACKS } from './engine.js';
import { Composer } from './composer.js';

const BASE = new URL('.', import.meta.url).href;
const CORE = ['piano', 'vln_sus', 'vla_sus', 'vc_sus', 'cb_sus'];
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let seed = parseInt(params.get('seed') || '', 10) || Math.floor(Math.random() * 1e9);

const FAMILY = (tr) => {
  if (tr.startsWith('~')) return 'syn';
  if (/vln|vla|vc_|basses/.test(tr)) return 'str';
  if (/horn|trump|tromb|tuba/.test(tr)) return 'brs';
  if (/clar|flut|bass/.test(tr)) return 'ww';
  if (/timp|perc/.test(tr)) return 'perc';
  return 'keys';
};
const COLORS = { str: [217, 178, 106], brs: [214, 112, 72], ww: [104, 190, 170], keys: [150, 180, 235], perc: [240, 236, 226], syn: [170, 130, 220] };

// ---------------------------------------------------------------------------
// live player
// ---------------------------------------------------------------------------
class Player {
  constructor() {
    this.ctx = null; this.engine = null; this.composer = null;
    this.queue = []; this.infos = []; this.base = 0; this.timer = null; this.running = false;
    this.notes = [];       // for the visualiser
  }
  async init(lite) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    this.engine = new Engine(this.ctx, { seed, lite });
    this.engine.onNote = (track, pitch, t, dur, dyn) => this.notes.push({ fam: FAMILY(track), pitch, t, dur, dyn });
    setStatus('Loading the orchestra…'); showBar(true);
    await this.engine.load(BASE, (d, n) => setFill(d / n), CORE);
    this.engine.build();
    // remaining sections load while the opening plays
    this.restLoading = this.engine.load(BASE, (d, n) => { setFill(d / n); if (d === n) showBar(false); })
      .then(() => { this.loaded = true; }).catch((e) => { console.warn(e); this.loaded = true; showBar(false); });
  }
  start() {
    this.composer = new Composer(seed);
    this.queue = []; this.infos = [];
    this.base = this.ctx.currentTime + 0.4;
    this.running = true;
    this.engine.volume.gain.setValueAtTime(+$('volume').value, this.ctx.currentTime);
    this.tick();
    this.timer = setInterval(() => this.tick(), 80);
  }
  tick() {
    const now = this.ctx.currentTime;
    // keep ~20 s of composed music ahead of the playhead
    while (!this.infos.length || this.infos[this.infos.length - 1].t1 + this.base < now + 20) {
      const { events, info } = this.composer.next();
      for (const e of events) {
        if (e.t !== undefined) e.t += this.base;
        if (e.t0 !== undefined) { e.t0 += this.base; e.t1 += this.base; }
        this.queue.push(e);
      }
      info.t0 += this.base; info.t1 += this.base; for (const c of info.chords) c.t += this.base;
      this.infos.push(info);
      this.queue.sort((a, b) => (a.t ?? a.t0) - (b.t ?? b.t0));
    }
    const horizon = now + (document.hidden ? 4 : 1.6);
    let i = 0;
    while (i < this.queue.length && (this.queue[i].t ?? this.queue[i].t0) < horizon) {
      const e = this.queue[i++];
      if (e.type === 'note' && !this.loaded && !this.engine.inst[TRACKS[e.track].inst]) continue;   // still loading
      try { this.engine.play(e); } catch (err) { console.warn(err); }
    }
    this.queue.splice(0, i);
    while (this.infos.length > 1 && this.infos[0].t1 < now - 5) this.infos.shift();
    updateNow(this);
  }
  async pause() { this.running = false; await this.ctx.suspend(); }
  async resume() { this.running = true; await this.ctx.resume(); }
  async restart(newSeed) {
    clearInterval(this.timer);
    const v = this.engine.volume.gain, now = this.ctx.currentTime;
    v.setValueAtTime(v.value, now); v.linearRampToValueAtTime(0, now + 1.2);
    await new Promise((r) => setTimeout(r, 1300));
    // detach everything still sounding by rebuilding the graph
    this.engine.volume.disconnect();
    seed = newSeed;
    const lite = $('lite').checked;
    const old = this.engine;
    this.engine = new Engine(this.ctx, { seed, lite });
    this.engine.meta = old.meta; this.engine.buffers = old.buffers; this.engine.inst = old.inst; this.engine.perc = old.perc;
    this.engine.onNote = old.onNote;
    this.engine.build();
    this.notes = [];
    this.start();
    history.replaceState(null, '', '?seed=' + seed);
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const player = new Player();
function setStatus(s) { $('status').textContent = s; }
function showBar(on) { $('bar').classList.toggle('on', on); }
function setFill(x) { $('fill').style.width = (100 * x).toFixed(1) + '%'; }
const NAMES = { discovery: 'Discovery', discovery_short: 'Discovery', pulse: 'Pulse', reflection: 'Reflection' };
const ARCSEC = {
  discovery: ['Questions', 'Method', 'Night', 'Ascent', 'Breath', 'Discovery', 'Apex', 'Wonder'],
  discovery_short: ['Questions', 'Method', 'Ascent', 'Breath', 'Discovery', 'Apex', 'Wonder'],
  pulse: ['Night', 'Ascent', 'Storm', 'Wonder'],
  reflection: ['Questions', 'Method', 'Song', 'Wonder'],
};
let lastArcKey = '';
function updateNow(p) {
  const now = p.ctx.currentTime;
  const info = p.infos.find((x) => now >= x.t0 && now < x.t1) || p.infos[0];
  if (!info) return;
  $('piece').textContent = `No. ${info.piece} · ${info.key} ${info.mode} · ${NAMES[info.arc]}`;
  $('section').textContent = info.name;
  let ch = info.chords[0];
  for (const c of info.chords) if (c.t <= now) ch = c;
  $('chord').textContent = ch ? ch.name : '—';
  $('tempo').textContent = info.bpm + ' bpm';
  const key = info.piece + info.arc;
  if (key !== lastArcKey) {
    lastArcKey = key;
    $('arc').innerHTML = ARCSEC[info.arc].map((s) => `<span>${s}</span>`).join('');
  }
  const spans = [...$('arc').children];
  const idx = ARCSEC[info.arc].indexOf(info.name);
  spans.forEach((s, i) => { s.className = i < idx ? 'done' : i === idx ? 'on' : ''; });
}

// iOS: route Web Audio through the 'playback' session so the ring/silent switch doesn't mute it
function unlockMobileAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  const a = new Audio(BASE + 'silence.mp3'); a.loop = true; a.setAttribute('playsinline', ''); a.volume = 0.01;
  a.play().catch(() => {});
}
function mediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: 'Threshold', artist: 'An endless score', album: 'mshep.com/music' });
  navigator.mediaSession.setActionHandler('play', () => { if (!player.running) $('play').click(); });
  navigator.mediaSession.setActionHandler('pause', () => { if (player.running) $('play').click(); });
}

$('play').addEventListener('click', async () => {
  const btn = $('play');
  if (!player.ctx) {
    btn.disabled = true;
    unlockMobileAudio(); mediaSession();
    try {
      await player.init($('lite').checked);
      await player.ctx.resume();
      player.start();
      setStatus('Playing');
      btn.disabled = false; btn.classList.add('playing');
      $('now').hidden = false; $('controls').hidden = false;
      history.replaceState(null, '', '?seed=' + seed);
    } catch (e) {
      console.error(e); setStatus('Could not start audio: ' + e.message); btn.disabled = false;
    }
    return;
  }
  if (player.running) { await player.pause(); btn.classList.remove('playing'); setStatus('Paused'); }
  else { await player.resume(); btn.classList.add('playing'); setStatus('Playing'); }
});
$('volume').addEventListener('input', (e) => { if (player.engine?.volume) player.engine.volume.gain.setTargetAtTime(+e.target.value, player.ctx.currentTime, 0.05); });
$('next').addEventListener('click', () => player.restart(Math.floor(Math.random() * 1e9)));
$('share').addEventListener('click', async () => {
  const url = location.origin + location.pathname + '?seed=' + seed;
  try { await navigator.clipboard.writeText(url); $('share').textContent = 'Link copied'; } catch { $('share').textContent = url; }
  setTimeout(() => ($('share').textContent = 'Copy link to this stream'), 2500);
});
if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4) $('lite').checked = true;

// ---------------------------------------------------------------------------
// visualiser: a slow-scrolling score of light
// ---------------------------------------------------------------------------
const cv = $('viz'), g2 = cv.getContext('2d');
function resize() { const d = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * d; cv.height = innerHeight * d; g2.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', resize); resize();
let spec = null;
function draw() {
  requestAnimationFrame(draw);
  const W = innerWidth, H = innerHeight;
  g2.fillStyle = 'rgba(7,8,11,0.32)';
  g2.fillRect(0, 0, W, H);
  if (!player.ctx) return;
  const now = player.ctx.currentTime;
  const span = 16, px = W / span;        // ~16 seconds of light trailing behind the playhead
  const xNow = W * 0.86;
  const y = (p) => H * (0.95 - (p - 24) / (100 - 24) * 0.85);
  g2.globalCompositeOperation = 'lighter';
  player.notes = player.notes.filter((n) => n.t + n.dur > now - span);
  for (const n of player.notes) {
    if (n.t > now) continue;                       // only what has sounded
    const x0 = xNow + (n.t - now) * px, x1 = Math.min(xNow, xNow + (n.t + n.dur - now) * px);
    if (x1 < 0) continue;
    const [r, g, b] = COLORS[n.fam];
    const on = now >= n.t && now <= n.t + n.dur;
    const a = (0.12 + 0.5 * n.dyn) * (on ? 1 : 0.45);
    g2.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    const h = n.fam === 'perc' ? 6 : 2.2;
    g2.fillRect(x0, y(n.pitch) - h / 2, Math.max(1.5, x1 - x0), h);
    if (on && n.dyn > 0.3) { g2.fillStyle = `rgba(${r},${g},${b},${(a * 0.18).toFixed(3)})`; g2.fillRect(x0, y(n.pitch) - 7, Math.max(2, x1 - x0), 14); }
  }
  g2.globalCompositeOperation = 'source-over';
  const grd = g2.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, 'rgba(217,178,106,0)'); grd.addColorStop(0.5, 'rgba(217,178,106,0.22)'); grd.addColorStop(1, 'rgba(217,178,106,0)');
  g2.fillStyle = grd; g2.fillRect(xNow, 0, 1, H);
  // spectrum glow along the bottom
  const an = player.engine?.analyser;
  if (an && player.running) {
    spec = spec || new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(spec);
    g2.beginPath(); g2.moveTo(0, H);
    for (let i = 0; i < 200; i++) {
      const f = 30 * Math.pow(16000 / 30, i / 199), bin = Math.round(f / (player.ctx.sampleRate / 2) * spec.length);
      g2.lineTo(i / 199 * W, H - (spec[bin] / 255) * H * 0.12);
    }
    g2.lineTo(W, H); g2.closePath();
    g2.fillStyle = 'rgba(217,178,106,0.022)'; g2.fill();
  }
}
draw();

// ---------------------------------------------------------------------------
// offline render (used for automated testing / analysis)
// ---------------------------------------------------------------------------
window.renderOffline = async (seconds, renderSeed, opts = {}) => {
  const sr = 44100;
  const octx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const eng = new Engine(octx, { seed: renderSeed, lite: !!opts.lite });
  await eng.load(BASE, null);
  eng.build();
  if (opts.norev) for (const r of [eng.hall, eng.longv, eng.room]) r.disconnect();
  const comp = new Composer(renderSeed);
  const evs = [], infos = [];
  let tEnd = 0;
  while (tEnd < (opts.from || 0) + seconds + 2) { const { events, info } = comp.next(); evs.push(...events); infos.push(info); tEnd = info.t1; }
  evs.sort((a, b) => (a.t ?? a.t0) - (b.t ?? b.t0));
  if (opts.from) {            // audio-thread cost test: one segment, everything scheduled before rendering starts
    const seg = evs.filter((e) => (e.t ?? e.t0) >= opts.from - 1 && (e.t ?? e.t0) < opts.from + seconds);
    for (const e of seg) { if (e.t !== undefined) e.t -= opts.from - 1; if (e.t0 !== undefined) { e.t0 -= opts.from - 1; e.t1 -= opts.from - 1; } }
    for (const e of seg) if ((e.t ?? e.t0) >= 0) eng.play(e);
    const t0 = performance.now(); await octx.startRendering();
    return { audioThreadCost: (performance.now() - t0) / 1000 / seconds, events: seg.length };
  }
  const solo = opts.solo ? new Set(opts.solo) : null;
  let idx = 0;
  const step = 2;
  const feed = (until) => {
    while (idx < evs.length && (evs[idx].t ?? evs[idx].t0) < until) {
      const e = evs[idx++];
      if (solo && !(e.type === 'note' ? solo.has(e.track) : solo.has('~' + e.type))) continue;
      eng.play(e);
    }
  };
  feed(step + 1);
  const blocks = [];
  for (let t = step; t < seconds; t += step) octx.suspend(t).then(() => { blocks.push([t, performance.now()]); feed(t + step + 1); octx.resume(); });
  const t0 = performance.now();
  const buf = await octx.startRendering();
  const elapsed = (performance.now() - t0) / 1000;
  // 16-bit WAV
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  const wav = new DataView(new ArrayBuffer(44 + n * 4));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt '); wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); wav.setUint16(22, 2, true); wav.setUint32(24, sr, true); wav.setUint32(28, sr * 4, true);
  wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); ws(36, 'data'); wav.setUint32(40, n * 4, true);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    wav.setInt16(44 + i * 4, l * 32767, true); wav.setInt16(46 + i * 4, r * 32767, true);
  }
  window.__wav = new Uint8Array(wav.buffer);
  return { bytes: window.__wav.length, elapsed, peak, blocks, infos: infos.map((i) => ({ name: i.name, piece: i.piece, arc: i.arc, key: i.key, mode: i.mode, bpm: i.bpm, t0: i.t0, t1: i.t1, chords: i.chords })), events: evs.length };
};
window.wavChunk = (i, size) => {
  const s = window.__wav.subarray(i * size, (i + 1) * size);
  let bin = '';
  for (let k = 0; k < s.length; k += 0x8000) bin += String.fromCharCode.apply(null, s.subarray(k, k + 0x8000));
  return btoa(bin);
};
