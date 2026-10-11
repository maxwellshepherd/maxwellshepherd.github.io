// Threshold engine: expressive sampler + hybrid synth layers + generated halls + mastering, all Web Audio.
// Port of the offline Python renderer used to make "Threshold".

const db = (x) => Math.pow(10, x / 20);
// decorative doublings dropped in Lite mode (phones / low-power machines)
const LITE_SKIP = new Set(['organ_arp', 'basses_spic', 'bassoons']);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------------------
// mix layout: one entry per performer track (gain dB, pan, sends, sampler behaviour)
// ---------------------------------------------------------------------------
export const TRACKS = {
  piano:        { inst: 'piano', gain: 0, pan: -0.05, send: 0.32, depth: 9000, release: 0.45, dyn: 12, hum: 0.006 },
  piano_low:    { inst: 'piano', gain: -4, pan: -0.1, send: 0.38, release: 0.9, dyn: 12, hum: 0.008, offset: -3 },
  vln_theme:    { inst: 'vln_sus', gain: 2, pan: -0.45, send: 0.38, release: 0.7, dyn: 24, legato: true },
  vln_pad:      { inst: 'vln_sus', gain: -3, pan: -0.3, send: 0.42, release: 0.9, dyn: 26 },
  vln_high:     { inst: 'vln_sus', gain: -6, pan: -0.15, send: 0.55, long: 0.6, release: 1.4, dyn: 26 },
  vln_trem:     { inst: 'vln_trem', gain: -6, pan: -0.35, send: 0.5, release: 0.8, dyn: 22 },
  vln_spic:     { inst: 'vln_spic', gain: 1, pan: -0.5, send: 0.33, depth: 7000, release: 0.12, dyn: 18, hum: 0.006, offset: 42 },
  vla_pad:      { inst: 'vla_sus', gain: -1, pan: 0.15, send: 0.42, release: 0.9, dyn: 26 },
  vla_spic:     { inst: 'vla_spic', gain: 2, pan: 0.2, send: 0.33, depth: 7000, release: 0.12, dyn: 18, hum: 0.006, offset: 19 },
  vc_pad:       { inst: 'vc_sus', gain: 4, pan: 0.35, send: 0.4, release: 1.0, dyn: 26 },
  vc_theme:     { inst: 'vc_sus', gain: 0, pan: 0.35, send: 0.38, release: 0.7, dyn: 24, legato: true },
  vc_spic:      { inst: 'vc_spic', gain: 1, pan: 0.45, send: 0.3, release: 0.15, dyn: 18, hum: 0.006, offset: 15 },
  basses:       { inst: 'cb_sus', gain: 7, pan: 0.45, send: 0.3, release: 1.0, dyn: 24 },
  basses_spic:  { inst: 'cb_spic', gain: 3, pan: 0.6, send: 0.28, release: 0.2, dyn: 18, offset: 47 },
  horns:        { inst: 'hn_sus', gain: 2, pan: -0.35, send: 0.6, depth: 6000, release: 0.8, dyn: 26, legato: true },
  horns_chords: { inst: 'hn_sus', gain: -2, pan: -0.2, send: 0.6, depth: 6000, release: 0.9, dyn: 26 },
  trumpets:     { inst: 'tpt_sus', gain: -3, pan: 0.15, send: 0.55, depth: 8000, release: 0.7, dyn: 26, legato: true },
  trombones:    { inst: 'tbn_sus', gain: -2, pan: 0.35, send: 0.55, depth: 6000, release: 0.8, dyn: 26 },
  tuba:         { inst: 'tba_sus', gain: 2, pan: 0.4, send: 0.45, depth: 6000, release: 0.8, dyn: 26 },
  organ:        { inst: 'org_loud_man', gain: -8, pan: 0, send: 0.45, release: 1.2, dyn: 20 },
  organ_soft:   { inst: 'org_q_man', gain: -6, pan: 0, send: 0.5, release: 1.2, dyn: 18 },
  organ_arp:    { inst: 'org_loud_man', gain: -8, pan: 0.05, send: 0.45, depth: 6000, release: 0.25, dyn: 16, hum: 0, offset: 10 },
  organ_pedal:  { inst: 'org_loud_ped', gain: -1, pan: 0, send: 0.4, release: 1.5, dyn: 18 },
  clarinets:    { inst: 'cl_sus', gain: -5, pan: -0.1, send: 0.42, depth: 7000, release: 0.18, dyn: 20, hum: 0.006, offset: 25 },
  flutes:       { inst: 'fl_sus', gain: -13, pan: -0.2, send: 0.45, depth: 7000, release: 0.18, dyn: 20, hum: 0.006, offset: 8 },
  bassoons:     { inst: 'bsn_sus', gain: -6, pan: 0.15, send: 0.42, release: 0.6, dyn: 22 },
  harp:         { inst: 'harp', gain: -6, pan: -0.6, send: 0.45, depth: 7000, release: 1.0, dyn: 10, hum: 0.005 },
  timpani:      { inst: 'timp_hit', gain: 3, pan: 0.1, send: 0.5, release: 2.0, dyn: 18, hum: 0.004, offset: -2 },
  timp_roll:    { inst: 'timp_roll', gain: -17, pan: 0.1, send: 0.5, release: 0.6, dyn: 24 },
  piano_mel:    { inst: 'piano', gain: 0, pan: 0.05, send: 0.36, depth: 9000, release: 0.6, dyn: 12, hum: 0.006 },
  oboe:         { inst: 'ob_vib', gain: -4, pan: 0.1, send: 0.45, depth: 8000, release: 0.5, dyn: 22, legato: true },
  marimba:      { inst: 'marimba', gain: -3, pan: 0.25, send: 0.4, release: 0.6, dyn: 14, hum: 0.006 },
  glock:        { inst: 'glock', gain: -12, pan: -0.25, send: 0.5, depth: 9000, release: 1.2, dyn: 12, hum: 0.005 },
  vln_pizz:     { inst: 'vln_pizz', gain: 0, pan: -0.4, send: 0.4, release: 0.3, dyn: 16, hum: 0.006 },
  vc_pizz:      { inst: 'vc_pizz', gain: 2, pan: 0.35, send: 0.35, release: 0.4, dyn: 16, hum: 0.006 },
};
// synth / sound-design buses
const SYN = {
  sub:     { gain: -8, send: 0, long: 0, hp: 25, lp: 160 },
  boom:    { gain: -12, send: 0.25, long: 0.4, lp: 1200 },
  riser:   { gain: -12, send: 0.2, long: 0.6, hp: 200 },
  pad:     { gain: -11, send: 0.3, long: 0.5, hp: 90, lp: 4500 },
  shimmer: { gain: -4, send: 0.2, long: 0.9, hp: 300, nogate: true },
  perc:    { gain: -6, send: 0.5, long: 0.3 },
};

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// algorithmic hall impulse response (band-wise exponential decay + early reflections)
// ---------------------------------------------------------------------------
function makeIR(ctx, rt60, predelay, seed, densityLP) {
  const sr = ctx.sampleRate;
  const n = Math.floor(rt60 * 1.15 * sr);       // beyond ~-45 dB the tail is inaudible under music
  const pd = Math.floor(predelay * sr);
  const buf = ctx.createBuffer(2, n + pd, sr);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // crossover frequencies and decay multipliers (low decays longest, highs fastest)
  const xo = [200, 800, 2500, 6000];
  const mult = [1.35, 1.1, 0.9, 0.65, 0.42];
  const a = xo.map((f) => Math.exp(-2 * Math.PI * f / sr));
  const lpa = Math.exp(-2 * Math.PI * densityLP / sr);
  let energy = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const st = xo.map(() => [0, 0]);
    let lp1 = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const x = rnd();
      // cascaded 2-pole lowpasses -> band splits
      const lows = [];
      for (let k = 0; k < xo.length; k++) {
        st[k][0] = (1 - a[k]) * x + a[k] * st[k][0];
        st[k][1] = (1 - a[k]) * st[k][0] + a[k] * st[k][1];
        lows.push(st[k][1]);
      }
      const t = i / sr;
      let y = lows[0] * Math.exp(-6.91 * t / (rt60 * mult[0]));
      for (let k = 1; k < xo.length; k++) y += (lows[k] - lows[k - 1]) * Math.exp(-6.91 * t / (rt60 * mult[k]));
      y += (x - lows[xo.length - 1]) * Math.exp(-6.91 * t / (rt60 * mult[4]));
      y *= 1 - Math.exp(-t / 0.035);
      lp1 = (1 - lpa) * y + lpa * lp1; lp2 = (1 - lpa) * lp1 + lpa * lp2;
      d[pd + i] = lp2;
    }
    for (let k = 0; k < 18; k++) {           // early reflections
      const dd = 0.004 + (rnd() * 0.5 + 0.5) * 0.086;
      const i = pd + Math.floor(dd * sr);
      d[i] += (0.3 + 0.7 * (rnd() * 0.5 + 0.5)) * (1 - dd * 6) * (rnd() > 0 ? 1 : -1) * 0.25;
    }
    for (let i = 0; i < d.length; i++) energy += d[i] * d[i];
  }
  const g = 1 / Math.sqrt(energy / 2);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return buf;
}

// ---------------------------------------------------------------------------
export class Engine {
  constructor(ctx, { seed = 1, lite = false } = {}) {
    this.ctx = ctx;
    this.lite = lite;
    let s = seed >>> 0 || 1;
    this.rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    this.buffers = {};
    this.inst = {};
    this.perc = {};
    this.rr = {};
    this.voices = 0;
    this.gates = [];
    this._pushes = 0;
    this.onNote = null;     // visualiser hook
  }

  // ---------------- loading ----------------
  async load(base, onProgress, only = null) {
    if (!this.meta) {
      this.meta = await (await fetch(base + 'samples/instruments.json')).json();
    }
    const M = this.meta;
    const jobs = [];
    for (const [k, v] of Object.entries(M.instruments)) {
      if (only && !only.includes(k)) continue;
      for (const r of v.regions) if (!this.buffers[r.f]) jobs.push(r);
    }
    for (const [k, r] of Object.entries(M.perc)) if ((!only || only.includes('perc')) && !this.buffers[r.f]) jobs.push(r);
    let done = 0;
    const total = jobs.length;
    const fetchDecode = async (r) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const resp = await fetch(base + 'samples/' + r.f);
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const ab = await resp.arrayBuffer();
          return await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
        } catch (e) {
          await new Promise((res) => setTimeout(res, 400 * (attempt + 1) ** 2));   // transient network trouble: back off and retry
        }
      }
      console.warn('sample unavailable, continuing without it:', r.f);
      return null;
    };
    const worker = async () => {
      while (jobs.length) {
        const r = jobs.shift();
        const buf = await fetchDecode(r);
        if (buf) {
          // MP3 encoder delay: trimmed by most decoders; detect and compensate if not
          r.off = buf.duration - r.dur > 0.012 ? M.encoderDelay : 0;
          this.buffers[r.f] = buf;
        }
        done++;
        if (onProgress) onProgress(done, total);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    for (const [k, v] of Object.entries(M.instruments)) {
      if (only && !only.includes(k)) continue;
      const regs = v.regions.filter((r) => this.buffers[r.f]);
      if (!regs.length) continue;
      const layers = v.layers.filter((l) => regs.some((r) => r.layer === l));
      this.inst[k] = { kind: v.kind, layers, regions: regs };
    }
    for (const [k, r] of Object.entries(M.perc)) if (this.buffers[r.f]) this.perc[k] = r;
  }

  // ---------------- graph ----------------
  build() {
    const c = this.ctx;
    const out = c.createGain();
    // master tonal curve (match-EQ toward the reference + body + air control)
    const eq = [
      ['highpass', 24, 0.7, 0], ['lowshelf', 110, 0, 3], ['peaking', 85, 0.9, 2.5], ['peaking', 170, 0.7, 1],
      ['peaking', 320, 0.8, -1.5], ['highshelf', 4500, 0, -2.5],
    ].map(([type, f, q, g]) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; b.gain.value = g; return b; });
    this.masterIn = c.createGain();
    this.masterIn.channelCount = 2; this.masterIn.channelCountMode = 'explicit';
    let node = this.masterIn;
    for (const b of eq) { node.connect(b); node = b; }
    // M/S widening above 250 Hz (keeps lows mono)
    const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
    const diff = c.createGain(); const inv = c.createGain(); inv.gain.value = -1;
    const shp = c.createBiquadFilter(); shp.type = 'highpass'; shp.frequency.value = 250;
    const wl = c.createGain(); wl.gain.value = 0.2; const wr = c.createGain(); wr.gain.value = -0.2;
    node.connect(split);
    split.connect(merge, 0, 0); split.connect(merge, 1, 1);
    split.connect(diff, 0); split.connect(inv, 1); inv.connect(diff);
    diff.connect(shp); shp.connect(wl); shp.connect(wr);
    wl.connect(merge, 0, 0); wr.connect(merge, 0, 1);
    // glue + parallel compression + limiter.
    // Web Audio compressors add automatic makeup gain ((1/fullRangeGain)^0.6 per spec); cancel it so they only compress.
    const comp = (thr, ratio, knee, att, rel) => {
      const k = c.createDynamicsCompressor();
      k.threshold.value = thr; k.ratio.value = ratio; k.knee.value = knee; k.attack.value = att; k.release.value = rel;
      const fullRangeDb = thr + (0 - thr) / ratio;        // curve output for a 0 dBFS input
      const undo = c.createGain(); undo.gain.value = db(0.6 * fullRangeDb);
      k.connect(undo);
      return [k, undo];
    };
    this.trim = c.createGain(); this.trim.gain.value = db(-6);
    merge.connect(this.trim);
    const [glue, glueOut] = comp(-20, 1.8, 6, 0.04, 0.3);
    this.trim.connect(glue);
    const [par, parOut] = comp(-32, 5, 3, 0.008, 0.18);
    const parG = c.createGain(); parG.gain.value = db(-5);
    const sum = c.createGain();
    glueOut.connect(sum); glueOut.connect(par); parOut.connect(parG); parG.connect(sum);
    const [lim, limOut] = comp(-3, 20, 0, 0.002, 0.12);
    this.makeup = c.createGain(); this.makeup.gain.value = db(2.5);
    sum.connect(lim); limOut.connect(this.makeup);
    // final safety: transparent below -3 dBFS, soft-saturates anything above (never clips). Handles +-2 input.
    const clip = c.createWaveShaper(); const N = 8192, cv = new Float32Array(N);
    const th = db(-3), ceil = 0.97;
    for (let i = 0; i < N; i++) {
      const s = ((i / (N - 1)) * 2 - 1) * 2, as = Math.abs(s);
      cv[i] = 0.5 * (as <= th ? s : Math.sign(s) * (th + (ceil - th) * Math.tanh((as - th) / (ceil - th))));
    }
    clip.curve = cv; clip.oversample = '2x';
    const pre = c.createGain(); pre.gain.value = 0.5;
    const post = c.createGain(); post.gain.value = 2;
    this.volume = c.createGain();
    this.makeup.connect(pre); pre.connect(clip); clip.connect(post); post.connect(this.volume);
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 4096; this.analyser.smoothingTimeConstant = 0.8;
    this.volume.connect(this.analyser);
    this.volume.connect(c.destination);
    // reverbs
    const rev = (rt, pd, seed, dlp, hp, ret, hs) => {
      const inp = c.createGain();
      const conv = c.createConvolver(); conv.normalize = false; conv.buffer = makeIR(c, rt, pd, seed, dlp);
      const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
      const g = c.createGain(); g.gain.value = ret;
      inp.connect(conv); conv.connect(h);
      let last = h;
      if (hs) { const s = c.createBiquadFilter(); s.type = 'highshelf'; s.frequency.value = 5000; s.gain.value = -3; h.connect(s); last = s; }
      last.connect(g); g.connect(this.masterIn);
      return inp;
    };
    this.hall = rev(3.3, 0.028, 1, 9000, 70, 0.75 * 1.15, true);
    this.longv = rev(this.lite ? 4.5 : 6.5, 0.06, 2, 7000, 150, 0.5, true);
    this.room = rev(0.9, 0.006, 3, 10000, 90, 0.45, false);
    // tracks
    this.tracks = {};
    for (const [name, cfg] of Object.entries(TRACKS)) this.tracks[name] = this._track(name, cfg);
    for (const [name, cfg] of Object.entries(SYN)) this.tracks['~' + name] = this._track('~' + name, { ...cfg, pan: 0, syn: true });
    this.noise = c.createBuffer(2, c.sampleRate * 4, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = this.noise.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    // sub waveform: fundamental + harmonics that carry it on small speakers
    this.subWave = c.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.35, 0.14]));
    this.shaper = (k) => { const ws = c.createWaveShaper(); const n = 1024; const cv = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = Math.tanh(k * x) / Math.tanh(k); } ws.curve = cv; return ws; };
  }

  _track(name, cfg) {
    const c = this.ctx;
    const input = c.createGain(); input.gain.value = db(cfg.gain || 0);
    // fixed stereo: if the channel count changed when a stereo source ends, Chrome would reset filter state (a click)
    input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
    let node = input;
    const chain = [];
    if (cfg.depth) chain.push(['lowpass', cfg.depth]);
    if (cfg.lp) chain.push(['lowpass', cfg.lp]);
    chain.push(['highpass', cfg.hp || 35]);
    for (const [t, f] of chain) { const b = c.createBiquadFilter(); b.type = t; b.frequency.value = f; node.connect(b); node = b; }
    const pan = c.createStereoPanner(); pan.pan.value = cfg.pan || 0;
    node.connect(pan);
    pan.connect(this.masterIn);
    const sends = [[this.hall, cfg.send ?? 0.35], [this.longv, cfg.long ?? 0.1], [this.room, cfg.syn ? 0 : (cfg.room ?? 0.35)]];
    for (const [bus, amt] of sends) if (amt > 0) { const g = c.createGain(); g.gain.value = amt; pan.connect(g); g.connect(bus); }
    return { input, cfg, name };
  }

  // gate all dry tracks (reverb tails keep ringing): hard cut and the pre-arrival "suck"
  // Implemented per voice (a node that is always processing while its note sounds): robust in every browser,
  // unlike automating an idle bus node.
  gateOff(t0, t1) {
    this.gates.push([t0, t1]);
    for (const tr of Object.values(this.tracks)) {
      if (tr.cfg.nogate || !tr.kill) continue;
      tr.kill.gain.setValueAtTime(1, t0); tr.kill.gain.linearRampToValueAtTime(0, t0 + 0.012);
      tr.kill = null;                       // later voices get a fresh node
    }
  }
  _gated(t) { return this.gates.some(([a, b]) => t >= a && t < b); }
  // Voices enter their track through a shared 'kill' node that is swapped at every gate. The node is always busy
  // while its voices sound, so its automation is honoured (automating an idle bus is unreliable in Chrome).
  _voice(track) {
    if (++this._pushes % 256 === 0) { const now = this.ctx.currentTime; this.gates = this.gates.filter(([, b]) => b > now - 1); }
    const tr = this.tracks[track];
    if (!tr.kill) { tr.kill = this.ctx.createGain(); tr.kill.connect(tr.input); }
    return tr.kill;
  }

  // ---------------- sampler ----------------
  _pick(instKey, pitch, layerIdx) {
    const I = this.inst[instKey];
    const regs = I.regions.filter((r) => r.layer === layerIdx);
    let best = Infinity;
    for (const r of regs) best = Math.min(best, Math.abs(r.root - pitch));
    const close = regs.filter((r) => Math.abs(r.root - pitch) <= best + 0.51);
    const key = instKey + ':' + Math.round(pitch) + ':' + layerIdx;
    const i = (this.rr[key] = (this.rr[key] || 0) + 1);
    return close[i % close.length];
  }

  // n: {track, t, dur, pitch, dyn (number | [[relSec, level]...]), legIn, legOut, fadeIn, startOffset}
  note(n) {
    const tr = this.tracks[n.track];
    if (!tr || this._gated(n.t)) return;
    if (this.lite && LITE_SKIP.has(n.track)) return;
    const cfg = tr.cfg;
    const I = this.inst[cfg.inst];
    if (!I) return;
    const c = this.ctx;
    const curve = typeof n.dyn === 'number' ? [[0, n.dyn]] : n.dyn;
    const d0 = curve[0][1];
    const nl = I.layers.length;
    const sustain = I.kind === 'sustain';
    let t = n.t + (cfg.offset || 0) / 1000 + gauss(this.rng) * (cfg.hum ?? 0.009);
    let so = n.startOffset || 0, fi = n.fadeIn || 0;
    let rel = n.legOut && cfg.legato ? 0.2 : (n.release ?? cfg.release);
    const leg = cfg.legato && n.legIn;
    if (leg) { so = Math.max(so, 0.14); fi = Math.max(fi, 0.09); }
    // layer weights (two adjacent dynamic layers, equal-power)
    const posOf = (d) => clamp(d, 0, 1) * (nl - 1);
    let lo, hi;
    if (sustain) {
      let mn = Infinity, mx = -Infinity;
      for (const [, v] of curve) { mn = Math.min(mn, posOf(v)); mx = Math.max(mx, posOf(v)); }
      lo = Math.floor(mn); hi = Math.min(Math.ceil(mx), lo + 1);
      if (this.lite || mx - mn < 0.25) { lo = hi = Math.round((mn + mx) / 2); }
    } else {
      lo = hi = Math.round(posOf(d0 + (this.rng() - 0.5) * 0.08));
    }
    const dur = n.dur + (cfg.legato ? 0.12 : 0);
    const regLo = this._pick(cfg.inst, n.pitch, I.layers[lo]);
    if (!regLo) return;
    // timing compensation
    if (sustain) {
      let att = regLo.attack || 0;
      if (!leg && att > 0.2) { const skip = Math.min(0.35 * att, 0.25); so += skip; att -= skip; fi = Math.max(fi, 0.06); }
      else if (leg) att = Math.max(0, att - 0.14);
      t -= Math.min(0.6 * att, 0.22) + (leg ? 0.06 : 0);
    } else {
      t -= regLo.onset || 0;
    }
    if (fi === 0 && sustain && d0 < 0.3 && !n.fadeIn) fi = 0.25;
    t = Math.max(t, c.currentTime + 0.005);
    const dynRange = cfg.dyn || 24;
    const gainOf = (d) => db(-dynRange * Math.pow(1 - clamp(d, 0, 1), 1.2));
    const end = t + dur;
    const kill = this._voice(n.track);
    for (let li = lo; li <= hi; li++) {
      const reg = li === lo ? regLo : this._pick(cfg.inst, n.pitch, I.layers[li]);
      if (!reg) continue;
      const buf = this.buffers[reg.f];
      const src = c.createBufferSource();
      src.buffer = buf;
      const rate = Math.pow(2, (n.pitch - reg.root) / 12);
      src.playbackRate.value = rate;
      const off = reg.off || 0;
      if (sustain && reg.loopEnd) {
        src.loop = true; src.loopStart = reg.loopStart + off; src.loopEnd = reg.loopEnd + off;
      }
      const g = c.createGain();
      const gp = g.gain;
      const w = (d) => (lo === hi ? 1 : Math.sqrt(clamp(1 - Math.abs(posOf(d) - li), 0, 1)));
      const amp = (d) => gainOf(d) * w(d) * (reg.gain || 1);
      const a0 = amp(d0);
      if (fi > 0) { gp.setValueAtTime(0, t); gp.linearRampToValueAtTime(a0, t + fi); }
      else { gp.setValueAtTime(0, t); gp.linearRampToValueAtTime(a0, t + 0.004); }
      for (const [rt, v] of curve) {
        const tt = t + rt;
        if (rt <= fi || tt >= end) continue;
        gp.linearRampToValueAtTime(amp(v), tt);
      }
      const last = curve[curve.length - 1][1];
      gp.setValueAtTime(amp(last), end);
      gp.linearRampToValueAtTime(0, end + Math.max(0.03, rel));
      src.connect(g); g.connect(kill);
      src.start(t, off + so);
      src.stop(end + Math.max(0.03, rel) + 0.05);
      this.voices++;
      src.onended = () => { this.voices--; g.disconnect(); };
    }
    if (this.onNote) this.onNote(n.track, n.pitch, t, n.dur, d0);
  }

  // ---------------- synth layers ----------------
  sub(t, dur, midi, lev, att, rel) {
    const c = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = c.createOscillator(); o.setPeriodicWave(this.subWave);
    o.frequency.setValueAtTime(f * 1.04, t); o.frequency.setTargetAtTime(f, t, 0.03);
    const sh = this.shaper(1.5); const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lev * 0.75, t + Math.max(0.01, att));
    g.gain.setValueAtTime(lev * 0.75, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + rel);
    o.connect(sh); sh.connect(g); g.connect(this._voice('~sub'));
    o.start(t); o.stop(t + dur + rel + 0.05);
  }

  boom(t, level, rootMidi) {
    const c = this.ctx, flo = 440 * Math.pow(2, (rootMidi - 69) / 12), fhi = flo * 2.5;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(fhi, t); o.frequency.setTargetAtTime(flo, t, 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.005); g.gain.setTargetAtTime(0, t + 0.005, 1.6);
    const nz = c.createBufferSource(); nz.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 130; bp.Q.value = 0.5;
    const ng = c.createGain(); ng.gain.setValueAtTime(level * 0.8, t); ng.gain.setTargetAtTime(0, t, 0.08); ng.gain.setValueAtTime(0, t + 0.9);
    const sh = this.shaper(2);
    o.connect(g); g.connect(sh); nz.connect(bp); bp.connect(ng); ng.connect(sh);
    sh.connect(this._voice('~boom'));
    o.start(t); o.stop(t + 7); nz.start(t); nz.stop(t + 1.5);
  }

  riser(t, dur, level) {
    const c = this.ctx;
    const nz = c.createBufferSource(); nz.buffer = this.noise; nz.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const g = c.createGain();
    const N = 64, cv = new Float32Array(N);
    for (let i = 0; i < N; i++) cv[i] = Math.pow(i / (N - 1), 2.5) * level;
    g.gain.setValueAtTime(0, t); g.gain.setValueCurveAtTime(cv, t, dur);
    g.gain.setValueAtTime(level, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    nz.connect(lp); lp.connect(g); g.connect(this._voice('~riser'));
    nz.start(t); nz.stop(t + dur + 0.05);
  }

  pad(t, dur, midis, lev, att = 0.8, rel = 1.2) {
    const c = this.ctx;
    const voices = 3;
    const L = lev / voices * 1.25;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(L, t + att);
    g.gain.setValueAtTime(L, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + rel);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.707;
    lp.connect(g); g.connect(this._voice('~pad'));
    const pans = [-0.7, 0, 0.7].map((x) => { const p = c.createStereoPanner(); p.pan.value = x; p.connect(lp); return p; });
    for (const m of midis) {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      for (let v = 0; v < voices; v++) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = f; o.detune.value = (v - 1) * 13;
        o.connect(pans[v]);
        o.start(t); o.stop(t + dur + rel + 0.05);
      }
    }
  }

  shimmer(t, dur, midi, lev, att, rel) {
    const c = this.ctx, f = 440 * Math.pow(2, (midi - 69) / 12);
    for (const side of [-0.7, 0.7]) {
      const o = c.createOscillator(); o.frequency.value = f * (1 + (this.rng() - 0.5) * 0.002);
      const vib = c.createOscillator(); vib.frequency.value = 3.5 + this.rng() * 1.5;
      const vg = c.createGain(); vg.gain.value = f * 0.0015; vib.connect(vg); vg.connect(o.frequency);
      const lfo = c.createOscillator(); lfo.frequency.value = 0.05 + this.rng() * 0.2;
      const lg = c.createGain(); lg.gain.value = 0.4 * lev;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lev * 0.6, t + att);
      g.gain.setValueAtTime(lev * 0.6, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + rel);
      lfo.connect(lg); lg.connect(g.gain);
      const p = c.createStereoPanner(); p.pan.value = side;
      o.connect(g); g.connect(p); p.connect(this.tracks['~shimmer'].input);
      for (const x of [o, vib, lfo]) { x.start(t); x.stop(t + dur + rel + 0.05); }
    }
  }

  percHit(kind, t, level) {
    const r = this.perc[kind];
    if (!r) return;
    const c = this.ctx;
    let ts = t;
    if (kind === 'cym_roll') ts = t - (r.peak || 0);          // roll lands on its target
    else ts = t - (r.onset || 0);
    const src = c.createBufferSource(); src.buffer = this.buffers[r.f];
    const g = c.createGain(); g.gain.value = level;
    src.connect(g); g.connect(this._voice('~perc'));
    const off = (r.off || 0) + Math.max(0, c.currentTime + 0.01 - ts);
    ts = Math.max(ts, c.currentTime + 0.01);
    src.start(ts, off);
    if (kind === 'cym_roll') { g.gain.setValueAtTime(level, t); g.gain.linearRampToValueAtTime(0, t + 0.15); src.stop(t + 0.2); }
  }

  // dispatch a composer event
  play(ev) {
    if (ev.type !== 'note' && ev.type !== 'gate' && ev.type !== 'shimmer' && this._gated(ev.t)) return;
    switch (ev.type) {
      case 'note': return this.note(ev);
      case 'sub': return this.sub(ev.t, ev.dur, ev.midi, ev.lev, ev.att, ev.rel);
      case 'boom': return this.boom(ev.t, ev.lev, ev.root);
      case 'riser': return this.riser(ev.t, ev.dur, ev.lev);
      case 'pad': return this.pad(ev.t, ev.dur, ev.midis, ev.lev);
      case 'shimmer': return this.shimmer(ev.t, ev.dur, ev.midi, ev.lev, ev.att, ev.rel);
      case 'perc': return this.percHit(ev.kind, ev.t, ev.lev);
      case 'gate': return this.gateOff(ev.t0, ev.t1);
    }
  }
}
