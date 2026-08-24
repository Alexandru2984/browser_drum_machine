"use strict";

// THUMP core — pure logic, no DOM, no audio. Shared by app.js (browser)
// and tests (node). UMD-ish so both can load it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.THUMP_CORE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  const SCALES = {
    major:      [0, 2, 4, 5, 7, 9, 11],
    minor:      [0, 2, 3, 5, 7, 8, 10],
    pentaMinor: [0, 3, 5, 7, 10],
    pentaMajor: [0, 2, 4, 7, 9],
    dorian:     [0, 2, 3, 5, 7, 9, 10],
    phrygian:   [0, 1, 3, 5, 7, 8, 10],
    blues:      [0, 3, 5, 6, 7, 10],
  };

  const SLOTS = ["A", "B", "C", "D"];
  const MIN_STEPS = 4;
  const MAX_STEPS = 64;

  const BASS_ROOT_MIDI = 33; // A1
  const LEAD_BASE = 57;      // A3
  const CHORD_BASE = 45;     // A2

  const AUTO_DEFAULTS = { cutoff: 1, rev: 1, dly: 1, bpm: 0 }; // bpm 0 = no override

  function noteName(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  }

  function scaleMidi(deg, key, scale) {
    const iv = SCALES[scale] || SCALES.minor;
    const n = iv.length;
    const oct = Math.floor(deg / n);
    const idx = ((deg % n) + n) % n;
    return key + iv[idx] + 12 * oct;
  }

  function leadMidi(deg, key, scale) {
    return LEAD_BASE + scaleMidi(deg, key, scale);
  }

  function chordMidis(deg, key, scale) {
    return [0, 2, 4].map((d) => CHORD_BASE + scaleMidi(deg + d, key, scale));
  }

  function emptyPattern(steps) {
    return {
      bass: Array.from({ length: steps }, () => ({ on: false, semi: 0 })),
      lead: Array.from({ length: steps }, () => ({ on: false, deg: 0 })),
      chords: Array.from({ length: steps }, () => ({ on: false, deg: 0 })),
    };
  }

  function resizePattern(p, steps) {
    for (const id of ["bass", "lead", "chords"]) {
      if (!p[id]) continue;
      const mk = id === "bass" ? () => ({ on: false, semi: 0 }) : () => ({ on: false, deg: 0 });
      while (p[id].length < steps) p[id].push(mk());
      p[id] = p[id].slice(0, steps);
    }
    return p;
  }

  // ---------- MIDI ----------
  // events: [{tick, midi, vel, dur}] → format-0 MIDI file ArrayBuffer
  function buildMidiFile({ bpm = 120, ticksPerBeat = 96, notes = [] }) {
    const events = [];
    for (const n of notes) {
      events.push({ tick: n.tick, bytes: [0x90 | 0, n.midi, Math.max(1, Math.min(127, Math.round(n.vel * 127)))] });
      events.push({ tick: n.tick + Math.max(1, n.dur), bytes: [0x80, n.midi, 0] });
    }
    // note-offs before note-ons at the same tick
    events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);

    const vlq = (v) => {
      const bytes = [v & 0x7f];
      while (v >>= 7) bytes.unshift((v & 0x7f) | 0x80);
      return bytes;
    };

    const track = [];
    // tempo meta
    const mpqn = Math.round(60000000 / bpm);
    track.push(0x00, 0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff);
    let prev = 0;
    for (const ev of events) {
      track.push(...vlq(ev.tick - prev), ...ev.bytes);
      prev = ev.tick;
    }
    track.push(...vlq(0), 0xff, 0x2f, 0x00);

    const u32 = (v) => [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    const u16 = (v) => [(v >> 8) & 0xff, v & 0xff];
    const str = (s) => [...s].map((c) => c.charCodeAt(0));

    return new Uint8Array([
      ...str("MThd"), ...u32(6), ...u16(0), ...u16(1), ...u16(ticksPerBeat),
      ...str("MTrk"), ...u32(track.length), ...track,
    ]).buffer;
  }

  // minimal format-0 parser → { division, bpm, notes: [{tick, midi, vel, dur, channel}] }
  function parseMidiFile(ab) {
    const v = new DataView(ab);
    const u8 = (o) => v.getUint8(o);
    const str = (o, n) => String.fromCharCode(...new Uint8Array(ab, o, n));
    let off = 0;
    if (str(0, 4) !== "MThd") throw new Error("not a MIDI file");
    const headerLen = v.getUint32(4);
    const division = v.getUint16(10, false) & 0x7fff;
    off = 8 + headerLen;

    let bpm = 120;
    const notes = [];

    while (off + 8 <= ab.byteLength) {
      const chunkId = str(off, 4);
      const chunkLen = v.getUint32(off + 4);
      off += 8;
      if (chunkId !== "MTrk") { off += chunkLen; continue; }
      const end = off + chunkLen;
      let tick = 0;
      let running = 0;
      const openNotes = new Map();

      const readVlq = () => {
        let val = 0;
        for (;;) {
          const b = u8(off++);
          val = (val << 7) | (b & 0x7f);
          if (!(b & 0x80)) break;
        }
        return val;
      };

      while (off < end) {
        tick += readVlq();
        let status = u8(off);
        if (status < 0x80) { status = running; }
        else { off++; running = status >= 0x80 && status < 0xf0 ? status : 0; }

        if (status === 0xff) {
          const type = u8(off++);
          const len = readVlq();
          if (type === 0x51 && len === 3) {
            const mpqn = (u8(off) << 16) | (u8(off + 1) << 8) | u8(off + 2);
            bpm = Math.round(60000000 / mpqn);
          }
          off += len;
        } else if (status === 0xf0 || status === 0xf7) {
          const len = readVlq();
          off += len;
        } else {
          const cmd = status & 0xf0;
          const channel = status & 0x0f;
          const midi = u8(off++);
          const vel = cmd === 0xc0 || cmd === 0xd0 ? 0 : u8(off++);
          if (cmd === 0x90 && vel > 0) {
            openNotes.set(midi, { tick, vel: vel / 127, channel });
          } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
            const on = openNotes.get(midi);
            if (on) {
              notes.push({ tick: on.tick, midi, vel: on.vel, dur: Math.max(1, tick - on.tick), channel: on.channel });
              openNotes.delete(midi);
            }
          }
        }
      }
      off = end;
    }
    notes.sort((a, b) => a.tick - b.tick);
    return { division, bpm, notes };
  }

  function normalizeSong(song) {
    // accepts ["A","B"] or [{slot:"A",reps:2,auto:{...}}] → normalized entries
    return song
      .filter((e) => (typeof e === "string" ? SLOTS.includes(e) : SLOTS.includes(e.slot)))
      .map((e) => {
        if (typeof e === "string") return { slot: e, reps: 1, auto: undefined };
        return {
          slot: e.slot,
          reps: Math.max(1, Math.min(16, +e.reps || 1)),
          auto: e.auto && typeof e.auto === "object" ? sanitizeAuto(e.auto) : undefined,
        };
      })
      .slice(0, 64);
  }

  function sanitizeAuto(a) {
    const clamp = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : def);
    return {
      cutoff: clamp(a.cutoff, 0.05, 1, 1),
      rev: clamp(a.rev, 0, 2, 1),
      dly: clamp(a.dly, 0, 2, 1),
      bpm: +a.bpm > 0 ? clamp(a.bpm, 60, 200, 0) : 0,
    };
  }

  function getAuto(entry) {
    return { ...AUTO_DEFAULTS, ...(entry && entry.auto ? entry.auto : {}) };
  }

  function hasAuto(entry) {
    if (!entry || !entry.auto) return false;
    const a = entry.auto;
    return a.cutoff !== 1 || a.rev !== 1 || a.dly !== 1 || (a.bpm || 0) > 0;
  }

  // buf: {numberOfChannels, length, sampleRate, getChannelData(ch)}
  // returns ArrayBuffer (16-bit PCM WAV)
  function audioBufferToWav(buf) {
    const numCh = buf.numberOfChannels;
    const len = buf.length;
    const bytes = 44 + len * numCh * 2;
    const ab = new ArrayBuffer(bytes);
    const view = new DataView(ab);
    const w = (off, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };

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
    return ab;
  }

  return {
    NOTE_NAMES,
    SCALES,
    SLOTS,
    MIN_STEPS,
    MAX_STEPS,
    BASS_ROOT_MIDI,
    LEAD_BASE,
    CHORD_BASE,
    AUTO_DEFAULTS,
    noteName,
    scaleMidi,
    leadMidi,
    chordMidis,
    emptyPattern,
    resizePattern,
    normalizeSong,
    sanitizeAuto,
    getAuto,
    hasAuto,
    audioBufferToWav,
    buildMidiFile,
    parseMidiFile,
  };
});
