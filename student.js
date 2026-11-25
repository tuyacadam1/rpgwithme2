(() => {
  const API_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL";

  // --- DEVTOOLS & CONSOLE DETERRENT SHIELD ---
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'K'].includes(e.key.toUpperCase())) ||
      (e.metaKey && e.altKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) ||
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

  // --- 3v3 PVP STATE ---
  let pvpPlayersCache = [];
  let draftSquadIds = [];
  let pvpBattle = null;

  const RARITY_MULT = { Common: 1.0, Rare: 1.2, Epic: 1.5, Legendary: 2.0, Secret: 2.6, Divine: 3.5 };
  const RARITY_ORDER = { Divine: 1, Secret: 2, Legendary: 3, Epic: 4, Rare: 5, Common: 6 };

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

          if (foundAny && maxY > minY) {
            const contentHeight = maxY - minY;
            const paddedHeight = Math.min(cellH, contentHeight * 1.18);
            const zoom = Math.max(1.0, Math.min(1.45, cellH / paddedHeight));
            const centerNorm = ((minY + maxY) * 0.5) / cellH;
            entry.rowMetrics[r] = { zoom, centerNorm };
          } else {
            entry.rowMetrics[r] = { zoom: 1.08, centerNorm: 0.48 };
          }
        }
        entry.ready = true;
      } catch (_) {
        for (let r = 0; r < rows; r++) {
          entry.rowMetrics[r] = { zoom: 1.08, centerNorm: 0.48 };
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
    btn.style.color = bgmPlaying ? '#fbbf24' : '#9ca3af';
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

  // --- 1. LOGIN (STUDENT ID ONLY) ---
  async function loginStudent() {
    const studentId = document.getElementById('student-id-input').value.trim();
    if (!studentId) return alert("Enter your Student ID.");

    startAnimeBGM();
    showToast("Summoning World...", "#3b82f6");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'studentLogin', studentId })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      hero = json.data;
      sessionToken = json.data.token || '';

      if (!hero.avatar || !Array.isArray(hero.avatar.unlockedChars)) {
        hero.avatar = { unlockedChars: [], equippedChar: null, pityEpic: 0, pityLeg: 0, pitySecret: 0, pityDivine: 0, pvpSquad: [], pvpWins: 0, pvpLosses: 0, pvpPoints: 1000 };
      }
      hero.avatar.pityEpic = Number(hero.avatar.pityEpic) || 0;
      hero.avatar.pityLeg = Number(hero.avatar.pityLeg) || 0;
      hero.avatar.pitySecret = Number(hero.avatar.pitySecret) || 0;
      hero.avatar.pityDivine = Number(hero.avatar.pityDivine) || 0;
      if (!Array.isArray(hero.avatar.pvpSquad)) hero.avatar.pvpSquad = [];
      hero.avatar.pvpWins = Number(hero.avatar.pvpWins) || 0;
      hero.avatar.pvpLosses = Number(hero.avatar.pvpLosses) || 0;
      hero.avatar.pvpPoints = hero.avatar.pvpPoints !== undefined ? Number(hero.avatar.pvpPoints) : 1000;

      if (!hero.stats.level) hero.stats.level = 1;
      if (hero.stats.exp === undefined) hero.stats.exp = 0;

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
      hideToast();
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
        if (!isPlayingAction) {
          applySpriteFrame(document.getElementById('arena-hero-sprite'), charObj, idleAnimFrame, 0);
        }
      } else {
        setSilhouette(document.getElementById('stage-hero-sprite'));
        setSilhouette(document.getElementById('arena-hero-sprite'));
      }

      applySpriteFrame(document.getElementById('arena-enemy-sprite'), enemyObj, idleAnimFrame, 0);

      // Animate active 3v3 PvP sprites if battle is open
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

  // --- 3. EXP & LEVEL DISPLAY ---
  function getExpNeeded(level) {
    return Math.floor(100 * Math.pow(1.25, level - 1));
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

  // --- 4. CONTINUOUS AUTO-CLIMB TOWER BATTLE ---
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
        resBox.innerHTML = `<span style="color:#fbbf24;">🎰 Roll the Gacha Banner below to summon a hero for the Tower!</span>`;
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
          enemyHP -= dmg;
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
          heroHP -= enemyDmg;
          spawnFloatingDamage('combatant-hero', enemyDmg, '#f87171');
          updateHPBars();
        }, 200);

        setTimeout(() => {
          enemySprite.classList.remove('lunge-left');
          heroSprite.classList.remove('hit-flash');

          if (heroHP <= 0) {
            if (hero.towerFloor > 1) {
              hero.towerFloor -= 1;
              hasUnsaved = true;
            }
            resBox.innerHTML = `<span style="color:#f87171;">⚠️ Enemy too strong! Retreated to Floor ${hero.towerFloor} to farm EXP...</span>`;
            resetCombatRound();
            renderAll();
          } else {
            idleTurn = 'hero';
          }
        }, 560);
      }
    }, 1150);
  }

  function handleIdleVictory(enemy) {
    const resBox = document.getElementById('raid-result');
    const clearedFloor = hero.towerFloor;

    const expGain = (50 + (clearedFloor * 25)) * (enemy.isBoss ? 3 : 1);
    grantTowerExp(expGain);

    hero.towerFloor++;
    hasUnsaved = true;

    resBox.innerHTML = `<span style="color:#38bdf8;">⚔️ +${expGain} EXP! Advancing to Floor ${hero.towerFloor}...</span>`;

    resetCombatRound();
    renderAll();
  }

  function toggleIdlePause() {
    idlePaused = !idlePaused;
    document.getElementById('pause-idle-btn').innerText = idlePaused ? '▶️ Resume Idle' : '⏸️ Pause Idle';
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
    showToast("✨ Summoning...", "#9333ea");

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

      document.getElementById('gacha-result-log').innerHTML =
        `<span style="color:#e879f9;">🎉 ${json.data.pullResults.join(' • ')}</span>`;

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
      row.innerHTML = `<div style="font-size:12px; color:#fbbf24; padding:8px;">No characters unlocked yet. Spend 5 Class Points above to roll your first hero!</div>`;
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

  // --- 8. FLOOR ENEMY LOOKUP & RENDER ---
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
    document.getElementById('tower-floor-badge').innerText = enemy.isBoss ? `🔥 FLOOR ${hero.towerFloor} BOSS` : `FLOOR ${hero.towerFloor}`;
    const heroNameEl = document.getElementById('arena-hero-name');
    const enemyNameEl = document.getElementById('arena-enemy-name');
    heroNameEl.innerText = charObj ? charObj.name : 'No Hero Deployed';
    heroNameEl.title = charObj ? charObj.name : 'No Hero Deployed';
    enemyNameEl.innerText = enemy.asset.name;
    enemyNameEl.title = enemy.asset.name;

    document.getElementById('arena-hero-cp').innerText = getTotalCP().toLocaleString() + " CP";
    document.getElementById('arena-enemy-cp').innerText = enemy.reqCP.toLocaleString() + " CP";
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
    document.getElementById('active-char-badge').innerText = charObj
      ? `[${charObj.rarity}] ${charObj.name}`
      : 'No Character (Roll Gacha!)';

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

  function focusSection(id, btn) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // --- 9. SAFE CONFLICT-FREE AUTO-SYNC + MANUAL SYNC ---
  function startSafeAutoSyncLoop() {
    setInterval(() => {
      if (hero && hasUnsaved && !isSyncing && !devToolsOpen) {
        syncProgress(true);
      }
    }, 60000);
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
    if (!silent) showToast("☁️ Syncing Hero...", "#10b981");

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'saveStudentState',
          token: sessionToken,
          studentId: hero.studentId,
          state: {
            avatar: { equippedChar: hero.avatar.equippedChar },
            towerFloor: hero.towerFloor,
            equipped: hero.equipped
          }
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      hero.unspentPoints = Number(json.data.unspentPoints) || 0;
      if (json.data.stats) hero.stats = json.data.stats;
      if (json.data.towerFloor) hero.towerFloor = json.data.towerFloor;
      if (json.data.inventory) hero.inventory = json.data.inventory;

      if (syncRevision === localEquipRevision) {
        if (json.data.avatar) hero.avatar = json.data.avatar;
        if (json.data.equipped) hero.equipped = json.data.equipped;
        hasUnsaved = false;
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

  // --- 11. 3v3 MISCRITS-STYLE TACTICAL PVP & GLOBAL LEADERBOARD ---
  function openPvpModal() {
    if (!hero) return;
    if (hero.avatar.unlockedChars.length === 0) {
      return alert("Summon at least 1 Hero in the Gacha before entering 3v3 PvP!");
    }
    pvpBattle = null;
    document.getElementById('pvp-modal').classList.remove('hidden');
    switchPvpTab('lobby');
    loadPvpLobby();
  }

  function closePvpModal() {
    pvpBattle = null;
    document.getElementById('pvp-modal').classList.add('hidden');
  }

  function switchPvpTab(tab) {
    document.getElementById('pvp-tabs').classList.remove('hidden');
    document.getElementById('pvp-view-lobby').classList.toggle('hidden', tab !== 'lobby');
    document.getElementById('pvp-view-squad').classList.toggle('hidden', tab !== 'squad');
    document.getElementById('pvp-view-battle').classList.add('hidden');

    document.getElementById('pvp-tab-lobby').style.background = tab === 'lobby' ? '' : '#1f2937';
    document.getElementById('pvp-tab-squad').style.background = tab === 'squad' ? '' : '#1f2937';

    if (tab === 'squad') {
      draftSquadIds = (hero.avatar.pvpSquad || []).slice(0, 3);
      renderPvpSquadBuilder();
    }
  }

  async function loadPvpLobby() {
    const list = document.getElementById('pvp-global-list');
    document.getElementById('pvp-my-pts').innerText = hero.avatar.pvpPoints || 1000;
    document.getElementById('pvp-my-record').innerText = `${hero.avatar.pvpWins || 0}W - ${hero.avatar.pvpLosses || 0}L`;
    list.innerHTML = '<p style="text-align:center; color:var(--muted); padding:20px;">Loading Global Challengers across all classes...</p>';

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

      pvpPlayersCache = json.data.leaderboard || [];
      if (pvpPlayersCache.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:var(--muted); padding:20px;">No players with heroes found yet.</p>';
        return;
      }

      list.innerHTML = pvpPlayersCache.map((p, idx) => {
        const medal = idx === 0 ? '👑' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const isMe = String(p.studentId) === String(hero.studentId);
        const squadThumbs = p.squad.map(sq => {
          const asset = (hero.assets || []).find(a => a.assetId === sq.assetId);
          return asset ? `<div style="width:28px; height:28px; border-radius:6px; border:1px solid #334155; ${getThumbSpriteStyle(asset)}" title="${sq.name}"></div>` : '';
        }).join('');

        return `
          <div class="rpg-card" style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; ${isMe ? 'border-color:var(--gold); background:rgba(245,158,11,0.12);' : ''}">
            <div style="display:flex; align-items:center; gap:8px; min-width:0;">
              <span style="font-size:15px; font-weight:900; min-width:26px; text-align:center; color:${idx < 3 ? 'var(--gold)' : 'var(--muted)'};">${medal}</span>
              <div style="min-width:0;">
                <div style="font-weight:800; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${p.name} <span style="font-size:10px; color:#38bdf8;">[${p.className}]</span>
                </div>
                <div style="font-size:10px; color:var(--muted); margin-bottom:4px;">
                  ⭐ ${p.pvpPoints} Pts • <b style="color:#4ade80;">${p.wins}W</b>-<b style="color:#f87171;">${p.losses}L</b> • ${p.teamCP.toLocaleString()} Team CP
                </div>
                <div style="display:flex; gap:4px;">${squadThumbs}</div>
              </div>
            </div>
            ${isMe
              ? `<span class="badge" style="color:var(--gold);">YOU</span>`
              : `<button class="plus-btn" style="background:linear-gradient(90deg, #e11d48, #be123c); color:#fff; padding:7px 12px;" onclick="startPvpBattle('${p.studentId}')">⚔️ Fight</button>`
            }
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
        <div class="rpg-card" style="text-align:center; padding:18px 6px; border-style:dashed; border-color:#334155; color:var(--muted); font-size:11px;">
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
          style="text-align:center; padding:8px 4px; cursor:pointer; ${inSquad ? 'border-color:#4ade80; box-shadow:0 0 10px rgba(74,222,128,0.4);' : ''}">
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
      const mult = (RARITY_MULT[asset.rarity] || 1.0) + (((Number(u.stars) || 1) - 1) * 0.1);
      const cp = Math.max(100, Math.floor(basePower * mult));
      return {
        assetId: id,
        name: asset.name,
        rarity: asset.rarity,
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
        asset,
        cp,
        maxHp: cp * 4,
        hp: cp * 4,
        energy: 30,
        shield: false
      };
    });

    pvpBattle = {
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

    document.getElementById('pvp-tabs').classList.add('hidden');
    document.getElementById('pvp-view-lobby').classList.add('hidden');
    document.getElementById('pvp-view-squad').classList.add('hidden');
    document.getElementById('pvp-view-battle').classList.remove('hidden');

    document.getElementById('pvp-b-myname').innerText = `${hero.name} (3v3)`;
    document.getElementById('pvp-b-oppname').innerText = `${opp.name} [${opp.className}]`;
    document.getElementById('pvp-battle-log').innerText = `⚔️ 3v3 Battle started vs ${opp.name}! Choose your skill!`;

    renderPvpBattleUI();
  }

  function renderPvpBattleUI() {
    if (!pvpBattle) return;
    const myU = pvpBattle.myTeam[pvpBattle.myActiveIdx];
    const oppU = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];

    document.getElementById('pvp-act-myname').innerText = myU.name;
    document.getElementById('pvp-act-myhp').innerText = `${Math.max(0, myU.hp).toLocaleString()}/${myU.maxHp.toLocaleString()}`;
    document.getElementById('pvp-my-hpbar').style.width = `${Math.max(0, (myU.hp / myU.maxHp) * 100)}%`;
    document.getElementById('pvp-act-myen').innerText = myU.energy;
    document.getElementById('pvp-my-shield-tag').innerText = myU.shield ? '🛡️ SHIELDED' : '';

    document.getElementById('pvp-act-oppname').innerText = oppU.name;
    document.getElementById('pvp-act-opphp').innerText = `${Math.max(0, oppU.hp).toLocaleString()}/${oppU.maxHp.toLocaleString()}`;
    document.getElementById('pvp-opp-hpbar').style.width = `${Math.max(0, (oppU.hp / oppU.maxHp) * 100)}%`;
    document.getElementById('pvp-act-oppen').innerText = oppU.energy;
    document.getElementById('pvp-opp-shield-tag').innerText = oppU.shield ? '🛡️ SHIELDED' : '';

    const turnEl = document.getElementById('pvp-b-turn');
    turnEl.innerText = pvpBattle.turn === 'player' ? '🟢 YOUR TURN' : '🔴 ENEMY TURN';

    document.getElementById('pvp-my-bench').innerHTML = pvpBattle.myTeam.map((u, idx) =>
      `<span style="padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800; background:${u.hp > 0 ? (idx === pvpBattle.myActiveIdx ? '#0284c7' : '#1e293b') : '#450a0a'}; color:${u.hp > 0 ? '#fff' : '#f87171'};">${idx + 1}. ${u.name.split(' ')[0]} ${u.hp > 0 ? '❤️' : '💀'}</span>`
    ).join('');

    document.getElementById('pvp-opp-bench').innerHTML = pvpBattle.oppTeam.map((u, idx) =>
      `<span style="padding:2px 7px; border-radius:6px; font-size:10px; font-weight:800; background:${u.hp > 0 ? (idx === pvpBattle.oppActiveIdx ? '#be123c' : '#1e293b') : '#450a0a'}; color:${u.hp > 0 ? '#fff' : '#f87171'};">${idx + 1}. ${u.name.split(' ')[0]} ${u.hp > 0 ? '❤️' : '💀'}</span>`
    ).join('');

    const isMyTurn = pvpBattle.turn === 'player' && !pvpBattle.finished;
    document.getElementById('pvp-sk-0').disabled = !isMyTurn;
    document.getElementById('pvp-sk-1').disabled = !isMyTurn || myU.energy < 25;
    document.getElementById('pvp-sk-2').disabled = !isMyTurn || myU.energy < 20;
    document.getElementById('pvp-sk-3').disabled = !isMyTurn || myU.energy < 50;

    document.getElementById('pvp-switch-row').innerHTML = pvpBattle.myTeam.map((u, idx) => {
      const canSwitch = isMyTurn && idx !== pvpBattle.myActiveIdx && u.hp > 0;
      return `
        <button class="plus-btn" ${canSwitch ? '' : 'disabled'} style="padding:6px; font-size:10px; background:${idx === pvpBattle.myActiveIdx ? '#0369a1' : '#1e293b'}; color:#fff; opacity:${u.hp > 0 ? 1 : 0.4};" onclick="switchPvpHero(${idx})">
          ${idx === pvpBattle.myActiveIdx ? '★ Active' : (u.hp > 0 ? `Swap: ${u.name.split(' ')[0]}` : `💀 ${u.name.split(' ')[0]}`)}
        </button>
      `;
    }).join('');
  }

  function playPvpUnitAction(side, rowIdx, onDone) {
    if (!pvpBattle) return;
    const isMy = side === 'my';
    const unit = isMy ? pvpBattle.myTeam[pvpBattle.myActiveIdx] : pvpBattle.oppTeam[pvpBattle.oppActiveIdx];
    const spriteEl = document.getElementById(isMy ? 'pvp-sprite-my' : 'pvp-sprite-opp');
    const cols = Math.max(1, unit.asset?.meta?.cols || 6);

    if (isMy) pvpBattle.myActing = true;
    else pvpBattle.oppActing = true;

    spriteEl.classList.add(isMy ? 'lunge-right' : 'lunge-left');
    let f = 0;
    const t = setInterval(() => {
      if (unit.asset) applySpriteFrame(spriteEl, unit.asset, f, rowIdx);
      f++;
      if (f >= cols) {
        clearInterval(t);
        spriteEl.classList.remove('lunge-right', 'lunge-left');
        if (pvpBattle) {
          if (isMy) pvpBattle.myActing = false;
          else pvpBattle.oppActing = false;
        }
        if (onDone) onDone();
      }
    }, 115);
  }

  function switchPvpHero(newIdx) {
    if (!pvpBattle || pvpBattle.turn !== 'player' || pvpBattle.finished) return;
    const target = pvpBattle.myTeam[newIdx];
    if (!target || target.hp <= 0 || newIdx === pvpBattle.myActiveIdx) return;

    pvpBattle.myActiveIdx = newIdx;
    pvpBattle.turn = 'enemy';
    document.getElementById('pvp-battle-log').innerHTML = `🔄 You switched in <b>${target.name}</b>!`;
    renderPvpBattleUI();
    setTimeout(runPvpEnemyTurn, 850);
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
      setTimeout(runPvpEnemyTurn, 900);
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
      setTimeout(() => oppSprite.classList.remove('hit-flash'), 250);

      let dmg = Math.floor(myU.cp * mult * (0.92 + Math.random() * 0.16));
      if (oppU.shield) {
        dmg = Math.floor(dmg * 0.5);
        oppU.shield = false;
      }
      oppU.hp -= dmg;
      spawnFloatingDamage('pvp-comb-opp', dmg, skillIdx === 3 ? '#fbbf24' : '#ffffff');
      document.getElementById('pvp-battle-log').innerHTML = `⚔️ <b>${myU.name}</b> used <b>${label}</b> for <b>${dmg.toLocaleString()}</b> damage!`;

      if (oppU.hp <= 0) {
        oppU.hp = 0;
        const nextOppIdx = pvpBattle.oppTeam.findIndex(u => u.hp > 0);
        if (nextOppIdx === -1) {
          finishPvpBattle(true);
          return;
        }
        pvpBattle.oppActiveIdx = nextOppIdx;
        document.getElementById('pvp-battle-log').innerHTML += ` 💀 ${oppU.name} fainted! <b>${pvpBattle.oppTeam[nextOppIdx].name}</b> enters!`;
      }

      pvpBattle.turn = 'enemy';
      renderPvpBattleUI();
      setTimeout(runPvpEnemyTurn, 900);
    });
  }

  function runPvpEnemyTurn() {
    if (!pvpBattle || pvpBattle.finished) return;
    const myU = pvpBattle.myTeam[pvpBattle.myActiveIdx];
    const oppU = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];
    oppU.shield = false;

    // Tactical AI: switch if critically low and healthy bench exists
    const healthyBenchIdx = pvpBattle.oppTeam.findIndex((u, i) => i !== pvpBattle.oppActiveIdx && u.hp > u.maxHp * 0.45);
    if (oppU.hp < oppU.maxHp * 0.25 && healthyBenchIdx !== -1 && Math.random() < 0.5) {
      pvpBattle.oppActiveIdx = healthyBenchIdx;
      document.getElementById('pvp-battle-log').innerHTML = `🔄 ${pvpBattle.opponentName} switched to <b>${pvpBattle.oppTeam[healthyBenchIdx].name}</b>!`;
      pvpBattle.turn = 'player';
      renderPvpBattleUI();
      return;
    }

    // Tactical AI skill selection
    if (oppU.hp < oppU.maxHp * 0.45 && oppU.energy >= 20 && Math.random() < 0.55) {
      oppU.energy -= 20;
      oppU.shield = true;
      const healAmt = Math.floor(oppU.maxHp * 0.18);
      oppU.hp = Math.min(oppU.maxHp, oppU.hp + healAmt);
      spawnFloatingDamage('pvp-comb-opp', `+${healAmt} HP`, '#4ade80');
      document.getElementById('pvp-battle-log').innerHTML = `🛡️ Enemy <b>${oppU.name}</b> used Guard & healed <b>+${healAmt} HP</b>!`;
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
      setTimeout(() => mySprite.classList.remove('hit-flash'), 250);

      let dmg = Math.floor(oppU.cp * mult * (0.92 + Math.random() * 0.16));
      if (myU.shield) {
        dmg = Math.floor(dmg * 0.5);
        myU.shield = false;
      }
      myU.hp -= dmg;
      spawnFloatingDamage('pvp-comb-my', dmg, '#f87171');
      document.getElementById('pvp-battle-log').innerHTML = `🔥 Enemy <b>${oppU.name}</b> used <b>${label}</b> for <b>${dmg.toLocaleString()}</b> damage!`;

      if (myU.hp <= 0) {
        myU.hp = 0;
        const nextMyIdx = pvpBattle.myTeam.findIndex(u => u.hp > 0);
        if (nextMyIdx === -1) {
          finishPvpBattle(false);
          return;
        }
        pvpBattle.myActiveIdx = nextMyIdx;
        document.getElementById('pvp-battle-log').innerHTML += ` 💀 ${myU.name} fainted! <b>${pvpBattle.myTeam[nextMyIdx].name}</b> steps up!`;
      }

      pvpBattle.turn = 'player';
      renderPvpBattleUI();
    });
  }

  async function finishPvpBattle(won) {
    if (!pvpBattle || pvpBattle.finished) return;
    pvpBattle.finished = true;
    renderPvpBattleUI();

    document.getElementById('pvp-battle-log').innerHTML = won
      ? `<span style="color:#4ade80; font-weight:900;">🏆 VICTORY! Recording Global PvP Win...</span>`
      : `<span style="color:#f87171; font-weight:900;">💀 DEFEAT! Recording Global PvP Match...</span>`;

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

      if (json.data.won) playAnimeSFX('levelup');
      showToast(json.data.won ? `🏆 +25 PvP Rating (${json.data.pvpPoints})!` : `⚔️ Match Recorded (${json.data.pvpPoints} Rating)`, json.data.won ? "#10b981" : "#f59e0b");
      setTimeout(hideToast, 2200);
    } catch (err) {
      alert("PvP Record Error: " + err.message);
    }

    setTimeout(() => {
      pvpBattle = null;
      switchPvpTab('lobby');
      loadPvpLobby();
    }, 1600);
  }

  function showToast(msg, bg) {
    const t = document.getElementById('toast');
    t.innerText = msg; t.style.background = bg; t.style.display = 'block';
  }
  function hideToast() { document.getElementById('toast').style.display = 'none'; }

  window.addEventListener('beforeunload', (e) => {
    if (hasUnsaved) { e.preventDefault(); e.returnValue = ''; }
  });

  Object.assign(window, {
    loginStudent,
    toggleAnimeBGM,
    toggleIdlePause,
    rollGacha,
    equipCharacter,
    openCollection,
    closeCollection,
    openArmory,
    closeArmory,
    equipGear,
    focusSection,
    syncProgress,
    loadLeaderboard,
    openTasksModal,
    closeTasksModal,
    openPvpModal,
    closePvpModal,
    switchPvpTab,
    loadPvpLobby,
    toggleDraftSquad,
    savePvpSquad,
    startPvpBattle,
    usePvpSkill,
    switchPvpHero
  });
})();
