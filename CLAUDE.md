# Custom Gun Game

Browser game (plain HTML/JS/canvas, no build step). Open `index.html` to play.
Live: https://ulfur2012.github.io/customgungame/ — repo `ulfur2012/customgungame`, GitHub Pages from `main`.
Pushing to `main` redeploys in ~1 minute. The user is fine with commit + push after each change.

The user gives short, informal requests (often with typos) and wants things built without
clarifying questions — make a sensible call, then say what was assumed. The user will provide art later.

## Files
- `js/config.js` — all tuning: GUNS (main/secondary), PARTS per slot, STATS, ENEMIES, MAP layouts
  (seeded generator: straight/L walls, houses with 2-3 doors, 2-4 empty 8x8 areas, maze), HEALTH_PACK,
  AMMO, ABILITIES, ABILITY_CRATE, PING, LOADOUT_PRESETS. Art paths are filled in at the bottom.
- `js/core.js` — geometry, gun layout/stats (`computeStats`), Rules (host-banned parts), local accounts.
- `js/input.js` — PC (WASD, mouse, R reload, Q/1/2 swap, E ability) and mobile twin sticks.
- `js/net.js` — PeerJS P2P; host relays all messages. `js/game.js` — the round (SP + MP).
- `js/ui.js` — screens: login/sign up → menu → loadout builder → game; host setup + lobby.

## Game rules decided with the user
- Stats: damage, knockback (each point = 0.1s between shots, also pushes targets), reload time,
  mag size, loudness (x120 = hearing radius). Silencers cut loudness 80% and worsen one stat each.
- Main gun: up to 5 parts per slot; slots body (shotgun/AK/sniper), barrel, mag, handle, stock,
  silencer, bullets. Sidearm: no barrel, 2 small mags, 2 handles, 1 stock, 3 silencers,
  bodies flare gun (1 in chamber, 50 dmg, 6s reload, 3 shots + 1 per ammo box only when main is full)
  and revolver (6 shots). Sidearms are more accurate.
- Bullets: bouncing (4 wall bounces), armor piercing, boom (5 dmg blast on walls); specials do 20% less damage.
- Limited ammo: 3 spare mags; ammo boxes give 1 mag to main first, both if both need it, work while reloading.
- Abilities (pick 1, 2 uses per round, RPG only 1): grenade (arcs over walls, white path line while
  holding E), shield (200 HP, blue bar, 7s), regen (passive, +10 HP per 10s out of combat), RPG,
  energy drink (+10 HP, 1.7x speed), burger (+100 HP). Red crates and boss kills restore abilities.
- Hearing: unsilenced shots nearby = yellow screen edge, strongest toward the shot. Damage = red edge.
- No natural healing; green + packs (+20) spawn 3 every 30s.
- Mobile: fixed move stick bottom-left; aim stick auto-fires when an enemy is in the aim area
  (wider for AK/shotgun, thin for sniper). PC shows the aim area outline but never auto-fires.
- Line of sight: you can't see past walls. Health bar sits above the player (middle of screen).
- Single player: waves, boss every 5th wave (paths only through 2-wide areas), enemies pathfind to you,
  "enemies left" counter.
- Multiplayer: host picks FFA/teams (random), walls few/medium/MAZE, banned upgrades.
  Name tags blue = team, red = enemy. Every 3 min, players not in combat get pinged toward enemies.
  Maps must be identical in every browser (no random-comparator sorts in the generator).

## Testing
Headless Edge + puppeteer-core scripts were used (not kept in the repo). `Game.debugState` exposes
the round state for tests.
