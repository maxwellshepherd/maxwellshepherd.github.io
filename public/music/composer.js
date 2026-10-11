// Generative composer. Nothing here is a pre-written piece: every phrase is assembled in real time from primitives
// (form grammar, modal chord graph, motif + development operations, ostinato cells, an arranger), and every
// weighted choice is logged so the page can show each choice as you hear its consequence.
//
// What makes it sound composed rather than shuffled: sections are planned as periods of phrases that answer
// each other (antecedent / consequent cadences), orchestration changes are rate-limited and staggered so
// instruments enter mid-phrase or as pickups and leave after finishing their line, the tempo map breathes at
// phrase ends and broadens into arrivals, dynamics follow a hairpin across each phrase, held chords swell,
// suspensions resolve, melodies take pickups and land their cadences, and accents follow the hypermeter.

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
const QN = { m: 'm', M: '', sus4: 'sus4', sus2: 'sus2', m9: 'm(add9)', add9: 'add9', maj7: 'maj7', m7: 'm7', '7sus': '7sus4', 7: '7' };
const QI = { m: [0, 3, 7], M: [0, 4, 7], sus4: [0, 5, 7], sus2: [0, 2, 7], m9: [0, 3, 7, 2], add9: [0, 4, 7, 2], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '7sus': [0, 5, 7, 10], 7: [0, 4, 7, 10] };
// a degree is usable when its triad has a perfect fifth in the mode (no diminished chords in this idiom)
const usableDeg = (mode, d) => { const sc = MODES[mode]; return (sc[(d + 4) % 7] - sc[d] + 12) % 12 === 7; };

function mkChord(tonic, mode, deg, color = 'plain', bassPc = null, forceMajor = false) {
  const sc = MODES[mode];
  const root = (tonic + sc[deg]) % 12;
  const third = (sc[(deg + 2) % 7] - sc[deg] + 12) % 12;
  const fifth = (sc[(deg + 4) % 7] - sc[deg] + 12) % 12;
  const second = (sc[(deg + 1) % 7] - sc[deg] + 12) % 12, fourth = (sc[(deg + 3) % 7] - sc[deg] + 12) % 12, seventh = (sc[(deg + 6) % 7] - sc[deg] + 12) % 12;
  let q = third === 3 ? 'm' : 'M';
  if (forceMajor) q = 'M';                     // explicit borrowing (major V): a deliberate, logged choice
  else if (fifth !== 7) q = fourth === 5 ? 'sus4' : 'sus2';   // only reached if a caller ignores usableDeg
  // colours are drawn from the mode itself, so they never add notes outside it
  if (!forceMajor) {
    if (color === 'add9' && second === 2) q = q === 'm' ? 'm9' : q === 'M' ? 'add9' : q;
    else if (color === 'seventh') q = q === 'm' && seventh === 10 ? 'm7' : q === 'M' && seventh === 11 ? 'maj7' : q === 'M' && seventh === 10 ? '7' : q;
    else if (color === 'sus' && fourth === 5 && fifth === 7) q = 'sus4';
  }
  const pcs = QI[q].map((x) => (root + x) % 12);
  const bass = bassPc ?? root;
  const num = (q === 'm' || q === 'm9' || q === 'm7' ? ROMAN[deg] : ROMAN[deg].toUpperCase());
  const flat = (MODES.ionian[deg] - sc[deg]) > 0 ? 'b' : (sc[deg] - MODES.ionian[deg]) > 0 ? '#' : '';
  const FEEL = ['home', 'a gentle step away', 'bright relief', 'darker, longing', 'tension that wants to resolve', 'warm and wistful', 'rising, hopeful'];
  return { root, q, pcs, bass, deg, num: flat + num, feel: FEEL[deg], name: spell(root, tonic) + QN[q] + (bass !== root ? '/' + spell(bass, tonic) : '') };
}
const midiOfPc = (pc, lo, hi) => { for (let p = lo; p <= hi; p++) if (((p % 12) + 12) % 12 === pc) return p; return lo; };
const bassNote = (ch, lo, hi) => midiOfPc(ch.bass, lo, hi);
function* combos(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i < arr.length; i++) { acc.push(arr[i]); yield* combos(arr, k, i + 1, acc); acc.pop(); }
}
function voicing(ch, nv, lo, hi, prev, occupied = null) {
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
    if (occupied) {                       // other layers already sounding this chord: avoid unisons, complete the chord between us
      for (const p of cmb) if (occupied.has(p)) c += 2.5;
      const all = new Set([...occupied].map((p) => p % 12)); for (const p of cmb) all.add(p % 12);
      for (const pc of pcs) if (!all.has(pc)) c += 1.2;
    }
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
// nearest note whose pitch class is in a given set, with a bias toward preferred classes (cadences land on the root)
const nearestOf = (p, pcs, prefer, maxd = 6) => { let best = p, bd = 99; for (let q = p - maxd; q <= p + maxd; q++) { const pc = ((q % 12) + 12) % 12; if (!pcs.includes(pc)) continue; const d = Math.abs(q - p) - (prefer.includes(pc) ? 1.5 : 0); if (d < bd) { bd = d; best = q; } } return best; };

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
  emerge:    { e: [0.1, 0.2],  len: [[4, 2], [6, 2], [8, 1]], hr: [[2, 2], [1, 1]] },
  pulse:     { e: [0.28, 0.38], len: [[8, 3], [12, 1]], hr: [[2, 3], [1, 1]] },
  song:      { e: [0.34, 0.5], len: [[8, 2], [12, 1], [16, 1]], hr: [[2, 3], [1, 2]] },
  shadow:    { e: [0.3, 0.44], len: [[6, 1], [8, 2]], hr: [[1, 2], [2, 1]] },
  still:     { e: [0.18, 0.24], len: [[4, 1], [8, 1]], hr: [[2, 2], [4, 1]] },
  build:     { e: [0.45, 0.8], len: [[8, 2], [12, 2], [16, 1]], hr: [[1, 2], [2, 2]] },
  breath:    { e: [0.38, 0.66], len: [[2, 1], [4, 2]], hr: [[1, 1]] },
  arrival:   { e: [0.86, 1.0], len: [[8, 2], [12, 1], [16, 1]], hr: [[2, 3], [1, 1]] },
  afterglow: { e: [0.6, 0.42], len: [[4, 1], [8, 1]], hr: [[2, 2]] },
  coda:      { e: [0.22, 0.07], len: [[6, 1], [8, 1]], hr: [[1, 1], [2, 1]] },
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
// how a section of N bars is cut into phrases (hypermeter). Lyrical roles prefer regular periods.
const PLANS = {
  2: [[[2], 1]], 4: [[[4], 3], [[2, 2], 1]], 6: [[[3, 3], 2], [[2, 4], 1.5], [[4, 2], 1], [[2, 2, 2], 0.7]],
  8: [[[4, 4], 4], [[2, 2, 4], 1.2], [[4, 2, 2], 0.8], [[3, 3, 2], 1], [[2, 3, 3], 0.6]],
  12: [[[4, 4, 4], 3], [[6, 6], 1], [[4, 4, 2, 2], 0.8], [[3, 3, 3, 3], 0.8], [[4, 2, 2, 4], 0.7]],
  16: [[[4, 4, 4, 4], 3], [[6, 6, 4], 0.8], [[4, 4, 2, 2, 4], 1], [[3, 3, 2, 4, 4], 0.6]],
};
const LYRICAL = new Set(['song', 'arrival', 'afterglow', 'still', 'coda', 'emerge']);
const GENTLE = new Set(['emerge', 'still', 'shadow', 'pulse']);
// phrase-level dynamic hairpin amplitude, per role
const HAIR = { song: 0.12, afterglow: 0.1, arrival: 0.08, still: 0.04, emerge: 0.06, pulse: 0.05, build: 0.04, shadow: 0.08, coda: 0.08, breath: 0 };
// how much the last beat of a phrase lengthens (agogic breath), per role
const BREATH = { song: 1.06, afterglow: 1.07, still: 1.05, coda: 1.08, emerge: 1.04, shadow: 1.04, pulse: 1.02, build: 1.015, arrival: 1.03, breath: 1 };
const RUBATO = new Set(['song', 'still', 'afterglow', 'coda', 'emerge', 'shadow']);
const SUS_P = { song: 0.4, still: 0.4, afterglow: 0.4, coda: 0.45, emerge: 0.3, shadow: 0.25, pulse: 0.15, build: 0.15, arrival: 0.1, breath: 0 };
const OST_CONTOURS = { up: [0, 1, 2, 3], updown: [0, 1, 2, 1], pendulum: [0, 2, 1, 3], broken: [0, 2, 1, 2], fifths: [0, 1], rising3: [0, 1, 2], turn: [1, 0, 1, 2], arpdown: [3, 2, 1, 0] };
const GROUPINGS = { 8: [[3, 3, 2], [3, 2, 3], [2, 3, 3], [2, 2, 2, 2], [4, 4], [3, 3, 1, 1]], 6: [[3, 3], [2, 2, 2], [4, 2]], 16: [[3, 3, 2, 3, 3, 2], [3, 3, 3, 3, 4], [4, 4, 4, 4], [3, 3, 2, 2, 3, 3]], 12: [[3, 3, 3, 3], [6, 6], [4, 4, 4]], 9: [[3, 3, 3]] };
// a section's principal accent pattern, scaled to a layer's subdivision
const scaleGrouping = (g, slots, E) => { if (slots === E) return g; if (slots === 2 * E) return g.concat(g); return GROUPINGS[slots] ? GROUPINGS[slots][0] : [slots]; };
// cell lengths that do NOT divide the bar, so a freely cycling cell genuinely drifts against the barline
const PHASE_LENGTHS = { 8: [3, 5], 6: [4, 5], 16: [3, 5, 6, 7], 12: [5, 7], 9: [4, 5] };

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
const ROLE_NAME = { ost: 'Ostinato', mel: 'Melody', pad: 'Harmony', bass: 'Bass' };
const DEV_OPS = {
  song: { repeat: 3, sequence: 3, answer: 2, ornament: 1.5, fragment: 1, return: 0.5 },
  pulse: { repeat: 2, sequence: 2, fragment: 2, answer: 1 },
  build: { sequence: 3.5, fragment: 2.5, repeat: 1.5, climb: 2.5 },
  arrival: { repeat: 3, augment: 2.5, climb: 2, sequence: 1.5, return: 2 },
  afterglow: { augment: 3, answer: 2, repeat: 1.5, return: 2 },
  shadow: { invert: 3, fragment: 2, sequence: 1 },
  emerge: { fragment: 3, augment: 2, repeat: 1 },
  still: { augment: 2, invert: 1.5, fragment: 2 },
  coda: { augment: 3, fragment: 2, answer: 2, return: 2.5 },
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

  // ------- every musical decision goes through here and is logged --------
  pick(level, label, opts, t, quiet = false, extra = null) {
    const live = opts.filter((o) => o[1] > 0);
    const tot = live.reduce((a, o) => a + o[1], 0);
    let x = this.rng() * tot, idx = live.length - 1;
    for (let i = 0; i < live.length; i++) { x -= live[i][1]; if (x <= 0) { idx = i; break; } }
    this.rolls++;
    if (!quiet) this.decisions.push({ t, level, label, chosen: idx, options: live.map((o) => ({ name: o[2] ?? String(o[0]), p: o[1] / tot })), ...(extra ? extra(live[idx][0]) : {}) });
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
    P.motif0 = { durs: P.motif.durs.slice(), steps: P.motif.steps.slice(), bars: P.motif.bars };
    P.stmt = 0; P.lastMelEnd = null; P.melEndT = -1; P.builds = 0;
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
  // the form grammar, weighted by where the piece is in its planned arc
  chooseRole(t) {
    const P = this.piece;
    const prev = this.sec && this.sec.piece === P.no ? this.sec.role : 'start';
    let w = { ...(NEXT_ROLE[prev] || NEXT_ROLE.start) };
    const prog = P.elapsed / P.targetSecs, over = prog > 1;
    if (prog > 0.6 && !P.peaked) { w.build = (w.build || 0) * 2 + 2; w.arrival = (w.arrival || 0) * 2; w.song = (w.song || 0) * 0.5; w.pulse = (w.pulse || 0) * 0.4; w.still = (w.still || 0) * 0.4; }
    if (prog < 0.35 && !P.peaked && P.builds < 2) { w.arrival = (w.arrival || 0) * 0.2; w.breath = (w.breath || 0) * 0.3; if (prev === 'build') w.shadow = (w.shadow || 0) + 2; }
    if (prev === 'build' && P.builds >= 2) { w.arrival = (w.arrival || 0) + 4; w.breath = (w.breath || 0) + 3; w.shadow = 0; }   // two builds is enough tension
    if (P.peaked) {
      if (prog < 0.72) { w.coda = (w.coda || 0) * 0.1; w.still = (w.still || 0) + 2; w.afterglow = (w.afterglow || 0) + 1; if (prev === 'still' || prev === 'afterglow') { w.song = (w.song || 0) + 2; w.build = (w.build || 0) + 1.5; } }
      else { w.coda = (w.coda || 0) + 2 + (over ? 6 : 0); w.arrival = (w.arrival || 0) * 0.3; w.build = (w.build || 0) * 0.3; }
    }
    if (over && !P.peaked) w = prev === 'build' ? { breath: 4, arrival: 4 } : { build: 3 };
    if (P.arrivals >= 2) { w.arrival = (w.arrival || 0) * 0.25; w.build = (w.build || 0) * 0.5; }
    if (P.peaked && prog > 0.9) w = prev === 'arrival' ? { coda: 6, afterglow: 2 } : { coda: 1 };   // time to come home
    if (prog < 0.6 || P.sections < 3) delete w.coda;
    if (prev === 'breath') w = { arrival: 1 };
    const opts = Object.entries(w).filter(([k, v]) => v > 0 && ROLES[k]).map(([k, v]) => [k, v, k[0].toUpperCase() + k.slice(1)]);
    return this.pick('section', 'Next section', opts.length ? opts : [['coda', 1, 'Coda']], t);
  }

  newSection() {
    if (!this.piece || this.piece.done) { this.pendingRole = null; this.newPiece(); }
    const P = this.piece, t = this.t;
    if (this.sec && this.sec.piece === P.no) {        // entry and exit bars were counted in the old section's bars
      const ob = this.sec.bars;
      for (const ls of Object.values(P.layers)) for (const l of ls) { l.from = Math.min(0, l.from - ob); if (l.until !== Infinity) l.until -= ob; }
    }
    const role = this.pendingRole || this.chooseRole(t);
    this.pendingRole = null;
    const R = ROLES[role];
    const bars = this.pick('section', 'Section length', R.len.map(([b, w]) => [b, w, b + ' bars']), t);
    const jitter = (this.rng() - 0.5) * 0.08;
    let e0 = R.e[0] + jitter, e1 = R.e[1] + jitter;
    if (role === 'build') e0 = Math.max(0.3, Math.min(0.55, P.energy));
    const S = { piece: P.no, role, bars, bar: 0, e0, e1, t0: t, phraseIdx: 0 };
    // hypermeter: the section is cut into phrases that pair up as question and answer
    const plans = (PLANS[bars] || [[[bars], 1]]).map(([p, w]) => [p, LYRICAL.has(role) && p.some((x) => x !== p[0]) ? w * 0.35 : w, p.join(' + ') + ' bars']);
    S.plan = plans.length > 1 ? this.pick('section', 'Phrase plan', plans, t) : plans[0][0];
    const gw = P.meter.name === '6/8' ? [[[3, 3], 4], [[4, 2], 0.6], [[2, 2, 2], 0.4]] : P.meter.name === '3/4' ? [[[2, 2, 2], 3], [[3, 3], 1], [[4, 2], 1]] : GROUPINGS[8].map((g, i) => [g, [3, 2, 1.5, 1.2, 1, 0.8][i]]);
    S.grouping = this.pick('pattern', 'Accent pattern', gw.map(([g, w]) => [g, w, g.join('+')]), t);
    S.hr = this.pick('harmony', 'Harmonic rhythm', R.hr.map(([b, w]) => [b, w, b === 1 ? 'chord per bar' : b + ' bars per chord']), t);
    S.mode = P.mode;
    if (role === 'shadow' && MINORISH.has(P.homeMode)) S.mode = this.pick('harmony', 'Shadow colour', [['phrygian', 2, 'darken to Phrygian'], [P.homeMode, 2, 'stay ' + P.homeMode]], t);
    if (role === 'arrival' || role === 'afterglow' || (role === 'coda' && P.peaked)) {
      if (!P.arrivalMode) P.arrivalMode = MINORISH.has(P.homeMode) ? this.pick('harmony', 'Arrival mode', [['ionian', 3, 'burst into major'], ['lydian', 0.8, 'lift to Lydian'], [P.homeMode, 2.2, 'stay dark']], t) : P.homeMode;
      S.mode = P.arrivalMode;
    }
    if (role === 'arrival' && P.peaked && this.chance('harmony', 'Key lift for the second wave', 0.4, t, 'lift a step', 'stay')) { this.tonic = (this.tonic + 2) % 12; P.tonic = this.tonic; P.anchor += P.anchor + 2 > 74 ? -10 : 2; if (P.lastMelEnd) P.lastMelEnd += 2; }
    S.pedal = ['emerge', 'shadow', 'still'].includes(role) ? this.chance('harmony', 'Pedal point', 0.65, t, 'hold the tonic', 'free bass')
      : role === 'build' ? this.chance('harmony', 'Pedal point', 0.35, t, 'tonic pedal under the build', 'free bass') : false;
    S.bpm = role === 'coda' ? Math.round(P.bpm * 0.82) : P.bpm;
    if (role === 'coda' && this.cutPending) { this.t += 60 / P.bpm * P.meter.beats; S.t0 = this.t; S.afterCut = true; }
    this.cutPending = false;
    // the tempo breathes: a per-bar rubato walk for lyrical roles, and an agogic lengthening of each phrase's last beat
    S.breath = BREATH[role] || 1;
    S.rub = []; let r = 1;
    for (let b = 0; b < bars; b++) { S.rub.push(RUBATO.has(role) ? r : 1); r = Math.max(0.985, Math.min(1.015, r + (this.rng() - 0.5) * 0.02)); }
    if (['song', 'build', 'arrival', 'afterglow', 'coda', 'still'].includes(role))
      S.pickup = this.pick('motif', 'Melody pickup', [[0, 3, 'the tune starts on the downbeat'], [1, 1.5, 'an eighth-note pickup'], [2, 2, 'a quarter-note pickup']], t);
    if (role === 'arrival' || (role === 'build' && e1 > 0.7)) S.stabs = this.chance('pattern', 'Brass on the strong bars', role === 'arrival' ? 0.6 : 0.35, t, 'accented chords', 'sustained only');
    S.motifOps = 0;
    if (role !== 'emerge' && role !== 'breath' && P.sections > 1 && this.chance('motif', 'Motif mutation', 0.3, t, 'mutate the motif', 'keep it')) this.mutateMotif(P, t);
    if (role === 'arrival') { P.peaked = true; P.builds = 0; P.arrivals = (P.arrivals || 0) + (this.sec && this.sec.role === 'arrival' ? 0 : 1); }
    if (role === 'build') P.builds = (P.builds || 0) + 1;
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
  // kind: 'ante' (question, ends open), 'cons' (answer, resolves), 'final' (the section's own ending)
  phraseChords(P, S, bars, t, kind, barTime) {
    const nCh0 = Math.max(1, Math.round(bars / S.hr));
    const mode = S.mode, T = P.tonic;
    const ok = (d) => usableDeg(mode, d);
    const label = (d) => { const c = mkChord(T, mode, d); return c.name + ' (' + c.num + ')'; };
    const per = bars / nCh0;
    let lens = Array(nCh0).fill(per);
    const at = (i) => barTime(lens.slice(0, i).reduce((a, b) => a + b, 0));
    // 1. how the phrase ends is decided first; its chords are consequences, not separate choices
    let fixed = {};
    let cadence = 'open', borrow = false;
    const isLast = kind === 'final';
    const quiet = ['emerge', 'still'].includes(S.role);
    if (S.role === 'coda' && isLast) fixed[nCh0 - 1] = 0;
    else if (nCh0 >= 2 && !(quiet && isLast)) {
      let opts;
      if (quiet) opts = [['open', 3, 'left open'], ['half', 1, 'on the dominant (unresolved)'], ['plagal', 0.6, 'softly home (iv to i)']];
      else if (isLast && (S.role === 'build' || S.role === 'breath')) opts = [['half', 3, 'on the dominant (unresolved)'], ['aeolian', 2.5, 'climbing VI to VII'], ['open', 1, 'left open']];
      else if (kind === 'ante') opts = [['half', 3, 'on the dominant (unresolved)'], ['open', 2, 'left open'], ['aeolian', 1.5, 'climbing VI to VII'], ['deceptive', 0.6, 'a surprise turn (V to VI)']];
      else opts = [['authentic', 2, 'resolving home (V to i)'], ['plagal', 1.8, 'softly home (iv to i)'], ['deceptive', 1, 'a surprise turn (V to VI)'], ['half', isLast ? 1.2 : 0.6, 'on the dominant (unresolved)'], ['aeolian', 1.2, 'climbing VI to VII'], ['open', isLast ? 1.2 : 0.8, 'left open']];
      opts = opts.filter(([c]) => (c !== 'plagal' || ok(3)) && (c !== 'aeolian' || (ok(5) && ok(6))) && (c !== 'deceptive' || ok(5)));
      const first = { authentic: nCh0 - 2, plagal: nCh0 - 2, deceptive: nCh0 - 2, half: nCh0 - 1, aeolian: nCh0 - 2, open: nCh0 - 1 };
      cadence = this.pick('harmony', 'How the phrase ends', opts.map(([c, w, n]) => [c, w, n]), at(Math.max(0, nCh0 - 2)));
      if (cadence === 'authentic') { fixed[nCh0 - 2] = 4; fixed[nCh0 - 1] = 0; }
      else if (cadence === 'plagal') { fixed[nCh0 - 2] = 3; fixed[nCh0 - 1] = 0; }
      else if (cadence === 'deceptive') { fixed[nCh0 - 2] = 4; fixed[nCh0 - 1] = 5; }
      else if (cadence === 'half') fixed[nCh0 - 1] = 4;
      else if (cadence === 'aeolian') { fixed[nCh0 - 2] = 5; fixed[nCh0 - 1] = 6; }
      // borrowing a major V (its leading tone) is a deliberate, visible choice in minor-ish modes
      if (['authentic', 'half', 'deceptive'].includes(cadence) && (MINORISH.has(mode) || !ok(4)))
        borrow = !ok(4) || this.chance('harmony', 'Borrow a major dominant', 0.7, at(first[cadence]), 'yes, for a stronger pull home', 'no, keep the modal colour');
      if (!ok(4) && !borrow) { for (const k in fixed) if (fixed[k] === 4) fixed[k] = ok(6) ? 6 : 3; }
      // a quicker turn into the cadence: the pre-dominant takes only the last bar before home
      if (['authentic', 'plagal', 'deceptive'].includes(cadence) && per >= 2 && kind !== 'ante'
        && this.chance('harmony', 'Cadence pace', 0.35, at(nCh0 - 2), 'a quicker turn into the cadence', 'even pacing')) {
        lens = lens.slice(0, nCh0 - 2).concat([per - 1, 1, per]);
        const nf = {}; for (const k in fixed) nf[+k >= nCh0 - 2 ? +k + 1 : +k] = fixed[k]; fixed = nf;
      }
    }
    const nCh = lens.length;
    // 2. the free slots are drawn from the chord graph, staying inside the mode
    const degs = [];
    let cur = P.prevChord && P.prevChord.mode === mode ? P.prevChord.deg : 0;
    for (let i = 0; i < nCh; i++) {
      let d;
      if (fixed[i] !== undefined) d = fixed[i];
      else if (i === 0 && S.bar === 0) {
        d = ['arrival', 'emerge', 'pulse', 'coda'].includes(S.role) ? 0
          : this.pick('harmony', 'Opening chord', [[0, 4], [5, 1], [3, 0.7]].filter(([k]) => ok(k)).map(([k, w]) => [k, w, label(k)]), at(0), false, (k) => ({ feel: mkChord(T, mode, k).feel }));
      } else {
        const opts = Object.entries(CHORD_GRAPH[cur]).filter(([k]) => ok(+k)).map(([k, w]) => [+k, w, label(+k)]);
        d = this.pick('harmony', 'Next chord', opts.length ? opts : [[0, 1, label(0)]], at(i), false, (k) => ({ feel: mkChord(T, mode, k).feel }));
      }
      degs.push(d); cur = d;
    }
    const chords = degs.map((d, i) => {
      const color = this.roll([['plain', 5], ['add9', 2.2], ['seventh', 1.2], ['sus', d === 4 ? 1.5 : 0.4]]);
      const isBorrowedV = borrow && d === 4 && fixed[i] === 4;
      const final = S.role === 'coda' && isLast && i === nCh - 1;
      const ch = mkChord(T, mode, d, final ? 'add9' : isBorrowedV ? 'plain' : color, S.pedal ? T : null, isBorrowedV);
      ch.mode = mode;
      return ch;
    });
    P.prevChord = chords[chords.length - 1];
    const spans = []; let pos = 0;
    for (let i = 0; i < nCh; i++) { spans.push([pos, pos + lens[i], chords[i]]); pos += lens[i]; }
    return { chords, cadence, spans };
  }

  // ------- arranger: decides who plays, when they enter and when they leave ------------------------
  // Changes are rate-limited (a composed score adds or removes one voice at a time, more at a section
  // start, everything at an arrival) and placed within the phrase: on the downbeat, mid-phrase, or as a
  // pickup into the next phrase. Leaving voices finish the phrase first unless the energy jumps.
  arrange(P, S, e, bars, sb, phI, tAt, isLast) {
    const L = P.layers;
    const palBias = {
      strings: { vla_pad: 1.5, vln_pad: 1.5, vln_theme: 1.5, vc_theme: 1.4, vla_spic: 1.4 }, brass: { horns: 2, horns_chords: 2, trombones: 1.6, trumpets: 1.5 },
      keys: { piano: 1.5, marimba: 2, glock: 1.6, harp: 1.5, piano_mel: 1.6 }, winds: { clarinets: 1.8, flutes: 1.8, oboe: 2.2 }, organ: { organ: 2, organ_soft: 2, organ_arp: 2 },
    }[P.palette] || {};
    for (const r in L) L[r] = L[r].filter((l) => l.until > sb);      // voices that finished their exit are gone
    const busy = new Set(Object.values(L).flat().map((l) => l.track));
    const budget = {
      bass: e < 0.3 ? 1 : e < 0.7 ? 2 : 3,
      pad: e < 0.2 ? 1 : e < 0.4 ? 2 : e < 0.7 ? 3 : 4,
      ost: S.role === 'emerge' ? (e < 0.15 ? 0 : 1) : e < 0.25 ? 1 : e < 0.45 ? 2 : e < 0.75 ? 3 : 4,
      mel: ['song', 'build', 'arrival', 'afterglow', 'coda', 'still'].includes(S.role) ? (e < 0.55 ? 1 : e < 0.85 ? 2 : 3)
        : (S.role === 'emerge' || S.role === 'shadow') && this.rng() < 0.45 ? 1 : 0,
    };
    const secStart = sb === 0;
    const jumpUp = secStart && e - this.lastE > 0.2 && P.sections > 1;          // a new piece assembles itself; a jump within a piece is a cut
    const drop = secStart && this.lastE - e > 0.2 && !S.afterCut;               // after a climax the outgoing voices fade through the first bar
    const big = secStart && (S.role === 'arrival' || S.role === 'breath' || jumpUp || drop);
    let changes = big ? 99 : secStart ? 3 : phI % 2 === 1 ? 1 : 2;
    const tEnd = sb + bars, beats = P.meter.beats;
    const roles = ['bass', 'pad', 'ost', 'mel'], k0 = Math.floor(this.rng() * 4);
    // something must sound from the first beat: the first voice to join an empty texture enters on the downbeat
    const sounding = () => Object.values(L).flat().some((l) => l.from <= sb && l.until > sb);
    const leave = (l, role, when) => {        // when: 'now' | 'dovetail' | 'end'
      if (when === 'now') { L[role] = L[role].filter((x) => x !== l); busy.delete(l.track); }
      else if (when === 'dovetail') { l.until = sb + 1; l.dovetail = true; }
      else l.until = tEnd;
    };
    for (const role of roles.slice(k0).concat(roles.slice(0, k0))) {
      const cands = CAND[role];
      const fits = (c) => c && e >= c[2] - 0.04 && e <= c[3] + 0.04;
      const candOf = (l) => cands.find((c) => c[0] === (l.kind || l.track));
      const staying = () => L[role].filter((l) => l.until > tEnd);
      const counted = () => L[role].filter((l) => !l.dovetail).length;
      const how = big ? (drop && role !== 'mel' ? 'dovetail' : 'now') : 'end';
      for (const l of [...L[role]]) {
        if (l.until <= tEnd || fits(candOf(l))) continue;
        leave(l, role, how);
        this.decisions.push({ t: tAt(how === 'end' ? bars : 0), level: 'layer', label: `${l.desc} bows out`, chosen: 0, options: [{ name: 'energy moved out of its range', p: 1 }] });
      }
      while (staying().length > budget[role]) {
        const victim = this.pick('layer', `${ROLE_NAME[role]}: who drops out`, staying().map((l) => [l, 1 + l.age, l.desc]), tAt(how === 'end' ? bars : 0));
        leave(victim, role, how);
        changes--;
      }
      if (changes > 0 && role !== 'bass' && !secStart && this.rng() < 0.1) {
        const old = staying().filter((l) => l.age >= 3);
        if (old.length) { const victim = this.pick('layer', `${ROLE_NAME[role]}: hand over`, old.map((l) => [l, 1 + l.age, l.desc]), tAt(bars)); victim.until = tEnd; changes--; }
      }
      while (counted() < budget[role] && changes > 0) {
        const opts = cands.filter((c) => fits(c) && !busy.has(role === 'bass' ? BASS_TRACK[c[0]] : c[0]) && !(role === 'bass' && L.bass.some((l) => l.kind === c[0])))
          .map((c) => [c, c[1] * (palBias[c[0]] || 1), pretty(c[0])]);
        if (!opts.length) break;
        const di = this.decisions.length;
        const c = this.pick('layer', `${ROLE_NAME[role]}: who joins`, opts, tAt(0));
        const layer = this.makeLayer(P, S, role, c, tAt(0));
        let enter = 0;
        if ((!big || drop) && bars >= 2 && sounding()) {
          const gentle = GENTLE.has(S.role);
          const mid = role === 'mel' ? (P.motif.bars < bars ? P.motif.bars : 0) : Math.min(2, bars - 1);
          const eo = [[0, secStart ? (gentle ? 2.5 : 4) : 3, 'on the downbeat']];
          if (mid > 0) eo.push([mid, secStart ? (gentle ? 2 : 1) : 1.2, `in bar ${mid + 1}`]);
          if (role !== 'mel' && !isLast) eo.push([bars - 1 / beats, 1.5, 'as a pickup into the next phrase']);
          enter = eo.length > 1 ? this.pick('layer', `${pretty(c[0])}: entrance`, eo, tAt(0)) : 0;
        }
        layer.from = sb + enter; layer.until = Infinity;
        const te = tAt(enter);
        for (const d of this.decisions.slice(di)) d.t = te;     // its cards appear when it is heard
        L[role].push(layer); busy.add(layer.track); changes--;
      }
      for (const l of L[role]) l.age++;
    }
  }

  makeLayer(P, S, role, c, t) {
    const E = P.meter.E;
    if (role === 'bass') {
      const kind = c[0];
      const L = { role, kind, track: BASS_TRACK[kind], age: 0, desc: pretty(kind), from: 0, until: Infinity };
      if (kind === 'pulse' || kind === 'pizz') L.grouping = this.pick('pattern', 'Bass accents', (GROUPINGS[E] || GROUPINGS[8]).map((g) => [g, 1, g.join('+')]), t);
      return L;
    }
    if (role === 'pad') return { role, track: c[0], reg: c[4], age: 0, desc: pretty(c[0]), prev: null, from: 0, until: Infinity };
    if (role === 'mel') return { role, track: c[0], oct: c[4], age: 0, desc: pretty(c[0]) + ' (melody)', from: 0, until: Infinity };
    const track = c[0];
    const subs = [['e', 3, '8ths'], ['s', ['piano', 'marimba', 'organ_arp', 'harp'].includes(track) ? 1.6 : 0.3, '16ths']];
    if (P.meter.name !== '6/8') subs.push(['t', ['harp', 'flutes', 'marimba', 'glock'].includes(track) ? 2 : 0.4, 'triplets']);
    const sub = this.pick('pattern', `${pretty(track)}: subdivision`, subs, t);
    const slots = sub === 'e' ? E : sub === 's' ? E * 2 : P.meter.beats * 3;
    const contour = this.pick('pattern', `${pretty(track)}: cell shape`, Object.keys(OST_CONTOURS).map((k) => [k, k === 'up' || k === 'broken' ? 2 : 1, k]), t);
    const process = this.pick('pattern', `${pretty(track)}: process`, [['group', 3, 'restarts with each accent'], ['cycle', 2, 'cycles freely, drifting against the beat'], ['grow', 1, 'grows a note at a time']], t);
    const main = scaleGrouping(S.grouping || [slots], slots, E);
    let grouping = main;
    if (process === 'grow') grouping = [slots];
    else if (this.chance('pattern', `${pretty(track)}: accents`, 0.25, t, 'a contrasting accent pattern', 'the section\'s accent pattern')) {
      const alts = (GROUPINGS[slots] || [[slots]]).filter((g) => g.join() !== main.join());
      if (alts.length) grouping = this.pick('pattern', `${pretty(track)}: contrasting accents`, alts.map((g) => [g, 1, g.join('+')]), t);
    }
    let cell = OST_CONTOURS[contour];
    if (process === 'cycle') {           // a cell length that does not divide the bar, so it truly drifts
      const L = this.pick('pattern', `${pretty(track)}: cycle length`, (PHASE_LENGTHS[slots] || [3]).map((n) => [n, 1, n + ' notes']), t);
      const ext = cell.concat(cell.slice(1, -1).reverse(), cell);
      cell = ext.slice(0, L);
    }
    return { role, track, sub, slots, cell, contour, process, grouping, phase: 0, base: c[4], age: 0, from: 0, until: Infinity, thin: false,
      desc: `${pretty(track)} (${contour}, ${{ e: '8ths', s: '16ths', t: 'triplets' }[sub]}, ${process === 'grow' ? 'growing' : process === 'cycle' ? 'drifting ' + cell.length + '-note cycle' : grouping.join('+')})` };
  }

  // ------- one phrase of music -----------------------------------------------------------
  next() {
    if (!this.sec || this.sec.bar >= this.sec.bars) {
      if (this.sec && this.sec.role === 'coda') this.piece.done = true;
      this.newSection();
    }
    const P = this.piece, S = this.sec;
    const phI = S.phraseIdx;
    const bars = Math.max(1, Math.min(S.plan[phI] ?? 4, S.bars - S.bar));
    const isLast = S.bar + bars >= S.bars;
    const kind = isLast ? 'final' : phI % 2 === 0 ? 'ante' : 'cons';
    const t0 = this.t, beats = P.meter.beats, E = P.meter.E;
    const beatDur = 60 / S.bpm, barDur = beatDur * beats;
    const sb = S.bar;                 // frozen: S.bar advances at the end of the phrase, timestamps must not move with it
    if (S.bar === 0) for (const d of this.decisions) d.t = Math.max(d.t, t0);
    // the next section is chosen before this one ends, so transitions can prepare for what actually comes next
    if (isLast && S.role !== 'coda') { P.elapsed += bars * barDur; this.pendingRole = this.chooseRole(t0 + bars * barDur); P.elapsed -= bars * barDur; }
    const nextRole = isLast ? (S.role === 'coda' ? 'new piece' : this.pendingRole) : null;
    // ---- tempo map: section drift (builds press on, arrivals broaden, codas slow), rubato, and a breath at phrase ends ----
    const nB = bars * beats, st = new Array(nB), T = [0];
    for (let i = 0; i < nB; i++) {
      const bar = sb + i / beats, prog = bar / S.bars;
      let s = 1;
      if (S.role === 'build') s /= 1 + 0.05 * prog;
      else if (S.role === 'arrival' && sb < 2) s *= 1 + 0.05 * Math.max(0, 1 - bar / 2);
      else if (S.role === 'coda') s *= 1 + 0.35 * Math.max(0, (bar - (S.bars - 3)) / 3);
      s *= S.rub[Math.min(S.rub.length - 1, Math.floor(bar))] || 1;
      if (i === nB - 1) { s *= S.breath; if (isLast) s *= nextRole === 'arrival' ? 1.14 : nextRole === 'breath' ? 1 : 1.05; }
      st[i] = s; T.push(T[i] + beatDur * s);
    }
    const timeOf = (barF) => {
      const x = barF * beats;
      if (x <= 0) return t0 + x * beatDur * st[0];
      if (x >= nB) return t0 + T[nB] + (x - nB) * beatDur * st[nB - 1];
      const i = Math.floor(x); return t0 + T[i] + (x - i) * beatDur * st[i];
    };
    // ---- dynamics: the section's ramp, shaped by a hairpin across the phrase ----
    const ramp = (barF) => S.e0 + (S.e1 - S.e0) * Math.min(1, (sb + barF) / S.bars);
    const A = HAIR[S.role] ?? 0.06;
    const hair = (barF) => { const f = Math.max(0, Math.min(1, barF / bars)); return f < 0.65 ? -0.5 + f / 0.65 : 0.5 - (f - 0.65) / 0.35 * 0.8; };
    const eAt = (barF) => Math.max(0.03, Math.min(1, ramp(barF) * (1 + A * hair(barF))));
    const e = ramp(0.5 * bars);
    P.energy = e;
    for (const l of P.layers.ost) l.thin = false;
    this.arrange(P, S, e, bars, sb, phI, timeOf, isLast);
    const { chords, cadence, spans: chordSpan } = this.phraseChords(P, S, bars, t0, kind, timeOf);
    const chordAt = (barF) => { for (const [a, b, ch] of chordSpan) if (barF >= a - 1e-9 && barF < b) return ch; return chordSpan[chordSpan.length - 1][2]; };
    const resolving = ['authentic', 'plagal'].includes(cadence);
    const ev = [];
    const note = (track, b0, b1, pitch, lev, x = null) => {
      if (b1 <= b0) return;
      const ta = timeOf(b0), tb = timeOf(b1);
      ev.push({ type: 'note', track, t: ta, dur: Math.max(0.05, tb - ta), pitch, lev, b0, b1, ...(x || {}) });
    };
    const L = P.layers;
    const dynBase = { bass: 0.12, pad: 0.06, ost: 0.1, mel: 0.22 };
    const lev = (role, barF) => Math.min(1, dynBase[role] + 0.82 * Math.pow(eAt(barF), 1.15));
    const ped = (ch) => (S.pedal ? { ...ch, bass: P.tonic } : ch);
    const span = (l) => [Math.max(0, l.from - sb), Math.min(bars, l.until - sb)];     // where this voice sounds within the phrase
    const fadeOf = (l, bf) => (l.dovetail ? 0.7 * Math.max(0.2, 1 - 0.8 * bf) : 1);         // outgoing voices fade through their last bar
    const strong = (b) => (sb + b) % 4 === 0;                                           // hypermetric downbeat
    const approachP = { song: 0.4, build: 0.4, arrival: 0.35, afterglow: 0.35, pulse: 0.3, coda: 0.3 }[S.role] || 0.1;

    // ---- bass ----
    for (const l of L.bass) {
      const [s0, s1] = span(l);
      if (s1 <= s0) continue;
      if (l.kind === 'sustain' || l.kind === 'pedal' || l.kind === 'octaves') {
        chordSpan.forEach(([a0, b0, ch0], i) => {
          const a = Math.max(a0, s0), b = Math.min(b0, s1);
          if (b <= a) return;
          const ch = l.kind === 'pedal' ? { ...ch0, bass: P.tonic } : ped(ch0);
          const lo = l.kind === 'sustain' ? 28 : 36, hi = lo + 11;
          const bn = bassNote(ch, lo, hi);
          // an approach note: the last beat steps toward the next root (bass lines move, they do not only jump)
          let bEnd = b, app = null;
          const nx = chordSpan[i + 1];
          if (l.kind !== 'pedal' && !S.pedal && nx && b === b0 && b - a >= 1 && this.rng() < approachP) {
            const nb = bassNote(ped(nx[2]), lo, hi);
            if (nb !== bn && Math.abs(nb - bn) <= 7) { const ap = scaleStep(nb, nb > bn ? -1 : 1, P.tonic, S.mode); if (ap !== bn && Math.abs(ap - bn) <= 7) { app = ap; bEnd = b - 1 / beats; } }
          }
          const emit = (tr, p, mul) => { note(tr, a, bEnd, p, lev('bass', a) * mul * fadeOf(l, a), l.dovetail ? { fade: true } : null); if (app !== null) note(tr, bEnd, b, p + (app - bn), lev('bass', a) * mul * 0.9 * fadeOf(l, a)); };
          if (l.kind === 'sustain') { emit('basses', bn, 1); emit('vc_pad', bassNote(ch, 36, 47), 0.95); }
          else if (l.kind === 'pedal') { emit('organ_pedal', bn, 1); emit('organ_pedal', bn - 12, 0.95); }
          else { emit('piano_low', bn, 0.9); note('piano_low', a + 0.004, bEnd, bn - 12, lev('bass', a) * 0.8); if (app !== null) note('piano_low', bEnd + 0.004, b, app - 12, lev('bass', a) * 0.7); }
        });
      } else {
        const tr = l.track;
        const starts = new Set(); let k = 0; for (const g of l.grouping) { starts.add(k); k += g; }
        for (let b = 0; b < bars; b++) {
          const ch = ped(chordAt(b)), bn = bassNote(ch, 36, 47);
          for (let i = 0; i < E; i++) {
            const bf = b + i / E;
            if (bf < s0 || bf >= s1) continue;
            note(tr, bf, b + (i + 0.8) / E, starts.has(i) ? bn - 12 : bn, lev('bass', bf) * (starts.has(i) ? 1.12 : 0.85) * fadeOf(l, bf));
          }
          if (l.kind === 'pulse' && e > 0.6) for (const i of starts) if (b + i / E >= s0 && b + i / E < s1) note('basses_spic', b + i / E, b + (i + 0.9) / E, bassNote(ch, 28, 39), lev('bass', b));
        }
      }
    }
    // ---- pads: held chords that swell, with suspensions that resolve a beat late ----
    const susP = SUS_P[S.role] ?? 0.2;
    for (const [a0, b0, ch] of chordSpan) {
      const occupied = new Set();
      for (const l of L.pad) {
        const [s0, s1] = span(l);
        const a = Math.max(a0, s0), b = Math.min(b0, s1);
        if (b <= a) continue;
        if (l.track === '~pad') { const v = voicing(ch, 4, 50, 64, l.prev); l.prev = v; ev.push({ type: 'pad', t: timeOf(a), dur: timeOf(b) - timeOf(a), midis: v, lev: 0.06 + 0.12 * eAt(a) }); continue; }
        const nv = l.track === 'organ' || l.track === 'organ_soft' ? 4 : l.track === 'vln_high' ? 2 : 3;
        const v = voicing(ch, nv, l.reg[0], l.reg[1], l.prev, occupied);
        const prev = l.prev; l.prev = v;
        const swell = b - a >= 1 && !/organ/.test(l.track);
        let sus = -1;
        if (prev && a === a0 && b - a >= 1 && this.rng() < susP) {
          const sorted = [...prev].sort((x, y) => x - y);
          for (let i = 0; i < v.length; i++) { const d = sorted[i] - v[i]; if ((d === 1 || d === 2) && !ch.pcs.includes(sorted[i] % 12) && !v.includes(sorted[i])) { sus = i; break; } }
          if (sus >= 0) { const held = sorted[sus]; note(l.track, a, a + 1 / beats, held, lev('pad', a) * fadeOf(l, a)); note(l.track, a + 1 / beats, b, v[sus], lev('pad', a) * fadeOf(l, a), { fadeIn: 0.1, swell, fade: l.dovetail }); occupied.add(v[sus]); }
        }
        for (let i = 0; i < v.length; i++) { if (i === sus) continue; note(l.track, a, b, v[i], lev('pad', a) * fadeOf(l, a), { swell, fade: l.dovetail }); occupied.add(v[i]); }
      }
    }
    // ---- ostinati: the figures climb through a build and may thin to their accents for a phrase ----
    if (sb !== 0 && L.ost.length >= 2 && ['song', 'pulse', 'shadow', 'afterglow'].includes(S.role)
      && this.chance('pattern', 'Texture', 0.22, t0, 'one figure thins to its accents', 'full texture')) {
      const cands = L.ost.filter((l) => l.from <= sb);
      if (cands.length) cands[Math.floor(this.rng() * cands.length)].thin = true;
    }
    const climbOf = (bar) => (S.role === 'build' ? Math.round(7 * bar / S.bars) : S.role === 'arrival' && (P.arrivals || 0) >= 2 ? 5 : 0);
    for (const l of L.ost) {
      const [s0, s1] = span(l);
      if (s1 <= s0) continue;
      const n = l.slots;
      for (let b = 0; b < bars; b++) {
        const ch = chordAt(b);
        const lo = l.base - 3 + climbOf(sb + b);
        const tones = chordTones(ch, midiOfPc(ch.pcs[2], lo, lo + 11), 5);
        let groups = l.grouping;
        if (l.process === 'grow') { const g = 2 + ((sb + b) % 4); groups = []; let left = n; while (left > 0) { groups.push(Math.min(g, left)); left -= g; } }
        let pos = 0;
        for (const g of groups) {
          for (let j = 0; j < g && pos < n; j++, pos++) {
            const bf = b + pos / n;
            if (bf < s0 || bf >= s1) continue;
            if (l.thin && j !== 0) continue;
            const idx = l.process === 'cycle' ? (l.phase + pos) % l.cell.length : j % l.cell.length;
            const pitch = tones[l.cell[idx] % tones.length];
            note(l.track, bf, b + (pos + 1) / n, pitch, lev('ost', bf) * (j === 0 ? 1.12 : 0.88) * fadeOf(l, bf));
          }
        }
        l.phase = (l.phase + n) % 840;
      }
    }
    // ---- melody: the motif, developed; it remembers where it was across phrases ----
    const melLayers = L.mel.filter((l) => { const [s0, s1] = span(l); return s1 > s0; });
    if (melLayers.length) {
      const stmts = Math.max(1, Math.floor(bars / P.motif.bars));
      const ops = DEV_OPS[S.role] || DEV_OPS.song;
      const line = [];
      const arch = [0, 2, 4, 1, 3, 5, 2, 0];
      const lift0 = { arrival: 4, afterglow: 2, build: 2, song: 0, coda: 0 }[S.role] ?? 0;
      const lead = melLayers[0], leadFrom = Math.max(0, lead.from - sb);
      const pk = S.pickup || 0;
      for (let k = 0; k < stmts; k++) {
        const op = k === 0 && S.motifOps === 0 ? 'repeat' : this.pick('motif', 'Development', Object.entries(ops).map(([o, w]) => [o, w, o]), timeOf(k * P.motif.bars));
        S.motifOps++;
        const m = op === 'return' ? P.motif0 : P.motif;
        let durs = m.durs.slice(), steps = m.steps.slice();
        const full = m.bars * E;
        if (op === 'invert') steps = steps.map((x) => -x);
        if (op === 'augment') { const out = [], stp = []; let tot = 0; for (let q = 0; q < durs.length && tot < full; q++) { const d = Math.min(durs[q] * 2, full - tot); out.push(d); stp.push(steps[q]); tot += d; } durs = out; steps = stp; }
        if (op === 'fragment') { const half = Math.max(1, Math.ceil(durs.length / 2)); const fd = durs.slice(0, half); const tot = fd.reduce((a, b) => a + b, 0); if (tot * 2 <= full) { durs = fd.concat(fd); steps = steps.slice(0, half).concat(steps.slice(0, half).map((x) => x + 1)); durs[durs.length - 1] += full - tot * 2; } }
        if (op === 'answer') steps = steps.map((x, q) => (q === steps.length - 1 ? 0 : x));
        if (op === 'ornament') { const d2 = [], s2 = []; durs.forEach((d, q) => { if (d >= 4 && q + 1 < durs.length && Math.abs(steps[q + 1] - steps[q]) >= 2) { d2.push(d - 1, 1); s2.push(steps[q], steps[q] + Math.sign(steps[q + 1] - steps[q])); } else { d2.push(d); s2.push(steps[q]); } }); durs = d2; steps = s2; }
        const lift = op === 'sequence' ? (P.stmt % 2 ? 1 : -1) * (this.rng() < 0.4 ? 2 : 1) : op === 'climb' ? 1 + k : 0;
        const ch = chordAt(k * m.bars);
        let target = scaleStep(P.anchor, arch[P.stmt % arch.length] + lift0 + lift, P.tonic, S.mode);
        if (P.lastMelEnd !== null && Math.abs(target - P.lastMelEnd) > 5) target = Math.round((target + P.lastMelEnd) / 2);   // start near where the last phrase ended
        const anchor = nearestChordTone(target, ch, 3);
        P.stmt++;
        let pos = k * full;
        const end = (k + 1) * full;
        // a pickup: the statement begins a little before its downbeat, stepping or leaping up into its first note
        const startBar = k * m.bars;
        if (pk > 0 && startBar >= leadFrom && S.role !== 'arrival') {
          const first = nearestChordTone(scaleStep(anchor, steps[0], P.tonic, S.mode), ch, 2);
          const prevNote = line.length ? line[line.length - 1] : null;
          let okPk = false;
          if (k === 0) okPk = lead.from <= sb && lead.age >= 2 && P.melEndT <= timeOf(-pk / E) - 0.02;
          else if (prevNote && (prevNote[1] - prevNote[0]) * E >= pk + 2) { prevNote[1] = startBar - pk / E; okPk = true; }
          if (okPk) {
            const kindPk = this.roll([['step', 3], ['leap', 1.5], ['same', 1]]);
            const pp = kindPk === 'step' ? scaleStep(first, -1, P.tonic, S.mode) : kindPk === 'leap' ? nearestChordTone(first - 7, ch, 2) : first;
            line.push([startBar - pk / E, startBar, pp, k, true]);
          }
        }
        for (let q = 0; q < durs.length && pos < end; q++) {
          const d = Math.min(durs[q], end - pos);
          const barF = pos / E;
          let pch = scaleStep(anchor, steps[q], P.tonic, S.mode);
          if (pos % (E / 2) === 0 || d >= 4) pch = nearestChordTone(pch, chordAt(barF), 2);
          line.push([barF, (pos + d) / E, pch, k, false]);
          pos += d;
        }
      }
      if (line.length) {
        const last = line[line.length - 1];
        // the cadence decides where the tune lands: home on the tonic when the harmony resolves, otherwise on the last chord
        const lastCh = chordAt(last[0]);
        if (resolving || (S.role === 'coda' && isLast)) last[2] = nearestOf(last[2], [P.tonic % 12, (P.tonic + MODES[S.mode][2]) % 12, (P.tonic + 7) % 12], [P.tonic % 12], 6);
        else last[2] = nearestChordTone(last[2], lastCh, 4);
        const breathe = !['arrival', 'build'].includes(S.role) && bars >= 3 && this.chance('motif', 'End of the phrase', resolving ? 0.25 : 0.4, timeOf(last[0]), 'a rest before the next phrase', 'hold the last note', true);
        last[1] = breathe ? Math.max(last[0] + 0.25, bars - 0.5) : bars;
        P.lastMelEnd = last[2];
        P.melEndT = timeOf(last[1]);
        // the highest note of the phrase is its climax: a touch more weight
        let top = line[0]; for (const x of line) if (x[2] > top[2]) top = x; top[5] = 1.08;
      }
      // the first melody instrument carries the line; others answer, join at the ends, play a counter-line, or (in arrivals) double it
      melLayers.forEach((l, li) => {
        const [s0, s1] = span(l);
        let share = 'all';
        if (li > 0 && S.role !== 'arrival') share = l.share || (l.share = this.pick('motif', `${pretty(l.track)}: how it shares the tune`, [['answer', 2, 'takes alternate statements'], ['ending', 1.5, 'joins at the ends of phrases'], ['counter', 2, 'plays a slow counter-line'], ['all', 0.8, 'doubles the whole line']], timeOf(s0)));
        const lastK = line.length ? line[line.length - 1][3] : 0;
        if (share === 'counter') {
          let prevC = null, prevM = null;
          for (const [a, b] of chordSpan) {
            if (a < s0 || a >= s1) continue;
            const m = line.find((x) => x[0] <= a && x[1] > a) || line.find((x) => x[0] >= a) || line[line.length - 1];
            if (!m) continue;
            const ch = chordAt(a);
            const cands = []; for (let p = m[2] - 12; p <= m[2] - 3; p++) if (ch.pcs.includes(((p % 12) + 12) % 12)) cands.push(p);
            if (!cands.length) continue;
            let p;
            if (prevC === null || prevM === null) p = cands[Math.floor(cands.length / 2)];
            else { const up = m[2] > prevM; const pref = cands.filter((x) => (up ? x <= prevC : x >= prevC)); const pool = pref.length ? pref : cands; p = pool.reduce((best, x) => (Math.abs(x - prevC) < Math.abs(best - prevC) ? x : best), pool[0]); }
            note(l.track, a, Math.min(b, s1), Math.max(43, Math.min(96, p + l.oct)), lev('mel', a) * 0.8);
            prevC = p; prevM = m[2];
          }
          return;
        }
        for (const [a, b, p, k, isPk, acc] of line) {
          if (a < s0 - 0.5 || a >= s1) continue;
          if (share === 'answer' && k % 2 === 0 && line.some((x) => x[3] === k + 1)) continue;
          if (share === 'ending' && k !== lastK) continue;
          note(l.track, a, b, Math.max(43, Math.min(96, p + l.oct)), lev('mel', Math.max(0, a)) * (acc || 1) * (isPk ? 0.85 : 1));
        }
        if (e > 0.85 && l.track === 'vln_theme') for (const [a, b, p] of line) if (a >= s0 && a < s1 && p + 12 <= 98) note('vln_theme', a, b, p + 12, lev('mel', a) * 0.9);
      });
    }
    // ---- percussion & sound design: accents follow the hypermeter, not every bar ----
    if (e > 0.42) {
      const pat = S.timp || (S.timp = this.pick('pattern', 'Timpani pattern', [['downbeat', 3, 'downbeats'], ['pickup', 2, 'downbeat + pickup'], ['half', beats === 4 ? 1.2 : 0, 'half notes'], ['rolls', 1, 'rolls']], t0));
      for (let b = 0; b < bars; b++) {
        const bn = bassNote(chordAt(b), 33, 44), l = Math.min(1, 0.2 + eAt(b));
        const every = eAt(b) > 0.72;
        if (pat === 'rolls') { if (strong(b + 1)) note('timp_roll', b, b + 1, bn, Math.min(1, 0.3 + eAt(b) * 0.5)); }
        else {
          if (strong(b) || every) note('timpani', b, b + 0.5, bn, l);
          if (pat === 'half' && (strong(b) || every)) note('timpani', b + 0.5, b + 1, bn, l * 0.8);
          if (pat === 'pickup' && (strong(b + 1) || every)) note('timpani', b + (E - 1) / E, b + 1, bn, l * 0.75);
        }
      }
    }
    if (S.role === 'arrival') for (let b = 0; b < bars; b++) if (strong(b) || eAt(b) > 0.9) ev.push({ type: 'perc', kind: 'bd_f', t: timeOf(b), lev: 0.35 + 0.3 * eAt(b) });
    // brass accents on the strong bars of an arrival or the top of a build
    if (S.stabs && e > 0.65) {
      const busy = new Set(Object.values(L).flat().map((l) => l.track));
      const trs = ['trombones', 'horns_chords', 'trumpets'].filter((t) => !busy.has(t)).slice(0, 2);
      for (let b = 0; b < bars; b++) if (strong(b) || (S.role === 'arrival' && eAt(b) > 0.92 && (sb + b) % 2 === 0)) {
        const ch = chordAt(b);
        for (const tr of trs) { const v = voicing(ch, 3, tr === 'trombones' ? 43 : tr === 'trumpets' ? 62 : 50, tr === 'trombones' ? 60 : tr === 'trumpets' ? 76 : 64, null); for (const p of v) note(tr, b, b + 1.2 / beats, p, 0.92, { stab: true }); }
      }
    }
    // sub pulse re-struck each bar: a whisper in songs, a wall in arrivals
    const subLev = (x) => 0.05 + 0.75 * Math.pow(Math.min(1, Math.max(0, (x - 0.3) / 0.65)), 1.5);
    if (e > 0.32) for (let b = 0; b < bars; b++) ev.push({ type: 'sub', t: timeOf(b), dur: timeOf(b + 1) - timeOf(b), midi: bassNote(ped(chordAt(b)), 24, 35), lev: subLev(eAt(b)), att: 0.01, rel: 0.3 });
    if (S.bar === 0) {
      const jump = e - this.lastE;
      if (S.role === 'arrival' || jump > 0.22 || S.role === 'shadow') ev.push({ type: 'boom', t: t0, lev: Math.min(1, 0.35 + Math.max(0, jump) + (S.role === 'arrival' ? 0.4 : 0)), root: bassNote(chords[0], 22, 33) });
      if (S.role === 'arrival') { ev.push({ type: 'perc', kind: 'crash', t: t0, lev: 1 }); if (this.rng() < 0.6) ev.push({ type: 'perc', kind: 'gong', t: t0, lev: 0.9 }); }
      if (['emerge', 'still', 'coda'].includes(S.role)) {
        const sp = timeOf(Math.min(bars, S.bars)) - t0 + S.bars * barDur * 0.5;
        ev.push({ type: 'shimmer', t: t0, dur: sp, midi: P.anchor + 17, lev: 0.008, att: 5, rel: 5 });
        ev.push({ type: 'shimmer', t: t0 + barDur, dur: sp, midi: P.anchor + 12, lev: 0.006, att: 6, rel: 5 });
      }
    }
    // transitions prepare for the section that was actually chosen next
    if (isLast && nextRole === 'arrival') {
      const rb = Math.min(bars, 2);
      ev.push({ type: 'riser', t: timeOf(bars - rb), dur: timeOf(bars) - timeOf(bars - rb), lev: 0.45 });
      note('timp_roll', bars - rb, bars, midiOfPc(P.tonic, 33, 44), 0.9);
      // the brass hold the last chord and swell into the downbeat
      const busy = new Set(Object.values(L).flat().map((l) => l.track));
      const tr = busy.has('horns_chords') ? 'trombones' : 'horns_chords';
      const v = voicing(chordAt(bars - 0.01), 3, tr === 'trombones' ? 43 : 50, tr === 'trombones' ? 60 : 64, null);
      for (const p of v) note(tr, bars - rb, bars, p, 0.95, { rise: 0.3 });
      ev.push({ type: 'perc', kind: 'cym_roll', t: timeOf(bars), lev: 0.8, lead: 3.6 });
      if (this.chance('section', 'Just before the arrival', S.role === 'breath' ? 0.8 : 0.4, timeOf(bars - 0.5), 'a moment of silence', 'drive straight in')) ev.push({ type: 'gate', t0: timeOf(bars - 0.5 / beats), t1: timeOf(bars) - 0.004 });
    } else if (isLast && nextRole === 'breath') {
      ev.push({ type: 'riser', t: timeOf(Math.max(0, bars - 2)), dur: timeOf(bars) - timeOf(Math.max(0, bars - 2)), lev: 0.3 });
    }
    if (isLast && S.role === 'arrival' && nextRole === 'coda' && this.chance('section', 'End of the arrival', 0.6, timeOf(bars), 'a hard cut to silence', 'let it ring on')) {
      ev.push({ type: 'gate', t0: timeOf(bars), t1: timeOf(bars) + barDur - 0.4 });
      this.cutPending = true;
    }

    // ---- dynamics: turn levels into the engine's per-note curves, following the phrase's shape along each note ----
    const out = [];
    const ONESHOT = new Set(['piano', 'piano_low', 'piano_mel', 'vln_spic', 'vla_spic', 'vc_spic', 'basses_spic', 'harp', 'timpani', 'marimba', 'glock', 'vln_pizz', 'vc_pizz']);
    const byTrack = {};
    for (const n of ev) if (n.type === 'note') (byTrack[n.track] = byTrack[n.track] || []).push(n); else out.push(n);
    for (const [track, list] of Object.entries(byTrack)) {
      list.sort((a, b) => a.t - b.t);
      const legato = ['vln_theme', 'vc_theme', 'horns', 'trumpets', 'oboe'].includes(track);
      for (const n of list) {
        const d0 = Math.min(1, Math.max(0.03, n.lev));
        if (!ONESHOT.has(track) && !n.stab) {
          const k = Math.max(2, Math.floor(n.dur / 0.3));
          const base = eAt(Math.max(0, n.b0));
          n.dyn = Array.from({ length: k + 1 }, (_, i) => {
            const x = i / k;
            let v;
            if (n.rise !== undefined) v = n.lev * (n.rise + (1 - n.rise) * Math.pow(x, 1.5));
            else {
              v = d0 * eAt(Math.max(0, n.b0 + (n.b1 - n.b0) * x)) / base;
              if (n.swell) v *= 0.85 + 0.2 * Math.sin(Math.PI * Math.pow(x, 0.9));
              if (n.fade) v *= 1 - 0.8 * x;
              if (legato && n.dur > 1.2) v *= 0.93 + 0.11 * Math.sin(Math.PI * Math.min(1, x / 0.85)) - 0.04 * Math.max(0, (x - 0.85) / 0.15);
            }
            return [n.dur * x, Math.min(1, Math.max(0.03, v))];
          });
        } else n.dyn = d0;
        if (legato) {
          n.legIn = list.some((m) => m.t < n.t - 0.05 && Math.abs(m.t + m.dur - n.t) < 0.06);
          n.legOut = list.some((m) => m.t > n.t + 0.05 && Math.abs(m.t - (n.t + n.dur)) < 0.06);
        }
        delete n.lev; delete n.b0; delete n.b1; delete n.swell; delete n.rise; delete n.stab; delete n.fade;
        out.push(n);
      }
    }
    out.sort((a, b) => (a.t ?? a.t0) - (b.t ?? b.t0));
    const tEnd = timeOf(bars);
    this.lastE = e;
    S.bar = sb + bars;
    S.phraseIdx = phI + 1;
    P.elapsed += tEnd - t0;
    this.t = tEnd;
    const decisions = this.decisions.splice(0);
    const info = {
      piece: P.no, section: S.role, key: spell(P.tonic, P.tonic), mode: S.mode, meter: P.meter.name, bpm: S.bpm, energy: e, t0, t1: tEnd,
      palette: P.palette, cadence, sectionBar: sb, sectionBars: S.bars, plan: S.plan, phrase: phI, phraseBars: bars, kind,
      chords: chordSpan.map(([a, , c]) => ({ t: timeOf(a), name: c.name, num: c.num })),
      layers: Object.entries(L).flatMap(([r, ls]) => ls.map((l) => ({ role: r, track: l.track, desc: l.desc, enter: timeOf(Math.max(0, l.from - sb)), exit: l.until === Infinity ? Infinity : timeOf(l.until - sb) }))),
      rolls: this.rolls,
    };
    return { events: out, info, decisions };
  }
}
