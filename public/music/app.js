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
  if (/clar|flut|bass|oboe/.test(tr)) return 'ww';
  if (/timp|perc|marimba|glock/.test(tr)) return 'perc';
  return 'keys';
};
const COLORS = { str: [217, 178, 106], brs: [214, 112, 72], ww: [104, 190, 170], keys: [150, 180, 235], perc: [240, 236, 226], syn: [170, 130, 220] };
const LEVEL_COLORS = { piece: '#f0ece2', section: '#d9b26a', harmony: '#8fb2ee', motif: '#6fd0b4', layer: '#e08a5f', pattern: '#b79be8' };
const LEVEL_NAMES = { piece: 'piece', section: 'form', harmony: 'harmony', motif: 'melody', layer: 'orchestra', pattern: 'pattern' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const ROLE_NAMES = { bass: 'Bass', pad: 'Harmony', ost: 'Ostinato', mel: 'Melody' };
const CHIP_TRACKS = { basses: ['basses', 'vc_pad'], vc_spic: ['vc_spic', 'basses_spic'] };   // chips that drive several tracks

// ---------------------------------------------------------------------------
// live player
// ---------------------------------------------------------------------------
class Player {
  constructor() {
    this.ctx = null; this.engine = null; this.composer = null;
    this.queue = []; this.infos = []; this.base = 0; this.timer = null; this.running = false;
    this.notes = []; this.decQ = []; this.glow = {};
  }
  async init(lite) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    this.engine = this.newEngine(lite);
    setStatus('Loading the orchestra...'); showBar(true);
    await this.engine.load(BASE, (d, n) => setFill(d / n), CORE);
    this.engine.build();
    this.restLoading = this.engine.load(BASE, (d, n) => { setFill(d / n); if (d === n) showBar(false); })
      .then(() => { this.loaded = true; }).catch((e) => { console.warn(e); this.loaded = true; showBar(false); });
  }
  newEngine(lite) {
    const e = new Engine(this.ctx, { seed, lite });
    e.onNote = (track, pitch, t, dur, dyn) => { this.notes.push({ fam: FAMILY(track), pitch, t, dur, dyn, track }); };
    return e;
  }
  start() {
    this.composer = new Composer(seed);
    this.queue = []; this.infos = []; this.decQ = [];
    $('feed').innerHTML = '';
    this.base = this.ctx.currentTime + 0.4;
    this.running = true;
    this.engine.volume.gain.setValueAtTime(+$('volume').value, this.ctx.currentTime);
    this.tick();
    this.timer = setInterval(() => this.tick(), 80);
  }
  tick() {
    const now = this.ctx.currentTime;
    // compose phrase by phrase, staying only ~8 s ahead of the playhead
    while (!this.infos.length || this.infos[this.infos.length - 1].t1 + this.base < now + 8) {
      const { events, info, decisions } = this.composer.next();
      for (const e of events) {
        if (e.t !== undefined) e.t += this.base;
        if (e.t0 !== undefined) { e.t0 += this.base; e.t1 += this.base; }
        this.queue.push(e);
      }
      info.t0 += this.base; info.t1 += this.base; for (const c of info.chords) c.t += this.base;
      this.infos.push(info);
      for (const d of decisions) { d.t += this.base; this.decQ.push(d); }
      this.queue.sort((a, b) => (a.t ?? a.t0) - (b.t ?? b.t0));
      this.decQ.sort((a, b) => a.t - b.t);
    }
    const horizon = now + (document.hidden ? 4 : 1.6);
    let i = 0;
    while (i < this.queue.length && (this.queue[i].t ?? this.queue[i].t0) < horizon) {
      const e = this.queue[i++];
      if (e.type === 'note' && !this.loaded && !this.engine.inst[TRACKS[e.track].inst]) continue;   // still loading
      try { this.engine.play(e); } catch (err) { console.warn(err); }
    }
    this.queue.splice(0, i);
    // reveal each dice roll at the moment its consequence becomes audible
    while (this.decQ.length && this.decQ[0].t <= now) showRoll(this.decQ.shift());
    while (this.infos.length > 1 && this.infos[0].t1 < now - 2) this.infos.shift();
    updateNow(this);
  }
  async pause() { this.running = false; await this.ctx.suspend(); }
  async resume() { this.running = true; await this.ctx.resume(); }
  async restart(newSeed) {
    clearInterval(this.timer);
    const v = this.engine.volume.gain, now = this.ctx.currentTime;
    v.setValueAtTime(v.value, now); v.linearRampToValueAtTime(0, now + 1.2);
    await new Promise((r) => setTimeout(r, 1300));
    this.engine.volume.disconnect();
    seed = newSeed;
    const old = this.engine;
    this.engine = this.newEngine($('lite').checked);
    Object.assign(this.engine, { meta: old.meta, buffers: old.buffers, inst: old.inst, perc: old.perc });
    this.engine.build();
    this.notes = []; markers.length = 0; formTrail = []; lastPiece = -1; chipKey = '';
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
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showRoll(d) {
  const feed = $('feed');
  const el = document.createElement('div');
  el.className = 'roll';
  el.style.setProperty('--c', LEVEL_COLORS[d.level] || '#d9b26a');
  const win = d.options[d.chosen];
  const many = d.options.length > 1;
  const odds = many ? ` <span class="q">${Math.round(win.p * 100)}%</span>` : '';
  const bars = many ? `<div class="dist">${d.options.map((o, i) => `<i class="${i === d.chosen ? 'win' : ''}" style="flex:${o.p.toFixed(4)}" title="${esc(o.name)} ${Math.round(o.p * 100)}%"></i>`).join('')}</div>` : '';
  const alts = many ? `<div class="alts">${d.options.map((o, i) => (i === d.chosen ? `<b>${esc(o.name)}</b>` : esc(o.name)) + ' ' + Math.round(o.p * 100) + '%').join(' · ')}</div>` : '';
  el.innerHTML = `<div class="what"><span class="lv ${d.level}">${LEVEL_NAMES[d.level] || d.level}</span><span class="q">${esc(d.label)}</span><span class="a">${esc(win.name)}</span>${odds}</div>${bars}${alts}`;
  feed.prepend(el);
  while (feed.children.length > 24) feed.lastChild.remove();
  const short = !many ? d.label : d.level === 'harmony' && d.label === 'Next chord' ? win.name : (d.label.length < 22 ? d.label.replace(/:.*$/, '') + ': ' : '') + win.name;
  markers.push({ t: d.t, level: d.level, text: short });
}

let formTrail = [], lastPiece = -1, lastSecStart = -1, chipKey = '';
function updateNow(p) {
  const now = p.ctx.currentTime;
  const info = p.infos.find((x) => now >= x.t0 && now < x.t1) || p.infos[0];
  if (!info) return;
  $('piece').textContent = `No. ${info.piece} · ${info.key} ${cap(info.mode)} · ${info.meter} · ${info.bpm} bpm · ${info.palette}`;
  $('section').textContent = cap(info.section);
  $('secprog').textContent = `phrase at bar ${info.sectionBar + 1} of ${info.sectionBars}`;
  let ch = info.chords[0];
  for (const c of info.chords) if (c.t <= now) ch = c;
  $('chord').textContent = ch ? ch.name : '-';
  $('roman').textContent = ch ? ch.num : '';
  $('energy').style.width = (info.energy * 100).toFixed(0) + '%';
  $('rolls').textContent = `${p.composer.rolls.toLocaleString()} rolls · seed ${seed}`;
  // form timeline: sections appear only as the grammar decides them
  if (info.piece !== lastPiece) { formTrail = []; lastPiece = info.piece; }
  if (info.sectionBar === 0 && info.t0 !== lastSecStart) { lastSecStart = info.t0; formTrail.push(info.section); }
  if (!formTrail.length) formTrail.push(info.section);
  $('form').innerHTML = formTrail.map((s, i) => `<span class="${i === formTrail.length - 1 ? 'on' : ''}">${cap(s)}</span>`).join('') + '<span class="next">?</span>';
  // orchestra map
  const key = info.layers.map((l) => l.role + ':' + l.track).join('|');
  if (key !== chipKey) {
    const prev = new Set(chipKey.split('|'));
    chipKey = key;
    const byRole = {};
    for (const l of info.layers) (byRole[l.role] = byRole[l.role] || []).push(l);
    $('orchestra').innerHTML = ['mel', 'ost', 'pad', 'bass'].filter((r) => byRole[r]).map((r) => `<span class="role">${ROLE_NAMES[r]}</span><span class="chips">${byRole[r].map((l) => `<span class="chip${prev.has(l.role + ':' + l.track) ? '' : ' new'}" data-track="${l.track}" title="${esc(l.desc)}">${esc(l.desc.replace(/ \(.*/, ''))}</span>`).join('')}</span>`).join('');
  }
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
      $('now').hidden = false; $('controls').hidden = false; $('dice').hidden = false;
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
// visualiser: a slow-scrolling score of light, annotated with the dice that made it
// ---------------------------------------------------------------------------
const cv = $('viz'), g2 = cv.getContext('2d');
const mk = $('marks'), g3 = mk.getContext('2d');     // crisp overlay (cleared every frame) for labels and the playhead
const markers = [];
function resize() {
  const d = Math.min(2, devicePixelRatio || 1);
  for (const [c, g] of [[cv, g2], [mk, g3]]) { c.width = innerWidth * d; c.height = innerHeight * d; g.setTransform(d, 0, 0, d, 0, 0); }
}
addEventListener('resize', resize); resize();
let spec = null;
function draw() {
  requestAnimationFrame(draw);
  const W = innerWidth, H = innerHeight;
  g2.fillStyle = 'rgba(7,8,11,0.32)';
  g2.fillRect(0, 0, W, H);
  if (!player.ctx) return;
  const now = player.ctx.currentTime;
  const span = 16, px = W / span;
  const xNow = W * 0.86;
  const y = (p) => H * (0.95 - (p - 24) / (100 - 24) * 0.85);
  g2.globalCompositeOperation = 'lighter';
  player.notes = player.notes.filter((n) => n.t + n.dur > now - span);
  for (const n of player.notes) {
    if (n.t > now) continue;
    const x0 = xNow + (n.t - now) * px, x1 = Math.min(xNow, xNow + (n.t + n.dur - now) * px);
    if (x1 < 0) continue;
    const [r, g, b] = COLORS[n.fam];
    const on = now <= n.t + n.dur;
    const a = (0.12 + 0.5 * n.dyn) * (on ? 1 : 0.45);
    g2.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    const h = n.fam === 'perc' ? 4 : 2.2;
    g2.fillRect(x0, y(n.pitch) - h / 2, Math.max(1.5, x1 - x0), h);
    if (on && n.dyn > 0.3) { g2.fillStyle = `rgba(${r},${g},${b},${(a * 0.18).toFixed(3)})`; g2.fillRect(x0, y(n.pitch) - 7, Math.max(2, x1 - x0), 14); }
    if (on && now - n.t < 0.12) player.glow[n.track] = Math.min(1, (player.glow[n.track] || 0) + 0.3 * (0.4 + n.dyn));
  }
  g2.globalCompositeOperation = 'source-over';
  // dice markers drift left with the music they caused (overlay, redrawn crisply each frame)
  g3.clearRect(0, 0, W, H);
  while (markers.length && markers[0].t < now - span) markers.shift();
  g3.font = '11px "Iowan Old Style", Georgia, serif';
  const lanes = [];
  for (const m of markers) {
    if (m.t > now) continue;
    const x = xNow + (m.t - now) * px;
    const alpha = Math.max(0, 1 - (now - m.t) / span) * 0.85;
    const c = LEVEL_COLORS[m.level] || '#d9b26a';
    let lane = 0;
    while (lanes[lane] !== undefined && lanes[lane] > x - 6) lane++;
    lanes[lane] = x + g3.measureText(m.text).width + 4;
    g3.globalAlpha = alpha * 0.22;
    g3.fillStyle = c; g3.fillRect(x, 14 + lane * 15, 1, H);
    if (lane < 8) { g3.globalAlpha = alpha; g3.fillText(m.text, x + 4, 22 + lane * 15); }
  }
  g3.globalAlpha = 1;
  const grd = g3.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, 'rgba(217,178,106,0)'); grd.addColorStop(0.5, 'rgba(217,178,106,0.22)'); grd.addColorStop(1, 'rgba(217,178,106,0)');
  g3.fillStyle = grd; g3.fillRect(xNow, 0, 1, H);
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
  // orchestra chips glow with their instruments
  for (const el of document.querySelectorAll('.chip')) {
    const trs = CHIP_TRACKS[el.dataset.track] || [el.dataset.track];
    let gl = 0; for (const t of trs) gl = Math.max(gl, player.glow[t] || 0);
    const [r, g, b] = COLORS[FAMILY(el.dataset.track)];
    el.style.boxShadow = gl > 0.02 ? `0 0 ${(4 + 14 * gl).toFixed(0)}px rgba(${r},${g},${b},${(0.25 + 0.5 * gl).toFixed(2)})` : '';
    el.style.borderColor = gl > 0.02 ? `rgba(${r},${g},${b},${(0.3 + 0.6 * gl).toFixed(2)})` : '';
  }
  for (const k in player.glow) player.glow[k] *= 0.9;
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
  const comp = new Composer(renderSeed);
  const evs = [], infos = [];
  let tEnd = 0, ndec = 0;
  while (tEnd < (opts.from || 0) + seconds + 2) { const { events, info, decisions } = comp.next(); evs.push(...events); infos.push(info); ndec += decisions.length; tEnd = info.t1; }
  evs.sort((a, b) => (a.t ?? a.t0) - (b.t ?? b.t0));
  const solo = opts.solo ? new Set(opts.solo) : null;
  const noteTimes = [];
  let idx = 0;
  const step = 2;
  const feed = (until) => {
    while (idx < evs.length && (evs[idx].t ?? evs[idx].t0) < until) {
      const e = evs[idx++];
      if (solo && !(e.type === 'note' ? solo.has(e.track) : solo.has('~' + e.type))) continue;
      if (solo && e.type === 'note') noteTimes.push(e.t);
      eng.play(e);
    }
  };
  feed(step + 1);
  const blocks = [];
  for (let t = step; t < seconds; t += step) octx.suspend(t).then(() => { blocks.push([t, performance.now()]); feed(t + step + 1); octx.resume(); });
  const t0 = performance.now();
  const buf = await octx.startRendering();
  const elapsed = (performance.now() - t0) / 1000;
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
  return { bytes: window.__wav.length, elapsed, peak, blocks, decisions: ndec, events: evs.length, noteTimes,
    infos: infos.map((i) => ({ name: i.section, piece: i.piece, key: i.key, mode: i.mode, meter: i.meter, bpm: i.bpm, t0: i.t0, t1: i.t1, energy: i.energy, chords: i.chords })) };
};
window.wavChunk = (i, size) => {
  const s = window.__wav.subarray(i * size, (i + 1) * size);
  let bin = '';
  for (let k = 0; k < s.length; k += 0x8000) bin += String.fromCharCode.apply(null, s.subarray(k, k + 0x8000));
  return btoa(bin);
};
