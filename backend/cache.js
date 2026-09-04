const cache = new Map();

function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  console.log(`[CACHE] HIT ${key}`);
  return entry.data;
}

function set(key, data, ttlMs = 5 * 60 * 1000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  console.log(`[CACHE] SET ${key}`);
  return data;
}

function clear() {
  cache.clear();
}

module.exports = { get, set, clear };
