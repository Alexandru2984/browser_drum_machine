const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
  .replace(/<script src="core.js"><\/script>/, "")
  .replace(/<script src="app.js"><\/script>/, "");

const dom = new JSDOM(html, { url: "http://localhost:3000/", pretendToBeVisual: true, runScripts: "outside-only" });
const { window } = dom;

// ---- stubs for browser APIs jsdom lacks ----
window.AudioContext = class {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
    this._nodes = 0;
  }
  resume() {}
  createGain() { return this._paramNode(); }
  createOscillator() {
    const n = this._paramNode();
    n.type = "sine";
    n.start = () => {}; n.stop = () => {};
    return n;
  }
  createBiquadFilter() {
    const n = this._paramNode();
    n.type = "lowpass"; n.Q = { value: 0 };
    return n;
  }
  createDynamicsCompressor() {
    const n = this._paramNode();
    ["threshold","knee","ratio","attack","release"].forEach(p => n[p] = { value: 0 });
    return n;
  }
  createBufferSource() { const self = { buffer: null, start(){}, stop(){}, connect(dest){ return dest; } }; return self; }
  createConvolver() { return { buffer: null, connect(dest){ return dest; } }; }
  createDelay(t) { return { delayTime: this._audioParam(), connect(dest){ return dest; } }; }
  createAnalyser() { return { fftSize: 0, frequencyBinCount: 128, getByteFrequencyData() {}, connect(d){ return d; } }; }
  createBuffer(ch, len, sr) {
    return { getChannelData: () => new Float32Array(len), numberOfChannels: ch, length: len, sampleRate: sr };
  }
  _paramNode() {
    const param = () => ({ value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){}, setTargetAtTime(){} });
    return { gain: param(), frequency: param(), detune: param(), connect(dest) { return dest; } };
  }
  _audioParam() {
    return { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} };
  }
};
window.OfflineAudioContext = window.AudioContext;
window.URL.createObjectURL = () => "blob:x";
window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;
// jsdom has no canvas backend — stub 2d context
window.HTMLCanvasElement.prototype.getContext = () => ({
  clearRect() {},
  fillRect() {},
  set fillStyle(_) {},
  set globalAlpha(_) {},
});

const errors = [];
window.addEventListener("error", (e) => errors.push(e.error ? e.error.stack : e.message));

// run the app
const coreCode = fs.readFileSync(path.join(ROOT, "core.js"), "utf8");
const code = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
try {
  window.eval(coreCode);
  window.eval(code);
} catch (e) {
  console.log("INIT FAILED:", e.stack);
  process.exit(1);
}
console.log("init: OK");

// exercise interactions
const doc = window.document;
const fire = (el, type, init = {}) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...init }));

function clickAll(sel, label, extraInit) {
  doc.querySelectorAll(sel).forEach((el) => {
    try { fire(el, "pointerdown", extraInit); fire(el, "click"); fire(el, "pointerup"); }
    catch (e) { errors.push(`${label}[${el.dataset?.track || el.textContent}]: ${e.stack}`); }
  });
}

try {
  // toggle a bunch of cells (perc + bass), with and without shift
  clickAll(".cell", "cell", {});
  clickAll(".cell", "cell-shift", { shiftKey: true });
  // mute buttons
  clickAll(".mute-btn", "mute");
  // copy/paste rows
  clickAll(".copy-btn", "copy");
  // slots select + copy
  clickAll(".slot", "slot");
  // mode toggle, presets, chain add/clear
  clickAll("#modeToggle .chip", "mode");
  clickAll("#presets .chip", "preset");
  fire(doc.getElementById("chainAdd"), "click");
  fire(doc.getElementById("chainAdd"), "click");
  fire(doc.getElementById("chainClear"), "click");
  // undo/redo
  fire(doc.getElementById("undoBtn"), "click");
  fire(doc.getElementById("redoBtn"), "click");
  // randomize / clear
  fire(doc.getElementById("randomBtn"), "click");
  fire(doc.getElementById("clearBtn"), "click");
  console.log("interactions: OK");
} catch (e) {
  errors.push("interactions: " + e.stack);
}

// PLAY — the one that broke
try {
  // tabs navigation
  doc.querySelectorAll("#tabs button").forEach((b) => fire(b, "click"));
  if (!doc.getElementById("viewShare").classList.contains("active")) {
    errors.push("tabs: share view not active after clicking all tabs");
  }
  fire(doc.querySelector('#tabs [data-view="grid"]'), "click");
  if (!doc.getElementById("viewGrid").classList.contains("active")) {
    errors.push("tabs: grid view not active after switching back");
  }
  // mixer: mute/solo toggles + master slider
  clickAll(".mix-mute", "mix-mute");
  clickAll(".mix-solo", "mix-solo");
  const masterSlider = doc.querySelector(".mix-master");
  masterSlider.value = 50;
  masterSlider.dispatchEvent(new window.Event("input", { bubbles: true }));
  // mobile transport + tap tempo + metronome toggle
  fire(doc.getElementById("mBpmUp"), "click");
  fire(doc.getElementById("mBpmDown"), "click");
  fire(doc.getElementById("tapBtn"), "click");
  fire(doc.getElementById("metroChk"), "click");
  // timeline: add entries, open automation, remove via contextmenu
  fire(doc.getElementById("chainAdd"), "click");
  fire(doc.getElementById("chainAdd"), "click");
  const blocks = doc.querySelectorAll(".tl-block");
  if (blocks.length !== 3) errors.push(`timeline: expected 3 blocks, got ${blocks.length}`);
  fire(blocks[0], "click");
  if (doc.getElementById("autoPop").classList.contains("hidden")) errors.push("timeline: auto popover did not open");
  fire(blocks[2], "contextmenu");
  if (doc.querySelectorAll(".tl-block").length !== 2) errors.push("timeline: contextmenu did not remove block");
  fire(doc.getElementById("chainClear"), "click");

  // steps input 16 → 32 → 64 → back
  const stepsInput = doc.getElementById("stepsInput");
  const setSteps = (n) => {
    stepsInput.value = n;
    stepsInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  setSteps(32);
  const cells32 = doc.querySelectorAll(`.cell[data-step="31"]`).length;
  if (cells32 !== 14) errors.push(`steps input: expected 14 cells at step 31, got ${cells32}`);
  setSteps(64);
  const cells64 = doc.querySelectorAll(`.cell[data-step="63"]`).length;
  if (cells64 !== 14) errors.push(`steps input: expected 14 cells at step 63, got ${cells64}`);
  setSteps(32);
  fire(doc.getElementById("randomBtn"), "click");
  setSteps(16);
  // live drum keys + recording toggle
  fire(doc.getElementById("recBtn"), "click");
  fire(doc.getElementById("playBtn"), "click");
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", bubbles: true, cancelable: true }));
  fire(doc.getElementById("playBtn"), "click");
  fire(doc.getElementById("recBtn"), "click");
  // arp + progression + copy link + help
  fire(doc.getElementById("arpBtn"), "click");
  fire(doc.getElementById("progBtn"), "click");
  fire(doc.getElementById("copyLinkBtn"), "click");
  fire(doc.getElementById("helpBtn"), "click");
  fire(doc.getElementById("playBtn"), "click");
  setTimeout(() => {
    fire(doc.getElementById("playBtn"), "click"); // stop
    if (errors.length) {
      console.log("ERRORS:\n" + errors.join("\n---\n"));
      process.exit(1);
    } else {
      console.log("play/stop cycle: OK");
      console.log("ALL SMOKE TESTS PASSED");
      process.exit(0);
    }
  }, 400);
} catch (e) {
  console.log("PLAY FAILED:", e.stack);
  process.exit(1);
}
