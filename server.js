'use strict';

const path = require('path');
const express = require('express');
const store = require('./lib/store');
const imap = require('./lib/imap');
const auth = require('./lib/auth');
const users = require('./lib/users');

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
  const user = auth.currentUser(req);
  res.json({
    authenticated: Boolean(user),
    username: user ? user.username : null,
    hasUsers: users.hasUsers(),
    inviteRequired: auth.inviteRequired(),
  });
});

app.post('/api/signup', auth.rateLimit, (req, res) => {
  const { username, password, invite } = req.body || {};
  if (!auth.verifyInvite(invite)) {
    return res.status(403).json({ error: '招待コードが違います' });
  }
  const isFirstUser = !users.hasUsers();
  const result = users.createUser(username, password);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  // 旧バージョン(ユーザー機能なし)のアカウントは最初のユーザーが引き継ぐ
  if (isFirstUser) store.adoptOrphanAccounts(result.user.id);
  auth.clearAttempts(req);
  res.cookie(auth.COOKIE_NAME, auth.createToken(result.user.id), auth.cookieOptions(req));
  res.status(201).json({ ok: true, username: result.user.username });
});

app.post('/api/login', auth.rateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const user = users.authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  }
  auth.clearAttempts(req);
  res.cookie(auth.COOKIE_NAME, auth.createToken(user.id), auth.cookieOptions(req));
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(auth.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ---- アカウント管理(要ログイン・自分のアカウントのみ) ----

app.get('/api/accounts', auth.requireAuth, (req, res) => {
  res.json(store.listAccounts(req.user.id));
});

app.post('/api/accounts', auth.requireAuth, (req, res) => {
  const { label, email, host, port, user, password } = req.body || {};
  if (!email || !host || !password) {
    return res.status(400).json({ error: 'email, host, password は必須です' });
  }
  const account = store.addAccount(req.user.id, { label, email, host, port, user, password });
  res.status(201).json(account);
});

app.put('/api/accounts/:id', auth.requireAuth, (req, res) => {
  const updated = store.updateAccount(req.user.id, req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'アカウントが見つかりません' });
  res.json(updated);
});

app.delete('/api/accounts/:id', auth.requireAuth, (req, res) => {
  const ok = store.deleteAccount(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'アカウントが見つかりません' });
  res.status(204).end();
});

// ---- 受信箱の状態チェック(要ログイン・自分のアカウントのみ) ----

app.get('/api/status', auth.requireAuth, async (req, res) => {
  const accounts = store.listAccountsWithPassword(req.user.id);
  const results = await imap.checkAll(accounts);
  res.json(results);
});

app.get('/api/status/:id', auth.requireAuth, async (req, res) => {
  const account = store.getAccountWithPassword(req.user.id, req.params.id);
  if (!account) return res.status(404).json({ error: 'アカウントが見つかりません' });
  const { password, ...safe } = account;
  const result = await imap.checkInbox(account);
  res.json({ account: safe, ...result });
});

app.listen(PORT, () => {
  console.log(`mailmanage: http://localhost:${PORT} で起動しました`);
  if (!auth.inviteRequired()) {
    console.warn(
      '注意: MAILMANAGE_INVITE_CODE が未設定のため、誰でもユーザー登録できます。' +
        'インターネットに公開する場合は設定を推奨します。'
    );
  }
});
