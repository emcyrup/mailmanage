'use strict';

const path = require('path');
const express = require('express');
const store = require('./lib/store');
const imap = require('./lib/imap');
const auth = require('./lib/auth');
const users = require('./lib/users');
const msoauth = require('./lib/msoauth');

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
    msOauthConfigured: msoauth.configured(),
  });
});

// ---- Microsoft OAuth(Outlook連携) ----

app.get('/api/oauth/microsoft/start', (req, res) => {
  const user = auth.currentUser(req);
  if (!user) return res.redirect('/login.html');
  if (!msoauth.configured()) {
    return res.status(400).send('Microsoft連携は未設定です(MS_CLIENT_ID / MS_CLIENT_SECRET が必要)');
  }
  res.redirect(msoauth.buildAuthUrl(req, msoauth.createState(user.id)));
});

app.get('/api/oauth/microsoft/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const uid = msoauth.verifyState(state);
  if (!uid) return res.redirect('/?oauth=' + encodeURIComponent('認証セッションが無効です。もう一度お試しください'));
  if (error || !code) {
    return res.redirect('/?oauth=' + encodeURIComponent(errorDescription || error || '認証がキャンセルされました'));
  }
  try {
    const { email, refreshToken } = await msoauth.exchangeCode(req, code);
    store.addAccount(uid, {
      label: `${email} (Microsoft)`,
      email,
      host: 'outlook.office365.com',
      port: 993,
      user: email,
      password: refreshToken,
      authType: 'ms-oauth',
    });
    res.redirect('/?oauth=ok');
  } catch (err) {
    res.redirect('/?oauth=' + encodeURIComponent(err.message));
  }
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
  msoauth.dropCache(req.params.id);
  res.status(204).end();
});

// ---- 受信箱の状態チェック(要ログイン・自分のアカウントのみ) ----

// OAuth アカウントは接続前にアクセストークンを取得する。
// 失敗しても他のアカウントのチェックは続行できるよう tokenError に記録する。
async function resolveAuth(account) {
  if (account.authType !== 'ms-oauth') return account;
  try {
    return { ...account, accessToken: await msoauth.getAccessToken(account) };
  } catch (err) {
    return { ...account, tokenError: `Microsoft認証の更新に失敗しました: ${err.message}(再連携が必要です)` };
  }
}

app.get('/api/status', auth.requireAuth, async (req, res) => {
  const accounts = await Promise.all(store.listAccountsWithPassword(req.user.id).map(resolveAuth));
  const results = await imap.checkAll(accounts);
  res.json(results);
});

app.get('/api/status/:id', auth.requireAuth, async (req, res) => {
  const stored = store.getAccountWithPassword(req.user.id, req.params.id);
  if (!stored) return res.status(404).json({ error: 'アカウントが見つかりません' });
  const account = await resolveAuth(stored);
  const { password, accessToken, ...safe } = account;
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
