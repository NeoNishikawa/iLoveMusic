const http = require('http');
const fs = require('fs');
const path = require('path');
const { routeRequest, getHomeData } = require('./backend/routes');
const events = require('./backend/events');
const userAuth = require('./backend/userAuth');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const publicRoot = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: false, error: { code, message } }));
}

async function handleSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 5000\n\n');
  events.addClient(res);
  events.writeEvent(res, 'connected', { timestamp: Date.now() });

  try {
    const data = await getHomeData();
    events.writeEvent(res, 'home', { success: true, data });
  } catch (error) {
    console.error(`[SSE ERROR] ${error.code || error.message}`);
    // Kirim event dengan success: false agar frontend tahu data tidak bisa dimuat
    events.writeEvent(res, 'home', { 
      success: false, 
      error: { code: error.code || 'SPOTIFY_ERROR', message: error.message },
      data: null 
    });
  }

  req.on('close', () => events.removeClient(res));
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(publicRoot, safePath);
  if (!filePath.startsWith(publicRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendError(res, 404, 'NOT_FOUND', 'Resource not found');
  }
  res.writeHead(200, {
    'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=300'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  console.log(`[API] ${req.method} ${requestUrl.pathname}`);

  if (req.method !== 'GET' && requestUrl.pathname.startsWith('/api/')) {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported');
  }

  if (requestUrl.pathname === '/api/spotify/login' || requestUrl.pathname === '/api/spotify/callback' || requestUrl.pathname === '/api/spotify/token') {
    try {
      const handled = await userAuth.handle(req, res, requestUrl.pathname, requestUrl.searchParams);
      if (handled === false && !res.writableEnded) sendError(res, 404, 'NOT_FOUND', 'Auth route not found');
    } catch (error) {
      console.error(`[ERROR] ${error.code || 'SPOTIFY_USER_AUTH_ERROR'}: ${error.message}`);
      if (!res.writableEnded) sendError(res, error.status || 502, error.code || 'SPOTIFY_USER_AUTH_ERROR', error.message);
    }
    return;
  }

  if (requestUrl.pathname === '/api/events') {
    if (req.method !== 'GET') return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported');
    return handleSse(req, res);
  }

  if (requestUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: 'ok', service: 'ilovemusic' }));
    return;
  }

  if (requestUrl.pathname === '/' && (requestUrl.searchParams.has('code') || requestUrl.searchParams.has('error'))) {
    try {
      await userAuth.completeLogin(req, res, requestUrl.searchParams);
    } catch (error) {
      console.error(`[ERROR] ${error.code || 'SPOTIFY_USER_AUTH_ERROR'}: ${error.message}`);
      if (!res.writableEnded) sendError(res, error.status || 502, error.code || 'SPOTIFY_USER_AUTH_ERROR', error.message);
    }
    return;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    try {
      const handled = await routeRequest(req, res, requestUrl.pathname, requestUrl.searchParams);
      if (!handled && !res.writableEnded) sendError(res, 404, 'NOT_FOUND', 'API route not found');
    } catch (error) {
      console.error(`[ERROR] ${error.code || 'INTERNAL_ERROR'}: ${error.message}`);
      const status = error.status === 429 ? 429 : error.status === 404 ? 404 : 502;
      sendError(res, status, error.code || 'SPOTIFY_API_ERROR', error.message || 'Unable to fetch Spotify data');
    }
    return;
  }

  serveStatic(res, requestUrl.pathname);
});

// Refresh interval dikurangi menjadi 2 menit agar lebih responsif
const refreshMs = Math.max(60_000, Number(process.env.SSE_REFRESH_MS || 120_000));
const refreshTimer = setInterval(async () => {
  if (events.count() === 0) return;
  try {
    const data = await getHomeData();
    events.broadcast('home', { success: true, data });
  } catch (error) {
    console.error(`[ERROR] SSE refresh: ${error.code || error.message}`);
    events.broadcast('home', { 
      success: false, 
      error: { code: error.code || 'SPOTIFY_ERROR', message: error.message },
      data: null 
    });
  }
}, refreshMs);
const heartbeatTimer = setInterval(() => events.heartbeat(), 25_000);
refreshTimer.unref();
heartbeatTimer.unref();

server.listen(port, host, () => console.log(`[SERVER] Aura listening on http://${host}:${port}`));
