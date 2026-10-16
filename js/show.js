// Runs the show: lobby, 10 rounds, locking corners, eliminations and scores.
// Every client works this out on its own from the shared clock and player positions.
window.FF = window.FF || {};

(function () {
  const { ROUNDS, LOCK_AT, RESOLVE_AT, TELEPORT_AT } = FF.clock;
  const A = FF.arena;
  const MY_SPEED = 7.5;
  const MIN_REAL_PLAYERS = 4; // fewer real players than this and bots fill the room...
  const ROOM_WITH_BOTS = 8; // ...up to this many

  class ShowRunner {
    /**
     * mode: 'practice' or 'live'. scene: the three.js scene. me: { id, name, style }.
     * onEvent(type, data) gets 'show', 'round', 'lock', 'out', 'showEnd'.
     */
    constructor({ mode, scene, me, questions, onEvent }) {
      this.mode = mode;
      this.scene = scene;
      this.onEvent = onEvent;
      this.questions = questions;
      const practiceEpoch = Date.now();
      this.practiceSeed = Math.floor(Math.random() * 1e9);
      this.schedule = FF.clock.makeSchedule(
        mode === 'practice'
          ? { epoch: practiceEpoch, lobbyMs: FF.clock.PRACTICE_LOBBY_MS }
          : { epoch: FF.clock.EPOCH, lobbyMs: FF.clock.LIVE_LOBBY_MS },
      );
      this.now = mode === 'practice' ? () => Date.now() : FF.clock.now;
      this.people = new Map(); // id -> participant
      this.rand = Math.random;
      this.state = null;
      this.me = this.addPerson({ ...me, local: true, isMe: true });
      const start = this.spotNearMiddle();
      this.me.x = this.me.tx = start.x;
      this.me.z = this.me.tz = start.z;
    }

    // ----- participants -----

    addPerson({ id, name, style, local = false, isMe = false, bot = false, speed = MY_SPEED }) {
      const char = FF.character.makeCharacter(style);
      const tag = FF.character.makeNameTag(name || 'Player', { bot, me: isMe });
      char.root.add(tag);
      this.scene.add(char.root);
      const p = {
        id, name, style, bot, isMe, local, char, tag,
        // x/z is where we draw them; netX/netZ is where a remote player last said they were.
        x: 0, z: 0, tx: 0, tz: 0, ry: 0, netX: 0, netZ: 0, moving: false, speed,
        active: false, inShow: false, eliminatedAt: null, rounds: 0, correct: 0, plan: null, zone: -1,
      };
      this.people.set(id, p);
      return p;
    }

    removePerson(id) {
      const p = this.people.get(id);
      if (!p) return;
      this.scene.remove(p.char.root);
      p.tag.material.map.dispose();
      p.tag.material.dispose();
      this.people.delete(id);
    }

    get list() {
      return [...this.people.values()];
    }

    // ----- remote players (live mode) -----

    /** A player from the live room: { id, name, style, x, z, ry, moving }. */
    addRemote(player) {
      const id = `r-${player.id}`;
      if (this.people.has(id)) this.removePerson(id);
      const p = this.addPerson({ id, name: player.name, style: player.style });
      p.x = p.netX = Number(player.x) || 0;
      p.z = p.netZ = Number(player.z) || 0;
      p.ry = Number(player.ry) || 0;
      // Joining while a show is on: they watch until the next lobby, like we would.
      return p;
    }

    removeRemote(id) {
      this.removePerson(`r-${id}`);
    }

    remoteMove(msg) {
      const p = this.people.get(`r-${msg.id}`);
      if (!p) return;
      p.netX = Number(msg.x) || 0;
      p.netZ = Number(msg.z) || 0;
      p.ry = Number(msg.ry) || 0;
      p.moving = !!msg.moving;
    }

    remoteWave(id) {
      this.people.get(`r-${id}`)?.char.cheer();
    }

    /** Where a player counts as standing: our own position, or what a remote player told us. */
    spotOf(p) {
      return p.local ? { x: p.x, z: p.z } : { x: p.netX, z: p.netZ };
    }

    spotNearMiddle() {
      const a = this.rand() * Math.PI * 2;
      const r = 1.5 + this.rand() * 4;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    }

    teleport(p, spot) {
      p.x = p.tx = spot.x;
      p.z = p.tz = spot.z;
    }

    /** Bots fill the room up to 8 when there are fewer than 4 real players. */
    fillBots(showIndex) {
      const real = this.list.filter((p) => !p.bot).length;
      const want = this.mode === 'practice' ? ROOM_WITH_BOTS - 1 : real < MIN_REAL_PLAYERS ? ROOM_WITH_BOTS - real : 0;
      const bots = this.list.filter((p) => p.bot);
      for (let k = bots.length; k < want; k++) {
        const who = FF.bots.botIdentity(showIndex, k);
        const bot = this.addPerson({ ...who, bot: true, local: true, speed: who.speed });
        this.teleport(bot, this.spotNearMiddle());
      }
      for (let k = want; k < bots.length; k++) this.removePerson(`bot-${k}`);
    }

    /** New bots for a new show: different faces each show. */
    resetBots(showIndex) {
      for (const p of this.list) if (p.bot) this.removePerson(p.id);
      this.fillBots(showIndex);
    }

    /** Live headcount of players still in the show, per corner. */
    counts() {
      const counts = [0, 0, 0, 0];
      for (const p of this.people.values()) {
        if (!p.active) continue;
        const spot = this.spotOf(p);
        const z = A.zoneOf(spot.x, spot.z);
        if (z >= 0) counts[z]++;
      }
      return counts;
    }

    // ----- the show -----

    question(round) {
      return this.state?.questions[round] ?? null;
    }

    startShow(s, first) {
      const showIndex = this.mode === 'practice' ? this.practiceSeed + s.showIndex : s.showIndex;
      this.state = {
        showIndex: s.showIndex,
        seedIndex: showIndex,
        questions: FF.clock.pickQuestions(showIndex, this.questions),
        round: -1,
        resolved: new Set(),
        teleported: new Set(),
        results: [],
        lateJoin: first && s.phase !== 'lobby',
      };
      this.resetBots(showIndex);
      for (const p of this.list) {
        Object.assign(p, { active: false, inShow: false, eliminatedAt: null, rounds: 0, correct: 0, plan: null });
        // Everyone comes back from the stands for the new show.
        if (p.local && A.inStands(p.z)) this.teleport(p, this.spotNearMiddle());
      }
      if (this.state.lateJoin) {
        // Joined mid-show: watch from the stands until the next lobby. Bots carry on as if they'd played.
        this.teleport(this.me, A.spotInStands(-1, this.rand));
        for (const p of this.list) if (p.bot) Object.assign(p, { active: true, inShow: true });
      }
      this.onEvent('show', { lateJoin: this.state.lateJoin });
    }

    /** The lobby ends: everyone on the arena floor is in the show. */
    beginRounds() {
      if (this.state.lateJoin) return;
      // The bots for this show are settled now, from who's in the room.
      this.fillBots(this.state.seedIndex);
      for (const p of this.list) {
        if (A.inStands(this.spotOf(p).z)) continue;
        p.active = true;
        p.inShow = true;
      }
    }

    startRound(round) {
      const st = this.state;
      if (round === 0 || (st.round < 0 && !st.lateJoin)) this.beginRounds();
      // Catch up on rounds we missed (the tab was in the background).
      for (let r = Math.max(0, st.round); r < round; r++) {
        if (!st.resolved.has(r)) this.resolve(r);
        this.sendOutEliminated(r);
      }
      st.round = round;
      const q = this.question(round);
      for (const p of this.list) {
        if (p.bot) p.plan = FF.bots.planRound(st.seedIndex, round, Number(p.id.slice(4)), q);
      }
      this.onEvent('round', { round, question: q });
    }

    /** Corners lock: work out who survives from where everyone is standing. */
    resolve(round) {
      const st = this.state;
      st.resolved.add(round);
      const q = this.question(round);
      const counts = [0, 0, 0, 0];
      const active = [];
      for (const p of this.list) {
        const spot = this.spotOf(p);
        p.zone = A.zoneOf(spot.x, spot.z);
        if (!p.active) continue;
        active.push(p);
        if (p.zone >= 0) counts[p.zone]++;
      }
      let surviving = [];
      if (q.type === 'fact') surviving = [q.answer];
      else if (q.type === 'majority') {
        const max = Math.max(...counts);
        if (max > 0) surviving = [0, 1, 2, 3].filter((i) => counts[i] === max);
      } else {
        const filled = counts.filter((c) => c > 0);
        const min = filled.length ? Math.min(...filled) : 0;
        surviving = [0, 1, 2, 3].filter((i) => counts[i] > 0 && counts[i] === min);
      }
      const survives = (p) => surviving.includes(p.zone);
      // If nobody would be left standing, everyone gets another chance.
      const saved = active.length > 0 && !active.some(survives);
      for (const p of this.list) {
        if (!p.inShow) continue;
        if (survives(p) && p.zone >= 0) p.correct++;
        if (!p.active) continue;
        if (survives(p) || saved) p.rounds++;
        else {
          p.active = false;
          p.eliminatedAt = round;
        }
      }
      const result = { round, question: q, counts, surviving, saved, outCount: active.filter((p) => !p.active).length, myZone: this.me.zone };
      st.results[round] = result;
      this.onEvent('lock', result);
    }

    /** Eliminated players go to the stands, so every client sees them out. */
    sendOutEliminated(round) {
      const st = this.state;
      if (st.teleported.has(round)) return;
      st.teleported.add(round);
      for (const p of this.list) {
        if (!p.local || p.eliminatedAt !== round) continue;
        this.teleport(p, A.spotInStands(-1, this.rand));
        if (p.isMe) this.onEvent('out', { round });
      }
    }

    finishShow() {
      const st = this.state;
      if (!st || st.lateJoin || st.round < 0) return;
      for (let r = 0; r < ROUNDS; r++) if (!st.resolved.has(r)) this.resolve(r);
      const players = this.list.filter((p) => p.inShow);
      const me = this.me;
      const myOut = me.eliminatedAt ?? Infinity;
      const outlasted = players.filter((p) => p !== me && p.eliminatedAt !== null && p.eliminatedAt < myOut).length;
      const winners = players.filter((p) => p.active);
      this.onEvent('showEnd', {
        mode: this.mode,
        played: me.inShow,
        won: me.inShow && me.active,
        winners: winners.map((p) => ({ name: p.name, bot: p.bot, isMe: p.isMe })),
        stats: { rounds: me.rounds, correct: me.correct, outlasted },
        players: players.length,
      });
    }

    // ----- every frame -----

    update(dt) {
      const s = this.schedule.at(this.now());
      if (!this.state || s.showIndex !== this.state.showIndex) {
        const first = !this.state;
        if (!first) this.finishShow();
        this.startShow(s, first);
      }
      const st = this.state;
      if (s.round >= 0 && s.round !== st.round) this.startRound(s.round);
      if (s.round >= 0 && s.rt >= RESOLVE_AT && !st.resolved.has(s.round)) this.resolve(s.round);
      if (s.round >= 0 && s.rt >= TELEPORT_AT) this.sendOutEliminated(s.round);
      if (s.phase === 'lobby') this.fillBots(st.seedIndex);

      const counts = this.counts();
      for (const p of this.people.values()) {
        if (p.bot) {
          if (s.phase === 'lobby') FF.bots.wander(p, this.rand);
          else if (s.phase === 'question') FF.bots.think(p, s.rt, counts);
        }
        if (p.local) this.step(p, dt, s);
        else this.follow(p, dt, s);
        p.char.root.position.set(p.x, 0, p.z);
        p.char.root.rotation.y = p.ry;
        p.char.update(dt, p.moving);
      }
      this.moment = s;
      return s;
    }

    /** Walks a local player (me or a bot) toward their target. Frozen while the corners are locked. */
    step(p, dt, s) {
      const locked = s.round >= 0 && s.rt >= LOCK_AT && s.rt < TELEPORT_AT && p.active;
      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      const dist = Math.hypot(dx, dz);
      p.moving = !locked && dist > 0.08;
      if (p.moving) {
        const d = Math.min(dist, p.speed * dt);
        p.x += (dx / dist) * d;
        p.z += (dz / dist) * d;
        p.ry = Math.atan2(dx, dz);
      }
      A.clamp(p, A.inStands(p.z));
    }

    /** Glides a remote player toward where they said they are; jumps on a teleport. */
    follow(p, dt, s) {
      const dx = p.netX - p.x;
      const dz = p.netZ - p.z;
      if (Math.hypot(dx, dz) > 8) {
        p.x = p.netX;
        p.z = p.netZ;
      } else {
        const k = Math.min(1, dt * 10);
        p.x += dx * k;
        p.z += dz * k;
      }
      // We're spectating a show already under way: count whoever's on the floor as still in.
      if (this.state.lateJoin && s.phase !== 'lobby' && p.eliminatedAt === null && !A.inStands(p.netZ)) {
        p.active = true;
        p.inShow = true;
      }
      // They went to the stands on their own screen, so they're out: everyone agrees.
      if (p.active && s.phase !== 'lobby' && A.inStands(p.netZ)) {
        p.active = false;
        p.eliminatedAt ??= Math.max(0, this.state.round);
      }
    }

    /** Sets my walking target, kept to where I'm allowed to be. */
    walkTo(x, z) {
      const spot = { x, z };
      A.clamp(spot, A.inStands(this.me.z));
      this.me.tx = spot.x;
      this.me.tz = spot.z;
    }

    dispose() {
      for (const p of this.list) this.removePerson(p.id);
    }
  }

  FF.ShowRunner = ShowRunner;
})();
