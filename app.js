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
const volInput = $("vol");
const volVal = $("volVal");
const slotBtnsEl = $("slotBtns");
const chainEl = $("chain");

// ---------- data ----------
const SLOTS = ["A", "B", "C", "D"];
const MIN_STEPS = 4;
const MAX_STEPS = 64;
const STORAGE_KEY = "thump-v2";
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BASS_ROOT_MIDI = 33; // A1

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
  const p = {};
  for (const t of PERC_TRACKS) p[t.id] = new Array(steps).fill(0); // 0 off | 1 on | 2 accent
  p.bass = Array.from({ length: steps }, () => ({ on: false, semi: 0 }));
  return p;
}

const state = {
  playing: false,
  bpm: 124,
  swing: 12,
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
  while (p.bass.length < steps) p.bass.push({ on: false, semi: 0 });
  p.bass = p.bass.slice(0, steps);
}

// ---------- persistence ----------
function serialize() {
  return {
    v: 2,
    bpm: state.bpm,
    swing: state.swing,
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
    state.steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, +d.steps || 16));
    state.mode = d.mode === "song" ? "song" : "pattern";
    state.activeSlot = SLOTS.includes(d.activeSlot) ? d.activeSlot : "A";
    state.song = Array.isArray(d.song) && d.song.length ? normalizeSong(d.song) : [{ slot: state.activeSlot, reps: 1 }];
    for (const s of SLOTS) {
      const sp = d.patterns[s];
      if (!sp) continue;
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
    }
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeSong(song) {
  // accepts ["A","B"] or [{slot:"A",reps:2}] → [{slot,reps}]
  return song
    .map((e) => (typeof e === "string" ? { slot: e, reps: 1 } : { slot: SLOTS.includes(e.slot) ? e.slot : "A", reps: Math.max(1, Math.min(16, +e.reps || 1)) }))
    .filter((e) => SLOTS.includes(e.slot))
    .slice(0, 64);
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...serialize(),
      tracks: Object.fromEntries([...PERC_TRACKS, BASS_TRACK].map((t) => [t.id, { vol: t.vol, mute: t.mute, rev: t.rev, dly: t.dly }])),
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
      for (const t of [...PERC_TRACKS, BASS_TRACK]) {
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
function normalizeSong(song) {
  // accepts ["A","B"] or [{slot:"A",reps:2}] → [{slot,reps}] (song v2)
  return song
    .map((e) => (typeof e === "string" ? { slot: e, reps: 1 } : { slot: SLOTS.includes(e.slot) ? e.slot : "A", reps: Math.max(1, Math.min(16, +e.reps || 1)) }))
    .filter((e) => SLOTS.includes(e.slot))
    .slice(0, 64);
}

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
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(ac.destination);
  master.connect(comp);

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
  for (const t of [...PERC_TRACKS, BASS_TRACK]) {
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
    const tr = [...PERC_TRACKS, BASS_TRACK].find((x) => x.id === id);
    sends[id].rev.gain.setTargetAtTime(tr.rev / 100, ac.currentTime, 0.02);
    sends[id].dly.gain.setTargetAtTime(tr.dly / 100, ac.currentTime, 0.02);
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

  function trigger(id, tt, value) {
    const tr = [...PERC_TRACKS, BASS_TRACK].find((x) => x.id === id);
    if (tr && tr.mute) return;
    const v = value >= 2 ? 1.0 : 0.72;
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

  return { ac, master, gains, trigger, bass, setDelayTime, updateSends };
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
  const tr = [...PERC_TRACKS, BASS_TRACK].find((x) => x.id === id);
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

  for (const tr of PERC_TRACKS) {
    const val = pat[tr.id][step];
    if (!val) continue;
    const swingOffset = step % 2 === 1 ? (state.swing / 100) * sd : 0;
    engine.trigger(tr.id, time + swingOffset, val);
    scheduleVisual(slot, tr.id, step, time + swingOffset);
  }

  const b = pat.bass[step];
  if (b.on) {
    const swingOffset = step % 2 === 1 ? (state.swing / 100) * sd : 0;
    let len = sd;
    for (let k = 1; k < state.steps; k++) {
      if (pat.bass[(step + k) % state.steps].on) { len = k * sd; break; }
    }
    const midi = BASS_ROOT_MIDI + b.semi;
    engine.bass(time + swingOffset, midi, len, b.semi % 12 === 0 ? 1.0 : 0.8);
    scheduleVisual(slot, "bass", step, time + swingOffset);
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
  document.querySelectorAll(".cell.playhead").forEach((c) => c.classList.remove("playhead"));
  document.querySelectorAll(".chain-chip.now").forEach((c) => c.classList.remove("now"));
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

function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function buildGrid() {
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `170px repeat(${state.steps}, minmax(14px, 1fr))`;
  const rows = [...PERC_TRACKS.map((t) => ({ ...t, kind: "perc" })), { ...BASS_TRACK, kind: "bass" }];

  rows.forEach((tr) => {
    const label = document.createElement("div");
    label.className = "row-label" + (tr.mute ? " muted" : "");
    label.dataset.track = tr.id;
    label.innerHTML =
      `<div class="row-head"><span class="row-name">${tr.name}</span><small>${tr.kind === "bass" ? "acid" : tr.note}</small></div>` +
      `<div class="row-tools">` +
      `<button class="mute-btn${tr.mute ? " active" : ""}" data-track="${tr.id}" title="Mute">M</button>` +
      `<input type="range" class="row-vol" data-track="${tr.id}" min="0" max="100" value="${tr.vol}" title="Volume" />` +
      `<input type="range" class="row-fx" data-track="${tr.id}" data-fx="rev" min="0" max="100" value="${tr.rev}" title="Reverb send" />` +
      `<input type="range" class="row-fx" data-track="${tr.id}" data-fx="dly" min="0" max="100" value="${tr.dly}" title="Delay send" />` +
      `<button class="copy-btn" data-track="${tr.id}" title="Click: copy row · Right-click: paste">⧉</button>` +
      `</div>`;
    grid.appendChild(label);

    for (let s = 0; s < state.steps; s++) {
      const cell = document.createElement("div");
      cell.className = "cell" + (s % 4 === 0 ? " beat-mark" : "") + (tr.kind === "bass" ? " bass-cell" : "");
      cell.dataset.track = tr.id;
      cell.dataset.step = s;
      cell.addEventListener("pointerdown", (e) => onCellDown(e, tr, s, cell));
      cell.addEventListener("wheel", (e) => {
        if (tr.kind !== "bass") return;
        e.preventDefault();
        onBassWheel(e.deltaY, s);
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
      const tr = [...PERC_TRACKS, BASS_TRACK].find((x) => x.id === vol.dataset.track);
      tr.vol = +vol.value;
      updateTrackGain(tr.id);
      saveLocal();
      return;
    }
    const fx = e.target.closest(".row-fx");
    if (fx) {
      const tr = [...PERC_TRACKS, BASS_TRACK].find((x) => x.id === fx.dataset.track);
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
      const tr = [...PERC_TRACKS, BASS_TRACK].find((x) => x.id === btn.dataset.track);
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

  if (tr.kind === "bass") {
    if (e.shiftKey) return; // shift+wheel reserved
    const b = curPattern().bass[s];
    b.on = !b.on;
    paintCell(cell, tr.id, s);
    if (b.on) previewBass(s);
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

function onBassWheel(deltaY, s) {
  ensureAudio();
  pushHistory();
  const b = curPattern().bass[s];
  if (!b.on) { b.on = true; }
  b.semi = Math.max(-24, Math.min(24, b.semi + (deltaY < 0 ? 1 : -1)));
  refreshCells();
  previewBass(s);
  saveLocal();
}

function previewBass(s) {
  const b = curPattern().bass[s];
  engine.bass(engine.ac.currentTime + 0.01, BASS_ROOT_MIDI + b.semi, 0.3, 0.9);
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
  if (trackId === "bass") {
    const b = pat.bass[step];
    cell.classList.toggle("on", b.on);
    cell.classList.toggle("acc", b.on && b.semi % 12 === 0);
    let tag = cell.querySelector(".note-tag");
    if (b.on) {
      if (!tag) { tag = document.createElement("span"); tag.className = "note-tag"; cell.appendChild(tag); }
      tag.textContent = noteName(BASS_ROOT_MIDI + b.semi);
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
    const tr = [...PERC_TRACKS, BASS_TRACK].find((x) => x.id === id);
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
  rowClipboard =
    trackId === "bass"
      ? { trackId: "bass", values: pat.bass.map((b) => ({ ...b })) }
      : { trackId, values: [...pat[trackId]] };
  Object.values(clipBtns).forEach((b) => b.classList.remove("clipboard"));
  btn.classList.add("clipboard");
  setStatus(`${trackId} row copied — right-click ⧉ on another row to paste.`);
}

function pasteRow(targetTrack) {
  if (!rowClipboard) return setStatus("Clipboard empty — click ⧉ on a row first.");
  pushHistory();
  const pat = curPattern();
  const fixLen = (arr, fill) => {
    const out = arr.slice(0, state.steps);
    while (out.length < state.steps) out.push(typeof fill === "function" ? fill() : fill);
    return out;
  };
  if (rowClipboard.trackId === "bass") {
    if (targetTrack !== "bass") {
      pat[targetTrack] = fixLen(rowClipboard.values.map((b) => (b.on ? 1 : 0)), 0);
    } else {
      pat.bass = fixLen(rowClipboard.values.map((b) => ({ ...b })), () => ({ on: false, semi: 0 }));
    }
  } else if (targetTrack === "bass") {
    pat.bass = fixLen(rowClipboard.values.map((v) => ({ on: !!v, semi: 0 })), () => ({ on: false, semi: 0 }));
  } else {
    pat[targetTrack] = fixLen(rowClipboard.values, 0);
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
  return !PERC_TRACKS.some((t) => p[t.id].some(Boolean)) && !p.bass.some((b) => b.on);
}

function buildChain() {
  chainEl.innerHTML = "";
  state.song.forEach((entry, i) => {
    const chip = document.createElement("button");
    chip.className = "chain-chip";
    chip.textContent = entry.reps > 1 ? `${entry.slot}·${entry.reps}` : entry.slot;
    chip.title = "Click: remove · Wheel: repeats (1–16)";
    chip.addEventListener("click", () => {
      pushHistory();
      state.song.splice(i, 1);
      if (!state.song.length) state.song = [{ slot: state.activeSlot, reps: 1 }];
      buildChain();
      saveLocal();
      jamBroadcast();
    });
    chip.addEventListener("wheel", (e) => {
      e.preventDefault();
      pushHistory();
      entry.reps = Math.max(1, Math.min(16, entry.reps + (e.deltaY < 0 ? 1 : -1)));
      buildChain();
      saveLocal();
      jamBroadcast();
    }, { passive: false });
    chainEl.appendChild(chip);
  });
}

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
  document.querySelectorAll(".chain-chip").forEach((c, i) => c.classList.toggle("now", i === idx));
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
    const scale = [0, 3, 5, 7, 10];
    if (Math.random() < 0.28 && s % 2 === 0) {
      return { on: true, semi: scale[(Math.random() * scale.length) | 0] };
    }
    return b;
  });
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

  let sequence; // array of slots
  if (state.mode === "song") sequence = state.song.flatMap((e) => Array(e.reps).fill(e.slot));
  else sequence = new Array(2).fill(state.activeSlot); // 2 loops

  const totalSteps = sequence.length * state.steps;
  const dur = totalSteps * sd + 1.5;

  const oc = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const eng = createEngine(oc);
  eng.master.gain.value = state.masterVol;

  let t = 0.05;
  sequence.forEach((slot, seqIdx) => {
    const pat = state.patterns[slot];
    for (let s = 0; s < state.steps; s++) {
      const time = t + s * sd;
      const sw = s % 2 === 1 ? (state.swing / 100) * sd : 0;
      for (const tr of PERC_TRACKS) {
        const v = pat[tr.id][s];
        if (v) eng.trigger(tr.id, time + sw, v);
      }
      const b = pat.bass[s];
      if (b.on) {
        let len = sd;
        for (let k = 1; k < state.steps; k++) {
          if (pat.bass[(s + k) % state.steps].on) { len = k * sd; break; }
        }
        eng.bass(time + sw, BASS_ROOT_MIDI + b.semi, len, 0.9);
      }
    }
    t += state.steps * sd;
  });

  const rendered = await oc.startRendering();
  const blob = audioBufferToWav(rendered);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `thump-${Date.now()}.wav`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus("WAV exported.");
}

function audioBufferToWav(buf) {
  const numCh = buf.numberOfChannels;
  const len = buf.length;
  const bytes = 44 + len * numCh * 2;
  const ab = new ArrayBuffer(bytes);
  const view = new DataView(ab);
  const w = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

  w(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  w(8, "WAVE");
  w(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  w(36, "data");
  view.setUint32(40, len * numCh * 2, true);

  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

document.getElementById("exportWavBtn").addEventListener("click", exportWav);

// ---------- project save/load (JSON file) ----------
document.getElementById("saveProjBtn").addEventListener("click", () => {
  const data = {
    ...serialize(),
    tracks: Object.fromEntries([...PERC_TRACKS, BASS_TRACK].map((t) => [t.id, { vol: t.vol, mute: t.mute, rev: t.rev, dly: t.dly }])),
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
        for (const t of [...PERC_TRACKS, BASS_TRACK]) {
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
