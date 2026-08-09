'use strict';

const { ImapFlow } = require('imapflow');

const CONNECT_TIMEOUT_MS = 15000;
const RECENT_COUNT = 10;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function formatAddress(addr) {
  if (!addr || !addr.length) return '';
  const a = addr[0];
  return a.name ? `${a.name} <${a.address}>` : a.address || '';
}

// 1アカウントの受信箱の状態(未読数・合計・最新メール)を取得する
async function checkInbox(account) {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.port !== 143,
    auth: { user: account.user, pass: account.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
  });

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, '接続がタイムアウトしました');

    const status = await client.status('INBOX', { messages: true, unseen: true });

    const recent = [];
    const lock = await client.getMailboxLock('INBOX');
    try {
      const total = client.mailbox.exists;
      if (total > 0) {
        const from = Math.max(1, total - RECENT_COUNT + 1);
        for await (const msg of client.fetch(`${from}:*`, { envelope: true, flags: true })) {
          recent.push({
            subject: msg.envelope.subject || '(件名なし)',
            from: formatAddress(msg.envelope.from),
            date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
            seen: msg.flags.has('\\Seen'),
          });
        }
      }
    } finally {
      lock.release();
    }
    recent.reverse(); // 新しい順に

    await client.logout();

    return {
      ok: true,
      total: status.messages,
      unseen: status.unseen,
      recent,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    try {
      client.close();
    } catch (_) {
      /* already closed */
    }
    return {
      ok: false,
      error: err.responseText || err.message || String(err),
      checkedAt: new Date().toISOString(),
    };
  }
}

// 全アカウントを並列でチェック
async function checkAll(accounts) {
  const results = await Promise.all(
    accounts.map(async (account) => {
      const { password, ...safe } = account;
      const result = await checkInbox(account);
      return { account: safe, ...result };
    })
  );
  return results;
}

module.exports = { checkInbox, checkAll };
