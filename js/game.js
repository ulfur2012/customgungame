// The round itself: single player (waves + boss) or multiplayer (last one standing).
const Game = (() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const VIEW = 820;        // world units visible across the screen's short side
  const GUN_SCALE = 0.55;  // gun units -> world units
  const el = id => document.getElementById(id);

  let W = 0, H = 0, DPR = 1, zoom = 1;
  let G = null, raf = 0, last = 0;
  const hooks = { spOver: () => {}, myDeath: () => {} };

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    zoom = Math.min(W, H) / VIEW;
  }
  addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- setup
  function makeGun(kind, build) {
    const stats = computeStats(kind, build);
    return { kind, build: { ...build }, stats, sprite: renderGunSprite(kind, build), ammo: stats.magSize, reserve: stats.maxReserve, reload: 0, cd: 0 };
  }

  function newState(mode, spawn, color) {
    const L = Account.user.loadout;
    return {
      mode, paused: false,
      me: {
        x: spawn[0], y: spawn[1], r: PLAYER.r, hp: PLAYER.hp, maxHp: PLAYER.hp, aim: 0, vx: 0, vy: 0,
        kick: 0, meleeInv: 0, alive: true, color, name: Account.user.name,
        guns: [makeGun('main', allowedBuild('main', L.main)), makeGun('secondary', allowedBuild('secondary', L.secondary))], cur: 0,
      },
      bullets: [], fx: [], texts: [], hears: [], feed: [],
      enemies: [], remotes: new Map(),
      cam: { x: spawn[0], y: spawn[1] }, shake: 0, hurt: 0, banner: null,
      wave: 0, phase: 'break', breakT: 1.5, queue: [], spawnT: 0, score: 0, kills: 0, boss: null,
      sendT: 0, packs: [], packT: 0, time: 0, lastCombat: 0, pingT: PING.every, ping: 0,
    };
  }

  function startSP() {
    resize();
    G = newState('sp', [MAP.w / 2, MAP.h / 2], PLAYER_COLORS[0]);
    begin();
  }

  // players: [{id, name, team}] in spawn order. team mode = no friendly fire, last team standing wins
  function startMP(players, myId, teams) {
    resize();
    const idx = Math.max(0, players.findIndex(p => p.id === myId));
    const spawnOf = i => MAP.spawns[i % MAP.spawns.length];
    G = newState('mp', spawnOf(idx), PLAYER_COLORS[idx % PLAYER_COLORS.length]);
    G.myId = myId;
    G.teams = !!teams;
    G.me.team = (players[idx] || {}).team || 0;
    players.forEach((p, i) => {
      if (p.id === myId) return;
      const [x, y] = spawnOf(i);
      G.remotes.set(p.id, {
        id: p.id, name: p.name, team: p.team || 0, color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        x, y, tx: x, ty: y, aim: 0, hp: PLAYER.hp, gun: 0, alive: true, kick: 0, flash: 0, sprites: [null, null],
      });
    });
    G.banner = { text: G.teams ? 'Team match — last team standing wins!' : 'Last one standing wins!', t: 2.5 };
    begin();
    Net.send({ t: 'kit', main: G.me.guns[0].build, secondary: G.me.guns[1].build });
  }

  function begin() {
    Input.reset();
    updateWeaponBar(true);
    document.body.classList.add('in-game');
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    G = null;
    document.body.classList.remove('in-game');
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = clamp((t - last) / 1000, 0, 0.05);
    last = t;
    if (G && !G.paused) update(dt);
    render();
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    const me = G.me;
    if (me.alive) updateMe(dt);
    G.cam.x += (me.x - G.cam.x) * Math.min(1, dt * 10);
    G.cam.y += (me.y - G.cam.y) * Math.min(1, dt * 10);

    if (G.mode === 'sp') { updateWaves(dt); updateEnemies(dt); }
    else {
      for (const r of G.remotes.values()) {
        r.x += (r.tx - r.x) * Math.min(1, dt * 15);
        r.y += (r.ty - r.y) * Math.min(1, dt * 15);
        r.kick = Math.max(0, r.kick - 40 * dt);
        r.flash = Math.max(0, r.flash - dt);
      }
      G.sendT -= dt;
      if (G.sendT <= 0) {
        G.sendT = 0.05;
        Net.send({ t: 'st', x: Math.round(me.x), y: Math.round(me.y), aim: +me.aim.toFixed(3), hp: me.hp, gun: me.cur, alive: me.alive });
      }
    }
    updateBullets(dt);
    updatePacks(dt);
    G.time += dt;
    if (G.mode === 'mp') {
      // every 3 minutes, anyone who hasn't been fighting gets pinged toward the enemies
      G.ping = Math.max(0, G.ping - dt);
      G.pingT -= dt;
      if (G.pingT <= 0) {
        G.pingT = PING.every;
        if (G.time - G.lastCombat > PING.calm) { G.ping = PING.show; G.banner = { text: 'Enemies pinged!', t: 1.5 }; }
      }
    }

    for (const f of G.fx) { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.9; f.vy *= 0.9; f.life -= dt; }
    G.fx = G.fx.filter(f => f.life > 0);
    for (const t of G.texts) { t.y -= 40 * dt; t.life -= dt; }
    G.texts = G.texts.filter(t => t.life > 0);
    for (const h of G.hears) h.t -= dt / 1.2;
    G.hears = G.hears.filter(h => h.t > 0);
    for (const f of G.feed) f.t -= dt;
    G.feed = G.feed.filter(f => f.t > 0);
    G.shake = Math.max(0, G.shake - 30 * dt);
    G.hurt = Math.max(0, G.hurt - dt * 2);
    if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
    updateWeaponBar();
  }

  function updateMe(dt) {
    const me = G.me;
    const mv = Input.move();
    me.x += (mv.x * PLAYER.speed + me.vx) * dt;
    me.y += (mv.y * PLAYER.speed + me.vy) * dt;
    me.vx *= Math.exp(-10 * dt); me.vy *= Math.exp(-10 * dt);
    collideWorld(me);
    me.kick = Math.max(0, me.kick - 50 * dt);
    me.meleeInv = Math.max(0, me.meleeInv - dt);

    const sel = Input.take('select');
    if (sel >= 0) switchGun(sel);
    if (Input.take('swap')) switchGun(1 - me.cur);

    const gun = me.guns[me.cur], s = gun.stats;
    const scr = toScreen(me.x, me.y);
    const aim = Input.aim(scr.x, scr.y);
    if (aim.angle !== null) me.aim = aim.angle;
    let fire = aim.fire;
    if (Settings.mobile) {
      // Brawl Stars style: hold the aim stick and it fires by itself when an enemy is in your sights
      fire = aim.aiming && targetInSights(me.aim);
      if (Input.take('tap')) {
        const t = nearestVisibleTarget();
        if (t) { me.aim = Math.atan2(t.y - me.y, t.x - me.x); fire = true; }
      }
    }

    if (gun.reload > 0) {
      gun.reload -= dt;
      if (gun.reload <= 0) {
        gun.reload = 0;
        const got = Math.min(s.magSize - gun.ammo, gun.reserve);
        gun.ammo += got;
        gun.reserve -= got;
      }
    } else if (Input.take('reload') && gun.ammo < s.magSize && gun.reserve > 0) {
      gun.reload = s.reloadTime;
    }
    gun.cd = Math.max(0, gun.cd - dt);
    if (fire && gun.reload === 0 && gun.ammo > 0 && gun.cd === 0) {
      shoot(gun);
      gun.cd = s.fireDelay;
    }
    if (gun.ammo === 0 && gun.reload === 0 && gun.reserve > 0) gun.reload = s.reloadTime;
  }

  function switchGun(i) {
    const me = G.me;
    if (!G || i === me.cur || !me.alive) return;
    me.guns[me.cur].reload = 0; // switching cancels a reload in progress
    me.cur = i;
    me.guns[i].cd = Math.max(me.guns[i].cd, 0.2);
    updateWeaponBar(true);
  }

  // in team mode, people on your team aren't enemies
  const isEnemy = r => !G.teams || r.team !== G.me.team;
  const teamOf = id => (G.remotes.has(id) ? G.remotes.get(id).team : G.me.team);

  function targets() {
    if (G.mode === 'sp') return G.enemies;
    return [...G.remotes.values()].filter(r => r.alive && isEnemy(r)).map(r => ({ x: r.x, y: r.y, r: PLAYER.r }));
  }

  // mobile auto-shoot: is an enemy inside the aim area? (wider for AK/shotgun, thin for sniper)
  function targetInSights(angle) {
    const me = G.me, s = me.guns[me.cur].stats;
    for (const t of targets()) {
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      if (d > s.range) continue;
      const tol = Math.max(0.12, Math.atan2(t.r, d)) * s.assist;
      if (angleDiff(Math.atan2(t.y - me.y, t.x - me.x), angle) <= tol && lineOfSight(me.x, me.y, t.x, t.y)) return true;
    }
    return false;
  }

  function nearestVisibleTarget() {
    const me = G.me;
    let best = null, bd = me.guns[me.cur].stats.range;
    for (const t of targets()) {
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      if (d < bd && lineOfSight(me.x, me.y, t.x, t.y)) { best = t; bd = d; }
    }
    return best;
  }

  function shoot(gun) {
    const me = G.me, s = gun.stats;
    const m = gunToWorld(me, gun.sprite.muzzle);
    const angles = [];
    for (let i = 0; i < s.pellets; i++) {
      const fan = s.pellets > 1 ? (i / (s.pellets - 1) - 0.5) * s.spread : 0;
      angles.push(+(me.aim + fan + (Math.random() - 0.5) * (s.pellets > 1 ? 0.08 : s.spread)).toFixed(4));
    }
    for (const a of angles) addBullet(m.x, m.y, a, s.speed, s.damage, s.knockback, 'me', G.myId, s.range, s.falloff, s.flare);
    const a = me.aim;
    G.lastCombat = G.time;
    gun.ammo--;
    me.kick = Math.min(10, 3 + s.knockback * 2);
    me.vx -= Math.cos(me.aim) * s.knockback * 12;
    me.vy -= Math.sin(me.aim) * s.knockback * 12;
    G.shake = Math.min(6, G.shake + 1 + s.knockback * 0.5);
    muzzleFlash(m.x, m.y, a);
    if (G.mode === 'mp') {
      Net.send({ t: 'shot', x: Math.round(m.x), y: Math.round(m.y), as: angles, sp: s.speed, fl: s.flare ? 1 : 0, rng: s.range, fo: s.falloff, dmg: s.damage, kb: s.knockback, loud: s.hearRadius });
    }
  }

  function addBullet(x, y, a, speed, dmg, kb, team, owner, range = BULLET_RANGE, falloff = 0, flare = false) {
    G.bullets.push({ x, y, ox: x, oy: y, range, falloff, flare, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: range / speed, dmg, kb, team, owner });
  }
  // damage after falloff (shotguns hit hardest up close)
  const bulletDamage = b => b.dmg * (1 - b.falloff * Math.min(1, Math.hypot(b.x - b.ox, b.y - b.oy) / b.range));

  function muzzleFlash(x, y, a) {
    for (let i = 0; i < 4; i++) {
      const b = a + (Math.random() - 0.5) * 0.8, v = 100 + Math.random() * 150;
      G.fx.push({ x, y, vx: Math.cos(b) * v, vy: Math.sin(b) * v, life: 0.08, max: 0.08, size: 5, color: '#ffd36b' });
    }
  }

  // An unsilenced shot near you: red screen edge, strongest toward the shot.
  function hear(x, y, radius) {
    const me = G.me;
    if (!me.alive || radius <= 0) return;
    const d = Math.hypot(x - me.x, y - me.y);
    if (d > radius) return;
    G.hears.push({ angle: Math.atan2(y - me.y, x - me.x), t: 1, power: 1 - (d / radius) * 0.6 });
    if (G.hears.length > 4) G.hears.shift();
  }

  function hurtMe(dmg, kb, angle, by) {
    const me = G.me;
    if (!me.alive) return;
    me.hp = Math.max(0, me.hp - dmg);
    me.vx += Math.cos(angle) * kb * 60;
    me.vy += Math.sin(angle) * kb * 60;
    G.hurt = 1;
    G.lastCombat = G.time;
    G.shake = Math.min(12, G.shake + 5);
    G.texts.push({ x: me.x, y: me.y - 34, text: `-${Math.round(dmg)}`, color: '#ff6b6b', life: 0.8 });
    if (G.mode === 'mp') Net.send({ t: 'hit', by, dmg });
    if (me.hp > 0) return;
    me.alive = false;
    burst(me.x, me.y, me.color, 20, 280);
    if (G.mode === 'sp') {
      setTimeout(() => G && hooks.spOver({ wave: G.wave, score: G.score, kills: G.kills }), 900);
    } else {
      G.banner = { text: 'You were eliminated', t: 3 };
      Net.send({ t: 'dead', by });
      addFeed(by, G.myId);
      hooks.myDeath(by);
    }
  }

  // segment (x1,y1)->(x2,y2) passes within r of (cx,cy)
  function segHitsCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((cx - x1) * dx + (cy - y1) * dy) / l2, 0, 1) : 0;
    const px = x1 + dx * t - cx, py = y1 + dy * t - cy;
    return px * px + py * py <= r * r;
  }

  function updateBullets(dt) {
    const me = G.me;
    for (const b of G.bullets) {
      const x1 = b.x, y1 = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) continue;
      if (b.x < 0 || b.y < 0 || b.x > MAP.w || b.y > MAP.h || MAP.walls.some(w => segmentHitsRect(x1, y1, b.x, b.y, w))) {
        b.life = 0;
        burst(b.x, b.y, '#9aa3b2', 3, 80);
        continue;
      }
      const a = Math.atan2(b.vy, b.vx);
      if (b.team === 'me') {
        if (G.mode === 'sp') {
          for (const e of G.enemies) {
            if (e.hp <= 0 || !segHitsCircle(x1, y1, b.x, b.y, e.x, e.y, e.r)) continue;
            hitEnemy(e, b, a);
            b.life = 0;
            break;
          }
        } else {
          for (const r of G.remotes.values()) {
            if (r.alive && isEnemy(r) && segHitsCircle(x1, y1, b.x, b.y, r.x, r.y, PLAYER.r)) { b.life = 0; r.flash = 0.08; break; }
          }
        }
      } else {
        const friendly = G.mode === 'mp' && G.teams && teamOf(b.owner) === me.team;
        if (me.alive && !friendly && segHitsCircle(x1, y1, b.x, b.y, me.x, me.y, me.r)) {
          hurtMe(bulletDamage(b), b.kb, a, b.owner);
          b.life = 0;
          continue;
        }
        if (b.team === 'r') {
          for (const r of G.remotes.values()) {
            if (r.id !== b.owner && r.alive && (!G.teams || r.team !== teamOf(b.owner)) && segHitsCircle(x1, y1, b.x, b.y, r.x, r.y, PLAYER.r)) { b.life = 0; break; }
          }
        }
      }
    }
    G.bullets = G.bullets.filter(b => b.life > 0);
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      G.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4, max: 0.4, size: 4, color });
    }
  }

  // ---------------------------------------------------------------- health packs
  // In multiplayer only the host spawns them and tells everyone else where they are.
  function updatePacks(dt) {
    const me = G.me;
    if (G.mode === 'sp' || Net.state.isHost) {
      G.packT -= dt;
      if (G.packT <= 0) {
        G.packT = HEALTH_PACK.every;
        const fresh = [];
        for (let i = 0; i < HEALTH_PACK.count && G.packs.length + fresh.length < HEALTH_PACK.max; i++) fresh.push(randomFloorSpot());
        for (let i = 0; i < AMMO.box.count; i++) fresh.push({ ...randomFloorSpot(), kind: 'ammo' });
        addPacks(fresh);
        if (G.mode === 'mp') Net.send({ t: 'packs', packs: fresh });
      }
    }
    if (!me.alive) return;
    for (const p of G.packs) {
      if (Math.hypot(p.x - me.x, p.y - me.y) > me.r + HEALTH_PACK.r) continue;
      if (p.kind === 'ammo') {
        // main gun first; the sidearm too if it needs ammo (the flare gun only once the main gun is full)
        const wants = gn => gn.reserve < gn.stats.maxReserve && gn.stats.boxRefill > 0;
        const [main, side] = me.guns;
        const needs = [];
        if (wants(main)) needs.push(main);
        if (wants(side) && !(side.stats.flare && needs.length)) needs.push(side);
        if (!needs.length) continue;
        for (const gn of needs) gn.reserve = Math.min(gn.stats.maxReserve, gn.reserve + gn.stats.boxRefill);
        G.texts.push({ x: me.x, y: me.y - 34, text: '+AMMO', color: '#ffd23f', life: 0.9 });
        updateWeaponBar(true);
      } else {
        if (me.hp >= me.maxHp) continue;
        me.hp = Math.min(me.maxHp, me.hp + HEALTH_PACK.heal);
        G.texts.push({ x: me.x, y: me.y - 34, text: `+${HEALTH_PACK.heal}`, color: '#4cff7a', life: 0.9 });
      }
      removePack(p.id);
      if (G.mode === 'mp') Net.send({ t: 'took', id: p.id });
      break;
    }
  }

  function randomFloorSpot() {
    const C = MAP.grid;
    for (let i = 0; i < 200; i++) {
      const gx = 1 + Math.floor(Math.random() * (MAP.cols - 2)), gy = 1 + Math.floor(Math.random() * (MAP.cols - 2));
      if (!MAP.solid[gy * MAP.cols + gx]) return { id: Math.random().toString(36).slice(2, 9), x: gx * C + C / 2, y: gy * C + C / 2 };
    }
    return { id: Math.random().toString(36).slice(2, 9), x: MAP.w / 2, y: MAP.h / 2 };
  }
  function addPacks(list) { G.packs.push(...list); }
  function removePack(id) { G.packs = G.packs.filter(p => p.id !== id); }

  function drawAmmoBox(p) {
    const s = AMMO.box.r;
    ctx.fillStyle = 'rgba(255,210,60,0.16)';
    ctx.beginPath(); ctx.arc(p.x, p.y, s * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c99a1e';
    ctx.strokeStyle = '#4a3700';
    ctx.lineWidth = 3;
    ctx.strokeRect(p.x - s, p.y - s * 0.7, s * 2, s * 1.4);
    ctx.fillRect(p.x - s, p.y - s * 0.7, s * 2, s * 1.4);
    ctx.fillStyle = '#ffe27a';
    for (let i = -1; i <= 1; i++) ctx.fillRect(p.x + i * s * 0.55 - 2.5, p.y - s * 0.45, 5, s * 0.9);
  }

  function drawPacks() {
    for (const p of G.packs) {
      if (p.kind === 'ammo') { drawAmmoBox(p); continue; }
      const pulse = 1 + Math.sin(performance.now() / 250) * 0.08, s = HEALTH_PACK.r * pulse, t = s * 0.38;
      ctx.fillStyle = 'rgba(40,255,110,0.18)';
      ctx.beginPath(); ctx.arc(p.x, p.y, s * 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2bd96b';
      ctx.strokeStyle = '#0b4a22';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.rect(p.x - s, p.y - t, s * 2, t * 2);
      ctx.rect(p.x - t, p.y - s, t * 2, s * 2);
      ctx.stroke();
      ctx.fillRect(p.x - s, p.y - t, s * 2, t * 2);
      ctx.fillRect(p.x - t, p.y - s, t * 2, s * 2);
    }
  }

  // ---------------------------------------------------------------- single player
  function updateWaves(dt) {
    if (!G.me.alive) return;
    if (G.phase === 'break') {
      G.breakT -= dt;
      if (G.breakT > 0) return;
      G.wave++;
      G.phase = 'fight';
      G.spawnT = 0;
      if (G.wave % BOSS_EVERY === 0) {
        G.queue = ['boss', ...Array(G.wave).fill('grunt')];
        G.banner = { text: `Wave ${G.wave} — BOSS!`, t: 2.5 };
      } else {
        G.queue = Array.from({ length: 3 + G.wave * 2 }, () => {
          const r = Math.random();
          return G.wave >= 2 && r < 0.3 ? 'shooter' : G.wave >= 2 && r < 0.55 ? 'runner' : 'grunt';
        });
        G.banner = { text: `Wave ${G.wave}`, t: 2 };
      }
    } else if (G.queue.length) {
      G.spawnT -= dt;
      if (G.spawnT <= 0) {
        spawnEnemy(G.queue.shift());
        G.spawnT = Math.max(0.25, 1 - G.wave * 0.05);
      }
    } else if (G.enemies.length === 0) {
      G.phase = 'break';
      G.breakT = 3;
      G.banner = { text: 'Wave cleared!', t: 2.5 };
    }
  }

  function spawnEnemy(type) {
    const def = ENEMIES[type], me = G.me;
    let x = 0, y = 0;
    for (let i = 0; i < 40; i++) {
      x = def.r + Math.random() * (MAP.w - def.r * 2);
      y = def.r + Math.random() * (MAP.h - def.r * 2);
      const c = { x, y, r: def.r };
      collideWorld(c);
      x = c.x; y = c.y;
      if (Math.hypot(x - me.x, y - me.y) > 650) break;
    }
    const scale = type === 'boss' ? 1 + (G.wave / BOSS_EVERY - 1) * 0.6 : 1 + (G.wave - 1) * 0.12;
    const e = {
      type, def, x, y, r: def.r, hp: def.hp * scale, maxHp: def.hp * scale,
      speed: def.speed * (0.9 + Math.random() * 0.2), kx: 0, ky: 0, flash: 0, aim: 0,
      cd: 1 + Math.random(), side: Math.random() < 0.5 ? -1 : 1, pattern: 0,
    };
    G.enemies.push(e);
    if (type === 'boss') G.boss = e;
  }

  function updateEnemies(dt) {
    const me = G.me, list = G.enemies;
    for (const e of list) {
      const dx = me.x - e.x, dy = me.y - e.y, d = Math.hypot(dx, dy) || 1;
      const sees = lineOfSight(e.x, e.y, me.x, me.y);
      let mx = dx / d, my = dy / d;
      if (!me.alive) { mx = my = 0; }
      else if (e.def.keepDistance && sees && d < e.def.keepDistance) { mx *= -0.6; my *= -0.6; }
      else if (!sees) { // slide around walls
        const sx = -my * e.side, sy = mx * e.side;
        mx = mx * 0.6 + sx * 0.8; my = my * 0.6 + sy * 0.8;
        const l = Math.hypot(mx, my); mx /= l; my /= l;
      }
      e.x += (mx * e.speed + e.kx) * dt;
      e.y += (my * e.speed + e.ky) * dt;
      e.kx *= Math.exp(-8 * dt); e.ky *= Math.exp(-8 * dt);
      e.flash = Math.max(0, e.flash - dt);
      e.aim = Math.atan2(dy, dx);
      collideWorld(e);

      if (e.def.gun && me.alive && sees && d < BULLET_RANGE * 0.8) {
        e.cd -= dt;
        if (e.cd <= 0) { enemyShoot(e); e.cd = e.def.gun.delay * (0.8 + Math.random() * 0.4); }
      }
      if (me.alive && d < e.r + me.r && me.meleeInv === 0) {
        hurtMe(e.def.melee, 4, Math.atan2(dy, dx), null);
        me.meleeInv = 0.6;
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2), push = min - d, nx = dx / d, ny = dy / d;
        const wa = b.r / (a.r + b.r);
        a.x -= nx * push * wa; a.y -= ny * push * wa;
        b.x += nx * push * (1 - wa); b.y += ny * push * (1 - wa);
      }
    }
  }

  function enemyShoot(e) {
    const g = e.def.gun;
    const shots = [];
    if (e.type === 'boss') {
      e.pattern = (e.pattern + 1) % 2;
      if (e.pattern === 0) for (let i = -2; i <= 2; i++) shots.push(e.aim + i * 0.18);
      else for (let i = 0; i < 14; i++) shots.push(e.aim + i * Math.PI * 2 / 14);
    } else {
      shots.push(e.aim + (Math.random() - 0.5) * 0.12);
    }
    const sx = e.x + Math.cos(e.aim) * e.r, sy = e.y + Math.sin(e.aim) * e.r;
    for (const a of shots) addBullet(sx, sy, a, g.speed, g.damage, 2, 'e', null);
    muzzleFlash(sx, sy, e.aim);
    hear(sx, sy, g.loudness * HEAR_UNIT);
  }

  function hitEnemy(e, b, a) {
    const dmg = bulletDamage(b);
    e.hp -= dmg;
    e.flash = 0.08;
    const weight = e.r / 16;
    e.kx += Math.cos(a) * b.kb * 50 / weight;
    e.ky += Math.sin(a) * b.kb * 50 / weight;
    G.texts.push({ x: e.x + (Math.random() - 0.5) * 16, y: e.y - e.r, text: Math.round(dmg), color: '#fff', life: 0.5 });
    burst(b.x, b.y, e.def.color, 3, 120);
    if (e.hp > 0) return;
    G.kills++;
    G.score += e.def.score;
    burst(e.x, e.y, e.def.color, e.type === 'boss' ? 60 : 14, e.type === 'boss' ? 500 : 260);
    G.enemies = G.enemies.filter(x => x !== e);
    if (e === G.boss) { G.boss = null; G.banner = { text: 'Boss defeated!', t: 2.5 }; }
  }

  // ---------------------------------------------------------------- multiplayer messages
  function remote(id) {
    if (!G.remotes.has(id)) {
      G.remotes.set(id, { id, name: '?', color: '#ccc', x: MAP.w / 2, y: MAP.h / 2, tx: MAP.w / 2, ty: MAP.h / 2,
        aim: 0, hp: PLAYER.hp, gun: 0, alive: true, kick: 0, flash: 0, sprites: [null, null] });
    }
    return G.remotes.get(id);
  }

  const nameOf = id => (id && G.myId === id ? G.me.name : id && G.remotes.has(id) ? G.remotes.get(id).name : 'Someone');

  function addFeed(by, victim) {
    const text = by && by !== victim ? `${nameOf(by)} eliminated ${nameOf(victim)}` : `${nameOf(victim)} was eliminated`;
    G.feed.push({ text, t: 5 });
  }

  const inMP = () => G && G.mode === 'mp';
  Net.on('st', m => {
    if (!inMP()) return;
    const r = remote(m.from);
    Object.assign(r, { tx: m.x, ty: m.y, aim: m.aim, hp: m.hp, gun: m.gun });
    if (!m.alive) r.alive = false;
  });
  Net.on('kit', m => {
    if (!inMP()) return;
    const r = remote(m.from);
    r.sprites = [renderGunSprite('main', m.main), renderGunSprite('secondary', m.secondary)];
  });
  Net.on('shot', m => {
    if (!inMP()) return;
    const r = remote(m.from);
    r.kick = 6;
    const angles = m.as || [m.a];
    for (const a of angles) addBullet(m.x, m.y, a, m.sp || BULLET_SPEED, m.dmg, m.kb, 'r', m.from, m.rng || BULLET_RANGE, m.fo || 0, !!m.fl);
    muzzleFlash(m.x, m.y, angles[0]);
    hear(m.x, m.y, m.loud);
  });
  Net.on('hit', m => {
    if (!inMP() || !G.remotes.has(m.from)) return;
    const r = G.remotes.get(m.from);
    r.flash = 0.1;
    G.texts.push({ x: r.x, y: r.y - 34, text: `-${Math.round(m.dmg)}`, color: m.by === G.myId ? '#fff' : '#ffb0b0', life: 0.6 });
    if (m.by === G.myId) G.lastCombat = G.time;
  });
  Net.on('dead', m => {
    if (!inMP()) return;
    const r = remote(m.from);
    r.alive = false;
    burst(r.x, r.y, r.color, 20, 280);
    addFeed(m.by, m.from);
  });
  Net.on('packs', m => { if (inMP()) addPacks(m.packs); });
  Net.on('took', m => { if (inMP()) removePack(m.id); });
  Net.on('leave', m => {
    if (!inMP() || !G.remotes.has(m.from)) return;
    G.feed.push({ text: `${G.remotes.get(m.from).name} left`, t: 5 });
    G.remotes.delete(m.from);
  });

  // ---------------------------------------------------------------- helpers
  const toScreen = (x, y) => ({ x: (x - G.cam.x) * zoom + W / 2, y: (y - G.cam.y) * zoom + H / 2 });

  // gun-space point (relative to the hand) -> world, for any shooter {x, y, r?, aim, kick}
  function gunToWorld(who, p) {
    const flip = Math.cos(who.aim) < 0 ? -1 : 1;
    const lx = PLAYER.r * 0.55 - who.kick + p.x * GUN_SCALE, ly = (4 + p.y * GUN_SCALE) * flip;
    const c = Math.cos(who.aim), s = Math.sin(who.aim);
    return { x: who.x + c * lx - s * ly, y: who.y + s * lx + c * ly };
  }

  // ---------------------------------------------------------------- render
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#0e1014';
    ctx.fillRect(0, 0, W, H);
    if (!G) return;

    const sx = (Math.random() - 0.5) * G.shake, sy = (Math.random() - 0.5) * G.shake;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-G.cam.x + sx, -G.cam.y + sy);

    drawFloor();

    // you only see what's in your line of sight: everything else is hidden behind walls
    const me = G.me;
    const sight = visibilityPolygon(me.x, me.y);
    ctx.save();
    tracePoly(sight);
    ctx.clip();

    drawPacks();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    for (const b of G.bullets) {
      ctx.strokeStyle = b.flare ? '#ff7b00' : b.team === 'me' ? '#ffe9a8' : '#ff8a7a';
      ctx.lineWidth = b.flare ? 9 : 3;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
      ctx.stroke();
    }

    for (const e of G.enemies) {
      drawChar(e.def, e.x, e.y, e.r, e.aim, e.def.color, e.flash > 0);
      if (e !== G.boss) drawBar(e.x, e.y - e.r - 10, e.r * 2, 5, e.hp / e.maxHp);
    }

    for (const r of G.remotes.values()) {
      if (!r.alive) continue;
      const sprite = r.sprites[r.gun];
      drawPlayer(r, r.color, sprite, r.flash > 0);
      drawBar(r.x, r.y - PLAYER.r - 14, 54, 7, r.hp / PLAYER.hp);
      nameTag(r.name, r.x, r.y - PLAYER.r - 20, isEnemy(r) ? '#ff5050' : '#4aa3ff');
    }

    ctx.restore();

    if (me.alive) {
      const gun = me.guns[me.cur];
      // aim area: on mobile while aiming (it auto-shoots there); on PC always shown, but you shoot yourself
      if (Settings.mobile ? Input.sticks.aim : Input.mouse.active) drawAimLine(me);
      drawPlayer(me, me.color, gun.sprite, false, me.meleeInv > 0 && Math.floor(me.meleeInv * 20) % 2);
      // health bar right above you — the middle of the screen
      drawBar(me.x, me.y - me.r - 16, 64, 9, me.hp / me.maxHp, true);
      if (G.mode === 'mp') nameTag(me.name, me.x, me.y - me.r - 22, G.teams ? '#4aa3ff' : '#ffffff');
    }

    for (const f of G.fx) {
      ctx.globalAlpha = f.life / f.max;
      ctx.fillStyle = f.color;
      ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.font = '700 16px system-ui, sans-serif';
    for (const t of G.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 3);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // shadow over everything you can't see
    ctx.beginPath();
    ctx.rect(G.cam.x - W / zoom, G.cam.y - H / zoom, W * 2 / zoom, H * 2 / zoom);
    tracePoly(sight);
    ctx.fillStyle = 'rgba(5,7,10,0.72)';
    ctx.fill('evenodd');
    ctx.restore();

    drawHearing();
    drawPing();
    drawHud();
  }

  function tracePoly(pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  // Ray-cast polygon of everything visible from (ox, oy), limited to the screen area.
  function visibilityPolygon(ox, oy) {
    const rx = W / 2 / zoom + 60, ry = H / 2 / zoom + 60;
    const box = [G.cam.x - rx, G.cam.y - ry, rx * 2, ry * 2];
    const rects = MAP.walls.filter(([x, y, w, h]) => x < box[0] + box[2] && x + w > box[0] && y < box[1] + box[3] && y + h > box[1]);
    const segs = [];
    const addRect = ([x, y, w, h]) => {
      segs.push([x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]);
    };
    rects.forEach(addRect);
    addRect(box);
    const angles = [];
    for (const [x1, y1] of segs) {
      const a = Math.atan2(y1 - oy, x1 - ox);
      angles.push(a - 0.0005, a, a + 0.0005);
    }
    for (let i = 0; i < 24; i++) angles.push(i / 24 * Math.PI * 2 - Math.PI);
    angles.sort((a, b) => a - b);
    const pts = [];
    for (const a of angles) {
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = Infinity;
      for (const [x1, y1, x2, y2] of segs) {
        const sx = x2 - x1, sy = y2 - y1, den = dx * sy - dy * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((x1 - ox) * sy - (y1 - oy) * sx) / den;
        const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
        if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
      }
      if (best < Infinity) pts.push({ x: ox + dx * best, y: oy + dy * best });
    }
    return pts;
  }

  // name above a player: blue = your team, red = enemy
  function nameTag(name, x, y, color) {
    ctx.font = '800 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(name, x, y);
    ctx.fillStyle = color;
    ctx.fillText(name, x, y);
  }

  // red arrows around you pointing at every enemy, during a ping
  function drawPing() {
    if (!G.ping || G.mode !== 'mp' || !G.me.alive) return;
    const a = Math.min(1, G.ping), R = Math.min(W, H) * 0.36;
    for (const r of G.remotes.values()) {
      if (!r.alive || !isEnemy(r)) continue;
      const ang = Math.atan2(r.y - G.me.y, r.x - G.me.x);
      const x = W / 2 + Math.cos(ang) * R, y = H / 2 + Math.sin(ang) * R;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.globalAlpha = a * (0.75 + 0.25 * Math.sin(performance.now() / 90));
      ctx.fillStyle = '#ff2b2b';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(22, 0); ctx.lineTo(-12, -15); ctx.lineTo(-5, 0); ctx.lineTo(-12, 15);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  function drawFloor() {
    const hw = W / 2 / zoom + 20, hh = H / 2 / zoom + 20;
    const x0 = Math.max(0, G.cam.x - hw), x1 = Math.min(MAP.w, G.cam.x + hw);
    const y0 = Math.max(0, G.cam.y - hh), y1 = Math.min(MAP.h, G.cam.y + hh);
    ctx.fillStyle = '#1a1e25';
    ctx.fillRect(0, 0, MAP.w, MAP.h);
    ctx.strokeStyle = '#222732';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const S = MAP.grid;
    for (let x = Math.ceil(x0 / S) * S; x <= x1; x += S) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.ceil(y0 / S) * S; y <= y1; y += S) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    for (const [x, y, w, h] of MAP.walls) {
      ctx.fillStyle = '#323946';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#3e4757';
      ctx.fillRect(x, y, w, 8);
      ctx.strokeStyle = '#151920';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.strokeStyle = '#3d4555';
    ctx.lineWidth = 10;
    ctx.strokeRect(-5, -5, MAP.w + 10, MAP.h + 10);
  }

  function drawBar(x, y, w, h, frac, mine) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = mine ? '#ff2e2e' : '#e05a5a';
    ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), h);
  }

  function drawChar(def, x, y, r, angle, color, flash) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (def._img) {
      const s = def.size;
      ctx.imageSmoothingEnabled = !PIXEL_ART;
      ctx.drawImage(def._img, -s / 2, -s / 2, s, s);
      if (flash) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= 0.7;
        ctx.drawImage(def._img, -s / 2, -s / 2, s, s);
      }
    } else {
      ctx.fillStyle = flash ? '#fff' : color;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#111';
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(r * 0.45, side * r * 0.35, r * 0.17, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawPlayer(p, color, sprite, flash, blink) {
    const behind = Math.sin(p.aim) < -0.3; // aiming up: gun goes behind the body
    if (behind) drawHeldGun(p, sprite);
    ctx.globalAlpha = blink ? 0.45 : 1;
    drawChar(PLAYER, p.x, p.y, PLAYER.r, p.aim, color, flash);
    ctx.globalAlpha = 1;
    if (!behind) drawHeldGun(p, sprite);
  }

  function drawHeldGun(p, sprite) {
    if (!sprite) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aim);
    ctx.scale(1, Math.cos(p.aim) < 0 ? -1 : 1);
    ctx.translate(PLAYER.r * 0.55 - p.kick, 4);
    ctx.scale(GUN_SCALE, GUN_SCALE);
    ctx.drawImage(sprite.canvas, sprite.minX, sprite.minY, sprite.w, sprite.h);
    ctx.restore();
  }

  function drawAimLine(me) {
    const m = gunToWorld(me, me.guns[me.cur].sprite.muzzle);
    // shows the auto-shoot area: as long as the gun's range, as wide as its assist
    const s = me.guns[me.cur].stats, half = 0.12 * s.assist, len = Math.min(s.range, 1200);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.arc(m.x, m.y, len, me.aim - half, me.aim + half);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // red edges fading toward the middle, like classic shooters
  function edgeGlow(rgb, alpha) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(1, `rgba(${rgb},${alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawHearing() {
    if (G.hurt > 0) edgeGlow('255,0,0', 0.75 * G.hurt);
    const R = Math.max(W, H);
    for (const h of G.hears) {
      const a = h.t * h.power;
      // yellow outline of the whole screen...
      edgeGlow('255,210,0', 0.35 * a);
      // ...strongest on the side the shot came from
      const cx = W / 2 + Math.cos(h.angle) * R * 0.75, cy = H / 2 + Math.sin(h.angle) * R * 0.75;
      const dir = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
      dir.addColorStop(0, `rgba(255,210,0,${0.8 * a})`);
      dir.addColorStop(0.55, `rgba(255,210,0,${0.28 * a})`);
      dir.addColorStop(1, 'rgba(255,210,0,0)');
      ctx.fillStyle = dir;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawHud() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const pad = 14;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    if (G.mode === 'sp') {
      ctx.fillText(`WAVE ${G.wave}`, pad, pad);
      ctx.fillStyle = '#ffd36b';
      ctx.fillText(`SCORE ${G.score}`, pad, pad + 20);
    } else {
      const alive = [...G.remotes.values()].filter(r => r.alive).length + (G.me.alive ? 1 : 0);
      ctx.fillText(`ALIVE ${alive}/${G.remotes.size + 1}`, pad, pad);
    }

    ctx.textAlign = 'right';
    ctx.font = '600 13px system-ui, sans-serif';
    G.feed.slice(-4).forEach((f, i) => {
      ctx.globalAlpha = Math.min(1, f.t);
      ctx.fillStyle = '#fff';
      ctx.fillText(f.text, W - 76, pad + 6 + i * 18);
    });
    ctx.globalAlpha = 1;

    if (G.boss) {
      const bw = Math.min(420, W * 0.6), y = Settings.mobile ? 86 : pad;
      ctx.textAlign = 'center';
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.fillStyle = '#e2b6ff';
      ctx.fillText('BOSS', W / 2, y);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(W / 2 - bw / 2, y + 16, bw, 10);
      ctx.fillStyle = '#b05cff';
      ctx.fillRect(W / 2 - bw / 2, y + 16, bw * Math.max(0, G.boss.hp / G.boss.maxHp), 10);
    }

    if (G.banner) {
      ctx.globalAlpha = Math.min(1, G.banner.t * 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(Math.min(40, W / 13))}px system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.fillText(G.banner.text, W / 2, H * 0.3);
      ctx.globalAlpha = 1;
    }

    if (!G.me.alive && G.mode === 'mp') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('Waiting for the round to end…', W / 2, H * 0.6);
    }

    if (Settings.mobile) drawSticks();
    else if (Input.mouse.active && G.me.alive) drawCrosshair();
  }

  function drawCrosshair() {
    const { x, y } = Input.mouse;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(x + dx * 6, y + dy * 6);
      ctx.lineTo(x + dx * 14, y + dy * 14);
    }
    ctx.stroke();
  }

  function drawSticks() {
    const R = Input.STICK_R;
    const draw = (s, gx, label, tint) => {
      const ox = s ? s.ox : gx, oy = s ? s.oy : H - 120;
      ctx.globalAlpha = s ? 1 : 0.45;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox, oy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = tint;
      ctx.beginPath(); ctx.arc(s ? s.x : ox, s ? s.y : oy, 26, 0, Math.PI * 2); ctx.fill();
      if (!s) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, ox, oy + R + 14);
      }
      ctx.globalAlpha = 1;
    };
    draw(Input.sticks.move, 110, 'MOVE', 'rgba(120,180,255,0.6)');
    draw(Input.sticks.aim, W - 110, 'AIM (auto-fires)', 'rgba(255,90,90,0.65)');
  }

  // ---------------------------------------------------------------- weapon bar (DOM)
  let barCache = '';
  function updateWeaponBar(force) {
    if (!G) return;
    const me = G.me;
    const key = me.cur + me.guns.map(g => `${g.ammo}/${g.reserve}/${g.reload > 0 ? Math.ceil(g.reload * 10) : 0}`).join('|');
    if (!force && key === barCache) return;
    barCache = key;
    me.guns.forEach((g, i) => {
      const btn = el('gun' + i);
      btn.classList.toggle('active', i === me.cur);
      btn.querySelector('.ammo').textContent = g.reload > 0 ? `Reloading ${g.reload.toFixed(1)}s`
        : g.ammo === 0 && g.reserve === 0 ? 'OUT OF AMMO' : `${g.ammo} | ${g.reserve}`;
    });
  }
  el('gun0').addEventListener('click', () => G && switchGun(0));
  el('gun1').addEventListener('click', () => G && switchGun(1));
  el('reloadBtn').addEventListener('pointerdown', e => { e.preventDefault(); Input.flags.reload = true; });

  function pause() { if (G) { if (G.mode === 'sp') G.paused = true; Input.reset(); } }
  function resume() { if (G) { G.paused = false; last = performance.now(); } }

  return {
    startSP, startMP, stop, pause, resume,
    get running() { return !!G; },
    get mode() { return G && G.mode; },
    get debugState() { return G; },
    on(name, fn) { hooks[name] = fn; },
  };
})();
