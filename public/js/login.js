const errorEl = document.getElementById('loginError');
const warningEl = document.getElementById('configWarning');

function returnToPath() {
  const params = new URLSearchParams(location.search);
  return params.get('returnTo') || '/index.html';
}

async function onCredential(response) {
  errorEl.textContent = '';
  try {
    const res = await fetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Sign-in failed.';
      return;
    }
    location.href = returnToPath();
  } catch (err) {
    errorEl.textContent = 'Sign-in failed. Is the server running?';
  }
}

async function init() {
  try {
    const res = await fetch('/auth/config');
    const cfg = await res.json();

    if (!cfg.configured) {
      warningEl.textContent = 'Google login is not configured yet: set GOOGLE_CLIENT_ID and ALLOWED_EMAILS in .env, then restart the server.';
      return;
    }

    const render = () => {
      if (!window.google || !window.google.accounts) return setTimeout(render, 100);
      google.accounts.id.initialize({ client_id: cfg.clientId, callback: onCredential });
      google.accounts.id.renderButton(document.getElementById('googleBtn'), {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill'
      });
    };
    render();
  } catch (err) {
    warningEl.textContent = 'Could not reach the server.';
  }
}

init();
