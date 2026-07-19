'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

const DATABASE_SCHEMA_VERSION = 1;
const TOKEN_VERSION = 'v1';
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;
const MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_SCRYPT = Object.freeze({
  // Perfil recomendado para scrypt con ~32 MiB de memoria y mayor coste CPU.
  N: 32_768,
  r: 8,
  p: 3,
  keyLength: 64,
  maxmem: 64 * 1024 * 1024,
});
const DUMMY_SALT = Buffer.from(
  'PvWFCkq9qUsKSfkheAY8-PfBaZKQ1RiPCACi_jtYjV8',
  'base64url',
);

// Almacen documental JSON local. API publica:
// initialize, register, login, verifySession, revokeUserSessions y getUserById.

class AuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

function normalizeUsername(username) {
  if (typeof username !== 'string') {
    throw new AuthError('INVALID_USERNAME', 'El nombre de usuario debe ser texto.');
  }

  const display = username.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const length = Array.from(display).length;
  if (length < 3 || length > 24) {
    throw new AuthError(
      'INVALID_USERNAME',
      'El nombre de usuario debe tener entre 3 y 24 caracteres.',
    );
  }
  if (!/^[\p{L}\p{M}\p{N}_. -]+$/u.test(display)) {
    throw new AuthError(
      'INVALID_USERNAME',
      'El nombre de usuario contiene caracteres no permitidos.',
    );
  }

  return Object.freeze({
    display,
    key: display.toLowerCase(),
  });
}

function validatePassword(password) {
  if (typeof password !== 'string') {
    throw new AuthError('INVALID_PASSWORD', 'La contraseña debe ser texto.');
  }

  const length = Array.from(password).length;
  const bytes = Buffer.byteLength(password, 'utf8');
  if (length < 8 || length > 128 || bytes > 256) {
    throw new AuthError(
      'INVALID_PASSWORD',
      'La contraseña debe tener entre 8 y 128 caracteres.',
    );
  }
}

function publicUser(user) {
  return Object.freeze({
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  });
}

function invalidCredentials() {
  return new AuthError(
    'INVALID_CREDENTIALS',
    'Nombre de usuario o contraseña incorrectos.',
    401,
  );
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseSecret(value) {
  let secret;
  if (Buffer.isBuffer(value)) {
    secret = Buffer.from(value);
  } else if (typeof value === 'string') {
    secret = Buffer.from(value, 'utf8');
  } else {
    throw new TypeError('sessionSecret debe ser un string o Buffer.');
  }

  if (secret.length < 32) {
    throw new TypeError('sessionSecret debe contener al menos 32 bytes.');
  }
  return secret;
}

class AuthStore {
  constructor(options = {}) {
    if (typeof options.filePath !== 'string' || options.filePath.trim() === '') {
      throw new TypeError('filePath es obligatorio.');
    }

    this.filePath = path.resolve(options.filePath);
    this.sessionSecret = parseSecret(options.sessionSecret);
    this.clock = typeof options.clock === 'function' ? options.clock : Date.now;
    this.defaultSessionTtlSeconds = Number.isSafeInteger(options.sessionTtlSeconds)
      ? options.sessionTtlSeconds
      : DEFAULT_SESSION_TTL_SECONDS;
    this.scrypt = Object.freeze({
      ...DEFAULT_SCRYPT,
      ...(options.scrypt || {}),
    });

    if (
      !Number.isSafeInteger(this.defaultSessionTtlSeconds)
      || this.defaultSessionTtlSeconds < 1
      || this.defaultSessionTtlSeconds > MAX_SESSION_TTL_SECONDS
    ) {
      throw new TypeError(`sessionTtlSeconds debe estar entre 1 y ${MAX_SESSION_TTL_SECONDS}.`);
    }

    this.database = null;
    this.initializing = null;
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    if (this.database) return this;
    if (this.initializing) return this.initializing;

    this.initializing = this.#load().then(() => this);
    try {
      return await this.initializing;
    } catch (error) {
      this.database = null;
      throw error;
    } finally {
      this.initializing = null;
    }
  }

  async register({ username, password } = {}) {
    await this.initialize();
    const normalized = normalizeUsername(username);
    validatePassword(password);

    // El calculo costoso ocurre antes de tomar la cola de escritura.
    const credentials = await this.#createCredentials(password);
    return this.#mutate(async () => {
      if (this.#findByUsernameKey(normalized.key)) {
        throw new AuthError(
          'USERNAME_TAKEN',
          'Ese nombre de usuario ya está registrado.',
          409,
        );
      }

      const now = new Date(this.clock()).toISOString();
      const user = {
        id: crypto.randomUUID(),
        username: normalized.display,
        usernameKey: normalized.key,
        credentials,
        sessionVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.database.users.push(user);
      return publicUser(user);
    });
  }

  async login({ username, password, ttlSeconds } = {}) {
    await this.initialize();
    await this.writeQueue;

    let normalized;
    try {
      normalized = normalizeUsername(username);
    } catch {
      // La respuesta de login no revela si el usuario existe o si es valido.
      normalized = { key: '' };
    }
    const suppliedPassword = typeof password === 'string' ? password : '';
    const user = this.#findByUsernameKey(normalized.key);
    const credentials = user ? user.credentials : this.#dummyCredentials();

    let candidate;
    try {
      candidate = await this.#deriveKey(suppliedPassword, credentials);
    } catch {
      throw invalidCredentials();
    }

    let stored;
    try {
      stored = Buffer.from(credentials.hash, 'base64url');
    } catch {
      stored = Buffer.alloc(this.scrypt.keyLength);
    }
    const matches = candidate.length === stored.length
      && crypto.timingSafeEqual(candidate, stored);
    if (!user || !matches) throw invalidCredentials();

    const session = this.#issueSession(user, ttlSeconds);
    return Object.freeze({
      user: publicUser(user),
      token: session.token,
      expiresAt: session.expiresAt,
    });
  }

  async verifySession(token) {
    await this.initialize();
    await this.writeQueue;
    const payload = this.#verifyToken(token);
    const user = this.database.users.find((candidate) => candidate.id === payload.sub);
    if (!user) {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }
    if (payload.sv !== user.sessionVersion) {
      throw new AuthError('SESSION_REVOKED', 'La sesión fue revocada.', 401);
    }
    if (payload.usr !== user.usernameKey) {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }

    return Object.freeze({
      user: publicUser(user),
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  }

  async revokeUserSessions(userId) {
    await this.initialize();
    if (typeof userId !== 'string' || userId === '') {
      throw new AuthError('USER_NOT_FOUND', 'Usuario no encontrado.', 404);
    }

    return this.#mutate(async () => {
      const user = this.database.users.find((candidate) => candidate.id === userId);
      if (!user) throw new AuthError('USER_NOT_FOUND', 'Usuario no encontrado.', 404);
      user.sessionVersion += 1;
      user.updatedAt = new Date(this.clock()).toISOString();
      return publicUser(user);
    });
  }

  async getUserById(userId) {
    await this.initialize();
    await this.writeQueue;
    const user = this.database.users.find((candidate) => candidate.id === userId);
    return user ? publicUser(user) : null;
  }

  async #load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.#validateDatabase(parsed);
      this.database = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (error instanceof SyntaxError) {
          throw new Error(`La base de autenticacion no contiene JSON valido: ${this.filePath}`);
        }
        throw error;
      }

      const now = new Date(this.clock()).toISOString();
      this.database = {
        schemaVersion: DATABASE_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        users: [],
      };
      await this.#persist();
    }
  }

  #validateDatabase(database) {
    if (
      !database
      || database.schemaVersion !== DATABASE_SCHEMA_VERSION
      || !Array.isArray(database.users)
    ) {
      throw new Error('Formato de base de autenticacion no compatible.');
    }

    const ids = new Set();
    const keys = new Set();
    for (const user of database.users) {
      if (
        !user
        || typeof user.id !== 'string'
        || typeof user.username !== 'string'
        || typeof user.usernameKey !== 'string'
        || !user.credentials
        || user.credentials.algorithm !== 'scrypt'
        || typeof user.credentials.salt !== 'string'
        || typeof user.credentials.hash !== 'string'
        || !Number.isSafeInteger(user.sessionVersion)
      ) {
        throw new Error('La base de autenticacion contiene un usuario invalido.');
      }
      if (ids.has(user.id) || keys.has(user.usernameKey)) {
        throw new Error('La base de autenticacion contiene usuarios duplicados.');
      }
      ids.add(user.id);
      keys.add(user.usernameKey);
    }
  }

  async #mutate(mutator) {
    const operation = this.writeQueue.then(async () => {
      const previous = deepCopy(this.database);
      try {
        const result = await mutator();
        this.database.updatedAt = new Date(this.clock()).toISOString();
        await this.#persist();
        return result;
      } catch (error) {
        this.database = previous;
        throw error;
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async #persist() {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    const data = `${JSON.stringify(this.database, null, 2)}\n`;
    let handle;
    try {
      handle = await fs.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(data, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporaryPath, this.filePath);

      // En plataformas que lo permiten, sincroniza tambien la entrada del directorio.
      try {
        const directoryHandle = await fs.open(directory, 'r');
        await directoryHandle.sync();
        await directoryHandle.close();
      } catch {
        // Windows no siempre permite fsync sobre directorios.
      }
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await fs.unlink(temporaryPath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  #findByUsernameKey(usernameKey) {
    return this.database.users.find((user) => user.usernameKey === usernameKey);
  }

  async #createCredentials(password) {
    const salt = crypto.randomBytes(32);
    const key = await scryptAsync(password, salt, this.scrypt.keyLength, {
      N: this.scrypt.N,
      r: this.scrypt.r,
      p: this.scrypt.p,
      maxmem: this.scrypt.maxmem,
    });
    return {
      algorithm: 'scrypt',
      salt: salt.toString('base64url'),
      hash: Buffer.from(key).toString('base64url'),
      keyLength: this.scrypt.keyLength,
      params: {
        N: this.scrypt.N,
        r: this.scrypt.r,
        p: this.scrypt.p,
        maxmem: this.scrypt.maxmem,
      },
    };
  }

  #dummyCredentials() {
    return {
      algorithm: 'scrypt',
      salt: DUMMY_SALT.toString('base64url'),
      hash: Buffer.alloc(this.scrypt.keyLength).toString('base64url'),
      keyLength: this.scrypt.keyLength,
      params: {
        N: this.scrypt.N,
        r: this.scrypt.r,
        p: this.scrypt.p,
        maxmem: this.scrypt.maxmem,
      },
    };
  }

  async #deriveKey(password, credentials) {
    const salt = Buffer.from(credentials.salt, 'base64url');
    const params = credentials.params || {};
    const keyLength = Number(credentials.keyLength);
    if (
      credentials.algorithm !== 'scrypt'
      || salt.length < 16
      || !Number.isSafeInteger(keyLength)
      || keyLength < 32
      || keyLength > 128
    ) {
      throw new Error('Credenciales almacenadas no validas.');
    }
    return Buffer.from(await scryptAsync(password, salt, keyLength, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: params.maxmem,
    }));
  }

  #issueSession(user, requestedTtl) {
    const ttl = requestedTtl === undefined ? this.defaultSessionTtlSeconds : requestedTtl;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAX_SESSION_TTL_SECONDS) {
      throw new AuthError(
        'INVALID_SESSION_TTL',
        `La duracion de la sesion debe estar entre 1 y ${MAX_SESSION_TTL_SECONDS} segundos.`,
      );
    }

    const issuedAt = Math.floor(this.clock() / 1000);
    const payload = {
      sub: user.id,
      usr: user.usernameKey,
      sv: user.sessionVersion,
      iat: issuedAt,
      exp: issuedAt + ttl,
      jti: crypto.randomBytes(16).toString('base64url'),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signedPart = `${TOKEN_VERSION}.${encodedPayload}`;
    const signature = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(signedPart)
      .digest('base64url');
    return {
      token: `${signedPart}.${signature}`,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  #verifyToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }

    const signedPart = `${parts[0]}.${parts[1]}`;
    const expected = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(signedPart)
      .digest();
    let received;
    try {
      received = Buffer.from(parts[2], 'base64url');
    } catch {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }
    if (
      !payload
      || typeof payload.sub !== 'string'
      || typeof payload.usr !== 'string'
      || !Number.isSafeInteger(payload.sv)
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || typeof payload.jti !== 'string'
      || payload.exp <= payload.iat
    ) {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }

    const now = Math.floor(this.clock() / 1000);
    if (now >= payload.exp) {
      throw new AuthError('SESSION_EXPIRED', 'La sesión expiró.', 401);
    }
    if (payload.iat > now + 30) {
      throw new AuthError('INVALID_SESSION', 'La sesión no es válida.', 401);
    }
    return payload;
  }
}

module.exports = {
  AuthError,
  AuthStore,
  normalizeUsername,
};
