"use strict";

// Regression: loading old saved data (pre lead/chords tracks, arbitrary
// step count) must not crash the app on hard refresh.
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function bootAppWithStorage(storage) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
    .replace(/<script src="core.js"><\/script>/, "")
    .replace(/<script src="app.js"><\/script>/, "");
  const dom = new JSDOM(html, { url: "http://localhost:3000/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;

  window.AudioContext = class {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    resume() {}
    createGain() { return this._n(); }
    createOscillator() { const n = this._n(); n.type = "sine"; n.start = () => {}; n.stop = () => {}; return n; }
    createBiquadFilter() { const n = this._n(); n.type = "lowpass"; n.Q = { value: 0 }; return n; }
    createDynamicsCompressor() { const n = this._n(); ["threshold", "knee", "ratio", "attack", "release"].forEach((p) => (n[p] = { value: 0 })); return n; }
    createConvolver() { return { buffer: null, connect(d) { return d; } }; }
    createDelay() { return { delayTime: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} }, connect(d) { return d; } }; }
    createBufferSource() { return { buffer: null, start() {}, stop() {}, connect(d) { return d; } }; }
    createBuffer(c, l, s) { return { getChannelData: () => new Float32Array(l), numberOfChannels: c, length: l, sampleRate: s }; }
    _n() {
      const p = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
      return { gain: p(), frequency: p(), detune: p(), connect(d) { return d; } };
    }
  };
  window.OfflineAudioContext = window.AudioContext;
  window.URL.createObjectURL = () => "blob:x";

  if (storage) window.localStorage.setItem("thump-v2", JSON.stringify(storage));

  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.error ? e.error.message : String(e.message)));

  window.eval(fs.readFileSync(path.join(ROOT, "core.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
  return { window, dom, errors };
}

test("old saved data without lead/chords and with 53 steps loads cleanly", () => {
  // format saved by thump before the melodic tracks existed
  const perc = {};
  for (const id of ["kick", "snare", "clap", "hatC", "hatO", "tom", "rim", "cowbell"]) {
    perc[id] = new Array(53).fill(0);
  }
  perc.kick[0] = 1;
  const storage = {
    v: 2,
    bpm: 124,
    swing: 12,
    steps: 53,
    mode: "pattern",
    activeSlot: "A",
    song: ["A"],
    patterns: { A: { ...perc, bass: new Array(53).fill(0).map(() => ({ on: false, semi: 0 })) } },
    // slots B, C, D entirely missing (old bug crashed here)
  };

  const { window, dom, errors } = bootAppWithStorage(storage);
  try {
    assert.deepEqual(errors, [], `console errors: ${errors.join("; ")}`);

  // every slot must be resized to 53 steps
  const st = window.__THUMP_STATE;
  for (const slot of ["A", "B", "C", "D"]) {
    for (const row of ["kick", "bass", "lead", "chords"]) {
      assert.equal(st.patterns[slot][row].length, 53, `${slot}.${row}`);
    }
  }
    // grid rendered 53 columns of 14 rows without crashing
    assert.equal(window.document.querySelectorAll('.cell[data-step="52"]').length, 14);
  } finally {
    dom.window.close();
  }
});

test("corrupt saved data falls back to defaults without crashing", () => {
  const { errors, dom } = bootAppWithStorage({ v: 2, patterns: "garbage" });
  try {
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
  }
});

test("empty storage boots with defaults", () => {
  const { window, errors, dom } = bootAppWithStorage(null);
  try {
    assert.deepEqual(errors, []);
    assert.equal(window.document.querySelectorAll(".cell").length > 0, true);
  } finally {
    dom.window.close();
  }
});
