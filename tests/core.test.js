"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const CORE = require("../core.js");

const { noteName, scaleMidi, leadMidi, chordMidis, normalizeSong, sanitizeAuto, getAuto, hasAuto, emptyPattern, resizePattern, audioBufferToWav, MIN_STEPS, MAX_STEPS } = CORE;

// ---------- noteName ----------
test("noteName renders naturals and octaves", () => {
  assert.equal(noteName(60), "C4");
  assert.equal(noteName(69), "A4");
  assert.equal(noteName(33), "A1");
  assert.equal(noteName(21), "A0");
});

test("noteName handles accidentals", () => {
  assert.equal(noteName(61), "C#4");
  assert.equal(noteName(70), "A#4");
});

// ---------- scaleMidi ----------
test("scaleMidi walks the minor scale", () => {
  // key C (0), minor: [0,2,3,5,7,8,10]
  assert.equal(scaleMidi(0, 0, "minor"), 0);
  assert.equal(scaleMidi(1, 0, "minor"), 2);
  assert.equal(scaleMidi(2, 0, "minor"), 3);
  assert.equal(scaleMidi(6, 0, "minor"), 10);
  assert.equal(scaleMidi(7, 0, "minor"), 12, "degree 7 = octave up");
  assert.equal(scaleMidi(14, 0, "minor"), 24, "degree 14 = two octaves");
});

test("scaleMidi handles negative degrees", () => {
  assert.equal(scaleMidi(-1, 0, "minor"), -2, "one scale step below root");
  assert.equal(scaleMidi(-7, 0, "minor"), -12, "octave below");
});

test("scaleMidi respects key offset", () => {
  assert.equal(scaleMidi(0, 9, "minor"), 9, "key A");
  assert.equal(scaleMidi(3, 9, "minor"), 14, "A minor third degree = D");
});

test("scaleMidi falls back to minor for unknown scale", () => {
  assert.equal(scaleMidi(2, 0, "nonexistent"), 3);
});

// ---------- lead / chords ----------
test("leadMidi sits two octaves above bass root, in key", () => {
  assert.equal(leadMidi(0, 0, "minor"), 57, "key C → A3");
  assert.equal(leadMidi(0, 9, "minor"), 66, "key A → +9 semitones");
});

test("chordMidis builds a diatonic triad", () => {
  // A minor: degrees 0,2,4 = A, C, E → midi 45+9=54? no: CHORD_BASE 45 + key 9 = 54 (F#3)? verify math
  const [a, b, c] = chordMidis(0, 9, "minor");
  assert.equal(a, 45 + 9);
  assert.equal(b, 45 + 12);
  assert.equal(c, 45 + 16);
});

test("chordMidis wraps across scale length", () => {
  // CHORD_BASE 45 + degrees 6, 8(=7+1), 10(=7+3) in minor → 45+[10,14,17]
  const [a, b, c] = chordMidis(6, 0, "minor");
  assert.equal(a, 55);
  assert.equal(b, 59);
  assert.equal(c, 62);
});

// ---------- song normalization ----------
test("normalizeSong converts string entries", () => {
  const song = normalizeSong(["A", "B"]);
  assert.deepEqual(song, [
    { slot: "A", reps: 1, auto: undefined },
    { slot: "B", reps: 1, auto: undefined },
  ]);
});

test("normalizeSong clamps reps and filters bad slots", () => {
  const song = normalizeSong([
    { slot: "A", reps: 99 },
    { slot: "Z", reps: 2 },
    { slot: "C", reps: -5 },
  ]);
  assert.deepEqual(song.map((e) => [e.slot, e.reps]), [["A", 16], ["C", 1]]);
});

test("normalizeSong caps length at 64", () => {
  const song = normalizeSong(Array.from({ length: 100 }, () => "A"));
  assert.equal(song.length, 64);
});

test("normalizeSong sanitizes automation", () => {
  const song = normalizeSong([{ slot: "A", reps: 1, auto: { cutoff: 999, rev: -3, dly: "0.5", bpm: 999 } }]);
  assert.deepEqual(song[0].auto, { cutoff: 1, rev: 0, dly: 0.5, bpm: 200 });
});

// ---------- automation ----------
test("sanitizeAuto clamps to valid ranges", () => {
  assert.equal(sanitizeAuto({ cutoff: 0.01 }).cutoff, 0.05);
  assert.equal(sanitizeAuto({ rev: 5 }).rev, 2);
  assert.equal(sanitizeAuto({ bpm: 10 }).bpm, 60);
  assert.equal(sanitizeAuto({ bpm: "abc" }).bpm, 0);
  assert.equal(sanitizeAuto({ rev: 0 }).rev, 0, "explicit zero must be preserved");
});

test("getAuto merges defaults", () => {
  assert.deepEqual(getAuto({ auto: { cutoff: 0.5 } }), { cutoff: 0.5, rev: 1, dly: 1, bpm: 0 });
  assert.deepEqual(getAuto(undefined), { cutoff: 1, rev: 1, dly: 1, bpm: 0 });
  assert.deepEqual(getAuto(null), { cutoff: 1, rev: 1, dly: 1, bpm: 0 });
});

test("hasAuto detects only meaningful overrides", () => {
  assert.equal(hasAuto({ auto: { cutoff: 1, rev: 1, dly: 1, bpm: 0 } }), false);
  assert.equal(hasAuto({ auto: { cutoff: 0.4 } }), true);
  assert.equal(hasAuto({ auto: { bpm: 140 } }), true);
  assert.equal(hasAuto({}), false);
  assert.equal(hasAuto(null), false);
});

// ---------- patterns ----------
test("emptyPattern creates melodic steps of correct length", () => {
  const p = emptyPattern(16);
  assert.equal(p.bass.length, 16);
  assert.equal(p.lead.length, 16);
  assert.equal(p.chords.length, 16);
  assert.equal(p.bass[0].on, false);
});

test("emptyPattern respects step bounds constants", () => {
  assert.equal(MIN_STEPS, 4);
  assert.equal(MAX_STEPS, 64);
});

test("resizePattern grows with silence and shrinks preserving data", () => {
  const p = emptyPattern(8);
  p.bass[0] = { on: true, semi: 5 };
  p.lead[7] = { on: true, deg: 3 };
  resizePattern(p, 16);
  assert.equal(p.bass.length, 16);
  assert.equal(p.bass[0].on, true);
  assert.equal(p.bass[15].on, false);
  assert.equal(p.lead[7].deg, 3);
  resizePattern(p, 4);
  assert.equal(p.bass.length, 4);
  assert.equal(p.lead.length, 4);
  assert.equal(p.chords.length, 4);
});

test("resizePattern tolerates missing melodic rows", () => {
  const p = { bass: Array.from({ length: 4 }, () => ({ on: false, semi: 0 })) };
  assert.doesNotThrow(() => resizePattern(p, 8));
});

// ---------- WAV encoder ----------
test("audioBufferToWav produces a valid 16-bit PCM header", () => {
  const len = 4;
  const fake = {
    numberOfChannels: 2,
    length: len,
    sampleRate: 44100,
    getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]),
  };
  const ab = audioBufferToWav(fake);
  const view = new DataView(ab);
  const magic = (o, n) => String.fromCharCode(...new Uint8Array(ab, o, n));
  assert.equal(magic(0, 4), "RIFF");
  assert.equal(magic(8, 4), "WAVE");
  assert.equal(magic(12, 4), "fmt ");
  assert.equal(magic(36, 4), "data");
  assert.equal(view.getUint16(22, true), 2, "channels");
  assert.equal(view.getUint32(24, true), 44100, "sample rate");
  assert.equal(view.getUint16(34, true), 16, "bits per sample");
  assert.equal(ab.byteLength, 44 + len * 2 * 2);
});

test("audioBufferToWav clamps and quantizes samples", () => {
  const fake = {
    numberOfChannels: 1,
    length: 3,
    sampleRate: 8000,
    getChannelData: () => new Float32Array([2, -2, 0.5]),
  };
  const ab = audioBufferToWav(fake);
  const view = new DataView(ab);
  assert.equal(view.getInt16(44, true), 32767, "clamped to max");
  assert.equal(view.getInt16(46, true), -32768, "clamped to min");
  assert.equal(view.getInt16(48, true), 16383, "0.5 quantized (truncated)");
});
