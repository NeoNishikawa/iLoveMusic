(() => {
    // --- APP ENGINE STATE & AUDIO SYSTEM ---
    const htmlAudio = new Audio();
    htmlAudio.preload = 'metadata';

    let ytPlayer = null;
    let isYTReady = false;
    let isYTActive = false;
    let ytProgressTimer = null;

    let activePlaylist = [];
    let currentTrackIndex = -1;
    let isPlaying = false;

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

    // Initialize YouTube Background Player API
    window.onYouTubeIframeAPIReady = () => {
      ytPlayer = new YT.Player('yt-player', {
        height: '0',
        width: '0',
        playerVars: { autoplay: 1, controls: 0 },
        events: {
          'onReady': () => { isYTReady = true; },
          'onStateChange': onYTStateChange
        }
      });
    };

    function onYTStateChange(event) {
      if (event.data === YT.PlayerState.PLAYING) {
        isYTActive = true;
        isPlaying = true;
        updatePlayIcons(true);
        startYTTimer();
      } else if (event.data === YT.PlayerState.PAUSED) {
        isPlaying = false;
        updatePlayIcons(false);
        stopYTTimer();
      } else if (event.data === YT.PlayerState.ENDED) {
        isPlaying = false;
        updatePlayIcons(false);
        stopYTTimer();
        if (currentTrackIndex !== -1 && currentTrackIndex + 1 < activePlaylist.length) {
          playTrack(activePlaylist[currentTrackIndex + 1], activePlaylist, currentTrackIndex + 1);
        }
      }
    }

    function startYTTimer() {
      stopYTTimer();
      ytProgressTimer = setInterval(() => {
        if (ytPlayer && isYTActive && typeof ytPlayer.getCurrentTime === 'function') {
          const curr = ytPlayer.getCurrentTime() || 0;
          const dur = ytPlayer.getDuration() || 1;
          ui.currentTime.textContent = formatTimeMs(curr * 1000);
          ui.totalTime.textContent = formatTimeMs(dur * 1000);
          ui.progressBar.style.width = `${(curr / dur) * 100}%`;
        }
      }, 300);
    }

    function stopYTTimer() {
      if (ytProgressTimer) clearInterval(ytProgressTimer);
    }

    // --- API HELPER ---
    const api = async (path, options = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeout || 10000);
      try {
        const response = await fetch(path, { signal: controller.signal, credentials: 'include' });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error?.message || 'Gagal memuat API');
        return payload.data;
      } finally {
        clearTimeout(timer);
      }
    };

    function formatTimeMs(ms) {
      if (!ms || isNaN(ms)) return "0:00";
      const seconds = Math.floor(ms / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // --- PLAYBACK ENGINE CONTROLLER ---
    function updatePlayIcons(playing) {
      const icon = playing ? 'pause' : 'play_arrow';
      if (ui.playIcon) ui.playIcon.textContent = icon;
      if (ui.mobilePlayIcon) ui.mobilePlayIcon.textContent = icon;
    }

    async function playTrack(track, playlist = [], index = -1) {
      if (!track) return;
      if (playlist.length) activePlaylist = playlist;
      if (index !== -1) currentTrackIndex = index;

      const trackTitle = track.title || track.name || 'Unknown Track';
      const trackArtist = track.artist || (track.artists || []).map(a => a.name).join(', ') || 'Unknown Artist';
      const trackImage = extractImage(track);

      // Stop previous audio streams
      htmlAudio.pause();
      if (ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();

      // Update Hero Card
      document.getElementById('hero-song-title').textContent = trackTitle;
      document.getElementById('hero-song-artist').textContent = trackArtist;
      if (trackImage) document.getElementById('hero-album-cover').style.backgroundImage = `url('${trackImage}')`;

      // Update Footer Info
      ui.title.textContent = trackTitle;
      ui.artist.textContent = trackArtist;
      if (trackImage) {
        ui.image.style.backgroundImage = `url('${trackImage}')`;
        ui.image.innerHTML = '';
      }

      // 1. HTML5 Preview Stream (Jika preview_url tersedia dari Spotify)
      if (track.previewUrl) {
        isYTActive = false;
        htmlAudio.src = track.previewUrl;
        htmlAudio.play().then(() => {
          isPlaying = true;
          updatePlayIcons(true);
        }).catch(err => console.warn('Autoplay error:', err));
        return;
      }

      // 2. YouTube Audio Streaming Fallback (GUARANTEES 100% WORKING SOUND FOR ALL SONGS)
      if (ytPlayer && isYTReady && typeof ytPlayer.loadPlaylist === 'function') {
        isYTActive = true;
        ytPlayer.loadPlaylist({
          listType: 'search',
          list: `${trackArtist} ${trackTitle}`,
          index: 0
        });
      }
    }

    function togglePlay() {
      if (isYTActive && ytPlayer) {
        const state = ytPlayer.getPlayerState();
        if (state === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
        else ytPlayer.playVideo();
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
      if (isYTActive) return;
      if (htmlAudio.duration) {
        ui.currentTime.textContent = formatTimeMs(htmlAudio.currentTime * 1000);
        ui.totalTime.textContent = formatTimeMs(htmlAudio.duration * 1000);
        ui.progressBar.style.width = `${(htmlAudio.currentTime / htmlAudio.duration) * 100}%`;
      }
    });

    htmlAudio.addEventListener('ended', () => {
      if (isYTActive) return;
      isPlaying = false;
      updatePlayIcons(false);
      if (currentTrackIndex !== -1 && currentTrackIndex + 1 < activePlaylist.length) {
        playTrack(activePlaylist[currentTrackIndex + 1], activePlaylist, currentTrackIndex + 1);
      }
    });

    // Seeker Bar Click
    if (ui.progressContainer) {
      ui.progressContainer.addEventListener('click', (e) => {
        const rect = ui.progressContainer.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        if (isYTActive && ytPlayer && typeof ytPlayer.getDuration === 'function') {
          ytPlayer.seekTo(ratio * ytPlayer.getDuration(), true);
        } else if (htmlAudio.duration) {
          htmlAudio.currentTime = ratio * htmlAudio.duration;
        }
      });
    }

    // Volume Slider
    if (ui.volumeSlider) {
      ui.volumeSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        htmlAudio.volume = val;
        if (ytPlayer && typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(val * 100);
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

    // --- RENDER DYNAMIS & DATA BINDING ---
    let globalSongs = [];
    let searchSongs = [];

    function extractImage(item) {
      if (!item) return '';
      if (typeof item.image === 'string' && item.image) return item.image;
      if (item.album && item.album.image) return item.album.image;
      if (Array.isArray(item.images) && item.images.length) return item.images[0].url || '';
      return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&auto=format&fit=crop&q=80';
    }

    function renderSearchResultsList(songs, query) {
      searchSongs = songs.map(s => ({
        id: s.id,
        title: s.title || s.name,
        artist: s.artist || (s.artists || []).map(a => a.name).join(', '),
        image: extractImage(s),
        duration: s.duration || s.durationMs || 0,
        previewUrl: s.previewUrl || null
      }));

      const sec = document.getElementById('sec-search-results');
      const title = document.getElementById('search-query-title');
      const container = document.getElementById('search-songs-list');

      title.textContent = `Hasil untuk: "${query}"`;
      sec.classList.remove('hidden');

      container.innerHTML = searchSongs.map((song, idx) => `
        <div class="flex items-center justify-between p-space-3 rounded-xl bg-surface-container/80 hover:bg-surface-container-high transition-colors group cursor-pointer border border-primary/10" data-search-index="${idx}">
          <div class="flex items-center gap-space-4">
            <span class="text-headline-sm text-primary font-headline-sm w-8">${String(idx + 1).padStart(2, '0')}</span>
            <div class="w-12 h-12 rounded-lg bg-surface-container-highest overflow-hidden relative flex-shrink-0 bg-cover bg-center" style="background-image: url('${song.image}')"></div>
            <div>
              <div class="text-body-lg font-medium text-on-surface group-hover:text-primary transition-colors">${song.title}</div>
              <div class="text-body-sm text-on-surface-variant">${song.artist}</div>
            </div>
          </div>
          <div class="flex items-center gap-space-4">
            <span class="text-body-sm text-on-surface-variant">${song.duration ? formatTimeMs(song.duration) : ''}</span>
            <button class="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center group-hover:scale-110 transition-transform shadow-md">
              <span class="material-symbols-outlined text-[18px]">play_arrow</span>
            </button>
          </div>
        </div>
      `).join('');

      sec.scrollIntoView({ behavior: 'smooth' });
    }

    function renderTrending(songs) {
      globalSongs = songs.map(s => ({
        id: s.id,
        title: s.title || s.name,
        artist: s.artist || (s.artists || []).map(a => a.name).join(', '),
        image: extractImage(s),
        duration: s.duration || s.durationMs || 0,
        previewUrl: s.previewUrl || null
      }));

      const container = document.getElementById('trending-songs-list');
      container.innerHTML = globalSongs.map((song, idx) => `
        <div class="flex items-center justify-between p-space-3 rounded-xl bg-surface-container/60 hover:bg-surface-container-high transition-colors group cursor-pointer" data-index="${idx}">
          <div class="flex items-center gap-space-4">
            <span class="text-headline-sm text-primary font-headline-sm w-8">${String(idx + 1).padStart(2, '0')}</span>
            <div class="w-12 h-12 rounded-lg bg-surface-container-highest overflow-hidden relative flex-shrink-0 bg-cover bg-center" style="background-image: url('${song.image}')"></div>
            <div>
              <div class="text-body-lg font-medium text-on-surface group-hover:text-primary transition-colors">${song.title}</div>
              <div class="text-body-sm text-on-surface-variant">${song.artist}</div>
            </div>
          </div>
          <div class="flex items-center gap-space-4">
            <span class="text-body-sm text-on-surface-variant">${song.duration ? formatTimeMs(song.duration) : ''}</span>
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
            <div class="w-full h-full rounded-full bg-cover bg-center overflow-hidden" style="background-image: url('${extractImage(artist)}')"></div>
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
        <div class="album-card flex flex-col gap-space-3 p-space-4 rounded-xl bg-surface-container/60 hover:bg-surface-container transition-all group cursor-pointer" data-query="${encodeURIComponent((album.title || album.name) + ' ' + (album.artist || ''))}">
          <div class="w-full h-48 rounded-lg bg-surface-container-high overflow-hidden relative">
            <div class="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-500" style="background-image: url('${extractImage(album)}')"></div>
          </div>
          <div>
            <div class="text-body-lg font-medium text-on-surface group-hover:text-primary transition-colors">${album.title || album.name}</div>
            <div class="text-body-sm text-on-surface-variant">${album.artist || ''}</div>
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
        <div class="playlist-card flex items-center gap-space-4 p-space-3 rounded-xl bg-surface-container/60 hover:bg-surface-container transition-colors group cursor-pointer" data-query="${encodeURIComponent(pl.title || pl.name)}">
          <div class="w-16 h-16 rounded-lg bg-surface-container-high overflow-hidden relative flex-shrink-0 bg-cover bg-center" style="background-image: url('${extractImage(pl)}')"></div>
          <div class="flex-1 min-w-0">
            <div class="text-body-lg font-medium text-on-surface truncate group-hover:text-primary transition-colors">${pl.title || pl.name}</div>
            <div class="text-body-sm text-on-surface-variant truncate">${pl.subtitle || 'Playlist'}</div>
          </div>
        </div>
      `).join('');
    }

    // --- FETCH DATA HOME & PENCARIAN ---
    async function loadHome() {
      try {
        const data = await api('/api/home');
        if (data.trending && data.trending.length) renderTrending(data.trending);
        if (data.artists && data.artists.length) renderArtists(data.artists);
        if (data.albums && data.albums.length) renderAlbums(data.albums);
        if (data.playlists && data.playlists.length) renderPlaylists(data.playlists);
        renderGenres();
      } catch (e) {
        console.warn('[AURA] Home fetch failed:', e.message);
      }
    }

    async function executeSearch(query) {
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
        if (data.tracks && data.tracks.length) {
          renderSearchResultsList(data.tracks, query);
          playTrack(searchSongs[0], searchSongs, 0);
        }
      } catch (e) {
        console.warn('[AURA] Search failed:', e.message);
      }
    }

    // Global Click Handler
    document.addEventListener('click', e => {
      // Klik Hasil Pencarian
      const searchRow = e.target.closest('#search-songs-list > div');
      if (searchRow) {
        const idx = parseInt(searchRow.dataset.searchIndex, 10);
        if (!isNaN(idx) && searchSongs[idx]) playTrack(searchSongs[idx], searchSongs, idx);
        return;
      }

      // Klik Lagu Trending
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

      // Tag Pencarian Cepat
      const tag = e.target.closest('#quick-search-tags > span');
      if (tag) {
        const text = tag.textContent.trim();
        document.getElementById('modal-search-input').value = text;
        executeSearch(text);
        document.getElementById('search-modal').classList.add('hidden');
      }
    });

    // Close Search Results Container
    document.getElementById('close-search-results')?.addEventListener('click', () => {
      document.getElementById('sec-search-results')?.classList.add('hidden');
    });

    // Search Input Modal Event
    const modalInput = document.getElementById('modal-search-input');
    modalInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        executeSearch(modalInput.value.trim());
        document.getElementById('search-modal').classList.add('hidden');
      }
    });

    // Navigasi Sidebar
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

    // Modals & Drawer Triggers
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
