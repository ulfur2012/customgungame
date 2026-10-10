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
        ability: L.ability, abCd: 0, abUses: (ABILITIES[L.ability] || {}).uses ?? Infinity,
        abWasHeld: false, abAiming: false, shield: 0, shieldT: 0, regenTicks: 0, speedT: 0, rapidT: 0, slowT: 0, invT: 0, lastStand: false,
        ult: null, wallT: 0, rocketT: 0, trackT: 0, miniT: 0, godT: 0, hellT: 0, hellCd: 0, aimShots: 0,
        frozenT: 0, airT: 0, airA: 0, phaseT: 0, reflectT: 0, overShots: 0, recall: null, grapple: null, padCd: 0, thornCd: 0,
        guns: [makeGun('main', allowedBuild('main', L.main)), makeGun('secondary', allowedBuild('secondary', L.secondary))], cur: 0,
      },
      bullets: [], fx: [], texts: [], hears: [], feed: [],
      enemies: [], remotes: new Map(),
      cam: { x: spawn[0], y: spawn[1] }, shake: 0, hurt: 0, banner: null,
      wave: 0, phase: 'break', breakT: 1.5, queue: [], spawnT: 0, score: 0, kills: 0, boss: null,
      turrets: [], zones: [], gadgets: [], rings: [], strikes: [], lasers: [],
      sendT: 0, packs: [], packT: 0, nades: [], rockets: [], time: 0, lastCombat: 0, pingT: PING.every, ping: 0,
    };
  }

  // Bandolier passive: extra spare mags (and room for them)
  function applyBandolier(me) {
    me.maxHp = me.ability === 'glass' ? ABILITIES.glass.hp : PLAYER.hp;
    me.hp = Math.min(me.hp, me.maxHp);
    if (me.ability !== 'bandolier') return;
    for (const g of me.guns) {
      if (g.stats.flare || g.stats.maxReserve === 0) continue;
      const extra = g.stats.magSize * ABILITIES.bandolier.mags;
      g.stats.maxReserve += extra; g.reserve += extra;
    }
  }

  // test = test mode: change guns/ability/loadout from the pause menu; score doesn't count
  function startSP(test = false) {
    resize();
    G = newState('sp', [MAP.w / 2, MAP.h / 2], PLAYER_COLORS[0]);
    G.test = test;
    begin();
  }

  // test mode: rebuild your guns and ability from the current loadout, keeping where you are
  // test mode: drop an epic (ultimate) crate a little in front of you
  function spawnEpic() {
    if (!G) return;
    const me = G.me;
    let x = me.x, y = me.y;
    for (let d = 140; d >= 40; d -= 20) {
      const nx = me.x + Math.cos(me.aim) * d, ny = me.y + Math.sin(me.aim) * d;
      if (!pointInWall(nx, ny) && nx > 30 && ny > 30 && nx < MAP.w - 30 && ny < MAP.h - 30) { x = nx; y = ny; break; }
    }
    G.packs.push({ id: Math.random().toString(36).slice(2, 9), x, y, kind: 'epic' });
  }

  function applyLoadout() {
    if (!G) return;
    const me = G.me, L = Account.user.loadout;
    me.guns = [makeGun('main', allowedBuild('main', L.main)), makeGun('secondary', allowedBuild('secondary', L.secondary))];
    me.cur = 0;
    me.ability = L.ability;
    me.abCd = 0; me.abUses = (ABILITIES[L.ability] || {}).uses ?? Infinity;
    me.shield = 0; me.shieldT = 0; me.speedT = 0; me.rapidT = 0; me.slowT = 0; me.lastStand = false;
    applyBandolier(me);
    abCache = '';
    updateWeaponBar(true);
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
    applyBandolier(G.me);
    Input.reset();
    abCache = '';
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

    if (G.mode === 'sp') { updateWaves(dt); updateEnemies(me.slowT > 0 ? dt * ABILITIES.slowmo.factor : dt); }
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
        Net.send({ t: 'st', x: Math.round(me.x), y: Math.round(me.y), aim: +me.aim.toFixed(3), hp: me.hp, sh: Math.round(me.shield), gun: me.cur, alive: me.alive });
      }
    }
    updateBullets(dt);
    updateProjectiles(dt);
    updateGadgets(dt);
    updateGadgetList(dt);
    updateUlt(dt);
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
    const speed = PLAYER.speed * (me.speedT > 0 ? ABILITIES.energy.speed : 1) * (me.ability === 'sprinter' ? ABILITIES.sprinter.speed : 1)
      * (adrenalineOn() ? ABILITIES.adrenaline.speed : 1) * (me.frozenT > 0 ? 0.2 : 1) * (me.godT > 0 ? ULTIMATES.god.speed : 1);
    me.x += (mv.x * speed + me.vx) * dt;
    me.y += (mv.y * speed + me.vy) * dt;
    me.vx *= Math.exp(-10 * dt); me.vy *= Math.exp(-10 * dt);
    if (me.airT > 0) { // jump pad flight
      me.airT -= dt;
      me.vx = Math.cos(me.airA) * ABILITIES.jumppad.speed; me.vy = Math.sin(me.airA) * ABILITIES.jumppad.speed;
      if (me.airT <= 0) { me.vx *= 0.15; me.vy *= 0.15; }
    }
    if (me.phaseT > 0 || me.airT > 0) { me.x = clamp(me.x, me.r, MAP.w - me.r); me.y = clamp(me.y, me.r, MAP.h - me.r); } // phase walk
    else collideWorld(me);
    me.kick = Math.max(0, me.kick - 50 * dt);
    me.meleeInv = Math.max(0, me.meleeInv - dt);

    const sel = Input.take('select');
    if (sel >= 0) switchGun(sel);
    if (Input.take('swap')) switchGun(1 - me.cur);

    const gun = me.guns[me.cur], s = gun.stats;
    const scr = toScreen(me.x, me.y);
    const aim = Input.aim(scr.x, scr.y);
    if (aim.angle !== null) me.aim = aim.angle;
    updateAbility(dt);
    let fire = aim.fire && !me.abAiming;
    if (Settings.mobile) {
      // Brawl Stars style: hold the aim stick and it fires by itself when an enemy is in your sights
      fire = aim.aiming && !me.abAiming && targetInSights(me.aim);
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
      gun.reload = reloadTimeOf(s);
    }
    gun.cd = Math.max(0, gun.cd - dt);
    if (me.miniT > 0 || me.rocketT > 0) { gun.reload = 0; gun.ammo = Math.max(gun.ammo, 1); }
    if (fire && gun.reload === 0 && gun.ammo > 0 && gun.cd === 0) {
      shoot(gun);
      gun.cd = s.fireDelay * (me.rapidT > 0 ? ABILITIES.rapid.fireMul : 1) * (adrenalineOn() ? ABILITIES.adrenaline.fire : 1);
      if (me.miniT > 0) gun.cd = ULTIMATES.minigun.delay;
      if (me.rocketT > 0) gun.cd = Math.max(gun.cd, ULTIMATES.rockets.delay);
    }
    if (gun.ammo === 0 && gun.reload === 0 && gun.reserve > 0) gun.reload = reloadTimeOf(s);
  }

  // Quick Hands passive shortens every reload
  function reloadTimeOf(s) {
    return s.reloadTime * (G.me.ability === 'hands' ? ABILITIES.hands.reloadMul : 1);
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
    if (me.rocketT > 0) { // Rocket Rounds ultimate: every shot is an RPG
      addRocket(m.x, m.y, me.aim, myOwnerId());
      if (G.mode === 'mp') Net.send({ t: 'rpg', x: Math.round(m.x), y: Math.round(m.y), a: +me.aim.toFixed(4) });
      G.lastCombat = G.time; G.shake = Math.min(12, G.shake + 4); muzzleFlash(m.x, m.y, me.aim);
      return;
    }
    const angles = [];
    for (let i = 0; i < s.pellets; i++) {
      const fan = s.pellets > 1 ? (i / (s.pellets - 1) - 0.5) * s.spread : 0;
      angles.push(+(me.aim + fan + (Math.random() - 0.5) * (s.pellets > 1 ? 0.08 : s.spread)).toFixed(4));
    }
    const kind = { bounce: s.bounce, pierce: s.pierce, boom: s.boom };
    if (me.aimShots > 0) { me.aimShots--; kind.homing = 1; }
    if (me.wallT > 0) kind.ghost = 1;
    let dmg = s.damage * (me.ability === 'glass' ? ABILITIES.glass.mul : 1);
    if (me.overShots > 0) { me.overShots--; dmg *= ABILITIES.overcharge.mul; }
    for (const a of angles) addBullet(m.x, m.y, a, s.speed, dmg, s.knockback, 'me', G.myId, s.range, s.falloff, s.flare, kind);
    const a = me.aim;
    G.lastCombat = G.time;
    if (me.miniT <= 0) gun.ammo--;
    me.kick = Math.min(10 * s.recoil, (3 + s.knockback * 2) * s.recoil);
    me.vx -= Math.cos(me.aim) * s.knockback * 12 * s.recoil;
    me.vy -= Math.sin(me.aim) * s.knockback * 12 * s.recoil;
    G.shake = Math.min(6 * s.recoil, G.shake + (1 + s.knockback * 0.5) * s.recoil);
    muzzleFlash(m.x, m.y, a);
    if (G.mode === 'mp') {
      Net.send({ t: 'shot', x: Math.round(m.x), y: Math.round(m.y), as: angles, sp: s.speed, fl: s.flare ? 1 : 0, bt: kind, rng: s.range, fo: s.falloff, dmg, kb: s.knockback, loud: s.hearRadius });
    }
  }

  function addBullet(x, y, a, speed, dmg, kb, team, owner, range = BULLET_RANGE, falloff = 0, flare = false, kind = {}) {
    G.bullets.push({ x, y, ox: x, oy: y, range, falloff, flare,
      bounce: kind.bounce || 0, pierce: !!kind.pierce, homing: !!kind.homing, ghost: !!kind.ghost, boom: kind.boom || null, hit: new Set(), vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: range / speed, dmg, kb, team, owner });
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
    if (!me.alive || me.invT > 0 || me.godT > 0) return;
    if (me.ability === 'armor') dmg *= ABILITIES.armor.takeMul;
    const soaked = Math.min(me.shield, dmg);
    me.shield -= soaked;
    me.hp = Math.max(0, me.hp - (dmg - soaked));
    if (me.ability === 'thorns' && me.hp > 0 && me.thornCd <= 0) {
      const T = ABILITIES.thorns;
      me.thornCd = T.cd;
      fireBullets(me.x, me.y, Array.from({ length: T.count }, (_, i) => +(i * Math.PI * 2 / T.count).toFixed(4)), 900, T.damage, 1, 350, 3 * HEAR_UNIT);
    }
    me.vx += Math.cos(angle) * kb * 60;
    me.vy += Math.sin(angle) * kb * 60;
    G.hurt = 1;
    G.lastCombat = G.time;
    G.shake = Math.min(12, G.shake + 5);
    G.texts.push({ x: me.x, y: me.y - 34, text: `-${Math.round(dmg)}`, color: '#ff6b6b', life: 0.8 });
    if (G.mode === 'mp') Net.send({ t: 'hit', by, dmg });
    if (me.hp <= 0 && me.ability === 'laststand' && !me.lastStand) {
      me.lastStand = true;
      me.hp = ABILITIES.laststand.hp;
      me.invT = ABILITIES.laststand.inv;
      G.banner = { text: 'LAST STAND!', t: 1.5 };
    }
    if (me.hp > 0) return;
    me.alive = false;
    burst(me.x, me.y, me.color, 20, 280);
    if (G.mode === 'sp') {
      setTimeout(() => G && hooks.spOver({ wave: G.wave, score: G.score, kills: G.kills, test: G.test }), 900);
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
    const slow = me.slowT > 0 ? ABILITIES.slowmo.factor : 1;
    for (const b of G.bullets) {
      const x1 = b.x, y1 = b.y, bdt = b.team === 'me' ? dt : dt * slow;
      if (b.homing) steerBullet(b, bdt);
      b.x += b.vx * bdt; b.y += b.vy * bdt; b.life -= bdt;
      if (b.life <= 0) continue;
      const wall = b.ghost ? null : MAP.walls.find(w => segmentHitsRect(x1, y1, b.x, b.y, w));
      const out = b.x < 0 || b.y < 0 || b.x > MAP.w || b.y > MAP.h;
      if (wall || out) {
        if (b.bounce > 0) {
          // bounce: flip the side that crossed into the wall
          b.bounce--;
          let flipX, flipY;
          if (out) { flipX = b.x < 0 || b.x > MAP.w; flipY = b.y < 0 || b.y > MAP.h; }
          else {
            const [rx, ry, rw, rh] = wall;
            flipX = x1 < rx || x1 > rx + rw;
            flipY = y1 < ry || y1 > ry + rh;
            if (flipX && flipY) { flipX = Math.abs(b.vx) > Math.abs(b.vy); flipY = !flipX; }
          }
          if (flipX) b.vx = -b.vx;
          if (flipY || (!flipX && !flipY)) b.vy = -b.vy;
          b.x = x1; b.y = y1;
          burst(x1, y1, '#a29bfe', 3, 60);
          continue;
        }
        b.life = 0;
        if (b.boom) miniBoom(x1, y1, b);
        else burst(b.x, b.y, '#9aa3b2', 3, 80);
        continue;
      }
      const a = Math.atan2(b.vy, b.vx);
      if (G.gadgets.length && bulletHitsGadget(b, x1, y1)) { b.life = 0; continue; }
      if (b.team === 'me') {
        if (G.mode === 'sp') {
          for (const e of G.enemies) {
            if (e.hp <= 0 || b.hit.has(e) || !segHitsCircle(x1, y1, b.x, b.y, e.x, e.y, e.r)) continue;
            b.hit.add(e);
            hitEnemy(e, b, a);
            if (!b.pierce) { b.life = 0; break; }
          }
        } else {
          for (const r of G.remotes.values()) {
            if (r.alive && isEnemy(r) && !b.hit.has(r.id) && segHitsCircle(x1, y1, b.x, b.y, r.x, r.y, PLAYER.r)) {
              b.hit.add(r.id); r.flash = 0.08; vampire();
              if (!b.pierce) { b.life = 0; break; }
            }
          }
        }
      } else {
        const friendly = G.mode === 'mp' && G.teams && teamOf(b.owner) === me.team;
        if (me.alive && !friendly && !b.hit.has('me') && segHitsCircle(x1, y1, b.x, b.y, me.x, me.y, me.r)) {
          b.hit.add('me');
          if (me.reflectT > 0) { // mirror: send it straight back
            b.life = 0;
            fireBullets(me.x, me.y, [+(a + Math.PI).toFixed(4)], Math.hypot(b.vx, b.vy), b.dmg, b.kb, b.range, 3 * HEAR_UNIT);
            burst(me.x, me.y, '#f5f6fa', 5, 140);
            continue;
          }
          hurtMe(bulletDamage(b), b.kb, a, b.owner);
          if (!b.pierce) { b.life = 0; continue; }
        }
        if (b.team === 'r') {
          for (const r of G.remotes.values()) {
            if (r.id !== b.owner && r.alive && !b.hit.has(r.id) && (!G.teams || r.team !== teamOf(b.owner)) && segHitsCircle(x1, y1, b.x, b.y, r.x, r.y, PLAYER.r)) {
              b.hit.add(r.id);
              if (!b.pierce) { b.life = 0; break; }
            }
          }
        }
      }
    }
    G.bullets = G.bullets.filter(b => b.life > 0);
  }

  // boom bullets: a small 5 damage blast where they hit a wall
  function miniBoom(x, y, b) {
    const { radius, damage } = b.boom, me = G.me;
    burst(x, y, '#ff7675', 10, 200);
    G.fx.push({ x, y, vx: 0, vy: 0, life: 0.15, max: 0.15, size: radius * 1.4, color: 'rgba(255,120,100,0.45)' });
    if (b.team === 'me') {
      if (G.mode === 'sp') {
        for (const e of [...G.enemies]) {
          if (Math.hypot(e.x - x, e.y - y) <= radius + e.r) hitEnemy(e, { dmg: damage, falloff: 0, kb: 1, x: e.x, y: e.y, ox: e.x, oy: e.y, range: 1 }, Math.atan2(e.y - y, e.x - x));
        }
      }
    } else {
      const friendly = G.mode === 'mp' && G.teams && teamOf(b.owner) === me.team;
      if (me.alive && !friendly && Math.hypot(me.x - x, me.y - y) <= radius + me.r) hurtMe(damage, 1, Math.atan2(me.y - y, me.x - x), b.owner);
    }
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      G.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4, max: 0.4, size: 4, color });
    }
  }

  // ---------------------------------------------------------------- abilities
  const myOwnerId = () => G.myId || 'me';
  const isMine = owner => owner === myOwnerId();
  const hostileTo = owner => !isMine(owner) && (G.mode === 'sp' ? owner === 'enemy' : (!G.teams || teamOf(owner) !== G.me.team));

  function updateAbility(dt) {
    const me = G.me, A = ABILITIES[me.ability];
    if (!A) return;
    me.invT = Math.max(0, me.invT - dt);
    me.abCd = Math.max(0, me.abCd - dt);
    me.speedT = Math.max(0, me.speedT - dt);
    me.rapidT = Math.max(0, me.rapidT - dt);
    me.slowT = Math.max(0, me.slowT - dt);
    for (const k of ['frozenT', 'phaseT', 'reflectT', 'padCd', 'thornCd']) me[k] = Math.max(0, me[k] - dt);
    if (me.recall) {
      me.recall.t -= dt;
      if (me.recall.t <= 0) {
        burst(me.x, me.y, '#00a8ff', 14, 220);
        me.x = me.recall.x; me.y = me.recall.y; me.hp = Math.max(me.hp, me.recall.hp); me.vx = me.vy = 0;
        burst(me.x, me.y, '#00a8ff', 14, 220);
        me.recall = null;
      }
    }
    if (me.grapple) {
      const g = me.grapple, d = Math.hypot(g.x - me.x, g.y - me.y);
      g.t -= dt;
      if (d < 40 || g.t <= 0) me.grapple = null;
      else { me.vx = (g.x - me.x) / d * ABILITIES.grapple.pull; me.vy = (g.y - me.y) / d * ABILITIES.grapple.pull; }
    }
    if (me.shieldT > 0) {
      me.shieldT -= dt;
      if (me.shieldT <= 0) { me.shieldT = 0; me.shield = 0; }
    }
    if (A.type === 'passive' && me.ability !== 'regen') return; // the other passives work where they apply
    if (A.type === 'passive') {
      // regen: +10 HP for every 10 seconds out of combat
      const calm = G.time - G.lastCombat, ticks = Math.floor(calm / A.every);
      if (calm < A.every) me.regenTicks = 0;
      else if (ticks > me.regenTicks) {
        me.regenTicks = ticks;
        if (me.hp < me.maxHp) {
          me.hp = Math.min(me.maxHp, me.hp + A.heal);
          G.texts.push({ x: me.x, y: me.y - 34, text: `+${A.heal}`, color: '#4cff7a', life: 0.9 });
        }
      }
      return;
    }
    const pressed = Input.take('abPress');
    const held = Input.abilityHeld();
    const ready = me.abCd === 0 && me.abUses > 0 && me.shieldT === 0;
    const instant = ['shield', 'energy', 'burger', 'dash', 'rapid', 'blink', 'nova', 'slowmo', 'resupply', 'grapple', 'phase', 'reflect', 'overcharge', 'quake', 'recall'].includes(me.ability);
    if (instant) {
      if ((pressed || (held && !me.abWasHeld)) && ready) useInstant(A);
    } else {
      if (held && ready) me.abAiming = true;
      if (!held && me.abWasHeld && me.abAiming && ready) {
        if (me.ability === 'rpg') fireRocket(); else throwGrenade();
      }
      if (!held || !ready) me.abAiming = false;
    }
    me.abWasHeld = held;
  }

  const heal = n => {
    const me = G.me;
    me.hp = Math.min(me.maxHp, me.hp + n);
    G.texts.push({ x: me.x, y: me.y - 34, text: `+${n}`, color: '#4cff7a', life: 0.9 });
  };

  // abilities that happen the moment you press the button
  function useInstant(A) {
    const me = G.me;
    me.abCd = A.cooldown;
    me.abUses--;
    if (me.ability === 'shield') { me.shield = A.hp; me.shieldT = A.duration; G.banner = { text: 'Shield up!', t: 1 }; }
    if (me.ability === 'energy') { heal(A.heal); me.speedT = A.duration; G.banner = { text: 'Speed boost!', t: 1 }; }
    if (me.ability === 'burger') heal(A.heal);
    if (me.ability === 'rapid') { me.rapidT = A.duration; G.banner = { text: 'Rapid fire!', t: 1 }; }
    if (me.ability === 'dash') {
      const mv = Input.move(), moving = Math.hypot(mv.x, mv.y) > 0.2;
      const a = moving ? Math.atan2(mv.y, mv.x) : me.aim;
      me.vx += Math.cos(a) * A.power;
      me.vy += Math.sin(a) * A.power;
      burst(me.x, me.y, A.color, 8, 160);
    }
    if (me.ability === 'blink') {
      // goes through walls: land at full range, or the furthest free spot before it
      const free = (x, y) => !pointInWall(x, y) && !pointInWall(x - me.r, y) && !pointInWall(x + me.r, y)
        && !pointInWall(x, y - me.r) && !pointInWall(x, y + me.r);
      let tx = me.x, ty = me.y;
      for (let d = A.range; d > 0; d -= 10) {
        const nx = me.x + Math.cos(me.aim) * d, ny = me.y + Math.sin(me.aim) * d;
        if (free(nx, ny)) { tx = nx; ty = ny; break; }
      }
      burst(me.x, me.y, A.color, 12, 200);
      me.x = tx; me.y = ty; collideWorld(me);
      burst(me.x, me.y, A.color, 12, 200);
    }
    if (me.ability === 'nova') {
      const angles = Array.from({ length: A.count }, (_, i) => +(i * Math.PI * 2 / A.count).toFixed(4));
      fireBullets(me.x, me.y, angles, A.speed, A.damage, 1.5, A.range, 6 * HEAR_UNIT);
      G.shake = Math.min(12, G.shake + 5);
    }
    if (me.ability === 'slowmo') { me.slowT = A.duration; G.banner = { text: 'Bullet time!', t: 1 }; }
    if (me.ability === 'grapple') {
      let hit = null;
      for (let d = 20; d <= A.range; d += 10) {
        const x = me.x + Math.cos(me.aim) * d, y = me.y + Math.sin(me.aim) * d;
        if (pointInWall(x, y)) { hit = { x: me.x + Math.cos(me.aim) * (d - me.r - 4), y: me.y + Math.sin(me.aim) * (d - me.r - 4) }; break; }
      }
      if (!hit) { me.abUses++; me.abCd = 0; G.banner = { text: 'Nothing to hook onto', t: 1 }; }
      else me.grapple = { ...hit, t: 0.8 };
    }
    if (me.ability === 'phase') { me.phaseT = A.duration; G.banner = { text: 'Phase walk!', t: 1 }; }
    if (me.ability === 'reflect') { me.reflectT = A.duration; G.banner = { text: 'Mirror up!', t: 1 }; }
    if (me.ability === 'overcharge') { me.overShots = A.shots; G.banner = { text: 'Overcharged!', t: 1 }; }
    if (me.ability === 'recall') me.recall = { x: me.x, y: me.y, hp: me.hp, t: A.delay };
    if (me.ability === 'quake') {
      slam(me.x, me.y, A.radius, A.damage, A.kb, myOwnerId());
      if (G.mode === 'mp') Net.send({ t: 'aoe', x: Math.round(me.x), y: Math.round(me.y), r: A.radius, dmg: A.damage, kb: A.kb });
      G.shake = Math.min(14, G.shake + 8);
    }
    if (me.ability === 'resupply') {
      for (const g of me.guns) {
        g.reserve = Math.min(g.stats.maxReserve, g.reserve + g.stats.magSize);
        g.ammo = g.stats.magSize; g.reload = 0;
      }
      G.banner = { text: 'Resupplied!', t: 1 };
      updateWeaponBar(true);
    }
  }

  // Vampire passive: every hit you land heals you a little
  function vampire() {
    const me = G.me;
    if (me.ability !== 'vampire' || !me.alive || me.hp >= me.maxHp) return;
    me.hp = Math.min(me.maxHp, me.hp + ABILITIES.vampire.heal);
  }

  // bullets that don't come from your gun (nova, turret); other players see them too
  function fireBullets(x, y, angles, speed, dmg, kb, range, loud, kind = {}, falloff = 0) {
    for (const a of angles) addBullet(x, y, a, speed, dmg, kb, 'me', G.myId, range, falloff, false, kind);
    G.lastCombat = G.time;
    if (G.mode === 'mp') Net.send({ t: 'shot', x: Math.round(x), y: Math.round(y), as: angles, sp: speed, fl: 0, bt: kind, rng: range, fo: falloff, dmg, kb, loud });
  }

  const adrenalineOn = () => G.me.ability === 'adrenaline' && G.me.hp < G.me.maxHp * ABILITIES.adrenaline.below;

  // Scavenger passive: kills give health and ammo
  function onKill() {
    const me = G.me, S = ABILITIES.scavenger;
    if (me.ability !== 'scavenger' || !me.alive) return;
    heal(S.heal);
    for (const g of me.guns) g.reserve = Math.min(g.stats.maxReserve, g.reserve + Math.ceil(g.stats.magSize * S.mags));
    updateWeaponBar(true);
  }

  // damage an enemy (single player) without a real bullet
  function hurtEnemy(e, dmg, kb, a) {
    hitEnemy(e, { dmg, falloff: 0, kb, x: e.x, y: e.y, ox: e.x, oy: e.y, range: 1, team: 'me' }, a);
  }

  // ground slam: hurts + pushes enemies of the owner
  function slam(x, y, radius, dmg, kb, owner) {
    G.rings.push({ x, y, r: radius, life: 0.45, max: 0.45, color: '184,132,90' });
    burst(x, y, '#b8845a', 24, 360);
    areaOf({ x, y, owner }, radius,
      e => hurtEnemy(e, dmg, kb, Math.atan2(e.y - y, e.x - x)),
      () => hurtMe(dmg, kb, Math.atan2(G.me.y - y, G.me.x - x), owner));
  }

  // calls onEnemy for single player enemies in range (if it's mine), or onMe if I'm an enemy of its owner and in range
  function areaOf(g, r, onEnemy, onMe) {
    const me = G.me;
    if (isMine(g.owner)) {
      if (G.mode === 'sp') for (const e of [...G.enemies]) if (Math.hypot(e.x - g.x, e.y - g.y) <= r + e.r) onEnemy(e);
    } else if (me.alive && hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= r + me.r) onMe();
  }

  // like areaOf, but hits everyone in range, the thrower too
  function areaAll(g, r, onEnemy, onMe) {
    const me = G.me;
    if (isMine(g.owner) && G.mode === 'sp') for (const e of [...G.enemies]) if (Math.hypot(e.x - g.x, e.y - g.y) <= r + e.r) onEnemy(e);
    if (me.alive && Math.hypot(me.x - g.x, me.y - g.y) <= r + me.r) onMe();
  }

  // ---- thrown gadgets: everyone simulates them; damage is worked out by whoever gets hit
  let gadgetSeq = 0;
  function landGadget(n) {
    const id = (G.myId || 'me') + ':' + (gadgetSeq++);
    const main = G.me.guns[0];
    addGadget({ kind: n.kind, x: n.x1, y: n.y1, a: n.a || 0, owner: n.owner, id, color: G.me.color, name: G.me.name, stats: main.stats, sprite: main.sprite });
    if (G.mode === 'mp') Net.send({ t: 'gad', k: n.kind, x: Math.round(n.x1), y: Math.round(n.y1), a: +(n.a || 0).toFixed(3), id, c: G.me.color, n: G.me.name, b: main.build });
  }
  function addGadget(g) {
    const A = ABILITIES[g.kind];
    Object.assign(g, { age: 0, tick: 0, t: A.duration || A.life || 1, zaps: [] });
    burst(g.x, g.y, A.color, 18, 260);
    if (g.kind === 'freeze') {
      G.rings.push({ x: g.x, y: g.y, r: A.radius, life: 0.6, max: 0.6, color: '126,214,255' });
      areaAll(g, A.radius, e => { e.frozen = A.time; }, () => { G.me.frozenT = A.time; G.banner = { text: 'Frozen!', t: 1 }; });
      g.t = 0.6;
    }
    if (g.kind === 'smoke') {
      // a lumpy cloud: lots of puffs of different sizes, not one circle
      const R = A.radius;
      g.puffs = Array.from({ length: 14 }, (_, i) => {
        const an = i * 2.4 + Math.random() * 0.8, d = R * (0.15 + Math.random() * 0.55);
        return { x: g.x + Math.cos(an) * d, y: g.y + Math.sin(an) * d * 0.8, r: R * (0.3 + Math.random() * 0.3), ph: Math.random() * 6 };
      });
    }
    if (A.hp) g.hp = A.hp;
    if (g.kind === 'decoy') Object.assign(g, { r: PLAYER.r, cd: 0.5, kick: 0, aim: g.a });
    if (g.kind === 'barrier') {
      const L = A.len, T = A.thick, vert = Math.abs(Math.cos(g.a)) > Math.abs(Math.sin(g.a));
      g.rect = vert ? [g.x - T / 2, g.y - L / 2, T, L] : [g.x - L / 2, g.y - T / 2, L, T];
      MAP.walls.push(g.rect);
      if (!G.me.phaseT) collideWorld(G.me);
    }
    G.gadgets.push(g);
  }
  function removeGadget(g) {
    g.dead = true;
    if (g.rect) MAP.walls = MAP.walls.filter(w => w !== g.rect);
  }
  const smokeBlocks = (x1, y1, x2, y2) => G.gadgets.some(g => g.kind === 'smoke' && g.puffs.some(p => segHitsCircle(x1, y1, x2, y2, p.x, p.y, p.r * 0.8)));
  const myDecoy = () => G.gadgets.find(g => g.kind === 'decoy' && isMine(g.owner));

  function updateGadgetList(dt) {
    const me = G.me;
    for (const g of G.gadgets) {
      if (g.dead) continue;
      const A = ABILITIES[g.kind];
      g.t -= dt; g.age += dt; g.tick -= dt;
      for (const z of g.zaps) z.life -= dt;
      g.zaps = g.zaps.filter(z => z.life > 0);
      if (g.kind === 'blackhole') {
        areaAll(g, A.radius, e => {
          const d = Math.hypot(g.x - e.x, g.y - e.y) || 1, w = e.r / 16;
          e.kx += (g.x - e.x) / d * A.pull * dt * 6 / w; e.ky += (g.y - e.y) / d * A.pull * dt * 6 / w;
        }, () => {
          const d = Math.hypot(g.x - me.x, g.y - me.y) || 1;
          me.vx += (g.x - me.x) / d * A.pull * dt * 3; me.vy += (g.y - me.y) / d * A.pull * dt * 3;
        });
      }
      if (g.kind === 'firepit' && g.tick <= 0) {
        g.tick = 0.5;
        areaAll(g, A.radius, e => hurtEnemy(e, A.dps / 2, 0.2, Math.atan2(e.y - g.y, e.x - g.x)),
          () => hurtMe(A.dps / 2, 0, Math.atan2(me.y - g.y, me.x - g.x), g.owner));
      }
      if (g.kind === 'firepit' && Math.random() < 0.6) {
        const an = Math.random() * Math.PI * 2, d = Math.random() * A.radius;
        G.fx.push({ x: g.x + Math.cos(an) * d, y: g.y + Math.sin(an) * d, vx: 0, vy: -50, life: 0.5, max: 0.5, size: 7, color: Math.random() < 0.5 ? '#ff6b1a' : '#ffd32a' });
      }
      if (g.kind === 'tesla' && g.tick <= 0) {
        g.tick = A.every;
        if (isMine(g.owner)) {
          for (const e of (G.mode === 'sp' ? [...G.enemies] : targets())) {
            if (Math.hypot(e.x - g.x, e.y - g.y) > A.radius || !lineOfSight(g.x, g.y, e.x, e.y)) continue;
            g.zaps.push({ x: e.x, y: e.y, life: 0.15 });
            if (G.mode === 'sp') hurtEnemy(e, A.damage, 0.5, Math.atan2(e.y - g.y, e.x - g.x));
          }
        } else if (me.alive && hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= A.radius && lineOfSight(g.x, g.y, me.x, me.y)) {
          g.zaps.push({ x: me.x, y: me.y, life: 0.15 });
          hurtMe(A.damage, 0.5, Math.atan2(me.y - g.y, me.x - g.x), g.owner);
        }
      }
      if (g.kind === 'mine' && g.age > A.arm) {
        let boom = false;
        if (isMine(g.owner)) boom = targets().some(e => Math.hypot(e.x - g.x, e.y - g.y) <= A.trigger + (e.r || PLAYER.r));
        else boom = me.alive && hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= A.trigger + me.r;
        if (boom) {
          mineBoom(g);
          if (G.mode === 'mp') Net.send({ t: 'gadx', id: g.id });
        }
      }
      if (g.kind === 'decoy' && isMine(g.owner)) updateBuddy(g, dt);
      if (g.kind === 'jumppad' && me.alive && me.padCd === 0 && !hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= A.radius + me.r * 0.5) {
        me.padCd = 0.8;
        me.airT = A.air; me.airA = g.a; // flying: walls don't stop you until you land
        burst(g.x, g.y, A.color, 12, 260);
      }
      if (g.t <= 0 || g.hp <= 0) removeGadget(g);
    }
    G.gadgets = G.gadgets.filter(g => !g.dead);
    G.buddySend = (G.buddySend || 0) - dt;
    if (G.mode === 'mp' && G.buddySend <= 0) {
      G.buddySend = 0.08;
      for (const g of G.gadgets) if (g.kind === 'decoy' && isMine(g.owner)) Net.send({ t: 'gadm', id: g.id, x: Math.round(g.x), y: Math.round(g.y), a: +g.aim.toFixed(3), hp: Math.round(g.hp) });
    }
    for (const r of G.rings) r.life -= dt;
    G.rings = G.rings.filter(r => r.life > 0);
    // frozen single player enemies thaw out
    if (G.mode === 'sp') for (const e of G.enemies) if (e.frozen > 0) e.frozen -= dt;
  }
  // Buddy (decoy): a teammate bot with a copy of your main gun that hunts enemies
  function updateBuddy(g, dt) {
    const A = ABILITIES.decoy;
    let best = null, bd = Infinity;
    for (const t of targets()) { const d = Math.hypot(t.x - g.x, t.y - g.y); if (d < bd) { best = t; bd = d; } }
    let mx = 0, my = 0;
    const sees = best && lineOfSight(g.x, g.y, best.x, best.y) && !smokeBlocks(g.x, g.y, best.x, best.y);
    if (best) {
      g.roam = null;
      g.aim = Math.atan2(best.y - g.y, best.x - g.x);
      if (sees) {
        // in range: hold a fighting distance, otherwise charge in
        const want = bd < g.stats.range * 0.8 ? (bd < 200 ? -1 : bd > 320 ? 1 : 0) : 1;
        mx = Math.cos(g.aim) * want; my = Math.sin(g.aim) * want;
      } else ({ x: mx, y: my } = buddyPath(g, best.x, best.y, dt));
    } else {
      // nobody to fight right now: go out and look for them instead of waiting by you
      if (!g.roam || Math.hypot(g.roam.x - g.x, g.roam.y - g.y) < 80) { g.roam = randomFloorSpot(); g.flow = null; }
      ({ x: mx, y: my } = buddyPath(g, g.roam.x, g.roam.y, dt));
      if (mx || my) g.aim = Math.atan2(my, mx);
    }
    g.x += mx * A.speed * dt; g.y += my * A.speed * dt;
    collideWorld(g);
    g.cd -= dt;
    g.kick = Math.max(0, g.kick - 40 * dt);
    if (sees && bd < g.stats.range && g.cd <= 0) {
      const s = g.stats;
      g.cd = Math.max(s.fireDelay, s.reloadTime / s.magSize, 0.12);
      g.kick = 4;
      shootFrom(g.x + Math.cos(g.aim) * 30, g.y + Math.sin(g.aim) * 30, g.aim, s);
    }
  }

  // direction for the buddy to walk to reach (tx, ty) around walls (grid paths, refreshed often)
  function buddyPath(g, tx, ty, dt) {
    const C = MAP.grid, cols = MAP.cols;
    const cell = (v) => clamp(Math.floor(v / C), 0, cols - 1);
    const goal = cell(ty) * cols + cell(tx);
    g.pathT = (g.pathT || 0) - dt;
    if (g.pathT <= 0 || !g.flow || g.goal !== goal) {
      g.pathT = 0.4; g.goal = goal;
      const open = (x, y) => x >= 0 && y >= 0 && x < cols && y < cols && !MAP.solid[y * cols + x];
      g.flow = bfs(open, [goal]);
    }
    const x = cell(g.x), y = cell(g.y);
    let step = null, sd = g.flow[y * cols + x] >= 0 ? g.flow[y * cols + x] : Infinity;
    if (sd === 0) step = { x: tx, y: ty };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, v = nx >= 0 && ny >= 0 && nx < cols && ny < cols ? g.flow[ny * cols + nx] : -1;
      if (v >= 0 && v < sd) { sd = v; step = { x: (nx + 0.5) * C, y: (ny + 0.5) * C }; }
    }
    if (!step) { const l = Math.hypot(tx - g.x, ty - g.y) || 1; return { x: (tx - g.x) / l, y: (ty - g.y) / l }; }
    const l = Math.hypot(step.x - g.x, step.y - g.y) || 1;
    return { x: (step.x - g.x) / l, y: (step.y - g.y) / l };
  }

  // fire one shot of a gun's stats from somewhere (turret / buddy)
  function shootFrom(sx, sy, aim, s) {
    const angles = [];
    for (let i = 0; i < s.pellets; i++) {
      const fan = s.pellets > 1 ? (i / (s.pellets - 1) - 0.5) * s.spread : 0;
      angles.push(+(aim + fan + (Math.random() - 0.5) * s.spread).toFixed(4));
    }
    fireBullets(sx, sy, angles, s.speed, s.damage, s.knockback, s.range, s.hearRadius, { bounce: s.bounce, pierce: s.pierce, boom: s.boom }, s.falloff);
    muzzleFlash(sx, sy, aim);
  }

  // buildings and your buddy can be shot. Returns true if the bullet was stopped.
  // The owner keeps track of the HP and tells everyone when it breaks.
  function bulletHitsGadget(b, x1, y1) {
    for (const g of G.gadgets) {
      if (g.hp === undefined || g.dead) continue;
      const hostile = G.mode === 'sp' ? b.team === 'e'
        : b.owner !== g.owner && (!G.teams || teamOf(b.owner) !== teamOf(g.owner));
      if (!hostile || !segHitsCircle(x1, y1, b.x, b.y, g.x, g.y, g.kind === 'decoy' ? PLAYER.r : 22)) continue;
      damageGadget(g, bulletDamage(b));
      return true;
    }
    return false;
  }
  function damageGadget(g, dmg) {
    g.flash = 0.1;
    if (!isMine(g.owner)) return;
    g.hp -= dmg;
    if (g.hp <= 0) {
      burst(g.x, g.y, ABILITIES[g.kind].color, 24, 300);
      removeGadget(g);
      if (G.mode === 'mp') Net.send({ t: 'gadx', id: g.id });
    }
  }

  function mineBoom(g) {
    if (g.dead) return;
    const A = ABILITIES.mine;
    removeGadget(g);
    explode(g.x, g.y, A.radius, A.damage, g.owner);
  }

  function drawGadgetList() {
    for (const g of G.gadgets) {
      const A = ABILITIES[g.kind], pop = Math.min(1, g.age / 0.25);
      g.flash = Math.max(0, (g.flash || 0) - 1 / 60);
      ctx.save();
      if (g.kind === 'blackhole') {
        const r = A.radius * pop;
        const grd = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, r);
        grd.addColorStop(0, 'rgba(0,0,0,0.95)'); grd.addColorStop(0.25, 'rgba(60,20,90,0.7)'); grd.addColorStop(1, 'rgba(142,68,173,0)');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(200,140,255,0.6)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(g.x, g.y, r * (0.3 + 0.2 * i), G.time * (3 + i) , G.time * (3 + i) + 2); ctx.stroke(); }
      } else if (g.kind === 'firepit') {
        ctx.fillStyle = 'rgba(255,107,26,0.25)'; ctx.strokeStyle = 'rgba(255,160,40,0.7)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(g.x, g.y, A.radius * pop, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (g.kind === 'decoy') {
        drawPlayer({ x: g.x, y: g.y, aim: g.aim ?? g.a, kick: g.kick || 0 }, g.color, g.sprite, g.flash > 0);
        drawBar(g.x, g.y - PLAYER.r - 14, 54, 7, g.hp / A.hp, false, hostileTo(g.owner) ? '#ff5050' : '#4aa3ff');
        nameTag(`${g.name}'s buddy`, g.x, g.y - PLAYER.r - 20, hostileTo(g.owner) ? '#ff5050' : '#4aa3ff');
      } else if (g.kind === 'barrier' && g.rect) {
        const [x, y, w, h] = g.rect;
        ctx.fillStyle = 'rgba(84,160,255,0.55)'; ctx.strokeStyle = '#c8e1ff'; ctx.lineWidth = 2;
        ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
      } else if (g.kind === 'mine') {
        if (!hostileTo(g.owner)) { // enemies can't see your mines
          ctx.fillStyle = '#3d3d3d'; ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(g.x, g.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = g.age > A.arm && Math.sin(G.time * 10) > 0 ? '#ff3030' : '#550000';
          ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, Math.PI * 2); ctx.fill();
        }
      } else if (g.kind === 'jumppad') {
        ctx.translate(g.x, g.y); ctx.rotate(g.a);
        ctx.fillStyle = 'rgba(29,209,161,0.35)'; ctx.strokeStyle = '#1dd1a1'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, A.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1dd1a1';
        const s = (G.time * 2) % 1;
        for (let i = 0; i < 2; i++) { const o = -14 + ((s + i * 0.5) % 1) * 28; ctx.beginPath(); ctx.moveTo(o + 10, 0); ctx.lineTo(o - 4, -10); ctx.lineTo(o - 4, 10); ctx.fill(); }
      } else if (g.kind === 'radar') {
        ctx.strokeStyle = `rgba(255,159,243,${0.6 * (1 - (G.time % 1.5) / 1.5)})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(g.x, g.y, 30 + ((G.time % 1.5) / 1.5) * 200, 0, Math.PI * 2); ctx.stroke();
        // tower: base, mast and a spinning dish
        ctx.fillStyle = g.flash > 0 ? '#fff' : '#57606f'; ctx.fillRect(g.x - 18, g.y - 18, 36, 36);
        ctx.strokeStyle = '#2f3542'; ctx.lineWidth = 2; ctx.strokeRect(g.x - 18, g.y - 18, 36, 36);
        ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(G.time * 3);
        ctx.fillStyle = '#ff9ff3'; ctx.fillRect(-4, -4, 26, 8); ctx.beginPath(); ctx.arc(22, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        drawBar(g.x, g.y - 32, 44, 6, g.hp / A.hp, false, '#ff9ff3');
      } else if (g.kind === 'tesla') {
        ctx.strokeStyle = 'rgba(72,219,251,0.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(g.x, g.y, A.radius, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = g.flash > 0 ? '#fff' : '#2d3436'; ctx.fillRect(g.x - 18, g.y - 18, 36, 36);
        ctx.strokeStyle = '#48dbfb'; ctx.lineWidth = 2; ctx.strokeRect(g.x - 18, g.y - 18, 36, 36);
        ctx.fillStyle = '#636e72'; ctx.fillRect(g.x - 5, g.y - 14, 10, 18);
        ctx.fillStyle = '#48dbfb'; ctx.beginPath(); ctx.arc(g.x, g.y - 12, 8 + Math.sin(G.time * 20) * 2, 0, Math.PI * 2); ctx.fill();
        drawBar(g.x, g.y - 32, 44, 6, g.hp / A.hp, false, '#48dbfb');
        ctx.strokeStyle = '#c7f4ff'; ctx.lineWidth = 3;
        for (const z of g.zaps) { // jagged lightning
          ctx.beginPath(); ctx.moveTo(g.x, g.y - 4);
          for (let i = 1; i < 6; i++) { const k = i / 6; ctx.lineTo(g.x + (z.x - g.x) * k + (Math.random() - 0.5) * 22, g.y - 4 + (z.y - g.y + 4) * k + (Math.random() - 0.5) * 22); }
          ctx.lineTo(z.x, z.y); ctx.stroke();
        }
      }
      ctx.restore();
    }
    for (const r of G.rings) {
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = `rgba(${r.color},${1 - k})`; ctx.lineWidth = 8 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.2 + 0.8 * k), 0, Math.PI * 2); ctx.stroke();
    }
    // frozen enemies get an ice shell
    if (G.mode === 'sp') for (const e of G.enemies) if (e.frozen > 0) {
      ctx.fillStyle = 'rgba(126,214,255,0.45)'; ctx.strokeStyle = '#dff6ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    const me = G.me;
    if (me.frozenT > 0) { ctx.fillStyle = 'rgba(126,214,255,0.45)'; ctx.beginPath(); ctx.arc(me.x, me.y, me.r + 6, 0, Math.PI * 2); ctx.fill(); }
    if (me.reflectT > 0) { ctx.strokeStyle = 'rgba(245,246,250,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(me.x, me.y, me.r + 9, 0, Math.PI * 2); ctx.stroke(); }
    if (me.overShots > 0) { ctx.strokeStyle = 'rgba(251,197,49,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(me.x, me.y, me.r + 5 + Math.sin(G.time * 15) * 2, 0, Math.PI * 2); ctx.stroke(); }
    if (me.recall) { // ghost of where you'll jump back to
      ctx.globalAlpha = 0.35; drawChar(PLAYER, me.recall.x, me.recall.y, PLAYER.r, me.aim, '#00a8ff', false); ctx.globalAlpha = 1;
    }
    if (me.grapple) { ctx.strokeStyle = '#e1b12c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(me.grapple.x, me.grapple.y); ctx.stroke(); }
  }

  // arrow around you pointing at the nearest enemy (radar tower, tracker ultimate)
  function drawEnemyArrow(color) {
    const me = G.me;
    let best = null, bd = Infinity;
    for (const t of targets()) { const d = Math.hypot(t.x - me.x, t.y - me.y); if (d < bd) { best = t; bd = d; } }
    if (!best) return;
    const an = Math.atan2(best.y - me.y, best.x - me.x), ax = me.x + Math.cos(an) * 75, ay = me.y + Math.sin(an) * 75;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(an);
    ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-4, 0); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(bd / MAP.grid)}m`, ax, ay + 26);
  }

  // drawn on top of the darkness: smoke hides everything, radar shows enemies through walls
  function drawGadgetsTop() {
    const me = G.me;
    for (const g of G.gadgets) {
      if (g.kind === 'smoke') {
        const grow = Math.min(1, g.age / 0.5), fade = Math.min(1, g.t / 0.8);
        for (const p of g.puffs) {
          const px = g.x + (p.x - g.x) * grow + Math.sin(G.time * 0.7 + p.ph) * 8, py = g.y + (p.y - g.y) * grow + Math.cos(G.time * 0.6 + p.ph) * 8;
          const r = p.r * grow * (1 + 0.05 * Math.sin(G.time + p.ph));
          const grd = ctx.createRadialGradient(px, py, 0, px, py, r);
          grd.addColorStop(0, `rgba(158,164,174,${0.97 * fade})`); grd.addColorStop(0.65, `rgba(150,156,166,${0.9 * fade})`); grd.addColorStop(1, 'rgba(150,156,166,0)');
          ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (g.kind === 'radar' && !hostileTo(g.owner) && me.alive) {
        let best = null, bd = Infinity;
        for (const t of targets()) { const d = Math.hypot(t.x - me.x, t.y - me.y); if (d < bd) { best = t; bd = d; } }
        if (best) {
          const an = Math.atan2(best.y - me.y, best.x - me.x), ax = me.x + Math.cos(an) * 75, ay = me.y + Math.sin(an) * 75;
          ctx.save(); ctx.translate(ax, ay); ctx.rotate(an);
          ctx.fillStyle = '#ff4d4d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-4, 0); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(`${Math.round(bd / MAP.grid)}m`, ax, ay + 26);
        }
        for (const t of targets()) {
          if (Math.hypot(t.x - g.x, t.y - g.y) > ABILITIES.radar.radius) continue;
          ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(t.x, t.y, (t.r || PLAYER.r) + 6 + Math.sin(G.time * 8) * 3, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(255,77,77,0.35)'; ctx.fill();
        }
      }
    }
  }

  // ---- ULTIMATES (from the epic crate)
  function steerBullet(b, dt) {
    // aimbot bullets turn toward the closest enemy of whoever shot them
    let best = null, bd = 900;
    const cands = b.team === 'me' ? targets()
      : [...(G.me.alive && hostileTo(b.owner) ? [G.me] : []), ...[...G.remotes.values()].filter(r => r.alive && r.id !== b.owner && (!G.teams || r.team !== teamOf(b.owner)))];
    for (const t of cands) { const d = Math.hypot(t.x - b.x, t.y - b.y); if (d < bd && lineOfSight(b.x, b.y, t.x, t.y)) { best = t; bd = d; } }
    if (!best) return;
    const sp = Math.hypot(b.vx, b.vy), cur = Math.atan2(b.vy, b.vx), want = Math.atan2(best.y - b.y, best.x - b.x);
    const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), turn = ULTIMATES.aimbot.turn * dt;
    const na = cur + clamp(diff, -turn, turn);
    b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
    b.life = Math.max(b.life, 0.3);
  }

  function useUlt() {
    const me = G.me, k = me.ult, U = ULTIMATES[k];
    me.ult = null;
    G.banner = { text: `${U.name.toUpperCase()}!`, t: 1.5 };
    G.lastCombat = G.time;
    const strikes = [];
    if (k === 'airstrike') {
      for (let i = 0; i < U.bombs; i++) {
        const d = 150 + i * U.spacing;
        strikes.push([Math.round(clamp(me.x + Math.cos(me.aim) * d, 0, MAP.w)), Math.round(clamp(me.y + Math.sin(me.aim) * d, 0, MAP.h)), +(U.delay + i * U.gap).toFixed(2), U.radius, U.damage]);
      }
    }
    if (k === 'nuke') strikes.push([Math.round(clamp(me.x + Math.cos(me.aim) * U.dist, 0, MAP.w)), Math.round(clamp(me.y + Math.sin(me.aim) * U.dist, 0, MAP.h)), U.delay, U.radius, U.damage]);
    for (const s of strikes) G.strikes.push({ x: s[0], y: s[1], t: s[2], max: s[2], r: s[3], dmg: s[4], owner: myOwnerId() });
    if (strikes.length && G.mode === 'mp') Net.send({ t: 'ult', k, s: strikes });
    if (k === 'laser') {
      const x = Math.round(me.x + Math.cos(me.aim) * 200), y = Math.round(me.y + Math.sin(me.aim) * 200), a = +me.aim.toFixed(3);
      G.lasers.push({ x, y, a, t: U.duration, tick: 0, owner: myOwnerId() });
      if (G.mode === 'mp') Net.send({ t: 'ult', k, x, y, a });
    }
    if (k === 'minigun') me.miniT = U.duration;
    if (k === 'god') me.godT = U.duration;
    if (k === 'bullethell') { me.hellT = U.duration; me.hellCd = 0; }
    if (k === 'aimbot') me.aimShots = U.shots;
    if (k === 'wallhack') me.wallT = U.duration;
    if (k === 'rockets') me.rocketT = U.duration;
    if (k === 'tracker') { me.trackT = U.duration; if (G.mode === 'mp') Net.send({ t: 'ult', k }); }
  }

  function updateUlt(dt) {
    const me = G.me;
    if (Input.take('ultPress') && me.ult && me.alive) useUlt();
    me.miniT = Math.max(0, me.miniT - dt);
    me.godT = Math.max(0, me.godT - dt);
    for (const k of ['wallT', 'rocketT', 'trackT']) me[k] = Math.max(0, me[k] - dt);
    if (me.hellT > 0) {
      const U = ULTIMATES.bullethell;
      me.hellT -= dt; me.hellCd -= dt;
      if (me.hellCd <= 0) {
        me.hellCd = U.every;
        const off = G.time * 2;
        fireBullets(me.x, me.y, Array.from({ length: U.count }, (_, i) => +(off + i * Math.PI * 2 / U.count).toFixed(4)), 1000, U.damage, 1, 700, 6 * HEAR_UNIT);
      }
    }
    for (const s of G.strikes) {
      s.t -= dt;
      if (s.t <= 0) {
        s.done = true;
        explode(s.x, s.y, s.r, s.dmg, s.owner);
        if (s.r > 300) { G.shake = 30; burst(s.x, s.y, '#ffffff', 60, 900); G.rings.push({ x: s.x, y: s.y, r: s.r * 1.3, life: 1, max: 1, color: '255,221,0' }); }
      }
    }
    G.strikes = G.strikes.filter(s => !s.done);
    const L = ULTIMATES.laser;
    for (const l of G.lasers) {
      l.t -= dt; l.tick -= dt;
      l.x = clamp(l.x + Math.cos(l.a) * L.speed * dt, 0, MAP.w); l.y = clamp(l.y + Math.sin(l.a) * L.speed * dt, 0, MAP.h);
      if (Math.random() < 0.8) burst(l.x + (Math.random() - 0.5) * L.radius, l.y + (Math.random() - 0.5) * L.radius, '#ff3df5', 1, 200);
      if (l.tick <= 0) {
        l.tick = 0.25;
        areaOf(l, L.radius, e => hurtEnemy(e, L.dps / 4, 0.3, Math.atan2(e.y - l.y, e.x - l.x)),
          () => hurtMe(L.dps / 4, 0.3, Math.atan2(me.y - l.y, me.x - l.x), l.owner));
      }
    }
    G.lasers = G.lasers.filter(l => l.t > 0);
  }

  function drawUlt() {
    const me = G.me;
    if (me.trackT > 0 && me.alive) drawEnemyArrow('#ff4d4d');
    for (const s of G.strikes) {
      const k = 1 - s.t / s.max;
      ctx.strokeStyle = `rgba(255,${s.r > 300 ? 221 : 60},0,${0.4 + 0.5 * k})`; ctx.lineWidth = s.r > 300 ? 6 : 3;
      ctx.setLineDash([14, 10]);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,${s.r > 300 ? 200 : 40},0,${0.08 + 0.2 * k})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * k, 0, Math.PI * 2); ctx.fill();
      if (s.r > 300) { // nuke countdown
        ctx.fillStyle = '#ffdd00'; ctx.font = '900 40px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('☢ ' + Math.ceil(s.t), s.x, s.y);
      }
    }
    const L = ULTIMATES.laser;
    for (const l of G.lasers) {
      const w = L.radius * (0.85 + 0.15 * Math.sin(G.time * 30));
      const grd = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, w);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.35, 'rgba(255,61,245,0.8)'); grd.addColorStop(1, 'rgba(255,61,245,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(l.x, l.y, w, 0, Math.PI * 2); ctx.fill();
    }
    if (me.godT > 0) {
      ctx.strokeStyle = `rgba(246,229,141,${0.6 + 0.3 * Math.sin(G.time * 12)})`; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(me.x, me.y, me.r + 12, 0, Math.PI * 2); ctx.stroke();
    }
    if (me.miniT > 0 || me.aimShots > 0) {
      ctx.strokeStyle = me.aimShots > 0 ? 'rgba(0,255,208,0.8)' : 'rgba(255,159,26,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(me.x, me.y, me.r + 16, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // heal zones and turrets
  function updateGadgets(dt) {
    const me = G.me, M = ABILITIES.medic, T = ABILITIES.turret;
    for (const z of G.zones) {
      z.t -= dt; z.tick -= dt; z.age += dt;
      if (z.tick <= 0) {
        z.tick = 1;
        if (me.alive && me.hp < me.maxHp && Math.hypot(me.x - z.x, me.y - z.y) <= M.radius) heal(M.perSec);
      }
    }
    G.zones = G.zones.filter(z => z.t > 0);
    for (const t of G.turrets) {
      t.t -= dt; t.cd -= dt;
      let best = null, bd = t.stats.range; // sees as far as your sidearm shoots
      for (const e of targets()) {
        const d = Math.hypot(e.x - t.x, e.y - t.y);
        if (d < bd && lineOfSight(t.x, t.y, e.x, e.y)) { best = e; bd = d; }
      }
      if (best) t.aim = Math.atan2(best.y - t.y, best.x - t.x);
      if (best && t.cd <= 0) {
        const s = t.stats;
        t.cd = Math.max(s.fireDelay, s.reloadTime / s.magSize, 0.15); // reloads built in, never runs dry
        shootFrom(t.x + Math.cos(t.aim) * 20, t.y + Math.sin(t.aim) * 20, t.aim, s);
      }
    }
    G.turrets = G.turrets.filter(t => t.t > 0);
  }

  function drawGadgets() {
    const M = ABILITIES.medic;
    for (const z of G.zones) {
      // grows in with a little overshoot when it lands, then gently pulses
      const a = Math.min(1, z.age / 0.35), pop = a < 1 ? a * (1 + 0.25 * Math.sin(a * Math.PI)) : 1;
      const r = M.radius * pop * (1 + 0.03 * Math.sin(G.time * 4));
      ctx.fillStyle = 'rgba(50,255,126,0.13)';
      ctx.strokeStyle = 'rgba(50,255,126,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(z.x, z.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // shockwave ring right after landing
      if (z.age < 0.6) {
        const k = z.age / 0.6;
        ctx.strokeStyle = `rgba(180,255,210,${1 - k})`; ctx.lineWidth = 6 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(z.x, z.y, M.radius * (0.3 + 1.1 * k), 0, Math.PI * 2); ctx.stroke();
      }
      const c = 1 + (z.age < 0.35 ? 0.6 * (1 - a) : 0);
      ctx.fillStyle = '#32ff7e';
      ctx.fillRect(z.x - 4 * c, z.y - 14 * c, 8 * c, 28 * c); ctx.fillRect(z.x - 14 * c, z.y - 4 * c, 28 * c, 8 * c);
      // little green pluses floating up
      if (Math.random() < 0.15) {
        const ang = Math.random() * Math.PI * 2, d = Math.random() * M.radius * 0.9;
        G.fx.push({ x: z.x + Math.cos(ang) * d, y: z.y + Math.sin(ang) * d, vx: 0, vy: -60, life: 0.7, max: 0.7, size: 5, color: '#7dffaa' });
      }
    }
    for (const t of G.turrets) {
      ctx.fillStyle = '#4b4b5a'; ctx.strokeStyle = '#cd84f1'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.aim);
      if (Math.cos(t.aim) < 0) ctx.scale(1, -1);
      const sp = t.sprite, k = 0.6; // your sidearm sitting on top
      ctx.drawImage(sp.canvas, sp.minX * k, sp.minY * k - 6, sp.w * k, sp.h * k);
      ctx.restore();
    }
    const me = G.me;
    if (me.invT > 0) {
      ctx.strokeStyle = `rgba(255,63,52,${0.5 + 0.4 * Math.sin(G.time * 20)})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(me.x, me.y, me.r + 10, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // where the grenade will land: the mouse on PC, a fixed distance along your aim on mobile
  function grenadeTarget() {
    const me = G.me, A = ABILITIES.grenade;
    let tx, ty;
    if (!Settings.mobile && Input.mouse.active) {
      tx = (Input.mouse.x - W / 2) / zoom + G.cam.x;
      ty = (Input.mouse.y - H / 2) / zoom + G.cam.y;
    } else {
      tx = me.x + Math.cos(me.aim) * A.range * 0.7;
      ty = me.y + Math.sin(me.aim) * A.range * 0.7;
    }
    const d = Math.hypot(tx - me.x, ty - me.y);
    if (d > A.range) { tx = me.x + (tx - me.x) / d * A.range; ty = me.y + (ty - me.y) / d * A.range; }
    return { x: clamp(tx, 0, MAP.w), y: clamp(ty, 0, MAP.h) };
  }

  function throwGrenade() {
    const me = G.me, t = grenadeTarget();
    const kind = me.ability;
    G.nades.push({ x0: me.x, y0: me.y, x1: t.x, y1: t.y, t: 0, owner: myOwnerId(), kind, a: me.aim });
    me.abCd = ABILITIES[kind].cooldown;
    me.abUses--;
    if (kind !== 'grenade') return; // heal zone / turret: only yours, nothing to tell others
    G.lastCombat = G.time;
    if (G.mode === 'mp') Net.send({ t: 'nade', x0: Math.round(me.x), y0: Math.round(me.y), x1: Math.round(t.x), y1: Math.round(t.y) });
  }

  function fireRocket() {
    const me = G.me, m = gunToWorld(me, me.guns[me.cur].sprite.muzzle);
    addRocket(m.x, m.y, me.aim, myOwnerId());
    me.abUses--;
    G.lastCombat = G.time;
    G.shake = Math.min(12, G.shake + 6);
    if (G.mode === 'mp') Net.send({ t: 'rpg', x: Math.round(m.x), y: Math.round(m.y), a: +me.aim.toFixed(4) });
  }

  function addRocket(x, y, a, owner) {
    const A = ABILITIES.rpg;
    G.rockets.push({ x, y, a, vx: Math.cos(a) * A.speed, vy: Math.sin(a) * A.speed, life: 3, owner });
  }

  // blast: hurts enemies of whoever caused it. skip = the one already hit directly
  function explode(x, y, radius, dmg, owner, skip) {
    burst(x, y, '#ff9f43', 30, 380);
    burst(x, y, '#ffd36b', 16, 220);
    G.fx.push({ x, y, vx: 0, vy: 0, life: 0.25, max: 0.25, size: radius * 1.6, color: 'rgba(255,170,60,0.5)' });
    const me = G.me, d = Math.hypot(me.x - x, me.y - y);
    G.shake = Math.min(14, G.shake + Math.max(0, 12 - d / 60));
    if (!isMine(owner)) hear(x, y, 12 * HEAR_UNIT);
    if (isMine(owner) && G.mode === 'sp') {
      for (const e of [...G.enemies]) {
        if (e === skip || Math.hypot(e.x - x, e.y - y) > radius + e.r) continue;
        hitEnemy(e, { dmg, falloff: 0, kb: 5, x: e.x, y: e.y, ox: e.x, oy: e.y, range: 1 }, Math.atan2(e.y - y, e.x - x));
      }
    } else if (skip !== 'me' && me.alive && hostileTo(owner) && d <= radius + me.r) {
      hurtMe(dmg, 6, Math.atan2(me.y - y, me.x - x), owner);
    }
  }

  function updateProjectiles(dt) {
    const G_ = ABILITIES.grenade, R = ABILITIES.rpg, me = G.me;
    for (const n of G.nades) {
      n.t += dt;
      if (n.t < G_.flight) continue;
      n.done = true;
      if (n.kind === 'medic') {
        G.zones.push({ x: n.x1, y: n.y1, t: ABILITIES.medic.duration, tick: 1, age: 0 });
        // landing effect: green splash + sparkles
        burst(n.x1, n.y1, '#32ff7e', 26, 320);
        burst(n.x1, n.y1, '#eafff1', 10, 180);
        G.fx.push({ x: n.x1, y: n.y1, vx: 0, vy: 0, life: 0.2, max: 0.2, size: ABILITIES.medic.radius * 1.2, color: 'rgba(50,255,126,0.35)' });
      }
      else if (n.kind === 'turret') {
        // the turret gets a copy of your sidearm
        const side = me.guns[1];
        G.turrets.push({ x: n.x1, y: n.y1, t: ABILITIES.turret.duration, cd: 0.5, aim: 0, stats: side.stats, sprite: side.sprite });
      } else if (ABILITIES[n.kind] && ABILITIES[n.kind].gadget) landGadget(n);
      else explode(n.x1, n.y1, G_.radius, G_.damage, n.owner);
    }
    G.nades = G.nades.filter(n => !n.done);

    for (const r of G.rockets) {
      const x1 = r.x, y1 = r.y;
      r.x += r.vx * dt; r.y += r.vy * dt; r.life -= dt;
      if (Math.random() < 0.8) G.fx.push({ x: x1, y: y1, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.35, max: 0.35, size: 6, color: '#bbb' });
      const blocked = r.life <= 0 || r.x < 0 || r.y < 0 || r.x > MAP.w || r.y > MAP.h || MAP.walls.some(w => segmentHitsRect(x1, y1, r.x, r.y, w));
      if (blocked) { r.done = true; explode(x1, y1, R.radius, R.damage, r.owner); continue; }
      // direct hits
      if (isMine(r.owner)) {
        if (G.mode === 'sp') {
          const e = G.enemies.find(e => segHitsCircle(x1, y1, r.x, r.y, e.x, e.y, e.r));
          if (e) {
            r.done = true;
            hitEnemy(e, { dmg: R.direct, falloff: 0, kb: 8, x: e.x, y: e.y, ox: e.x, oy: e.y, range: 1 }, r.a);
            explode(r.x, r.y, R.radius, R.damage, r.owner, e);
          }
        } else {
          const hit = [...G.remotes.values()].find(o => o.alive && isEnemy(o) && segHitsCircle(x1, y1, r.x, r.y, o.x, o.y, PLAYER.r));
          if (hit) { r.done = true; explode(r.x, r.y, R.radius, R.damage, r.owner); }
        }
      } else {
        if (me.alive && hostileTo(r.owner) && segHitsCircle(x1, y1, r.x, r.y, me.x, me.y, me.r)) {
          r.done = true;
          hurtMe(R.direct, 8, r.a, r.owner);
          explode(r.x, r.y, R.radius, R.damage, r.owner, 'me');
          continue;
        }
        const hit = [...G.remotes.values()].find(o => o.alive && o.id !== r.owner && segHitsCircle(x1, y1, r.x, r.y, o.x, o.y, PLAYER.r));
        if (hit) { r.done = true; explode(r.x, r.y, R.radius, R.damage, r.owner); }
      }
    }
    G.rockets = G.rockets.filter(r => !r.done);
  }

  function drawProjectiles() {
    const A = ABILITIES.grenade;
    for (const n of G.nades) {
      const look = n.kind === 'medic' ? ['#32ff7e', '#0b5a2a', 'rgba(50,255,126,', ABILITIES.medic.radius]
                 : n.kind === 'turret' ? ['#cd84f1', '#4b2a5a', 'rgba(205,132,241,', 22]
                 : ['#4b7b2f', '#1d3311', 'rgba(255,80,60,', A.radius];
      const k = Math.min(1, n.t / A.flight), x = n.x0 + (n.x1 - n.x0) * k, y = n.y0 + (n.y1 - n.y0) * k;
      const h = 4 * 110 * k * (1 - k); // height of the arc
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look[0]; ctx.strokeStyle = look[1]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - h, 8 + h / 40, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // landing warning
      ctx.strokeStyle = `${look[2]}${0.25 + 0.5 * k})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.x1, n.y1, look[3], 0, Math.PI * 2); ctx.stroke();
    }
    for (const r of G.rockets) {
      ctx.save();
      ctx.translate(r.x, r.y); ctx.rotate(r.a);
      ctx.fillStyle = '#5d6d4e'; ctx.fillRect(-16, -5, 26, 10);
      ctx.fillStyle = '#e17055'; ctx.beginPath(); ctx.moveTo(10, -5); ctx.lineTo(18, 0); ctx.lineTo(10, 5); ctx.fill();
      ctx.fillStyle = '#ffb142'; ctx.fillRect(-22, -3, 6, 6);
      ctx.restore();
    }
  }

  // white path preview while holding the ability button
  function drawAbilityAim(me) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 10]);
    if (me.ability !== 'rpg') { // thrown: grenade, heal zone, turret
      const t = grenadeTarget(), mx = (me.x + t.x) / 2, my = (me.y + t.y) / 2, d = Math.hypot(t.x - me.x, t.y - me.y);
      // bend the line sideways so it reads as an arc over walls
      const nx = -(t.y - me.y) / (d || 1), ny = (t.x - me.x) / (d || 1), bend = d * 0.25 * (Math.cos(me.aim) < 0 ? 1 : -1);
      ctx.beginPath();
      ctx.moveTo(me.x, me.y);
      ctx.quadraticCurveTo(mx + nx * bend, my + ny * bend, t.x, t.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const AA = ABILITIES[me.ability], rad = me.ability === 'radar' ? 40 : me.ability === 'barrier' ? AA.len / 2 : AA.radius || 22;
      ctx.beginPath(); ctx.arc(t.x, t.y, rad, 0, Math.PI * 2); ctx.stroke();
    } else {
      // rocket: straight line until the first wall
      let len = 1400;
      for (let s = 20; s < 1400; s += 20) {
        if (pointInWall(me.x + Math.cos(me.aim) * s, me.y + Math.sin(me.aim) * s)) { len = s; break; }
      }
      ctx.beginPath();
      ctx.moveTo(me.x, me.y);
      ctx.lineTo(me.x + Math.cos(me.aim) * len, me.y + Math.sin(me.aim) * len);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(me.x + Math.cos(me.aim) * len, me.y + Math.sin(me.aim) * len, ABILITIES.rpg.radius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
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
        if (Math.random() < ABILITY_CRATE.chance) fresh.push({ ...randomFloorSpot(), kind: 'ability' });
        if (Math.random() < EPIC_CRATE.chance) fresh.push({ ...randomFloorSpot(), kind: 'epic' });
        addPacks(fresh);
        if (G.mode === 'mp') Net.send({ t: 'packs', packs: fresh });
      }
    }
    if (!me.alive) return;
    for (const p of G.packs) {
      if (Math.hypot(p.x - me.x, p.y - me.y) > me.r + HEALTH_PACK.r) continue;
      if (p.kind === 'ammo') {
        // main gun first; the sidearm too if it needs ammo (the flare gun only once the main gun is full)
        // counts the loaded mag too, so a box still helps while you're reloading or your mag is empty
        const room = gn => gn.stats.magSize + gn.stats.maxReserve - gn.ammo - gn.reserve;
        const wants = gn => room(gn) > 0 && gn.stats.boxRefill > 0;
        const [main, side] = me.guns;
        const needs = [];
        if (wants(main)) needs.push(main);
        if (wants(side) && !(side.stats.flare && needs.length)) needs.push(side);
        if (!needs.length) continue;
        for (const gn of needs) gn.reserve += Math.min(room(gn), gn.stats.boxRefill);
        G.texts.push({ x: me.x, y: me.y - 34, text: '+AMMO', color: '#ffd23f', life: 0.9 });
        updateWeaponBar(true);
      } else if (p.kind === 'epic') {
        if (me.ult) continue; // already holding one
        const keys = Object.keys(ULTIMATES);
        me.ult = keys[Math.floor(Math.random() * keys.length)];
        G.banner = { text: `ULTIMATE: ${ULTIMATES[me.ult].name}! (${Settings.mobile ? 'gold button' : 'press F'})`, t: 3 };
        burst(me.x, me.y, '#ffd700', 40, 400);
      } else if (p.kind === 'ability') {
        // rare red crate: all ability uses back and no cooldown
        const A = ABILITIES[me.ability];
        const full = !A || A.type === 'passive' || (me.abUses >= (A.uses ?? Infinity) && me.abCd === 0);
        if (full) continue;
        me.abUses = A.uses ?? Infinity;
        me.abCd = 0;
        G.texts.push({ x: me.x, y: me.y - 34, text: 'ABILITY RESTORED', color: '#ff5d5d', life: 1.2 });
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

  function drawEpicCrate(p) {
    const s = 24, t = performance.now() / 1000;
    ctx.save();
    // golden rays
    ctx.translate(p.x, p.y);
    ctx.rotate(t * 0.8);
    ctx.fillStyle = 'rgba(255,215,0,0.25)';
    for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(70, -10); ctx.lineTo(70, 10); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = `rgba(255,215,0,${0.3 + 0.2 * Math.sin(t * 5)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, s * 1.9, 0, Math.PI * 2); ctx.fill();
    const grd = ctx.createLinearGradient(p.x - s, p.y - s, p.x + s, p.y + s);
    grd.addColorStop(0, '#fff3a0'); grd.addColorStop(0.5, '#ffc300'); grd.addColorStop(1, '#b8860b');
    ctx.fillStyle = grd; ctx.strokeStyle = '#5c3b00'; ctx.lineWidth = 3;
    ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2); ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
    ctx.fillStyle = '#7a00ff'; ctx.fillRect(p.x - s, p.y - 4, s * 2, 8); ctx.fillRect(p.x - 4, p.y - s, 8, s * 2);
    ctx.fillStyle = '#fff'; ctx.font = '900 20px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', p.x, p.y + 1);
    ctx.font = '900 11px system-ui, sans-serif'; ctx.fillStyle = '#ffd700';
    ctx.fillText('EPIC', p.x, p.y - s - 12);
  }

  function drawAbilityCrate(p) {
    const s = 20, glow = 0.25 + 0.15 * Math.sin(performance.now() / 200);
    ctx.fillStyle = `rgba(255,40,40,${glow})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, s * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c0392b'; ctx.strokeStyle = '#4a0d07'; ctx.lineWidth = 3;
    ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
    ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
    ctx.strokeStyle = '#ff8a7a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s); ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '900 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', p.x, p.y + 1);
  }

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
      if (p.kind === 'ability') { drawAbilityCrate(p); continue; }
      if (p.kind === 'epic') { drawEpicCrate(p); continue; }
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
    // the boss only spawns where a 2-wide route leads to you
    const big = def.r > MAP.grid * 0.45;
    if (big) { flowT = 0; updateFlow(0); }
    for (let i = 0; i < 200; i++) {
      x = def.r + Math.random() * (MAP.w - def.r * 2);
      y = def.r + Math.random() * (MAP.h - def.r * 2);
      const c = { x, y, r: def.r };
      collideWorld(c);
      x = c.x; y = c.y;
      if (Math.hypot(x - me.x, y - me.y) <= 650) continue;
      if (!big) break;
      const C = MAP.grid, gx = Math.floor((x - C / 2) / C), gy = Math.floor((y - C / 2) / C);
      if (gx >= 0 && gy >= 0 && flowBig[gy * MAP.cols + gx] >= 0) { x = (gx + 1) * C; y = (gy + 1) * C; break; }
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

  // ---- pathfinding: a distance map from the player over the grid (refreshed a few times a second)
  // Two maps: one for normal enemies (1 square wide gaps) and one for big ones like the boss,
  // which only walk where there's a 2x2 square of open floor.
  let flow = null, flowBig = null, flowT = 0;
  function bfs(walkable, starts) {
    const cols = MAP.cols, n = cols * cols, dist = new Int32Array(n).fill(-1), q = new Int32Array(n);
    let head = 0, tail = 0;
    for (const i of starts) if (walkable(i % cols, (i - i % cols) / cols) && dist[i] < 0) { dist[i] = 0; q[tail++] = i; }
    while (head < tail) {
      const i = q[head++], x = i % cols, y = (i - x) / cols;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * cols + nx;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= cols || dist[j] !== -1 || !walkable(nx, ny)) continue;
        dist[j] = dist[i] + 1;
        q[tail++] = j;
      }
    }
    return dist;
  }
  function updateFlow(dt) {
    flowT -= dt;
    if (flow && flowT > 0) return;
    flowT = 0.25;
    const C = MAP.grid, cols = MAP.cols;
    const open = (x, y) => x >= 0 && y >= 0 && x < cols && y < cols && !MAP.solid[y * cols + x];
    const sx = clamp(Math.floor(G.me.x / C), 0, cols - 1), sy = clamp(Math.floor(G.me.y / C), 0, cols - 1);
    flow = bfs(open, [sy * cols + sx]);
    // big: (x, y) is the top-left of a 2x2 block that must be all open
    const open2 = (x, y) => open(x, y) && open(x + 1, y) && open(x, y + 1) && open(x + 1, y + 1);
    const starts = [];
    for (let y = sy - 1; y <= sy; y++) for (let x = sx - 1; x <= sx; x++) if (x >= 0 && y >= 0) starts.push(y * cols + x);
    flowBig = bfs(open2, starts);
  }
  // the next spot on the way to the player (no cutting corners)
  function pathStep(e, forceSmall) {
    if (!flow) return null;
    const C = MAP.grid, cols = MAP.cols, big = e.r > C * 0.45 && !forceSmall;
    const f = big ? flowBig : flow;
    // big enemies are tracked by the top-left square of their 2x2 block
    const x = clamp(Math.floor((big ? e.x - C / 2 : e.x) / C), 0, cols - 1), y = clamp(Math.floor((big ? e.y - C / 2 : e.y) / C), 0, cols - 1);
    const free = (a, b) => a >= 0 && b >= 0 && a < cols && b < cols && f[b * cols + a] >= 0;
    let best = null, bd = free(x, y) ? f[y * cols + x] : Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || !free(x + dx, y + dy)) continue;
      if (dx && dy && (!free(x + dx, y) || !free(x, y + dy))) continue;
      const v = f[(y + dy) * cols + x + dx] + (dx && dy ? 0.4 : 0);
      if (v < bd) { bd = v; best = { x: (x + dx + (big ? 1 : 0.5)) * C, y: (y + dy + (big ? 1 : 0.5)) * C }; }
    }
    // a big enemy cut off from every 2-wide route squeezes through the narrow path instead
    if (!best && big) return pathStep(e, true);
    return best;
  }

  function updateEnemies(dt) {
    const me = G.me, list = G.enemies;
    updateFlow(dt);
    const decoy = myDecoy();
    for (const e of list) {
      if (e.frozen > 0) { e.flash = 0; continue; } // frozen solid
      // go for whoever is closer: you or your buddy
      const tgt = decoy && Math.hypot(decoy.x - e.x, decoy.y - e.y) < Math.hypot(me.x - e.x, me.y - e.y) ? decoy : me;
      if (decoy && (e.botCd = Math.max(0, (e.botCd || 0) - dt)) === 0 && Math.hypot(decoy.x - e.x, decoy.y - e.y) < e.r + PLAYER.r) { damageGadget(decoy, e.def.melee); e.botCd = 0.6; }
      const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.hypot(dx, dy) || 1;
      const sees = lineOfSight(e.x, e.y, tgt.x, tgt.y) && !smokeBlocks(e.x, e.y, tgt.x, tgt.y);
      let mx = dx / d, my = dy / d;
      if (!me.alive) { mx = my = 0; }
      else if (e.def.keepDistance && sees && d < e.def.keepDistance) { mx *= -0.6; my *= -0.6; }
      else if (!sees || (e.r > MAP.grid * 0.45 && d > 250)) { // follow the path around the walls toward you (the boss always does)
        const step = pathStep(e);
        if (step) { const l = Math.hypot(step.x - e.x, step.y - e.y) || 1; mx = (step.x - e.x) / l; my = (step.y - e.y) / l; }
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
      if (me.alive && Math.hypot(me.x - e.x, me.y - e.y) < e.r + me.r && me.meleeInv === 0) {
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
    if (b.team === 'me') vampire();
    e.hp -= dmg;
    e.flash = 0.08;
    const weight = e.r / 16;
    e.kx += Math.cos(a) * b.kb * 50 / weight;
    e.ky += Math.sin(a) * b.kb * 50 / weight;
    G.texts.push({ x: e.x + (Math.random() - 0.5) * 16, y: e.y - e.r, text: Math.round(dmg), color: '#fff', life: 0.5 });
    burst(b.x, b.y, e.def.color, 3, 120);
    if (e.hp > 0) return;
    G.kills++;
    onKill();
    G.score += e.def.score;
    burst(e.x, e.y, e.def.color, e.type === 'boss' ? 60 : 14, e.type === 'boss' ? 500 : 260);
    G.enemies = G.enemies.filter(x => x !== e);
    if (e === G.boss) {
      G.boss = null;
      // beating a boss gives your ability back
      const A = ABILITIES[G.me.ability];
      if (A && A.type !== 'passive') { G.me.abUses = A.uses ?? Infinity; G.me.abCd = 0; }
      G.banner = { text: 'Boss defeated! Ability restored', t: 2.5 };
      updateWeaponBar(true);
    }
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
    Object.assign(r, { tx: m.x, ty: m.y, aim: m.aim, hp: m.hp, sh: m.sh || 0, gun: m.gun });
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
    for (const a of angles) addBullet(m.x, m.y, a, m.sp || BULLET_SPEED, m.dmg, m.kb, 'r', m.from, m.rng || BULLET_RANGE, m.fo || 0, !!m.fl, m.bt);
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
    if (m.by === G.myId) onKill();
  });
  Net.on('gad', m => {
    if (!inMP()) return;
    const sprite = m.k === 'decoy' && m.b ? renderGunSprite('main', m.b) : null;
    addGadget({ kind: m.k, x: m.x, y: m.y, a: m.a, owner: m.from, id: m.id, color: m.c, name: m.n, sprite });
  });
  Net.on('gadx', m => {
    if (!inMP()) return;
    const g = G.gadgets.find(g => g.id === m.id);
    if (!g) return;
    if (g.kind === 'mine') mineBoom(g);
    else { burst(g.x, g.y, ABILITIES[g.kind].color, 24, 300); removeGadget(g); }
  });
  Net.on('gadm', m => {
    if (!inMP()) return;
    const g = G.gadgets.find(g => g.id === m.id);
    if (g) { g.x = m.x; g.y = m.y; g.aim = m.a; g.hp = m.hp; }
  });
  Net.on('ult', m => {
    if (!inMP()) return;
    if (m.k === 'tracker') { if (!hostileTo(m.from)) { G.me.trackT = ULTIMATES.tracker.duration; G.banner = { text: 'Teammate used Tracker!', t: 1.5 }; } }
    else if (m.k === 'laser') G.lasers.push({ x: m.x, y: m.y, a: m.a, t: ULTIMATES.laser.duration, tick: 0, owner: m.from });
    else for (const s of m.s) G.strikes.push({ x: s[0], y: s[1], t: s[2], max: s[2], r: s[3], dmg: s[4], owner: m.from });
  });
  Net.on('aoe', m => { if (inMP()) slam(m.x, m.y, m.r, m.dmg, m.kb, m.from); });
  Net.on('nade', m => { if (inMP()) G.nades.push({ x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, t: 0, owner: m.from }); });
  Net.on('rpg', m => { if (inMP()) addRocket(m.x, m.y, m.a, m.from); });
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
    ctx.fillStyle = theme().bg;
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
    drawGadgetList();
    drawUlt();
    drawGadgets();
    drawProjectiles();
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    for (const b of G.bullets) {
      ctx.strokeStyle = b.flare ? '#ff7b00' : b.bounce || b.boom || b.pierce ? (b.boom ? '#ff7675' : b.pierce ? '#dfe6e9' : '#a29bfe') : b.team === 'me' ? '#ffe9a8' : '#ff8a7a';
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
      if (r.sh > 0) drawBar(r.x, r.y - PLAYER.r - 14, 54, 7, r.sh / ABILITIES.shield.hp, false, '#3b82f6');
      else drawBar(r.x, r.y - PLAYER.r - 14, 54, 7, r.hp / PLAYER.hp);
      nameTag(r.name, r.x, r.y - PLAYER.r - 20, isEnemy(r) ? '#ff5050' : '#4aa3ff');
    }

    ctx.restore();

    if (me.alive) {
      const gun = me.guns[me.cur];
      // aim area: on mobile while aiming (it auto-shoots there); on PC always shown, but you shoot yourself
      if (me.abAiming) drawAbilityAim(me);
      else if (Settings.mobile ? Input.sticks.aim : Input.mouse.active) drawAimLine(me);
      drawPlayer(me, me.color, gun.sprite, false, me.meleeInv > 0 && Math.floor(me.meleeInv * 20) % 2);
      // health bar right above you — the middle of the screen
      if (me.shield > 0) drawBar(me.x, me.y - me.r - 16, 64, 9, me.shield / ABILITIES.shield.hp, true, '#3b82f6');
      else drawBar(me.x, me.y - me.r - 16, 64, 9, me.hp / me.maxHp, true);
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
    ctx.fillStyle = theme().shadow;
    ctx.fill('evenodd');
    drawGadgetsTop();
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

  // colours for the arena in dark / light mode
  const THEMES = {
    dark:  { bg: '#0e1014', floor: '#1a1e25', grid: '#222732', wall: '#323946', wallTop: '#3e4757', wallLine: '#151920', border: '#3d4555', shadow: 'rgba(5,7,10,0.72)' },
    light: { bg: '#dfe4ec', floor: '#eef1f6', grid: '#dde2ea', wall: '#7b8494', wallTop: '#959eae', wallLine: '#4b5261', border: '#8a93a3', shadow: 'rgba(120,130,150,0.55)' },
  };
  const theme = () => THEMES[Settings.light ? 'light' : 'dark'];

  function drawFloor() {
    const T = theme();
    const hw = W / 2 / zoom + 20, hh = H / 2 / zoom + 20;
    const x0 = Math.max(0, G.cam.x - hw), x1 = Math.min(MAP.w, G.cam.x + hw);
    const y0 = Math.max(0, G.cam.y - hh), y1 = Math.min(MAP.h, G.cam.y + hh);
    ctx.fillStyle = T.floor;
    ctx.fillRect(0, 0, MAP.w, MAP.h);
    ctx.strokeStyle = T.grid;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const S = MAP.grid;
    for (let x = Math.ceil(x0 / S) * S; x <= x1; x += S) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.ceil(y0 / S) * S; y <= y1; y += S) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    for (const [x, y, w, h] of MAP.walls) {
      ctx.fillStyle = T.wall;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = T.wallTop;
      ctx.fillRect(x, y, w, 8);
      ctx.strokeStyle = T.wallLine;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.strokeStyle = T.border;
    ctx.lineWidth = 10;
    ctx.strokeRect(-5, -5, MAP.w + 10, MAP.h + 10);
  }

  function drawBar(x, y, w, h, frac, mine, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color || (mine ? '#ff2e2e' : '#e05a5a');
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
    // light mode: give white HUD text a dark glow so it stays readable
    ctx.save();
    if (Settings.light) { ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 4; }
    drawHudInner();
    ctx.restore();
  }
  function drawHudInner() {
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
      ctx.fillStyle = '#ff8a8a';
      ctx.fillText(`ENEMIES LEFT ${G.enemies.length + G.queue.length}`, pad, pad + 40);
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
    updateAbilityBtn();
    if (!force && key === barCache) return;
    barCache = key;
    me.guns.forEach((g, i) => {
      const btn = el('gun' + i);
      btn.classList.toggle('active', i === me.cur);
      btn.querySelector('.ammo').textContent = g.reload > 0 ? `Reloading ${g.reload.toFixed(1)}s`
        : g.ammo === 0 && g.reserve === 0 ? 'OUT OF AMMO' : `${g.ammo} | ${g.reserve}`;
    });
  }
  let abCache = '';
  function updateAbilityBtn() {
    const ub = el('ultBtn'), U = G.me.ult && ULTIMATES[G.me.ult];
    ub.classList.toggle('hidden', !U);
    if (U && ub.dataset.k !== G.me.ult) { ub.dataset.k = G.me.ult; ub.querySelector('.ult-name').textContent = U.name; }
    if (!U) ub.dataset.k = '';
    const me = G.me, A = ABILITIES[me.ability], btn = el('abilityBtn');
    if (!A) { btn.classList.add('hidden'); return; }
    const state = A.type === 'passive' ? 'Passive'
      : me.abUses <= 0 ? 'Used'
      : me.shieldT > 0 ? `${Math.ceil(me.shieldT)}s`
      : me.rapidT > 0 ? `${Math.ceil(me.rapidT)}s`
      : me.slowT > 0 ? `${Math.ceil(me.slowT)}s`
      : me.phaseT > 0 ? `${Math.ceil(me.phaseT)}s`
      : me.reflectT > 0 ? `${Math.ceil(me.reflectT)}s`
      : me.abCd > 0 ? `${Math.ceil(me.abCd)}s`
      : me.abUses === Infinity ? 'Ready' : `Ready ×${me.abUses}`;
    const key = A.name + state;
    if (key === abCache) return;
    abCache = key;
    btn.classList.remove('hidden');
    btn.classList.toggle('passive', A.type === 'passive');
    btn.classList.toggle('cooling', A.type !== 'passive' && !state.startsWith('Ready'));
    btn.querySelector('.ab-name').textContent = A.name;
    btn.querySelector('.ab-state').textContent = state;
  }

  el('gun0').addEventListener('click', () => G && switchGun(0));
  el('gun1').addEventListener('click', () => G && switchGun(1));
  el('reloadBtn').addEventListener('pointerdown', e => { e.preventDefault(); Input.flags.reload = true; });

  function pause() { if (G) { if (G.mode === 'sp') G.paused = true; Input.reset(); } }
  function resume() { if (G) { G.paused = false; last = performance.now(); } }

  return {
    startSP, startMP, stop, pause, resume, applyLoadout, spawnEpic,
    get test() { return !!(G && G.test); },
    get running() { return !!G; },
    get mode() { return G && G.mode; },
    get debugState() { return G; },
    on(name, fn) { hooks[name] = fn; },
  };
})();
