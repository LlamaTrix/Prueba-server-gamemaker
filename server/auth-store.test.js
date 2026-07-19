'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

const {
  AuthError,
  AuthStore,
  normalizeUsername,
} = require('./auth-store');

const TEST_SCRYPT = Object.freeze({
  N: 1_024,
  r: 8,
  p: 1,
  keyLength: 64,
  maxmem: 16 * 1024 * 1024,
});

async function createFixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'game-auth-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'users.json');
  const secret = options.secret || crypto.randomBytes(48);
  const store = new AuthStore({
    filePath,
    sessionSecret: secret,
    clock: options.clock,
    scrypt: TEST_SCRYPT,
  });
  await store.initialize();
  return { directory, filePath, secret, store };
}

function hasCode(code) {
  return (error) => error instanceof AuthError && error.code === code;
}

test('normaliza nombres y garantiza unicidad sin distinguir mayusculas', async (t) => {
  const { store } = await createFixture(t);
  const created = await store.register({
    username: '  A\u0301LICE  ',
    password: 'Clave-Segura-123',
  });

  assert.equal(created.username, 'ÁLICE');
  assert.deepEqual(normalizeUsername('álice'), {
    display: 'álice',
    key: 'álice',
  });

  const session = await store.login({
    username: 'álice',
    password: 'Clave-Segura-123',
  });
  assert.equal(session.user.id, created.id);

  await assert.rejects(
    store.register({ username: 'Álice', password: 'Otra-Clave-456' }),
    hasCode('USERNAME_TAKEN'),
  );
});

test('persiste solo salt y hash scrypt, nunca la contrasena', async (t) => {
  const { filePath, secret, store } = await createFixture(t);
  const password = 'No-Aparece-En-El-Documento-987';
  const created = await store.register({ username: 'Vegeta', password });

  const raw = await fs.readFile(filePath, 'utf8');
  assert.equal(raw.includes(password), false);

  const document = JSON.parse(raw);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.users.length, 1);
  assert.equal(document.users[0].id, created.id);
  assert.equal(document.users[0].credentials.algorithm, 'scrypt');
  assert.ok(document.users[0].credentials.salt.length >= 40);
  assert.ok(document.users[0].credentials.hash.length >= 80);
  assert.equal(Object.hasOwn(document.users[0], 'password'), false);

  const reloaded = new AuthStore({
    filePath,
    sessionSecret: secret,
    scrypt: TEST_SCRYPT,
  });
  const login = await reloaded.login({ username: 'VEGETA', password });
  assert.equal(login.user.id, created.id);
});

test('no revela si fallo el usuario o la contrasena', async (t) => {
  const { store } = await createFixture(t);
  await store.register({ username: 'Gohan', password: 'Correcta-123' });

  await assert.rejects(
    store.login({ username: 'Gohan', password: 'Incorrecta-123' }),
    hasCode('INVALID_CREDENTIALS'),
  );
  await assert.rejects(
    store.login({ username: 'NoExiste', password: 'Incorrecta-123' }),
    hasCode('INVALID_CREDENTIALS'),
  );
});

test('firma, verifica, expira y revoca tokens de sesion', async (t) => {
  let now = Date.UTC(2026, 6, 19, 12, 0, 0);
  const { store } = await createFixture(t, { clock: () => now });
  const user = await store.register({ username: 'Goku', password: 'Kame-Hame-123' });
  const login = await store.login({
    username: 'goku',
    password: 'Kame-Hame-123',
    ttlSeconds: 60,
  });

  const verified = await store.verifySession(login.token);
  assert.equal(verified.user.id, user.id);

  const tokenParts = login.token.split('.');
  const first = tokenParts[2][0] === 'A' ? 'B' : 'A';
  tokenParts[2] = first + tokenParts[2].slice(1);
  await assert.rejects(
    store.verifySession(tokenParts.join('.')),
    hasCode('INVALID_SESSION'),
  );

  await store.revokeUserSessions(user.id);
  await assert.rejects(
    store.verifySession(login.token),
    hasCode('SESSION_REVOKED'),
  );

  const renewed = await store.login({
    username: 'goku',
    password: 'Kame-Hame-123',
    ttlSeconds: 60,
  });
  now += 60_000;
  await assert.rejects(
    store.verifySession(renewed.token),
    hasCode('SESSION_EXPIRED'),
  );
});

test('serializa registros concurrentes y no crea usuarios duplicados', async (t) => {
  const { filePath, store } = await createFixture(t);
  const attempts = await Promise.allSettled([
    store.register({ username: 'Trunks', password: 'Primera-Clave-1' }),
    store.register({ username: 'TRUNKS', password: 'Segunda-Clave-2' }),
  ]);

  assert.equal(attempts.filter((entry) => entry.status === 'fulfilled').length, 1);
  const rejected = attempts.find((entry) => entry.status === 'rejected');
  assert.equal(rejected.reason.code, 'USERNAME_TAKEN');

  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(document.users.length, 1);
  const temporaryFiles = (await fs.readdir(path.dirname(filePath)))
    .filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(temporaryFiles, []);
});

test('rechaza secretos de firma demasiado cortos', () => {
  assert.throws(
    () => new AuthStore({ filePath: 'users.json', sessionSecret: 'corto' }),
    /al menos 32 bytes/,
  );
});
