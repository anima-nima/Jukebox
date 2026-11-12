// ═══ CONFIG ═══
const API_URL = 'https://script.google.com/macros/s/AKfycbzH2ScZCKVnHEHxbUb8np1ouILBmE-dhqMcqHnJOSiyyqjNdXD873tn2ZtaTqbj8F7N/exec';
const SYNC_MS = 10 * 60 * 1000;

const fileCache = new Map();

// Lädt Bilder und Audio über deine eingebaute action=media Funktion im Apps Script
async function loadDriveFile(id) {
  if (!id) return '';
  if (fileCache.has(id)) return fileCache.get(id);

  try {
    const res = await fetch(`${API_URL}?action=media&id=${encodeURIComponent(id)}`, { redirect: 'follow' });
    const json = await res.json();
    if (json.base64 && json.mimeType) {
      const dataUrl = `data:${json.mimeType};base64,${json.base64}`;
      fileCache.set(id, dataUrl);
      return dataUrl;
    }
    console.warn('Media-Fehler:', json.error);
  } catch (e) {
    console.error('Fetch-Fehler für Datei ' + id, e);
  }
  return '';
}

function hydrateImages(container = document) {
  container.querySelectorAll('img[data-drive-id]').forEach(async img => {
    const id = img.getAttribute('data-drive-id');
    if (!id) return;
    const url = await loadDriveFile(id);
    if (url) img.src = url;
  });
}

// ═══ STATE ═══
let S = { data: {}, channel: null, project: null, tracks: [], idx: -1, playing: false, timer: null };

// ═══ DOM (einmalig) ═══
const $ = id => document.getElementById(id);
const el = {
  jbLogo: $('jbLogo'),
  tabs: $('channelTabs'),
  sync: $('syncBadge'),
  lH: $('leftHeader'),
  lB: $('leftBody'),
  lI: $('leftInfoBtn'),
  rH: $('rightHeader'),
  rB: $('rightBody'),
  rI: $('rightInfoBtn'),
  bA: $('bannerArea'),
  bI: $('bannerImg'),
  bO: $('bannerOverlay'),
  bM: $('bannerMd'),
  tL: $('trackList'),
  tE: $('rightEmpty'),
  pT: $('pbTitle'),
  pA: $('pbArtist'),
  pTm: $('pbTime'),
  pD: $('pbDur'),
  pP: $('pbProgress'),
  pPlay: $('pbPlay'),
  pPrev: $('pbPrev'),
  pNext: $('pbNext'),
  pRnd: $('pbRandom'),
  audio: $('audio'),
  mOv: $('modalOverlay'),
  mC: $('modalContent'),
  mX: $('modalClose')
};

// ═══ MARKDOWN ═══
function md(s) {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[-] (.+)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

// ═══ SYNC ═══
async function sync() {
  try {
    const res = await fetch(API_URL + '?action=sync', { redirect: 'follow' });
    const json = await res.json();
    S.data = json.data;
    el.sync.textContent = new Date().toLocaleTimeString() + (json.fromCache ? ' (C)' : '');
    if (S.data.error) {
      el.sync.textContent = 'Fehler: ' + S.data.error;
      return;
    }
    renderTop();
    renderTabs();
  } catch (e) {
    el.sync.textContent = 'Fehler: ' + e.message;
  }
}

function startSync() {
  if (S.timer) clearInterval(S.timer);
  S.timer = setInterval(sync, SYNC_MS);
}

// ═══ RENDER: TOP ═══
async function renderTop() {
  const jb = S.data.__jukebox;
  if (jb && jb.image) {
    el.jbLogo.style.display = 'block';
    el.jbLogo.src = await loadDriveFile(jb.image);
  } else {
    el.jbLogo.style.display = 'none';
  }
}

function renderTabs() {
  el.tabs.innerHTML = '';
  const names = Object.keys(S.data).filter(k => k !== '__jukebox');
  if (!names.length) {
    el.tabs.innerHTML = '<div class="empty">Keine Channels</div>';
    return;
  }
  names.forEach(n => {
    const t = document.createElement('div');
    t.className = 'channel-tab' + (n === S.channel ? ' active' : '');
    t.textContent = n;
    t.onclick = () => selectChannel(n);
    el.tabs.appendChild(t);
  });
  if (!S.channel || !S.data[S.channel]) selectChannel(names[0]);
}

// ═══ RENDER: LEFT ═══
function selectChannel(name) {
  S.channel = name;
  S.project = null;
  S.tracks = [];
  S.idx = -1;
  stop();
  renderTabs();
  renderLeft();
  renderRight();
}

function renderLeft() {
  const ch = S.data[S.channel];
  if (!ch) {
    el.lB.innerHTML = '<div class="empty">–</div>';
    return;
  }
  el.lH.textContent = 'Projekte';

  if (ch.md || ch.qr) {
    el.lI.style.display = 'flex';
    el.lI.onclick = () => {
      let h = '';
      if (ch.qr) h += `<img data-drive-id="${ch.qr}" alt="QR">`;
      if (ch.md) h += `<div class="md-body">${md(ch.md)}</div>`;
      modal(h || '<p class="empty">Keine Infos</p>');
    };
  } else {
    el.lI.style.display = 'none';
  }

  el.lB.innerHTML = '';
  if (!ch.projects || !ch.projects.length) {
    el.lB.innerHTML = '<div class="empty">Keine Projekte</div>';
    return;
  }

  const g = document.createElement('div');
  g.className = 'project-grid';
  ch.projects.forEach(p => {
    const c = document.createElement('div');
    c.className = 'project-card' + (p.name === S.project ? ' active' : '');
    c.innerHTML =
      (p.image ? `<img class="card-img" data-drive-id="${p.image}" alt="">` : '') +
      `<div class="card-info"><div class="card-name">${p.name}</div>` +
      `<div class="card-count">${p.tracks.length} Tracks</div></div>` +
      (p.qr ? `<img class="card-qr" data-drive-id="${p.qr}" data-qr-id="${p.qr}">` : '');
    c.onclick = () => selectProject(p);
    const q = c.querySelector('.card-qr');
    if (q) {
      q.onclick = e => {
        e.stopPropagation();
        modal(`<img data-drive-id="${q.dataset.qrId}" alt="QR">`);
      };
    }
    g.appendChild(c);
  });
  el.lB.appendChild(g);
  hydrateImages(el.lB);
}

// ═══ RENDER: RIGHT ═══
function selectProject(p) {
  S.project = p.name;
  S.tracks = p.tracks || [];
  S.idx = -1;
  stop();
  renderLeft();
  renderRight();
}

async function renderRight() {
  const ch = S.data[S.channel];
  const proj = ch?.projects?.find(p => p.name === S.project);
  el.rH.textContent = S.project || 'Tracks';

  if (proj && (proj.md || proj.qr)) {
    el.rI.style.display = 'flex';
    el.rI.onclick = () => {
      let h = '';
      if (proj.qr) h += `<img data-drive-id="${proj.qr}" alt="QR">`;
      if (proj.md) h += `<div class="md-body">${md(proj.md)}</div>`;
      modal(h || '<p class="empty">Keine Infos</p>');
    };
  } else {
    el.rI.style.display = 'none';
  }

  if (proj && proj.image) {
    el.bA.style.display = 'block';
    el.bI.src = '';
    loadDriveFile(proj.image).then(url => {
      if (url) el.bI.src = url;
    });
    if (proj.md) {
      el.bO.style.display = 'flex';
      el.bM.innerHTML = md(proj.md);
    } else {
      el.bO.style.display = 'none';
    }
  } else {
    el.bA.style.display = 'none';
  }

  el.tL.innerHTML = '';
  el.tE.style.display = S.tracks.length ? 'none' : 'block';
  S.tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'track-item' + (i === S.idx ? ' active' : '');
    li.innerHTML =
      (t.image ? `<img class="track-thumb" data-drive-id="${t.image}" alt="">` : `<span class="track-num">${i + 1}</span>`) +
      `<div class="track-meta"><div class="track-name">${t.title}</div>` +
      `<div class="track-artist">${t.artist}</div></div>` +
      ((t.md || t.qr) ? '<button class="track-info-btn">i</button>' : '');
    li.onclick = () => play(i);
    const ib = li.querySelector('.track-info-btn');
    if (ib) {
      ib.onclick = e => {
        e.stopPropagation();
        trackInfo(i);
      };
    }
    el.tL.appendChild(li);
  });
  hydrateImages(el.tL);
}

// ═══ MODAL ═══
function modal(html) {
  el.mC.innerHTML = html;
  el.mOv.classList.add('open');
  hydrateImages(el.mC);
}

function trackInfo(i) {
  const t = S.tracks[i];
  let h = '';
  if (t.qr) h += `<img data-drive-id="${t.qr}" alt="QR">`;
  if (t.md) h += `<div class="md-body">${md(t.md)}</div>`;
  modal(h || '<p class="empty">Keine Infos</p>');
}

el.mX.onclick = () => el.mOv.classList.remove('open');
el.mOv.onclick = e => {
  if (e.target === el.mOv) el.mOv.classList.remove('open');
};

// ═══ PLAYBACK ═══
async function play(i) {
  if (i < 0 || i >= S.tracks.length) return;
  S.idx = i;
  const t = S.tracks[i];

  el.pT.textContent = t.title + ' (Lädt...)';
  el.pA.textContent = t.artist;
  renderRight();

  const srcUrl = await loadDriveFile(t.audioId);
  if (!srcUrl || S.idx !== i) return;

  el.pT.textContent = t.title;
  el.audio.src = srcUrl;
  el.audio.play().catch(e => console.warn('Audio playback error:', e));
  S.playing = true;
  el.pPlay.textContent = '■';
}

function togglePlay() {
  if (S.idx < 0) return;
  if (S.playing) {
    el.audio.pause();
    el.audio.currentTime = 0;
    S.playing = false;
    el.pPlay.textContent = '▶';
    el.pTm.textContent = '0:00';
    el.pP.value = 0;
  } else {
    el.audio.play().catch(e => console.warn('Audio playback error:', e));
    S.playing = true;
    el.pPlay.textContent = '■';
  }
}

function stop() {
  el.audio.pause();
  el.audio.currentTime = 0;
  S.playing = false;
  el.pPlay.textContent = '▶';
  el.pTm.textContent = '0:00';
  el.pP.value = 0;
}

function prev() {
  if (!S.tracks.length) return;
  play((S.idx - 1 + S.tracks.length) % S.tracks.length);
}

function next() {
  if (!S.tracks.length) return;
  play((S.idx + 1) % S.tracks.length);
}

function random() {
  if (!S.tracks.length) return;
  let i;
  do {
    i = Math.floor(Math.random() * S.tracks.length);
  } while (i === S.idx && S.tracks.length > 1);
  play(i);
}

// ═══ HELPERS ═══
function fmt(s) {
  if (!isFinite(s)) return '0:00';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

// ═══ EVENTS ═══
el.pPlay.onclick = togglePlay;
el.pPrev.onclick = prev;
el.pNext.onclick = next;
el.pRnd.onclick = random;

el.audio.ontimeupdate = () => {
  if (el.audio.duration) {
    el.pTm.textContent = fmt(el.audio.currentTime);
el.pP.value = (el.audio.currentTime / el.audio.duration) * 100;
}
};
el.audio.onloadedmetadata = () => {
el.pD.textContent = fmt(el.audio.duration);
};
el.audio.onended = next;
el.pP.oninput = () => {
if (el.audio.duration) el.audio.currentTime = (el.pP.value / 100) * el.audio.duration;
};
document.onkeydown = e => {
if (e.target.tagName === 'INPUT') return;
if (e.code === 'Space') {
e.preventDefault();
togglePlay();
}
if (e.code === 'ArrowLeft') prev();
if (e.code === 'ArrowRight') next();
if (e.code === 'KeyR') random();
if (e.code === 'Escape') el.mOv.classList.remove('open');
};
// ═══ INIT ═══
sync();
startSync();
