// ═══════════════════════════════════════════════════════════
//  DRIFT — world server
//  Serves the static site and runs the shared sea over WebSocket:
//  player roster, position relay, global + private chat, bombs
//  (server-authoritative hits) and random respawns.
//
//    cd server && npm install && node server.js
// ═══════════════════════════════════════════════════════════

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8000;
const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/plain; charset=utf-8",
};

// ── static files ──
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

// ── shared sea ──
const wss = new WebSocketServer({ server });
const players = new Map();   // ws → { id, name, color, x, z, h, s, lastBomb }
let nextId = 1;

const COLORS = [0xb44b32, 0x3a7ca5, 0x5a8f4e, 0xc2a23a, 0x8e5aa5, 0xd07840, 0x4aa58e, 0xa54a6e];
const BOMB_RANGE = 40;       // max throw distance
const BLAST_RADIUS = 7;      // sink anything this close to the splash
const BOMB_COOLDOWN_MS = 2300;

const cast = (msg, except) => {
  const s = JSON.stringify(msg);
  for (const ws of players.keys()) if (ws !== except && ws.readyState === 1) ws.send(s);
};
const sanitize = (s, n) => String(s || "").replace(/[\x00-\x1f<>]/g, "").slice(0, n).trim();
const num = (v) => (Number.isFinite(+v) ? +v : 0);

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const p = players.get(ws);

    if (m.t === "hello" && !p) {
      const id = nextId++;
      const me = {
        id, name: sanitize(m.name, 18) || `marinero-${id}`,
        color: COLORS[id % COLORS.length],
        x: (Math.random() - 0.5) * 160, z: (Math.random() - 0.5) * 160,
        h: 0, s: 0, lastBomb: 0,
      };
      players.set(ws, me);
      ws.send(JSON.stringify({
        t: "welcome", id, name: me.name, color: me.color, x: me.x, z: me.z,
        players: [...players.values()].filter((q) => q.id !== id)
          .map((q) => ({ id: q.id, name: q.name, color: q.color, x: q.x, z: q.z, h: q.h })),
      }));
      cast({ t: "join", id, name: me.name, color: me.color, x: me.x, z: me.z, h: 0 }, ws);
      console.log(`+ ${me.name} (${players.size} a bordo)`);
      return;
    }
    if (!p) return;

    if (m.t === "pos") {
      p.x = num(m.x); p.z = num(m.z); p.h = num(m.h); p.s = num(m.s);
      cast({ t: "pos", id: p.id, x: p.x, z: p.z, h: p.h, s: p.s }, ws);

    } else if (m.t === "chat") {
      const text = sanitize(m.text, 140);
      if (!text) return;
      const out = { t: "chat", id: p.id, name: p.name, text };
      if (m.to) {
        out.to = num(m.to);   // private: only the chosen boat and the sender
        for (const [w, q] of players)
          if ((q.id === out.to || q.id === p.id) && w.readyState === 1) w.send(JSON.stringify(out));
      } else {
        cast(out);            // global: everyone, sender included (echo confirms)
      }

    } else if (m.t === "bomb") {
      const now = Date.now();
      if (now - p.lastBomb < BOMB_COOLDOWN_MS) return;
      p.lastBomb = now;
      const x0 = num(m.x0), z0 = num(m.z0);
      let x1 = num(m.x1), z1 = num(m.z1);
      const d = Math.hypot(x1 - x0, z1 - z0);
      if (d > BOMB_RANGE) { x1 = x0 + ((x1 - x0) * BOMB_RANGE) / d; z1 = z0 + ((z1 - z0) * BOMB_RANGE) / d; }
      const dur = 0.9 + Math.hypot(x1 - x0, z1 - z0) * 0.025;
      cast({ t: "bomb", id: p.id, x0, z0, x1, z1, dur });
      setTimeout(() => {
        const victims = [];
        for (const q of players.values()) {
          if (Math.hypot(q.x - x1, q.z - z1) < BLAST_RADIUS) {
            const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 120;
            q.x = x1 + Math.cos(a) * r;
            q.z = z1 + Math.sin(a) * r;
            victims.push({ id: q.id, name: q.name, rx: q.x, rz: q.z });
          }
        }
        if (victims.length) cast({ t: "boom", x: x1, z: z1, victims });
      }, dur * 1000);
    }
  });

  ws.on("close", () => {
    const p = players.get(ws);
    if (!p) return;
    players.delete(ws);
    cast({ t: "leave", id: p.id, name: p.name });
    console.log(`- ${p.name} (${players.size} a bordo)`);
  });
});

server.listen(PORT, () => console.log(`DRIFT a flote → http://localhost:${PORT}`));
