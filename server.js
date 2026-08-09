'use strict';

const path = require('path');
const express = require('express');
const store = require('./lib/store');
const imap = require('./lib/imap');
const auth = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// リバースプロキシ(Render/Railway/nginx等)の背後で
// クライアントIPやHTTPS判定を正しく扱う
app.set('trust proxy', 1);

// セキュリティヘッダー
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  });
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- 認証 ----

app.get('/api/auth', (req, res) => {
  res.json({ enabled: auth.isEnabled(), authenticated: auth.isAuthenticated(req) });
});

app.post('/api/login', auth.rateLimitLogin, (req, res) => {
  if (!auth.isEnabled()) {
    return res.status(400).json({ error: '認証は設定されていません' });
  }
  if (!auth.verifyPassword((req.body || {}).password)) {
    return res.status(401).json({ error: 'パスワードが違います' });
  }
  auth.clearAttempts(req);
  res.cookie(auth.COOKIE_NAME, auth.createToken(), auth.cookieOptions(req));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(auth.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ---- アカウント管理(要ログイン) ----

app.get('/api/accounts', auth.requireAuth, (req, res) => {
  res.json(store.listAccounts());
});

app.post('/api/accounts', auth.requireAuth, (req, res) => {
  const { label, email, host, port, user, password } = req.body || {};
  if (!email || !host || !password) {
    return res.status(400).json({ error: 'email, host, password は必須です' });
  }
  const account = store.addAccount({ label, email, host, port, user, password });
  res.status(201).json(account);
});

app.put('/api/accounts/:id', auth.requireAuth, (req, res) => {
  const updated = store.updateAccount(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'アカウントが見つかりません' });
  res.json(updated);
});

app.delete('/api/accounts/:id', auth.requireAuth, (req, res) => {
  const ok = store.deleteAccount(req.params.id);
  if (!ok) return res.status(404).json({ error: 'アカウントが見つかりません' });
  res.status(204).end();
});

// ---- 受信箱の状態チェック(要ログイン) ----

app.get('/api/status', auth.requireAuth, async (req, res) => {
  const accounts = store.listAccountsWithPassword();
  const results = await imap.checkAll(accounts);
  res.json(results);
});

app.get('/api/status/:id', auth.requireAuth, async (req, res) => {
  const account = store.getAccountWithPassword(req.params.id);
  if (!account) return res.status(404).json({ error: 'アカウントが見つかりません' });
  const { password, ...safe } = account;
  const result = await imap.checkInbox(account);
  res.json({ account: safe, ...result });
});

app.listen(PORT, () => {
  console.log(`mailmanage: http://localhost:${PORT} で起動しました`);
  if (!auth.isEnabled()) {
    console.warn(
      '警告: MAILMANAGE_PASSWORD が未設定のため認証なしで動作しています。' +
        'インターネットに公開する場合は必ず設定してください。'
    );
  }
});
