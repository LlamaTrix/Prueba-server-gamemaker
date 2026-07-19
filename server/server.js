// Servidor de lobby + chat para el juego de GameMaker.
// Sin dependencias: solo el módulo net de Node.
//
// Protocolo (TCP raw, little-endian):
//   Cada trama = [u16 largo del payload][payload]
//   Payload    = [u8 idMensaje][...datos]
//   Los strings son UTF-8 terminados en NUL (igual que buffer_string de GameMaker).
//
// Mensajes:
//   1 MSG_JOIN         cliente -> servidor : string nombre
//   2 MSG_WELCOME      servidor -> cliente : u16 uid
//   3 MSG_PLAYER_LIST  servidor -> todos   : u16 cantidad, N strings
//   4 MSG_CHAT         cliente -> servidor : string texto
//                      servidor -> todos   : string nombre, string texto

const net = require('net');
const http = require('http');
const readline = require('readline');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 6510;
const HTTP_PORT = process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 6511;
const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 6512;
const MAX_NAME_LEN = 24;
const MAX_CHAT_LEN = 200;
const SERVER_NAME = '-servidor-';

const MSG_JOIN = 1;
const MSG_WELCOME = 2;
const MSG_PLAYER_LIST = 3;
const MSG_CHAT = 4;
const MSG_ACTIVITY = 5;
const MSG_KICK = 6;
const MSG_LEAVE = 7;
const MSG_WORLD = 8;   // servidor -> clientes: snapshot de todos (uid, nombre, x, y, facing)
const MSG_POS = 9;     // posición y dirección de un jugador
const MSG_BUBBLE = 10; // uid + texto para la burbuja de chat
const MSG_ATTACK = 11; // cliente -> servidor: u8 tipo + u8 nivel de carga
const MSG_HIT = 12;    // servidor -> clientes: objetivo, golpe, vida y posición autoritativa
const MSG_ATTACK_STATE = 13; // servidor -> clientes: u16 atacante + u8 tipo + u8 fase
const MSG_STATS = 14;        // servidor -> clientes: u16 uid + u8 vida + u8 ki
const MSG_KI_CHARGE = 15;    // cliente -> servidor: u8 activo
const MSG_KI_FIRE = 16;      // cliente -> servidor: u8 disparo frontal
const MSG_KI_STATE = 17;     // servidor -> clientes: u16 uid + u8 estado
const MSG_DASH = 18;         // cliente -> servidor: s8 dirección lateral
const MSG_DASH_STATE = 19;   // servidor -> clientes: u16 uid + u16 x + u16 y + s8 dirección
const MSG_KI_HIT = 20;       // cliente -> servidor: u16 objetivo (impacto de onda de ki)
const MSG_INPUT = 21;
const MSG_SNAPSHOT = 22;
const MSG_PING = 23;
const MSG_PONG = 24;
const MSG_NAME_REJECT = 25;
const DASH_COOLDOWN_MS = 1000;
const DASH_DISTANCE = 30;

const AFK_AFTER_MS = process.env.AFK_AFTER_MS ? Number(process.env.AFK_AFTER_MS) : 60_000;
const KICK_AFTER_MS = process.env.KICK_AFTER_MS ? Number(process.env.KICK_AFTER_MS) : 80_000;

let nextUid = 1;
const clients = new Map(); // socket -> { uid, name, inbuf, lastMovementAt, afk }

// ---------- helpers de escritura ----------

class Writer {
  constructor() { this.parts = []; }
  u8(v)  { this.parts.push(Buffer.from([v & 0xff])); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(v)))); this.parts.push(b); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.parts.push(b); return this; }
  s8(v)  { const b = Buffer.alloc(1); b.writeInt8(v); this.parts.push(b); return this; }
  str(s) { this.parts.push(Buffer.from(String(s), 'utf8'), Buffer.from([0])); return this; }
  frame() {
    const payload = Buffer.concat(this.parts);
    const head = Buffer.alloc(2);
    head.writeUInt16LE(payload.length);
    return Buffer.concat([head, payload]);
  }
}

function send(socket, writer) {
  if (!socket.destroyed) socket.write(writer.frame());
}

function broadcast(writer) {
  const frame = writer.frame();
  for (const [socket, c] of clients) {
    if (c.name !== null && !socket.destroyed) socket.write(frame);
  }
}

function broadcastExcept(writer, exceptSocket) {
  const frame = writer.frame();
  for (const [socket, c] of clients) {
    if (socket !== exceptSocket && c.name !== null && !socket.destroyed) socket.write(frame);
  }
}

function readString(buf, offset) {
  const end = buf.indexOf(0, offset);
  if (end === -1) return null;
  return { value: buf.toString('utf8', offset, end), next: end + 1 };
}

// ---------- lógica del juego ----------

function playerListWriter() {
  const names = [...clients.values()]
    .filter(c => c.name !== null)
    .map(c => c.name + (c.afk ? ' [AFK]' : ''));
  const w = new Writer().u8(MSG_PLAYER_LIST).u16(names.length);
  for (const n of names) w.str(n);
  return w;
}

function worldWriter() {
  const players = [...clients.values()].filter(c => c.name !== null);
  const w = new Writer().u8(MSG_WORLD).u16(players.length);
  for (const c of players) w.u16(c.uid).str(c.name).u16(c.x).u16(c.y).s8(c.facing);
  return w;
}

function broadcastPosition(c) {
  broadcast(new Writer().u8(MSG_POS).u16(c.uid).u16(c.x).u16(c.y).s8(c.facing));
}

function broadcastSnapshot(c) {
  broadcast(new Writer().u8(MSG_SNAPSHOT).u16(c.uid).u32(c.lastInputSeq).u16(c.x).u16(c.y).s8(c.facing));
}

function broadcastStats(c, exceptSocket = null) {
  const frame = new Writer().u8(MSG_STATS).u16(c.uid).u8(c.health).u8(c.ki).frame();
  for (const [socket, player] of clients) {
    if (socket !== exceptSocket && player.name !== null && !socket.destroyed) socket.write(frame);
  }
}

function applyDamage(target, damage) {
  target.health = Math.max(0, target.health - damage);
  if (target.kiCharging) {
    target.kiCharging = false;
    broadcast(new Writer().u8(MSG_KI_STATE).u16(target.uid).u8(0));
  }
  broadcastStats(target);
}

function findAttackTarget(attacker, kind) {
  const vertical = kind === 3 || kind === 4;
  const hitX = attacker.x + attacker.facing * (vertical ? 32 : 42);
  const hitY = attacker.y + (kind === 3 ? -62 : kind === 4 ? -18 : -40);
  const hitRadius = kind === 1 ? 15 : 19;
  let best = null;
  let bestDistance = Infinity;

  for (const candidate of clients.values()) {
    if (candidate.name === null || candidate.uid === attacker.uid) continue;
    const distance = Math.hypot(candidate.x - hitX, (candidate.y - 40) - hitY);
    if (distance <= hitRadius + 26 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function systemChat(text) {
  broadcast(new Writer().u8(MSG_CHAT).str(SERVER_NAME).str(text));
}

// Busca un cliente ya identificado por su uid (número) o por su nombre exacto.
function findClient(query) {
  const q = String(query).trim();
  const asUid = Number(q);
  for (const [socket, c] of clients) {
    if (c.name === null) continue;
    if (!Number.isNaN(asUid) && q !== '' && c.uid === asUid) return { socket, c };
    if (c.name.toLowerCase() === q.toLowerCase()) return { socket, c };
  }
  return null;
}

// Expulsa a un jugador con un motivo. Devuelve true si lo encontró.
function kickPlayer(query, reason) {
  const found = findClient(query);
  if (!found) return false;
  const { socket, c } = found;
  c.kicking = true;
  const motivo = reason && reason.trim() !== '' ? reason.trim() : 'Expulsado por el servidor';
  send(socket, new Writer().u8(MSG_KICK).str(motivo));
  systemChat(`${c.name} fue expulsado (${motivo})`);
  console.log(`[kick] ${c.name} (uid ${c.uid}) — ${motivo}`);
  socket.end();
  return true;
}

function handleMessage(socket, payload) {
  const c = clients.get(socket);
  if (!c || payload.length < 1) return;
  const msg = payload.readUInt8(0);

  if (msg === MSG_JOIN && c.name === null) {
    const r = readString(payload, 1);
    if (!r) return;
    let name = r.value.trim().slice(0, MAX_NAME_LEN);
    if (name === '') {
      send(socket, new Writer().u8(MSG_NAME_REJECT).str('El nombre es obligatorio'));
      return;
    }
    const duplicate = [...clients.values()].some(other => other !== c && other.name !== null
      && other.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      send(socket, new Writer().u8(MSG_NAME_REJECT).str('Ese nombre ya está en uso'));
      return;
    }
    c.name = name;
    c.x = 100 + Math.floor(Math.random() * 3801);
    c.y = 100 + Math.floor(Math.random() * 3801);
    c.facing = 1;
    c.lastMovementAt = Date.now();

    send(socket, new Writer().u8(MSG_WELCOME).u16(c.uid).u16(c.x).u16(c.y));
    broadcast(playerListWriter());
    broadcast(worldWriter());
    for (const player of clients.values()) if (player.name !== null) send(socket, new Writer().u8(MSG_STATS).u16(player.uid).u8(player.health).u8(player.ki));
    systemChat(`${name} entró al lobby`);
    console.log(`[+] ${name} (uid ${c.uid}) entró — ${countPlayers()} en línea`);

  } else if (msg === MSG_CHAT && c.name !== null) {
    const r = readString(payload, 1);
    if (!r) return;
    const text = r.value.trim().slice(0, MAX_CHAT_LEN);
    if (text === '') return;
    broadcast(new Writer().u8(MSG_CHAT).str(c.name).str(text));
    broadcast(new Writer().u8(MSG_BUBBLE).u16(c.uid).str(text));
    console.log(`[chat] ${c.name}: ${text}`);

  } else if (msg === MSG_INPUT && c.name !== null && payload.length >= 8) {
    const sequence = payload.readUInt32LE(1);
    if (sequence <= c.lastInputSeq || sequence - c.lastInputSeq > 180) return;
    c.lastInputSeq = sequence;
    const dx = Math.max(-1, Math.min(1, payload.readInt8(5)));
    const dy = Math.max(-1, Math.min(1, payload.readInt8(6)));
    c.facing = payload.readInt8(7) < 0 ? -1 : 1;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      c.x = Math.max(20, Math.min(3980, c.x + dx / length * 3));
      c.y = Math.max(48, Math.min(3990, c.y + dy / length * 3));
    }
    c.lastMovementAt = Date.now();
    if (c.afk) {
      c.afk = false;
      broadcast(playerListWriter());
      systemChat(`${c.name} ya no está AFK`);
    }
    broadcastSnapshot(c);

  } else if (msg === MSG_POS && c.name !== null) {
    // Compatibilidad: las posiciones enviadas por clientes ya no son autoridad.
    return;

  } else if (msg === MSG_PING && c.name !== null && payload.length >= 5) {
    send(socket, new Writer().u8(MSG_PONG).u32(payload.readUInt32LE(1)));

  } else if (msg === MSG_ATTACK && c.name !== null && payload.length >= 3) {
    const now = Date.now();
    if (now - c.lastAttackAt < 100) return;
    c.lastAttackAt = now;

    const kind = payload.readUInt8(1);
    if (kind < 1 || kind > 4) return;
    let charge = Math.min(3, payload.readUInt8(2));
    const comboStage = payload.length >= 4 ? Math.min(3, payload.readUInt8(3)) : 0;
    if (kind === 1 || kind === 2) charge = 0;

    // Todos ven la animación del atacante, incluso cuando el golpe no alcanza a nadie.
    broadcastExcept(new Writer().u8(MSG_ATTACK_STATE).u16(c.uid).u8(kind).u8(comboStage), socket);

    const target = findAttackTarget(c, kind);
    if (target) {
      const damage = kind === 1 ? 3 : 5 + charge;
      applyDamage(target, damage);
      // El servidor mueve también la posición autoritativa para que el empuje
      // sea visible de forma consistente tanto en escritorio como en HTML5.
      if (kind === 2) target.x = Math.max(20, Math.min(3980, target.x + c.facing * (30 + charge)));
      if (kind === 3) target.y = Math.max(48, Math.min(3990, target.y - (30 + charge)));
      if (kind === 4) target.y = Math.max(48, Math.min(3990, target.y + (30 + charge)));
      broadcast(new Writer().u8(MSG_HIT).u16(target.uid).u8(kind).s8(c.facing).u8(charge).u8(target.health).u16(target.x).u16(target.y));
      if (kind !== 1) broadcastPosition(target);
      console.log(`[hit] ${c.name} -> ${target.name} (tipo ${kind}, carga ${charge})`);
    }

  } else if (msg === MSG_KI_CHARGE && c.name !== null && payload.length >= 2) {
    const active = payload.readUInt8(1) !== 0;
    if (c.kiCharging !== active) {
      c.kiCharging = active;
      broadcastExcept(new Writer().u8(MSG_KI_STATE).u16(c.uid).u8(active ? 1 : 0), socket);
    }

  } else if (msg === MSG_KI_FIRE && c.name !== null && payload.length >= 2) {
    const now = Date.now();
    if (c.ki < 5 || now - c.lastKiFireAt < 70) return;
    c.lastKiFireAt = now;
    c.ki -= 5;
    const forwardBlast = payload.readUInt8(1) !== 0;
    broadcastStats(c, socket);
    // Solo dispara la animación; el daño lo aplica el impacto real del proyectil (MSG_KI_HIT).
    broadcastExcept(new Writer().u8(MSG_KI_STATE).u16(c.uid).u8(forwardBlast ? 3 : 2), socket);

  } else if (msg === MSG_KI_HIT && c.name !== null && payload.length >= 3) {
    // El cliente que lanzó la onda avisa que impactó a alguien. El servidor valida y aplica daño.
    const now = Date.now();
    if (now - (c.lastKiHitAt || 0) < 60) return; // una onda golpea una sola vez
    const targetUid = payload.readUInt16LE(1);
    let target = null;
    for (const t of clients.values()) {
      if (t.name !== null && t.uid === targetUid) { target = t; break; }
    }
    if (!target || target.uid === c.uid) return;
    // Anti-trampa: el objetivo debe estar a un rango plausible del atacante.
    if (Math.hypot(target.x - c.x, target.y - c.y) > 1150) return;
    c.lastKiHitAt = now;
    applyDamage(target, 3);
    broadcast(new Writer().u8(MSG_HIT).u16(target.uid).u8(1).s8(c.facing).u8(0).u8(target.health).u16(target.x).u16(target.y));
    console.log(`[ki-hit] ${c.name} -> ${target.name} (vida ${target.health})`);

  } else if (msg === MSG_DASH && c.name !== null && payload.length >= 2) {
    const now = Date.now();
    const direction = payload.readInt8(1) < 0 ? -1 : 1;
    if (c.ki < 5 || now - c.lastDashAt < DASH_COOLDOWN_MS) return;
    c.lastDashAt = now;
    c.ki -= 5;
    c.x = Math.max(20, Math.min(3980, c.x + direction * DASH_DISTANCE));
    c.lastMovementAt = now;
    broadcastStats(c, socket);
    broadcastExcept(new Writer().u8(MSG_DASH_STATE).u16(c.uid).u16(c.x).u16(c.y).s8(direction), socket);
    broadcastPosition(c);

  } else if (msg === MSG_ACTIVITY && c.name !== null) {
    c.lastMovementAt = Date.now();
    if (c.afk) {
      c.afk = false;
      broadcast(playerListWriter());
      systemChat(`${c.name} ya no está AFK`);
      console.log(`[AFK] ${c.name} volvió a moverse`);
    }

  } else if (msg === MSG_LEAVE) {
    socket.end();
  }
}

function countPlayers() {
  return [...clients.values()].filter(c => c.name !== null).length;
}

// ---------- manejo común de conexiones (TCP y WebSocket) ----------
// 'conn' abstrae el transporte: expone write(buf), end(), destroyed y remoteAddress.
// La versión de escritorio llega por TCP; el navegador (HTML5) por WebSocket.

function newClientRecord() {
  return {
    uid: nextUid++,
    name: null,
    inbuf: Buffer.alloc(0),
    lastMovementAt: Date.now(),
    afk: false,
    kicking: false,
    x: 2000,
    y: 2000,
    facing: 1,
    lastAttackAt: 0,
    health: 100,
    ki: 0,
    kiCharging: false,
    lastKiFireAt: 0,
    lastKiHitAt: 0,
    lastDashAt: 0,
    lastInputSeq: 0
  };
}

// Acumula bytes recibidos (idéntico para TCP y WS) y procesa tramas completas.
function handleData(conn, chunk) {
  const c = clients.get(conn);
  if (!c) return;
  if (c.name === null) {
    console.log(`[debug] primeros bytes de ${conn.remoteAddress}: ${chunk.subarray(0, 24).toString('hex')}`);
  }
  c.inbuf = Buffer.concat([c.inbuf, chunk]);
  if (c.inbuf.length > 64 * 1024) { conn.end(); return; } // anti-flood

  while (c.inbuf.length >= 2) {
    const len = c.inbuf.readUInt16LE(0);
    if (c.inbuf.length < 2 + len) break;
    const payload = c.inbuf.subarray(2, 2 + len);
    c.inbuf = c.inbuf.subarray(2 + len);
    handleMessage(conn, payload);
  }
}

function disconnect(conn) {
  const c = clients.get(conn);
  if (!c) return;
  clients.delete(conn);
  if (c.name !== null) {
    console.log(`[-] ${c.name} se desconectó — ${countPlayers()} en línea`);
    broadcast(playerListWriter());
    broadcast(worldWriter());
    systemChat(`${c.name} salió del lobby`);
  }
}

// ---------- servidor TCP (versión de escritorio) ----------

const server = net.createServer(socket => {
  socket.setNoDelay(true);
  clients.set(socket, newClientRecord());
  console.log(`[~] conexión TCP desde ${socket.remoteAddress}`);
  socket.on('data', chunk => handleData(socket, chunk));
  socket.on('close', () => disconnect(socket));
  socket.on('error', () => disconnect(socket));
});

server.listen(PORT, () => {
  console.log(`Servidor TCP escuchando en el puerto ${PORT}`);
});

// ---------- servidor WebSocket (versión navegador / HTML5) ----------
// GameMaker HTML5 usa network_socket_wss: cada mensaje binario contiene los
// mismos bytes que enviaría por TCP, así que se reutiliza toda la lógica.
// nginx expone esto como wss://jugar.minecruz.com/ws/ (proxy a 127.0.0.1:WS_PORT).

const wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });

wss.on('connection', (ws, req) => {
  const conn = {
    isWs: true,
    remoteAddress: (req.socket && req.socket.remoteAddress) || 'ws',
    get destroyed() { return ws.readyState !== 1; },
    write(buf) { if (ws.readyState === 1) ws.send(buf); },
    end() { try { ws.close(); } catch (e) {} },
    destroy() { try { ws.terminate(); } catch (e) {} }
  };
  clients.set(conn, newClientRecord());
  console.log(`[~] conexión WS desde ${conn.remoteAddress}`);

  ws.on('message', data => {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    handleData(conn, chunk);
  });
  ws.on('close', () => disconnect(conn));
  ws.on('error', () => disconnect(conn));
});

wss.on('listening', () => {
  console.log(`Servidor WebSocket escuchando en 127.0.0.1:${WS_PORT}`);
});

// El servidor es la autoridad del AFK: 60 s para marcar y 20 s más para expulsar.
setInterval(() => {
  const now = Date.now();
  for (const [socket, c] of clients) {
    if (c.name === null || c.kicking || socket.destroyed) continue;
    const idleFor = now - c.lastMovementAt;

    if (!c.afk && idleFor >= AFK_AFTER_MS) {
      c.afk = true;
      broadcast(playerListWriter());
      systemChat(`${c.name} está AFK y será expulsado en 20 segundos`);
      console.log(`[AFK] ${c.name} marcado como AFK`);
    }

    if (idleFor >= KICK_AFTER_MS) {
      c.kicking = true;
      send(socket, new Writer().u8(MSG_KICK).str('Expulsado por inactividad'));
      systemChat(`${c.name} fue expulsado por inactividad`);
      console.log(`[AFK] expulsando a ${c.name}`);
      socket.end();
    }
  }
}, 1000);

// Recarga de ki autoritativa: aproximadamente un punto por frame (60/s).
setInterval(() => {
  for (const [socket, c] of clients) {
    if (c.name === null || !c.kiCharging || c.ki >= 100) continue;
    c.ki += 1;
    broadcastStats(c, socket);
  }
}, 1000 / 60);

// ---------- página de estado (detrás de nginx en prueba.minecruz.com) ----------

const started = Date.now();

http.createServer((req, res) => {
  const names = [...clients.values()].filter(c => c.name !== null).map(c => c.name);
  if (req.url === '/status.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ online: true, jugadores: names.length, nombres: names, desde: new Date(started).toISOString() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Servidor del juego</title>
<style>body{font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center}h1{color:#6f6}code{background:#222;padding:2px 8px;border-radius:6px}</style>
<main><h1>&#9679; Servidor en línea</h1>
<p>Jugadores conectados: <strong>${names.length}</strong></p>
<p>${names.map(n => `<code>${String(n).replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</code>`).join(' ') || '(nadie todavía)'}</p>
<p>Conéctate desde el juego a <code>prueba.minecruz.com:${PORT}</code></p></main></html>`);
}).listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`Página de estado en http://127.0.0.1:${HTTP_PORT}`);
});

// ---------- consola del operador (stdin) ----------
// El operador escribe comandos en la terminal donde corre el servidor.
//   say <texto>          envía un mensaje a todos como -servidor-
//   kick <nombre|uid> [motivo]   expulsa a un jugador
//   list                 muestra quién está conectado
//   help                 muestra esta ayuda
// Cualquier texto que no empiece por un comando conocido se envía como mensaje.

function printHelp() {
  console.log([
    'Comandos disponibles:',
    '  say <texto>                envía un mensaje a todos como ' + SERVER_NAME,
    '  kick <nombre|uid> [motivo] expulsa a un jugador',
    '  list                       muestra los jugadores conectados',
    '  help                       muestra esta ayuda',
    '  (cualquier otro texto se envía como mensaje de ' + SERVER_NAME + ')'
  ].join('\n'));
}

function handleConsole(line) {
  const raw = line.trim();
  if (raw === '') return;

  const space = raw.indexOf(' ');
  const cmd = (space === -1 ? raw : raw.slice(0, space)).toLowerCase();
  const rest = space === -1 ? '' : raw.slice(space + 1).trim();

  if (cmd === 'help') {
    printHelp();

  } else if (cmd === 'list') {
    const jugadores = [...clients.values()].filter(c => c.name !== null);
    if (jugadores.length === 0) {
      console.log('No hay jugadores conectados.');
    } else {
      console.log(`${jugadores.length} conectado(s):`);
      for (const c of jugadores) console.log(`  [${c.uid}] ${c.name}${c.afk ? ' (AFK)' : ''}`);
    }

  } else if (cmd === 'kick') {
    if (rest === '') { console.log('Uso: kick <nombre|uid> [motivo]'); return; }
    const sp = rest.indexOf(' ');
    const target = sp === -1 ? rest : rest.slice(0, sp);
    const reason = sp === -1 ? '' : rest.slice(sp + 1);
    if (!kickPlayer(target, reason)) console.log(`No encontré a ningún jugador "${target}".`);

  } else if (cmd === 'say') {
    if (rest === '') { console.log('Uso: say <texto>'); return; }
    systemChat(rest.slice(0, MAX_CHAT_LEN));
    console.log(`${SERVER_NAME}: ${rest}`);

  } else {
    // Texto libre: se manda como mensaje del servidor.
    systemChat(raw.slice(0, MAX_CHAT_LEN));
    console.log(`${SERVER_NAME}: ${raw}`);
  }
}

if (process.stdin.isTTY || process.env.CONSOLE === '1') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
  rl.on('line', line => handleConsole(line));
  rl.on('close', () => {});
  console.log('Consola lista. Escribe "help" para ver los comandos.');
}
