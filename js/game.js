// The round itself: single player (waves + boss) or multiplayer (last one standing).
const Game = (() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const VIEW = 820;        // world units visible across the screen's short side
  const GUN_SCALE = 0.55;  // gun units -> world units
  const el = id => document.getElementById(id);

  let W = 0, H = 0, DPR = 1, zoom = 1;
  let G = null, raf = 0, last = 0;
  const hooks = { spOver: () => {}, myDeath: () => {}, bossDown: () => {} };

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

  // second ability slot (C on PC). Its state gets swapped into `me` while it runs, so all the ability code works for both.
  const SLOT_KEYS = ['ability', 'abCd', 'abUses', 'abWasHeld', 'abAiming', 'refillT'];
  function newSlot(ability) {
    return { ability: ABILITIES[ability] ? ability : null, abCd: 0, abUses: (ABILITIES[ability] || {}).uses ?? Infinity, abWasHeld: false, abAiming: false, refillT: undefined };
  }
  // slot = 'alt' (2nd ability), 'alt3' (3rd, wave 20) or 'alt4' (4th, wave 30)
  function swapAlt(slot = 'alt') {
    const me = G.me;
    for (const k of SLOT_KEYS) { const v = me[k]; me[k] = me[slot][k]; me[slot][k] = v; }
  }
  // is this ability equipped in any slot? (passives work from all of them)
  const hasAb = id => G.me.ability === id || G.me.alt.ability === id || G.me.alt3.ability === id || G.me.alt4.ability === id;
  const slot3Wave = () => (myClass() || {}).id === 'engineer' ? CLASSES.engineerSlot3 : SLOT3_WAVE;
  const slot3Open = () => G.mode === 'sp' && (G.test || G.wave >= slot3Wave());
  const slot4Open = () => G.mode === 'sp' && (G.test || G.wave >= SLOT4_WAVE);
  const allSlots = () => [G.me, G.me.alt, G.me.alt3, G.me.alt4];
  // CLASSES: only one section's abilities in slots 1-3 -> slot 4 is the class ability (from CLASSES.unlockWave in SP)
  const myClass = () => classOf(Account.user.loadout);
  const classOpen = () => G.mode !== 'sp' || G.test || G.wave >= CLASSES.unlockWave;
  function slot4Pick() {
    const c = myClass();
    if (c) return classOpen() ? c.ab : null;
    return slot4Open() ? Account.user.loadout.ability4 : null;
  }
  // ENGINEER building levels: each level = less time between shots
  const lvlRate = b => b.lvl > 1 ? 1 / (1 - ABILITIES.cls_upgrade.delayCut * (b.lvl - 1)) : 1;

  function newState(mode, spawn, color) {
    const L = Account.user.loadout;
    return {
      mode, paused: false,
      me: {
        x: spawn[0], y: spawn[1], r: PLAYER.r, hp: PLAYER.hp, maxHp: PLAYER.hp, aim: 0, vx: 0, vy: 0,
        kick: 0, meleeInv: 0, alive: true, color, name: Account.user.name,
        ability: L.ability, abCd: 0, abUses: (ABILITIES[L.ability] || {}).uses ?? Infinity,
        alt: newSlot(L.ability2), alt3: newSlot(null), alt4: newSlot(null),
        abWasHeld: false, abAiming: false, shield: 0, shieldT: 0, regenTicks: 0, speedT: 0, rapidT: 0, slowT: 0, invT: 0, lastStand: false,
        ult: null, stimT: 0, frenzyT: 0, stormN: 0, stormT: 0, fountT: 0, juggT: 0, overT: 0, wallT: 0, rocketT: 0, trackT: 0, miniT: 0, godT: 0, hellT: 0, hellCd: 0, aimShots: 0,
        frozenT: 0, airT: 0, airA: 0, phaseT: 0, reflectT: 0, overShots: 0, recall: null, grapple: null, padCd: 0, thornCd: 0,
        guns: [makeGun('main', allowedBuild('main', L.main)), makeGun('secondary', allowedBuild('secondary', L.secondary))], cur: 0,
      },
      bullets: [], fx: [], texts: [], hears: [], feed: [],
      enemies: [], remotes: new Map(),
      cam: { x: spawn[0], y: spawn[1] }, shake: 0, hurt: 0, banner: null,
      wave: 0, phase: 'break', breakT: 1.5, queue: [], spawnT: 0, score: 0, kills: 0, boss: null,
      turrets: [], zones: [], gadgets: [], rings: [], healShots: [], strikes: [], lasers: [], blooms: [], debris: [],
      sendT: 0, packs: [], packT: 0, nades: [], rockets: [], time: 0, lastCombat: 0, pingT: PING.every, ping: 0,
    };
  }

  // Bandolier passive: extra spare mags (and room for them)
  // ability boosts: change this ability's numbers (for you) while it's equipped
  const ABILITY_BASE = structuredClone(ABILITIES); // (structuredClone keeps Infinity)
  function applyPerk(me) {
    for (const k in ABILITIES) Object.assign(ABILITIES[k], structuredClone(ABILITY_BASE[k]));
    const L = Account.user.loadout;
    for (const [ab, pid] of [[me.ability, L.perk], [me.alt.ability, L.perk2], [me.alt3.ability, L.perk3], [me.alt4.ability, L.perk4]]) {
      const perk = (ABILITY_PERKS[ab] || []).find(p => p.id === pid), A = ABILITIES[ab];
      if (!perk || !A) continue;
      for (const k in perk.add || {}) A[k] = (A[k] || 0) + perk.add[k];
      for (const k in perk.mul || {}) A[k] *= perk.mul[k];
    }
    me.abUses = (ABILITIES[me.ability] || {}).uses ?? Infinity;
    // passive combos: both equipped -> their numbers go up
    me.synergies = [];
    for (const c of COMBOS) {
      if (!c.syn || !hasAb(c.a) || !hasAb(c.b)) continue;
      me.synergies.push(c.name);
      for (const ab in c.syn) {
        const A = ABILITIES[ab], m = c.syn[ab];
        for (const k in m.add || {}) A[k] = (A[k] || 0) + m.add[k];
        for (const k in m.mul || {}) A[k] *= m.mul[k];
      }
    }
    me.abUses = (ABILITIES[me.ability] || {}).uses ?? Infinity;
    me.alt.abUses = (ABILITIES[me.alt.ability] || {}).uses ?? Infinity;
    me.alt3.abUses = (ABILITIES[me.alt3.ability] || {}).uses ?? Infinity;
    me.alt4.abUses = (ABILITIES[me.alt4.ability] || {}).uses ?? Infinity;
  }

  function applyBandolier(me) {
    applyPerk(me);
    me.maxHp = hasAb('glass') ? ABILITIES.glass.hp : PLAYER.hp;
    me.hp = Math.min(me.hp, me.maxHp);
    if (!hasAb('bandolier') || me.guns.bandolier) return;
    me.guns.bandolier = true;
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

  // after a boss: swap abilities only (guns, ammo and health stay as they are)
  function applyAbilities() {
    if (!G) return;
    const me = G.me, L = Account.user.loadout;
    me.ability = L.ability; me.abCd = 0; me.abWasHeld = me.abAiming = false;
    me.alt = newSlot(L.ability2);
    me.alt3 = newSlot(slot3Open() ? L.ability3 : null);
    me.alt4 = newSlot(slot4Pick());
    applyBandolier(me);
    abCache = abCache2 = abCache3 = abCache4 = '';
    updateWeaponBar(true);
  }

  function applyLoadout() {
    if (!G) return;
    const me = G.me, L = Account.user.loadout;
    me.guns = [makeGun('main', allowedBuild('main', L.main)), makeGun('secondary', allowedBuild('secondary', L.secondary))];
    me.cur = 0;
    me.ability = L.ability;
    me.abCd = 0; me.abUses = (ABILITIES[L.ability] || {}).uses ?? Infinity;
    me.alt = newSlot(L.ability2); abCache2 = '';
    me.alt3 = newSlot(slot3Open() ? L.ability3 : null); abCache3 = '';
    me.alt4 = newSlot(slot4Pick()); abCache4 = '';
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
    if (slot3Open()) G.me.alt3 = newSlot(Account.user.loadout.ability3);
    if (slot4Pick()) G.me.alt4 = newSlot(slot4Pick());
    applyBandolier(G.me);
    if (G.me.synergies.length) G.banner = { text: `COMBO: ${G.me.synergies.join(' + ').toUpperCase()}`, t: 2.5 };
    const cl = myClass();
    if (cl) G.banner = { text: `${cl.name.toUpperCase()} CLASS`, t: 2.5 };
    Input.reset();
    abCache = abCache2 = abCache3 = abCache4 = '';
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
    assignTeam(dt);
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
    updateJuice(dt);
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
    const speed = PLAYER.speed * (me.speedT > 0 ? ABILITIES.energy.speed : 1) * (hasAb('sprinter') ? ABILITIES.sprinter.speed : 1)
      * (adrenalineOn() ? ABILITIES.adrenaline.speed : 1) * (me.frozenT > 0 ? 0.2 : 1) * (me.godT > 0 ? ULTIMATES.god.speed : 1)
      * (me.stimT > 0 ? ABILITIES.stim.speed : 1) * (me.frenzyT > 0 ? ULTIMATES.frenzy.speed : 1);
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
    const abAim = me.abAiming || me.alt.abAiming || me.alt3.abAiming || me.alt4.abAiming;
    let fire = aim.fire && !abAim;
    if (Settings.mobile) {
      // Brawl Stars style: hold the aim stick and it fires by itself when an enemy is in your sights
      fire = aim.aiming && !abAim && targetInSights(me.aim);
      const tp = Input.flags.tapAt;
      if (tp) {
        Input.flags.tapAt = null;
        const here = buildingsInCell((tp.x - W / 2) / zoom + G.cam.x, (tp.y - H / 2) / zoom + G.cam.y).filter(h => h.kind === 'turret' || isMine(h.o.owner));
        if (here.length) G.selBld = here[0].o;
      }
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
    if (me.miniT > 0 || me.rocketT > 0 || me.clockT > 0) { gun.reload = 0; gun.ammo = Math.max(gun.ammo, 1); }
    if (fire && gun.reload === 0 && gun.ammo > 0 && gun.cd === 0) {
      shoot(gun);
      gun.cd = s.fireDelay * (me.rapidT > 0 ? ABILITIES.rapid.fireMul : 1) * (adrenalineOn() ? ABILITIES.adrenaline.fire : 1);
      gun.cd *= (me.stimT > 0 ? ABILITIES.stim.fire : 1) * (me.frenzyT > 0 ? ULTIMATES.frenzy.fire : 1);
      if (me.miniT > 0) gun.cd = ULTIMATES.minigun.delay;
      if (me.rocketT > 0) gun.cd = Math.max(gun.cd, ULTIMATES.rockets.delay);
    }
    if (gun.ammo === 0 && gun.reload === 0 && gun.reserve > 0) gun.reload = reloadTimeOf(s);
  }

  // Quick Hands passive shortens every reload
  function reloadTimeOf(s) {
    return s.reloadTime * (hasAb('hands') ? ABILITIES.hands.reloadMul : 1);
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
    let dmg = s.damage * (hasAb('glass') ? ABILITIES.glass.mul : 1) * (me.juggT > 0 ? ULTIMATES.juggernaut.mul : 1);
    if (me.overShots > 0) { me.overShots--; dmg *= ABILITIES.overcharge.mul; }
    if (me.clockT > 0) dmg *= ABILITIES.cls_overclock.mul;
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
      Net.send({ t: 'shot', x: Math.round(m.x), y: Math.round(m.y), as: angles, sp: s.speed, fl: s.flare ? 1 : 0, bt: kind, rng: s.range, fo: s.falloff, dmg, kb: s.knockback, loud: s.hearRadius * (hasAb('ninja') ? ABILITIES.ninja.quiet : 1) });
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
    if (hasAb('armor')) dmg *= ABILITIES.armor.takeMul;
    if (easy()) dmg *= EASY.damage;
    const soaked = Math.min(me.shield, dmg);
    me.shield -= soaked;
    me.hp = Math.max(0, me.hp - (dmg - soaked));
    if (hasAb('thorns') && me.hp > 0 && me.thornCd <= 0) {
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
    if (me.hp <= 0 && hasAb('laststand') && !me.lastStand) {
      me.lastStand = true;
      me.hp = ABILITIES.laststand.hp;
      me.invT = ABILITIES.laststand.inv;
      G.banner = { text: 'LAST STAND!', t: 1.5 };
    }
    if (me.hp > 0) return;
    me.alive = false;
    burst(me.x, me.y, me.color, 20, 280);
    if (G.mode === 'sp') {
      G.over = true;
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
      if (wall && G.gadgets.length) { // shooting a Barrier wears it down
        const bg = G.gadgets.find(g => g.rect === wall && !g.dead);
        if (bg && bg.hp !== undefined && (G.mode === 'sp' ? b.team === 'e' : b.owner !== bg.owner && (!G.teams || teamOf(b.owner) !== teamOf(bg.owner)))) damageGadget(bg, bulletDamage(b));
      }
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
      if ((G.gadgets.length || G.turrets.length) && bulletHitsGadget(b, x1, y1)) { b.life = 0; continue; }
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
    const me = G.me;
    me.invT = Math.max(0, me.invT - dt);
    me.speedT = Math.max(0, me.speedT - dt);
    me.rapidT = Math.max(0, me.rapidT - dt);
    me.slowT = Math.max(0, me.slowT - dt);
    for (const k of ['frozenT', 'phaseT', 'reflectT', 'padCd', 'thornCd', 'clockT', 'trapT']) me[k] = Math.max(0, (me[k] || 0) - dt);
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
    updateSlot(dt, 0);
    swapAlt(); updateSlot(dt, 1); swapAlt();
    if (me.alt3.ability) { swapAlt('alt3'); updateSlot(dt, 2); swapAlt('alt3'); }
    if (me.alt4.ability) { swapAlt('alt4'); updateSlot(dt, 3); swapAlt('alt4'); }
  }

  // one ability slot (slot 1's state is swapped into `me` while this runs)
  function updateSlot(dt, slot) {
    const me = G.me, A = ABILITIES[me.ability];
    if (!A) return;
    me.abCd = Math.max(0, me.abCd - dt);
    if (G.test && G.infAbility) { me.abCd = 0; me.abUses = Infinity; me.frozenT = 0; } // test mode: infinite ability, no stun
    if (A.respawn && me.abUses < A.uses) { // weak abilities come back by themselves
      me.refillT = (me.refillT ?? A.respawn) - dt;
      if (me.refillT <= 0) { me.abUses++; me.refillT = A.respawn; G.texts.push({ x: me.x, y: me.y - 34, text: `+1 ${A.name}`, color: '#2bd96b', life: 1 }); }
    } else me.refillT = A.respawn;
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
    const pressed = Input.take(['abPress', 'ab2Press', 'ab3Press', 'ab4Press'][slot]);
    const held = Input.abilityHeld(slot);
    const ready = me.abCd === 0 && me.abUses > 0 && (me.ability !== 'shield' || me.shieldT === 0 || G.infAbility);
    const instant = ['shield', 'energy', 'burger', 'dash', 'rapid', 'blink', 'nova', 'slowmo', 'grapple', 'phase', 'reflect', 'overcharge', 'quake', 'recall', 'stim', 'shadowstep'].includes(me.ability) || !!A.cls;
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
    if (me.ability === 'stim') {
      me.stimT = A.duration;
      if (A.cost > 0) { me.hp = Math.max(1, me.hp - A.cost); G.texts.push({ x: me.x, y: me.y - 34, text: `-${A.cost}`, color: '#c56cf0', life: 0.8 }); }
      G.banner = { text: 'Stimmed!', t: 1 };
    }
    if (me.ability === 'shadowstep' && !stepBehind(A.range)) { me.abUses++; me.abCd = 0; G.banner = { text: 'No enemy in sight', t: 1 }; }
    if (A.cls) useClass(A);
  }

  // ---- CLASS abilities (slot 4 when every ability is from one section; numbers in config ABILITIES.cls_*)
  // while the class ability runs it's swapped into `me`, so the other slots sit in alt/alt3/alt4
  function slotsExcept() { const me = G.me; return [me.alt, me.alt3, me.alt4]; }
  function upgradePick() {
    let x, y;
    if (!Settings.mobile && Input.mouse.active) { x = (Input.mouse.x - W / 2) / zoom + G.cam.x; y = (Input.mouse.y - H / 2) / zoom + G.cam.y; }
    else if (G.selBld && !G.selBld.dead && G.selBld.hp > 0) return G.selBld;
    else return null;
    const here = buildingsInCell(x, y).filter(h => h.kind === 'turret' || isMine(h.o.owner));
    return here.length ? here[0].o : null;
  }
  function useClass(A) {
    const me = G.me, id = me.ability;
    const refund = msg => { me.abUses++; me.abCd = 0; G.banner = { text: msg, t: 1.2 }; };
    if (id === 'cls_upgrade') {
      // PC: the building in the square under your mouse. Phone: the building you last tapped.
      const pick = upgradePick();
      const best = pick && (pick.lvl || 1) < A.maxLvl ? pick : null;
      if (!best) return refund(pick ? 'That building is max level' : Settings.mobile ? 'Tap one of your buildings first' : 'Point your mouse at a building');
      best.lvl = (best.lvl || 1) + 1;
      if (best.maxHp && best.maxHp !== Infinity) best.hp = best.maxHp;
      best.flash = 0.2;
      if (best.id && G.mode === 'mp') Net.send({ t: 'gadl', id: best.id, l: best.lvl });
      levelFx(best);
    }
    if (id === 'cls_restock') {
      for (const s of slotsExcept()) if (s.ability && !ABILITIES[s.ability].cls) { s.abCd = 0; if (s.abUses < 1) s.abUses = 1; }
      me.trapT = A.window;
      burst(me.x, me.y, A.color, 18, 240);
      G.banner = { text: 'Double Trap! Next placeable x2', t: 1.5 };
    }
    if (id === 'cls_barrage') {
      const L = Account.user.loadout, thr = ABILITY_GROUPS[2].ids;
      const kind = thr.includes(me.lastThrow) ? me.lastThrow : [L.ability, L.ability2, L.ability3].find(k => thr.includes(k)) || 'grenade';
      const t = grenadeTarget(), d = Math.hypot(t.x - me.x, t.y - me.y);
      for (let i = 0; i < A.count; i++) {
        const a = me.aim + (i / (A.count - 1) - 0.5) * A.spread * 2, dd = d * (0.85 + 0.15 * (i % 2));
        const x1 = clamp(me.x + Math.cos(a) * dd, 20, MAP.w - 20), y1 = clamp(me.y + Math.sin(a) * dd, 20, MAP.h - 20);
        G.nades.push({ x0: me.x, y0: me.y, x1, y1, t: -i * 0.06, owner: myOwnerId(), kind, a: me.aim });
        if (kind === 'grenade' && G.mode === 'mp') Net.send({ t: 'nade', x0: Math.round(me.x), y0: Math.round(me.y), x1: Math.round(x1), y1: Math.round(y1) });
      }
      G.lastCombat = G.time;
      G.banner = { text: `Barrage: ${A.count}x ${ABILITIES[kind].name}!`, t: 1.2 };
    }
    if (id === 'cls_overclock') { me.clockT = A.duration; G.banner = { text: 'Overclock! +60% damage, no reload', t: 1.5 }; burst(me.x, me.y, A.color, 16, 220); }
    if (id === 'cls_afterimage') {
      const mv = ABILITY_GROUPS[4].ids;
      for (const s of slotsExcept()) if (mv.includes(s.ability)) { s.abCd = 0; if (s.abUses < 1) s.abUses = 1; }
      me.speedT = Math.max(me.speedT, A.duration); me.phaseT = Math.max(me.phaseT, A.duration);
      for (let i = 0; i < 6; i++) G.fx.push({ x: me.x, y: me.y, vx: 0, vy: 0, life: 0.5, max: 0.5, size: me.r * 2 + i * 6, color: 'rgba(24,220,255,0.25)' });
      G.banner = { text: 'Afterimage!', t: 1 };
    }
    if (id === 'cls_pulse') {
      if (me.hp < me.maxHp) heal(Math.ceil(me.maxHp - me.hp));
      me.frozenT = 0; me.shield = Math.max(me.shield, A.shield); me.shieldT = Math.max(me.shieldT, A.shieldT);
      for (const g of G.gadgets) if (!g.dead && g.kind === 'decoy' && isMine(g.owner) && g.maxHp && Math.hypot(g.x - me.x, g.y - me.y) <= A.radius) {
        g.hp = g.maxHp; burst(g.x, g.y, '#32ff7e', 12, 180);
      }
      G.rings.push({ x: me.x, y: me.y, r: A.radius, life: 0.7, max: 0.7, color: '50,255,126' });
      burst(me.x, me.y, '#32ff7e', 30, 340);
      G.banner = { text: 'Revive Pulse!', t: 1 };
    }
  }
  function levelFx(b) {
    burst(b.x, b.y, '#ffd32a', 36, 380); burst(b.x, b.y, '#ffffff', 14, 240);
    G.rings.push({ x: b.x, y: b.y, r: 120, life: 0.6, max: 0.6, color: '255,211,42' });
    G.texts.push({ x: b.x, y: b.y - 60, text: `LEVEL ${b.lvl}!`, color: '#ffd32a', life: 1.4 });
  }
  // gold stars over upgraded buildings
  function drawLevels() {
    for (const b of [...G.turrets, ...G.gadgets]) {
      if (b.dead || !(b.lvl > 1)) continue;
      const n = b.lvl, y = b.y - 52 * (b.sc || 1);
      ctx.fillStyle = '#ffd32a'; ctx.strokeStyle = '#3a2a00'; ctx.lineWidth = 1.5;
      for (let i = 0; i < n; i++) {
        const x = b.x + (i - (n - 1) / 2) * 11;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) { const r = k % 2 ? 2.4 : 5.5, a = -Math.PI / 2 + k * Math.PI / 5; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
  }

  // the thrown Resupply crate landed: a pickup with a few charges (+ a Supply Decoy with the combo)
  function landSupply(n) {
    const pack = { id: Math.random().toString(36).slice(2, 9), x: n.x1, y: n.y1, kind: 'supply', mags: ABILITIES.resupply.charges };
    addPacks([pack]);
    if (G.mode === 'mp') Net.send({ t: 'packs', packs: [pack] });
    burst(n.x1, n.y1, '#fff200', 20, 260);
  }

  // teleport right behind the closest enemy you can see. false if there's nobody
  function stepBehind(range) {
    const me = G.me;
    let best = null, bd = range;
    for (const t of targets()) { const d = Math.hypot(t.x - me.x, t.y - me.y); if (d < bd && lineOfSight(me.x, me.y, t.x, t.y)) { best = t; bd = d; } }
    if (!best) return false;
    const an = Math.atan2(best.y - me.y, best.x - me.x), r = (best.r || PLAYER.r) + me.r + 16;
    burst(me.x, me.y, '#2d3436', 16, 260);
    me.x = best.x + Math.cos(an) * r; me.y = best.y + Math.sin(an) * r;
    collideWorld(me);
    me.aim = an + Math.PI;
    burst(me.x, me.y, '#636e72', 16, 260);
    return true;
  }

  // Vampire passive: every hit you land heals you a little
  function vampire() {
    const me = G.me;
    if (!hasAb('vampire') || !me.alive || me.hp >= me.maxHp) return;
    me.hp = Math.min(me.maxHp, me.hp + ABILITIES.vampire.heal);
  }

  // bullets that don't come from your gun (nova, turret); other players see them too
  function fireBullets(x, y, angles, speed, dmg, kb, range, loud, kind = {}, falloff = 0) {
    for (const a of angles) addBullet(x, y, a, speed, dmg, kb, 'me', G.myId, range, falloff, false, kind);
    G.lastCombat = G.time;
    if (G.mode === 'mp') Net.send({ t: 'shot', x: Math.round(x), y: Math.round(y), as: angles, sp: speed, fl: 0, bt: kind, rng: range, fo: falloff, dmg, kb, loud });
  }

  const adrenalineOn = () => hasAb('adrenaline') && G.me.hp < G.me.maxHp * ABILITIES.adrenaline.below;

  // Scavenger passive: kills give health and ammo
  function onKill() {
    const me = G.me, S = ABILITIES.scavenger;
    if (!hasAb('scavenger') || !me.alive) return;
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
    if (isMine(n.owner) && n.kind === 'decoy' && !n.supply) { // SUPPLY DECOY: a decoy thrown onto your Resupply crate
      const crate = G.packs.find(p => p.kind === 'supply' && Math.hypot(p.x - n.x1, p.y - n.y1) <= 70);
      if (crate) {
        removePack(crate.id);
        if (G.mode === 'mp') Net.send({ t: 'took', id: crate.id });
        n.supply = true; n.x1 = crate.x; n.y1 = crate.y;
        comboFx(crate.x, crate.y, '#fff200', 'SUPPLY DECOY');
      }
    }
    if (isMine(n.owner)) {
      if (n.kind === 'firepit') { // INFERNO VORTEX
        const bh = myGadget('blackhole', n.x1, n.y1, ABILITIES.blackhole.radius);
        if (bh && !bh.vortex) { upgradeGadget(bh, 'vortex'); comboFx(bh.x, bh.y, '#ff6b1a', 'INFERNO VORTEX'); return; }
        const tc = myGadget('tesla', n.x1, n.y1, COMBO.near); // PLASMA COIL
        if (tc && !tc.plasma) { upgradeGadget(tc, 'plasma'); comboFx(tc.x, tc.y, '#ff9f43', 'PLASMA COIL'); return; }
        const t = nearTurret(n.x1, n.y1); // FLAME TURRET
        if (t && !t.flame) { t.flame = true; comboFx(t.x, t.y, '#ff6b1a', 'FLAME TURRET'); return; }
        const wall = myWall(n.x1, n.y1, 'fire');
        if (wall) { upgradeGadget(wall, 'fire'); comboFx(n.x1, n.y1, '#ff6b1a', 'WALL OF FIRE'); return; }
      }
      if (n.kind === 'bubble') { // SHIELDED TURRET (the bubble still goes up)
        const t = G.turrets.find(t => t.hp > 0 && Math.hypot(t.x - n.x1, t.y - n.y1) <= COMBO.near);
        if (t) { t.shieldT = ABILITIES.bubble.duration; comboFx(t.x, t.y, '#7ef9ff', 'SHIELDED TURRET'); }
      }
      if (n.kind === 'radar') { // PRISM LASER (radar used up)
        const lz = myGadget('laser', n.x1, n.y1, COMBO.near);
        if (lz && !lz.prism && !(lz.big && Math.hypot(lz.x - n.x1, lz.y - n.y1) > MAP.grid * 0.5)) { upgradeGadget(lz, 'prism'); comboFx(lz.x, lz.y, '#c56cf0', 'PRISM LASER'); return; }
      }
      if (n.kind === 'barrier' && !n.noMerge && !n.big) { // INFERNO RING (barrier used up)
        const ft = myGadget('flame', n.x1, n.y1, COMBO.near);
        if (ft && !ft.blaze) { upgradeGadget(ft, 'blaze'); comboFx(ft.x, ft.y, '#ffd32a', 'INFERNO RING'); return; }
      }
      if (n.kind === 'radar') { // EAGLE EYE (radar used up)
        const sn = myGadget('sniper', n.x1, n.y1, COMBO.near);
        if (sn && !sn.spot) { upgradeGadget(sn, 'spot'); comboFx(sn.x, sn.y, '#ff9ff3', 'EAGLE EYE'); return; }
      }
      if (n.kind === 'tesla' && !n.big) { // SHOCK DOME (tesla used up)
        const sg = myGadget('shieldgen', n.x1, n.y1, COMBO.near);
        if (sg && !sg.shock) { upgradeGadget(sg, 'shock'); comboFx(sg.x, sg.y, '#a29bfe', 'SHOCK DOME'); return; }
      }
      if (n.kind === 'radar') { // SPOTTER TURRET
        const t = nearTurret(n.x1, n.y1);
        if (t) { t.spot = true; comboFx(t.x, t.y, '#ff9ff3', 'SPOTTER TURRET'); return; }
        const tc = myGadget('tesla', n.x1, n.y1, COMBO.near * 1.5); // SEEKER COIL
        if (tc && !tc.seeker) { upgradeGadget(tc, 'seeker'); comboFx(tc.x, tc.y, '#ff9ff3', 'SEEKER COIL'); return; }
      }
      if (n.kind === 'barrier' && !n.noMerge && !n.big) { // BUNKER: the barrier is used up as armor plating
        const t = G.turrets.find(t => !t.bunker && t.hp > 0 && Math.hypot(t.x - n.x1, t.y - n.y1) <= COMBO.near);
        if (t) { t.bunker = true; comboFx(t.x, t.y, '#a4b0be', 'BUNKER'); return; }
      }
      if (n.kind === 'decoy' && !n.supply) { // COMMAND TOWER (the decoy still lands as a normal buddy)
        const rd = myGadget('radar', n.x1, n.y1, COMBO.near);
        if (rd && !rd.command) { upgradeGadget(rd, 'command'); comboFx(rd.x, rd.y, '#ffd32a', 'COMMAND TOWER'); setTimeout(checkFormations, 0); }
      }
      if (n.kind === 'freeze') { // CRYO MORTAR (the freeze still goes off)
        const mo = myGadget('mortar', n.x1, n.y1, COMBO.near);
        if (mo && !mo.cryo) { upgradeGadget(mo, 'cryo'); comboFx(mo.x, mo.y, '#74b9ff', 'CRYO MORTAR'); }
      }
      if (n.kind === 'freeze') { // ICE WALL (the freeze still goes off)
        const wall = myWall(n.x1, n.y1, 'ice');
        if (wall) { upgradeGadget(wall, 'ice'); comboFx(n.x1, n.y1, '#9ee7ff', 'ICE WALL'); }
      }
      if (n.kind === 'freeze') { // CRYO COIL (the freeze still goes off)
        const tc = myGadget('tesla', n.x1, n.y1, COMBO.near);
        if (tc && !tc.cryo) { upgradeGadget(tc, 'cryo'); comboFx(tc.x, tc.y, '#74b9ff', 'CRYO COIL'); }
        const mn = myGadget('mine', n.x1, n.y1, COMBO.near); // CRYO MINE
        if (mn && !mn.cryo) { upgradeGadget(mn, 'cryo'); comboFx(mn.x, mn.y, '#74b9ff', 'CRYO MINE'); }
      }
    }
    if (ABILITIES[n.kind].building && !n.noMerge) ({ x: n.x1, y: n.y1 } = snapCell(n.x1, n.y1));
    if (ABILITIES[n.kind].building && !n.noMerge && !n.big && isMine(n.owner) && cellBlocked(n.kind, n.x1, n.y1)) return refundThrow(n.kind, n.x1, n.y1);
    const id = (G.myId || 'me') + ':' + (gadgetSeq++);
    const main = G.me.guns[0];
    addGadget({ kind: n.kind, x: n.x1, y: n.y1, a: n.a || 0, owner: n.owner, id, color: G.me.color, name: G.me.name, stats: n.supply ? null : main.stats, sprite: n.supply ? null : main.sprite, hp: n.hp, dur: n.dur, big: n.big, supply: n.supply });
    if (n.kind === 'barrier' && isMine(n.owner) && myGadget('tesla', n.x1, n.y1, COMBO.fenceNear)) { // ELECTRIC FENCE
      const g = G.gadgets.find(x => x.id === id);
      setTimeout(() => { if (G && g && !g.dead) { upgradeGadget(g, 'electric'); comboFx(g.x, g.y, '#feca57', 'ELECTRIC FENCE'); } }, 0);
    }
    if (G.mode === 'mp') Net.send({ t: 'gad', k: n.kind, x: Math.round(n.x1), y: Math.round(n.y1), a: +(n.a || 0).toFixed(3), id, c: G.me.color, n: G.me.name, b: n.supply ? null : main.build, hp: n.hp, dur: n.dur, g: n.big ? 1 : 0, s: n.supply ? 1 : 0 });
    if (ABILITIES[n.kind].building && !n.big && !n.noMerge) mergeBuildings(n.kind, n.x1, n.y1);
    if (isMine(n.owner) && ABILITIES[n.kind].building) checkFormations();
  }

  // buildings sit in the middle of a floor square (unless that square is a wall)
  function snapCell(x, y) {
    const C = MAP.grid, cx = (Math.floor(x / C) + 0.5) * C, cy = (Math.floor(y / C) + 0.5) * C;
    return pointInWall(cx, cy) ? { x, y } : { x: cx, y: cy };
  }
  const cellOf = o => [Math.floor(o.x / MAP.grid), Math.floor(o.y / MAP.grid)];
  // every building (turrets + building gadgets) standing in the floor square of (x, y)
  function buildingsInCell(x, y) {
    const cx = Math.floor(x / MAP.grid), cy = Math.floor(y / MAP.grid), here = o => { const [a, b] = cellOf(o); return a === cx && b === cy; };
    return [...G.turrets.filter(t => t.hp > 0 && here(t)).map(t => ({ o: t, kind: 'turret', small: !t.rocket && !t.rail && !t.fort })),
            ...G.gadgets.filter(g => !g.dead && ABILITIES[g.kind] && ABILITIES[g.kind].building && here(g)).map(g => ({ o: g, kind: g.kind, small: !g.big && !FORMATIONS_ANY(g) }))];
  }
  const FORMATIONS_ANY = g => Object.keys(FORMATIONS).some(k => g[k]);
  // ONE building per square: only up to 3 small ones of the SAME kind may share it (they merge into a big one)
  function cellBlocked(kind, x, y) {
    const here = buildingsInCell(x, y);
    return here.length && !(here.every(h => h.kind === kind && h.small) && here.length < 3);
  }
  function refundThrow(kind, x, y) {
    const s = allSlots().find(sl => sl.ability === kind);
    if (s) { s.abUses++; s.abCd = 0; }
    burst(x, y, '#ffffff', 12, 200);
    G.banner = { text: 'Only one building per square!', t: 1.4 };
  }

  // ---- ability combos (see COMBOS in config)
  const comboFx = (x, y, color, text) => {
    burst(x, y, color, 45, 420);
    G.rings.push({ x, y, r: 150, life: 0.6, max: 0.6, color: '255,215,0' });
    G.banner = { text: `COMBO: ${text}!`, t: 1.8 };
  };
  const nearTurret = (x, y) => G.turrets.find(t => !t.rocket && !t.rail && !t.fort && !t.spot && !t.medic && t.hp > 0 && Math.hypot(t.x - x, t.y - y) <= COMBO.near);
  // your barrier whose wall is within 70 of (x, y) and doesn't have `flag` yet
  const myWall = (x, y, flag) => G.gadgets.find(g => g.kind === 'barrier' && g.rect && !g.dead && !g[flag] && isMine(g.owner) &&
    Math.hypot(x - clamp(x, g.rect[0], g.rect[0] + g.rect[2]), y - clamp(y, g.rect[1], g.rect[1] + g.rect[3])) <= 70);
  const myGadget = (kind, x, y, r) => G.gadgets.find(g => g.kind === kind && !g.dead && isMine(g.owner) && Math.hypot(g.x - x, g.y - y) <= r);
  // tell everyone a gadget changed (vortex / cryo)
  function upgradeGadget(g, what) {
    g[what] = true;
    if (what === 'vortex') g.t += COMBO.vortexTime;
    if (FORMATIONS[what]) formUp(g, what);
    if (G.mode === 'mp') Net.send({ t: 'gadc', id: g.id, w: what });
  }
  // a gadget becomes a formation super building (runs on every client)
  function formUp(g, what) {
    const F = FORMATIONS[what];
    g.hp = g.maxHp = F.hp; g.flash = 0.2; g.formAge = 0;
    g.lvl = 1; // any level of the parts can fuse; the super building starts fresh
    if (F.size) g.sc = F.size;
    if (what === 'carrier') g.drones = null; // rebuilt with more, bigger drones
  }
  const formationFx = (x, y, col, text, sc = 1.6) => {
    burst(x, y, col, 70, 560); burst(x, y, '#ffffff', 24, 380);
    G.rings.push({ x, y, r: 240, life: 0.8, max: 0.8, color: rgbOf(col) }, { x, y, r: 140, life: 0.5, max: 0.5, color: '255,215,0' });
    G.blooms.push({ x, y, r: 160, col, life: 0.6, max: 0.6 });
    landFx(x, y, col, sc);
    G.shake = Math.max(G.shake || 0, 14);
    G.banner = { text: `FORMATION: ${text}!`, t: 2.2 };
  };
  // ---- FORMATIONS (config FORMATIONS): buildings in side-by-side squares fuse into one super building
  function consumeGadget(g) { removeGadget(g); if (G.mode === 'mp') Net.send({ t: 'gadx', id: g.id, q: 1 }); }
  function checkFormations() {
    if (!G) return;
    checkRailgun();
    const mineOf = k => G.gadgets.filter(g => g.kind === k && !g.dead && isMine(g.owner));
    const at = (list, x, y) => list.find(o => { const [a, b] = cellOf(o); return a === x && b === y; });
    const AX = [[1, 0], [0, 1]], SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // ORBITAL STRIKE: radar | big laser | radar
    const radars = mineOf('radar');
    for (const lz of mineOf('laser')) {
      if (!lz.big || lz.orbital) continue;
      const [x, y] = cellOf(lz);
      for (const [dx, dy] of AX) {
        const a = at(radars, x - dx, y - dy), b = at(radars, x + dx, y + dy);
        if (!a || !b) continue;
        consumeGadget(a); consumeGadget(b); upgradeGadget(lz, 'orbital');
        formationFx(lz.x, lz.y, '#ff2e63', 'ORBITAL STRIKE'); return;
      }
    }
    // CARRIER: big hangar next to a command tower
    // forgiving: the command tower just has to be close (any side, diagonals too), not in the exact next square
    for (const hg of mineOf('hangar')) {
      if (hg.carrier) continue;
      const ct = radars.find(r => r.command && Math.hypot(r.x - hg.x, r.y - hg.y) <= MAP.grid * 2.2);
      if (!ct) continue;
      if (!hg.big) { G.banner = { text: 'Carrier needs a BIG Drone Hangar (3 in one spot)', t: 2.5 }; continue; }
      consumeGadget(ct); upgradeGadget(hg, 'carrier');
      formationFx(hg.x, hg.y, '#00d2d3', 'CARRIER'); return;
    }
    // STORM TOWER: 3 big teslas in an L (lives in the corner square)
    const bigT = mineOf('tesla').filter(g => g.big && !g.stormtower);
    for (const c of bigT) {
      const [x, y] = cellOf(c);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const a = at(bigT, x + sx, y), b = at(bigT, x, y + sy);
        if (!a || !b) continue;
        consumeGadget(a); consumeGadget(b); upgradeGadget(c, 'stormtower');
        formationFx(c.x, c.y, '#a29bfe', 'STORM TOWER'); return;
      }
    }
    // FORTRESS: rocket turret | shield generator | rocket turret
    const rockets = G.turrets.filter(t => t.rocket && t.hp > 0);
    for (const sg of mineOf('shieldgen')) {
      const [x, y] = cellOf(sg);
      for (const [dx, dy] of AX) {
        const a = at(rockets, x - dx, y - dy), b = at(rockets, x + dx, y + dy);
        if (!a || !b) continue;
        consumeGadget(sg);
        G.turrets = G.turrets.filter(t => t !== a && t !== b);
        const F = FORMATIONS.fortress;
        G.turrets.push({ x: sg.x, y: sg.y, t: Infinity, hp: F.hp, maxHp: F.hp, cd: 0.5, aim: a.aim || 0, fort: true, sh: F.shield, rk: 1, ov: 0, bar: 0, stats: a.stats, sprite: a.sprite, bunker: a.bunker || b.bunker });
        formationFx(sg.x, sg.y, '#6c5ce7', 'FORTRESS'); return;
      }
    }
  }

  // big tesla | rocket turret | big tesla in a row -> RAILGUN in the middle square
  function checkRailgun() {
    const teslas = G.gadgets.filter(g => g.kind === 'tesla' && g.big && !g.dead && isMine(g.owner));
    const at = (x, y) => teslas.find(g => { const [a, b] = cellOf(g); return a === x && b === y; });
    for (const t of G.turrets) {
      if (!t.rocket || t.hp <= 0) continue;
      const [x, y] = cellOf(t);
      const pair = at(x - 1, y) && at(x + 1, y) ? [at(x - 1, y), at(x + 1, y)] : at(x, y - 1) && at(x, y + 1) ? [at(x, y - 1), at(x, y + 1)] : null;
      if (!pair) continue;
      for (const g of pair) { removeGadget(g); if (G.mode === 'mp') Net.send({ t: 'gadx', id: g.id }); }
      const R = MERGE.railgun;
      Object.assign(t, { rocket: false, rail: true, hp: R.hp, maxHp: R.hp, cd: 0.5, zap: null, lvl: 1 }); // levels of the parts don't matter: starts fresh
      burst(t.x, t.y, '#48dbfb', 60, 500);
      G.rings.push({ x: t.x, y: t.y, r: 220, life: 0.7, max: 0.7, color: '72,219,251' });
      G.banner = { text: 'RAILGUN!', t: 1.8 };
      return;
    }
  }

  // 3 of your same building close together -> one BIG building in the middle
  function mergeBuildings(kind, x, y) {
    const near = G.gadgets.filter(g => g.kind === kind && !g.big && !g.dead && isMine(g.owner) && Math.hypot(g.x - x, g.y - y) <= MERGE.near);
    if (near.length < 3) return;
    const three = near.slice(-3), cx = three.reduce((s, g) => s + g.x, 0) / 3, cy = three.reduce((s, g) => s + g.y, 0) / 3;
    for (const g of three) {
      removeGadget(g);
      if (G.mode === 'mp') Net.send({ t: 'gadx', id: g.id, q: 1 });
    }
    burst(cx, cy, ABILITIES[kind].color, 50, 420);
    G.rings.push({ x: cx, y: cy, r: 160, life: 0.6, max: 0.6, color: '255,215,0' });
    G.banner = { text: `BIG ${ABILITIES[kind].name.toUpperCase()}!`, t: 1.5 };
    landGadget({ kind, x1: cx, y1: cy, a: three[0].a || 0, owner: myOwnerId(), big: true });
  }

  // 3 of your turrets in the same floor square -> ROCKET TURRET
  function mergeTurrets(x, y) {
    const near = G.turrets.filter(t => !t.rocket && t.hp > 0 && Math.hypot(t.x - x, t.y - y) <= MERGE.turretNear);
    if (near.length < 3) return;
    const three = near.slice(-3), R = MERGE.rocketTurret;
    for (const t of three) t.t = 0;
    const { x: cx, y: cy } = snapCell(three.reduce((s, t) => s + t.x, 0) / 3, three.reduce((s, t) => s + t.y, 0) / 3);
    G.turrets = G.turrets.filter(t => t.t > 0);
    G.turrets.push({ x: cx, y: cy, t: Infinity, hp: R.hp, maxHp: R.hp, cd: 1, aim: 0, rocket: true, stats: three[0].stats, sprite: three[0].sprite });
    burst(cx, cy, '#e17055', 50, 420);
    G.rings.push({ x: cx, y: cy, r: 160, life: 0.6, max: 0.6, color: '225,112,85' });
    G.banner = { text: 'ROCKET TURRET!', t: 1.5 };
    checkFormations();
  }
  function addGadget(g) {
    const A = ABILITIES[g.kind];
    Object.assign(g, { age: 0, tick: 0, t: g.dur || A.duration || A.life || 1, zaps: [] });
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
    if (A.hp) g.hp = g.maxHp = g.hp || A.hp; // clones bring their own HP
    g.sc = g.big ? MERGE.size : 1; // big (merged) buildings
    if (g.big) { g.hp = g.maxHp = A.hp * MERGE.hp; g.t = (A.duration || g.t) * MERGE.range; }
    if (g.kind === 'decoy') {
      Object.assign(g, { r: PLAYER.r, cd: 0.5, kick: 0, aim: g.a, reloadT: 0 });
      if (g.stats) { g.ammo = g.stats.magSize; g.reserve = g.stats.magSize * A.spareMags; }
    }
    if (g.kind === 'barrier') {
      const L = A.len * (g.big ? 1.4 : 1), T = A.thick * (g.big ? 1.5 : 1), vert = Math.abs(Math.cos(g.a)) > Math.abs(Math.sin(g.a));
      g.rect = vert ? [g.x - T / 2, g.y - L / 2, T, L] : [g.x - L / 2, g.y - T / 2, L, T];
      MAP.walls.push(g.rect);
      if (!G.me.phaseT) collideWorld(G.me);
    }
    if (ABILITIES[g.kind].building) landFx(g.x, g.y, ABILITIES[g.kind].color, g.sc);
    G.gadgets.push(g);
  }
  function removeGadget(g) {
    g.dead = true;
    if (g.rect) MAP.walls = MAP.walls.filter(w => w !== g.rect);
  }
  const smokeBlocks = (x1, y1, x2, y2) => G.gadgets.some(g => g.kind === 'smoke' && g.puffs.some(p => segHitsCircle(x1, y1, x2, y2, p.x, p.y, p.r * 0.8)));
  const myDecoy = () => G.gadgets.find(g => g.kind === 'decoy' && isMine(g.owner));

  // STORM COIL: a zap jumps on from enemy to enemy (nearest one not hit yet, up to stormChains more)
  const teslaRange = (g, A) => A.radius * (g.stormtower ? FORMATIONS.stormtower.radius : g.big ? MERGE.range : 1) * (g.seeker ? COMBO.seekerRange : 1);
  function stormChain(g, first, A, dmg) {
    const done = [first], ST = g.stormtower && FORMATIONS.stormtower;
    let from = first;
    for (let k = 0; k < (ST ? ST.chains : COMBO.stormChains); k++) {
      let pick = null, bd = ST ? ST.chainRange : COMBO.stormRange;
      for (const o of G.enemies) {
        if (done.includes(o)) continue;
        const d = Math.hypot(o.x - from.x, o.y - from.y);
        if (d < bd && lineOfSight(from.x, from.y, o.x, o.y)) { pick = o; bd = d; }
      }
      if (!pick) return;
      g.zaps.push({ x: pick.x, y: pick.y, fx: from.x, fy: from.y, life: 0.18 });
      hurtEnemy(pick, dmg, 0.5, Math.atan2(pick.y - from.y, pick.x - from.x));
      if (g.cryo) pick.frozen = Math.max(pick.frozen || 0, COMBO.cryoFreeze);
      done.push(pick); from = pick;
    }
  }

  // MORTAR: lobs a shell over walls at the farthest enemy in range (owner decides, everyone sees the strike)
  function updateMortar(g, A) {
    g.recoil = Math.max(0, (g.recoil || 0) - 0.05);
    if (!isMine(g.owner) || g.tick > 0) return;
    const R = A.range * (g.big ? MERGE.range : 1);
    let best = null, bd = A.minRange;
    for (const e of targets()) { const d = Math.hypot(e.x - g.x, e.y - g.y); if (d <= R && d > bd) { best = e; bd = d; } }
    if (!best) { g.tick = 0.4; return; }
    g.tick = A.every; g.aim = Math.atan2(best.y - g.y, best.x - g.x); g.recoil = 1;
    const s = [Math.round(best.x), Math.round(best.y), A.flight, A.radius * (g.big ? 1.3 : 1), A.damage, g.cryo ? 1 : 0, Math.round(g.x), Math.round(g.y)];
    addStrike(s, g.owner);
    if (G.mode === 'mp') Net.send({ t: 'ult', k: 'mortar', s: [s] });
    burst(g.x + Math.cos(g.aim) * 14, g.y + Math.sin(g.aim) * 14 - 10, '#ffd29a', 8, 160); flashAt(g.x + Math.cos(g.aim) * 22, g.y + Math.sin(g.aim) * 22, '#ffb347', 34);
  }
  function addStrike(s, owner) { G.strikes.push({ x: s[0], y: s[1], t: s[2], max: s[2], r: s[3], dmg: s[4], cryo: s[5], sx: s[6] ?? undefined, sy: s[7] ?? undefined, orb: s[8], owner }); }
  // SNIPER NEST: one big shot at the closest enemy it can see (Eagle Eye: through walls)
  function updateSniper(g, A, dt) {
    if (g.tracer) { g.tracer.life -= dt; if (g.tracer.life <= 0) g.tracer = null; }
    g.kick = Math.max(0, (g.kick || 0) - 40 * dt);
    if (!isMine(g.owner)) return;
    const R = A.range * (g.big ? MERGE.range : 1);
    let best = null, bd = R;
    for (const e of targets()) { const d = Math.hypot(e.x - g.x, e.y - g.y); if (d < bd && (g.spot || lineOfSight(g.x, g.y, e.x, e.y))) { best = e; bd = d; } }
    if (best) g.aim = Math.atan2(best.y - g.y, best.x - g.x);
    if (!best || g.tick > 0) return;
    g.tick = A.every;
    const sx = g.x + Math.cos(g.aim) * 34 * g.sc, sy = g.y + Math.sin(g.aim) * 34 * g.sc;
    fireBullets(sx, sy, [+g.aim.toFixed(4)], A.speed, A.damage * (g.big ? 1.5 : 1), 2, R + 50, 6 * HEAR_UNIT, g.spot ? { ghost: 1 } : {});
    g.tracer = { x0: sx, y0: sy, x: best.x, y: best.y, life: 0.25 }; g.kick = 8;
    muzzleFlash(sx, sy, g.aim); flashAt(sx, sy, '#fff3b0', 36);
  }
  // SHIELD GENERATOR: everyone friendly inside the dome gets an overshield every few seconds (each player does it for themselves)
  function updateShieldGen(g, A) {
    const me = G.me, R = A.radius * (g.big ? MERGE.range : 1);
    if (g.tick > 0) return;
    g.tick = g.shock ? 0.5 : A.every;
    g.pulse = (g.pulse || 0) - (g.shock ? 0.5 : A.every);
    if (g.pulse <= 0) {
      g.pulse = A.every; g.ring = 0.5;
      if (me.alive && !hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= R) {
        me.shield = Math.max(me.shield, A.shield); me.shieldT = Math.max(me.shieldT, A.shieldTime);
      }
      if (isMine(g.owner)) for (const b of G.gadgets) if (b.kind === 'decoy' && !b.dead && isMine(b.owner) && Math.hypot(b.x - g.x, b.y - g.y) <= R) b.sh = A.shield;
    }
    if (g.shock) { // SHOCK DOME
      if (isMine(g.owner)) { if (G.mode === 'sp') for (const e of [...G.enemies]) if (Math.hypot(e.x - g.x, e.y - g.y) <= R + e.r) { hurtEnemy(e, COMBO.shockDps / 2, 0.5, Math.atan2(e.y - g.y, e.x - g.x)); g.zaps.push({ x: e.x, y: e.y, life: 0.15 }); } }
      else if (me.alive && hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= R + me.r) { hurtMe(COMBO.shockDps / 2, 0.5, Math.atan2(me.y - g.y, me.x - g.x), g.owner); g.zaps.push({ x: me.x, y: me.y, life: 0.15 }); }
    }
  }

  // ---- FLAME TOWER / LASER TOWER / DRONE HANGAR / GRAVITY TOWER
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const turnTo = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
  // FLAME TOWER: a cone of fire at the closest enemy it can see (Inferno Ring: all the way around); sets them on fire
  function updateFlame(g, A, dt) {
    const me = G.me, R = A.range * (g.big ? MERGE.range : 1) * (g.blaze ? COMBO.blazeRange : 1);
    let best = null;
    if (isMine(g.owner)) {
      let bd = Infinity;
      for (const e of targets()) { const d = Math.hypot(e.x - g.x, e.y - g.y); if (d <= R + (e.r || 0) && d < bd && lineOfSight(g.x, g.y, e.x, e.y)) { best = e; bd = d; } }
    } else if (me.alive && hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= R + me.r && lineOfSight(g.x, g.y, me.x, me.y)) best = me;
    g.firing = !!best;
    if (g.aim === undefined) g.aim = g.a || 0;
    if (best) g.aim = turnTo(g.aim, Math.atan2(best.y - g.y, best.x - g.x), dt * 10);
    // fire particles (just looks; capped so lots of towers stay cheap)
    g.flames = g.flames || [];
    for (const p of g.flames) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97; p.life -= dt; }
    g.flames = g.flames.filter(p => p.life > 0);
    if (g.firing && g.flames.length < 70) for (let i = 0; i < (g.blaze ? 5 : 3); i++) {
      const an = g.blaze ? Math.random() * Math.PI * 2 : g.aim + (Math.random() - 0.5) * 2 * A.cone * 0.85, v = R * (1.5 + Math.random() * 0.6);
      const sx = g.x + Math.cos(an) * 22 * g.sc, sy = g.y + Math.sin(an) * 22 * g.sc;
      g.flames.push({ x: sx, y: sy, vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: 0.5, max: 0.5, s: 9 + Math.random() * 9 });
    }
    if (!g.firing || g.tick > 0) return;
    g.tick = 0.25;
    const dmg = A.dps * 0.25 * (g.big ? 1.5 : 1), hits = (x, y, r) => Math.hypot(x - g.x, y - g.y) <= R + r &&
      (g.blaze || angDiff(Math.atan2(y - g.y, x - g.x), g.aim) <= A.cone) && lineOfSight(g.x, g.y, x, y);
    if (isMine(g.owner)) {
      if (G.mode === 'sp') for (const e of [...G.enemies]) if (hits(e.x, e.y, e.r)) { e.burnT = A.burn; hurtEnemy(e, dmg, 0.3, Math.atan2(e.y - g.y, e.x - g.x)); }
    } else if (me.alive && hostileTo(g.owner) && hits(me.x, me.y, me.r)) { me.burnT = A.burn; me.burnBy = g.owner; hurtMe(dmg, 0.3, Math.atan2(me.y - g.y, me.x - g.x), g.owner); }
  }

  // LASER TOWER: locks a beam on one enemy; the longer it holds on, the more it hurts (Prism Laser: 2 extra beams)
  function updateLaser(g, A, dt) {
    const me = G.me, R = A.range * (g.big ? MERGE.range : 1);
    g.uplink = Math.max(0, (g.uplink || 0) - dt);
    if (g.orbital && isMine(g.owner)) { // ORBITAL STRIKE: sky beam on the toughest enemy anywhere
      const F = FORMATIONS.orbital;
      g.orbK = (g.orbK ?? 2) - dt;
      if (g.orbK <= 0) {
        let best = null, bh = -1;
        for (const e of targets()) { const h = e.hp ?? 1; if (h > bh) { best = e; bh = h; } }
        if (best) {
          g.orbK = F.every; g.uplink = 0.6;
          const s = [Math.round(best.x), Math.round(best.y), F.delay, F.radius, F.damage, 0, null, null, 1];
          addStrike(s, g.owner);
          if (G.mode === 'mp') Net.send({ t: 'ult', k: 'orb', s: [s] });
        } else g.orbK = 0.5;
      }
    }
    const ok = e => Math.hypot(e.x - g.x, e.y - g.y) <= R + (e.r || 0) && lineOfSight(g.x, g.y, e.x, e.y);
    g.beams = [];
    let tgt = null, extra = [];
    if (isMine(g.owner)) {
      const list = targets();
      if (g.tgt) tgt = G.mode === 'sp' ? (list.includes(g.tgt) ? g.tgt : null) : list.find(e => Math.hypot(e.x - g.tgt.x, e.y - g.tgt.y) < 60) || null;
      if (tgt && !ok(tgt)) tgt = null;
      if (!tgt) {
        g.heat = 0;
        let bd = Infinity;
        for (const e of list) { const d = Math.hypot(e.x - g.x, e.y - g.y); if (d < bd && ok(e)) { tgt = e; bd = d; } }
      }
      g.tgt = tgt ? (G.mode === 'sp' ? tgt : { x: tgt.x, y: tgt.y }) : null;
      if (tgt && g.prism) extra = list.filter(e => e !== tgt && ok(e)).sort((a, b) => Math.hypot(a.x - g.x, a.y - g.y) - Math.hypot(b.x - g.x, b.y - g.y)).slice(0, COMBO.prismBeams);
    } else if (me.alive && hostileTo(g.owner) && ok(me)) tgt = me;
    if (!tgt) { g.heat = Math.max(0, (g.heat || 0) - dt * 2); return; }
    g.heat = Math.min(1, (g.heat || 0) + dt / A.ramp);
    g.aim = Math.atan2(tgt.y - g.y, tgt.x - g.x);
    g.beams.push({ x: tgt.x, y: tgt.y, main: true });
    for (const e of extra) g.beams.push({ x: e.x, y: e.y });
    if (Math.random() < 0.5) G.fx.push({ x: tgt.x, y: tgt.y, vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300, life: 0.2, max: 0.2, size: 3, color: '#ffd1dc' });
    if (g.tick > 0) return;
    g.tick = 0.2;
    const dmg = (A.dps + (A.maxDps - A.dps) * g.heat) * 0.2 * (g.big ? 1.5 : 1);
    if (tgt === me) hurtMe(dmg, 0.05, g.aim, g.owner);
    else if (G.mode === 'sp') {
      hurtEnemy(tgt, dmg, 0.05, g.aim);
      for (const e of extra) hurtEnemy(e, dmg * COMBO.prismMul, 0.05, Math.atan2(e.y - g.y, e.x - g.x));
    }
  }

  // DRONE HANGAR: drones orbit the hangar, fly out at enemies near it and shoot them; shot-down drones come back later
  function updateHangar(g, A, dt) {
    const CF = g.carrier && FORMATIONS.carrier, me = G.me, mine = isMine(g.owner), n = CF ? CF.drones : A.drones + (g.big ? 1 : 0), dhp = A.droneHp * (CF ? CF.droneHp : 1);
    if (!g.drones) g.drones = Array.from({ length: n }, (_, i) => ({ x: g.x, y: g.y, ph: i * Math.PI * 2 / n, alive: false, back: 0.35 + i * 0.35, hp: dhp, cd: 0.5, a: 0, mf: 0 }));
    const R = A.range * (g.big ? MERGE.range : 1) * (CF ? CF.range : 1);
    let tgt = null;
    if (mine) { let bd = R; for (const e of targets()) { const d = Math.hypot(e.x - g.x, e.y - g.y); if (d < bd) { tgt = e; bd = d; } } }
    // drones spin as one ring, spread perfectly evenly (3 drones = 120 degrees apart, like the nuclear symbol)
    g.spin = ((g.spin || 0) + dt * 2.4) % (Math.PI * 2);
    const flying = g.drones.filter(d => d.alive);
    // single player: each drone goes for the enemy TEAMWORK gave it (or circles home)
    const tgtOf = d => G.mode !== 'sp' ? tgt : d.assigned && d.assigned.hp > 0 && G.enemies.includes(d.assigned) ? d.assigned : null;
    for (const d of g.drones) {
      d.mf = Math.max(0, d.mf - dt);
      if (d.hb) { d.hb.life -= dt; if (d.hb.life <= 0) d.hb = null; }
      if (!d.alive) {
        d.back -= dt;
        if (d.back <= 0) { d.alive = true; d.hp = dhp; d.x = g.x; d.y = g.y; burst(g.x, g.y, g.medic ? '#32ff7e' : A.color, 8, 160); }
        continue;
      }
      const dt_ = tgtOf(d), group = flying.filter(o => tgtOf(o) === dt_); // drones on the same target share one even ring
      d.ph = g.spin + group.indexOf(d) * Math.PI * 2 / group.length;
      const tgt = dt_;
      const tx = tgt ? tgt.x + Math.cos(d.ph) * 110 : g.x + Math.cos(d.ph) * 58 * g.sc, ty = tgt ? tgt.y + Math.sin(d.ph) * 110 : g.y + Math.sin(d.ph) * 58 * g.sc;
      const dx = tx - d.x, dy = ty - d.y, dl = Math.hypot(dx, dy) || 1, step = Math.min(dl, Math.max(A.speed, Math.min(dl * 6, A.speed * 2.5)) * dt);
      d.x += dx / dl * step; d.y += dy / dl * step;
      d.a = tgt ? Math.atan2(tgt.y - d.y, tgt.x - d.x) : Math.atan2(dy, dx);
      d.cd -= dt;
      if (mine && tgt && d.cd <= 0 && Math.hypot(tgt.x - d.x, tgt.y - d.y) <= A.shootRange && lineOfSight(d.x, d.y, tgt.x, tgt.y)) {
        d.cd = A.every;
        const sx = d.x + Math.cos(d.a) * 10, sy = d.y + Math.sin(d.a) * 10;
        fireBullets(sx, sy, [+d.a.toFixed(4)], 1500, A.damage * (CF ? CF.dmgMul : g.big ? 1.5 : 1), 0.5, A.shootRange + 80, 1.5 * HEAR_UNIT);
        d.mf = 0.07; flashAt(sx, sy, g.medic ? '#7dffaa' : '#7efcff', 16);
      }
    }
    if (g.medic && mine) { // MEDIC DRONES: every 2s each drone patches up you or your buddies near the hangar
      g.healK = (g.healK ?? A.healEvery) - dt;
      if (g.healK <= 0) {
        g.healK = A.healEvery;
        for (const d of g.drones) {
          if (!d.alive) continue;
          if (me.alive && me.hp < me.maxHp && Math.hypot(me.x - g.x, me.y - g.y) <= COMBO.medicDroneRange) { heal(A.heal); d.hb = { x: me.x, y: me.y, life: 0.3 }; }
          healBuddies(g.x, g.y, COMBO.medicDroneRange, A.heal);
        }
      }
    }
  }
  // a hostile bullet hits one of my drones?
  function bulletHitsDrone(b, x1, y1) {
    for (const g of G.gadgets) {
      if (g.kind !== 'hangar' || g.dead || !g.drones || !isMine(g.owner)) continue;
      for (const d of g.drones) {
        if (!d.alive || !segHitsCircle(x1, y1, b.x, b.y, d.x, d.y, g.carrier ? 14 : 10)) continue;
        d.hp -= bulletDamage(b); markAttack(g, b.src);
        if (d.hp <= 0) { d.alive = false; d.back = ABILITIES.hangar.respawn; buildingBoom(d.x, d.y, ABILITIES.hangar.color, 0.35); }
        else burst(b.x, b.y, '#7efcff', 4, 120);
        return true;
      }
    }
    return false;
  }

  // GRAVITY TOWER: drags enemies toward it and slows them (Implosion: crushes them every few seconds)
  function updateGravity(g, A, dt) {
    const me = G.me, R = A.radius * (g.big ? MERGE.range : 1), P = A.pull * (g.big ? 1.3 : 1);
    areaOf(g, R, e => {
      e.grav = 0.2;
      const d = Math.hypot(g.x - e.x, g.y - e.y) || 1, w = Math.max(1, e.r / 16);
      if (d > 36) { e.kx += (g.x - e.x) / d * P * 8 * dt / w; e.ky += (g.y - e.y) / d * P * 8 * dt / w; }
    }, () => {
      const d = Math.hypot(g.x - me.x, g.y - me.y) || 1;
      if (d > 36) { me.vx += (g.x - me.x) / d * P * 3 * dt; me.vy += (g.y - me.y) / d * P * 3 * dt; }
    });
    if (g.implode && isMine(g.owner)) {
      g.impK = (g.impK ?? COMBO.implodeEvery) - dt;
      if (g.impK <= 0) {
        g.impK = COMBO.implodeEvery;
        if (targets().some(e => Math.hypot(e.x - g.x, e.y - g.y) <= R)) {
          const s = [Math.round(g.x), Math.round(g.y), 0.05, COMBO.implodeRadius * (g.big ? 1.3 : 1), COMBO.implodeDamage * (g.big ? 1.5 : 1)];
          G.strikes.push({ x: s[0], y: s[1], t: s[2], max: s[2], r: s[3], dmg: s[4], owner: g.owner });
          if (G.mode === 'mp') Net.send({ t: 'ult', k: 'imp', s: [s] });
          G.rings.push({ x: g.x, y: g.y, r: R, life: 0.5, max: 0.5, color: '125,95,255' });
          G.blooms.push({ x: g.x, y: g.y, r: 120, col: '#b8a6ff', life: 0.4, max: 0.4 });
          g.squeeze = 0.4;
        }
      }
    }
  }

  // burning (flame tower) and gravity slow wear off
  function updateBurn(dt) {
    const me = G.me, A = ABILITIES.flame;
    if (G.mode === 'sp') for (const e of [...G.enemies]) {
      if (e.grav > 0) e.grav -= dt;
      if (!(e.burnT > 0)) continue;
      e.burnT -= dt; e.burnK = (e.burnK || 0) - dt;
      if (Math.random() < 0.3) G.fx.push({ x: e.x + (Math.random() - 0.5) * e.r, y: e.y + (Math.random() - 0.5) * e.r, vx: 0, vy: -60, life: 0.4, max: 0.4, size: 5, color: Math.random() < 0.5 ? '#ff6b1a' : '#ffd32a' });
      if (e.burnK <= 0) { e.burnK = 0.5; hurtEnemy(e, A.burnDps * 0.5, 0, 0); }
    }
    if (me.burnT > 0) {
      me.burnT -= dt; me.burnK = (me.burnK || 0) - dt;
      if (Math.random() < 0.3) G.fx.push({ x: me.x + (Math.random() - 0.5) * me.r, y: me.y, vx: 0, vy: -60, life: 0.4, max: 0.4, size: 5, color: '#ff6b1a' });
      if (me.burnK <= 0 && me.alive) { me.burnK = 0.5; hurtMe(A.burnDps * 0.5, 0, 0, me.burnBy); }
    }
  }

  // ---- building juice: additive glow sprites (pre-rendered once per colour), landing pop, destruction debris
  const glowCache = {};
  const rgbOf = c => { const n = parseInt(c.slice(1), 16); return `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`; };
  function glowSprite(col) {
    let c = glowCache[col];
    if (c) return c;
    c = glowCache[col] = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32), rgb = rgbOf(col);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, `rgba(${rgb},0.95)`); gr.addColorStop(0.45, `rgba(${rgb},0.35)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return c;
  }
  function glow(x, y, r, col, a = 1) {
    if (r <= 0 || a <= 0) return;
    const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a) * ga;
    ctx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
  }
  const flashAt = (x, y, col, r = 26) => { if (G.blooms.length < 120) G.blooms.push({ x, y, r, col, life: 0.1, max: 0.1 }); };
  const easeBack = k => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
  // landing / build-up scale (call inside a save/restore)
  function popIn(age, x, y) {
    if (age === undefined || age >= BUILD_FX.land) return;
    const s = Math.max(0.05, easeBack(age / BUILD_FX.land));
    ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y);
  }
  // corner brackets that snap in onto a building while it's being built
  function buildBrackets(age, x, y, col, sc = 1) {
    if (age === undefined || age >= 0.7) return;
    const k = age / 0.7, r = (30 + (1 - k) * 40) * sc, L = 10 * sc;
    ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(x + sx * r, y + sy * (r - L)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - L), y + sy * r); }
    ctx.stroke(); ctx.restore();
    glow(x, y, 50 * sc * (1 - k), col, 0.6 * (1 - k));
  }
  function landFx(x, y, col, sc = 1) {
    G.rings.push({ x, y, r: 70 * sc, life: 0.4, max: 0.4, color: '220,220,220' });
    G.blooms.push({ x, y, r: 70 * sc, col, life: 0.35, max: 0.35 });
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.random() * 0.4, v = 90 + Math.random() * 60;
      G.fx.push({ x: x + Math.cos(a) * 18, y: y + Math.sin(a) * 18, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, max: 0.5, size: 10 + Math.random() * 6, color: 'rgba(170,160,140,0.45)' });
    }
    burst(x, y, col, 10, 220);
  }
  // a building blows up: fireball, smoke, tumbling debris
  function buildingBoom(x, y, col, sc = 1) {
    G.blooms.push({ x, y, r: 100 * sc, col: '#ffb347', life: 0.35, max: 0.35 }, { x, y, r: 60 * sc, col, life: 0.55, max: 0.55 });
    G.rings.push({ x, y, r: 120 * sc, life: 0.45, max: 0.45, color: '255,170,80' });
    if (G.debris.length < 160) for (let i = 0; i < BUILD_FX.debris * sc; i++) {
      const a = Math.random() * Math.PI * 2, v = 100 + Math.random() * 260;
      G.debris.push({ x, y, z: 8, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 220 + Math.random() * 320, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18,
        w: (4 + Math.random() * 7) * Math.max(0.6, sc), h: (3 + Math.random() * 5) * Math.max(0.6, sc), col: i % 3 ? '#3b404c' : col, life: 1.3 + Math.random() * 0.6 });
    }
    for (let i = 0; i < BUILD_FX.smoke * sc; i++) G.fx.push({ x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 40, life: 0.9, max: 0.9, size: (16 + Math.random() * 14) * sc, color: 'rgba(55,55,60,0.5)' });
    burst(x, y, '#ffd36b', Math.round(18 * sc), 380);
    G.shake = Math.max(G.shake || 0, 8 * sc);
  }
  function gadgetBoom(g) {
    const col = ABILITIES[g.kind].color;
    if (g.rect) { const [x, y, w, h] = g.rect; for (let i = 0; i < 3; i++) buildingBoom(x + w * (i + 0.5) / 3, y + h * (i + 0.5) / 3, col, 0.6); }
    else buildingBoom(g.x, g.y, col, g.sc || 1);
  }
  function updateJuice(dt) {
    for (const b of G.blooms) b.life -= dt;
    G.blooms = G.blooms.filter(b => b.life > 0);
    for (const d of G.debris) {
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.vz -= 1100 * dt; d.rot += d.vr * dt; d.life -= dt;
      if (d.z < 0) { d.z = 0; d.vz *= -0.35; d.vx *= 0.55; d.vy *= 0.55; d.vr *= 0.5; }
    }
    G.debris = G.debris.filter(d => d.life > 0);
  }
  function drawJuice() {
    for (const d of G.debris) {
      const a = Math.min(1, d.life * 2);
      ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#000'; ctx.fillRect(d.x - d.w / 2 + 2, d.y - d.h / 2 + 3, d.w, d.h);
      ctx.globalAlpha = a; ctx.save(); ctx.translate(d.x, d.y - d.z); ctx.rotate(d.rot);
      ctx.fillStyle = d.col; ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-d.w / 2, -d.h / 2, d.w, 1.5);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const b of G.blooms) { const k = b.life / b.max; glow(b.x, b.y, b.r * (0.7 + 0.3 * (1 - k)), b.col, k); }
  }

  function updateGadgetList(dt) {
    const me = G.me;
    for (const g of G.gadgets) {
      if (g.dead) continue;
      const A = ABILITIES[g.kind];
      const ldt = dt * lvlRate(g);
      g.t -= dt; g.age += dt; g.tick -= ldt;
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
      if (g.kind === 'blackhole' && g.vortex && g.tick <= 0) { // inferno vortex burns enemies
        g.tick = 0.5;
        areaOf(g, A.radius, e => hurtEnemy(e, COMBO.vortexDps / 2, 0.1, Math.atan2(e.y - g.y, e.x - g.x)),
          () => hurtMe(COMBO.vortexDps / 2, 0, Math.atan2(me.y - g.y, me.x - g.x), g.owner));
      }
      if (g.kind === 'blackhole' && g.vortex && Math.random() < 0.7) {
        const an = Math.random() * Math.PI * 2, d = A.radius * (0.3 + Math.random() * 0.6);
        G.fx.push({ x: g.x + Math.cos(an) * d, y: g.y + Math.sin(an) * d, vx: -Math.sin(an) * 200 - Math.cos(an) * 120, vy: Math.cos(an) * 200 - Math.sin(an) * 120, life: 0.5, max: 0.5, size: 7, color: Math.random() < 0.5 ? '#ff6b1a' : '#ffd32a' });
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
      if (g.kind === 'tesla' && g.stormtower && isMine(g.owner) && G.mode === 'sp') { // STORM TOWER: lightning falls from its cloud
        const F = FORMATIONS.stormtower;
        g.boltK = (g.boltK ?? F.boltEvery) - dt;
        if (g.boltK <= 0) {
          g.boltK = F.boltEvery;
          const inR = G.enemies.filter(e => Math.hypot(e.x - g.x, e.y - g.y) <= teslaRange(g, A) * 1.3);
          for (let i = 0; i < F.bolts && inR.length; i++) {
            const e = inR.splice(Math.floor(Math.random() * inR.length), 1)[0];
            g.zaps.push({ x: e.x, y: e.y, fx: e.x + (Math.random() - 0.5) * 60, fy: e.y - 420, life: 0.25, sky: 1 });
            hurtEnemy(e, F.boltDmg, 1, -Math.PI / 2); flashAt(e.x, e.y, '#d6d2ff', 40);
          }
        }
      }
      if (g.kind === 'tesla' && g.tick <= 0) {
        const dmg = A.damage * (g.plasma ? 2 : 1) * (g.stormtower ? FORMATIONS.stormtower.dmgMul : 1), R = teslaRange(g, A);
        g.tick = A.every * (g.stormtower ? FORMATIONS.stormtower.everyMul : 1);
        if (isMine(g.owner)) {
          for (const e of (G.mode === 'sp' ? [...G.enemies] : targets())) {
            if (Math.hypot(e.x - g.x, e.y - g.y) > R || !lineOfSight(g.x, g.y, e.x, e.y)) continue;
            g.zaps.push({ x: e.x, y: e.y, life: 0.15 });
            if (G.mode === 'sp') { hurtEnemy(e, dmg, 0.5, Math.atan2(e.y - g.y, e.x - g.x)); if (g.cryo) e.frozen = Math.max(e.frozen || 0, COMBO.cryoFreeze); }
            if ((g.storm || g.stormtower) && G.mode === 'sp') stormChain(g, e, A, dmg);
          }
        } else if (me.alive && hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= R && lineOfSight(g.x, g.y, me.x, me.y)) {
          g.zaps.push({ x: me.x, y: me.y, life: 0.15 });
          hurtMe(dmg, 0.5, Math.atan2(me.y - g.y, me.x - g.x), g.owner);
          if (g.cryo) me.frozenT = Math.max(me.frozenT, COMBO.cryoFreeze * 0.6);
        }
      }
      if (g.kind === 'mortar') updateMortar(g, A);
      if (g.kind === 'sniper') updateSniper(g, A, ldt);
      if (g.kind === 'shieldgen') updateShieldGen(g, A);
      if (g.kind === 'flame') updateFlame(g, A, ldt);
      if (g.kind === 'laser') updateLaser(g, A, ldt);
      if (g.kind === 'hangar') updateHangar(g, A, ldt);
      if (g.kind === 'gravity') updateGravity(g, A, ldt);
      if (g.kind === 'mine' && g.age > A.arm) {
        let boom = false;
        if (isMine(g.owner)) boom = targets().some(e => Math.hypot(e.x - g.x, e.y - g.y) <= A.trigger + (e.r || PLAYER.r));
        else boom = me.alive && hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= A.trigger + me.r;
        if (boom) {
          mineBoom(g);
          if (G.mode === 'mp') Net.send({ t: 'gadx', id: g.id });
        }
      }
      if (g.kind === 'decoy' && isMine(g.owner)) (g.supply ? updateSupply : updateBuddy)(g, dt);
      if (g.kind === 'decoy' && g.medicBuddy && isMine(g.owner)) {
        g.healT -= dt;
        if (g.healT <= 0) {
          g.healT = 1;
          g.hp = Math.min(g.maxHp, g.hp + COMBO.buddyHeal);
          if (me.alive && me.hp < me.maxHp && Math.hypot(me.x - g.x, me.y - g.y) <= COMBO.buddyRadius) heal(COMBO.buddyHeal);
          healBuddies(g.x, g.y, COMBO.buddyRadius, COMBO.buddyHeal);
        }
      }
      if (g.kind === 'bubble' && g.heal && g.tick <= 0) {
        g.tick = 1;
        if (me.alive && me.hp < me.maxHp && !hostileTo(g.owner) && Math.hypot(me.x - g.x, me.y - g.y) <= A.radius) heal(COMBO.domeHeal);
        if (isMine(g.owner)) healBuddies(g.x, g.y, A.radius, COMBO.domeHeal);
      }
      if (g.kind === 'barrier' && g.fire && g.rect && Math.random() < 0.5) {
        const [rx, ry, rw, rh] = g.rect;
        G.fx.push({ x: rx + Math.random() * rw, y: ry + Math.random() * rh, vx: 0, vy: -70, life: 0.5, max: 0.5, size: 7, color: Math.random() < 0.5 ? '#ff6b1a' : '#ffd32a' });
      }
      if (g.kind === 'barrier' && g.ice && g.rect) { // ICE WALL: everything near it is chilled (slowed)
        const [rx, ry, rw, rh] = g.rect;
        const near = (x, y, r) => Math.hypot(x - clamp(x, rx, rx + rw), y - clamp(y, ry, ry + rh)) <= r + COMBO.iceNear;
        if (isMine(g.owner)) { if (G.mode === 'sp') for (const e of G.enemies) if (near(e.x, e.y, e.r)) e.chill = COMBO.iceTime; }
        else if (me.alive && hostileTo(g.owner) && near(me.x, me.y, me.r)) me.frozenT = Math.max(me.frozenT, COMBO.iceTime * 0.5);
      }
      if (g.kind === 'barrier' && (g.electric || g.fire) && g.rect && g.tick <= 0) {
        g.tick = 0.5;
        const dps = (g.electric ? COMBO.fenceDps : 0) + (g.fire ? COMBO.fireWallDps : 0);
        const [rx, ry, rw, rh] = g.rect;
        const touch = (x, y, r) => Math.hypot(x - clamp(x, rx, rx + rw), y - clamp(y, ry, ry + rh)) <= r + 14;
        if (isMine(g.owner)) {
          if (G.mode === 'sp') for (const e of [...G.enemies]) if (touch(e.x, e.y, e.r)) { hurtEnemy(e, dps / 2, 3, Math.atan2(e.y - g.y, e.x - g.x)); g.zaps.push({ x: e.x, y: e.y, life: 0.15 }); }
        } else if (me.alive && hostileTo(g.owner) && touch(me.x, me.y, me.r)) { hurtMe(dps / 2, 3, Math.atan2(me.y - g.y, me.x - g.x), g.owner); g.zaps.push({ x: me.x, y: me.y, life: 0.15 }); }
      }
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
    if (G.mode === 'sp') for (const e of G.enemies) { if (e.frozen > 0) e.frozen -= dt; if (e.chill > 0) e.chill -= dt; }
    updateBurn(dt);
  }
  // Buddy (decoy): a teammate bot with a copy of your main gun that hunts enemies
  // heal sources (heal zones, medic turrets, medic buddies, healing domes) also patch up your buddies
  function healBuddies(x, y, r, amount) {
    for (const b of G.gadgets) {
      if (b.kind !== 'decoy' || b.dead || !isMine(b.owner) || b.hp >= b.maxHp || Math.hypot(b.x - x, b.y - y) > r) continue;
      b.hp = Math.min(b.maxHp, b.hp + amount);
      G.texts.push({ x: b.x, y: b.y - 34, text: `+${amount}`, color: '#4cff7a', life: 0.7 });
    }
  }

  // another of your decoys to stay near: the most hurt one (hurtFirst) or simply the closest
  function mateFor(g, hurtFirst) {
    let pick = null, score = Infinity;
    for (const b of G.gadgets) {
      if (b === g || b.kind !== 'decoy' || b.dead || b.supply || b.medicBuddy || !isMine(b.owner)) continue;
      const d = Math.hypot(b.x - g.x, b.y - g.y), sc = hurtFirst ? (b.hp / b.maxHp) * 10000 + d : d;
      if (sc < score) { pick = b; score = sc; }
    }
    return pick;
  }

  // SUPPLY DECOY: no gun, never attacks. Goes round your decoys (new ones and low ones) giving each 3 mags.
  function updateSupply(g, dt) {
    // visits every new decoy once (then the next one), and comes back to any that run low again
    const me = G.me, low = b => b.kind === 'decoy' && !b.supply && !b.dead && isMine(b.owner) && b.stats && (!b.supplied || b.ammo + b.reserve <= b.stats.magSize);
    let tgt = null, bd = Infinity;
    for (const b of G.gadgets) if (low(b)) { const d = Math.hypot(b.x - g.x, b.y - g.y); if (d < bd) { tgt = b; bd = d; } }
    let mx = 0, my = 0;
    if (tgt) {
      if (bd < 46) { // hand over the mags
        tgt.reserve += tgt.stats.magSize * COMBO.supplyMags;
        tgt.supplied = true;
        if (tgt.ammo === 0) { const k = Math.min(tgt.stats.magSize, tgt.reserve); tgt.ammo = k; tgt.reserve -= k; }
        G.texts.push({ x: tgt.x, y: tgt.y - 34, text: `+${COMBO.supplyMags} MAGS`, color: '#fff200', life: 1 });
        burst(tgt.x, tgt.y, '#fff200', 12, 180);
      } else ({ x: mx, y: my } = buddyPath(g, tgt.x, tgt.y, dt));
    } else {
      // no decoy needs anything: only come to you if YOU need ammo, then hand you mags
      const room = gn => gn.stats.magSize + gn.stats.maxReserve - gn.ammo - gn.reserve;
      const gun = me.guns.find(gn => room(gn) > 0 && gn.stats.boxRefill > 0);
      const d = Math.hypot(me.x - g.x, me.y - g.y);
      g.giveCd = Math.max(0, (g.giveCd || 0) - dt);
      const mate = !gun || !me.alive ? mateFor(g, false) : null;
      if (mate && Math.hypot(mate.x - g.x, mate.y - g.y) > 70) ({ x: mx, y: my } = buddyPath(g, mate.x, mate.y, dt)); // nothing to do: tag along with the nearest decoy
      if (gun && me.alive) {
        if (d > 55) ({ x: mx, y: my } = buddyPath(g, me.x, me.y, dt));
        else if (g.giveCd === 0) {
          g.giveCd = 1;
          for (const gn of me.guns) if (room(gn) > 0 && gn.stats.boxRefill > 0) gn.reserve += Math.min(room(gn), gn.stats.boxRefill * COMBO.supplyMags);
          G.texts.push({ x: me.x, y: me.y - 34, text: `+${COMBO.supplyMags} MAGS`, color: '#fff200', life: 1 });
          updateWeaponBar(true);
        }
      }
    }
    if (mx || my) g.aim = Math.atan2(my, mx);
    g.x += mx * ABILITIES.decoy.speed * COMBO.supplySpeed * dt; g.y += my * ABILITIES.decoy.speed * COMBO.supplySpeed * dt; // a bit faster than every other decoy
    collideWorld(g);
  }

  // where a buddy that needs ammo or healing should go (null = nothing to go for)
  function buddyNeed(g) {
    const A = ABILITIES.decoy, near = list => list.reduce((b, o) => (!b || Math.hypot(o.x - g.x, o.y - g.y) < Math.hypot(b.x - g.x, b.y - g.y) ? o : b), null);
    if (g.stats && g.ammo === 0 && g.reserve === 0) {
      const box = near([...G.packs.filter(p => p.kind === 'ammo' || p.kind === 'supply'), ...G.gadgets.filter(o => o.supply && !o.dead && isMine(o.owner))]);
      if (box) return { x: box.x, y: box.y, why: 'ammo' };
    }
    // between waves it tops up on any healing in the 8x8 squares around it; during a fight only when it's low
    const between = G.mode === 'sp' && G.phase === 'break', box = A.healBox * MAP.grid / 2;
    if (g.hp < g.maxHp * A.lowHp || (between && g.hp < g.maxHp)) {
      let spots = [
        ...G.packs.filter(p => !p.kind),                                   // green health packs
        ...G.zones.map(z => ({ x: z.x, y: z.y })),                         // heal zones
        ...G.turrets.filter(t => t.medic),                                  // medic + heal turrets
        ...G.gadgets.filter(o => o !== g && !o.dead && isMine(o.owner) && (o.medicBuddy || (o.kind === 'bubble' && o.heal))),
      ];
      if (between && g.hp >= g.maxHp * A.lowHp) spots = spots.filter(o => Math.abs(o.x - g.x) <= box && Math.abs(o.y - g.y) <= box);
      const h = near(spots);
      if (h) return { x: h.x, y: h.y, why: 'heal' };
    }
    return null;
  }

  function updateBuddy(g, dt) {
    const A = ABILITIES.decoy;
    const best = buddyTarget(g), bd = best ? Math.hypot(best.x - g.x, best.y - g.y) : Infinity;
    let mx = 0, my = 0;
    const sees = best && lineOfSight(g.x, g.y, best.x, best.y) && !smokeBlocks(g.x, g.y, best.x, best.y);
    // reload from the spare mag
    if (g.stats && g.ammo === 0 && g.reserve > 0) {
      g.reloadT += dt;
      if (g.reloadT >= g.stats.reloadTime) { g.reloadT = 0; const n = Math.min(g.stats.magSize, g.reserve); g.ammo = n; g.reserve -= n; }
    }
    // pick up ammo boxes / health packs it walks over
    for (const p of G.packs) {
      if (Math.hypot(p.x - g.x, p.y - g.y) > g.r + HEALTH_PACK.r) continue;
      if (p.kind === 'supply' && g.stats && g.ammo + g.reserve < g.stats.magSize * (1 + A.spareMags)) {
        g.ammo = g.stats.magSize; g.reserve = g.stats.magSize * A.spareMags;
        G.texts.push({ x: g.x, y: g.y - 34, text: 'RESUPPLIED', color: '#fff200', life: 0.9 });
        p.mags--;
        if (p.mags > 0) { if (G.mode === 'mp') Net.send({ t: 'boxm', id: p.id, mags: p.mags }); break; }
        removePack(p.id);
        if (G.mode === 'mp') Net.send({ t: 'took', id: p.id });
        break;
      }
      if (p.kind === 'ammo' && g.stats && g.ammo + g.reserve < g.stats.magSize * (1 + A.spareMags)) {
        // take only the mags it needs; the rest stays in the box
        p.mags = p.mags ?? AMMO.box.mags;
        const ms = g.stats.magSize, missing = ms * (1 + A.spareMags) - g.ammo - g.reserve, take = Math.min(Math.ceil(missing / ms), p.mags);
        g.reserve += Math.min(missing, take * ms);
        if (g.ammo === 0) { const n = Math.min(ms, g.reserve); g.ammo = n; g.reserve -= n; }
        p.mags -= take;
        G.texts.push({ x: g.x, y: g.y - 34, text: `+${take} MAG${take > 1 ? 'S' : ''}`, color: '#ffd23f', life: 0.9 });
        if (p.mags > 0) { if (G.mode === 'mp') Net.send({ t: 'boxm', id: p.id, mags: p.mags }); break; }
        removePack(p.id);
        if (G.mode === 'mp') Net.send({ t: 'took', id: p.id });
        break;
      }
      else if (!p.kind && g.hp < g.maxHp) g.hp = Math.min(g.maxHp, g.hp + HEALTH_PACK.heal);
      else continue;
      G.texts.push({ x: g.x, y: g.y - 34, text: p.kind === 'ammo' ? '+AMMO' : `+${HEALTH_PACK.heal}`, color: p.kind === 'ammo' ? '#ffd23f' : '#4cff7a', life: 0.9 });
      removePack(p.id);
      if (G.mode === 'mp') Net.send({ t: 'took', id: p.id });
      break;
    }
    const need = buddyNeed(g);
    g.need = need && need.why;
    if (need) { // out of ammo / hurt: head for supplies, still turning to face enemies it can see
      g.roam = null;
      ({ x: mx, y: my } = buddyPath(g, need.x, need.y, dt));
      if (Math.hypot(need.x - g.x, need.y - g.y) < 30) mx = my = 0; // sitting in a heal zone
      g.aim = sees ? Math.atan2(best.y - g.y, best.x - g.x) : (mx || my ? Math.atan2(my, mx) : g.aim);
    } else if (g.medicBuddy && (g.mate = mateFor(g, true))) {
      // MEDIC BUDDY: hangs around your other decoys (the most hurt one first) and shoots what it can see
      g.roam = null;
      if (Math.hypot(g.mate.x - g.x, g.mate.y - g.y) > 80) ({ x: mx, y: my } = buddyPath(g, g.mate.x, g.mate.y, dt));
      g.aim = sees ? Math.atan2(best.y - g.y, best.x - g.x) : (mx || my ? Math.atan2(my, mx) : g.aim);
    } else if (best) {
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
    // decoys can't stand in the same spot: push apart
    for (const o of G.gadgets) {
      if (o === g || o.kind !== 'decoy' || o.dead || o.owner !== g.owner) continue;
      const dx = g.x - o.x, dy = g.y - o.y, d = Math.hypot(dx, dy) || 0.01, min = PLAYER.r * 2;
      if (d < min) { const push = (min - d) / 2; g.x += dx / d * push; g.y += dy / d * push; o.x -= dx / d * push; o.y -= dy / d * push; }
    }
    collideWorld(g);
    g.cd -= dt;
    g.kick = Math.max(0, g.kick - 40 * dt);
    // COMMAND TOWER: buddies near your command radar shoot faster and harder
    g.cmd = G.gadgets.some(r => r.kind === 'radar' && r.command && !r.dead && isMine(r.owner) && Math.hypot(r.x - g.x, r.y - g.y) <= COMBO.cmdRadius * (r.big ? MERGE.range : 1));
    if (sees && bd < g.stats.range && g.cd <= 0 && g.ammo > 0) {
      const s = g.stats;
      g.ammo--;
      g.cd = Math.max(s.fireDelay, 0.12) * (g.cmd ? COMBO.cmdFire : 1);
      g.kick = 4;
      shootFrom(g.x + Math.cos(g.aim) * 30, g.y + Math.sin(g.aim) * 30, g.aim, g.cmd ? { ...s, damage: s.damage * COMBO.cmdDmg } : s);
    }
  }

  // DECOY AI: spread out. Take the nearest enemy nobody else is on; if another decoy already has it,
  // go for the next nearest, unless that enemy has more than 2 enemies around it (then help out).
  // TEAMWORK: hand out your buddies and drones to enemies, most dangerous first, until strength >= danger
  const dangerOf = e => e.mini ? DANGER.mini : DANGER[e.type] ?? 5;
  // an enemy that hits your decoy / drones counts DANGER.attackMul x as dangerous, but only for that decoy / hangar
  function markAttack(g, e) { if (G.mode === 'sp' && e && g && isMine(g.owner)) (g.atk ||= new Map()).set(e, G.time); }
  function assignTeam(dt) {
    G.teamT = (G.teamT || 0) - dt;
    if (G.mode !== 'sp' || G.teamT > 0) return;
    G.teamT = 0.25;
    const units = [];
    for (const g of G.gadgets) {
      if (g.dead || !isMine(g.owner)) continue;
      if (g.kind === 'decoy' && !g.supply && !g.medicBuddy && g.stats) { g.assigned = null; units.push({ u: g, x: g.x, y: g.y, str: STRENGTH.decoy, reach: DECOY_AI.maxSpread }); }
      if (g.kind === 'hangar' && g.drones) {
        const A = ABILITIES.hangar, R = A.range * (g.big ? MERGE.range : 1) * (g.carrier ? FORMATIONS.carrier.range : 1);
        const str = g.carrier ? STRENGTH.carrierDrone : g.big ? STRENGTH.bigDrone : STRENGTH.drone;
        for (const d of g.drones) { d.assigned = null; if (d.alive) units.push({ u: d, x: d.x, y: d.y, str, home: g, reach: R }); }
      }
    }
    const canReach = (k, e) => Math.hypot(e.x - (k.home ? k.home.x : k.x), e.y - (k.home ? k.home.y : k.y)) <= k.reach;
    const foes = G.enemies.filter(e => e.hp > 0), distMe = e => Math.hypot(e.x - G.me.x, e.y - G.me.y);
    // jobs: every enemy once, plus an extra job (danger x3) for each building it attacked, only that building's units can take it
    const jobs = foes.map(e => ({ e, danger: dangerOf(e) }));
    for (const g of G.gadgets) {
      if (!g.atk) continue;
      for (const [e, t] of g.atk) {
        if (G.time - t > DANGER.attackFor || !foes.includes(e)) { g.atk.delete(e); continue; }
        jobs.push({ e, danger: dangerOf(e) * DANGER.attackMul, only: g });
      }
    }
    jobs.sort((a, b) => b.danger - a.danger || distMe(a.e) - distMe(b.e));
    const free = new Set(units), sent = new Map(); // strength already sent at each enemy
    for (const j of jobs) {
      let need = j.danger - (sent.get(j.e) || 0);
      const near = [...free].filter(k => (!j.only || k.u === j.only || k.home === j.only) && canReach(k, j.e))
        .sort((a, b) => Math.hypot(a.x - j.e.x, a.y - j.e.y) - Math.hypot(b.x - j.e.x, b.y - j.e.y));
      for (const k of near) { if (need <= 0) break; k.u.assigned = j.e; free.delete(k); need -= k.str; sent.set(j.e, (sent.get(j.e) || 0) + k.str); }
      if (!free.size) break;
    }
    // anyone left over helps with the closest enemy they can reach
    for (const k of free) {
      let best = null, bd = Infinity;
      for (const e of foes) { const d = Math.hypot(e.x - k.x, e.y - k.y); if (d < bd && canReach(k, e)) { best = e; bd = d; } }
      k.u.assigned = best;
    }
  }

  function buddyTarget(g) {
    if (G.mode === 'sp' && g.assigned && g.assigned.hp > 0 && G.enemies.includes(g.assigned)) return (g.target = g.assigned);
    const list = targets(), D = DECOY_AI;
    const sorted = list.map(t => ({ t, d: Math.hypot(t.x - g.x, t.y - g.y) })).sort((a, b) => a.d - b.d || a.t.x - b.t.x);
    if (!sorted.length) return (g.target = null);
    const crowd = t => list.filter(o => Math.hypot(o.x - t.x, o.y - t.y) < D.crowdRadius).length;
    const others = G.gadgets.filter(o => o !== g && o.kind === 'decoy' && !o.dead && o.owner === g.owner);
    let pick = null;
    for (const { t, d } of sorted) {
      if (d > D.maxSpread && pick === null && sorted[0].d < D.maxSpread) break; // don't run across the map for a spare one
      const taken = others.some(o => o.target === t);
      if (!taken || crowd(t) > D.crowd) { pick = t; break; }
    }
    return (g.target = pick || sorted[0].t);
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
  function shootFrom(sx, sy, aim, s, extra = {}) {
    const angles = [];
    for (let i = 0; i < s.pellets; i++) {
      const fan = s.pellets > 1 ? (i / (s.pellets - 1) - 0.5) * s.spread : 0;
      angles.push(+(aim + fan + (Math.random() - 0.5) * s.spread).toFixed(4));
    }
    fireBullets(sx, sy, angles, s.speed, s.damage, s.knockback, extra.range || s.range, s.hearRadius, { bounce: s.bounce, pierce: s.pierce, boom: s.boom, ...extra.kind }, s.falloff);
    muzzleFlash(sx, sy, aim);
  }

  // buildings and your buddy can be shot. Returns true if the bullet was stopped.
  // The owner keeps track of the HP and tells everyone when it breaks.
  function bulletHitsGadget(b, x1, y1) {
    // your turrets (only on your screen)
    const hostileToMe = G.mode === 'sp' ? b.team === 'e' : b.team === 'r' && hostileTo(b.owner);
    if (hostileToMe) for (const t of G.turrets) {
      if (t.hp <= 0 || !segHitsCircle(x1, y1, b.x, b.y, t.x, t.y, t.fort ? 36 : t.rail ? 30 : t.rocket ? 26 : 18)) continue;
      if (t.shieldT > 0) { burst(b.x, b.y, '#7ef9ff', 4, 120); return true; } // shielded turret
      if (t.fort) { t.lastHit = G.time; if (t.sh > 0) { t.sh -= bulletDamage(b); t.shHit = 0.15; burst(b.x, b.y, '#a29bfe', 5, 140); return true; } }
      t.hp -= bulletDamage(b) * (t.bunker ? COMBO.bunkerTake : 1); t.flash = 0.1;
      if (t.hp <= 0) { t.t = 0; buildingBoom(t.x, t.y, '#cd84f1', t.fort ? 1.9 : t.rail ? 1.6 : t.rocket ? 1.3 : 1); }
      return true;
    }
    if (hostileToMe && bulletHitsDrone(b, x1, y1)) return true;
    for (const g of G.gadgets) {
      if (g.kind === 'bubble') {
        const R = ABILITIES.bubble.radius * Math.min(1, g.age / 0.25);
        const hostile = G.mode === 'sp' ? b.team === 'e' : b.owner !== g.owner && (!G.teams || teamOf(b.owner) !== teamOf(g.owner));
        if (hostile && Math.hypot(b.x - g.x, b.y - g.y) < R && Math.hypot(x1 - g.x, y1 - g.y) >= R - 2) { burst(b.x, b.y, '#7ef9ff', 4, 120); return true; }
        continue;
      }
      if (g.hp === undefined || g.dead || g.kind === 'barrier') continue;
      const hostile = G.mode === 'sp' ? b.team === 'e'
        : b.owner !== g.owner && (!G.teams || teamOf(b.owner) !== teamOf(g.owner));
      if (!hostile || !segHitsCircle(x1, y1, b.x, b.y, g.x, g.y, g.kind === 'decoy' ? PLAYER.r : 22 * (g.sc || 1))) continue;
      markAttack(g, b.src); damageGadget(g, bulletDamage(b));
      return true;
    }
    return false;
  }
  function damageGadget(g, dmg) {
    g.flash = 0.1;
    if (!isMine(g.owner)) return;
    if (g.sh > 0) { const soak = Math.min(g.sh, dmg); g.sh -= soak; dmg -= soak; } // shield generator overshield
    g.hp -= dmg;
    if (g.hp <= 0) {
      if (ABILITIES[g.kind].building) gadgetBoom(g); else burst(g.x, g.y, ABILITIES[g.kind].color, 24, 300);
      removeGadget(g);
      if (G.mode === 'mp') Net.send({ t: 'gadx', id: g.id });
    }
  }

  function mineBoom(g) {
    if (g.dead) return;
    const A = ABILITIES.mine;
    removeGadget(g);
    explode(g.x, g.y, A.radius, A.damage, g.owner);
    if (g.cryo) { // cryo mine freezes everyone around it too
      G.rings.push({ x: g.x, y: g.y, r: A.radius * 1.3, life: 0.6, max: 0.6, color: '126,214,255' });
      areaAll({ x: g.x, y: g.y, owner: g.owner }, A.radius * 1.3, e => { e.frozen = COMBO.cryoMineFreeze; },
        () => { if (hostileTo(g.owner)) G.me.frozenT = COMBO.cryoMineFreeze; });
    }
  }

  function drawGadgetList() {
    for (const g of G.gadgets) {
      const A = ABILITIES[g.kind], pop = Math.min(1, g.age / 0.25);
      g.flash = Math.max(0, (g.flash || 0) - 1 / 60);
      ctx.save();
      if (A.building) popIn(g.age, g.x, g.y);
      if (g.kind === 'blackhole') {
        const r = A.radius * pop;
        const grd = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, r);
        if (g.vortex) { grd.addColorStop(0, 'rgba(0,0,0,0.95)'); grd.addColorStop(0.3, 'rgba(200,60,0,0.7)'); grd.addColorStop(1, 'rgba(255,107,26,0)'); }
        else { grd.addColorStop(0, 'rgba(0,0,0,0.95)'); grd.addColorStop(0.25, 'rgba(60,20,90,0.7)'); grd.addColorStop(1, 'rgba(142,68,173,0)'); }
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(200,140,255,0.6)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(g.x, g.y, r * (0.3 + 0.2 * i), G.time * (3 + i) , G.time * (3 + i) + 2); ctx.stroke(); }
      } else if (g.kind === 'bubble') {
        const r = A.radius * pop;
        ctx.fillStyle = g.heal ? 'rgba(50,255,126,0.16)' : 'rgba(126,249,255,0.12)'; ctx.strokeStyle = g.heal ? `rgba(50,255,126,${0.6 + 0.2 * Math.sin(G.time * 6)})` : `rgba(126,249,255,${0.5 + 0.2 * Math.sin(G.time * 6)})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(g.x, g.y, r * 0.8, -2.4, -1.6); ctx.stroke();
      } else if (g.kind === 'firepit') {
        ctx.fillStyle = 'rgba(255,107,26,0.25)'; ctx.strokeStyle = 'rgba(255,160,40,0.7)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(g.x, g.y, A.radius * pop, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (g.kind === 'decoy') {
        if (g.medicBuddy) {
          const k = (G.time % 1.2) / 1.2;
          ctx.strokeStyle = `rgba(50,255,126,${0.5 * (1 - k)})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(g.x, g.y, 24 + k * (COMBO.buddyRadius - 24), 0, Math.PI * 2); ctx.stroke();
        }
        drawPlayer({ x: g.x, y: g.y, aim: g.aim ?? g.a, kick: g.kick || 0 }, g.supply ? '#e1b12c' : g.color, g.sprite, g.flash > 0);
        if (g.supply) { // ammo crate on its back
          ctx.fillStyle = '#c99a1e'; ctx.strokeStyle = '#4a3700'; ctx.lineWidth = 2;
          ctx.fillRect(g.x - 9, g.y - 6, 18, 12); ctx.strokeRect(g.x - 9, g.y - 6, 18, 12);
          ctx.fillStyle = '#ffe27a'; ctx.fillRect(g.x - 6, g.y - 3, 3, 6); ctx.fillRect(g.x - 1.5, g.y - 3, 3, 6); ctx.fillRect(g.x + 3, g.y - 3, 3, 6);
        }
        if (g.medicBuddy) { ctx.fillStyle = '#32ff7e'; ctx.fillRect(g.x - 3, g.y - 9, 6, 18); ctx.fillRect(g.x - 9, g.y - 3, 18, 6); }
        drawBar(g.x, g.y - PLAYER.r - 14, 54, 7, g.hp / g.maxHp, false, hostileTo(g.owner) ? '#ff5050' : '#4aa3ff');
        nameTag(g.supply ? `${g.name}'s supply` : `${g.name}'s buddy`, g.x, g.y - PLAYER.r - 20, hostileTo(g.owner) ? '#ff5050' : '#4aa3ff');
        if (isMine(g.owner) && g.stats) {
          const txt = g.ammo === 0 && g.reserve === 0 ? 'NO AMMO' : g.ammo === 0 ? 'RELOADING' : g.need === 'heal' ? 'HEALING' : `${g.ammo}/${g.reserve}`;
          ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillStyle = txt === 'NO AMMO' ? '#ff6b6b' : txt === 'HEALING' ? '#4cff7a' : '#ffd23f';
          ctx.fillText(txt, g.x, g.y + PLAYER.r + 14);
        }
      } else if (g.kind === 'barrier' && g.rect) {
        drawBarrier(g);
      } else if (g.kind === 'mine') {
        if (!hostileTo(g.owner)) { // enemies can't see your mines
          ctx.fillStyle = g.cryo ? '#4a6a80' : '#3d3d3d'; ctx.strokeStyle = g.cryo ? '#7ed6ff' : '#c0392b'; ctx.lineWidth = 2;
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
        drawRadar(g);
      } else if (g.kind === 'tesla') {
        drawTesla(g, A);
      } else if (g.kind === 'mortar') {
        drawMortar(g);
      } else if (g.kind === 'shieldgen') {
        drawShieldGen(g, A);
      } else if (g.kind === 'sniper') {
        drawSniper(g);
      } else if (g.kind === 'flame') {
        drawFlame(g, A);
      } else if (g.kind === 'laser') {
        drawLaser(g, A);
      } else if (g.kind === 'hangar') {
        drawHangar(g, A);
      } else if (g.kind === 'gravity') {
        drawGravity(g, A);
      }
      ctx.restore();
    }
    for (const g of G.gadgets) if (ABILITIES[g.kind].building && g.age < 0.7) buildBrackets(g.age, g.x, g.y, ABILITIES[g.kind].color, g.sc || 1);
    for (const r of G.rings) {
      const k = 1 - r.life / r.max;
      ctx.strokeStyle = `rgba(${r.color},${1 - k})`; ctx.lineWidth = 8 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.2 + 0.8 * k), 0, Math.PI * 2); ctx.stroke();
    }
    // chilled enemies (ice wall) get a frosty ring, frozen ones an ice shell
    if (G.mode === 'sp') for (const e of G.enemies) if (e.chill > 0 && !(e.frozen > 0) && canSee(e.x, e.y, e.r)) {
      ctx.strokeStyle = 'rgba(158,231,255,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    if (G.mode === 'sp') for (const e of G.enemies) if (e.frozen > 0 && canSee(e.x, e.y, e.r)) {
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

  // ---- building art (cheap layered vector shapes: shadow, dark rim, face, highlight)
  const hash01 = k => { const v = Math.sin(k * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const DASH = [10, 8], NODASH = [];
  function bShadow(rx, ry) { ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.beginPath(); ctx.ellipse(3, 6, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function bPoly(n, r, rot) { ctx.beginPath(); for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); }
  function bBolts(n, r, rot, col) { ctx.fillStyle = col; for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; ctx.fillRect(Math.cos(a) * r - 1.5, Math.sin(a) * r - 1.5, 3, 3); } }
  // big (merged) buildings: gold corner plates instead of a plain outline
  function bGoldCorners(r) {
    ctx.fillStyle = '#7a5c0e';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.fillRect(sx * r - (sx > 0 ? 9 : 0), sy * r - (sy > 0 ? 3 : 0), 9, 3); ctx.fillRect(sx * r - (sx > 0 ? 3 : 0), sy * r - (sy > 0 ? 9 : 0), 3, 9); }
    ctx.fillStyle = '#ffd700';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.fillRect(sx * r - (sx > 0 ? 8 : -1), sy * r - (sy > 0 ? 2 : -1), 7, 1.5); ctx.fillRect(sx * r - (sx > 0 ? 2 : -1), sy * r - (sy > 0 ? 8 : -1), 1.5, 7); }
  }
  function bGoldRing(n, r, rot) { ctx.strokeStyle = '#7a5c0e'; ctx.lineWidth = 4; bPoly(n, r, rot); ctx.stroke(); ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.5; bPoly(n, r, rot); ctx.stroke(); }
  function bSpark(x, y, len, col) { // little jagged arc
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y);
    const a = Math.random() * Math.PI * 2;
    for (let i = 1; i <= 3; i++) ctx.lineTo(x + Math.cos(a) * len * i / 3 + (Math.random() - 0.5) * 6, y + Math.sin(a) * len * i / 3 + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }

  function drawBarrier(g) {
    const [x, y, w, h] = g.rect, horiz = w >= h, L = horiz ? w : h;
    // [face, mid, dark edge, highlight]
    const pal = g.ice ? ['#cdefff', '#86cdee', '#3a7ca3', '#ffffff'] : g.fire ? ['#ff9a4d', '#d9531a', '#5e1e06', '#ffd29a']
      : g.electric ? ['#ffe08a', '#d6a42a', '#5e480f', '#fff7d6'] : ['#8ea7c6', '#5d7695', '#253246', '#dbe8f7'];
    if (g.ice) { ctx.fillStyle = 'rgba(158,231,255,0.10)'; ctx.fillRect(x - COMBO.iceNear, y - COMBO.iceNear, w + COMBO.iceNear * 2, h + COMBO.iceNear * 2); }
    ctx.fillStyle = 'rgba(0,0,0,0.33)'; ctx.fillRect(x + 4, y + 6, w, h);
    const n = Math.max(2, Math.round(L / 24)), seg = L / n;
    const frac = g.maxHp && g.maxHp !== Infinity ? Math.max(0, g.hp / g.maxHp) : 1, dmg = (1 - frac) * 1.3, seed = (g.x * 0.37 + g.y * 0.71) | 0;
    for (let i = 0; i < n; i++) {
      const sx = horiz ? x + i * seg : x, sy = horiz ? y : y + i * seg, sw = horiz ? seg : w, sh = horiz ? h : seg;
      ctx.fillStyle = pal[2]; ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = pal[1]; ctx.fillRect(sx + 1, sy + 1, sw - 2, sh - 2);
      ctx.fillStyle = pal[0]; ctx.fillRect(sx + 3, sy + 3, sw - 6, sh - 7);
      ctx.fillStyle = pal[3]; if (horiz) ctx.fillRect(sx + 3, sy + 3, sw - 6, 2); else ctx.fillRect(sx + 3, sy + 3, 2, sh - 7);
      ctx.fillStyle = pal[2]; // rivets
      if (horiz) { ctx.fillRect(sx + 4, sy + sh / 2 - 1, 2, 2); ctx.fillRect(sx + sw - 6, sy + sh / 2 - 1, 2, 2); }
      else { ctx.fillRect(sx + sw / 2 - 1, sy + 4, 2, 2); ctx.fillRect(sx + sw / 2 - 1, sy + sh - 7, 2, 2); }
      if (hash01(seed + i) < dmg) { // cracks appear segment by segment as HP drops
        const cx = sx + sw / 2, cy = sy + sh / 2;
        ctx.strokeStyle = 'rgba(15,20,30,0.85)'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a = hash01(seed * 3 + i * 7 + k) * Math.PI * 2, r = Math.min(sw, sh) * (0.3 + 0.3 * hash01(i + k * 13));
          ctx.moveTo(cx, cy); const mx = cx + Math.cos(a) * r * 0.5 + 2, my = cy + Math.sin(a) * r * 0.5 - 1;
          ctx.lineTo(mx, my); ctx.lineTo(cx + Math.cos(a + 0.4) * r, cy + Math.sin(a + 0.4) * r);
        }
        ctx.stroke();
      }
    }
    if (g.ice) { // frost crystals on top
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < n; i++) { const sx = horiz ? x + (i + 0.5) * seg : x + w / 2, sy = horiz ? y + h / 2 : y + (i + 0.5) * seg; ctx.beginPath(); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx + 3, sy); ctx.lineTo(sx, sy + 4); ctx.lineTo(sx - 3, sy); ctx.fill(); }
    }
    if (g.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x, y, w, h); }
    if (g.big) { ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 3; ctx.strokeRect(x - 3, y - 3, w + 6, h + 6); }
    if (g.maxHp && g.maxHp !== Infinity && g.dur === undefined) drawBar(x + w / 2, y - 8, 50, 5, frac, false, g.ice ? '#9ee7ff' : '#54a0ff');
    if (g.electric) { // crackling arc linking the fence to its tesla's toroid
      if (!g.link || g.link.dead) g.link = G.gadgets.find(t => t.kind === 'tesla' && !t.dead && t.owner === g.owner && Math.hypot(t.x - g.x, t.y - g.y) <= COMBO.fenceNear + 40);
      const q = Math.floor(G.time * 14);
      if (g.link && hash01(q + g.x) < 0.55) {
        const tl = g.link, top = (tl.stormtower ? -44 : -34) * tl.sc;
        teslaArc(tl.x, tl.y + top, clamp(tl.x, x, x + w), clamp(tl.y, y, y + h), q * 3.1 + g.y, 26, '#feca57', '#fff7d6', 1.8);
      }
    }
    if (g.electric) { // crackling sparks running along the fence
      ctx.strokeStyle = '#fff3a0'; ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        for (let k = 0; k <= 8; k++) {
          const f = k / 8, px = horiz ? x + w * f : x + w / 2 + (Math.random() - 0.5) * 16, py = horiz ? y + h / 2 + (Math.random() - 0.5) * 16 : y + h * f;
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = '#c7f4ff'; ctx.lineWidth = 3;
      for (const z of g.zaps) { ctx.beginPath(); ctx.moveTo(clamp(z.x, x, x + w), clamp(z.y, y, y + h)); ctx.lineTo(z.x, z.y); ctx.stroke(); }
    }
  }

  function drawRadar(g) {
    const T = G.time, acc = g.command ? '#ffd32a' : '#ff9ff3', k = (T % 1.5) / 1.5;
    ctx.strokeStyle = g.command ? `rgba(255,211,42,${0.5 * (1 - k)})` : `rgba(255,159,243,${0.6 * (1 - k)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(g.x, g.y, 30 + k * 200, 0, Math.PI * 2); ctx.stroke();
    if (g.command) { // command radius
      ctx.strokeStyle = 'rgba(255,211,42,0.3)'; ctx.lineWidth = 2; ctx.setLineDash(DASH);
      ctx.beginPath(); ctx.arc(g.x, g.y, COMBO.cmdRadius * (g.big ? MERGE.range : 1), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash(NODASH);
    }
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc, g.sc);
    bShadow(22, 18);
    ctx.fillStyle = '#1f242d'; ctx.fillRect(-19, -17, 38, 38);              // side (depth)
    ctx.fillStyle = g.flash > 0 ? '#fff' : '#57606f'; ctx.fillRect(-19, -19, 38, 34); // top
    ctx.fillStyle = '#747d8c'; ctx.fillRect(-15, -15, 30, 26);
    ctx.fillStyle = '#a4b0be'; ctx.fillRect(-15, -15, 30, 2);
    bBolts(4, 21, Math.PI / 4, '#2f3542');
    if (g.command) { ctx.fillStyle = '#ffd32a'; for (let i = 0; i < 4; i++) ctx.fillRect(-15 + i * 8, 9, 4, 2); }
    if (g.big) { // BIG: gold corners, lattice mast with a blinking beacon, second dish turning the other way
      bGoldCorners(21);
      ctx.strokeStyle = '#c8d6e5'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(13, -16); ctx.lineTo(16, 10); ctx.moveTo(11, 0); ctx.lineTo(15, 0); ctx.moveTo(12, -8); ctx.lineTo(14, -8); ctx.stroke();
      const on = Math.sin(T * 5) > 0.3; ctx.fillStyle = on ? '#ff4757' : '#6b1d24'; ctx.beginPath(); ctx.arc(13, -17, 2.5, 0, Math.PI * 2); ctx.fill(); if (on) glow(13, -17, 10, '#ff4757', 0.9);
      ctx.save(); ctx.translate(-10, 8); ctx.rotate(-T * 2.2);
      ctx.strokeStyle = '#2f3542'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(-4, 0, 9, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(-4, 0, 9, -1.1, 1.1); ctx.stroke();
      ctx.restore();
    }
    // sweep wedge
    const a = T * 3;
    ctx.fillStyle = g.command ? 'rgba(255,211,42,0.18)' : 'rgba(255,159,243,0.18)';
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.arc(0, -2, 52, a - 0.8, a); ctx.closePath(); ctx.fill();
    // mast + dish
    ctx.fillStyle = '#2f3542'; ctx.beginPath(); ctx.arc(0, -2, 6, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(0, -2); ctx.rotate(a);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2f3542'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(-8, 0, 17, -1.05, 1.05); ctx.stroke();
    ctx.strokeStyle = acc; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(-8, 0, 17, -1.05, 1.05); ctx.stroke();
    ctx.strokeStyle = '#f1f2f6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-8, 0, 14, -0.8, 0.8); ctx.stroke();
    ctx.strokeStyle = '#2f3542'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 0); ctx.stroke();
    ctx.fillStyle = Math.sin(T * 10) > 0 ? '#fff' : acc; ctx.beginPath(); ctx.arc(14, 0, 3, 0, Math.PI * 2); ctx.fill();
    if (Math.sin(T * 10) > 0) glow(14, 0, 13, acc, 0.9);
    ctx.restore();
    if (g.command) { // flag on the mast
      ctx.strokeStyle = '#dfe4ea'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(-12, -30); ctx.stroke();
      ctx.fillStyle = '#ffd32a'; ctx.beginPath(); ctx.moveTo(-12, -30); ctx.lineTo(2 + Math.sin(T * 6) * 2, -26); ctx.lineTo(-12, -22); ctx.fill();
    }
    ctx.restore();
    drawBar(g.x, g.y - 36 * g.sc, 44, 6, g.hp / g.maxHp, false, acc);
  }

  // TESLA TOWER (3/4 view): concrete plinth, copper primary coil, ceramic insulator stack, toroid on top,
  // arcs crackling from the toroid down to the base ring. Arcs re-roll ~16x/s from a hash (no per-frame alloc).
  function teslaArc(x1, y1, x2, y2, seed, jit, col, hot, w) {
    const pts = 6;
    const path = () => {
      ctx.beginPath(); ctx.moveTo(x1, y1);
      for (let i = 1; i < pts; i++) { const k = i / pts; ctx.lineTo(x1 + (x2 - x1) * k + (hash01(seed + i * 3.7) - 0.5) * jit, y1 + (y2 - y1) * k + (hash01(seed + i * 9.1) - 0.5) * jit * 0.6); }
      ctx.lineTo(x2, y2);
    };
    ctx.strokeStyle = col; ctx.globalAlpha = 0.4; ctx.lineWidth = w * 3; path(); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = hot; ctx.lineWidth = w; path(); ctx.stroke();
  }
  function teslaToroid(y, rx, ry, metal, rim, col, flash) {
    ctx.fillStyle = '#12171b'; ctx.beginPath(); ctx.ellipse(0, y + 2, rx, ry + 1.5, 0, 0, Math.PI * 2); ctx.fill();     // underside
    ctx.fillStyle = flash ? '#fff' : metal; ctx.beginPath(); ctx.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); // tube top
    ctx.fillStyle = '#1a2024'; ctx.beginPath(); ctx.ellipse(0, y, rx * 0.45, ry * 0.42, 0, 0, Math.PI * 2); ctx.fill(); // hole
    ctx.strokeStyle = rim; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(0, y - 0.8, rx * 0.74, ry * 0.62, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); // shine
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawTesla(g, A) {
    const T = G.time, ST = !!g.stormtower;
    const col = ST || g.storm ? '#a29bfe' : g.plasma ? '#ff9f43' : g.cryo ? '#9ee7ff' : g.seeker ? '#ff9ff3' : '#48dbfb';
    const hot = ST || g.storm ? '#ece9ff' : g.plasma ? '#fff0c2' : g.cryo ? '#f2fbff' : g.seeker ? '#ffe3fa' : '#e6fdff';
    const R = teslaRange(g, A), seed = Math.floor(g.x * 0.37 + g.y * 0.71), q = Math.floor(T * 16);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.x, g.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (ST) { // storm cloud swirling over the tower's reach
      for (let i = 0; i < 7; i++) {
        const a = T * 0.35 + i * 0.9, d = 70 + 38 * Math.sin(i * 2.3);
        ctx.fillStyle = `rgba(86,80,138,${0.28 + 0.06 * Math.sin(T + i)})`;
        ctx.beginPath(); ctx.ellipse(g.x + Math.cos(a) * d, g.y - 105 + Math.sin(a) * d * 0.45, 46, 26, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (hash01(q * 0.37 + seed) < 0.18) glow(g.x + (hash01(q) - 0.5) * 160, g.y - 105 + (hash01(q + 5) - 0.5) * 60, 70, '#d6d2ff', 0.7);
    }
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc, g.sc);
    // tall tower: soft round shadow + a long one thrown down-right
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(3, 5, 21, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(18, 6, 18, 5, -0.25, 0, Math.PI * 2); ctx.fill();
    // plinth (a short cylinder): side band, then top face
    const big = g.big || ST, pr = ST ? 23 : 20;
    if (big) { // gold-trimmed foundation ring
      ctx.fillStyle = '#5e4a12'; ctx.beginPath(); ctx.ellipse(0, 3, pr + 4, 11.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e1b12c'; ctx.beginPath(); ctx.ellipse(0, 1, pr + 4, 11, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#161b1f'; ctx.beginPath(); ctx.ellipse(0, 4, pr, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-pr, -1, pr * 2, 5);
    ctx.fillStyle = g.flash > 0 ? '#fff' : g.cryo ? '#5d7f93' : '#3d474e'; ctx.beginPath(); ctx.ellipse(0, -1, pr, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g.cryo ? '#88aec4' : '#55626b'; ctx.beginPath(); ctx.ellipse(0, -1.5, pr - 4, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    // ground ring the arcs strike + copper lugs
    ctx.strokeStyle = col; ctx.globalAlpha = 0.55 + 0.25 * Math.sin(T * 7); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -1.5, pr - 2, 7.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.5; ctx.fillStyle = '#c97b3a'; ctx.fillRect(Math.cos(a) * (pr - 3) - 1.5, -1.5 + Math.sin(a) * 7.5 - 1.5, 3, 3); }
    if (g.cryo) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.4, x = Math.cos(a) * 15, y = -1 + Math.sin(a) * 6; ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 2, y); ctx.lineTo(x, y + 3); ctx.lineTo(x - 2, y); ctx.fill(); } }
    // big: four capacitor pylons on the corners (back ones first)
    const pyl = big ? [[-pr + 2, -6], [pr - 2, -6], [-pr - 1, 4], [pr + 1, 4]] : [];
    for (const [px, py] of pyl) {
      ctx.fillStyle = '#1b2125'; ctx.fillRect(px - 3, py - 13, 6, 13);
      ctx.fillStyle = '#6f7d86'; ctx.fillRect(px - 3, py - 13, 2, 13);
      ctx.fillStyle = '#d9d2bd'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(px, py - 3 - k * 4, 4, 1.5, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(px, py - 14, 2.2, 0, Math.PI * 2); ctx.fill();
      glow(px, py - 14, 8 + 2 * Math.sin(T * 9 + px), col, 0.8);
    }
    // primary coil: wide copper drum with windings
    ctx.fillStyle = '#5a3416'; ctx.beginPath(); ctx.ellipse(0, -2, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g.cryo ? '#9fc9de' : '#a8642c'; ctx.fillRect(-10, -9, 20, 7);
    ctx.fillStyle = g.cryo ? '#dff4ff' : '#e39a55';
    for (let i = 0; i < 4; i++) ctx.fillRect(-10, -8.5 + i * 1.8, 20, 0.8);
    ctx.fillStyle = g.cryo ? '#cbeaff' : '#c47a3c'; ctx.beginPath(); ctx.ellipse(0, -9, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b1a0c'; ctx.beginPath(); ctx.ellipse(0, -9, 6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    // insulator stack (secondary): ceramic discs up a dark column
    const top = ST ? -44 : -34;
    ctx.fillStyle = '#20262a'; ctx.fillRect(-3, top + 4, 6, -9 - top - 4);
    ctx.fillStyle = '#4a555c'; ctx.fillRect(-3, top + 4, 2, -9 - top - 4);
    const nd = ST ? 8 : 6;
    for (let i = 0; i < nd; i++) {
      const y = -11 - i * ((-13 - top) / nd), rw = 6.5 - i * 0.25;
      ctx.fillStyle = g.cryo ? '#7fb6d1' : '#9b9078'; ctx.beginPath(); ctx.ellipse(0, y + 1, rw, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = g.cryo ? '#e6f7ff' : '#efe8d6'; ctx.beginPath(); ctx.ellipse(0, y, rw, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    // pulsing glow, then the toroid(s)
    const p = 1 + Math.sin(T * 6) * 0.12 + (g.zaps.length ? 0.25 : 0);
    glow(0, top, (ST ? 44 : big ? 34 : 28) * p, col, g.plasma ? 0.85 : 0.6);
    const metal = g.plasma ? '#c9763a' : g.cryo ? '#bfe9ff' : ST || g.storm ? '#6d6a8e' : '#6c7a83';
    if (big || g.storm) teslaToroid(top + 7, 10, 3.6, metal, '#eef3f5', col, g.flash > 0); // second, smaller ring
    teslaToroid(top, ST ? 19 : 15, ST ? 7 : 5.6, metal, '#eef3f5', col, g.flash > 0);
    if (ST) teslaToroid(top - 8, 9, 3.4, metal, '#eef3f5', col, false);
    if (g.plasma) glow(0, top, 18, '#ffd29a', 0.5 + 0.3 * Math.sin(T * 20));
    // top terminal
    ctx.fillStyle = '#d7e0e4'; ctx.beginPath(); ctx.arc(0, top - (ST ? 11 : 3), 2.6, 0, Math.PI * 2); ctx.fill();
    if (g.seeker) { // little pink tracking dish on a mast
      ctx.strokeStyle = '#2f3542'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(6, top + 2); ctx.lineTo(13, top - 8); ctx.stroke();
      ctx.save(); ctx.translate(13, top - 8); ctx.rotate(T * 3); ctx.strokeStyle = '#ff9ff3'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(-2, 0, 5, -1.1, 1.1); ctx.stroke(); ctx.restore();
    }
    // crackling arcs: toroid rim -> base ring (+ pylons on big ones)
    const na = ST ? 4 : big ? 3 : 2, trx = ST ? 19 : 15, try_ = ST ? 7 : 5.6;
    for (let i = 0; i < na; i++) {
      const s0 = seed + i * 31 + q * 7.3;
      if (hash01(s0) > (g.storm || ST ? 0.85 : 0.6)) continue;
      const a = hash01(s0 + 1) * Math.PI * 2, b = a + (hash01(s0 + 2) - 0.5) * 1.2;
      teslaArc(Math.cos(a) * trx, top + Math.sin(a) * try_, Math.cos(b) * (pr - 2), -1.5 + Math.sin(b) * 7.5, s0 + 3, 9, col, hot, 1.4);
    }
    for (let i = 0; i < pyl.length; i++) {
      const s0 = seed + 99 + i * 13 + q * 5.1;
      if (hash01(s0) > 0.3) continue;
      const [px, py] = pyl[i];
      teslaArc(px, py - 14, Math.sign(px) * trx * 0.8, top, s0, 7, col, hot, 1.2);
    }
    ctx.restore();
    drawBar(g.x, g.y - (ST ? 58 : 46) * g.sc, ST ? 64 : 44, 6, g.hp / g.maxHp, false, col);
    if (ST) { ctx.fillStyle = '#ece9ff'; ctx.font = '900 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('STORM TOWER', g.x, g.y - 58 * g.sc - 8); }
    // zaps out to enemies: wide coloured glow + white-hot core (chain zaps start from the last enemy, storm bolts from the sky)
    const ox = g.x, oy = g.y + top * g.sc;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const z of g.zaps) {
      const fx = z.fx ?? ox, fy = z.fy ?? oy, n = z.sky ? 9 : 6, j = z.sky ? 34 : 22;
      const path = () => { ctx.beginPath(); ctx.moveTo(fx, fy); for (let i = 1; i < n; i++) { const k = i / n; ctx.lineTo(fx + (z.x - fx) * k + (Math.random() - 0.5) * j, fy + (z.y - fy) * k + (Math.random() - 0.5) * j); } ctx.lineTo(z.x, z.y); };
      ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = g.plasma || z.sky ? 9 : 7; path(); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = hot; ctx.lineWidth = g.plasma || z.sky ? 3.5 : 2.5; path(); ctx.stroke();
      glow(z.x, z.y, z.sky ? 40 : 22, col, Math.min(1, z.life / 0.15));
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  }

  function drawMortar(g) {
    const acc = g.cryo ? '#9ee7ff' : '#e67e22', a = g.aim ?? g.a, rc = g.recoil || 0;
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc, g.sc);
    bShadow(22, 16);
    // sandbag ring (BIG: steel armor plates with gold rivets)
    for (let i = 0; i < 8; i++) {
      const b = i * Math.PI / 4;
      if (g.big) {
        ctx.save(); ctx.rotate(b); ctx.fillStyle = '#2b3036'; ctx.fillRect(14, -8, 9, 16); ctx.fillStyle = '#5f6b75'; ctx.fillRect(14, -8, 8, 14);
        ctx.fillStyle = '#ffd700'; ctx.fillRect(17, -6, 2, 2); ctx.fillRect(17, 3, 2, 2); ctx.restore(); continue;
      }
      ctx.fillStyle = '#6d5a3a'; ctx.beginPath(); ctx.ellipse(Math.cos(b) * 17, Math.sin(b) * 17, 8, 5.5, b + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a48a5c'; ctx.beginPath(); ctx.ellipse(Math.cos(b) * 17 - 1, Math.sin(b) * 17 - 1.5, 6, 3.5, b + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = g.flash > 0 ? '#fff' : '#3b3f46'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    bBolts(4, 8, Math.PI / 4, '#7f8c8d');
    // stubby tube pointing up-and-out toward the target
    ctx.rotate(a);
    for (const oy of g.big ? [-6.5, 6.5] : [0]) { // BIG: twin tubes
      ctx.save(); ctx.translate(0, oy); if (g.big) ctx.scale(1, 0.8);
      ctx.fillStyle = '#1e2226'; ctx.fillRect(-6 - rc * 4, -6, 26, 12);
      ctx.fillStyle = '#4b5259'; ctx.fillRect(-6 - rc * 4, -6, 26, 4);
      ctx.fillStyle = g.big ? '#ffd700' : acc; ctx.fillRect(16 - rc * 4, -7, 5, 14);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(21 - rc * 4, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (rc > 0) glow(23 - rc * 4, 0, 10 + rc * 22, '#ffb347', rc);
    ctx.restore();
    drawBar(g.x, g.y - 34 * g.sc, 44, 6, g.hp / g.maxHp, false, acc);
  }

  function drawShieldGen(g, A) {
    const T = G.time, R = A.radius * (g.big ? MERGE.range : 1), col = g.shock ? '162,155,254' : '108,92,231';
    // soft dome
    ctx.fillStyle = `rgba(${col},${0.08 + 0.03 * Math.sin(T * 3)})`; ctx.strokeStyle = `rgba(${col},0.55)`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(g.x, g.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = `rgba(${col},0.18)`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(g.x, g.y, R, R * 0.45, 0, 0, Math.PI * 2); ctx.moveTo(g.x + R * 0.45, g.y); ctx.ellipse(g.x, g.y, R * 0.45, R, 0, 0, Math.PI * 2); ctx.stroke();
    if (g.ring > 0) { g.ring -= 1 / 60; ctx.strokeStyle = `rgba(200,190,255,${g.ring * 2})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(g.x, g.y, R * (1 - g.ring), 0, Math.PI * 2); ctx.stroke(); }
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc, g.sc);
    bShadow(20, 15);
    if (g.big) bGoldRing(6, 22, 0);
    ctx.fillStyle = '#1b1830'; bPoly(6, 20, 0); ctx.fill();
    ctx.fillStyle = g.flash > 0 ? '#fff' : '#3d3769'; bPoly(6, 18, 0); ctx.fill();
    ctx.fillStyle = '#5a52a0'; bPoly(6, 12, 0); ctx.fill();
    bBolts(6, 15, Math.PI / 6, '#a29bfe');
    // emitter: spinning ring + core
    ctx.strokeStyle = g.shock ? '#d6d2ff' : '#a29bfe'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, -2, 9, T * 2, T * 2 + 4); ctx.stroke();
    if (g.big) { // BIG: counter-spinning outer ring + 3 emitter pylons feeding the core
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, -2, 12.5, -T * 1.5, -T * 1.5 + 3.6); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const b = i * Math.PI * 2 / 3 - Math.PI / 2, px = Math.cos(b) * 16, py = Math.sin(b) * 16;
        ctx.fillStyle = '#2a2550'; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d6d2ff'; ctx.beginPath(); ctx.arc(px, py - 1, 2, 0, Math.PI * 2); ctx.fill();
        glow(px, py - 1, 9, '#a29bfe', 0.6 + 0.3 * Math.sin(T * 5 + i));
      }
    }
    ctx.fillStyle = `rgba(${col},0.5)`; ctx.beginPath(); ctx.arc(0, -2, 7 + Math.sin(T * 6), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#efeaff'; ctx.beginPath(); ctx.arc(0, -2, 3.5, 0, Math.PI * 2); ctx.fill();
    glow(0, -2, 20 + Math.sin(T * 6) * 2, g.shock ? '#d6d2ff' : '#a29bfe', 0.7);
    if (g.shock && Math.random() < 0.6) bSpark(0, -2, 14, '#d6d2ff');
    ctx.restore();
    drawBar(g.x, g.y - 32 * g.sc, 44, 6, g.hp / g.maxHp, false, '#a29bfe');
    if (g.shock) { ctx.strokeStyle = '#d6d2ff'; ctx.lineWidth = 2; for (const z of g.zaps) { ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo((g.x + z.x) / 2 + (Math.random() - 0.5) * 20, (g.y + z.y) / 2 + (Math.random() - 0.5) * 20); ctx.lineTo(z.x, z.y); ctx.stroke(); } }
  }

  function drawSniper(g) {
    const acc = g.spot ? '#ff9ff3' : '#20bf6b', a = g.aim ?? g.a, k = g.kick || 0;
    if (g.tracer) { // bright tracer line
      const f = g.tracer.life / 0.25;
      ctx.strokeStyle = `rgba(255,250,200,${f})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(g.tracer.x0, g.tracer.y0); ctx.lineTo(g.tracer.x, g.tracer.y); ctx.stroke();
      ctx.strokeStyle = `rgba(255,200,80,${f * 0.4})`; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(g.tracer.x0, g.tracer.y0); ctx.lineTo(g.tracer.x, g.tracer.y); ctx.stroke();
    }
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc, g.sc);
    bShadow(22, 17);
    // camo platform with a low wall
    ctx.fillStyle = '#1f2a1f'; ctx.fillRect(-19, -17, 38, 38);
    ctx.fillStyle = g.flash > 0 ? '#fff' : '#3e5233'; ctx.fillRect(-19, -19, 38, 34);
    ctx.fillStyle = '#566e45'; ctx.fillRect(-14, -14, 28, 24);
    ctx.fillStyle = '#2f3f27'; ctx.fillRect(-12, -10, 8, 5); ctx.fillRect(3, 2, 9, 5); ctx.fillRect(-6, 4, 6, 4); // camo blotches
    ctx.fillStyle = '#7d9466'; ctx.fillRect(-19, -19, 38, 2);
    if (g.big) { // BIG: gold corners + sandbag wall along the front
      bGoldCorners(21);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = '#6d5a3a'; ctx.beginPath(); ctx.ellipse(-12 + i * 8, 13, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#a48a5c'; ctx.beginPath(); ctx.ellipse(-12.5 + i * 8, 12, 3.6, 2, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    // long rifle (BIG: anti-materiel rifle - longer, bipod, gold scope)
    ctx.rotate(a); ctx.translate(-k, 0);
    if (g.big) {
      ctx.strokeStyle = '#1c1f22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(30, -9); ctx.moveTo(24, 0); ctx.lineTo(30, 9); ctx.stroke();
      ctx.fillStyle = '#1c1f22'; ctx.fillRect(36, -2.5, 16, 5); ctx.fillStyle = '#ffd700'; ctx.fillRect(50, -4.5, 5, 9);
    }
    ctx.fillStyle = '#1c1f22'; ctx.fillRect(-12, -3, 50, 6);
    ctx.fillStyle = '#3c4247'; ctx.fillRect(-12, -3, 50, 2);
    ctx.fillStyle = '#5b4632'; ctx.fillRect(-16, -4, 12, 8);   // stock
    ctx.fillStyle = g.big ? '#b8860b' : '#111'; ctx.fillRect(2, -8, 14, 4);         // scope
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(16, -6, 2.2, 0, Math.PI * 2); ctx.fill();
    glow(16, -6, 7 + Math.sin(G.time * 3), acc, 0.8);
    ctx.fillStyle = '#2d3436'; ctx.fillRect(36, -4, 5, 8);      // muzzle brake
    ctx.restore();
    if (g.spot) { // radar dish on the nest
      ctx.save(); ctx.translate(g.x - 12 * g.sc, g.y + 10 * g.sc); ctx.rotate(G.time * 3);
      ctx.strokeStyle = '#ff9ff3'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-3, 0, 6, -1, 1); ctx.stroke(); ctx.restore();
    }
    drawBar(g.x, g.y - 34 * g.sc, 44, 6, g.hp / g.maxHp, false, acc);
  }

  function drawFlame(g, A) {
    const T = G.time, a = g.aim ?? g.a ?? 0, acc = g.blaze ? '#ffd32a' : '#ff5e1a';
    for (const p of g.flames || []) { // additive fire: yellow -> orange -> red as it fades
      const k = p.life / p.max;
      glow(p.x, p.y, p.s * (1.7 - k * 0.7), k > 0.65 ? '#ffd36b' : k > 0.3 ? '#ff7a1a' : '#d63031', Math.min(1, k * 1.5));
    }
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc, g.sc);
    bShadow(21, 16);
    if (g.big) bGoldRing(8, 22.5, Math.PI / 8);
    ctx.fillStyle = '#20140f'; bPoly(8, 21, Math.PI / 8); ctx.fill();
    ctx.fillStyle = g.flash > 0 ? '#fff' : '#4d3226'; bPoly(8, 19, Math.PI / 8); ctx.fill();
    ctx.fillStyle = '#6e4734'; bPoly(8, 14, Math.PI / 8); ctx.fill();
    ctx.strokeStyle = '#2a1a12'; ctx.lineWidth = 1.5; // brick seams
    for (let i = 0; i < 8; i++) { const b = i * Math.PI / 4 + Math.PI / 8; ctx.beginPath(); ctx.moveTo(Math.cos(b) * 14, Math.sin(b) * 14); ctx.lineTo(Math.cos(b) * 19, Math.sin(b) * 19); ctx.stroke(); }
    ctx.strokeStyle = acc; ctx.lineWidth = 2.5; bPoly(8, 19, Math.PI / 8); ctx.stroke();
    glow(0, 0, 24 + Math.sin(T * 9) * 3, '#ff5e1a', g.firing ? 0.55 : 0.25); // heat
    // twin fuel tanks
    for (const [tx, ty] of g.big ? [[-6, -8], [-6, 8], [7, -11], [7, 11]] : [[-6, -8], [-6, 8]]) { // BIG: 4 tanks
      ctx.fillStyle = '#8e1b10'; ctx.beginPath(); ctx.arc(tx, ty, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = g.big ? '#ffb142' : '#e74c3c'; ctx.beginPath(); ctx.arc(tx - 1, ty - 1.5, 3, 0, Math.PI * 2); ctx.fill();
    }
    if (g.blaze) { // Inferno Ring: 4 extra nozzles spinning round
      for (let i = 0; i < 4; i++) {
        const b = T * 2 + i * Math.PI / 2;
        ctx.save(); ctx.rotate(b); ctx.fillStyle = '#2d2d34'; ctx.fillRect(12, -3, 11, 6); ctx.fillStyle = '#ffd32a'; ctx.fillRect(21, -3.5, 3, 7); ctx.restore();
      }
    }
    ctx.rotate(a);
    ctx.fillStyle = '#1b1b21'; ctx.fillRect(-9, -8, 18, 16);
    ctx.fillStyle = '#4a4a57'; ctx.fillRect(-9, -8, 18, 3);
    const fl = 0.75 + Math.random() * 0.4; // pilot light
    for (const oy of g.big ? [-5, 5] : [0]) { // BIG: twin nozzles
      ctx.fillStyle = '#2d2d34'; ctx.fillRect(6, oy - (g.big ? 3.5 : 5), 18, g.big ? 7 : 10);
      ctx.fillStyle = '#5c5c6a'; ctx.fillRect(6, oy - (g.big ? 3.5 : 5), 18, 2);
      ctx.fillStyle = g.big ? '#ffd700' : '#ff9f43'; ctx.fillRect(22, oy - (g.big ? 4.5 : 6), 4, g.big ? 9 : 12);
      glow(29, oy, (g.firing ? 16 : 9) * fl * (g.big ? 0.85 : 1), '#ffb347', 0.95);
      glow(27, oy, 4, '#74b9ff', 0.8);
    }
    ctx.restore();
    drawBar(g.x, g.y - 34 * g.sc, 44, 6, g.hp / g.maxHp, false, acc);
  }

  function drawLaser(g, A) {
    const T = G.time, a = g.aim ?? g.a ?? 0, h = g.heat || 0, acc = g.prism ? '#c56cf0' : '#ff2e63';
    const ex = g.x + Math.cos(a) * 16 * g.sc, ey = g.y + Math.sin(a) * 16 * g.sc;
    if (g.beams && g.beams.length) { // glowing beams: wide soft glow + hot white core, thicker as it heats up
      ctx.save(); ctx.lineCap = 'round';
      for (const b of g.beams) {
        const w = b.main ? 3 + 7 * h : 3, wob = 1 + Math.sin(T * 40) * 0.15;
        ctx.strokeStyle = `rgba(${rgbOf(acc)},0.28)`; ctx.lineWidth = w * 3.2 * wob;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = acc; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, w * 0.35);
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(b.x, b.y); ctx.stroke();
        glow(b.x, b.y, (b.main ? 16 + 22 * h : 14) * wob, acc, 0.9);
      }
      ctx.restore();
    }
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc, g.sc);
    bShadow(20, 15);
    if (g.big) bGoldRing(6, 22.5, 0);
    ctx.fillStyle = '#16121c'; bPoly(6, 21, 0); ctx.fill();
    ctx.fillStyle = g.flash > 0 ? '#fff' : '#2e2838'; bPoly(6, 19, 0); ctx.fill();
    ctx.fillStyle = '#433a52'; bPoly(6, 13, 0); ctx.fill();
    ctx.fillStyle = '#5e5470'; ctx.fillRect(-13, -12, 26, 2);
    bBolts(6, 16.5, Math.PI / 6, '#8a7fa0');
    // charge ring: segments light up with heat
    for (let i = 0; i < 6; i++) {
      const b = i * Math.PI / 3 + T * (1 + h * 6);
      ctx.strokeStyle = i / 6 < h + 0.05 ? acc : '#3a3046'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 16, b, b + 0.7); ctx.stroke();
    }
    glow(0, 0, 18 + h * 16, acc, 0.25 + h * 0.5);
    ctx.rotate(a);
    ctx.fillStyle = '#1d1a24'; ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = '#3a3448'; ctx.fillRect(2, -4, 16, 8);
    ctx.fillStyle = '#6c6480'; ctx.fillRect(2, -4, 16, 2);
    // crystal lens
    ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(16, -5); ctx.lineTo(22, 0); ctx.lineTo(16, 5); ctx.lineTo(13, 0); ctx.closePath(); ctx.fill();
    if (g.big) { // BIG: two gold focusing prongs around the lens
      ctx.fillStyle = '#ffd700';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(8, s * 5); ctx.lineTo(24, s * 7); ctx.lineTo(25, s * 4); ctx.lineTo(12, s * 3); ctx.closePath(); ctx.fill(); }
    }
    glow(18, 0, 8 + 10 * h + Math.sin(T * 12) * 1.5, acc, 0.9);
    ctx.restore();
    if (g.orbital) drawOrbitalTop(g, T);
    drawBar(g.x, g.y - 34 * g.sc, 44, 6, g.hp / g.maxHp, false, acc);
  }

  // ORBITAL STRIKE tower: sky uplink dish on top of the big laser, satellites circling, uplink beam when it calls a strike
  function drawOrbitalTop(g, T) {
    const sc = g.sc;
    ctx.save(); ctx.translate(g.x, g.y);
    ctx.strokeStyle = 'rgba(255,46,99,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, -6 * sc, 30 * sc, 12 * sc, 0, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 3; i++) { // satellites
      const a = T * 1.3 + i * Math.PI * 2 / 3, x = Math.cos(a) * 30 * sc, y = -6 * sc + Math.sin(a) * 12 * sc;
      ctx.fillStyle = '#2e2838'; ctx.fillRect(x - 6, y - 2, 12, 4); ctx.fillStyle = '#4aa3ff'; ctx.fillRect(x - 9, y - 1.5, 3, 3); ctx.fillRect(x + 6, y - 1.5, 3, 3);
      ctx.fillStyle = '#ff2e63'; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    // uplink dish pointing at the sky
    ctx.fillStyle = '#1d1a24'; ctx.fillRect(-3, -26 * sc, 6, 18 * sc);
    ctx.fillStyle = '#3a3448'; ctx.beginPath(); ctx.ellipse(0, -26 * sc, 13 * sc / 1.5, 5 * sc / 1.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffd1dc'; ctx.beginPath(); ctx.arc(0, -28 * sc, 3, 0, Math.PI * 2); ctx.fill();
    glow(0, -28 * sc, 16 + Math.sin(T * 8) * 3, '#ff2e63', 0.9);
    if (g.uplink > 0) { // beam shooting up into space
      const f = g.uplink / 0.6;
      ctx.fillStyle = `rgba(255,46,99,${0.35 * f})`; ctx.fillRect(-10 * f, -900, 20 * f, 900 - 28 * sc);
      ctx.fillStyle = `rgba(255,255,255,${0.9 * f})`; ctx.fillRect(-2.5, -900, 5, 900 - 28 * sc);
      glow(0, -28 * sc, 40 * f, '#ff2e63', f);
    }
    ctx.restore();
    ctx.fillStyle = '#ffd1dc'; ctx.font = '900 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ORBITAL STRIKE', g.x, g.y - 44 * sc);
  }
  // the sky beam an Orbital Strike calls down: targeting reticle, then a blinding column
  function drawSkyBeam(s) {
    const T = G.time;
    if (!s.boomed) {
      const k = 1 - s.t / s.max, r = s.r * (1.5 - 0.5 * k);
      ctx.strokeStyle = `rgba(255,46,99,${0.35 + 0.55 * k})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(T * 3);
      ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.moveTo(r * 0.55, 0); ctx.lineTo(r * 1.1, 0); } ctx.stroke();
      ctx.restore();
      ctx.fillStyle = `rgba(255,46,99,${0.15 + 0.35 * k})`; ctx.fillRect(s.x - 1.5 - 3 * k, s.y - 1400, 3 + 6 * k, 1400);
      glow(s.x, s.y, 20 + 30 * k, '#ff2e63', 0.4 + 0.5 * k);
    } else {
      const f = Math.max(0, s.post / 0.45);
      ctx.fillStyle = `rgba(255,46,99,${0.35 * f})`; ctx.fillRect(s.x - 55 * f, s.y - 1400, 110 * f, 1400);
      ctx.fillStyle = `rgba(255,170,200,${0.7 * f})`; ctx.fillRect(s.x - 24 * f, s.y - 1400, 48 * f, 1400);
      ctx.fillStyle = `rgba(255,255,255,${f})`; ctx.fillRect(s.x - 8 * f, s.y - 1400, 16 * f, 1400);
      glow(s.x, s.y, 150 * f, '#ff2e63', f); glow(s.x, s.y, 60 * f, '#ffffff', f);
    }
  }
  function drawHangar(g, A) {
    const T = G.time, acc = g.medic ? '#32ff7e' : '#00d2d3';
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc, g.sc);
    bShadow(23, 18);
    if (g.carrier) drawCarrierDeck(T, acc);
    ctx.fillStyle = '#14191d'; ctx.fillRect(-21, -19, 42, 42);
    ctx.fillStyle = g.flash > 0 ? '#fff' : '#2f3a40'; ctx.fillRect(-21, -21, 42, 38);
    // hazard stripes along the edge
    ctx.save(); ctx.beginPath(); ctx.rect(-21, -21, 42, 38); ctx.rect(-16, -16, 32, 28); ctx.clip('evenodd');
    ctx.fillStyle = '#f9ca24'; ctx.fillRect(-21, -21, 42, 38);
    ctx.fillStyle = '#1e1e1e';
    for (let i = -6; i < 8; i++) { ctx.beginPath(); ctx.moveTo(-21 + i * 8, -21); ctx.lineTo(-17 + i * 8, -21); ctx.lineTo(-17 + i * 8 - 38, 17); ctx.lineTo(-21 + i * 8 - 38, 17); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#3d4a52'; ctx.fillRect(-16, -16, 32, 28);
    // landing pad circle + H
    ctx.strokeStyle = '#dfe6e9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -2, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = g.big ? '#ffd700' : '#dfe6e9'; ctx.fillRect(-5, -7, 2, 10); ctx.fillRect(3, -7, 2, 10); ctx.fillRect(-5, -3, 10, 2);
    if (g.big && !g.carrier) { // BIG: gold corners + launch rails on both sides
      bGoldCorners(23);
      ctx.fillStyle = '#20272c'; ctx.fillRect(-27, -14, 5, 24); ctx.fillRect(22, -14, 5, 24);
      ctx.fillStyle = '#7f8c8d'; for (let i = 0; i < 4; i++) { ctx.fillRect(-26, -12 + i * 6, 3, 2); ctx.fillRect(23, -12 + i * 6, 3, 2); }
    }
    // corner lights chasing round
    const corners = [[-14, -14], [14, -14], [14, 10], [-14, 10]];
    corners.forEach(([x, y], i) => { const on = Math.floor(T * 4) % 4 === i; ctx.fillStyle = on ? '#fff' : acc; ctx.fillRect(x - 2, y - 2, 4, 4); if (on) glow(x, y, 9, acc, 0.9); });
    ctx.restore();
    if (g.carrier) { ctx.fillStyle = '#a5f3f3'; ctx.font = '900 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('CARRIER', g.x, g.y - 42 * g.sc); }
    const dsc = g.carrier ? 1.4 : 1;
    for (const d of g.drones || []) {
      if (!d.alive) continue;
      if (d.hb) { ctx.strokeStyle = `rgba(50,255,126,${d.hb.life / 0.3})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.hb.x, d.hb.y); ctx.stroke(); }
      const bob = Math.sin(T * 6 + d.ph) * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(d.x + 6, d.y + 12, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(d.x, d.y + bob); ctx.rotate(d.a); ctx.scale(dsc, dsc);
      ctx.strokeStyle = '#2d3436'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(-7, 7); ctx.lineTo(7, -7); ctx.stroke();
      for (const [x, y] of [[-7, -7], [7, -7], [7, 7], [-7, 7]]) { // spinning rotors (blurred discs)
        ctx.fillStyle = 'rgba(200,214,229,0.35)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#dfe6e9'; ctx.lineWidth = 1.2; const r = T * 40; ctx.beginPath(); ctx.moveTo(x + Math.cos(r) * 5, y + Math.sin(r) * 5); ctx.lineTo(x - Math.cos(r) * 5, y - Math.sin(r) * 5); ctx.stroke();
      }
      ctx.fillStyle = g.carrier ? '#5e4a12' : '#353b48'; ctx.fillRect(-5, -4, 10, 8);
      ctx.fillStyle = g.carrier ? '#ffd700' : '#636e72'; ctx.fillRect(-5, -4, 10, 2);
      ctx.fillStyle = '#1e272e'; ctx.fillRect(4, -1.5, 6, 3);
      glow(0, 0, 7, acc, 0.9);
      if (d.mf > 0) glow(12, 0, 10, '#fff3b0', 1);
      ctx.restore();
    }
    drawBar(g.x, g.y - 36 * g.sc, 44, 6, g.hp / g.maxHp, false, acc);
  }

  // CARRIER: a long flight deck under the hangar with a control island
  function drawCarrierDeck(T, acc) {
    ctx.fillStyle = '#101418'; ctx.fillRect(-34, -22, 68, 46);
    ctx.fillStyle = '#39434a'; ctx.fillRect(-34, -24, 68, 44);
    ctx.fillStyle = '#4b565e'; ctx.fillRect(-32, -22, 64, 40);
    ctx.fillStyle = '#dfe6e9'; for (let i = 0; i < 6; i++) ctx.fillRect(-30 + i * 11, 15, 6, 1.5); // runway centre line
    ctx.fillStyle = '#ffd700'; ctx.fillRect(-34, -24, 68, 1.5); ctx.fillRect(-34, 18.5, 68, 1.5);
    // control island
    ctx.fillStyle = '#1b2126'; ctx.fillRect(24, -21, 9, 16); ctx.fillStyle = '#6c7a83'; ctx.fillRect(24, -21, 9, 3);
    ctx.fillStyle = Math.sin(T * 4) > 0 ? acc : '#0b3a3a'; ctx.fillRect(26, -15, 5, 2);
    ctx.strokeStyle = '#c8d6e5'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(28.5, -21); ctx.lineTo(28.5, -30); ctx.stroke();
    ctx.save(); ctx.translate(28.5, -30); ctx.rotate(T * 3); ctx.strokeStyle = '#ffd32a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-2, 0, 4, -1.1, 1.1); ctx.stroke(); ctx.restore();
    // deck lights chasing toward the bow
    for (let i = 0; i < 6; i++) { const on = Math.floor(T * 8) % 6 === i; ctx.fillStyle = on ? '#fff' : acc; ctx.fillRect(-31 + i * 10, -20, 2, 2); if (on) glow(-30 + i * 10, -19, 7, acc, 0.9); }
  }
  function drawGravity(g, A) {
    const T = G.time, R = A.radius * (g.big ? MERGE.range : 1), acc = g.implode ? '#ff6bcb' : '#7d5fff', rgb = rgbOf(acc);
    // swirling distortion: rings sliding inward + spiral arcs
    ctx.fillStyle = `rgba(${rgb},0.05)`; ctx.beginPath(); ctx.arc(g.x, g.y, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const k = (T * 0.45 + i / 4) % 1, r = R * (1 - k);
      ctx.strokeStyle = `rgba(${rgb},${0.45 * k * (1 - k) * 4 * 0.6})`;
      ctx.beginPath(); ctx.arc(g.x, g.y, r, T * 1.5 + i, T * 1.5 + i + 4.2); ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${rgb},0.22)`; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) { const b = -T * 2 + i * Math.PI * 2 / 3; ctx.beginPath(); ctx.arc(g.x, g.y, R * 0.55, b, b + 1.1); ctx.stroke(); }
    const sq = g.squeeze > 0 ? (g.squeeze -= 1 / 60) : 0;
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.sc * (1 - sq * 0.4), g.sc * (1 - sq * 0.4));
    bShadow(20, 15);
    if (g.big) { ctx.strokeStyle = '#7a5c0e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 22.5, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = '#100d1c'; ctx.beginPath(); ctx.arc(0, 0, 21, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g.flash > 0 ? '#fff' : '#2b2450'; ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fill();
    bBolts(8, 16.5, 0, '#7f75b8');
    // gyroscope rings
    ctx.strokeStyle = '#a29bfe'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 14 * Math.abs(Math.cos(T * 2)), T * 0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = acc; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 14 * Math.abs(Math.sin(T * 1.6)), 14, -T * 0.5, 0, Math.PI * 2); ctx.stroke();
    if (g.big) { // BIG: a third gold ring + rocks caught in orbit
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, 0, 17, 17 * Math.abs(Math.sin(T * 1.1 + 1)), -T * 0.9, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 4; i++) { const b = T * 2.4 + i * Math.PI / 2; ctx.fillStyle = i % 2 ? '#6d6a8e' : '#8a83b8'; ctx.beginPath(); ctx.arc(Math.cos(b) * 26, Math.sin(b) * 11, 2.6, 0, Math.PI * 2); ctx.fill(); }
    }
    // singularity core
    glow(0, 0, 22 + Math.sin(T * 5) * 3, acc, 0.75);
    ctx.fillStyle = '#05030a'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#efeaff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, 6.5, T * 6, T * 6 + 2.5); ctx.stroke();
    ctx.restore();
    drawBar(g.x, g.y - 32 * g.sc, 44, 6, g.hp / g.maxHp, false, acc);
  }

  // armor plates bolted around a turret (BUNKER)
  function drawBunker(t, r) {
    ctx.save(); ctx.translate(t.x, t.y);
    ctx.fillStyle = '#1e252b'; bPoly(8, r + 2, Math.PI / 8); ctx.fill();
    ctx.fillStyle = '#5a6670'; bPoly(8, r, Math.PI / 8); ctx.fill();
    ctx.fillStyle = '#7f8c96'; bPoly(8, r - 4, Math.PI / 8); ctx.fill();
    ctx.strokeStyle = '#1e252b'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8)); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke(); }
    bBolts(8, r - 3, 0, '#c8d6e5');
    ctx.restore();
  }

  // a normal turret: shaded octagon base + rotating head housing with your sidearm on top
  function drawTurret(t) {
    const acc = t.spot ? '#ff9ff3' : t.medic || t.healer ? '#32ff7e' : t.flame ? '#ff6b1a' : '#cd84f1';
    ctx.save(); ctx.translate(t.x, t.y);
    bShadow(20, 15);
    ctx.restore();
    if (t.bunker) drawBunker(t, 26);
    ctx.save(); ctx.translate(t.x, t.y);
    ctx.fillStyle = '#23252e'; bPoly(8, 19, Math.PI / 8); ctx.fill();
    ctx.fillStyle = t.flash > 0 ? '#fff' : '#3a3d4a'; bPoly(8, 17, Math.PI / 8); ctx.fill();
    ctx.fillStyle = '#545869'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = acc; ctx.lineWidth = 3; bPoly(8, 17, Math.PI / 8); ctx.stroke();
    bBolts(4, 14.5, Math.PI / 4, '#9aa0b5');
    glow(0, 0, 22, acc, 0.2 + 0.08 * Math.sin(G.time * 4));
    ctx.rotate(t.aim);
    ctx.fillStyle = '#2b2d38'; ctx.fillRect(-11, -9, 20, 18);
    ctx.fillStyle = '#6b6f85'; ctx.fillRect(-11, -9, 20, 3);
    ctx.fillStyle = acc; ctx.fillRect(-11, 5, 20, 2);
    ctx.restore();
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
          if (Math.hypot(t.x - g.x, t.y - g.y) > ABILITIES.radar.radius * (g.big ? MERGE.range : 1)) continue;
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

  // random ultimate, weighted toward the one that matches your ability (hidden)
  function rollUlt(abilities) {
    const favs = abilities.map(a => ULT_AFFINITY[a]);
    const pool = Object.keys(ULTIMATES).map(k => [k, favs.includes(k) ? ULT_AFFINITY.weight : 1]);
    let r = Math.random() * pool.reduce((n, [, w]) => n + w, 0);
    for (const [k, w] of pool) { if ((r -= w) < 0) return k; }
    return pool[0][0];
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
    if (k === 'clones') {
      for (let i = 0; i < U.count; i++) {
        const an = me.aim + (i - 1) * 0.9;
        let x = me.x, y = me.y;
        for (let d = 90; d >= 0; d -= 15) { const nx = me.x + Math.cos(an) * d, ny = me.y + Math.sin(an) * d; if (!pointInWall(nx, ny)) { x = nx; y = ny; break; } }
        landGadget({ kind: 'decoy', x1: x, y1: y, a: an, owner: myOwnerId(), hp: U.hp, dur: U.duration });
      }
    }
    if (k === 'fountain') { me.hp = me.maxHp; me.fountT = U.duration; me.fountTick = 1; burst(me.x, me.y, '#55efc4', 40, 300); }
    if (k === 'meteors') {
      const cx = me.x + Math.cos(me.aim) * U.dist, cy = me.y + Math.sin(me.aim) * U.dist, list = [];
      for (let i = 0; i < U.count; i++) {
        const an = Math.random() * Math.PI * 2, d = Math.random() * U.spread;
        list.push([Math.round(clamp(cx + Math.cos(an) * d, 0, MAP.w)), Math.round(clamp(cy + Math.sin(an) * d, 0, MAP.h)), +(0.6 + Math.random() * 3.4).toFixed(2), U.radius, U.damage]);
      }
      for (const s of list) G.strikes.push({ x: s[0], y: s[1], t: s[2], max: s[2], r: s[3], dmg: s[4], owner: myOwnerId() });
      if (G.mode === 'mp') Net.send({ t: 'ult', k, s: list });
    }
    if (k === 'timestop') {
      for (const e of G.enemies) e.frozen = U.duration;
      me.slowT = U.duration;
      G.rings.push({ x: me.x, y: me.y, r: 900, life: 0.8, max: 0.8, color: '116,185,255' });
      if (G.mode === 'mp') Net.send({ t: 'ult', k });
    }
    if (k === 'juggernaut') { me.juggT = U.duration; me.shield = U.shield; me.shieldT = U.duration; }
    if (k === 'overdrive') me.overT = U.duration;
    if (k === 'megaslam') {
      slam(me.x, me.y, U.radius, U.damage, U.kb, myOwnerId());
      if (G.mode === 'mp') Net.send({ t: 'aoe', x: Math.round(me.x), y: Math.round(me.y), r: U.radius, dmg: U.damage, kb: U.kb });
      G.shake = 25;
    }
    if (k === 'carpet') {
      const list = [], px = -Math.sin(me.aim), py = Math.cos(me.aim);
      for (let i = 0; i < U.count; i++) {
        const along = 150 + Math.random() * U.length, side = (Math.random() - 0.5) * U.width;
        list.push([Math.round(clamp(me.x + Math.cos(me.aim) * along + px * side, 0, MAP.w)), Math.round(clamp(me.y + Math.sin(me.aim) * along + py * side, 0, MAP.h)),
          +(0.6 + (along / U.length) * 2 + Math.random() * 0.3).toFixed(2), U.radius, U.damage]);
      }
      for (const s of list) G.strikes.push({ x: s[0], y: s[1], t: s[2], max: s[2], r: s[3], dmg: s[4], owner: myOwnerId() });
      if (G.mode === 'mp') Net.send({ t: 'ult', k, s: list });
    }
    if (k === 'fortress') {
      for (let i = 0; i < U.walls; i++) {
        const an = i * Math.PI * 2 / U.walls;
        landGadget({ kind: 'barrier', x1: me.x + Math.cos(an) * U.ring, y1: me.y + Math.sin(an) * U.ring, a: an, owner: myOwnerId(), dur: 10, noMerge: true });
      }
      landGadget({ kind: 'bubble', x1: me.x, y1: me.y, a: 0, owner: myOwnerId() });
    }
    if (k === 'blinkstorm') { me.stormN = U.jumps; me.stormT = 0; }
    if (k === 'frenzy') { heal(U.heal); me.frenzyT = U.duration; }
    if (k === 'turretnest') {
      const side = me.guns[1];
      for (let i = 0; i < U.count; i++) {
        const an = me.aim + i * Math.PI * 2 / U.count, c = { x: me.x + Math.cos(an) * U.ring, y: me.y + Math.sin(an) * U.ring, r: 16 };
        collideWorld(c);
        G.turrets.push({ x: c.x, y: c.y, t: ABILITIES.turret.duration, hp: ABILITIES.turret.hp, maxHp: ABILITIES.turret.hp, cd: 0.3 + i * 0.1, aim: an, stats: side.stats, sprite: side.sprite });
        burst(c.x, c.y, U.color, 12, 200);
      }
    }
    if (k === 'blizzard') {
      for (let i = 0; i < U.count; i++) {
        const an = Math.random() * Math.PI * 2, d = 320 + Math.random() * 350;
        G.nades.push({ x0: me.x, y0: me.y, x1: clamp(me.x + Math.cos(an) * d, 0, MAP.w), y1: clamp(me.y + Math.sin(an) * d, 0, MAP.h), t: -i * 0.3, owner: myOwnerId(), kind: 'freeze', a: an });
      }
    }
    if (k === 'tracker') { me.trackT = U.duration; if (G.mode === 'mp') Net.send({ t: 'ult', k }); }
  }

  function updateUlt(dt) {
    const me = G.me;
    if (Input.take('ultPress') && me.ult && me.alive) useUlt();
    me.miniT = Math.max(0, me.miniT - dt);
    me.godT = Math.max(0, me.godT - dt);
    for (const k of ['wallT', 'rocketT', 'trackT', 'juggT', 'overT', 'stimT', 'frenzyT']) me[k] = Math.max(0, me[k] - dt);
    if (me.stormN > 0) { // blink storm
      me.stormT -= dt;
      if (me.stormT <= 0) {
        const U = ULTIMATES.blinkstorm;
        me.stormT = U.every;
        if (stepBehind(1000)) {
          me.stormN--;
          slam(me.x, me.y, U.radius, U.damage, 6, myOwnerId());
          if (G.mode === 'mp') Net.send({ t: 'aoe', x: Math.round(me.x), y: Math.round(me.y), r: U.radius, dmg: U.damage, kb: 6 });
        } else me.stormN = 0;
      }
    }
    if (me.overT > 0) for (const s of allSlots()) { s.abCd = 0; if (s.abUses < 1) s.abUses = 1; } // overdrive: ability spam
    if (me.fountT > 0) {
      me.fountT -= dt; me.fountTick -= dt;
      if (me.fountTick <= 0) { me.fountTick = 1; if (me.alive && me.hp < me.maxHp) heal(ULTIMATES.fountain.perSec); }
    }
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
      if (s.boomed) { s.post -= dt; if (s.post <= 0) s.done = true; continue; }
      s.t -= dt;
      if (s.t <= 0) {
        s.done = true;
        if (s.orb) { s.done = false; s.boomed = true; s.post = 0.45; G.shake = Math.max(G.shake || 0, 16); G.blooms.push({ x: s.x, y: s.y, r: 170, col: '#ff2e63', life: 0.5, max: 0.5 }); burst(s.x, s.y, '#ffd1dc', 40, 600); G.rings.push({ x: s.x, y: s.y, r: s.r * 1.4, life: 0.6, max: 0.6, color: '255,46,99' }); }
        explode(s.x, s.y, s.r, s.dmg, s.owner);
        if (s.cryo) { // CRYO MORTAR
          areaOf(s, s.r, e => { e.frozen = Math.max(e.frozen || 0, COMBO.cryoMortar); }, () => { G.me.frozenT = Math.max(G.me.frozenT, COMBO.cryoMortar); });
          G.rings.push({ x: s.x, y: s.y, r: s.r, life: 0.5, max: 0.5, color: '126,214,255' });
        }
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
      if (s.orb) { drawSkyBeam(s); continue; }
      if (s.sx !== undefined) { // mortar shell arcing through the air
        const px = s.sx + (s.x - s.sx) * k, py = s.sy + (s.y - s.sy) * k - Math.sin(k * Math.PI) * 160;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(s.sx + (s.x - s.sx) * k, s.sy + (s.y - s.sy) * k, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = s.cryo ? '#9ee7ff' : '#2d3436'; ctx.strokeStyle = s.cryo ? '#dff6ff' : '#e67e22'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 6 + Math.sin(k * Math.PI) * 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
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

  // RAILGUN look: spinning armored ring, hex base, glowing coil barrel, pulsing core, layered electric bolt
  function drawRailgun(t) {
    const T = G.time, spin = t.spin || 0, kick = t.kick || 0;
    ctx.save();
    // electric glow on the floor
    const glow = ctx.createRadialGradient(t.x, t.y, 10, t.x, t.y, 70);
    glow.addColorStop(0, 'rgba(72,219,251,0.35)'); glow.addColorStop(1, 'rgba(72,219,251,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(t.x, t.y, 70, 0, Math.PI * 2); ctx.fill();
    // hexagon base
    ctx.fillStyle = '#141a20'; ctx.strokeStyle = '#2e86de'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; ctx.lineTo(t.x + Math.cos(a) * 34, t.y + Math.sin(a) * 34); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // spinning outer ring segments
    ctx.strokeStyle = '#48dbfb'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = spin + i * Math.PI * 2 / 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, 40, a, a + 1.3); ctx.stroke();
    }
    // corner capacitor lights
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.PI / 6, on = Math.sin(T * 8 + i) > 0;
      ctx.fillStyle = on ? '#c7f4ff' : '#1e5f7a';
      ctx.beginPath(); ctx.arc(t.x + Math.cos(a) * 28, t.y + Math.sin(a) * 28, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    // the gun itself
    ctx.translate(t.x, t.y); ctx.rotate(t.aim); ctx.translate(-kick, 0);
    // twin rails
    ctx.fillStyle = '#2f3640'; ctx.strokeStyle = '#0c1014'; ctx.lineWidth = 2;
    ctx.fillRect(-14, -12, 76, 7); ctx.strokeRect(-14, -12, 76, 7);
    ctx.fillRect(-14, 5, 76, 7); ctx.strokeRect(-14, 5, 76, 7);
    // energy channel between the rails
    const ch = ctx.createLinearGradient(0, 0, 66, 0);
    ch.addColorStop(0, 'rgba(72,219,251,0.4)'); ch.addColorStop(1, `rgba(199,244,255,${0.6 + 0.4 * Math.sin(T * 30)})`);
    ctx.fillStyle = ch; ctx.fillRect(-4, -4, 68, 8);
    // glowing coils along the barrel
    for (let i = 0; i < 4; i++) {
      const x = 8 + i * 14, pulse = 0.5 + 0.5 * Math.sin(T * 14 - i * 1.2);
      ctx.fillStyle = `rgba(72,219,251,${0.4 + 0.6 * pulse})`;
      ctx.fillRect(x, -15, 5, 30);
    }
    // muzzle charge
    const mz = ctx.createRadialGradient(68, 0, 0, 68, 0, 12);
    mz.addColorStop(0, 'rgba(255,255,255,0.95)'); mz.addColorStop(1, 'rgba(72,219,251,0)');
    ctx.fillStyle = mz; ctx.beginPath(); ctx.arc(68, 0, 12 + Math.sin(T * 40) * 2, 0, Math.PI * 2); ctx.fill();
    // back housing
    ctx.fillStyle = '#1e272e'; ctx.strokeStyle = '#2e86de'; ctx.lineWidth = 2;
    ctx.fillRect(-22, -16, 20, 32); ctx.strokeRect(-22, -16, 20, 32);
    ctx.restore();
    // pulsing core
    const core = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, 14);
    core.addColorStop(0, '#ffffff'); core.addColorStop(0.5, '#7efcff'); core.addColorStop(1, 'rgba(46,134,222,0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(t.x, t.y, 12 + Math.sin(T * 25) * 2, 0, Math.PI * 2); ctx.fill();
    // the bolt: wide soft glow, then a jagged white-hot core, plus a few side forks
    if (t.zap) {
      const z = t.zap, a = z.life / 0.09;
      const pts = [[z.x0, z.y0]];
      for (let i = 1; i < 12; i++) { const k = i / 12; pts.push([z.x0 + (z.x - z.x0) * k + (Math.random() - 0.5) * 24, z.y0 + (z.y - z.y0) * k + (Math.random() - 0.5) * 24]); }
      pts.push([z.x, z.y]);
      const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); };
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(72,219,251,${0.35 * a})`; ctx.lineWidth = 16; path(); ctx.stroke();
      ctx.strokeStyle = `rgba(126,252,255,${0.8 * a})`; ctx.lineWidth = 6; path(); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = 2; path(); ctx.stroke();
      ctx.strokeStyle = `rgba(199,244,255,${0.7 * a})`; ctx.lineWidth = 2;
      for (let i = 3; i < pts.length - 1; i += 3) {
        const [px, py] = pts[i], fa = Math.random() * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(fa) * 30, py + Math.sin(fa) * 30); ctx.stroke();
      }
      // impact flash
      const im = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, 26);
      im.addColorStop(0, `rgba(255,255,255,${a})`); im.addColorStop(1, 'rgba(72,219,251,0)');
      ctx.fillStyle = im; ctx.beginPath(); ctx.arc(z.x, z.y, 26, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (t.flash > 0) { t.flash -= 1 / 60; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(t.x, t.y, 34, 0, Math.PI * 2); ctx.fill(); }
    drawBar(t.x, t.y - 50, 64, 6, t.hp / t.maxHp, false, '#48dbfb');
    ctx.fillStyle = '#c7f4ff'; ctx.font = '900 10px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('RAILGUN', t.x, t.y - 56);
  }

  // FORTRESS: 4-barrel gun + rockets, regenerating shield, overshield for you inside its dome
  function updateFortress(t, dt) {
    const F = FORMATIONS.fortress, me = G.me;
    t.kick = Math.max(0, (t.kick || 0) - 50 * dt); t.shHit = Math.max(0, (t.shHit || 0) - dt);
    if (G.time - (t.lastHit || 0) > F.shieldDelay) t.sh = Math.min(F.shield, t.sh + F.shieldRegen * dt);
    let best = null, bd = F.range;
    for (const e of targets()) { const d = Math.hypot(e.x - t.x, e.y - t.y); if (d < bd && lineOfSight(t.x, t.y, e.x, e.y)) { best = e; bd = d; } }
    if (best) t.aim = Math.atan2(best.y - t.y, best.x - t.x);
    t.spin = (t.spin || 0) + dt * (best ? 14 : 1);
    if (best && t.cd <= 0) {
      t.cd = F.every; t.bar = (t.bar + 1) % 4;
      const off = [-9, -3, 3, 9][t.bar], c = Math.cos(t.aim), si = Math.sin(t.aim);
      const sx = t.x + c * 46 - si * off, sy = t.y + si * 46 + c * off;
      fireBullets(sx, sy, [+(t.aim + (Math.random() - 0.5) * 0.04).toFixed(4)], F.speed, F.damage, 0.4, F.range, 3 * HEAR_UNIT);
      flashAt(sx, sy, '#ffd36b', 20); t.kick = 3;
    }
    t.rk -= dt;
    if (best && t.rk <= 0) {
      t.rk = F.rocketEvery;
      const sx = t.x + Math.cos(t.aim) * 30, sy = t.y + Math.sin(t.aim) * 30;
      addRocket(sx, sy, t.aim, myOwnerId()); flashAt(sx, sy, '#ff9f43', 40);
      if (G.mode === 'mp') Net.send({ t: 'rpg', x: Math.round(sx), y: Math.round(sy), a: +t.aim.toFixed(4) });
    }
    t.ov -= dt;
    if (t.ov <= 0) {
      t.ov = F.overEvery; t.ring = 0.5;
      if (me.alive && Math.hypot(me.x - t.x, me.y - t.y) <= F.dome) { me.shield = Math.max(me.shield, F.overshield); me.shieldT = Math.max(me.shieldT, ABILITIES.shieldgen.shieldTime); }
    }
  }

  // FORTRESS: armored octagon, 4 shield pylons, gatling head with a rocket pod, regenerating shield bubble
  function drawFortress(t) {
    const F = FORMATIONS.fortress, T = G.time, shf = Math.max(0, t.sh / F.shield);
    ctx.strokeStyle = 'rgba(108,92,231,0.25)'; ctx.lineWidth = 2; ctx.setLineDash(DASH);
    ctx.beginPath(); ctx.arc(t.x, t.y, F.dome, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash(NODASH);
    if (t.ring > 0) { t.ring -= 1 / 60; ctx.strokeStyle = `rgba(200,190,255,${t.ring * 2})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(t.x, t.y, F.dome * (1 - t.ring), 0, Math.PI * 2); ctx.stroke(); }
    ctx.save(); ctx.translate(t.x, t.y);
    bShadow(44, 34);
    if (t.bunker) { ctx.fillStyle = '#5a6670'; bPoly(8, 48, Math.PI / 8); ctx.fill(); }
    ctx.fillStyle = '#16171d'; bPoly(8, 44, Math.PI / 8); ctx.fill();
    ctx.fillStyle = t.flash > 0 ? '#fff' : '#3a3d4a'; bPoly(8, 41, Math.PI / 8); ctx.fill();
    ctx.fillStyle = '#4a4e60'; bPoly(8, 30, Math.PI / 8); ctx.fill();
    ctx.strokeStyle = '#16171d'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); ctx.lineTo(Math.cos(a) * 41, Math.sin(a) * 41); ctx.stroke(); }
    bGoldRing(8, 41, Math.PI / 8); bBolts(8, 36, 0, '#ffd700');
    for (let i = 0; i < 4; i++) { // shield pylons
      const a = i * Math.PI / 2 + Math.PI / 4, px = Math.cos(a) * 34, py = Math.sin(a) * 34;
      ctx.fillStyle = '#2a2550'; ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a29bfe'; ctx.beginPath(); ctx.arc(px, py - 1, 3, 0, Math.PI * 2); ctx.fill();
      glow(px, py - 1, 12 * (0.5 + shf * 0.6), '#a29bfe', 0.8);
    }
    // gun head
    ctx.rotate(t.aim);
    ctx.fillStyle = '#23252e'; ctx.fillRect(-18, -17, 30, 34); ctx.fillStyle = '#6b6f85'; ctx.fillRect(-18, -17, 30, 4);
    ctx.fillStyle = '#ffd700'; ctx.fillRect(-18, 13, 30, 2);
    const k = t.kick || 0;
    ctx.fillStyle = '#15171b'; ctx.fillRect(10 - k, -12, 8, 24); // barrel clamp
    for (let i = 0; i < 4; i++) { // 4 spinning barrels (shaded by fake rotation)
      const off = [-9, -3, 3, 9][i], sh = 0.5 + 0.5 * Math.sin(t.spin + i * 1.6);
      ctx.fillStyle = `rgb(${40 + sh * 70},${42 + sh * 70},${50 + sh * 74})`; ctx.fillRect(12 - k, off - 2, 36, 4);
    }
    ctx.fillStyle = '#ffd700'; ctx.fillRect(44 - k, -12, 3, 24);
    ctx.fillStyle = '#3e4a34'; ctx.fillRect(-14, -27, 26, 10); ctx.fillStyle = '#5d6d4e'; ctx.fillRect(-14, -27, 26, 3); // rocket pod
    if (t.rk > 1) { ctx.fillStyle = '#e17055'; ctx.beginPath(); ctx.arc(13, -22, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // shield bubble (brighter when hit)
    if (shf > 0) {
      ctx.strokeStyle = `rgba(162,155,254,${0.25 + 0.4 * shf + (t.shHit > 0 ? 0.35 : 0)})`; ctx.lineWidth = 3 + (t.shHit > 0 ? 3 : 0);
      ctx.beginPath(); ctx.arc(t.x, t.y, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(108,92,231,${0.06 + 0.06 * shf})`; ctx.fill();
    }
    if (t.flash > 0) t.flash -= 1 / 60;
    drawBar(t.x, t.y - 62, 70, 6, t.hp / t.maxHp, false, '#cd84f1');
    drawBar(t.x, t.y - 55, 70, 4, shf, false, '#a29bfe');
    ctx.fillStyle = '#d6d2ff'; ctx.font = '900 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('FORTRESS', t.x, t.y - 70);
  }

  // heal zones and turrets
  function updateGadgets(dt) {
    const me = G.me, M = ABILITIES.medic, T = ABILITIES.turret;
    for (const z of G.zones) {
      z.t -= dt; z.tick -= dt; z.age += dt;
      if (z.tick <= 0) {
        z.tick = 1;
        if (me.alive && me.hp < me.maxHp && Math.hypot(me.x - z.x, me.y - z.y) <= M.radius) heal(M.perSec);
        healBuddies(z.x, z.y, M.radius, M.perSec);
      }
    }
    G.zones = G.zones.filter(z => z.t > 0);
    for (const h of G.healShots) { // heal turret bullets
      const c = h.tgt, d = Math.hypot(c.x - h.x, c.y - h.y), step = COMBO.healShotSpeed * dt;
      if ((c === me && !me.alive) || c.dead) { h.done = true; continue; }
      if (d <= step + 14) {
        h.done = true;
        if (c === me) heal(h.amt);
        else { c.hp = Math.min(c.maxHp, c.hp + h.amt); G.texts.push({ x: c.x, y: c.y - 34, text: `+${h.amt}`, color: '#4cff7a', life: 0.9 }); }
        burst(c.x, c.y, '#32ff7e', 12, 180);
      } else { h.x += (c.x - h.x) / d * step; h.y += (c.y - h.y) / d * step; }
    }
    G.healShots = G.healShots.filter(h => !h.done);
    for (const t of G.turrets) {
      t.t -= dt; t.cd -= dt * lvlRate(t);
      if (t.age === undefined) { t.age = 0; landFx(t.x, t.y, '#cd84f1', t.fort ? 1.9 : t.rail ? 1.6 : t.rocket ? 1.3 : 1); }
      t.age += dt;
      if (t.shieldT > 0) t.shieldT -= dt;
      if (t.fort) { updateFortress(t, dt); continue; }
      if (t.rail) { // RAILGUN: fast, long range bolts of electricity
        const R = MERGE.railgun;
        if (t.zap) { t.zap.life -= dt; if (t.zap.life <= 0) t.zap = null; }
        t.kick = Math.max(0, (t.kick || 0) - 60 * dt);
        let best = null, bd = R.range;
        for (const e of targets()) { const d = Math.hypot(e.x - t.x, e.y - t.y); if (d < bd && lineOfSight(t.x, t.y, e.x, e.y)) { best = e; bd = d; } }
        if (best) t.aim = Math.atan2(best.y - t.y, best.x - t.x);
        t.spin = (t.spin || 0) + dt * (best ? 4 : 1); // ring spins faster while it has a target
        if (best && t.cd <= 0) {
          t.cd = R.every;
          const sx = t.x + Math.cos(t.aim) * 40, sy = t.y + Math.sin(t.aim) * 40;
          fireBullets(sx, sy, [+t.aim.toFixed(4)], R.speed, R.damage, 0.3, R.range, 4 * HEAR_UNIT);
          t.zap = { x0: sx, y0: sy, x: best.x, y: best.y, life: 0.09 };
          t.kick = 7; flashAt(sx, sy, '#48dbfb', 32); flashAt(best.x, best.y, '#c7f4ff', 22); // recoil
          for (let i = 0; i < 4; i++) { // sparks where it hits
            const an = Math.random() * Math.PI * 2, v = 120 + Math.random() * 220;
            G.fx.push({ x: best.x, y: best.y, vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: 0.25, max: 0.25, size: 4, color: Math.random() < 0.5 ? '#c7f4ff' : '#48dbfb' });
          }
        }
        continue;
      }
      if (t.rocket) { // ROCKET TURRET: an RPG every 5 seconds
        const R = MERGE.rocketTurret;
        let best = null, bd = R.range;
        for (const e of targets()) { const d = Math.hypot(e.x - t.x, e.y - t.y); if (d < bd && lineOfSight(t.x, t.y, e.x, e.y)) { best = e; bd = d; } }
        if (best) t.aim = Math.atan2(best.y - t.y, best.x - t.x);
        if (best && t.cd <= 0) {
          t.cd = R.every;
          const sx = t.x + Math.cos(t.aim) * 34, sy = t.y + Math.sin(t.aim) * 34;
          addRocket(sx, sy, t.aim, myOwnerId()); flashAt(sx, sy, '#ff9f43', 40);
          if (G.mode === 'mp') Net.send({ t: 'rpg', x: Math.round(sx), y: Math.round(sy), a: +t.aim.toFixed(4) });
          muzzleFlash(sx, sy, t.aim);
        }
        continue;
      }
      if (t.healer) { // HEAL TURRET: healing beam at the most hurt buddy (or you) it can see
        t.beamT -= dt;
        if (t.beam) { t.beam.life -= dt; if (t.beam.life <= 0) t.beam = null; }
        if (t.beamT <= 0) {
          const me = G.me, cands = G.gadgets.filter(g => g.kind === 'decoy' && !g.dead && isMine(g.owner) && g.hp < g.maxHp);
          if (me.alive && me.hp < me.maxHp) cands.push(me);
          let pick = null, worst = 1;
          for (const c of cands) {
            const frac = c.hp / c.maxHp;
            if (frac < worst && Math.hypot(c.x - t.x, c.y - t.y) <= COMBO.healRange && lineOfSight(t.x, t.y, c.x, c.y)) { pick = c; worst = frac; }
          }
          if (pick) {
            t.beamT = COMBO.healEvery;
            t.aim = Math.atan2(pick.y - t.y, pick.x - t.x);
            // fires a green heal bullet that homes in on them and heals on hit
            G.healShots.push({ x: t.x + Math.cos(t.aim) * 24, y: t.y + Math.sin(t.aim) * 24, tgt: pick, amt: pick === me ? COMBO.healBeamMe : COMBO.healBeam });
            burst(t.x + Math.cos(t.aim) * 24, t.y + Math.sin(t.aim) * 24, '#32ff7e', 6, 120);
          } else t.beamT = 0.3;
        }
      }
      if (t.medic) { // medic turret heals you when you're close
        t.healT -= dt;
        if (t.healT <= 0) { // 5 HP every 3s, only when you're out of combat
          t.healT = COMBO.medicEvery;
          const me = G.me, calm = G.time - G.lastCombat >= COMBO.medicCalm;
          if (calm && me.alive && me.hp < me.maxHp && Math.hypot(me.x - t.x, me.y - t.y) <= COMBO.medicRadius) heal(COMBO.medicHeal);
          healBuddies(t.x, t.y, COMBO.medicRadius, COMBO.medicHeal);
        }
      }
      // spotter turrets see through walls from very far away
      let best = null, bd = t.spot ? COMBO.spotRange : t.stats.range; // otherwise as far as your sidearm shoots
      for (const e of targets()) {
        const d = Math.hypot(e.x - t.x, e.y - t.y);
        if (d < bd && (t.spot || lineOfSight(t.x, t.y, e.x, e.y))) { best = e; bd = d; }
      }
      if (best) t.aim = Math.atan2(best.y - t.y, best.x - t.x);
      if (best && t.cd <= 0) {
        const s = t.stats;
        t.cd = Math.max(s.fireDelay, s.reloadTime / s.magSize, 0.15); // reloads built in, never runs dry
        flashAt(t.x + Math.cos(t.aim) * 26, t.y + Math.sin(t.aim) * 26, t.flame ? '#ff7a1a' : '#ffd36b', 22);
        shootFrom(t.x + Math.cos(t.aim) * 20, t.y + Math.sin(t.aim) * 20, t.aim, t.flame ? { ...s, damage: s.damage * COMBO.flameMul } : s, t.spot ? { kind: { ghost: 1 }, range: COMBO.spotRange } : {});
      }
    }
    G.turrets = G.turrets.filter(t => t.t > 0);
  }

  // ENGINEER: outline the square of the building Upgrade would level up
  function drawUpgradePick() {
    if (!hasAb('cls_upgrade')) return;
    const b = upgradePick();
    if (!b) return;
    const C = MAP.grid, [cx, cy] = cellOf(b), k = 0.5 + 0.5 * Math.sin(G.time * 6);
    ctx.strokeStyle = `rgba(255,215,0,${0.5 + 0.4 * k})`; ctx.lineWidth = 3; ctx.setLineDash([10, 6]);
    ctx.strokeRect(cx * C + 3, cy * C + 3, C - 6, C - 6); ctx.setLineDash([]);
  }
  function drawGadgets() {
    drawUpgradePick();
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
    for (const h of G.healShots) { // heal turret bullets: glowing green orb with a cross
      ctx.fillStyle = 'rgba(50,255,126,0.35)'; ctx.beginPath(); ctx.arc(h.x, h.y, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#32ff7e'; ctx.beginPath(); ctx.arc(h.x, h.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(h.x - 4, h.y - 1.5, 8, 3); ctx.fillRect(h.x - 1.5, h.y - 4, 3, 8);
    }
    for (const t of G.turrets) { ctx.save(); popIn(t.age, t.x, t.y); drawOneTurret(t); ctx.restore(); buildBrackets(t.age, t.x, t.y, '#cd84f1', t.fort ? 1.9 : t.rail ? 1.6 : t.rocket ? 1.3 : 1); }
    function drawOneTurret(t) {
      if (t.rail) { if (t.bunker) drawBunker(t, 40); drawRailgun(t); return; }
      if (t.fort) { drawFortress(t); return; }
      if (t.rocket) {
        ctx.save(); ctx.translate(t.x, t.y); bShadow(30, 24); ctx.restore();
        if (t.bunker) drawBunker(t, 34);
        ctx.save(); ctx.translate(t.x, t.y);
        ctx.fillStyle = '#1f2026'; bPoly(8, 28, Math.PI / 8); ctx.fill();
        ctx.fillStyle = t.flash > 0 ? '#fff' : '#3d3f4c'; bPoly(8, 26, Math.PI / 8); ctx.fill();
        ctx.fillStyle = '#4f5263'; bPoly(8, 19, Math.PI / 8); ctx.fill();
        ctx.strokeStyle = '#1f2026'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 19, Math.sin(a) * 19); ctx.lineTo(Math.cos(a) * 26, Math.sin(a) * 26); ctx.stroke(); }
        bGoldRing(8, 26, Math.PI / 8); bBolts(8, 22.5, 0, '#ffd700');
        glow(0, 0, 34, '#e17055', 0.18 + 0.08 * Math.sin(G.time * 4));
        ctx.rotate(t.aim);
        ctx.fillStyle = '#26282f'; ctx.fillRect(-12, -10, 20, 20); ctx.fillStyle = '#6b6f85'; ctx.fillRect(-12, -10, 20, 3);
        for (const oy of [-14, 3]) { // two launch pods, 3 rockets each (noses show when loaded)
          ctx.fillStyle = '#3e4a34'; ctx.fillRect(-6, oy, 40, 11); ctx.fillStyle = '#5d6d4e'; ctx.fillRect(-6, oy, 40, 3);
          ctx.fillStyle = '#ffd700'; ctx.fillRect(-6, oy + 4.5, 40, 1);
          for (let k = 0; k < 2; k++) { ctx.fillStyle = '#15171b'; ctx.beginPath(); ctx.arc(33, oy + 3 + k * 5, 2.4, 0, Math.PI * 2); ctx.fill(); if (t.cd < MERGE.rocketTurret.every - 1) { ctx.fillStyle = '#e17055'; ctx.beginPath(); ctx.arc(33, oy + 3 + k * 5, 1.6, 0, Math.PI * 2); ctx.fill(); } }
        }
        ctx.restore();
        if (t.flash > 0) { t.flash -= 1 / 60; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(t.x, t.y, 26, 0, Math.PI * 2); ctx.fill(); }
        drawBar(t.x, t.y - 38, 56, 6, t.hp / t.maxHp, false, '#e17055');
        return;
      }
      if (t.beam) {
        ctx.save(); ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(50,255,126,${0.35 * t.beam.life / 0.35})`; ctx.lineWidth = 14;
        ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.beam.x, t.beam.y); ctx.stroke();
        ctx.strokeStyle = `rgba(220,255,230,${t.beam.life / 0.35})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.beam.x, t.beam.y); ctx.stroke();
        ctx.restore();
      }
      if (t.healer) { ctx.strokeStyle = '#32ff7e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(t.x, t.y, 22, 0, Math.PI * 2); ctx.stroke(); }
      if (t.medic) {
        const k = (G.time % 1.2) / 1.2;
        ctx.strokeStyle = `rgba(50,255,126,${0.5 * (1 - k)})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.x, t.y, 20 + k * (COMBO.medicRadius - 20), 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(50,255,126,0.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t.x, t.y, COMBO.medicRadius, 0, Math.PI * 2); ctx.stroke();
      }
      if (t.shieldT > 0) { ctx.strokeStyle = `rgba(126,249,255,${0.6 + 0.3 * Math.sin(G.time * 8)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(t.x, t.y, 26, 0, Math.PI * 2); ctx.stroke(); }
      if (t.flame) { ctx.fillStyle = `rgba(255,107,26,${0.25 + 0.15 * Math.sin(G.time * 12)})`; ctx.beginPath(); ctx.arc(t.x, t.y, 24, 0, Math.PI * 2); ctx.fill(); }
      if (t.spot) { // radar dish on the back + scanning sweep
        ctx.strokeStyle = 'rgba(255,159,243,0.35)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.arc(t.x, t.y, 60, G.time * 4, G.time * 4 + 0.6); ctx.closePath(); ctx.stroke();
      }
      drawTurret(t);
      if (t.medic) { ctx.fillStyle = '#32ff7e'; ctx.fillRect(t.x - 3, t.y + 4, 6, 14); ctx.fillRect(t.x - 7, t.y + 8, 14, 6); }
      if (t.spot) { ctx.fillStyle = '#ff9ff3'; ctx.beginPath(); ctx.arc(t.x - 12, t.y - 12, 6, 0, Math.PI * 2); ctx.fill(); }
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.aim);
      if (Math.cos(t.aim) < 0) ctx.scale(1, -1);
      const sp = t.sprite, k = 0.6; // your sidearm sitting on top
      ctx.drawImage(sp.canvas, sp.minX * k, sp.minY * k - 6, sp.w * k, sp.h * k);
      ctx.restore();
      if (t.flash > 0) { t.flash -= 1 / 60; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(t.x, t.y, 16, 0, Math.PI * 2); ctx.fill(); }
      drawBar(t.x, t.y - (t.bunker ? 34 : 28), 40, 5, t.hp / t.maxHp, false, t.bunker ? '#c8d6e5' : '#cd84f1');
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
    if (kind === 'decoy') { // max 5 decoys out at once (clones from Clone Army don't count)
      const out = G.gadgets.filter(g => g.kind === 'decoy' && !g.dead && !g.dur && !g.supply && isMine(g.owner)).length + G.nades.filter(n => n.kind === 'decoy').length;
      if (out >= ABILITIES.decoy.max) { G.banner = { text: `Max ${ABILITIES.decoy.max} decoys`, t: 1.2 }; return; }
    }
    G.nades.push({ x0: me.x, y0: me.y, x1: t.x, y1: t.y, t: 0, owner: myOwnerId(), kind, a: me.aim });
    if (ABILITY_GROUPS[2].ids.includes(kind)) me.lastThrow = kind;
    if (me.trapT > 0 && ABILITY_GROUPS[1].ids.includes(kind)) { // TRAPPER Double Trap: a 2nd copy lands beside it
      me.trapT = 0;
      const sa = me.aim + Math.PI / 2, x1 = clamp(t.x + Math.cos(sa) * 70, 20, MAP.w - 20), y1 = clamp(t.y + Math.sin(sa) * 70, 20, MAP.h - 20);
      G.nades.push({ x0: me.x, y0: me.y, x1, y1, t: -0.1, owner: myOwnerId(), kind, a: me.aim });
    }
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
      const medT = n.kind === 'medic' && isMine(n.owner) && G.turrets.find(t => t.medic && !t.healer && t.hp > 0 && Math.hypot(t.x - n.x1, t.y - n.y1) <= COMBO.near);
      if (medT) { medT.healer = true; medT.beamT = 1; comboFx(medT.x, medT.y, '#32ff7e', 'HEAL TURRET'); continue; }
      const hg = n.kind === 'medic' && isMine(n.owner) && myGadget('hangar', n.x1, n.y1, COMBO.near); // MEDIC DRONES (heal zone used up)
      if (hg && !hg.medic) { upgradeGadget(hg, 'medic'); comboFx(hg.x, hg.y, '#32ff7e', 'MEDIC DRONES'); continue; }
      const dome = n.kind === 'medic' && isMine(n.owner) && myGadget('bubble', n.x1, n.y1, ABILITIES.bubble.radius);
      const bud = n.kind === 'medic' && isMine(n.owner) && myGadget('decoy', n.x1, n.y1, COMBO.near);
      if (dome && !dome.heal) { upgradeGadget(dome, 'heal'); dome.t += COMBO.domeTime; comboFx(dome.x, dome.y, '#32ff7e', 'HEALING DOME'); }
      else if (bud && !bud.medicBuddy) { bud.medicBuddy = true; bud.healT = 1; comboFx(bud.x, bud.y, '#32ff7e', 'MEDIC BUDDY'); }
      else if (n.kind === 'medic' && nearTurret(n.x1, n.y1)) { // MEDIC TURRET
        const t = nearTurret(n.x1, n.y1);
        t.medic = true; t.healT = 1;
        comboFx(t.x, t.y, '#32ff7e', 'MEDIC TURRET');
      }
      else if (n.kind === 'medic') {
        G.zones.push({ x: n.x1, y: n.y1, t: ABILITIES.medic.duration, tick: 1, age: 0 });
        // landing effect: green splash + sparkles
        burst(n.x1, n.y1, '#32ff7e', 26, 320);
        burst(n.x1, n.y1, '#eafff1', 10, 180);
        G.fx.push({ x: n.x1, y: n.y1, vx: 0, vy: 0, life: 0.2, max: 0.2, size: ABILITIES.medic.radius * 1.2, color: 'rgba(50,255,126,0.35)' });
      }
      else if (n.kind === 'turret') {
        // the turret gets a copy of your sidearm
        const side = me.guns[1];
        ({ x: n.x1, y: n.y1 } = snapCell(n.x1, n.y1));
        if (cellBlocked('turret', n.x1, n.y1)) { refundThrow('turret', n.x1, n.y1); continue; }
        setTimeout(() => {
          if (!G) return;
          mergeTurrets(n.x1, n.y1);
          const rd = myGadget('radar', n.x1, n.y1, COMBO.near), t = nearTurret(n.x1, n.y1);
          if (rd && t) { removeGadget(rd); if (G.mode === 'mp') Net.send({ t: 'gadx', id: rd.id }); t.spot = true; comboFx(t.x, t.y, '#ff9ff3', 'SPOTTER TURRET'); }
        }, 0);
        G.turrets.push({ x: n.x1, y: n.y1, t: ABILITIES.turret.duration, hp: ABILITIES.turret.hp, maxHp: ABILITIES.turret.hp, cd: 0.5, aim: 0, stats: side.stats, sprite: side.sprite });
      } else if (n.kind === 'resupply') landSupply(n);
      else if (n.kind === 'cluster') {
        const C = ABILITIES.cluster, list = [];
        for (let i = 0; i < C.bombs; i++) {
          const an = i * Math.PI * 2 / C.bombs + Math.random() * 0.5, d = 40 + Math.random() * (C.radius - 40);
          list.push([Math.round(n.x1 + Math.cos(an) * d), Math.round(n.y1 + Math.sin(an) * d), +(0.1 + i * 0.08).toFixed(2), C.bombRadius, C.damage]);
        }
        burst(n.x1, n.y1, C.color, 16, 260);
        for (const s of list) G.strikes.push({ x: s[0], y: s[1], t: s[2], max: s[2], r: s[3], dmg: s[4], owner: n.owner });
        if (G.mode === 'mp') Net.send({ t: 'ult', k: 'cluster', s: list });
      } else if (ABILITIES[n.kind] && ABILITIES[n.kind].gadget) landGadget(n);
      else {
        const bh = isMine(n.owner) && myGadget('blackhole', n.x1, n.y1, ABILITIES.blackhole.radius);
        if (bh) { // SINGULARITY
          removeGadget(bh);
          if (G.mode === 'mp') Net.send({ t: 'gadx', id: bh.id });
          const s = [Math.round(bh.x), Math.round(bh.y), 0.05, COMBO.singRadius, COMBO.singDamage];
          G.strikes.push({ x: s[0], y: s[1], t: s[2], max: s[2], r: s[3], dmg: s[4], owner: n.owner });
          if (G.mode === 'mp') Net.send({ t: 'ult', k: 'sing', s: [s] });
          comboFx(bh.x, bh.y, '#8e44ad', 'SINGULARITY');
          G.shake = 30;
        } else if (n.kind === 'grenade' && isMine(n.owner) && myGadget('gravity', n.x1, n.y1, COMBO.near) && !myGadget('gravity', n.x1, n.y1, COMBO.near).implode) { // IMPLOSION
          const gt = myGadget('gravity', n.x1, n.y1, COMBO.near);
          upgradeGadget(gt, 'implode'); comboFx(gt.x, gt.y, '#ff6bcb', 'IMPLOSION');
        } else if (n.kind === 'grenade' && isMine(n.owner) && myGadget('tesla', n.x1, n.y1, COMBO.near) && !myGadget('tesla', n.x1, n.y1, COMBO.near).storm) { // STORM COIL
          const tc = myGadget('tesla', n.x1, n.y1, COMBO.near);
          upgradeGadget(tc, 'storm'); comboFx(tc.x, tc.y, '#a29bfe', 'STORM COIL');
        } else explode(n.x1, n.y1, G_.radius, G_.damage, n.owner);
      }
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
      if (n.t < 0) continue; // not thrown yet
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
      const AA = ABILITIES[me.ability], rad = ['radar', 'mortar', 'sniper', 'laser', 'hangar', 'flame'].includes(me.ability) ? 40 : me.ability === 'barrier' ? AA.len / 2 : AA.radius || 22;
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
        if (Math.random() < EPIC_CRATE.chance * (hasAb('lucky') ? ABILITIES.lucky.epic : 1)) fresh.push({ ...randomFloorSpot(), kind: 'epic' });
        addPacks(fresh);
        if (G.mode === 'mp') Net.send({ t: 'packs', packs: fresh });
      }
    }
    if (!me.alive) return;
    if (hasAb('magnet')) for (const p of G.packs) {
      const d = Math.hypot(me.x - p.x, me.y - p.y), M = ABILITIES.magnet;
      if (d < M.range && d > 1) { p.x += (me.x - p.x) / d * M.pull * dt; p.y += (me.y - p.y) / d * M.pull * dt; }
    }
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
        // the box holds 3 mags: each gun takes the mags it needs (main gun first) until it's empty
        p.mags = p.mags ?? AMMO.box.mags;
        for (const gn of needs) {
          const per = gn.stats.boxRefill, want = Math.ceil(room(gn) / per), take = Math.min(want, p.mags);
          gn.reserve += Math.min(room(gn), take * per);
          p.mags -= take;
          if (p.mags <= 0) break;
        }
        G.texts.push({ x: me.x, y: me.y - 34, text: '+AMMO', color: '#ffd23f', life: 0.9 });
        updateWeaponBar(true);
        if (p.mags > 0) { // some left for someone else
          if (G.mode === 'mp') Net.send({ t: 'boxm', id: p.id, mags: p.mags });
          continue;
        }
      } else if (p.kind === 'supply') {
        // supply crate: one charge fills both guns all the way up
        const needs = me.guns.some(gn => gn.ammo < gn.stats.magSize || gn.reserve < gn.stats.maxReserve);
        if (!needs) continue;
        for (const gn of me.guns) { gn.reserve = gn.stats.maxReserve; gn.ammo = gn.stats.magSize; gn.reload = 0; } // completely full
        G.texts.push({ x: me.x, y: me.y - 34, text: 'RESUPPLIED', color: '#fff200', life: 1 });
        updateWeaponBar(true);
        p.mags--;
        if (p.mags > 0) { if (G.mode === 'mp') Net.send({ t: 'boxm', id: p.id, mags: p.mags }); continue; }
      } else if (p.kind === 'epic') {
        if (me.ult) continue; // already holding one
        me.ult = rollUlt(allSlots().map(s => s.ability));
        G.banner = { text: `ULTIMATE: ${ULTIMATES[me.ult].name}! (${Settings.mobile ? 'gold button' : 'press F'})`, t: 3 };
        burst(me.x, me.y, '#ffd700', 40, 400);
      } else if (p.kind === 'ability') {
        // rare red crate: all ability uses back and no cooldown
        const needs = s => { const A = ABILITIES[s.ability]; return A && A.type !== 'passive' && (s.abUses < (A.uses ?? Infinity) || s.abCd > 0); };
        if (!allSlots().some(needs)) continue;
        for (const s of allSlots()) if (needs(s)) { s.abUses = ABILITIES[s.ability].uses ?? Infinity; s.abCd = 0; }
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

  // the ultimate crate looks like the ability crate, but purple
  function drawEpicCrate(p) {
    const s = 20, glow = 0.3 + 0.18 * Math.sin(performance.now() / 180);
    ctx.fillStyle = `rgba(170,60,255,${glow})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, s * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8e44ad'; ctx.strokeStyle = '#2c0b3d'; ctx.lineWidth = 3;
    ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
    ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
    ctx.strokeStyle = '#d6a2ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s); ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '900 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('★', p.x, p.y + 1);
  }

  // thrown Resupply crate: yellow box, one light per charge left
  function drawSupplyCrate(p) {
    const s = 18;
    ctx.fillStyle = `rgba(255,242,0,${0.2 + 0.1 * Math.sin(performance.now() / 200)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, s * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e1b12c'; ctx.strokeStyle = '#4a3700'; ctx.lineWidth = 3;
    ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2); ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
    ctx.fillStyle = '#4a3700'; ctx.fillRect(p.x - s, p.y - 2, s * 2, 4);
    const n = p.mags ?? ABILITIES.resupply.charges;
    for (let i = 0; i < ABILITIES.resupply.charges; i++) {
      ctx.fillStyle = i < n ? '#fff200' : '#5c4a00';
      ctx.fillRect(p.x - s + 4 + i * 8, p.y - s + 4, 5, 6);
    }
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
    const left = p.mags ?? AMMO.box.mags;
    for (let i = -1; i <= 1; i++) if (i + 1 < left) ctx.fillRect(p.x + i * s * 0.55 - 2.5, p.y - s * 0.45, 5, s * 0.9);
  }

  function drawPacks() {
    for (const p of G.packs) {
      if (p.kind === 'ammo') { drawAmmoBox(p); continue; }
      if (p.kind === 'ability') { drawAbilityCrate(p); continue; }
      if (p.kind === 'epic') { drawEpicCrate(p); continue; }
      if (p.kind === 'supply') { drawSupplyCrate(p); continue; }
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
  const easy = () => G.mode === 'sp' && G.wave <= EASY.waves;
  function updateWaves(dt) {
    if (!G.me.alive) return;
    if (G.phase === 'break') {
      G.breakT -= dt;
      if (G.breakT > 0) return;
      G.wave++;
      if (G.mode === 'sp' && G.wave === slot3Wave() && !G.me.alt3.ability && Account.user.loadout.ability3) {
        G.me.alt3 = newSlot(Account.user.loadout.ability3); applyPerk(G.me); abCache3 = '';
      }
      if (G.mode === 'sp' && slot4Pick() && G.me.alt4.ability !== slot4Pick()) {
        G.me.alt4 = newSlot(slot4Pick()); applyPerk(G.me); abCache4 = '';
        const c = myClass();
        if (c && G.me.alt4.ability === c.ab) G.banner = { text: `${ABILITIES[c.ab].name} unlocked!`, t: 2.5 };
      }
      G.phase = 'fight';
      G.spawnT = 0;
      if (G.wave % BOSS_EVERY === 0) {
        const B = bossFor(G.wave);
        G.queue = ['boss', ...(B.id === 'gamemaster' ? [] : Array(G.wave).fill('grunt'))];
        G.banner = { text: `Wave ${G.wave} — ${B.name}!`, t: 3 };
      } else {
        // old mix, plus the newer enemies once their wave comes up
        const extra = Object.keys(ENEMIES).filter(k => ENEMIES[k].from && G.wave >= ENEMIES[k].from);
        G.queue = Array.from({ length: Math.round((3 + G.wave * 2) * (easy() ? EASY.count : 1)) }, () => {
          if (extra.length && Math.random() < Math.min(0.45, 0.1 + G.wave * 0.02)) {
            let r = Math.random() * extra.reduce((n, k) => n + ENEMIES[k].weight, 0);
            for (const k of extra) if ((r -= ENEMIES[k].weight) < 0) return k;
          }
          const r = Math.random();
          return G.wave >= 2 && r < 0.3 ? 'shooter' : G.wave >= 2 && r < 0.55 ? 'runner' : 'grunt';
        });
        G.banner = { text: `Wave ${G.wave}`, t: 2 };
      }
    } else if (G.queue.length) {
      G.spawnT -= dt;
      if (G.spawnT <= 0) {
        spawnEnemy(G.queue.shift());
        G.spawnT = Math.max(0.25, 1 - G.wave * 0.05) * (easy() ? EASY.spawn : 1);
      }
    } else if (G.enemies.length === 0) {
      G.phase = 'break';
      G.breakT = 3;
      G.banner = { text: 'Wave cleared!', t: 2.5 };
    }
  }

  // which boss shows up on this wave
  function bossFor(wave) {
    const n = wave / BOSS_EVERY;
    return n % 10 === 0 ? CREATOR : BOSSES[(n - 1) % 10 % BOSSES.length];
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
    const scale = (type === 'boss' ? 1 + (G.wave / BOSS_EVERY - 1) * 0.6 : 1 + (G.wave - 1) * 0.12) * (easy() ? EASY.hp : 1);
    const e = {
      type, def, x, y, r: def.r, hp: def.hp * scale, maxHp: def.hp * scale,
      speed: def.speed * (0.9 + Math.random() * 0.2), kx: 0, ky: 0, flash: 0, aim: 0,
      cd: 1 + Math.random(), side: Math.random() < 0.5 ? -1 : 1, pattern: 0,
    };
    G.enemies.push(e);
    if (type === 'boss') {
      const B = bossFor(G.wave);
      Object.assign(e, { boss: B.id, name: B.name, color: B.color, bt: B.every || 3, hp: e.hp * B.hp, maxHp: e.maxHp * B.hp, seen: 0 });
      if (B.id === 'phantom') e.speed *= 1.7;
      G.boss = e;
      if (B.id === 'gamemaster') enterArena(e);
    }
  }

  // minion spawned right next to (x, y)
  function spawnNear(type, x, y) {
    const def = ENEMIES[type], scale = (1 + (G.wave - 1) * 0.12) * (easy() ? EASY.hp : 1);
    const c = { x: x + (Math.random() - 0.5) * 160, y: y + (Math.random() - 0.5) * 160, r: def.r };
    collideWorld(c);
    G.enemies.push({ type, def, x: c.x, y: c.y, r: def.r, hp: def.hp * scale, maxHp: def.hp * scale, speed: def.speed, kx: 0, ky: 0, flash: 0, aim: 0, cd: 1, side: 1, pattern: 0 });
    burst(c.x, c.y, '#6c5ce7', 12, 200);
  }

  // GAMEMASTER: you and him get pulled into an empty arena (no walls) until he dies
  function enterArena(e) {
    const me = G.me;
    G.arena = { walls: MAP.walls, solid: MAP.solid, x: me.x, y: me.y };
    MAP.walls = [];
    MAP.solid = new Uint8Array(MAP.solid.length);
    flowT = 0;
    G.enemies = [e];
    G.queue = [];
    burst(me.x, me.y, '#fd79a8', 40, 400);
    me.x = MAP.w / 2; me.y = MAP.h / 2 + 300;
    e.x = MAP.w / 2; e.y = MAP.h / 2 - 300;
    G.cam.x = me.x; G.cam.y = me.y;
    G.banner = { text: 'GAMEMASTER: Welcome to my game!', t: 3 };
  }
  function leaveArena() {
    if (!G.arena) return;
    MAP.walls = G.arena.walls; MAP.solid = G.arena.solid;
    G.me.x = G.arena.x; G.me.y = G.arena.y;
    G.cam.x = G.me.x; G.cam.y = G.me.y;
    collideWorld(G.me);
    flowT = 0;
    G.arena = null;
  }

  // the special move of each boss
  function bossMove(e, dt) {
    const me = G.me;
    e.bt -= dt;
    e.seen = Math.max(0, e.seen - dt);
    if (e.boss === 'gamemaster') { // bullet hell: a spinning spiral plus a ring every so often
      e.spin = (e.spin || 0) + dt;
      e.hellCd = (e.hellCd || 0) - dt;
      if (e.hellCd <= 0) {
        e.hellCd = 0.12;
        for (let i = 0; i < 3; i++) addBullet(e.x, e.y, e.spin * 1.7 + i * Math.PI * 2 / 3, 420, 7, 1, 'e', null, 2000);
      }
      if (e.bt <= 0) { e.bt = 2.2; for (let i = 0; i < 24; i++) addBullet(e.x, e.y, i * Math.PI / 12 + e.spin, 300, 9, 1, 'e', null, 2000); }
      return;
    }
    if (e.bt > 0) return;
    const B = e.boss === 'creator' ? CREATOR : BOSSES.find(b => b.id === e.boss);
    e.bt = B.every || 3;
    const toMe = Math.atan2(me.y - e.y, me.x - e.x);
    if (e.boss === 'tp') {
      for (let i = 0; i < 60; i++) {
        const an = Math.random() * Math.PI * 2, d = 350 + Math.random() * 350;
        const c = { x: clamp(me.x + Math.cos(an) * d, e.r, MAP.w - e.r), y: clamp(me.y + Math.sin(an) * d, e.r, MAP.h - e.r), r: e.r };
        collideWorld(c);
        if (!MAP.walls.some(w => c.x + c.r > w[0] && c.x - c.r < w[0] + w[2] && c.y + c.r > w[1] && c.y - c.r < w[1] + w[3])) {
          burst(e.x, e.y, B.color, 30, 380);
          e.x = c.x; e.y = c.y;
          burst(e.x, e.y, B.color, 30, 380);
          e.cd = 0.3;
          break;
        }
      }
    }
    if (e.boss === 'summoner') for (let i = 0; i < 3; i++) spawnNear(Math.random() < 0.5 ? 'grunt' : 'runner', e.x, e.y);
    if (e.boss === 'inferno') addGadget({ kind: 'firepit', x: e.x, y: e.y, a: 0, owner: 'enemy', id: 'f' + Math.random() });
    if (e.boss === 'frost') G.nades.push({ x0: e.x, y0: e.y, x1: me.x, y1: me.y, t: 0, owner: 'enemy', kind: 'freeze' });
    if (e.boss === 'warlord') { addRocket(e.x + Math.cos(toMe) * e.r, e.y + Math.sin(toMe) * e.r, toMe, 'enemy'); hear(e.x, e.y, 12 * HEAR_UNIT); }
    if (e.boss === 'creator') {
      const move = ['airstrike', 'meteors', 'nuke', 'laser', 'bullethell', 'timestop', 'megaslam', 'summon'][Math.floor(Math.random() * 8)];
      const U = ULTIMATES[move];
      G.banner = { text: `CREATOR uses ${U ? U.name.toUpperCase() : 'SUMMON'}!`, t: 1.5 };
      const strike = (x, y, t, r, dmg) => G.strikes.push({ x: clamp(x, 0, MAP.w), y: clamp(y, 0, MAP.h), t, max: t, r, dmg, owner: 'enemy' });
      if (move === 'airstrike') for (let i = 0; i < 8; i++) { const d = 150 + i * 120; strike(e.x + Math.cos(toMe) * d, e.y + Math.sin(toMe) * d, 0.8 + i * 0.18, 120, 40); }
      if (move === 'meteors') for (let i = 0; i < 14; i++) { const an = Math.random() * 6.28, d = Math.random() * 350; strike(me.x + Math.cos(an) * d, me.y + Math.sin(an) * d, 0.8 + Math.random() * 3, 90, 30); }
      if (move === 'nuke') strike(me.x, me.y, 3, 380, 90);
      if (move === 'laser') G.lasers.push({ x: e.x + Math.cos(toMe) * 120, y: e.y + Math.sin(toMe) * 120, a: toMe, t: 5, tick: 0, owner: 'enemy' });
      if (move === 'bullethell') e.hellT = 3;
      if (move === 'timestop') { me.frozenT = 1.5; G.rings.push({ x: e.x, y: e.y, r: 900, life: 0.8, max: 0.8, color: '116,185,255' }); }
      if (move === 'megaslam') slam(e.x, e.y, 600, 30, 18, 'enemy');
      if (move === 'summon') for (let i = 0; i < 4; i++) spawnNear(['grunt', 'runner', 'shooter'][i % 3], e.x, e.y);
    }
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
    // your buddies, towers and turrets can be attacked too
    const allies = [...G.gadgets.filter(g => g.hp !== undefined && !g.dead && isMine(g.owner)), ...G.turrets];
    const buddies = allies.filter(a => a.kind === 'decoy');
    for (const e of list) {
      if (e.frozen > 0) { e.flash = 0; continue; } // frozen solid
      // you come first: if they can see you, they go for you. Otherwise the closest buddy/building they can see
      // you and your buddies are equally important: go for the closest one it can see
      const visible = a => lineOfSight(e.x, e.y, a.x, a.y) && !smokeBlocks(e.x, e.y, a.x, a.y);
      let tgt = me, bestD = Infinity;
      for (const a of [me.alive ? me : null, ...buddies]) {
        if (!a || !visible(a)) continue;
        const d = Math.hypot(a.x - e.x, a.y - e.y);
        if (d < bestD) { tgt = a; bestD = d; }
      }
      if (bestD === Infinity) { // nobody in sight: shoot buildings it can see, otherwise hunt you down
        let bd = BULLET_RANGE * 0.8;
        for (const a of allies) {
          const d = Math.hypot(a.x - e.x, a.y - e.y);
          if (d < bd && lineOfSight(e.x, e.y, a.x, a.y) && !smokeBlocks(e.x, e.y, a.x, a.y)) { tgt = a; bd = d; }
        }
      }
      e.botCd = Math.max(0, (e.botCd || 0) - dt);
      if (e.botCd === 0 && e.def.melee) for (const bd of buddies) if (!bd.dead && Math.hypot(bd.x - e.x, bd.y - e.y) < e.r + PLAYER.r) { markAttack(bd, e); damageGadget(bd, e.def.melee); e.botCd = 0.6; break; }
      const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.hypot(dx, dy) || 1;
      const sees = lineOfSight(e.x, e.y, tgt.x, tgt.y) && !smokeBlocks(e.x, e.y, tgt.x, tgt.y);
      let mx = dx / d, my = dy / d;
      if (!me.alive) { mx = my = 0; }
      else if (e.def.keepDistance && sees && d < e.def.keepDistance) { mx *= -0.6; my *= -0.6; }
      else if (!sees || (e.r > MAP.grid * 0.45 && d > 250)) { // follow the path around the walls toward you (the boss always does)
        const step = pathStep(e);
        if (step) { const l = Math.hypot(step.x - e.x, step.y - e.y) || 1; mx = (step.x - e.x) / l; my = (step.y - e.y) / l; }
      }
      const spd = e.speed * (e.chill > 0 ? COMBO.iceSlow : 1) * (e.grav > 0 ? ABILITIES.gravity.slow : 1); // ice wall
      e.x += (mx * spd + e.kx) * dt;
      e.y += (my * spd + e.ky) * dt;
      e.kx *= Math.exp(-8 * dt); e.ky *= Math.exp(-8 * dt);
      e.flash = Math.max(0, e.flash - dt);
      e.aim = Math.atan2(dy, dx);
      collideWorld(e);

      if (e.boss && me.alive) bossMove(e, dt);
      if (e.hellT > 0) { // creator's bullet hell
        e.hellT -= dt; e.hellCd = (e.hellCd || 0) - dt;
        if (e.hellCd <= 0) { e.hellCd = 0.25; for (let i = 0; i < 16; i++) addBullet(e.x, e.y, G.time * 2 + i * Math.PI / 8, 500, 8, 1, 'e', null, 1200); }
      }
      if (e.def.gun && me.alive && sees && d < BULLET_RANGE * 0.8) {
        e.cd -= dt;
        if (e.cd <= 0) {
          enemyShoot(e); e.cd = e.def.gun.delay * (0.8 + Math.random() * 0.4);
          const g = e.def.gun;
          if (g.mag) { e.shots = (e.shots ?? g.mag) - 1; if (e.shots <= 0) { e.shots = g.mag; e.cd = g.reload; } } // revolver: reload after 6
        }
      }
      if (me.alive && e.def.melee && Math.hypot(me.x - e.x, me.y - e.y) < e.r + me.r && me.meleeInv === 0) {
        hurtMe(e.def.melee, 4, Math.atan2(dy, dx), null);
        me.meleeInv = 0.6;
      }
      // BOMBER: blows up when it reaches you (or your buddy)
      if (e.def.kamikaze && !e.gone && Math.hypot(tgt.x - e.x, tgt.y - e.y) < e.r + PLAYER.r + 18) {
        e.gone = true;
        explode(e.x, e.y, e.def.kamikaze.radius, e.def.kamikaze.damage, 'enemy');
        if (tgt !== me && tgt.hp !== undefined) { if (tgt.kind) { markAttack(tgt, e); damageGadget(tgt, e.def.kamikaze.damage); } else tgt.hp -= e.def.kamikaze.damage * (tgt.bunker ? COMBO.bunkerTake : 1); }
      }
      // HEALER: patches up enemies around it
      if (e.def.heal) {
        e.healT = (e.healT || 1) - dt;
        if (e.healT <= 0) {
          e.healT = 1;
          const H = e.def.heal;
          for (const o of list) if (o.hp < o.maxHp && Math.hypot(o.x - e.x, o.y - e.y) <= H.radius) {
            o.hp = Math.min(o.maxHp, o.hp + H.perSec);
            G.texts.push({ x: o.x, y: o.y - o.r - 6, text: `+${H.perSec}`, color: '#2ecc71', life: 0.6 });
          }
          G.rings.push({ x: e.x, y: e.y, r: H.radius, life: 0.5, max: 0.5, color: '46,204,113' });
        }
      }
      e.laserOn = !!(e.def.laser && sees && e.cd < 0.8); // SNIPER: red laser right before it fires
    }
    if (list.some(e => e.gone)) G.enemies = G.enemies.filter(e => !e.gone);
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
    e.seen = 0.6;
    const shots = [];
    if (e.type === 'boss') {
      e.pattern = (e.pattern + 1) % 2;
      if (e.pattern === 0) for (let i = -2; i <= 2; i++) shots.push(e.aim + i * 0.18);
      else for (let i = 0; i < 14; i++) shots.push(e.aim + i * Math.PI * 2 / 14);
    } else {
      shots.push(e.aim + (Math.random() - 0.5) * 0.12);
    }
    const sx = e.x + Math.cos(e.aim) * e.r, sy = e.y + Math.sin(e.aim) * e.r;
    for (const a of shots) { addBullet(sx, sy, a, g.speed, g.damage, 2, 'e', null); G.bullets[G.bullets.length - 1].src = e; }
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
    burst(e.x, e.y, e.color || e.def.color, e.type === 'boss' ? 60 : 14, e.type === 'boss' ? 500 : 260);
    G.enemies = G.enemies.filter(x => x !== e);
    if (e.def.split) for (let i = 0; i < e.def.split.count; i++) spawnNear(e.def.split.into, e.x, e.y); // SPLITTER
    if (e.boss === 'hydra' && !e.mini) { // HYDRA splits into 3 smaller heads
      for (let i = 0; i < 3; i++) {
        const an = i * Math.PI * 2 / 3, c = { x: e.x + Math.cos(an) * 60, y: e.y + Math.sin(an) * 60, r: 30 };
        collideWorld(c);
        G.enemies.push({ ...e, x: c.x, y: c.y, r: 30, hp: e.maxHp * 0.25, maxHp: e.maxHp * 0.25, mini: true, speed: e.speed * 1.4, kx: 0, ky: 0, flash: 0 });
      }
      G.banner = { text: 'HYDRA splits!', t: 1.5 };
    }
    if (e.boss && G.boss === e) G.boss = G.enemies.find(x => x.boss) || e;
    if (e.boss && !G.enemies.some(x => x.boss)) {
      leaveArena();
      G.boss = null;
      // beating a boss gives your ability back
      for (const s of allSlots()) {
        const A = ABILITIES[s.ability];
        if (A && A.type !== 'passive') { s.abUses = A.uses ?? Infinity; s.abCd = 0; }
      }
      G.banner = { text: `${e.name || 'Boss'} defeated! Ability restored`, t: 2.5 };
      if (G.mode === 'sp') setTimeout(() => G && hooks.bossDown({ unlocked3: G.wave >= slot3Wave() && G.wave - BOSS_EVERY < slot3Wave(), unlocked4: G.wave >= SLOT4_WAVE && G.wave - BOSS_EVERY < SLOT4_WAVE }), 1200);
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
    addGadget({ kind: m.k, x: m.x, y: m.y, a: m.a, owner: m.from, id: m.id, color: m.c, name: m.n, sprite, hp: m.hp, dur: m.dur, big: !!m.g, supply: !!m.s });
  });
  Net.on('gadx', m => {
    if (!inMP()) return;
    const g = G.gadgets.find(g => g.id === m.id);
    if (!g) return;
    if (g.kind === 'mine') mineBoom(g);
    else { if (ABILITIES[g.kind].building && !m.q) gadgetBoom(g); else burst(g.x, g.y, ABILITIES[g.kind].color, 24, 300); removeGadget(g); }
  });
  Net.on('gadl', m => { // ENGINEER upgraded a building
    if (!inMP()) return;
    const g = G.gadgets.find(g => g.id === m.id);
    if (g) { g.lvl = m.l; if (g.maxHp) g.hp = g.maxHp; levelFx(g); }
  });
  Net.on('gadc', m => {
    if (!inMP()) return;
    const g = G.gadgets.find(g => g.id === m.id);
    if (g) { g[m.w] = true; if (m.w === 'vortex') g.t += COMBO.vortexTime; if (FORMATIONS[m.w]) { formUp(g, m.w); burst(g.x, g.y, ABILITIES[g.kind].color, 50, 480); } }
  });
  Net.on('gadm', m => {
    if (!inMP()) return;
    const g = G.gadgets.find(g => g.id === m.id);
    if (g) { g.x = m.x; g.y = m.y; g.aim = m.a; g.hp = m.hp; }
  });
  Net.on('ult', m => {
    if (!inMP()) return;
    if (m.k === 'timestop') { if (hostileTo(m.from)) { G.me.frozenT = 3; G.banner = { text: 'TIME STOPPED!', t: 1.5 }; } }
    else if (m.k === 'tracker') { if (!hostileTo(m.from)) { G.me.trackT = ULTIMATES.tracker.duration; G.banner = { text: 'Teammate used Tracker!', t: 1.5 }; } }
    else if (m.k === 'laser') G.lasers.push({ x: m.x, y: m.y, a: m.a, t: ULTIMATES.laser.duration, tick: 0, owner: m.from });
    else if (m.s) for (const s of m.s) addStrike(s, m.from);
  });
  Net.on('aoe', m => { if (inMP()) slam(m.x, m.y, m.r, m.dmg, m.kb, m.from); });
  Net.on('nade', m => { if (inMP()) G.nades.push({ x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, t: 0, owner: m.from }); });
  Net.on('rpg', m => { if (inMP()) addRocket(m.x, m.y, m.a, m.from); });
  Net.on('packs', m => { if (inMP()) addPacks(m.packs); });
  Net.on('took', m => { if (inMP()) removePack(m.id); });
  Net.on('boxm', m => { if (!inMP()) return; const p = G.packs.find(p => p.id === m.id); if (p) p.mags = m.mags; });
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
  // can you see this thing? Only if there's a clear line to its middle (no peeking at someone hiding behind a wall)
  function canSee(x, y, r) {
    const me = G.me;
    return lineOfSight(me.x, me.y, x, y) || (r > 30 && lineOfSight(me.x, me.y, x, y - r * 0.5)) || (r > 30 && lineOfSight(me.x, me.y, x, y + r * 0.5));
  }

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
      if (!canSee(e.x, e.y, e.r)) continue; // no peeking at enemies around corners
      if (e.laserOn) {
        ctx.strokeStyle = `rgba(255,40,40,${0.35 + 0.4 * Math.sin(G.time * 30)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.aim) * 1400, e.y + Math.sin(e.aim) * 1400); ctx.stroke();
      }
      if (e.boss === 'phantom') ctx.globalAlpha = e.seen > 0 || e.flash > 0 ? 0.85 : 0.1;
      drawChar(e.def, e.x, e.y, e.r, e.aim, e.color || e.def.color, e.flash > 0);
      ctx.globalAlpha = 1;
      if (e !== G.boss) drawBar(e.x, e.y - e.r - 10, e.r * 2, 5, e.hp / e.maxHp);
    }

    for (const r of G.remotes.values()) {
      if (!r.alive) continue;
      if (isEnemy(r) && !canSee(r.x, r.y, PLAYER.r)) continue; // enemy players behind walls stay hidden (teammates always show)
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
      else if (me.alt.abAiming) { swapAlt(); drawAbilityAim(me); swapAlt(); }
      else if (me.alt3.abAiming) { swapAlt('alt3'); drawAbilityAim(me); swapAlt('alt3'); }
      else if (me.alt4.abAiming) { swapAlt('alt4'); drawAbilityAim(me); swapAlt('alt4'); }
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
    drawJuice();

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
    drawLevels();
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
    light: { bg: '#b4bac4', floor: '#c9ced6', grid: '#bcc2cb', wall: '#6d7585', wallTop: '#858d9c', wallLine: '#424856', border: '#7a8291', shadow: 'rgba(90,98,112,0.55)' },
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
      ctx.fillText(G.boss.name || 'BOSS', W / 2, y);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(W / 2 - bw / 2, y + 16, bw, 10);
      ctx.fillStyle = G.boss.color || '#b05cff';
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
  let abCache = '', abCache2 = '', abCache3 = '', abCache4 = '';
  // which timer a running ability shows on its button
  const RUNNING = { shield: 'shieldT', rapid: 'rapidT', slowmo: 'slowT', phase: 'phaseT', reflect: 'reflectT', stim: 'stimT', cls_overclock: 'clockT', cls_afterimage: 'phaseT' };
  function updateAbilityBtn() {
    const ub = el('ultBtn'), U = G.me.ult && ULTIMATES[G.me.ult];
    ub.classList.toggle('hidden', !U);
    if (U && ub.dataset.k !== G.me.ult) { ub.dataset.k = G.me.ult; ub.querySelector('.ult-name').textContent = U.name; }
    if (!U) ub.dataset.k = '';
    abCache = paintAbilityBtn(el('abilityBtn'), abCache);
    swapAlt(); abCache2 = paintAbilityBtn(el('ability2Btn'), abCache2); swapAlt();
    swapAlt('alt3'); abCache3 = paintAbilityBtn(el('ability3Btn'), abCache3); swapAlt('alt3');
    const cl = myClass();
    if (cl && !G.me.alt4.ability) { // class ability still locked (SP before CLASSES.unlockWave)
      const key = 'lock' + cl.id;
      if (abCache4 !== key) {
        const btn = el('ability4Btn'); abCache4 = key;
        btn.classList.remove('hidden', 'passive'); btn.classList.add('cooling');
        btn.querySelector('.ab-name').innerHTML = `${abilityIconSVG(cl.ab, 16, '#fff')} ${ABILITIES[cl.ab].name}`;
        btn.querySelector('.ab-state').textContent = `🔒 Wave ${CLASSES.unlockWave}`;
      }
    } else { swapAlt('alt4'); abCache4 = paintAbilityBtn(el('ability4Btn'), abCache4); swapAlt('alt4'); }
  }
  function paintAbilityBtn(btn, cache) {
    const me = G.me, A = ABILITIES[me.ability];
    if (!A) { btn.classList.add('hidden'); return ''; }
    const run = RUNNING[me.ability] && me[RUNNING[me.ability]];
    const state = A.type === 'passive' ? 'Passive'
      : me.abUses <= 0 && A.respawn ? `+1 in ${Math.ceil(me.refillT ?? A.respawn)}s`
      : me.abUses <= 0 ? 'Used'
      : run > 0 ? `${Math.ceil(run)}s`
      : me.abCd > 0 ? `${Math.ceil(me.abCd)}s`
      : me.abUses === Infinity ? 'Ready' : `Ready ×${me.abUses}`;
    const key = A.name + state;
    if (key === cache) return cache;
    btn.classList.remove('hidden');
    btn.classList.toggle('passive', A.type === 'passive');
    btn.classList.toggle('cooling', A.type !== 'passive' && !state.startsWith('Ready'));
    btn.querySelector('.ab-name').innerHTML = `${abilityIconSVG(me.ability, 16, '#fff')} ${A.name}`;
    btn.querySelector('.ab-state').textContent = state;
    return key;
  }

  el('gun0').addEventListener('click', () => G && switchGun(0));
  el('gun1').addEventListener('click', () => G && switchGun(1));
  el('reloadBtn').addEventListener('pointerdown', e => { e.preventDefault(); Input.flags.reload = true; });

  function pause() { if (G) { if (G.mode === 'sp') G.paused = true; Input.reset(); } }
  function resume() { if (G) { G.paused = false; last = performance.now(); } }

  return {
    startSP, startMP, stop, pause, resume, applyLoadout, applyAbilities, spawnEpic,
    get test() { return !!(G && G.test); },
    get infAbility() { return !!(G && G.infAbility); },
    set infAbility(v) { if (G) G.infAbility = v; },
    get running() { return !!G; },
    get mode() { return G && G.mode; },
    get run() { return G && G.mode === 'sp' && !G.over ? { wave: G.wave, score: G.score, test: G.test } : null; },
    get debugState() { return G; },
    on(name, fn) { hooks[name] = fn; },
  };
})();
