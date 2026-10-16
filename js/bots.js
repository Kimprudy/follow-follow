// Bots fill the room when fewer than 4 real players are in it (and are the whole cast in practice).
// Their looks and first choices are seeded from the show, so everyone sees the same bots.
window.FF = window.FF || {};

(function () {
  const NAMES = ['Tolu', 'Chidi', 'Amaka', 'Bayo', 'Ngozi', 'Emeka', 'Funmi', 'Kemi', 'Ife', 'Dayo', 'Zainab', 'Musa', 'Ada', 'Seyi', 'Uche', 'Halima', 'Femi', 'Nkechi', 'Tunde', 'Bisi'];
  const ACCURACY = 0.6; // chance a bot picks the right corner on a fact round

  const seed = (...parts) => parts.reduce((h, p) => Math.imul(h ^ p, 2654435761) >>> 0, 0x9e3779b9);

  const SPEED = 6.5; // m/s: the same on every screen, so bots reach their corners at the same time

  /** The k-th bot of a show: { id, name, style, speed }. */
  function botIdentity(showIndex, k) {
    const rand = FF.clock.mulberry32(seed(showIndex, k, 7));
    const start = Math.floor(FF.clock.mulberry32(seed(showIndex, 99))() * NAMES.length);
    return { id: `bot-${k}`, name: NAMES[(start + k * 7) % NAMES.length], style: FF.character.randomStyle(rand), speed: SPEED };
  }

  /** What a bot will do this round. Pure: depends only on the show, round and bot. */
  function planRound(showIndex, round, k, question) {
    const rand = FF.clock.mulberry32(seed(showIndex, round, k, 3));
    let corner = Math.floor(rand() * 4);
    if (question.type === 'fact') {
      const wrong = [0, 1, 2, 3].filter((i) => i !== question.answer);
      corner = rand() < ACCURACY ? question.answer : wrong[Math.floor(rand() * 3)];
    }
    const decideAt = FF.clock.READY_END + 300 + rand() * 3500;
    // Late enough to see the crowd, early enough to cross the arena before the lock.
    const herdAt = Math.min(FF.clock.LOCK_AT - 5000, decideAt + 1500 + rand() * 4000);
    const herds = rand() < 0.25 + rand() * 0.4; // drifts to the busiest corner after a while
    return { corner, decideAt, herdAt, herds, decided: false, herded: false, rand };
  }

  /**
   * Moves a bot's target for this moment of the round. counts are the live headcounts of the
   * players still in the show. Bots in the stands just pick a stands section.
   */
  function think(bot, rt, counts) {
    const plan = bot.plan;
    if (!plan) return;
    if (!plan.decided && rt >= plan.decideAt) {
      plan.decided = true;
      const spot = bot.active ? FF.arena.spotInCorner(plan.corner, plan.rand) : FF.arena.spotInStands(plan.corner, plan.rand);
      bot.tx = spot.x;
      bot.tz = spot.z;
    }
    if (bot.active && plan.decided && !plan.herded && plan.herds && rt >= plan.herdAt) {
      plan.herded = true;
      const busiest = counts.indexOf(Math.max(...counts));
      if (busiest !== plan.corner && counts[busiest] > 0) {
        plan.corner = busiest;
        const spot = FF.arena.spotInCorner(busiest, plan.rand);
        bot.tx = spot.x;
        bot.tz = spot.z;
      }
    }
  }

  /** Lobby: mill around the middle. */
  function wander(bot, rand) {
    if (Math.hypot(bot.tx - bot.x, bot.tz - bot.z) > 0.3 || rand() > 0.01) return;
    const a = rand() * Math.PI * 2;
    const r = 1 + rand() * 5;
    bot.tx = Math.cos(a) * r;
    bot.tz = Math.sin(a) * r;
  }

  FF.bots = { botIdentity, planRound, think, wander };
})();
