const { getAccessToken, clearAccessToken } = require('./spotifyAuth');

const API_BASE = 'https://api.spotify.com/v1';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;

class SpotifyRequestError extends Error {
  constructor(message, code, status, retryAfter) {
    super(message);
    this.name = 'SpotifyRequestError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function spotifyRequest(endpoint, options = {}, attempt = 0) {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401 && attempt === 0) {
      console.warn('[SPOTIFY] Cached token rejected; refreshing once');
      clearAccessToken();
      return spotifyRequest(endpoint, options, attempt + 1);
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = Number(retryAfterHeader || 0);
      if (attempt < MAX_RETRIES && retryAfterSeconds <= 5) {
        console.warn(`[SPOTIFY] Rate limited; retrying attempt ${attempt + 1}`);
        await sleep(Math.max(250, retryAfterSeconds * 1000));
        return spotifyRequest(endpoint, options, attempt + 1);
      }
      throw new SpotifyRequestError(
        'Spotify is temporarily rate limiting requests',
        'SPOTIFY_RATE_LIMITED',
        429,
        retryAfterHeader
      );
    }

    if (!response.ok) {
      throw new SpotifyRequestError(
        'Spotify could not complete the request',
        'SPOTIFY_API_ERROR',
        response.status
      );
    }

    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      if (attempt < MAX_RETRIES) {
        console.warn(`[SPOTIFY] Request timed out; retrying attempt ${attempt + 1}`);
        return spotifyRequest(endpoint, options, attempt + 1);
      }
      throw new SpotifyRequestError('Spotify request timed out', 'SPOTIFY_TIMEOUT', 504);
    }
    if (error instanceof SpotifyRequestError) throw error;
    if (attempt < MAX_RETRIES) {
      console.warn(`[SPOTIFY] Network error; retrying attempt ${attempt + 1}`);
      await sleep(250 * (attempt + 1));
      return spotifyRequest(endpoint, options, attempt + 1);
    }
    throw new SpotifyRequestError('Unable to connect to Spotify', 'SPOTIFY_NETWORK_ERROR', 502);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { spotifyRequest, SpotifyRequestError };
