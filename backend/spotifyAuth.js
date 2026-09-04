const TOKEN_URL = 'https://accounts.spotify.com/api/token';

let accessToken = null;
let expiresAt = 0;
let tokenRequestPromise = null;

function requireCredentials() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    const error = new Error('Spotify credentials are not configured on the server');
    error.code = 'SPOTIFY_CONFIG_ERROR';
    throw error;
  }
}

async function getAccessToken() {
  requireCredentials();

  const safetyMarginMs = 60_000;
  if (accessToken && Date.now() < expiresAt - safetyMarginMs) {
    return accessToken;
  }
  if (tokenRequestPromise) return tokenRequestPromise;

  tokenRequestPromise = requestNewToken();
  try {
    return await tokenRequestPromise;
  } finally {
    tokenRequestPromise = null;
  }
}

async function requestNewToken() {
  console.log('[AUTH] Requesting a new Spotify access token');
  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    accessToken = null;
    expiresAt = 0;
    const error = new Error('Spotify authentication failed');
    error.code = 'SPOTIFY_AUTH_ERROR';
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  if (!payload.access_token || !payload.expires_in) {
    const error = new Error('Spotify returned an invalid authentication response');
    error.code = 'SPOTIFY_AUTH_ERROR';
    throw error;
  }

  accessToken = payload.access_token;
  expiresAt = Date.now() + Number(payload.expires_in) * 1000;
  return accessToken;
}

function clearAccessToken() {
  accessToken = null;
  expiresAt = 0;
  tokenRequestPromise = null;
}

module.exports = { getAccessToken, clearAccessToken };
