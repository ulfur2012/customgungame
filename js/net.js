// Peer-to-peer multiplayer via PeerJS. The host relays every message to the other players.
const Net = (() => {
  const PREFIX = 'cgg-room-';
  let peer = null, conns = [], hostConn = null;
  const handlers = {};
  const state = { isHost: false, myId: null, code: null, connected: false };

  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  function emit(msg) { for (const fn of handlers[msg.t] || []) fn(msg); }

  const randomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');

  function host() {
    leave();
    return new Promise((resolve, reject) => {
      const code = randomCode();
      peer = new Peer(PREFIX + code);
      peer.on('open', id => {
        Object.assign(state, { isHost: true, myId: id, code, connected: true });
        resolve(code);
      });
      peer.on('connection', c => {
        c.on('open', () => conns.push(c));
        c.on('data', m => {
          if (!m || typeof m !== 'object') return;
          m.from = c.peer; // never trust a client-provided sender id
          if (m.t !== 'hello') relay(m, c);
          emit(m);
        });
        c.on('close', () => {
          conns = conns.filter(x => x !== c);
          emit({ t: 'leave', from: c.peer });
        });
      });
      peer.on('error', err => {
        if (!state.connected) reject(err);
        else emit({ t: 'error', error: err });
      });
    });
  }

  function join(code) {
    leave();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not find that room.')), 12000);
      peer = new Peer();
      peer.on('open', id => {
        state.myId = id;
        hostConn = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
        hostConn.on('open', () => {
          clearTimeout(timer);
          Object.assign(state, { isHost: false, code: code.trim().toUpperCase(), connected: true });
          resolve();
        });
        hostConn.on('data', m => { if (m && typeof m === 'object') emit(m); });
        hostConn.on('close', () => { if (state.connected) emit({ t: 'hostLeft' }); });
      });
      peer.on('error', err => {
        clearTimeout(timer);
        if (!state.connected) reject(err.type === 'peer-unavailable' ? new Error('No room with that code.') : err);
        else emit({ t: 'error', error: err });
      });
    });
  }

  function relay(msg, except) {
    for (const c of conns) if (c !== except && c.open) c.send(msg);
  }

  // Host: to everyone. Client: to the host (who relays it).
  function send(msg) {
    msg.from = state.myId;
    if (state.isHost) relay(msg, null);
    else if (hostConn && hostConn.open) hostConn.send(msg);
  }

  function leave() {
    state.connected = false;
    if (peer) peer.destroy();
    peer = null; conns = []; hostConn = null;
    Object.assign(state, { isHost: false, myId: null, code: null });
  }

  return { host, join, send, leave, on, state };
})();
