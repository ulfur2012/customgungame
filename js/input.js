// Desktop: WASD + mouse. Mobile version: Brawl Stars style twin joysticks.
const Input = (() => {
  const canvas = document.getElementById('game');
  const keys = new Set();
  const mouse = { x: 0, y: 0, down: false, active: false };
  const sticks = { move: null, aim: null };
  const STICK_R = 60;
  const flags = { reload: false, swap: false, select: -1, tap: false, abPress: false };

  addEventListener('keydown', e => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyR') flags.reload = true;
    if (e.code === 'KeyQ') flags.swap = true;
    if (e.code === 'KeyE') flags.abPress = true;
    if (e.code === 'Digit1') flags.select = 0;
    if (e.code === 'Digit2') flags.select = 1;
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', reset);
  canvas.addEventListener('wheel', () => { if (!Settings.mobile) flags.swap = true; }, { passive: true });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!Settings.mobile) {
      if (e.pointerType !== 'mouse') return;
      Object.assign(mouse, { x: e.clientX, y: e.clientY, active: true });
      if (e.button === 0) mouse.down = true;
      return;
    }
    // mobile version: left half = move stick, right half = aim stick (mouse works too, for testing)
    const side = e.clientX < innerWidth / 2 ? 'move' : 'aim';
    if (sticks[side]) return;
    sticks[side] = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), far: 0 };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });

  addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') Object.assign(mouse, { x: e.clientX, y: e.clientY, active: true });
    for (const k in sticks) {
      const s = sticks[k];
      if (!s || s.id !== e.pointerId) continue;
      s.x = e.clientX; s.y = e.clientY;
      const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy);
      s.far = Math.max(s.far, d);
      if (d > STICK_R) { s.ox = s.x - dx / d * STICK_R; s.oy = s.y - dy / d * STICK_R; }
    }
  });

  const release = e => {
    if (e.pointerType === 'mouse' && e.button === 0) mouse.down = false;
    for (const k in sticks) {
      const s = sticks[k];
      if (!s || s.id !== e.pointerId) continue;
      // quick tap on the aim side = auto-aim at the nearest enemy and shoot
      if (k === 'aim' && performance.now() - s.t < 250 && s.far < 15) flags.tap = true;
      sticks[k] = null;
    }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);

  function reset() {
    keys.clear();
    mouse.down = false;
    abilityTouch = false;
    sticks.move = sticks.aim = null;
    Object.assign(flags, { reload: false, swap: false, select: -1, tap: false, abPress: false });
  }

  // {x, y}, length <= 1
  function move() {
    if (Settings.mobile) {
      const s = sticks.move;
      if (!s) return { x: 0, y: 0 };
      let x = (s.x - s.ox) / STICK_R, y = (s.y - s.oy) / STICK_R;
      const d = Math.hypot(x, y);
      if (d < 0.15) return { x: 0, y: 0 };
      if (d > 1) { x /= d; y /= d; }
      return { x, y };
    }
    const x = (keys.has('KeyD') || keys.has('ArrowRight')) - (keys.has('KeyA') || keys.has('ArrowLeft'));
    const y = (keys.has('KeyS') || keys.has('ArrowDown')) - (keys.has('KeyW') || keys.has('ArrowUp'));
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
  }

  // Desktop: angle toward the mouse, fire while held.
  // Mobile: angle of the aim stick; `aiming` is true while the stick is pushed (game auto-fires).
  function aim(px, py) {
    if (Settings.mobile) {
      const s = sticks.aim;
      if (!s) return { angle: null, aiming: false, fire: false };
      const dx = s.x - s.ox, dy = s.y - s.oy;
      if (Math.hypot(dx, dy) < 10) return { angle: null, aiming: false, fire: false };
      return { angle: Math.atan2(dy, dx), aiming: true, fire: false };
    }
    if (!mouse.active) return { angle: null, aiming: false, fire: keys.has('Space') };
    return { angle: Math.atan2(mouse.y - py, mouse.x - px), aiming: true, fire: mouse.down || keys.has('Space') };
  }

  // ability button: E on PC, the green button on mobile
  let abilityTouch = false;
  const abBtn = document.getElementById('abilityBtn');
  abBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    abilityTouch = true;
    flags.abPress = true;
    try { abBtn.setPointerCapture(e.pointerId); } catch (err) {}
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) abBtn.addEventListener(ev, () => { abilityTouch = false; });
  const abilityHeld = () => keys.has('KeyE') || abilityTouch;

  function take(name) { const v = flags[name]; flags[name] = name === 'select' ? -1 : false; return v; }

  return { move, aim, reset, take, flags, sticks, mouse, STICK_R, abilityHeld };
})();
