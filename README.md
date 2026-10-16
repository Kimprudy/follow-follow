# Follow Follow

A live multiplayer quiz for [start.ng](https://start.ng) where you answer with your feet. A question appears and the four corners of the arena are A, B, C and D. Run your start.ng character to a corner while you watch everyone else move: trust yourself, or follow the crowd. Wrong corners go to the stands. Last ones standing win the show.

Play it at **https://follow-follow.start.ng**, or open `index.html` from a local copy for practice mode with bots.

## Rounds

| Type | Who survives |
| --- | --- |
| Fact | Players in the correct corner |
| Majority | Players in the corner with the most players |
| Minority | Players in the corner with the fewest players (empty corners don't count; ties all survive) |

If nobody would be left standing, everyone survives that round. Players in the stands keep answering from the A–D sections for their personal score, but can't win.

## How it works

There's no game server. Every show runs on a shared clock: a 40 s lobby, then 10 rounds of 20 s, repeating forever. Each player's browser works out the show, round and questions from the time (seeded with mulberry32), and works out who survived from where everyone was standing when the corners locked. Eliminated players walk to the stands, so every client agrees on who's out.

| File | What it does |
| --- | --- |
| `js/clock.js` | Shared clock (synced from the page's `Date` header), PRNG, show schedule, question picker |
| `js/show.js` | Lobby, rounds, locking, eliminations, scores |
| `js/bots.js` | Bots that fill the room when fewer than 4 real players are in it |
| `js/character.js` | The low-poly start.ng character, drawn from the player's `style` |
| `js/arena.js` | The arena, corners and stands |
| `js/platform.js` | start.ng: who's playing, sign-in, scores, leaderboard, live-room tickets |
| `js/main.js` | Screens, input, camera, HUD |
| `questions.json` | 200 questions (`js/questions.js` is generated from it) |

Plain HTML, CSS and JavaScript with no build step. three.js r159 is in `vendor/` (MIT, see `vendor/three.LICENSE`) and loaded as a classic script, so the game also runs as a local file.

## Editing questions

Edit `questions.json`, then run `node tools/sync-questions.js` to regenerate `js/questions.js`. Each question is `{ id, type, category, q, options[4], answer, confidence }`; `answer` is the correct option's index for fact rounds and `null` otherwise. Questions marked `"confidence": "low"` need a human check.

## Cover

`node tools/make-cover.mjs` renders `tools/cover.html` in headless Chrome and writes `cover.png` (1600×1000).
