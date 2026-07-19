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

const PORT = process.env.PORT ? Number(process.env.PORT) : 6510;
const HTTP_PORT = process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 6511;
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
const MSG_HIT = 12;    // servidor -> clientes: u16 objetivo + u8 tipo + s8 dirección + u8 carga

const AFK_AFTER_MS = process.env.AFK_AFTER_MS ? Number(process.env.AFK_AFTER_MS) : 60_000;
const KICK_AFTER_MS = process.env.KICK_AFTER_MS ? Number(process.env.KICK_AFTER_MS) : 80_000;

let nextUid = 1;
const clients = new Map(); // socket -> { uid, name, inbuf, lastMovementAt, afk }

// ---------- helpers de escritura ----------

class Writer {
  constructor() { this.parts = []; }
  u8(v)  { this.parts.push(Buffer.from([v & 0xff])); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.parts.push(b); return this; }
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
    if (name === '') name = 'Jugador' + c.uid;
    c.name = name;
    c.x = 100 + Math.floor(Math.random() * 3801);
    c.y = 100 + Math.floor(Math.random() * 3801);
    c.facing = 1;
    c.lastMovementAt = Date.now();

    send(socket, new Writer().u8(MSG_WELCOME).u16(c.uid).u16(c.x).u16(c.y));
    broadcast(playerListWriter());
    broadcast(worldWriter());
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

  } else if (msg === MSG_POS && c.name !== null && payload.length >= 6) {
    c.x = Math.max(20, Math.min(3980, payload.readUInt16LE(1)));
    c.y = Math.max(48, Math.min(3990, payload.readUInt16LE(3)));
    c.facing = payload.readInt8(5) < 0 ? -1 : 1;
    c.lastMovementAt = Date.now();
    if (c.afk) {
      c.afk = false;
      broadcast(playerListWriter());
      systemChat(`${c.name} ya no está AFK`);
    }
    broadcastPosition(c);

  } else if (msg === MSG_ATTACK && c.name !== null && payload.length >= 3) {
    const now = Date.now();
    if (now - c.lastAttackAt < 100) return;
    c.lastAttackAt = now;

    const kind = payload.readUInt8(1);
    if (kind < 1 || kind > 4) return;
    let charge = Math.min(3, payload.readUInt8(2));
    if (kind === 1 || kind === 2) charge = 0;

    const target = findAttackTarget(c, kind);
    if (target) {
      broadcast(new Writer().u8(MSG_HIT).u16(target.uid).u8(kind).s8(c.facing).u8(charge));
      console.log(`[hit] ${c.name} -> ${target.name} (tipo ${kind}, carga ${charge})`);
    }

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

// ---------- servidor TCP ----------

const server = net.createServer(socket => {
  socket.setNoDelay(true);
  clients.set(socket, {
    uid: nextUid++,
    name: null,
    inbuf: Buffer.alloc(0),
    lastMovementAt: Date.now(),
    afk: false,
    kicking: false,
    x: 2000,
    y: 2000,
    facing: 1,
    lastAttackAt: 0
  });
  console.log(`[~] conexión desde ${socket.remoteAddress}`);

  socket.on('data', chunk => {
    const c = clients.get(socket);
    if (!c) return;
    if (c.name === null) {
      console.log(`[debug] primeros bytes de ${socket.remoteAddress}: ${chunk.subarray(0, 24).toString('hex')}`);
    }
    c.inbuf = Buffer.concat([c.inbuf, chunk]);
    if (c.inbuf.length > 64 * 1024) { socket.destroy(); return; } // anti-flood

    while (c.inbuf.length >= 2) {
      const len = c.inbuf.readUInt16LE(0);
      if (c.inbuf.length < 2 + len) break;
      const payload = c.inbuf.subarray(2, 2 + len);
      c.inbuf = c.inbuf.subarray(2 + len);
      handleMessage(socket, payload);
    }
  });

  const bye = () => {
    const c = clients.get(socket);
    if (!c) return;
    clients.delete(socket);
    if (c.name !== null) {
      console.log(`[-] ${c.name} se desconectó — ${countPlayers()} en línea`);
      broadcast(playerListWriter());
      broadcast(worldWriter());
      systemChat(`${c.name} salió del lobby`);
    }
  };
  socket.on('close', bye);
  socket.on('error', bye);
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
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

// ---------- página de estado (detrás de nginx en prueba.minecruz.com) ----------

const started = Date.now();

http.createServer((req, res) => {
  const names = [...clients.values()].filter(c => c.name !== null).map(c => c.name);
  if (req.url === '/status.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
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
