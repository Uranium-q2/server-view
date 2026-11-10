const errorEl = document.getElementById('loginError');
const warningEl = document.getElementById('configWarning');
const discordBtn = document.getElementById('discordBtn');

function returnToPath() {
  const params = new URLSearchParams(location.search);
  return params.get('returnTo') || '/index.html';
}

const urlError = new URLSearchParams(location.search).get('error');
if (urlError) errorEl.textContent = urlError;

discordBtn.href = `/auth/discord?returnTo=${encodeURIComponent(returnToPath())}`;

fetch('/auth/config')
  .then((res) => res.json())
  .then((cfg) => {
    if (!cfg.configured) {
      warningEl.textContent = 'Discord login is not configured yet: set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI and ALLOWED_DISCORD_IDS in .env, then restart the server.';
    }
  })
  .catch(() => {
    warningEl.textContent = 'Could not reach the server.';
  });
