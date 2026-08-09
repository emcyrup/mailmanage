'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

function loadUsers() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('base64')}.${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
    const check = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(hash, check);
  } catch (_) {
    return false;
  }
}

function hasUsers() {
  return loadUsers().length > 0;
}

function getById(id) {
  return loadUsers().find((u) => u.id === id) || null;
}

function getByUsername(username) {
  if (typeof username !== 'string') return null;
  const name = username.toLowerCase();
  return loadUsers().find((u) => u.username.toLowerCase() === name) || null;
}

// 戻り値: {user} または {error}
function createUser(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return { error: 'ユーザー名は3〜32文字の英数字・ピリオド・ハイフン・アンダースコアで入力してください' };
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください` };
  }
  if (getByUsername(username)) {
    return { error: 'このユーザー名は既に使われています' };
  }
  const users = loadUsers();
  const user = {
    id: crypto.randomUUID(),
    username,
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return { user };
}

// 戻り値: user または null
function authenticate(username, password) {
  const user = getByUsername(username);
  if (!user) {
    // ユーザーの存在有無で応答時間が変わらないようダミー検証
    verifyPassword(String(password), 'AA==.AA==');
    return null;
  }
  return verifyPassword(String(password), user.password) ? user : null;
}

module.exports = { hasUsers, getById, getByUsername, createUser, authenticate };
