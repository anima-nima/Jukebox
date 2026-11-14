// ═══ CONFIG ═══
const API_URL = 'https://script.google.com/macros/s/AKfycbzH2ScZCKVnHEHxbUb8np1ouILBmE-dhqMcqHnJOSiyyqjNdXD873tn2ZtaTqbj8F7N/exec';
const SYNC_MS = 1 * 60 * 1000;

const fileCache = new Map();

async function loadDriveFile(id) {
  if (!id) return '';
  if (fileCache.has(id)) return fileCache.get(id);
  try {
    const res = await fetch(`${API_URL}?action=media&id=${encodeURIComponent(id)}`, { redirect: 'follow' });
    if (!res.ok) {
      console.warn('HTTP', res.status, 'für ID:', id);
      return '';
    }
    const json = await res.json();
    if (json.base64 && json.mimeType) {
      const dataUrl = `data:${json.mimeType};base64,${json.base64}`;
      fileCache.set(id, dataUrl);
      return dataUrl;
    }
    console.warn('Media-Fehler für', id, ':', json.error || json);
  } catch (e) {
    console.error('Fetch-Fehler für ' + id, e);
  }
  return '';
}

function hydrateImages(container = document) {
  container.querySelectorAll('img[data-drive-id]').forEach(async img => {
    const id = img.getAttribute('data-drive-id');
    if (!id || img.dataset.loaded) return;
    const url = await loadDriveFile(id);
    if (url) {
      img.src = url;
      img.dataset.loaded = '1';
    }
  });
}

// ═══ STATE ═══
// Anzeige-State (was gerade sichtbar ist)
let S = { data: {}, channel: null, project: null, tracks: [], idx: -1, timer: null };
// Playback-State (was gerade spielt – unabhängig von der Anzeige)
let P = { channel: null, project: null, tracks: [], idx: -1, playing: false };

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
  contextImageWrap: $('contextImageWrap'),
  contextImg: $('contextImg'),
  contextLogo: $('contextLogo'),
  contextText: $('contextText'),
  fadeTop: $('fadeTop'),
  fadeBottom: $('fadeBottom')
};

// ═══ MARKDOWN ═══
function md(s) {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/!\[([^\]]*)\]\(([a-zA-Z0-9_-]{25,})\)/g, '<img data-drive-id="\$2" alt="\$1" class="md-img">')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '<img src="\$2" alt="\$1" class="md-img">')
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

// ═══ RENDER: TABS ═══
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
    if (ch && ch.image) {
      const logoUrl = await loadDriveFile(ch.image);
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
  // Playback läuft weiter – P wird nicht geändert
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

    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.innerHTML =
      '<span class="accordion-arrow">▶</span>' +
      (p.image ? `<img class="accordion-img" data-drive-id="${p.image}" alt="">` : '') +
      `<div class="accordion-info"><div class="accordion-name">${p.name}</div>` +
      `<div class="accordion-count">${p.tracks.length} Tracks</div></div>` +
      (p.qr ? `<img class="accordion-qr" data-drive-id="${p.qr}" data-qr-id="${p.qr}">` : '');
    header.onclick = e => {
      if (e.target.closest('.accordion-qr')) return;
      toggleAccordion(p);
    };

    const qr = header.querySelector('.accordion-qr');
    if (qr) {
      qr.onclick = e => {
        e.stopPropagation();
        showQR(qr.dataset.qrId);
      };
    }

    item.appendChild(header);

    const body = document.createElement('div');
    body.className = 'accordion-body';
    const ul = document.createElement('ul');
    ul.className = 'track-list';

    (p.tracks || []).forEach((t, ti) => {
      const li = document.createElement('li');
      const isActive = S.project === p.name && S.tracks.indexOf(t) === S.idx;
      li.className = 'track-item' + (isActive ? ' active' : '');

      // Thumbnail
      let thumbHtml;
      if (t.image) {
        thumbHtml = `<img class="track-thumb" data-drive-id="${t.image}" alt="">`;
      } else {
        thumbHtml = `<span class="track-num">${ti + 1}</span>`;
      }

      // QR-Button
      let qrHtml = '';
      if (t.qr) {
        qrHtml = '<button class="track-qr-btn" title="QR-Code anzeigen">🔗</button>';
      }

      li.innerHTML =
        thumbHtml +
        `<div class="track-meta"><div class="track-name">${t.title}</div>` +
        `<div class="track-artist">${t.artist}</div></div>` +
        qrHtml;

      li.onclick = () => {
        S.project = p.name;
        S.tracks = p.tracks || [];
        play(S.tracks.indexOf(t));
      };

      const qb = li.querySelector('.track-qr-btn');
      if (qb) {
        qb.onclick = e => {
          e.stopPropagation();
          showQR(t.qr);
        };
      }

      ul.appendChild(li);
    });

    body.appendChild(ul);
    item.appendChild(body);
    acc.appendChild(item);
  });

  el.lB.appendChild(acc);

  // Alle Bilder direkt laden
  const allImgs = el.lB.querySelectorAll('img[data-drive-id]');
  allImgs.forEach(async img => {
    const id = img.getAttribute('data-drive-id');
    if (!id || img.dataset.loaded) return;
    const url = await loadDriveFile(id);
    if (url) {
      img.src = url;
      img.dataset.loaded = '1';
    }
  });
}

function toggleAccordion(p) {
  if (S.project === p.name) {
    S.project = null;
    S.tracks = [];
    S.idx = -1;
  } else {
    S.project = p.name;
    S.tracks = p.tracks || [];
    S.idx = -1;
  }
  renderLeft();
  renderRight();
}

// ═══ RENDER: RIGHT ═══
async function renderRight() {
  const ch = S.data[S.channel];
  const proj = ch?.projects?.find(p => p.name === S.project);

  el.contextText.scrollTop = 0;
  el.contextImageWrap.classList.remove('shrunk');
  updateFades();

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
    el.contextText.innerHTML = t.md ? md(t.md) : '';
  } else if (proj) {
    el.rH.textContent = proj.name;
    el.contextLogo.style.display = 'none';
    if (proj.image) {
      el.contextImg.style.display = 'block';
      el.contextImg.src = '';
      const url = await loadDriveFile(proj.image);
      if (url) el.contextImg.src = url;
    } else {
      el.contextImg.style.display = 'none';
    }
    el.contextText.innerHTML = proj.md ? md(proj.md) : '';
  } else if (ch && ch.image) {
    el.rH.textContent = S.channel || 'Info';
    el.contextImg.style.display = 'none';
    el.contextText.innerHTML = ch.md ? md(ch.md) : '';
    el.contextLogo.style.display = 'block';
    el.contextLogo.src = '';
    const url = await loadDriveFile(ch.image);
    if (url) el.contextLogo.src = url;
  } else {
    el.rH.textContent = 'Info';
    el.contextImg.style.display = 'none';
    el.contextLogo.style.display = 'none';
    el.contextText.innerHTML = '<p class="empty">Keine Auswahl</p>';
  }

  hydrateImages(el.contextText);
  updateFades();
}

// ═══ QR-MODAL ═══
async function showQR(qrId) {
  if (!qrId) return;
  const hint = S.channel === 'Hitproducer'
    ? 'Folge dem Track auf SoundCloud!'
    : 'Folge diesem QR-Code für mehr Infos';
  const url = await loadDriveFile(qrId);
  const imgHtml = url ? `<img src="${url}" alt="QR-Code">` : '<p class="empty">QR-Code konnte nicht geladen werden</p>';
  modal(`<div class="qr-modal">$${imgHtml}<p class="qr-hint">$${hint}</p></div>`);
}

// ═══ SCROLL-EFFEKTE ═══
function updateFades() {
  const el2 = el.contextText;
  const hasScroll = el2.scrollHeight > el2.clientHeight;
  const atTop = el2.scrollTop <= 4;
  const atBottom = el2.scrollTop + el2.clientHeight >= el2.scrollHeight - 4;
  el.fadeTop.classList.toggle('visible', hasScroll && !atTop);
  el.fadeBottom.classList.toggle('visible', hasScroll && !atBottom);
}

el.contextText.addEventListener('scroll', () => {
  updateFades();
  const shrunk = el.contextText.scrollTop > 40;
  el.contextImageWrap.classList.toggle('shrunk', shrunk);
});

// ═══ MODAL ═══
function modal(html) {
  el.mC.innerHTML = html;
  el.mOv.classList.add('open');
  hydrateImages(el.mC);
}

el.mX.onclick = () => el.mOv.classList.remove('open');
el.mOv.onclick = e => {
  if (e.target === el.mOv) el.mOv.classList.remove('open');
};

// ═══ PLAYBACK (nutzt P, nicht S) ═══
async function play(i) {
  if (i < 0 || i >= S.tracks.length) return;
  S.idx = i;
  const t = S.tracks[i];

  // Playback-State aktualisieren
  P.channel = S.channel;
  P.project = S.project;
  P.tracks = S.tracks;
  P.idx = i;

  el.pT.textContent = t.title + ' (Lädt...)';
  el.pA.textContent = t.artist;
  renderLeft();
  renderRight();

  const srcUrl = await loadDriveFile(t.audioId);
  if (!srcUrl || P.idx !== i) return;

  el.pT.textContent = t.title;
  el.audio.src = srcUrl;
  el.audio.currentTime = 0;
  el.audio.play().catch(e => console.warn('Audio playback error:', e));
  P.playing = true;
  el.pPlay.textContent = '■';
}

function togglePlay() {
  if (P.idx < 0) return;
  if (P.playing) {
    el.audio.pause();
    P.playing = false;
    el.pPlay.textContent = '▶';
  } else {
    el.audio.play().catch(e => console.warn('Audio playback error:', e));
    P.playing = true;
    el.pPlay.textContent = '■';
  }
}

function stop() {
  el.audio.pause();
  el.audio.currentTime = 0;
  P.playing = false;
  P.idx = -1;
  el.pPlay.textContent = '▶';
  el.pTm.textContent = '0:00';
  el.pP.value = 0;
  el.pT.textContent = '–';
  el.pA.textContent = '–';
}

function prev() {
  if (!P.tracks.length) return;
  // Wenn anderer Channel angezeigt wird → dorthin wechseln
  if (P.channel !== S.channel) {
    S.channel = P.channel;
    S.project = P.project;
    S.tracks = P.tracks;
    renderTabs();
    renderLeft();
    renderRight();
  }
  const newIdx = (P.idx - 1 + P.tracks.length) % P.tracks.length;
  S.idx = newIdx;
  P.idx = newIdx;
  playTrack(P.tracks[newIdx]);
}

function next() {
  if (!P.tracks.length) return;
  if (P.channel !== S.channel) {
    S.channel = P.channel;
    S.project = P.project;
    S.tracks = P.tracks;
    renderTabs();
    renderLeft();
    renderRight();
  }
  const newIdx = (P.idx + 1) % P.tracks.length;
  S.idx = newIdx;
  P.idx = newIdx;
  playTrack(P.tracks[newIdx]);
}

function random() {
  if (!P.tracks.length) return;
  if (P.channel !== S.channel) {
    S.channel = P.channel;
    S.project = P.project;
    S.tracks = P.tracks;
    renderTabs();
    renderLeft();
    renderRight();
  }
  let i;
  do {
    i = Math.floor(Math.random() * P.tracks.length);
  } while (i === P.idx && P.tracks.length > 1);
  S.idx = i;
  P.idx = i;
  playTrack(P.tracks[i]);
}

// Gemeinsame Playback-Funktion
async function playTrack(t) {
  el.pT.textContent = t.title + ' (Lädt...)';
  el.pA.textContent = t.artist;
  renderLeft();
  renderRight();

  const srcUrl = await loadDriveFile(t.audioId);
  if (!srcUrl) return;

  el.pT.textContent = t.title;
  el.audio.src = srcUrl;
  el.audio.currentTime = 0;
  el.audio.play().catch(e => console.warn('Audio playback error:', e));
  P.playing = true;
  el.pPlay.textContent = '■';
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
