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
const DRAW_ORDER = { stock: 0, mag: 1, barrel: 2, silencer: 3, body: 4, handle: 5, extra: 6 };

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

// what an unlock costs in banked score; 0 = free or already owned. key = 'ab:id' | 'perk:id' | 'part:kind:slot:id'
function priceOf(key) {
  if (!Account.user || Account.user.owned.includes(key)) return 0;
  const [type, a, b, c] = key.split(':');
  if (type === 'ab') {
    const A = ABILITIES[a];
    return SHOP.freeAbilities.includes(a) ? 0 : A.building || a === 'turret' ? SHOP.ability.building : A.gadget ? SHOP.ability.gadget : A.type === 'passive' ? SHOP.ability.passive : SHOP.ability.active;
  }
  if (type === 'perk') return SHOP.perk;
  const i = PARTS[b].filter(p => (p.gun || 'main') === a || p.gun === 'both').findIndex(p => p.id === c);
  return i < SHOP.freeParts ? 0 : Math.min(SHOP.partMax, (i - SHOP.freeParts + 1) * SHOP.part);
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
  // Extra: where it sits depends on its mount (muzzle = on the end, top = on top of the body, ...)
  const extra = findPart('extra', build.extra);
  if (extra) {
    const bodyW = g.w, bar = socket('barrel'), hd = socket('handle');
    if (extra.mount === 'muzzle') {
      const pc = put('extra', extra, muzzle);
      muzzle = { x: pc.x + extra.w, y: pc.y + extra.h / 2 };
    } else {
      const at = extra.mount === 'top'     ? { x: ox + bodyW * 0.55 - extra.w / 2, y: oy - extra.h + 2 }
               : extra.mount === 'under'   ? { x: bar.x - extra.w - 4, y: bar.y + 6 }
               : extra.mount === 'trigger' ? { x: hd.x + 7, y: hd.y - 2 }
               :                             { x: ox + bodyW * 0.3, y: oy + 3 }; // side
      pieces.push({ slot: 'extra', part: extra, x: at.x, y: at.y });
    }
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

// which slot each part belongs to (for the drawing style)
const PART_SLOT = new Map();
for (const k in PARTS) for (const p of PARTS[k]) PART_SLOT.set(p, k);

// ---- realistic vector parts (until real art arrives): real materials + real silhouettes
const MATS = {
  steel: ['#646a74', '#383c43', '#1c1e22'],
  dark:  ['#4a4e55', '#2a2d32', '#141518'],
  poly:  ['#45484e', '#2a2c30', '#151618'],
  wood:  ['#b0723f', '#83502a', '#4f2e15'],
  tan:   ['#cdb88f', '#a68f66', '#6e5c3d'],
  brass: ['#f3d37a', '#c9973a', '#7a5718'],
  pearl: ['#ffffff', '#e8e4dc', '#a9a49a'],
};
const EDGE = '#0b0c0e';

function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// fill the current path with a material (lit from above) and outline it
function paint(ctx, mat, y, h, edge = true) {
  const m = MATS[mat] || MATS.steel, g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, m[0]); g.addColorStop(0.35, m[1]); g.addColorStop(1, m[2]);
  ctx.fillStyle = g; ctx.fill();
  if (edge) { ctx.strokeStyle = EDGE; ctx.lineWidth = 0.9; ctx.stroke(); }
}
// polygon from points given in 0..1 of the box
function poly(ctx, x, y, w, h, pts) {
  ctx.beginPath();
  pts.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](x + px * w, y + py * h));
  ctx.closePath();
}
function box(ctx, mat, x, y, w, h, r = 1.5) { rrect(ctx, x, y, w, h, r); paint(ctx, mat, y, h); }
function shine(ctx, x1, y1, x2, y2, a = 0.25) {
  ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function grooves(ctx, list, a = 0.55, wd = 0.8) {
  ctx.strokeStyle = `rgba(0,0,0,${a})`; ctx.lineWidth = wd;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of list) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.stroke();
}
const count = n => Array.from({ length: Math.max(0, n) }, (_, i) => i);
function woodGrain(ctx, x, y, w, h) {
  ctx.save(); ctx.clip();
  grooves(ctx, count(4).map(i => [x, y + h * (0.2 + i * 0.2), x + w, y + h * (0.15 + i * 0.22)]), 0.18, 0.6);
  ctx.restore();
}
function dark(ctx, x, y, w, h) { rrect(ctx, x, y, w, h, 0.8); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill(); }
function triggerGuard(ctx, x, y, w, h) {
  ctx.strokeStyle = '#1b1d21'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h * 0.55); ctx.quadraticCurveTo(x, y + h, x + w * 0.5, y + h); ctx.lineTo(x + w * 1.1, y + h); ctx.lineTo(x + w * 1.25, y); ctx.stroke();
  ctx.strokeStyle = '#3a3e45'; ctx.lineWidth = 1.2; // trigger
  ctx.beginPath(); ctx.moveTo(x + w * 0.7, y); ctx.quadraticCurveTo(x + w * 0.8, y + h * 0.45, x + w * 0.55, y + h * 0.7); ctx.stroke();
}
function rail(ctx, x, y, w) {
  box(ctx, 'dark', x, y, w, 2.6, 0.5);
  grooves(ctx, count(Math.floor(w / 3.2)).map(i => [x + 1.6 + i * 3.2, y, x + 1.6 + i * 3.2, y + 2.6]), 0.7, 1);
}

function drawBody(ctx, part, x, y) {
  const id = part.id, w = part.w, top = part.shape ? part.shape[0] : [0, 0, w, part.h];
  const [tx, ty, tw, th] = top, gr = part.shape && part.shape[1] ? part.shape[1] : [w * 0.25, th, 12, part.h - th];
  const X = x + tx, Y = y + ty, gh = Math.min(10, part.h - th);
  if (id === 'revolver') {
    poly(ctx, X, Y + 2, tw, 12, [[0, 0.1], [0.95, 0.1], [1, 0.35], [1, 0.9], [0.05, 1], [0, 0.7]]); paint(ctx, 'steel', Y, 14);
    box(ctx, 'steel', x + 15, y, 18, 16, 4); // cylinder
    grooves(ctx, [0.25, 0.5, 0.75].map(f => [x + 15 + 18 * f, y + 2, x + 15 + 18 * f, y + 14]), 0.6);
    shine(ctx, x + 17, y + 1.5, x + 31, y + 1.5, 0.35);
    poly(ctx, X, Y, 6, 5, [[0, 1], [0.3, 0], [1, 0.2], [1, 1]]); paint(ctx, 'steel', Y, 5); // hammer
    triggerGuard(ctx, x + gr[0] + 6, y + 13, 8, 9);
    return;
  }
  if (id === 'sawedoff') {
    for (const yy of [1, 8]) { box(ctx, 'steel', x + 14, y + yy, w - 14, 7.5, 3.5); shine(ctx, x + 16, y + yy + 1.5, x + w - 2, y + yy + 1.5, 0.3); }
    poly(ctx, x, y, 22, 17, [[0, 0.1], [1, 0], [1, 1], [0.15, 1], [0, 0.7]]); paint(ctx, 'steel', y, 17);
    poly(ctx, x + 20, y + 13, 22, 5, [[0, 0], [1, 0], [0.9, 1], [0.05, 1]]); paint(ctx, 'wood', y + 13, 5); // forend
    triggerGuard(ctx, x + 8, y + 16, 8, 9);
    return;
  }
  if (part.gun === 'secondary' || part === GUNS.secondary) {
    // pistol: steel slide on a polymer frame
    const sh = th * 0.55, slideMat = id === 'flare' ? 'tan' : 'steel';
    poly(ctx, X, Y + sh - 0.5, tw, th - sh + 0.5, [[0.02, 0], [1, 0], [1, 0.7], [0.35, 1], [0, 1]]);
    paint(ctx, id === 'flare' ? 'tan' : id === 'handcannon' ? 'steel' : 'poly', Y + sh, th - sh);
    poly(ctx, X, Y, tw, sh, [[0, 0.15], [0.03, 0], [1, 0], [1, 1], [0, 1]]); paint(ctx, slideMat, Y, sh);
    grooves(ctx, count(5).map(i => [X + 3 + i * 2, Y + 1, X + 3 + i * 2, Y + sh - 1]), 0.6); // serrations
    shine(ctx, X + 2, Y + 1, X + tw - 1, Y + 1, 0.35);
    if (id !== 'flare') dark(ctx, X + tw * 0.45, Y + 1.5, tw * 0.18, sh * 0.45); // ejection port
    else { ctx.beginPath(); ctx.arc(X + tw - 1, Y + sh / 2 + 1, sh * 0.45, 0, Math.PI * 2); ctx.fillStyle = '#1a1a1a'; ctx.fill(); }
    triggerGuard(ctx, x + gr[0] + gr[2] * 0.6, Y + th - 1, gr[2] * 0.8, gh);
    return;
  }
  // rifles / shotgun: steel receiver, details by model
  const recv = [[0, 0.1], [0.06, 0], [0.94, 0], [1, 0.12], [1, 0.88], [0.6, 1], [0.04, 1], [0, 0.85]];
  poly(ctx, X, Y, tw, th, recv); paint(ctx, id === 'sniper' ? 'dark' : 'steel', Y, th);
  shine(ctx, X + 4, Y + 1.2, X + tw - 4, Y + 1.2, 0.35);
  if (id === 'ak') {
    poly(ctx, X + tw * 0.62, Y + th * 0.3, tw * 0.38, th * 0.72, [[0, 0], [1, 0.05], [1, 0.85], [0.08, 1], [0, 0.6]]); paint(ctx, 'wood', Y + th * 0.3, th * 0.7);
    woodGrain(ctx, X + tw * 0.62, Y + th * 0.3, tw * 0.38, th * 0.7);
    grooves(ctx, [[X + tw * 0.3, Y + th * 0.45, X + tw * 0.56, Y + th * 0.45]], 0.5); // dust cover line
    box(ctx, 'steel', X + tw * 0.25, Y + th * 0.25, 4, 2.5, 1); // charging handle
  } else if (id === 'shotgun') {
    poly(ctx, X + tw * 0.58, Y + th * 0.5, tw * 0.36, th * 0.6, [[0, 0.1], [1, 0], [1, 0.9], [0, 1]]); paint(ctx, 'wood', Y + th * 0.5, th * 0.6);
    grooves(ctx, count(6).map(i => [X + tw * 0.62 + i * 4.5, Y + th * 0.55, X + tw * 0.62 + i * 4.5, Y + th * 1.05]), 0.45);
    dark(ctx, X + tw * 0.3, Y + th * 0.25, tw * 0.2, th * 0.3);
  } else if (id === 'sniper') {
    box(ctx, 'steel', X + tw * 0.28, Y - 1, 3, 8, 1.5); // bolt handle
    ctx.beginPath(); ctx.arc(X + tw * 0.28 + 1.5, Y + 8.5, 2.5, 0, Math.PI * 2); paint(ctx, 'steel', Y + 6, 5);
    poly(ctx, X + tw * 0.5, Y + th * 0.35, tw * 0.5, th * 0.65, [[0, 0], [1, 0.1], [1, 0.85], [0, 1]]); paint(ctx, 'poly', Y + th * 0.35, th * 0.65);
  } else {
    rail(ctx, X + tw * 0.12, Y - 2.2, tw * 0.5);
    dark(ctx, X + tw * 0.38, Y + th * 0.3, tw * 0.16, th * 0.25); // ejection port
    poly(ctx, X + tw * 0.6, Y + th * 0.2, tw * 0.4, th * 0.8, [[0, 0], [1, 0], [1, 0.85], [0, 1]]); paint(ctx, 'poly', Y + th * 0.2, th * 0.8); // handguard
    grooves(ctx, count(4).map(i => [X + tw * 0.65 + i * tw * 0.08, Y + th * 0.45, X + tw * 0.69 + i * tw * 0.08, Y + th * 0.45]), 0.8, 1.6);
  }
  triggerGuard(ctx, x + gr[0] + 3, Y + th - 1, gr[2] * 0.7, gh);
}

function drawPart(ctx, part, x, y) {
  if (part._img) {
    ctx.imageSmoothingEnabled = !PIXEL_ART;
    ctx.drawImage(part._img, x, y, part.w, part.h);
    return;
  }
  const slot = PART_SLOT.get(part) || 'body', id = part.id, w = part.w, h = part.h;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (slot === 'body') drawBody(ctx, part, x, y);
  else if (slot === 'barrel') {
    const bh = id === 'heavy' ? h * 0.75 : h * 0.55, by = y + (h - bh) / 2;
    if (w > 30) { poly(ctx, x + w - 10, y - 3, 4, by - y + 3.5, [[0.2, 0], [0.8, 0], [1, 1], [0, 1]]); paint(ctx, 'dark', y - 3, by - y + 3); } // front sight
    box(ctx, id === 'sniper' ? 'dark' : 'steel', x, by, w, bh, bh / 2);
    shine(ctx, x + 1, by + bh * 0.3, x + w - 2, by + bh * 0.3, 0.35);
    if (id === 'heavy') grooves(ctx, [[x + 4, by + bh * 0.6, x + w - 6, by + bh * 0.6]], 0.6, 1); // fluting
    if (id === 'short') { box(ctx, 'dark', x + w - 7, y + 1, 7, h - 2, 1); grooves(ctx, [[x + w - 5, y + 2, x + w - 5, y + h - 2], [x + w - 2.5, y + 2, x + w - 2.5, y + h - 2]], 0.8); } // flash hider
    else box(ctx, 'dark', x + w - 3, by - 0.5, 3, bh + 1, 1); // crown
  } else if (slot === 'silencer') {
    box(ctx, 'poly', x, y, w, h, h * 0.35);
    shine(ctx, x + 3, y + h * 0.22, x + w - 3, y + h * 0.22, 0.25);
    grooves(ctx, [[x + 3, y + 1, x + 3, y + h - 1]], 0.7);
    rrect(ctx, x + w * 0.62, y + 0.5, 3, h - 1, 0.5); ctx.fillStyle = part.color; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; // colour band
  } else if (slot === 'mag') {
    if (id.includes('drum')) {
      const r = Math.min(w, h) / 2, cx = x + w / 2, cy = y + h / 2;
      box(ctx, 'dark', cx - r * 0.45, y - 1, r * 0.9, r * 0.6, 1); // feed neck
      ctx.beginPath(); ctx.arc(cx, cy + 1, r, 0, Math.PI * 2); paint(ctx, 'poly', cy - r, r * 2);
      ctx.beginPath(); ctx.arc(cx, cy + 1, r * 0.72, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy + 1, r * 0.25, 0, Math.PI * 2); paint(ctx, 'steel', cy - r * 0.25, r * 0.5);
    } else if (id === 'extended' || id === 'dual') {
      // curved "banana" mag (dual = two taped together)
      const k = id === 'dual' ? w / 2 : w;
      for (const ox of id === 'dual' ? [w / 2, 0] : [0]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y); ctx.lineTo(x + ox + k, y);
        ctx.quadraticCurveTo(x + ox + k + k * 0.15, y + h * 0.6, x + ox + k + k * 0.55, y + h);
        ctx.lineTo(x + ox + k * 0.55, y + h); ctx.quadraticCurveTo(x + ox - k * 0.1, y + h * 0.55, x + ox, y);
        ctx.closePath(); paint(ctx, id === 'dual' ? 'steel' : 'poly', y, h);
        grooves(ctx, count(Math.floor(h / 7)).map(i => [x + ox + 2 + i * 0.6, y + 5 + i * 7, x + ox + k - 1 + i * 0.9, y + 5 + i * 7]), 0.35);
      }
      if (id === 'dual') grooves(ctx, [[x, y + h * 0.45, x + w, y + h * 0.45]], 0.85, 3); // tape
    } else {
      box(ctx, id === 'heavy' ? 'steel' : 'poly', x, y, w, h - 2, 1);
      grooves(ctx, count(Math.floor((h - 6) / 6)).map(i => [x + 2, y + 5 + i * 6, x + w - 2, y + 5 + i * 6]), 0.3);
      box(ctx, 'dark', x - 0.5, y + h - 3, w + 1, 3, 1); // floor plate
      if (id === 'speedload') { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w * 0.3, 0, Math.PI * 2); paint(ctx, 'brass', y, h); }
    }
  } else if (slot === 'handle') {
    const mat = id === 'pearl' ? 'pearl' : id === 'heavy' ? 'wood' : 'poly';
    const lean = id === 'angled' ? 0.45 : 0.25;
    poly(ctx, x, y, w, h, [[0, 0], [1, 0], [1 - lean * 0.3, 0.92], [0.72 - lean, 1], [-lean, 1], [-lean * 0.7, 0.85]]); paint(ctx, mat, y, h);
    ctx.save(); ctx.clip();
    if (mat === 'poly') { ctx.fillStyle = 'rgba(0,0,0,0.35)'; for (let yy = 4; yy < h - 2; yy += 2.2) for (let xx = -6; xx < w; xx += 2.2) ctx.fillRect(x + xx, y + yy, 0.8, 0.8); } // stipple
    if (id === 'wrapped') grooves(ctx, count(Math.floor(h / 3)).map(i => [x - 6, y + 3 + i * 3, x + w, y + 1 + i * 3]), 0.6, 1.2);
    if (mat === 'wood') grooves(ctx, count(4).map(i => [x - 6, y + h * (0.2 + i * 0.2), x + w, y + h * (0.1 + i * 0.22)]), 0.18, 0.6);
    ctx.restore();
    shine(ctx, x + w - 1.5, y + 2, x + w - 1.5 - lean * 3, y + h - 3, 0.2);
  } else if (slot === 'stock') {
    if (id === 'tactical' || id === 'brace') {
      box(ctx, 'dark', x + w * 0.35, y + h * 0.3, w * 0.65, h * 0.32, 2); // buffer tube
      poly(ctx, x, y, w * 0.55, h, [[0, 0], [1, 0.15], [1, 0.75], [0.2, 1], [0, 1]]); paint(ctx, 'poly', y, h);
      grooves(ctx, [[x + w * 0.1, y + h * 0.3, x + w * 0.45, y + h * 0.35]], 0.5);
    } else if (id === 'skeleton' || id === 'folding') {
      ctx.strokeStyle = '#2a2d32'; ctx.lineWidth = id === 'folding' ? 1.6 : 2.4;
      ctx.beginPath(); ctx.moveTo(x + w, y + h * 0.15); ctx.lineTo(x + 2, y + 1); ctx.lineTo(x + 2, y + h - 1); ctx.lineTo(x + w, y + h * 0.75); ctx.stroke();
      box(ctx, 'poly', x, y, 3.5, h, 1); // butt plate
    } else {
      const mat = id === 'heavy' ? 'wood' : 'poly';
      ctx.beginPath();
      ctx.moveTo(x + w, y + h * 0.1); ctx.lineTo(x + 3, y); ctx.lineTo(x, y + 1); ctx.lineTo(x, y + h);
      ctx.lineTo(x + w * 0.35, y + h); ctx.quadraticCurveTo(x + w * 0.6, y + h * 0.6, x + w, y + h * 0.65); ctx.closePath(); paint(ctx, mat, y, h);
      if (mat === 'wood') woodGrain(ctx, x, y, w, h);
      shine(ctx, x + 3, y + 1, x + w - 2, y + h * 0.1 + 0.8, 0.25);
      box(ctx, id === 'padded' ? 'poly' : 'dark', x - 1, y - 0.5, id === 'padded' ? 5 : 3, h + 1, 1.5); // butt pad
    }
  } else if (slot === 'bullets') {
    const cw = w * 0.6;
    rrect(ctx, x, y, cw, h, 1); paint(ctx, 'brass', y, h);
    grooves(ctx, [[x + 2, y + 0.5, x + 2, y + h - 0.5]], 0.5);
    ctx.beginPath(); ctx.moveTo(x + cw, y + 0.6); ctx.quadraticCurveTo(x + w, y + h * 0.2, x + w, y + h / 2); ctx.quadraticCurveTo(x + w, y + h * 0.8, x + cw, y + h - 0.6); ctx.closePath();
    paint(ctx, id === 'piercing' ? 'steel' : 'brass', y, h);
    if (id !== 'piercing') { ctx.fillStyle = part.color; ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1; } // painted tip
  } else if (id === 'scope') {
    box(ctx, 'dark', x + w * 0.25, y + h - 3, 3, 3, 0.5); box(ctx, 'dark', x + w * 0.65, y + h - 3, 3, 3, 0.5); // rings
    poly(ctx, x, y, w, h - 2, [[0, 0], [0.18, 0.2], [0.82, 0.2], [1, 0], [1, 1], [0.82, 0.8], [0.18, 0.8], [0, 1]]); paint(ctx, 'poly', y, h - 2);
    box(ctx, 'dark', x + w * 0.44, y - 2, 3.5, 3, 0.5); // turret
    ctx.fillStyle = 'rgba(90,170,255,0.8)'; ctx.fillRect(x + w - 1.2, y + 1, 1, h - 4); // lens
  } else if (id === 'reddot') {
    box(ctx, 'poly', x, y + h * 0.55, w, h * 0.45, 1);
    rrect(ctx, x + w * 0.2, y, w * 0.6, h * 0.65, 1.5); ctx.strokeStyle = '#26282c'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x + w * 0.5, y + h * 0.33, 0.9, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'laser') {
    box(ctx, 'poly', x, y, w, h, 1.5);
    ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x + w - 1.6, y + h / 2, 1.2, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'muzzle') {
    box(ctx, 'dark', x, y, w, h, 1.5); // muzzle brake with side ports
    grooves(ctx, [[x + w * 0.35, y + 2, x + w * 0.35, y + h - 2], [x + w * 0.65, y + 2, x + w * 0.65, y + h - 2]], 0.9, 1.6);
  } else if (id === 'trigger') {
    ctx.strokeStyle = '#c9973a'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.quadraticCurveTo(x + w * 0.8, y + h * 0.5, x + 3, y + h); ctx.stroke();
  } else if (id === 'hollow') {
    for (const ox of [0, 4, 8]) { ctx.beginPath(); ctx.arc(x + ox + 2, y + h / 2, 2, 0, Math.PI * 2); paint(ctx, 'brass', y, h); }
  } else {
    box(ctx, 'poly', x, y, w, h, 1.5);
  }
  ctx.restore();
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
  s.spread = body.spread || (kind === 'secondary' ? 0.012 : 0.05); // sidearms are more accurate
  s.range = body.range || BULLET_RANGE;
  s.speed = body.speed || BULLET_SPEED;
  s.falloff = body.falloff || 0;
  s.assist = body.assist || 1;
  s.recoil = body.recoil || 1; // extra kick (sniper)
  const extra = findPart('extra', build.extra) || {};
  s.range *= extra.rangeMul || 1;
  s.speed *= extra.speedMul || 1;
  s.spread *= extra.spreadMul || 1;
  s.assist *= extra.assist || 1;
  const ammoType = findPart('bullets', build.bullets) || {};
  s.bounce = ammoType.bounce || 0;
  s.pierce = !!ammoType.pierce;
  s.boom = ammoType.boom || null;
  if (body.fixed) Object.assign(s, body.fixed);
  s.flare = !!body.flare;
  // limited ammo: spare rounds on top of the loaded mag
  s.maxReserve = body.totalAmmo ? Math.max(0, body.totalAmmo - s.magSize) : s.magSize * AMMO.spareMags;
  s.boxRefill = body.flare ? 1 : body.totalAmmo ? 0 : s.magSize * AMMO.box.refillMags;
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

// ---------------------------------------------------------------- ability icons
// Simple shapes as SVG paths in a 40x40 box. [path, fill rule]. Used as SVG in menus and Path2D on canvas.
const ICON_SHAPES = {
  plus:      ['M15 5h10v10h10v10H25v10H15V25H5V15h10z'],
  mortar:    ['M6 31h28v5H6zM11 24h18v7H11zM17 24l-3-3L24 4l6 3-10 17z'],
  flametower:['M8 30h24v6H8zM13 18h14v12H13zM20 2c5 5 7 9 4 14h-8c-3-5 0-8 4-14zM20 8c2 3 2 5 1 7h-2c-1-2-1-4 1-7z', 'evenodd'],
  laser:     ['M9 30h22v6H9zM14 20h12v10H14zM18 12h4v8h-4zM20 2l2 4 4-2-2 4 4 2-4 2 2 4-4-2-2 4-2-4-4 2 2-4-4-2 4-2-2-4 4 2z'],
  drone:     ['M15 16h10v8H15zM6 9a4 4 0 1 1-.01 0zM34 9a4 4 0 1 1-.01 0zM6 23a4 4 0 1 1-.01 0zM34 23a4 4 0 1 1-.01 0zM8 13l7 4-1 2-7-4zM32 13l-7 4 1 2 7-4zM8 27l7-4-1-2-7 4zM32 27l-7-4 1-2 7 4zM10 33h20v4H10z'],
  gravity:   ['M20 14a6 6 0 1 1-.01 0zM20 4a16 16 0 1 1-.01 0zM20 7a13 13 0 1 0 .01 0zM20 10a10 10 0 1 1-.01 0zM20 12a8 8 0 1 0 .01 0z', 'evenodd'],
  dome:      ['M4 33a16 16 0 0 1 32 0zM18 9h4v8h-4zM20 3a3 3 0 1 1-.01 0z'],
  scope:     ['M20 4a16 16 0 1 1-.01 0zM20 8a12 12 0 1 0 .01 0zM19 1h2v15h-2zM19 24h2v15h-2zM1 19h15v2H1zM24 19h15v2H24z', 'evenodd'],
  heart:     ['M20 35L6 21a8.5 8.5 0 0 1 14-11 8.5 8.5 0 0 1 14 11z'],
  heartbolt: ['M20 35L6 21a8.5 8.5 0 0 1 14-11 8.5 8.5 0 0 1 14 11zM22 12l-7 10h5l-2 8 7-11h-5z', 'evenodd'],
  shield:    ['M20 3l14 5v11c0 9-6 15-14 18C12 34 6 28 6 19V8z'],
  vest:      ['M9 4h7l4 5 4-5h7v32H9z'],
  grenade:   ['M20 12a12 12 0 1 1-.01 0zM16 3h8v8h-8zM24 5h7v4h-7z'],
  rocket:    ['M20 2l7 11v17h-14V13zM13 24l-6 10h6zM27 24l6 10h-6zM16 31h8l-4 7z'],
  can:       ['M12 7h16v29H12zM15 3h10v4H15z'],
  burger:    ['M5 17a15 11 0 0 1 30 0zM4 20h32v4H4zM5 27h30a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6z'],
  arrow:     ['M3 15h18V7l16 13-16 13v-8H3z'],
  chevrons:  ['M3 6l13 14L3 34h7l13-14L10 6zM17 6l13 14-13 14h7l13-14L24 6z'],
  reload:    ['M20 4a16 16 0 1 0 16 16h-6a10 10 0 1 1-10-10v6l9-9-9-9z'],
  star:      ['M20 2l5 12 13 1-10 8 3 13-11-7-11 7 3-13L2 15l13-1z'],
  burst:     ['M20 1l4 11 11-5-5 11 11 4-11 4 5 11-11-5-4 11-4-11-11 5 5-11L1 20l11-4L7 5l11 5z'],
  hourglass: ['M8 3h24v5l-9 12 9 12v5H8v-5l9-12-9-12z'],
  turret:    ['M20 9a11 11 0 1 1-.01 0zM20 17h17v6H20z'],
  box:       ['M5 12l15-8 15 8v17l-15 8-15-8zM5 12l15 8 15-8M20 20v17'],
  fangs:     ['M5 6h30v7l-6 18-5-18h-8l-5 18-6-18z'],
  skull:     ['M20 3a15 14 0 0 1 15 14c0 5-3 8-5 9v8H10v-8c-2-1-5-4-5-9A15 14 0 0 1 20 3zM13 15a4 4 0 1 0 .01 0zM27 15a4 4 0 1 0 .01 0z', 'evenodd'],
  bullets:   ['M7 12a3 3 0 0 1 6 0v24H7zM17 8a3 3 0 0 1 6 0v28h-6zM27 12a3 3 0 0 1 6 0v24h-6z'],
  vortex:    ['M20 3a17 17 0 1 1-.01 0zM20 10a10 10 0 1 0 .01 0zM20 16a4 4 0 1 1-.01 0z', 'evenodd'],
  flame:     ['M20 2c3 8 12 12 12 22a12 12 0 0 1-24 0c0-6 4-9 6-13 1 4 3 6 5 6-1-5 0-10 1-15z'],
  snow:      ['M17 2h6v13l9-9 4 4-9 9h13v6H27l9 9-4 4-9-9v13h-6V27l-9 9-4-4 9-9H2v-6h13L6 10l4-4 7 7z'],
  person:    ['M20 3a7 7 0 1 1-.01 0zM8 37v-9a12 12 0 0 1 24 0v9z'],
  wall:      ['M3 10h16v8H3zM21 10h16v8H21zM3 20h8v8H3zM13 20h14v8H13zM29 20h8v8h-8zM3 30h16v6H3zM21 30h16v6H21z'],
  mine:      ['M20 9a11 11 0 1 1-.01 0zM18 2h4v8h-4zM18 30h4v8h-4zM2 18h8v4H2zM30 18h8v4h-8z'],
  up:        ['M3 22L20 6l17 16v8L20 14 3 30zM3 34L20 18l17 16v4L20 26 3 38z'],
  dish:      ['M5 31A22 22 0 0 1 31 5l-4 5A16 16 0 0 0 10 27zM14 22l8-8 4 4-8 8zM6 34h14v4H6z'],
  bolt:      ['M24 2L7 23h11l-4 15 19-22H22z'],
  cloud:     ['M12 14a7 7 0 1 1-.01 0zM26 12a9 9 0 1 1-.01 0zM18 22a10 10 0 1 1-.01 0zM8 22a6 6 0 1 1-.01 0zM32 22a6 6 0 1 1-.01 0z'],
  hook:      ['M21 3h5v21a10 10 0 1 1-20 0h5a5 5 0 1 0 10 0z'],
  ghost:     ['M7 37V18a13 13 0 0 1 26 0v19l-4-4-4 4-5-4-5 4-4-4zM15 15a3 3 0 1 0 .01 0zM25 15a3 3 0 1 0 .01 0z', 'evenodd'],
  mirror:    ['M20 2l16 18-16 18L4 20zM20 10l9 10-9 10-9-10z', 'evenodd'],
  battery:   ['M10 8h20v30H10zM15 3h10v5H15zM22 13l-7 11h5l-2 9 7-12h-5z', 'evenodd'],
  hammer:    ['M5 5h24v11H5zM14 16h6v21h-6zM29 8h6v5h-6z'],
  rewind:    ['M37 7L21 20l16 13zM20 7L4 20l16 13z'],
  spikes:    ['M3 37L9 9l5 28 6-35 6 35 5-28 6 28z'],
  bone:      ['M12 16h16v8H12zM9 11a5 5 0 1 1-.01 0zM9 21a5 5 0 1 1-.01 0zM31 11a5 5 0 1 1-.01 0zM31 21a5 5 0 1 1-.01 0z'],
  gem:       ['M10 5h20l7 11-17 21L3 16z'],
  dots:      ['M20 13a7 7 0 1 1-.01 0zM9 4a5 5 0 1 1-.01 0zM31 4a5 5 0 1 1-.01 0zM9 26a5 5 0 1 1-.01 0zM31 26a5 5 0 1 1-.01 0z'],
  ring:      ['M20 3a17 17 0 1 1-.01 0zM20 9a11 11 0 1 0 .01 0z', 'evenodd'],
  syringe:   ['M17 2h6v5h4v4h-2v18l-5 7-5-7V11h-2V7h4z'],
  dagger:    ['M20 2l5 8v17h-10V10zM10 27h20v4H10zM17 31h6v7h-6z'],
  magnet:    ['M5 4h10v17a5 5 0 0 0 10 0V4h10v17a15 15 0 0 1-30 0z'],
  moon:      ['M25 3a17 17 0 1 0 12 27A14 14 0 0 1 25 3z'],
  clover:    ['M20 4a8 8 0 1 1-.01 0zM20 20a8 8 0 1 1-.01 0zM12 12a8 8 0 1 1-.01 0zM28 12a8 8 0 1 1-.01 0zM18 26h4v12h-4z'],
};
const iconOf = id => ICON_SHAPES[ABILITY_ICONS[id]] || ICON_SHAPES.star;
// very dark ability colours get a light grey icon so you can still see it
function iconColor(id) {
  const c = ABILITIES[id].color, n = parseInt(c.slice(1), 16);
  const lum = (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
  return lum < 0.3 ? '#b2bec3' : c;
}
// SVG for menus. size in px, colour defaults to the ability colour
function abilityIconSVG(id, size = 32, color) {
  const [d, rule] = iconOf(id);
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill="${color || iconColor(id)}" fill-rule="${rule || 'nonzero'}"/></svg>`;
}
// draw on a canvas, centred on (x, y)
function drawAbilityIcon(ctx, id, x, y, size, color) {
  const [d, rule] = iconOf(id);
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 40, size / 40);
  ctx.fillStyle = color || iconColor(id);
  ctx.fill(new Path2D(d), rule || 'nonzero');
  ctx.restore();
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
  light: Store.get('cgg.settings', {}).light ?? false, // light mode (default dark)
  save() { Store.set('cgg.settings', { mobile: this.mobile, light: this.light }); },
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

const emptyBuild = () => ({ body: null, barrel: null, mag: null, handle: null, stock: null, silencer: null, bullets: null, extra: null });

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
    this.use(all[key]);
    Store.set('cgg.lastName', name);
    Store.set('cgg.session', key); // stay logged in after a refresh
    return { ok: true, created };
  },
  // log back in to the account that was signed in last time (no password needed on this device)
  restore() {
    const key = Store.get('cgg.session', null), all = Store.get('cgg.accounts', {});
    if (!key || !all[key]) return false;
    this.use(all[key]);
    return true;
  },
  use(user) {
    this.user = user;
    // saved loadouts: the old single loadout becomes preset 1
    const u = this.user;
    if (!Array.isArray(u.presets)) u.presets = [u.loadout];
    while (u.presets.length < LOADOUT_PRESETS) u.presets.push(JSON.parse(JSON.stringify(u.presets[0])));
    u.active = clamp(u.active | 0, 0, LOADOUT_PRESETS - 1);
    u.loadout = u.presets[u.active];
    for (const p of u.presets) if (!ABILITIES[p.ability]) p.ability = 'grenade';
    for (const p of u.presets) if (p.ability2 && (!ABILITIES[p.ability2] || p.ability2 === p.ability)) p.ability2 = null;
    for (const p of u.presets) if (p.ability3 && (!ABILITIES[p.ability3] || p.ability3 === p.ability || p.ability3 === p.ability2)) p.ability3 = null;
    for (const p of u.presets) if (p.ability4 && (!ABILITIES[p.ability4] || [p.ability, p.ability2, p.ability3].includes(p.ability4))) p.ability4 = null;
    // shop: banked score + what you've unlocked. Things already equipped before the shop existed stay yours.
    if (!Array.isArray(u.owned)) {
      u.owned = [];
      if (u.bank === undefined) u.bank = SHOP.start;
      for (const L of u.presets) {
        for (const k of ['ability', 'ability2', 'ability3', 'ability4']) if (L[k]) u.owned.push('ab:' + L[k]);
        for (const k of ['perk', 'perk2', 'perk3', 'perk4']) if (L[k]) u.owned.push('perk:' + L[k]);
        for (const kind of ['main', 'secondary']) for (const sl in L[kind] || {}) if (L[kind][sl]) u.owned.push(`part:${kind}:${sl}:${L[kind][sl]}`);
      }
    }
    for (const L of this.user.presets) for (const kind of ['main', 'secondary']) {
      const b = { ...emptyBuild(), ...L[kind] };
      for (const s of SLOTS) if (b[s.key] && !partsFor(kind, s.key).some(p => p.id === b[s.key])) b[s.key] = null;
      L[kind] = b;
    }
  },
  usePreset(i) {
    this.user.active = i;
    this.user.loadout = this.user.presets[i];
    this.save();
  },
  save() {
    if (!this.user) return;
    this.user.presets[this.user.active] = this.user.loadout;
    const all = Store.get('cgg.accounts', {});
    all[this.user.name.toLowerCase()] = this.user;
    Store.set('cgg.accounts', all);
  },
  logout() { this.user = null; Store.set('cgg.session', null); },
};
