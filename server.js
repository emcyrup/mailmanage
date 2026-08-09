'use strict';

const path = require('path');
const express = require('express');
const store = require('./lib/store');
const imap = require('./lib/imap');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// アカウント一覧(パスワードは含まない)
app.get('/api/accounts', (req, res) => {
  res.json(store.listAccounts());
});

// アカウント追加
app.post('/api/accounts', (req, res) => {
  const { label, email, host, port, user, password } = req.body || {};
  if (!email || !host || !password) {
    return res.status(400).json({ error: 'email, host, password は必須です' });
  }
  const account = store.addAccount({ label, email, host, port, user, password });
  res.status(201).json(account);
});

// アカウント更新
app.put('/api/accounts/:id', (req, res) => {
  const updated = store.updateAccount(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'アカウントが見つかりません' });
  res.json(updated);
});

// アカウント削除
app.delete('/api/accounts/:id', (req, res) => {
  const ok = store.deleteAccount(req.params.id);
  if (!ok) return res.status(404).json({ error: 'アカウントが見つかりません' });
  res.status(204).end();
});

// 全アカウントの受信箱の状態をチェック
app.get('/api/status', async (req, res) => {
  const accounts = store.listAccountsWithPassword();
  const results = await imap.checkAll(accounts);
  res.json(results);
});

// 1アカウントだけチェック
app.get('/api/status/:id', async (req, res) => {
  const account = store.getAccountWithPassword(req.params.id);
  if (!account) return res.status(404).json({ error: 'アカウントが見つかりません' });
  const { password, ...safe } = account;
  const result = await imap.checkInbox(account);
  res.json({ account: safe, ...result });
});

app.listen(PORT, () => {
  console.log(`mailmanage: http://localhost:${PORT} で起動しました`);
});
