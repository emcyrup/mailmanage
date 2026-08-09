'use strict';

fetch('/api/auth')
  .then((r) => r.json())
  .then(({ authenticated, hasUsers, inviteRequired }) => {
    if (authenticated) {
      location.replace('/');
      return;
    }
    if (inviteRequired) {
      document.querySelector('#invite-label').classList.remove('hidden');
      document.querySelector('#invite-label input').required = true;
    }
    if (!hasUsers) {
      document.querySelector('#signup-lead').textContent =
        '最初のユーザーを登録してください';
    }
  })
  .catch(() => {});

document.querySelector('#signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const errorEl = document.querySelector('#signup-error');
  errorEl.classList.add('hidden');

  if (data.password !== data.confirm) {
    errorEl.textContent = 'パスワードが一致しません';
    errorEl.classList.remove('hidden');
    return;
  }
  delete data.confirm;

  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (res.ok) {
    location.replace('/');
    return;
  }
  const err = await res.json().catch(() => ({}));
  errorEl.textContent = err.error || '登録に失敗しました';
  errorEl.classList.remove('hidden');
});
