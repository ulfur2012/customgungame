// Screens and flow: login → menu → loadout → game, plus the multiplayer lobby.
(() => {
  const el = id => document.getElementById(id);
  const SCREENS = ['login', 'menu', 'loadout', 'mp', 'hostSetup', 'lobby'];
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

  function show(id) {
    for (const s of SCREENS) el(s).classList.toggle('hidden', s !== id);
  }
  const overlay = (id, on) => el(id).classList.toggle('hidden', !on);

  let toastTimer = 0;
  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  }

  function showResult(title, text, buttons) {
    el('resultTitle').textContent = title;
    el('resultText').textContent = text;
    const wrap = el('resultButtons');
    wrap.innerHTML = '';
    buttons.forEach((b, i) => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (i === 0) btn.className = 'primary';
      btn.onclick = () => { overlay('resultScreen', false); b.fn(); };
      wrap.appendChild(btn);
    });
    overlay('resultScreen', true);
  }

  // ---------------------------------------------------------------- login + menu
  el('loginName').value = Store.get('cgg.lastName', '');
  let signup = false;
  function setAuthMode(s) {
    signup = s;
    el('tabLogin').classList.toggle('active', !s);
    el('tabSignup').classList.toggle('active', s);
    el('authSubmit').textContent = s ? 'Create account' : 'Log in';
    el('loginPass').autocomplete = s ? 'new-password' : 'current-password';
    el('loginError').textContent = '';
  }
  el('tabLogin').onclick = () => setAuthMode(false);
  el('tabSignup').onclick = () => setAuthMode(true);
  el('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const r = Account.login(el('loginName').value, el('loginPass').value, signup);
    if (r.error) { el('loginError').textContent = r.error; return; }
    el('loginError').textContent = '';
    el('loginPass').value = '';
    toast(r.created ? `Account created. Welcome, ${Account.user.name}!` : `Welcome back, ${Account.user.name}!`);
    goMenu();
  });

  function goMenu() {
    Rules.banned = new Set(); // host rules only apply inside a multiplayer room
    el('menuName').textContent = Account.user.name;
    el('menuBest').textContent = (Account.user.best ? `· best wave ${Account.user.best} ` : '') + `· ⭐ ${Account.user.bank} score to spend`;
    show('menu');
  }

  let testMode = false;
  let runBanked = 0; // score from the current run already added to your bank (boss shops bank it early)
  function bankRun(r) {
    if (!r || r.test) return 0;
    const add = Math.max(0, r.score - runBanked);
    runBanked = r.score;
    Account.user.best = Math.max(Account.user.best || 0, r.wave);
    Account.user.bank = (Account.user.bank || 0) + add;
    Account.save();
    return add;
  }
  const spLoadout = () => openLoadout(testMode ? 'Start test' : 'Start', () => { show(null); buildMap('medium', MAP.seed, 'medium'); runBanked = 0; Game.startSP(testMode); }, goMenu);
  // Single Player first asks: test mode on or off?
  el('spBtn').onclick = () => { el('testToggle').checked = testMode; overlay('spScreen', true); };
  el('spStart').onclick = () => { testMode = el('testToggle').checked; shopOn = !el('freeToggle').checked; overlay('spScreen', false); spLoadout(); };
  el('spCancel').onclick = () => overlay('spScreen', false);
  // test mode: change loadout from the pause menu, then jump straight back in
  el('testInfBtn').onclick = () => {
    Game.infAbility = !Game.infAbility;
    el('testInfBtn').textContent = `∞ Infinite ability: ${Game.infAbility ? 'ON' : 'OFF'}`;
    el('testInfBtn').classList.toggle('primary', Game.infAbility);
  };
  el('testEpicBtn').onclick = () => { overlay('pauseScreen', false); Game.spawnEpic(); Game.resume(); };
  el('testLoadoutBtn').onclick = () => {
    overlay('pauseScreen', false);
    openLoadout('Back to game', () => { show(null); Game.applyLoadout(); Game.resume(); },
      () => { show(null); Game.applyLoadout(); Game.resume(); });
  };
  el('mpBtn').onclick = () => { el('mpStatus').textContent = ''; show('mp'); };
  el('customizeBtn').onclick = () => { shopOn = false; openLoadout('Save', goMenu, goMenu); };
  el('settingsBtn').onclick = () => overlay('settingsScreen', true);
  el('logoutBtn').onclick = () => { Account.logout(); show('login'); };

  // ---------------------------------------------------------------- settings
  function applySettings() {
    document.body.classList.toggle('mobile', Settings.mobile);
    document.body.classList.toggle('light', Settings.light);
    document.querySelector('meta[name="theme-color"]').content = Settings.light ? '#c9ced6' : '#0e1014';
    for (const b of el('themePick').children) {
      b.classList.toggle('active', (b.dataset.v === 'light') === Settings.light);
      b.onclick = () => { Settings.light = b.dataset.v === 'light'; Settings.save(); applySettings(); };
    }
    el('mobileToggle').checked = Settings.mobile;
  }
  el('mobileToggle').onchange = () => {
    Settings.mobile = el('mobileToggle').checked;
    Settings.save();
    Input.reset();
    applySettings();
  };
  el('settingsClose').onclick = () => overlay('settingsScreen', false);
  applySettings();

  // ---------------------------------------------------------------- loadout builder
  let gunKind = 'main', slot = 'barrel', onDone = null, onBack = null;

  function openLoadout(doneLabel, done, back, abilitiesOnly = false) {
    el('loadout').classList.toggle('abilities-only', abilitiesOnly);
    if (abilitiesOnly) gunKind = 'ability';
    el('loadoutDone').textContent = doneLabel;
    onDone = done; onBack = back;
    show('loadout');
    renderLoadout();
  }
  el('loadoutDone').onclick = () => onDone && checkout() && onDone();
  el('loadoutBack').onclick = () => onBack && onBack();

  // ---- shop: locked cards show a price, tapping one buys it with banked score
  const priceTag = cost => cost && shopOn ? ` <small class="price">⭐ ${cost}</small>` : '';
  // everything can be picked for free while customizing; locking in the loadout asks you to buy what you don't own
  function unowned() {
    const L = Account.user.loadout, list = [];
    for (const k of ['ability', 'ability2', 'ability3', 'ability4']) if (L[k]) list.push(['ab:' + L[k], ABILITIES[L[k]].name]);
    for (const [k, a] of [['perk', 'ability'], ['perk2', 'ability2'], ['perk3', 'ability3'], ['perk4', 'ability4']]) {
      const p = L[k] && (ABILITY_PERKS[L[a]] || []).find(x => x.id === L[k]);
      if (p) list.push(['perk:' + p.id, p.name]);
    }
    for (const kind of ['main', 'secondary']) for (const sl in L[kind]) if (L[kind][sl]) list.push([`part:${kind}:${sl}:${L[kind][sl]}`, findPart(sl, L[kind][sl]).name]);
    return list.map(([key, name]) => ({ key, name, cost: priceOf(key) })).filter(x => x.cost);
  }
  let shopOn = false; // only when the single player / host settings say upgrades aren't free
  function stripUnowned() {
    const L = Account.user.loadout;
    for (const x of unowned()) {
      const [type, a, b, c] = x.key.split(':');
      if (type === 'part') L[a][b] = null;
      for (const [k, pk] of [['ability', 'perk'], ['ability2', 'perk2'], ['ability3', 'perk3'], ['ability4', 'perk4']]) {
        if (type === 'ab' && L[k] === a) { L[k] = k === 'ability' ? 'grenade' : null; L[pk] = null; }
        if (type === 'perk' && L[pk] === a) L[pk] = null;
      }
    }
    Account.save();
    toast('Upgrades you do not own were taken out of your loadout');
  }
  function checkout() {
    if (!shopOn) return true;
    const u = Account.user, list = unowned();
    if (!list.length) return true;
    const total = list.reduce((n, x) => n + x.cost, 0);
    const lines = list.map(x => `• ${x.name} — ${x.cost}`).join('\n');
    if ((u.bank || 0) < total) { alert(`This loadout costs ${total} score:\n${lines}\n\nYou have ${u.bank || 0}. Swap something out or earn more score.`); return false; }
    if (!confirm(`This loadout costs ${total} score:\n${lines}\n\nYou have ${u.bank}. Buy it?`)) return false;
    u.bank -= total; u.owned.push(...list.map(x => x.key)); Account.save();
    toast(`Bought! ${u.bank} score left`);
    return true;
  }

  function renderLoadout() {
    const owe = unowned().reduce((n, x) => n + x.cost, 0);
    el('bankLine').textContent = `⭐ ${Account.user.bank || 0} score` + (owe && shopOn ? ` · loadout costs ${owe}` : '');
    el('presetTabs').innerHTML = '<span>Loadout</span>';
    for (let i = 0; i < LOADOUT_PRESETS; i++) {
      const b = document.createElement('button');
      b.textContent = i + 1;
      b.className = i === Account.user.active ? 'active' : '';
      b.onclick = () => { Account.usePreset(i); renderLoadout(); };
      el('presetTabs').appendChild(b);
    }
    el('gunTabs').innerHTML = '';
    for (const kind of ['main', 'secondary', 'ability']) {
      const b = document.createElement('button');
      b.className = 'gun-tab' + (kind === gunKind ? ' active' : '') + (kind === 'ability' ? ' ability-tab' : '');
      b.textContent = kind === 'ability' ? 'Ability' : GUNS[kind].name;
      b.onclick = () => { gunKind = kind; renderLoadout(); };
      el('gunTabs').appendChild(b);
    }
    if (gunKind === 'ability') { renderAbilities(); return; }
    const build = Account.user.loadout[gunKind];

    const slots = SLOTS.filter(s => partsFor(gunKind, s.key).length);
    if (!slots.some(s => s.key === slot)) slot = slots[0].key;
    el('slotTabs').innerHTML = '';
    for (const s of slots) {
      const part = findPart(s.key, build[s.key]);
      const b = document.createElement('button');
      b.className = 'tab' + (s.key === slot ? ' active' : '');
      b.innerHTML = `<span class="tab-label">${s.label}</span><span class="tab-value">${part ? part.name : 'None'}</span>`;
      if (part) b.style.setProperty('--chip', part.color);
      b.onclick = () => { slot = s.key; renderLoadout(); };
      el('slotTabs').appendChild(b);
    }

    const wrap = el('parts');
    wrap.innerHTML = '';
    for (const part of [null, ...partsFor(gunKind, slot)]) {
      const equipped = (build[slot] || null) === (part ? part.id : null);
      const key = part && 'part:' + gunKind + ':' + slot + ':' + part.id, cost = part ? priceOf(key) : 0;
      const card = document.createElement('button');
      card.className = 'card' + (equipped ? ' equipped' : '') + (cost ? ' locked' : '');
      const thumb = document.createElement('canvas');
      thumb.className = 'thumb';
      card.appendChild(thumb);
      const mods = part ? describeMods(part).map(m => `<span class="${m.good ? 'good' : 'bad'}">${m.text}</span>`).join('') : '';
      const info = document.createElement('div');
      info.innerHTML = `<div class="card-name">${part ? part.name : 'None'}${priceTag(cost)}</div><div class="card-mods">${mods || '<span>no changes</span>'}</div>`;
      card.appendChild(info);
      card.dataset.part = part ? part.id : 'none';
      card.onclick = () => {
                build[slot] = part ? part.id : null;
        Account.save();
        keepInPlace(`[data-part="${part ? part.id : 'none'}"]`, renderLoadout);
      };
      wrap.appendChild(card);
      requestAnimationFrame(() => drawThumb(thumb, part));
    }

    renderPreview();
    renderStats();
  }

  // re-render without the list jumping: the card you tapped stays exactly where it was on screen
  function keepInPlace(selector, render) {
    const box = el('parts'), before = box.querySelector(selector);
    const top = before ? before.getBoundingClientRect().top : null, scroll = box.scrollTop;
    render();
    const after = box.querySelector(selector);
    box.scrollTop = scroll;
    if (top !== null && after) box.scrollTop += after.getBoundingClientRect().top - top;
  }
  let abSlot = 0; // which ability slot the Ability tab is editing (0 = E, 1 = C)
  function renderAbilities() {
    const L = Account.user.loadout;
    const KEYS = ['ability', 'ability2', 'ability3', 'ability4'], PERKS = ['perk', 'perk2', 'perk3', 'perk4'];
    const key = KEYS[abSlot], perkKey = PERKS[abSlot];
    const current = L[key];
    // two slot tabs, like the upgrade slots
    el('slotTabs').innerHTML = '';
    [['Ability 1 (E)', 'ability'], ['Ability 2 (C)', 'ability2'], [`Ability 3 (V) · wave ${SLOT3_WAVE}+`, 'ability3'], [`Ability 4 (B) · wave ${SLOT4_WAVE}+`, 'ability4']].forEach(([label, k], i) => {
      const b = document.createElement('button'), A = ABILITIES[L[k]];
      b.className = 'tab' + (i === abSlot ? ' active' : '');
      b.innerHTML = `<span class="tab-label">${label}</span><span class="tab-value">${A ? A.name : 'None'}</span>`;
      if (A) b.style.setProperty('--chip', A.color);
      b.onclick = () => { abSlot = i; renderLoadout(); };
      el('slotTabs').appendChild(b);
    });
    const wrap = el('parts');
    wrap.innerHTML = '';
    // boosts for the ability in this slot (only shown for that ability)
    const perks = ABILITY_PERKS[current] || [];
    if (!perks.some(p => p.id === L[perkKey])) L[perkKey] = null;
    if (perks.length) {
      const head = document.createElement('div');
      head.className = 'perk-head';
      head.textContent = `⚡ Boosts for ${ABILITIES[current].name}`;
      wrap.appendChild(head);
      for (const p of [null, ...perks]) {
        const card = document.createElement('button');
        const pk = p && 'perk:' + p.id, cost = p ? priceOf(pk) : 0;
        card.className = 'card perk' + ((L[perkKey] || null) === (p ? p.id : null) ? ' equipped' : '') + (cost ? ' locked' : '');
        card.innerHTML = `<div class="card-name">${p ? p.name : 'No boost'}${priceTag(cost)}</div><div class="card-desc">${p ? p.desc : 'Plain ability'}</div>`;
        card.dataset.perk = p ? p.id : 'none';
        card.onclick = () => { L[perkKey] = p ? p.id : null; Account.save(); keepInPlace(`[data-perk="${p ? p.id : 'none'}"]`, renderLoadout); };
        wrap.appendChild(card);
      }
    }
    // combos this ability is part of
    const combos = COMBOS.filter(c => c.a === current || c.b === current);
    if (combos.length) {
      const head = document.createElement('div');
      head.className = 'perk-head';
      head.textContent = `🔗 Combos with ${ABILITIES[current].name}`;
      wrap.appendChild(head);
      for (const c of combos) {
        const other = ABILITIES[c.a === current ? c.b : c.a], have = [L.ability, L.ability2, L.ability3, L.ability4].includes(c.a) && [L.ability, L.ability2, L.ability3, L.ability4].includes(c.b);
        const card = document.createElement('div');
        card.className = 'card combo' + (have ? ' ready' : '');
        card.innerHTML = `<div class="card-name">${c.name} <small class="hint">+ ${other.name}${have ? ' ✓' : ''}</small></div><div class="card-desc">${c.how}</div>`;
        wrap.appendChild(card);
      }
    }
    const head2 = document.createElement('div');
    head2.className = 'perk-head';
    head2.textContent = ['Abilities', 'Second ability', 'Third ability', 'Fourth ability'][abSlot];
    wrap.appendChild(head2);
    // picking the ability that's in the other slot swaps the two
    const pick = id => {
      const j = id ? KEYS.findIndex((k, i) => i !== abSlot && L[k] === id) : -1;
      if (j >= 0) { // it's in another slot: swap the two
        if (!L[key] && j === 0) return; // slot 1 can't be empty
        [L[KEYS[j]], L[PERKS[j]]] = [L[key], L[perkKey]];
      } else if (L[key] !== id) L[perkKey] = null;
      L[key] = id;
      Account.save(); keepInPlace(`[data-ab="${id}"]`, renderLoadout);
    };
    if (abSlot) {
      const none = document.createElement('button');
      none.className = 'card' + (!current ? ' equipped' : '');
      none.innerHTML = `<div class="ab-icon" style="background:#555c68">–</div><div class="card-name">None</div><div class="card-desc">Leave this slot empty.</div>`;
      none.dataset.ab = 'none';
      none.onclick = () => pick(null);
      wrap.appendChild(none);
    }
    // abilities in sections: Buildings, Placeables, Throwables ... Passives
    const listed = new Set(ABILITY_GROUPS.flatMap(g => g.ids));
    const others = Object.keys(ABILITIES).filter(id => !listed.has(id));
    const groups = [...ABILITY_GROUPS,
      { label: '✨ Passives', note: 'always on', ids: others.filter(id => ABILITIES[id].type === 'passive') },
      { label: 'Other', ids: others.filter(id => ABILITIES[id].type !== 'passive') }];
    for (const grp of groups) {
      const ids = grp.ids.filter(id => ABILITIES[id]);
      if (!ids.length) continue;
      const sec = document.createElement('div');
      sec.className = 'ab-section';
      sec.innerHTML = `${grp.label}${grp.note ? ` <small>${grp.note}</small>` : ''}`;
      wrap.appendChild(sec);
      for (const id of ids) addAbilityCard(id);
    }
    // combo loadouts at the bottom: tap one to equip both of its abilities
    const csec = document.createElement('div');
    csec.className = 'ab-section';
    csec.innerHTML = '🔗 Combos <small>tap to equip both abilities</small>';
    wrap.appendChild(csec);
    for (const c of COMBOS) {
      const A1 = ABILITIES[c.a], A2 = ABILITIES[c.b];
      const eq = [L.ability, L.ability2, L.ability3, L.ability4], on = eq.includes(c.a) && eq.includes(c.b);
      const card = document.createElement('button');
      card.className = 'card combo-pick' + (on ? ' equipped' : '');
      card.innerHTML = `<div class="combo-icons"><span>${abilityIconSVG(c.a, 32)}</span>+<span>${abilityIconSVG(c.b, 32)}</span></div>
        <div class="card-name">${c.name}${c.passive ? ' <small class="hint">auto</small>' : ''}${on ? ' ✓' : ''}</div>
        <div class="card-desc"><b>${A1.name} + ${A2.name}</b><br>${c.how}</div>`;
      card.onclick = () => {
        if (!on) {
          if (L.ability !== c.a) L.perk = null;
          if (L.ability2 !== c.b) L.perk2 = null;
          L.ability = c.a; if (c.b !== c.a) L.ability2 = c.b;
          toast(`Equipped ${A1.name} (E) + ${A2.name} (C)`);
        }
        Account.save(); keepInPlace(`[data-combo="${c.name}"]`, renderLoadout);
      };
      card.dataset.combo = c.name;
      wrap.appendChild(card);
    }
    function addAbilityCard(id) {
      const A = ABILITIES[id];
      const card = document.createElement('button');
      const cost = priceOf('ab:' + id);
      card.className = 'card' + (id === current ? ' equipped' : '') + (cost ? ' locked' : '');
      card.innerHTML = `<div class="ab-icon">${abilityIconSVG(id, 36)}</div>
        <div class="card-name">${A.name}${priceTag(cost)}${KEYS.some((k, i) => i !== abSlot && L[k] === id) ? ' <small class="hint">other slot</small>' : ''}</div>
        <div class="card-desc">${A.desc}</div>`;
      card.dataset.ab = id;
      card.onclick = () => pick(id);
      wrap.appendChild(card);
    }
    if (!current) {
      const { ctx, w, h } = fitCanvas(el('preview'));
      if (w && h) { ctx.fillStyle = '#8a93a3'; ctx.font = '800 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('No second ability', w / 2, h / 2); }
      el('stats').innerHTML = '<p class="stat-note">Pick a second ability to use with C (or the second green button on mobile).</p>';
      return;
    }
    const A = ABILITIES[current];
    const { ctx, w, h } = fitCanvas(el('preview'));
    if (w && h) {
      const r = Math.min(w, h) * 0.24;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(w / 2, h / 2 - 10, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = A.color; ctx.lineWidth = 3; ctx.stroke();
      drawAbilityIcon(ctx, current, w / 2, h / 2 - 10, r * 1.25);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.fillText(A.name, w / 2, h - 22);
    }
    const extra = A.type === 'passive' ? 'Always on.'
      : id_cd(A);
    el('stats').innerHTML = `<p class="stat-note" style="font-size:14px">${A.desc}</p><p class="stat-note">${extra}</p>`;
  }
  const id_cd = A => `${A.uses} use${A.uses === 1 ? '' : 's'} per round · cooldown ${A.cooldown || 0}s. E on PC, the green button on mobile${A.thrown || A === ABILITIES.rpg ? ' (hold to aim, let go to fire)' : ''}.`;

  function fitCanvas(canvas) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawThumb(canvas, part) {
    const { ctx, w, h } = fitCanvas(canvas);
    if (!w || !h) return;
    if (!part) {
      ctx.strokeStyle = '#555c68'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w / 2 - 12, h / 2); ctx.lineTo(w / 2 + 12, h / 2); ctx.stroke();
      return;
    }
    const s = Math.min((w - 12) / part.w, (h - 12) / part.h, 3);
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    drawPart(ctx, part, -part.w / 2, -part.h / 2);
  }

  function renderPreview() {
    if (el('loadout').classList.contains('hidden') || gunKind === 'ability') return;
    const { ctx, w, h } = fitCanvas(el('preview'));
    if (!w || !h) return;
    const L = layoutGun(gunKind, Account.user.loadout[gunKind]);
    const s = Math.min((w - 40) / L.w, (h - 40) / L.h, 5);
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-L.minX - L.w / 2, -L.minY - L.h / 2);
    drawGun(ctx, L);
  }
  new ResizeObserver(renderPreview).observe(el('previewWrap'));
  onArtLoaded = () => { if (!el('loadout').classList.contains('hidden')) renderLoadout(); };

  function renderStats() {
    const s = computeStats(gunKind, Account.user.loadout[gunKind]);
    el('stats').innerHTML = STATS.map(st => `
      <div class="stat">
        <span class="stat-label">${st.label}</span>
        <span class="stat-bar"><i style="width:${Math.round(clamp(s[st.key] / st.max, 0.03, 1) * 100)}%"></i></span>
        <span class="stat-val">${formatStat(st.key, s[st.key])}</span>
      </div>`).join('') +
      `<p class="stat-note">Range ${Math.round(s.range)}${s.pellets > 1 ? ` · ${s.pellets} pellets` : ''} · fires every ${s.fireDelay.toFixed(2)}s · heard ${Math.round(s.hearRadius)} units away${s.loudness < 2 ? ' (silenced)' : ''}</p>`;
  }

  // ---------------------------------------------------------------- pause
  el('pauseBtn').onclick = () => {
    Game.pause();
    el('pauseNote').textContent = Game.mode === 'mp' ? 'The round keeps going while this is open!' : Game.test ? 'Test mode' : '';
    el('testLoadoutBtn').classList.toggle('hidden', !Game.test);
    el('testEpicBtn').classList.toggle('hidden', !Game.test);
    el('testInfBtn').classList.toggle('hidden', !Game.test);
    el('testInfBtn').textContent = `∞ Infinite ability: ${Game.infAbility ? 'ON' : 'OFF'}`;
    el('testInfBtn').classList.toggle('primary', Game.infAbility);
    overlay('pauseScreen', true);
  };
  el('resumeBtn').onclick = () => { overlay('pauseScreen', false); Game.resume(); };
  el('pauseSettings').onclick = () => overlay('settingsScreen', true);
  el('quitBtn').onclick = () => {
    overlay('pauseScreen', false);
    if (Game.mode === 'mp') {
      Net.send({ t: 'dead', by: null });
      if (Net.state.isHost) handleDead(Net.state.myId);
      Game.stop();
      showLobby();
    } else {
      // quitting still banks the score you earned this run (test mode doesn't count)
      const r = Game.run;
      const add = bankRun(r);
      if (add) toast(`+${add} score to spend`);
      Game.stop();
      goMenu();
    }
  };
  addEventListener('keydown', e => {
    if (e.code !== 'Escape' || !Game.running) return;
    if (el('pauseScreen').classList.contains('hidden')) el('pauseBtn').click();
    else el('resumeBtn').click();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Game.running && Game.mode === 'sp' && el('pauseScreen').classList.contains('hidden')) el('pauseBtn').click();
  });

  // after beating a boss: change abilities (guns stay), then jump back in
  Game.on('bossDown', r => {
    if (!Game.running) return;
    Game.pause();
    bankRun(Game.run); // score earned so far this run can be spent in the boss shop
    for (const o of ['pauseScreen', 'resultScreen', 'settingsScreen']) overlay(o, false);
    if (r.unlocked3) abSlot = 2;
    if (r.unlocked4) abSlot = 3;
    openLoadout('Back to game', () => { show(null); Game.applyAbilities(); Game.resume(); },
      () => { show(null); Game.applyAbilities(); Game.resume(); }, true);
    const note = document.createElement('div');
    note.className = 'boss-pick';
    note.textContent = r.unlocked4 ? 'Boss down! 4th ability slot unlocked — press B to use it.' : r.unlocked3 ? 'Boss down! 3rd ability slot unlocked — press V to use it.' : 'Boss down! You can switch your abilities now.';
    el('parts').prepend(note);
  });
  Game.on('spOver', r => {
    bankRun(r);
    Game.stop();
    showResult('You died', `Wave ${r.wave} · ${r.kills} kills · score ${r.score}${r.test ? ' (test mode — not counted)' : ` · +${r.score} to spend (you have ${Account.user.bank})`}`, [
      { label: 'Play again', fn: spLoadout },
      { label: 'Main menu', fn: goMenu },
    ]);
  });

  // ---------------------------------------------------------------- multiplayer
  const lobby = { players: [], inRound: false, alive: new Set(), round: [], settings: { mode: 'ffa', layout: 'medium', size: 'medium', banned: [] } };

  function applyRules() { Rules.banned = new Set(lobby.settings.banned); }
  function rulesText() {
    const s = lobby.settings;
    return `${s.mode === 'teams' ? 'Teams (random)' : 'Free for all'} · ${MAP.layouts[s.layout].label} · ${MAP.sizes[s.size || 'medium'].label} map` +
      (s.free ? ' · all upgrades free' : ' · upgrades cost score') + (s.banned.length ? ` · ${s.banned.length} upgrade${s.banned.length === 1 ? '' : 's'} removed` : '');
  }

  // ---- host setup screen
  let editing = { ...lobby.settings };
  function openHostSetup(inRoom) {
    editing = { ...lobby.settings, banned: [...lobby.settings.banned] };
    el('hostConfirm').textContent = inRoom ? 'Save' : 'Create room';
    el('hostConfirm').onclick = inRoom ? saveRoomSettings : createRoom;
    el('hostCancel').onclick = inRoom ? showLobby : () => show('mp');
    show('hostSetup');
    renderHostSetup();
  }
  function renderHostSetup() {
    el('hostFree').checked = !!editing.free;
    el('hostFree').onchange = () => { editing.free = el('hostFree').checked; };
    for (const b of el('modePick').children) {
      b.classList.toggle('active', b.dataset.v === editing.mode);
      b.onclick = () => { editing.mode = b.dataset.v; renderHostSetup(); };
    }
    el('modeHint').textContent = editing.mode === 'teams' ? 'Players are split into two random teams. No friendly fire.' : 'Everyone against everyone.';
    el('layoutPick').innerHTML = '';
    for (const key in MAP.layouts) {
      const b = document.createElement('button');
      b.textContent = MAP.layouts[key].label;
      b.className = key === editing.layout ? 'active' : '';
      b.onclick = () => { editing.layout = key; renderHostSetup(); };
      el('layoutPick').appendChild(b);
    }
    el('sizePick').innerHTML = '';
    for (const key in MAP.sizes) {
      const b = document.createElement('button');
      b.textContent = MAP.sizes[key].label;
      b.className = key === (editing.size || 'medium') ? 'active' : '';
      b.onclick = () => { editing.size = key; renderHostSetup(); };
      el('sizePick').appendChild(b);
    }
    el('banList').innerHTML = '';
    for (const s of SLOTS) {
      const group = document.createElement('div');
      group.className = 'ban-group';
      group.innerHTML = `<span>${s.label}</span>`;
      for (const p of PARTS[s.key]) {
        const key = s.key + ':' + p.id, banned = editing.banned.includes(key);
        const chip = document.createElement('button');
        chip.className = 'chip' + (banned ? ' banned' : '');
        chip.style.setProperty('--chip', p.color);
        chip.textContent = p.name;
        chip.onclick = () => {
          editing.banned = banned ? editing.banned.filter(k => k !== key) : [...editing.banned, key];
          renderHostSetup();
        };
        group.appendChild(chip);
      }
      el('banList').appendChild(group);
    }
  }
  async function createRoom() {
    lobby.settings = editing;
    show('mp');
    el('mpStatus').textContent = 'Creating room…';
    try {
      await Net.host();
      lobby.players = [{ id: Net.state.myId, name: Account.user.name, wins: 0 }];
      lobby.inRound = false;
      applyRules();
      showLobby();
    } catch (err) { netError(err); }
  }
  function saveRoomSettings() {
    lobby.settings = editing;
    applyRules();
    broadcastRoster();
    showLobby();
  }

  function netError(err) {
    const msg = typeof Peer === 'undefined' ? 'Multiplayer needs an internet connection.' : (err && err.message) || 'Connection failed.';
    el('mpStatus').textContent = msg;
  }

  el('mpBack').onclick = () => { Net.leave(); goMenu(); };
  el('hostBtn').onclick = () => openHostSetup(false);
  el('roomSettingsBtn').onclick = () => openHostSetup(true);
  el('joinBtn').onclick = async () => {
    const code = el('joinCode').value.trim().toUpperCase();
    if (code.length !== 5) { el('mpStatus').textContent = 'Room codes are 5 characters.'; return; }
    el('mpStatus').textContent = 'Joining…';
    try {
      await Net.join(code);
      lobby.players = [];
      Net.send({ t: 'hello', name: Account.user.name });
      showLobby();
    } catch (err) { netError(err); }
  };
  el('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') el('joinBtn').click(); });

  function showLobby() {
    show('lobby');
    renderLobby();
  }

  function renderLobby() {
    el('roomCode').textContent = Net.state.code || '';
    el('playerList').innerHTML = lobby.players.map((p, i) => `
      <li><i style="background:${PLAYER_COLORS[i % PLAYER_COLORS.length]}"></i>
      <span>${esc(p.name)}${p.id === Net.state.myId ? ' (you)' : ''}${i === 0 ? ' · host' : ''}</span>
      <b>${p.wins} ${p.wins === 1 ? 'win' : 'wins'}</b></li>`).join('') || '<li><span>Connecting…</span></li>';
    el('lobbyRules').textContent = rulesText();
    el('roomSettingsBtn').classList.toggle('hidden', !Net.state.isHost || lobby.inRound);
    el('startRoundBtn').classList.toggle('hidden', !Net.state.isHost);
    el('startRoundBtn').disabled = lobby.inRound;
    el('lobbyStatus').textContent = lobby.inRound ? 'A round is in progress…'
      : Net.state.isHost ? (lobby.players.length < 2 ? 'Waiting for friends to join…' : 'Customize your guns, then start the round.')
      : 'Customize your guns. The host starts the round.';
  }

  el('lobbyCustomize').onclick = () => { shopOn = !lobby.settings.free; openLoadout('Done', showLobby, showLobby); };
  el('leaveLobby').onclick = () => { Net.leave(); goMenu(); };

  function broadcastRoster() {
    Net.send({ t: 'roster', players: lobby.players, inRound: lobby.inRound, settings: lobby.settings });
    if (!el('lobby').classList.contains('hidden')) renderLobby();
  }

  el('startRoundBtn').onclick = () => {
    if (lobby.players.length < 2) { toast('You need at least 2 players.'); return; }
    lobby.inRound = true;
    lobby.alive = new Set(lobby.players.map(p => p.id));
    // random teams: shuffle, then alternate
    const order = lobby.players.map(p => ({ id: p.id, name: p.name })).sort(() => Math.random() - 0.5);
    order.forEach((p, i) => { p.team = lobby.settings.mode === 'teams' ? i % 2 : i; });
    const seed = Math.floor(Math.random() * 1e9);
    Net.send({ t: 'start', players: order, settings: lobby.settings, seed });
    broadcastRoster();
    beginRound(order, lobby.settings, seed);
  };

  function beginRound(players, settings, seed) {
    for (const o of ['pauseScreen', 'resultScreen', 'settingsScreen']) overlay(o, false);
    show(null);
    lobby.round = players;
    lobby.settings = settings;
    // paid server: buy what you don't own, or it gets taken out of your loadout
    shopOn = !settings.free;
    if (unowned().length && !checkout()) stripUnowned();
    applyRules();
    buildMap(settings.layout, seed, settings.size);
    Game.startMP(players, Net.state.myId, settings.mode === 'teams');
  }

  // host bookkeeping
  function handleDead(id) {
    if (!Net.state.isHost || !lobby.inRound) return;
    lobby.alive.delete(id);
    const teamOf = pid => (lobby.round.find(p => p.id === pid) || {}).team;
    const teamsLeft = new Set([...lobby.alive].map(teamOf));
    if (teamsLeft.size > 1) return;
    const winTeam = teamsLeft.size ? [...teamsLeft][0] : null;
    const winners = winTeam === null ? [] : lobby.round.filter(p => p.team === winTeam).map(p => p.id);
    lobby.inRound = false;
    for (const p of lobby.players) if (winners.includes(p.id)) p.wins++;
    const winner = lobby.settings.mode === 'teams' ? null : winners[0] || null;
    Net.send({ t: 'end', winner, team: winTeam });
    broadcastRoster();
    roundOver(winner, winTeam);
  }

  function roundOver(winner, team) {
    const name = (lobby.players.find(p => p.id === winner) || {}).name;
    const mine = (lobby.round.find(p => p.id === Net.state.myId) || {}).team;
    const title = lobby.settings.mode === 'teams'
      ? (team === null || team === undefined ? 'Round over' : team === mine ? 'Your team wins!' : 'Your team lost')
      : winner === Net.state.myId ? 'You win!' : name ? `${name} wins!` : 'Round over';
    setTimeout(() => {
      if (Game.mode === 'mp') Game.stop();
      overlay('pauseScreen', false);
      showResult(title, 'Change your guns in the lobby before the next round.', [{ label: 'Back to lobby', fn: showLobby }]);
    }, 1200);
  }

  Net.on('hello', m => {
    if (!Net.state.isHost) return;
    if (!lobby.players.some(p => p.id === m.from)) {
      lobby.players.push({ id: m.from, name: String(m.name || 'Player').slice(0, 16), wins: 0 });
      toast(`${String(m.name).slice(0, 16)} joined`);
    }
    broadcastRoster();
  });
  Net.on('roster', m => {
    if (Net.state.isHost) return;
    lobby.players = m.players;
    lobby.inRound = m.inRound;
    if (m.settings) { lobby.settings = m.settings; applyRules(); }
    if (!el('lobby').classList.contains('hidden')) renderLobby();
  });
  Net.on('leave', m => {
    if (!Net.state.isHost) return;
    lobby.players = lobby.players.filter(p => p.id !== m.from);
    handleDead(m.from);
    broadcastRoster();
  });
  Net.on('start', m => { if (!Net.state.isHost) { lobby.inRound = true; beginRound(m.players, m.settings, m.seed); } });
  Net.on('dead', m => handleDead(m.from));
  Game.on('myDeath', () => handleDead(Net.state.myId));
  Net.on('end', m => { if (!Net.state.isHost) { lobby.inRound = false; roundOver(m.winner, m.team); } });
  Net.on('hostLeft', () => {
    Game.stop();
    Net.leave();
    for (const o of ['pauseScreen', 'resultScreen', 'settingsScreen']) overlay(o, false);
    show(null);
    showResult('The host left', 'The game has ended.', [{ label: 'Main menu', fn: goMenu }]);
  });
  Net.on('error', m => toast((m.error && m.error.message) || 'Connection problem'));

  // ---------------------------------------------------------------- go
  loadArt();
  if (Account.restore()) goMenu(); else show('login');
})();
