'use strict';

const crypto = require('crypto');
const { getKey } = require('./store');
const users = require('./users');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日
const COOKIE_NAME = 'mm_session';

// ログイン/登録試行のレート制限(IPごとに15分で10回まで)
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

function authKey() {
  // 保存用鍵から認証専用の鍵を派生させる
  return crypto.createHmac('sha256', getKey()).update('mailmanage-auth').digest();
}

function sign(payload) {
  return crypto.createHmac('sha256', authKey()).update(payload).digest('base64url');
}

function createToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

// 有効なら userId、無効なら null
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof uid !== 'string' || typeof exp !== 'number' || exp <= Date.now()) return null;
    return uid;
  } catch (_) {
    return null;
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

// ログイン中のユーザーを返す(未ログインなら null)
function currentUser(req) {
  const uid = verifyToken(parseCookies(req)[COOKIE_NAME]);
  if (!uid) return null;
  return users.getById(uid);
}

function cookieOptions(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_TTL_MS, path: '/' };
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'ログインが必要です' });
  req.user = user;
  next();
}

// 招待コード(設定されている場合のみ登録時に必要)
function inviteRequired() {
  return Boolean(process.env.MAILMANAGE_INVITE_CODE);
}

function verifyInvite(code) {
  if (!inviteRequired()) return true;
  if (typeof code !== 'string') return false;
  const ha = crypto.createHash('sha256').update(code).digest();
  const hb = crypto.createHash('sha256').update(process.env.MAILMANAGE_INVITE_CODE).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: '試行回数が多すぎます。しばらく待ってから再試行してください' });
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
  createToken,
  currentUser,
  cookieOptions,
  requireAuth,
  inviteRequired,
  verifyInvite,
  rateLimit,
  clearAttempts,
};
