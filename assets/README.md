# Art guide

Drop transparent PNGs at these paths. Anything missing is drawn as a coloured placeholder.
Sizes and attach points for every piece are in `js/config.js` (`w`, `h`, `anchor`, `sockets`, `hand`).

- `assets/guns/main.png`, `assets/guns/secondary.png`: gun bodies, side view, facing right
- `assets/parts/<slot>/<id>.png`: slots are barrel, mag, handle, stock, silencer.
  The ids are listed in `PARTS` in `js/config.js` (e.g. `assets/parts/silencer/red.png`).
- `assets/characters/<id>.png`: top-down, facing right, square.
  The ids are player, grunt, runner, shooter, boss.

Make each image the same aspect ratio as its `w` × `h` in the config. Any resolution works; 4× is crisp.
Set `PIXEL_ART = true` in config.js for pixel art.
