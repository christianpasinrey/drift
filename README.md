# DRIFT — Open Water

A real-time WebGL ocean you float on. Physically-simulated Gerstner swells, a full
day–night sky, and a little sailboat that genuinely rides the waves. Vanilla
HTML/CSS/JS + Three.js (loaded from CDN via import maps — no build step).

## Run it

ES modules need to be served over HTTP (not `file://`):

```bash
cd drift
python -m http.server 8000
# then open http://localhost:8000
```

Or drop it under Laragon and visit `http://drift.test`.

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

## Controls

| Input | Action |
|-------|--------|
| Drag | look around |
| Scroll | zoom |
| `1`–`4` | views: deck / horizon / drone / wake |
| `A` | auto day–night cycle on/off |
| `G` | gulls on/off |
| `S` | sound on/off |
| `Space` | pause |

Sliders set **time of day** (scrubbing pauses the auto cycle) and **sea state**
(calm → heavy), which feeds the waves, the boat's motion and the wind sound.

## Files

```
index.html      markup + HUD + import map
css/style.css   the look (deep sea · warm sun · brass · foam)
js/waves.js     Gerstner wave set + CPU sampler + GLSL generator (shared truth)
js/sky.js       shared skyColor() GLSL + day–night colour palette
js/scene.js     Three.js world: sky dome, ocean shader, boat, gulls, lighting
js/audio.js     procedural sea + wind ambience (Web Audio)
js/main.js      camera, day–night cycle, views, HUD, render loop
```

## Note

It's stylised realism, not a navigation simulator — tuned to *feel* like open water
and reward just sitting and watching the light change. Best on a real GPU, where
the sun glitter and HDR bloom come through fully.
