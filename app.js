"use strict";

// ============================================================
// THUMP v2 — slots, song mode, bass synth, accents,
// undo/redo, WAV export, share API + jam rooms
// ============================================================

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const grid = $("grid");
const playBtn = $("playBtn");
const statusEl = $("status");
const bpmInput = $("bpm");
const bpmVal = $("bpmVal");
const swingInput = $("swing");
const swingVal = $("swingVal");
const humInput = $("hum");
const humVal = $("humVal");
const volInput = $("vol");
const volVal = $("volVal");
const slotBtnsEl = $("slotBtns");
const chainEl = $("chain");

// ---------- data ----------
const CORE = window.THUMP_CORE;
const SLOTS = CORE.SLOTS;
const MIN_STEPS = CORE.MIN_STEPS;
const MAX_STEPS = CORE.MAX_STEPS;
const NOTE_NAMES = CORE.NOTE_NAMES;
const SCALES = CORE.SCALES;
const BASS_ROOT_MIDI = CORE.BASS_ROOT_MIDI;
const STORAGE_KEY = "thump-v2";

const PERC_TRACKS = [
  { id: "kick",    name: "Kick",    note: "C2",  vol: 90, mute: false, rev: 0,  dly: 0 },
  { id: "snare",   name: "Snare",   note: "D3",  vol: 80, mute: false, rev: 22, dly: 0 },
  { id: "clap",    name: "Clap",    note: "D#3", vol: 75, mute: false, rev: 28, dly: 0 },
  { id: "hatC",    name: "Hat Cl",  note: "F#5", vol: 62, mute: false, rev: 6,  dly: 14 },
  { id: "hatO",    name: "Hat Op",  note: "A#5", vol: 55, mute: false, rev: 10, dly: 30 },
  { id: "tom",     name: "Tom",     note: "G3",  vol: 70, mute: false, rev: 12, dly: 0 },
  { id: "rim",     name: "Rim",     note: "E4",  vol: 60, mute: false, rev: 8,  dly: 10 },
  { id: "cowbell", name: "Cowbell", note: "C#4", vol: 50, mute: false, rev: 5,  dly: 8 },
];

const BASS_TRACK = { id: "bass", name: "Bass", note: "A1", vol: 78, mute: false, rev: 4, dly: 0 };
const LEAD_TRACK = { id: "lead", name: "Lead", note: "A3", vol: 62, mute: false, rev: 18, dly: 22 };
const CHORDS_TRACK = { id: "chords", name: "Chords", note: "A2", vol: 58, mute: false, rev: 30, dly: 8 };

const MELODIC_TRACKS = [BASS_TRACK, LEAD_TRACK, CHORDS_TRACK];

const scaleMidi = (deg) => CORE.scaleMidi(deg, state.key, state.scale);
const leadMidi = (deg) => CORE.leadMidi(deg, state.key, state.scale);
const chordMidis = (deg) => CORE.chordMidis(deg, state.key, state.scale);

const PRESETS = {
  house: {
    bpm: 124, swing: 12,
    pattern: {
      kick:  "1000100010001000",
      clap:  "0000100000001000",
      hatC:  "0010001000100010",
      hatO:  "0000000000000010",
    },
  },
  breaks: {
    bpm: 138, swing: 22,
    pattern: {
      kick:  "1000000010010000",
      snare: "0000100000001001",
      hatC:  "0010101000101010",
      tom:   "0000000000000010",
    },
  },
  techno: {
    bpm: 132, swing: 0,
    pattern: {
      kick:    "1000100010001000",
      rim:     "0010000000100010",
      hatO:    "0000001000000010",
      hatC:    "0010100010101001",
      cowbell: "0000000010000000",
    },
  },
  hiphop: {
    bpm: 92, swing: 34,
    pattern: {
      kick:  "1001000000100100",
      snare: "0000100000001000",
      hatC:  "0010101000101010",
      tom:   "0000000000000100",
    },
  },
};

// ---------- state ----------
function emptyPattern(steps = state.steps) {
  return { ...CORE.emptyPattern(steps),
    ...Object.fromEntries(PERC_TRACKS.map((t) => [t.id, new Array(steps).fill(0)])) // 0 off | 1 on | 2 accent
  };
}

const state = {
  playing: false,
  bpm: 124,
  swing: 12,
  humanize: 0,
  key: 9, // A
  scale: "minor",
  masterVol: 0.8,
  mode: "pattern",
  steps: 16,
  activeSlot: "A",
  song: [{ slot: "A", reps: 1 }],
  patterns: Object.fromEntries(SLOTS.map((s) => [s, emptyPattern(16)])),
};

function curPattern() {
  return state.patterns[state.activeSlot];
}

function resizePattern(p, steps) {
  for (const t of PERC_TRACKS) {
    const row = p[t.id];
    while (row.length < steps) row.push(row.length % 4 === 0 ? row[0] ?? 0 : 0);
    p[t.id] = row.slice(0, steps);
  }
  CORE.resizePattern(p, steps);
}

// exposed for tests/debugging
window.__THUMP_STATE = state;

// ---------- persistence ----------
function serialize() {
  return {
    v: 2,
    bpm: state.bpm,
    swing: state.swing,
    humanize: state.humanize,
    key: state.key,
    scale: state.scale,
    steps: state.steps,
    mode: state.mode,
    activeSlot: state.activeSlot,
    song: [...state.song],
    patterns: JSON.parse(JSON.stringify(state.patterns)),
  };
}

function deserialize(d) {
  if (!d || d.v !== 2 || !d.patterns) return false;
  try {
    state.bpm = d.bpm ?? state.bpm;
    state.swing = d.swing ?? state.swing;
    state.humanize = Math.max(0, Math.min(100, +d.humanize || 0));
    state.key = ((+d.key || 0) % 12 + 12) % 12;
    state.scale = SCALES[d.scale] ? d.scale : "minor";
    state.steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, +d.steps || 16));
    state.mode = d.mode === "song" ? "song" : "pattern";
    state.activeSlot = SLOTS.includes(d.activeSlot) ? d.activeSlot : "A";
    state.song = Array.isArray(d.song) && d.song.length ? normalizeSong(d.song) : [{ slot: state.activeSlot, reps: 1 }];
    for (const s of SLOTS) {
      const sp = d.patterns[s] || {};
      const fresh = emptyPattern();
      for (const t of PERC_TRACKS) {
        if (Array.isArray(sp[t.id])) {
          const row = sp[t.id].map((v) => (v === 2 ? 2 : v ? 1 : 0));
          while (row.length < fresh[t.id].length) row.push(0);
          state.patterns[s][t.id] = row.slice(0, fresh[t.id].length);
        }
      }
      if (Array.isArray(sp.bass)) {
        const bass = sp.bass.map((b) => ({
          on: !!(b && b.on),
          semi: Math.max(-24, Math.min(24, +(b && b.semi) || 0)),
        }));
        while (bass.length < fresh.bass.length) bass.push({ on: false, semi: 0 });
        state.patterns[s].bass = bass.slice(0, fresh.bass.length);
      }
      for (const id of ["lead", "chords"]) {
        if (Array.isArray(sp[id])) {
          const row = sp[id].map((b) => ({
            on: !!(b && b.on),
            deg: Math.max(-7, Math.min(14, +(b && b.deg) || 0)),
          }));
          while (row.length < fresh[id].length) row.push({ on: false, deg: 0 });
          state.patterns[s][id] = row.slice(0, fresh[id].length);
        }
      }
      // guarantee every slot matches the loaded step count, even slots
      // absent from older saved data
      resizePattern(state.patterns[s], state.steps);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...serialize(),
      tracks: Object.fromEntries([...PERC_TRACKS, ...MELODIC_TRACKS].map((t) => [t.id, { vol: t.vol, mute: t.mute, rev: t.rev, dly: t.dly }])),
    }));
  } catch (_) {}
}

function restoreLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    const ok = deserialize(d);
    if (ok && d.tracks) {
      for (const t of [...PERC_TRACKS, ...MELODIC_TRACKS]) {
      if (d.tracks[t.id]) {
        t.vol = d.tracks[t.id].vol ?? t.vol;
        t.mute = !!d.tracks[t.id].mute;
        t.rev = d.tracks[t.id].rev ?? t.rev;
        t.dly = d.tracks[t.id].dly ?? t.dly;
      }
      }
    }
    return ok;
  } catch (_) {
    return false;
  }
}
const normalizeSong = CORE.normalizeSong;
const sanitizeAuto = CORE.sanitizeAuto;
const getAuto = CORE.getAuto;
const hasAuto = CORE.hasAuto;
const AUTO_DEFAULTS = CORE.AUTO_DEFAULTS;

// ---------- history (undo/redo) ----------
const hist = { undo: [], redo: [] };

function pushHistory() {
  hist.undo.push(JSON.stringify(serialize()));
  if (hist.undo.length > 80) hist.undo.shift();
  hist.redo.length = 0;
}

function applySnapshot(json) {
  deserialize(JSON.parse(json));
  refreshCells();
  refreshSlotsUI();
  syncControls();
  buildChain();
  saveLocal();
}

function undo() {
  if (!hist.undo.length) return setStatus("Nothing to undo.");
  hist.redo.push(JSON.stringify(serialize()));
  applySnapshot(hist.undo.pop());
}

function redo() {
  if (!hist.redo.length) return setStatus("Nothing to redo.");
  hist.undo.push(JSON.stringify(serialize()));
  applySnapshot(hist.redo.pop());
}

// ============================================================
// AUDIO ENGINE — factory so it works with live AND offline ctx
// ============================================================
function createEngine(ac) {
  const master = ac.createGain();
  const macroLP = ac.createBiquadFilter();
  macroLP.type = "lowpass";
  macroLP.frequency.value = 18000;
  macroLP.Q.value = 0.5;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(ac.destination);
  master.connect(macroLP);
  macroLP.connect(comp);

  // reverb send (generated impulse response)
  const revIn = ac.createGain();
  const conv = ac.createConvolver();
  const irLen = Math.floor(ac.sampleRate * 2.6);
  const ir = ac.createBuffer(2, irLen, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.6);
    }
  }
  conv.buffer = ir;
  revIn.connect(conv);
  conv.connect(master);

  // delay send (dotted-eighth, tempo-synced)
  const dlyIn = ac.createGain();
  const dly = ac.createDelay(2);
  const fb = ac.createGain();
  fb.gain.value = 0.38;
  const dlyTone = ac.createBiquadFilter();
  dlyTone.type = "lowpass";
  dlyTone.frequency.value = 3200;
  dlyIn.connect(dly);
  dly.connect(dlyTone);
  dlyTone.connect(fb);
  fb.connect(dly);
  dly.connect(master);
  setDelayTime(ac.currentTime);

  function setDelayTime(when) {
    const t = 60 / state.bpm / 4 * 3;
    dly.delayTime.setTargetAtTime(t, when, 0.05);
  }

  const gains = {};
  const sends = {};
  for (const t of [...PERC_TRACKS, ...MELODIC_TRACKS]) {
    const main = ac.createGain();
    main.gain.value = trackLevel(t);
    main.connect(master);
    const sr = ac.createGain();
    sr.gain.value = t.rev / 100;
    main.connect(sr);
    sr.connect(revIn);
    const sd = ac.createGain();
    sd.gain.value = t.dly / 100;
    main.connect(sd);
    sd.connect(dlyIn);
    gains[t.id] = main;
    sends[t.id] = { rev: sr, dly: sd };
  }

  function updateSends(id) {
    if (!ac.currentTime && ac.currentTime !== 0) return;
    const tr = [...PERC_TRACKS, ...MELODIC_TRACKS].find((x) => x.id === id);
    sends[id].rev.gain.setTargetAtTime((tr.rev / 100) * macro.rev, ac.currentTime, 0.02);
    sends[id].dly.gain.setTargetAtTime((tr.dly / 100) * macro.dly, ac.currentTime, 0.02);
  }

  const macro = { cutoff: 1, rev: 1, dly: 1 };

  function setMacro(cutoff, rev, dly) {
    macro.cutoff = cutoff;
    macro.rev = rev;
    macro.dly = dly;
    const when = ac.currentTime;
    macroLP.frequency.setTargetAtTime(Math.max(150, 18000 * cutoff * cutoff), when, 0.06);
    for (const t of [...PERC_TRACKS, ...MELODIC_TRACKS]) {
      sends[t.id].rev.gain.setTargetAtTime((t.rev / 100) * rev, when, 0.06);
      sends[t.id].dly.gain.setTargetAtTime((t.dly / 100) * dly, when, 0.06);
    }
  }

  const noiseLen = ac.sampleRate * 2;
  const noiseBuf = ac.createBuffer(1, noiseLen, ac.sampleRate);
  {
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) ch[i] = Math.random() * 2 - 1;
  }

  function noise(t, dur) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.start(t);
    src.stop(t + dur + 0.05);
    return src;
  }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * vel(), 0.001), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  let _vel = 1;
  function vel() { return _vel; }

  // ---- instruments ----
  function kick(t, v) {
    _vel = v;
    const o = ac.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    const g = ac.createGain();
    env(g, t, 0.002, 1.0, 0.34);
    o.connect(g).connect(gains.kick);
    o.start(t); o.stop(t + 0.45);

    const sub = ac.createOscillator(); sub.type = "sine";
    sub.frequency.setValueAtTime(70, t);
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const sg = ac.createGain();
    env(sg, t, 0.004, 0.6, 0.26);
    sub.connect(sg).connect(gains.kick);
    sub.start(t); sub.stop(t + 0.35);

    const n = noise(t, 0.02);
    const ng = ac.createGain();
    env(ng, t, 0.001, 0.4, 0.015);
    n.connect(ng).connect(gains.kick);
  }

  function snare(t, v) {
    _vel = v;
    const n = noise(t, 0.25);
    const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
    const g = ac.createGain();
    env(g, t, 0.002, 0.7, 0.19);
    n.connect(hp).connect(g).connect(gains.snare);
    [185, 330].forEach((f, i) => {
      const o = ac.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.09);
      const og = ac.createGain();
      env(og, t, 0.002, i === 0 ? 0.5 : 0.28, 0.1);
      o.connect(og).connect(gains.snare);
      o.start(t); o.stop(t + 0.15);
    });
  }

  function clap(t, v) {
    _vel = v;
    [0, 0.011, 0.023].forEach((off, i) => {
      const last = i === 2;
      const n = noise(t + off, 0.2);
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1100; bp.Q.value = 1.6;
      const g = ac.createGain();
      env(g, t + off, 0.001, last ? 0.6 : 0.32, last ? 0.17 : 0.01);
      n.connect(bp).connect(g).connect(gains.clap);
    });
  }

  function hat(t, open, v) {
    _vel = v;
    const dur = open ? 0.45 : 0.09;
    const dest = open ? gains.hatO : gains.hatC;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 10000; bp.Q.value = 1;
    const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 8000;
    const g = ac.createGain();
    env(g, t, 0.001, open ? 0.45 : 0.55, open ? 0.35 : 0.05);
    bp.connect(hp).connect(g).connect(dest);
    [263, 400, 421, 474, 587, 845].forEach((f) => {
      const o = ac.createOscillator(); o.type = "square"; o.frequency.value = f;
      o.connect(bp);
      o.start(t); o.stop(t + dur);
    });
    const n = noise(t, open ? 0.4 : 0.07);
    const ng = ac.createGain();
    env(ng, t, 0.001, 0.35, open ? 0.33 : 0.045);
    n.connect(hp).connect(ng).connect(dest);
  }

  function tom(t, v) {
    _vel = v;
    const o = ac.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(95, t + 0.18);
    const g = ac.createGain();
    env(g, t, 0.002, 0.75, 0.26);
    o.connect(g).connect(gains.tom);
    o.start(t); o.stop(t + 0.35);
    const n = noise(t, 0.08);
    const ng = ac.createGain();
    env(ng, t, 0.001, 0.15, 0.06);
    n.connect(ng).connect(gains.tom);
  }

  function rim(t, v) {
    _vel = v;
    [1700, 2550].forEach((f, i) => {
      const o = ac.createOscillator(); o.type = "square"; o.frequency.value = f;
      const g = ac.createGain();
      env(g, t, 0.001, i === 0 ? 0.25 : 0.12, 0.03);
      o.connect(g).connect(gains.rim);
      o.start(t); o.stop(t + 0.06);
    });
  }

  function cowbell(t, v) {
    _vel = v;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2640; bp.Q.value = 1.1;
    const g = ac.createGain();
    env(g, t, 0.002, 0.35, 0.3);
    bp.connect(g).connect(gains.cowbell);
    [540, 800].forEach((f) => {
      const o = ac.createOscillator(); o.type = "square"; o.frequency.value = f;
      o.connect(bp);
      o.start(t); o.stop(t + 0.35);
    });
  }

  // 303-style acid bass
  function bass(t, midi, dur, v) {
    _vel = v;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
    const sub = ac.createOscillator(); sub.type = "sine"; sub.frequency.value = f / 2;

    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 9;
    lp.frequency.setValueAtTime(Math.min(f * 9, 9000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.4, 60), t + 0.17);

    const g = ac.createGain();
    env(g, t, 0.004, 0.55, Math.max(dur * 0.9, 0.22));

    o.connect(lp);
    sub.connect(lp);
    lp.connect(g).connect(gains.bass);
    o.start(t); o.stop(t + dur + 0.4);
    sub.start(t); sub.stop(t + dur + 0.4);
  }

  // bright plucky lead (detuned saw pair)
  function lead(t, midi, dur, v) {
    _vel = v;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(Math.min(f * 10, 12000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 300), t + 0.12);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.3 * _vel, 0.001), t + 0.006);
    g.gain.setTargetAtTime(0.0001, t + Math.max(dur * 0.8, 0.1), 0.09);
    lp.connect(g).connect(gains.lead);
    [-7, 7].forEach((cents) => {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.5);
    });
  }

  // soft poly pad for chords
  function chords(t, midis, dur, v) {
    _vel = v;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.16 * _vel, 0.001), t + 0.04);
    g.gain.setTargetAtTime(0.0001, t + Math.max(dur * 0.85, 0.15), 0.18);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    lp.connect(g).connect(gains.chords);
    midis.forEach((m, i) => {
      const f = 440 * Math.pow(2, (m - 69) / 12);
      const o1 = ac.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = f; o1.detune.value = -5;
      const o2 = ac.createOscillator(); o2.type = "triangle"; o2.frequency.value = f; o2.detune.value = 5;
      const og = ac.createGain();
      og.gain.value = i === 0 ? 0.5 : 0.36;
      o1.connect(og); o2.connect(og);
      og.connect(lp);
      [o1, o2].forEach((o) => { o.start(t); o.stop(t + dur + 0.8); });
    });
  }

  function trigger(id, tt, value, velMul = 1) {
    const tr = [...PERC_TRACKS, ...MELODIC_TRACKS].find((x) => x.id === id);
    if (tr && tr.mute) return;
    const v = (value >= 2 ? 1.0 : 0.72) * velMul;
    switch (id) {
      case "kick": return kick(tt, v);
      case "snare": return snare(tt, v);
      case "clap": return clap(tt, v);
      case "hatC": return hat(tt, false, v);
      case "hatO": return hat(tt, true, v);
      case "tom": return tom(tt, v);
      case "rim": return rim(tt, v);
      case "cowbell": return cowbell(tt, v);
      case "bass": break;
    }
  }

  return { ac, master, gains, trigger, bass, lead, chords, setDelayTime, updateSends, setMacro };
}

let engine = null;

function ensureAudio() {
  if (!engine) engine = createEngine(new (window.AudioContext || window.webkitAudioContext)());
  if (engine.ac.state === "suspended") engine.ac.resume();
}

function trackLevel(t) {
  return Math.pow(t.vol / 100, 2) * 0.9;
}

function updateTrackGain(id) {
  if (!engine) return;
  const tr = [...PERC_TRACKS, ...MELODIC_TRACKS].find((x) => x.id === id);
  engine.gains[id].gain.setTargetAtTime(trackLevel(tr), engine.ac.currentTime, 0.02);
}

function updateSendsFor(id) {
  if (!engine) return;
  engine.updateSends(id);
}

// ============================================================
// SEQUENCER
// ============================================================
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
let nextNoteTime = 0;
let schedStep = 0;
let schedEntry = 0;
let schedRep = 0;
let timerId = null;

function stepDuration() {
  return 60 / state.bpm / 4;
}

function scheduleStep(slot, step, time) {
  const pat = state.patterns[slot];
  const sd = stepDuration();

  const h = state.humanize / 100;
  const humT = () => (Math.random() * 2 - 1) * h * 0.012;
  const humV = () => 1 - Math.random() * h * 0.35;

  for (const tr of PERC_TRACKS) {
    const val = pat[tr.id][step];
    if (!val) continue;
    const swingOffset = step % 2 === 1 ? (state.swing / 100) * sd : 0;
    engine.trigger(tr.id, time + swingOffset + humT(), val, humV());
    scheduleVisual(slot, tr.id, step, time + swingOffset);
  }

  const b = pat.bass[step];
  if (b.on && !BASS_TRACK.mute) {
    const swingOffset = step % 2 === 1 ? (state.swing / 100) * sd : 0;
    let len = sd;
    for (let k = 1; k < state.steps; k++) {
      if (pat.bass[(step + k) % state.steps].on) { len = k * sd; break; }
    }
    const midi = BASS_ROOT_MIDI + b.semi;
    engine.bass(time + swingOffset + humT(), midi, len, (b.semi % 12 === 0 ? 1.0 : 0.8) * humV());
    scheduleVisual(slot, "bass", step, time + swingOffset);
  }

  const ld = pat.lead[step];
  if (ld.on && !LEAD_TRACK.mute) {
    const swingOffset = step % 2 === 1 ? (state.swing / 100) * sd : 0;
    let len = sd;
    for (let k = 1; k < state.steps; k++) {
      if (pat.lead[(step + k) % state.steps].on) { len = k * sd; break; }
    }
    engine.lead(time + swingOffset + humT(), leadMidi(ld.deg), len, humV());
    scheduleVisual(slot, "lead", step, time + swingOffset);
  }

  const ch = pat.chords[step];
  if (ch.on && !CHORDS_TRACK.mute) {
    const swingOffset = step % 2 === 1 ? (state.swing / 100) * sd : 0;
    let len = sd;
    for (let k = 1; k < state.steps; k++) {
      if (pat.chords[(step + k) % state.steps].on) { len = k * sd; break; }
    }
    engine.chords(time + swingOffset, chordMidis(ch.deg), len, humV());
    scheduleVisual(slot, "chords", step, time + swingOffset);
  }

  updatePlayhead(step, time);
}

function scheduleVisual(slot, trackId, step, time) {
  if (slot !== state.activeSlot) return; // only flash the slot being viewed
  const delay = Math.max(0, (time - engine.ac.currentTime) * 1000);
  setTimeout(() => {
    if (trackId) flashCell(trackId, step);
  }, delay);
}

function updatePlayhead(step, time) {
  const delay = Math.max(0, (time - engine.ac.currentTime) * 1000);
  setTimeout(() => {
    document.querySelectorAll(".cell.playhead").forEach((c) => c.classList.remove("playhead"));
    document.querySelectorAll(`.cell[data-step="${step}"]`).forEach((c) => c.classList.add("playhead"));
  }, delay);
}

function scheduler() {
  while (nextNoteTime < engine.ac.currentTime + SCHEDULE_AHEAD) {
    const slot =
      state.mode === "song"
        ? state.song[schedEntry % state.song.length].slot
        : state.activeSlot;

    if (state.mode === "song") {
      const len = state.song.length;
      const ea = getAuto(state.song[schedEntry]);
      const pa = getAuto(state.song[(schedEntry - 1 + len) % len]);
      const f = schedRep === 0 ? (schedStep + 1) / state.steps : 1;
      const lerp = (a, b) => a + (b - a) * f;
      engine.setMacro(lerp(pa.cutoff, ea.cutoff), lerp(pa.rev, ea.rev), lerp(pa.dly, ea.dly));
      const pb = pa.bpm > 0 ? pa.bpm : state.bpm;
      const eb = ea.bpm > 0 ? ea.bpm : state.bpm;
      const target = lerp(pb, eb);
      if (Math.abs(target - state.bpm) > 0.25) {
        state.bpm = target;
        bpmInput.value = Math.round(target);
        bpmVal.textContent = Math.round(target);
      }
    }

    scheduleStep(slot, schedStep, nextNoteTime);

    if (state.mode === "song" && schedStep === state.steps - 1) {
      const idx = schedEntry;
      const delay = Math.max(0, (nextNoteTime + stepDuration() - engine.ac.currentTime) * 1000);
      setTimeout(() => highlightChain(idx), delay);
    }

    schedStep = (schedStep + 1) % state.steps;
    if (schedStep === 0 && state.mode === "song") {
      schedRep++;
      if (schedRep >= state.song[schedEntry % state.song.length].reps) {
        schedEntry = (schedEntry + 1) % state.song.length;
        schedRep = 0;
      }
    }
    nextNoteTime += stepDuration();
  }
}

function start() {
  ensureAudio();
  state.playing = true;
  schedStep = 0;
  schedEntry = 0;
  schedRep = 0;
  nextNoteTime = engine.ac.currentTime + 0.06;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  playBtn.textContent = "❚❚";
  playBtn.classList.add("on");
  setStatus(state.mode === "song" ? `Playing song · ${state.bpm} BPM` : `Playing ${state.activeSlot} · ${state.bpm} BPM`);
}

function stop() {
  state.playing = false;
  clearInterval(timerId);
  playBtn.textContent = "▶";
  playBtn.classList.remove("on");
  if (engine) engine.setMacro(1, 1, 1);
  document.querySelectorAll(".cell.playhead").forEach((c) => c.classList.remove("playhead"));
  document.querySelectorAll(".tl-block.now").forEach((c) => c.classList.remove("now"));
  document.querySelectorAll(".slot.playing").forEach((s) => s.classList.remove("playing"));
  setStatus("Stopped.");
}

// ============================================================
// UI — grid
// ============================================================
let painting = false;
let paintValue = 1;
let rowClipboard = null; // {trackId, values}
const clipBtns = {};

const noteName = CORE.noteName;

function buildGrid() {
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `var(--label-w) repeat(${state.steps}, minmax(26px, 1fr))`;
  const rows = [
    ...PERC_TRACKS.map((t) => ({ ...t, kind: "perc" })),
    { ...BASS_TRACK, kind: "bass" },
    { ...LEAD_TRACK, kind: "lead" },
    { ...CHORDS_TRACK, kind: "chords" },
  ];

  rows.forEach((tr) => {
    const label = document.createElement("div");
    label.className = "row-label" + (tr.mute ? " muted" : "");
    label.dataset.track = tr.id;
    label.innerHTML =
      `<div class="row-head"><span class="row-name">${tr.name}</span><small>${tr.kind === "bass" ? "acid" : tr.note}</small></div>` +
      `<div class="row-tools">` +
      `<button class="mute-btn${tr.mute ? " active" : ""}" data-track="${tr.id}" title="Mute">M</button>` +
      `<input type="range" class="row-vol" data-track="${tr.id}" min="0" max="100" value="${tr.vol}" title="Volume" />` +
      `<button class="copy-btn" data-track="${tr.id}" title="Click: copy row · Right-click: paste">⧉</button>` +
      `</div>` +
      `<div class="fx-line"><small>RV</small>` +
      `<input type="range" class="row-fx" data-track="${tr.id}" data-fx="rev" min="0" max="100" value="${tr.rev}" title="Reverb send" />` +
      `<small>DL</small>` +
      `<input type="range" class="row-fx" data-track="${tr.id}" data-fx="dly" min="0" max="100" value="${tr.dly}" title="Delay send" />` +
      `</div>`;
    grid.appendChild(label);

    for (let s = 0; s < state.steps; s++) {
      const cell = document.createElement("div");
      cell.className = "cell" + (s % 4 === 0 ? " beat-mark" : "") + (tr.kind === "bass" ? " bass-cell" : "");
      cell.dataset.track = tr.id;
      cell.dataset.step = s;
      cell.addEventListener("pointerdown", (e) => onCellDown(e, tr, s, cell));
      cell.addEventListener("wheel", (e) => {
        if (tr.kind === "perc") return;
        e.preventDefault();
        onMelodicWheel(e, tr, s);
      }, { passive: false });
      cell.addEventListener("contextmenu", (e) => e.preventDefault());
      grid.appendChild(cell);
    }
  });

  grid.addEventListener("pointerover", (e) => {
    if (!painting) return;
    const cell = e.target.closest(".cell");
    if (cell) applyPaint(cell, cell.dataset.track, +cell.dataset.step);
  });
  window.addEventListener("pointerup", () => (painting = false));

  grid.addEventListener("input", (e) => {
    const vol = e.target.closest(".row-vol");
    if (vol) {
      const tr = [...PERC_TRACKS, ...MELODIC_TRACKS].find((x) => x.id === vol.dataset.track);
      tr.vol = +vol.value;
      updateTrackGain(tr.id);
      saveLocal();
      return;
    }
    const fx = e.target.closest(".row-fx");
    if (fx) {
      const tr = [...PERC_TRACKS, ...MELODIC_TRACKS].find((x) => x.id === fx.dataset.track);
      tr[fx.dataset.fx] = +fx.value;
      if (engine) {
        engine.ac; // touch to ensure engine exists
        updateSendsFor(tr.id);
      }
      saveLocal();
    }
  });

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".mute-btn");
    if (btn) {
      const tr = [...PERC_TRACKS, ...MELODIC_TRACKS].find((x) => x.id === btn.dataset.track);
      tr.mute = !tr.mute;
      btn.classList.toggle("active", tr.mute);
      btn.closest(".row-label").classList.toggle("muted", tr.mute);
      saveLocal();
      setStatus(`${tr.name} ${tr.mute ? "muted" : "unmuted"}.`);
    }
  });

  grid.addEventListener("contextmenu", (e) => {
    const btn = e.target.closest(".mute-btn, .copy-btn, .row-vol");
    if (btn) e.preventDefault();
    if (!btn) return;
    if (btn.classList.contains("copy-btn")) pasteRow(btn.dataset.track);
  });

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-btn");
    if (btn) copyRow(btn);
  });

  refreshCells();
}

function onCellDown(e, tr, s, cell) {
  e.preventDefault();
  ensureAudio();
  pushHistory();

  if (tr.kind === "bass" || tr.kind === "lead" || tr.kind === "chords") {
    if (e.shiftKey) return;
    const b = curPattern()[tr.id][s];
    b.on = !b.on;
    paintCell(cell, tr.id, s);
    if (b.on) previewMelodic(tr.id, s);
    saveLocal();
    return;
  }

  painting = true;
  const cur = curPattern()[tr.id][s];
  paintValue = e.shiftKey
    ? (cur === 2 ? 1 : 2)          // shift cycles accent
    : (cur ? 0 : 1);
  if (e.shiftKey) {
    curPattern()[tr.id][s] = paintValue;
    paintCell(cell, tr.id, s);
    if (paintValue && !state.playing) engine.trigger(tr.id, engine.ac.currentTime + 0.01, paintValue);
  } else {
    applyPaint(cell, tr.id, s);
    if (paintValue && !state.playing) engine.trigger(tr.id, engine.ac.currentTime + 0.01, paintValue);
  }
  saveLocal();
}

function onMelodicWheel(e, tr, s) {
  ensureAudio();
  pushHistory();
  const b = curPattern()[tr.id][s];
  if (!b.on) b.on = true;
  const dir = e.deltaY < 0 ? 1 : -1;
  if (tr.kind === "bass") {
    b.semi = Math.max(-24, Math.min(24, b.semi + dir * (e.shiftKey ? 12 : 1)));
  } else {
    b.deg = Math.max(-7, Math.min(14, b.deg + dir * (e.shiftKey ? 7 : 1)));
  }
  refreshCells();
  previewMelodic(tr.id, s);
  saveLocal();
}

function previewMelodic(trackId, s) {
  const b = curPattern()[trackId][s];
  if (trackId === "bass") {
    engine.bass(engine.ac.currentTime + 0.01, BASS_ROOT_MIDI + b.semi, 0.3, 0.9);
  } else if (trackId === "lead") {
    engine.lead(engine.ac.currentTime + 0.01, leadMidi(b.deg), 0.3, 0.9);
  } else {
    engine.chords(engine.ac.currentTime + 0.01, chordMidis(b.deg), 0.5, 0.9);
  }
}

function applyPaint(cell, trackId, step) {
  if (trackId === "bass") return;
  curPattern()[trackId][step] = paintValue;
  paintCell(cell, trackId, step);
  if (paintValue) flashCell(trackId, step);
  saveLocal();
}

function paintCell(cell, trackId, step) {
  const pat = curPattern();
  if (trackId === "bass" || trackId === "lead" || trackId === "chords") {
    const b = pat[trackId][step];
    const isRoot = trackId === "bass" ? b.semi % 12 === 0 : b.deg % 7 === 0;
    cell.classList.toggle("on", b.on);
    cell.classList.toggle("acc", b.on && isRoot);
    let tag = cell.querySelector(".note-tag");
    if (b.on) {
      if (!tag) { tag = document.createElement("span"); tag.className = "note-tag"; cell.appendChild(tag); }
      tag.textContent =
        trackId === "bass" ? noteName(BASS_ROOT_MIDI + b.semi)
        : trackId === "lead" ? noteName(leadMidi(b.deg))
        : noteName(chordMidis(b.deg)[0]);
    } else if (tag) tag.remove();
    return;
  }
  const val = pat[trackId][step];
  cell.classList.toggle("on", !!val);
  cell.classList.toggle("acc", val === 2);
}

function flashCell(trackId, step) {
  const cell = document.querySelector(`.cell[data-track="${trackId}"][data-step="${step}"]`);
  if (!cell || !cell.classList.contains("on")) return;
  cell.classList.add("hit");
  setTimeout(() => cell.classList.remove("hit"), 90);
}

function refreshCells() {
  document.querySelectorAll(".cell").forEach((cell) => paintCell(cell, cell.dataset.track, +cell.dataset.step));
}

function refreshRowLabels() {
  document.querySelectorAll(".row-label").forEach((label) => {
    const id = label.querySelector(".mute-btn")?.dataset.track;
    if (!id) return;
    const tr = [...PERC_TRACKS, ...MELODIC_TRACKS].find((x) => x.id === id);
    label.classList.toggle("muted", tr.mute);
    label.querySelector(".mute-btn").classList.toggle("active", tr.mute);
    label.querySelector(".row-vol").value = tr.vol;
    const [rev, dly] = label.querySelectorAll(".row-fx");
    rev.value = tr.rev;
    dly.value = tr.dly;
  });
}

// row copy/paste
function copyRow(btn) {
  const trackId = btn.dataset.track;
  const pat = curPattern();
  const isMelodic = trackId !== "perc" && MELODIC_TRACKS.some((t) => t.id === trackId);
  rowClipboard = isMelodic
    ? { trackId, values: pat[trackId].map((b) => ({ ...b })), melodic: true }
    : { trackId, values: [...pat[trackId]], melodic: false };
  Object.values(clipBtns).forEach((b) => b.classList.remove("clipboard"));
  btn.classList.add("clipboard");
  setStatus(`${trackId} row copied — right-click ⧉ on another row to paste.`);
}

function pasteRow(targetTrack) {
  if (!rowClipboard) return setStatus("Clipboard empty — click ⧉ on a row first.");
  pushHistory();
  const pat = curPattern();
  const targetMelodic = MELODIC_TRACKS.some((t) => t.id === targetTrack);
  const fixLen = (arr, mk) => {
    const out = arr.slice(0, state.steps);
    while (out.length < state.steps) out.push(mk());
    return out;
  };
  const mkPerc = () => 0;
  const mkBass = () => ({ on: false, semi: 0 });
  const mkDeg = () => ({ on: false, deg: 0 });

  if (rowClipboard.melodic) {
    if (targetMelodic) {
      const mk = targetTrack === "bass" ? mkBass : mkDeg;
      pat[targetTrack] = fixLen(rowClipboard.values.map((b) => ({ ...b })), mk);
    } else {
      pat[targetTrack] = fixLen(rowClipboard.values.map((b) => (b.on ? 1 : 0)), mkPerc);
    }
  } else if (targetMelodic) {
    const mk = targetTrack === "bass" ? mkBass : mkDeg;
    pat[targetTrack] = fixLen(rowClipboard.values.map((v) => (targetTrack === "bass" ? { on: !!v, semi: 0 } : { on: !!v, deg: 0 })), mk);
  } else {
    pat[targetTrack] = fixLen(rowClipboard.values, mkPerc);
  }
  refreshCells();
  saveLocal();
  setStatus(`Pasted into ${targetTrack}.`);
}

// ============================================================
// UI — slots & song mode
// ============================================================
function buildSlotsBar() {
  SLOTS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "slot" + (s === state.activeSlot ? " active" : "");
    b.textContent = s;
    b.dataset.slot = s;
    b.title = "Left-click: edit · Right-click: copy current slot here";
    b.addEventListener("click", () => selectSlot(s));
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      copySlotTo(s);
    });
    slotBtnsEl.appendChild(b);
  });
}

function selectSlot(s) {
  pushHistory();
  state.activeSlot = s;
  refreshSlotsUI();
  refreshCells();
  saveLocal();
  jamBroadcast();
}

function copySlotTo(dest) {
  if (dest === state.activeSlot) return;
  pushHistory();
  state.patterns[dest] = JSON.parse(JSON.stringify(curPattern()));
  refreshSlotsUI();
  saveLocal();
  setStatus(`Copied ${state.activeSlot} → ${dest}.`);
  jamBroadcast();
}

function refreshSlotsUI() {
  document.querySelectorAll(".slot").forEach((b) => {
    b.classList.toggle("active", b.dataset.slot === state.activeSlot);
    b.classList.toggle("empty", isSlotEmpty(b.dataset.slot));
  });
}

function isSlotEmpty(s) {
  const p = state.patterns[s];
  return !PERC_TRACKS.some((t) => p[t.id].some(Boolean)) && !MELODIC_TRACKS.some((t) => p[t.id].some((b) => b.on));
}

function buildChain() {
  chainEl.innerHTML = "";
  chainEl.classList.add("timeline");
  state.song.forEach((entry, i) => {
    const block = document.createElement("div");
    block.className = "tl-block" + (hasAuto(entry) ? " has-auto" : "") + (i === autoSelIdx ? " sel" : "");
    block.dataset.slot = entry.slot;
    block.style.flexGrow = entry.reps;
    block._entry = entry;
    block.innerHTML =
      `<span class="tl-label">${entry.slot}${entry.reps > 1 ? " ×" + entry.reps : ""}</span>` +
      `<span class="tl-grip" title="Drag to change repeats"></span>`;
    attachTimelineEvents(block, i);
    chainEl.appendChild(block);
  });
  if (!state.song.length) {
    chainEl.innerHTML = `<span class="tl-empty">+ Chain to build your song</span>`;
  }
}

function attachTimelineEvents(block, i) {
  let drag = null;

  block.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = block.getBoundingClientRect();
    if (rect.right - e.clientX < 12) {
      drag = { mode: "resize", startX: e.clientX, startReps: block._entry.reps, moved: false };
    } else {
      drag = { mode: "move", startX: e.clientX, idx: i, moved: false };
      block.classList.add("dragging");
    }
    block.setPointerCapture(e.pointerId);
  });

  block.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.mode === "resize") {
      const newReps = Math.max(1, Math.min(16, drag.startReps + Math.round((e.clientX - drag.startX) / 34)));
      if (newReps !== block._entry.reps) {
        if (!drag.moved) { pushHistory(); drag.moved = true; }
        block._entry.reps = newReps;
        block.style.flexGrow = newReps;
        block.querySelector(".tl-label").textContent = `${block._entry.slot}${newReps > 1 ? " ×" + newReps : ""}`;
      }
      return;
    }
    if (!drag.moved && Math.abs(e.clientX - drag.startX) > 8) drag.moved = true;
    if (!drag.moved) return;
    const siblings = [...chainEl.querySelectorAll(".tl-block")];
    let target = null;
    for (const sib of siblings) {
      if (sib === block) continue;
      const r = sib.getBoundingClientRect();
      if (e.clientX > r.left && e.clientX < r.right) {
        target = e.clientX > r.left + r.width / 2 ? sib.nextSibling : sib;
        break;
      }
    }
    if (target === block.nextSibling) target = null;
    if (target !== null && target !== block) {
      chainEl.insertBefore(block, target);
    } else if (target === null && e.clientX > siblings[siblings.length - 1].getBoundingClientRect().right) {
      chainEl.appendChild(block);
    }
  });

  block.addEventListener("pointerup", () => {
    if (!drag) return;
    block.classList.remove("dragging");
    if (drag.mode === "move" && drag.moved) {
      // commit DOM order back into state.song
      const order = [...chainEl.querySelectorAll(".tl-block")].map((b) => b._entry);
      const same = order.length === state.song.length && order.every((en, j) => en === state.song[j]);
      if (!same) {
        state.song = order;
        saveLocal();
        jamBroadcast();
      }
    } else if (drag.mode === "resize" && drag.moved) {
      saveLocal();
      jamBroadcast();
    } else if (!drag.moved) {
      block._skipClick = true;
      openAutoEditor(i);
    }
    buildChain();
    drag = null;
  });

  block.addEventListener("click", () => {
    if (block._skipClick) { block._skipClick = false; return; }
    openAutoEditor(i);
  });

  block.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    pushHistory();
    state.song.splice(i, 1);
    if (!state.song.length) state.song = [{ slot: state.activeSlot, reps: 1 }];
    if (autoSelIdx >= state.song.length) autoSelIdx = -1;
    buildChain();
    saveLocal();
    jamBroadcast();
  });
}

function e_pointerIdSafe() { return 0; }
// ---------- automation editor ----------
let autoSelIdx = -1;
const autoPop = $("autoPop");

function openAutoEditor(i) {
  autoSelIdx = i;
  const entry = state.song[i];
  const a = getAuto(entry);
  $("autoSlotLbl").textContent = `${entry.slot}·${entry.reps}`;
  $("autoCut").value = Math.round(a.cutoff * 100);
  $("autoCutVal").textContent = Math.round(a.cutoff * 100) + "%";
  $("autoRev").value = Math.round(a.rev * 100);
  $("autoRevVal").textContent = Math.round(a.rev * 100) + "%";
  $("autoDly").value = Math.round(a.dly * 100);
  $("autoDlyVal").textContent = Math.round(a.dly * 100) + "%";
  $("autoBpmOn").checked = a.bpm > 0;
  $("autoBpm").disabled = a.bpm <= 0;
  $("autoBpm").value = a.bpm > 0 ? a.bpm : Math.round(state.bpm);
  $("autoBpmVal").textContent = a.bpm > 0 ? a.bpm + " BPM" : "";
  buildChain();
  autoPop.classList.remove("hidden");
}

function autoSave(patch) {
  if (autoSelIdx < 0 || !state.song[autoSelIdx]) return;
  pushHistory();
  const entry = state.song[autoSelIdx];
  entry.auto = sanitizeAuto({ ...getAuto(entry), ...patch });
  if (!hasAuto(entry)) delete entry.auto;
  buildChain();
  saveLocal();
  jamBroadcast();
}

$("autoCut").addEventListener("input", (e) => {
  $("autoCutVal").textContent = e.target.value + "%";
  autoSave({ cutoff: e.target.value / 100 });
});
$("autoRev").addEventListener("input", (e) => {
  $("autoRevVal").textContent = e.target.value + "%";
  autoSave({ rev: e.target.value / 100 });
});
$("autoDly").addEventListener("input", (e) => {
  $("autoDlyVal").textContent = e.target.value + "%";
  autoSave({ dly: e.target.value / 100 });
});
$("autoBpmOn").addEventListener("change", (e) => {
  $("autoBpm").disabled = !e.target.checked;
  $("autoBpmVal").textContent = e.target.checked ? $("autoBpm").value + " BPM" : "";
  autoSave({ bpm: e.target.checked ? +$("autoBpm").value : 0 });
});
$("autoBpm").addEventListener("input", (e) => {
  $("autoBpmVal").textContent = e.target.value + " BPM";
  autoSave({ bpm: +e.target.value });
});
document.addEventListener("pointerdown", (e) => {
  if (autoPop.classList.contains("hidden")) return;
  const chip = e.target.closest(".tl-block");
  if (!autoPop.contains(e.target) && !(chip && chip.classList.contains("sel"))) {
    autoPop.classList.add("hidden");
    autoSelIdx = -1;
    buildChain();
  }
});

$("chainAdd").addEventListener("click", () => {
  pushHistory();
  state.song.push({ slot: state.activeSlot, reps: 1 });
  buildChain();
  saveLocal();
  setStatus(`Appended ${state.activeSlot} — song has ${state.song.length} entries.`);
  jamBroadcast();
});

$("chainClear").addEventListener("click", () => {
  pushHistory();
  state.song = [{ slot: state.activeSlot, reps: 1 }];
  buildChain();
  saveLocal();
});

$("modeToggle").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-mode]");
  if (!btn) return;
  pushHistory();
  state.mode = btn.dataset.mode;
  document.querySelectorAll("#modeToggle .chip").forEach((b) => b.classList.toggle("active", b === btn));
  saveLocal();
  setStatus(state.mode === "song" ? "Song mode — chain plays in order." : "Pattern mode.");
});

const stepsInput = document.getElementById("stepsInput");
stepsInput.addEventListener("change", () => {
  const n = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.round(+stepsInput.value || 16)));
  stepsInput.value = n;
  if (n === state.steps) return;
  pushHistory();
  state.steps = n;
  for (const s of SLOTS) resizePattern(state.patterns[s], state.steps);
  buildGrid();
  saveLocal();
  setStatus(`${state.steps} steps per pattern.`);
});

function highlightChain(idx) {
  document.querySelectorAll(".tl-block").forEach((b, i) => b.classList.toggle("now", i === idx));
  const slot = state.song[idx] ? state.song[idx].slot : null;
  document.querySelectorAll(".slot").forEach((b) =>
    b.classList.toggle("playing", state.mode === "song" && b.dataset.slot === slot)
  );
}

// ============================================================
// UI — top controls / presets
// ============================================================
bpmInput.addEventListener("input", () => {
  state.bpm = +bpmInput.value;
  bpmVal.textContent = state.bpm;
  if (engine) engine.setDelayTime(engine.ac.currentTime);
  saveLocal();
});
swingInput.addEventListener("input", () => {
  state.swing = +swingInput.value;
  swingVal.textContent = state.swing + "%";
  saveLocal();
});
humInput.addEventListener("input", () => {
  state.humanize = +humInput.value;
  humVal.textContent = state.humanize;
  saveLocal();
});

// key / scale selects
const keySel = $("keySel");
const scaleSel = $("scaleSel");
NOTE_NAMES.forEach((n, i) => {
  const o = document.createElement("option");
  o.value = i;
  o.textContent = n;
  keySel.appendChild(o);
});
Object.keys(SCALES).forEach((s) => {
  const o = document.createElement("option");
  o.value = s;
  o.textContent = s.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  scaleSel.appendChild(o);
});
keySel.addEventListener("change", () => {
  state.key = +keySel.value;
  refreshCells();
  saveLocal();
});
scaleSel.addEventListener("change", () => {
  state.scale = scaleSel.value;
  refreshCells();
  saveLocal();
});
volInput.addEventListener("input", () => {
  state.masterVol = volInput.value / 100;
  volVal.textContent = volInput.value;
  if (engine) engine.master.gain.setTargetAtTime(state.masterVol, engine.ac.currentTime, 0.02);
  saveLocal();
});

function syncControls() {
  bpmInput.value = state.bpm;
  bpmVal.textContent = state.bpm;
  swingInput.value = state.swing;
  swingVal.textContent = state.swing + "%";
  humInput.value = state.humanize;
  humVal.textContent = state.humanize;
  keySel.value = state.key;
  scaleSel.value = state.scale;
  volInput.value = Math.round(state.masterVol * 100);
  volVal.textContent = Math.round(state.masterVol * 100);
  document.querySelectorAll("#modeToggle .chip").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === state.mode)
  );
  stepsInput.value = state.steps;
  document.getElementById("stepsVal").textContent = state.steps;
}

playBtn.addEventListener("click", () => (state.playing ? stop() : start()));

document.getElementById("clearBtn").addEventListener("click", () => {
  pushHistory();
  state.patterns[state.activeSlot] = emptyPattern();
  refreshCells();
  refreshSlotsUI();
  saveLocal();
  setStatus(`Slot ${state.activeSlot} cleared.`);
  jamBroadcast();
});

document.getElementById("randomBtn").addEventListener("click", randomize);
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);

// ---------- fill generator ----------
const fillPop = $("fillPop");
const fillTracksEl = $("fillTracks");
const fillSel = new Set(PERC_TRACKS.map((t) => t.id));

PERC_TRACKS.forEach((t) => {
  const b = document.createElement("button");
  b.className = "fill-track on";
  b.textContent = t.name;
  b.addEventListener("click", () => {
    if (fillSel.has(t.id)) fillSel.delete(t.id); else fillSel.add(t.id);
    b.classList.toggle("on", fillSel.has(t.id));
  });
  fillTracksEl.appendChild(b);
});

$("fillBtn").addEventListener("click", () => fillPop.classList.toggle("hidden"));
document.addEventListener("pointerdown", (e) => {
  if (!fillPop.classList.contains("hidden") && !fillPop.contains(e.target) && e.target.id !== "fillBtn") {
    fillPop.classList.add("hidden");
  }
});
$("fillLen").addEventListener("input", (e) => ($("fillLenVal").textContent = e.target.value));
$("fillDen").addEventListener("input", (e) => ($("fillDenVal").textContent = e.target.value));

$("fillApply").addEventListener("click", () => {
  const len = +$("fillLen").value;
  const den = +$("fillDen").value / 100;
  const pat = curPattern();
  pushHistory();

  for (const tr of PERC_TRACKS) {
    if (!fillSel.has(tr.id)) continue;
    for (let s = state.steps - len; s < state.steps; s++) {
      const r = Math.random();
      // rising density towards the last step, occasional accents
      const p = den * (0.5 + 0.5 * ((s - (state.steps - len)) / Math.max(len - 1, 1)));
      pat[tr.id][s] = r < p * 0.18 ? 2 : r < p ? 1 : 0;
    }
  }
  if (fillSel.has("bass")) {
    const scale = [0, 3, 5, 7, 10, 12];
    for (let s = state.steps - len; s < state.steps; s++) {
      if (Math.random() < den * 0.7) {
        pat.bass[s] = { on: true, semi: scale[(Math.random() * scale.length) | 0] };
      }
    }
  }
  refreshCells();
  saveLocal();
  fillPop.classList.add("hidden");
  setStatus(`Fill generated into last ${len} steps of ${state.activeSlot}.`);
  jamBroadcast();
});

function randomize() {
  pushHistory();
  const density = { kick: 0.2, snare: 0.14, clap: 0.08, hatC: 0.45, hatO: 0.08, tom: 0.08, rim: 0.1, cowbell: 0.05 };
  const pat = curPattern();
  for (const t of PERC_TRACKS) {
    pat[t.id] = pat[t.id].map((_, s) => {
      const bias = s % 4 === 0 ? 1.6 : 0.7;
      const r = Math.random();
      return r < density[t.id] * bias * 0.75 ? 1 : r < density[t.id] * bias ? 2 : 0;
    });
  }
  if (!pat.kick.some(Boolean)) pat.kick[0] = 1;
  pat.bass = pat.bass.map((b, s) => {
    if (Math.random() < 0.28 && s % 2 === 0) {
      const iv = SCALES[state.scale];
      const base = ((state.key - 9 + 12) % 12);
      const semi = base > 6 ? base - 12 : base;
      return { on: true, semi: semi + iv[(Math.random() * iv.length) | 0] + (Math.random() < 0.3 ? 12 : 0) };
    }
    return b;
  });
  pat.lead = pat.lead.map((b, s) =>
    s % 2 === 1 && Math.random() < 0.22
      ? { on: true, deg: (Math.random() * 7) | 0 }
      : b
  );
  pat.chords = pat.chords.map((b, s) =>
    s % 8 === 0 && Math.random() < 0.7
      ? { on: true, deg: (Math.random() * 7) | 0 }
      : b
  );
  refreshCells();
  refreshSlotsUI();
  saveLocal();
  setStatus("Randomized current slot.");
  jamBroadcast();
}

document.getElementById("presets").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-preset]");
  if (!btn) return;
  pushHistory();
  document.querySelectorAll("#presets .chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  loadPresetIntoActive(btn.dataset.preset);
});

function loadPresetIntoActive(name) {
  const p = PRESETS[name];
  state.bpm = p.bpm;
  state.swing = p.swing;
  const pat = emptyPattern();
  for (const [id, row] of Object.entries(p.pattern)) {
    const arr = row.split("").map(Number);
    while (arr.length < pat[id].length) arr.push(0);
    pat[id] = arr;
  }
  state.patterns[state.activeSlot] = pat;
  refreshCells();
  refreshSlotsUI();
  syncControls();
  saveLocal();
  setStatus(`Loaded "${name}" into slot ${state.activeSlot}.`);
  jamBroadcast();
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.repeat && e.target.tagName !== "INPUT") {
    e.preventDefault();
    state.playing ? stop() : start();
  }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
    e.preventDefault();
    redo();
  }
});

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ============================================================
// EXPORT WAV
// ============================================================
async function exportWav() {
  setStatus("Rendering WAV…");
  const sr = 44100;
  const sd = 60 / state.bpm / 4;

  let bars; // [{slot, auto}]
  if (state.mode === "song") {
    bars = [];
    state.song.forEach((e, i) => {
      const cur = getAuto(e);
      const prev = getAuto(state.song[(i - 1 + state.song.length) % state.song.length]);
      for (let r = 0; r < e.reps; r++) bars.push({ slot: e.slot, cur, prev, first: r === 0 });
    });
  } else {
    bars = Array.from({ length: 2 }, () => ({ slot: state.activeSlot, cur: { ...AUTO_DEFAULTS }, prev: { ...AUTO_DEFAULTS }, first: false }));
  }

  const totalSteps = bars.length * state.steps;
  const dur = bars.reduce((acc, b) => acc + state.steps * (60 / (b.cur.bpm > 0 ? b.cur.bpm : state.bpm) / 4), 1.5);

  const oc = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const eng = createEngine(oc);
  eng.master.gain.value = state.masterVol;

  const lerp = (a, b, f) => a + (b - a) * f;
  const h = state.humanize / 100;
  let t = 0.05;
  bars.forEach((bar) => {
    const barBpm = bar.cur.bpm > 0 ? bar.cur.bpm : state.bpm;
    const sd = 60 / barBpm / 4;
    const f = bar.first ? 1 : 1; // constant per bar in export
    eng.setMacro(lerp(bar.prev.cutoff, bar.cur.cutoff, f), lerp(bar.prev.rev, bar.cur.rev, f), lerp(bar.prev.dly, bar.cur.dly, f));
    const pat = state.patterns[bar.slot];
    for (let s = 0; s < state.steps; s++) {
      const time = t + s * sd;
      const sw = s % 2 === 1 ? (state.swing / 100) * sd : 0;
      const humT = () => (Math.random() * 2 - 1) * h * 0.012;
      const humV = () => 1 - Math.random() * h * 0.35;
      for (const tr of PERC_TRACKS) {
        const v = pat[tr.id][s];
        if (v) eng.trigger(tr.id, time + sw + humT(), v, humV());
      }
      const b = pat.bass[s];
      if (b.on) {
        let len = sd;
        for (let k = 1; k < state.steps; k++) {
          if (pat.bass[(s + k) % state.steps].on) { len = k * sd; break; }
        }
        eng.bass(time + sw + humT(), BASS_ROOT_MIDI + b.semi, len, (b.semi % 12 === 0 ? 1.0 : 0.8) * humV());
      }
      const ld = pat.lead[s];
      if (ld.on) {
        let len = sd;
        for (let k = 1; k < state.steps; k++) {
          if (pat.lead[(s + k) % state.steps].on) { len = k * sd; break; }
        }
        eng.lead(time + sw + humT(), leadMidi(ld.deg), len, humV());
      }
      const ch = pat.chords[s];
      if (ch.on) {
        let len = sd;
        for (let k = 1; k < state.steps; k++) {
          if (pat.chords[(s + k) % state.steps].on) { len = k * sd; break; }
        }
        eng.chords(time + sw, chordMidis(ch.deg), len, humV());
      }
    }
    t += state.steps * sd;
  });

  const rendered = await oc.startRendering();
  const blob = new Blob([CORE.audioBufferToWav(rendered)], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `thump-${Date.now()}.wav`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("WAV exported.");
}

document.getElementById("exportWavBtn").addEventListener("click", exportWav);

// ---------- project save/load (JSON file) ----------
document.getElementById("saveProjBtn").addEventListener("click", () => {
  const data = {
    ...serialize(),
    tracks: Object.fromEntries([...PERC_TRACKS, ...MELODIC_TRACKS].map((t) => [t.id, { vol: t.vol, mute: t.mute, rev: t.rev, dly: t.dly }])),
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `thump-project-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Project saved to file.");
});

const projFile = document.getElementById("projFile");
document.getElementById("loadProjBtn").addEventListener("click", () => projFile.click());
projFile.addEventListener("change", () => {
  const file = projFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      pushHistory();
      if (!deserialize(d)) throw new Error("unrecognized project format");
      if (d.tracks) {
        for (const t of [...PERC_TRACKS, ...MELODIC_TRACKS]) {
          if (d.tracks[t.id]) {
            t.vol = d.tracks[t.id].vol ?? t.vol;
            t.mute = !!d.tracks[t.id].mute;
            t.rev = d.tracks[t.id].rev ?? t.rev;
            t.dly = d.tracks[t.id].dly ?? t.dly;
          }
        }
      }
      buildGrid();
      refreshCells();
      refreshRowLabels();
      refreshSlotsUI();
      buildChain();
      syncControls();
      saveLocal();
      setStatus(`Project "${file.name}" loaded.`);
    } catch (err) {
      setStatus(`Load failed: ${err.message}`);
    }
    projFile.value = "";
  };
  reader.readAsText(file);
});

// ============================================================
// SHARE / GALLERY
// ============================================================
document.getElementById("shareBtn").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/patterns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: document.getElementById("shareTitle").value,
        author: document.getElementById("shareAuthor").value,
        data: serialize(),
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const { id } = await res.json();
    const link = `${location.origin}/?p=${id}`;
    try { await navigator.clipboard.writeText(link); setStatus(`Shared! Link copied: ${link}`); }
    catch (_) { setStatus(`Shared! Link: ${link}`); }
  } catch (err) {
    setStatus(`Share failed: ${err.message}`);
  }
});

async function loadFromServer(id) {
  try {
    const res = await fetch(`/api/patterns/${id}`);
    if (!res.ok) throw new Error("not found");
    const p = await res.json();
    pushHistory();
    if (deserialize(p.data)) {
      buildGrid();
      refreshCells();
      refreshSlotsUI();
      buildChain();
      syncControls();
      saveLocal();
      setStatus(`Loaded "${p.title}" by ${p.author}.`);
    } else {
      setStatus("Invalid pattern data.");
    }
  } catch (err) {
    setStatus(`Load failed: ${err.message}`);
  }
}

const modal = $("modal");
document.getElementById("galleryBtn").addEventListener("click", async () => {
  modal.classList.remove("hidden");
  const list = $("galleryList");
  list.innerHTML = `<div class="gal-empty">Loading…</div>`;
  try {
    const res = await fetch("/api/patterns");
    const items = await res.json();
    if (!items.length) {
      list.innerHTML = `<div class="gal-empty">Gallery is empty — be the first to share!</div>`;
      return;
    }
    list.innerHTML = "";
    items.forEach((it) => {
      const el = document.createElement("div");
      el.className = "gal-item";
      el.innerHTML =
        `<div><div class="g-title"></div><div class="g-meta"></div></div>` +
        `<div class="grow"></div>` +
        `<button class="btn chip like-btn">♥ <span>${it.likes}</span></button>` +
        `<button class="btn chip load-btn">Load</button>`;
      el.querySelector(".g-title").textContent = it.title;
      el.querySelector(".g-meta").textContent = `${it.author} · ${it.created_at}`;
      el.querySelector(".like-btn").addEventListener("click", async (e) => {
        const r = await fetch(`/api/patterns/${it.id}/like`, { method: "POST" });
        const j = await r.json();
        e.currentTarget.querySelector("span").textContent = j.likes ?? "?";
      });
      el.querySelector(".load-btn").addEventListener("click", () => {
        modal.classList.add("hidden");
        location.href = `/?p=${it.id}`;
      });
      list.appendChild(el);
    });
  } catch (err) {
    list.innerHTML = `<div class="gal-empty">Failed to load gallery: ${err.message}</div>`;
  }
});
$("modalClose").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden");
});

// ============================================================
// JAM ROOMS
// ============================================================
let ws = null;
let myClientId = null;
let syncTimer = null;
let applyingRemote = false;

function joinRoom(name) {
  leaveRoom(true);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws?room=${encodeURIComponent(name)}`);
  ws.onopen = () => {
    document.getElementById("jamDot").classList.add("on");
    document.getElementById("joinBtn").textContent = "Leave";
    document.getElementById("joinBtn").classList.add("joined");
    setStatus(`Joined room "${name}".`);
  };
  ws.onclose = () => resetJamUI(`Left room.`);
  ws.onerror = () => resetJamUI("Jam connection error.");
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (msg.type === "hello") {
      myClientId = msg.clientId;
      setStatus(`In room "${name}" — ${msg.members} musician${msg.members === 1 ? "" : "s"} online.`);
      jamBroadcast();
      return;
    }
    if (msg.type === "sync" && msg.from !== myClientId && msg.state) {
      applyingRemote = true;
      try {
        if (deserialize(msg.state)) {
          refreshCells();
          refreshSlotsUI();
          buildChain();
          syncControls();
          saveLocal();
        }
      } finally {
        applyingRemote = false;
      }
    }
  };
}

function leaveRoom(quiet) {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (!quiet) resetJamUI("Left room.");
}

function resetJamUI(msg) {
  document.getElementById("jamDot").classList.remove("on");
  const jb = document.getElementById("joinBtn");
  jb.textContent = "Join";
  jb.classList.remove("joined");
  if (msg) setStatus(msg);
}

function jamBroadcast() {
  if (!ws || ws.readyState !== WebSocket.OPEN || applyingRemote) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "sync", state: serialize() }));
    }
  }, 300);
}

document.getElementById("joinBtn").addEventListener("click", () => {
  if (ws) { leaveRoom(); return; }
  joinRoom(document.getElementById("roomName").value.trim() || "lobby");
});

// ============================================================
// INIT
// ============================================================
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// global error toast
window.addEventListener("error", (e) => toast(`Error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => toast(`Error: ${e.reason}`));

let toastTimer = null;
function toast(msg) {
  let el = document.getElementById("errToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "errToast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 5000);
}

buildGrid();
buildSlotsBar();
buildChain();
syncControls();

(function init() {
  const params = new URLSearchParams(location.search);
  if (params.get("p")) {
    loadFromServer(params.get("p"));
    window.history.replaceState(null, "", "/");
    return;
  }
  if (!restoreLocal()) {
    loadPresetIntoActive("house");
    return;
  }
  buildGrid();
  refreshCells();
  refreshSlotsUI();
})();

// keep remote/local sync flowing on edits
["pointerdown", "change"].forEach((ev) =>
  document.body.addEventListener(ev, () => jamBroadcast(), true)
);
