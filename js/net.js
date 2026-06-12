// ═══════════════════════════════════════════════════════════
//  DRIFT — multiplayer client (WebSocket)
//  One shared sea: every sailor's boat, a global chat whose lines
//  also surface above the speaking boat, private boat-to-boat chat,
//  and bombs. Falls back to solo sailing if no server answers.
// ═══════════════════════════════════════════════════════════

export class Net {
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;            // { getNav(), onRespawn(x, z) }
    this.ws = null;
    this.id = null;
    this.name = "";
    this.players = new Map();      // id → { name, color }
    this.posTimer = 0;
    this.bombCool = 0;
    this.retry = 2;
    this._wireUI();
  }

  // ───────── connection ─────────
  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = new URLSearchParams(location.search).get("server") || `${proto}://${location.host}`;
    try { this.ws = new WebSocket(url); } catch { return this._down(); }
    this.ws.onopen = () => {
      this.retry = 2;
      this.ws.send(JSON.stringify({ t: "hello", name: localStorage.getItem("drift-name") || "" }));
    };
    this.ws.onmessage = (ev) => { try { this._on(JSON.parse(ev.data)); } catch {} };
    this.ws.onclose = () => this._down();
    this.ws.onerror = () => {};
  }
  _down() {
    if (this.id !== null) {
      for (const id of this.players.keys()) this.scene.removeRemote(id);
      this.players.clear();
      this._roster();
    }
    this.id = null;
    this._status();
    setTimeout(() => this.connect(), this.retry * 1000);
    this.retry = Math.min(30, this.retry * 2);
  }

  get online() { return this.id !== null && this.ws && this.ws.readyState === 1; }

  // ───────── per-frame ─────────
  tick(dt) {
    this.bombCool = Math.max(0, this.bombCool - dt);
    if (!this.online) return;
    this.posTimer -= dt;
    if (this.posTimer <= 0) {
      this.posTimer = 0.12;       // ~8 Hz position updates
      const n = this.hooks.getNav();
      this.ws.send(JSON.stringify({
        t: "pos",
        x: +n.x.toFixed(2), z: +n.z.toFixed(2),
        h: +n.heading.toFixed(3), s: +n.speed.toFixed(2),
      }));
    }
  }

  // bomb lobbed ahead of the bow, slight scatter; server decides who sinks
  sendBomb(nav) {
    if (!this.online || this.bombCool > 0) return;
    this.bombCool = 2.5;
    const x1 = nav.x + Math.cos(nav.heading) * 28 + (Math.random() - 0.5) * 6;
    const z1 = nav.z - Math.sin(nav.heading) * 28 + (Math.random() - 0.5) * 6;
    this.ws.send(JSON.stringify({ t: "bomb", x0: nav.x, z0: nav.z, x1, z1 }));
  }

  // ───────── inbound ─────────
  _on(m) {
    const S = this.scene;
    switch (m.t) {
      case "welcome": {
        this.id = m.id;
        this.name = m.name;
        localStorage.setItem("drift-name", m.name);
        this.hooks.onRespawn(m.x, m.z);
        for (const p of m.players) this._join(p, true);
        this._status();
        this._sys(`a bordo como «${m.name}»`);
        break;
      }
      case "join":
        this._join(m);
        this._sys(`⛵ ${m.name} se hace a la mar`);
        break;
      case "leave": {
        const p = this.players.get(m.id);
        if (p) this._sys(`${p.name} vuelve a puerto`);
        this.players.delete(m.id);
        S.removeRemote(m.id);
        this._roster(); this._status();
        break;
      }
      case "pos":
        S.updateRemote(m.id, m.x, m.z, m.h, m.s);
        break;
      case "chat": {
        const mine = m.id === this.id;
        if (m.to) {
          this._line(m.name, m.text, { dm: true, mine });
        } else {
          this._line(m.name, m.text, { mine });
          S.say(mine ? null : m.id, m.text);   // surfaces above the boat
        }
        break;
      }
      case "bomb":
        S.launchBomb(m.x0, m.z0, m.x1, m.z1, m.dur);
        break;
      case "boom":
        for (const v of m.victims) {
          if (v.id === this.id) {
            this.hooks.onRespawn(v.rx, v.rz);
            this._sys("☠ ¡tu barco se ha hundido! reapareces en otro punto");
          } else {
            const r = S.remotes.get(v.id);
            if (r) { r.fresh = true; S.updateRemote(v.id, v.rx, v.rz, r.th, 0); }
            this._sys(`☠ ${v.name} ha sido hundido`);
          }
        }
        break;
    }
  }

  _join(p, silent) {
    this.players.set(p.id, { name: p.name, color: p.color });
    this.scene.addRemote(p.id, p.name, p.color);
    this.scene.updateRemote(p.id, p.x, p.z, p.h || 0, 0);
    this._roster(); this._status();
  }

  // ───────── chat UI ─────────
  _wireUI() {
    this.$panel = document.getElementById("chat");
    this.$head = document.getElementById("chat-head");
    this.$log = document.getElementById("chat-log");
    this.$to = document.getElementById("chat-to");
    this.$input = document.getElementById("chat-input");

    this.$head.addEventListener("click", () => {
      this.$panel.classList.toggle("collapsed");
      this.$head.classList.remove("ping");
    });
    // Enter anywhere opens the chat; Enter in the box sends; Esc returns to the helm
    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && document.activeElement !== this.$input && this.online) {
        this.$panel.classList.remove("collapsed");
        this.$input.focus();
        e.preventDefault();
      }
    });
    this.$input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.$input.blur();
      if (e.key !== "Enter") return;
      const text = this.$input.value.trim();
      this.$input.value = "";
      if (!text || !this.online) { this.$input.blur(); return; }
      const to = this.$to.value;
      this.ws.send(JSON.stringify({ t: "chat", text, to: to ? +to : undefined }));
      this.$input.blur();
    });
  }

  _status() {
    const n = this.players.size;
    this.$head.textContent = this.online
      ? `⚓ ${n === 0 ? "mar abierto · solo tú" : n + (n === 1 ? " barco cerca" : " barcos cerca")}`
      : "⚓ sin conexión · navegación en solitario";
    this.$panel.classList.toggle("offline", !this.online);
  }

  _roster() {
    const cur = this.$to.value;
    this.$to.innerHTML = `<option value="">todos</option>` +
      [...this.players.entries()].map(([id, p]) => `<option value="${id}">${p.name}</option>`).join("");
    this.$to.value = [...this.players.keys()].some((id) => String(id) === cur) ? cur : "";
  }

  _line(name, text, { dm = false, mine = false } = {}) {
    const div = document.createElement("div");
    div.className = "chat-line" + (dm ? " dm" : "") + (mine ? " mine" : "");
    const who = document.createElement("b");
    who.textContent = (dm ? "✉ " : "") + name;
    div.append(who, document.createTextNode(" " + text));
    this._push(div);
  }
  _sys(text) {
    const div = document.createElement("div");
    div.className = "chat-line sys";
    div.textContent = text;
    this._push(div);
  }
  _push(div) {
    this.$log.append(div);
    while (this.$log.children.length > 60) this.$log.firstChild.remove();
    this.$log.scrollTop = this.$log.scrollHeight;
    if (this.$panel.classList.contains("collapsed")) this.$head.classList.add("ping");
  }
}
