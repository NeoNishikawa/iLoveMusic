(() => {
    // --- APP STATE & AUDIO ENGINE ---
    let spotifySDKPlayer = null;
    let spotifyDeviceId = null;
    let userAccessToken = null;
    const htmlAudio = new Audio();
    htmlAudio.preload = 'metadata';

    let activePlaylist = [];
    let currentTrackIndex = -1;
    let isPlaying = false;
    let isSDKActive = false;

    const ui = {
      title: document.getElementById('player-track-title'),
      artist: document.getElementById('player-track-artist'),
      image: document.getElementById('player-track-image'),
      playIcon: document.getElementById('player-play-icon'),
      mobilePlayIcon: document.getElementById('player-mobile-play-icon'),
      playBtn: document.getElementById('player-play-btn'),
      mobilePlayBtn: document.getElementById('player-mobile-play-btn'),
      currentTime: document.getElementById('player-current-time'),
      totalTime: document.getElementById('player-total-time'),
      progressBar: document.getElementById('player-progress-bar'),
      progressContainer: document.getElementById('player-progress-container'),
      volumeSlider: document.getElementById('player-volume-slider')
    };

    // --- API HELPER ---
    const api = async (path, options = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeout || 10000);
      try {
        const response = await fetch(path, { signal: controller.signal, credentials: 'include' });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error?.message || 'Gagal terhubung ke API');
        return payload.data;
      } finally {
        clearTimeout(timer);
      }
    };

    function formatTime(ms) {
      if (!ms || isNaN(ms)) return "0:00";
      const seconds = Math.floor(ms / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // --- AUTOMATIC SILENT SPOTIFY INITIALIZATION ---
    async function initSystemAccessToken() {
      try {
        const response = await fetch('/api/spotify/token', { credentials: 'include' });
        if (response.ok) {
          const payload = await response.json();
          userAccessToken = payload.data?.accessToken;
          return true;
        }
      } catch (e) {
        console.warn('[AURA] Server token fetch warning:', e.message);
      }
      return false;
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
      initSystemAccessToken().then(hasToken => {
        if (!hasToken || !window.Spotify) return;

        spotifySDKPlayer = new Spotify.Player({
          name: 'Aura Shared Player',
          getOAuthToken: cb => cb(userAccessToken),
          volume: 0.8
        });

        spotifySDKPlayer.addListener('ready', ({ device_id }) => {
          spotifyDeviceId = device_id;
          console.log('[AURA] Spotify Web SDK Ready. Shared Device ID:', device_id);
        });

        spotifySDKPlayer.addListener('player_state_changed', state => {
          if (!state) return;
          isSDKActive = true;
          isPlaying = !state.paused;
          updatePlayIcons(isPlaying);

          const track = state.track_window.current_track;
          if (track) {
            ui.title.textContent = track.name;
            ui.artist.textContent = track.artists.map(a => a.name).join(', ');
            const imgUrl = track.album.images[0]?.url;
            if (imgUrl) ui.image.style.backgroundImage = `url('${imgUrl}')`;
          }

          ui.currentTime.textContent = formatTime(state.position);
          ui.totalTime.textContent = formatTime(state.duration);
          ui.progressBar.style.width = `${(state.position / state.duration) * 100}%`;
        });

        spotifySDKPlayer.connect();
      });
    };

    // --- PLAYER CONTROLLER ENGINE ---
    function updatePlayIcons(playing) {
      const icon = playing ? 'pause' : 'play_arrow';
      if (ui.playIcon) ui.playIcon.textContent = icon;
      if (ui.mobilePlayIcon) ui.mobilePlayIcon.textContent = icon;
    }

    async function playTrack(track, playlist = [], index = -1) {
      if (!track) return;
      if (playlist.length) activePlaylist = playlist;
      if (index !== -1) currentTrackIndex = index;

      // Update Header Display Card
      document.getElementById('hero-song-title').textContent = track.title || track.name;
      document.getElementById('hero-song-artist').textContent = track.artist || 'Artist';
      if (track.image) document.getElementById('hero-album-cover').style.backgroundImage = `url('${track.image}')`;

      // Update Footer Player Info
      ui.title.textContent = track.title || track.name;
      ui.artist.textContent = track.artist || 'Artist';
      if (track.image) {
        ui.image.style.backgroundImage = `url('${track.image}')`;
        ui.image.innerHTML = '';
      }

      // METODE 1: Spotify Web Playback SDK (Lagu Penuh via Server Token)
      if (spotifyDeviceId && userAccessToken && track.id) {
        try {
          const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: [`spotify:track:${track.id}`] })
          });
          if (res.ok || res.status === 204) {
            htmlAudio.pause();
            return;
          }
        } catch (e) {
          console.warn('[AURA] Fallback to HTML Audio Engine');
        }
      }

      // METODE 2: Fallback ke Pemutar HTML5 Preview
      isSDKActive = false;
      if (track.previewUrl) {
        htmlAudio.src = track.previewUrl;
        htmlAudio.play();
        isPlaying = true;
        updatePlayIcons(true);
      } else {
        alert(`Sistem sedang menyiapkan stream untuk "${track.title || track.name}". Silakan coba lagu lainnya.`);
      }
    }

    function togglePlay() {
      if (isSDKActive && spotifySDKPlayer) {
        spotifySDKPlayer.togglePlay();
        return;
      }
      if (!htmlAudio.src) return;
      if (htmlAudio.paused) {
        htmlAudio.play();
        isPlaying = true;
        updatePlayIcons(true);
      } else {
        htmlAudio.pause();
        isPlaying = false;
        updatePlayIcons(false);
      }
    }

    // Listener Progress Audio HTML5
    htmlAudio.addEventListener('timeupdate', () => {
      if (isSDKActive) return;
      if (htmlAudio.duration) {
        ui.currentTime.textContent = formatTime(htmlAudio.currentTime * 1000);
        ui.totalTime.textContent = formatTime(htmlAudio.duration * 1000);
        ui.progressBar.style.width = `${(htmlAudio.currentTime / htmlAudio.duration) * 100}%`;
      }
    });

    htmlAudio.addEventListener('ended', () => {
      if (isSDKActive) return;
      isPlaying = false;
      updatePlayIcons(false);
      if (currentTrackIndex !== -1 && currentTrackIndex + 1 < activePlaylist.length) {
        playTrack(activePlaylist[currentTrackIndex + 1], activePlaylist, currentTrackIndex + 1);
      }
    });

    // Seek / Tracker Click Handler
    if (ui.progressContainer) {
      ui.progressContainer.addEventListener('click', (e) => {
        const rect = ui.progressContainer.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        if (isSDKActive && spotifySDKPlayer) {
          spotifySDKPlayer.getCurrentState().then(state => {
            if (state) spotifySDKPlayer.seek(ratio * state.duration);
          });
        } else if (htmlAudio.duration) {
          htmlAudio.currentTime = ratio * htmlAudio.duration;
        }
      });
    }

    // Kontrol Volume
    if (ui.volumeSlider) {
      ui.volumeSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        htmlAudio.volume = val;
        if (spotifySDKPlayer) spotifySDKPlayer.setVolume(val);
      });
    }

    ui.playBtn?.addEventListener('click', togglePlay);
    ui.mobilePlayBtn?.addEventListener('click', togglePlay);

    document.getElementById('player-next-btn')?.addEventListener('click', () => {
      if (currentTrackIndex !== -1 && currentTrackIndex + 1 < activePlaylist.length) {
        playTrack(activePlaylist[currentTrackIndex + 1], activePlaylist, currentTrackIndex + 1);
      }
    });

    document.getElementById('player-prev-btn')?.addEventListener('click', () => {
      if (currentTrackIndex > 0) {
        playTrack(activePlaylist[currentTrackIndex - 1], activePlaylist, currentTrackIndex - 1);
      }
    });

    // --- RENDER DYNAMIS ---
    let globalSongs = [];

    function renderTrending(songs) {
      globalSongs = songs;
      const container = document.getElementById('trending-songs-list');
      container.innerHTML = songs.map((song, idx) => `
        <div class="flex items-center justify-between p-space-3 rounded-xl bg-surface-container/60 hover:bg-surface-container-high transition-colors group cursor-pointer" data-index="${idx}">
          <div class="flex items-center gap-space-4">
            <span class="text-headline-sm text-primary font-headline-sm w-8">${String(idx + 1).padStart(2, '0')}</span>
            <div class="w-12 h-12 rounded-lg bg-surface-container-highest overflow-hidden relative flex-shrink-0 bg-cover bg-center" style="background-image: url('${song.image || ''}')"></div>
            <div>
              <div class="text-body-lg font-medium text-on-surface group-hover:text-primary transition-colors">${song.title}</div>
              <div class="text-body-sm text-on-surface-variant">${song.artist}</div>
            </div>
          </div>
          <div class="flex items-center gap-space-4">
            <span class="text-body-sm text-on-surface-variant">${song.duration ? formatTime(song.duration) : ''}</span>
            <button class="w-9 h-9 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center group-hover:scale-110 transition-transform">
              <span class="material-symbols-outlined text-[18px]">play_arrow</span>
            </button>
          </div>
        </div>
      `).join('');
    }

    function renderArtists(artists) {
      const container = document.getElementById('popular-artists-grid');
      container.innerHTML = artists.map(artist => `
        <div class="artist-card flex flex-col items-center gap-space-3 p-space-4 rounded-xl bg-surface-container/40 hover:bg-surface-container transition-all group cursor-pointer" data-query="${encodeURIComponent(artist.name)}">
          <div class="relative w-20 h-20 md:w-24 md:h-24 rounded-full p-1 bg-gradient-to-tr from-secondary via-primary to-primary-container">
            <div class="w-full h-full rounded-full bg-cover bg-center overflow-hidden" style="background-image: url('${artist.image || ''}')"></div>
          </div>
          <div class="text-center">
            <div class="text-body-md font-medium text-on-surface group-hover:text-secondary transition-colors">${artist.name}</div>
            <div class="text-body-sm text-on-surface-variant">${artist.role || 'Artist'}</div>
          </div>
        </div>
      `).join('');
    }

    function renderAlbums(albums) {
      const container = document.getElementById('featured-albums-grid');
      container.innerHTML = albums.map(album => `
        <div class="album-card flex flex-col gap-space-3 p-space-4 rounded-xl bg-surface-container/60 hover:bg-surface-container transition-all group cursor-pointer" data-query="${encodeURIComponent(album.title + ' ' + album.artist)}">
          <div class="w-full h-48 rounded-lg bg-surface-container-high overflow-hidden relative">
            <div class="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-500" style="background-image: url('${album.image || ''}')"></div>
          </div>
          <div>
            <div class="text-body-lg font-medium text-on-surface group-hover:text-primary transition-colors">${album.title}</div>
            <div class="text-body-sm text-on-surface-variant">${album.artist}</div>
          </div>
        </div>
      `).join('');
    }

    function renderGenres() {
      const genres = [
        { name: "J-Pop / Anime", query: "J-Pop", color: "from-primary-container to-primary" },
        { name: "Electronic", query: "Electronic", color: "from-secondary-container to-secondary" },
        { name: "Synthwave", query: "Synthwave", color: "from-tertiary-container to-tertiary" },
        { name: "Lo-Fi Beats", query: "Lo-Fi", color: "from-surface-container-high to-surface-container" },
        { name: "Hip-Hop", query: "Hip-Hop", color: "from-primary-container to-secondary-container" },
        { name: "Rock", query: "Rock", color: "from-surface-container-high to-primary-container" }
      ];
      const container = document.getElementById('genres-grid');
      container.innerHTML = genres.map(g => `
        <div class="genre-card flex flex-col justify-between p-space-4 rounded-xl bg-gradient-to-br ${g.color} h-28 relative overflow-hidden group cursor-pointer shadow-lg hover:scale-105 transition-transform" data-query="${g.query}">
          <div class="text-headline-sm text-on-surface font-headline-sm">${g.name}</div>
          <div class="text-body-sm text-on-surface-variant">Jelajahi -></div>
        </div>
      `).join('');
    }

    function renderPlaylists(playlists) {
      const container = document.getElementById('playlists-grid');
      container.innerHTML = playlists.map(pl => `
        <div class="playlist-card flex items-center gap-space-4 p-space-3 rounded-xl bg-surface-container/60 hover:bg-surface-container transition-colors group cursor-pointer" data-query="${encodeURIComponent(pl.title)}">
          <div class="w-16 h-16 rounded-lg bg-surface-container-high overflow-hidden relative flex-shrink-0 bg-cover bg-center" style="background-image: url('${pl.image || ''}')"></div>
          <div class="flex-1 min-w-0">
            <div class="text-body-lg font-medium text-on-surface truncate group-hover:text-primary transition-colors">${pl.title}</div>
            <div class="text-body-sm text-on-surface-variant truncate">${pl.subtitle || 'Playlist'}</div>
          </div>
        </div>
      `).join('');
    }

    // --- FETCH DATA HOME ---
    async function loadHome() {
      try {
        const data = await api('/api/home');
        if (data.trending) renderTrending(data.trending);
        if (data.artists) renderArtists(data.artists);
        if (data.albums) renderAlbums(data.albums);
        if (data.playlists) renderPlaylists(data.playlists);
        renderGenres();
      } catch (e) {
        console.warn('[AURA] Error loading home data:', e.message);
      }
    }

    async function executeSearch(query) {
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
        if (data.tracks && data.tracks.length) {
          renderTrending(data.tracks);
          playTrack(data.tracks[0], data.tracks, 0);
          document.getElementById('sec-trending').scrollIntoView({ behavior: 'smooth' });
        }
      } catch (e) {
        alert('Gagal mencari lagu: ' + e.message);
      }
    }

    // Global Event Delegation (Klik Kartu & List)
    document.addEventListener('click', e => {
      // Klik Row Lagu Trending
      const trendRow = e.target.closest('#trending-songs-list > div');
      if (trendRow) {
        const idx = parseInt(trendRow.dataset.index, 10);
        if (!isNaN(idx) && globalSongs[idx]) playTrack(globalSongs[idx], globalSongs, idx);
        return;
      }

      // Klik Kartu Artis / Album / Genre / Playlist
      const card = e.target.closest('.artist-card, .album-card, .genre-card, .playlist-card');
      if (card) {
        const query = card.dataset.query;
        if (query) executeSearch(decodeURIComponent(query));
        return;
      }

      // Tag Pencarian Cepat Modal
      const tag = e.target.closest('#quick-search-tags > span');
      if (tag) {
        const text = tag.textContent.trim();
        document.getElementById('modal-search-input').value = text;
        executeSearch(text);
        document.getElementById('search-modal').classList.add('hidden');
      }
    });

    // Input Search Modal Event
    const modalInput = document.getElementById('modal-search-input');
    modalInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        executeSearch(modalInput.value.trim());
        document.getElementById('search-modal').classList.add('hidden');
      }
    });

    // Navigasi Sidebar Links
    document.querySelectorAll('.nav-item').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const path = link.dataset.path;
        if (path === 'theme') {
          document.documentElement.classList.toggle('dark');
        } else if (path === 'settings') {
          alert("Settings: Server iloveMusic aktif di Railway.");
        } else if (path === 'trending' || path === 'discover') {
          document.getElementById('sec-trending')?.scrollIntoView({ behavior: 'smooth' });
        } else if (path === 'artists') {
          document.getElementById('sec-artists')?.scrollIntoView({ behavior: 'smooth' });
        } else if (path === 'albums') {
          document.getElementById('sec-albums')?.scrollIntoView({ behavior: 'smooth' });
        } else if (path === 'playlists') {
          document.getElementById('sec-playlists')?.scrollIntoView({ behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });

    // Triggers Modal & Drawer Mobile
    const searchModal = document.getElementById('search-modal');
    document.getElementById('desktop-search-trigger')?.addEventListener('click', () => searchModal.classList.remove('hidden'));
    document.getElementById('mobile-search-trigger')?.addEventListener('click', () => searchModal.classList.remove('hidden'));
    document.getElementById('close-search')?.addEventListener('click', () => searchModal.classList.add('hidden'));

    const drawer = document.getElementById('mobile-drawer');
    document.getElementById('open-drawer')?.addEventListener('click', () => drawer.classList.remove('hidden'));
    document.getElementById('close-drawer')?.addEventListener('click', () => drawer.classList.add('hidden'));

    window.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchModal.classList.remove('hidden');
      }
      if (e.key === 'Escape') {
        searchModal.classList.add('hidden');
        drawer.classList.add('hidden');
      }
    });

    document.addEventListener('DOMContentLoaded', () => {
      loadHome();
    });
  })();
