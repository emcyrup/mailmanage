'use strict';

const PRESETS = {
  gmail: {
    host: 'imap.gmail.com',
    port: 993,
    hint: 'Gmail は2段階認証を有効にした上で「アプリパスワード」を発行し、それをパスワード欄に入力してください(通常のパスワードは使えません)。',
  },
  outlook: {
    host: 'outlook.office365.com',
    port: 993,
    hint: 'Outlook.com はアプリパスワードが必要な場合があります。',
  },
  'yahoo-jp': {
    host: 'imap.mail.yahoo.co.jp',
    port: 993,
    hint: 'Yahoo!メールは設定で IMAP アクセスを有効にしてください。',
  },
  icloud: {
    host: 'imap.mail.me.com',
    port: 993,
    hint: 'iCloud は Apple ID の「アプリ用パスワード」を発行して入力してください。',
  },
};

const $ = (sel) => document.querySelector(sel);

const cardsEl = $('#cards');
const emptyEl = $('#empty');
const summaryEl = $('#summary');
const dialog = $('#add-dialog');
const form = $('#add-form');

let refreshTimer = null;

// 401ならログインページへ飛ばす fetch ラッパー
async function api(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    location.replace('/login.html');
    throw new Error('unauthorized');
  }
  return res;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function renderLoading(accounts) {
  emptyEl.classList.toggle('hidden', accounts.length > 0);
  summaryEl.classList.add('hidden');
  cardsEl.innerHTML = accounts
    .map(
      (a) => `
      <section class="card loading" data-id="${a.id}">
        <header class="card-header">
          <div>
            <h2>${escapeHtml(a.label)}</h2>
            <p class="email">${escapeHtml(a.email)}</p>
          </div>
          <span class="badge badge-loading">確認中…</span>
        </header>
        <div class="spinner"></div>
      </section>`
    )
    .join('');
}

function renderResults(results) {
  const totalUnseen = results.filter((r) => r.ok).reduce((n, r) => n + r.unseen, 0);
  const errors = results.filter((r) => !r.ok).length;
  summaryEl.classList.remove('hidden');
  summaryEl.innerHTML =
    `未読合計: <strong>${totalUnseen}</strong> 件 / ${results.length} アカウント` +
    (errors ? ` <span class="summary-error">(${errors} 件のアカウントでエラー)</span>` : '');

  cardsEl.innerHTML = results.map(renderCard).join('');

  cardsEl.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.card').dataset.id;
      if (!confirm('このアカウントを削除しますか?')) return;
      await api(`/api/accounts/${id}`, { method: 'DELETE' });
      refresh();
    });
  });
}

function renderCard(r) {
  const a = r.account;
  if (!r.ok) {
    return `
      <section class="card card-error" data-id="${a.id}">
        <header class="card-header">
          <div>
            <h2>${escapeHtml(a.label)}</h2>
            <p class="email">${escapeHtml(a.email)}</p>
          </div>
          <span class="badge badge-error">エラー</span>
        </header>
        <p class="error-detail">${escapeHtml(r.error)}</p>
        <footer class="card-footer">
          <button class="link delete-btn">削除</button>
        </footer>
      </section>`;
  }

  const rows = r.recent
    .map(
      (m) => `
      <li class="${m.seen ? 'seen' : 'unseen'}">
        <span class="msg-from" title="${escapeHtml(m.from)}">${escapeHtml(m.from)}</span>
        <span class="msg-subject">${escapeHtml(m.subject)}</span>
        <span class="msg-date">${formatDate(m.date)}</span>
      </li>`
    )
    .join('');

  return `
    <section class="card" data-id="${a.id}">
      <header class="card-header">
        <div>
          <h2>${escapeHtml(a.label)}</h2>
          <p class="email">${escapeHtml(a.email)}</p>
        </div>
        <span class="badge ${r.unseen > 0 ? 'badge-unseen' : 'badge-zero'}">未読 ${r.unseen}</span>
      </header>
      <p class="meta">全 ${r.total} 件 ・ ${formatDate(r.checkedAt)} 時点</p>
      <ul class="messages">${rows || '<li class="none">メールはありません</li>'}</ul>
      <footer class="card-footer">
        <button class="link delete-btn">削除</button>
      </footer>
    </section>`;
}

async function refresh() {
  const accounts = await (await api('/api/accounts')).json();
  renderLoading(accounts);
  if (accounts.length === 0) {
    cardsEl.innerHTML = '';
    return;
  }
  const results = await (await api('/api/status')).json();
  renderResults(results);
}

// ---- アカウント追加ダイアログ ----

function applyPreset() {
  const preset = PRESETS[$('#preset').value];
  $('#preset-hint').textContent = preset ? preset.hint : '';
  if (preset) {
    form.elements.host.value = preset.host;
    form.elements.port.value = preset.port;
  }
}

$('#preset').addEventListener('change', applyPreset);

$('#add-btn').addEventListener('click', () => {
  form.reset();
  $('#add-error').classList.add('hidden');
  applyPreset();
  dialog.showModal();
});

$('#cancel-btn').addEventListener('click', () => dialog.close());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const res = await api('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const el = $('#add-error');
    el.textContent = err.error || '追加に失敗しました';
    el.classList.remove('hidden');
    return;
  }
  dialog.close();
  refresh();
});

// ---- 更新まわり ----

$('#refresh-btn').addEventListener('click', refresh);

$('#auto-refresh').addEventListener('change', (e) => {
  clearInterval(refreshTimer);
  refreshTimer = null;
  if (e.target.checked) {
    refreshTimer = setInterval(refresh, 60_000);
  }
});

// ---- 認証 ----

const logoutBtn = $('#logout-btn');

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.replace('/login.html');
});

fetch('/api/auth')
  .then((r) => r.json())
  .then(({ enabled, authenticated }) => {
    if (enabled && !authenticated) {
      location.replace('/login.html');
      return;
    }
    if (enabled) logoutBtn.classList.remove('hidden');
    refresh();
  })
  .catch(() => refresh());
