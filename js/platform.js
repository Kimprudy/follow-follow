// Talks to start.ng through its hidden connect page (see https://start.ng/docs.md).
// The game never sees passwords, emails or the player's start.ng sign-in.
window.FF = window.FF || {};

(function () {
  // start.ng only answers games served from *.start.ng. Anywhere else (a local file,
  // a dev server) there is no start.ng, so the game runs as a guest in practice mode.
  const START_NG = location.hostname.endsWith('.start.ng') ? 'https://start.ng' : null;
  const API = 'https://api.start.ng';
  const GAME = location.hostname.split('.')[0];

  // After signing in, start.ng sends players back with a game session in the address. Phone
  // browsers often hide start.ng's sign-in from the hidden connect frame, so we keep the session
  // and use the HTTP API whenever the connect page doesn't know the player.
  const SESSION_KEY = 'startng_session';
  let freshSession = null;
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get(SESSION_KEY)) {
    try {
      sessionStorage.setItem(SESSION_KEY, params.get(SESSION_KEY));
    } catch {
      // Storage blocked: the session still works for this page load.
    }
    freshSession = params.get(SESSION_KEY);
    history.replaceState(null, '', location.pathname + location.search); // remove it from the address bar
  }
  function session() {
    try {
      return sessionStorage.getItem(SESSION_KEY) || freshSession || null;
    } catch {
      return freshSession || null;
    }
  }
  function dropSession() {
    freshSession = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // nothing to drop
    }
  }

  /** Calls the start.ng API with the game session. Resolves to { status, body }. */
  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    const s = session();
    if (s) headers.Authorization = `Bearer ${s}`;
    if (body) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(`${API}/games/${GAME}${path}`, { method, headers, body: body && JSON.stringify(body) });
      if (res.status === 401) dropSession();
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch {
      return { status: 0, body: null };
    }
  }

  // Shown for guests when start.ng can't tell us its guest look (e.g. opened as a local file).
  const GUEST_STYLE = {
    body: 'male', primaryColor: '#d8fd71', secondaryColor: '#292a23', skinColor: '#a0662f',
    hairColor: '#17120f', hair: 'short', hat: 'none', accessory: 'none',
  };

  let frame;
  function connectFrame() {
    frame ??= new Promise((resolve, reject) => {
      const el = document.createElement('iframe');
      el.src = `${START_NG}/connect`;
      el.hidden = true;
      el.title = 'start.ng connection';
      el.addEventListener('load', () => resolve(el), { once: true });
      el.addEventListener('error', reject, { once: true });
      document.body.append(el);
    });
    return frame;
  }

  // Sends a message to start.ng/connect and resolves to its reply, or null if start.ng
  // isn't reachable or didn't answer in time.
  async function ask(message, replyType, timeoutMs = 5000) {
    if (!START_NG) return null;
    let el;
    try {
      el = await connectFrame();
    } catch {
      return null;
    }
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2);
      const done = (reply) => {
        clearTimeout(timer);
        removeEventListener('message', onMessage);
        resolve(reply);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      function onMessage(e) {
        // Only trust replies from start.ng's own frame.
        if (e.origin !== START_NG || e.source !== el.contentWindow) return;
        if (e.data?.type === replyType && e.data.requestId === requestId) done(e.data);
      }
      addEventListener('message', onMessage);
      el.contentWindow.postMessage({ ...message, requestId }, START_NG);
    });
  }

  /**
   * Who's playing: { user, guest, signedIn, online }. `user` is { id, name, account, style, face }
   * or null; `guest` is start.ng's guest look. Never throws.
   */
  async function whoami() {
    const reply = await ask({ type: 'startng:whoami' }, 'startng:user');
    const guest = reply?.guest ?? { name: 'Guest', style: GUEST_STYLE, face: null };
    let user = reply?.user ?? null;
    if (!user && START_NG && session()) {
      const res = await api('/player');
      if (res.status === 200 && res.body?.id) {
        user = { id: res.body.id, name: res.body.name, account: null, style: res.body.style, face: null };
      }
    }
    return { user, guest, signedIn: !!user, online: !!reply || !!user };
  }

  /** Calls fn(whoamiResult) when the player comes back to this tab: they may have signed in or out. */
  function onPlayerChange(fn) {
    const recheck = async () => {
      if (document.visibilityState !== 'visible') return;
      const who = await whoami();
      if (who.online) fn(who); // ignore a check that failed rather than signing the player out
    };
    document.addEventListener('visibilitychange', recheck);
    addEventListener('focus', recheck);
  }

  function signIn() {
    if (!START_NG) return;
    location.href = `${START_NG}/?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
  }

  /** Saves a run: stats must be exactly the keys in startng.json, as whole numbers. */
  async function saveScore(stats) {
    const clean = {};
    for (const key of ['rounds', 'correct', 'outlasted']) {
      clean[key] = Math.max(0, Math.min(1e9, Math.round(stats[key] || 0)));
    }
    const reply = await ask({ type: 'startng:score', stats: clean }, 'startng:scoreSaved', 8000);
    if (reply?.ok || !session()) return reply ?? { ok: false, error: 'start.ng did not answer' };
    const res = await api('/scores', { method: 'POST', body: { stats: clean } });
    if (res.status === 200) return { ok: true, result: res.body };
    return { ok: false, error: res.status === 401 ? 'Sign in again to save your score' : res.body?.detail || 'Could not save' };
  }

  /** The top players, or null when start.ng isn't reachable. */
  async function leaderboard(limit = 10) {
    const reply = await ask({ type: 'startng:leaderboard', limit }, 'startng:leaderboardData', 8000);
    if (reply?.ok) return reply.entries;
    if (!START_NG) return null;
    const res = await api(`/leaderboard?limit=${limit}`);
    return res.status === 200 && Array.isArray(res.body) ? res.body : null;
  }

  /** A one-minute ticket into the live room: { ticket, url }, { error }, or null if no answer. */
  async function liveTicket() {
    const reply = await ask({ type: 'startng:ticket' }, 'startng:ticketData', 8000);
    if (reply?.ok) return { ticket: reply.ticket, url: reply.url };
    if (session()) {
      const res = await api('/ticket', { method: 'POST' });
      if (res.status === 200 && res.body?.ticket) {
        return { ticket: res.body.ticket, url: res.body.url || `wss://api.start.ng/games/${GAME}/live` };
      }
    }
    if (!reply) return null;
    return { error: reply.error || 'no ticket' };
  }

  FF.platform = {
    available: !!START_NG,
    isGuestLink: new URLSearchParams(location.search).has('guest'),
    GUEST_STYLE,
    whoami,
    onPlayerChange,
    signIn,
    saveScore,
    leaderboard,
    liveTicket,
  };
})();
