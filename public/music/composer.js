// Generative composer. Nothing here is a pre-written piece: every phrase is assembled in real time from primitives
// (form grammar, modal chord graph, motif + development operations, ostinato cells, an arranger), and every
// weighted choice is logged so the page can show the dice as you hear their consequences.

export const PCN = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_KEYS = new Set([2, 4, 6, 9, 11, 7]);
export const spell = (pc, tonic) => (SHARP_KEYS.has(tonic) ? ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']
  : ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'])[pc].replace('D#', 'Eb').replace('Gb', 'F#');

// ---------------------------------------------------------------------------
// theory primitives
// ---------------------------------------------------------------------------
export const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const MINORISH = new Set(['aeolian', 'dorian', 'phrygian']);
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];
const QN = { m: 'm', M: '', sus4: 'sus4', sus2: 'sus2', m9: 'm(add9)', add9: 'add9', maj7: 'maj7', m7: 'm7', '7sus': '7sus4' };
const QI = { m: [0, 3, 7], M: [0, 4, 7], sus4: [0, 5, 7], sus2: [0, 2, 7], m9: [0, 3, 7, 2], add9: [0, 4, 7, 2], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '7sus': [0, 5, 7, 10] };

function mkChord(tonic, mode, deg, color = 'plain', bassPc = null, forceMajor = false) {
  const sc = MODES[mode];
  const root = (tonic + sc[deg]) % 12;
  const third = (sc[(deg + 2) % 7] - sc[deg] + 12) % 12;
  const fifth = (sc[(deg + 4) % 7] - sc[deg] + 12) % 12;
  let q = third === 3 ? 'm' : 'M';
  if (forceMajor) q = 'M';
  if (fifth !== 7) q = 'sus4';                 // no diminished triads in this idiom
  if (color === 'add9') q = q === 'm' ? 'm9' : q === 'M' ? 'add9' : q;
  else if (color === 'seventh') q = q === 'm' ? 'm7' : q === 'M' ? (third === 4 && (sc[(deg + 6) % 7] - sc[deg] + 12) % 12 === 11 ? 'maj7' : 'add9') : '7sus';
  else if (color === 'sus') q = 'sus4';
  const pcs = QI[q].map((x) => (root + x) % 12);
  const bass = bassPc ?? root;
  const num = (q === 'm' || q === 'm9' || q === 'm7' ? ROMAN[deg] : ROMAN[deg].toUpperCase());
  const flat = (MODES.ionian[deg] - sc[deg]) > 0 ? 'b' : (sc[deg] - MODES.ionian[deg]) > 0 ? '#' : '';
  return { root, q, pcs, bass, deg, num: flat + num, name: spell(root, tonic) + QN[q] + (bass !== root ? '/' + spell(bass, tonic) : '') };
}
const midiOfPc = (pc, lo, hi) => { for (let p = lo; p <= hi; p++) if (((p % 12) + 12) % 12 === pc) return p; return lo; };
const bassNote = (ch, lo, hi) => midiOfPc(ch.bass, lo, hi);
function* combos(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i < arr.length; i++) { acc.push(arr[i]); yield* combos(arr, k, i + 1, acc); acc.pop(); }
}
function voicing(ch, nv, lo, hi, prev) {
  const pcs = ch.pcs;
  let cands = [];
  for (let h = hi; cands.length < nv; h += 3) { cands = []; for (let p = lo; p <= h; p++) if (pcs.includes(p % 12)) cands.push(p); }
  if (cands.length > 12) cands = cands.slice(0, 12);
  let best = null, bc = Infinity;
  for (const cmb of combos(cands, nv)) {
    let c = 0;
    const got = new Set(cmb.map((p) => p % 12));
    for (let i = 0; i < 2; i++) if (!got.has(pcs[i])) c += 6;
    if (pcs.length > 3 && !got.has(pcs[3])) c += 1.5;
    if (!got.has(pcs[2])) c += 1;
    if (cmb.filter((p) => p % 12 === pcs[1]).length > 1) c += 2.5;
    for (let i = 0; i + 1 < cmb.length; i++) {
      const iv = cmb[i + 1] - cmb[i];
      if (iv < 3 && cmb[i] < 60) c += 4;
      if (iv < 2) c += 3;
      if (iv > 9) c += (iv - 9) * 0.6;
    }
    if (prev) { const sp = [...prev].sort((a, b) => a - b); for (let i = 0; i < Math.min(sp.length, cmb.length); i++) c += 0.35 * Math.abs(cmb[i] - sp[i]); }
    else c += 0.05 * Math.abs(cmb.reduce((a, b) => a + b, 0) / nv - (lo + hi) / 2);
    if (c < bc) { bc = c; best = cmb; }
  }
  return best;
}
function chordTones(ch, lo, n = 5) {
  const t = []; for (let p = lo; t.length < n && p < lo + 36; p++) if (ch.pcs.includes(p % 12)) t.push(p);
  return t;
}
// scale-step walking in the current mode
function scaleStep(p, steps, tonic, mode) {
  const sc = MODES[mode];
  const inScale = (x) => sc.includes(((x - tonic) % 12 + 12) % 12);
  let q = p;
  while (!inScale(q)) q--;
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) { q += dir; while (!inScale(q)) q += dir; }
  return q;
}
const nearestChordTone = (p, ch, maxd = 4) => { let best = p, bd = 99; for (let q = p - maxd; q <= p + maxd; q++) if (ch.pcs.includes(((q % 12) + 12) % 12) && Math.abs(q - p) < bd) { bd = Math.abs(q - p); best = q; } return best; };

// ---------------------------------------------------------------------------
// grammar tables (weights, not scripts)
// ---------------------------------------------------------------------------
const CHORD_GRAPH = {        // degree -> {degree: weight}; film-minor bias toward VI-VII-i, plagal motion and falling thirds
  0: { 5: 3, 3: 2.5, 6: 2, 2: 1.5, 4: 1.5, 1: 0.5 },
  1: { 4: 3, 6: 1.5, 0: 1, 3: 1 },
  2: { 6: 2.5, 5: 2.5, 3: 2, 0: 1 },
  3: { 0: 2.5, 4: 2.5, 5: 1.5, 6: 2, 1: 0.5 },
  4: { 0: 3.5, 5: 2.5, 3: 1, 2: 0.7 },
  5: { 6: 3, 3: 2.5, 2: 1.5, 0: 1.5, 4: 1 },
  6: { 0: 3.5, 2: 2, 5: 1.5, 3: 1 },
};
const ROLES = {
  emerge:    { e: [0.1, 0.2],  len: [[4, 2], [6, 2], [8, 1]], phrase: 2, hr: [[2, 2], [1, 1]] },
  pulse:     { e: [0.28, 0.38], len: [[8, 3], [12, 1]], phrase: 4, hr: [[2, 3], [1, 1]] },
  song:      { e: [0.34, 0.5], len: [[8, 2], [12, 1], [16, 1]], phrase: 4, hr: [[2, 3], [1, 2]] },
  shadow:    { e: [0.3, 0.44], len: [[6, 1], [8, 2]], phrase: 2, hr: [[1, 2], [2, 1]] },
  still:     { e: [0.18, 0.24], len: [[4, 1], [8, 1]], phrase: 4, hr: [[2, 2], [4, 1]] },
  build:     { e: [0.45, 0.8], len: [[8, 2], [12, 2], [16, 1]], phrase: 4, hr: [[1, 2], [2, 2]] },
  breath:    { e: [0.38, 0.66], len: [[2, 1], [4, 2]], phrase: 2, hr: [[1, 1]] },
  arrival:   { e: [0.86, 1.0], len: [[8, 2], [12, 1], [16, 1]], phrase: 4, hr: [[2, 3], [1, 1]] },
  afterglow: { e: [0.6, 0.42], len: [[4, 1], [8, 1]], phrase: 4, hr: [[2, 2]] },
  coda:      { e: [0.22, 0.07], len: [[6, 1], [8, 1]], phrase: 2, hr: [[1, 1], [2, 1]] },
};
const NEXT_ROLE = {
  start: { emerge: 6, pulse: 2.5, shadow: 1.5, still: 0.7 },
  emerge: { pulse: 4.5, song: 3.5, shadow: 2 },
  pulse: { song: 4.5, build: 2.5, shadow: 2, still: 1 },
  song: { build: 3.5, shadow: 2.5, pulse: 1.5, song: 1, still: 1 },
  shadow: { build: 5.5, song: 2, pulse: 1.5, still: 1 },
  still: { pulse: 3, song: 3, build: 3, coda: 1 },
  build: { breath: 4.5, arrival: 4.5, shadow: 1 },
  breath: { arrival: 1 },
  arrival: { afterglow: 3.5, coda: 4, arrival: 1, still: 1.5 },
  afterglow: { coda: 7, still: 3 },
};
const OST_CONTOURS = { up: [0, 1, 2, 3], updown: [0, 1, 2, 1], pendulum: [0, 2, 1, 3], broken: [0, 2, 1, 2], fifths: [0, 1], rising3: [0, 1, 2], turn: [1, 0, 1, 2], arpdown: [3, 2, 1, 0] };
const GROUPINGS = { 8: [[3, 3, 2], [3, 2, 3], [2, 3, 3], [2, 2, 2, 2], [4, 4], [3, 3, 1, 1]], 6: [[3, 3], [2, 2, 2], [4, 2]], 16: [[3, 3, 2, 3, 3, 2], [3, 3, 3, 3, 4], [4, 4, 4, 4], [3, 3, 2, 2, 3, 3]], 12: [[3, 3, 3, 3], [6, 6], [4, 4, 4]], 9: [[3, 3, 3]] };

// instruments per arranger role: [track, weight, minEnergy, maxEnergy, register]
const CAND = {
  pad: [['vla_pad', 3, 0.15, 1, [53, 66]], ['vln_pad', 2.5, 0.3, 1, [69, 82]], ['horns_chords', 2, 0.3, 1, [48, 62]], ['organ_soft', 1.6, 0.1, 0.6, [57, 70]],
    ['organ', 1.4, 0.5, 1, [62, 74]], ['trombones', 1.4, 0.6, 1, [41, 62]], ['vln_trem', 1, 0.28, 0.75, [67, 79]], ['vln_high', 1.6, 0, 0.32, [79, 91]], ['~pad', 1.2, 0.1, 1, [50, 64]]],
  ost: [['piano', 3.2, 0.1, 1, 60], ['clarinets', 2, 0.25, 1, 62], ['vla_spic', 2, 0.36, 1, 57], ['vln_spic', 1.6, 0.48, 1, 69], ['harp', 1.8, 0.1, 1, 62],
    ['marimba', 1.6, 0.15, 0.9, 60], ['flutes', 1.1, 0.55, 1, 74], ['organ_arp', 1, 0.62, 1, 74], ['glock', 0.8, 0.1, 0.6, 79], ['vln_pizz', 1.1, 0.15, 0.55, 62]],
  mel: [['vln_theme', 3, 0.2, 1, 0], ['vc_theme', 2, 0.2, 1, -12], ['horns', 2, 0.42, 1, -12], ['trumpets', 1, 0.76, 1, 0], ['oboe', 1.6, 0.15, 0.62, 0],
    ['piano_mel', 1.4, 0, 0.45, 0], ['flutes', 0.9, 0.3, 0.8, 12], ['clarinets', 0.8, 0.2, 0.6, -12]],
  bass: [['sustain', 3, 0, 1], ['pedal', 1.6, 0, 0.7], ['pulse', 2.2, 0.35, 1], ['octaves', 1.6, 0.2, 1], ['pizz', 1, 0.15, 0.55]],
};
const BASS_TRACK = { sustain: 'basses', pedal: 'organ_pedal', pulse: 'vc_spic', octaves: 'piano_low', pizz: 'vc_pizz' };
const DEV_OPS = {
  song: { repeat: 3, sequence: 3, answer: 2, ornament: 1.5, fragment: 1 },
  pulse: { repeat: 2, sequence: 2, fragment: 2, answer: 1 },
  build: { sequence: 3.5, fragment: 2.5, repeat: 1.5, climb: 2.5 },
  arrival: { repeat: 3, augment: 2.5, climb: 2, sequence: 1.5 },
  afterglow: { augment: 3, answer: 2, repeat: 1.5 },
  shadow: { invert: 3, fragment: 2, sequence: 1 },
  emerge: { fragment: 3, augment: 2, repeat: 1 },
  still: { augment: 2, invert: 1.5, fragment: 2 },
  coda: { augment: 3, fragment: 2, answer: 2 },
  breath: { fragment: 3, climb: 2 },
};
const pretty = (tr) => ({ vla_pad: 'violas', vln_pad: 'violins', horns_chords: 'horn choir', organ_soft: 'soft organ', organ: 'full organ', trombones: 'trombones', vln_trem: 'tremolo violins',
  vln_high: 'high violins', '~pad': 'synth pad', piano: 'piano', clarinets: 'clarinets', vla_spic: 'viola spiccato', vln_spic: 'violin spiccato', harp: 'harp', marimba: 'marimba',
  flutes: 'flutes', organ_arp: 'organ arpeggio', glock: 'glockenspiel', vln_pizz: 'violin pizzicato', vln_theme: 'violins', vc_theme: 'cellos', horns: 'horns', trumpets: 'trumpets',
  oboe: 'oboe', piano_mel: 'piano', sustain: 'sustained basses', pedal: 'organ pedal', pulse: 'cello pulse', octaves: 'piano octaves', pizz: 'cello pizzicato' }[tr] || tr);

// ---------------------------------------------------------------------------
export class Composer {
  constructor(seed) {
    let s = seed >>> 0 || 1;
    this.rng = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.t = 0.3;
    this.pieceNo = 0;
    this.piece = null;
    this.sec = null;
    this.rolls = 0;
    this.decisions = [];
    this.tonic = null;
    this.lastE = 0;
  }

  // ------- the dice: every musical decision goes through here and is logged --------
  pick(level, label, opts, t, quiet = false) {
    const live = opts.filter((o) => o[1] > 0);
    const tot = live.reduce((a, o) => a + o[1], 0);
    let x = this.rng() * tot, idx = live.length - 1;
    for (let i = 0; i < live.length; i++) { x -= live[i][1]; if (x <= 0) { idx = i; break; } }
    this.rolls++;
    if (!quiet) this.decisions.push({ t, level, label, chosen: idx, options: live.map((o) => ({ name: o[2] ?? String(o[0]), p: o[1] / tot })) });
    return live[idx][0];
  }
  chance(level, label, p, t, yes = 'yes', no = 'no', quiet = false) { return this.pick(level, label, [[true, p, yes], [false, 1 - p, no]], t, quiet); }
  roll(opts) { return this.pick('', '', opts, 0, true); }

  // ------- piece ---------------------------------------------------------------
  newPiece() {
    const t = this.t;
    const P = { no: ++this.pieceNo, sections: 0, elapsed: 0, peaked: false, t0: t };
    if (this.tonic === null) this.tonic = this.pick('piece', 'Key', [2, 5, 7, 9, 0, 4, 10, 3].map((k) => [k, 1, spell(k, k)]), t);
    else {
      const iv = this.pick('piece', 'Modulation', [[3, 2.5, 'up a minor 3rd'], [8, 2, 'down a major 3rd'], [5, 2, 'up a 4th'], [7, 1.6, 'up a 5th'], [2, 1.2, 'up a step'], [1, 0.5, 'up a half step'], [0, 0.8, 'same key']], t);
      this.tonic = (this.tonic + iv) % 12;
    }
    P.tonic = this.tonic;
    P.mode = this.pick('piece', 'Mode', [['aeolian', 4.5, 'Aeolian (minor)'], ['dorian', 2, 'Dorian'], ['phrygian', 0.8, 'Phrygian'], ['ionian', 1.2, 'Ionian (major)'], ['mixolydian', 0.8, 'Mixolydian'], ['lydian', 0.9, 'Lydian']], t);
    P.homeMode = P.mode;
    P.bpm = this.pick('piece', 'Tempo', [[80, 1], [86, 1.5], [90, 2], [94, 2.5], [98, 2], [104, 1.2], [110, 0.6]].map(([b, w]) => [b, w, b + ' bpm']), t);
    P.meter = this.pick('piece', 'Meter', [[{ beats: 4, E: 8, name: '4/4' }, 7, '4/4'], [{ beats: 3, E: 6, name: '3/4' }, 1.4, '3/4'], [{ beats: 3, E: 6, name: '6/8' }, 1.6, '6/8']], t);
    P.targetSecs = this.pick('piece', 'Length', [[200, 1, 'about 3.5 min'], [260, 2, 'about 4.5 min'], [320, 1.5, 'about 5.5 min'], [380, 0.7, 'about 6.5 min']], t);
    P.palette = this.pick('piece', 'Palette', [['strings', 3, 'strings-led'], ['brass', 1.5, 'brass-led'], ['keys', 2, 'keys and mallets'], ['winds', 1.2, 'woodwind colours'], ['organ', 1.2, 'organ-led']], t);
    let anchor = 60 + ((this.tonic + 7) % 12); while (anchor < 65) anchor += 12; while (anchor > 72) anchor -= 12;
    P.anchor = anchor;          // the 5th of the key in the violin octave: where melodies ask their question
    P.motif = this.makeMotif(P, t);
    P.prevChord = null;
    P.layers = { bass: [], pad: [], ost: [], mel: [] };
    P.energy = 0.15;
    this.piece = P;
  }

  makeMotif(P, t) {
    const E = P.meter.E;
    const bars = this.pick('motif', 'Motif length', [[1, 1, '1 bar'], [2, 2.2, '2 bars']], t);
    const total = E * bars;
    const feel = this.pick('motif', 'Motif rhythm', [['long', 3, 'long notes'], ['question', 2.5, 'question (long-short-long)'], ['dotted', 1.6, 'dotted'], ['flowing', 1.4, 'flowing']], t);
    const vocab = { long: [[8, 2], [6, 3], [4, 3], [2, 1.5]], question: [[3, 3], [2, 2], [4, 2], [6, 2]], dotted: [[3, 3], [1, 2.5], [4, 2], [6, 1]], flowing: [[2, 4], [1, 2], [4, 2], [3, 1]] }[feel];
    const durs = [];
    let left = total;
    while (left > 0) {
      const fit = vocab.filter(([d]) => d <= left);
      const d = fit.length ? this.roll(fit.map(([d, w]) => [d, w])) : left;
      durs.push(d); left -= d;
    }
    if (durs.length < 2) durs.splice(0, 1, Math.ceil(total / 2), Math.floor(total / 2));
    const shape = this.pick('motif', 'Motif contour', [['question', 3, 'leap up, then steps'], ['arch', 2.2, 'arch'], ['rise', 1.6, 'rising'], ['sigh', 1.4, 'sighing fall'], ['valley', 1, 'valley']], t);
    const steps = [0];
    for (let i = 1; i < durs.length; i++) {
      const prev = steps[i - 1];
      let st;
      if (shape === 'question') st = i === 1 ? this.roll([[3, 2], [4, 1.5], [2, 1]]) : this.roll([[1, 2], [-1, 1.5], [0, 0.5]]);
      else if (shape === 'arch') st = i < durs.length / 2 ? this.roll([[1, 2], [2, 1.5]]) : this.roll([[-1, 2], [-2, 1]]);
      else if (shape === 'rise') st = this.roll([[1, 3], [2, 1.5], [-1, 0.5]]);
      else if (shape === 'sigh') st = i === 1 ? this.roll([[2, 1], [4, 1]]) : this.roll([[-1, 3], [-2, 0.8]]);
      else st = i < durs.length / 2 ? this.roll([[-1, 2], [-2, 1]]) : this.roll([[1, 2], [2, 1]]);
      steps.push(Math.max(-5, Math.min(8, prev + st)));
    }
    return { durs, steps, bars, feel, shape };
  }

  // ------- section -------------------------------------------------------------
  newSection() {
    if (!this.piece || this.piece.done) this.newPiece();
    const P = this.piece, t = this.t;
    const prev = this.sec && this.sec.piece === P.no ? this.sec.role : 'start';
    let w = { ...(NEXT_ROLE[prev] || NEXT_ROLE.start) };
    const late = P.elapsed > P.targetSecs * 0.65, over = P.elapsed > P.targetSecs;
    if (late && !P.peaked) { w.build = (w.build || 0) * 2 + 2; w.arrival = (w.arrival || 0) * 2; w.song = (w.song || 0) * 0.5; w.pulse = (w.pulse || 0) * 0.4; }
    if (P.peaked) { w.coda = (w.coda || 0) + 2 + (over ? 6 : 0); w.arrival = (w.arrival || 0) * 0.3; w.build = (w.build || 0) * 0.3; }
    if (over && !P.peaked) w = prev === 'build' ? { breath: 4, arrival: 4 } : { build: 3 };
    if (P.sections < 2) delete w.coda;
    if (prev === 'breath') w = { arrival: 1 };
    const role = this.pick('section', 'Next section', Object.entries(w).filter(([, v]) => v > 0).map(([k, v]) => [k, v, k[0].toUpperCase() + k.slice(1)]), t);
    const R = ROLES[role];
    const bars = this.pick('section', 'Section length', R.len.map(([b, w]) => [b, w, b + ' bars']), t);
    const jitter = (this.rng() - 0.5) * 0.08;
    let e0 = R.e[0] + jitter, e1 = R.e[1] + jitter;
    if (role === 'build') e0 = Math.max(0.3, Math.min(0.55, P.energy));
    const S = { piece: P.no, role, bars, bar: 0, e0, e1, t0: t, phraseLen: R.phrase };
    S.hr = this.pick('harmony', 'Harmonic rhythm', R.hr.map(([b, w]) => [b, w, b === 1 ? 'chord per bar' : b + ' bars per chord']), t);
    S.mode = P.mode;
    if (role === 'shadow' && MINORISH.has(P.homeMode)) S.mode = this.pick('harmony', 'Shadow colour', [['phrygian', 2, 'darken to Phrygian'], [P.homeMode, 2, 'stay ' + P.homeMode]], t);
    if (role === 'arrival' || role === 'afterglow' || (role === 'coda' && P.peaked)) {
      if (!P.arrivalMode) P.arrivalMode = MINORISH.has(P.homeMode) ? this.pick('harmony', 'Arrival mode', [['ionian', 3, 'burst into major'], ['lydian', 0.8, 'lift to Lydian'], [P.homeMode, 2.2, 'stay dark']], t) : P.homeMode;
      S.mode = P.arrivalMode;
    }
    if (role === 'arrival' && P.peaked && this.chance('harmony', 'Key lift for the second wave', 0.4, t, 'lift a step', 'stay')) { this.tonic = (this.tonic + 2) % 12; P.tonic = this.tonic; }
    S.pedal = ['emerge', 'shadow', 'still'].includes(role) ? this.chance('harmony', 'Pedal point', 0.65, t, 'hold the tonic', 'free bass')
      : role === 'build' ? this.chance('harmony', 'Pedal point', 0.35, t, 'tonic pedal under the build', 'free bass') : false;
    S.bpm = role === 'coda' ? Math.round(P.bpm * 0.82) : P.bpm;
    S.rit = role === 'coda';
    if (role === 'coda' && this.cutPending) { this.t += 60 / P.bpm * P.meter.beats; S.t0 = this.t; }
    this.cutPending = false;
    S.motifOps = 0;
    if (role !== 'emerge' && role !== 'breath' && P.sections > 1 && this.chance('motif', 'Motif mutation', 0.3, t, 'mutate the motif', 'keep it')) this.mutateMotif(P, t);
    if (role === 'arrival') P.peaked = true;
    P.sections++;
    this.sec = S;
  }

  mutateMotif(P, t) {
    const m = P.motif;
    const op = this.pick('motif', 'Mutation', [['interval', 3, 'change an interval'], ['rhythm', 2, 'swap two durations'], ['extend', 1, 'extend the tail'], ['leap', 1.4, 'widen the opening leap']], t);
    const i = 1 + Math.floor(this.rng() * Math.max(1, m.steps.length - 1));
    if (op === 'interval' && m.steps.length > 1) m.steps[i] = Math.max(-5, Math.min(8, m.steps[i] + (this.rng() < 0.5 ? -1 : 1)));
    else if (op === 'rhythm' && m.durs.length > 2) { const j = Math.min(m.durs.length - 1, i + 1); [m.durs[i], m.durs[j]] = [m.durs[j], m.durs[i]]; }
    else if (op === 'extend') { const last = m.durs.length - 1; if (m.durs[last] >= 2 && m.durs[last] % 2 === 0) { const d = m.durs[last]; m.durs[last] = d / 2; m.durs.push(d / 2); m.steps.push(m.steps[last] - 1); } }
    else if (op === 'leap' && m.steps.length > 1) { for (let k = 1; k < m.steps.length; k++) m.steps[k] = Math.min(8, m.steps[k] + 1); }
  }

  // ------- harmony for one phrase ---------------------------------------------------
  phraseChords(P, S, bars, t, isLast, barTime) {
    const nCh = Math.max(1, Math.round(bars / S.hr));
    const mode = S.mode, T = P.tonic;
    const usable = (d) => { const sc = MODES[mode]; return (sc[(d + 4) % 7] - sc[d] + 12) % 12 === 7 || d === 4; };
    const degs = [];
    let cur = P.prevChord && P.prevChord.mode === mode ? P.prevChord.deg : 0;
    for (let i = 0; i < nCh; i++) {
      let d;
      const tc = barTime(i * bars / nCh);
      if (i === 0 && S.bar === 0) {
        d = ['arrival', 'emerge', 'pulse', 'coda'].includes(S.role) ? 0 : this.pick('harmony', 'Opening chord', [[0, 4, 'tonic'], [5, 1, mkChord(T, mode, 5).num], [3, 0.7, mkChord(T, mode, 3).num]], tc);
      } else {
        const g = CHORD_GRAPH[cur];
        d = this.pick('harmony', 'Next chord', Object.entries(g).filter(([k]) => usable(+k)).map(([k, w]) => [+k, w, mkChord(T, mode, +k).num]), tc);
      }
      degs.push(d); cur = d;
    }
    let cadence = 'open';
    if (isLast && nCh >= 2 && !['emerge', 'still'].includes(S.role)) {
      const opts = S.role === 'build' || S.role === 'breath' ? [['half', 3, 'half cadence (V)'], ['aeolian', 2.5, 'VI to VII climb'], ['open', 1, 'open']]
        : S.role === 'coda' ? [['authentic', 2, 'V to I'], ['plagal', 3, 'IV to I (amen)']]
          : [['authentic', 1.5, 'V to i'], ['plagal', 1.5, 'iv to i'], ['deceptive', 1.2, 'deceptive (V to VI)'], ['half', 1.5, 'half cadence'], ['aeolian', 1.5, 'VI to VII'], ['open', 2, 'open']];
      cadence = this.pick('harmony', 'Cadence', opts, barTime(bars - bars / nCh));
      const L = degs.length;
      if (cadence === 'authentic') { degs[L - 2] = 4; degs[L - 1] = 0; }
      else if (cadence === 'plagal') { degs[L - 2] = 3; degs[L - 1] = 0; }
      else if (cadence === 'deceptive') { degs[L - 2] = 4; degs[L - 1] = 5; }
      else if (cadence === 'half') degs[L - 1] = 4;
      else if (cadence === 'aeolian') { degs[L - 2] = 5; degs[L - 1] = 6; }
    }
    if (S.role === 'coda' && isLast) degs[degs.length - 1] = 0;
    const chords = degs.map((d, i) => {
      const color = this.roll([['plain', 5], ['add9', 2.2], ['seventh', 1.2], ['sus', d === 4 ? 1.5 : 0.4]]);
      const domMajor = d === 4 && MINORISH.has(mode) && ['authentic', 'half', 'deceptive'].includes(cadence) && i >= nCh - 2;
      const final = S.role === 'coda' && isLast && i === nCh - 1;
      const ch = mkChord(T, mode, d, final ? 'add9' : (color === 'sus' && domMajor ? 'plain' : color), S.pedal ? T : null, domMajor);
      ch.mode = mode;
      return ch;
    });
    P.prevChord = chords[chords.length - 1];
    return { chords, cadence };
  }

  // ------- arranger: decides who plays, per role, at each phrase boundary ------------------------
  arrange(P, S, e, t) {
    const L = P.layers;
    const palBias = {
      strings: { vla_pad: 1.5, vln_pad: 1.5, vln_theme: 1.5, vc_theme: 1.4, vla_spic: 1.4 }, brass: { horns: 2, horns_chords: 2, trombones: 1.6, trumpets: 1.5 },
      keys: { piano: 1.5, marimba: 2, glock: 1.6, harp: 1.5, piano_mel: 1.6 }, winds: { clarinets: 1.8, flutes: 1.8, oboe: 2.2 }, organ: { organ: 2, organ_soft: 2, organ_arp: 2 },
    }[P.palette] || {};
    const busy = new Set(Object.values(L).flat().map((l) => l.track));
    const budget = {
      bass: e < 0.3 ? 1 : e < 0.7 ? 2 : 3,
      pad: e < 0.2 ? 1 : e < 0.4 ? 2 : e < 0.7 ? 3 : 4,
      ost: S.role === 'emerge' ? (e < 0.15 ? 0 : 1) : e < 0.25 ? 1 : e < 0.45 ? 2 : e < 0.75 ? 3 : 4,
      mel: ['song', 'build', 'arrival', 'afterglow', 'coda', 'still'].includes(S.role) ? (e < 0.55 ? 1 : e < 0.85 ? 2 : 3)
        : (S.role === 'emerge' || S.role === 'shadow') && this.rng() < 0.45 ? 1 : 0,
    };
    for (const role of ['bass', 'pad', 'ost', 'mel']) {
      const cands = CAND[role];
      const fits = (c) => c && e >= c[2] - 0.04 && e <= c[3] + 0.04;
      const candOf = (l) => cands.find((c) => c[0] === (l.kind || l.track));
      for (const l of [...L[role]]) {
        if (!fits(candOf(l))) {
          L[role] = L[role].filter((x) => x !== l); busy.delete(l.track);
          this.decisions.push({ t, level: 'layer', label: `${l.desc} bows out`, chosen: 0, options: [{ name: 'energy moved out of its range', p: 1 }] });
        }
      }
      while (L[role].length > budget[role]) {
        const victim = this.pick('layer', `${role === 'ost' ? 'Ostinato' : role === 'mel' ? 'Melody' : role === 'pad' ? 'Harmony' : 'Bass'}: who drops out`, L[role].map((l) => [l, 1 + l.age, l.desc]), t);
        L[role] = L[role].filter((x) => x !== victim); busy.delete(victim.track);
      }
      if (L[role].length && role !== 'bass' && this.rng() < 0.12) {
        const victim = this.pick('layer', `${role === 'ost' ? 'Ostinato' : role === 'mel' ? 'Melody' : 'Harmony'}: hand over`, L[role].map((l) => [l, 1 + l.age, l.desc]), t);
        L[role] = L[role].filter((x) => x !== victim); busy.delete(victim.track);
      }
      while (L[role].length < budget[role]) {
        const opts = cands.filter((c) => fits(c) && !busy.has(role === 'bass' ? BASS_TRACK[c[0]] : c[0]) && !(role === 'bass' && L.bass.some((l) => l.kind === c[0])))
          .map((c) => [c, c[1] * (palBias[c[0]] || 1), pretty(c[0])]);
        if (!opts.length) break;
        const c = this.pick('layer', `${role === 'ost' ? 'Ostinato' : role === 'mel' ? 'Melody' : role === 'pad' ? 'Harmony' : 'Bass'}: who joins`, opts, t);
        const layer = this.makeLayer(P, S, role, c, t);
        L[role].push(layer); busy.add(layer.track);
      }
      for (const l of L[role]) l.age++;
    }
  }

  makeLayer(P, S, role, c, t) {
    const E = P.meter.E;
    if (role === 'bass') {
      const kind = c[0];
      const L = { role, kind, track: BASS_TRACK[kind], age: 0, desc: pretty(kind) };
      if (kind === 'pulse' || kind === 'pizz') L.grouping = this.pick('pattern', 'Bass accents', (GROUPINGS[E] || GROUPINGS[8]).map((g) => [g, 1, g.join('+')]), t);
      return L;
    }
    if (role === 'pad') return { role, track: c[0], reg: c[4], age: 0, desc: pretty(c[0]), prev: null };
    if (role === 'mel') return { role, track: c[0], oct: c[4], age: 0, desc: pretty(c[0]) + ' (melody)' };
    const track = c[0];
    const subs = [['e', 3, '8ths'], ['s', ['piano', 'marimba', 'organ_arp', 'harp'].includes(track) ? 1.6 : 0.3, '16ths']];
    if (P.meter.name !== '6/8') subs.push(['t', ['harp', 'flutes', 'marimba', 'glock'].includes(track) ? 2 : 0.4, 'triplets']);
    const sub = this.pick('pattern', `${pretty(track)}: subdivision`, subs, t);
    const slots = sub === 'e' ? E : sub === 's' ? E * 2 : P.meter.beats * 3;
    const contour = this.pick('pattern', `${pretty(track)}: cell shape`, Object.keys(OST_CONTOURS).map((k) => [k, k === 'up' || k === 'broken' ? 2 : 1, k]), t);
    const process = this.pick('pattern', `${pretty(track)}: process`, [['group', 3, 'restart each group'], ['cycle', 2, 'cycle freely (phasing)'], ['grow', 1, 'additive growth']], t);
    const grouping = process === 'grow' ? [slots] : this.pick('pattern', `${pretty(track)}: accent grouping`, (GROUPINGS[slots] || [[slots]]).map((g) => [g, 1, g.join('+')]), t);
    return { role, track, sub, slots, cell: OST_CONTOURS[contour], contour, process, grouping, base: c[4], age: 0, desc: `${pretty(track)} (${contour}, ${{ e: '8ths', s: '16ths', t: 'triplets' }[sub]}, ${process === 'grow' ? 'growing' : grouping.join('+')})` };
  }

  // ------- one phrase of music -----------------------------------------------------------
  next() {
    if (!this.sec || this.sec.bar >= this.sec.bars) {
      if (this.sec && this.sec.role === 'coda') this.piece.done = true;
      this.newSection();
    }
    const P = this.piece, S = this.sec;
    const bars = Math.min(S.phraseLen, S.bars - S.bar);
    const isLast = S.bar + bars >= S.bars;
    const t0 = this.t, beats = P.meter.beats, E = P.meter.E;
    const barDur = 60 / S.bpm * beats;
    const timeOf = (barF) => {
      if (!S.rit) return t0 + barF * barDur;
      let tt = t0; const steps = Math.max(1, Math.ceil(barF * 8));
      for (let k = 0; k < steps; k++) { const b = S.bar + ((k + 0.5) / steps) * barF; const slow = 1 + 0.35 * Math.max(0, (b - (S.bars - 3)) / 3); tt += (barF / steps) * barDur * slow; }
      return tt;
    };
    const eAt = (barF) => S.e0 + (S.e1 - S.e0) * Math.min(1, (S.bar + barF) / S.bars);
    const e = eAt(0.5 * bars);
    P.energy = e;
    const dec0 = this.decisions.length;
    if (S.bar === 0) for (const d of this.decisions) d.t = Math.max(d.t, t0);
    this.arrange(P, S, e, t0);
    const { chords, cadence } = this.phraseChords(P, S, bars, t0, isLast, timeOf);
    const per = bars / chords.length;
    const chordAt = (barF) => chords[Math.min(chords.length - 1, Math.floor(barF / per + 1e-9))];
    const chordSpan = chords.map((ch, i) => [i * per, (i + 1) * per, ch]);
    const ev = [];
    const note = (track, b0, b1, pitch, lev) => {
      if (b1 <= b0) return;
      const ta = timeOf(b0), tb = timeOf(b1);
      ev.push({ type: 'note', track, t: ta, dur: Math.max(0.05, tb - ta), pitch, lev });
    };
    const L = P.layers;
    const dynBase = { bass: 0.12, pad: 0.06, ost: 0.1, mel: 0.22 };
    const lev = (role, barF) => Math.min(1, dynBase[role] + 0.82 * Math.pow(eAt(barF), 1.15));
    const ped = (ch) => (S.pedal ? { ...ch, bass: P.tonic } : ch);

    // ---- bass ----
    for (const l of L.bass) {
      if (l.kind === 'sustain' || l.kind === 'pedal' || l.kind === 'octaves') {
        for (const [a, b, ch0] of chordSpan) {
          const ch = l.kind === 'pedal' ? { ...ch0, bass: P.tonic } : ped(ch0);
          if (l.kind === 'sustain') { note('basses', a, b, bassNote(ch, 28, 39), lev('bass', a)); note('vc_pad', a, b, bassNote(ch, 36, 47), lev('bass', a) * 0.95); }
          else if (l.kind === 'pedal') { note('organ_pedal', a, b, bassNote(ch, 36, 47), lev('bass', a)); note('organ_pedal', a, b, bassNote(ch, 24, 35), lev('bass', a) * 0.95); }
          else { const bn = bassNote(ch, 36, 47); note('piano_low', a, b, bn, lev('bass', a) * 0.9); note('piano_low', a + 0.004, b, bn - 12, lev('bass', a) * 0.8); }
        }
      } else {
        const tr = l.track;
        const starts = new Set(); let k = 0; for (const g of l.grouping) { starts.add(k); k += g; }
        for (let b = 0; b < bars; b++) {
          const ch = ped(chordAt(b)), bn = bassNote(ch, 36, 47);
          for (let i = 0; i < E; i++) note(tr, b + i / E, b + (i + 0.8) / E, starts.has(i) ? bn - 12 : bn, lev('bass', b) * (starts.has(i) ? 1.12 : 0.85));
          if (l.kind === 'pulse' && e > 0.6) for (const i of starts) note('basses_spic', b + i / E, b + (i + 0.9) / E, bassNote(ch, 28, 39), lev('bass', b));
        }
      }
    }
    // ---- pads ----
    for (const l of L.pad) {
      for (const [a, b, ch] of chordSpan) {
        if (l.track === '~pad') { const v = voicing(ch, 4, 50, 64, l.prev); l.prev = v; ev.push({ type: 'pad', t: timeOf(a), dur: timeOf(b) - timeOf(a), midis: v, lev: 0.06 + 0.12 * e }); continue; }
        const nv = l.track === 'organ' || l.track === 'organ_soft' ? 4 : l.track === 'vln_high' ? 2 : 3;
        const v = voicing(ch, nv, l.reg[0], l.reg[1], l.prev); l.prev = v;
        for (const p of v) note(l.track, a, b, p, lev('pad', a));
      }
    }
    // ---- ostinati ----
    for (const l of L.ost) {
      const n = l.slots;
      for (let b = 0; b < bars; b++) {
        const ch = chordAt(b);
        const tones = chordTones(ch, midiOfPc(ch.pcs[2], l.base - 3, l.base + 8), 5);
        let groups = l.grouping;
        if (l.process === 'grow') { const g = 2 + ((S.bar + b) % 4); groups = []; let left = n; while (left > 0) { groups.push(Math.min(g, left)); left -= g; } }
        let pos = 0;
        for (const g of groups) {
          for (let j = 0; j < g && pos < n; j++, pos++) {
            const idx = l.process === 'cycle' ? ((S.bar + b) * n + pos) % l.cell.length : j % l.cell.length;
            const pitch = tones[l.cell[idx] % tones.length];
            note(l.track, b + pos / n, b + (pos + 1) / n, pitch, lev('ost', b) * (j === 0 ? 1.12 : 0.88));
          }
        }
      }
    }
    // ---- melody: the motif, developed ----
    if (L.mel.length) {
      const m = P.motif;
      const stmts = Math.max(1, Math.floor(bars / m.bars));
      const ops = DEV_OPS[S.role] || DEV_OPS.song;
      const line = [];
      const arch = [0, 2, 4, 1, 3, 5, 2, 0];
      const lift0 = { arrival: 4, afterglow: 2, build: 2, song: 0, coda: 0 }[S.role] ?? 0;
      for (let k = 0; k < stmts; k++) {
        const op = k === 0 && S.motifOps === 0 ? 'repeat' : this.pick('motif', 'Development', Object.entries(ops).map(([o, w]) => [o, w, o]), timeOf(k * m.bars));
        S.motifOps++;
        let durs = m.durs.slice(), steps = m.steps.slice();
        const full = m.bars * E;
        if (op === 'invert') steps = steps.map((s) => -s);
        if (op === 'augment') { const out = [], st = []; let tot = 0; for (let i = 0; i < durs.length && tot < full; i++) { const d = Math.min(durs[i] * 2, full - tot); out.push(d); st.push(steps[i]); tot += d; } durs = out; steps = st; }
        if (op === 'fragment') { const half = Math.max(1, Math.ceil(durs.length / 2)); const fd = durs.slice(0, half); const tot = fd.reduce((a, b) => a + b, 0); if (tot * 2 <= full) { durs = fd.concat(fd); steps = steps.slice(0, half).concat(steps.slice(0, half).map((s) => s + 1)); durs[durs.length - 1] += full - tot * 2; } }
        if (op === 'answer') steps = steps.map((s, i) => (i === steps.length - 1 ? 0 : s));
        if (op === 'ornament') { const d2 = [], s2 = []; durs.forEach((d, i) => { if (d >= 4 && i + 1 < durs.length && Math.abs(steps[i + 1] - steps[i]) >= 2) { d2.push(d - 1, 1); s2.push(steps[i], steps[i] + Math.sign(steps[i + 1] - steps[i])); } else { d2.push(d); s2.push(steps[i]); } }); durs = d2; steps = s2; }
        const lift = op === 'sequence' ? (k % 2 ? 1 : -1) * (this.rng() < 0.4 ? 2 : 1) : op === 'climb' ? 1 + k : 0;
        const ch = chordAt(k * m.bars);
        const target = scaleStep(P.anchor, arch[k % arch.length] + lift0 + lift, P.tonic, S.mode);
        const anchor = nearestChordTone(target, ch, 3);
        let pos = k * full;
        const end = (k + 1) * full;
        for (let i = 0; i < durs.length && pos < end; i++) {
          const d = Math.min(durs[i], end - pos);
          const barF = pos / E;
          let p = scaleStep(anchor, steps[i], P.tonic, S.mode);
          if (pos % (E / 2) === 0 || d >= 4) p = nearestChordTone(p, chordAt(barF), 2);
          line.push([barF, (pos + d) / E, p]);
          pos += d;
        }
      }
      if (line.length) line[line.length - 1][1] = bars;
      for (const l of L.mel) {
        for (const [a, b, p] of line) note(l.track, a, b, Math.max(43, Math.min(96, p + l.oct)), lev('mel', a));
        if (e > 0.85 && l.track === 'vln_theme') for (const [a, b, p] of line) if (p + 12 <= 98) note('vln_theme', a, b, p + 12, lev('mel', a) * 0.9);
      }
    }
    // ---- percussion & sound design ----
    if (e > 0.42) {
      const pat = S.timp || (S.timp = this.pick('pattern', 'Timpani pattern', [['downbeat', 3, 'downbeats'], ['pickup', 2, 'downbeat + pickup'], ['half', beats === 4 ? 1.2 : 0, 'half notes'], ['rolls', 1, 'rolls']], t0));
      for (let b = 0; b < bars; b++) {
        const bn = bassNote(chordAt(b), 33, 44), l = Math.min(1, 0.2 + eAt(b));
        if (pat === 'rolls') { if (b % 2 === 1) note('timp_roll', b, b + 1, bn, Math.min(1, 0.3 + eAt(b) * 0.5)); }
        else {
          note('timpani', b, b + 0.5, bn, l);
          if (pat === 'half') note('timpani', b + 0.5, b + 1, bn, l * 0.8);
          if (pat === 'pickup') note('timpani', b + (E - 1) / E, b + 1, bn, l * 0.75);
        }
      }
    }
    if (S.role === 'arrival') for (let b = 0; b < bars; b++) ev.push({ type: 'perc', kind: 'bd_f', t: timeOf(b), lev: 0.35 + 0.3 * eAt(b) });
    // sub pulse re-struck each bar: a whisper in songs, a wall in arrivals
    const subLev = (x) => 0.05 + 0.75 * Math.pow(Math.min(1, Math.max(0, (x - 0.3) / 0.65)), 1.5);
    if (e > 0.32) for (let b = 0; b < bars; b++) ev.push({ type: 'sub', t: timeOf(b), dur: timeOf(b + 1) - timeOf(b), midi: bassNote(ped(chordAt(b)), 24, 35), lev: subLev(eAt(b)), att: 0.01, rel: 0.3 });
    if (S.bar === 0) {
      const jump = e - this.lastE;
      if (S.role === 'arrival' || jump > 0.22 || S.role === 'shadow') ev.push({ type: 'boom', t: t0, lev: Math.min(1, 0.35 + Math.max(0, jump) + (S.role === 'arrival' ? 0.4 : 0)), root: bassNote(chords[0], 22, 33) });
      if (S.role === 'arrival') { ev.push({ type: 'perc', kind: 'crash', t: t0, lev: 1 }); if (this.rng() < 0.6) ev.push({ type: 'perc', kind: 'gong', t: t0, lev: 0.9 }); }
      if (['emerge', 'still', 'coda'].includes(S.role)) {
        const span = timeOf(Math.min(bars, S.bars)) - t0 + S.bars * barDur * 0.5;
        ev.push({ type: 'shimmer', t: t0, dur: span, midi: P.anchor + 17, lev: 0.008, att: 5, rel: 5 });
        ev.push({ type: 'shimmer', t: t0 + barDur, dur: span, midi: P.anchor + 12, lev: 0.006, att: 6, rel: 5 });
      }
    }
    if (isLast && (S.role === 'build' || S.role === 'breath')) {
      const rb = Math.min(bars, 2);
      ev.push({ type: 'riser', t: timeOf(bars - rb), dur: timeOf(bars) - timeOf(bars - rb), lev: 0.45 });
      note('timp_roll', bars - rb, bars, midiOfPc(P.tonic, 33, 44), 0.9);
      ev.push({ type: 'perc', kind: 'cym_roll', t: timeOf(bars), lev: 0.8 });
      if (this.chance('section', 'Before the arrival', S.role === 'breath' ? 0.8 : 0.4, timeOf(bars - 0.5), 'a breath of silence', 'drive straight in')) ev.push({ type: 'gate', t0: timeOf(bars - 0.5 / beats), t1: timeOf(bars) - 0.004 });
    }
    if (isLast && S.role === 'arrival' && this.chance('section', 'End of the arrival', 0.6, timeOf(bars), 'hard cut', 'ring on')) {
      ev.push({ type: 'gate', t0: timeOf(bars), t1: timeOf(bars) + barDur - 0.4 });
      this.cutPending = true;
    }

    // ---- dynamics: turn levels into the engine's per-note curves ----
    const out = [];
    const ONESHOT = new Set(['piano', 'piano_low', 'piano_mel', 'vln_spic', 'vla_spic', 'vc_spic', 'basses_spic', 'harp', 'timpani', 'marimba', 'glock', 'vln_pizz', 'vc_pizz']);
    const byTrack = {};
    for (const n of ev) if (n.type === 'note') (byTrack[n.track] = byTrack[n.track] || []).push(n); else out.push(n);
    for (const [track, list] of Object.entries(byTrack)) {
      list.sort((a, b) => a.t - b.t);
      const legato = ['vln_theme', 'vc_theme', 'horns', 'trumpets', 'oboe'].includes(track);
      for (const n of list) {
        const d0 = Math.min(1, Math.max(0.03, n.lev));
        if (!ONESHOT.has(track)) {
          const grow = 1 + (S.e1 - S.e0) * 0.6 * n.dur / (S.bars * barDur);
          const e1 = Math.min(1, Math.max(0.03, n.lev * grow));
          const k = Math.max(2, Math.floor(n.dur / 0.3));
          n.dyn = Array.from({ length: k + 1 }, (_, i) => { const x = i / k; let v = d0 + (e1 - d0) * x; if (legato && n.dur > 1.2) v *= 0.93 + 0.11 * Math.sin(Math.PI * Math.min(1, x / 0.85)) - 0.04 * Math.max(0, (x - 0.85) / 0.15); return [n.dur * x, Math.min(1, v)]; });
        } else n.dyn = d0;
        if (legato) {
          n.legIn = list.some((m) => m.t < n.t - 0.05 && Math.abs(m.t + m.dur - n.t) < 0.06);
          n.legOut = list.some((m) => m.t > n.t + 0.05 && Math.abs(m.t - (n.t + n.dur)) < 0.06);
        }
        delete n.lev;
        out.push(n);
      }
    }
    out.sort((a, b) => (a.t ?? a.t0) - (b.t ?? b.t0));
    const tEnd = timeOf(bars);
    this.lastE = e;
    S.bar += bars;
    P.elapsed += tEnd - t0;
    this.t = tEnd;
    const decisions = this.decisions.splice(0);
    const info = {
      piece: P.no, section: S.role, key: spell(P.tonic, P.tonic), mode: S.mode, meter: P.meter.name, bpm: S.bpm, energy: e, t0, t1: tEnd,
      palette: P.palette, cadence, sectionBar: S.bar - bars, sectionBars: S.bars,
      chords: chords.map((c, i) => ({ t: timeOf(i * per), name: c.name, num: c.num })),
      layers: Object.entries(L).flatMap(([r, ls]) => ls.map((l) => ({ role: r, track: l.track, desc: l.desc }))),
      rolls: this.rolls,
    };
    return { events: out, info, decisions };
  }
}
