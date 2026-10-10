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
  ],
  handle: [
    { id: 'grip',   name: 'Grip Handle',   w: 14, h: 22, color: '#1abc9c', gun: 'both', add: { knockback: -0.3 } },
    { id: 'angled', name: 'Angled Handle', w: 16, h: 20, color: '#e84393', add: { knockback: -0.2, reloadTime: -0.1 } },
    { id: 'pistol', name: 'Pistol Handle', w: 13, h: 22, color: '#636e72', add: { damage: 2, knockback: -0.1 } },
    { id: 'heavy',  name: 'Heavy Handle',  w: 18, h: 24, color: '#d35400', add: { damage: 3, reloadTime: 0.2 } },
    { id: 'quick',  name: 'Quick Handle',  w: 12, h: 20, color: '#ff79c6', gun: 'both', add: { reloadTime: -0.3 } },
  ],
  stock: [
    { id: 'light',    name: 'Light Stock',    w: 32, h: 10, color: '#c0392b', add: { knockback: -0.2 } },
    { id: 'skeleton', name: 'Skeleton Stock', w: 34, h: 12, color: '#fd79a8', add: { reloadTime: -0.3 } },
    { id: 'tactical', name: 'Tactical Stock', w: 38, h: 14, color: '#00bcd4', add: { knockback: -0.1, reloadTime: -0.2 } },
    { id: 'padded',   name: 'Padded Stock',   w: 40, h: 16, color: '#6c5ce7', add: { knockback: -0.4 } },
    { id: 'heavy',    name: 'Heavy Stock',    w: 46, h: 18, color: '#a0522d', add: { knockback: -0.6, reloadTime: 0.3 } },
    { id: 'folding',  name: 'Folding Stock',  w: 22, h: 8,  color: '#fab1a0', gun: 'secondary', add: { knockback: -0.3 } },
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
    { id: 'hollow',  name: 'Hollow Points', mount: 'side', w: 12, h: 8,  color: '#e17055', gun: 'both', mul: { damage: 1.25, magSize: 0.8 },
      note: 'Hit harder, fewer bullets per mag' },
  ],
  // Silencers make you much quieter but each one makes one stat worse.
  silencer: [
    { id: 'red',    name: 'Red Silencer',    w: 34, h: 12, color: '#ff4757', gun: 'both', mul: { loudness: 0.2 }, add: { damage: -4 } },
    { id: 'blue',   name: 'Blue Silencer',   w: 34, h: 12, color: '#3742fa', gun: 'both', mul: { loudness: 0.2 }, add: { reloadTime: 0.5 } },
    { id: 'yellow', name: 'Yellow Silencer', w: 34, h: 12, color: '#ffa502', gun: 'both', mul: { loudness: 0.2 }, add: { knockback: 0.5 } },
    { id: 'green',  name: 'Green Silencer',  w: 34, h: 12, color: '#2ed573', mul: { loudness: 0.2, magSize: 0.75 } },
    { id: 'black',  name: 'Black Silencer',  w: 40, h: 13, color: '#2d3436', mul: { loudness: 0.1 }, add: { damage: -6 } },
  ],
};

// Single player enemies. size = drawn size, r = hitbox radius.
// Enemies with `gun` shoot at you (and you can hear them).
const ENEMIES = {
  grunt:   { size: 40, r: 16, color: '#e05555', hp: 40,   speed: 115, melee: 12, score: 10 },
  runner:  { size: 30, r: 12, color: '#f0a84e', hp: 20,   speed: 200, melee: 7,  score: 10 },
  shooter: { size: 40, r: 16, color: '#4ecdc4', hp: 35,   speed: 90,  melee: 8,  score: 15, keepDistance: 380,
             gun: { damage: 9, delay: 1.1, loudness: 7, speed: 700 } },
  boss:    { size: 110, r: 46, color: '#9b59b6', hp: 1200, speed: 55, melee: 30, score: 200,
             gun: { damage: 12, delay: 1.6, loudness: 12, speed: 600 } },
};
const BOSS_EVERY = 5; // a boss shows up every 5th wave

const PLAYER = { size: 46, r: 18, hp: 100, speed: 250 };
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
const AMMO = { spareMags: 3, box: { count: 2, refillMags: 1, r: 16 } };

// Abilities: pick one before each round. Active ones use E on PC / the green button on mobile.
// uses = how many times per round (2 for everything except the RPG, which gets one shot).
const ABILITIES = {
  grenade: { name: 'Grenade', type: 'active', thrown: true, color: '#6ab04c', cooldown: 15, uses: 2,
             damage: 100, radius: 130, range: 650, flight: 0.8,
             desc: 'Hold to aim (white line shows the path), let go to throw. Flies over walls. 100 damage.' },
  shield:  { name: 'Shield', type: 'active', color: '#3b82f6', cooldown: 30, uses: 2, duration: 7, hp: 200,
             desc: 'A 200 HP shield for 7 seconds. Your health bar turns blue.' },
  regen:   { name: 'Regeneration', type: 'passive', color: '#2ecc71', every: 10, heal: 10,
             desc: 'Passive: +10 HP for every 10 seconds you are out of combat.' },
  rpg:     { name: 'RPG', type: 'active', color: '#e17055', uses: 1, damage: 70, direct: 100, radius: 120, speed: 750,
             desc: 'ONE rocket per round. 100 damage on a direct hit, 70 in the blast. Explodes on walls.' },
  energy:  { name: 'Energy Drink', type: 'active', color: '#f9ca24', cooldown: 5, uses: 2, heal: 10, speed: 1.7, duration: 6,
             desc: 'Heals 10 HP and makes you 1.7x faster for 6 seconds.' },
  burger:  { name: 'Burger', type: 'active', color: '#cd6133', cooldown: 5, uses: 2, heal: 100,
             desc: 'Eat it to heal 100 HP.' },
  dash:    { name: 'Dash', type: 'active', color: '#00d2d3', cooldown: 4, uses: 4, power: 1800,
             desc: '4 quick dashes per round in the way you are walking (or aiming if standing still).' },
  rapid:   { name: 'Rapid Fire', type: 'active', color: '#ff4d6d', cooldown: 20, uses: 2, duration: 5, fireMul: 0.5,
             desc: 'Your guns shoot twice as fast for 5 seconds.' },
  armor:   { name: 'Body Armor', type: 'passive', color: '#95a5a6', takeMul: 0.8,
             desc: 'Passive: you take 20% less damage.' },
  hands:   { name: 'Quick Hands', type: 'passive', color: '#a55eea', reloadMul: 0.65,
             desc: 'Passive: reload 35% faster.' },
  blink:    { name: 'Blink', type: 'active', color: '#7d5fff', cooldown: 6, uses: 3, range: 380,
              desc: 'Teleport forward where you aim, even through walls. 3 per round.' },
  nova:     { name: 'Bullet Nova', type: 'active', color: '#ffa801', cooldown: 15, uses: 2, count: 16, damage: 15, speed: 1100, range: 600,
              desc: 'Shoot 16 bullets in a ring all around you, 15 damage each.' },
  slowmo:   { name: 'Bullet Time', type: 'active', color: '#18dcff', cooldown: 25, uses: 2, duration: 5, factor: 0.35,
              desc: 'For 5 seconds enemy bullets (and in single player, enemies) move in slow motion.' },
  medic:    { name: 'Heal Zone', type: 'active', thrown: true, color: '#32ff7e', cooldown: 20, uses: 2, duration: 8, radius: 110, perSec: 8,
              desc: 'Hold to aim, let go to throw a healing circle: +8 HP every second while you stand in it (8s).' },
  turret:   { name: 'Turret', type: 'active', thrown: true, color: '#cd84f1', cooldown: 25, uses: 2, duration: 12, delay: 0.35, damage: 7, range: 650,
              desc: 'Hold to aim, let go to throw a turret. It uses a copy of your sidearm (its damage, fire rate and bullets) and shoots the closest enemy it can see for 12s.' },
  resupply: { name: 'Resupply', type: 'active', color: '#fff200', cooldown: 10, uses: 2,
              desc: 'Instantly fills both guns and gives each one an extra spare mag.' },
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
  decoy:     { name: 'Decoy', type: 'active', thrown: true, gadget: true, color: '#dfe6e9', cooldown: 20, uses: 2,
               radius: 20, duration: 15, hp: 100, speed: 220,
               desc: 'Throw a buddy on your team. It carries a copy of your main gun and hunts down enemies (100 HP, 15s).' },
  barrier:   { name: 'Barrier', type: 'active', thrown: true, gadget: true, color: '#54a0ff', cooldown: 15, uses: 3,
               radius: 180, duration: 7, len: 360, thick: 36,
               desc: 'Throw a wall that pops up where it lands. Blocks bullets and movement for 7s.' },
  mine:      { name: 'Land Mine', type: 'active', thrown: true, gadget: true, color: '#c0392b', cooldown: 6, uses: 3,
               radius: 130, trigger: 60, damage: 80, life: 45, arm: 0.8,
               desc: 'Throw a hidden mine (enemies can\'t see it). Explodes for 80 damage when an enemy walks over it.' },
  jumppad:   { name: 'Jump Pad', type: 'active', thrown: true, gadget: true, color: '#1dd1a1', cooldown: 12, uses: 2,
               radius: 40, duration: 15, speed: 1400, air: 0.45,
               desc: 'Throw a launch pad. Step on it to get flung over walls in the direction you threw it (you and teammates).' },
  radar:     { name: 'Radar', type: 'active', thrown: true, gadget: true, color: '#ff9ff3', cooldown: 25, uses: 2,
               radius: 1100, duration: 10, hp: 30, building: true,
               desc: 'Throw a radar tower (30 HP, 10s). You and your teammates get an arrow to the nearest enemy, and see enemies near it through walls.' },
  tesla:     { name: 'Tesla Coil', type: 'active', thrown: true, gadget: true, color: '#48dbfb', cooldown: 25, uses: 2,
               radius: 230, duration: 10, every: 0.6, damage: 10, hp: 100, building: true,
               desc: 'Throw a tesla tower (100 HP, 10s) that zaps every enemy close to it with lightning (10 damage).' },
  smoke:     { name: 'Smoke Bomb', type: 'active', thrown: true, gadget: true, color: '#a4b0be', cooldown: 18, uses: 2,
               radius: 300, duration: 7,
               desc: 'Throw a big thick smoke cloud nobody can see through for 7s. Enemies can\'t shoot you through it.' },

  // ---- instant actives ----
  grapple:   { name: 'Grappling Hook', type: 'active', color: '#e1b12c', cooldown: 5, uses: 4, range: 700, pull: 1500,
               desc: 'Shoot a hook at a wall where you aim and zip over to it.' },
  phase:     { name: 'Phase Walk', type: 'active', color: '#9c88ff', cooldown: 20, uses: 2, duration: 3,
               desc: 'For 3 seconds you can walk straight through walls.' },
  reflect:   { name: 'Mirror', type: 'active', color: '#f5f6fa', cooldown: 20, uses: 2, duration: 3,
               desc: 'For 3 seconds every bullet that hits you bounces straight back at the shooter.' },
  overcharge:{ name: 'Overcharge', type: 'active', color: '#fbc531', cooldown: 20, uses: 2, shots: 12, mul: 2,
               desc: 'Your next 12 shots do double damage.' },
  quake:     { name: 'Ground Slam', type: 'active', color: '#b8845a', cooldown: 15, uses: 2, radius: 280, damage: 20, kb: 10,
               desc: 'Slam the ground: 20 damage and a huge push to every enemy around you.' },
  recall:    { name: 'Rewind', type: 'active', color: '#00a8ff', cooldown: 20, uses: 2, delay: 3,
               desc: 'Marks where you are. 3 seconds later you jump back there with the health you had then.' },

  // ---- passives ----
  thorns:    { name: 'Thorns', type: 'passive', color: '#6ab04c', count: 8, damage: 6, cd: 0.8,
               desc: 'Passive: whenever you get hurt, 8 spikes shoot out of you in every direction.' },
  scavenger: { name: 'Scavenger', type: 'passive', color: '#cc8e35', heal: 10, mags: 0.5,
               desc: 'Passive: every kill gives you 10 HP and half a mag of ammo.' },
  glass:     { name: 'Glass Cannon', type: 'passive', color: '#ff7979', hp: 65, mul: 1.5,
               desc: 'Passive: your guns do 50% more damage, but you only have 65 max HP.' },
  adrenaline:{ name: 'Adrenaline', type: 'passive', color: '#eb4d4b', below: 0.35, speed: 1.3, fire: 0.7,
               desc: 'Passive: when you are under 35% health you run 30% faster and shoot 30% faster.' },
};
const LOADOUT_PRESETS = 3; // saved loadouts you can switch between

// Rare red crate: restores all your ability uses. Chance that one shows up each time packs spawn.
const ABILITY_CRATE = { chance: 0.6 };
