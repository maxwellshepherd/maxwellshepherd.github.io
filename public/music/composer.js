// Procedural composer: an endless stream of pieces in the style of "Threshold"
// (Danna's slow harmonic rhythm and pedal pulse, Glass's ostinati, Zimmer's organ and arrival).

export const PCN = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_KEYS = new Set([2, 4, 6, 9, 11]);      // D, E, F#, A, B (minor) spell with sharps
let spellTonic = 2;
export const spell = (pc, tonic = spellTonic) => {
  const sharp = SHARP_KEYS.has(tonic);
  return (sharp ? ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'] : ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'])[pc]
    .replace(/^Gb$/, tonic === 3 || tonic === 8 || tonic === 1 ? 'Gb' : 'F#').replace(/^D#$/, tonic === 4 || tonic === 11 ? 'D#' : 'Eb');
};
const QUAL = {
  m: [0, 3, 7], M: [0, 4, 7], sus4: [0, 5, 7], m9: [0, 3, 7, 2], add9: [0, 4, 7, 2], maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10], '7sus': [0, 5, 7, 10],
};
const NUM = {
  // minor
  i: [0, 'm'], III: [3, 'M'], iv: [5, 'm'], v: [7, 'm'], V: [7, 'M'], Vsus: [7, 'sus4'], VI: [8, 'M'], VII: [10, 'M'],
  bII: [1, 'M'], IV: [5, 'M'],
  // major
  I: [0, 'M'], ii: [2, 'm'], iii: [4, 'm'], vi: [9, 'm'], bVI: [8, 'M'], bVII: [10, 'M'],
};
const COLOR = { m: 'm9', M: 'add9', sus4: 'sus4' };
const TO_MAJOR = { i: 'I', VI: 'vi', III: 'IV', VII: 'V', iv: 'IV', v: 'V', V: 'V', Vsus: 'Vsus', IV: 'IV' };

const PROG_A = [['i', 'VI', 'III', 'VII'], ['i', 'VI', 'iv', 'V'], ['i', 'iv', 'VI', 'V'], ['i', 'VII', 'VI', 'VII'],
  ['i', 'III', 'VII', 'iv'], ['i', 'VI', 'III', 'v'], ['i', 'v', 'VI', 'III'], ['i', 'VI', 'VII', 'III']];
const CAD_B = [['iv', 'V'], ['VI', 'V'], ['iv', 'Vsus'], ['VI', 'Vsus'], ['iv', 'V']];

// ---------------------------------------------------------------------------
// theory helpers
// ---------------------------------------------------------------------------
function chord(tonic, num, color = false, pedal = false) {
  const [deg, q0] = NUM[num];
  const q = color ? (COLOR[q0] || q0) : q0;
  const root = (tonic + deg) % 12;
  const pcs = QUAL[q].map((x) => (root + x) % 12);
  return { root, q, pcs, bass: pedal ? tonic : root, num, name: spell(root, tonic) + ({ m: 'm', M: '', sus4: 'sus4', m9: 'm9', add9: 'add9', maj7: 'maj7', m7: 'm7', '7sus': '7sus4' }[q]) + (pedal && root !== tonic ? '/' + spell(tonic, tonic) : '') };
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
function arpTones(ch, lo, hi) {
  const t = []; for (let p = lo; p <= hi + 12 && t.length < 4; p++) if (ch.pcs.includes(p % 12)) t.push(p);
  return t;
}
// piano ostinato set: [5th below, root, 9th, 3rd] around the treble staff (the "Threshold" voicing)
function ostSet(ch) {
  const r = midiOfPc(ch.root, 65, 76);
  const third = ch.q === 'sus4' || ch.q === '7sus' ? 5 : (ch.pcs.includes((ch.root + 3) % 12) && !ch.pcs.includes((ch.root + 4) % 12) ? 3 : 4);
  return [r - 5, r, r + 2, r + third];
}

// ---------------------------------------------------------------------------
// theme generator
// ---------------------------------------------------------------------------
const RH_OPEN = [[3, 3, 2], [3, 1, 4], [2, 2, 4], [3, 3, 1, 1]];
const RH_MID = [[5, 1, 2], [6, 1, 1], [4, 4], [5, 3], [3, 1, 2, 1, 1], [6, 2]];
const RH_END = [[6, 2], [8], [4, 2, 2], [6, 1, 1]];
const MINOR = [0, 2, 3, 5, 7, 8, 10], MAJOR = [0, 2, 4, 5, 7, 9, 11];

function makeTheme(rng, tonic, anchor, chordsA, chordsB) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const units = [pick(RH_OPEN), pick(RH_MID), pick(RH_MID), pick(RH_END)];
  units.push(units[0], pick(RH_MID), pick(RH_MID.filter((u) => u.length >= 3)), [4, 2, 2]);
  const targets = [0, 8, 3, 10, 0, 12, 13, 12].map((x) => x + Math.round((rng() - 0.5) * 2));
  const chords = [...chordsA, ...chordsB];
  // walking tones: natural minor; the leading tone only where the chord is the major dominant
  const scaleFor = (ch) => (p) => {
    const rel = ((p - tonic) % 12 + 12) % 12;
    if (ch.pcs.includes((tonic + 11) % 12)) return rel === 11 || (MINOR.includes(rel) && rel !== 10);
    return MINOR.includes(rel);
  };
  const lo = anchor - 3, hi = anchor + 15;
  const notes = [];
  let prev = anchor;
  const startNotes = [];
  for (let u = 0; u < 8; u++) {
    const ch = chords[u];
    const tgt = anchor + targets[u];
    let cand = [];
    for (let p = lo; p <= hi; p++) if (ch.pcs.includes(p % 12)) cand.push(p);
    let s0 = cand.reduce((b, p) => (Math.abs(p - tgt) + 0.3 * Math.abs(p - prev) < Math.abs(b - tgt) + 0.3 * Math.abs(b - prev) ? p : b), cand[0]);
    if (u === 0 || u === 4) s0 = midiOfPc((tonic + 7) % 12, anchor - 1, anchor + 11);   // the question starts on the 5th
    startNotes.push(s0);
    prev = s0;
  }
  for (let u = 0; u < 8; u++) {
    const rh = units[u];
    const ch = chords[u];
    const s0 = startNotes[u];
    const next = u < 7 ? startNotes[u + 1] : s0;
    let beat = u * 8, cur = s0;
    for (let k = 0; k < rh.length; k++) {
      let p;
      if (k === 0) p = s0;
      else if (u === 7) {          // final unit of phrase B: dominant arpeggio down to the leading tone
        const dom = [(tonic + 7) % 12, (tonic + 2) % 12, (tonic + 11) % 12];
        p = midiOfPc(dom[Math.min(k, 2)], cur - 9, cur - 1);
      } else if (k === 1 && (u === 0 || u === 4)) {     // leap up a fourth to the tonic
        p = midiOfPc(tonic, cur + 3, cur + 8);
      } else {
        const dir = Math.sign(next - cur) || -1;
        const scale = scaleFor(ch);
        p = cur + dir;
        while (!scale(p)) p += dir;
        if (Math.abs(next - p) > 0 && Math.abs(next - cur) <= 2 && k === rh.length - 1) { /* approach tone */ }
      }
      p = Math.max(lo, Math.min(hi + 2, p));
      notes.push({ beat, dur: rh[k], midi: p, strong: k === 0 });
      cur = p; beat += rh[k];
    }
  }
  // fix final unit for phrase B: hold the 5th, then step down to the leading tone
  return notes;
}

function majorize(notes, tonic, chordsMaj) {
  return notes.map((n, i) => {
    const rel = ((n.midi - tonic) % 12 + 12) % 12;
    const oct = n.midi - rel;
    const di = MINOR.indexOf(rel);
    let m = di >= 0 ? oct + MAJOR[di] : n.midi;
    const ch = chordsMaj[Math.floor(n.beat / 8)];
    if (n.strong && !ch.pcs.includes(m % 12)) {
      let best = m, bd = 99;
      for (let p = m - 3; p <= m + 3; p++) if (ch.pcs.includes(p % 12) && Math.abs(p - m) < bd) { bd = Math.abs(p - m); best = p; }
      m = best;
    }
    return { ...n, midi: m };
  });
}

// ---------------------------------------------------------------------------
// section builder
// ---------------------------------------------------------------------------
class Sec {
  constructor(piece, name, t0, bpm, bars, chords) {
    Object.assign(this, { piece, name, t0, bpm, bars, chords });
    this.notes = [];       // [track, beat, durBeats, pitch, vel, opts]
    this.expr = {};
    this.events = [];
    this.rit = 0;          // ritardando over the last 2 bars (fraction of tempo lost)
  }
  B(bar, beat = 0) { return 4 * (bar - 1) + beat; }
  sec(beat) {
    const spb = 60 / this.bpm, total = this.bars * 4;
    if (!this.rit) return this.t0 + beat * spb;
    const r0 = total - 8;
    if (beat <= r0) return this.t0 + beat * spb;
    // integrate slowing tempo
    let t = this.t0 + r0 * spb, b = r0;
    while (b < beat) { const st = Math.min(0.125, beat - b); const f = 1 - this.rit * Math.min(1, (b - r0) / 8); t += st * spb / f; b += st; }
    return t;
  }
  get end() { return this.sec(this.bars * 4); }
  ch(bar) { return this.chords[Math.min(this.bars, Math.max(1, bar)) - 1]; }
  add(track, beat, dur, pitch, vel = 1, opts = {}) { this.notes.push([track, beat, dur, pitch, vel, opts]); }
  e(track, ...pts) { (this.expr[track] = this.expr[track] || []).push(...pts.map(([b, v]) => [4 * (b - 1), v])); this.expr[track].sort((a, b) => a[0] - b[0]); }
  exprAt(track, beat) {
    const p = this.expr[track];
    if (!p || !p.length) return 0.6;
    if (beat <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) if (beat <= p[i][0]) { const [b0, v0] = p[i - 1], [b1, v1] = p[i]; return v0 + (v1 - v0) * (beat - b0) / Math.max(1e-6, b1 - b0); }
    return p[p.length - 1][1];
  }
  ev(e) { this.events.push(e); }
  spans(b0, b1, same = (a, b) => a.name === b.name) {
    const out = []; let b = b0;
    while (b < b1) { let L = 1; while (b + L < b1 && same(this.ch(b + L), this.ch(b))) L++; out.push([b, L, this.ch(b)]); b += L; }
    return out;
  }
  finalize(sustainKinds, cutBeat = null) {
    const evs = [];
    const legTracks = new Set(['vln_theme', 'vc_theme', 'horns', 'trumpets']);
    // legato topology per track
    const byTrack = {};
    for (const n of this.notes) (byTrack[n[0]] = byTrack[n[0]] || []).push(n);
    for (const [track, list] of Object.entries(byTrack)) {
      list.sort((a, b) => a[1] - b[1]);
      const sus = sustainKinds(track);
      for (const n of list) {
        const [, beat, durB, pitch, vel, opts] = n;
        let endB = beat + durB;
        if (cutBeat !== null && endB > cutBeat) endB = cutBeat;
        const t0 = this.sec(beat), t1 = this.sec(endB);
        const d = Math.max(0.05, t1 - t0);
        let dyn;
        if (sus) {
          const k = Math.max(2, Math.floor(d / 0.25) + 1);
          dyn = [];
          for (let i = 0; i <= k; i++) {
            const b = beat + (endB - beat) * i / k;
            let v = this.exprAt(track, b) * vel;
            if (legTracks.has(track) && d > 1.2) { const x = (d * i / k) / d; v *= 0.93 + 0.11 * Math.sin(Math.PI * Math.min(1, x / 0.85)) - 0.04 * Math.max(0, (x - 0.85) / 0.15); }
            dyn.push([d * i / k, Math.min(1, Math.max(0, v))]);
          }
          if (Math.max(...dyn.map((p) => p[1])) < 0.02) continue;
        } else {
          dyn = Math.min(1, Math.max(0, this.exprAt(track, beat) * vel));
          if (dyn < 0.02) continue;
        }
        let legIn = false, legOut = false;
        if (legTracks.has(track) && !opts.rearticulate) {
          legIn = list.some((m) => m[1] < beat - 0.05 && Math.abs(m[1] + m[2] - beat) < 0.06);
          legOut = list.some((m) => m[1] > beat + 0.05 && Math.abs(m[1] - endB) < 0.06);
        }
        evs.push({ type: 'note', track, t: t0, dur: d, pitch, dyn, legIn, legOut, ...opts });
      }
    }
    return evs.concat(this.events).sort((a, b) => (a.t ?? a.t0) - (b.t ?? b.t0));
  }
}

// ---------------------------------------------------------------------------
// reusable layers
// ---------------------------------------------------------------------------
function pianoOst(S, b0, b1, mode = '8', track = 'piano', oct = 0, vel = 1) {
  for (let b = b0; b < b1; b++) {
    const [lo, mid, t1, t2] = ostSet(S.ch(b)).map((p) => p + oct);
    if (mode === '16') {
      const pat = [lo, mid, t1, lo, mid, t2, mid, t1];
      for (let i = 0; i < 16; i++) S.add(track, S.B(b, i * 0.25), 0.3, pat[i % 8], vel * ([0, 3, 6].includes(i % 8) ? 1.1 : 0.86));
    } else if (mode === 'broken') {      // Glass broken-chord alternation
      const pat = [lo, t2, mid, t2, lo, t1, mid, t1];
      for (let i = 0; i < 8; i++) S.add(track, S.B(b, i * 0.5), 0.5, pat[i], vel * (i % 2 === 0 ? 1.08 : 0.9));
    } else {
      const pat = [lo, mid, t1, lo, mid, t2, lo, mid], acc = [1, 0, 0, 1, 0, 0, 1, 0];
      for (let i = 0; i < 8; i++) S.add(track, S.B(b, i * 0.5), 0.5, pat[i], vel * (1 + 0.12 * acc[i] - (i % 3 === 2 ? 0.04 : 0)));
    }
  }
}
function sustainBass(S, track, b0, b1, lo, hi, octUp = 0) {
  for (const [b, L, ch] of S.spans(b0, b1, (a, c) => a.bass === c.bass && a.root === c.root)) {
    for (let k = 0; k < L; k += 4) S.add(track, S.B(b + k), 4 * Math.min(4, L - k), bassNote(ch, lo, hi) + octUp, 1);
  }
}
function pads(S, track, b0, b1, nv, lo, hi) {
  let prev = null;
  for (const [b, L, ch] of S.spans(b0, b1)) { const v = voicing(ch, nv, lo, hi, prev); prev = v; for (const p of v) S.add(track, S.B(b), 4 * L, p, 1); }
}
function clar3(S, b0, b1, track = 'clarinets', lo = 62, hi = 74, order = [0, 2, 1]) {
  for (let b = b0; b < b1; b++) {
    const tones = arpTones(S.ch(b), lo, hi);
    for (let i = 0; i < 8; i++) { const g = (b - 1) * 8 + i; S.add(track, S.B(b, i * 0.5), 0.5, tones[order[g % 3]], 0.95 + (g % 3 === 0 ? 0.1 : 0)); }
  }
}
function spicEngine(S, b0, b1, { vln = true, cb = true } = {}) {
  for (let b = b0; b < b1; b++) {
    const ch = S.ch(b);
    const v = voicing(ch, 2, 57, 69);
    const bn = bassNote(ch, 48, 59);
    const tones = arpTones(ch, 69, 81);
    for (let i = 0; i < 8; i++) {
      S.add('vla_spic', S.B(b, i * 0.5), 0.4, v[i % 2], i % 2 === 0 ? 1.1 : 0.85);
      S.add('vc_spic', S.B(b, i * 0.5), 0.4, bn - ([0, 3, 6].includes(i) ? 12 : 0), [0, 3, 6].includes(i) ? 1.15 : 0.85);
      const g = (b - 1) * 8 + i;
      if (vln) S.add('vln_spic', S.B(b, i * 0.5), 0.4, tones[g % 3], g % 3 === 0 ? 1.12 : 0.86);
    }
    if (cb) for (const i of [0, 3, 6]) S.add('basses_spic', S.B(b, i * 0.5), 0.45, bassNote(ch, 28, 39), 1);
  }
}
function themeOn(S, track, notes, startBar, transpose = 0, sel = null) {
  for (const n of notes) {
    if (sel && !(n.beat >= sel[0] && n.beat < sel[1])) continue;
    S.add(track, S.B(startBar) + n.beat - (sel ? sel[0] : 0), n.dur, n.midi + transpose, 1);
  }
}
function subPerBar(S, b0, b1, levFn, pedal = null) {
  for (let b = b0; b < b1; b++) {
    const m = pedal ?? bassNote(S.ch(b), 24, 35);
    S.ev({ type: 'sub', t: S.sec(S.B(b)), dur: S.sec(S.B(b + 1)) - S.sec(S.B(b)), midi: m, lev: levFn(b), att: 0.01, rel: 0.3 });
  }
}
function padLayer(S, b0, b1, lev) {
  let prev = null;
  for (const [b, L, ch] of S.spans(b0, b1)) {
    const v = voicing(ch, 4, 50, 64, prev); prev = v;
    S.ev({ type: 'pad', t: S.sec(S.B(b)), dur: S.sec(S.B(b + L)) - S.sec(S.B(b)), midis: v, lev });
  }
}
const boomEv = (S, bar, lev) => S.ev({ type: 'boom', t: S.sec(S.B(bar)), lev, root: bassNote(S.ch(bar), 22, 33) });

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------
function secQuestions(P, t0) {
  const T = P.tonic, c = (n, col, ped) => chord(T, n, col, ped);
  const chords = [c('i'), c('i'), P.A[0], P.A[0], P.A[1], P.A[1], c('iv', true), c('Vsus')];
  const S = new Sec(P, 'Questions', t0, P.bpm, 8, chords);
  const top = P.anchor + 5;   // tonic in the theme octave
  S.ev({ type: 'shimmer', t: S.sec(0), dur: S.sec(36) - S.sec(0), midi: top + 12, lev: 0.012, att: 6, rel: 5 });
  S.ev({ type: 'shimmer', t: S.sec(2), dur: S.sec(36) - S.sec(2), midi: P.anchor + 12, lev: 0.012, att: 7, rel: 5 });
  S.e('vln_high', [1, 0], [2, 0.22], [4, 0.3], [7, 0.26], [8.5, 0.18], [9, 0]);
  for (const [p, b, d] of [[P.anchor + 12, 0, 32], [top + 12, 2, 30], [top + 14, 6, 10], [top + 15, 16, 12]]) S.add('vln_high', b, d, p, 1);
  boomEv(S, 3, 0.42);
  S.ev({ type: 'sub', t: S.sec(S.B(3)), dur: S.sec(S.B(4)) - S.sec(S.B(3)), midi: bassNote(S.ch(3), 24, 35), lev: 0.15, att: 0.02, rel: 9 });
  // solo piano asks the theme's question (first two units over bars 3-6)
  S.e('piano', [1, 0.55], [9, 0.5]);
  themeOn(S, 'piano', P.theme.map((n) => ({ ...n, dur: n.dur + 0.5 })), 3, 0, [0, 16]);
  const iv = S.ch(7), V = S.ch(8);
  S.add('piano', S.B(7), 2.5, midiOfPc(iv.pcs[2], P.anchor - 3, P.anchor + 8), 0.9);
  S.add('piano', S.B(7, 2), 1.5, midiOfPc(iv.pcs[0], P.anchor - 5, P.anchor + 6), 0.8);
  S.add('piano', S.B(8), 4.5, midiOfPc(V.pcs[0], P.anchor - 3, P.anchor + 8), 0.85);
  S.e('piano_low', [1, 0.36], [9, 0.36]);
  for (const b of [3, 5, 7, 8]) {
    const ch = S.ch(b), bn = bassNote(ch, 33, 44);
    [bn, bn + 7, bn + 12 + (ch.pcs.includes((ch.root + 3) % 12) ? 3 : 4)].forEach((p, k) => S.add('piano_low', S.B(b, k * 0.5), (b < 7 ? 8 : 4) - k * 0.5, p, 0.9 - 0.1 * k));
  }
  S.e('basses', [5, 0], [6, 0.25], [8, 0.35], [9, 0.3]);
  S.e('vc_pad', [5, 0], [6, 0.22], [8, 0.35], [9, 0.3]);
  sustainBass(S, 'basses', 5, 9, 28, 39);
  sustainBass(S, 'vc_pad', 5, 9, 36, 47, 12);
  return S;
}

function secMethod(P, t0, opts = {}) {
  const chords = [];
  for (let k = 0; k < 2; k++) for (const ch of P.A) chords.push(ch, chord(P.tonic, ch.num, P.rng() < 0.6));
  chords.push(P.Bc[2], chord(P.tonic, P.Bc[2].num, true), P.Bc[3], P.Bc[3].q === 'sus4' ? chord(P.tonic, 'V') : P.Bc[3]);
  const S = new Sec(P, opts.name || 'Method', t0, P.bpm, 20, chords);
  const mode = P.ostMode;
  S.e('piano', [1, 0.42], [9, 0.46], [17, 0.5], [20, 0.58], [21, 0.4]);
  pianoOst(S, 1, 21, mode);
  S.e('piano_low', [1, 0.4], [17, 0.48], [21, 0.4]);
  for (const [b, L, ch] of S.spans(1, 21, (a, c) => a.root === c.root)) { const bn = bassNote(ch, 36, 47); S.add('piano_low', S.B(b), 4 * L, bn, 0.95); S.add('piano_low', S.B(b, 0.02), 4 * L, bn - 12, 0.8); }
  S.e('basses', [1, 0.3], [9, 0.42], [17, 0.5], [20, 0.62], [21, 0.25]);
  S.e('vc_pad', [1, 0.3], [9, 0.42], [17, 0.5], [20, 0.65], [21, 0.25]);
  sustainBass(S, 'basses', 1, 21, 28, 39);
  sustainBass(S, 'vc_pad', 1, 21, 36, 47);
  S.e('clarinets', [5, 0], [6, 0.3], [9, 0.38], [17, 0.48], [20, 0.6], [21, 0]);
  clar3(S, 5, 21, 'clarinets', 62, 74, P.rng() < 0.5 ? [0, 1, 2] : [0, 2, 1]);
  S.e('vla_pad', [5, 0], [7, 0.3], [9, 0.38], [17, 0.5], [20, 0.62], [21, 0]);
  pads(S, 'vla_pad', 5, 21, 2, 53, 65);
  // theme: violins (or cellos in reflective pieces) on the second pass
  const lead = opts.lead || 'vln_theme';
  const tr = lead === 'vc_theme' ? -12 : 0;
  S.e(lead, [9, 0.2], [10, 0.38], [13, 0.5], [15, 0.46], [17, 0.55], [19, 0.66], [20.8, 0.72], [21, 0]);
  themeOn(S, lead, P.theme, 9, tr, [0, 32]);
  themeOn(S, lead, P.theme, 17, tr, [48, 64]);
  S.e('vln_pad', [13, 0], [14, 0.28], [17, 0.38], [20, 0.55], [21, 0]);
  pads(S, 'vln_pad', 13, 21, 2, 69, 81);
  S.e('organ_soft', [13, 0], [15, 0.35], [17, 0.45], [20, 0.6], [21, 0.2]);
  pads(S, 'organ_soft', 13, 21, 4, 57, 69);
  S.e('horns_chords', [9, 0], [10, 0.28], [16, 0.34], [17, 0.38], [18, 0.3], [19, 0.45], [20.7, 0.62], [21, 0]);
  pads(S, 'horns_chords', 9, 21, 3, 48, 60);
  S.e('timp_roll', [19, 0.15], [20.9, 0.7], [21, 0]);
  S.add('timp_roll', S.B(19), 8, bassNote(S.ch(19), 33, 44), 1);
  S.ev({ type: 'riser', t: S.sec(S.B(19)), dur: S.sec(S.B(21)) - S.sec(S.B(19)), lev: 0.25 });
  padLayer(S, 1, 21, 0.1);
  for (let b = 1; b < 21; b++) S.ev({ type: 'sub', t: S.sec(S.B(b)), dur: S.sec(S.B(b + 1)) - S.sec(S.B(b)), midi: bassNote(S.ch(b), 24, 35), lev: 0.06 + 0.05 * b / 20, att: 0.25, rel: 0.6 });
  return S;
}

function secNight(P, t0) {
  const T = P.tonic, c = (n, col) => chord(T, n, col, true);
  const chords = [c('i'), c('bII'), c('i'), c('bII', true), c('VI'), c('bII'), c('iv'), c('V')];
  chords[3] = { ...chords[3], pcs: [...chords[1].pcs, (chords[1].root + 11) % 12], name: chords[1].name.replace('/', 'maj7/') };
  const S = new Sec(P, 'Night', t0, P.bpm, 8, chords);
  const ped = midiOfPc(T, 36, 47);
  S.ev({ type: 'sub', t: S.sec(0), dur: S.sec(32) - S.sec(0), midi: midiOfPc(T, 24, 35), lev: 0.2, att: 1.5, rel: 3 });
  boomEv(S, 1, 0.45);
  S.e('organ_pedal', [1, 0.35], [8, 0.5], [9, 0.6]);
  S.add('organ_pedal', 0, 32, ped, 1); S.add('organ_pedal', 0, 32, ped - 12, 0.95);
  S.e('basses', [1, 0.25], [5, 0.35], [8, 0.5], [9, 0.55]);
  S.add('basses', 0, 32, ped, 1);
  S.e('vc_spic', [1, 0.22], [5, 0.32], [8.5, 0.48], [9, 0.5]);
  for (let b = 1; b <= 8; b++) for (let i = 0; i < 8; i++) S.add('vc_spic', S.B(b, i * 0.5), 0.4, ped + 12, i % 4 === 0 ? 1.15 : (i % 2 ? 0.8 : 0.9));
  S.e('vln_trem', [1, 0], [2, 0.3], [5, 0.36], [8, 0.5], [9, 0]);
  let prev = null;
  for (let b = 1; b <= 8; b++) { const v = voicing(S.ch(b), 3, 67, 79, prev); prev = v; for (const p of v) S.add('vln_trem', S.B(b), 4, p, 1); }
  S.e('vla_pad', [1, 0], [2, 0.3], [8, 0.45], [9, 0.4]);
  for (let b = 1; b <= 8; b++) for (const p of voicing(S.ch(b), 2, 55, 64)) S.add('vla_pad', S.B(b), 4, p, 1);
  S.e('piano_low', [1, 0.38], [9, 0.42]);
  const head = P.theme.filter((n) => n.beat < 16);
  for (const n of head) S.add('piano_low', S.B(2) + n.beat, n.dur + 1, n.midi - 12, 0.9);
  for (const n of head.slice(0, 3)) S.add('piano_low', S.B(6) + n.beat, n.dur + 1, n.midi - 12, 0.9);
  S.e('horns_chords', [3, 0], [4, 0.32], [5, 0.15], [7, 0.25], [8.8, 0.55], [9, 0]);
  for (const b of [3, 4, 7, 8]) for (const p of voicing(S.ch(b), 3, 50, 63)) S.add('horns_chords', S.B(b), 4, p, 1);
  S.e('harp', [1, 0.5], [9, 0.5]);
  for (let b = 1; b <= 8; b++) { const p = midiOfPc(S.ch(b).pcs[b % 3], P.anchor, P.anchor + 11); S.add('harp', S.B(b, 1.5), 2, p, 0.8); S.add('harp', S.B(b, 3), 2, p - 12, 0.6); }
  S.e('timp_roll', [7, 0.1], [8.95, 0.8], [9, 0]);
  S.add('timp_roll', S.B(7), 8, midiOfPc(T, 33, 44), 1);
  S.ev({ type: 'shimmer', t: S.sec(0), dur: S.sec(32) - S.sec(0), midi: P.anchor + 17, lev: 0.016, att: 4, rel: 4 });
  S.ev({ type: 'riser', t: S.sec(S.B(7)), dur: S.sec(S.B(9)) - S.sec(S.B(7)), lev: 0.35 });
  return S;
}

function secAscent(P, t0, { minorEnd = false } = {}) {
  const T = P.tonic, c = (n, col, ped) => chord(T, n, col, ped);
  const chords = [c('i'), c('i'), c('VI', false, true), c('VI', false, true), c('iv', false, true), c('iv', false, true), c('bII', false, true), c('bII', true, true)];
  for (const ch of P.A) chords.push(ch, chord(T, ch.num, P.rng() < 0.5));
  chords.push(c('iv'), c('iv', true), c('Vsus'), c('V'));
  const S = new Sec(P, 'Ascent', t0, P.bpm, 20, chords);
  const ped = midiOfPc(T, 24, 35);
  boomEv(S, 1, 0.75); boomEv(S, 9, 0.6);
  subPerBar(S, 1, 21, (b) => 0.3 + 0.12 * (b - 1) / 19, null);
  for (let i = S.events.length - 20; i < S.events.length - 12; i++) S.events[i].midi = ped;
  S.e('piano', [1, 0.48], [9, 0.5], [17, 0.56], [20, 0.64], [21, 0.66]);
  pianoOst(S, 1, 9, P.ostMode);
  pianoOst(S, 9, 21, '16');
  S.e('piano_low', [1, 0.45], [21, 0.55]);
  for (let b = 1; b < 21; b++) { const bn = b < 9 ? ped + 12 : bassNote(S.ch(b), 36, 47); S.add('piano_low', S.B(b), 4, bn, 0.9); S.add('piano_low', S.B(b), 4, bn - 12, 0.8); }
  S.e('basses', [1, 0.5], [9, 0.55], [17, 0.65], [20.8, 0.8], [21, 0.8]);
  S.add('basses', 0, 32, ped + 12, 1);
  sustainBass(S, 'basses', 9, 21, 28, 39);
  S.e('vc_spic', [1, 0.45], [9, 0.55], [17, 0.65], [21, 0.72]);
  S.e('vla_spic', [1, 0.38], [9, 0.48], [17, 0.58], [21, 0.65]);
  S.e('vln_spic', [9, 0.4], [17, 0.52], [21, 0.6]);
  S.e('basses_spic', [9, 0.45], [17, 0.55], [21, 0.65]);
  for (let b = 1; b < 9; b++) {
    const v = voicing(S.ch(b), 2, 57, 69);
    for (let i = 0; i < 8; i++) { S.add('vc_spic', S.B(b, i * 0.5), 0.4, ped + 24, [0, 3, 6].includes(i) ? 1.15 : 0.85); S.add('vla_spic', S.B(b, i * 0.5), 0.4, v[i % 2], i % 2 ? 0.85 : 1.1); }
  }
  spicEngine(S, 9, 21);
  S.e('clarinets', [5, 0], [6, 0.35], [9, 0.45], [17, 0.55], [21, 0.6]);
  clar3(S, 5, 21);
  S.e('organ_pedal', [1, 0.6], [9, 0.65], [21, 0.75]);
  S.add('organ_pedal', 0, 32, ped + 12, 1); S.add('organ_pedal', 0, 32, ped, 0.95);
  for (const [b, L, ch] of S.spans(9, 21, (a, c2) => a.bass === c2.bass)) { const bn = bassNote(ch, 36, 47); S.add('organ_pedal', S.B(b), 4 * L, bn, 1); S.add('organ_pedal', S.B(b), 4 * L, bn - 12, 0.95); }
  S.e('organ', [5, 0], [7, 0.3], [9, 0.42], [17, 0.55], [20.8, 0.72], [21, 0.75]);
  pads(S, 'organ', 5, 21, 4, 62, 74);
  S.e('vla_pad', [1, 0.4], [9, 0.45], [17, 0.55], [21, 0.6]);
  S.e('vln_pad', [1, 0], [3, 0.3], [9, 0.42], [17, 0.55], [21, 0.65]);
  pads(S, 'vla_pad', 1, 21, 2, 53, 65); pads(S, 'vln_pad', 1, 21, 2, 69, 81);
  S.e('vc_pad', [1, 0.45], [9, 0.5], [17, 0.6], [21, 0.65]);
  S.add('vc_pad', 0, 32, ped + 12, 1); S.add('vc_pad', 0, 32, ped + 19, 0.9);
  sustainBass(S, 'vc_pad', 9, 21, 36, 47);
  S.e('vc_theme', [1, 0.35], [3, 0.5], [7, 0.6], [9, 0]);
  themeOn(S, 'vc_theme', P.theme, 1, -12, [0, 32]);
  S.e('horns', [9, 0.42], [11, 0.5], [13, 0.55], [15, 0.58], [17, 0.62], [19, 0.7], [20.9, 0.82], [21, 0]);
  themeOn(S, 'horns', P.theme, 9, -12, [0, 32]); themeOn(S, 'horns', P.theme, 17, -12, [48, 64]);
  S.e('vln_theme', [13, 0], [13.5, 0.42], [17, 0.55], [20.9, 0.75], [21, 0]);
  themeOn(S, 'vln_theme', P.theme, 13, 0, [16, 32]);
  themeOn(S, 'vln_theme', P.theme, 17, 0, [48, 64]);
  S.e('horns_chords', [9, 0.3], [13, 0.4], [17, 0.5], [20.9, 0.72], [21, 0.3]);
  pads(S, 'horns_chords', 9, 21, 3, 48, 60);
  S.e('trombones', [13, 0], [14, 0.35], [17, 0.45], [20.8, 0.7], [21, 0]);
  pads(S, 'trombones', 13, 21, 3, 41, 62);
  S.e('tuba', [13, 0], [14, 0.35], [20.9, 0.6]);
  sustainBass(S, 'tuba', 13, 21, 26, 37);
  S.e('timpani', [1, 0.35], [9, 0.45], [17, 0.55], [21, 0.9]);
  for (let b = 1; b < 19; b++) { const bn = b < 9 ? midiOfPc(T, 33, 44) : bassNote(S.ch(b), 33, 44); S.add('timpani', S.B(b), 2, bn, 1); if (b >= 9 && b % 2 === 0) S.add('timpani', S.B(b, 3.5), 1, bn, 0.75); }
  S.e('timp_roll', [19, 0.2], [20.95, 0.9], [21, 0]);
  S.add('timp_roll', S.B(19), 8, bassNote(S.ch(19), 33, 44), 1);
  S.ev({ type: 'riser', t: S.sec(S.B(17)), dur: S.sec(S.B(21)) - S.sec(S.B(17)), lev: 0.5 });
  for (const b of [17, 18, 19, 20]) S.ev({ type: 'perc', kind: 'bd_p', t: S.sec(S.B(b)), lev: 0.25 + 0.06 * (b - 17) });
  if (!minorEnd) S.ev({ type: 'perc', kind: 'cym_roll', t: S.end, lev: 0.8 });
  padLayer(S, 1, 21, 0.13);
  return S;
}

function secBreath(P, t0) {
  const T = P.tonic;
  const chords = [chord(T, 'bVI'), chord(T, 'bVI', true), chord(T, 'bVII'), chord(T, 'bVII', true)];
  const S = new Sec(P, 'Breath', t0, P.bpm, 4, chords);
  pianoOst(S, 1, 5, P.ostMode);
  S.e('piano', [1, 0.38], [4.9, 0.62]);
  spicEngine(S, 1, 5, { cb: false });
  S.e('vla_spic', [1, 0.32], [4.9, 0.72]); S.e('vc_spic', [1, 0.34], [4.9, 0.75]); S.e('vln_spic', [1, 0.3], [4.9, 0.66]);
  S.e('basses_spic', [3, 0.45], [4.9, 0.65]);
  for (let b = 3; b < 5; b++) for (const i of [0, 3, 6]) S.add('basses_spic', S.B(b, i * 0.5), 0.45, bassNote(S.ch(b), 28, 39), 1);
  // horns announce the theme head, crescendo
  S.e('horns', [1, 0.32], [3, 0.5], [4.9, 0.85]);
  const h = P.theme.filter((n) => n.beat < 16);
  for (const n of h) { const p = n.midi + (chords[0].root - T + 12) % 12 - 12; S.add('horns', n.beat, n.dur, p - 12, 1); S.add('horns', n.beat, n.dur, p, 1); }
  S.e('vla_pad', [1, 0.28], [4.9, 0.6]); S.e('vc_pad', [1, 0.33], [4.9, 0.66]); S.e('horns_chords', [1, 0.3], [4.9, 0.72]);
  S.e('trombones', [1, 0.25], [4.9, 0.7]); S.e('tuba', [1, 0.25], [4.9, 0.68]); S.e('basses', [1, 0.4], [4.9, 0.8]);
  S.e('vln_pad', [1, 0.25], [4.9, 0.7]); S.e('organ', [1, 0.32], [4.9, 0.82]); S.e('organ_pedal', [1, 0.6], [4.9, 0.85]);
  for (const [b, L, ch] of S.spans(1, 5, (a, c) => a.root === c.root)) {
    for (const p of voicing(ch, 3, 53, 65)) S.add('vla_pad', S.B(b), 4 * L, p, 1);
    for (const p of voicing(ch, 3, 48, 62)) S.add('horns_chords', S.B(b), 4 * L, p, 1);
    for (const p of voicing(ch, 3, 41, 65)) S.add('trombones', S.B(b), 4 * L, p, 1);
    for (const p of voicing(ch, 3, 74, 86)) S.add('vln_pad', S.B(b), 4 * L, p, 1);
    for (const p of voicing(ch, 4, 62, 74)) S.add('organ', S.B(b), 4 * L, p, 1);
    const bn = bassNote(ch, 36, 47);
    S.add('vc_pad', S.B(b), 4 * L, bn, 1); S.add('basses', S.B(b), 4 * L, bassNote(ch, 28, 39), 1);
    S.add('tuba', S.B(b), 4 * L, bassNote(ch, 26, 37), 1); S.add('organ_pedal', S.B(b), 4 * L, bn, 1); S.add('organ_pedal', S.B(b), 4 * L, bn - 12, 0.95);
  }
  S.e('timp_roll', [1, 0.1], [4.95, 0.95], [5, 0]);
  S.add('timp_roll', 0, 16, midiOfPc(T, 33, 44), 1);
  S.ev({ type: 'riser', t: S.sec(0), dur: S.end - S.sec(0), lev: 0.5 });
  for (let b = 1; b < 5; b++) S.ev({ type: 'sub', t: S.sec(S.B(b)), dur: S.sec(S.B(b + 1)) - S.sec(S.B(b)), midi: bassNote(S.ch(b), 24, 35), lev: 0.45, att: 0.01, rel: 0.3 });
  boomEv(S, 1, 0.35);
  S.ev({ type: 'gate', t0: S.sec(15.5), t1: S.end - 0.004, fadeIn: 0.004 });   // the suck before the arrival
  padLayer(S, 1, 5, 0.16);
  return S;
}

function tutti(S, P, b0, b1, { major = true, apexFrom = null } = {}) {
  pianoOst(S, b0, b1, P.ostMode);
  pianoOst(S, b0, b1, P.ostMode, 'piano_low', -12, 0.8);
  spicEngine(S, b0, b1);
  sustainBass(S, 'basses', b0, b1, 28, 39);
  sustainBass(S, 'organ_pedal', b0, b1, 36, 47);
  for (const [b, L, ch] of S.spans(b0, b1, (a, c) => a.bass === c.bass)) S.add('organ_pedal', S.B(b), 4 * L, bassNote(ch, 24, 35), 0.95);
  sustainBass(S, 'bassoons', b0, b1, 36, 47, 12);
  sustainBass(S, 'tuba', b0, b1, 26, 37);
  pads(S, 'trombones', b0, b1, 3, 41, 65);
  pads(S, 'vln_pad', b0, b1, 3, 74, 86);
  pads(S, 'organ', b0, b1, 4, 62, 74);
  pads(S, 'vla_pad', b0, b1, 3, 53, 65);
  pads(S, 'horns_chords', b0, b1, 3, 48, 62);
  for (const [b, L, ch] of S.spans(b0, b1)) { const bn = bassNote(ch, 36, 47); S.add('vc_pad', S.B(b), 4 * L, bn, 1); S.add('vc_pad', S.B(b), 4 * L, ch.pcs.includes((bn + 7) % 12) ? bn + 7 : bn + 12, 1); }
  clar3(S, b0, b1);
  for (let b = b0; b < b1; b++) {
    const ft = arpTones(S.ch(b), 74, 86);
    for (let i = 0; i < 12; i++) { const g = (b - 1) * 12 + i; S.add('flutes', S.B(b, i / 3), 1 / 3, ft[[0, 1, 2, 3, 2, 1][g % 6]], 0.95 + (g % 3 === 0 ? 0.1 : 0)); }
    const up = []; for (let p = 62; p < 86; p++) if (S.ch(b).pcs.includes(p % 12)) up.push(p);
    const seq = up.concat(up.slice(1, -1).reverse());
    for (let i = 0; i < 12; i++) S.add('harp', S.B(b, i / 3), 1, seq[(i + 3 * (b % 2)) % seq.length], i % 3 ? 0.9 : 1.05);
    const ot = arpTones(S.ch(b), 74, 86);
    for (let i = 0; i < 16; i++) { const g = (b - 1) * 16 + i; S.add('organ_arp', S.B(b, i * 0.25), 0.25, ot[[0, 1, 2, 3, 2, 1][g % 6]], g % 6 === 0 ? 1.05 : 0.92); }
    const bn = bassNote(S.ch(b), 33, 44);
    S.add('timpani', S.B(b), 2, bn, 1.1); S.add('timpani', S.B(b, 2.5), 1, bn, 0.75);
    if (b % 4 === 0) S.add('timpani', S.B(b, 3.5), 1, bn, 0.85);
    S.ev({ type: 'perc', kind: 'bd_f', t: S.sec(S.B(b)), lev: apexFrom && b >= apexFrom ? 0.65 : 0.45 });
  }
}

function setTuttiExpr(S, lv) {
  const m = (x) => Math.min(1, x * lv);
  const set = {
    piano: 0.64, piano_low: 0.5, vla_spic: 0.75, vc_spic: 0.78, vln_spic: 0.7, basses_spic: 0.7, basses: 0.9, organ_pedal: 0.85,
    bassoons: 0.62, tuba: 0.72, trombones: 0.72, vln_pad: 0.75, organ: 0.85, vla_pad: 0.66, horns_chords: 0.78, vc_pad: 0.72,
    clarinets: 0.68, flutes: 0.5, harp: 0.65, organ_arp: 0.55, timpani: 0.9,
  };
  for (const [k, v] of Object.entries(set)) S.e(k, [1, m(v)], [S.bars + 1, m(v * 1.08)]);
}

function secDiscovery(P, t0) {
  const chords = [];
  for (const ch of [...P.Amaj, ...P.Bmaj]) chords.push(ch, chord(P.tonic, ch.num, P.rng() < 0.5));
  const S = new Sec(P, 'Discovery', t0, P.bpm, 16, chords);
  setTuttiExpr(S, 1);
  tutti(S, P, 1, 17);
  boomEv(S, 1, 1.0); boomEv(S, 9, 0.6);
  S.ev({ type: 'perc', kind: 'gong', t: S.sec(0), lev: 0.9 });
  S.ev({ type: 'perc', kind: 'crash', t: S.sec(0), lev: 1.0 });
  S.ev({ type: 'perc', kind: 'crash', t: S.sec(S.B(9)), lev: 0.7 });
  subPerBar(S, 1, 17, () => 0.7);
  S.e('vln_theme', [1, 0.8], [9, 0.8], [13, 0.86], [17, 0.9]);
  S.e('vc_theme', [1, 0.78], [17, 0.88]);
  S.e('horns', [1, 0.85], [17, 0.9]);
  S.e('trumpets', [9, 0.6], [13, 0.7], [17, 0.8]);
  for (const n of P.themeMaj) {
    S.add('vln_theme', n.beat, n.dur, n.midi, 1);
    if (n.beat >= 32) S.add('vln_theme', n.beat, n.dur, n.midi + 12, 0.9);
    S.add('vc_theme', n.beat, n.dur, n.midi - 12, 1);
    S.add('horns', n.beat, n.dur, n.midi - 12, 1);
    if (n.beat >= 32) S.add('trumpets', n.beat, n.dur, n.midi - (n.midi > P.anchor + 14 ? 12 : 0), 1);
  }
  padLayer(S, 1, 17, 0.16);
  return S;
}

function secApex(P, t0) {
  const T = P.tonic;
  const chords = [chord(T, 'bVI'), chord(T, 'bVI', true), chord(T, 'bVII'), chord(T, 'bVII', true), chord(T, 'I'), chord(T, 'I', true), chord(T, 'I'), chord(T, 'I')];
  const S = new Sec(P, 'Apex', t0, P.bpm, 8, chords);
  setTuttiExpr(S, 1.1);
  tutti(S, P, 1, 9, { apexFrom: 5 });
  boomEv(S, 1, 0.75); boomEv(S, 5, 1.0);
  S.ev({ type: 'perc', kind: 'cym_roll', t: S.sec(S.B(5)), lev: 0.8 });
  S.ev({ type: 'perc', kind: 'crash', t: S.sec(S.B(5)), lev: 1.0 });
  S.ev({ type: 'perc', kind: 'gong', t: S.sec(S.B(5)), lev: 1.0 });
  subPerBar(S, 1, 9, () => 0.7);
  // stepwise climb to the major third: D-E-F# over bVI-bVII-I
  const top = P.anchor + 17;
  const apex = [[top, 0, 8], [top + 2, 8, 8], [top + 4, 16, 14], [top + 2, 30, 1], [top, 31, 1]];
  S.e('vln_theme', [1, 0.9], [5, 1], [9, 1]); S.e('vc_theme', [1, 0.88], [9, 0.95]); S.e('horns', [1, 0.9], [5, 1], [9, 1]); S.e('trumpets', [1, 0.8], [5, 0.95], [9, 1]);
  for (const [p, b, d] of apex) {
    S.add('vln_theme', b, d, p, 1); S.add('vln_theme', b, d, p - 12, 1); S.add('vc_theme', b, d, p - 24, 1);
    S.add('horns', b, d, p - 12, 1); S.add('trumpets', b, d, p - 12, 1);
  }
  S.add('vla_pad', S.B(5), 16, top + 4 - 24, 1);
  S.e('timp_roll', [3, 0.3], [4.95, 1], [5, 0.6], [8, 0.9], [9, 1]);
  S.add('timp_roll', S.B(3), 8, midiOfPc((T + 10) % 12, 33, 44), 1);
  S.add('timp_roll', S.B(5), 16, midiOfPc(T, 33, 44), 1);
  S.ev({ type: 'riser', t: S.sec(S.B(3)), dur: S.sec(S.B(5)) - S.sec(S.B(3)), lev: 0.55 });
  padLayer(S, 1, 9, 0.16);
  S.cutBeat = 32;
  return S;
}

function secStorm(P, t0) {      // the "pulse" arc's minor climax (Thin Blue Line darkness)
  const chords = [];
  for (const ch of [...P.A, ...P.Bc]) chords.push(ch, chord(P.tonic, ch.num, P.rng() < 0.4));
  const S = new Sec(P, 'Storm', t0, P.bpm, 16, chords);
  setTuttiExpr(S, 0.95);
  tutti(S, P, 1, 17);
  boomEv(S, 1, 0.9); boomEv(S, 9, 0.7);
  S.ev({ type: 'perc', kind: 'crash', t: S.sec(0), lev: 0.9 });
  subPerBar(S, 1, 17, () => 0.65);
  S.e('vln_theme', [1, 0.78], [17, 0.92]); S.e('vc_theme', [1, 0.78], [17, 0.9]); S.e('horns', [1, 0.82], [17, 0.95]); S.e('trumpets', [9, 0.6], [17, 0.85]);
  for (const n of P.theme) {
    S.add('vln_theme', n.beat, n.dur, n.midi, 1); S.add('vc_theme', n.beat, n.dur, n.midi - 12, 1); S.add('horns', n.beat, n.dur, n.midi - 12, 1);
    if (n.beat >= 32) { S.add('vln_theme', n.beat, n.dur, n.midi + 12, 0.9); S.add('trumpets', n.beat, n.dur, n.midi - (n.midi > P.anchor + 14 ? 12 : 0), 1); }
  }
  padLayer(S, 1, 17, 0.16);
  S.cutBeat = 64;
  return S;
}

function secSong(P, t0) {       // reflective middle: theme in cellos, then violins, harp and soft organ
  const chords = [];
  for (const ch of [...P.A, ...P.Bc]) chords.push(ch, chord(P.tonic, ch.num, P.rng() < 0.6));
  const S = new Sec(P, 'Song', t0, P.bpm, 16, chords);
  S.e('piano', [1, 0.4], [17, 0.46]); pianoOst(S, 1, 17, 'broken');
  S.e('basses', [1, 0.4], [17, 0.5]); sustainBass(S, 'basses', 1, 17, 28, 39);
  S.e('vc_pad', [1, 0.38], [17, 0.5]); sustainBass(S, 'vc_pad', 1, 17, 36, 47);
  S.e('vla_pad', [1, 0.38], [17, 0.5]); pads(S, 'vla_pad', 1, 17, 3, 53, 65);
  S.e('vln_pad', [9, 0], [10, 0.35], [17, 0.45]); pads(S, 'vln_pad', 9, 17, 2, 74, 86);
  S.e('organ_soft', [1, 0.3], [17, 0.45]); pads(S, 'organ_soft', 1, 17, 4, 57, 69);
  S.e('vc_theme', [1, 0.5], [8.9, 0.6], [9, 0]); themeOn(S, 'vc_theme', P.theme, 1, -12, [0, 32]);
  S.e('vln_theme', [9, 0.45], [17, 0.6]); themeOn(S, 'vln_theme', P.theme, 9, 0, [32, 64]);
  S.e('harp', [1, 0.5], [17, 0.6]);
  for (let b = 1; b < 17; b++) { const t = arpTones(S.ch(b), 62, 79); for (let i = 0; i < 6; i++) S.add('harp', S.B(b, i * 0.667), 1.5, t[[0, 1, 2, 3, 2, 1][i]], i ? 0.85 : 1); }
  S.e('horns_chords', [5, 0], [6, 0.28], [17, 0.36]); pads(S, 'horns_chords', 5, 17, 3, 48, 60);
  padLayer(S, 1, 17, 0.1);
  return S;
}

function secWonder(P, t0, major = true) {
  const T = P.tonic, c = (n, col, ped) => chord(T, n, col, ped);
  const chords = major
    ? [c('I'), c('I'), { ...c('IV', false, true) }, c('vi'), c('IV', true), c('Vsus'), c('V'), c('I', true), c('I', true), c('I', true)]
    : [c('i'), c('i'), c('iv', false, true), c('VI'), c('III'), c('Vsus'), c('V'), c('I', true), c('I', true), c('I', true)];
  const S = new Sec(P, 'Wonder', t0, Math.round(P.bpm * 0.8), 10, chords);
  S.rit = 0.18;
  const th = major ? P.themeMaj : P.theme;
  S.e('piano', [2, 0.45], [10, 0.38]);
  for (const n of th.filter((x) => x.beat < 16)) S.add('piano', S.B(2) + n.beat, n.dur + 0.6, n.midi, 0.9);
  const I = S.ch(8);
  S.add('piano', S.B(6), 2, midiOfPc((T + (major ? 11 : 11)) % 12, P.anchor, P.anchor + 11), 0.85);
  S.add('piano', S.B(6, 2), 2, midiOfPc((T + 2) % 12, P.anchor + 2, P.anchor + 13), 0.85);
  S.add('piano', S.B(7), 4, midiOfPc((T + 7) % 12, P.anchor - 2, P.anchor + 9), 0.85);
  S.add('piano', S.B(8), 12, P.anchor + 5, 0.9);
  S.e('piano_low', [2, 0.38], [10, 0.32]);
  for (let b = 2; b <= 8; b++) {
    if (b > 2 && S.ch(b).name === S.ch(b - 1).name) continue;
    const ch = S.ch(b), bn = bassNote(ch, 38, 49);
    const v = [bn, ...voicing(ch, 2, bn + 5, bn + 17)];
    v.forEach((p, k) => S.add('piano_low', S.B(b, k * 0.5), (b === 8 ? 12 : 4.5) - k * 0.5, p, 0.9 - 0.08 * k));
  }
  S.e('vln_high', [2, 0], [3, 0.36], [6, 0.44], [8, 0.38], [11, 0]);
  pads(S, 'vln_high', 2, 11, 2, 81, 93);
  S.e('vc_pad', [2, 0], [3, 0.32], [9, 0.26], [11, 0]);
  sustainBass(S, 'vc_pad', 2, 11, 38, 49, 12);
  S.ev({ type: 'shimmer', t: S.sec(4), dur: S.end - S.sec(4), midi: P.anchor + 17, lev: 0.009, att: 5, rel: 6 });
  S.ev({ type: 'shimmer', t: S.sec(8), dur: S.end - S.sec(8), midi: P.anchor + 24, lev: 0.005, att: 6, rel: 6 });
  return S;
}

// ---------------------------------------------------------------------------
// the endless composer
// ---------------------------------------------------------------------------
const ARCS = {
  discovery: ['questions', 'method', 'night', 'ascent', 'breath', 'discovery', 'apex', 'wonder'],
  discovery_short: ['questions', 'method', 'ascent', 'breath', 'discovery', 'apex', 'wonder'],
  pulse: ['night', 'ascent_minor', 'storm', 'wonder_minor'],
  reflection: ['questions', 'method_cello', 'song', 'wonder'],
};

export class Composer {
  constructor(seed) {
    let s = seed >>> 0 || 1;
    this.rng = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.t = 0.3;
    this.pieceNo = 0;
    this.queue = [];
    this.tonic = [2, 5, 7, 9, 0, 4][Math.floor(this.rng() * 6)];
    this.lastArc = null;
  }
  newPiece() {
    const r = this.rng;
    if (this.pieceNo > 0) this.tonic = (this.tonic + [3, 8, 5, 7, 2, 10][Math.floor(r() * 6)]) % 12;
    this.pieceNo++;
    let arcs = Object.keys(ARCS).filter((a) => a !== this.lastArc);
    const w = { discovery: 3, discovery_short: 2.5, pulse: 1.4, reflection: 1.2 };
    if (this.pieceNo === 1) arcs = ['discovery'];
    const tot = arcs.reduce((a, k) => a + w[k], 0);
    let x = r() * tot, arc = arcs[0];
    for (const k of arcs) { x -= w[k]; if (x <= 0) { arc = k; break; } }
    this.lastArc = arc;
    const T = this.tonic;
    let anchor = 60 + ((T + 7) % 12); while (anchor < 64) anchor += 12; while (anchor > 72) anchor -= 12;
    const pa = PROG_A[Math.floor(r() * PROG_A.length)], cb = CAD_B[Math.floor(r() * CAD_B.length)];
    const A = pa.map((n) => chord(T, n));
    const Bc = [A[0], A[1], chord(T, cb[0]), chord(T, cb[1])];
    const Amaj = pa.map((n) => chord(T, TO_MAJOR[n]));
    const Bmaj = [Amaj[0], Amaj[1], chord(T, TO_MAJOR[cb[0]]), chord(T, 'V')];
    const theme = makeTheme(r, T, anchor, A, Bc);
    const themeMaj = majorize(theme, T, [...Amaj, ...Bmaj]);
    // major theme ends on the 5th, rising to the leading tone (sets up the apex)
    const last = themeMaj.filter((n) => n.beat >= 56);
    if (last.length) { last[0].midi = midiOfPc((T + 7) % 12, anchor + 7, anchor + 18); last[0].dur = 6; for (let i = 1; i < last.length; i++) last[i].dur = 0; }
    const P = {
      rng: r, tonic: T, anchor, bpm: [88, 92, 96, 96, 100][Math.floor(r() * 5)], arc, no: this.pieceNo,
      A, Bc, Amaj, Bmaj, theme, themeMaj: themeMaj.filter((n) => n.dur > 0).concat(last.length ? [{ beat: 62, dur: 2, midi: midiOfPc((T + 11) % 12, anchor + 12, anchor + 23), strong: false }] : []),
      ostMode: r() < 0.7 ? '8' : 'broken', key: spell(T, T),
    };
    for (const s of ARCS[arc]) this.queue.push([s, P]);
  }
  next() {
    if (!this.queue.length) this.newPiece();
    const [kind, P] = this.queue.shift();
    const t0 = this.t;
    let S;
    switch (kind) {
      case 'questions': S = secQuestions(P, t0); break;
      case 'method': S = secMethod(P, t0); break;
      case 'method_cello': S = secMethod(P, t0, { lead: 'vc_theme' }); break;
      case 'night': S = secNight(P, t0); break;
      case 'ascent': S = secAscent(P, t0); break;
      case 'ascent_minor': S = secAscent(P, t0, { minorEnd: true }); break;
      case 'breath': S = secBreath(P, t0); break;
      case 'discovery': S = secDiscovery(P, t0); break;
      case 'apex': S = secApex(P, t0); break;
      case 'storm': S = secStorm(P, t0); break;
      case 'song': S = secSong(P, t0); break;
      case 'wonder': S = secWonder(P, t0, true); break;
      case 'wonder_minor': S = secWonder(P, t0, false); break;
    }
    const sustain = (tr) => !['piano', 'piano_low', 'vln_spic', 'vla_spic', 'vc_spic', 'basses_spic', 'harp', 'timpani'].includes(tr);
    const cutBeat = S.cutBeat ?? null;
    const events = S.finalize(sustain, cutBeat);
    let end = S.end;
    if (cutBeat !== null) {
      // hard cut, one bar of ringing silence, then the coda
      const tc = S.sec(cutBeat);
      const gapBar = 60 / (P.bpm * 0.8) * 4;
      events.push({ type: 'gate', t0: tc, t1: tc + gapBar - 0.4, fadeIn: 0.25 });
      end = tc + gapBar;
    }
    if (kind.startsWith('wonder')) end = S.end - 2;   // next piece's opening overlaps the coda's last chord
    this.t = end;
    const info = {
      name: S.name, piece: P.no, arc: P.arc, key: spell(P.tonic, P.tonic), mode: ['discovery', 'apex', 'wonder'].includes(kind) || kind === 'breath' ? 'major' : 'minor',
      bpm: S.bpm, t0, t1: end,
      chords: Array.from({ length: S.bars }, (_, i) => ({ t: S.sec(4 * i), name: S.chords[i].name })),
    };
    return { events, info };
  }
}
