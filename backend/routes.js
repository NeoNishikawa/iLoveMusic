const cache = require('./cache');
const { spotifyRequest } = require('./spotify');

const imageOf = item => item?.images?.[0]?.url || null;
const artistsOf = artists => (artists || []).map(artist => ({
  id: artist.id,
  name: artist.name,
  url: artist.external_urls?.spotify || null
}));

function normalizeTrack(track) {
  return {
    id: track.id,
    title: track.name,
    artists: artistsOf(track.artists),
    artist: (track.artists || []).map(a => a.name).join(', '),
    album: track.album ? {
      id: track.album.id,
      name: track.album.name,
      image: imageOf(track.album)
    } : null,
    duration: track.duration_ms || 0,
    durationMs: track.duration_ms || 0,
    previewUrl: track.preview_url || null,
    explicit: Boolean(track.explicit),
    popularity: track.popularity ?? null,
    spotifyUrl: track.external_urls?.spotify || null
  };
}

function normalizeArtist(artist) {
  return {
    id: artist.id,
    name: artist.name,
    image: imageOf(artist),
    images: artist.images || [],
    followers: artist.followers?.total ?? null,
    genres: artist.genres || [],
    popularity: artist.popularity ?? null,
    spotifyUrl: artist.external_urls?.spotify || null
  };
}

function normalizeAlbum(album) {
  return {
    id: album.id,
    title: album.name,
    name: album.name,
    image: imageOf(album),
    images: album.images || [],
    artist: (album.artists || []).map(a => a.name).join(', '),
    artists: artistsOf(album.artists),
    releaseDate: album.release_date || null,
    totalTracks: album.total_tracks || 0,
    tracks: (album.tracks?.items || []).map(normalizeTrack),
    spotifyUrl: album.external_urls?.spotify || null
  };
}

function normalizePlaylist(playlist) {
  return {
    id: playlist.id,
    title: playlist.name,
    name: playlist.name,
    image: imageOf(playlist),
    images: playlist.images || [],
    description: playlist.description || '',
    owner: playlist.owner?.display_name || playlist.owner?.id || null,
    totalTracks: playlist.tracks?.total || 0,
    spotifyUrl: playlist.external_urls?.spotify || null,
    tracks: (playlist.tracks?.items || []).map(item => item.track).filter(Boolean).map(normalizeTrack)
  };
}

function responseData(res, data) {
  res.json({ success: true, data });
}

function cached(key, loader, ttlMs) {
  const existing = cache.get(key);
  return existing ? Promise.resolve(existing) : loader().then(data => cache.set(key, data, ttlMs));
}

async function home() {
  return cached('home', async () => {
    const [tracks, artists, albums, playlists] = await Promise.all([
      spotifyRequest('/search?q=genre%3Aelectronic&type=track&limit=5'),
      spotifyRequest('/search?q=year%3A2025&type=artist&limit=6'),
      spotifyRequest('/browse/new-releases?limit=4'),
      spotifyRequest('/search?q=genre%3Aelectronic&type=playlist&limit=3')
    ]);

    const trending = (tracks?.tracks?.items || []).map(normalizeTrack);


    return {
      trending,
      artists: (artists.artists?.items || []).map(normalizeArtist),
      albums: (albums.albums?.items || []).map(normalizeAlbum),
      playlists: (playlists.playlists?.items || []).map(normalizePlaylist),
      genres: []
    };
  }, 120000);
}

async function search(query, types = 'track,artist,album,playlist') {
  const params = new URLSearchParams({ q: query, type: types, limit: '10' });
  return cached(`search:${params.toString()}`, async () => {
    const data = await spotifyRequest(`/search?${params}`);
    return {
      tracks: (data.tracks?.items || []).map(normalizeTrack),
      artists: (data.artists?.items || []).map(normalizeArtist),
      albums: (data.albums?.items || []).map(normalizeAlbum),
      playlists: (data.playlists?.items || []).map(normalizePlaylist)
    };
  }, 30000);
}

async function routeRequest(req, res, pathname, query) {
  if (pathname === '/api/home') return responseData(res, await home());
  if (pathname === '/api/search') {
    const q = String(query.get('q') || '').trim();
    if (!q) return responseData(res, { tracks: [], artists: [], albums: [], playlists: [] });
    return responseData(res, await search(q, query.get('types') || undefined));
  }
  if (pathname === '/api/recommendations') {
    const data = await spotifyRequest('/browse/featured-playlists?limit=10');
    return responseData(res, (data.playlists?.items || []).map(normalizePlaylist));
  }
  if (pathname === '/api/new-releases') {
    const data = await spotifyRequest('/browse/new-releases?limit=20');
    return responseData(res, (data.albums?.items || []).map(normalizeAlbum));
  }
  if (pathname === '/api/featured') return responseData(res, await home());

  let match = pathname.match(/^\/api\/(tracks|albums|artists|playlists)\/([^/]+)(?:\/(top-tracks))?$/);
  if (!match) return false;
  const [, resource, id, suffix] = match;
  const key = `${resource}:${id}${suffix ? `:${suffix}` : ''}`;
  const data = await cached(key, async () => {
    const endpoint = resource === 'artists' && suffix
      ? `/artists/${encodeURIComponent(id)}/top-tracks?market=US`
      : `/${resource}/${encodeURIComponent(id)}`;
    const raw = await spotifyRequest(endpoint);
    if (resource === 'tracks') return normalizeTrack(raw);
    if (resource === 'albums') return normalizeAlbum(raw);
    if (resource === 'artists' && suffix) return (raw.tracks || []).map(normalizeTrack);
    if (resource === 'artists') return normalizeArtist(raw);
    return normalizePlaylist(raw);
  }, 300000);
  return responseData(res, data);
}

module.exports = { routeRequest };
