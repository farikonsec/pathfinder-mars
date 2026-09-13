# PATHFINDER · Mars

A browser spaceflight game. Arrive at Mars from deep space, capture into orbit, survive atmospheric entry, fly over measured terrain and land a spaceplane at Jezero Base.

**Play:** https://farikonsec.github.io/pathfinder-mars/

It runs entirely in the browser (WebGL, no backend). A desktop browser with a GPU works best.

## What's in it

- **Real Mars terrain.** NASA MOLA elevation data with a high-resolution Valles Marineris strip, and procedural detail close to the ground. Olympus Mons, the canyons, the major craters and every surface mission's landing site sit at their published coordinates.
- **Flight model.** Lift and drag, fly-by-wire attitude control, entry heating on the belly shield, hover jets, landing gear, and a fictional 30 g torch drive for vacuum.
- **Starts.** Deep-space arrival, low orbit, atmospheric entry, Olympus Mons, the Valles Marineris canyon run, Jezero Base approach and pad, Phobos and Deimos.
- **Missions.** First landing, Supply hop, Canyon courier, Storm landing, Night landing, and From deep space to Jezero, each scored gold, silver or bronze on time, fuel, touchdown and precision.
- **Weather and light.** Wind and gusts, dust devils, dust storms, sunrise to night, and dust from engines and touchdowns.
- **Jezero Base.** A fictional first human settlement near Perseverance's landing site, with landing pads, habitats, greenhouse farms and a solar field.

## Controls

W/S pitch, A/D roll, Q/E yaw (or drag with the mouse). Shift/Ctrl throttle, Z full, X cut, R/F hover jets, G gear, V descent assist, B entry attitude, M torch, T assisted/Newtonian, C camera, H clean view, Space pause. The Flight guide button in the game explains the rest.

## Develop

```bash
bun install
bun run dev
```

`bun run check` runs the unit tests and a production build. The build uses relative paths, so `dist/` can be hosted from any static host or subfolder.

## Credits

Mars imagery and elevation data are credited in [`public/textures/CREDITS.md`](public/textures/CREDITS.md). The hull lettering uses RAHIMLI STENCIL (`src/rahimli-font.ts`), a stencil typeface drawn for Farhad Rahimli. The music, "Red Horizon", is an original 8-bit score synthesised live in the browser.
