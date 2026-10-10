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
    el('menuBest').textContent = Account.user.best ? `· best wave ${Account.user.best}` : '';
    show('menu');
  }

  let testMode = false;
  const spLoadout = () => openLoadout(testMode ? 'Start test' : 'Start', () => { show(null); buildMap('medium', MAP.seed, 'medium'); Game.startSP(testMode); }, goMenu);
  // Single Player first asks: test mode on or off?
  el('spBtn').onclick = () => { el('testToggle').checked = testMode; overlay('spScreen', true); };
  el('spStart').onclick = () => { testMode = el('testToggle').checked; overlay('spScreen', false); spLoadout(); };
  el('spCancel').onclick = () => overlay('spScreen', false);
  // test mode: change loadout from the pause menu, then jump straight back in
  el('testLoadoutBtn').onclick = () => {
    overlay('pauseScreen', false);
    openLoadout('Back to game', () => { show(null); Game.applyLoadout(); Game.resume(); },
      () => { show(null); Game.applyLoadout(); Game.resume(); });
  };
  el('mpBtn').onclick = () => { el('mpStatus').textContent = ''; show('mp'); };
  el('customizeBtn').onclick = () => openLoadout('Save', goMenu, goMenu);
  el('settingsBtn').onclick = () => overlay('settingsScreen', true);
  el('logoutBtn').onclick = () => { Account.logout(); show('login'); };

  // ---------------------------------------------------------------- settings
  function applySettings() {
    document.body.classList.toggle('mobile', Settings.mobile);
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

  function openLoadout(doneLabel, done, back) {
    el('loadoutDone').textContent = doneLabel;
    onDone = done; onBack = back;
    show('loadout');
    renderLoadout();
  }
  el('loadoutDone').onclick = () => onDone && onDone();
  el('loadoutBack').onclick = () => onBack && onBack();

  function renderLoadout() {
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
      b.className = 'gun-tab' + (kind === gunKind ? ' active' : '');
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
      const card = document.createElement('button');
      card.className = 'card' + (equipped ? ' equipped' : '');
      const thumb = document.createElement('canvas');
      thumb.className = 'thumb';
      card.appendChild(thumb);
      const mods = part ? describeMods(part).map(m => `<span class="${m.good ? 'good' : 'bad'}">${m.text}</span>`).join('') : '';
      const info = document.createElement('div');
      info.innerHTML = `<div class="card-name">${part ? part.name : 'None'}</div><div class="card-mods">${mods || '<span>no changes</span>'}</div>`;
      card.appendChild(info);
      card.onclick = () => {
        build[slot] = part ? part.id : null;
        Account.save();
        renderLoadout();
      };
      wrap.appendChild(card);
      requestAnimationFrame(() => drawThumb(thumb, part));
    }

    renderPreview();
    renderStats();
  }

  function renderAbilities() {
    const current = Account.user.loadout.ability;
    el('slotTabs').innerHTML = '';
    const wrap = el('parts');
    wrap.innerHTML = '';
    for (const id in ABILITIES) {
      const A = ABILITIES[id];
      const card = document.createElement('button');
      card.className = 'card' + (id === current ? ' equipped' : '');
      card.innerHTML = `<div class="ab-icon" style="background:${A.color}">${A.name[0]}</div>
        <div class="card-name">${A.name} <small class="hint">${A.type}</small></div>
        <div class="card-desc">${A.desc}</div>`;
      card.onclick = () => { Account.user.loadout.ability = id; Account.save(); renderLoadout(); };
      wrap.appendChild(card);
    }
    const A = ABILITIES[current];
    const { ctx, w, h } = fitCanvas(el('preview'));
    if (w && h) {
      ctx.fillStyle = A.color;
      ctx.beginPath(); ctx.arc(w / 2, h / 2 - 10, Math.min(w, h) * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(Math.min(w, h) * 0.2)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(A.name[0], w / 2, h / 2 - 10);
      ctx.font = '800 16px system-ui, sans-serif';
      ctx.fillText(A.name, w / 2, h - 22);
    }
    const extra = A.type === 'passive' ? 'Always on.'
      : id_cd(A);
    el('stats').innerHTML = `<p class="stat-note" style="font-size:14px">${A.desc}</p><p class="stat-note">${extra}</p>`;
  }
  const id_cd = A => `${A.uses} use${A.uses === 1 ? '' : 's'} per round · cooldown ${A.cooldown || 0}s. E on PC, the green button on mobile${['grenade', 'rpg', 'medic', 'turret'].includes(Object.keys(ABILITIES).find(k => ABILITIES[k] === A)) ? ' (hold to aim, let go to fire)' : ''}.`;

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

  Game.on('spOver', r => {
    if (!r.test) { Account.user.best = Math.max(Account.user.best || 0, r.wave); Account.save(); }
    Game.stop();
    showResult('You died', `Wave ${r.wave} · ${r.kills} kills · score ${r.score}${r.test ? ' (test mode — not counted)' : ''}`, [
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
      (s.banned.length ? ` · ${s.banned.length} upgrade${s.banned.length === 1 ? '' : 's'} removed` : '');
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

  el('lobbyCustomize').onclick = () => openLoadout('Done', showLobby, showLobby);
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
