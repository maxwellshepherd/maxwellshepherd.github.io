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
const LEVEL_NAMES = { piece: 'piece', section: 'form', harmony: 'harmony', motif: 'melody', layer: 'instruments', pattern: 'rhythm' };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const ROLE_NAMES = { bass: 'Bass', pad: 'Harmony', ost: 'Ostinato', mel: 'Melody' };
const dispatchAt = (e) => (e.t ?? e.t0) - (e.lead || 0);   // cymbal rolls must start seconds before they land
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
  async init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    this.engine = this.newEngine();
    setStatus('Loading the orchestra...'); showBar(true);
    await this.engine.load(BASE, (d, n) => setFill(d / n), CORE);
    this.engine.build();
    this.restLoading = this.engine.load(BASE, (d, n) => { setFill(d / n); if (d === n) showBar(false); })
      .then(() => { this.loaded = true; }).catch((e) => { console.warn(e); this.loaded = true; showBar(false); });
  }
  newEngine() {
    const e = new Engine(this.ctx, { seed });
    e.onNote = (track, pitch, t, dur, dyn) => { this.notes.push({ fam: FAMILY(track), pitch, t, dur, dyn, track }); };
    return e;
  }
  async start() {
    this.composer = new Composer(seed);
    this.queue = []; this.infos = []; this.decQ = [];
    $('feed').innerHTML = ''; shownCount = 0;
    // compose the opening before the clock starts and make sure the instruments it chose are loaded
    this.pre = [this.composer.next(), this.composer.next()];
    const need = new Set();
    for (const { events } of this.pre) for (const e of events) if (e.type === 'note') need.add(TRACKS[e.track].inst);
    const missing = [...need].filter((k) => !this.engine.inst[k]);
    if (missing.length) { setStatus('Loading the opening...'); await this.engine.load(BASE, null, missing); }
    this.base = this.ctx.currentTime + 0.4;
    streamStart = this.base;
    this.engine.volume.gain.setValueAtTime(+$('volume').value, this.ctx.currentTime);
    this.stopClock();
    this.tick();
    this.startClock();
  }
  // The clock runs in a worker: browsers throttle main-thread timers in background tabs and minimised windows,
  // which starves the scheduler. Falls back to setInterval where workers are unavailable.
  startClock() {
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 80);'], { type: 'text/javascript' }));
      this.worker = new Worker(url); URL.revokeObjectURL(url);
      this.worker.onmessage = () => this.tick();
    } catch { this.worker = null; }
    this.timer = setInterval(() => { if (!this.worker || performance.now() - this.lastTick > 400) this.tick(); }, 80);
  }
  stopClock() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  // After a stall (the page was frozen or throttled) the queue is overdue. Never play the backlog at once:
  // slide the rest of the stream later so it resumes where it left off.
  shift(dt) {
    this.base += dt;
    for (const e of this.queue) { if (e.t !== undefined) e.t += dt; if (e.t0 !== undefined) { e.t0 += dt; e.t1 += dt; } }
    for (const info of this.infos) { info.t0 += dt; info.t1 += dt; for (const c of info.chords) c.t += dt; for (const l of info.layers) { l.enter += dt; l.exit += dt; } }
    for (const d of this.decQ) d.t += dt;
  }
  tick() {
    if (this.ticking || !this.composer) return;
    this.ticking = true;
    try { this._tick(); } finally { this.ticking = false; this.lastTick = performance.now(); }
  }
  _tick() {
    const now = this.ctx.currentTime;
    if (this.queue.length && dispatchAt(this.queue[0]) < now - 0.1) this.shift(now + 0.1 - dispatchAt(this.queue[0]));
    // hidden pages may be frozen outright (phones with the screen locked), so schedule much further ahead there
    const ahead = document.hidden ? 40 : 4;
    // compose phrase by phrase, staying a few seconds ahead of the scheduling horizon
    while (!this.infos.length || this.infos[this.infos.length - 1].t1 < now + ahead + 6) {
      const { events, info, decisions } = this.pre && this.pre.length ? this.pre.shift() : this.composer.next();
      for (const e of events) {
        if (e.t !== undefined) e.t += this.base;
        if (e.t0 !== undefined) { e.t0 += this.base; e.t1 += this.base; }
        this.queue.push(e);
      }
      info.t0 += this.base; info.t1 += this.base; for (const c of info.chords) c.t += this.base; for (const l of info.layers) { l.enter += this.base; l.exit += this.base; }
      this.infos.push(info);
      for (const d of decisions) { d.t += this.base; this.decQ.push(d); }
      this.queue.sort((a, b) => dispatchAt(a) - dispatchAt(b));
      this.decQ.sort((a, b) => a.t - b.t);
    }
    if (this.queue.length && dispatchAt(this.queue[0]) < now - 0.1) this.shift(now + 0.1 - dispatchAt(this.queue[0]));
    const horizon = now + ahead;
    let i = 0;
    while (i < this.queue.length && dispatchAt(this.queue[i]) < horizon) {
      const e = this.queue[i++];
      if (e.type === 'note' && !this.loaded && !this.engine.inst[TRACKS[e.track].inst]) continue;   // still loading
      try { this.engine.play(e); } catch (err) { console.warn(err); }
    }
    this.queue.splice(0, i);
    // reveal each choice at the moment its consequence becomes audible
    while (this.decQ.length && this.decQ[0].t <= now) {
      const t = this.decQ[0].t, group = [];
      while (this.decQ.length && this.decQ[0].t - t < 0.08) group.push(this.decQ.shift());
      showCard(group);
    }
    while (this.infos.length > 1 && this.infos[0].t1 < now - 2) this.infos.shift();
    updateNow(this);
  }
  async pause() { this.running = false; await this.ctx.suspend(); }
  async resume() { this.running = true; await this.ctx.resume(); }
  async restart(newSeed) {
    if (this.restarting) return;
    this.restarting = true;
    try { await this._restart(newSeed); } finally { this.restarting = false; }
  }
  async _restart(newSeed) {
    const wasRunning = this.running;
    if (!wasRunning) await this.ctx.resume();
    this.stopClock();
    const v = this.engine.volume.gain, now = this.ctx.currentTime;
    v.setValueAtTime(v.value, now); v.linearRampToValueAtTime(0, now + 1.2);
    await new Promise((r) => setTimeout(r, 1300));
    this.engine.volume.disconnect();
    seed = newSeed;
    const old = this.engine;
    this.engine = this.newEngine();
    Object.assign(this.engine, { meta: old.meta, buffers: old.buffers, inst: old.inst, perc: old.perc });
    this.engine.build();
    this.notes = []; markers.length = 0; formKey = ''; chipKey = '';
    await this.start();
    if (!wasRunning) await this.ctx.suspend();
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

const nice = (x) => String(x).replace(/\b([A-G])b(?![a-z])/g, '$1♭').replace(/([A-G])#/g, '$1♯');
const capw = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const strip = (x) => x.replace(/ \(.*\)$/, '');
const SECTION_TEXT = { Emerge: 'a quiet opening', Pulse: 'a steady rhythmic texture', Song: 'the tune takes the lead', Shadow: 'a darker, tense passage', Still: 'a near-silent pause',
  Build: 'the energy rises', Breath: 'a short pull-back before the peak', Arrival: 'the full orchestra arrives', Afterglow: 'the climax settles', Coda: 'the closing' };
const ROLE_TEXT = { Melody: 'on the melody', Ostinato: 'with a repeating figure', Harmony: 'holding the chords', Bass: 'on the bass line' };
const DEV_TEXT = { repeat: 'the tune repeats', sequence: 'the tune moves to a new pitch', invert: 'the tune is turned upside down', augment: 'the tune slows to half speed',
  fragment: 'only the opening of the tune echoes', answer: 'the tune answers itself and comes home', ornament: 'the tune gains passing notes', climb: 'the tune climbs higher', return: 'the original tune returns' };
const plural = (who) => /s$/.test(who) && !/bass$/.test(who);
// one plain sentence per choice; the priority decides which choice leads its card
function describe(d) {
  const w = d.options[d.chosen].name, L = d.label;
  let m;
  if (L === 'Key') return [`A new piece begins in ${nice(w)}`, 100];
  if (L === 'Modulation') return [`A new piece begins, ${w} from the last`, 100];
  if (L === 'Mode') return [`mode: ${w}`, 20];
  if (L === 'Tempo') return [w.replace(' dotted-quarter beats per minute', ' dotted-quarter bpm'), 19];
  if (L === 'Meter') return [`${w} time`, 18];
  if (L === 'Length') return [`planned length ${w}`, 10];
  if (L === 'Palette') return [w, 17];
  if (L === 'Motif length') return [`a new ${w} tune`, 16];
  if (L === 'Motif rhythm') return [`in ${w}`, 15];
  if (L === 'Motif contour') return [`shaped as ${w === 'arch' ? 'an arch' : w === 'valley' ? 'a valley' : w}`, 14];
  if (L === 'Next section') return [`New section: ${w}, ${SECTION_TEXT[w] || ''}`, 90];
  if (L === 'Section length') return [`lasting ${w}`, 30];
  if (L === 'Arc') return [`The piece is planned as ${w}`, 88];
  if (L === 'Theme') return [w, 85];
  if (L === 'Theme harmony: question') return [`a theme over ${w}`, 13];
  if (L === 'Theme harmony: answer') return [`answered by ${w}`, 12];
  if (L === 'Theme: the answer begins') return [`its answer begins ${w}`, 11];
  if (L === 'Theme: the last note') return [`its last note ${w}`, 10];
  if (L === 'Theme doubling') return [`The theme is doubled by ${w}`, 70];
  if ((m = L.match(/^Into the (arrival|build|quiet)$/))) return [/plain change|clean change/.test(w) ? '' : `Into the ${m[1] === 'quiet' ? 'quiet' : m[1]}: ${w}`, 62];
  if (L === 'Brass accents') return [`brass: ${w}`, 31];
  if (L === 'Ensemble drums') return [w.startsWith('low drums') ? w : '', 30];
  if (L === 'Chord colour') return [w === 'keep it diatonic' ? '' : `colour: ${w}`, 42];
  if (L === 'Final chord') return [w.startsWith('a major') ? 'The piece will end on a major chord' : '', 44];
  if (L === 'Bass line') return ['the bass walks by step', 20];
  if (L === 'Shape of the climax') return [w.startsWith('pulls') ? 'The climax will pull back before its last statement' : '', 58];
  if (L === 'Basses wait for the answer') return [w.startsWith('yes') ? 'The basses wait for the answer' : '', 27];
  if (L === 'Phrase plan') return [`in phrases of ${w}`, 29];
  if (L === 'Melody pickup') return [w.startsWith('the tune') ? '' : `the tune begins with ${w}`, 24];
  if (L === 'Brass on the strong bars') return [w === 'accented chords' ? 'brass accents on the strong bars' : '', 23];
  if (L === 'Cadence pace') return [w.startsWith('a quicker') ? 'a quicker turn into the cadence' : '', 34];
  if (L === 'Texture') return [w.startsWith('one figure') ? 'One figure thins to its accents' : '', 46];
  if (L === 'Harmonic rhythm') return [w === 'chord per bar' ? 'a new chord every bar' : `a new chord every ${w.split(' ')[0]} bars`, 25];
  if (L === 'Accent pattern') return [`accents grouped ${w}`, 22];
  if (L === 'Shadow colour') return [w.startsWith('darken') ? 'the scale darkens to Phrygian' : 'the scale stays the same', 40];
  if (L === 'Arrival mode') return [w === 'burst into major' ? 'The climax will turn to a major key' : w === 'lift to Lydian' ? 'The climax will brighten to Lydian' : 'The climax will stay in minor', 60];
  if (L.startsWith('Key lift')) return [w.startsWith('lift') ? 'The key rises a step for a second wave' : 'the key stays put', 70];
  if (L === 'Pedal point') return [w === 'free bass' ? 'the bass moves with the chords' : 'the bass holds one low note underneath', 28];
  if (L === 'Opening chord' || L === 'Next chord') return [`Chord: ${nice(strip(w))}${d.feel ? ', ' + d.feel : ''}`, 40];
  if (L === 'How the phrase ends') return [`The phrase will end ${strip(w)}`, 45];
  if (L === 'Borrow a major dominant') return [w.startsWith('yes') ? 'a borrowed major chord leads home' : 'the chord before home keeps the mode’s colour', 35];
  if (L === 'Timpani pattern') return [`Timpani: ${w}`, 32];
  if (L === 'Bass accents') return [`bass accents grouped ${w}`, 12];
  if ((m = L.match(/^(Melody|Ostinato|Harmony|Bass): who joins$/))) return [`${capw(w)} ${plural(w) ? 'join' : 'joins'} ${ROLE_TEXT[m[1]]}`, 80];
  if (/: who drops out$/.test(L)) { const who = strip(w); return [`${capw(who)} ${plural(who) ? 'drop' : 'drops'} out`, 78]; }
  if (/: hand over$/.test(L)) { const who = strip(w); return [`${capw(who)} ${plural(who) ? 'step' : 'steps'} aside`, 78]; }
  if (L === 'Several bow out') return [`The orchestra thins: ${d.names.slice(0, -1).join(', ')} and ${d.names[d.names.length - 1]} fade out`, 77];
  if (L.endsWith(' bows out')) { const who = strip(L.replace(' bows out', '').replace(' (melody)', '')); return [`${capw(who)} ${plural(who) ? 'fade' : 'fades'} out`, 76]; }
  if (L === 'Development') return [`Melody: ${DEV_TEXT[w] || w}`, 55];
  if (L === 'Motif mutation') return [w.startsWith('mutate') ? 'the tune will change slightly' : '', 12];
  if (L === 'Mutation') return [`The tune changes: ${w}`, 50];
  if (L.endsWith('how it shares the tune')) return [`${capw(L.split(':')[0])} ${w}`, 36];
  if (L.endsWith(': entrance')) return [w === 'on the downbeat' ? 'entering on the downbeat' : w.startsWith('in bar') ? `entering ${w}` : 'entering as a pickup into the next phrase', 13];
  if (L.startsWith('Just before the arrival')) return [w.startsWith('a moment') ? 'A moment of silence before the arrival' : 'No pause before the arrival', 65];
  if (L === 'End of the arrival') return [w.startsWith('a hard') ? 'The orchestra stops dead' : 'The climax rings on', 65];
  if ((m = L.match(/^(.*): (subdivision|cell shape|process|accents|contrasting accents|cycle length)$/))) {
    const who = m[1], k = m[2];
    if (k === 'subdivision') return [`${who} in ${w}`, 11];
    if (k === 'cell shape') return [`its figure moves ${{ up: 'upward', updown: 'up and back', pendulum: 'like a pendulum', broken: 'in broken chords', fifths: 'between two notes', rising3: 'up in threes', turn: 'in a turn', arpdown: 'downward' }[w] || w}`, 10];
    if (k === 'process') return [w, 9];
    if (k === 'cycle length') return [`a ${w} cycle`, 8];
    if (k === 'accents') return [w.startsWith('a contrasting') ? 'with contrasting accents' : '', 7];
    return [`accents grouped ${w}`, 7];
  }
  return [`${L}: ${w}`, 5];
}
let shownCount = 0, streamStart = 0;
// one moment can hold several choices: each significant one gets its own card, and the small details
// (an instrument's pattern, a section's length or chord pace) attach to the card they belong to
function showCard(group) {
  shownCount += group.length;
  // several instruments leaving at once read as one event
  const outs = group.filter((d) => d.label.endsWith(' bows out'));
  if (outs.length >= 3) {
    const names = outs.map((d) => strip(d.label.replace(' bows out', '').replace(' (melody)', '')));
    group = group.filter((d) => !outs.includes(d)).concat([{ ...outs[0], label: 'Several bow out', names }]);
  }
  $('count').textContent = `${shownCount.toLocaleString()} choices made`;
  const items = group.map((d) => { const [text, pri] = describe(d); return { d, text, pri, who: (d.label.match(/^(.*): (subdivision|cell shape|process|accents|contrasting accents|cycle length|entrance)$/) || [])[1] }; }).filter((x) => x.text);
  if (!items.length) return;
  const cards = items.filter((x) => x.pri >= 45).sort((a, b) => b.pri - a.pri).map((x) => ({ lead: x, extra: [] }));
  const find = (pred) => cards.find((c) => pred(c.lead));
  for (const x of items.filter((y) => y.pri < 45).sort((a, b) => b.pri - a.pri)) {
    let home = null;
    if (x.who) home = find((l) => l.d.level === 'layer' && l.text.toLowerCase().startsWith(x.who.toLowerCase()));
    else if (x.d.level === 'piece' || x.d.level === 'motif' && /^(Motif|Theme[ :])/.test(x.d.label)) home = find((l) => l.d.level === 'piece');
    if (!home && !x.who && (['section', 'harmony', 'pattern'].includes(x.d.level) || x.d.label === 'Melody pickup') && !/chord/.test(x.d.label)) home = find((l) => l.d.label === 'Next section');
    if (!home && x.d.level === 'harmony' && !/chord/.test(x.d.label)) home = find((l) => l.d.level === 'harmony');
    if (!home && x.d.level === 'motif') home = find((l) => l.d.level === 'motif');
    if (home) { home.extra.push(x.who && x.d.label.endsWith('subdivision') ? x.text.replace(x.who + ' ', '') : x.text); home.group = (home.group || [home.lead.d]).concat([x.d]); }
    else cards.push({ lead: x, extra: [] });
  }
  const feed = $('feed');
  const atTop = feed.scrollTop < 8;
  let added = 0;
  const secs = Math.max(0, group[0].t - streamStart), when = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
  for (const c of cards.slice().reverse()) {            // prepend in reverse so the most important card ends up on top
    const ds = c.group || [c.lead.d];
    const el = document.createElement('div');
    el.className = 'card';
    el.style.setProperty('--c', LEVEL_COLORS[c.lead.d.level] || '#d9b26a');
    const odds = ds.filter((d) => d.options.length > 1).map((d) => {
      const bars = d.options.map((o, i) => `<i class="${i === d.chosen ? 'win' : ''}" style="flex:${o.p.toFixed(4)}"></i>`).join('');
      const alts = d.options.map((o, i) => (i === d.chosen ? `<b>${esc(nice(o.name))} ${Math.round(o.p * 100)}%</b>` : `${esc(nice(o.name))} ${Math.round(o.p * 100)}%`)).join(' · ');
      return `<div class="odd"><div class="q">${esc(d.label)}</div><div class="dist">${bars}</div><div class="alts">${alts}</div></div>`;
    }).join('');
    const extra = [...new Set(c.extra)];
    el.innerHTML = `<div class="meta"><span>${LEVEL_NAMES[c.lead.d.level] || ''}</span><span class="when">${when}</span></div>`
      + `<div class="main">${esc(capw(c.lead.text))}</div>`
      + (extra.length ? `<div class="more">${esc(capw(extra.join(', ')))}</div>` : '')
      + (odds ? `<details><summary>Choices and chances</summary><div class="odds"><div class="hdr">Chance of each option when the choice was made</div>${odds}</div></details>` : '');
    feed.prepend(el);
    added += el.offsetHeight + 8;
  }
  if (!atTop) feed.scrollTop += added;                   // keep the reader's place while they scroll back
  while (feed.children.length > 100) feed.lastChild.remove();
  const top = cards[0].lead.text;
  markers.push({ t: group[0].t, level: cards[0].lead.d.level, text: capw(top.length > 40 ? top.slice(0, 38) + '…' : top) });
}

const loadingTrack = (p, tr) => !tr.startsWith('~') && TRACKS[tr] && !p.engine.inst[TRACKS[tr].inst];
let formKey = '', chipKey = '';
function updateNow(p) {
  const now = p.ctx.currentTime;
  const info = p.infos.find((x) => now >= x.t0 && now < x.t1) || p.infos[0];
  if (!info) return;
  $('piece').textContent = `No. ${info.piece} · ${info.key} ${cap(info.mode)} · ${info.meter} · ${info.bpm} ${info.meter === '6/8' ? 'dotted-quarter bpm' : 'bpm'} · ${info.palette}`;
  $('section').textContent = cap(info.section);
  $('secprog').textContent = `bar ${info.sectionBar + 1} of ${info.sectionBars} · phrase ${info.phrase + 1} of ${info.plan.length}${info.theme ? ', the theme' : info.kind === 'ante' ? ', a question' : info.kind === 'cons' ? ', its answer' : ''}`;
  let ch = info.chords[0];
  for (const c of info.chords) if (c.t <= now) ch = c;
  $('chord').textContent = ch ? ch.name : '-';
  $('roman').textContent = ch ? ch.num : '';
  $('energy').style.width = (info.energy * 100).toFixed(0) + '%';
  // form timeline: the whole arc is planned when the piece begins
  const fk = info.piece + ':' + info.secIdx;
  if (fk !== formKey) {
    formKey = fk;
    $('form').innerHTML = info.form.map((s, i) => `<span class="${i < info.secIdx ? 'done' : i === info.secIdx ? 'on' : 'next'}">${cap(s)}</span>`).join('');
    $('form').title = 'Planned as ' + info.arc;
  }
  // orchestra map
  const heard = info.layers.filter((l) => now >= l.enter - 0.05 && now < l.exit);
  const key = heard.map((l) => l.role + ':' + l.track + (loadingTrack(p, l.track) ? '*' : '')).join('|');
  if (key !== chipKey) {
    const prev = new Set(chipKey.split('|'));
    chipKey = key;
    const byRole = {};
    for (const l of heard) (byRole[l.role] = byRole[l.role] || []).push(l);
    $('orchestra').innerHTML = ['mel', 'ost', 'pad', 'bass'].filter((r) => byRole[r]).map((r) => `<span class="role">${ROLE_NAMES[r]}</span><span class="chips">${byRole[r].map((l) => `<span class="chip${prev.has(l.role + ':' + l.track) ? '' : ' new'}${loadingTrack(p, l.track) ? ' loading' : ''}" data-track="${l.track}" title="${esc(l.desc)}">${esc(l.desc.replace(/ \(.*/, ''))}${loadingTrack(p, l.track) ? ' (loading)' : ''}</span>`).join('')}</span>`).join('');
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
      await player.init();
      await player.ctx.resume();
      await player.start();
      player.running = true;
      setStatus('Playing');
      btn.disabled = false; btn.classList.add('playing');
      $('now').hidden = false; $('controls').hidden = false; $('choices').hidden = false;
      history.replaceState(null, '', '?seed=' + seed);
    } catch (e) {
      console.error(e); setStatus('Could not start audio: ' + e.message); btn.disabled = false;
      try { if (player.ctx) player.ctx.close(); } catch {}
      player.ctx = null; player.engine = null;
    }
    return;
  }
  if (player.running) { await player.pause(); btn.classList.remove('playing'); setStatus('Paused'); }
  else { await player.resume(); btn.classList.add('playing'); setStatus('Playing'); }
});
document.addEventListener('visibilitychange', () => { if (player.running) player.tick(); });   // schedule far ahead before the page is throttled
$('volume').addEventListener('input', (e) => { if (player.engine?.volume) player.engine.volume.gain.setTargetAtTime(+e.target.value, player.ctx.currentTime, 0.05); });
$('next').addEventListener('click', () => player.restart(Math.floor(Math.random() * 1e9)));
$('share').addEventListener('click', async () => {
  const url = location.origin + location.pathname + '?seed=' + seed;
  try { await navigator.clipboard.writeText(url); $('share').textContent = 'Link copied'; } catch { $('share').textContent = url; }
  setTimeout(() => ($('share').textContent = 'Copy link to this stream'), 2500);
});

// ---------------------------------------------------------------------------
// visualiser: a slow-scrolling score of light, annotated with the choices that made it
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
  // choice markers drift left with the music they caused (overlay, redrawn crisply each frame)
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
  const eng = new Engine(octx, { seed: renderSeed });
  await eng.load(BASE, null);
  eng.build();
  const comp = new Composer(renderSeed);
  const evs = [], infos = [];
  let tEnd = 0, ndec = 0;
  while (tEnd < (opts.from || 0) + seconds + 2) { const { events, info, decisions } = comp.next(); evs.push(...events); infos.push(info); ndec += decisions.length; tEnd = info.t1; }
  evs.sort((a, b) => dispatchAt(a) - dispatchAt(b));
  const solo = opts.solo ? new Set(opts.solo) : null;
  const noteTimes = [];
  let idx = 0;
  const step = 2;
  const feed = (until) => {
    while (idx < evs.length && dispatchAt(evs[idx]) < until) {
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
// render an explicit list of events (used by the instrument balance test)
window.renderEvents = async (events, seconds) => {
  const sr = 44100;
  const octx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const eng = new Engine(octx, { seed: 1 });
  await eng.load(BASE, null);
  eng.build();
  for (const e of events.slice().sort((a, b) => dispatchAt(a) - dispatchAt(b))) eng.play(e);
  const buf = await octx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  const wav = new DataView(new ArrayBuffer(44 + n * 4));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt '); wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); wav.setUint16(22, 2, true); wav.setUint32(24, sr, true); wav.setUint32(28, sr * 4, true);
  wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); ws(36, 'data'); wav.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { wav.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); wav.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  window.__wav = new Uint8Array(wav.buffer);
  return { bytes: window.__wav.length };
};
window.wavChunk = (i, size) => {
  const s = window.__wav.subarray(i * size, (i + 1) * size);
  let bin = '';
  for (let k = 0; k < s.length; k += 0x8000) bin += String.fromCharCode.apply(null, s.subarray(k, k + 0x8000));
  return btoa(bin);
};
