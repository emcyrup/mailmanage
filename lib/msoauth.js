'use strict';

const crypto = require('crypto');
const store = require('./store');

const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
// IMAP アクセス + リフレッシュトークン + メールアドレス取得
const SCOPES = 'https://outlook.office365.com/IMAP.AccessAsUser.All offline_access openid email';
const STATE_TTL_MS = 10 * 60 * 1000;

// アカウントごとのアクセストークンキャッシュ(約1時間有効)
const tokenCache = new Map();

function configured() {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

function redirectUri(req) {
  const base = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/oauth/microsoft/callback`;
}

// ---- CSRF対策のstate(署名付き・10分有効) ----

function stateKey() {
  return crypto.createHmac('sha256', store.getKey()).update('mailmanage-oauth-state').digest();
}

function createState(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyState(state) {
  if (typeof state !== 'string') return null;
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const expected = crypto.createHmac('sha256', stateKey()).update(payload).digest('base64url');
  const sig = state.slice(dot + 1);
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

// ---- OAuth フロー ----

function buildAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(req),
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
  return `${AUTH_BASE}/authorize?${params}`;
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      ...params,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Microsoft token endpoint error (${res.status})`);
  }
  return data;
}

// 認可コードをトークンに交換し、アカウントのメールアドレスも取り出す
async function exchangeCode(req, code) {
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(req),
  });
  let email = null;
  if (data.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8'));
      email = payload.preferred_username || payload.email || null;
    } catch (_) {
      /* id_token が読めなくても致命的ではない */
    }
  }
  if (!email) throw new Error('Microsoftアカウントのメールアドレスを取得できませんでした');
  if (!data.refresh_token) throw new Error('リフレッシュトークンを取得できませんでした(offline_access スコープを確認してください)');
  return { email, refreshToken: data.refresh_token };
}

// アカウントの有効なアクセストークンを返す(必要ならリフレッシュ、
// リフレッシュトークンがローテーションされたら保存し直す)
async function getAccessToken(account) {
  const cached = tokenCache.get(account.id);
  if (cached && cached.exp > Date.now() + 60000) return cached.token;

  const data = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: account.password, // 復号済みリフレッシュトークン
    scope: SCOPES,
  });
  tokenCache.set(account.id, {
    token: data.access_token,
    exp: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  });
  if (data.refresh_token && data.refresh_token !== account.password) {
    store.updateAccount(account.ownerId, account.id, { password: data.refresh_token });
  }
  return data.access_token;
}

function dropCache(accountId) {
  tokenCache.delete(accountId);
}

module.exports = { configured, createState, verifyState, buildAuthUrl, exchangeCode, getAccessToken, dropCache };
