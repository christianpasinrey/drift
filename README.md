# DRIFT — Open Water

A real-time WebGL ocean you sail on — with everyone else. Physically-simulated
Gerstner swells, a full day–night sky, a little sailboat you steer with the
keyboard, and a shared multiplayer sea: other sailors' boats, global + private
chat, and bombs to sink each other. Vanilla HTML/CSS/JS + Three.js (loaded from
CDN via import maps — no build step) plus a tiny Node WebSocket world server.

## Run it

The Node server serves the site *and* hosts the shared sea:

```bash
cd drift/server
npm install
node server.js
# then open http://localhost:8000 (in several tabs, if you want company)
```

No Node? Any static server still works for solo sailing (the client falls back
gracefully when no world server answers):

```bash
cd drift
python -m http.server 8000
```

You can also point the client at a remote world with `?server=wss://host`.

## What makes it real

- **One wave field, shared by GPU and CPU.** A set of Gerstner waves is defined
  once in `waves.js`. The water surface is displaced by that exact formula in the
  vertex shader, and the *same* function is sampled on the CPU to float the boat —
  so the hull sits on the real surface and pitches/rolls with the actual swell,
  never a faked sine.
- **One sky, mirrored by the sea.** A single GLSL `skyColor()` function drives both
  the sky dome and the water's reflection (Fresnel-weighted), so the ocean always
  reflects the true sky — including the sun's glitter path.
- **A full day–night cycle.** The sun arcs from sunrise through golden hour, midday,
  sunset and night. A colour palette keyed to sun elevation shifts the whole world:
  sky, sea, fog, light direction and intensity. At night the sky fills with stars
  and a moon, and the boat's stern lantern glows on the water.
- **Custom water shading:** Fresnel sky reflection, animated micro-normal sun
  glitter, foam on steep crests, subsurface back-glow when you look toward the sun
  through a wave, depth-darkened troughs, and distance fog that dissolves the sea
  into the sky. Filmic (ACES) tone mapping ties it together.
- **Procedural sound:** a low ocean wash that swells on an LFO plus a wind hiss that
  rises with the sea state — all synthesised with the Web Audio API, no audio files.
- **Life:** circling, wing-flapping gulls by day; the pennant flutters at the
  masthead.
- **A shared sea.** Everyone who connects sails the *same* world: you see their
  boats riding the same swell, name tags at the masthead, and what they say in
  global chat surfaces as a speech bubble above their hull. The sea state is
  autonomous — a slow deterministic swell keyed to wall-clock time, identical
  for every sailor — while the day–night cycle stays personal (your time of day
  is your own; it doesn't change the world).
- **Naval skirmishes.** `F` lobs a bomb ahead of your bow. The server judges the
  splash: any hull within the blast radius is sunk and respawns somewhere random.
  That includes you, if you aim badly.

## Controls

| Input | Action |
|-------|--------|
| `W A S D` / arrows | sail: throttle + rudder |
| `F` | lob a bomb ahead of the bow |
| `Enter` | open chat (pick *todos* or a boat for private messages) |
| Drag | look around |
| Scroll | zoom |
| `1`–`4` | views: deck / horizon / drone / wake |
| `T` | auto day–night cycle on/off |
| `G` | gulls on/off |
| `M` | sound on/off |
| `Space` | pause |

The slider sets **time of day** (scrubbing pauses the auto cycle). The **sea
state** is no longer yours to command — it wanders on its own from calm to heavy,
feeding the waves, the boat's motion and the wind sound.

## Files

```
index.html        markup + HUD + chat panel + import map
css/style.css     the look (deep sea · warm sun · brass · foam)
js/waves.js       Gerstner wave set + CPU sampler + GLSL generator (shared truth)
js/sky.js         shared skyColor() GLSL + day–night colour palette
js/scene.js       Three.js world: sky, ocean, boats (yours + everyone's), gulls, fx
js/audio.js       procedural sea + wind ambience (Web Audio)
js/main.js        sailing physics, camera, day–night cycle, views, HUD, render loop
js/net.js         multiplayer client: roster, chat (global/private), bombs
server/server.js  world server: static site + WebSocket relay + bomb arbitration
```

## Note

It's stylised realism, not a navigation simulator — tuned to *feel* like open water
and reward just sitting and watching the light change. Best on a real GPU, where
the sun glitter and HDR bloom come through fully.
