// The show runs on a shared clock with no server: everyone works out the same show,
// round and questions from the time alone.
window.FF = window.FF || {};

(function () {
  const ROUNDS = 10;
  const ROUND_MS = 20000;
  const LIVE_LOBBY_MS = 40000;
  const PRACTICE_LOBBY_MS = 12000;
  const EPOCH = Date.UTC(2026, 0, 1); // shows count up from here

  // Round timeline (ms into the round).
  const READY_END = 2000; // get ready + category
  const LOCK_AT = 14000; // corners lock: players in the show stop moving
  const RESOLVE_AT = 14600; // results are worked out once everyone's final position has arrived
  const TELEPORT_AT = 15500; // eliminated players go to the stands
  const REVEAL_END = 17000; // then results until ROUND_MS

  // mulberry32: a small seeded PRNG, so every player gets the same "random" numbers.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 10 questions for a show: 6 fact, 2 majority, 2 minority, with a minority round last. */
  function pickQuestions(showIndex, all) {
    const rand = mulberry32(showIndex * 2654435761);
    const of = (type, n) => shuffle(all.filter((q) => q.type === type), rand).slice(0, n);
    const [lastMinority, otherMinority] = of('minority', 2);
    const first = shuffle([...of('fact', 6), ...of('majority', 2), otherMinority], rand);
    return [...first, lastMinority];
  }

  /**
   * A schedule: where we are in the endless run of shows at a given time.
   * Live shows share EPOCH and the server clock; practice starts its own epoch now.
   */
  function makeSchedule({ epoch, lobbyMs }) {
    const showMs = lobbyMs + ROUNDS * ROUND_MS;
    return {
      lobbyMs,
      showMs,
      at(now) {
        const rel = now - epoch;
        const showIndex = Math.floor(rel / showMs);
        const t = rel - showIndex * showMs;
        if (t < lobbyMs) return { showIndex, phase: 'lobby', round: -1, rt: t, left: lobbyMs - t };
        const round = Math.floor((t - lobbyMs) / ROUND_MS);
        const rt = t - lobbyMs - round * ROUND_MS;
        let phase = 'results';
        if (rt < READY_END) phase = 'ready';
        else if (rt < LOCK_AT) phase = 'question';
        else if (rt < REVEAL_END) phase = 'reveal';
        return { showIndex, phase, round, rt, left: ROUND_MS - rt };
      },
    };
  }

  // Server time offset, from the Date header of our own page. The header only has whole
  // seconds, so we sample a few times and narrow down when the second ticks over.
  let offset = 0;
  async function syncClock() {
    if (location.protocol === 'file:') return 0;
    let low = -Infinity;
    let high = Infinity;
    for (let i = 0; i < 8; i++) {
      const sent = Date.now();
      let res;
      try {
        res = await fetch(`./index.html?t=${sent}`, { method: 'HEAD', cache: 'no-store' });
      } catch {
        break;
      }
      const got = Date.now();
      const date = Date.parse(res.headers.get('date') || '');
      if (Number.isNaN(date)) break;
      // The server's time when it answered was in [date, date + 1000), sometime between sent and got.
      low = Math.max(low, date - got);
      high = Math.min(high, date + 1000 - sent);
      if (high - low < 150) break;
      await new Promise((r) => setTimeout(r, 137));
    }
    if (Number.isFinite(low) && Number.isFinite(high) && low <= high) offset = Math.round((low + high) / 2);
    return offset;
  }

  FF.clock = {
    ROUNDS,
    ROUND_MS,
    LIVE_LOBBY_MS,
    PRACTICE_LOBBY_MS,
    EPOCH,
    READY_END,
    LOCK_AT,
    RESOLVE_AT,
    TELEPORT_AT,
    REVEAL_END,
    mulberry32,
    shuffle,
    pickQuestions,
    makeSchedule,
    syncClock,
    now: () => Date.now() + offset,
  };
})();
