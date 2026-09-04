const crypto = require('crypto');

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const sessions = new Map();
const pendingLogins = new Map();

function requireCredentials() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    const error = new Error('Spotify credentials are not configured on the server');
    error.code = 'SPOTIFY_CONFIG_ERROR';
    error.status = 503;
    throw error;
  }
}

function randomString(size = 48) {
  return crypto.randomBytes(size).toString('base64url');
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    if (index === -1) return [];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(pair => pair.length === 2));
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function publicOrigin(req) {
  return process.env.PUBLIC_ORIGIN || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
}

function redirectUri(req) {
  return `${publicOrigin(req)}/`;
}

function setCookies(res, values) {
  const existing = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), ...values]);
}

async function beginLogin(req, res) {
  requireCredentials();
  const state = randomString(24);
  const verifier = randomString(64);
  pendingLogins.set(state, { verifier, createdAt: Date.now() });
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(req),
    code_challenge_method: 'S256',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    state,
    scope: 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state'
  });
  setCookies(res, [cookie('aura_oauth_state', state, { maxAge: 600 })]);
  res.writeHead(302, { Location: `${AUTHORIZE_URL}?${params}` });
  res.end();
}

async function exchangeCode(req, code, verifier) {
  const credentials = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req), code_verifier: verifier })
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.error_description || 'Spotify user authorization failed');
    error.code = 'SPOTIFY_USER_AUTH_ERROR';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function completeLogin(req, res, query) {
  requireCredentials();
  if (query.get('error')) {
    res.writeHead(302, { Location: `/?spotify_error=${encodeURIComponent(query.get('error'))}` });
    return res.end();
  }
  const state = query.get('state');
  const code = query.get('code');
  const cookies = parseCookies(req);
  const pending = state && pendingLogins.get(state);
  pendingLogins.delete(state);
  if (!code || !state || cookies.aura_oauth_state !== state || !pending || Date.now() - pending.createdAt > 600000) {
    const error = new Error('Spotify OAuth state validation failed');
    error.code = 'SPOTIFY_OAUTH_STATE_ERROR';
    error.status = 400;
    throw error;
  }
  const token = await exchangeCode(req, code, pending.verifier);
  const sessionId = randomString(32);
  sessions.set(sessionId, { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 });
  setCookies(res, [cookie('aura_oauth_state', '', { maxAge: 0 }), cookie('aura_session', sessionId, { maxAge: 60 * 60 * 24 * 30 })]);
  res.writeHead(302, { Location: '/' });
  res.end();
}

async function refreshSession(session) {
  if (!session.refreshToken) return null;
  const credentials = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken })
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) return null;
  session.accessToken = payload.access_token;
  session.expiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
  if (payload.refresh_token) session.refreshToken = payload.refresh_token;
  return session.accessToken;
}

async function getUserToken(req) {
  const sessionId = parseCookies(req).aura_session;
  const session = sessionId && sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() < session.expiresAt - 60_000) return session.accessToken;
  return refreshSession(session);
}

async function handle(req, res, pathname, query) {
  if (pathname === '/api/spotify/login') return beginLogin(req, res);
  if (pathname === '/api/spotify/callback') return completeLogin(req, res, query);
  if (pathname === '/api/spotify/token') {
    const token = await getUserToken(req);
    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: false, error: { code: 'SPOTIFY_USER_UNAUTHORIZED', message: 'Spotify login required' } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ success: true, data: { accessToken: token } }));
  }
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [state, value] of pendingLogins) if (value.createdAt < cutoff) pendingLogins.delete(state);
}, 10 * 60 * 1000).unref();

module.exports = { handle, completeLogin };
