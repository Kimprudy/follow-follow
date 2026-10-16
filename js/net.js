// The start.ng live room: everyone in Follow Follow sees each other move and cheer.
// The protocol only carries positions and waves; see "Multiplayer" in https://start.ng/docs.md.
window.FF = window.FF || {};

(function () {
  const NEEDS_SIGN_IN = 4401;
  const ROOM_FULL = 4403;
  const OTHER_TAB = 4409;

  class LiveRoom {
    /**
     * handlers.onMessage(msg) gets welcome / join / move / wave / leave.
     * handlers.onStatus(state) gets 'connecting', 'online', 'retrying', 'full',
     * and the blocking states 'signin' and 'other-tab'.
     */
    constructor(handlers) {
      this.handlers = handlers;
      this.ws = null;
      this.tries = 0;
      this.stopped = false;
      this.timer = 0;
    }

    async connect() {
      if (this.stopped) return;
      this.handlers.onStatus(this.tries ? 'retrying' : 'connecting');
      const pass = await FF.platform.liveTicket();
      if (this.stopped) return;
      if (!pass) return this.retry('retrying');
      if (pass.error) return this.block('signin');

      const ws = new WebSocket(`${pass.url}?ticket=${encodeURIComponent(pass.ticket)}`);
      this.ws = ws;
      ws.addEventListener('message', (e) => {
        if (this.ws !== ws) return;
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'welcome') {
          this.tries = 0;
          this.handlers.onStatus('online');
        }
        this.handlers.onMessage(msg);
      });
      ws.addEventListener('close', (e) => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.stopped) return;
        if (e.code === NEEDS_SIGN_IN) return this.block('signin');
        if (e.code === OTHER_TAB) return this.block('other-tab');
        this.retry(e.code === ROOM_FULL ? 'full' : 'retrying');
      });
    }

    retry(state) {
      if (this.stopped) return;
      this.handlers.onStatus(state);
      const delay = Math.min(15000, 1000 * 2 ** this.tries++);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.connect(), delay);
    }

    block(state) {
      this.stopped = true;
      this.handlers.onStatus(state);
    }

    get online() {
      return this.ws?.readyState === WebSocket.OPEN;
    }

    send(msg) {
      if (this.online) this.ws.send(JSON.stringify(msg));
    }

    /** Joins again after being blocked (e.g. "Play here" after opening another tab). */
    rejoin() {
      this.stopped = false;
      this.tries = 0;
      this.connect();
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.timer);
      const ws = this.ws;
      this.ws = null;
      ws?.close();
    }
  }

  FF.LiveRoom = LiveRoom;
})();
