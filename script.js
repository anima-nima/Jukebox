// ============================================================================
// PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL BELOW:
// ============================================================================
const GOOGLE_SCRIPT_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_URL_HERE";

const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes silent background sync

window.addEventListener("load", () => {
  // DOM Elements
  const channelBtns = document.querySelectorAll(".channelBtn"),
        channelLogo = document.getElementById("channelLogo"),
        channelTitle = document.getElementById("channelTitle"),
        channelInfoBtn = document.getElementById("channelInfoBtn"),
        projectTabs = document.getElementById("projectTabs"),
        trackWrapper = document.getElementById("trackWrapper"),
        audioEngine = document.getElementById("audioEngine"),
        playPauseBtn = document.getElementById("playPauseBtn"),
        playIcon = document.getElementById("playIcon"),
        pauseIcon = document.getElementById("pauseIcon"),
        prevBtn = document.getElementById("prevBtn"),
        nextBtn = document.getElementById("nextBtn"),
        shuffleBtn = document.getElementById("shuffleBtn"),
        repeatBtn = document.getElementById("repeatBtn"),
        progressTrack = document.getElementById("progressTrack"),
        progressFill = document.getElementById("progressFill"),
        currentTimeEl = document.getElementById("currentTime"),
        endTimeEl = document.getElementById("endTime"),
        contextBadge = document.getElementById("contextBadge"),
        infoTitle = document.getElementById("infoTitle"),
        infoSubtitle = document.getElementById("infoSubtitle"),
        infoBody = document.getElementById("infoBody"),
        qrBox = document.getElementById("qrBox"),
        qrImage = document.getElementById("qrImage"),
        syncText = document.getElementById("syncText");

  // Application State
  let libraryData = null;
  let activeChannel = "hitproducer";
  let activeProjectId = null;
  let activeTrackId = null;
  let isPlaying = false;
  let isShuffle = false;
  let isRepeat = false;
  let swiper = null;

  // 1. Fetch Library from Google Drive Bridge
  async function syncLibrary(isInitial = false) {
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("PASTE_YOUR")) {
      infoTitle.textContent = "Setup Required";
      infoBody.innerHTML = "<p>Please paste your Google Apps Script Web App URL into <strong>script.js</strong>.</p>";
      return;
    }

    try {
      syncText.textContent = "Syncing...";
      const response = await fetch(`${GOOGLE_SCRIPT_URL}?t=${Date.now()}`);
      const freshData = await response.json();

      libraryData = freshData;
      const now = new Date();
      syncText.textContent = `Synced ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

      if (isInitial) {
        renderChannel(activeChannel);
      } else {
        reconcileActiveView();
      }
    } catch (err) {
      console.error("Sync error:", err);
      syncText.textContent = "Offline";
    }
  }

  // 2. Render Selected Channel (Hitproducer / kHaus)
  function renderChannel(channelKey) {
    activeChannel = channelKey;
    document.body.setAttribute("data-channel", channelKey);

    channelBtns.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.channel === channelKey);
    });

    if (!libraryData || !libraryData.channels[channelKey]) return;

    const ch = libraryData.channels[channelKey];
    channelTitle.textContent = ch.name || channelKey;
    channelLogo.src = ch.logoUrl || "";
    channelLogo.style.visibility = ch.logoUrl ? "visible" : "hidden";

    renderProjectTabs(ch.projects);

    if (ch.projects && ch.projects.length > 0) {
      const targetProj = ch.projects.find(p => p.id === activeProjectId) || ch.projects[0];
      selectProject(targetProj.id, false);
    } else {
      activeProjectId = null;
      renderTracks([]);
      showChannelInfo();
    }
  }

  // 3. Render Project Subfolder Tabs
  function renderProjectTabs(projects) {
    projectTabs.innerHTML = "";
    if (!projects) return;

    projects.forEach(proj => {
      const btn = document.createElement("button");
      btn.className = "projectTab" + (proj.id === activeProjectId ? " active" : "");
      btn.dataset.projectId = proj.id;
      btn.innerHTML = `
        ${proj.logoUrl ? `<img src="${proj.logoUrl}" alt="">` : ""}
        <span>${proj.name}</span>
      `;
      btn.addEventListener("click", () => selectProject(proj.id, true));
      projectTabs.appendChild(btn);
    });
  }

  // 4. Select a Project Subfolder
  function selectProject(projectId, showProjectNotes = false) {
    activeProjectId = projectId;
    document.querySelectorAll(".projectTab").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.projectId === projectId);
    });

    const ch = libraryData.channels[activeChannel];
    const proj = ch.projects.find(p => p.id === projectId);
    if (!proj) return;

    renderTracks(proj.tracks);

    if (showProjectNotes && proj.descriptionHtml && proj.tracks.length === 0) {
      showProjectInfo(proj);
    }
  }

  // 5. Render Swiper Track Slides
  function renderTracks(tracks) {
    if (swiper) {
      swiper.destroy(true, true);
      swiper = null;
    }

    trackWrapper.innerHTML = "";

    if (!tracks || tracks.length === 0) {
      trackWrapper.innerHTML = `
        <div class="swiper-slide">
          <div class="coverFrame"></div>
          <p class="slideArtist">Empty Folder</p>
          <h3 class="slideTitle">No Audio Tracks Found</h3>
        </div>`;
      return;
    }

    tracks.forEach(track => {
      const slide = document.createElement("div");
      slide.className = "swiper-slide";
      slide.dataset.trackId = track.id;
      slide.innerHTML = `
        <div class="coverFrame">
          <img src="${track.imageUrl}" alt="${track.title}">
        </div>
        <p class="slideArtist">${track.artist}</p>
        <h3 class="slideTitle">${track.title}</h3>
      `;
      trackWrapper.appendChild(slide);
    });

    const initialIdx = Math.max(0, tracks.findIndex(t => t.id === activeTrackId));

    swiper = new Swiper(".trackSwiper", {
      direction: "horizontal",
      effect: "coverflow",
      centeredSlides: true,
      slidesPerView: "auto",
      initialSlide: initialIdx,
      speed: 450,
      coverflowEffect: {
        rotate: 30,
        stretch: 0,
        depth: 120,
        modifier: 1,
        slideShadows: false
      },
      on: {
        slideChange: function() {
          const newTrack = tracks[this.activeIndex];
          if (newTrack) {
            loadTrack(newTrack, isPlaying);
          }
        }
      }
    });

    // Load initial track if not already playing this exact track
    const currentTrack = tracks[initialIdx];
    if (currentTrack && currentTrack.id !== activeTrackId) {
      loadTrack(currentTrack, false);
    } else if (currentTrack) {
      updateTrackInfoPanel(currentTrack);
    }
  }

  // 6. Silent 10-Minute Reconciliation (Continuous Playback Safe)
  function reconcileActiveView() {
    const ch = libraryData.channels[activeChannel];
    if (!ch) return;

    channelTitle.textContent = ch.name || activeChannel;
    if (ch.logoUrl) channelLogo.src = ch.logoUrl;

    renderProjectTabs(ch.projects);

    const proj = ch.projects.find(p => p.id === activeProjectId) || ch.projects[0];
    if (!proj) {
      renderTracks([]);
      return;
    }
    activeProjectId = proj.id;

    const currentSlideIds = Array.from(trackWrapper.querySelectorAll(".swiper-slide"))
      .map(el => el.dataset.trackId);
    const freshIds = proj.tracks.map(t => t.id);

    const hasListChanged =
      currentSlideIds.length !== freshIds.length ||
      currentSlideIds.some((id, idx) => id !== freshIds[idx]);

    if (!hasListChanged) {
      // List is identical: update active track metadata/description in place without touching audio
      const activeObj = proj.tracks.find(t => t.id === activeTrackId);
      if (activeObj) updateTrackInfoPanel(activeObj);
      return;
    }

    // Check if the currently playing song still exists in the updated folder
    const stillExists = proj.tracks.find(t => t.id === activeTrackId);
    if (stillExists) {
      // Rebuild slides around the currently playing track without interrupting audioEngine
      renderTracks(proj.tracks);
    } else {
      // Currently playing folder was deleted: smoothly load the first available track
      activeTrackId = null;
      renderTracks(proj.tracks);
      if (proj.tracks.length > 0 && isPlaying) {
        loadTrack(proj.tracks[0], true);
      }
    }
  }

  // 7. Load & Play Audio Track
  function loadTrack(track, autoPlay = false) {
    activeTrackId = track.id;
    updateTrackInfoPanel(track);

    if (audioEngine.src !== track.audioUrl) {
      audioEngine.src = track.audioUrl;
      progressFill.style.width = "0%";
      currentTimeEl.textContent = "00:00";
      endTimeEl.textContent = "00:00";
    }

    if (autoPlay) {
      audioEngine.play().then(() => {
        setPlayState(true);
      }).catch(() => {
        setPlayState(false);
      });
    }
  }

  function setPlayState(playing) {
    isPlaying = playing;
    playIcon.classList.toggle("hidden", playing);
    pauseIcon.classList.toggle("hidden", !playing);
  }

  // 8. Right-Side Description & QR Code Panel
  function updateTrackInfoPanel(track) {
    contextBadge.textContent = "TRACK INFO";
    infoTitle.textContent = track.title;
    infoSubtitle.textContent = track.artist;
    infoBody.innerHTML = track.descriptionHtml || "<p>No description available for this track.</p>";

    if (track.qrUrl) {
      qrImage.src = track.qrUrl;
      qrBox.classList.remove("hidden");
    } else {
      qrBox.classList.add("hidden");
    }
  }

  function showProjectInfo(proj) {
    contextBadge.textContent = "PROJECT INFO";
    infoTitle.textContent = proj.name;
    infoSubtitle.textContent = channelTitle.textContent;
    infoBody.innerHTML = proj.descriptionHtml || "No project description available.";
    qrBox.classList.add("hidden");
  }

  function showChannelInfo() {
    const ch = libraryData?.channels[activeChannel];
    if (!ch) return;
    contextBadge.textContent = "CHANNEL INFO";
    infoTitle.textContent = ch.name;
    infoSubtitle.textContent = "Channel Overview";
    infoBody.innerHTML = ch.descriptionHtml || "No channel description available.";
    qrBox.classList.add("hidden");
  }

  // Event Listeners
  channelBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.channel !== activeChannel) {
        activeProjectId = null;
        renderChannel(btn.dataset.channel);
      }
    });
  });

  channelInfoBtn.addEventListener("click", showChannelInfo);

  playPauseBtn.addEventListener("click", () => {
    if (!audioEngine.src) return;
    if (audioEngine.paused) {
      audioEngine.play().then(() => setPlayState(true));
    } else {
      audioEngine.pause();
      setPlayState(false);
    }
  });

  prevBtn.addEventListener("click", () => {
    if (swiper) swiper.slidePrev();
  });

  nextBtn.addEventListener("click", () => {
    if (!swiper) return;
    if (isShuffle && swiper.slides.length > 1) {
      let rand;
      do {
        rand = Math.floor(Math.random() * swiper.slides.length);
      } while (rand === swiper.activeIndex);
      swiper.slideTo(rand);
    } else {
      swiper.slideNext();
    }
  });

  shuffleBtn.addEventListener("click", () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle("active", isShuffle);
  });

  repeatBtn.addEventListener("click", () => {
    isRepeat = !isRepeat;
    repeatBtn.classList.toggle("active", isRepeat);
  });

  // Audio Progress & Auto-Advance
  audioEngine.addEventListener("loadedmetadata", () => {
    endTimeEl.textContent = formatTime(audioEngine.duration);
  });

  audioEngine.addEventListener("timeupdate", () => {
    if (!audioEngine.duration) return;
    const pct = (audioEngine.currentTime / audioEngine.duration) * 100;
    progressFill.style.width = `${pct}%`;
    currentTimeEl.textContent = formatTime(audioEngine.currentTime);
  });

  audioEngine.addEventListener("ended", () => {
    if (isRepeat) {
      audioEngine.currentTime = 0;
      audioEngine.play();
    } else if (swiper) {
      if (isShuffle && swiper.slides.length > 1) {
        let rand;
        do {
          rand = Math.floor(Math.random() * swiper.slides.length);
        } while (rand === swiper.activeIndex);
        swiper.slideTo(rand);
      } else if (swiper.activeIndex < swiper.slides.length - 1) {
        swiper.slideNext();
      } else {
        swiper.slideTo(0);
      }
    }
  });

  progressTrack.addEventListener("click", (e) => {
    if (!audioEngine.duration) return;
    const rect = progressTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioEngine.currentTime = ratio * audioEngine.duration;
  });

  function formatTime(sec) {
    if (isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  // Initial Load & 10-Minute Background Polling
  syncLibrary(true);
  setInterval(() => syncLibrary(false), SYNC_INTERVAL_MS);
});
