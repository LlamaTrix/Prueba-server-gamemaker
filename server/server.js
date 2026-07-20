// Servidor autoritativo, REST y autenticación para el juego de GameMaker.
//
// Protocolo (TCP raw, little-endian):
//   Cada trama = [u16 largo del payload][payload]
//   Payload    = [u8 idMensaje][...datos]
//   Los strings son UTF-8 terminados en NUL (igual que buffer_string de GameMaker).
//
// Mensajes:
//   1 MSG_JOIN         cliente -> servidor : string ticket efímero
//   2 MSG_WELCOME      servidor -> cliente : u16 uid
//   3 MSG_PLAYER_LIST  servidor -> todos   : u16 cantidad, N strings
//   4 MSG_CHAT         cliente -> servidor : string texto
//                      servidor -> todos   : string nombre, string texto

const net = require('net');
const http = require('http');
const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { AuthError, AuthStore } = require('./auth-store');

const PORT = process.env.PORT ? Number(process.env.PORT) : 6510;
const HTTP_PORT = process.env.HTTP_PORT ? Number(process.env.HTTP_PORT) : 6511;
const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 6512;
const MAX_CHAT_LEN = 200;
const SERVER_NAME = '-servidor-';
const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;
const PLAYER_MIN_X = 20;
const PLAYER_MAX_X = WORLD_WIDTH - 20;
const PLAYER_MIN_Y = 48;
const PLAYER_MAX_Y = WORLD_HEIGHT - 10;
const MOVEMENT_SPEED_PER_SECOND = 180;
const GAME_TICKET_TTL_MS = 30_000;
const AUTH_DB_PATH = process.env.AUTH_DB_PATH
  ? path.resolve(process.env.AUTH_DB_PATH)
  : path.join(__dirname, 'data', 'users.json');
const AUTH_SECRET_PATH = process.env.AUTH_SECRET_PATH
  ? path.resolve(process.env.AUTH_SECRET_PATH)
  : path.join(__dirname, 'data', 'auth-secret');

const MSG_JOIN = 1;
const MSG_WELCOME = 2;
const MSG_PLAYER_LIST = 3;
const MSG_CHAT = 4;
const MSG_ACTIVITY = 5;
const MSG_KICK = 6;
const MSG_LEAVE = 7;
const MSG_POS = 9;     // posición y dirección de un jugador
const MSG_BUBBLE = 10; // uid + texto para la burbuja de chat
const MSG_ATTACK = 11; // cliente -> servidor: u8 tipo + u8 nivel de carga
const MSG_ATTACK_STATE = 13; // servidor -> clientes: u16 atacante + u8 tipo + u8 fase
const MSG_STATS = 14;        // servidor -> clientes: u16 uid + u8 vida + u8 ki
const MSG_KI_CHARGE = 15;    // cliente -> servidor: u8 activo
const MSG_KI_FIRE = 16;      // cliente -> servidor: u8 disparo frontal
const MSG_KI_STATE = 17;     // servidor -> clientes: u16 uid + u8 estado
const MSG_DASH = 18;         // cliente -> servidor: s8 dirección lateral
const MSG_DASH_STATE = 19;   // servidor -> clientes: u16 uid + u16 x + u16 y + s8 dirección
const MSG_INPUT = 21;
const MSG_PING = 23;
const MSG_PONG = 24;
const MSG_NAME_REJECT = 25;
const MSG_SERVER_QUERY = 26;
const MSG_SERVER_INFO = 27;
const MSG_COMBAT_EVENT = 28;
const MSG_PROJECTILE_SPAWN = 29;
const MSG_PROJECTILE_DESTROY = 30;
const MSG_WORLD_STATE = 31;
const MSG_WORLD_SNAPSHOT = 32;
const MSG_GUARD = 38;        // cliente -> servidor: u8 escudo activo (1) / soltado (0)
const MSG_GUARD_STATE = 39;  // servidor -> todos: u16 uid + u8 estado (0 off, 1 on, 2 parry)
const GUARD_PARRY_MS = 83;       // primeros 5 frames: ventana de parry
const GUARD_COOLDOWN_MS = 500;   // 30 frames de espera tras soltar el escudo
const MSG_READY = 33;        // cliente -> servidor: u8 listo (1) / cancelar (0)
const MSG_LOBBY_STATE = 34;  // servidor -> todos: u8 fase + u16 segundos + lista (uid, nombre, listo, kills)
const MSG_KO_EVENT = 35;     // servidor -> todos: u16 victima + u16 asesino + str nombre + u16 kills
const MSG_RESPAWN = 36;      // servidor -> todos: u16 uid + u16 x + u16 y
const MSG_MATCH_END = 37;    // servidor -> todos: u16 uid ganador + str nombre + u16 kills
const DASH_COOLDOWN_MS = 1000;
const DASH_DISTANCE = 80;

// ---------- fases de la partida ----------
// lobby: chat + todos deben dar JUGAR -> countdown -> match (5 min, cada kill
// vale 1 punto) -> post (ganador, 3 s) -> lobby de nuevo.
const LOBBY_COUNTDOWN_MS = Number(process.env.LOBBY_COUNTDOWN_MS || 5000);
const MATCH_DURATION_MS = Number(process.env.MATCH_DURATION_MS || 300000);
const RESPAWN_MS = Number(process.env.RESPAWN_MS || 3000);
const POST_MATCH_MS = 3000;
const matchState = { phase: 'lobby', phaseEndsAt: 0, matchEndsAt: 0 };
const PHASE_BYTE = { lobby: 0, countdown: 1, match: 2, post: 3 };

const AFK_AFTER_MS = process.env.AFK_AFTER_MS ? Number(process.env.AFK_AFTER_MS) : 60_000;
const KICK_AFTER_MS = process.env.KICK_AFTER_MS ? Number(process.env.KICK_AFTER_MS) : 80_000;

let nextUid = 1;
let nextCombatEventId = 1;
let nextProjectileId = 1;
const clients = new Map(); // socket -> { uid, name, inbuf, lastMovementAt, afk }
const projectiles = new Map();
const gameTickets = new Map();

function loadOrCreateAuthSecret() {
  if (process.env.AUTH_TOKEN_SECRET) return process.env.AUTH_TOKEN_SECRET;
  fs.mkdirSync(path.dirname(AUTH_SECRET_PATH), { recursive: true });
  try {
    return fs.readFileSync(AUTH_SECRET_PATH, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generated = crypto.randomBytes(48).toString('base64url');
  try {
    fs.writeFileSync(AUTH_SECRET_PATH, `${generated}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return generated;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return fs.readFileSync(AUTH_SECRET_PATH, 'utf8').trim();
  }
}

const authStore = new AuthStore({
  filePath: AUTH_DB_PATH,
  sessionSecret: loadOrCreateAuthSecret(),
  sessionTtlSeconds: 24 * 60 * 60
});
const authReady = authStore.initialize();

function hashTicket(ticket) {
  return crypto.createHash('sha256').update(ticket, 'utf8').digest('hex');
}

function issueGameTicket(session) {
  for (const [key, record] of gameTickets) {
    if (record.accountId === session.user.id) gameTickets.delete(key);
  }
  const ticket = crypto.randomBytes(32).toString('base64url');
  gameTickets.set(hashTicket(ticket), {
    accountId: session.user.id,
    username: session.user.username,
    expiresAt: Date.now() + GAME_TICKET_TTL_MS
  });
  return ticket;
}

function consumeGameTicket(ticket) {
  if (typeof ticket !== 'string' || ticket.length < 32 || ticket.length > 128) return null;
  const key = hashTicket(ticket);
  const record = gameTickets.get(key);
  gameTickets.delete(key);
  if (!record || record.expiresAt <= Date.now()) return null;
  return record;
}

function allocateUid() {
  for (let attempt = 0; attempt < 65535; attempt++) {
    const candidate = nextUid;
    nextUid = nextUid >= 65535 ? 1 : nextUid + 1;
    let used = false;
    for (const player of clients.values()) {
      if (player.name !== null && player.uid === candidate) { used = true; break; }
    }
    if (!used) return candidate;
  }
  return 0;
}

// ---------- helpers de escritura ----------

class Writer {
  constructor() { this.parts = []; }
  u8(v)  { this.parts.push(Buffer.from([v & 0xff])); return this; }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(v)))); this.parts.push(b); return this; }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); this.parts.push(b); return this; }
  s8(v)  { const b = Buffer.alloc(1); b.writeInt8(v); this.parts.push(b); return this; }
  s16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v); this.parts.push(b); return this; }
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
  const w = new Writer().u8(MSG_WORLD_STATE).u16(players.length);
  for (const c of players) {
    w.u16(c.uid).str(c.name).u16(c.x).u16(c.y).s8(c.facing)
      .u8(c.health).u8(c.ki).u32(c.stateRevision);
  }
  return w;
}

function broadcastPosition(c) {
  broadcast(new Writer().u8(MSG_POS).u16(c.uid).u16(c.x).u16(c.y).s8(c.facing));
}

function worldSnapshotWriter() {
  const players = [...clients.values()].filter(c => c.name !== null);
  const writer = new Writer().u8(MSG_WORLD_SNAPSHOT).u16(players.length);
  for (const c of players) {
    writer.u16(c.uid).u32(c.lastInputSeq).u16(c.x).u16(c.y).s8(c.facing);
  }
  return writer;
}

function broadcastStats(c, exceptSocket = null) {
  const frame = new Writer().u8(MSG_STATS).u16(c.uid).u8(c.health).u8(c.ki).frame();
  for (const [socket, player] of clients) {
    if (socket !== exceptSocket && player.name !== null && !socket.destroyed) socket.write(frame);
  }
}

function broadcastWorldAndStats() {
  broadcast(worldWriter());
}

// ---------- lobby / partidas ----------

function randomSpawn() {
  return {
    x: 100 + Math.floor(Math.random() * (WORLD_WIDTH - 200)),
    y: 100 + Math.floor(Math.random() * (WORLD_HEIGHT - 200))
  };
}

function lobbySeconds() {
  const now = Date.now();
  if (matchState.phase === 'countdown' || matchState.phase === 'post') {
    return Math.max(0, Math.ceil((matchState.phaseEndsAt - now) / 1000));
  }
  if (matchState.phase === 'match') {
    return Math.max(0, Math.ceil((matchState.matchEndsAt - now) / 1000));
  }
  return 0;
}

function lobbyStateWriter() {
  const players = [...clients.values()].filter(c => c.name !== null);
  const w = new Writer().u8(MSG_LOBBY_STATE)
    .u8(PHASE_BYTE[matchState.phase])
    .u16(lobbySeconds())
    .u16(players.length);
  for (const c of players) w.u16(c.uid).str(c.name).u8(c.ready ? 1 : 0).u16(c.kills);
  return w;
}

function broadcastLobbyState() {
  broadcast(lobbyStateWriter());
}

// Si todos los presentes dieron JUGAR, arranca el countdown; si alguien
// cancela o entra alguien nuevo sin dar JUGAR, se vuelve al lobby.
function reevaluateLobby() {
  const players = [...clients.values()].filter(c => c.name !== null);
  const everyoneReady = players.length >= 1 && players.every(c => c.ready);
  if (matchState.phase === 'lobby' && everyoneReady) {
    matchState.phase = 'countdown';
    matchState.phaseEndsAt = Date.now() + LOBBY_COUNTDOWN_MS;
    systemChat('Todos listos: la partida comienza en ' + Math.round(LOBBY_COUNTDOWN_MS / 1000) + ' segundos');
  } else if (matchState.phase === 'countdown' && !everyoneReady) {
    matchState.phase = 'lobby';
    systemChat('Inicio cancelado: faltan jugadores por dar JUGAR');
  }
  broadcastLobbyState();
}

function respawnPlayer(c) {
  const spawn = randomSpawn();
  c.x = spawn.x;
  c.y = spawn.y;
  c.health = 100;
  c.ki = 0;
  c.dead = false;
  c.stunUntil = 0;
  c.inputDx = 0;
  c.inputDy = 0;
  c.guarding = false;
  c.guardCooldownUntil = 0;
  c.stateRevision += 1;
  broadcast(new Writer().u8(MSG_RESPAWN).u16(c.uid).u16(c.x).u16(c.y));
  broadcastStats(c);
}

function startMatch() {
  matchState.phase = 'match';
  matchState.matchEndsAt = Date.now() + MATCH_DURATION_MS;
  for (const projectile of [...projectiles.values()]) destroyProjectile(projectile, false);
  for (const c of clients.values()) {
    if (c.name === null) continue;
    c.kills = 0;
    // El tiempo quieto en el lobby no cuenta como inactividad de la partida.
    c.lastMovementAt = Date.now();
    c.afk = false;
    respawnPlayer(c);
  }
  broadcastWorldAndStats();
  broadcastLobbyState();
  systemChat('¡Comienza la partida! 5 minutos, cada kill vale 1 punto');
  console.log('[match] partida iniciada');
}

function endMatch() {
  const players = [...clients.values()].filter(c => c.name !== null);
  let winner = null;
  for (const c of players) {
    if (winner === null || c.kills > winner.kills) winner = c;
  }
  matchState.phase = 'post';
  matchState.phaseEndsAt = Date.now() + POST_MATCH_MS;
  if (winner) {
    broadcast(new Writer().u8(MSG_MATCH_END).u16(winner.uid).str(winner.name).u16(winner.kills));
    systemChat('Ganador: ' + winner.name + ' con ' + winner.kills + ' puntos');
    console.log(`[match] fin — ganador ${winner.name} (${winner.kills} kills)`);
  }
  broadcastLobbyState();
}

function backToLobby() {
  matchState.phase = 'lobby';
  for (const c of clients.values()) {
    if (c.name === null) continue;
    c.ready = false;
    c.dead = false;
    c.health = 100;
    c.ki = 0;
    c.stateRevision += 1;
  }
  broadcastWorldAndStats();
  broadcastLobbyState();
  systemChat('De vuelta en el lobby: den JUGAR para otra partida');
}

function commitCombatEvent(attacker, target, kind, damage, charge) {
  const now = Date.now();

  // Parry: golpeado dentro de los primeros 5 frames del escudo -> sin daño,
  // el escudo se consume y todos ven la onda del parry.
  if (target.guarding && now - target.guardStartAt <= GUARD_PARRY_MS) {
    target.guarding = false;
    target.guardCooldownUntil = now + GUARD_COOLDOWN_MS;
    broadcast(new Writer().u8(MSG_GUARD_STATE).u16(target.uid).u8(2));
    console.log(`[parry] ${target.name} bloqueo el golpe de ${attacker.name}`);
    return 0;
  }

  // Escudo activo: recibe la mitad del daño.
  if (target.guarding) damage = Math.max(1, Math.ceil(damage / 2));

  const oldX = target.x;
  const oldY = target.y;
  target.health = Math.max(0, target.health - Math.max(0, damage));
  target.stateRevision += 1;
  target.inputDx = 0;
  target.inputDy = 0;
  if (target.kiCharging) {
    target.kiCharging = false;
    broadcast(new Writer().u8(MSG_KI_STATE).u16(target.uid).u8(0));
  }

  // Empuje de los golpes fuertes (kinds 2/3/4): distancia base + bono por carga.
  const push = 100 + charge * 15;
  if (kind === 2) target.x = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, target.x + attacker.facing * push));
  if (kind === 3) target.y = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_MAX_Y, target.y - push));
  if (kind === 4) target.y = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_MAX_Y, target.y + push));

  const eventId = nextCombatEventId++;
  if (nextCombatEventId > 0xffffffff) nextCombatEventId = 1;
  broadcast(new Writer()
    .u8(MSG_COMBAT_EVENT).u32(eventId)
    .u16(attacker.uid).u16(target.uid)
    .u32(target.stateRevision).u8(kind).u8(damage).u8(target.health).u8(target.ki)
    .s8(attacker.facing).u8(charge)
    .s16(Math.round(target.x - oldX)).s16(Math.round(target.y - oldY))
    .u16(target.x).u16(target.y));
  if (kind >= 2 && kind <= 4) broadcastPosition(target);
  target.stunUntil = Date.now() + (kind === 1 ? 200 : 300);

  // KO: el atacante gana 1 punto y la victima reaparece en 3 segundos.
  if (target.health <= 0 && !target.dead && matchState.phase === 'match') {
    target.dead = true;
    target.respawnAt = Date.now() + RESPAWN_MS;
    target.inputDx = 0;
    target.inputDy = 0;
    attacker.kills += 1;
    broadcast(new Writer().u8(MSG_KO_EVENT).u16(target.uid).u16(attacker.uid)
      .str(attacker.name).u16(attacker.kills));
    systemChat(attacker.name + ' elimino a ' + target.name);
    broadcastLobbyState();
    console.log(`[kill] ${attacker.name} -> ${target.name} (${attacker.kills} kills)`);
  }
  return eventId;
}

function findAttackTarget(attacker, kind) {
  // Hitbox ovalada centrada en el atacante con un sesgo leve hacia adelante.
  // Con el sesgo grande anterior (22px) y radios chicos, un rival a 27px
  // podia quedar fuera y el golpe fallaba aun estando pegados.
  const cx = attacker.x + attacker.facing * 10;
  const cy = attacker.y;
  const rx = 60; // semieje horizontal
  const ry = 40; // semieje vertical
  let best = null;
  let bestScore = Infinity;

  for (const candidate of clients.values()) {
    if (candidate.name === null || candidate.uid === attacker.uid || candidate.dead) continue;
    const nx = (candidate.x - cx) / rx;
    const ny = (candidate.y - cy) / ry;
    const score = nx * nx + ny * ny; // <= 1 dentro de la elipse
    if (score <= 1 && score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

// Rival más cercano a un jugador (para diagnosticar golpes fallados).
function nearestOpponent(c) {
  let nd = Infinity, nn = null;
  for (const o of clients.values()) {
    if (o.name === null || o.uid === c.uid) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < nd) { nd = d; nn = o.name; }
  }
  return { name: nn, dist: nd };
}

function spawnProjectile(owner) {
  const projectile = {
    id: nextProjectileId++, owner,
    x: owner.x + owner.facing * 52,
    y: owner.y - 50,
    vx: owner.facing * 6,
    direction: owner.facing,
    life: 180
  };
  if (nextProjectileId > 0xffffffff) nextProjectileId = 1;
  projectiles.set(projectile.id, projectile);
  broadcast(new Writer().u8(MSG_PROJECTILE_SPAWN).u32(projectile.id)
    .u16(owner.uid).u16(projectile.x).u16(projectile.y).s8(projectile.direction));
}

function destroyProjectile(projectile, hit) {
  if (!projectiles.delete(projectile.id)) return;
  broadcast(new Writer().u8(MSG_PROJECTILE_DESTROY).u32(projectile.id)
    .u16(projectile.x).u16(projectile.y).u8(hit ? 1 : 0));
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

  if (msg === MSG_SERVER_QUERY) {
    send(socket, new Writer().u8(MSG_SERVER_INFO).u16(countPlayers()).str('Servidor principal'));

  } else if (msg === MSG_JOIN && c.name === null) {
    const r = readString(payload, 1);
    if (!r) return;
    const identity = consumeGameTicket(r.value);
    if (!identity) {
      send(socket, new Writer().u8(MSG_NAME_REJECT).str('El ticket de juego es inválido o venció'));
      socket.end();
      return;
    }
    const duplicate = [...clients.values()].some(other => other !== c && other.name !== null
      && other.accountId === identity.accountId);
    if (duplicate) {
      send(socket, new Writer().u8(MSG_NAME_REJECT).str('Esta cuenta ya está dentro de la partida'));
      socket.end();
      return;
    }
    c.uid = allocateUid();
    if (c.uid === 0) {
      send(socket, new Writer().u8(MSG_KICK).str('El servidor está lleno'));
      socket.end();
      return;
    }
    c.accountId = identity.accountId;
    c.name = identity.username;
    c.x = 100 + Math.floor(Math.random() * (WORLD_WIDTH - 200));
    c.y = 100 + Math.floor(Math.random() * (WORLD_HEIGHT - 200));
    c.facing = 1;
    c.lastMovementAt = Date.now();

    c.ready = false;
    c.kills = 0;
    c.dead = false;

    send(socket, new Writer().u8(MSG_WELCOME).u16(c.uid).u16(c.x).u16(c.y));
    broadcast(playerListWriter());
    broadcastWorldAndStats();
    systemChat(`${c.name} entró al lobby`);
    console.log(`[+] ${c.name} (uid ${c.uid}) entró — ${countPlayers()} en línea`);
    // Entrar sin dar JUGAR cancela un countdown en curso; en partida entra directo.
    if (matchState.phase === 'countdown') reevaluateLobby();
    else broadcastLobbyState();

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
    if (Date.now() >= c.stunUntil && !c.guarding) {
      c.inputDx = dx;
      c.inputDy = dy;
    } else {
      c.inputDx = 0;
      c.inputDy = 0;
    }
    c.lastInputAt = Date.now();
    if (dx !== 0 || dy !== 0) c.lastMovementAt = Date.now();
    if (c.afk) {
      c.afk = false;
      broadcast(playerListWriter());
      systemChat(`${c.name} ya no está AFK`);
    }
  } else if (msg === MSG_POS && c.name !== null) {
    // Compatibilidad: las posiciones enviadas por clientes ya no son autoridad.
    return;

  } else if (msg === MSG_PING && c.name !== null && payload.length >= 5) {
    send(socket, new Writer().u8(MSG_PONG).u32(payload.readUInt32LE(1)));

  } else if (msg === MSG_GUARD && c.name !== null && payload.length >= 2) {
    const now = Date.now();
    const wantsGuard = payload.readUInt8(1) !== 0;
    if (wantsGuard) {
      if (matchState.phase !== 'match' || c.dead || c.guarding) return;
      if (now < c.guardCooldownUntil || now < c.stunUntil) return;
      c.guarding = true;
      c.guardStartAt = now;
      c.inputDx = 0;
      c.inputDy = 0;
      c.lastMovementAt = now;
      broadcastExcept(new Writer().u8(MSG_GUARD_STATE).u16(c.uid).u8(1), socket);
    } else if (c.guarding) {
      c.guarding = false;
      c.guardCooldownUntil = now + GUARD_COOLDOWN_MS;
      broadcastExcept(new Writer().u8(MSG_GUARD_STATE).u16(c.uid).u8(0), socket);
    }

  } else if (msg === MSG_READY && c.name !== null && payload.length >= 2) {
    if (matchState.phase !== 'lobby' && matchState.phase !== 'countdown') return;
    const wantsReady = payload.readUInt8(1) !== 0;
    if (c.ready !== wantsReady) {
      c.ready = wantsReady;
      console.log(`[lobby] ${c.name} ${wantsReady ? 'esta listo' : 'cancelo'}`);
      reevaluateLobby();
    }

  } else if (msg === MSG_ATTACK && c.name !== null && payload.length >= 8) {
    const now = Date.now();
    if (matchState.phase !== 'match' || c.dead || c.guarding) return;
    if (now < c.stunUntil) return;

    const kind = payload.readUInt8(1);
    if (kind < 1 || kind > 4) return;
    let charge = Math.min(3, payload.readUInt8(2));
    const comboStage = payload.length >= 4 ? Math.min(3, payload.readUInt8(3)) : 0;
    const actionSequence = payload.readUInt32LE(4);
    if (actionSequence <= c.lastCombatAction) return;
    if (now - c.lastAttackAt < 100) return;
    c.lastCombatAction = actionSequence;
    c.lastAttackAt = now;
    if (kind === 1 || kind === 2) charge = 0;

    // Todos ven la animación del atacante, incluso cuando el golpe no alcanza a nadie.
    broadcastExcept(new Writer().u8(MSG_ATTACK_STATE).u16(c.uid).u8(kind).u8(comboStage), socket);

    const target = findAttackTarget(c, kind);
    if (target) {
      const damage = kind === 1 ? 3 : 5 + charge;
      const eventId = commitCombatEvent(c, target, kind, damage, charge);
      if (eventId !== 0) console.log(`[hit] ${c.name} -> ${target.name} tipo ${kind} dmg ${damage} vida ${target.health}`);
    } else {
      const near = nearestOpponent(c);
      console.log(`[miss] ${c.name} (${Math.round(c.x)},${Math.round(c.y)} f${c.facing}) atacó tipo ${kind}; rival más cercano ${near.name || 'ninguno'} a ${Number.isFinite(near.dist) ? Math.round(near.dist) : '-'}px`);
    }

  } else if (msg === MSG_KI_CHARGE && c.name !== null && payload.length >= 2) {
    const active = payload.readUInt8(1) !== 0;
    if (c.kiCharging !== active) {
      c.kiCharging = active;
      broadcastExcept(new Writer().u8(MSG_KI_STATE).u16(c.uid).u8(active ? 1 : 0), socket);
    }

  } else if (msg === MSG_KI_FIRE && c.name !== null && payload.length >= 2) {
    const now = Date.now();
    if (matchState.phase !== 'match' || c.dead) return;
    if (now < c.stunUntil) return;
    if (c.ki < 5 || now - c.lastKiFireAt < 70) return;
    c.lastKiFireAt = now;
    c.ki -= 5;
    const forwardBlast = payload.readUInt8(1) !== 0;
    broadcastStats(c);
    // La simulación y el impacto del proyectil viven completamente en el servidor.
    broadcastExcept(new Writer().u8(MSG_KI_STATE).u16(c.uid).u8(forwardBlast ? 3 : 2), socket);
    spawnProjectile(c);

  } else if (msg === MSG_DASH && c.name !== null && payload.length >= 2) {
    const now = Date.now();
    if (matchState.phase !== 'match' || c.dead) return;
    if (now < c.stunUntil) return;
    const direction = payload.readInt8(1) < 0 ? -1 : 1;
    if (c.ki < 5 || now - c.lastDashAt < DASH_COOLDOWN_MS) return;
    c.lastDashAt = now;
    c.ki -= 5;
    c.x = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, c.x + direction * DASH_DISTANCE));
    c.lastMovementAt = now;
    broadcastStats(c);
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
    uid: 0,
    accountId: null,
    name: null,
    inbuf: Buffer.alloc(0),
    connectedAt: Date.now(),
    lastMovementAt: Date.now(),
    afk: false,
    kicking: false,
    x: 2000,
    y: 2000,
    facing: 1,
    lastAttackAt: 0,
    lastCombatAction: 0,
    health: 100,
    stateRevision: 1,
    ki: 0,
    kiCharging: false,
    lastKiFireAt: 0,
    lastDashAt: 0,
    stunUntil: 0,
    lastInputSeq: 0,
    lastInputAt: 0,
    inputDx: 0,
    inputDy: 0,
    ready: false,
    kills: 0,
    dead: false,
    respawnAt: 0,
    guarding: false,
    guardStartAt: 0,
    guardCooldownUntil: 0
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
  for (const projectile of [...projectiles.values()]) {
    if (projectile.owner === c) destroyProjectile(projectile, false);
  }
  if (c.name !== null) {
    console.log(`[-] ${c.name} se desconectó — ${countPlayers()} en línea`);
    broadcast(playerListWriter());
    broadcastWorldAndStats();
    systemChat(`${c.name} salió del lobby`);
    // Su salida puede completar el "todos listos" o vaciar la partida.
    if (matchState.phase === 'lobby' || matchState.phase === 'countdown') reevaluateLobby();
    else if (countPlayers() === 0) { matchState.phase = 'lobby'; }
    else broadcastLobbyState();
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

// Movimiento autoritativo por tiempo: la velocidad ya no depende de cuántos
// paquetes mande el cliente ni de su FPS. Los snapshots completos salen a 20 Hz.
let lastMovementTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const elapsedSeconds = Math.min(0.05, Math.max(0, now - lastMovementTick) / 1000);
  lastMovementTick = now;
  for (const c of clients.values()) {
    if (c.name === null || c.dead || now < c.stunUntil) continue;
    if (now - c.lastInputAt > 750) {
      c.inputDx = 0;
      c.inputDy = 0;
    }
    const length = Math.hypot(c.inputDx, c.inputDy);
    if (length <= 0) continue;
    const distance = MOVEMENT_SPEED_PER_SECOND * elapsedSeconds;
    const oldX = c.x;
    const oldY = c.y;
    c.x = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, c.x + c.inputDx / length * distance));
    c.y = Math.max(PLAYER_MIN_Y, Math.min(PLAYER_MAX_Y, c.y + c.inputDy / length * distance));
    if (c.x !== oldX || c.y !== oldY) c.lastMovementAt = now;
  }
}, 1000 / 60);

setInterval(() => {
  if (countPlayers() > 0) broadcast(worldSnapshotWriter());
}, 50);

// Transiciones de fase y reapariciones, una vez por segundo.
setInterval(() => {
  const now = Date.now();
  if (matchState.phase === 'countdown' && now >= matchState.phaseEndsAt) {
    startMatch();
  } else if (matchState.phase === 'match') {
    for (const c of clients.values()) {
      if (c.name !== null && c.dead && now >= c.respawnAt) respawnPlayer(c);
    }
    if (now >= matchState.matchEndsAt) endMatch();
  } else if (matchState.phase === 'post' && now >= matchState.phaseEndsAt) {
    backToLobby();
  }
  if (countPlayers() > 0) {
    broadcastLobbyState();
    // Difusion periodica de vida/ki: aunque un evento de combate se pierda,
    // todos los clientes convergen al estado real en un segundo como maximo.
    for (const c of clients.values()) {
      if (c.name !== null) broadcastStats(c);
    }
  }
}, 1000);

// El servidor es la autoridad del AFK: 60 s para marcar y 20 s más para expulsar.
// Solo aplica durante la partida; en el lobby se puede estar quieto chateando.
setInterval(() => {
  const now = Date.now();
  for (const [socket, c] of clients) {
    if (c.name === null) {
      if (now - c.connectedAt >= 15_000) socket.end();
      continue;
    }
    if (matchState.phase !== 'match') continue;
    if (c.kicking || socket.destroyed) continue;
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

// Proyectiles de ki autoritativos a 60 ticks/s. El cliente sólo los dibuja.
setInterval(() => {
  for (const projectile of [...projectiles.values()]) {
    projectile.x += projectile.vx;
    projectile.life -= 1;
    let hitTarget = null;
    let bestDistance = Infinity;
    for (const target of clients.values()) {
      if (target.name === null || target.uid === projectile.owner.uid || target.dead) continue;
      const distance = Math.hypot(target.x - projectile.x, (target.y - 40) - projectile.y);
      if (distance <= 28 && distance < bestDistance) {
        hitTarget = target;
        bestDistance = distance;
      }
    }
    if (hitTarget) {
      commitCombatEvent(projectile.owner, hitTarget, 1, 3, 0);
      destroyProjectile(projectile, true);
    } else if (projectile.life <= 0 || projectile.x < -32 || projectile.x > WORLD_WIDTH + 32) {
      destroyProjectile(projectile, false);
    }
  }
}, 1000 / 60);

// Recarga de ki autoritativa: aproximadamente un punto por frame (60/s).
setInterval(() => {
  for (const [socket, c] of clients) {
    if (c.name === null || !c.kiCharging || c.ki >= 100) continue;
    c.ki += 1;
    broadcastStats(c, socket);
  }
}, 1000 / 60);

// ---------- REST de autenticación, lista de servidores y estado ----------

const started = Date.now();
const allowedOrigins = new Set((process.env.CORS_ORIGINS
  || 'https://jugar.minecruz.com,http://localhost,http://127.0.0.1')
  .split(',').map(value => value.trim()).filter(Boolean));
const authRateLimits = new Map();

function isAllowedOrigin(origin) {
  return allowedOrigins.has(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(origin));
}

function requestAddress(req) {
  const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || '')
    .split(',')[0].trim();
}

function applyApiHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(req, res, status, body) {
  applyApiHeaders(req, res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    throw new AuthError('UNSUPPORTED_MEDIA_TYPE', 'Se requiere Content-Type application/json.', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new AuthError('BODY_TOO_LARGE', 'La solicitud es demasiado grande.', 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AuthError('INVALID_JSON', 'El cuerpo JSON no es válido.', 400);
  }
}

function allowAuthAttempt(req) {
  const now = Date.now();
  const key = requestAddress(req);
  let bucket = authRateLimits.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + 10 * 60_000 };
  bucket.count += 1;
  authRateLimits.set(key, bucket);
  return bucket.count <= 20;
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!match) throw new AuthError('AUTH_REQUIRED', 'Debes iniciar sesión.', 401);
  return match[1];
}

async function handleHttp(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const names = [...clients.values()].filter(c => c.name !== null).map(c => c.name);

  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      sendJson(req, res, 403, { ok: false, error: 'Origen no permitido.' });
      return;
    }
    applyApiHeaders(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/') && req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
    sendJson(req, res, 403, { ok: false, error: 'Origen no permitido.' });
    return;
  }

  try {
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      if (!allowAuthAttempt(req)) throw new AuthError('RATE_LIMIT', 'Demasiados intentos. Espera unos minutos.', 429);
      await authReady;
      const body = await readJsonBody(req);
      await authStore.register({ username: body.username, password: body.password });
      const session = await authStore.login({ username: body.username, password: body.password });
      sendJson(req, res, 201, { ok: true, token: session.token, expiresAt: session.expiresAt, user: session.user });
      return;
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!allowAuthAttempt(req)) throw new AuthError('RATE_LIMIT', 'Demasiados intentos. Espera unos minutos.', 429);
      await authReady;
      const body = await readJsonBody(req);
      const session = await authStore.login({ username: body.username, password: body.password });
      sendJson(req, res, 200, { ok: true, token: session.token, expiresAt: session.expiresAt, user: session.user });
      return;
    }

    if (url.pathname === '/api/servers' && req.method === 'GET') {
      sendJson(req, res, 200, {
        ok: true,
        servers: [{
          id: 'principal', name: 'Servidor principal', online: true,
          players: names.length, tcpHost: 'prueba.minecruz.com', tcpPort: PORT,
          wsUrl: 'wss://jugar.minecruz.com/ws/', wsPort: 443
        }]
      });
      return;
    }

    if (url.pathname === '/api/game-ticket' && req.method === 'POST') {
      await authReady;
      const session = await authStore.verifySession(bearerToken(req));
      const body = await readJsonBody(req);
      if (body.serverId !== 'principal') throw new AuthError('SERVER_NOT_FOUND', 'Servidor no encontrado.', 404);
      sendJson(req, res, 201, {
        ok: true,
        ticket: issueGameTicket(session),
        expiresIn: Math.floor(GAME_TICKET_TTL_MS / 1000)
      });
      return;
    }

    if (url.pathname === '/status.json' && req.method === 'GET') {
      sendJson(req, res, 200, {
        online: true, jugadores: names.length, nombres: names,
        desde: new Date(started).toISOString()
      });
      return;
    }

    if (url.pathname !== '/' || req.method !== 'GET') {
      sendJson(req, res, 404, { ok: false, error: 'Ruta no encontrada.' });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Servidor del juego</title>
<style>body{font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center}h1{color:#6f6}code{background:#222;padding:2px 8px;border-radius:6px}</style>
<main><h1>&#9679; Servidor en línea</h1>
<p>Jugadores conectados: <strong>${names.length}</strong></p>
<p>${names.map(n => `<code>${String(n).replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</code>`).join(' ') || '(nadie todavía)'}</p>
<p>API REST y servidor de juego activos.</p></main></html>`);
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(req, res, error.status, { ok: false, code: error.code, error: error.message });
      return;
    }
    console.error('[http]', error);
    sendJson(req, res, 500, { ok: false, error: 'Error interno del servidor.' });
  }
}

http.createServer((req, res) => {
  handleHttp(req, res).catch(error => {
    console.error('[http fatal]', error);
    if (!res.headersSent) sendJson(req, res, 500, { ok: false, error: 'Error interno del servidor.' });
    else res.destroy();
  });
}).listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`REST/estado en http://127.0.0.1:${HTTP_PORT}`);
});

authReady.then(() => {
  console.log(`Base documental de usuarios lista: ${AUTH_DB_PATH}`);
}).catch(error => {
  console.error('No se pudo abrir la base de autenticación:', error);
  process.exit(1);
});

setInterval(() => {
  const now = Date.now();
  for (const [key, ticket] of gameTickets) if (ticket.expiresAt <= now) gameTickets.delete(key);
  for (const [key, bucket] of authRateLimits) if (bucket.resetAt <= now) authRateLimits.delete(key);
}, 30_000);

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
