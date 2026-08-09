'use strict';

// すでにログイン済み(または認証無効)ならダッシュボードへ
fetch('/api/auth')
  .then((r) => r.json())
  .then(({ enabled, authenticated }) => {
    if (!enabled || authenticated) location.replace('/');
  })
  .catch(() => {});

document.querySelector('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = new FormData(e.target).get('password');
  const errorEl = document.querySelector('#login-error');
  errorEl.classList.add('hidden');

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (res.ok) {
    location.replace('/');
    return;
  }
  const err = await res.json().catch(() => ({}));
  errorEl.textContent = err.error || 'ログインに失敗しました';
  errorEl.classList.remove('hidden');
});
