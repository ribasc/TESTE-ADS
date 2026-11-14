import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { db } from './db.js';

const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function createUser({ name, email, password }) {
  if (!name || !email || !password) throw new Error('Nome, e-mail e senha são obrigatórios.');
  if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?')
      .run(name, hashPassword(password), existing.id);
    return { id: existing.id, updated: true };
  }
  const r = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, hashPassword(password));
  return { id: Number(r.lastInsertRowid), updated: false };
}

/**
 * Cria as contas do casal a partir da variável COUPLE_USERS, útil em hospedagens
 * onde não dá para rodar o script de linha de comando.
 * Formato: "Nome:email:senha;Nome:email:senha"
 */
export function seedUsersFromEnv() {
  const raw = process.env.COUPLE_USERS;
  if (!raw) return;
  for (const entry of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [name, email, ...rest] = entry.split(':');
    const password = rest.join(':');
    try {
      createUser({ name, email, password });
    } catch (e) {
      console.warn(`COUPLE_USERS: não consegui criar "${email}": ${e.message}`);
    }
  }
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function login(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  // Sempre roda o scrypt para não revelar por tempo se o e-mail existe.
  const ok = verifyPassword(String(password || ''), user?.password_hash || 'scrypt$00$00');
  if (!user || !ok) return null;
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), user.id, expires);
  return { token, expires, user: { id: user.id, name: user.name, email: user.email } };
}

export function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function getSessionToken(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export function userFromRequest(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, s.expires_at FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, name: row.name, email: row.email };
}

export function setSessionCookie(res, token, expires) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expires).toUTCString()}${secure}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** Exige sessão. APIs respondem 401; páginas redirecionam para o login. */
export function requireCouple(req, res, next) {
  const user = userFromRequest(req);
  if (user) {
    req.user = user;
    return next();
  }
  if (req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Faça login para continuar.' });
  }
  return res.redirect(`/entrar?voltar=${encodeURIComponent(req.originalUrl)}`);
}

// Limite simples de tentativas de login por IP (10 a cada 15 min).
const attempts = new Map();
export function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= 10) {
    return res.status(429).json({ error: 'Muitas tentativas. Tente de novo em alguns minutos.' });
  }
  list.push(now);
  attempts.set(key, list);
  next();
}
