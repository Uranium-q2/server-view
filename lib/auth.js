const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
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
const client = CLIENT_ID ? new OAuth2Client(CLIENT_ID) : null;

function isConfigured() {
  return Boolean(CLIENT_ID) && ALLOWED_EMAILS.length > 0;
}

function isAllowedEmail(email) {
  return ALLOWED_EMAILS.includes((email || '').toLowerCase());
}

async function verifyGoogleToken(idToken) {
  if (!client) throw new Error('GOOGLE_CLIENT_ID is not configured');
  const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_ID });
  return ticket.getPayload(); // { email, email_verified, name, picture, ... }
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function createSessionCookie(user) {
  const payload = base64url(JSON.stringify({ email: user.email, name: user.name, exp: Date.now() + SESSION_TTL_MS }));
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
  isAllowedEmail,
  verifyGoogleToken,
  createSessionCookie,
  verifySessionValue,
  parseRawCookies,
  getSessionFromRequest,
  requireAuth,
  CLIENT_ID
};
