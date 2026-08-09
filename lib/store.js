'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const KEY_FILE = path.join(DATA_DIR, '.key');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// パスワード暗号化用の鍵。環境変数 MAILMANAGE_SECRET が優先、
// 無ければ初回起動時に data/.key を生成して使う。
function getKey() {
  if (process.env.MAILMANAGE_SECRET) {
    return crypto.createHash('sha256').update(process.env.MAILMANAGE_SECRET).digest();
  }
  ensureDataDir();
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
  }
  return fs.readFileSync(KEY_FILE);
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function decrypt(payload) {
  const [iv, tag, data] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function loadAccounts() {
  ensureDataDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
}

function saveAccounts(accounts) {
  ensureDataDir();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });
}

function ownedBy(ownerId) {
  return loadAccounts().filter((a) => a.ownerId === ownerId);
}

function listAccounts(ownerId) {
  // パスワードは返さない
  return ownedBy(ownerId).map(({ password, ...rest }) => rest);
}

function getAccountWithPassword(ownerId, id) {
  const account = ownedBy(ownerId).find((a) => a.id === id);
  if (!account) return null;
  return { ...account, password: decrypt(account.password) };
}

function listAccountsWithPassword(ownerId) {
  return ownedBy(ownerId).map((a) => ({ ...a, password: decrypt(a.password) }));
}

function addAccount(ownerId, { label, email, host, port, user, password, authType }) {
  const accounts = loadAccounts();
  const account = {
    id: crypto.randomUUID(),
    ownerId,
    label: label || email,
    email,
    host,
    port: Number(port) || 993,
    user: user || email,
    // password 欄には通常パスワードまたは OAuth のリフレッシュトークンが入る
    authType: authType || 'password',
    password: encrypt(password),
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  saveAccounts(accounts);
  const { password: _, ...safe } = account;
  return safe;
}

function updateAccount(ownerId, id, fields) {
  const accounts = loadAccounts();
  const account = accounts.find((a) => a.id === id && a.ownerId === ownerId);
  if (!account) return null;
  for (const key of ['label', 'email', 'host', 'user']) {
    if (fields[key] !== undefined && fields[key] !== '') account[key] = fields[key];
  }
  if (fields.port !== undefined && fields.port !== '') account.port = Number(fields.port);
  if (fields.password) account.password = encrypt(fields.password);
  saveAccounts(accounts);
  const { password: _, ...safe } = account;
  return safe;
}

function deleteAccount(ownerId, id) {
  const accounts = loadAccounts();
  const next = accounts.filter((a) => !(a.id === id && a.ownerId === ownerId));
  if (next.length === accounts.length) return false;
  saveAccounts(next);
  return true;
}

// 旧バージョン(ユーザー機能なし)で登録された ownerId 無しのアカウントを
// 指定ユーザーに引き継ぐ。最初のユーザー登録時に呼ばれる。
function adoptOrphanAccounts(ownerId) {
  const accounts = loadAccounts();
  let changed = false;
  for (const a of accounts) {
    if (!a.ownerId) {
      a.ownerId = ownerId;
      changed = true;
    }
  }
  if (changed) saveAccounts(accounts);
}

module.exports = {
  getKey,
  listAccounts,
  listAccountsWithPassword,
  getAccountWithPassword,
  addAccount,
  updateAccount,
  deleteAccount,
  adoptOrphanAccounts,
};
