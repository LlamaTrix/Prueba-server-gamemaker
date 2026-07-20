'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Worker } = require('node:worker_threads');

const MSG_JOIN = 1;
const MSG_WELCOME = 2;
const MSG_POS = 9;
const MSG_ATTACK = 11;
const MSG_STATS = 14;
const MSG_KI_CHARGE = 15;
const MSG_KI_FIRE = 16;
const MSG_INPUT = 21;
const MSG_NAME_REJECT = 25;
const MSG_COMBAT_EVENT = 28;
const MSG_PROJECTILE_SPAWN = 29;
const MSG_PROJECTILE_DESTROY = 30;
const MSG_WORLD_STATE = 31;
const MSG_WORLD_SNAPSHOT = 32;
const MSG_READY = 33;
const MSG_LOBBY_STATE = 34;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function freePort(used) {
  while (true) {
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const selected = probe.address().port;
        probe.close(error => error ? reject(error) : resolve(selected));
      });
    });
    if (!used.has(port)) {
      used.add(port);
      return port;
    }
  }
}

function frame(payload) {
  const header = Buffer.allocUnsafe(2);
  header.writeUInt16LE(payload.length);
  return Buffer.concat([header, payload]);
}

function cString(value) {
  return Buffer.concat([Buffer.from(value, 'utf8'), Buffer.from([0])]);
}

function readCString(payload, offset) {
  const end = payload.indexOf(0, offset);
  assert.notEqual(end, -1, 'string del protocolo sin terminador NUL');
  return { value: payload.toString('utf8', offset, end), next: end + 1 };
}

function parseWelcome(payload) {
  assert.equal(payload.length, 7, 'MSG_WELCOME debe contener uid, x e y');
  return {
    uid: payload.readUInt16LE(1),
    x: payload.readUInt16LE(3),
    y: payload.readUInt16LE(5),
  };
}

function parseWorldState(payload) {
  let offset = 1;
  const count = payload.readUInt16LE(offset);
  offset += 2;
  const players = [];
  for (let index = 0; index < count; index += 1) {
    const uid = payload.readUInt16LE(offset);
    offset += 2;
    const name = readCString(payload, offset);
    offset = name.next;
    const player = {
      uid,
      name: name.value,
      x: payload.readUInt16LE(offset),
      y: payload.readUInt16LE(offset + 2),
      facing: payload.readInt8(offset + 4),
      health: payload.readUInt8(offset + 5),
      ki: payload.readUInt8(offset + 6),
      revision: payload.readUInt32LE(offset + 7),
    };
    offset += 11;
    players.push(player);
  }
  assert.equal(offset, payload.length, 'MSG_WORLD_STATE tiene bytes sobrantes o truncados');
  return players;
}

function parseWorldSnapshot(payload) {
  let offset = 1;
  const count = payload.readUInt16LE(offset);
  offset += 2;
  const players = [];
  for (let index = 0; index < count; index += 1) {
    players.push({
      uid: payload.readUInt16LE(offset),
      acknowledgedInput: payload.readUInt32LE(offset + 2),
      x: payload.readUInt16LE(offset + 6),
      y: payload.readUInt16LE(offset + 8),
      facing: payload.readInt8(offset + 10),
    });
    offset += 11;
  }
  assert.equal(offset, payload.length, 'MSG_WORLD_SNAPSHOT tiene bytes sobrantes o truncados');
  return players;
}

function parseCombatEvent(payload) {
  assert.equal(payload.length, 27, 'MSG_COMBAT_EVENT debe medir exactamente 27 bytes');
  return {
    eventId: payload.readUInt32LE(1),
    attackerUid: payload.readUInt16LE(5),
    targetUid: payload.readUInt16LE(7),
    targetRevision: payload.readUInt32LE(9),
    kind: payload.readUInt8(13),
    damage: payload.readUInt8(14),
    healthAfter: payload.readUInt8(15),
    kiAfter: payload.readUInt8(16),
    attackerFacing: payload.readInt8(17),
    charge: payload.readUInt8(18),
    pushX: payload.readInt16LE(19),
    pushY: payload.readInt16LE(21),
    targetX: payload.readUInt16LE(23),
    targetY: payload.readUInt16LE(25),
  };
}

class GameClient {
  constructor(port) {
    this.port = port;
    this.socket = null;
    this.incoming = Buffer.alloc(0);
    this.messages = [];
    this.waiters = new Set();
    this.positions = new Map();
    this.inputSequence = 0;
  }

  async connect() {
    this.socket = net.createConnection({ host: '127.0.0.1', port: this.port });
    this.socket.setNoDelay(true);
    this.socket.on('data', chunk => this.#onData(chunk));
    this.socket.on('close', () => this.#wakeWaiters());
    this.socket.on('error', () => this.#wakeWaiters());
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    return this;
  }

  mark() {
    return this.messages.length;
  }

  send(payload) {
    assert(this.socket && !this.socket.destroyed, 'cliente TCP cerrado');
    this.socket.write(frame(payload));
  }

  join(ticket) {
    this.send(Buffer.concat([Buffer.from([MSG_JOIN]), cString(ticket)]));
  }

  input(dx, dy, facing) {
    this.inputSequence += 1;
    const payload = Buffer.alloc(8);
    payload.writeUInt8(MSG_INPUT, 0);
    payload.writeUInt32LE(this.inputSequence, 1);
    payload.writeInt8(dx, 5);
    payload.writeInt8(dy, 6);
    payload.writeInt8(facing, 7);
    this.send(payload);
  }

  attack(kind, actionSequence, charge = 0, comboStage = 0) {
    const payload = Buffer.alloc(8);
    payload.writeUInt8(MSG_ATTACK, 0);
    payload.writeUInt8(kind, 1);
    payload.writeUInt8(charge, 2);
    payload.writeUInt8(comboStage, 3);
    payload.writeUInt32LE(actionSequence, 4);
    this.send(payload);
  }

  chargeKi(active) {
    this.send(Buffer.from([MSG_KI_CHARGE, active ? 1 : 0]));
  }

  ready(active) {
    this.send(Buffer.from([MSG_READY, active ? 1 : 0]));
  }

  fireKi(forward = false) {
    this.send(Buffer.from([MSG_KI_FIRE, forward ? 1 : 0]));
  }

  async waitFor(predicate, { after = 0, timeout = 5000, description = 'mensaje' } = {}) {
    const find = () => {
      for (let index = after; index < this.messages.length; index += 1) {
        if (predicate(this.messages[index], index)) return this.messages[index];
      }
      return null;
    };
    const existing = find();
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const waiter = { find, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`timeout esperando ${description}`));
      }, timeout);
      this.waiters.add(waiter);
      this.#wakeWaiters();
    });
  }

  messagesAfter(after, messageId) {
    return this.messages.slice(after).filter(payload => payload[0] === messageId);
  }

  async close() {
    if (!this.socket || this.socket.destroyed) return;
    const closed = new Promise(resolve => this.socket.once('close', resolve));
    this.socket.end();
    await Promise.race([closed, delay(500)]);
    if (!this.socket.destroyed) this.socket.destroy();
  }

  #onData(chunk) {
    this.incoming = Buffer.concat([this.incoming, chunk]);
    while (this.incoming.length >= 2) {
      const length = this.incoming.readUInt16LE(0);
      if (this.incoming.length < length + 2) break;
      const payload = Buffer.from(this.incoming.subarray(2, length + 2));
      this.incoming = this.incoming.subarray(length + 2);
      this.messages.push(payload);
      this.#trackPositions(payload);
    }
    this.#wakeWaiters();
  }

  #trackPositions(payload) {
    if (payload[0] === MSG_WORLD_SNAPSHOT) {
      for (const player of parseWorldSnapshot(payload)) this.positions.set(player.uid, player);
    } else if (payload[0] === MSG_WORLD_STATE) {
      for (const player of parseWorldState(payload)) this.positions.set(player.uid, player);
    } else if (payload[0] === MSG_POS && payload.length === 8) {
      this.positions.set(payload.readUInt16LE(1), {
        uid: payload.readUInt16LE(1),
        x: payload.readUInt16LE(3),
        y: payload.readUInt16LE(5),
        facing: payload.readInt8(7),
      });
    } else if (payload[0] === MSG_COMBAT_EVENT && payload.length === 27) {
      const event = parseCombatEvent(payload);
      const previous = this.positions.get(event.targetUid) || {};
      this.positions.set(event.targetUid, {
        ...previous,
        uid: event.targetUid,
        x: event.targetX,
        y: event.targetY,
      });
    }
  }

  #wakeWaiters() {
    for (const waiter of [...this.waiters]) {
      let match;
      try {
        match = waiter.find();
      } catch (error) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.reject(error);
        continue;
      }
      if (match) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve(match);
      }
    }
  }
}

function apiRequest(port, pathname, { method = 'GET', token, body } = {}) {
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': encoded.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (error) {
          reject(new Error(`respuesta REST no es JSON (${response.statusCode}): ${text}`));
          return;
        }
        resolve({ status: response.statusCode, body: json });
      });
    });
    request.once('error', reject);
    if (encoded) request.write(encoded);
    request.end();
  });
}

function launchServer(environment) {
  try {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      hasExited: () => child.exitCode !== null,
      async stop() {
        if (child.exitCode === null) {
          const exited = new Promise(resolve => child.once('exit', resolve));
          child.kill('SIGTERM');
          await Promise.race([exited, delay(2000)]);
          if (child.exitCode === null) {
            child.kill('SIGKILL');
            await Promise.race([
              new Promise(resolve => child.once('exit', resolve)),
              delay(1000),
            ]);
          }
        }
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.stdout.destroy();
        child.stderr.destroy();
      },
    };
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    // Algunos sandboxes de Windows impiden child_process.spawn. Un Worker mantiene
    // el servidor y sus variables aislados y permite probar exactamente server.js.
    let exited = false;
    const worker = new Worker(path.join(__dirname, 'server.js'), {
      env: environment,
      stdout: true,
      stderr: true,
    });
    worker.once('exit', () => { exited = true; });
    return {
      stdout: worker.stdout,
      stderr: worker.stderr,
      hasExited: () => exited,
      async stop() {
        await worker.terminate();
        worker.stdout.removeAllListeners();
        worker.stderr.removeAllListeners();
        worker.stdout.destroy();
        worker.stderr.destroy();
      },
    };
  }
}

async function waitForServer(serverProcess, readiness, timeout = 15000) {
  let output = '';
  const append = chunk => { output += chunk.toString('utf8'); };
  serverProcess.stdout.on('data', append);
  serverProcess.stderr.on('data', append);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (serverProcess.hasExited()) throw new Error(`server.js terminó antes de iniciar:\n${output}`);
    if (readiness.every(fragment => output.includes(fragment))) return () => output;
    await delay(25);
  }
  throw new Error(`server.js no quedó listo:\n${output}`);
}

async function bringPlayersTogether(observer, clientA, uidA, clientB, uidB) {
  await observer.waitFor(payload => payload[0] === MSG_WORLD_SNAPSHOT
    && observer.positions.has(uidA) && observer.positions.has(uidB), {
    timeout: 5000,
    description: 'snapshot inicial de ambos jugadores',
  });

  const initialA = observer.positions.get(uidA);
  const initialB = observer.positions.get(uidB);
  const centerX = Math.round((initialA.x + initialB.x) / 2);
  const centerY = Math.round((initialA.y + initialB.y) / 2);
  const targetA = { x: centerX - 25, y: centerY };
  const targetB = { x: centerX + 25, y: centerY };
  const deadline = Date.now() + 22_000;

  const direction = (target, current) => Math.abs(target - current) <= 12
    ? 0
    : (target > current ? 1 : -1);

  while (Date.now() < deadline) {
    const currentA = observer.positions.get(uidA);
    const currentB = observer.positions.get(uidB);
    const aDx = direction(targetA.x, currentA.x);
    const aDy = direction(targetA.y, currentA.y);
    const bDx = direction(targetB.x, currentB.x);
    const bDy = direction(targetB.y, currentB.y);
    if (aDx === 0 && aDy === 0 && bDx === 0 && bDy === 0) break;
    clientA.input(aDx, aDy, 1);
    clientB.input(bDx, bDy, -1);
    await delay(70);
  }

  clientA.input(0, 0, 1);
  clientB.input(0, 0, -1);
  await delay(150);

  const finalA = observer.positions.get(uidA);
  const finalB = observer.positions.get(uidB);
  const hitDistance = Math.hypot(finalB.x - (finalA.x + 25), finalB.y - finalA.y);
  assert(hitDistance <= 80,
    `los jugadores no llegaron a rango: A(${finalA.x},${finalA.y}) B(${finalB.x},${finalB.y}) distanciaHit=${hitDistance}`);
  return { finalA, finalB };
}

test('REST, ticket de un uso y combate autoritativo completo', { timeout: 120_000 }, async () => {
  const usedPorts = new Set();
  const tcpPort = await freePort(usedPorts);
  const httpPort = await freePort(usedPorts);
  const wsPort = await freePort(usedPorts);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gm-server-integration-'));
  const clients = [];
  let serverProcess;
  let serverOutput = () => '';

  try {
    serverProcess = launchServer({
      ...process.env,
      PORT: String(tcpPort),
      HTTP_PORT: String(httpPort),
      WS_PORT: String(wsPort),
      AUTH_DB_PATH: path.join(temporary, 'users.json'),
      AUTH_SECRET_PATH: path.join(temporary, 'auth-secret'),
      AFK_AFTER_MS: '600000',
      KICK_AFTER_MS: '660000',
      LOBBY_COUNTDOWN_MS: '1000',
      MATCH_DURATION_MS: '600000',
    });
    serverOutput = await waitForServer(serverProcess, [
      `puerto ${tcpPort}`,
      `127.0.0.1:${wsPort}`,
      `127.0.0.1:${httpPort}`,
      'Base documental de usuarios lista:',
    ]);

    const users = {
      a: { username: 'IntegracionA', password: 'Clave segura A 2026' },
      b: { username: 'IntegracionB', password: 'Clave segura B 2026' },
      c: { username: 'IntegracionC', password: 'Clave segura C 2026' },
    };

    const registeredA = await apiRequest(httpPort, '/api/auth/register', { method: 'POST', body: users.a });
    assert.equal(registeredA.status, 201);
    assert.equal(registeredA.body.ok, true);
    assert.equal(registeredA.body.user.username, users.a.username);

    const duplicate = await apiRequest(httpPort, '/api/auth/register', { method: 'POST', body: users.a });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'USERNAME_TAKEN');

    const badPassword = await apiRequest(httpPort, '/api/auth/login', {
      method: 'POST',
      body: { username: users.a.username, password: 'Una clave incorrecta' },
    });
    assert.equal(badPassword.status, 401);
    assert.equal(badPassword.body.code, 'INVALID_CREDENTIALS');

    const loggedA = await apiRequest(httpPort, '/api/auth/login', { method: 'POST', body: users.a });
    assert.equal(loggedA.status, 200);
    assert.equal(loggedA.body.ok, true);
    assert.equal(typeof loggedA.body.token, 'string');

    const registeredB = await apiRequest(httpPort, '/api/auth/register', { method: 'POST', body: users.b });
    const registeredC = await apiRequest(httpPort, '/api/auth/register', { method: 'POST', body: users.c });
    assert.equal(registeredB.status, 201);
    assert.equal(registeredC.status, 201);

    const getTicket = async token => {
      const response = await apiRequest(httpPort, '/api/game-ticket', {
        method: 'POST',
        token,
        body: { serverId: 'principal' },
      });
      assert.equal(response.status, 201);
      assert.equal(response.body.ok, true);
      assert(response.body.ticket.length >= 32);
      return response.body.ticket;
    };

    const ticketA = await getTicket(loggedA.body.token);
    const clientA = await new GameClient(tcpPort).connect();
    clients.push(clientA);
    let mark = clientA.mark();
    clientA.join(ticketA);
    const welcomeA = parseWelcome(await clientA.waitFor(payload => payload[0] === MSG_WELCOME, {
      after: mark,
      description: 'WELCOME del jugador A',
    }));

    const replay = await new GameClient(tcpPort).connect();
    clients.push(replay);
    mark = replay.mark();
    replay.join(ticketA);
    const rejection = await replay.waitFor(payload => payload[0] === MSG_NAME_REJECT, {
      after: mark,
      description: 'rechazo al reutilizar el ticket',
    });
    const rejectionText = readCString(rejection, 1).value;
    assert.match(rejectionText, /inv.lido|venci./i);
    await replay.close();

    const ticketB = await getTicket(registeredB.body.token);
    const clientB = await new GameClient(tcpPort).connect();
    clients.push(clientB);
    mark = clientB.mark();
    clientB.join(ticketB);
    const welcomeB = parseWelcome(await clientB.waitFor(payload => payload[0] === MSG_WELCOME, {
      after: mark,
      description: 'WELCOME del jugador B',
    }));

    // Los ataques solo funcionan durante la partida: ambos dan JUGAR y esperan
    // a que termine el countdown del lobby.
    mark = clientA.mark();
    clientA.ready(true);
    clientB.ready(true);
    await clientA.waitFor(payload => payload[0] === MSG_LOBBY_STATE && payload.readUInt8(1) === 2, {
      after: mark,
      timeout: 8000,
      description: 'inicio de la partida tras dar JUGAR todos',
    });

    await bringPlayersTogether(clientA, clientA, welcomeA.uid, clientB, welcomeB.uid);

    mark = clientB.mark();
    clientA.attack(1, 1);
    const normal = parseCombatEvent(await clientB.waitFor(payload => payload[0] === MSG_COMBAT_EVENT
      && parseCombatEvent(payload).targetUid === welcomeB.uid, {
      after: mark,
      description: 'golpe normal autoritativo',
    }));
    assert.equal(normal.attackerUid, welcomeA.uid);
    assert.equal(normal.kind, 1);
    assert.equal(normal.damage, 3);
    assert.equal(normal.healthAfter, 97);
    assert.equal(normal.pushX, 0);
    assert.equal(normal.pushY, 0);

    await delay(125);
    mark = clientB.mark();
    clientA.attack(1, 1);
    await delay(300);
    assert.equal(clientB.messagesAfter(mark, MSG_COMBAT_EVENT).length, 0,
      'repetir actionSequence produjo daño por segunda vez');

    mark = clientB.mark();
    clientA.attack(2, 2);
    const strong = parseCombatEvent(await clientB.waitFor(payload => payload[0] === MSG_COMBAT_EVENT
      && parseCombatEvent(payload).targetUid === welcomeB.uid, {
      after: mark,
      description: 'golpe fuerte autoritativo',
    }));
    assert.equal(strong.kind, 2);
    assert.equal(strong.damage, 5);
    assert.equal(strong.healthAfter, 92);
    assert.equal(strong.pushX, strong.attackerFacing * 30);
    assert.equal(strong.pushY, 0);

    // Esta entrada intenta volver inmediatamente a la posición anterior. El servidor
    // debe descartarla durante el stun y conservar el endpoint del retroceso.
    clientB.input(-strong.attackerFacing, 0, -1);
    await delay(425);
    const afterKnockback = clientA.positions.get(welcomeB.uid);
    assert(Math.abs(afterKnockback.x - strong.targetX) <= 1,
      `retroceso revertido: evento=${strong.targetX}, snapshot=${afterKnockback.x}`);
    assert(Math.abs(afterKnockback.y - strong.targetY) <= 1);

    const ticketC = await getTicket(registeredC.body.token);
    const clientC = await new GameClient(tcpPort).connect();
    clients.push(clientC);
    mark = clientC.mark();
    clientC.join(ticketC);
    await clientC.waitFor(payload => payload[0] === MSG_WELCOME, {
      after: mark,
      description: 'WELCOME del jugador C',
    });
    const worldForC = parseWorldState(await clientC.waitFor(payload => payload[0] === MSG_WORLD_STATE, {
      after: mark,
      description: 'WORLD_STATE al entrar el tercer jugador',
    }));
    const bSeenByC = worldForC.find(player => player.uid === welcomeB.uid);
    assert(bSeenByC, 'el tercer jugador no recibió al jugador B en WORLD_STATE');
    assert.equal(bSeenByC.health, 92, 'WORLD_STATE restauró incorrectamente la vida a 100');
    assert.equal(bSeenByC.revision, strong.targetRevision);
    await clientC.close();

    mark = clientB.mark();
    clientA.chargeKi(true);
    const chargedStats = await clientB.waitFor(payload => payload[0] === MSG_STATS
      && payload.length === 5
      && payload.readUInt16LE(1) === welcomeA.uid
      && payload.readUInt8(4) >= 5, {
      after: mark,
      timeout: 3000,
      description: 'recarga autoritativa de al menos 5 ki',
    });
    assert(chargedStats.readUInt8(4) >= 5);
    clientA.chargeKi(false);

    mark = clientB.mark();
    clientA.fireKi(false);
    const spawnPayload = await clientB.waitFor(payload => payload[0] === MSG_PROJECTILE_SPAWN, {
      after: mark,
      description: 'spawn del proyectil de ki',
    });
    assert.equal(spawnPayload.length, 12);
    const projectileId = spawnPayload.readUInt32LE(1);
    assert.equal(spawnPayload.readUInt16LE(5), welcomeA.uid);

    const kiHit = parseCombatEvent(await clientB.waitFor(payload => payload[0] === MSG_COMBAT_EVENT
      && parseCombatEvent(payload).targetUid === welcomeB.uid, {
      after: mark,
      timeout: 3000,
      description: 'impacto autoritativo del ki',
    }));
    assert.equal(kiHit.kind, 1);
    assert.equal(kiHit.damage, 3);
    assert.equal(kiHit.healthAfter, 89);

    const destroyed = await clientB.waitFor(payload => payload[0] === MSG_PROJECTILE_DESTROY
      && payload.readUInt32LE(1) === projectileId, {
      after: mark,
      timeout: 3000,
      description: 'destrucción del proyectil al impactar',
    });
    assert.equal(destroyed.length, 10);
    assert.equal(destroyed.readUInt8(9), 1);

    assert.match(serverOutput(), /\[hit\].*dmg 3 vida 97/);
    assert.match(serverOutput(), /\[hit\].*dmg 5 vida 92/);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    if (serverProcess) await serverProcess.stop();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
});
