import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readJson, writeJson } from './store.js';

const sessionSecretPath = resolve(process.cwd(), 'server/storage/session-secret.json');
const tokenTtlSeconds = 60 * 60 * 8;
const lockoutMs = 15 * 60 * 1000;
const maxFailedAttempts = 5;
const scryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

let sessionSecretCache;

export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

export function safeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    passwordChangedAt: user.passwordChangedAt
  };
}

export function publicPasswordRequest(request) {
  return {
    id: request.id,
    userId: request.userId,
    username: request.username,
    status: request.status,
    requestedAt: request.requestedAt,
    reviewedAt: request.reviewedAt,
    reviewedBy: request.reviewedBy
  };
}

export function validateUsername(username) {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return 'El usuario debe tener 3 a 32 caracteres y solo usar letras, numeros, punto, guion o guion bajo.';
  }

  return null;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'La contraseña debe tener al menos 12 caracteres.';
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'La contraseña debe incluir mayuscula, minuscula, numero y simbolo.';
  }

  return null;
}

export function createPasswordHash(password) {
  const salt = randomBytes(24).toString('base64');
  const hash = scryptSync(password, salt, 64, scryptOptions).toString('base64');

  return {
    algorithm: 'scrypt',
    salt,
    hash
  };
}

export function verifyPassword(password, passwordHash) {
  if (!passwordHash || passwordHash.algorithm !== 'scrypt') {
    return false;
  }

  const expected = Buffer.from(passwordHash.hash, 'base64');
  const actual = scryptSync(password, passwordHash.salt, expected.length, scryptOptions);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function getSessionSecret() {
  if (sessionSecretCache) {
    return sessionSecretCache;
  }

  try {
    const saved = JSON.parse(await readFile(sessionSecretPath, 'utf8'));
    sessionSecretCache = saved.secret;
  } catch {
    sessionSecretCache = randomBytes(48).toString('base64url');
    await mkdir(dirname(sessionSecretPath), { recursive: true });
    await writeFile(sessionSecretPath, `${JSON.stringify({ secret: sessionSecretCache }, null, 2)}\n`);
  }

  return sessionSecretCache;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

async function signToken(header, payload) {
  const secret = await getSessionSecret();
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

async function verifyToken(token) {
  const [headerPart, payloadPart, signature] = String(token || '').split('.');

  if (!headerPart || !payloadPart || !signature) {
    return null;
  }

  const secret = await getSessionSecret();
  const unsigned = `${headerPart}.${payloadPart}`;
  const expected = createHmac('sha256', secret).update(unsigned).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  const payload = decode(payloadPart);
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

async function createSession(user) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + tokenTtlSeconds;
  const token = await signToken(
    { alg: 'HS256', typ: 'JWT' },
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      iat: issuedAt,
      exp: expiresAt,
      jti: randomUUID()
    }
  );

  return { token, expiresAt };
}

export async function authStatus() {
  const users = await readJson('users');
  return {
    setupRequired: users.length === 0,
    superuserExists: users.some((user) => user.role === 'superuser')
  };
}

export async function setupSuperuser(input) {
  const users = await readJson('users');

  if (users.length > 0) {
    const error = new Error('El superusuario ya fue configurado.');
    error.status = 409;
    throw error;
  }

  const username = normalizeUsername(input.username);
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(input.password);

  if (usernameError || passwordError) {
    const error = new Error(usernameError || passwordError);
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    username,
    name: String(input.name || 'Superusuario').trim(),
    email: String(input.email || '').trim(),
    role: 'superuser',
    active: true,
    passwordHash: createPasswordHash(input.password),
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now,
    passwordChangedAt: now,
    lastLoginAt: null
  };

  await writeJson('users', [user]);
  const session = await createSession(user);

  return { user: safeUser(user), ...session };
}

export async function loginUser(input) {
  const username = normalizeUsername(input.username);
  const users = await readJson('users');
  const userIndex = users.findIndex((user) => user.username === username);
  const user = users[userIndex];
  const nowMs = Date.now();
  const genericError = new Error('Usuario o contraseña invalidos.');
  genericError.status = 401;

  if (!user || !user.active) {
    throw genericError;
  }

  if (user.lockedUntil && new Date(user.lockedUntil).getTime() > nowMs) {
    const error = new Error('La cuenta esta bloqueada temporalmente por intentos fallidos.');
    error.status = 423;
    throw error;
  }

  if (!verifyPassword(String(input.password || ''), user.passwordHash)) {
    user.failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= maxFailedAttempts) {
      user.lockedUntil = new Date(nowMs + lockoutMs).toISOString();
      user.failedLoginAttempts = 0;
    }
    user.updatedAt = new Date().toISOString();
    users[userIndex] = user;
    await writeJson('users', users);
    throw genericError;
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date().toISOString();
  user.updatedAt = user.lastLoginAt;
  users[userIndex] = user;
  await writeJson('users', users);

  const session = await createSession(user);
  return { user: safeUser(user), ...session };
}

export async function requireUser(req, allowedRoles = ['admin', 'superuser']) {
  const authorization = req.headers.authorization || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  const payload = await verifyToken(token);

  if (!payload) {
    const error = new Error('Sesion invalida o expirada.');
    error.status = 401;
    throw error;
  }

  const users = await readJson('users');
  const user = users.find((item) => item.id === payload.sub && item.active);

  if (!user || !allowedRoles.includes(user.role)) {
    const error = new Error('No tienes permisos para esta accion.');
    error.status = 403;
    throw error;
  }

  return user;
}

export async function createAdminUser(actor, input) {
  if (actor.role !== 'superuser') {
    const error = new Error('Solo el superusuario puede crear cuentas.');
    error.status = 403;
    throw error;
  }

  const username = normalizeUsername(input.username);
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(input.password);

  if (usernameError || passwordError) {
    const error = new Error(usernameError || passwordError);
    error.status = 400;
    throw error;
  }

  const users = await readJson('users');

  if (users.some((user) => user.username === username)) {
    const error = new Error('Ese usuario ya existe.');
    error.status = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    username,
    name: String(input.name || username).trim(),
    email: String(input.email || '').trim(),
    role: 'admin',
    active: true,
    passwordHash: createPasswordHash(input.password),
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now,
    passwordChangedAt: now,
    lastLoginAt: null,
    createdBy: actor.id
  };

  users.push(user);
  await writeJson('users', users);
  return safeUser(user);
}

export async function listUsers() {
  const [users, passwordRequests] = await Promise.all([readJson('users'), readJson('passwordRequests')]);
  return {
    users: users.map(safeUser),
    passwordRequests: passwordRequests.map(publicPasswordRequest)
  };
}

export async function updateUserStatus(actor, userId, active) {
  if (actor.role !== 'superuser') {
    const error = new Error('Solo el superusuario puede administrar usuarios.');
    error.status = 403;
    throw error;
  }

  const users = await readJson('users');
  const userIndex = users.findIndex((user) => user.id === userId);

  if (userIndex === -1) {
    const error = new Error('Usuario no encontrado.');
    error.status = 404;
    throw error;
  }

  if (users[userIndex].role === 'superuser') {
    const error = new Error('El superusuario unico no se puede desactivar.');
    error.status = 400;
    throw error;
  }

  users[userIndex].active = Boolean(active);
  users[userIndex].updatedAt = new Date().toISOString();
  await writeJson('users', users);
  return safeUser(users[userIndex]);
}

export async function requestPasswordChange(actor, input) {
  const passwordError = validatePassword(input.newPassword);
  if (passwordError) {
    const error = new Error(passwordError);
    error.status = 400;
    throw error;
  }

  const users = await readJson('users');
  const userIndex = users.findIndex((user) => user.id === actor.id);
  const user = users[userIndex];

  if (!verifyPassword(String(input.currentPassword || ''), user.passwordHash)) {
    const error = new Error('La contraseña actual no es correcta.');
    error.status = 401;
    throw error;
  }

  const now = new Date().toISOString();

  if (user.role === 'superuser') {
    user.passwordHash = createPasswordHash(input.newPassword);
    user.passwordChangedAt = now;
    user.updatedAt = now;
    users[userIndex] = user;
    await writeJson('users', users);
    return { status: 'applied' };
  }

  const requests = await readJson('passwordRequests');
  requests
    .filter((request) => request.userId === actor.id && request.status === 'pending')
    .forEach((request) => {
      request.status = 'superseded';
      request.reviewedAt = now;
    });

  const request = {
    id: randomUUID(),
    userId: actor.id,
    username: actor.username,
    status: 'pending',
    requestedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    pendingPasswordHash: createPasswordHash(input.newPassword)
  };

  requests.unshift(request);
  await writeJson('passwordRequests', requests);
  return publicPasswordRequest(request);
}

export async function reviewPasswordRequest(actor, requestId, decision) {
  if (actor.role !== 'superuser') {
    const error = new Error('Solo el superusuario puede revisar cambios de contraseña.');
    error.status = 403;
    throw error;
  }

  const [users, requests] = await Promise.all([readJson('users'), readJson('passwordRequests')]);
  const requestIndex = requests.findIndex((request) => request.id === requestId);
  const request = requests[requestIndex];

  if (!request || request.status !== 'pending') {
    const error = new Error('Solicitud no encontrada o ya revisada.');
    error.status = 404;
    throw error;
  }

  const now = new Date().toISOString();
  request.status = decision === 'approved' ? 'approved' : 'rejected';
  request.reviewedAt = now;
  request.reviewedBy = actor.username;

  if (decision === 'approved') {
    const userIndex = users.findIndex((user) => user.id === request.userId);
    if (userIndex === -1) {
      const error = new Error('Usuario de la solicitud no encontrado.');
      error.status = 404;
      throw error;
    }

    users[userIndex].passwordHash = request.pendingPasswordHash;
    users[userIndex].passwordChangedAt = now;
    users[userIndex].updatedAt = now;
    await writeJson('users', users);
  }

  delete request.pendingPasswordHash;
  requests[requestIndex] = request;
  await writeJson('passwordRequests', requests);
  return publicPasswordRequest(request);
}
