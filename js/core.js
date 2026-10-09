// Shared helpers: geometry, gun assembly + stats, art loading, accounts, settings.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// ---------------------------------------------------------------- geometry
function pushOutOfRect(c, [rx, ry, rw, rh]) {
  const nx = clamp(c.x, rx, rx + rw), ny = clamp(c.y, ry, ry + rh);
  let dx = c.x - nx, dy = c.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= c.r * c.r) return;
  if (d2 > 0) {
    const d = Math.sqrt(d2);
    c.x = nx + dx / d * c.r; c.y = ny + dy / d * c.r;
  } else { // centre is inside the rect: leave by the nearest side
    const l = c.x - rx, r = rx + rw - c.x, t = c.y - ry, b = ry + rh - c.y, m = Math.min(l, r, t, b);
    if (m === l) c.x = rx - c.r; else if (m === r) c.x = rx + rw + c.r;
    else if (m === t) c.y = ry - c.r; else c.y = ry + rh + c.r;
  }
}

function collideWorld(c) {
  for (const w of MAP.walls) pushOutOfRect(c, w);
  c.x = clamp(c.x, c.r, MAP.w - c.r);
  c.y = clamp(c.y, c.r, MAP.h - c.r);
}

function pointInWall(x, y) {
  if (x < 0 || y < 0 || x > MAP.w || y > MAP.h) return true;
  return MAP.walls.some(([rx, ry, rw, rh]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh);
}

// Liang–Barsky segment vs rectangle
function segmentHitsRect(x1, y1, x2, y2, [rx, ry, rw, rh]) {
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

function lineOfSight(x1, y1, x2, y2) {
  return !MAP.walls.some(w => segmentHitsRect(x1, y1, x2, y2, w));
}

// ---------------------------------------------------------------- guns
const DRAW_ORDER = { stock: 0, mag: 1, barrel: 2, silencer: 3, body: 4, handle: 5 };

// Multiplayer rules set by the host. banned = Set of 'slot:id' upgrades nobody can use.
const Rules = { banned: new Set() };

// parts a gun is allowed to use in a slot
function partsFor(kind, slot) {
  return PARTS[slot].filter(p => ((p.gun || 'main') === kind || p.gun === 'both') && !Rules.banned.has(slot + ':' + p.id));
}

// a copy of the build with anything not allowed (wrong gun or banned) removed
function allowedBuild(kind, build) {
  const out = {};
  for (const s of SLOTS) out[s.key] = partsFor(kind, s.key).some(p => p.id === build[s.key]) ? build[s.key] : null;
  return out;
}

function findPart(slot, id) {
  return id ? PARTS[slot].find(p => p.id === id) || null : null;
}

// Positions every piece relative to the hand (0,0).
function layoutGun(kind, build) {
  const g = GUNS[kind];
  const ox = -g.hand.x, oy = -g.hand.y;
  // a Main Body upgrade replaces how the body looks; sockets stay the same
  const pieces = [{ slot: 'body', part: findPart('body', build.body) || g, x: ox, y: oy }];
  const put = (slot, part, at) => {
    const pc = { slot, part, x: at.x - part.anchor.x, y: at.y - part.anchor.y };
    pieces.push(pc);
    return pc;
  };
  const socket = k => ({ x: ox + g.sockets[k].x, y: oy + g.sockets[k].y });

  let muzzle = socket('barrel');
  for (const slot of ['barrel', 'silencer']) {
    const part = findPart(slot, build[slot]);
    if (!part) continue;
    const pc = put(slot, part, muzzle);
    muzzle = { x: pc.x + part.tip.x, y: pc.y + part.tip.y };
  }
  for (const slot of ['mag', 'handle', 'stock']) {
    if (!g.sockets[slot]) continue;
    const part = findPart(slot, build[slot]);
    if (part) put(slot, part, socket(slot));
  }
  pieces.sort((a, b) => DRAW_ORDER[a.slot] - DRAW_ORDER[b.slot]);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pieces) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.part.w); maxY = Math.max(maxY, p.y + p.part.h);
  }
  return { pieces, muzzle, minX, minY, w: maxX - minX, h: maxY - minY };
}

function drawPart(ctx, part, x, y) {
  if (part._img) {
    ctx.imageSmoothingEnabled = !PIXEL_ART;
    ctx.drawImage(part._img, x, y, part.w, part.h);
    return;
  }
  ctx.fillStyle = part.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  for (const [rx, ry, rw, rh] of part.shape || [[0, 0, part.w, part.h]]) {
    ctx.fillRect(x + rx, y + ry, rw, rh);
    ctx.strokeRect(x + rx + 0.5, y + ry + 0.5, rw - 1, rh - 1);
  }
}

function drawGun(ctx, layout) {
  for (const p of layout.pieces) drawPart(ctx, p.part, p.x, p.y);
}

function renderGunSprite(kind, build, res = 3) {
  const L = layoutGun(kind, build);
  const c = document.createElement('canvas');
  c.width = Math.ceil(L.w * res); c.height = Math.ceil(L.h * res);
  const g = c.getContext('2d');
  g.scale(res, res);
  g.translate(-L.minX, -L.minY);
  drawGun(g, L);
  return { canvas: c, minX: L.minX, minY: L.minY, w: L.w, h: L.h, muzzle: L.muzzle };
}

function computeStats(kind, build) {
  const s = { ...GUNS[kind].base };
  const parts = SLOTS.map(sl => findPart(sl.key, build[sl.key])).filter(Boolean);
  for (const p of parts) for (const k in p.add || {}) s[k] += p.add[k];
  for (const p of parts) for (const k in p.mul || {}) s[k] *= p.mul[k];
  s.damage = Math.max(1, s.damage);
  s.knockback = Math.max(0.5, s.knockback);
  s.reloadTime = Math.max(0.3, s.reloadTime);
  s.magSize = Math.max(1, Math.round(s.magSize));
  s.loudness = Math.max(0, s.loudness);
  s.fireDelay = s.knockback * 0.1;          // every point of knockback = 0.1s between shots
  s.hearRadius = s.loudness * HEAR_UNIT;
  const body = findPart('body', build.body) || {};
  s.pellets = body.pellets || 1;
  s.spread = body.spread || 0.05;
  s.range = body.range || BULLET_RANGE;
  s.speed = body.speed || BULLET_SPEED;
  s.falloff = body.falloff || 0;
  s.assist = body.assist || 1;
  return s;
}

function formatStat(key, v) {
  if (key === 'reloadTime') return `${v.toFixed(1)}s`;
  if (key === 'knockback') return `${v.toFixed(1)} (${(v * 0.1).toFixed(2)}s)`;
  if (key === 'magSize') return String(v);
  return (Math.round(v * 10) / 10).toString();
}

// "+6 damage", "×0.2 loudness" etc. good = whether it helps you
const LOWER_IS_BETTER = new Set(['reloadTime', 'knockback', 'loudness']);
function describeMods(part) {
  const label = k => STATS.find(s => s.key === k).label.toLowerCase();
  const out = [];
  for (const k in part.add || {}) {
    const v = part.add[k];
    out.push({ text: `${v > 0 ? '+' : ''}${v} ${label(k)}`, good: (v > 0) !== LOWER_IS_BETTER.has(k) });
  }
  for (const k in part.mul || {}) {
    const pct = Math.round((part.mul[k] - 1) * 100);
    out.push({ text: `${pct > 0 ? '+' : ''}${pct}% ${label(k)}`, good: (pct > 0) !== LOWER_IS_BETTER.has(k) });
  }
  if (part.note) out.unshift({ text: part.note, good: true });
  return out;
}

// ---------------------------------------------------------------- art
let onArtLoaded = () => {};
function loadArt() {
  const items = [...Object.values(GUNS), ...Object.values(PARTS).flat(), PLAYER, ...Object.values(ENEMIES)];
  for (const item of items) {
    const img = new Image();
    img.onload = () => { item._img = img; onArtLoaded(); };
    img.src = item.img;
  }
}

// ---------------------------------------------------------------- storage
const Store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

// Device settings (not per account).
const Settings = {
  mobile: Store.get('cgg.settings', {}).mobile ?? matchMedia('(pointer: coarse)').matches,
  save() { Store.set('cgg.settings', { mobile: this.mobile }); },
};

// Simple string hash (cyrb53). Accounts are stored on this device only.
function hashString(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const emptyBuild = () => ({ barrel: null, mag: null, handle: null, stock: null, silencer: null });

const Account = {
  user: null,
  login(name, password, signup) {
    name = name.trim();
    if (name.length < 2) return { error: 'Name needs at least 2 characters.' };
    if (password.length < 3) return { error: 'Password needs at least 3 characters.' };
    const all = Store.get('cgg.accounts', {});
    const key = name.toLowerCase();
    const hash = hashString(key + ':' + password);
    let created = false;
    if (signup && all[key]) return { error: 'That name is taken. Log in instead.' };
    if (!signup && !all[key]) return { error: 'No account with that name. Sign up first.' };
    if (!all[key]) {
      all[key] = { name, hash, best: 0, loadout: { main: { ...emptyBuild(), barrel: 'long', handle: 'grip' }, secondary: emptyBuild() } };
      Store.set('cgg.accounts', all);
      created = true;
    } else if (all[key].hash !== hash) {
      return { error: 'Wrong password for that name.' };
    }
    this.user = all[key];
    for (const kind of ['main', 'secondary']) {
      const b = { ...emptyBuild(), ...this.user.loadout[kind] };
      for (const s of SLOTS) if (b[s.key] && !partsFor(kind, s.key).some(p => p.id === b[s.key])) b[s.key] = null;
      this.user.loadout[kind] = b;
    }
    Store.set('cgg.lastName', name);
    return { ok: true, created };
  },
  save() {
    if (!this.user) return;
    const all = Store.get('cgg.accounts', {});
    all[this.user.name.toLowerCase()] = this.user;
    Store.set('cgg.accounts', all);
  },
  logout() { this.user = null; },
};
