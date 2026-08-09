'use strict';

// ログイン済みならダッシュボードへ、ユーザーが1人もいなければ登録ページへ
fetch('/api/auth')
  .then((r) => r.json())
  .then(({ authenticated, hasUsers }) => {
    if (authenticated) location.replace('/');
    else if (!hasUsers) location.replace('/signup.html');
  })
  .catch(() => {});

document.querySelector('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const errorEl = document.querySelector('#login-error');
  errorEl.classList.add('hidden');

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (res.ok) {
    location.replace('/');
    return;
  }
  const err = await res.json().catch(() => ({}));
  errorEl.textContent = err.error || 'ログインに失敗しました';
  errorEl.classList.remove('hidden');
});
