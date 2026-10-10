# Custom Gun Game

Browser game (plain HTML/JS/canvas, no build step). Open `index.html` to play.
Live: https://ulfur2012.github.io/customgungame/ — repo `ulfur2012/customgungame`, GitHub Pages from `main`.
Pushing to `main` redeploys in ~1 minute. Bump the `?v=N` on the script/css tags in index.html every change
(browser cache). The user is fine with commit + push after each change. Do NOT open the live page
after an update — only open it when the user asks (then `Start-Process` the URL with the current `?v=N`).

Everything must be phone friendly (touch controls, small screens) — check a phone-size screenshot before pushing.
The user gives short, informal requests (often with typos, sometimes several in a row while you work)
and wants things built without clarifying questions — make a sensible call, then say what was assumed.
The user will provide art later (icons/sprites are simple placeholder shapes for now).

## Files
- `js/config.js` — all tuning: GUNS, PARTS per slot (incl. `extra` slot), STATS, ENEMIES (+ newer ones with
  `from`/`weight`), BOSSES/CREATOR, MAP (sizes small/medium/large, layouts), HEALTH_PACK, AMMO (boxes hold 3
  mags), ABILITIES, ABILITY_ICONS (shape names), ABILITY_GROUPS (Ability-tab sections), ABILITY_PERKS
  (per-ability boosts), COMBOS + COMBO numbers, MERGE (3 buildings → big; turrets → rocket turret →
  railgun), ULTIMATES, ULT_AFFINITY, EPIC_CRATE, SLOT3_WAVE/SLOT4_WAVE.
- `js/core.js` — geometry, gun layout/stats (`computeStats`), ICON_SHAPES + `abilityIconSVG`/`drawAbilityIcon`,
  Rules (host-banned parts), local accounts (stay logged in via `cgg.session`), Settings (mobile, light mode).
- `js/input.js` — PC (WASD, mouse, R reload, Q/1/2 swap, E/C/V/B abilities, F ultimate) + mobile buttons.
- `js/net.js` — PeerJS P2P; host relays all messages. `js/game.js` — the round (SP + MP).
- `js/ui.js` — login → menu → loadout builder (Main/Sidearm/Ability tabs) → game; host setup + lobby.

## Game rules decided with the user
- Stats: damage, knockback (each point = 0.1s between shots), reload, mag size, loudness (x120 = hearing).
- Every placeable ability must be THROWN (hold = aim arc, release = throw; mark `thrown: true`), never dropped.
- Buildings (turret, radar, tesla, barrier) last until destroyed, snap to the grid, 3 of a kind merge.
- Ability slots: 1 = E, 2 = C, 3 = V from wave 20, 4 = B from wave 30 (SP; all 4 in Test mode).
  Slot state is swapped into `me` (`swapAlt('alt'|'alt3'|'alt4')`) so ability code works for every slot.
  Passives work from any slot (`hasAb`). Weak abilities (`respawn`) get a use back every 30s.
- After a boss in SP the game pauses on an abilities-only picker. Bosses every 10 waves, CREATOR at 100.
- Decoys (buddies): 25 HP, last forever, max 5 active, enemies treat them like the player (closest visible).
  They run out of ammo (mag + 1 spare) and seek ammo/health. Supply Decoy (a decoy thrown onto a Resupply
  crate) delivers 3 mags to each decoy, else follows the nearest decoy / you if you need ammo.
  Medic Buddy stays with the other decoys.
- You can't see enemies/enemy players unless there's line of sight to their middle (`canSee`).
- Multiplayer damage is worked out by whoever gets hit; gadgets are synced with `gad`/`gadx`/`gadc`/`gadm`.
- Maps must be identical in every browser (no random-comparator sorts in the generator).
- Single player Test mode: pause menu has change loadout, spawn ultimate crate, infinite ability.

## Testing
Headless Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) + puppeteer-core scripts
(install puppeteer-core in a scratch folder; not kept in the repo). `Game.debugState` exposes the round state.
Typical test: sign up a throwaway account, `buildMap(...)`, hide `.screen`s, `Game.startSP(true)`, then drive
keys/mouse and read `Game.debugState`. Screenshot to check visuals.
