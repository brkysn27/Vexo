const appState = {
  user: null,
  currentVideoId: null,
  currentVideo: null,
  likeState: false,
  subscribedState: false,
  allVideos: [],
  currentProfileUserId: null,
};

function formatCount(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatDate(dateString) {
  if (!dateString) return 'Bilinmiyor';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || 'İstek başarısız oldu.');
  }

  return payload;
}

async function loadSession() {
  try {
    const data = await apiRequest('/api/session');
    appState.user = data.user;
  } catch (error) {
    appState.user = null;
  }
}

function getStoredTheme() {
  const saved = localStorage.getItem('vexo-theme');
  return saved || 'light';
}

function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', nextTheme);
  localStorage.setItem('vexo-theme', nextTheme);

  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.textContent = nextTheme === 'dark' ? 'Koyu' : 'Açık';
  }
}

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  const initialTheme = getStoredTheme();
  applyTheme(initialTheme);

  toggle.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });
}

function renderAuthNav() {
  const authNav = document.getElementById('auth-nav');
  if (!authNav) return;

  if (!appState.user) {
    authNav.innerHTML = `
      <a href="/login.html" class="login-link">Giriş yap</a>
      <a href="/register.html" class="login-link">Kayıt ol</a>
    `;
    return;
  }

  authNav.innerHTML = `
    <a href="/profile.html?userId=${appState.user.id}" class="profile-pill">${escapeHtml(appState.user.username)}</a>
    <button type="button" id="logout-btn" class="logout-btn">Çıkış</button>
  `;

  const logoutButton = document.getElementById('logout-btn');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await apiRequest('/api/logout', { method: 'POST' });
        appState.user = null;
        renderAuthNav();
        if (window.location.pathname !== '/') {
          window.location.href = '/';
        }
      } catch (error) {
        alert(error.message);
      }
    });
  }
}

function setupSidebarToggle() {
  document.querySelector('.menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });
}

function renderVideoCard(video) {
  const card = document.createElement('article');
  card.className = 'video-card';
  const channelName = escapeHtml(video.channel_name || 'Vexo');
  const title = escapeHtml(video.title || 'Başlık yok');

  card.innerHTML = `
    <a href="/watch.html?id=${video.id}">
      <img class="video-card__thumb" src="${escapeHtml(video.thumbnail || '/images/default-thumb.jpg')}" alt="${title}" />
    </a>
    <div class="video-card__body">
      <div class="video-card__meta">
        <div class="channel-avatar">${channelName.charAt(0).toUpperCase() || 'V'}</div>
        <div>
          <h3><a href="/watch.html?id=${video.id}">${title}</a></h3>
          <div class="meta-line">${channelName}</div>
          <div class="video-card__stats">
            <span>${formatCount(video.views || 0)} izlenme</span>
            <span>•</span>
            <span>${formatDate(video.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  return card;
}

async function loadHomeVideos() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;

  try {
    const data = await apiRequest('/api/videos');
    appState.allVideos = data.videos || [];
    grid.innerHTML = '';

    if (!appState.allVideos.length) {
      grid.innerHTML = '<div class="empty-state">Henüz video yok.</div>';
      return;
    }

    appState.allVideos.forEach((video) => grid.appendChild(renderVideoCard(video)));
  } catch (error) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function loadWatchPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) return;

  appState.currentVideoId = Number(id);
  const player = document.getElementById('video-player');
  if (!player) return;

  try {
    const data = await apiRequest(`/api/videos/${id}`);
    const video = data.video;
    appState.currentVideo = video;
    appState.likeState = Boolean(video.liked);
    appState.subscribedState = Boolean(video.subscribed);

    player.src = video.filename;
    player.poster = video.thumbnail;
    document.getElementById('player-title').textContent = video.title;
    document.getElementById('player-meta-line').textContent = `${video.channel_name} • ${formatCount(video.views || 0)} izlenme • ${formatDate(video.created_at)}`;
    document.getElementById('video-description').textContent = video.description || 'Açıklama eklenmedi.';

    const likeButton = document.getElementById('like-button');
    const subscribeButton = document.getElementById('subscribe-button');
    if (likeButton) {
      likeButton.textContent = appState.likeState ? '👍 Beğendin' : '👍 Beğen';
      likeButton.classList.toggle('is-active', appState.likeState);
      likeButton.addEventListener('click', handleLikeToggle);
    }

    if (subscribeButton) {
      subscribeButton.textContent = appState.subscribedState ? 'Abone oldun' : 'Abone ol';
      subscribeButton.classList.toggle('is-active', appState.subscribedState);
      subscribeButton.addEventListener('click', handleSubscribeToggle);
    }

    renderComments(video.comments || []);
    await incrementView(id);
    await loadRecommendations();
  } catch (error) {
    document.getElementById('player-title').textContent = 'Video yüklenemedi';
    console.error(error);
  }
}

async function incrementView(videoId) {
  try {
    const result = await apiRequest(`/api/videos/${videoId}/view`, { method: 'POST' });
    const metaLine = document.getElementById('player-meta-line');
    if (metaLine) {
      metaLine.textContent = `${appState.currentVideo?.channel_name || 'Vexo'} • ${formatCount(result.views || 0)} izlenme • ${formatDate(appState.currentVideo?.created_at)}`;
    }
  } catch (error) {
    console.warn(error.message);
  }
}

async function handleLikeToggle() {
  if (!appState.user) {
    window.location.href = '/login.html';
    return;
  }

  const likeButton = document.getElementById('like-button');
  try {
    if (appState.likeState) {
      const result = await apiRequest(`/api/videos/${appState.currentVideoId}/like`, { method: 'DELETE' });
      appState.likeState = false;
      likeButton.classList.remove('is-active');
      likeButton.textContent = '👍 Beğen';
      const meta = document.getElementById('player-meta-line');
      if (meta) {
        meta.textContent = `${appState.currentVideo?.channel_name || 'Vexo'} • ${formatCount(result.likes_count || 0)} beğeni • ${formatDate(appState.currentVideo?.created_at)}`;
      }
    } else {
      const result = await apiRequest(`/api/videos/${appState.currentVideoId}/like`, { method: 'POST' });
      appState.likeState = true;
      likeButton.classList.add('is-active');
      likeButton.textContent = '👍 Beğendin';
      const meta = document.getElementById('player-meta-line');
      if (meta) {
        meta.textContent = `${appState.currentVideo?.channel_name || 'Vexo'} • ${formatCount(result.likes_count || 0)} beğeni • ${formatDate(appState.currentVideo?.created_at)}`;
      }
    }
  } catch (error) {
    alert(error.message);
  }
}

async function handleSubscribeToggle() {
  if (!appState.user) {
    window.location.href = '/login.html';
    return;
  }

  const subscribeButton = document.getElementById('subscribe-button');
  const channelId = appState.currentVideo?.user_id;
  if (!channelId) return;

  try {
    if (appState.subscribedState) {
      const result = await apiRequest(`/api/users/${channelId}/subscribe`, { method: 'DELETE' });
      appState.subscribedState = false;
      subscribeButton.classList.remove('is-active');
      subscribeButton.textContent = 'Abone ol';
      appState.currentVideo.subscribers_count = result.subscribers_count;
    } else {
      const result = await apiRequest(`/api/users/${channelId}/subscribe`, { method: 'POST' });
      appState.subscribedState = true;
      subscribeButton.classList.add('is-active');
      subscribeButton.textContent = 'Abone oldun';
      appState.currentVideo.subscribers_count = result.subscribers_count;
    }
  } catch (error) {
    alert(error.message);
  }
}

function renderComments(comments) {
  const list = document.getElementById('comment-list');
  if (!list) return;

  list.innerHTML = '';

  if (!comments.length) {
    list.innerHTML = '<li class="empty-state">Henüz yorum yok. İlk yorumu siz yazın.</li>';
    return;
  }

  comments.forEach((comment) => {
    const item = document.createElement('li');
    item.className = 'comment-item';
    const canDelete = Number(comment.user_id) === Number(appState.user?.id);

    item.innerHTML = `
      <div class="comment-head">
        <strong>${escapeHtml(comment.username || 'Anonim')}</strong>
        ${canDelete ? '<button type="button" class="delete-comment" data-comment-id="' + comment.id + '">Sil</button>' : ''}
      </div>
      <div class="muted">${formatDate(comment.created_at)}</div>
      <p>${escapeHtml(comment.comment || '')}</p>
    `;

    list.appendChild(item);
  });

  document.querySelectorAll('.delete-comment').forEach((button) => {
    button.addEventListener('click', async () => {
      const commentId = button.getAttribute('data-comment-id');
      if (!commentId) return;

      try {
        await apiRequest(`/api/comments/${commentId}`, { method: 'DELETE' });
        await loadWatchPage();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

async function handleCommentSubmit(event) {
  event.preventDefault();
  if (!appState.user) {
    window.location.href = '/login.html';
    return;
  }

  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;

  try {
    await apiRequest(`/api/videos/${appState.currentVideoId}/comment`, {
      method: 'POST',
      body: JSON.stringify({ comment: text })
    });
    input.value = '';
    await loadWatchPage();
  } catch (error) {
    alert(error.message);
  }
}

async function loadRecommendations() {
  const list = document.getElementById('recommendations');
  if (!list) return;

  try {
    const data = await apiRequest('/api/videos');
    const videos = (data.videos || []).filter((video) => Number(video.id) !== Number(appState.currentVideoId));
    list.innerHTML = '';
    videos.slice(0, 5).forEach((video) => list.appendChild(renderVideoCard(video)));
  } catch (error) {
    list.innerHTML = '<div class="empty-state">Öneri yüklenemedi.</div>';
  }
}

async function loadSearchPage() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';
  const resultsContainer = document.getElementById('search-results');
  const title = document.getElementById('search-title');
  const input = document.getElementById('search-query');
  if (input) input.value = query;

  if (!resultsContainer) return;

  if (!query) {
    resultsContainer.innerHTML = '<div class="empty-state">Arama yaparak videoları bulun.</div>';
    if (title) title.textContent = 'Arama sonuçları';
    return;
  }

  try {
    const data = await apiRequest(`/api/search?q=${encodeURIComponent(query)}`);
    if (title) title.textContent = `"${escapeHtml(query)}" için sonuçlar`;
    const videos = data.videos || [];
    resultsContainer.innerHTML = '';

    if (!videos.length) {
      resultsContainer.innerHTML = '<div class="empty-state">Sonuç bulunamadı.</div>';
      return;
    }

    videos.forEach((video) => resultsContainer.appendChild(renderVideoCard(video)));
  } catch (error) {
    resultsContainer.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function bindAuthForms() {
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = document.getElementById('register-message');
      const username = document.getElementById('register-username').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const confirm = document.getElementById('register-confirm').value;

      if (password !== confirm) {
        message.textContent = 'Şifreler eşleşmiyor.';
        message.className = 'form-message error';
        return;
      }

      try {
        const result = await apiRequest('/api/register', {
          method: 'POST',
          body: JSON.stringify({ username, email, password })
        });
        appState.user = result.user;
        message.textContent = 'Kayıt başarılı. Yönlendiriliyorsunuz...';
        message.className = 'form-message success';
        window.location.href = '/';
      } catch (error) {
        message.textContent = error.message;
        message.className = 'form-message error';
      }
    });
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = document.getElementById('login-message');
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      try {
        const result = await apiRequest('/api/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        appState.user = result.user;
        message.textContent = 'Giriş başarılı. Yönlendiriliyorsunuz...';
        message.className = 'form-message success';
        window.location.href = '/';
      } catch (error) {
        message.textContent = error.message;
        message.className = 'form-message error';
      }
    });
  }

  const uploadForm = document.getElementById('upload-form');
  if (uploadForm) {
    uploadForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = document.getElementById('upload-message');
      if (!appState.user) {
        window.location.href = '/login.html';
        return;
      }

      const formData = new FormData(uploadForm);
      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Yükleme başarısız oldu.');
        }

        message.textContent = 'Video başarıyla yüklendi.';
        message.className = 'form-message success';
        uploadForm.reset();
      } catch (error) {
        message.textContent = error.message;
        message.className = 'form-message error';
      }
    });
  }

  const commentForm = document.getElementById('comment-form');
  if (commentForm) {
    commentForm.addEventListener('submit', handleCommentSubmit);
  }
}

async function loadProfilePage() {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('userId') || appState.user?.id;
  if (!userId) return;

  try {
    const data = await apiRequest(`/api/profile/${userId}`);
    const user = data.user;
    const videos = data.videos || [];

    document.getElementById('profile-username').textContent = user.username;
    document.getElementById('profile-date').textContent = `Katılım: ${formatDate(user.created_at)}`;
    document.getElementById('videos-count').textContent = String(videos.length);
    document.getElementById('subscribers-count').textContent = String(user.subscribers_count || 0);
    document.getElementById('member-since').textContent = new Intl.DateTimeFormat('tr-TR', { month: 'short', year: 'numeric' }).format(new Date(user.created_at));
    document.getElementById('profile-avatar').textContent = (user.username || 'U').charAt(0).toUpperCase();

    const profileVideos = document.getElementById('profile-videos');
    profileVideos.innerHTML = '';
    if (!videos.length) {
      profileVideos.innerHTML = '<div class="empty-state">Bu kullanıcının yüklenmiş videosu yok.</div>';
      return;
    }

    videos.forEach((video) => profileVideos.appendChild(renderVideoCard(video)));
  } catch (error) {
    const container = document.getElementById('profile-videos');
    if (container) container.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function initApp() {
  setupThemeToggle();
  await loadSession();
  renderAuthNav();
  setupSidebarToggle();

  const page = document.body.dataset.page;

  if (page === 'home') {
    await loadHomeVideos();
  }

  if (page === 'watch') {
    await loadWatchPage();
  }

  if (page === 'search') {
    await loadSearchPage();
  }

  if (page === 'profile') {
    await loadProfilePage();
  }

  bindAuthForms();
}

document.addEventListener('DOMContentLoaded', initApp);
