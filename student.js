(() => {
  const API_URL = "https://script.google.com/macros/s/AKfycbxPN7yKyqOwyyxIarj2BTkIcuMOomlfc52zCo2vK4AcVWg8TRofqKaRR-kj1yKiLiENWA/exec";

  let hero = null;
  let hasUnsaved = false;
  let idleAnimFrame = 0;
  let actionAnimFrame = 0;
  let isPlayingAction = false;
  let heroAnimRow = 0; // 0 = Idle, 1 = Attack, 2 = Ultimate

  let idlePaused = false;
  let autoClimb = true;
  let heroHP = 100;
  let heroMaxHP = 100;
  let enemyHP = 100;
  let enemyMaxHP = 100;
  let idleTurn = 'hero';

  const RARITY_MULT = { Common: 1.0, Rare: 1.2, Epic: 1.5, Legendary: 2.0 };
  const RARITY_ORDER = { Legendary: 1, Epic: 2, Rare: 3, Common: 4 };

  // --- ANIME THEME BGM & SFX ENGINE (WEB AUDIO SYNTHESIZER) ---
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

  // --- INFINITE FLOOR-SCALED LOOT GENERATOR ---
  const SLOT_CONFIGS = [
    { slot: 'head', icon: '🪖', baseName: 'Helm', basePower: 6 },
    { slot: 'weapon', icon: '⚔️', baseName: 'Blade', basePower: 9 },
    { slot: 'armor', icon: '🛡️', baseName: 'Plate', basePower: 10 },
    { slot: 'boots', icon: '👢', baseName: 'Greaves', basePower: 7 },
    { slot: 'accessory', icon: '🔮', baseName: 'Relic', basePower: 8 }
  ];

  const RARITY_CONFIGS = {
    Common: { scale: 1.0, bonus: 0 },
    Rare: { scale: 1.4, bonus: 8 },
    Epic: { scale: 1.9, bonus: 22 },
    Legendary: { scale: 2.6, bonus: 45 }
  };

  function generateFloorLoot(floor, rarity) {
    const f = Math.max(1, Math.floor(Number(floor) || 1));
    const sCfg = SLOT_CONFIGS[Math.floor(Math.random() * SLOT_CONFIGS.length)];
    const rCfg = RARITY_CONFIGS[rarity] || RARITY_CONFIGS.Common;

    let prefix = 'Novice';
    if (f >= 100) prefix = 'Godslayer';
    else if (f >= 50) prefix = 'Celestial';
    else if (f >= 25) prefix = 'Abyssal';
    else if (f >= 10) prefix = 'Tempered';

    const power = Math.floor((sCfg.basePower + rCfg.bonus) + (f * rCfg.scale));
    return {
      id: `${sCfg.slot}_${rarity}_${f}`,
      slot: sCfg.slot,
      icon: sCfg.icon,
      name: `${prefix} ${sCfg.baseName} (F${f})`,
      rarity: rarity,
      floor: f,
      power: power
    };
  }

  // --- 1. LOGIN ---
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

      if (!hero.avatar || !Array.isArray(hero.avatar.unlockedChars)) {
        hero.avatar = { unlockedChars: [], equippedChar: null, pityEpic: 0, pityLeg: 0 };
      }
      hero.avatar.pityEpic = Number(hero.avatar.pityEpic) || 0;
      hero.avatar.pityLeg = Number(hero.avatar.pityLeg) || 0;

      if (!hero.stats.level) hero.stats.level = 1;
      if (hero.stats.exp === undefined) hero.stats.exp = 0;

      const validIds = new Set(hero.avatar.unlockedChars.map(u => u.id));
      if (!validIds.has(hero.avatar.equippedChar)) {
        hero.avatar.equippedChar = hero.avatar.unlockedChars.length > 0 ? hero.avatar.unlockedChars[0].id : null;
      }

      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('game-screen').classList.remove('hidden');

      resetCombatRound();
      startSpriteAnimationLoop();
      startIdleCombatLoop();
      startPointsRefreshLoop();
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
    }, 180);
  }

  function setSilhouette(el) {
    if (!el) return;
    el.style.backgroundImage = `url("${EMPTY_SLOT_SILHOUETTE}")`;
    el.style.backgroundSize = 'contain';
    el.style.backgroundPosition = 'center';
  }

  function getThumbSpriteStyle(asset) {
    const cols = Math.max(1, asset.meta?.cols || 1);
    const rows = Math.max(1, asset.meta?.rows || 1);
    if (rows > 1) {
      const zoom = 1.28;
      const rowCenter = 0.54 / rows;
      const yPct = Math.max(0, Math.min(100, ((rowCenter - 0.5 / (rows * zoom)) / (1 - 1 / (rows * zoom))) * 100));
      return `background-image:url(${asset.imageData}); background-size:${cols * 100}% ${rows * 128}%; background-position:0% ${yPct}%; background-repeat:no-repeat;`;
    }
    return `background-image:url(${asset.imageData}); background-size:${cols * 100}% 100%; background-position:0% 0%; background-repeat:no-repeat;`;
  }

  function applySpriteFrame(el, asset, frameIdx, targetRow) {
    if (!el || !asset) return;
    const cols = Math.max(1, asset.meta?.cols || 1);
    const rows = Math.max(1, asset.meta?.rows || 1);
    const col = frameIdx % cols;
    const row = Math.min(rows - 1, targetRow);

    el.style.backgroundImage = `url(${asset.imageData})`;
    const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;

    if (rows > 1) {
      const zoom = 1.28;
      el.style.backgroundSize = `${cols * 100}% ${rows * 128}%`;
      const rowTop = row / rows;
      const rowCenter = rowTop + (0.54 / rows);
      const yPct = Math.max(0, Math.min(100, ((rowCenter - 0.5 / (rows * zoom)) / (1 - 1 / (rows * zoom))) * 100));
      el.style.backgroundPosition = `${xPct}% ${yPct}%`;
    } else {
      el.style.backgroundSize = `${cols * 100}% 100%`;
      el.style.backgroundPosition = `${xPct}% 0%`;
    }
  }

  // --- 3. EXP & AUTO LEVEL-UP SYSTEM ---
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
      setTimeout(hideToast, 2200);
    }
    return leveledUp;
  }

  // --- 4. CONTINUOUS IDLE TOWER AUTO-BATTLE ---
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
    const tag = document.createElement('div');
    tag.className = 'dmg-popup';
    tag.style.color = color;
    tag.innerText = `-${dmg.toLocaleString()}`;
    box.appendChild(tag);
    setTimeout(() => tag.remove(), 750);
  }

  function startIdleCombatLoop() {
    setInterval(() => {
      if (idlePaused || !hero || idleTurn === 'animating') return;

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
              if (!autoClimb) {
                document.getElementById('auto-climb-btn').innerText = `🔁 Farming Floor ${hero.towerFloor}`;
              }
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

    if (autoClimb) {
      hero.towerFloor++;
      hasUnsaved = true;
    }

    const roll = Math.random() * 100;
    let rarity = 'Common';
    if (enemy.isBoss) rarity = roll < 30 ? 'Legendary' : roll < 75 ? 'Epic' : 'Rare';
    else rarity = roll < 4 ? 'Legendary' : roll < 18 ? 'Epic' : roll < 50 ? 'Rare' : 'Common';

    const drop = generateFloorLoot(clearedFloor, rarity);
    const existingIdx = hero.inventory.findIndex(i => i.slot === drop.slot && i.rarity === drop.rarity);

    if (existingIdx === -1) {
      hero.inventory.push(drop);
      hasUnsaved = true;
      resBox.innerHTML = `<span style="color:#4ade80;">🎉 +${expGain} EXP! Found [${drop.rarity}] ${drop.name} (+${drop.power})!</span>`;
    } else if (drop.power > hero.inventory[existingIdx].power) {
      const oldEq = hero.equipped[drop.slot];
      hero.inventory[existingIdx] = drop;
      if (oldEq && oldEq.slot === drop.slot && oldEq.rarity === drop.rarity) {
        hero.equipped[drop.slot] = drop;
      }
      hasUnsaved = true;
      resBox.innerHTML = `<span style="color:#4ade80;">⬆️ +${expGain} EXP! Upgraded [${drop.rarity}] ${drop.name} (+${drop.power})!</span>`;
    } else {
      resBox.innerHTML = `<span style="color:#38bdf8;">⚔️ +${expGain} EXP! ${autoClimb ? `Advancing to Floor ${hero.towerFloor}...` : `Farming Floor ${hero.towerFloor}...`}</span>`;
    }

    if (enemy.isBoss) {
      syncProgress();
      loadLeaderboard();
    }

    resetCombatRound();
    renderAll();
  }

  function toggleAutoClimb() {
    autoClimb = !autoClimb;
    const btn = document.getElementById('auto-climb-btn');

    if (!autoClimb) {
      if (hero.towerFloor > 1) {
        hero.towerFloor -= 1;
        hasUnsaved = true;
      }
      btn.innerText = `🔁 Farming Floor ${hero.towerFloor}`;
      btn.style.background = '#d97706';
      document.getElementById('raid-result').innerHTML =
        `<span style="color:#fbbf24;">🔁 Stepped back to Floor ${hero.towerFloor} to farm EXP & loot!</span>`;
    } else {
      btn.innerText = '🔄 Auto-Climb: ON';
      btn.style.background = '#059669';
      document.getElementById('raid-result').innerHTML =
        `<span style="color:#4ade80;">🔄 Auto-Climb enabled! Pushing higher floors...</span>`;
    }

    resetCombatRound();
    renderAll();
  }

  function toggleIdlePause() {
    idlePaused = !idlePaused;
    document.getElementById('pause-idle-btn').innerText = idlePaused ? '▶️ Resume Idle' : '⏸️ Pause Idle';
  }

  // --- 5. SERVER-AUTHORITATIVE GACHA SYSTEM WITH PITY ---
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

  function equipCharacter(assetId) {
    hero.avatar.equippedChar = assetId;
    hasUnsaved = true;
    resetCombatRound();
    renderAll();
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

  // --- 6. COMBAT POWER & AUTO-LEVELING STATS ---
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
      { key: 'head', defIcon: '🪖', label: 'Head' },
      { key: 'weapon', defIcon: '⚔️', label: 'Weapon' },
      { key: 'armor', defIcon: '🛡️', label: 'Armor' },
      { key: 'boots', defIcon: '👢', label: 'Boots' },
      { key: 'accessory', defIcon: '💍', label: 'Relic' }
    ];

    slotDefs.forEach(s => {
      const el = document.getElementById('slot-' + s.key);
      const item = hero.equipped[s.key];
      el.className = 'gear-slot ' + (item ? 'rarity-' + item.rarity : '');
      el.innerHTML = `
        <div class="gear-icon">${item ? item.icon : s.defIcon}</div>
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

      return `
        <div class="rpg-card rarity-${item.rarity}" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; ${isEquipped ? 'border-color:#4ade80; background:rgba(16,185,129,0.12);' : ''}">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:26px;">${item.icon}</span>
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
    }).join('') || '<p style="text-align:center; color:var(--muted); padding:20px;">No gear unlocked yet. Let your hero idle in the Tower!</p>';

    modal.classList.remove('hidden');
  }

  function closeArmory() { document.getElementById('armory-modal').classList.add('hidden'); }

  function equipGear(itemId) {
    const item = hero.inventory.find(i => i.id === itemId);
    if (!item) return;
    hero.equipped[item.slot] = item;
    hasUnsaved = true;
    closeArmory();
    resetCombatRound();
    renderAll();
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
    document.getElementById('arena-hero-name').innerText = charObj ? charObj.name : 'No Hero Deployed';
    document.getElementById('arena-hero-cp').innerText = getTotalCP().toLocaleString() + " CP";
    document.getElementById('arena-enemy-name').innerText = enemy.asset.name;
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
    if (epicEl) epicEl.innerText = `${hero.avatar.pityEpic || 0}/10`;
    if (legEl) legEl.innerText = `${hero.avatar.pityLeg || 0}/25`;

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

  // --- 9. CLOUD SYNC & LEADERBOARD ---
  async function syncProgress() {
    showToast("☁️ Saving Hero...", "#10b981");
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'saveStudentState',
          studentId: hero.studentId,
          state: {
            avatar: { equippedChar: hero.avatar.equippedChar },
            stats: hero.stats,
            towerFloor: hero.towerFloor,
            equipped: hero.equipped,
            inventory: hero.inventory
          }
        })
      });
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      hero.unspentPoints = Number(json.data.unspentPoints) || 0;
      if (json.data.avatar) hero.avatar = json.data.avatar;
      if (json.data.stats) hero.stats = json.data.stats;
      if (json.data.towerFloor) hero.towerFloor = json.data.towerFloor;
      if (json.data.equipped) hero.equipped = json.data.equipped;
      if (json.data.inventory) hero.inventory = json.data.inventory;

      hasUnsaved = false;
      resetCombatRound();
      renderAll();

      showToast("✅ Synced!", "#10b981");
      setTimeout(hideToast, 1500);
    } catch (err) {
      hideToast();
      alert("Sync failed: " + err.message);
    }
  }

  async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list || !hero) return;

    try {
      if (hasUnsaved) await syncProgress();

      const res = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'getLeaderboard', classId: hero.classId })
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
          body: JSON.stringify({ action: 'getStudentPoints', studentId: hero.studentId })
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
    toggleAutoClimb,
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
    closeTasksModal
  });
})();
