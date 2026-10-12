// =====================================================================
//  CONFIG — guns, parts, enemies, map. Your art plugs in here.
//
//  Art paths (missing files are fine — a coloured placeholder is drawn):
//    assets/guns/<main|secondary>.png        gun bodies
//    assets/parts/<slot>/<id>.png            e.g. assets/parts/barrel/long.png
//    assets/characters/<id>.png              player, grunt, runner, shooter, boss
//
//  Positions are in "gun units" from the image's top-left corner.
//    w, h     drawn size (make your art the same aspect ratio, any resolution)
//    anchor   point on the part that snaps onto its socket
//             defaults: barrel/silencer = left-middle, mag/handle = top-middle,
//             stock = right-middle
//    tip      barrel/silencer: front end where the bullet leaves
//    add/mul  stat changes. add is +/-, mul multiplies (0.5 = half)
// =====================================================================

const PIXEL_ART = false;   // true = keep pixel art crisp when scaled
const HEAR_UNIT = 120;     // loudness 1 = heard this far away (world units)
const BULLET_SPEED = 1400;
const BULLET_RANGE = 950;

const STATS = [
  { key: 'damage',     label: 'Damage',      max: 50 },
  { key: 'knockback',  label: 'Knockback',   max: 6 },
  { key: 'reloadTime', label: 'Reload time', max: 4 },
  { key: 'magSize',    label: 'Mag size',    max: 80 },
  { key: 'loudness',   label: 'Loudness',    max: 10 },
];

const SLOTS = [
  { key: 'body',     label: 'Main Body' },
  { key: 'barrel',   label: 'Barrel' },
  { key: 'mag',      label: 'Mag' },
  { key: 'handle',   label: 'Handle' },
  { key: 'stock',    label: 'Stock' },
  { key: 'silencer', label: 'Silencer' },
  { key: 'bullets',  label: 'Bullets' },
  { key: 'extra',    label: 'Extra' },
];

// The two guns you build before every round.
const GUNS = {
  main: {
    name: 'Main Gun', w: 96, h: 32, color: '#6b7380',
    shape: [[0, 0, 96, 20], [22, 18, 12, 14]],
    hand: { x: 28, y: 28 },
    sockets: { barrel: { x: 96, y: 8 }, mag: { x: 58, y: 20 }, handle: { x: 28, y: 20 }, stock: { x: 0, y: 10 } },
    base: { damage: 16, knockback: 1.5, reloadTime: 2.0, magSize: 24, loudness: 6 },
  },
  secondary: {
    name: 'Sidearm', w: 52, h: 28, color: '#80786b',
    shape: [[0, 0, 52, 16], [7, 14, 11, 14]],
    hand: { x: 12, y: 24 },
    sockets: { barrel: { x: 52, y: 6 }, mag: { x: 34, y: 16 }, handle: { x: 12, y: 16 }, stock: { x: 0, y: 7 } },
    base: { damage: 24, knockback: 3.5, reloadTime: 1.3, magSize: 8, loudness: 5 },
  },
};

// Every part has its own colour until real art is added.
// gun: which gun can use it — 'main' (default), 'secondary', or 'both'. Max 5 per slot for the main gun.
const PARTS = {
  // Main body swaps the whole gun body. Extra fields:
  //   pellets  bullets per shot      spread  how wide they fan out (radians)
  //   range    how far bullets fly   speed   bullet speed
  //   falloff  0-1, how much damage is lost at max range (shotgun = strong up close)
  //   assist   size of the mobile auto-shoot area (1 = normal, bigger = easier, smaller = thinner)
  body: [
    { id: 'shotgun', name: 'Shotgun', w: 96, h: 32, color: '#8d6e63', shape: [[0, 0, 96, 22], [22, 18, 12, 14]],
      pellets: 6, spread: 0.5, range: 400, falloff: 0.75, assist: 1.6,
      add: { knockback: 2.5, reloadTime: 0.6 }, mul: { damage: 0.75, magSize: 0.3 },
      note: '6 pellets · huge damage up close · short range' },
    { id: 'ak', name: 'AK', w: 96, h: 32, color: '#b5651d', shape: [[0, 2, 96, 16], [22, 16, 12, 16]],
      assist: 1.8, note: 'Normal gun · bigger auto-shoot area' },
    { id: 'sniper', name: 'Sniper', w: 96, h: 32, color: '#2f3640', shape: [[0, 3, 96, 14], [22, 15, 12, 17]],
      range: 2000, speed: 2400, assist: 0.35, recoil: 4,
      add: { damage: 40, knockback: 5 }, mul: { magSize: 0.25 },
      note: 'Very long range · thin auto-shoot area' },
    // sidearm bodies. fixed = stats that are set no matter what else is equipped
    // totalAmmo = all the shots you get for the whole round (no ammo boxes help beyond this)
    { id: 'flare', name: 'Flare Gun', gun: 'secondary', w: 52, h: 28, color: '#ff7b00', shape: [[0, 0, 52, 18], [7, 14, 11, 14]],
      fixed: { damage: 50, magSize: 1, reloadTime: 6 }, totalAmmo: 3, speed: 900, flare: true,
      note: '1 in the chamber · 50 damage · 6s reload · 3 shots (+1 from ammo boxes when main gun is full)' },
    { id: 'revolver', name: 'Revolver', gun: 'secondary', w: 52, h: 28, color: '#a4b0be', shape: [[0, 2, 52, 12], [16, 0, 16, 18], [7, 14, 11, 14]],
      fixed: { magSize: 6 }, add: { damage: 6, knockback: 1 },
      note: '6 shots · reloadable' },
    { id: 'machinepistol', name: 'Machine Pistol', gun: 'secondary', w: 52, h: 28, color: '#576574', shape: [[0, 2, 52, 12], [7, 12, 11, 16], [26, 12, 8, 12]],
      assist: 1.4, add: { knockback: -2.3 }, mul: { damage: 0.5, magSize: 2.25 },
      note: 'Sprays fast · 18 shots · low damage' },
    { id: 'handcannon', name: 'Hand Cannon', gun: 'secondary', w: 58, h: 30, color: '#b33939', shape: [[0, 0, 58, 16], [8, 14, 12, 16]],
      range: 1300, speed: 1900, recoil: 3, assist: 0.7, add: { damage: 26, knockback: 3 }, mul: { magSize: 0.5 },
      note: 'Huge damage · 4 shots · big kick' },
    { id: 'sawedoff', name: 'Sawed-Off', gun: 'secondary', w: 50, h: 28, color: '#6d4c41', shape: [[0, 1, 50, 8], [0, 9, 50, 8], [6, 15, 12, 13]],
      pellets: 5, spread: 0.45, range: 330, falloff: 0.7, assist: 1.6, fixed: { magSize: 2 }, add: { knockback: 1 }, mul: { damage: 0.6 },
      note: '2 shots · 5 pellets each · deadly up close' },
  ],
  barrel: [
    { id: 'short',    name: 'Short Barrel',    w: 20, h: 8,  color: '#e74c3c', add: { damage: -3, knockback: -0.4 } },
    { id: 'tactical', name: 'Tactical Barrel', w: 36, h: 9,  color: '#16a085', add: { damage: 3, knockback: -0.2 } },
    { id: 'long',     name: 'Long Barrel',     w: 60, h: 8,  color: '#3498db', add: { damage: 6, knockback: 0.4 } },
    { id: 'heavy',    name: 'Heavy Barrel',    w: 44, h: 12, color: '#9b59b6', add: { damage: 12, knockback: 1.2 } },
    { id: 'sniper',   name: 'Sniper Barrel',   w: 80, h: 7,  color: '#34495e', add: { damage: 20, knockback: 2.5 } },
  ],
  mag: [
    { id: 'quick',      name: 'Quick Mag',          w: 12, h: 16, color: '#f1c40f', add: { reloadTime: -0.7 }, mul: { magSize: 0.7 } },
    { id: 'dual',       name: 'Dual Mag',           w: 22, h: 26, color: '#27ae60', add: { reloadTime: -0.3 }, mul: { magSize: 1.3 } },
    { id: 'extended',   name: 'Extended Mag',       w: 14, h: 34, color: '#2ecc71', add: { reloadTime: 0.5 },  mul: { magSize: 1.5 } },
    { id: 'heavy',      name: 'Heavy Mag',          w: 16, h: 28, color: '#7f8c8d', add: { damage: 2, reloadTime: 0.3 }, mul: { magSize: 1.2 } },
    { id: 'drum',       name: 'Drum Mag',           w: 30, h: 30, color: '#e67e22', add: { reloadTime: 1.5 },  mul: { magSize: 2.5 } },
    { id: 'smallquick', name: 'Small Quick Mag',    w: 10, h: 12, color: '#fff200', gun: 'secondary', add: { reloadTime: -0.4 }, mul: { magSize: 0.75 } },
    { id: 'smallext',   name: 'Small Extended Mag', w: 10, h: 20, color: '#55efc4', gun: 'secondary', add: { reloadTime: 0.3 },  mul: { magSize: 1.5 } },
    { id: 'smalldrum',  name: 'Small Drum',         w: 18, h: 18, color: '#e1b12c', gun: 'secondary', add: { reloadTime: 0.8 },  mul: { magSize: 2 } },
    { id: 'speedload',  name: 'Speed Loader',       w: 12, h: 12, color: '#00d2d3', gun: 'secondary', add: { reloadTime: -0.6, damage: -2 } },
  ],
  handle: [
    { id: 'grip',   name: 'Grip Handle',   w: 14, h: 22, color: '#1abc9c', gun: 'both', add: { knockback: -0.3 } },
    { id: 'angled', name: 'Angled Handle', w: 16, h: 20, color: '#e84393', add: { knockback: -0.2, reloadTime: -0.1 } },
    { id: 'pistol', name: 'Pistol Handle', w: 13, h: 22, color: '#636e72', add: { damage: 2, knockback: -0.1 } },
    { id: 'heavy',  name: 'Heavy Handle',  w: 18, h: 24, color: '#d35400', add: { damage: 3, reloadTime: 0.2 } },
    { id: 'quick',  name: 'Quick Handle',  w: 12, h: 20, color: '#ff79c6', gun: 'both', add: { reloadTime: -0.3 } },
    { id: 'wrapped', name: 'Wrapped Grip', w: 12, h: 18, color: '#b2bec3', gun: 'secondary', add: { knockback: -0.2, reloadTime: -0.1 } },
    { id: 'pearl',   name: 'Pearl Grip',   w: 12, h: 18, color: '#f5f6fa', gun: 'secondary', add: { damage: 3, reloadTime: 0.1 } },
  ],
  stock: [
    { id: 'light',    name: 'Light Stock',    w: 32, h: 10, color: '#c0392b', add: { knockback: -0.2 } },
    { id: 'skeleton', name: 'Skeleton Stock', w: 34, h: 12, color: '#fd79a8', add: { reloadTime: -0.3 } },
    { id: 'tactical', name: 'Tactical Stock', w: 38, h: 14, color: '#00bcd4', add: { knockback: -0.1, reloadTime: -0.2 } },
    { id: 'padded',   name: 'Padded Stock',   w: 40, h: 16, color: '#6c5ce7', add: { knockback: -0.4 } },
    { id: 'heavy',    name: 'Heavy Stock',    w: 46, h: 18, color: '#a0522d', add: { knockback: -0.6, reloadTime: 0.3 } },
    { id: 'folding',  name: 'Folding Stock',  w: 22, h: 8,  color: '#fab1a0', gun: 'secondary', add: { knockback: -0.3 } },
    { id: 'brace',    name: 'Pistol Brace',   w: 26, h: 12, color: '#636e72', gun: 'secondary', add: { knockback: -0.6, reloadTime: 0.2 } },
  ],
  // Bullet types (both guns). None = normal bullets; the special ones do 20% less damage.
  bullets: [
    { id: 'bouncy',   name: 'Bouncing Bullets', gun: 'both', w: 14, h: 8, color: '#a29bfe', bounce: 4, mul: { damage: 0.8 },
      note: 'Bounce off walls up to 4 times' },
    { id: 'piercing', name: 'Armor Piercing',   gun: 'both', w: 16, h: 6, color: '#dfe6e9', pierce: true, mul: { damage: 0.8 },
      note: 'Go through enemies' },
    { id: 'boom',     name: 'Boom Bullets',     gun: 'both', w: 14, h: 8, color: '#ff7675', boom: { radius: 60, damage: 5 }, mul: { damage: 0.8 },
      note: 'Small 5 damage explosion when they hit a wall' },
  ],
  // Extra gadgets. rangeMul = how far bullets fly, speedMul = bullet speed, spreadMul = accuracy (lower = tighter)
  extra: [
    { id: 'scope',   name: 'Scope', mount: 'top',         w: 26, h: 10, color: '#74b9ff', rangeMul: 1.5, assist: 0.85,
      note: '+50% range · slightly thinner auto-shoot area' },
    { id: 'muzzle',  name: 'Muzzle Boost', mount: 'muzzle',  w: 14, h: 10, color: '#fdcb6e', gun: 'both', speedMul: 1.6, add: { loudness: 1 },
      note: 'Bullets fly 60% faster' },
    { id: 'laser',   name: 'Laser Sight', mount: 'under',   w: 18, h: 6,  color: '#ff3838', gun: 'both', spreadMul: 0.4,
      note: 'Much tighter bullet spread' },
    { id: 'trigger', name: 'Hair Trigger', mount: 'trigger',  w: 10, h: 10, color: '#00cec9', gun: 'both', add: { knockback: -0.5, damage: -2 },
      note: 'Shoots faster' },
    { id: 'reddot',  name: 'Red Dot', mount: 'top', w: 14, h: 8, color: '#eb3b5a', gun: 'secondary', rangeMul: 1.25, spreadMul: 0.7,
      note: '+25% range · a bit more accurate' },
    { id: 'hollow',  name: 'Hollow Points', mount: 'side', w: 12, h: 8,  color: '#e17055', gun: 'both', mul: { damage: 1.25, magSize: 0.8 },
      note: 'Hit harder, fewer bullets per mag' },
  ],
  // Silencers make you much quieter but each one makes one stat worse.
  silencer: [
    { id: 'red',    name: 'Red Silencer',    w: 34, h: 12, color: '#ff4757', gun: 'both', mul: { loudness: 0.2 }, add: { damage: -4 } },
    { id: 'blue',   name: 'Blue Silencer',   w: 34, h: 12, color: '#3742fa', gun: 'both', mul: { loudness: 0.2 }, add: { reloadTime: 0.5 } },
    { id: 'yellow', name: 'Yellow Silencer', w: 34, h: 12, color: '#ffa502', gun: 'both', mul: { loudness: 0.2 }, add: { knockback: 0.5 } },
    { id: 'green',  name: 'Green Silencer',  w: 34, h: 12, color: '#2ed573', mul: { loudness: 0.2, magSize: 0.75 } },
    { id: 'tiny',   name: 'Tiny Suppressor', w: 18, h: 9,  color: '#a4b0be', gun: 'secondary', mul: { loudness: 0.4 }, add: { damage: -2 } },
    { id: 'black',  name: 'Black Silencer',  w: 40, h: 13, color: '#2d3436', mul: { loudness: 0.1 }, add: { damage: -6 } },
  ],
};

// Single player enemies. size = drawn size, r = hitbox radius.
// Enemies with `gun` shoot at you (and you can hear them).
const ENEMIES = {
  grunt:   { size: 40, r: 16, color: '#e05555', hp: 40,   speed: 115, melee: 12, score: 10 },
  // early game: a guy with a plain revolver (6 shots, then reloads)
  gunslinger: { size: 40, r: 16, color: '#d4a373', hp: 30, speed: 100, melee: 6, score: 12, from: 1, weight: 2.5, keepDistance: 320,
             gun: { damage: 7, delay: 0.7, loudness: 6, speed: 800, mag: 6, reload: 2.2 } },
  runner:  { size: 30, r: 12, color: '#f0a84e', hp: 20,   speed: 200, melee: 7,  score: 10 },
  shooter: { size: 40, r: 16, color: '#4ecdc4', hp: 35,   speed: 90,  melee: 8,  score: 15, keepDistance: 380,
             gun: { damage: 9, delay: 1.1, loudness: 7, speed: 700 } },
  // newer enemies (from = first wave they can show up in, weight = how common)
  tank:    { size: 58, r: 24, color: '#7f8c8d', hp: 170,  speed: 70,  melee: 22, score: 25, from: 3, weight: 1 },
  bomber:  { size: 34, r: 14, color: '#ff3838', hp: 25,   speed: 230, melee: 0,  score: 15, from: 4, weight: 1.2,
             kamikaze: { radius: 95, damage: 30 } },
  splitter:{ size: 44, r: 18, color: '#c56cf0', hp: 60,   speed: 105, melee: 10, score: 20, from: 5, weight: 1,
             split: { into: 'runner', count: 2 } },
  sniper:  { size: 40, r: 16, color: '#3c6382', hp: 30,   speed: 80,  melee: 6,  score: 25, from: 6, weight: 0.7, keepDistance: 650, laser: true,
             gun: { damage: 25, delay: 2.6, loudness: 9, speed: 1400 } },
  healer:  { size: 38, r: 15, color: '#2ecc71', hp: 35,   speed: 95,  melee: 5,  score: 25, from: 8, weight: 0.6, keepDistance: 350,
             heal: { radius: 230, perSec: 8 } },
  boss:    { size: 110, r: 46, color: '#9b59b6', hp: 1200, speed: 55, melee: 30, score: 200,
             gun: { damage: 12, delay: 1.6, loudness: 12, speed: 600 } },
};
const BOSS_EVERY = 10; // a boss shows up every 10th wave
const SLOT3_WAVE = 20;  // single player: a 3rd ability slot (V) unlocks on this wave
const SLOT4_WAVE = 30;  // ...and a 4th (B) on this one

// Bosses in order: wave 10, 20, 30 ... 90, then wave 100 is the CREATOR. After that they cycle again.
//   hp = multiplier on the normal boss HP
const BOSSES = [
  { id: 'juggernaut', name: 'JUGGERNAUT', color: '#9b59b6', hp: 1,   desc: 'Big, slow and tough.' },
  { id: 'tp',         name: 'TP',         color: '#00cec9', hp: 0.8, every: 3.5, desc: 'Teleports around the map.' },
  { id: 'gamemaster', name: 'GAMEMASTER', color: '#fd79a8', hp: 1,   desc: 'Pulls you into his wall-less arena for a bullet hell.' },
  { id: 'summoner',   name: 'SUMMONER',   color: '#6c5ce7', hp: 0.9, every: 5, desc: 'Keeps calling in minions.' },
  { id: 'hydra',      name: 'HYDRA',      color: '#00b894', hp: 1,   desc: 'Splits into 3 when killed.' },
  { id: 'phantom',    name: 'PHANTOM',    color: '#dfe6e9', hp: 0.8, desc: 'Nearly invisible and fast. Only shows up when it shoots.' },
  { id: 'inferno',    name: 'INFERNO',    color: '#e17055', hp: 1,   every: 0.9, desc: 'Leaves a trail of fire.' },
  { id: 'frost',      name: 'FROST KING', color: '#74b9ff', hp: 1,   every: 5, desc: 'Throws freeze bombs at you.' },
  { id: 'warlord',    name: 'WARLORD',    color: '#636e72', hp: 1.1, every: 2.5, desc: 'Fires rockets.' },
];
const CREATOR = { id: 'creator', name: 'CREATOR', color: '#ffd700', hp: 3, every: 3.5, desc: 'Can use any ultimate.' };

const PLAYER = { size: 46, r: 18, hp: 100, speed: 250 };
// TEAM REVIVE (Teams + Co-op): stand on a fallen teammate's body for `hold`s without shooting, within `window`s of the death
const REVIVE = { window: 10, hold: 3, radius: 45, hp: 0.5, inv: 1 };
const PLAYER_COLORS = ['#4aa3ff', '#ff5d5d', '#5dff8a', '#ffd35d', '#c45dff', '#5dfff0', '#ff9f5d', '#ffffff'];

// Arena. The same seed always builds the same map, so everyone in multiplayer gets the same one.
// Walls are [x, y, width, height]; they block movement, bullets and sight (you can't see past corners).
const MAP = {
  w: 4000, h: 4000, seed: 1337,
  grid: 80,       // everything snaps to this grid (also the floor lines)
  // wall amounts the host can pick (single player uses medium). maze = a real maze with 2-wide halls
  layouts: {
    small:  { label: 'Few walls',  houses: 4, lWalls: 12, straightWalls: 20 },
    medium: { label: 'Medium',     houses: 8, lWalls: 25, straightWalls: 40 },
    maze:   { label: 'MAZE',       maze: true },
  },
  openAreas: [2, 4], openSize: 8,             // 2-4 empty 8x8 grid areas with no walls
  walls: [],      // filled in below
  spawns: [],     // filled in by buildMap (corners + edge middles)
  // map sizes the host can pick (single player uses medium). Walls/houses scale with the area.
  sizes: {
    small:  { label: 'Small',  size: 2800 },
    medium: { label: 'Medium', size: 4000 },
    large:  { label: 'Large',  size: 5600 },
  },
};

// ---- fill in defaults (no need to edit below) ----
GUNS.main.img = 'assets/guns/main.png';
GUNS.secondary.img = 'assets/guns/secondary.png';
for (const slot in PARTS) {
  for (const p of PARTS[slot]) {
    p.img = p.img || `assets/parts/${slot}/${p.id}.png`;
    if (!p.anchor) {
      p.anchor = slot === 'mag' || slot === 'handle' ? { x: p.w / 2, y: 0 }
               : slot === 'stock' ? { x: p.w, y: p.h / 2 }
               : { x: 0, y: p.h / 2 };
    }
    if ((slot === 'barrel' || slot === 'silencer') && !p.tip) p.tip = { x: p.w, y: p.h / 2 };
  }
}
PLAYER.img = 'assets/characters/player.png';
for (const id in ENEMIES) ENEMIES[id].img = ENEMIES[id].img || `assets/characters/${id}.png`;

// ---- build the map: straight walls, L walls and houses, all on the grid ----
// Every structure keeps at least one free grid square around it so you can always walk between them.
function buildMap(layout = 'medium', seed = MAP.seed, size = 'medium') {
  const S = (MAP.sizes[size] || MAP.sizes.medium).size, k = (S / 4000) ** 2;
  MAP.w = MAP.h = S;
  const e = S - 200, c = S / 2;
  MAP.spawns = [[200, 200], [e, e], [e, 200], [200, e], [c, 200], [c, e], [200, c], [e, c]];
  const base = MAP.layouts[layout] || MAP.layouts.medium;
  const D = { ...base };
  for (const key of ['houses', 'lWalls', 'straightWalls']) if (D[key]) D[key] = Math.round(D[key] * k);
  const C = MAP.grid, cols = MAP.w / C, rows = MAP.h / C;
  let s = seed | 0;
  const rand = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const owner = new Int32Array(cols * rows).fill(-1); // which structure uses each square
  const solid = new Uint8Array(cols * rows);
  const idx = (x, y) => y * cols + x;

  // keep spawns and the middle open
  for (const [px, py] of [...MAP.spawns, [MAP.w / 2, MAP.h / 2]]) {
    const gx = Math.floor(px / C), gy = Math.floor(py / C);
    for (let y = gy - 1; y <= gy + 1; y++) for (let x = gx - 1; x <= gx + 1; x++) {
      if (x >= 0 && y >= 0 && x < cols && y < rows) owner[idx(x, y)] = -2;
    }
  }

  // empty open areas
  const areas = Math.max(1, Math.round((MAP.openAreas[0] + Math.floor(rand() * (MAP.openAreas[1] - MAP.openAreas[0] + 1))) * k));
  for (let n = 0; n < areas; n++) {
    const S = MAP.openSize, ax = ri(1, cols - S - 1), ay = ri(1, rows - S - 1);
    for (let y = ay; y < ay + S; y++) for (let x = ax; x < ax + S; x++) owner[idx(x, y)] = -2;
  }

  let nextId = 0;
  // cells = wall squares, area = every square the structure claims (walls + inside + doors)
  function place(cells, area) {
    const id = nextId++;
    for (const [x, y] of area) {
      if (x < 1 || y < 1 || x >= cols - 1 || y >= rows - 1) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const o = owner[idx(x + dx, y + dy)];
        if (o !== -1 && o !== id) return false;
      }
    }
    for (const [x, y] of area) owner[idx(x, y)] = id;
    for (const [x, y] of cells) solid[idx(x, y)] = 1;
    return true;
  }

  function house(big) {
    const w = big ? ri(7, 9) : ri(5, 6), h = big ? ri(6, 8) : ri(5, 6);
    const x0 = ri(1, cols - w - 1), y0 = ri(1, rows - h - 1);
    const area = [], doors = new Set();
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) area.push([x, y]);
    // shuffle the 4 sides (Fisher-Yates, so every browser builds the exact same map)
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const sides = order.slice(0, ri(2, 3)); // 2-3 entrances
    for (const side of sides) {
      const along = side < 2 ? ri(x0 + 1, x0 + w - 2) : ri(y0 + 1, y0 + h - 2);
      const [dx, dy] = side === 0 ? [along, y0] : side === 1 ? [along, y0 + h - 1] : side === 2 ? [x0, along] : [x0 + w - 1, along];
      doors.add(idx(dx, dy));
    }
    const cells = area.filter(([x, y]) =>
      (x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1) && !doors.has(idx(x, y)));
    return place(cells, area);
  }

  function straight() {
    const len = ri(2, 5), vert = rand() < 0.5, x0 = ri(1, cols - 2), y0 = ri(1, rows - 2);
    const cells = Array.from({ length: len }, (_, i) => vert ? [x0, y0 + i] : [x0 + i, y0]);
    return place(cells, cells);
  }

  function lShape() {
    const a = ri(2, 4), b = ri(2, 4), fx = rand() < 0.5 ? 1 : -1, fy = rand() < 0.5 ? 1 : -1;
    const x0 = ri(1, cols - 2), y0 = ri(1, rows - 2);
    const cells = [];
    for (let i = 0; i < a; i++) cells.push([x0 + i * fx, y0]);
    for (let i = 1; i < b; i++) cells.push([x0, y0 + i * fy]);
    return place(cells, cells);
  }

  const fill = (n, make) => { for (let placed = 0, tries = 0; placed < n && tries < n * 40; tries++) if (make()) placed++; };
  if (D.maze) {
    // maze cells are 3 squares: 1 wall + 2 hallway. Carved with a random depth-first search.
    const mc = Math.floor((cols - 1) / 3), mr = Math.floor((rows - 1) / 3);
    for (let y = 0; y <= mr * 3; y++) for (let x = 0; x <= mc * 3; x++) solid[idx(x, y)] = 1;
    const carve = (x, y) => { for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) solid[idx(x + dx, y + dy)] = 0; };
    const seen = new Uint8Array(mc * mr), stack = [[0, 0]];
    seen[0] = 1; carve(1, 1);
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [cx + dx, cy + dy, dx, dy])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < mc && y < mr && !seen[y * mc + x]);
      if (!nb.length) { stack.pop(); continue; }
      const [nx, ny, dx, dy] = nb[Math.floor(rand() * nb.length)];
      seen[ny * mc + nx] = 1;
      carve(nx * 3 + 1, ny * 3 + 1);
      // knock down the wall between the two cells
      if (dx) for (let k = 1; k <= 2; k++) solid[idx(Math.max(cx, nx) * 3, cy * 3 + k)] = 0;
      else for (let k = 1; k <= 2; k++) solid[idx(cx * 3 + k, Math.max(cy, ny) * 3)] = 0;
      stack.push([nx, ny]);
    }
    // extra openings so it's not one single path
    for (let i = 0; i < mc * mr * 0.15; i++) {
      const x = ri(1, mc - 1) * 3, y = ri(0, mr - 1) * 3;
      if (rand() < 0.5) { solid[idx(x, y + 1)] = 0; solid[idx(x, y + 2)] = 0; }
      else { solid[idx(y + 1, x)] = 0; solid[idx(y + 2, x)] = 0; }
    }
    // spawns, the middle and open areas stay clear
    for (let i = 0; i < owner.length; i++) if (owner[i] === -2) solid[i] = 0;
  } else {
    fill(Math.ceil(D.houses / 2), () => house(true));
    fill(Math.floor(D.houses / 2), () => house(false));
    fill(D.lWalls, lShape);
    fill(D.straightWalls, straight);
  }

  // merge wall squares into as few rectangles as possible
  let open = new Map();
  const rects = [];
  for (let y = 0; y < rows; y++) {
    const next = new Map();
    for (let x = 0; x < cols; x++) {
      if (!solid[idx(x, y)]) continue;
      const x0 = x;
      while (x + 1 < cols && solid[idx(x + 1, y)]) x++;
      const key = x0 + ',' + x;
      let r = open.get(key);
      if (r) r.h++; else { r = { x: x0, y, w: x - x0 + 1, h: 1 }; rects.push(r); }
      next.set(key, r);
    }
    open = next;
  }
  MAP.walls = rects.map(r => [r.x * C, r.y * C, r.w * C, r.h * C]);
  MAP.solid = solid;
  MAP.cols = cols;
}
buildMap();

// Health pickups: a green + that heals you. 3 appear every 30 seconds (no natural healing).
const HEALTH_PACK = { heal: 20, every: 30, count: 3, r: 18, max: 12 };

// Multiplayer ping: every 3 minutes, players who haven't fought for `calm` seconds
// see red arrows pointing at the enemies for 3 seconds.
const PING = { every: 180, calm: 10, show: 3 };

// Limited ammo: every gun starts with this many spare mags (plus the one loaded).
// Ammo boxes (yellow) spawn with health packs. Each gives 1 mag to the main gun and/or sidearm,
// whichever needs it (both if both do). The flare gun only gets 1 shot, and only when the main gun is full.
const AMMO = { spareMags: 3, box: { count: 2, refillMags: 1, mags: 3, r: 16 } }; // a box holds 3 mags, everyone takes only what they need

// Abilities: pick one before each round. respawn = weak ones get a use back every 30s. Active ones use E on PC / the green button on mobile.
// uses = how many times per round (2 for everything except the RPG, which gets one shot).
const ABILITIES = {
  grenade: { name: 'Grenade', type: 'active', thrown: true, color: '#6ab04c', cooldown: 15, uses: 2,
             damage: 100, radius: 130, range: 650, flight: 0.8,
             desc: 'Hold to aim (white line shows the path), let go to throw. Flies over walls. 100 damage.' },
  shield:  { name: 'Shield', type: 'active', color: '#3b82f6', cooldown: 30, uses: 2, duration: 7, hp: 200,
             desc: 'A 200 HP shield for 7 seconds. Your health bar turns blue.' },
  regen:   { name: 'Regeneration', type: 'passive', color: '#2ecc71', every: 10, heal: 10,
             desc: 'Passive: +10 HP for every 10 seconds you are out of combat.' },
  rpg:     { name: 'RPG', type: 'active', color: '#e17055', uses: 2, cooldown: 20, damage: 80, direct: 110, radius: 130, speed: 750,
             desc: 'TWO rockets per round. 110 damage on a direct hit, 80 in the blast. Explodes on walls.' },
  energy:  { name: 'Energy Drink', type: 'active', respawn: 30, color: '#f9ca24', cooldown: 5, uses: 2, heal: 10, speed: 1.7, duration: 6,
             desc: 'Heals 10 HP and makes you 1.7x faster for 6 seconds.' },
  burger:  { name: 'Burger', type: 'active', respawn: 30, color: '#cd6133', cooldown: 5, uses: 2, heal: 100,
             desc: 'Eat it to heal 100 HP.' },
  dash:    { name: 'Dash', type: 'active', respawn: 30, color: '#00d2d3', cooldown: 4, uses: 4, power: 1800,
             desc: '4 quick dashes per round in the way you are walking (or aiming if standing still).' },
  rapid:   { name: 'Rapid Fire', type: 'active', color: '#ff4d6d', cooldown: 20, uses: 2, duration: 5, fireMul: 0.5,
             desc: 'Your guns shoot twice as fast for 5 seconds.' },
  armor:   { name: 'Body Armor', type: 'passive', color: '#95a5a6', takeMul: 0.8,
             desc: 'Passive: you take 20% less damage.' },
  hands:   { name: 'Quick Hands', type: 'passive', color: '#a55eea', reloadMul: 0.65,
             desc: 'Passive: reload 35% faster.' },
  blink:    { name: 'Blink', type: 'active', color: '#7d5fff', cooldown: 6, uses: 3, range: 380,
              desc: 'Teleport forward where you aim, even through walls. 3 per round.' },
  nova:     { name: 'Bullet Nova', type: 'active', color: '#ffa801', cooldown: 15, uses: 2, count: 20, damage: 18, speed: 1100, range: 650,
              desc: 'Shoot 20 bullets in a ring all around you, 18 damage each.' },
  slowmo:   { name: 'Bullet Time', type: 'active', color: '#18dcff', cooldown: 25, uses: 2, duration: 5, factor: 0.35,
              desc: 'For 5 seconds enemy bullets (and in single player, enemies) move in slow motion.' },
  medic:    { name: 'Heal Zone', type: 'active', thrown: true, color: '#32ff7e', cooldown: 20, uses: 2, duration: 8, radius: 110, perSec: 8,
              desc: 'Hold to aim, let go to throw a healing circle: +8 HP every second while you stand in it (8s).' },
  turret:   { name: 'Turret', type: 'active', thrown: true, color: '#cd84f1', cooldown: 25, uses: 2, duration: Infinity, hp: 25, delay: 0.35, damage: 7,
              desc: 'Hold to aim, let go to throw a turret. It uses a copy of your sidearm (its damage, fire rate and bullets) and shoots the closest enemy it can see. Stays until it is destroyed (25 HP).' },
  resupply: { name: 'Resupply', type: 'active', thrown: true, color: '#fff200', cooldown: 10, uses: 2, radius: 30, charges: 4,
              desc: 'Hold to aim, let go to throw a supply crate. Walking over it fills both guns all the way up (one charge). It has 4 charges, and your decoys refill from it too.' },
  vampire:  { name: 'Vampire', type: 'passive', color: '#b33939', heal: 3,
              desc: 'Passive: heal 3 HP every time one of your bullets hits.' },
  laststand:{ name: 'Last Stand', type: 'passive', color: '#ff3f34', hp: 1, inv: 3,
              desc: 'Passive: once per round, a hit that would kill you leaves you at 1 HP and unhittable for 3s.' },
  sprinter: { name: 'Sprinter', type: 'passive', color: '#67e6dc', speed: 1.2,
              desc: 'Passive: you always run 20% faster.' },
  bandolier:{ name: 'Bandolier', type: 'passive', color: '#cc8e35', mags: 2,
              desc: 'Passive: start with 2 extra spare mags for both guns (and room to carry them).' },

  // ---- thrown gadgets (hold to aim, let go to throw — every placeable is thrown) ----
  blackhole: { name: 'Black Hole', type: 'active', thrown: true, gadget: true, color: '#8e44ad', cooldown: 25, uses: 2,
               radius: 340, duration: 4, pull: 900,
               desc: 'Throw a huge black hole that sucks everyone in for 4s, you too! No damage.' },
  firepit:   { name: 'Fire Pit', type: 'active', thrown: true, gadget: true, color: '#ff6b1a', cooldown: 20, uses: 2,
               radius: 120, duration: 5, dps: 14,
               desc: 'Throw a patch of fire. Anyone standing in it burns for 14 damage per second (5s), you too!' },
  freeze:    { name: 'Freeze Bomb', type: 'active', thrown: true, gadget: true, color: '#7ed6ff', cooldown: 18, uses: 2,
               radius: 170, time: 2.5,
               desc: 'Throw an ice bomb. Everyone it hits is frozen solid for 2.5s, you too!' },
  decoy:     { name: 'Decoy', type: 'active', respawn: 30, thrown: true, gadget: true, color: '#dfe6e9', cooldown: 20, uses: 2,
               radius: 20, duration: Infinity, hp: 25, speed: 220, max: 5, spareMags: 1, lowHp: 0.6, healBox: 8,
               desc: 'Throw a buddy on your team. It carries a copy of your main gun and goes out hunting enemies. 25 HP, stays until it is killed. Enemies go after it just like they go after you. Up to 5 at once. It runs out of ammo (1 spare mag) and goes to find ammo boxes, and heals itself at health packs and heal zones when hurt.' },
  barrier:   { name: 'Barrier', type: 'active', respawn: 30, thrown: true, gadget: true, color: '#54a0ff', cooldown: 15, uses: 3,
               radius: 200, duration: Infinity, len: 400, thick: 40, hp: 150, building: true,
               desc: 'Throw a wall (5 squares long, 150 HP) that snaps to the grid. Blocks bullets and movement until enemies shoot it down.' },
  mine:      { name: 'Land Mine', type: 'active', thrown: true, gadget: true, color: '#c0392b', cooldown: 6, uses: 3,
               radius: 130, trigger: 60, damage: 80, life: 45, arm: 0.8,
               desc: 'Throw a hidden mine (enemies can\'t see it). Explodes for 80 damage when an enemy walks over it.' },
  jumppad:   { name: 'Jump Pad', type: 'active', respawn: 30, thrown: true, gadget: true, color: '#1dd1a1', cooldown: 12, uses: 2,
               radius: 40, duration: 15, speed: 1400, air: 0.45,
               desc: 'Throw a launch pad. Step on it to get flung over walls in the direction you threw it (you and teammates).' },
  radar:     { name: 'Radar', type: 'active', respawn: 30, thrown: true, gadget: true, color: '#ff9ff3', cooldown: 25, uses: 2,
               radius: 1100, duration: Infinity, hp: 30, building: true,
               desc: 'Throw a radar tower (30 HP, stays until destroyed). You and your teammates get an arrow to the nearest enemy, and see enemies near it through walls.' },
  mortar:    { name: 'Mortar', type: 'active', thrown: true, gadget: true, color: '#e67e22', cooldown: 25, uses: 2,
               duration: Infinity, hp: 60, building: true, every: 3.5, range: 950, minRange: 160, damage: 45, radius: 110, flight: 1.1,
               desc: 'Throw a mortar (60 HP, stays until destroyed). Every 3.5s it lobs a shell over the walls at the farthest enemy in range (45 damage blast).' },
  shieldgen: { name: 'Shield Generator', type: 'active', thrown: true, gadget: true, color: '#6c5ce7', cooldown: 25, uses: 2,
               duration: Infinity, hp: 80, building: true, every: 6, radius: 220, shield: 40, shieldTime: 6,
               desc: 'Throw a shield generator (80 HP, stays until destroyed). Every 6s it gives you, teammates and your buddies inside its dome a 40 HP overshield.' },
  sniper:    { name: 'Sniper Nest', type: 'active', thrown: true, gadget: true, color: '#20bf6b', cooldown: 25, uses: 2,
               duration: Infinity, hp: 50, building: true, every: 2.5, range: 1800, damage: 90, speed: 4200,
               desc: 'Throw a sniper nest (50 HP, stays until destroyed). Every 2.5s it fires one 90 damage shot at the closest enemy it can see, very far away.' },
  flame:     { name: 'Flame Tower', type: 'active', thrown: true, gadget: true, color: '#ff5e1a', cooldown: 25, uses: 2,
               duration: Infinity, hp: 90, building: true, range: 200, cone: 0.55, dps: 30, burn: 3, burnDps: 8,
               desc: 'Throw a flame tower (90 HP, stays until destroyed). It sprays a cone of fire at the closest enemy (30/s) and sets them on fire (8/s for 3s).' },
  laser:     { name: 'Laser Tower', type: 'active', thrown: true, gadget: true, color: '#ff2e63', cooldown: 25, uses: 2,
               duration: Infinity, hp: 60, building: true, range: 620, dps: 8, maxDps: 70, ramp: 3,
               desc: 'Throw a laser tower (60 HP, stays until destroyed). It locks a beam onto one enemy: 8 damage/s, ramping up to 70/s the longer it holds on.' },
  hangar:    { name: 'Drone Hangar', type: 'active', thrown: true, gadget: true, color: '#00d2d3', cooldown: 25, uses: 2,
               duration: Infinity, hp: 70, building: true, drones: 2, respawn: 6, droneHp: 20, range: 420, shootRange: 260,
               every: 0.45, damage: 9, speed: 420, healEvery: 2, heal: 6,
               desc: 'Throw a drone hangar (70 HP, stays until destroyed). It launches 2 drones that fly out and shoot enemies near it. Shot-down drones come back after 6s.' },
  gravity:   { name: 'Gravity Tower', type: 'active', thrown: true, gadget: true, color: '#7d5fff', cooldown: 25, uses: 2,
               duration: Infinity, hp: 80, building: true, radius: 260, pull: 110, slow: 0.55,
               desc: 'Throw a gravity tower (80 HP, stays until destroyed). Enemies near it are slowly dragged toward it and move at 55% speed.' },
  tesla:     { name: 'Tesla Coil', type: 'active', thrown: true, gadget: true, color: '#48dbfb', cooldown: 25, uses: 2,
               radius: 230, duration: Infinity, every: 0.6, damage: 10, hp: 100, building: true,
               desc: 'Throw a tesla tower (100 HP, stays until destroyed) that zaps every enemy close to it with lightning (10 damage).' },
  sensor:    { name: 'Motion Sensor', type: 'active', thrown: true, gadget: true, color: '#ff4d4d', cooldown: 8, uses: 3, duration: Infinity,
               radius: 180, reveal: 5, boomRadius: 70, boomDamage: 20,
               desc: 'Throw a hidden sensor (enemies can\'t see it). When an enemy comes close it shows you (and your team) where they are for 5s, then blows itself up (20 damage).' },
  smoke:     { name: 'Smoke Bomb', type: 'active', respawn: 30, thrown: true, gadget: true, color: '#a4b0be', cooldown: 18, uses: 2,
               radius: 300, duration: 7,
               desc: 'Throw a big thick smoke cloud nobody can see through for 7s. Enemies can\'t shoot you through it.' },

  door:      { name: 'Door', type: 'active', color: '#c8a165', cooldown: 20, uses: 3, reach: 200,
               desc: 'Aim at a wall and press: it opens a 2x2 doorway. Press again to close it (the 20s cooldown starts when you close it).' },
  // ---- instant actives ----
  grapple:   { name: 'Grappling Hook', type: 'active', color: '#e1b12c', cooldown: 5, uses: 4, range: 700, pull: 1500,
               desc: 'Shoot a hook at a wall where you aim and zip over to it.' },
  phase:     { name: 'Phase Walk', type: 'active', color: '#9c88ff', cooldown: 20, uses: 2, duration: 3,
               desc: 'For 3 seconds you can walk straight through walls.' },
  reflect:   { name: 'Mirror', type: 'active', color: '#f5f6fa', cooldown: 20, uses: 2, duration: 3,
               desc: 'For 3 seconds every bullet that hits you bounces straight back at the shooter.' },
  overcharge:{ name: 'Overcharge', type: 'active', color: '#fbc531', cooldown: 20, uses: 2, shots: 12, mul: 2,
               desc: 'Your next 12 shots do double damage.' },
  quake:     { name: 'Ground Slam', type: 'active', color: '#b8845a', cooldown: 15, uses: 2, radius: 280, damage: 30, kb: 10,
               desc: 'Slam the ground: 30 damage and a huge push to every enemy around you.' },
  recall:    { name: 'Rewind', type: 'active', color: '#00a8ff', cooldown: 20, uses: 2, delay: 3,
               desc: 'Marks where you are. 3 seconds later you jump back there with the health you had then.' },

  // ---- passives ----
  thorns:    { name: 'Thorns', type: 'passive', color: '#6ab04c', count: 8, damage: 6, cd: 0.8,
               desc: 'Passive: whenever you get hurt, 8 spikes shoot out of you in every direction.' },
  scavenger: { name: 'Scavenger', type: 'passive', color: '#cc8e35', heal: 10, mags: 0.5,
               desc: 'Passive: every kill gives you 10 HP and half a mag of ammo.' },
  glass:     { name: 'Glass Cannon', type: 'passive', color: '#ff7979', hp: 65, mul: 1.5,
               desc: 'Passive: your guns do 50% more damage, but you only have 65 max HP.' },
  // ---- newer abilities ----
  cluster:   { name: 'Cluster Bomb', type: 'active', thrown: true, color: '#ff7f50', cooldown: 14, uses: 2, radius: 150, bombs: 6, bombRadius: 70, damage: 35,
               desc: 'Throw a bomb that bursts into 6 small explosions around where it lands.' },
  bubble:    { name: 'Bubble Shield', type: 'active', thrown: true, gadget: true, color: '#7ef9ff', cooldown: 20, uses: 2, radius: 130, duration: 6,
               desc: 'Throw a dome that stops every enemy bullet trying to get in (6s). Your bullets go out fine.' },
  stim:      { name: 'Stim Shot', type: 'active', color: '#c56cf0', cooldown: 18, uses: 3, duration: 8, cost: 10, speed: 1.4, fire: 0.7,
               desc: 'Costs 10 HP: run 40% faster and shoot 30% faster for 8 seconds.' },
  shadowstep:{ name: 'Shadow Step', type: 'active', color: '#2d3436', cooldown: 10, uses: 3, range: 700,
               desc: 'Teleport right behind the closest enemy you can see.' },
  magnet:    { name: 'Magnet', type: 'passive', color: '#e84118', range: 320, pull: 520,
               desc: 'Passive: health packs, ammo and crates nearby slide over to you.' },
  ninja:     { name: 'Ninja', type: 'passive', color: '#353b48', quiet: 0.4,
               desc: 'Passive: your shots are 60% quieter, so enemies hear you from much closer.' },
  lucky:     { name: 'Lucky', type: 'passive', color: '#44bd32', epic: 3,
               desc: 'Passive: purple ultimate crates show up 3x more often.' },
  adrenaline:{ name: 'Adrenaline', type: 'passive', color: '#eb4d4b', below: 0.35, speed: 1.3, fire: 0.7,
               desc: 'Passive: when you are under 35% health you run 30% faster and shoot 30% faster.' },
};
const LOADOUT_PRESETS = 3; // saved loadouts you can switch between

// Rare red crate: restores all your ability uses. Chance that one shows up each time packs spawn.
const ABILITY_CRATE = { chance: 0.6 };

// EPIC crate (gold, very rare): gives you one random ULTIMATE. F on PC / the gold button on mobile.
// chance = per health pack spawn (every 30s), so about one every 6 minutes.
const EPIC_CRATE = { chance: 0.08 };

// Ability icons: simple flat shapes in the ability's colour until real art is added.
// Shape names are drawn by ICON_SHAPES in core.js.
const ABILITY_ICONS = {
  grenade: 'grenade', shield: 'shield', regen: 'heart', rpg: 'rocket', energy: 'can', burger: 'burger', dash: 'arrow',
  rapid: 'chevrons', armor: 'vest', hands: 'reload', blink: 'star', nova: 'burst', slowmo: 'hourglass', medic: 'plus',
  turret: 'turret', resupply: 'box', vampire: 'fangs', laststand: 'skull', sprinter: 'chevrons', bandolier: 'bullets',
  blackhole: 'vortex', firepit: 'flame', freeze: 'snow', decoy: 'person', barrier: 'wall', mine: 'mine', jumppad: 'up',
  radar: 'dish', tesla: 'bolt', mortar: 'mortar', shieldgen: 'dome', sniper: 'scope', flame: 'flametower', laser: 'laser', hangar: 'drone', gravity: 'gravity', smoke: 'cloud', grapple: 'hook', phase: 'ghost', reflect: 'mirror', overcharge: 'battery',
  quake: 'hammer', recall: 'rewind', thorns: 'spikes', scavenger: 'bone', glass: 'gem', adrenaline: 'heartbolt',
  cluster: 'dots', sensor: 'sensor', door: 'door', bubble: 'ring', stim: 'syringe', shadowstep: 'dagger', magnet: 'magnet', ninja: 'moon', lucky: 'clover',
};

// How the Ability tab sorts abilities into sections. Anything not listed goes under Passives / Other.
const ABILITY_GROUPS = [
  { label: '🏗️ Buildings', note: 'stay until destroyed · merge 3 into a big one', ids: ['turret', 'radar', 'tesla', 'barrier', 'mortar', 'shieldgen', 'sniper', 'flame', 'laser', 'hangar', 'gravity'] },
  { label: '📦 Placeables', note: 'thrown, then they sit where they land', ids: ['decoy', 'mine', 'sensor', 'jumppad', 'bubble', 'medic', 'smoke', 'resupply'] },
  { label: '💣 Throwables', note: 'thrown blasts and zones', ids: ['grenade', 'cluster', 'freeze', 'blackhole', 'firepit'] },
  { label: '🔫 Attacks', ids: ['rpg', 'nova', 'quake', 'rapid', 'overcharge'] },
  { label: '🏃 Movement', ids: ['dash', 'blink', 'grapple', 'phase', 'shadowstep', 'recall', 'door'] },
  { label: '🛡️ Support', ids: ['shield', 'burger', 'energy', 'stim', 'reflect', 'slowmo'] },
];

// CLASSES: equip ONLY abilities from one section (slots 1-3, at least 2 filled) -> slot 4 (B) becomes that class's ability.
// It unlocks at `unlockWave` in single player (right away in Test mode and in multiplayer).
const CLASSES = {
  unlockWave: 5,
  engineerSlot3: 10,     // ENGINEER: the 3rd ability slot (V) opens at wave 10 instead of SLOT3_WAVE
  list: [
    { id: 'engineer',  group: 0, name: 'Engineer',  emoji: '🏗️', ab: 'cls_upgrade' },
    { id: 'trapper',   group: 1, name: 'Trapper',   emoji: '📦', ab: 'cls_restock' },
    { id: 'grenadier', group: 2, name: 'Grenadier', emoji: '💣', ab: 'cls_barrage' },
    { id: 'assault',   group: 3, name: 'Assault',   emoji: '🔫', ab: 'cls_overclock' },
    { id: 'scout',     group: 4, name: 'Scout',     emoji: '🏃', ab: 'cls_afterimage' },
    { id: 'medic',     group: 5, name: 'Medic',     emoji: '🛡️', ab: 'cls_pulse' },
  ],
};
// class abilities (cls: true = never in the normal picker). All are press-to-use (good on phones).
Object.assign(ABILITIES, {
  cls_upgrade:    { cls: true, name: 'Upgrade', type: 'active', color: '#f6b93b', cooldown: 30, reach: 320, maxLvl: 5, delayCut: 0.12, rangeAdd: 0.1,
                    desc: 'Upgrades your closest building (in front of you first) one level, max 5. Each level: 12% less time between shots + healed to full.' },
  cls_restock:    { cls: true, name: 'Double Trap', type: 'active', color: '#e1b12c', cooldown: 30, window: 10,
                    desc: 'Resets your other abilities. The next placeable you throw in 10s is thrown twice.' },
  cls_barrage:    { cls: true, name: 'Barrage', type: 'active', color: '#e55039', cooldown: 30, count: 5, spread: 0.5,
                    desc: 'Throws 5 of your last-used throwable in a spread where you aim.' },
  cls_overclock:  { cls: true, name: 'Overclock', type: 'active', color: '#ff3838', cooldown: 30, duration: 6, mul: 1.6,
                    desc: '6 seconds of +60% damage and no reloading.' },
  cls_afterimage: { cls: true, name: 'Afterimage', type: 'active', color: '#18dcff', cooldown: 25, duration: 3,
                    desc: 'Resets your movement abilities, and for 3s you run fast and walk through walls.' },
  cls_pulse:      { cls: true, name: 'Revive Pulse', type: 'active', color: '#32ff7e', cooldown: 35, radius: 350, shield: 60, shieldT: 5,
                    desc: 'Heals you and your buddies nearby to full, removes freeze/slow and gives you a 60 shield for 5s.' },
});
Object.assign(ABILITY_ICONS, { cls_upgrade: 'up', cls_restock: 'box', cls_barrage: 'dots', cls_overclock: 'battery', cls_afterimage: 'ghost', cls_pulse: 'plus' });
// which class the loadout (slots 1-3) makes, or null
function classOf(L) {
  const ids = [L.ability, L.ability2, L.ability3].filter(id => ABILITIES[id]);
  if (ids.length < 2) return null;
  return CLASSES.list.find(c => ids.every(id => ABILITY_GROUPS[c.group].ids.includes(id))) || null;
}

// Ability combos: throw one ability's thing onto another's (needs both, e.g. one in each ability slot).
const COMBOS = [
  { a: 'turret', b: 'tesla',   name: 'Railgun',        how: '3 Turrets → Rocket Turret, 3 Teslas → Big Tesla. Line up Big Tesla, Rocket Turret, Big Tesla.' },
  // ---- FORMATIONS: buildings in side-by-side floor squares fuse into one super building (numbers in FORMATIONS) ----
  { a: 'laser', b: 'radar',    name: 'Orbital Strike', formation: true, how: 'Throw 3 Laser Towers into the same square → Big Laser. Put a Radar in the square on each side of it (left + right, or above + below; a Radar thrown right ONTO the Big Laser makes it a Prism instead). Every 6s it calls a sky beam down on the toughest enemy anywhere on the map (140 damage).' },
  { a: 'tesla', b: 'tesla',    name: 'Storm Tower',    formation: true, how: 'Make 3 Big Teslas (3 Teslas in one square each) in an L: one corner square with a Big Tesla right next to it on one side AND one above or below it. They fuse into a Storm Tower in the corner: huge range, zaps chain to 4 more enemies and lightning falls from its storm cloud.' },
  { a: 'turret', b: 'shieldgen', name: 'Fortress',     formation: true, how: '3 Turrets in one square → Rocket Turret. Line up Rocket Turret, Shield Generator, Rocket Turret (side-by-side squares, generator in the middle). They fuse into a Fortress: 4-barrel gun + rockets, a 250 HP regenerating shield, and an overshield for you inside its dome.' },
  { a: 'hangar', b: 'radar',   name: 'Carrier',        formation: true, how: 'Throw 3 Drone Hangars into one square → Big Hangar. Make a Command Tower (throw a Decoy onto a Radar) in the square right next to it (any side). The radar is used up and the hangar becomes a Carrier: 5 big drones, double damage, longer reach.' },
  { a: 'hangar', b: 'hangar',  name: 'Drone Hive',     formation: true, how: 'Throw 3 Drone Hangars into one square → Big Hangar. Put a normal Drone Hangar in the square on each side of it (left + right, or above + below). They fuse into a Drone Hive: 10 small, fast drones that shoot quicker.' },
  { a: 'hangar', b: 'laser',   name: 'Drone Uplink',   formation: true, how: 'Throw 3 Drone Hangars into one square → Big Hangar. Put a Laser Tower in the square right next to it (any side). The laser is used up and the hangar becomes a Drone Uplink: 5 drones that fire laser beams that never miss.' },
  { a: 'mortar', b: 'mortar',  name: 'Artillery Battery', formation: true, how: 'Throw 3 Mortars into one square → Big Mortar. Put a normal Mortar in the square on each side of it (left + right, or above + below). Every 4s the battery fires 5 shells at 5 enemies almost anywhere on the map (60 damage each).' },
  { a: 'shieldgen', b: 'shieldgen', name: 'Aegis Dome', formation: true, how: '3 Shield Generators in one square → Big Shield Generator. Put a normal Shield Generator on each side of it (row or column). The dome gets twice as big, gives an 80 HP overshield every 3s, repairs your buildings inside and stops enemy bullets.' },
  { a: 'flame', b: 'flame',    name: 'Inferno Tower',  formation: true, how: '3 Flame Towers in one square → Big Flame Tower. Put a normal Flame Tower on each side of it (row or column). It sprays fire all the way around (much stronger and further) and throws fireballs at enemies far away.' },
  { a: 'gravity', b: 'gravity', name: 'Black Hole Generator', formation: true, how: '3 Gravity Towers in one square → Big Gravity Tower. Put a normal Gravity Tower on each side of it (row or column). It pulls enemies in from twice as far and crushes everything near its core every 3s (50 damage).' },
  { a: 'sniper', b: 'radar',   name: 'Watchtower',     formation: true, how: '3 Sniper Nests in one square → Big Sniper Nest. Put a Radar in the square right next to it (any side). The radar is used up: every 1.2s it snipes the toughest enemy anywhere on the map, right through walls (160 damage).' },
  { a: 'barrier', b: 'shieldgen', name: 'Citadel Wall', formation: true, how: 'Throw 3 Barriers close together → Big Barrier. Throw a Shield Generator into a square touching the wall. The generator is used up: the wall gets 1500 HP, repairs itself and grows a gun tower at each end that shoots enemies.' },
  { a: 'turret', b: 'radar',   name: 'Spotter Turret', how: 'Throw a Radar next to a Turret (or a Turret next to a Radar): the turret shoots through walls from very far away.' },
  { a: 'turret', b: 'medic',   name: 'Heal Turret',    how: 'Throw a second Heal Zone onto a Medic Turret: it shoots green heal bullets at hurt buddies (+50 HP) and you (+20 HP). Low buddies run to it.' },
  { a: 'turret', b: 'medic',   name: 'Medic Turret',   how: 'Throw a Heal Zone onto a Turret: it keeps shooting and heals you 5 HP every 3 seconds when you are near it and out of combat.' },
  { a: 'blackhole', b: 'firepit', name: 'Inferno Vortex', how: 'Throw a Fire Pit into your Black Hole: it burns enemies it pulls in (20/s) and lasts 3s longer.' },
  { a: 'tesla', b: 'freeze',   name: 'Cryo Coil',      how: 'Throw a Freeze Bomb onto a Tesla Coil: its zaps freeze enemies for a moment.' },
  { a: 'barrier', b: 'tesla',  name: 'Electric Fence', how: 'Throw a Barrier next to a Tesla Coil: the wall crackles and shocks enemies that touch it (15/s).' },
  { a: 'bubble', b: 'medic',   name: 'Healing Dome',   how: 'Throw a Heal Zone into your Bubble Shield: inside heals you 8 HP/s and the dome lasts 6s longer.' },
  { a: 'decoy', b: 'medic',    name: 'Medic Buddy',    how: 'Throw a Heal Zone onto your Buddy: it heals you and your other decoys 5 HP/s when near, heals itself too, and stays with your other decoys (the most hurt one first).' },
  { a: 'blackhole', b: 'grenade', name: 'Singularity', how: 'Throw a Grenade into your Black Hole: it collapses into a giant 150 damage explosion.' },
  { a: 'tesla', b: 'firepit',  name: 'Plasma Coil',    how: 'Throw a Fire Pit onto a Tesla Coil: its zaps turn orange and do double damage.' },
  { a: 'mine', b: 'freeze',    name: 'Cryo Mine',      how: 'Throw a Freeze Bomb onto your Land Mine: when it blows up it also freezes everyone around it.' },
  { a: 'tesla', b: 'radar',    name: 'Seeker Coil',    how: 'Throw a Radar next to a Tesla Coil: the coil zaps 60% further.' },
  { a: 'turret', b: 'bubble',  name: 'Shielded Turret', how: 'Throw a Bubble Shield onto a Turret: the turret can\'t be hurt while the bubble is up.' },
  { a: 'barrier', b: 'firepit', name: 'Wall of Fire',  how: 'Throw a Fire Pit onto a Barrier: the wall burns enemies that touch it (20/s).' },
  { a: 'turret', b: 'firepit', name: 'Flame Turret',   how: 'Throw a Fire Pit onto a Turret: its bullets do 50% more damage.' },
  { a: 'barrier', b: 'freeze', name: 'Ice Wall',      how: 'Throw a Freeze Bomb onto a Barrier: the wall frosts over and enemies touching or right next to it move at 30% speed (the freeze bomb still goes off).' },
  { a: 'turret', b: 'barrier', name: 'Bunker',        how: 'Throw a Barrier onto a Turret: the barrier is used up and bolts on as armor plating. The turret takes 50% less damage.' },
  { a: 'radar', b: 'decoy',   name: 'Command Tower',  how: 'Throw a Decoy onto a Radar: the decoy stays a normal buddy and the radar becomes a Command Tower. Your buddies near it (320) shoot 30% faster and do 25% more damage.' },
  { a: 'mortar', b: 'freeze', name: 'Cryo Mortar',    how: 'Throw a Freeze Bomb onto a Mortar: its shells also freeze everyone they hit for 1.5s (the freeze bomb still goes off).' },
  { a: 'shieldgen', b: 'tesla', name: 'Shock Dome',   how: 'Throw a Tesla Coil onto a Shield Generator: the coil is used up and the dome shocks enemies inside it (20/s).' },
  { a: 'sniper', b: 'radar',  name: 'Eagle Eye',      how: 'Throw a Radar onto a Sniper Nest: the radar is used up and the nest shoots through walls at anything in range.' },
  { a: 'flame', b: 'barrier', name: 'Inferno Ring',  how: 'Throw a Barrier onto a Flame Tower: the barrier is used up and the tower sprays fire all the way around it, not just a cone.' },
  { a: 'laser', b: 'radar',   name: 'Prism Laser',    how: 'Throw a Radar onto a Laser Tower: the radar is used up and the beam splits to also burn up to 2 more enemies.' },
  { a: 'hangar', b: 'medic',  name: 'Medic Drones',   how: 'Throw a Heal Zone onto a Drone Hangar: the heal zone is used up, the drones turn green and every 2s each one heals you or a hurt buddy near the hangar (+6 HP) while still shooting.' },
  // v92 drone types: one per hangar (Medic Drones can still be added on top). Numbers in COMBO.drone*
  { a: 'hangar', b: 'freeze',  name: 'Frost Drones',  how: 'Throw a Freeze Bomb onto a Drone Hangar: the bomb is used up and the drones turn icy blue. Their shots slow enemies down and every 4th hit freezes them solid for a moment.' },
  { a: 'hangar', b: 'firepit', name: 'Flame Drones',  how: 'Throw a Fire Pit onto a Drone Hangar: the fire pit is used up and the drones turn orange. Their shots set enemies on fire.' },
  { a: 'hangar', b: 'tesla',   name: 'Shock Drones',  how: 'Throw a Tesla Coil onto a Drone Hangar: the coil is used up and the drones turn yellow. Every shot jumps with lightning to 2 more enemies close by.' },
  { a: 'hangar', b: 'mine',    name: 'Kamikaze Drones', how: 'Throw a Land Mine onto a Drone Hangar: the mine is used up and the drones turn red. They dive into the most dangerous enemies and blow up, then a new one launches after 3s. (A hangar can only have ONE drone type.)' },
  // v93: five more drone types (still one per hangar)
  { a: 'hangar', b: 'bubble',  name: 'Guardian Drones', how: 'Throw a Bubble Shield onto a Drone Hangar: the bubble is used up and the drones turn light blue. They fly in a circle around YOU, block enemy bullets (taking only half damage) and shoot anything close.' },
  { a: 'hangar', b: 'grenade', name: 'Bomber Drones',   how: 'Throw a Grenade onto a Drone Hangar: the grenade is used up and the drones turn green. They fly over enemies and drop a bomb every 2.5s (35 damage in a circle), great on groups.' },
  { a: 'hangar', b: 'sensor',  name: 'Sniper Drones',   how: 'Throw a Motion Sensor onto a Drone Hangar: the sensor is used up and the drones get long barrels. They stay far back and fire slow, very strong shots (4x damage) from twice as far.' },
  { a: 'hangar', b: 'smoke',   name: 'Ghost Drones',    how: 'Throw a Smoke Bomb onto a Drone Hangar: the smoke is used up and the drones go see-through. Enemy bullets fly right through them, and every enemy they hit is marked and takes 20% more damage from everything for 4s.' },
  { a: 'hangar', b: 'blackhole', name: 'Gravity Drones', how: 'Throw a Black Hole onto a Drone Hangar: the black hole is used up and the drones turn purple. Every shot pulls the enemies around the target in close together.' },
  { a: 'gravity', b: 'grenade', name: 'Implosion',    how: 'Throw a Grenade onto a Gravity Tower: the grenade is used up and every 5s the tower crushes everything it is pulling in (40 damage blast).' },
  { a: 'tesla', b: 'grenade', name: 'Storm Coil',     how: 'Throw a Grenade onto a Tesla Coil: the grenade is used up and every zap chains on to up to 2 more nearby enemies.' },
  // ---- passive combos: just equip both, they power each other up ----
  { a: 'sprinter', b: 'dash',   name: 'Speedster',      passive: true, how: 'Equip both: +2 dashes and dashes go 50% further.', syn: { dash: { add: { uses: 2 }, mul: { power: 1.5 } } } },
  { a: 'glass', b: 'overcharge', name: 'Overload',      passive: true, how: 'Equip both: overcharged shots do 3x damage instead of 2x.', syn: { overcharge: { add: { mul: 1 } } } },
  { a: 'armor', b: 'shield',    name: 'Tank',           passive: true, how: 'Equip both: shield has +150 HP and armor blocks 30% instead of 20%.', syn: { shield: { add: { hp: 150 } }, armor: { add: { takeMul: -0.1 } } } },
  { a: 'regen', b: 'medic',     name: 'Fast Recovery',  passive: true, how: 'Equip both: regen every 6s and Heal Zones heal +4 HP/s.', syn: { regen: { add: { every: -4 } }, medic: { add: { perSec: 4 } } } },
  { a: 'hands', b: 'rapid',     name: 'Trigger Happy',  passive: true, how: 'Equip both: Rapid Fire lasts 9s and shoots even faster.', syn: { rapid: { add: { duration: 4 }, mul: { fireMul: 0.8 } } } },
  { a: 'magnet', b: 'resupply', name: 'Ammo Hoarder',   passive: true, how: 'Equip both: Resupply cooldown 5s and the magnet pulls 50% further.', syn: { resupply: { add: { cooldown: -5 } }, magnet: { mul: { range: 1.5 } } } },
  { a: 'scavenger', b: 'vampire', name: 'Bloodhound',   passive: true, how: 'Equip both: hits heal 5 HP and kills heal 20 HP.', syn: { vampire: { add: { heal: 2 } }, scavenger: { add: { heal: 10 } } } },
  { a: 'ninja', b: 'shadowstep', name: 'Assassin',      passive: true, how: 'Equip both: +2 Shadow Steps that reach 40% further.', syn: { shadowstep: { add: { uses: 2 }, mul: { range: 1.4 } } } },
  { a: 'adrenaline', b: 'stim', name: 'Racing Heart',   passive: true, how: 'Equip both: Stim Shot costs no HP and lasts 12s.', syn: { stim: { add: { cost: -10, duration: 4 } } } },
  { a: 'resupply', b: 'decoy', name: 'Supply Decoy',  how: 'Throw a Decoy onto your Resupply crate: the crate is used up and becomes a Supply Decoy (no gun, never attacks). It goes to every decoy you place, one after another, and gives each 3 mags, then comes back to any that run low. When no decoy needs ammo it only comes to you if you need ammo, and hands you 3 mags. Otherwise it tags along with the nearest decoy.' },
  { a: 'laststand', b: 'recall', name: 'Second Chance', passive: true, how: 'Equip both: Last Stand keeps you unhittable for 6s and Rewind jumps back after 2s.', syn: { laststand: { add: { inv: 3 } }, recall: { add: { delay: -1 } } } },
  // ---- non-building combos (v83) ----
  { a: 'smoke', b: 'freeze',   name: 'Frost Fog',      how: 'Throw a Freeze Bomb into your Smoke cloud: the smoke turns icy and enemies inside move at 40% speed until it fades (the freeze bomb still goes off).' },
  { a: 'smoke', b: 'medic',    name: 'Healing Mist',   how: 'Throw a Heal Zone into your Smoke cloud: the heal zone is used up and the whole cloud heals you and your buddies 5 HP every second.' },
  { a: 'jumppad', b: 'mine',   name: 'Spring Trap',    how: 'Throw a Land Mine onto your Jump Pad: the mine is used up and the pad flings enemies that step on it far away for 40 damage (every 1.5s).' },
  { a: 'firepit', b: 'cluster', name: 'Napalm',        how: 'Throw a Cluster Bomb into your Fire Pit: the fire grows 60% bigger and burns 4s longer (the bombs still go off).' },
  { a: 'blackhole', b: 'freeze', name: 'Cryo Vortex',  how: 'Throw a Freeze Bomb into your Black Hole: it lasts 2s longer and when it closes everyone it was pulling in is frozen for 3s.' },
  { a: 'rpg', b: 'firepit',    name: 'Napalm Rocket',  passive: true, how: 'Equip both: every RPG rocket leaves a Fire Pit where it blows up.' },
  { a: 'dash', b: 'shield',    name: 'Shield Bash',    passive: true, how: 'Equip both: dashing while your Shield is up rams every enemy you touch (35 damage + big push).' },
  { a: 'blink', b: 'grenade',  name: 'Parting Gift',   passive: true, how: 'Equip both: every Blink leaves a bomb where you were. It blows up 0.6s later (60 damage).' },
  { a: 'grapple', b: 'quake',  name: 'Ground Pound',   passive: true, how: 'Equip both: when your Grappling Hook pulls you in, you slam the ground where you land (30 damage + push).' },
  { a: 'reflect', b: 'shield', name: 'Mirror Shield',  passive: true, how: 'Equip both: Mirror lasts 2s longer and gives you an 80 HP shield, and Shield comes back 10s sooner.', syn: { reflect: { add: { duration: 2 } }, shield: { add: { cooldown: -10 } } } },
  { a: 'rapid', b: 'overcharge', name: 'Supercharged', passive: true, how: 'Equip both: Overcharge gives 24 shots instead of 12 and Rapid Fire lasts 2s longer.', syn: { overcharge: { add: { shots: 12 } }, rapid: { add: { duration: 2 } } } },
  { a: 'nova', b: 'slowmo',    name: 'Time Burst',     passive: true, how: 'Equip both: using Bullet Time also fires a free Bullet Nova ring.' },
];
const COMBO = { supplySpeed: 1.25, supplyMags: 3, supplyMax: 2,  healBeam: 50, healBeamMe: 20, healEvery: 1.5, healRange: 700, healShotSpeed: 900,  seekerRange: 1.6, fireWallDps: 20, flameMul: 1.5,  fenceNear: 220, fenceDps: 15, domeHeal: 8, domeTime: 6, buddyHeal: 5, buddyRadius: 180, singRadius: 340, singDamage: 150, cryoMineFreeze: 2.5, near: 110, spotRange: 2200, medicRadius: 160, medicHeal: 5, medicEvery: 3, medicCalm: 3, vortexDps: 20, vortexTime: 3, cryoFreeze: 0.8,
  iceNear: 70, iceTime: 0.6, iceSlow: 0.3,  bunkerTake: 0.5,  cmdRadius: 320, cmdFire: 0.7, cmdDmg: 1.25,  stormChains: 2, stormRange: 230,  cryoMortar: 1.5, shockDps: 20,
  blazeRange: 0.8, prismBeams: 2, prismMul: 0.6, medicDroneRange: 300, droneChill: 1.5, droneFreezeHits: 4, droneFreeze: 0.8, droneBurn: 3, droneChains: 2, droneChainRange: 170, droneChainMul: 0.6,
  guardRing: 52, guardBlock: 16, guardTake: 0.5, bombEvery: 2.5, bombRadius: 110, bombDmg: 35, snipeRange: 520, snipeRing: 330, snipeEvery: 3, snipeMul: 4,
  ghostMark: 4, ghostMul: 1.2, gravDroneRange: 170, gravDronePull: 7,
  kamiRadius: 95, kamiDmg: 55, kamiBack: 3, kamiSpeed: 1.7, implodeEvery: 5, implodeDamage: 40, implodeRadius: 180,
  fogSlow: 0.4, mistHeal: 5, springDmg: 40, springKb: 30, springCd: 1.5, napalmSize: 1.6, napalmTime: 4, cryoBhTime: 2, cryoBhFreeze: 3,
  bashTime: 0.35, bashDmg: 35, bashKb: 16, giftDelay: 0.6, giftRadius: 130, giftDmg: 60, poundRadius: 200, poundDmg: 30, poundKb: 10, mirrorShield: 80 };
// Building look: landing pop time, debris pieces when one is destroyed
const BUILD_FX = { land: 0.45, debris: 12, smoke: 6 };

// Merging: 3 of the same building of yours close together become one BIG one.
//   near = how close they must be. Big buildings are `size`x bigger with `range`x range and `hp`x health.
// 3 turrets in the same floor square (turretNear) become a ROCKET TURRET.
const MERGE = { near: 160, size: 1.5, range: 1.5, hp: 3, turretNear: 40,
                rocketTurret: { hp: 300, every: 5, range: 1300 },
// BIG TESLA + ROCKET TURRET + BIG TESLA in a row (side by side squares, rocket turret in the middle) = RAILGUN
                railgun: { hp: 300, every: 0.15, range: 2000, damage: 8, speed: 5000 } };
// FORMATIONS: specific arrangements in side-by-side grid squares fuse into a super building (see COMBOS for how-to).
//   orbital    = Radar | Big Laser | Radar (row or column)      -> sky beam on the toughest enemy anywhere
//   stormtower = 3 Big Teslas in an L (corner + 2 neighbours)    -> lives in the corner square
//   fortress   = Rocket Turret | Shield Generator | Rocket Turret -> lives in the generator's square
//   carrier    = Big Hangar next to a Command Tower (any side)   -> lives in the hangar's square
const FORMATIONS = {
  orbital:    { hp: 360, every: 6, delay: 1.1, radius: 120, damage: 140, size: 1.8 },
  stormtower: { hp: 420, radius: 2.4, dmgMul: 2, chains: 4, chainRange: 300, everyMul: 0.7, boltEvery: 2.5, bolts: 3, boltDmg: 45, size: 2 },
  fortress:   { hp: 600, range: 1150, every: 0.11, damage: 9, speed: 2600, rocketEvery: 4, shield: 250, shieldRegen: 30, shieldDelay: 3, dome: 280, overshield: 40, overEvery: 5 },
  carrier:    { hp: 380, drones: 5, dmgMul: 2, droneHp: 2, range: 1.4, size: 1.8 },
  hive:       { hp: 420, drones: 10, dmgMul: 0.9, droneHp: 0.8, range: 1.3, speed: 1.6, every: 0.7, dsc: 0.8, size: 1.8 },              // Hangar | Big Hangar | Hangar
  uplink:     { hp: 420, drones: 5, dmgMul: 1, droneHp: 1.5, range: 1.4, beam: 22, beamRange: 340, every: 0.6, dsc: 1.2, size: 1.8 }, // Big Hangar + Laser Tower
  // v85: every building has a mega upgrade. "trio" = small | BIG | small of the same building (row or column)
  artillery:  { hp: 520, every: 4, shells: 5, range: 2600, minRange: 120, damage: 60, radius: 130, flight: 1.3, size: 1.8 },          // Mortar trio
  aegis:      { hp: 560, radius: 2, every: 3, shield: 80, shieldTime: 6, repair: 12, size: 1.8 },                                        // Shield Generator trio
  inferno:    { hp: 600, range: 1.7, dmgMul: 2.5, fireEvery: 2.5, fireballs: 3, fireRange: 900, fireDmg: 40, fireRadius: 110, burn: 4, size: 1.8 }, // Flame Tower trio
  singularity:{ hp: 560, radius: 2, pull: 2.2, crushEvery: 3, crushDmg: 50, crushRadius: 0.55, size: 1.8 },                            // Gravity Tower trio
  watchtower: { hp: 420, every: 1.2, range: 3000, damage: 160, speed: 6000, size: 1.8 },                                                 // Big Sniper Nest + Radar
  citadel:    { hp: 1500, regen: 20, every: 0.45, damage: 18, range: 750, speed: 2200 },                                                 // Big Barrier + Shield Generator
};
const FORMATION_NAMES = { orbital: 'Orbital Strike', stormtower: 'Storm Tower', fortress: 'Fortress', carrier: 'Carrier', hive: 'Drone Hive', uplink: 'Drone Uplink', artillery: 'Artillery Battery',
  aegis: 'Aegis Dome', inferno: 'Inferno Tower', singularity: 'Black Hole Generator', watchtower: 'Watchtower', citadel: 'Citadel Wall' };

// Ability boosts: passives that only exist for one ability (you only see them once that ability is equipped).
// add / mul change that ability's numbers for you while it's equipped.
const ABILITY_PERKS = {
  grenade:    [{ id: 'bignade', name: 'Big Bang', desc: '+40% blast radius', mul: { radius: 1.4 } },
               { id: 'extranade', name: 'Extra Pin', desc: '+1 grenade per round', add: { uses: 1 } }],
  shield:     [{ id: 'longshield', name: 'Long Shield', desc: 'Shield lasts 12s', add: { duration: 5 } },
               { id: 'thickshield', name: 'Thick Shield', desc: 'Shield has 300 HP', add: { hp: 100 } }],
  regen:      [{ id: 'fastregen', name: 'Fast Healer', desc: 'Heal every 6s instead of 10s', add: { every: -4 } }],
  rpg:        [{ id: 'tworpg', name: 'Spare Rocket', desc: '3 rockets per round', add: { uses: 1 } },
               { id: 'bigrpg', name: 'Warhead', desc: '+40% blast radius', mul: { radius: 1.4 } }],
  energy:     [{ id: 'bigcan', name: 'Big Can', desc: 'Speed lasts 10s', add: { duration: 4 } }],
  burger:     [{ id: 'double', name: 'Double Patty', desc: '+1 burger per round', add: { uses: 1 } }],
  dash:       [{ id: 'moredash', name: 'Light Feet', desc: '+2 dashes', add: { uses: 2 } },
               { id: 'longdash', name: 'Long Dash', desc: '+50% dash distance', mul: { power: 1.5 } }],
  rapid:      [{ id: 'longrapid', name: 'Long Burst', desc: 'Rapid fire lasts 8s', add: { duration: 3 } }],
  armor:      [{ id: 'heavyarmor', name: 'Heavy Plates', desc: 'Take 30% less damage instead of 20%', add: { takeMul: -0.1 } }],
  hands:      [{ id: 'fasthands', name: 'Lightning Hands', desc: 'Reload 50% faster', add: { reloadMul: -0.15 } }],
  blink:      [{ id: 'farblink', name: 'Far Blink', desc: '+50% blink distance', mul: { range: 1.5 } },
               { id: 'moreblink', name: 'Extra Blink', desc: '+2 blinks', add: { uses: 2 } }],
  nova:       [{ id: 'bignova', name: 'Mega Nova', desc: '28 bullets per ring', add: { count: 12 } },
               { id: 'hotnova', name: 'Hot Lead', desc: '+8 damage per bullet', add: { damage: 8 } }],
  slowmo:     [{ id: 'longslow', name: 'Slower Time', desc: 'Bullet time lasts 8s', add: { duration: 3 } }],
  medic:      [{ id: 'bigheal', name: 'Big Zone', desc: '+50% size and +4 HP/s', mul: { radius: 1.5 }, add: { perSec: 4 } }],
  turret:     [{ id: 'longturret', name: 'Armored Turret', desc: 'Turret has 60 HP', add: { hp: 35 } },
               { id: 'moreturret', name: 'Spare Turret', desc: '+1 turret per round', add: { uses: 1 } }],
  resupply:   [{ id: 'quickcrate', name: 'Quick Drop', desc: 'Cooldown 5s', add: { cooldown: -5 } }],
  vampire:    [{ id: 'bloodlust', name: 'Bloodlust', desc: 'Heal 5 HP per hit', add: { heal: 2 } }],
  laststand:  [{ id: 'longstand', name: 'Unbreakable', desc: 'Unhittable for 6s', add: { inv: 3 } }],
  sprinter:   [{ id: 'marathon', name: 'Marathon', desc: '35% faster instead of 20%', add: { speed: 0.15 } }],
  bandolier:  [{ id: 'moremags', name: 'Ammo Belt', desc: '4 extra mags instead of 2', add: { mags: 2 } }],
  blackhole:  [{ id: 'bighole', name: 'Event Horizon', desc: '+30% size and stronger pull', mul: { radius: 1.3, pull: 1.4 } }],
  firepit:    [{ id: 'hotfire', name: 'Napalm', desc: '+8 burn damage per second', add: { dps: 8 } }],
  freeze:     [{ id: 'deepfreeze', name: 'Deep Freeze', desc: 'Freeze lasts 4s', add: { time: 1.5 } }],
  decoy:      [{ id: 'tankbuddy', name: 'Tough Buddy', desc: 'Buddy has 75 HP', add: { hp: 50 } },
               { id: 'quickbuddy', name: 'Quick Return', desc: 'Get a buddy back every 15s', add: { respawn: -15 } }],
  barrier:    [{ id: 'longwall', name: 'Great Wall', desc: '7 squares long, 250 HP', add: { len: 160, hp: 100 } }],
  mine:       [{ id: 'moremines', name: 'Minefield', desc: '+2 mines', add: { uses: 2 } },
               { id: 'bigmine', name: 'Claymore', desc: '+40 mine damage', add: { damage: 40 } }],
  jumppad:    [{ id: 'highjump', name: 'Super Spring', desc: 'Fly 50% further', mul: { air: 1.5 } }],
  radar:      [{ id: 'strongradar', name: 'Reinforced Tower', desc: 'Tower has 90 HP', add: { hp: 60 } }],
  tesla:      [{ id: 'overclock', name: 'Overclock', desc: 'Zaps almost twice as fast', mul: { every: 0.55 } },
               { id: 'bigcoil', name: 'Long Reach', desc: '+40% zap range', mul: { radius: 1.4 } }],
  smoke:      [{ id: 'longsmoke', name: 'Thick Smoke', desc: 'Smoke lasts 12s', add: { duration: 5 } }],
  grapple:    [{ id: 'longrope', name: 'Long Rope', desc: '+50% range and +2 hooks', mul: { range: 1.5 }, add: { uses: 2 } }],
  phase:      [{ id: 'longphase', name: 'Ghost Form', desc: 'Phase walk lasts 5s', add: { duration: 2 } }],
  reflect:    [{ id: 'longmirror', name: 'Hall of Mirrors', desc: 'Mirror lasts 5s', add: { duration: 2 } }],
  overcharge: [{ id: 'moreover', name: 'Supercharge', desc: '20 boosted shots', add: { shots: 8 } }],
  quake:      [{ id: 'bigslam', name: 'Earthshaker', desc: '+40% slam size, +10 damage', mul: { radius: 1.4 }, add: { damage: 10 } }],
  recall:     [{ id: 'quickrewind', name: 'Quick Rewind', desc: 'Jump back after 2s', add: { delay: -1 } }],
  thorns:     [{ id: 'sharpthorns', name: 'Sharp Thorns', desc: '14 spikes, +4 damage', add: { count: 6, damage: 4 } }],
  scavenger:  [{ id: 'hoarder', name: 'Hoarder', desc: 'Kills give a full mag and 15 HP', add: { mags: 0.5, heal: 5 } }],
  glass:      [{ id: 'crystal', name: 'Crystal Cannon', desc: '+75% damage instead of +50%', add: { mul: 0.25 } }],
  adrenaline: [{ id: 'rush', name: 'Rush', desc: 'Kicks in under 50% health', add: { below: 0.15 } }],
  cluster:    [{ id: 'morebombs', name: 'Big Cluster', desc: '10 small bombs', add: { bombs: 4 } }],
  bubble:     [{ id: 'bigbubble', name: 'Big Bubble', desc: '+40% size, lasts 9s', mul: { radius: 1.4 }, add: { duration: 3 } }],
  stim:       [{ id: 'cleanstim', name: 'Clean Stim', desc: 'Costs no HP', add: { cost: -10 } }],
  shadowstep: [{ id: 'longstep', name: 'Long Shadow', desc: '+50% range', mul: { range: 1.5 } }],
  magnet:     [{ id: 'bigmagnet', name: 'Super Magnet', desc: '+60% pull range', mul: { range: 1.6 } }],
  lucky:      [{ id: 'jackpot', name: 'Jackpot', desc: 'Ultimate crates 5x more often', add: { epic: 2 } }],
};
const ULTIMATES = {
  airstrike: { name: 'Airstrike', color: '#ff4757', bombs: 8, gap: 0.18, spacing: 120, radius: 120, damage: 60, delay: 0.8,
               desc: '8 bombs rain down in a line where you aim.' },
  nuke:      { name: 'Nuke', color: '#ffdd00', dist: 600, delay: 3, radius: 450, damage: 150,
               desc: 'A nuke lands where you aim after 3 seconds. HUGE blast — get away!' },
  minigun:   { name: 'Minigun', color: '#ff9f1a', duration: 8, delay: 0.045,
               desc: 'For 8 seconds your gun fires crazy fast and never runs out of ammo.' },
  god:       { name: 'God Mode', color: '#f6e58d', duration: 6, speed: 1.6,
               desc: 'For 6 seconds nothing can hurt you and you run 60% faster.' },
  laser:     { name: 'Orbital Laser', color: '#ff3df5', duration: 5, speed: 160, radius: 90, dps: 45,
               desc: 'A giant laser beam from space burns a path forward from where you aim.' },
  bullethell:{ name: 'Bullet Hell', color: '#7bed9f', duration: 4, every: 0.22, count: 20, damage: 12,
               desc: 'Rings of bullets spray out of you for 4 seconds.' },
  aimbot:    { name: 'Aimbot', color: '#00ffd0', shots: 5, turn: 9,
               desc: 'Your next 5 shots home in on enemies.' },
  wallhack:  { name: 'Wallhack', color: '#a29bfe', duration: 6,
               desc: 'For 6 seconds your bullets fly straight through walls.' },
  rockets:   { name: 'Rocket Rounds', color: '#e17055', duration: 5, delay: 0.3,
               desc: 'For 5 seconds every shot is an RPG rocket.' },
  tracker:   { name: 'Tracker', color: '#ff4d4d', duration: 10,
               desc: 'For 10 seconds you and your teammates get an arrow pointing at the nearest enemy.' },
  clones:    { name: 'Clone Army', color: '#dfe6e9', count: 3, hp: 25, duration: 85,
               desc: '3 buddies (25 HP each, last 1:25) with copies of your main gun jump in and hunt enemies.' },
  fountain:  { name: 'Fountain of Youth', color: '#55efc4', duration: 10, perSec: 6,
               desc: 'Instantly back to full health, then +6 HP every second for 10 seconds.' },
  meteors:   { name: 'Meteor Shower', color: '#e67e22', count: 18, spread: 380, dist: 550, radius: 90, damage: 40,
               desc: '18 meteors smash down around where you aim over 4 seconds.' },
  timestop:  { name: 'Time Stop', color: '#74b9ff', duration: 4,
               desc: 'Freezes every enemy for 4 seconds (in multiplayer: 3s) and slows their bullets.' },
  juggernaut:{ name: 'Juggernaut', color: '#636e72', duration: 10, shield: 200, mul: 1.5,
               desc: '10 seconds with a 200 HP shield and +50% damage.' },
  overdrive: { name: 'Overdrive', color: '#fd79a8', duration: 10,
               desc: 'For 10 seconds your ability has no cooldown and never runs out.' },
  carpet:    { name: 'Carpet Bomb', color: '#ff7f50', count: 30, length: 1000, width: 320, radius: 100, damage: 45,
               desc: '30 bombs carpet a huge strip of the map where you aim.' },
  fortress:  { name: 'Fortress', color: '#54a0ff', walls: 8, ring: 190,
               desc: 'A ring of 8 walls pops up around you, with a bubble shield in the middle.' },
  blinkstorm:{ name: 'Blink Storm', color: '#7d5fff', jumps: 6, every: 0.35, radius: 140, damage: 40,
               desc: 'You blink behind the closest enemy 6 times in a row, slamming them every time.' },
  frenzy:    { name: 'Frenzy', color: '#c56cf0', duration: 10, heal: 30, speed: 1.8, fire: 0.4,
               desc: '+30 HP, then 10 seconds of running 80% faster and shooting 2.5x as fast.' },
  turretnest:{ name: 'Turret Nest', color: '#cd84f1', count: 4, ring: 140,
               desc: '4 turrets with copies of your sidearm pop up around you.' },
  blizzard:  { name: 'Blizzard', color: '#74b9ff', count: 8,
               desc: '8 freeze bombs rain down around you (not on you).' },
  railcannon:{ name: 'Rail Cannon', color: '#48dbfb', length: 2600, width: 46, damage: 400, delay: 0.6,
               desc: 'Charge for a moment, then fire a giant rail beam where you aim. It goes through walls and everyone in the line takes 400 damage.' },
  megaslam:  { name: 'Mega Slam', color: '#b8845a', radius: 600, damage: 60, kb: 18,
               desc: 'A giant ground slam: 60 damage and a massive push to everyone around you.' },
};

// Hidden: the ability you have equipped makes some ultimates more likely from an epic crate.
// The matching ultimate gets `weight` tickets, every other one gets 1.
// MEGA BUILDINGS (formations) must be bought in the loadout's Mega tab ('mega:id', SHOP) once you own every building ability
// in `needs`. Not owned = the formation won't fuse (except Test mode / "All upgrades free"). name/how from COMBOS + FORMATION_NAMES.
const MEGA = {
  railgun:     { name: 'Railgun', needs: ['turret', 'tesla'], price: 3000, color: '#48dbfb',
                 does: 'A super-fast rail cannon that shreds enemies from very far away.' },
  fortress:    { needs: ['turret', 'shieldgen'], price: 3500, color: '#6c5ce7', does: '4-barrel gun + rockets, a regenerating shield and an overshield for you inside its dome.' },
  stormtower:  { needs: ['tesla'], price: 3500, color: '#a29bfe', does: 'Huge range, zaps chain to 4 more enemies and lightning falls from its storm cloud.' },
  orbital:     { needs: ['laser', 'radar'], price: 4500, color: '#ff2e63', does: 'Every 6s a sky beam hits the toughest enemy anywhere on the map (140 damage).' },
  carrier:     { needs: ['hangar', 'radar', 'decoy'], price: 4500, color: '#00d2d3', does: '5 big drones, double damage, longer reach.' },
  hive:        { needs: ['hangar'], price: 3500, color: '#ffd32a', does: '10 small, fast drones that shoot quicker.' },
  uplink:      { needs: ['hangar', 'laser'], price: 4500, color: '#ff2e63', does: '5 drones that shoot laser beams that never miss (22 damage).' },
  artillery:   { needs: ['mortar'], price: 3500, color: '#e67e22', does: 'Every 4s fires 5 shells at 5 enemies almost anywhere on the map.' },
  aegis:       { needs: ['shieldgen'], price: 3500, color: '#6c5ce7', does: 'Giant dome: overshield for you, repairs buildings and stops enemy bullets.' },
  inferno:     { needs: ['flame'], price: 3500, color: '#ff5e1a', does: 'Fire all the way around (stronger, further) + fireballs at far enemies.' },
  singularity: { needs: ['gravity'], price: 4000, color: '#7d5fff', does: 'Pulls enemies from twice as far and crushes everything near its core.' },
  watchtower:  { needs: ['sniper', 'radar'], price: 5000, color: '#20bf6b', does: 'Snipes the toughest enemy anywhere on the map through walls every 1.2s (160 damage).' },
  citadel:     { needs: ['barrier', 'shieldgen'], price: 4000, color: '#54a0ff', does: '1500 HP wall that repairs itself, with a gun tower at each end.' },
};
const ULT_CHARGE = { damage: 1800, perSec: 3 }; // charge: 1 point per damage you deal + perSec every second; full at `damage`
const ULT_AFFINITY = {
  weight: 6,
  cluster: 'carpet', bubble: 'fortress', stim: 'frenzy', shadowstep: 'blinkstorm', magnet: 'overdrive', ninja: 'wallhack', lucky: 'overdrive',
  grenade: 'airstrike', rpg: 'rockets', nova: 'bullethell', rapid: 'minigun', shield: 'juggernaut',
  regen: 'fountain', medic: 'fountain', burger: 'fountain', vampire: 'fountain', energy: 'god', dash: 'god',
  sprinter: 'frenzy', laststand: 'god', blink: 'blinkstorm', smoke: 'wallhack', grapple: 'wallhack', phase: 'wallhack',
  turret: 'turretnest', decoy: 'clones', slowmo: 'timestop', freeze: 'blizzard', recall: 'timestop',
  blackhole: 'nuke', glass: 'nuke', firepit: 'meteors', mine: 'meteors', jumppad: 'airstrike',
  quake: 'megaslam', radar: 'tracker', tesla: 'railcannon', overcharge: 'aimbot', reflect: 'juggernaut',
  armor: 'juggernaut', barrier: 'fortress', resupply: 'overdrive', hands: 'overdrive', scavenger: 'overdrive',
  bandolier: 'minigun', adrenaline: 'minigun', thorns: 'bullethell',
};

// SHOP: unlocks cost banked score. Bought = yours forever (Account.user.owned) (earned in single player, not test mode). Free things never need buying.
const SHOP = {
  freeAbilities: ['grenade', 'shield', 'regen', 'dash', 'energy', 'burger', 'armor', 'hands', 'medic', 'resupply'],
  freeParts: 1,          // the first part of each slot (per gun) is free
  part: 300,             // each later part in a slot costs +300 more (300, 600, ...) up to partMax
  partMax: 2000,
  ability: { active: 1000, passive: 1200, gadget: 1500, building: 2500 },
  perk: 800,
  special: { radar: 5000, sensor: 200 }, // abilities with their own price
  start: 200,            // score new players start with
};
// first 10 waves of single player are easier (fewer, weaker, slower-spawning enemies)
const EASY = { waves: 10, hp: 0.55, count: 0.6, spawn: 1.6, damage: 0.6 };

// decoy teamwork: a 2nd decoy goes for the next-nearest enemy unless the first one's target has more than `crowd`
// enemies within crowdRadius (then it goes along to help). Spare targets further than maxSpread are skipped.
const DECOY_AI = { crowd: 2, crowdRadius: 250, maxSpread: 1400 };
// TEAMWORK (single player): every enemy has danger points, every buddy / drone has strength points.
// The most dangerous enemies are handled first: buddies + drones are sent until their strength adds up to its danger.
const DANGER = { grunt: 5, gunslinger: 5, runner: 3, shooter: 6, tank: 15, bomber: 6, splitter: 8, sniper: 8, healer: 8, boss: 100, mini: 25,
                 attackMul: 3, attackFor: 5 }; // hit your decoy/drones = x3 danger for that one building, for 5s after the last hit
const STRENGTH = { decoy: 5, drone: 3, bigDrone: 4, carrierDrone: 5, hiveDrone: 2, uplinkDrone: 4 };

// WHAT'S NEW: shown once on the main menu when the version is newer than the one the player last saw. Newest first.
// Every update adds an entry here (short, simple words).
const UPDATES = [
  { v: 94, title: 'Drones follow you', notes: ['Engineer: use Upgrade on a MAX level Drone Hangar to switch its drones between FOLLOW (they fly with you) and STAY.', 'Only one hangar can follow you at a time.'] },
  { v: 93, title: 'Even more drones', notes: ['5 new drone types! Throw onto a Drone Hangar:', 'Bubble Shield = Guardian Drones (fly around you and block bullets)', 'Grenade = Bomber Drones (drop bombs on groups)', 'Motion Sensor = Sniper Drones (stay far back, big hits)', 'Smoke Bomb = Ghost Drones (bullets go through them, enemies they hit take more damage)', 'Black Hole = Gravity Drones (pull enemies together)', 'Your gun is always under your player now.'] },
  { v: 92, title: 'New drone powers', notes: ['Throw a Freeze Bomb, Fire Pit, Tesla Coil or Land Mine onto a Drone Hangar to get Frost, Flame, Shock or Kamikaze Drones!', 'New mega buildings: Drone Hive (Hangar | Big Hangar | Hangar) with 10 fast drones, and Drone Uplink (Big Hangar next to a Laser Tower) whose drones shoot lasers.', 'Buy them in the 🏰 Mega tab.'] },
  { v: 91, title: 'Hex shield is back', notes: ['The Aegis Dome has its hexagon shield pattern again.'] },
  { v: 90, title: 'Cleaner mega buildings', notes: ['Artillery Battery, Aegis Dome, Inferno Tower, Black Hole Generator, Watchtower and Citadel Wall have new simple looks.', 'They all stand on a hexagon base like the Railgun, with one bright colour each. The Fortress got a hexagon base too.'] },
  { v: 89, title: 'Ability joysticks on phones', notes: ['On phones every ability button is now a little green joystick.', 'Drag it to aim where your throw lands (pull further = throw further), let go to use it.', 'Drag out and back to the middle to cancel. A quick tap still auto-aims.'] },
  { v: 88, title: 'Revive your teammates', notes: ['In Teams and Co-op, when a teammate dies they leave a ghost for 10 seconds.', 'Stand on the ghost for 3 seconds WITHOUT shooting to bring them back (abilities are OK).', 'They come back with half health in the same round. Enemies can see the ghost but cannot revive it.'] },
  { v: 87, title: 'Buy mega buildings', notes: ['Mega buildings (Railgun, Fortress, Watchtower...) are now bought with score in the new 🏰 Mega tab.', 'You must own the buildings they are made from first (Railgun needs Turret + Tesla).', 'Test mode and "All upgrades free" games still let you build them all.'] },
  { v: 86, title: 'Ultimates fixed', notes: ['Ultimates can NOT be bought anymore. They only come from gold crates again.', 'If you bought one, you got your score back.'] },
  { v: 85, title: 'Mega buildings for everyone', notes: [
    'Every building now has a MEGA version! Make a Big one (3 in one square) and put the right buddy building next to it.',
    'Artillery Battery: Mortar | Big Mortar | Mortar. Shoots 5 shells across the map.',
    'Aegis Dome: Shield Gen | Big Shield Gen | Shield Gen. Huge dome that stops enemy bullets.',
    'Inferno Tower: Flame | Big Flame | Flame. Fire all around + fireballs.',
    'Black Hole Generator: Gravity | Big Gravity | Gravity. Pulls from far and crushes.',
    'Watchtower: Big Sniper Nest + a Radar next to it. Snipes the toughest enemy anywhere.',
    'Citadel Wall: Big Barrier + a Shield Generator touching it. 1500 HP wall with 2 gun towers.',
    'The Command Tower now looks like a real tall radar tower.'] },
  { v: 84, title: 'Door', notes: ['New Door ability (Movement): aim at a wall to open a doorway, press again to close it.'] },
  { v: 83, title: 'Ultimates shop + new combos', notes: [
    'Buy ultimates in the new Ultimate tab. You need the right abilities first (Rail Cannon needs Turret + Tesla).',
    'Your ultimate charges up when you hit enemies. Press F (or the gold button) when it is ready!',
    'New Rail Cannon ultimate: a giant beam that goes through walls.',
    '12 new combos for non-building abilities: Frost Fog, Healing Mist, Spring Trap, Napalm, Shield Bash and more.',
    'RPG now has 2 rockets. Bullet Nova and Ground Slam hit harder.',
    'You can now buy things from Customize Guns on the main menu.',
    'New Motion Sensor (only 200 score): a hidden trap that shows you sneaky enemies, then goes boom.',
    'Radar now costs 5000 score.',
    'Press Esc to close a building\'s stats card.',
  ] },
  { v: 82, title: 'Hangar drones', notes: ['Upgrading a Drone Hangar adds drones: +1 per level, +2 on big hangars.'] },
  { v: 81, title: 'Co-op mode', notes: ['Play together against waves and bosses in Co-op.', 'Hosts can pick 1-10 rounds per game.'] },
  { v: 79, title: 'Controls + size', notes: ['Change your keys in Settings.', 'Make buttons and menus bigger or smaller.', 'Test mode can spawn any enemy.'] },
  { v: 77, title: 'Inspect buildings', notes: ['Double tap or right click a building to see its stats.', 'Building upgrades now add range too.'] },
];
