# THUMP — browser drum machine

A fully client-side drum machine & step sequencer with a Rust backend for sharing patterns and live jam rooms. All sound is synthesized in real time via the Web Audio API — zero samples, zero audio files.

![stack](https://img.shields.io/badge/client-vanilla_JS-orange) ![backend](https://img.shields.io/badge/backend-Rust%20%2B%20Axum-red) ![db](https://img.shields.io/badge/db-PostgreSQL-blue)

## Features

### Sequencer
- 16-step grid, 8 synthesized percussion instruments (kick, snare, clap, closed/open hats, tom, rim, cowbell)
- **Accent per step** — `shift+click` cycles normal → accent (louder, brighter)
- **Swing** (0–60%) and tempo 60–200 BPM
- Drag-paint steps, live playhead + hit flashes

### Bass synth
- 303-style acid bass: sawtooth + sub-sine through a resonant lowpass
- Per-step pitch — scroll wheel on a bass cell to change note

### Mixing & FX
- Per-track **reverb send** (generated impulse response convolution) and **tempo-synced delay send** (dotted-eighth, feedback-filtered)
- Volume, mute and FX sends per track
- **Humanize** — random micro-timing and velocity variation so the beat breathes

### Patterns & songs
- Pattern length: **16 or 32 steps**
- 4 pattern slots (**A/B/C/D**) — left-click to edit, right-click to copy the current slot into another
- **Song mode** — chain slots with repeat counts (`A·4`, `B·2`…) for full arrangements; scroll a chain chip to change its repeats
- Presets (House / Breaks / Techno / Hip-Hop), intelligent randomizer
- Undo/redo (`Ctrl+Z` / `Ctrl+Y`, 80 steps deep)
- Row copy/paste — click `⧉` to copy a row, right-click another row's `⧉` to paste
- Project save/load as `.json` file

### Sharing & collaboration
- **Share** any project via a short link (stored server-side)
- Public **gallery** with likes
- **Jam rooms** — join a room and your pattern edits sync live to everyone else over WebSockets
- **Export WAV** — offline render of the current pattern (2 loops) or the full arrangement

Everything is saved automatically to `localStorage`.

## Stack

| Layer    | Tech                                        |
|----------|---------------------------------------------|
| Client   | Vanilla JS, CSS, Web Audio API (no build)   |
| Server   | Rust, Axum, Tokio                           |
| Database | PostgreSQL                                  |
| Realtime | WebSockets (broadcast rooms)                |

## Getting started

### Prerequisites
- Rust (cargo) — https://rustup.rs
- PostgreSQL running locally

### Database setup

```sh
sudo -u postgres psql -c "CREATE USER thump WITH PASSWORD 'thump';"
sudo -u postgres psql -c "CREATE DATABASE thump OWNER thump;"
```

The table schema is created automatically by the server on first start.

### Run

```sh
cd server
cargo run -- ..        # ".." = directory containing index.html
```

Then open http://localhost:3000

For development without the backend, any static server works:

```sh
python3 -m http.server 8000   # sharing/gallery/jam won't work
```

## Project layout

```
index.html      UI markup
style.css       styling
app.js          sequencer, synth engine, export, API/WS client
server/
  Cargo.toml
  src/main.rs   Axum server: REST API, WebSocket hub, static files
```

## API reference

| Method | Path                      | Description                  |
|--------|---------------------------|------------------------------|
| POST   | `/api/patterns`           | Save `{title, author, data}` |
| GET    | `/api/patterns`           | List latest 60               |
| GET    | `/api/patterns/:id`       | Fetch one                    |
| POST   | `/api/patterns/:id/like`  | Increment likes              |
| GET    | `/ws?room=name`           | Join a jam room              |

## Keyboard shortcuts

| Key             | Action                        |
|-----------------|-------------------------------|
| `space`         | Play / stop                   |
| `shift+click`   | Accent a step                 |
| `wheel`         | Change bass pitch             |
| `wheel` (chain) | Change entry repeats          |
| `ctrl+z` / `ctrl+y` | Undo / redo               |
