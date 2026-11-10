const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const ALLOWED_IDS = (process.env.ALLOWED_DISCORD_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const COOKIE_NAME = 'sv_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const SECRET_FILE = path.join(__dirname, '..', 'data', 'session-secret.txt');

function loadOrCreateSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dataDir = path.dirname(SECRET_FILE);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}

const SECRET = loadOrCreateSecret();

function isConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI) && ALLOWED_IDS.length > 0;
}

function isAllowedUser(discordId) {
  return ALLOWED_IDS.includes(String(discordId));
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify'
  });
  if (state) params.set('state', state);
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForUser(code) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    })
  });
  if (!tokenRes.ok) throw new Error(`Discord token exchange failed (${tokenRes.status})`);
  const token = await tokenRes.json();

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  if (!userRes.ok) throw new Error(`Discord user fetch failed (${userRes.status})`);
  return userRes.json(); // { id, username, discriminator, avatar, ... }
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function createSessionCookie(user) {
  const payload = base64url(JSON.stringify({
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    exp: Date.now() + SESSION_TTL_MS
  }));
  return `${payload}.${sign(payload)}`;
}

function verifySessionValue(value) {
  if (!value || !value.includes('.')) return null;
  const [payload, sig] = value.split('.');
  if (sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function parseRawCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function getSessionFromRequest(req) {
  const raw = (req.cookies && req.cookies[COOKIE_NAME]) || parseRawCookies(req.headers.cookie)[COOKIE_NAME];
  return verifySessionValue(raw);
}

const PUBLIC_PATHS = new Set(['/login.html', '/js/login.js', '/css/style.css']);

function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();

  const session = getSessionFromRequest(req);
  if (session) {
    req.user = session;
    return next();
  }
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect(`/login.html?returnTo=${encodeURIComponent(req.originalUrl)}`);
}

module.exports = {
  COOKIE_NAME,
  isConfigured,
  isAllowedUser,
  buildAuthorizeUrl,
  exchangeCodeForUser,
  createSessionCookie,
  verifySessionValue,
  parseRawCookies,
  getSessionFromRequest,
  requireAuth
};
