'use strict';

const crypto = require('crypto');
const { getKey } = require('./store');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日
const COOKIE_NAME = 'mm_session';

// ログイン試行のレート制限(IPごとに15分で10回まで)
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

function isEnabled() {
  return Boolean(process.env.MAILMANAGE_PASSWORD);
}

function authKey() {
  // 保存用鍵から認証専用の鍵を派生させる
  return crypto.createHmac('sha256', getKey()).update('mailmanage-auth').digest();
}

function timingSafeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function verifyPassword(password) {
  if (!isEnabled() || typeof password !== 'string') return false;
  return timingSafeEqual(password, process.env.MAILMANAGE_PASSWORD);
}

function sign(payload) {
  return crypto.createHmac('sha256', authKey()).update(payload).digest('base64url');
}

function createToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return false;
  }
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch (_) {
    return false;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function isAuthenticated(req) {
  if (!isEnabled()) return true; // 認証未設定時(ローカル利用)は素通し
  return verifyToken(parseCookies(req)[COOKIE_NAME]);
}

function cookieOptions(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_TTL_MS, path: '/' };
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'ログインが必要です' });
}

function rateLimitLogin(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'ログイン試行が多すぎます。しばらく待ってから再試行してください' });
  }
  entry.count += 1;
  attempts.set(ip, entry);
  // 溜まりすぎたら古いエントリを掃除
  if (attempts.size > 10000) {
    for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
  }
  next();
}

function clearAttempts(req) {
  attempts.delete(req.ip || 'unknown');
}

module.exports = {
  COOKIE_NAME,
  isEnabled,
  verifyPassword,
  createToken,
  isAuthenticated,
  cookieOptions,
  requireAuth,
  rateLimitLogin,
  clearAttempts,
};
