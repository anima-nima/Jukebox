// ═══ CONFIG ═══
const API_URL = 'https://script.google.com/macros/s/AKfycbzH2ScZCKVnHEHxbUb8np1ouILBmE-dhqMcqHnJOSiyyqjNdXD873tn2ZtaTqbj8F7N/exec';
const SYNC_MS = 1 * 60 * 1000;

const fileCache = new Map();

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

// ═══ DOM ═══
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
  mX: $('modalClose'),
  contextImg: $('contextImg'),
  contextMd: $('contextMd'),
  contextLogo: $('contextLogo')
};

// ═══ MARKDOWN (mit Bild-Support) ═══
function md(s) {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="\$2" alt="\$1" class="md-img">')
    .replace(/^### (.+)$/gm, '<h3>\$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>\$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>\$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>\$1</strong>')
    .replace(/\*(.+?)\*\*/g, '<em>\$1</em>')
    .replace(/`(.+?)`/g, '<code>\$1</code>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>\$1</blockquote>')
    .replace(/^[-] (.+)$/gm, '<li>\$1</li>')
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

// ═══ RENDER: TABS (mit Channel-Logos) ═══
async function renderTabs() {
  el.tabs.innerHTML = '';
  const names = Object.keys(S.data).filter(k => k !== '__jukebox');
  if (!names.length) {
    el.tabs.innerHTML = '<div class="empty">Keine Channels</div>';
    return;
  }
  for (const n of names) {
    const t = document.createElement('div');
    t.className = 'channel-tab' + (n === S.channel ? ' active' : '');

    const ch = S.data[n];
    if (ch && ch.logo) {
      const logoUrl = await loadDriveFile(ch.logo);
      if (logoUrl) {
        const logoImg = document.createElement('img');
        logoImg.src = logoUrl;
        logoImg.className = 'channel-tab-logo';
        logoImg.alt = '';
        t.appendChild(logoImg);
      }
    }

    const label = document.createElement('span');
    label.textContent = n;
    t.appendChild(label);
    t.onclick = () => selectChannel(n);
    el.tabs.appendChild(t);
  }
  if (!S.channel || !S.data[S.channel]) selectChannel(names[0]);
}

// ═══ RENDER: LEFT (Akkordeon) ═══
function selectChannel(name) {
  S.channel = name;
  S.project = null;
  S.tracks = [];
  S.idx = -1;
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

  // Tab-Titel: "Projekte" bei Hitproducer, "Themen" bei allen anderen
  el.lH.textContent = S.channel === 'Hitproducer' ? 'Projekte' : 'Themen';

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
  const items = ch.projects || [];
  if (!items.length) {
    el.lB.innerHTML = '<div class="empty">Keine ' + (S.channel === 'Hitproducer' ? 'Projekte' : 'Themen') + '</div>';
    return;
  }

  const acc = document.createElement('div');
  acc.className = 'accordion';

  items.forEach(p => {
    const isOpen = p.name === S.project;
    const item = document.createElement('div');
    item.className = 'accordion-item' + (isOpen ? ' open' : '');

    // Header
    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.innerHTML =
      '<span class="accordion-arrow">▶</span>' +
      (p.image ? `<img class="accordion-img" data-drive-id="${p.image}" alt="">` : '') +
      `<div class="accordion-info"><div class="accordion-name">${p.name}</div>` +
      `<div class="accordion-count">${p.tracks.length} Tracks</div></div>` +
      (p.qr ? `<img class="accordion-qr" data-drive-id="$${p.qr}" data-qr-id="$${p.qr}">` : '');
    header.onclick = e => {
      if (e.target.closest('.accordion-qr')) return;
      toggleAccordion(p);
    };

    // QR-Button
    const qr = header.querySelector('.accordion-qr');
    if (qr) {
      qr.onclick = e => {
        e.stopPropagation();
        modal(`<img data-drive-id="${qr.dataset.qrId}" alt="QR">`);
      };
    }

    item.appendChild(header);

    // Body mit Tracks
    const body = document.createElement('div');
    body.className = 'accordion-body';
    const ul = document.createElement('ul');
    ul.className = 'track-list';

    (p.tracks || []).forEach((t, ti) => {
      const li = document.createElement('li');
      const globalIdx = S.tracks.indexOf(t);
      li.className = 'track-item' + (globalIdx >= 0 && globalIdx === S.idx ? ' active' : '');
      li.innerHTML =
        (t.image ? `<img class="track-thumb" data-drive-id="$${t.image}" alt="">` : `<span class="track-num">$${ti + 1}</span>`) +
        `<div class="track-meta"><div class="track-name">${t.title}</div>` +
        `<div class="track-artist">${t.artist}</div></div>` +
        ((t.md || t.qr) ? '<button class="track-info-btn">i</button>' : '');
      li.onclick = () => {
        S.project = p.name;
        S.tracks = p.tracks || [];
        play(S.tracks.indexOf(t));
      };
      const ib = li.querySelector('.track-info-btn');
      if (ib) {
        ib.onclick = e => {
          e.stopPropagation();
          trackInfo(t);
        };
      }
      ul.appendChild(li);
    });

    body.appendChild(ul);
    item.appendChild(body);
    acc.appendChild(item);
  });

  el.lB.appendChild(acc);
  hydrateImages(el.lB);
}

function toggleAccordion(p) {
  if (S.project === p.name) {
    // Zuklappen
    S.project = null;
    S.tracks = [];
    S.idx = -1;
  } else {
    // Aufklappen
    S.project = p.name;
    S.tracks = p.tracks || [];
    S.idx = -1;
  }
  renderLeft();
  renderRight();
}

// ═══ RENDER: RIGHT (nur Bild + Text) ═══
async function renderRight() {
  const ch = S.data[S.channel];
  const proj = ch?.projects?.find(p => p.name === S.project);

  // Priorität: Aktiver Track → Projekt → Channel-Logo
  if (S.idx >= 0 && S.tracks[S.idx]) {
    const t = S.tracks[S.idx];
    el.rH.textContent = t.title;
    el.contextLogo.style.display = 'none';
    if (t.image) {
      el.contextImg.style.display = 'block';
      el.contextImg.src = '';
      const url = await loadDriveFile(t.image);
      if (url) el.contextImg.src = url;
    } else {
      el.contextImg.style.display = 'none';
    }
    el.contextMd.innerHTML = t.md ? md(t.md) : '';
  } else if (proj && proj.image) {
    el.rH.textContent = proj.name;
    el.contextLogo.style.display = 'none';
    el.contextImg.style.display = 'block';
    el.contextImg.src = '';
    const url = await loadDriveFile(proj.image);
    if (url) el.contextImg.src = url;
    el.contextMd.innerHTML = proj.md ? md(proj.md) : '';
  } else if (proj && proj.md) {
    el.rH.textContent = proj.name;
    el.contextImg.style.display = 'none';
    el.contextLogo.style.display = 'none';
    el.contextMd.innerHTML = md(proj.md);
  } else if (ch && ch.logo) {
    el.rH.textContent = S.channel || 'Info';
    el.contextImg.style.display = 'none';
    el.contextMd.innerHTML = ch.md ? md(ch.md) : '';
    el.contextLogo.style.display = 'block';
    el.contextLogo.src = '';
    const url = await loadDriveFile(ch.logo);
    if (url) el.contextLogo.src = url;
  } else {
    el.rH.textContent = 'Info';
    el.contextImg.style.display = 'none';
    el.contextLogo.style.display = 'none';
    el.contextMd.innerHTML = '<p class="empty">Keine Auswahl</p>';
  }
}

// ═══ MODAL ═══
function modal(html) {
  el.mC.innerHTML = html;
  el.mOv.classList.add('open');
  hydrateImages(el.mC);
}

function trackInfo(t) {
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
  renderLeft();
  renderRight();

  const srcUrl = await loadDriveFile(t.audioId);
  if (!srcUrl || S.idx !== i) return;

  el.pT.textContent = t.title;
  el.audio.src = srcUrl;
  el.audio.currentTime = 0;
  el.audio.play().catch(e => console.warn('Audio playback error:', e));
  S.playing = true;
  el.pPlay.textContent = '■';
}

function togglePlay() {
  if (S.idx < 0) return;
  if (S.playing) {
    el.audio.pause();
    S.playing = false;
    el.pPlay.textContent = '▶';
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
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowLeft') prev();
  if (e.code === 'ArrowRight') next();
  if (e.code === 'KeyR') random();
  if (e.code === 'Escape') el.mOv.classList.remove('open');
};

// ═══ INIT ═══
sync();
startSync();
