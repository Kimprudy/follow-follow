// Follow Follow: screens, input, camera and HUD. The show itself is in show.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const A = FF.arena;
  const C = FF.clock;
  const P = FF.platform;
  const TYPE_INFO = {
    fact: { label: 'Fact', hint: 'Run to the right answer' },
    majority: { label: 'Majority', hint: 'The biggest crowd survives' },
    minority: { label: 'Minority', hint: 'The smallest crowd survives' },
  };

  // ----- renderer, scene, camera -----

  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  const world = A.build();
  const scene = world.scene;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 300);

  // Two camera framings: close on your character for the title, the whole arena for the game.
  const cam = {
    pos: new THREE.Vector3(0, 3, 9),
    look: new THREE.Vector3(0, 0, 0),
    wantPos: new THREE.Vector3(),
    wantLook: new THREE.Vector3(),
    mode: 'title',
  };

  function gameFraming(out) {
    const portrait = innerHeight > innerWidth;
    const elevation = THREE.MathUtils.degToRad(portrait ? 58 : 46);
    const look = new THREE.Vector3(0, 0, portrait ? 9 : 7);
    const dir = new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation));
    // The arena floor and the front of the stands must fit.
    const pts = [[-20.5, 0, -20.5], [20.5, 0, -20.5], [-20.5, 0, 37], [20.5, 0, 37]].map((p) => new THREE.Vector3(...p));
    const top = portrait ? 0.5 : 0.56; // leave room for the question card
    const probe = camera.clone();
    let d = 20;
    for (; d < 260; d += 1) {
      probe.position.copy(look).addScaledVector(dir, d);
      probe.lookAt(look);
      probe.updateMatrixWorld();
      const fits = pts.every((p) => {
        const v = p.clone().project(probe);
        return Math.abs(v.x) <= 0.96 && v.y <= top && v.y >= -0.92;
      });
      if (fits) break;
    }
    out.pos.copy(look).addScaledVector(dir, d);
    out.look.copy(look);
  }

  function titleFraming(out) {
    const portrait = innerHeight > innerWidth;
    // Looking below the character puts it in the top half, above the title panel.
    out.look.set(0, portrait ? -2.6 : -3, 0);
    out.pos.set(0, 3, 20);
  }

  function frame() {
    const tmp = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    if (cam.mode === 'game') gameFraming(tmp);
    else titleFraming(tmp);
    cam.wantPos.copy(tmp.pos);
    cam.wantLook.copy(tmp.look);
    // Fog only the far background, however far back the camera sits.
    const d = tmp.pos.distanceTo(tmp.look);
    scene.fog.near = d + 30;
    scene.fog.far = d + 110;
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    frame();
  }
  addEventListener('resize', resize);

  // ----- the player (start.ng) -----

  let who = { user: null, guest: { name: 'Guest', style: P.GUEST_STYLE, face: null }, signedIn: false, online: false };
  const player = () => who.user ?? who.guest;

  function updateCard() {
    const p = player();
    $('player-name').textContent = p.name || 'Guest';
    $('player-account').textContent = who.user?.account ? `@${who.user.account}` : 'Not signed in';
    const face = $('player-face');
    if (p.face) {
      face.style.backgroundImage = `url("${p.face}")`;
      face.textContent = '';
    } else {
      face.style.backgroundImage = '';
      face.textContent = (p.name || 'G').trim().charAt(0).toUpperCase();
    }
    $('player-sign-in').hidden = !P.available || who.signedIn;

    const live = $('play-live');
    if (!P.available) {
      live.disabled = true;
      live.textContent = 'Play Live';
      $('live-note').textContent = 'Live shows run on follow-follow.start.ng. Practice works anywhere.';
    } else if (!who.signedIn) {
      live.disabled = false;
      live.textContent = 'Sign in to play live';
      $('live-note').textContent = P.isGuestLink ? 'Playing as a guest: practice with bots, or sign in to join live shows.' : 'Live shows and the leaderboard need a start.ng account.';
    } else {
      live.disabled = false;
      live.textContent = 'Play Live';
      $('live-note').textContent = 'A new live show starts every 4 minutes.';
    }
  }

  // Your character on the title screen.
  let preview = null;
  let previewKey = '';
  function updatePreview() {
    const key = JSON.stringify(player().style);
    if (key === previewKey && preview) return;
    previewKey = key;
    if (preview) scene.remove(preview.root);
    preview = FF.character.makeCharacter(player().style);
    preview.root.visible = !runner;
    scene.add(preview.root);
  }

  async function refreshPlayer() {
    const next = await P.whoami();
    if (next.online || !P.available) who = next;
    updateCard();
    updatePreview();
  }

  P.onPlayerChange((next) => {
    const changed = next.user?.id !== who.user?.id;
    who = next;
    updateCard();
    updatePreview();
    // Signed out in another tab during a live show: back to the menu.
    if (changed && runner?.mode === 'live' && !who.signedIn) leave();
  });

  // ----- screens -----

  let runner = null;
  let lastEnd = null;

  function start(mode) {
    $('title').hidden = true;
    $('board').hidden = true;
    $('results').hidden = true;
    if (preview) preview.root.visible = false;
    const p = player();
    runner = new FF.ShowRunner({
      mode,
      scene,
      me: { id: who.user ? `p-${who.user.id}` : 'me', name: p.name || 'You', style: p.style },
      questions: window.FF_QUESTIONS,
      onEvent,
    });
    runner.me.char.root.add(meRing);
    cam.mode = 'game';
    frame();
    $('bottom').hidden = false;
    $('corners').hidden = false;
    if (mode === 'live') joinRoom();
  }

  function leave() {
    room?.stop();
    room = null;
    if (runner) runner.dispose();
    runner = null;
    banner(null);
    for (const id of ['hud', 'corners', 'bottom', 'lobby', 'results', 'board', 'net']) $(id).hidden = true;
    $('title').hidden = false;
    if (preview) preview.root.visible = true;
    world.setPads(['idle', 'idle', 'idle', 'idle']);
    marker.visible = false;
    cam.mode = 'title';
    frame();
  }

  // ----- the live room -----

  let room = null;
  let myNetId = null;
  const NET_TEXT = {
    connecting: 'Joining the live room…',
    retrying: 'Reconnecting… playing on with bots',
    full: 'The live room is full. Playing with bots, and trying again…',
    signin: 'Sign in to start.ng to play live.',
    'other-tab': "You're playing Follow Follow in another tab.",
  };

  function joinRoom() {
    myNetId = null;
    room = new FF.LiveRoom({
      onMessage(msg) {
        if (!runner) return;
        if (msg.type === 'welcome') {
          myNetId = msg.you;
          for (const p of runner.list) if (!p.local) runner.removePerson(p.id);
          for (const p of msg.players || []) if (p.id !== myNetId) runner.addRemote(p);
          sendMove(true);
        } else if (msg.type === 'join') {
          if (msg.player && msg.player.id !== myNetId) runner.addRemote(msg.player);
        } else if (msg.type === 'move') {
          if (msg.id !== myNetId) runner.remoteMove(msg);
        } else if (msg.type === 'wave') {
          if (msg.id !== myNetId) runner.remoteWave(msg.id);
        } else if (msg.type === 'leave') {
          runner.removeRemote(msg.id);
        }
      },
      onStatus(state) {
        const box = $('net');
        if (state === 'online') {
          box.hidden = true;
          return;
        }
        $('net-text').textContent = NET_TEXT[state] || '';
        const action = $('net-action');
        action.hidden = state !== 'signin' && state !== 'other-tab';
        action.textContent = state === 'signin' ? 'Sign in' : 'Play here';
        action.onclick = () => (state === 'signin' ? P.signIn() : room?.rejoin());
        box.hidden = false;
      },
    });
    room.connect();
  }

  // My position goes out about 10 times a second while I move, and once a second when I don't,
  // so newcomers and the corner lock always have a fresh position.
  let lastSent = 0;
  let lastSentKey = '';
  function sendMove(force) {
    if (!room?.online || !runner) return;
    const me = runner.me;
    const now = performance.now();
    const msg = { type: 'move', x: +me.x.toFixed(2), z: +me.z.toFixed(2), ry: +me.ry.toFixed(2), moving: me.moving };
    const key = `${msg.x},${msg.z},${msg.moving}`;
    const changed = key !== lastSentKey;
    if (!force && now - lastSent < (changed ? 100 : 1000)) return;
    room.send(msg);
    lastSent = now;
    lastSentKey = key;
  }

  $('practice').onclick = () => start('practice');
  $('play-live').onclick = () => (who.signedIn ? start('live') : P.signIn());
  $('player-sign-in').onclick = () => P.signIn();
  $('leave').onclick = leave;
  $('results-menu').onclick = leave;
  $('results-next').onclick = () => ($('results').hidden = true);
  $('open-board').onclick = async () => {
    $('board').hidden = false;
    await showBoard($('board-list'));
  };
  $('board-close').onclick = () => ($('board').hidden = true);

  async function showBoard(list) {
    list.replaceChildren(row('Loading…'));
    if (!P.available) {
      list.replaceChildren(row('The leaderboard lives on follow-follow.start.ng.'));
      return;
    }
    const entries = await P.leaderboard(10);
    if (!entries) list.replaceChildren(row("Couldn't reach start.ng. Try again in a moment."));
    else if (!entries.length) list.replaceChildren(row('No runs yet. Be the first!'));
    else {
      list.replaceChildren(...entries.map((e) => {
        const li = document.createElement('li');
        if (who.user && e.player_id === who.user.id) li.className = 'me';
        const s = e.stats || {};
        li.innerHTML = '<span class="rank"></span><span class="name"></span><span class="nums"></span>';
        li.children[0].textContent = `#${e.rank}`;
        li.children[1].textContent = e.name;
        li.children[2].textContent = `${s.rounds ?? 0} rounds · ${s.correct ?? 0} correct · ${s.outlasted ?? 0} out`;
        return li;
      }));
    }
    function row(text) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="empty"></span>';
      li.firstChild.textContent = text;
      return li;
    }
  }

  // ----- show events -----

  let bannerTimer = 0;
  function banner(text, sub, ms = 2000) {
    const el = $('banner');
    clearTimeout(bannerTimer);
    if (!text) {
      el.hidden = true;
      return;
    }
    el.textContent = text;
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      el.append(small);
    }
    el.hidden = false;
    // Restart the pop animation.
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    bannerTimer = setTimeout(() => (el.hidden = true), ms);
  }

  let myOutcome = null; // shown when the results part of a round starts

  function onEvent(type, data) {
    if (type === 'show') {
      myOutcome = null;
      if (data.lateJoin) banner('Show in progress', 'Watch from the stands. You join the next show.', 3500);
    } else if (type === 'round') {
      myOutcome = null;
      $('results').hidden = true;
      const info = TYPE_INFO[data.question.type];
      banner(`ROUND ${data.round + 1}`, `${data.question.category} · ${info.hint}`, C.READY_END + 300);
    } else if (type === 'lock') {
      const L = A.LETTERS;
      const q = data.question;
      const letters = data.surviving.map((i) => L[i]).join(' & ');
      let text;
      if (q.type === 'fact') text = `It's ${L[q.answer]}!`;
      else if (!data.surviving.length) text = 'Nobody picked a corner!';
      else text = `${q.type === 'majority' ? 'Biggest' : 'Smallest'} crowd: ${letters}`;
      let sub = q.type === 'fact' ? q.options[q.answer] : '';
      if (data.saved) sub = 'Nobody got it right, so everyone survives!';
      else if (data.outCount) sub = `${sub ? `${sub} · ` : ''}${data.outCount} out`;
      banner(text, sub, C.REVEAL_END - C.LOCK_AT);
      const me = runner.me;
      const right = data.surviving.includes(data.myZone);
      if (!me.inShow) myOutcome = null;
      else if (me.eliminatedAt === data.round) myOutcome = ["YOU'RE OUT!", 'Keep answering from the stands for points'];
      else if (me.active) myOutcome = ['YOU SURVIVED!', data.saved ? 'Saved by the crowd' : `${me.rounds} round${me.rounds === 1 ? '' : 's'} survived`];
      else myOutcome = right ? ['Correct!', '+1 point from the stands'] : ['Not this time', 'Keep going'];
    } else if (type === 'showEnd') {
      if (data.played) showResults(data);
    }
  }

  async function showResults(data) {
    lastEnd = data;
    $('results-title').textContent = data.won ? 'YOU WON THE SHOW! 🏆' : 'Show over!';
    const names = data.winners.map((w) => (w.isMe ? 'You' : w.bot ? `${w.name} (BOT)` : w.name));
    $('results-winners').textContent = names.length ? `Last ones standing: ${names.join(', ')}` : '';
    $('stat-rounds').textContent = data.stats.rounds;
    $('stat-correct').textContent = data.stats.correct;
    $('stat-outlasted').textContent = data.stats.outlasted;
    $('results').hidden = false;
    const saved = $('results-saved');
    if (data.mode !== 'live') saved.textContent = "Practice runs aren't saved. Play Live to get on the leaderboard.";
    else if (!who.signedIn) saved.textContent = 'Sign in to save your runs.';
    else {
      saved.textContent = 'Saving your run…';
      const reply = await P.saveScore(data.stats);
      if (lastEnd !== data) return;
      if (reply.ok) saved.textContent = reply.result?.improved ? `New best! You're #${reply.result.rank}.` : `Saved. Your best run is still #${reply.result?.rank ?? '?'}.`;
      else saved.textContent = `Couldn't save: ${reply.error || 'unknown error'}`;
    }
    await showBoard($('results-board'));
  }

  // ----- input -----

  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointer = new THREE.Vector2();
  const hit = new THREE.Vector3();
  let dragging = false;

  // Where you tapped, and a ring under you so you can find yourself.
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 20), new THREE.MeshBasicMaterial({ color: '#d8fd71', transparent: true, opacity: 0.9, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.05;
  marker.visible = false;
  scene.add(marker);
  const meRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 24), new THREE.MeshBasicMaterial({ color: '#d8fd71', depthWrite: false }));
  meRing.rotation.x = -Math.PI / 2;
  meRing.position.y = 0.04;

  function walkToPointer(e) {
    if (!runner) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(ground, hit)) return;
    runner.walkTo(hit.x, hit.z);
    marker.position.set(runner.me.tx, 0.05, runner.me.tz);
    marker.visible = true;
  }
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture?.(e.pointerId);
    walkToPointer(e);
  });
  canvas.addEventListener('pointermove', (e) => dragging && walkToPointer(e));
  const stopDrag = () => (dragging = false);
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  const keys = new Set();
  const KEY_DIRS = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  addEventListener('keydown', (e) => {
    if (!runner) return;
    if (KEY_DIRS[e.code]) {
      keys.add(e.code);
      e.preventDefault();
    } else if (e.code === 'Space') {
      e.preventDefault();
      cheer();
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function steerWithKeys() {
    if (!runner || !keys.size) return;
    let dx = 0;
    let dz = 0;
    for (const k of keys) {
      dx += KEY_DIRS[k][0];
      dz += KEY_DIRS[k][1];
    }
    const len = Math.hypot(dx, dz);
    if (!len) return;
    const me = runner.me;
    runner.walkTo(me.x + (dx / len) * 1.2, me.z + (dz / len) * 1.2);
    marker.visible = false;
  }

  let lastCheer = 0;
  function cheer() {
    if (!runner || performance.now() - lastCheer < 1000) return;
    lastCheer = performance.now();
    runner.me.char.cheer();
    room?.send({ type: 'wave' });
  }
  $('cheer').onclick = cheer;

  // ----- HUD -----

  const cornerEls = A.LETTERS.map((letter, i) => {
    const el = document.createElement('div');
    el.className = 'corner';
    el.innerHTML = '<span class="letter"></span><span class="text"></span><span class="count"></span>';
    el.children[0].textContent = letter;
    el.children[0].style.background = A.COLORS[i];
    $('corners').append(el);
    return el;
  });
  const anchor = new THREE.Vector3();
  const set = (el, prop, value) => {
    if (el[prop] !== value) el[prop] = value;
  };

  function updateHud(s) {
    const st = runner.state;
    const me = runner.me;
    const inLobby = s.phase === 'lobby';
    $('lobby').hidden = !inLobby;
    $('hud').hidden = inLobby;
    if (inLobby) {
      set($('lobby-count'), 'textContent', String(Math.ceil(s.left / 1000)));
      const humans = runner.list.filter((p) => !p.bot).length;
      set($('lobby-text'), 'textContent', runner.mode === 'practice'
        ? 'Practice show starting. Stay in the arena!'
        : `Next show starting · ${humans} player${humans === 1 ? '' : 's'} here. Stay in the arena to play!`);
    }

    const q = runner.question(s.round);
    const result = st.results[s.round];
    const showQ = q && (s.phase === 'question' || s.phase === 'reveal' || s.phase === 'results');
    $('question-card').hidden = !showQ;
    if (q) {
      set($('round-label'), 'textContent', `Round ${s.round + 1}/${C.ROUNDS}`);
      const type = $('type-label');
      set(type, 'textContent', TYPE_INFO[q.type].label);
      set(type, 'className', `pill type ${q.type}`);
      const alive = runner.list.filter((p) => p.active).length;
      set($('alive-label'), 'textContent', st.lateJoin ? 'Spectating' : `${alive} still in`);
      set($('category'), 'textContent', q.category);
      set($('question-text'), 'textContent', q.q);
      const left = s.phase === 'question' ? (C.LOCK_AT - s.rt) / (C.LOCK_AT - C.READY_END) : 0;
      $('timer-fill').style.transform = `scaleX(${Math.max(0, left).toFixed(3)})`;
    }

    // Corner labels with live headcounts.
    const counts = result ? result.counts : runner.counts();
    const myZone = A.zoneOf(me.x, me.z);
    cornerEls.forEach((el, i) => {
      if (!showQ) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      set(el.children[1], 'textContent', q.options[i]);
      set(el.children[2], 'textContent', String(counts[i]));
      const state = result ? (result.surviving.includes(i) ? ' win' : ' lose') : '';
      set(el, 'className', `corner${state}${myZone === i && !A.inStands(me.z) ? ' mine' : ''}`);
      // Beside the arena, level with the corner, so labels never cover players or the question.
      // On narrow screens there's no room beside the arena, so they sit just inside its edge.
      const c = A.cornerCenter(i);
      const narrow = innerWidth < 700;
      const left = c.x < 0;
      anchor.set(Math.sign(c.x) * (narrow ? A.HALF - 0.5 : A.HALF + 1), 0, c.z + (narrow ? Math.sign(c.z) * 4 : 0)).project(camera);
      const shift = left === narrow ? '0' : '-100%';
      el.style.transform = `translate(${shift}, -50%)${result && result.surviving.includes(i) ? ' scale(1.08)' : ''}`;
      const x = (anchor.x * 0.5 + 0.5) * innerWidth;
      const y = Math.max(40, Math.min(innerHeight - 90, (-anchor.y * 0.5 + 0.5) * innerHeight));
      el.style.left = `${x.toFixed(0)}px`;
      el.style.top = `${y.toFixed(0)}px`;
    });

    if (s.phase === 'question') world.setPads(['live', 'live', 'live', 'live']);
    else if (result) world.setPads([0, 1, 2, 3].map((i) => (result.surviving.includes(i) ? 'win' : 'lose')));
    else world.setPads(['idle', 'idle', 'idle', 'idle']);

    if (s.phase === 'results' && myOutcome) {
      banner(...myOutcome, C.ROUND_MS - C.REVEAL_END);
      myOutcome = null;
    }

    const status = $('status');
    if (st.lateJoin) {
      set(status, 'textContent', 'Spectating · next show soon');
      set(status, 'className', 'status');
    } else if (inLobby) {
      set(status, 'textContent', A.inStands(me.z) ? 'Walk into the arena to play' : "You're in for the next show");
      set(status, 'className', 'status in');
    } else if (me.active) {
      set(status, 'textContent', "You're still in!");
      set(status, 'className', 'status in');
    } else if (me.inShow) {
      set(status, 'textContent', 'In the stands · answer for points');
      set(status, 'className', 'status out');
    } else {
      set(status, 'textContent', 'Watching');
      set(status, 'className', 'status');
    }

    if (marker.visible && Math.hypot(me.tx - me.x, me.tz - me.z) < 0.2) marker.visible = false;
  }

  // ----- loop -----

  let last = performance.now();
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.25, (t - last) / 1000); // generous cap so slow phones still keep pace with the clock
    last = t;
    if (runner) {
      steerWithKeys();
      const s = runner.update(dt);
      sendMove(false);
      updateHud(s);
    } else if (preview) {
      preview.root.rotation.y = Math.sin(t / 1600) * 0.5;
      if (Math.floor(t / 4000) !== Math.floor((t - dt * 1000) / 4000)) preview.cheer();
      preview.update(dt, false);
    }
    world.tick(t / 1000);
    const k = 1 - Math.exp(-dt * 3);
    cam.pos.lerp(cam.wantPos, k);
    cam.look.lerp(cam.wantLook, k);
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
    renderer.render(scene, camera);
  }

  resize();
  cam.pos.copy(cam.wantPos);
  cam.look.copy(cam.wantLook);
  updateCard();
  updatePreview();
  refreshPlayer();
  C.syncClock();
  requestAnimationFrame(loop);
})();
