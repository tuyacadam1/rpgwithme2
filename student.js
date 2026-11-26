(() => {
  const API_URL = "https://script.google.com/macros/s/AKfycbxPN7yKyqOwyyxIarj2BTkIcuMOomlfc52zCo2vK4AcVWg8TRofqKaRR-kj1yKiLiENWA/exec";

  // --- DEVTOOLS & CONSOLE DETERRENT SHIELD ---
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'K'].includes(e.key.toUpperCase())) ||
      (e.metaKey && e.altKey && ['I', 'J', 'C', 'K'].includes(e.key.toUpperCase())) ||
      (e.ctrlKey && e.key.toUpperCase() === 'U')
    ) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  let devToolsOpen = false;
  setInterval(() => {
    const widthDiff = window.outerWidth - window.innerWidth > 170;
    const heightDiff = window.outerHeight - window.innerHeight > 170;
    if (widthDiff || heightDiff) {
      if (!devToolsOpen) {
        devToolsOpen = true;
        idlePaused = true;
        showToast("⚠️ Close Developer Tools / Inspect Element to continue!", "#dc2626");
      }
    } else if (devToolsOpen) {
      devToolsOpen = false;
      idlePaused = false;
      hideToast();
    }
  }, 1500);

  let hero = null;
  let sessionToken = '';
  let hasUnsaved = false;
  let isSyncing = false;
  let queuedSync = false;
  let localEquipRevision = 0;
  let equipSyncDebounce = null;
  let idleAnimFrame = 0;
  let actionAnimFrame = 0;
  let isPlayingAction = false;
  let heroAnimRow = 0;

  let idlePaused = false;
  let heroHP = 100;
  let heroMaxHP = 100;
  let enemyHP = 100;
  let enemyMaxHP = 100;
  let idleTurn = 'hero';

  // --- LEADERBOARD, 3v3 PVP & GUILD STATE ---
  let mainLbMode = 'tower';
  let pvpPlayersCache = [];
  let draftSquadIds = [];
  let pvpBattle = null; // Shared by 'pvp' and 'guild' 3v3 battles
  let pvpSpeedMult = 1;
  const pvpActionTimers = { my: null, opp: null };
  let guildHubCache = null;
  let guildWarTimerInterval = null;
  let newGuildPhotoDataUrl = '';
  let editGuildPhotoDataUrl = '';

  const RARITY_MULT = { Common: 1.0, Rare: 1.2, Epic: 1.5, Legendary: 2.0, Secret: 2.6, Divine: 3.5 };
  const RARITY_ORDER = { Divine: 1, Secret: 2, Legendary: 3, Epic: 4, Rare: 5, Common: 6 };

  // --- ANTI-TIE PVP NET SCORE HELPER (+10 per Win, -6 per Loss) ---
  function getPvpNetScore(wins, losses) {
    const w = Number(wins) || 0;
    const l = Number(losses) || 0;
    return (w * 10) - (l * 6);
  }

  function sortPvpPlayersAntiTie(list) {
    return (list || []).slice().sort((a, b) => {
      const netA = getPvpNetScore(a.wins, a.losses);
      const netB = getPvpNetScore(b.wins, b.losses);
      if (netB !== netA) return netB - netA;
      const ptsA = Number(a.pvpPoints) || 1000;
      const ptsB = Number(b.pvpPoints) || 1000;
      if (ptsB !== ptsA) return ptsB - ptsA;
      const wDiff = (Number(b.wins) || 0) - (Number(a.wins) || 0);
      if (wDiff !== 0) return wDiff;
      return (Number(b.teamCP) || 0) - (Number(a.teamCP) || 0);
    });
  }

  function isWeekendBoostActive() {
    if (hero && typeof hero.weekendBoost === 'boolean') return hero.weekendBoost;
    const day = new Date().getDay();
    return day === 0 || day === 6;
  }

  // --- AUTO-BOUNDING-BOX SPRITE ANALYZER ---
  const spriteBoundsCache = {};

  function analyzeSpriteSheet(asset) {
    if (!asset || !asset.imageData) return null;
    const cols = Math.max(1, asset.meta?.cols || 1);
    const rows = Math.max(1, asset.meta?.rows || 1);
    const cacheKey = `${asset.imageData}|${cols}x${rows}`;

    if (spriteBoundsCache[cacheKey]) return spriteBoundsCache[cacheKey];

    const entry = { ready: false, rowMetrics: [] };
    spriteBoundsCache[cacheKey] = entry;

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) return;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);

        const cellW = w / cols;
        const cellH = h / rows;

        for (let r = 0; r < rows; r++) {
          let minY = cellH;
          let maxY = 0;
          let foundAny = false;

          const startY = Math.floor(r * cellH);
          const endY = Math.min(h, Math.floor((r + 1) * cellH));
          const imgData = ctx.getImageData(0, startY, w, endY - startY).data;
          const rowHeightPx = endY - startY;

          for (let y = 0; y < rowHeightPx; y++) {
            for (let x = 0; x < w; x += 2) {
              const alpha = imgData[(y * w + x) * 4 + 3];
              if (alpha > 20) {
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                foundAny = true;
              }
            }
          }

          let f0MinX = cellW, f0MaxX = 0, f0MinY = cellH, f0MaxY = 0, f0Found = false;
          const f0EndX = Math.min(w, Math.floor(cellW));
          for (let y = 0; y < rowHeightPx; y++) {
            for (let x = 0; x < f0EndX; x++) {
              const alpha = imgData[(y * w + x) * 4 + 3];
              if (alpha > 25) {
                if (x < f0MinX) f0MinX = x;
                if (x > f0MaxX) f0MaxX = x;
                if (y < f0MinY) f0MinY = y;
                if (y > f0MaxY) f0MaxY = y;
                f0Found = true;
              }
            }
          }

          if (foundAny && maxY > minY) {
            const contentHeight = maxY - minY;
            const paddedHeight = Math.min(cellH, contentHeight * 1.18);
            const zoom = Math.max(1.0, Math.min(1.45, cellH / paddedHeight));
            const centerNorm = ((minY + maxY) * 0.5) / cellH;

            const bodyH = f0Found ? Math.max(1, f0MaxY - f0MinY) : contentHeight;
            const faceCenterX = f0Found ? ((f0MinX + f0MaxX) * 0.5) / cellW : 0.5;
            const faceCenterY = f0Found
              ? (f0MinY + bodyH * 0.25) / cellH
              : (minY + contentHeight * 0.25) / cellH;
            const faceZoom = Math.max(1.5, Math.min(2.6, (cellH / bodyH) * 1.65));

            entry.rowMetrics[r] = { zoom, centerNorm, faceCenterX, faceCenterY, faceZoom };
          } else {
            entry.rowMetrics[r] = { zoom: 1.08, centerNorm: 0.48, faceCenterX: 0.5, faceCenterY: 0.28, faceZoom: 1.9 };
          }
        }
        entry.ready = true;
        if (hero) {
          const charObj = getEquippedCharacterObj();
          if (charObj) applyPortraitCloseup(document.getElementById('hud-hero-portrait'), charObj);
          const enemy = getFloorEnemy(hero.towerFloor);
          if (enemy && enemy.asset) applyPortraitCloseup(document.getElementById('hud-enemy-portrait'), enemy.asset);
        }
        if (pvpBattle) renderPvpBattleUI();
      } catch (_) {
        for (let r = 0; r < rows; r++) {
          entry.rowMetrics[r] = { zoom: 1.08, centerNorm: 0.48, faceCenterX: 0.5, faceCenterY: 0.28, faceZoom: 1.9 };
        }
        entry.ready = true;
      }
    };
    img.src = asset.imageData;
    return entry;
  }

  function computeFrameBackground(asset, col, row) {
    const cols = Math.max(1, asset.meta?.cols || 1);
    const rows = Math.max(1, asset.meta?.rows || 1);
    const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;

    if (rows <= 1) {
      return { size: `${cols * 100}% 100%`, pos: `${xPct}% 0%` };
    }

    const analysis = analyzeSpriteSheet(asset);
    const metric = (analysis && analysis.ready && analysis.rowMetrics[row])
      ? analysis.rowMetrics[row]
      : { zoom: 1.08, centerNorm: 0.48 };

    const zoom = metric.zoom;
    const rowTop = row / rows;
    const rowCenter = rowTop + (metric.centerNorm / rows);
    const denom = 1 - (1 / (rows * zoom));
    const rawYPct = denom > 0 ? ((rowCenter - (0.5 / (rows * zoom))) / denom) * 100 : 0;
    const yPct = Math.max(0, Math.min(100, rawYPct));

    return {
      size: `${cols * 100}% ${rows * zoom * 100}%`,
      pos: `${xPct}% ${yPct}%`
    };
  }

  function getFaceCloseupCss(asset, customScale = 1.0) {
    const cols = Math.max(1, asset.meta?.cols || 1);
    const rows = Math.max(1, asset.meta?.rows || 1);
    const analysis = analyzeSpriteSheet(asset);
    const metric = (analysis && analysis.ready && analysis.rowMetrics[0])
      ? analysis.rowMetrics[0]
      : { faceCenterX: 0.5, faceCenterY: 0.28, faceZoom: 1.9 };

    const z = Math.max(1.3, metric.faceZoom * customScale);
    const cx = metric.faceCenterX / cols;
    const cy = metric.faceCenterY / rows;

    const denomX = 1 - (1 / (cols * z));
    const denomY = 1 - (1 / (rows * z));

    const xPct = denomX > 0 ? Math.max(0, Math.min(100, ((cx - (0.5 / (cols * z))) / denomX) * 100)) : 50;
    const yPct = denomY > 0 ? Math.max(0, Math.min(100, ((cy - (0.5 / (rows * z))) / denomY) * 100)) : 20;

    return {
      size: `${cols * z * 100}% ${rows * z * 100}%`,
      pos: `${xPct}% ${yPct}%`
    };
  }

  function applyPortraitCloseup(el, asset) {
    if (!el || !asset) return;
    const face = getFaceCloseupCss(asset, 1.0);
    el.style.backgroundImage = `url(${asset.imageData})`;
    el.style.backgroundSize = face.size;
    el.style.backgroundPosition = face.pos;
  }

  // --- ANIME THEME BGM & SFX ENGINE ---
  let audioCtx = null;
  let bgmPlaying = false;
  let bgmStep = 0;
  let bgmTimer = null;

  const ANIME_MELODY = [
    659.25, 0, 783.99, 987.77, 880.00, 783.99, 659.25, 587.33,
    659.25, 0, 783.99, 1174.66, 987.77, 0, 880.00, 783.99,
    659.25, 0, 783.99, 987.77, 1174.66, 1318.51, 1174.66, 987.77,
    880.00, 783.99, 659.25, 587.33, 493.88, 0, 587.33, 659.25
  ];
  const ANIME_BASS = [
    164.81, 164.81, 164.81, 164.81, 130.81, 130.81, 130.81, 130.81,
    196.00, 196.00, 196.00, 196.00, 146.83, 146.83, 146.83, 146.83,
    164.81, 164.81, 164.81, 164.81, 130.81, 130.81, 130.81, 130.81,
    196.00, 196.00, 146.83, 146.83, 164.81, 164.81, 164.81, 164.81
  ];

  function initAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function startAnimeBGM() {
    initAudio();
    if (bgmPlaying) return;
    bgmPlaying = true;
    updateBGMButton();

    bgmTimer = setInterval(() => {
      if (!bgmPlaying || !audioCtx) return;
      const now = audioCtx.currentTime;
      const leadFreq = ANIME_MELODY[bgmStep % ANIME_MELODY.length];
      const bassFreq = ANIME_BASS[bgmStep % ANIME_BASS.length];

      if (leadFreq > 0) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(leadFreq, now);
        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      }

      if (bassFreq > 0) {
        const bOsc = audioCtx.createOscillator();
        const bGain = audioCtx.createGain();
        bOsc.type = 'triangle';
        bOsc.frequency.setValueAtTime(bassFreq, now);
        bGain.gain.setValueAtTime(0.07, now);
        bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        bOsc.connect(bGain);
        bGain.connect(audioCtx.destination);
        bOsc.start(now);
        bOsc.stop(now + 0.17);
      }

      bgmStep++;
    }, 190);
  }

  function stopAnimeBGM() {
    bgmPlaying = false;
    if (bgmTimer) clearInterval(bgmTimer);
    updateBGMButton();
  }

  function toggleAnimeBGM() {
    if (bgmPlaying) stopAnimeBGM();
    else startAnimeBGM();
  }

  function updateBGMButton() {
    const btn = document.getElementById('bgm-toggle-btn');
    if (!btn) return;
    btn.innerText = bgmPlaying ? '🎵 BGM: ON' : '🔇 BGM: OFF';
    btn.style.color = bgmPlaying ? '#fde047' : '#e2e8f0';
  }

  function playAnimeSFX(type) {
    if (!bgmPlaying || !audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    if (type === 'slash') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.11);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.12);
    } else if (type === 'gacha' || type === 'levelup') {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((n, idx) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(n, now + idx * 0.08);
        g.gain.setValueAtTime(0.08, now + idx * 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now + idx * 0.08); o.stop(now + idx * 0.08 + 0.26);
      });
    }
  }

  const EMPTY_SLOT_SILHOUETTE = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="40" r="18" fill="#334155"/><path d="M32,102 Q32,68 60,68 Q88,68 88,102 Z" fill="#334155"/><text x="60" y="55" text-anchor="middle" fill="#94a3b8" font-size="28" font-weight="bold">?</text></svg>`
  );

  const FALLBACK_MOB = {
    name: 'Tower Guardian',
    imageData: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><ellipse cx="80" cy="90" rx="46" ry="40" fill="#16a34a"/><circle cx="64" cy="80" r="7" fill="#fef08a"/><circle cx="96" cy="80" r="7" fill="#fef08a"/></svg>`),
    meta: { cols: 1, rows: 1 }
  };

  const FALLBACK_BOSS = {
    name: 'Floor Overlord',
    imageData: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><ellipse cx="80" cy="92" rx="54" ry="46" fill="#7f1d1d" stroke="#fbbf24" stroke-width="4"/><circle cx="62" cy="80" r="9" fill="#fbbf24"/><circle cx="98" cy="80" r="9" fill="#fbbf24"/></svg>`),
    meta: { cols: 1, rows: 1 }
  };

  // --- 1. LOGIN ---
  async function loginStudent() {
    const studentId = document.getElementById('student-id-input').value.trim();
    const pin = document.getElementById('student-pin-input').value.trim();
    if (!studentId) return alert("Enter your Student ID.");
    if (!pin) return alert("Enter your PIN.");

    startAnimeBGM();
    showToast("Summoning World...", "#e11d48");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'studentLogin', studentId, pin })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      hero = json.data;
      sessionToken = json.data.token || '';

      if (!hero.avatar || !Array.isArray(hero.avatar.unlockedChars)) {
        hero.avatar = { unlockedChars: [], equippedChar: null, pityEpic: 0, pityLeg: 0, pitySecret: 0, pityDivine: 0, pvpSquad: [], pvpWins: 0, pvpLosses: 0, pvpPoints: 1000, defeatedOpponents: [] };
      }
      hero.avatar.pityEpic = Number(hero.avatar.pityEpic) || 0;
      hero.avatar.pityLeg = Number(hero.avatar.pityLeg) || 0;
      hero.avatar.pitySecret = Number(hero.avatar.pitySecret) || 0;
      hero.avatar.pityDivine = Number(hero.avatar.pityDivine) || 0;
      if (!Array.isArray(hero.avatar.pvpSquad)) hero.avatar.pvpSquad = [];
      if (!Array.isArray(hero.avatar.defeatedOpponents)) hero.avatar.defeatedOpponents = [];
      hero.avatar.pvpWins = Number(hero.avatar.pvpWins) || 0;
      hero.avatar.pvpLosses = Number(hero.avatar.pvpLosses) || 0;
      hero.avatar.pvpPoints = hero.avatar.pvpPoints !== undefined ? Number(hero.avatar.pvpPoints) : 1000;

      if (!hero.stats) hero.stats = { level: 1, exp: 0, str: 1, agi: 1, vit: 1, int: 1 };
      hero.stats.level = Math.max(1, Number(hero.stats.level) || 1);
      hero.stats.exp = Math.max(0, Number(hero.stats.exp) || 0);
      hero.stats.str = Math.max(1, Number(hero.stats.str) || 1);
      hero.stats.agi = Math.max(1, Number(hero.stats.agi) || 1);
      hero.stats.vit = Math.max(1, Number(hero.stats.vit) || 1);
      hero.stats.int = Math.max(1, Number(hero.stats.int) || 1);

      const validIds = new Set(hero.avatar.unlockedChars.map(u => u.id));
      if (!validIds.has(hero.avatar.equippedChar)) {
        hero.avatar.equippedChar = hero.avatar.unlockedChars.length > 0 ? hero.avatar.unlockedChars[0].id : null;
      }

      (hero.assets || []).forEach(a => analyzeSpriteSheet(a));

      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('game-screen').classList.remove('hidden');

      resetCombatRound();
      startSpriteAnimationLoop();
      startIdleCombatLoop();
      startPointsRefreshLoop();
      startSafeAutoSyncLoop();
      renderAll();
      loadLeaderboard();

      if (json.data.abandonedGuildLoss) {
        alert(`⚠️ You disconnected during an active Weekend Guild Battle against ${json.data.abandonedGuildLoss.oppGuildName}. It was counted as a LOSS (-${json.data.abandonedGuildLoss.stakePoints} Guild War Pts).`);
      }

      if (json.data.claimedPvpReward) {
        const rw = json.data.claimedPvpReward;
        playAnimeSFX('levelup');
        showToast(`🏆 Daily PvP Rank #${rw.rank} Reward: +${rw.points} Gacha Points!`, "#10b981");
        setTimeout(hideToast, 4200);
      }

      if (json.data.claimedGuildReward) {
        const gr = json.data.claimedGuildReward;
        playAnimeSFX('levelup');
        alert(`🏯 WEEKEND GUILD WAR REWARD!\n\nGuild: ${gr.guildName}\nFinal Rank: #${gr.rank}\nReward: +${gr.points} Gacha Points added to your balance!`);
      } else if (!json.data.claimedPvpReward && isWeekendBoostActive()) {
        showToast("🔥 WEEKEND EVENT: 2x EXP, 2x LUCK & GUILD WARS OPEN!", "#f59e0b");
        setTimeout(hideToast, 3400);
      } else if (!json.data.claimedPvpReward) {
        hideToast();
      }
    } catch (err) {
      hideToast();
      alert("Login Error: " + err.message);
    }
  }

  function getEquippedCharacterObj() {
    if (hero.avatar.equippedChar) {
      const found = (hero.assets || []).find(a => a.assetId === hero.avatar.equippedChar);
      if (found) return found;
    }
    return null;
  }

  // --- ARCADE DRAWER NAVIGATION ---
  function openDrawer(drawerId, btn) {
    ['drawer-hero', 'drawer-gacha', 'drawer-rank'].forEach(id => {
      document.getElementById(id).classList.toggle('hidden', id !== drawerId);
    });
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (drawerId === 'drawer-rank') refreshActiveLeaderboard();
    if (drawerId === 'drawer-gacha' && isWeekendBoostActive()) {
      const logEl = document.getElementById('gacha-result-log');
      if (logEl && !logEl.innerHTML.trim()) {
        logEl.innerHTML = `<span style="color:#fde047;">🔥 WEEKEND EVENT: 2x LUCK BOOST ACTIVE!</span>`;
      }
    }
  }

  function closeAllDrawers(btn) {
    ['drawer-hero', 'drawer-gacha', 'drawer-rank'].forEach(id => {
      document.getElementById(id).classList.add('hidden');
    });
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
    const arenaBtn = btn || document.getElementById('dock-arena');
    if (arenaBtn) arenaBtn.classList.add('active');
  }

  // --- 2. SYNCHRONIZED SPRITE SHEET ANIMATION LOOP ---
  function triggerHeroAction(rowIdx, frameSpeedMs, onComplete) {
    heroAnimRow = rowIdx;
    actionAnimFrame = 0;
    isPlayingAction = true;

    const charObj = getEquippedCharacterObj();
    const cols = Math.max(1, charObj?.meta?.cols || 6);

    if (charObj) {
      applySpriteFrame(document.getElementById('arena-hero-sprite'), charObj, 0, heroAnimRow);
    }

    const actionTimer = setInterval(() => {
      actionAnimFrame++;
      if (actionAnimFrame >= cols) {
        clearInterval(actionTimer);
        isPlayingAction = false;
        heroAnimRow = 0;
        idleAnimFrame = 0;
        if (onComplete) onComplete();
      } else if (charObj) {
        applySpriteFrame(document.getElementById('arena-hero-sprite'), charObj, actionAnimFrame, heroAnimRow);
      }
    }, frameSpeedMs);
  }

  function startSpriteAnimationLoop() {
    setInterval(() => {
      idleAnimFrame++;
      const charObj = getEquippedCharacterObj();
      const enemyObj = getFloorEnemy(hero.towerFloor).asset;

      if (charObj) {
        applySpriteFrame(document.getElementById('stage-hero-sprite'), charObj, idleAnimFrame, 0);
        applySpriteFrame(document.getElementById('hero-modal-sprite'), charObj, idleAnimFrame, 0);
        if (!isPlayingAction) {
          applySpriteFrame(document.getElementById('arena-hero-sprite'), charObj, idleAnimFrame, 0);
        }
      } else {
        setSilhouette(document.getElementById('stage-hero-sprite'));
        setSilhouette(document.getElementById('hero-modal-sprite'));
        setSilhouette(document.getElementById('arena-hero-sprite'));
      }

      applySpriteFrame(document.getElementById('arena-enemy-sprite'), enemyObj, idleAnimFrame, 0);

      if (pvpBattle) {
        const myUnit = pvpBattle.myTeam[pvpBattle.myActiveIdx];
        const oppUnit = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];
        if (myUnit && myUnit.asset && !pvpBattle.myActing) {
          applySpriteFrame(document.getElementById('pvp-sprite-my'), myUnit.asset, idleAnimFrame, 0);
        }
        if (oppUnit && oppUnit.asset && !pvpBattle.oppActing) {
          applySpriteFrame(document.getElementById('pvp-sprite-opp'), oppUnit.asset, idleAnimFrame, 0);
        }
      }
    }, 180);
  }

  function setSilhouette(el) {
    if (!el) return;
    el.style.backgroundImage = `url("${EMPTY_SLOT_SILHOUETTE}")`;
    el.style.backgroundSize = 'contain';
    el.style.backgroundPosition = 'center';
  }

  function getThumbSpriteStyle(asset) {
    const bg = computeFrameBackground(asset, 0, 0);
    return `background-image:url(${asset.imageData}); background-size:${bg.size}; background-position:${bg.pos}; background-repeat:no-repeat;`;
  }

  function applySpriteFrame(el, asset, frameIdx, targetRow) {
    if (!el || !asset) return;
    const cols = Math.max(1, asset.meta?.cols || 1);
    const rows = Math.max(1, asset.meta?.rows || 1);
    const col = frameIdx % cols;
    const row = Math.min(rows - 1, targetRow);
    const bg = computeFrameBackground(asset, col, row);

    el.style.backgroundImage = `url(${asset.imageData})`;
    el.style.backgroundSize = bg.size;
    el.style.backgroundPosition = bg.pos;
  }

  // --- 3. BALANCED EXP CURVE & LEVEL DISPLAY ---
  function getExpNeeded(level) {
    const lv = Math.max(1, Number(level) || 1);
    return Math.floor(100 + ((lv - 1) * 150) + (Math.pow(lv, 2.15) * 12));
  }

  function getFloorExpReward(floor, isBoss) {
    const fl = Math.max(1, Number(floor) || 1);
    const baseExp = 60 + (fl * 45) + (Math.pow(fl, 1.85) * 8);
    const bossMult = isBoss ? 3 : 1;
    const weekendMult = isWeekendBoostActive() ? 2 : 1;
    return Math.floor(baseExp * bossMult * weekendMult);
  }

  function grantTowerExp(amount) {
    hero.stats.exp = (Number(hero.stats.exp) || 0) + amount;
    let leveledUp = false;

    while (hero.stats.exp >= getExpNeeded(hero.stats.level)) {
      hero.stats.exp -= getExpNeeded(hero.stats.level);
      hero.stats.level += 1;
      hero.stats.str += 1;
      hero.stats.agi += 1;
      hero.stats.vit += 1;
      hero.stats.int += 1;
      leveledUp = true;
    }

    hasUnsaved = true;
    if (leveledUp) {
      playAnimeSFX('levelup');
      showToast(`🎉 LEVEL UP! Hero reached Lv. ${hero.stats.level}!`, "#f59e0b");
      setTimeout(hideToast, 2000);
    }
    return leveledUp;
  }

  // --- 4. TOWER BATTLE ---
  function resetCombatRound() {
    const enemy = getFloorEnemy(hero.towerFloor);
    heroMaxHP = Math.max(1, getTotalCP() * 3);
    heroHP = heroMaxHP;
    enemyMaxHP = enemy.reqCP * 3;
    enemyHP = enemyMaxHP;
    isPlayingAction = false;
    heroAnimRow = 0;
    idleTurn = 'hero';
    updateHPBars();
  }

  function updateHPBars() {
    const hPct = getEquippedCharacterObj() ? Math.max(0, Math.min(100, (heroHP / heroMaxHP) * 100)) : 0;
    const ePct = Math.max(0, Math.min(100, (enemyHP / enemyMaxHP) * 100));
    document.getElementById('hero-hp-bar').style.width = hPct + '%';
    document.getElementById('enemy-hp-bar').style.width = ePct + '%';
  }

  function spawnFloatingDamage(containerId, dmg, color) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const tag = document.createElement('div');
    tag.className = 'dmg-popup';
    tag.style.color = color;
    tag.innerText = typeof dmg === 'number' ? `-${dmg.toLocaleString()}` : dmg;
    box.appendChild(tag);
    setTimeout(() => tag.remove(), 750);
  }

  function startIdleCombatLoop() {
    setInterval(() => {
      if (idlePaused || devToolsOpen || !hero || idleTurn === 'animating') return;

      const activeChar = getEquippedCharacterObj();
      const resBox = document.getElementById('raid-result');

      if (!activeChar) {
        resBox.innerHTML = `<span style="color:#fbbf24;">✨ Open GACHA below to summon a hero for the Tower!</span>`;
        return;
      }

      const enemy = getFloorEnemy(hero.towerFloor);
      const myCP = getTotalCP();
      const heroSprite = document.getElementById('arena-hero-sprite');
      const enemySprite = document.getElementById('arena-enemy-sprite');

      if (idleTurn === 'hero') {
        const isCrit = Math.random() < 0.25;
        const dmg = Math.floor(myCP * (isCrit ? 1.5 : 1.0));
        const targetRow = isCrit ? 2 : 1;
        const frameMs = isCrit ? 165 : 140;

        idleTurn = 'animating';
        heroSprite.classList.add('lunge-right');
        playAnimeSFX('slash');

        setTimeout(() => {
          enemySprite.classList.add('hit-flash');
          enemyHP = Math.max(0, enemyHP - dmg);
          spawnFloatingDamage('combatant-enemy', dmg, isCrit ? '#fbbf24' : '#ffffff');
          updateHPBars();
        }, frameMs * 3);

        triggerHeroAction(targetRow, frameMs, () => {
          heroSprite.classList.remove('lunge-right');
          enemySprite.classList.remove('hit-flash');

          if (enemyHP <= 0) {
            handleIdleVictory(enemy);
          } else {
            idleTurn = 'enemy';
          }
        });

      } else if (idleTurn === 'enemy') {
        const enemyDmg = Math.floor(enemy.reqCP * 0.95);
        idleTurn = 'animating';
        enemySprite.classList.add('lunge-left');

        setTimeout(() => {
          heroSprite.classList.add('hit-flash');
          heroHP = Math.max(0, heroHP - enemyDmg);
          spawnFloatingDamage('combatant-hero', enemyDmg, '#f87171');
          updateHPBars();
        }, 220);

        setTimeout(() => {
          enemySprite.classList.remove('lunge-left');
          heroSprite.classList.remove('hit-flash');

          if (heroHP <= 0) {
            setTimeout(() => {
              if (hero.towerFloor > 1) {
                hero.towerFloor -= 1;
                hasUnsaved = true;
              }
              resBox.innerHTML = `<span style="color:#fb7185;">⚠️ Enemy too strong — retreated to Floor ${hero.towerFloor} to farm EXP</span>`;
              resetCombatRound();
              renderAll();
            }, 350);
          } else {
            idleTurn = 'hero';
          }
        }, 650);
      }
    }, 1150);
  }

  function handleIdleVictory(enemy) {
    const resBox = document.getElementById('raid-result');
    const clearedFloor = hero.towerFloor;
    const isWeekend = isWeekendBoostActive();

    const expGain = getFloorExpReward(clearedFloor, enemy.isBoss);
    grantTowerExp(expGain);

    hero.towerFloor++;
    hasUnsaved = true;

    const weekendTag = isWeekend ? ` <b style="color:#fde047;">🔥[2x WEEKEND]</b>` : '';
    resBox.innerHTML = `<span style="color:#38bdf8;">⚔️ +${expGain.toLocaleString()} EXP${weekendTag}! Advancing to Floor ${hero.towerFloor}...</span>`;

    resetCombatRound();
    renderAll();
  }

  function toggleIdlePause() {
    idlePaused = !idlePaused;
    const btn = document.getElementById('pause-idle-btn');
    btn.innerText = idlePaused ? '▶ RESUME' : '⏸ PAUSE';
    btn.style.borderColor = idlePaused ? '#facc15' : '#10b981';
    btn.style.color = idlePaused ? '#fde047' : '#4ade80';
  }

  // --- 5. SERVER-AUTHORITATIVE GACHA SYSTEM ---
  let isRollingGacha = false;
  async function rollGacha(count) {
    if (isRollingGacha) return;
    const cost = count === 5 ? 22 : 5;
    if (hero.unspentPoints < cost) return alert(`Need ${cost} Class Points to summon!`);

    isRollingGacha = true;
    document.getElementById('roll-1-btn').disabled = true;
    document.getElementById('roll-5-btn').disabled = true;
    showToast(isWeekendBoostActive() ? "🍀 Summoning (2x Weekend Luck)..." : "✨ Summoning...", "#9333ea");

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'rollGacha',
          token: sessionToken,
          studentId: hero.studentId,
          count: count
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      playAnimeSFX('gacha');
      hero.avatar = json.data.avatar;
      hero.unspentPoints = Number(json.data.unspentPoints) || 0;

      const luckBadge = isWeekendBoostActive() ? ` <b style="color:#fde047;">[🍀2x LUCK]</b>` : '';
      document.getElementById('gacha-result-log').innerHTML =
        `<span style="color:#e879f9;">🎉 ${json.data.pullResults.join(' • ')}${luckBadge}</span>`;

      hideToast();
      resetCombatRound();
      renderAll();
    } catch (err) {
      hideToast();
      alert("Summon Error: " + err.message);
      renderAll();
    } finally {
      isRollingGacha = false;
    }
  }

  function scheduleEquipSync() {
    if (equipSyncDebounce) clearTimeout(equipSyncDebounce);
    equipSyncDebounce = setTimeout(() => {
      syncProgress(true);
    }, 800);
  }

  function equipCharacter(assetId) {
    if (hero.avatar.equippedChar === assetId) return;
    hero.avatar.equippedChar = assetId;
    localEquipRevision++;
    hasUnsaved = true;
    resetCombatRound();
    renderAll();
    scheduleEquipSync();
  }

  function renderUnlockedCharacters() {
    const row = document.getElementById('unlocked-chars-row');
    const allCharAssets = (hero.assets || []).filter(a => a.type === 'character');
    const unlockedIds = new Set(hero.avatar.unlockedChars.map(u => u.id));
    const unlockedCount = allCharAssets.filter(a => unlockedIds.has(a.assetId)).length;

    const badge = document.getElementById('collection-count');
    if (badge) badge.innerText = `${unlockedCount}/${allCharAssets.length}`;

    const cards = hero.avatar.unlockedChars.map(u => ({
      id: u.id,
      stars: u.stars || 1,
      asset: allCharAssets.find(a => a.assetId === u.id)
    })).filter(x => x.asset);

    if (cards.length === 0) {
      row.innerHTML = `<div style="font-size:12px; color:#fbbf24; padding:8px;">No characters unlocked yet. Spend 5 Class Points in GACHA to roll your first hero!</div>`;
      return;
    }

    row.innerHTML = cards.map(c => {
      const a = c.asset;
      const isSelected = hero.avatar.equippedChar === c.id;
      return `
        <div class="char-card rarity-${a.rarity} ${isSelected ? 'active' : ''}" onclick="equipCharacter('${c.id}')">
          <div class="char-thumb" style="${getThumbSpriteStyle(a)}"></div>
          <div style="font-size:10px; font-weight:800; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.name}</div>
          <div style="font-size:9px; color:var(--gold);">★${c.stars} (${RARITY_MULT[a.rarity]}x)</div>
        </div>
      `;
    }).join('');
  }

  function openCollection() {
    const modal = document.getElementById('collection-modal');
    const grid = document.getElementById('collection-grid');
    const allCharAssets = (hero.assets || [])
      .filter(a => a.type === 'character')
      .sort((a, b) => (RARITY_ORDER[a.rarity] || 9) - (RARITY_ORDER[b.rarity] || 9));

    const unlockedMap = {};
    hero.avatar.unlockedChars.forEach(u => { unlockedMap[u.id] = u; });
    const unlockedCount = allCharAssets.filter(a => unlockedMap[a.assetId]).length;

    document.getElementById('modal-collection-count').innerText = `${unlockedCount}/${allCharAssets.length}`;

    if (allCharAssets.length === 0) {
      grid.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:var(--muted); padding:20px;">No Gacha Characters uploaded by your teacher yet.</p>';
    } else {
      grid.innerHTML = allCharAssets.map(a => {
        const unlocked = unlockedMap[a.assetId];
        const isDeployed = hero.avatar.equippedChar === a.assetId;
        const thumbStyle = getThumbSpriteStyle(a);

        if (unlocked) {
          return `
            <div class="rpg-card rarity-${a.rarity}" onclick="equipCharacter('${a.assetId}'); closeCollection();"
              style="text-align:center; padding:10px 6px; cursor:pointer; position:relative; ${isDeployed ? 'box-shadow:0 0 14px rgba(245,158,11,0.65); border-color:var(--gold);' : ''}">
              ${isDeployed ? '<div style="position:absolute; top:4px; right:4px; background:var(--gold); color:#000; font-size:8px; font-weight:900; padding:1px 5px; border-radius:6px;">ACTIVE</div>' : ''}
              <div style="width:68px; height:68px; margin:0 auto; ${thumbStyle}"></div>
              <div style="font-size:11px; font-weight:800; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.name}</div>
              <div style="font-size:9px; color:var(--gold); font-weight:700;">[${a.rarity}] ★${unlocked.stars}</div>
              <div style="font-size:9px; color:#4ade80; margin-top:2px;">${RARITY_MULT[a.rarity]}x Power</div>
            </div>
          `;
        } else {
          return `
            <div class="rpg-card" style="text-align:center; padding:10px 6px; opacity:0.8; border-color:#1e293b; background:#090d16; position:relative;">
              <div style="position:absolute; top:5px; right:6px; font-size:12px;">🔒</div>
              <div style="width:68px; height:68px; margin:0 auto; ${thumbStyle} filter:brightness(0);"></div>
              <div style="font-size:11px; font-weight:800; margin-top:6px; color:#64748b;">???</div>
              <div style="font-size:9px; color:#475569; font-weight:700;">[${a.rarity}] LOCKED</div>
              <div style="font-size:9px; color:#334155; margin-top:2px;">Summon to Unlock</div>
            </div>
          `;
        }
      }).join('');
    }

    modal.classList.remove('hidden');
  }

  function closeCollection() {
    document.getElementById('collection-modal').classList.add('hidden');
  }

  // --- 6. COMBAT POWER & STATS ---
  function getTotalCP() {
    const charObj = getEquippedCharacterObj();
    if (!charObj) return 0;

    const s = hero.stats;
    let base = (s.str * 15) + (s.agi * 12) + (s.vit * 12) + (s.int * 15);
    Object.values(hero.equipped).forEach(item => {
      if (item) base += (item.power * 10);
    });

    const unlockedEntry = hero.avatar.unlockedChars.find(u => u.id === charObj.assetId);
    const stars = unlockedEntry ? unlockedEntry.stars : 1;
    const mult = (RARITY_MULT[charObj.rarity] || 1.0) + ((stars - 1) * 0.1);

    return Math.floor(base * mult);
  }

  function renderStats() {
    const lvl = hero.stats.level || 1;
    const exp = hero.stats.exp || 0;
    const needed = getExpNeeded(lvl);
    const expPct = Math.min(100, (exp / needed) * 100);

    document.getElementById('panel-level').innerText = lvl;
    document.getElementById('exp-text').innerText = `${exp.toLocaleString()} / ${needed.toLocaleString()}`;
    document.getElementById('exp-bar-fill').style.width = expPct + '%';

    const meta = [
      { key: 'str', icon: '💪', label: 'STR' },
      { key: 'agi', icon: '⚡', label: 'AGI' },
      { key: 'vit', icon: '❤️', label: 'VIT' },
      { key: 'int', icon: '🔮', label: 'INT' }
    ];

    document.getElementById('stat-rows').innerHTML = meta.map(m => {
      const val = hero.stats[m.key];
      const pct = Math.min(100, (val / 50) * 100);
      return `
        <div class="stat-row">
          <span style="width:72px; font-weight:700;">${m.icon} ${m.label}: ${val}</span>
          <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
          <span style="font-size:10px; color:#4ade80; font-weight:800;">+1/Lv</span>
        </div>
      `;
    }).join('');
  }

  // --- 7. 5-SLOT GEAR & ARMORY ---
  function renderSlots() {
    const slotDefs = [
      { key: 'head', defIcon: '👑', label: 'Head' },
      { key: 'weapon', defIcon: '⚔️', label: 'Weapon' },
      { key: 'armor', defIcon: '🛡️', label: 'Armor' },
      { key: 'boots', defIcon: '👢', label: 'Boots' },
      { key: 'accessory', defIcon: '🔮', label: 'Relic' }
    ];

    slotDefs.forEach(s => {
      const el = document.getElementById('slot-' + s.key);
      const item = hero.equipped[s.key];
      el.className = 'gear-slot ' + (item ? 'rarity-' + item.rarity : '');
      const displayIcon = (item && item.icon && item.icon !== '🪖') ? item.icon : s.defIcon;
      el.innerHTML = `
        <div class="gear-icon">${displayIcon}</div>
        <div class="gear-name">${item ? item.name : s.label}</div>
        <div class="gear-stat">${item ? `[${item.rarity}] +${item.power}` : 'Empty'}</div>
      `;
    });
  }

  function openArmory(slotFilter) {
    const modal = document.getElementById('armory-modal');
    const list = document.getElementById('armory-items');
    document.getElementById('armory-title').innerText = slotFilter === 'all' ? '🎒 All Gear' : `🎒 ${slotFilter.toUpperCase()} Slot`;

    const items = (slotFilter === 'all' ? hero.inventory : hero.inventory.filter(i => i.slot === slotFilter))
      .slice()
      .sort((a, b) => b.power - a.power);

    list.innerHTML = items.map(item => {
      const curEquipped = hero.equipped[item.slot];
      const isEquipped = curEquipped && (curEquipped.id === item.id || (curEquipped.slot === item.slot && curEquipped.rarity === item.rarity));
      const safeIcon = (item.slot === 'head' && item.icon === '🪖') ? '👑' : item.icon;

      return `
        <div class="rpg-card rarity-${item.rarity}" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; ${isEquipped ? 'border-color:#4ade80; background:rgba(16,185,129,0.12);' : ''}">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:26px;">${safeIcon}</span>
            <div>
              <div style="font-weight:800; font-size:13px;">${item.name}</div>
              <div style="font-size:11px; color:var(--muted);">[${item.rarity}] ${item.slot.toUpperCase()} • +${(item.power * 10).toLocaleString()} CP</div>
            </div>
          </div>
          ${isEquipped
            ? `<button class="plus-btn" disabled style="background:#065f46; color:#6ee7b7; border:1px solid #10b981; cursor:default;">✓ EQUIPPED</button>`
            : `<button class="plus-btn" onclick="equipGear('${item.id}')">EQUIP</button>`
          }
        </div>
      `;
    }).join('') || '<p style="text-align:center; color:var(--muted); padding:20px;">No gear unlocked yet. Clear floors or click ☁️ Sync to claim loot drops!</p>';

    modal.classList.remove('hidden');
  }

  function closeArmory() { document.getElementById('armory-modal').classList.add('hidden'); }

  function equipGear(itemId) {
    const item = hero.inventory.find(i => i.id === itemId);
    if (!item) return;
    hero.equipped[item.slot] = item;
    localEquipRevision++;
    hasUnsaved = true;
    closeArmory();
    resetCombatRound();
    renderAll();
    scheduleEquipSync();
  }

  // --- 8. FLOOR ENEMY LOOKUP & ARCADE HUD RENDER ---
  function getFloorEnemy(floor) {
    const isBoss = floor % 10 === 0;
    const reqCP = Math.floor(250 * Math.pow(1.15, floor - 1));
    const assets = hero.assets || [];

    const targetType = isBoss ? 'boss' : 'mob';
    const specific = assets.find(a => a.type === targetType && a.meta?.floorRule === String(floor));
    const generalPool = assets.filter(a => a.type === targetType && a.meta?.floorRule === 'all');
    const chosen = specific || (generalPool.length > 0 ? generalPool[(floor - 1) % generalPool.length] : null);

    return {
      isBoss,
      reqCP,
      asset: chosen || (isBoss ? FALLBACK_BOSS : FALLBACK_MOB)
    };
  }

  function renderArena() {
    const enemy = getFloorEnemy(hero.towerFloor);
    const charObj = getEquippedCharacterObj();

    const enemyNameEl = document.getElementById('arena-enemy-name');
    enemyNameEl.innerText = enemy.asset.name;
    enemyNameEl.title = enemy.asset.name;

    document.getElementById('arena-enemy-cp').innerText = enemy.reqCP.toLocaleString() + " CP";
    document.getElementById('enemy-boss-badge').innerText = enemy.isBoss ? 'BOSS' : `F${hero.towerFloor}`;

    const heroPort = document.getElementById('hud-hero-portrait');
    if (charObj) applyPortraitCloseup(heroPort, charObj);
    else setSilhouette(heroPort);

    const enemyPort = document.getElementById('hud-enemy-portrait');
    applyPortraitCloseup(enemyPort, enemy.asset);

    updateHPBars();
  }

  function renderAll() {
    const charObj = getEquippedCharacterObj();
    document.getElementById('hud-name').innerText = hero.name;
    document.getElementById('hud-level').innerText = hero.stats.level || 1;
    document.getElementById('hud-id').innerText = hero.studentId;
    document.getElementById('hud-floor').innerText = hero.towerFloor;
    document.getElementById('hud-cp').innerText = getTotalCP().toLocaleString();
    document.getElementById('hud-pts').innerText = hero.unspentPoints;
    document.getElementById('gacha-pts-display').innerText = hero.unspentPoints;

    const weekendSuffix = isWeekendBoostActive() ? ' • 🔥2x WEEKEND' : '';
    const badgeText = charObj ? `[${charObj.rarity}] ${charObj.name}${weekendSuffix}` : `No Hero (Open Gacha!)${weekendSuffix}`;
    document.getElementById('active-char-badge').innerText = badgeText;
    const drawerBadge = document.getElementById('drawer-char-badge');
    if (drawerBadge) drawerBadge.innerText = badgeText;

    const epicEl = document.getElementById('pity-epic-text');
    const legEl = document.getElementById('pity-leg-text');
    const secEl = document.getElementById('pity-sec-text');
    const divEl = document.getElementById('pity-div-text');
    if (epicEl) epicEl.innerText = `${hero.avatar.pityEpic || 0}/10`;
    if (legEl) legEl.innerText = `${hero.avatar.pityLeg || 0}/25`;
    if (secEl) secEl.innerText = `${hero.avatar.pitySecret || 0}/50`;
    if (divEl) divEl.innerText = `${hero.avatar.pityDivine || 0}/100`;

    document.getElementById('roll-1-btn').disabled = hero.unspentPoints < 5;
    document.getElementById('roll-5-btn').disabled = hero.unspentPoints < 22;

    renderUnlockedCharacters();
    renderSlots();
    renderStats();
    renderArena();
  }

  // --- 9. SAFE CONFLICT-FREE AUTO-SYNC + MANUAL SYNC (WITH MONOTONIC EXP GUARD) ---
  function mergeServerStatsMonotonic(srvStats) {
    if (!srvStats || !hero || !hero.stats) return;
    const curLv = Math.max(1, Number(hero.stats.level) || 1);
    const srvLv = Math.max(1, Number(srvStats.level) || 1);
    const curExp = Math.max(0, Number(hero.stats.exp) || 0);
    const srvExp = Math.max(0, Number(srvStats.exp) || 0);

    if (srvLv > curLv) {
      hero.stats.level = srvLv;
      hero.stats.exp = srvExp;
    } else if (srvLv === curLv) {
      hero.stats.level = curLv;
      hero.stats.exp = Math.max(curExp, srvExp);
    }

    ['str', 'agi', 'vit', 'int'].forEach(k => {
      hero.stats[k] = Math.max(Number(hero.stats[k]) || 1, Number(srvStats[k]) || 1);
    });
  }

  function buildSaveStatePayload() {
    return JSON.stringify({
      action: 'saveStudentState',
      token: sessionToken,
      studentId: hero.studentId,
      state: {
        avatar: { equippedChar: hero.avatar.equippedChar },
        stats: {
          level: Math.max(1, Number(hero.stats.level) || 1),
          exp: Math.max(0, Number(hero.stats.exp) || 0),
          str: Math.max(1, Number(hero.stats.str) || 1),
          agi: Math.max(1, Number(hero.stats.agi) || 1),
          vit: Math.max(1, Number(hero.stats.vit) || 1),
          int: Math.max(1, Number(hero.stats.int) || 1)
        },
        towerFloor: hero.towerFloor,
        equipped: hero.equipped
      }
    });
  }

  function startSafeAutoSyncLoop() {
    setInterval(() => {
      if (hero && hasUnsaved && !isSyncing && !devToolsOpen) {
        syncProgress(true);
      }
    }, 30000);
  }

  async function syncProgress(silent = false) {
    if (!hero || devToolsOpen) return;
    if (isSyncing) {
      queuedSync = true;
      return;
    }

    isSyncing = true;
    queuedSync = false;
    const syncRevision = localEquipRevision;
    const sentLevel = Number(hero.stats.level) || 1;
    const sentExp = Number(hero.stats.exp) || 0;
    const sentFloor = Number(hero.towerFloor) || 1;
    if (!silent) showToast("☁️ Syncing Hero...", "#10b981");

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: buildSaveStatePayload()
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      hero.unspentPoints = Number(json.data.unspentPoints) || 0;
      if (json.data.stats) mergeServerStatsMonotonic(json.data.stats);
      if (json.data.towerFloor) {
        hero.towerFloor = Math.max(Number(hero.towerFloor) || 1, Number(json.data.towerFloor) || 1);
      }
      if (json.data.inventory) hero.inventory = json.data.inventory;

      const gainedMoreWhileSyncing =
        (Number(hero.stats.level) > sentLevel) ||
        (Number(hero.stats.level) === sentLevel && Number(hero.stats.exp) > sentExp) ||
        (Number(hero.towerFloor) > sentFloor);

      if (syncRevision === localEquipRevision) {
        if (json.data.avatar) hero.avatar = json.data.avatar;
        if (json.data.equipped) hero.equipped = json.data.equipped;
        hasUnsaved = gainedMoreWhileSyncing;
      } else {
        if (json.data.avatar) {
          hero.avatar.unlockedChars = json.data.avatar.unlockedChars;
          hero.avatar.pityEpic = json.data.avatar.pityEpic;
          hero.avatar.pityLeg = json.data.avatar.pityLeg;
          hero.avatar.pitySecret = json.data.avatar.pitySecret;
          hero.avatar.pityDivine = json.data.avatar.pityDivine;
        }
        queuedSync = true;
      }

      resetCombatRound();
      renderAll();

      if (json.data.newDrops && json.data.newDrops.length > 0) {
        const best = json.data.newDrops[json.data.newDrops.length - 1];
        document.getElementById('raid-result').innerHTML =
          `<span style="color:#4ade80;">🎁 Loot Drop: [${best.rarity}] ${best.name} (+${best.power})!</span>`;
      }

      if (!silent) {
        showToast("✅ Synced!", "#10b981");
        setTimeout(hideToast, 1500);
      }
    } catch (err) {
      if (!silent) {
        hideToast();
        alert("Sync failed: " + err.message);
      }
    } finally {
      isSyncing = false;
      if (queuedSync) {
        queuedSync = false;
        setTimeout(() => syncProgress(true), 300);
      }
    }
  }

  function flushSyncOnExit() {
    if (!hero || !hasUnsaved || devToolsOpen) return;
    try {
      const payload = buildSaveStatePayload();
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_URL, new Blob([payload], { type: 'text/plain;charset=utf-8' }));
        hasUnsaved = false;
      }
    } catch (_) {}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSyncOnExit();
  });
  window.addEventListener('pagehide', flushSyncOnExit);

  function toggleMainLeaderboardMode() {
    mainLbMode = mainLbMode === 'tower' ? 'pvp' : 'tower';
    const titleEl = document.getElementById('main-lb-title');
    const btnEl = document.getElementById('lb-mode-btn');
    if (mainLbMode === 'pvp') {
      titleEl.innerText = '🌍 GLOBAL PVP RANKING';
      btnEl.innerText = '🏰 Class Tower';
      btnEl.style.background = '#0284c7';
    } else {
      titleEl.innerText = '🏆 CLASS TOWER RANKING';
      btnEl.innerText = '🌍 Global PvP';
      btnEl.style.background = '#7e22ce';
    }
    refreshActiveLeaderboard();
  }

  function refreshActiveLeaderboard() {
    if (mainLbMode === 'pvp') loadGlobalPvpWinsLeaderboard('leaderboard-list');
    else loadLeaderboard();
  }

  async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list || !hero) return;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getLeaderboard',
          token: sessionToken,
          studentId: hero.studentId,
          classId: hero.classId
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      const ranks = json.data || [];
      if (ranks.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:var(--muted); font-size:12px; padding:10px;">No raiders ranked yet.</p>';
        return;
      }

      list.innerHTML = ranks.map((r, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const isMe = String(r.studentId) === String(hero.studentId);
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; margin-bottom:6px; border-radius:10px; background:${isMe ? 'rgba(245,158,11,0.15)' : '#0f172a'}; border:1px solid ${isMe ? 'var(--gold)' : '#1e293b'};">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:15px; font-weight:900; min-width:26px; text-align:center; color:${idx < 3 ? 'var(--gold)' : 'var(--muted)'};">${medal}</span>
              <div>
                <div style="font-weight:800; font-size:12px;">${r.name} <span style="color:#60a5fa; font-size:10px;">(Lv.${r.level})</span></div>
                <div style="font-size:10px; color:#c084fc;">⚔️ ${r.heroName}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:900; font-size:12px; color:#38bdf8;">FLOOR ${r.floor}</div>
              <div style="font-size:10px; color:var(--gold);">${Number(r.cp).toLocaleString()} CP</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<p style="text-align:center; color:#f87171; font-size:12px;">Error: ${err.message}</p>`;
    }
  }

  async function loadGlobalPvpWinsLeaderboard(targetElementId = 'pvp-wins-leaderboard-list') {
    const list = document.getElementById(targetElementId);
    if (!list || !hero) return;
    list.innerHTML = '<p style="text-align:center; color:var(--muted); font-size:12px; padding:12px;">Loading Global PvP Standings...</p>';

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getPvpData',
          token: sessionToken,
          studentId: hero.studentId
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      handlePvpServerPayload(json.data);

      const sortedByNetScore = sortPvpPlayersAntiTie(pvpPlayersCache);

      if (sortedByNetScore.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:var(--muted); font-size:12px; padding:12px;">No PvP matches recorded yet.</p>';
        return;
      }

      const legendBanner = `
        <div class="pvp-status-bar" style="justify-content:center; text-align:center; border-color:rgba(56,189,248,0.45); color:#bae6fd; font-size:11px;">
          ⚖️ <b>Anti-Tie Scoring:</b> <span style="color:#4ade80;">+10 Net Pts / Win</span> • <span style="color:#f87171;">-6 Net Pts / Loss</span>
        </div>
      `;

      list.innerHTML = legendBanner + sortedByNetScore.map((p, idx) => {
        const medal = idx === 0 ? '👑' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const isMe = String(p.studentId) === String(hero.studentId);
        const totalMatches = (p.wins || 0) + (p.losses || 0);
        const winRate = totalMatches > 0 ? Math.round((p.wins / totalMatches) * 100) : 0;
        const dailyPrize = idx === 0 ? '100' : idx === 1 ? '90' : idx === 2 ? '75' : '50';
        const netScore = getPvpNetScore(p.wins, p.losses);
        const netSign = netScore >= 0 ? `+${netScore}` : `${netScore}`;
        const netColor = netScore >= 0 ? '#4ade80' : '#f87171';

        return `
          <div class="pvp-challenger-card" style="${isMe ? 'border-color:var(--gold); background:rgba(245,158,11,0.18);' : ''}">
            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span style="font-size:16px; font-weight:900; min-width:28px; text-align:center; color:${idx < 3 ? 'var(--gold)' : '#cbd5e1'};">${medal}</span>
              <div style="min-width:0;">
                <div style="font-weight:900; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${p.name} <span style="color:#38bdf8; font-size:11px;">[${p.className}]</span>
                </div>
                <div style="font-size:11px; color:#cbd5e1;">
                  <b style="color:#4ade80;">${p.wins}W</b> - <b style="color:#f87171;">${p.losses}L</b> (${winRate}% WR) • ⭐ ${p.pvpPoints} Rating • ${p.teamCP.toLocaleString()} CP
                </div>
              </div>
            </div>
            <div style="text-align:right; flex-shrink:0;">
              <div style="font-weight:900; font-size:13px; color:${netColor};">${netSign} NET PTS</div>
              <div style="font-size:10px; color:var(--gold);">🎁 +${dailyPrize} Gacha Pts</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<p style="text-align:center; color:#f87171; font-size:12px;">Error: ${err.message}</p>`;
    }
  }

  function startPointsRefreshLoop() {
    setInterval(async () => {
      if (!hero) return;
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'getStudentPoints',
            token: sessionToken,
            studentId: hero.studentId
          })
        });
        const json = await res.json();
        if (json.status === 'success') {
          const livePts = Number(json.data.unspentPoints) || 0;
          if (livePts !== hero.unspentPoints) {
            hero.unspentPoints = livePts;
            renderAll();
            showToast("⭐ New Gacha Points Received!", "#3b82f6");
            setTimeout(hideToast, 2500);
          }
        }
      } catch (_) {}
    }, 15000);
  }

  // --- 10. STUDENT TASK & MISSING WORK CHECKER ---
  async function openTasksModal() {
    if (!hero) return;
    const modal = document.getElementById('tasks-modal');
    const body = document.getElementById('tasks-modal-body');
    document.getElementById('tasks-unspent').innerText = `${hero.unspentPoints} Pts`;
    body.innerHTML = '<p style="text-align:center; color:var(--muted); padding:20px;">Checking class records...</p>';
    modal.classList.remove('hidden');

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getStudentTasks',
          token: sessionToken,
          classId: hero.classId,
          studentId: hero.studentId
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      const { completed, missing, totalEarned } = json.data;
      document.getElementById('tasks-total-earned').innerText = `${totalEarned} Pts`;

      let html = '';

      html += `<div style="font-size:12px; font-weight:900; color:#f87171; margin:6px 0 8px;">⚠️ MISSING TASKS (${missing.length})</div>`;
      if (missing.length === 0) {
        html += `<div class="rpg-card" style="text-align:center; color:#4ade80; font-size:12px; margin-bottom:14px; border-color:#065f46;">🎉 No missing tasks! You are all caught up!</div>`;
      } else {
        html += missing.map(m => `
          <div class="rpg-card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-color:#991b1b; background:rgba(153,27,27,0.18);">
            <div>
              <div style="font-weight:800; font-size:13px; color:#fca5a5;">❌ ${m.taskName}</div>
              <div style="font-size:10px; color:var(--muted);">Assigned on ${m.date}</div>
            </div>
            <span style="background:#7f1d1d; color:#fecaca; font-size:11px; font-weight:800; padding:3px 8px; border-radius:8px;">Missing (${m.points} Pts)</span>
          </div>
        `).join('');
      }

      html += `<div style="font-size:12px; font-weight:900; color:#4ade80; margin:14px 0 8px;">✅ CREDITED TASKS (${completed.length})</div>`;
      if (completed.length === 0) {
        html += `<p style="text-align:center; color:var(--muted); font-size:12px; padding:12px;">No tasks credited yet.</p>`;
      } else {
        html += completed.map(c => `
          <div class="rpg-card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-color:#1e293b;">
            <div>
              <div style="font-weight:800; font-size:13px; color:#e2e8f0;">${c.taskName}</div>
              <div style="font-size:10px; color:var(--muted);">${c.date}</div>
            </div>
            <span style="color:var(--gold); font-weight:900; font-size:13px;">+${c.points} Pts</span>
          </div>
        `).join('');
      }

      body.innerHTML = html;
    } catch (err) {
      body.innerHTML = `<p style="text-align:center; color:#f87171; padding:20px;">Error: ${err.message}</p>`;
    }
  }

  function closeTasksModal() {
    document.getElementById('tasks-modal').classList.add('hidden');
  }

  // --- 11. 3v3 GLOBAL PVP & GUILD WAR SHARED BATTLE ENGINE ---
  function handlePvpServerPayload(data) {
    if (!data) return;
    pvpPlayersCache = sortPvpPlayersAntiTie(data.leaderboard || []);
    if (Array.isArray(data.defeatedOpponents)) {
      hero.avatar.defeatedOpponents = data.defeatedOpponents.map(String);
    }
    if (data.myPvpWins !== undefined) hero.avatar.pvpWins = Number(data.myPvpWins) || 0;
    if (data.myPvpLosses !== undefined) hero.avatar.pvpLosses = Number(data.myPvpLosses) || 0;
    if (data.myPvpPoints !== undefined) hero.avatar.pvpPoints = Number(data.myPvpPoints) || 1000;
    if (data.unspentPoints !== undefined) {
      hero.unspentPoints = Number(data.unspentPoints) || 0;
      renderAll();
    }
    if (data.claimedPvpReward) {
      const rw = data.claimedPvpReward;
      playAnimeSFX('levelup');
      showToast(`🏆 Daily PvP Rank #${rw.rank} Reward: +${rw.points} Gacha Points!`, "#10b981");
      setTimeout(hideToast, 4200);
    }
  }

  function togglePvpSpeed() {
    pvpSpeedMult = pvpSpeedMult === 1 ? 2 : 1;
    const btn = document.getElementById('pvp-speed-btn');
    if (btn) {
      btn.innerText = `${pvpSpeedMult}x`;
      btn.style.borderColor = pvpSpeedMult === 2 ? '#facc15' : '#e2e8f0';
      btn.style.color = pvpSpeedMult === 2 ? '#fde047' : '#fff';
    }
  }

  function clearPvpActionTimers() {
    ['my', 'opp'].forEach(side => {
      if (pvpActionTimers[side]) {
        clearInterval(pvpActionTimers[side]);
        pvpActionTimers[side] = null;
      }
    });
  }

  function openPvpModal() {
    if (!hero) return;
    if (hero.avatar.unlockedChars.length === 0) {
      return alert("Summon at least 1 Hero in the Gacha before entering 3v3 PvP!");
    }
    clearPvpActionTimers();
    pvpBattle = null;
    document.getElementById('pvp-modal').classList.remove('hidden');
    document.getElementById('pvp-lobby-shell').classList.remove('hidden');
    document.getElementById('pvp-view-battle').classList.add('hidden');
    switchPvpTab('lobby');
    loadPvpLobby();
  }

  function closePvpModal() {
    if (pvpBattle && !pvpBattle.finished) {
      handleBattleExitClick();
      return;
    }
    clearPvpActionTimers();
    pvpBattle = null;
    document.getElementById('pvp-modal').classList.add('hidden');
    closeAllDrawers();
  }

  function handleBattleExitClick() {
    if (!pvpBattle) {
      closePvpModal();
      return;
    }
    if (pvpBattle.mode === 'guild' && !pvpBattle.finished) {
      const ok = confirm("⚠️ Leaving an active Guild War battle counts as a LOSS and forfeits 25% of your Guild War Points! Retreat?");
      if (!ok) return;
      finishGuildWarBattle(false);
      return;
    }
    if (pvpBattle.mode === 'pvp' && !pvpBattle.finished) {
      const ok = confirm("⚠️ Leaving an active 3v3 PvP match counts as a LOSS (-6 Net PvP Pts & rating penalty)! Retreat?");
      if (!ok) return;
      finishPvpBattle(false);
      return;
    }
    clearPvpActionTimers();
    pvpBattle = null;
    switchPvpTab('lobby');
  }

  function switchPvpTab(tab) {
    document.getElementById('pvp-lobby-shell').classList.remove('hidden');
    document.getElementById('pvp-view-lobby').classList.toggle('hidden', tab !== 'lobby');
    document.getElementById('pvp-view-rank').classList.toggle('hidden', tab !== 'rank');
    document.getElementById('pvp-view-squad').classList.toggle('hidden', tab !== 'squad');
    document.getElementById('pvp-view-battle').classList.add('hidden');

    document.getElementById('pvp-tab-lobby').classList.toggle('active', tab === 'lobby');
    document.getElementById('pvp-tab-rank').classList.toggle('active', tab === 'rank');
    document.getElementById('pvp-tab-squad').classList.toggle('active', tab === 'squad');

    if (tab === 'rank') {
      loadGlobalPvpWinsLeaderboard('pvp-wins-leaderboard-list');
    } else if (tab === 'squad') {
      draftSquadIds = (hero.avatar.pvpSquad || []).slice(0, 3);
      renderPvpSquadBuilder();
    }
  }

  function updatePvpHeaderSummary() {
    const myNet = getPvpNetScore(hero.avatar.pvpWins, hero.avatar.pvpLosses);
    const netText = myNet >= 0 ? `+${myNet}` : `${myNet}`;
    document.getElementById('pvp-my-pts').innerText = `${hero.avatar.pvpPoints || 1000} (${netText} Net)`;
    document.getElementById('pvp-my-record').innerText = `${hero.avatar.pvpWins || 0}W - ${hero.avatar.pvpLosses || 0}L`;
  }

  async function loadPvpLobby() {
    const list = document.getElementById('pvp-global-list');
    updatePvpHeaderSummary();
    list.innerHTML = '<p style="text-align:center; color:#cbd5e1; padding:20px;">Loading Global Challengers across all classes...</p>';

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getPvpData',
          token: sessionToken,
          studentId: hero.studentId
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      handlePvpServerPayload(json.data);
      updatePvpHeaderSummary();

      const defeatedSet = new Set((hero.avatar.defeatedOpponents || []).map(String));

      const rewardBannerHtml = `
        <div class="pvp-status-bar" style="justify-content:center; text-align:center; border-color:rgba(245,158,11,0.45); color:#fde68a; font-size:11px;">
          <div>
            ⚖️ <b>Anti-Tie PvP Rules:</b> <span style="color:#4ade80;">Win = +10 Net Pts</span> • <span style="color:#f87171;">Loss = -6 Net Pts</span><br>
            ⏰ <b>Midnight Payout:</b> 👑 1st: <b>+100</b> • 🥈 2nd: <b>+90</b> • 🥉 3rd: <b>+75</b> • Others: <b>+50 Gacha Pts</b>
          </div>
        </div>
      `;

      if (pvpPlayersCache.length === 0) {
        list.innerHTML = rewardBannerHtml + '<p style="text-align:center; color:#cbd5e1; padding:20px;">No players with heroes found yet.</p>';
        return;
      }

      list.innerHTML = rewardBannerHtml + pvpPlayersCache.map((p, idx) => {
        const medal = idx === 0 ? '👑' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const isMe = String(p.studentId) === String(hero.studentId);
        const isDefeated = defeatedSet.has(String(p.studentId));
        const netScore = getPvpNetScore(p.wins, p.losses);
        const netSign = netScore >= 0 ? `+${netScore}` : `${netScore}`;
        const netColor = netScore >= 0 ? '#38bdf8' : '#f87171';

        const squadThumbs = p.squad.map(sq => {
          const asset = (hero.assets || []).find(a => a.assetId === sq.assetId);
          return asset ? `<div style="width:30px; height:30px; border-radius:6px; border:1px solid #475569; background-color:#090d16; ${getThumbSpriteStyle(asset)}" title="${sq.name}"></div>` : '';
        }).join('');

        let actionBadge = '';
        if (isMe) {
          actionBadge = `<span style="font-size:11px; font-weight:900; color:var(--gold);">YOU</span>`;
        } else if (isDefeated) {
          actionBadge = `<button class="pvp-won-btn" disabled>✓ Won Today</button>`;
        } else {
          actionBadge = `<button class="pvp-fight-btn" onclick="startPvpBattle('${p.studentId}')">⚔️ Fight</button>`;
        }

        return `
          <div class="pvp-challenger-card" style="${isMe ? 'border-color:var(--gold); background:rgba(245,158,11,0.18);' : isDefeated ? 'border-color:rgba(52,211,153,0.45);' : ''}">
            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span style="font-size:16px; font-weight:900; min-width:28px; text-align:center; color:${idx < 3 ? 'var(--gold)' : '#cbd5e1'};">${medal}</span>
              <div style="min-width:0;">
                <div style="font-weight:900; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${p.name} <span style="font-size:11px; color:#38bdf8;">[${p.className}]</span>
                </div>
                <div style="font-size:11px; color:#e2e8f0; margin-bottom:5px;">
                  <b style="color:#4ade80;">${p.wins}W</b>-<b style="color:#f87171;">${p.losses}L</b> • <b style="color:${netColor};">${netSign} Net</b> • ⭐ ${p.pvpPoints} • ${p.teamCP.toLocaleString()} CP
                </div>
                <div style="display:flex; gap:5px;">${squadThumbs}</div>
              </div>
            </div>
            ${actionBadge}
          </div>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<p style="text-align:center; color:#f87171; padding:20px;">Error: ${err.message}</p>`;
    }
  }

  function renderPvpSquadBuilder() {
    const slotsEl = document.getElementById('pvp-squad-slots');
    const rosterEl = document.getElementById('pvp-squad-roster');
    const allChars = (hero.assets || []).filter(a => a.type === 'character');

    slotsEl.innerHTML = [0, 1, 2].map(i => {
      const id = draftSquadIds[i];
      const asset = allChars.find(a => a.assetId === id);
      if (asset) {
        return `
          <div class="rpg-card rarity-${asset.rarity}" style="text-align:center; padding:8px; cursor:pointer;" onclick="toggleDraftSquad('${id}')">
            <div style="width:52px; height:52px; margin:0 auto; ${getThumbSpriteStyle(asset)}"></div>
            <div style="font-size:10px; font-weight:800; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${asset.name}</div>
            <div style="font-size:9px; color:#f87171;">✕ Remove</div>
          </div>
        `;
      }
      return `
        <div class="rpg-card" style="text-align:center; padding:18px 6px; border-style:dashed; border-color:#475569; color:#cbd5e1; font-size:11px;">
          Slot ${i + 1}<br>(Empty)
        </div>
      `;
    }).join('');

    rosterEl.innerHTML = hero.avatar.unlockedChars.map(u => {
      const asset = allChars.find(a => a.assetId === u.id);
      if (!asset) return '';
      const inSquad = draftSquadIds.includes(u.id);
      return `
        <div class="rpg-card rarity-${asset.rarity}" onclick="toggleDraftSquad('${u.id}')"
          style="text-align:center; padding:8px 4px; cursor:pointer; ${inSquad ? 'border-color:#4ade80; box-shadow:0 0 10px rgba(74,222,128,0.45);' : ''}">
          <div style="width:48px; height:48px; margin:0 auto; ${getThumbSpriteStyle(asset)}"></div>
          <div style="font-size:10px; font-weight:800; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${asset.name}</div>
          <div style="font-size:9px; color:${inSquad ? '#4ade80' : 'var(--gold)'};">${inSquad ? '✓ IN SQUAD' : `★${u.stars}`}</div>
        </div>
      `;
    }).join('');
  }

  function toggleDraftSquad(assetId) {
    const idx = draftSquadIds.indexOf(assetId);
    if (idx >= 0) {
      draftSquadIds.splice(idx, 1);
    } else if (draftSquadIds.length < 3) {
      draftSquadIds.push(assetId);
    } else {
      alert("Your 3v3 squad already has 3 heroes! Remove one first.");
    }
    renderPvpSquadBuilder();
  }

  async function savePvpSquad() {
    if (draftSquadIds.length === 0) return alert("Pick at least 1 hero for your squad!");
    showToast("💾 Saving 3v3 Squad...", "#10b981");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'savePvpSquad',
          token: sessionToken,
          studentId: hero.studentId,
          squad: draftSquadIds
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      hero.avatar.pvpSquad = json.data.pvpSquad;
      showToast("✅ Squad Saved!", "#10b981");
      setTimeout(hideToast, 1400);
      switchPvpTab('lobby');
      loadPvpLobby();
    } catch (err) {
      hideToast();
      alert("Save Squad Error: " + err.message);
    }
  }

  function buildMyPvpTeam() {
    const allChars = (hero.assets || []).filter(a => a.type === 'character');
    const s = hero.stats;
    let basePower = (s.str * 15) + (s.agi * 12) + (s.vit * 12) + (s.int * 15);
    Object.values(hero.equipped).forEach(item => {
      if (item) basePower += (item.power * 10);
    });

    let squadIds = (hero.avatar.pvpSquad || []).filter(id => hero.avatar.unlockedChars.some(u => u.id === id));
    if (squadIds.length === 0) {
      squadIds = hero.avatar.unlockedChars.slice(0, 3).map(u => u.id);
    }

    return squadIds.map(id => {
      const asset = allChars.find(a => a.assetId === id);
      const u = hero.avatar.unlockedChars.find(x => x.id === id);
      if (!asset || !u) return null;
      const stars = Number(u.stars) || 1;
      const mult = (RARITY_MULT[asset.rarity] || 1.0) + ((stars - 1) * 0.1);
      const cp = Math.max(100, Math.floor(basePower * mult));
      return {
        assetId: id,
        name: asset.name,
        rarity: asset.rarity,
        stars,
        asset,
        cp,
        maxHp: cp * 4,
        hp: cp * 4,
        energy: 30,
        shield: false
      };
    }).filter(Boolean);
  }

  function startPvpBattle(opponentId) {
    const defeatedSet = new Set((hero.avatar.defeatedOpponents || []).map(String));
    if (defeatedSet.has(String(opponentId))) {
      return alert("You already defeated this challenger today! Come back tomorrow for the daily reset.");
    }

    const opp = pvpPlayersCache.find(p => String(p.studentId) === String(opponentId));
    if (!opp) return;

    const myTeam = buildMyPvpTeam();
    if (myTeam.length === 0) return alert("You need at least 1 unlocked hero!");

    const allChars = (hero.assets || []).filter(a => a.type === 'character');
    const oppTeam = opp.squad.map(sq => {
      const asset = allChars.find(a => a.assetId === sq.assetId) || FALLBACK_MOB;
      const cp = Math.max(100, Number(sq.cp) || 250);
      return {
        assetId: sq.assetId,
        name: sq.name,
        rarity: sq.rarity,
        stars: Number(sq.stars) || 1,
        asset,
        cp,
        maxHp: cp * 4,
        hp: cp * 4,
        energy: 30,
        shield: false
      };
    });

    clearPvpActionTimers();
    pvpBattle = {
      mode: 'pvp',
      opponentId: opp.studentId,
      opponentName: opp.name,
      myTeam,
      oppTeam,
      myActiveIdx: 0,
      oppActiveIdx: 0,
      turn: 'player',
      myActing: false,
      oppActing: false,
      finished: false
    };

    document.getElementById('pvp-battle-mode-tag').innerText = '⚔️ 3v3 GLOBAL PVP';
    document.getElementById('pvp-lobby-shell').classList.add('hidden');
    document.getElementById('pvp-view-battle').classList.remove('hidden');

    document.getElementById('pvp-b-myname').innerText = hero.name;
    document.getElementById('pvp-b-oppname').innerText = `${opp.name} [${opp.className}]`;
    document.getElementById('pvp-battle-log').innerText = `⚔️ 3v3 Battle vs ${opp.name}! Win: +10 Net Pts | Loss: -6 Net Pts`;

    renderPvpBattleUI();
  }

  function renderPvpBattleUI() {
    if (!pvpBattle) return;
    const myU = pvpBattle.myTeam[pvpBattle.myActiveIdx];
    const oppU = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];

    if (myU.asset) applyPortraitCloseup(document.getElementById('pvp-my-portrait'), myU.asset);
    if (oppU.asset) applyPortraitCloseup(document.getElementById('pvp-opp-portrait'), oppU.asset);
    document.getElementById('pvp-my-stars').innerText = '★'.repeat(Math.min(7, myU.stars || 1));
    document.getElementById('pvp-opp-stars').innerText = '★'.repeat(Math.min(7, oppU.stars || 1));

    document.getElementById('pvp-act-myhp').innerText = `${Math.max(0, myU.hp).toLocaleString()}/${myU.maxHp.toLocaleString()}`;
    document.getElementById('pvp-my-hpbar').style.width = `${Math.max(0, (myU.hp / myU.maxHp) * 100)}%`;
    document.getElementById('pvp-act-myen').innerText = myU.energy;
    document.getElementById('pvp-my-enbar').style.width = `${Math.min(100, myU.energy)}%`;
    document.getElementById('pvp-my-shield-tag').innerText = myU.shield ? '🛡️' : '';

    document.getElementById('pvp-act-opphp').innerText = `${Math.max(0, oppU.hp).toLocaleString()}/${oppU.maxHp.toLocaleString()}`;
    document.getElementById('pvp-opp-hpbar').style.width = `${Math.max(0, (oppU.hp / oppU.maxHp) * 100)}%`;
    document.getElementById('pvp-act-oppen').innerText = oppU.energy;
    document.getElementById('pvp-opp-enbar').style.width = `${Math.min(100, oppU.energy)}%`;
    document.getElementById('pvp-opp-shield-tag').innerText = oppU.shield ? '🛡️' : '';

    const turnEl = document.getElementById('pvp-b-turn');
    turnEl.innerText = pvpBattle.turn === 'player' ? 'YOUR TURN' : 'ENEMY TURN';
    turnEl.style.background = pvpBattle.turn === 'player'
      ? 'linear-gradient(180deg, #facc15, #ca8a04)'
      : 'linear-gradient(180deg, #f43f5e, #9f1239)';
    turnEl.style.color = pvpBattle.turn === 'player' ? '#1e1b4b' : '#fff';

    const isMyTurn = pvpBattle.turn === 'player' && !pvpBattle.finished;
    document.getElementById('pvp-sk-0').disabled = !isMyTurn;
    document.getElementById('pvp-sk-1').disabled = !isMyTurn || myU.energy < 25;
    document.getElementById('pvp-sk-2').disabled = !isMyTurn || myU.energy < 20;
    document.getElementById('pvp-sk-3').disabled = !isMyTurn || myU.energy < 50;

    const sideSwitcher = document.getElementById('pvp-side-switcher');
    if (sideSwitcher) {
      sideSwitcher.innerHTML = pvpBattle.myTeam.map((u, idx) => {
        const isAct = idx === pvpBattle.myActiveIdx;
        const isAlive = u.hp > 0;
        const canSwitch = isMyTurn && !isAct && isAlive;
        const cardClass = isAct ? 'active-unit' : (isAlive ? 'ready-unit' : 'fainted-unit');
        const face = u.asset ? getFaceCloseupCss(u.asset, 1.0) : { size: '100% 100%', pos: 'center' };
        const faceStyle = u.asset
          ? `background-image:url(${u.asset.imageData}); background-size:${face.size}; background-position:${face.pos}; background-repeat:no-repeat;`
          : '';
        const hpPct = Math.max(0, Math.min(100, (u.hp / u.maxHp) * 100));

        return `
          <button class="pvp-side-card ${cardClass}" ${canSwitch ? '' : 'disabled'} onclick="switchPvpHero(${idx})">
            <div class="pvp-side-face" style="${faceStyle}"></div>
            <div class="pvp-side-meta">
              <span class="pvp-side-tag">${isAct ? '★ ACTIVE' : (isAlive ? 'SWAP' : '💀 KO')}</span>
              <span class="pvp-side-name">${u.name}</span>
              <div class="pvp-side-hp-track"><div class="pvp-side-hp-fill" style="width:${hpPct}%;"></div></div>
            </div>
          </button>
        `;
      }).join('');
    }
  }

  function playPvpUnitAction(side, rowIdx, onDone) {
    if (!pvpBattle) return;
    const isMy = side === 'my';
    const unit = isMy ? pvpBattle.myTeam[pvpBattle.myActiveIdx] : pvpBattle.oppTeam[pvpBattle.oppActiveIdx];
    const spriteEl = document.getElementById(isMy ? 'pvp-sprite-my' : 'pvp-sprite-opp');
    const cols = Math.max(1, unit.asset?.meta?.cols || 6);
    const frameInterval = Math.max(85, Math.floor(155 / pvpSpeedMult));

    // Clear any leftover interval on this side so animations never collide
    if (pvpActionTimers[side]) {
      clearInterval(pvpActionTimers[side]);
      pvpActionTimers[side] = null;
    }

    if (isMy) pvpBattle.myActing = true;
    else pvpBattle.oppActing = true;

    spriteEl.classList.add(isMy ? 'lunge-right' : 'lunge-left');

    // Render Frame 0 immediately so the full sprite row plays from start to finish
    let f = 0;
    if (unit.asset) applySpriteFrame(spriteEl, unit.asset, 0, rowIdx);

    pvpActionTimers[side] = setInterval(() => {
      f++;
      if (f >= cols) {
        clearInterval(pvpActionTimers[side]);
        pvpActionTimers[side] = null;
        spriteEl.classList.remove('lunge-right', 'lunge-left');

        // Snap cleanly back to Idle Frame 0 before firing hit/damage
        if (unit.asset) applySpriteFrame(spriteEl, unit.asset, 0, 0);

        if (pvpBattle) {
          if (isMy) pvpBattle.myActing = false;
          else pvpBattle.oppActing = false;
        }
        if (onDone) onDone();
      } else if (unit.asset) {
        applySpriteFrame(spriteEl, unit.asset, f, rowIdx);
      }
    }, frameInterval);
  }

  function switchPvpHero(newIdx) {
    if (!pvpBattle || pvpBattle.turn !== 'player' || pvpBattle.finished) return;
    const target = pvpBattle.myTeam[newIdx];
    if (!target || target.hp <= 0 || newIdx === pvpBattle.myActiveIdx) return;

    pvpBattle.myActiveIdx = newIdx;
    pvpBattle.turn = 'enemy';
    document.getElementById('pvp-battle-log').innerHTML = `🔄 You switched in <b>${target.name}</b>!`;
    renderPvpBattleUI();
    setTimeout(runPvpEnemyTurn, Math.floor(850 / pvpSpeedMult));
  }

  function usePvpSkill(skillIdx) {
    if (!pvpBattle || pvpBattle.turn !== 'player' || pvpBattle.finished) return;
    const myU = pvpBattle.myTeam[pvpBattle.myActiveIdx];
    const oppU = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];
    const costs = [0, 25, 20, 50];
    if (myU.energy < costs[skillIdx]) return;

    pvpBattle.turn = 'animating';
    myU.shield = false;
    renderPvpBattleUI();

    if (skillIdx === 2) {
      myU.energy -= 20;
      myU.shield = true;
      const healAmt = Math.floor(myU.maxHp * 0.18);
      myU.hp = Math.min(myU.maxHp, myU.hp + healAmt);
      spawnFloatingDamage('pvp-comb-my', `+${healAmt} HP`, '#4ade80');
      document.getElementById('pvp-battle-log').innerHTML = `🛡️ <b>${myU.name}</b> raised Iron Guard (50% Shield) and healed <b>+${healAmt} HP</b>!`;
      pvpBattle.turn = 'enemy';
      renderPvpBattleUI();
      setTimeout(runPvpEnemyTurn, Math.floor(900 / pvpSpeedMult));
      return;
    }

    let mult = 1.0;
    let row = 1;
    let label = 'Strike';
    if (skillIdx === 0) {
      myU.energy = Math.min(100, myU.energy + 15);
    } else if (skillIdx === 1) {
      myU.energy -= 25;
      mult = 1.55;
      row = 1;
      label = 'Heavy Smash';
    } else if (skillIdx === 3) {
      myU.energy -= 50;
      mult = 2.3;
      row = 2;
      label = 'ULTIMATE';
    }

    playAnimeSFX('slash');
    playPvpUnitAction('my', row, () => {
      if (!pvpBattle) return;
      const oppSprite = document.getElementById('pvp-sprite-opp');
      oppSprite.classList.add('hit-flash');

      let dmg = Math.floor(myU.cp * mult * (0.92 + Math.random() * 0.16));
      if (oppU.shield) {
        dmg = Math.floor(dmg * 0.5);
        oppU.shield = false;
      }
      oppU.hp = Math.max(0, oppU.hp - dmg);
      spawnFloatingDamage('pvp-comb-opp', dmg, skillIdx === 3 ? '#fbbf24' : '#ffffff');
      document.getElementById('pvp-battle-log').innerHTML = `⚔️ <b>${myU.name}</b> used <b>${label}</b> for <b>${dmg.toLocaleString()}</b> damage!`;
      renderPvpBattleUI();

      setTimeout(() => {
        if (!pvpBattle) return;
        oppSprite.classList.remove('hit-flash');

        if (oppU.hp <= 0) {
          const nextOppIdx = pvpBattle.oppTeam.findIndex(u => u.hp > 0);
          if (nextOppIdx === -1) {
            if (pvpBattle.mode === 'guild') finishGuildWarBattle(true);
            else finishPvpBattle(true);
            return;
          }
          pvpBattle.oppActiveIdx = nextOppIdx;
          document.getElementById('pvp-battle-log').innerHTML += ` 💀 ${oppU.name} fainted! <b>${pvpBattle.oppTeam[nextOppIdx].name}</b> enters!`;
        }

        pvpBattle.turn = 'enemy';
        renderPvpBattleUI();
        setTimeout(runPvpEnemyTurn, Math.floor(850 / pvpSpeedMult));
      }, Math.floor(380 / pvpSpeedMult));
    });
  }

  function runPvpEnemyTurn() {
    if (!pvpBattle || pvpBattle.finished) return;
    const myU = pvpBattle.myTeam[pvpBattle.myActiveIdx];
    const oppU = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];
    oppU.shield = false;

    const healthyBenchIdx = pvpBattle.oppTeam.findIndex((u, i) => i !== pvpBattle.oppActiveIdx && u.hp > u.maxHp * 0.45);
    if (oppU.hp < oppU.maxHp * 0.25 && healthyBenchIdx !== -1 && Math.random() < 0.5) {
      pvpBattle.oppActiveIdx = healthyBenchIdx;
      document.getElementById('pvp-battle-log').innerHTML = `🔄 ${pvpBattle.opponentName} switched to <b>${pvpBattle.oppTeam[healthyBenchIdx].name}</b>!`;
      pvpBattle.turn = 'player';
      renderPvpBattleUI();
      return;
    }

    if (oppU.hp < oppU.maxHp * 0.45 && oppU.energy >= 20 && Math.random() < 0.55) {
      oppU.energy -= 20;
      oppU.shield = true;
      const healAmt = Math.floor(oppU.maxHp * 0.18);
      oppU.hp = Math.min(oppU.maxHp, oppU.hp + healAmt);
      spawnFloatingDamage('pvp-comb-opp', `+${healAmt} HP`, '#4ade80');
      document.getElementById('pvp-battle-log').innerHTML = `🛡️ Enemy <b>${oppU.name}</b> used Guard &amp; healed <b>+${healAmt} HP</b>!`;
      pvpBattle.turn = 'player';
      renderPvpBattleUI();
      return;
    }

    let mult = 1.0;
    let row = 1;
    let label = 'Strike';
    if (oppU.energy >= 50) {
      oppU.energy -= 50;
      mult = 2.3;
      row = 2;
      label = 'ULTIMATE';
    } else if (oppU.energy >= 25 && Math.random() < 0.65) {
      oppU.energy -= 25;
      mult = 1.55;
      label = 'Heavy Smash';
    } else {
      oppU.energy = Math.min(100, oppU.energy + 15);
    }

    playPvpUnitAction('opp', row, () => {
      if (!pvpBattle) return;
      const mySprite = document.getElementById('pvp-sprite-my');
      mySprite.classList.add('hit-flash');

      let dmg = Math.floor(oppU.cp * mult * (0.92 + Math.random() * 0.16));
      if (myU.shield) {
        dmg = Math.floor(dmg * 0.5);
        myU.shield = false;
      }
      myU.hp = Math.max(0, myU.hp - dmg);
      spawnFloatingDamage('pvp-comb-my', dmg, '#f87171');
      document.getElementById('pvp-battle-log').innerHTML = `🔥 Enemy <b>${oppU.name}</b> used <b>${label}</b> for <b>${dmg.toLocaleString()}</b> damage!`;
      renderPvpBattleUI();

      setTimeout(() => {
        if (!pvpBattle) return;
        mySprite.classList.remove('hit-flash');

        if (myU.hp <= 0) {
          const nextMyIdx = pvpBattle.myTeam.findIndex(u => u.hp > 0);
          if (nextMyIdx === -1) {
            if (pvpBattle.mode === 'guild') finishGuildWarBattle(false);
            else finishPvpBattle(false);
            return;
          }
          pvpBattle.myActiveIdx = nextMyIdx;
          document.getElementById('pvp-battle-log').innerHTML += ` 💀 ${myU.name} fainted! <b>${pvpBattle.myTeam[nextMyIdx].name}</b> steps up!`;
        }

        pvpBattle.turn = 'player';
        renderPvpBattleUI();
      }, Math.floor(380 / pvpSpeedMult));
    });
  }

  async function finishPvpBattle(won) {
    if (!pvpBattle || pvpBattle.finished) return;
    pvpBattle.finished = true;
    clearPvpActionTimers();
    const prevPvpPts = Number(hero.avatar.pvpPoints) || 1000;
    renderPvpBattleUI();

    document.getElementById('pvp-battle-log').innerHTML = won
      ? `<span style="color:#4ade80; font-weight:900;">🏆 VICTORY (+10 Net PvP Pts)! Recording Match...</span>`
      : `<span style="color:#f87171; font-weight:900;">💀 DEFEAT (-6 Net PvP Pts)! Recording Match...</span>`;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'recordPvpResult',
          token: sessionToken,
          studentId: hero.studentId,
          opponentId: pvpBattle.opponentId,
          won: won
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      hero.avatar.pvpWins = json.data.pvpWins;
      hero.avatar.pvpLosses = json.data.pvpLosses;
      hero.avatar.pvpPoints = json.data.pvpPoints;
      if (Array.isArray(json.data.defeatedOpponents)) {
        hero.avatar.defeatedOpponents = json.data.defeatedOpponents.map(String);
      }

      const ratingDelta = (Number(json.data.pvpPoints) || prevPvpPts) - prevPvpPts;
      const ratingStr = ratingDelta >= 0 ? `+${ratingDelta}` : `${ratingDelta}`;
      const newNet = getPvpNetScore(json.data.pvpWins, json.data.pvpLosses);
      const netStr = newNet >= 0 ? `+${newNet}` : `${newNet}`;

      if (json.data.won) playAnimeSFX('levelup');
      showToast(
        json.data.won
          ? `🏆 Victory! +10 Net (${netStr} Total) • ${ratingStr} Rating`
          : `💀 Defeat! -6 Net (${netStr} Total) • ${ratingStr} Rating`,
        json.data.won ? "#10b981" : "#dc2626"
      );
      setTimeout(hideToast, 2600);
      refreshActiveLeaderboard();
    } catch (err) {
      alert("PvP Record Error: " + err.message);
    }

    setTimeout(() => {
      pvpBattle = null;
      switchPvpTab('lobby');
      loadPvpLobby();
    }, 1600);
  }

  // --- 12. GUILD HALL, LIVE COC-STYLE WAR TIMER & WEEKEND 3v3 GUILD WAR ---
  function getClientWarTimingFallback() {
    const now = new Date();
    const day = now.getDay();
    const isWeekend = (day === 0 || day === 6);
    if (isWeekend) {
      const daysUntilMon = day === 6 ? 2 : 1;
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMon, 0, 0, 0, 0);
      return { isWeekend: true, phaseLabel: 'BATTLE DAY LIVE', targetEpochMs: end.getTime() };
    } else {
      const daysUntilSat = 6 - day;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSat, 0, 0, 0, 0);
      return { isWeekend: false, phaseLabel: 'PREPARATION DAY', targetEpochMs: start.getTime() };
    }
  }

  function formatWarDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  }

  function updateGuildWarCountdownDisplay() {
    const phaseEl = document.getElementById('guild-war-phase-badge');
    const timerEl = document.getElementById('guild-war-countdown');
    if (!phaseEl || !timerEl) return;

    const timing = (guildHubCache && guildHubCache.warTiming)
      ? guildHubCache.warTiming
      : getClientWarTimingFallback();

    const remMs = Math.max(0, timing.targetEpochMs - Date.now());
    const formatted = formatWarDuration(remMs);

    if (timing.isWeekend) {
      phaseEl.innerText = '⚔️ BATTLE DAY LIVE';
      phaseEl.style.background = '#dc2626';
      phaseEl.style.color = '#fff';
      timerEl.innerText = `War Ends In: ${formatted}`;
      timerEl.style.color = '#4ade80';
    } else {
      phaseEl.innerText = '🛡️ PREPARATION DAY';
      phaseEl.style.background = '#b45309';
      phaseEl.style.color = '#fef08a';
      timerEl.innerText = `War Starts In: ${formatted}`;
      timerEl.style.color = '#fde047';
    }
  }

  function startGuildWarTimerLoop() {
    if (guildWarTimerInterval) clearInterval(guildWarTimerInterval);
    updateGuildWarCountdownDisplay();
    guildWarTimerInterval = setInterval(updateGuildWarCountdownDisplay, 1000);
  }

  function stopGuildWarTimerLoop() {
    if (guildWarTimerInterval) {
      clearInterval(guildWarTimerInterval);
      guildWarTimerInterval = null;
    }
  }

  function getProjectedGuildPayout(rank) {
    if (rank === 1) return 500;
    if (rank === 2) return 400;
    if (rank === 3) return 300;
    if (rank === 4) return 200;
    if (rank === 5) return 100;
    return 50;
  }

  function renderGuildEmblemHtml(emblem, sizePx = 42) {
    const val = String(emblem || '🛡️');
    if (val.startsWith('data:image/')) {
      return `<img src="${val}" style="width:${sizePx}px; height:${sizePx}px; border-radius:10px; object-fit:cover; border:1.5px solid var(--gold); background:#090d16; flex-shrink:0;" alt="Guild Photo" />`;
    }
    return `<div style="width:${sizePx}px; height:${sizePx}px; border-radius:10px; border:1.5px solid #475569; background:#090d16; display:inline-flex; align-items:center; justify-content:center; font-size:${Math.round(sizePx * 0.55)}px; flex-shrink:0;">${val}</div>`;
  }

  function compressGuildPhotoFile(file, callback) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        callback(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function handleNewGuildPhotoSelect(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    compressGuildPhotoFile(file, (dataUrl) => {
      newGuildPhotoDataUrl = dataUrl;
      const preview = document.getElementById('new-guild-photo-preview');
      if (preview) preview.innerHTML = renderGuildEmblemHtml(dataUrl, 44);
    });
  }

  function handleEditGuildPhotoSelect(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    compressGuildPhotoFile(file, (dataUrl) => {
      editGuildPhotoDataUrl = dataUrl;
      const preview = document.getElementById('edit-guild-photo-preview');
      if (preview) preview.innerHTML = renderGuildEmblemHtml(dataUrl, 44);
    });
  }

  function openGuildModal() {
    if (!hero) return;
    newGuildPhotoDataUrl = '';
    editGuildPhotoDataUrl = '';
    document.getElementById('guild-modal').classList.remove('hidden');
    startGuildWarTimerLoop();
    loadGuildHub();
  }

  function closeGuildModal() {
    stopGuildWarTimerLoop();
    document.getElementById('guild-modal').classList.add('hidden');
    closeAllDrawers();
  }

  async function loadGuildHub() {
    const body = document.getElementById('guild-hub-body');
    const statusEl = document.getElementById('guild-event-status');
    const cdBanner = document.getElementById('guild-cooldown-banner');
    body.innerHTML = '<p style="text-align:center; color:#cbd5e1; padding:20px;">Loading Guilds...</p>';

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'getGuildHub',
          token: sessionToken,
          studentId: hero.studentId
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      guildHubCache = json.data;
      updateGuildWarCountdownDisplay();

      if (guildHubCache.unspentPoints !== undefined) {
        hero.unspentPoints = Number(guildHubCache.unspentPoints) || 0;
        renderAll();
      }

      if (guildHubCache.claimedGuildReward) {
        const gr = guildHubCache.claimedGuildReward;
        playAnimeSFX('levelup');
        alert(`🏯 WEEKEND GUILD WAR REWARD!\n\nGuild: ${gr.guildName}\nFinal Rank: #${gr.rank}\nReward: +${gr.points} Gacha Points added to your balance!`);
      }

      statusEl.innerHTML = guildHubCache.isWeekend
        ? `<span style="color:#4ade80; font-weight:900;">🔥 WEEKEND WAR ACTIVE! Win 3v3 battles to steal 25% of a defender's Guild Pts!</span>`
        : `<span style="color:#fbbf24;">⏳ Guild Battles open every Saturday &amp; Sunday • Max 20 Members</span>`;

      if (guildHubCache.cooldownRemainingMs > 0) {
        const mins = Math.ceil(guildHubCache.cooldownRemainingMs / 60000);
        cdBanner.classList.remove('hidden');
        cdBanner.innerText = `⏳ Guild Leave Cooldown Active: You can join or create a guild in ${mins} minute(s).`;
      } else {
        cdBanner.classList.add('hidden');
      }

      renderGuildHub();
    } catch (err) {
      body.innerHTML = `<p style="text-align:center; color:#f87171; padding:20px;">Error: ${err.message}</p>`;
    }
  }

  function renderGuildHub() {
    if (!guildHubCache) return;
    const body = document.getElementById('guild-hub-body');
    const { myGuild, guilds, isWeekend, cooldownRemainingMs } = guildHubCache;
    let html = '';

    if (myGuild) {
      const isOwner = String(myGuild.ownerId) === String(hero.studentId);
      const currentEmblem = editGuildPhotoDataUrl || myGuild.emblem;
      const myGuildStatusLine = isWeekend
        ? `Rank #${myGuild.rank} • Projected Payout: <b>+${myGuild.projectedPayout} Gacha Pts</b> per member`
        : `🛡️ Preparation Phase • Rankings &amp; Gacha payouts go live Saturday`;

      html += `
        <div class="rpg-card" style="border-color:var(--gold); background:rgba(245,158,11,0.12); margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div style="display:flex; gap:10px; align-items:center; min-width:0;">
              ${renderGuildEmblemHtml(myGuild.emblem, 48)}
              <div style="min-width:0;">
                <div style="font-size:16px; font-weight:900; color:#fde047;">${myGuild.name}</div>
                <div style="font-size:11px; color:#cbd5e1; margin-top:2px;">"${myGuild.motto}"</div>
                <div style="font-size:11px; color:#38bdf8; margin-top:4px;">
                  👥 <b>${myGuild.memberCount}/${myGuild.maxMembers}</b> • 🏆 <b>${myGuild.totalPoints.toLocaleString()} Guild Pts</b> • ⚔️ ${myGuild.wins}W-${myGuild.losses}L
                </div>
                <div style="font-size:11px; color:#34d399; margin-top:2px;">
                  ${myGuildStatusLine}
                </div>
              </div>
            </div>
            <button onclick="leaveCurrentGuild()" style="background:#7f1d1d; color:#fecaca; border:1px solid #ef4444; border-radius:8px; padding:5px 9px; font-size:11px; font-weight:800; cursor:pointer; flex-shrink:0;">
              🚪 Leave (1h CD)
            </button>
          </div>
      `;

      if (isOwner) {
        html += `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid #334155;">
            <div style="font-size:11px; font-weight:900; color:#fbbf24; margin-bottom:6px;">👑 GUILD OWNER SETTINGS</div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
              <div id="edit-guild-photo-preview">${renderGuildEmblemHtml(currentEmblem, 44)}</div>
              <label style="background:#1e293b; border:1px solid #475569; color:#e2e8f0; padding:6px 10px; border-radius:8px; font-size:11px; font-weight:800; cursor:pointer;">
                📷 Upload Photo
                <input type="file" accept="image/*" style="display:none;" onchange="handleEditGuildPhotoSelect(this)">
              </label>
              <input id="edit-guild-name" value="${myGuild.name}" maxlength="28" placeholder="Guild Name" style="flex:1; background:#0f172a; color:#fff; border:1px solid #475569; border-radius:6px; padding:6px 8px; font-size:12px;">
            </div>
            <div style="display:flex; gap:6px;">
              <input id="edit-guild-motto" value="${myGuild.motto}" maxlength="80" placeholder="Guild Motto / Profile" style="flex:1; background:#0f172a; color:#fff; border:1px solid #475569; border-radius:6px; padding:6px 8px; font-size:12px;">
              <button onclick="updateGuildProfile()" class="plus-btn" style="font-size:11px;">💾 Save</button>
            </div>
          </div>
        `;

        if (myGuild.pendingDetails && myGuild.pendingDetails.length > 0) {
          html += `
            <div style="margin-top:10px; padding-top:10px; border-top:1px solid #334155;">
              <div style="font-size:11px; font-weight:900; color:#4ade80; margin-bottom:6px;">📩 JOIN REQUESTS (${myGuild.pendingDetails.length})</div>
              ${myGuild.pendingDetails.map(p => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:6px 8px; border-radius:8px; margin-bottom:5px; font-size:12px;">
                  <div><b>${p.name}</b> <span style="color:#38bdf8;">[${p.className}]</span> • ${p.cp.toLocaleString()} CP</div>
                  <div style="display:flex; gap:5px;">
                    <button onclick="respondGuildRequest('${p.studentId}', true)" style="background:#059669; color:#fff; border:none; border-radius:6px; padding:4px 8px; font-weight:800; cursor:pointer;">✓ Approve</button>
                    <button onclick="respondGuildRequest('${p.studentId}', false)" style="background:#991b1b; color:#fff; border:none; border-radius:6px; padding:4px 8px; font-weight:800; cursor:pointer;">✕</button>
                  </div>
                </div>
              `).join('')}
            </div>
          `;
        }
      }

      html += `
        <div style="margin-top:10px; padding-top:10px; border-top:1px solid #334155;">
          <div style="font-size:11px; font-weight:900; color:#94a3b8; margin-bottom:6px;">👥 MEMBERS &amp; POINT CONTRIBUTION</div>
          <div style="max-height:150px; overflow-y:auto;">
            ${myGuild.memberDetails.map(m => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 6px; border-bottom:1px solid #1e293b; font-size:11px;">
                <div>
                  ${m.isOwner ? '👑' : '⚔️'} <b>${m.name}</b> <span style="color:#64748b;">[${m.className}]</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="color:${m.warPts > 0 ? '#fbbf24' : '#f87171'}; font-weight:800;">
                    +${m.warPts.toLocaleString()} Pts ${m.stolenNet > 0 ? `(+${m.stolenNet})` : (m.stolenNet < 0 ? `(${m.stolenNet})` : '')}
                  </span>
                  ${(isOwner && !m.isOwner) ? `<button onclick="kickGuildMember('${m.studentId}')" style="background:transparent; color:#f87171; border:none; cursor:pointer; font-weight:900;" title="Kick Member">✕</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>`;
    } else if (cooldownRemainingMs <= 0) {
      html += `
        <div class="rpg-card" style="margin-bottom:12px; border-color:#3b82f6;">
          <div style="font-size:13px; font-weight:900; color:#60a5fa; margin-bottom:8px;">✨ CREATE A NEW GUILD (Max 20 Members)</div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <div id="new-guild-photo-preview">${renderGuildEmblemHtml(newGuildPhotoDataUrl || '🛡️', 44)}</div>
            <label style="background:#1e293b; border:1px solid #475569; color:#e2e8f0; padding:6px 10px; border-radius:8px; font-size:11px; font-weight:800; cursor:pointer;">
              📷 Upload Photo
              <input type="file" accept="image/*" style="display:none;" onchange="handleNewGuildPhotoSelect(this)">
            </label>
            <input id="new-guild-name" maxlength="28" placeholder="Guild Name..." style="flex:1; background:#0f172a; color:#fff; border:1px solid #475569; border-radius:6px; padding:6px 10px; font-size:12px;">
          </div>
          <div style="display:flex; gap:6px;">
            <input id="new-guild-motto" maxlength="80" placeholder="Guild Motto / Description..." style="flex:1; background:#0f172a; color:#fff; border:1px solid #475569; border-radius:6px; padding:6px 10px; font-size:12px;">
            <button onclick="createNewGuild()" class="plus-btn">➕ Create</button>
          </div>
        </div>
      `;
    }

    html += `
      <div class="rpg-card" style="margin-bottom:10px; padding:8px 10px; background:rgba(16,185,129,0.12); border-color:#10b981;">
        <div style="font-size:11px; font-weight:900; color:#34d399; margin-bottom:4px;">💎 WEEKEND GUILD REWARDS (Convertible Gacha Points / Member)</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px; font-size:10px; color:#e2e8f0;">
          <span style="background:#0f172a; padding:2px 6px; border-radius:6px; border:1px solid #fbbf24;">🥇 1st: <b>+500 Pts</b></span>
          <span style="background:#0f172a; padding:2px 6px; border-radius:6px;">🥈 2nd: <b>+400 Pts</b></span>
          <span style="background:#0f172a; padding:2px 6px; border-radius:6px;">🥉 3rd: <b>+300 Pts</b></span>
          <span style="background:#0f172a; padding:2px 6px; border-radius:6px;">4th: <b>+200 Pts</b></span>
          <span style="background:#0f172a; padding:2px 6px; border-radius:6px;">5th: <b>+100 Pts</b></span>
          <span style="background:#0f172a; padding:2px 6px; border-radius:6px;">6th+: <b>+50 Pts</b></span>
        </div>
      </div>
    `;

    html += `<div style="font-size:12px; font-weight:900; color:#fbbf24; margin-bottom:8px;">${isWeekend ? '🏆 GUILD RANKINGS &amp; WEEKEND WAR' : '🛡️ REGISTERED GUILDS (WAR STARTS SATURDAY)'}</div>`;
    if (guilds.length === 0) {
      html += `<p style="text-align:center; color:#94a3b8; font-size:12px; padding:14px;">No guilds formed yet. Create the first guild above!</p>`;
    } else {
      html += guilds.map((g, idx) => {
        const rank = idx + 1;
        const rankBadge = isWeekend
          ? (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`)
          : '🛡️';
        const projectedPts = g.projectedPayout || getProjectedGuildPayout(rank);
        const statsLine = isWeekend
          ? `🏆 <b>${g.totalPoints.toLocaleString()} Pts</b> • <span style="color:#4ade80;">${g.wins}W</span>-<span style="color:#f87171;">${g.losses}L</span> • <span style="color:#34d399;">💎 +${projectedPts} Gacha Pts</span>`
          : `🛡️ Base Pool: <b>${g.totalPoints.toLocaleString()} Pts</b> • <span style="color:#94a3b8;">Unranked (Starts Saturday)</span>`;

        const isMyGuild = myGuild && g.guildId === myGuild.guildId;
        let btnHtml = '';

        if (isMyGuild) {
          btnHtml = `<span style="font-size:11px; font-weight:900; color:var(--gold);">YOUR GUILD</span>`;
        } else if (myGuild) {
          const activeDefenders = (g.memberDetails || []).filter(m => m.warPts > 0);
          btnHtml = isWeekend
            ? (activeDefenders.length > 0
                ? `<button onclick="openGuildTargetPicker('${g.guildId}')" class="pvp-fight-btn">⚔️ Attack (${activeDefenders.length})</button>`
                : `<span style="font-size:10px; color:#94a3b8; font-weight:800;">💀 0 Pts Left</span>`)
            : `<span style="font-size:10px; color:#64748b;">Weekend Only</span>`;
        } else if (g.hasRequested) {
          btnHtml = `<span style="font-size:11px; color:#fbbf24; font-weight:800;">⏳ Pending</span>`;
        } else if (g.memberCount >= g.maxMembers) {
          btnHtml = `<span style="font-size:11px; color:#f87171;">Full (20/20)</span>`;
        } else if (cooldownRemainingMs <= 0) {
          btnHtml = `<button onclick="requestJoinGuild('${g.guildId}')" class="plus-btn" style="font-size:11px;">📩 Request Join</button>`;
        }

        return `
          <div class="pvp-challenger-card" style="${isMyGuild ? 'border-color:var(--gold);' : ''}">
            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span style="font-size:14px; font-weight:900; min-width:24px; text-align:center;">${rankBadge}</span>
              ${renderGuildEmblemHtml(g.emblem, 38)}
              <div style="min-width:0;">
                <div style="font-weight:900; font-size:13px;">${g.name} <span style="font-size:11px; color:#38bdf8;">(${g.memberCount}/${g.maxMembers})</span></div>
                <div style="font-size:10px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">"${g.motto}"</div>
                <div style="font-size:11px; color:#fde047; margin-top:2px;">
                  ${statsLine}
                </div>
              </div>
            </div>
            <div style="flex-shrink:0; margin-left:8px;">${btnHtml}</div>
          </div>
        `;
      }).join('');
    }

    body.innerHTML = html;
  }

  function openGuildTargetPicker(targetGuildId) {
    if (!guildHubCache) return;
    const targetGuild = guildHubCache.guilds.find(g => g.guildId === targetGuildId);
    if (!targetGuild) return;

    const body = document.getElementById('guild-hub-body');
    const members = targetGuild.memberDetails || [];

    body.innerHTML = `
      <div class="rpg-card" style="border-color:#ef4444; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            ${renderGuildEmblemHtml(targetGuild.emblem, 36)}
            <div>
              <div style="font-weight:900; font-size:14px; color:#f87171;">⚔️ Attack ${targetGuild.name}</div>
              <div style="font-size:11px; color:#cbd5e1;">Win a 3v3 battle to steal 25% of that member's Guild War Points!</div>
            </div>
          </div>
          <button onclick="renderGuildHub()" class="plus-btn" style="background:#334155; color:#fff; font-size:11px;">← Back</button>
        </div>

        ${members.map(m => {
          const stealAmt = m.stealReward || (m.warPts > 0 ? Math.max(25, Math.floor(m.warPts * 0.25)) : 0);
          return `
            <div class="pvp-challenger-card" style="margin-bottom:6px;">
              <div>
                <div style="font-weight:800; font-size:13px;">${m.isOwner ? '👑' : '⚔️'} ${m.name} <span style="color:#38bdf8; font-size:11px;">[${m.className}]</span></div>
                <div style="font-size:11px; color:#94a3b8;">3v3 Squad CP: ${m.cp.toLocaleString()} • Pool: <b style="color:${m.warPts > 0 ? '#fbbf24' : '#f87171'};">${m.warPts} Pts</b></div>
              </div>
              ${m.warPts > 0
                ? `<button onclick="initiateGuildBattle('${targetGuild.guildId}', '${m.studentId}')" class="pvp-fight-btn">⚔️ Steal +${stealAmt}</button>`
                : `<span style="font-size:11px; color:#64748b; font-weight:800;">💀 0 Pts</span>`
              }
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  async function createNewGuild() {
    const name = document.getElementById('new-guild-name').value.trim();
    const emblem = newGuildPhotoDataUrl || '🛡️';
    const motto = document.getElementById('new-guild-motto').value.trim();
    if (!name) return alert("Enter a Guild Name.");

    showToast("🏯 Founding Guild...", "#f59e0b");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'createGuild', token: sessionToken, studentId: hero.studentId, name, emblem, motto })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);
      guildHubCache = json.data;
      newGuildPhotoDataUrl = '';
      hideToast();
      renderGuildHub();
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function requestJoinGuild(guildId) {
    showToast("📩 Sending Join Request...", "#3b82f6");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'requestJoinGuild', token: sessionToken, studentId: hero.studentId, guildId })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);
      guildHubCache = json.data;
      showToast("✅ Request Sent! Awaiting Owner Approval.", "#10b981");
      setTimeout(hideToast, 2200);
      renderGuildHub();
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function respondGuildRequest(targetStudentId, approve) {
    if (!guildHubCache?.myGuild) return;
    showToast(approve ? "✅ Approving Member..." : "Declining...", "#10b981");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'respondGuildRequest',
          token: sessionToken,
          studentId: hero.studentId,
          guildId: guildHubCache.myGuild.guildId,
          targetStudentId,
          approve
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);
      guildHubCache = json.data;
      hideToast();
      renderGuildHub();
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function updateGuildProfile() {
    if (!guildHubCache?.myGuild) return;
    const name = document.getElementById('edit-guild-name').value.trim();
    const emblem = editGuildPhotoDataUrl || guildHubCache.myGuild.emblem;
    const motto = document.getElementById('edit-guild-motto').value.trim();
    showToast("💾 Updating Guild Profile...", "#10b981");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'updateGuildProfile',
          token: sessionToken,
          studentId: hero.studentId,
          guildId: guildHubCache.myGuild.guildId,
          name, emblem, motto
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);
      guildHubCache = json.data;
      editGuildPhotoDataUrl = '';
      showToast("✅ Guild Profile Updated!", "#10b981");
      setTimeout(hideToast, 1600);
      renderGuildHub();
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function leaveCurrentGuild() {
    if (!confirm("Leave your guild? You will have a 1-hour cooldown before joining or creating another guild.")) return;
    showToast("🚪 Leaving Guild...", "#ef4444");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'leaveGuild', token: sessionToken, studentId: hero.studentId })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);
      guildHubCache = json.data;
      hideToast();
      loadGuildHub();
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function kickGuildMember(targetStudentId) {
    if (!guildHubCache?.myGuild) return;
    if (!confirm("Remove this member from the guild?")) return;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'kickGuildMember',
          token: sessionToken,
          studentId: hero.studentId,
          guildId: guildHubCache.myGuild.guildId,
          targetStudentId
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);
      guildHubCache = json.data;
      renderGuildHub();
    } catch (err) {
      alert(err.message);
    }
  }

  // --- LAUNCH FULL-SCREEN 3v3 TORII ARENA FOR GUILD WAR ---
  async function initiateGuildBattle(targetGuildId, targetMemberId) {
    const myTeam = buildMyPvpTeam();
    if (myTeam.length === 0) return alert("Summon at least 1 Hero in Gacha before battling!");

    if (!confirm("⚔️ Enter 3v3 Guild War Battle? Winner steals 25% of the loser's Guild War Points! Leaving mid-battle counts as a LOSS.")) return;
    showToast("⚔️ Entering Guild Battlefield...", "#dc2626");

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'startGuildBattle',
          token: sessionToken,
          studentId: hero.studentId,
          targetGuildId,
          targetMemberId
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      hideToast();
      const m = json.data;
      const allChars = (hero.assets || []).filter(a => a.type === 'character');
      const oppTeam = (m.oppTeam || []).map(sq => {
        const asset = allChars.find(a => a.assetId === sq.assetId) || FALLBACK_MOB;
        const cp = Math.max(100, Number(sq.cp) || 250);
        return {
          assetId: sq.assetId,
          name: sq.name,
          rarity: sq.rarity,
          stars: Number(sq.stars) || 1,
          asset,
          cp,
          maxHp: cp * 4,
          hp: cp * 4,
          energy: 30,
          shield: false
        };
      });

      clearPvpActionTimers();
      pvpBattle = {
        mode: 'guild',
        matchId: m.matchId,
        opponentId: m.defenderId,
        opponentName: m.defenderName,
        oppGuildName: m.oppGuild.name,
        potentialSteal: m.potentialSteal,
        potentialLoss: m.potentialLoss,
        myTeam,
        oppTeam,
        myActiveIdx: 0,
        oppActiveIdx: 0,
        turn: 'player',
        myActing: false,
        oppActing: false,
        finished: false
      };

      stopGuildWarTimerLoop();
      document.getElementById('guild-modal').classList.add('hidden');
      document.getElementById('pvp-modal').classList.remove('hidden');
      document.getElementById('pvp-lobby-shell').classList.add('hidden');
      document.getElementById('pvp-view-battle').classList.remove('hidden');

      document.getElementById('pvp-battle-mode-tag').innerText = `🏯 GUILD WAR (+${m.potentialSteal} PTS)`;
      document.getElementById('pvp-b-myname').innerText = `${hero.name} [${m.myGuild.name}]`;
      document.getElementById('pvp-b-oppname').innerText = `${m.defenderName} [${m.oppGuild.name}]`;
      document.getElementById('pvp-battle-log').innerText = `🏯 Guild War vs ${m.defenderName}! Win to steal +${m.potentialSteal} Guild Pts!`;

      renderPvpBattleUI();
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function finishGuildWarBattle(won) {
    if (!pvpBattle || pvpBattle.mode !== 'guild' || pvpBattle.finished) return;
    pvpBattle.finished = true;
    clearPvpActionTimers();
    const matchId = pvpBattle.matchId;
    renderPvpBattleUI();

    document.getElementById('pvp-battle-log').innerHTML = won
      ? `<span style="color:#4ade80; font-weight:900;">🏆 GUILD VICTORY! Stealing Guild War Points...</span>`
      : `<span style="color:#f87171; font-weight:900;">💀 DEFEAT! Updating Guild War Standings...</span>`;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'finishGuildBattle',
          token: sessionToken,
          studentId: hero.studentId,
          matchId,
          won
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      guildHubCache = json.data.hub;
      const stolen = json.data.stolenPoints || 0;

      if (won) {
        playAnimeSFX('levelup');
        showToast(`🏆 Stole +${stolen} Guild War Points for your guild!`, "#10b981");
      } else {
        showToast(`💀 Lost ${stolen} Guild War Points!`, "#dc2626");
      }
      setTimeout(hideToast, 3000);
    } catch (err) {
      alert("Guild Battle Sync Error: " + err.message);
    }

    setTimeout(() => {
      pvpBattle = null;
      document.getElementById('pvp-modal').classList.add('hidden');
      document.getElementById('guild-modal').classList.remove('hidden');
      startGuildWarTimerLoop();
      if (guildHubCache) renderGuildHub();
      else loadGuildHub();
    }, 1500);
  }

  function showToast(msg, bg) {
    const t = document.getElementById('toast');
    t.innerText = msg; t.style.background = bg; t.style.display = 'block';
  }
  function hideToast() { document.getElementById('toast').style.display = 'none'; }

  window.addEventListener('beforeunload', (e) => {
    flushSyncOnExit();
    if (pvpBattle && !pvpBattle.finished) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  Object.assign(window, {
    loginStudent,
    openDrawer,
    closeAllDrawers,
    toggleAnimeBGM,
    toggleIdlePause,
    rollGacha,
    equipCharacter,
    openCollection,
    closeCollection,
    openArmory,
    closeArmory,
    equipGear,
    syncProgress,
    toggleMainLeaderboardMode,
    refreshActiveLeaderboard,
    loadLeaderboard,
    loadGlobalPvpWinsLeaderboard,
    openTasksModal,
    closeTasksModal,
    openPvpModal,
    closePvpModal,
    handleBattleExitClick,
    switchPvpTab,
    loadPvpLobby,
    toggleDraftSquad,
    savePvpSquad,
    startPvpBattle,
    togglePvpSpeed,
    usePvpSkill,
    switchPvpHero,
    openGuildModal,
    closeGuildModal,
    loadGuildHub,
    renderGuildHub,
    handleNewGuildPhotoSelect,
    handleEditGuildPhotoSelect,
    openGuildTargetPicker,
    createNewGuild,
    requestJoinGuild,
    respondGuildRequest,
    updateGuildProfile,
    leaveCurrentGuild,
    kickGuildMember,
    initiateGuildBattle
  });
})();
