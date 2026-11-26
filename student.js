(() => {
  const API_URL = "https://script.google.com/macros/s/AKfycbxPN7yKyqOwyyxIarj2BTkIcuMOomlfc52zCo2vK4AcVWg8TRofqKaRR-kj1yKiLiENWA/exec";

  // Client-side rate limiters & anti-tamper freeze
  let lastSaveRequestTime = 0;
  let lastGachaRequestTime = 0;
  let lastGuildActionTime = 0;

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg, bg = "#065f46") {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = msg;
    t.style.background = bg;
    t.style.display = 'block';
  }

  function hideToast() {
    const t = document.getElementById('toast');
    if (t) t.style.display = 'none';
  }

  const rarityConfig = {
    Common: { color: '#94a3b8', mult: 1.0, badge: 'COMMON' },
    Rare: { color: '#3b82f6', mult: 1.2, badge: 'RARE' },
    Epic: { color: '#a855f7', mult: 1.5, badge: 'EPIC' },
    Legendary: { color: '#eab308', mult: 2.0, badge: 'LEGENDARY' },
    Secret: { color: '#ef4444', mult: 2.6, badge: 'SECRET' },
    Divine: { color: '#06b6d4', mult: 3.5, badge: 'DIVINE' }
  };

  let sessionToken = '';
  let hero = {
    studentId: '',
    name: '',
    classId: '',
    avatar: {
      equippedChar: '',
      unlockedChars: [],
      pityEpic: 0,
      pityLeg: 0,
      pitySecret: 0,
      pityDivine: 0,
      pvpWins: 0,
      pvpLosses: 0,
      pvpPoints: 1000,
      pvpSquad: [],
      defeatedOpponents: [],
      guildId: null
    },
    stats: { level: 1, exp: 0, str: 1, agi: 1, vit: 1, int: 1 },
    inventory: [],
    equipped: { head: null, weapon: null, armor: null, boots: null, accessory: null },
    unspentPoints: 0,
    towerFloor: 1
  };

  let gameAssets = [];
  let gachaPool = [];
  let enemyPool = [];
  let bgPool = [];
  let pvpPlayersCache = [];
  let pvpSquadDraft = [];
  let pvpBattle = null;
  let guildHubData = null;
  let pendingGuildEmblem = '🛡️';
  let editGuildEmblem = '🛡️';
  let guildTimerInterval = null;
  let pvpActionTimers = [];

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playAnimeSFX(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'slash') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(750, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
      osc.start(now);
      osc.stop(now + 0.14);
    } else if (type === 'skill') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(1150, now + 0.35);
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'crit') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(950, now + 0.25);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'levelup') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.1);
      osc.frequency.setValueAtTime(659.25, now + 0.2);
      osc.frequency.setValueAtTime(880, now + 0.3);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.55);
    }
  }

  let combat = {
    enemy: { name: 'Slime', maxHp: 100, hp: 100, atk: 12, isBoss: false, sprite: null },
    playerHp: 100,
    playerMaxHp: 100,
    playerStamina: 100,
    enemyAttackTimer: 0,
    bossCycle: 0,
    ultimateReady: false,
    autoBattle: false,
    heroAnimState: 'idle',
    heroAnimTimer: 0,
    heroFrame: 0,
    enemyFrame: 0,
    frameTick: 0,
    particles: [],
    floatingTexts: [],
    shakeTimer: 0,
    hitstopTimer: 0,
    flashAlpha: 0,
    flashColor: '#ffffff',
    afterimages: [],
    skillCutinTimer: 0,
    skillCutinName: ''
  };

  let saveTimer = null;
  let dirtySave = false;
  let activeLeaderboardTab = 'tower';

  function getExpNeeded(level) {
    return Math.floor(100 + ((level - 1) * 150) + (Math.pow(level, 2.15) * 12));
  }

  function isWeekendClient() {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  }

  function getFloorExpReward(floor, isBoss) {
    const baseExp = 60 + (floor * 45) + (Math.pow(floor, 1.85) * 8);
    const bossMult = isBoss ? 3 : 1;
    const weekendMult = isWeekendClient() ? 2 : 1;
    return Math.floor(baseExp * bossMult * weekendMult);
  }

  function getEquipPowerBonus() {
    let bonus = 0;
    Object.values(hero.equipped || {}).forEach(item => {
      if (item && item.power) bonus += Number(item.power);
    });
    return bonus;
  }

  function getPlayerCombatPower() {
    const eqBonus = getEquipPowerBonus();
    const base = (hero.stats.str * 15) + (hero.stats.agi * 12) + (hero.stats.vit * 12) + (hero.stats.int * 15) + (eqBonus * 10);
    const activeChar = gachaPool.find(c => c.assetId === hero.avatar.equippedChar);
    const unlockedInfo = (hero.avatar.unlockedChars || []).find(u => u.id === hero.avatar.equippedChar);
    const mult = activeChar ? (rarityConfig[activeChar.rarity]?.mult || 1) : 1;
    const starBonus = unlockedInfo ? (1 + ((unlockedInfo.stars || 1) - 1) * 0.1) : 1;
    return Math.floor(base * mult * starBonus);
  }

  function getEnemyCombatPower(floor, isBoss) {
    const base = 250 * Math.pow(1.15, floor - 1);
    return Math.floor(base * (isBoss ? 1.85 : 1.0));
  }

  function getSkillTierInfo() {
    const lv = hero.stats.level;
    if (lv >= 50) return { name: 'VOID ANNIHILATION', mult: 7.5, color: '#ef4444' };
    if (lv >= 20) return { name: 'CELESTIAL NOVA', mult: 5.5, color: '#eab308' };
    if (lv >= 10) return { name: 'DRAGON BREAKER', mult: 4.2, color: '#a855f7' };
    return { name: 'AETHER SLASH', mult: 3.0, color: '#38bdf8' };
  }

  const imageCache = {};
  function getLoadedImage(src) {
    if (!src) return null;
    if (!imageCache[src]) {
      const img = new Image();
      img.src = src;
      imageCache[src] = img;
    }
    return imageCache[src];
  }

  function parseGameAssets(assets) {
    gameAssets = assets || [];
    gachaPool = gameAssets.filter(a => a.type === 'character');
    enemyPool = gameAssets.filter(a => a.type === 'monster' || a.type === 'boss');
    bgPool = gameAssets.filter(a => a.type === 'background');
    gameAssets.forEach(a => getLoadedImage(a.imageData));
  }

  function assetMatchesFloor(asset, floor) {
    const rule = (asset.meta?.floorRule || 'all').toLowerCase().trim();
    if (rule === 'all' || !rule) return true;
    if (rule.includes('-')) {
      const [min, max] = rule.split('-').map(Number);
      return floor >= min && floor <= max;
    }
    if (rule.endsWith('+')) {
      const min = Number(rule.replace('+', ''));
      return floor >= min;
    }
    return Number(rule) === floor;
  }

  async function apiPost(payload) {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.status === 'error') {
      if (String(json.message || '').includes('Unauthorized')) {
        sessionToken = '';
        alert("Session expired or invalid. Please log in again.");
        location.reload();
      }
      throw new Error(json.message);
    }
    return json;
  }

  async function studentLogin() {
    const studentId = document.getElementById('login-id').value.trim();
    const pin = document.getElementById('login-pin').value.trim();
    if (!studentId || !pin) return alert("Enter Student ID and PIN.");
    if (pin.length < 4) return alert("PIN must be at least 4 characters.");

    showToast("Summoning world...", "#4f46e5");
    try {
      const json = await apiPost({ action: 'studentLogin', studentId, pin });

      const data = json.data;
      sessionToken = data.token || '';
      hero.studentId = data.studentId;
      hero.name = data.name;
      hero.classId = data.classId;
      hero.avatar = Object.assign(hero.avatar, data.avatar || {});
      hero.stats = data.stats || hero.stats;
      hero.inventory = data.inventory || [];
      hero.equipped = data.equipped || hero.equipped;
      hero.unspentPoints = Number(data.unspentPoints) || 0;
      hero.towerFloor = Number(data.towerFloor) || 1;

      parseGameAssets(data.assets);
      hideToast();

      document.getElementById('login-pin').value = '';
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('hud-top').classList.remove('hidden');
      document.getElementById('hud-bottom').classList.remove('hidden');

      if (data.abandonedGuildLoss) {
        setTimeout(() => {
          alert(`⚠️ GUILD BATTLE FORFEIT!\nYou closed the game during a Guild Battle against ${data.abandonedGuildLoss.oppGuildName} and lost -${data.abandonedGuildLoss.stakePoints} Guild War Points!`);
        }, 400);
      }
      if (data.claimedGuildReward) {
        setTimeout(() => {
          alert(`🏆 WEEKEND GUILD WAR REWARD!\nYour guild (${data.claimedGuildReward.guildName}) finished Rank #${data.claimedGuildReward.rank}!\nYou received +${data.claimedGuildReward.points} Class Points!`);
        }, 700);
      }

      spawnFloorEnemy();
      updateHUD();
      refreshActiveLeaderboard();
      requestAnimationFrame(gameLoop);
    } catch (err) {
      hideToast();
      alert("Login Error: " + err.message);
    }
  }

  async function refreshPoints(manual = false) {
    if (!hero.studentId) return;
    if (manual) showToast("Checking Class Points...", "#0369a1");
    try {
      const json = await apiPost({ action: 'getStudentPoints', studentId: hero.studentId });
      hero.unspentPoints = Number(json.data.unspentPoints) || 0;
      updateHUD();
      if (manual) {
        showToast(`Synced! Balance: ★ ${hero.unspentPoints} Pts`, "#10b981");
        setTimeout(hideToast, 2000);
      }
    } catch (_) {
      if (manual) hideToast();
    }
  }

  function queueSave() {
    dirtySave = true;
    const syncStatus = document.getElementById('sync-status');
    if (syncStatus) syncStatus.innerText = "Syncing...";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 2500);
  }

  async function flushSave() {
    if (!dirtySave || !hero.studentId || !sessionToken) return;
    const now = Date.now();
    if (now - lastSaveRequestTime < 1500) {
      saveTimer = setTimeout(flushSave, 1500);
      return;
    }
    lastSaveRequestTime = now;
    dirtySave = false;

    const syncStatus = document.getElementById('sync-status');
    try {
      const json = await apiPost({
        action: 'saveStudentState',
        token: sessionToken,
        studentId: hero.studentId,
        state: {
          avatar: hero.avatar,
          stats: hero.stats,
          inventory: hero.inventory,
          equipped: hero.equipped,
          towerFloor: hero.towerFloor
        }
      });

      if (json && json.data) {
        if (json.data.avatar) hero.avatar = Object.assign(hero.avatar, json.data.avatar);
        if (json.data.equipped) hero.equipped = json.data.equipped;
        if (json.data.towerFloor !== undefined) hero.towerFloor = Number(json.data.towerFloor) || hero.towerFloor;
        if (json.data.unspentPoints !== undefined) hero.unspentPoints = Number(json.data.unspentPoints) || 0;
        if (json.data.stats) hero.stats = json.data.stats;
        if (Array.isArray(json.data.inventory)) hero.inventory = json.data.inventory;

        if (Array.isArray(json.data.newDrops) && json.data.newDrops.length > 0) {
          const drop = json.data.newDrops[json.data.newDrops.length - 1];
          combat.floatingTexts.push({
            x: canvas.width * 0.5,
            y: canvas.height * 0.34,
            text: `🎁 LOOT: ${drop.name}!`,
            color: '#facc15',
            life: 2.2,
            scale: 1.35
          });
          showToast(`🎁 Gear Dropped: ${drop.name} (+${drop.power} PWR)!`, "#7e22ce");
          setTimeout(hideToast, 2800);
        }
        updateHUD();
      }
      if (syncStatus) syncStatus.innerText = "Saved ✓";
    } catch (_) {
      if (syncStatus) syncStatus.innerText = "Offline";
    }
  }

  function switchLeaderboardTab(tab) {
    activeLeaderboardTab = tab;
    const btnTower = document.getElementById('lb-tab-tower');
    const btnPvp = document.getElementById('lb-tab-pvp');
    if (btnTower && btnPvp) {
      btnTower.style.background = tab === 'tower' ? '#eab308' : '#1e293b';
      btnTower.style.color = tab === 'tower' ? '#000' : '#94a3b8';
      btnPvp.style.background = tab === 'pvp' ? '#9333ea' : '#1e293b';
      btnPvp.style.color = tab === 'pvp' ? '#fff' : '#94a3b8';
    }
    refreshActiveLeaderboard();
  }

  function refreshActiveLeaderboard() {
    if (activeLeaderboardTab === 'pvp') {
      loadPvpLeaderboardSidebar();
    } else {
      loadLeaderboard();
    }
  }

  async function loadLeaderboard() {
    try {
      const json = await apiPost({ action: 'getLeaderboard', classId: hero.classId });
      const list = json.data || [];
      const container = document.getElementById('leaderboard-list');
      if (!container) return;

      if (list.length === 0) {
        container.innerHTML = `<div style="color:#94a3b8; font-size:12px;">No climbers yet.</div>`;
        return;
      }

      container.innerHTML = list.map((p, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const isMe = String(p.studentId) === String(hero.studentId);
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-radius:8px; margin-bottom:6px; background:${isMe ? 'rgba(234,179,8,0.18)' : 'rgba(15,23,42,0.7)'}; border:1px solid ${isMe ? '#eab308' : '#1e293b'};">
            <div>
              <div style="font-size:12px; font-weight:800; color:${isMe ? '#fde047' : '#f8fafc'};">${medal} ${escHtml(p.name)}</div>
              <div style="font-size:10px; color:#94a3b8;">Lv.${Number(p.level) || 1} • ${escHtml(p.heroName)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:12px; font-weight:800; color:#38bdf8;">F${Number(p.floor) || 1}</div>
              <div style="font-size:9px; color:#94a3b8;">CP ${Number(p.cp || 0).toLocaleString()}</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (_) {}
  }

  async function loadPvpLeaderboardSidebar() {
    try {
      const json = await apiPost({ action: 'getPvpData', studentId: hero.studentId });
      const list = json.data.leaderboard || [];
      const container = document.getElementById('leaderboard-list');
      if (!container) return;

      if (list.length === 0) {
        container.innerHTML = `<div style="color:#94a3b8; font-size:12px;">No PvP fighters yet.</div>`;
        return;
      }

      container.innerHTML = list.slice(0, 20).map((p, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const isMe = String(p.studentId) === String(hero.studentId);
        const netScore = getPvpNetScore(p.wins, p.losses);
        const netLabel = netScore >= 0 ? `+${netScore}` : `${netScore}`;
        const netColor = netScore >= 0 ? '#4ade80' : '#f87171';
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-radius:8px; margin-bottom:6px; background:${isMe ? 'rgba(147,51,234,0.22)' : 'rgba(15,23,42,0.7)'}; border:1px solid ${isMe ? '#a855f7' : '#1e293b'};">
            <div>
              <div style="font-size:12px; font-weight:800; color:${isMe ? '#e9d5ff' : '#f8fafc'};">${medal} ${escHtml(p.name)}</div>
              <div style="font-size:10px; color:#94a3b8;">${escHtml(p.className)} • ${Number(p.wins) || 0}W/${Number(p.losses) || 0}L</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:12px; font-weight:800; color:${netColor};">${netLabel} Net</div>
              <div style="font-size:9px; color:#94a3b8;">CP ${Number(p.teamCP || 0).toLocaleString()}</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (_) {}
  }

  function updateHUD() {
    document.getElementById('hud-name').innerText = hero.name;
    document.getElementById('hud-level').innerText = `Lv. ${hero.stats.level}`;
    document.getElementById('hud-points').innerText = hero.unspentPoints;
    document.getElementById('hud-floor').innerText = hero.towerFloor;

    const cp = getPlayerCombatPower();
    document.getElementById('hud-cp').innerText = cp.toLocaleString();

    const expNeeded = getExpNeeded(hero.stats.level);
    const expPct = Math.min(100, Math.floor((hero.stats.exp / expNeeded) * 100));
    document.getElementById('hud-exp-bar').style.width = `${expPct}%`;
    document.getElementById('hud-exp-text').innerText = `${hero.stats.exp.toLocaleString()} / ${expNeeded.toLocaleString()} EXP`;

    const activeChar = gachaPool.find(c => c.assetId === hero.avatar.equippedChar);
    const titleEl = document.getElementById('hud-hero-title');
    if (activeChar) {
      const cfg = rarityConfig[activeChar.rarity] || rarityConfig.Common;
      const unlocked = (hero.avatar.unlockedChars || []).find(u => u.id === activeChar.assetId);
      const stars = unlocked ? (unlocked.stars || 1) : 1;
      titleEl.innerText = `[${cfg.badge}] ${activeChar.name} ★${stars}`;
      titleEl.style.color = cfg.color;
    } else {
      titleEl.innerText = "No Hero Summoned";
      titleEl.style.color = "#94a3b8";
    }

    const weekendBadge = document.getElementById('hud-weekend-badge');
    if (weekendBadge) {
      if (isWeekendClient()) {
        weekendBadge.classList.remove('hidden');
      } else {
        weekendBadge.classList.add('hidden');
      }
    }

    const skillInfo = getSkillTierInfo();
    const skillBtn = document.getElementById('btn-skill');
    skillBtn.style.opacity = combat.ultimateReady ? '1' : '0.45';
    skillBtn.style.background = combat.ultimateReady ? skillInfo.color : '#334155';
    skillBtn.style.color = combat.ultimateReady ? '#000' : '#fff';
    skillBtn.innerText = `⚡ ${skillInfo.name}`;
  }

  function openTasksModal() {
    document.getElementById('modal-tasks').classList.remove('hidden');
    loadStudentTasks();
  }

  async function loadStudentTasks() {
    const contentEl = document.getElementById('tasks-modal-content');
    const summaryEl = document.getElementById('tasks-summary-bar');
    if (!contentEl) return;
    contentEl.innerHTML = `<div style="text-align:center; padding:24px; color:#94a3b8;">Loading your class tasks...</div>`;

    try {
      const json = await apiPost({
        action: 'getStudentTasks',
        studentId: hero.studentId,
        classId: hero.classId
      });

      const { completed = [], missing = [], totalEarned = 0 } = json.data || {};
      if (summaryEl) {
        summaryEl.innerHTML = `
          <span>✅ Completed: <strong style="color:#4ade80;">${completed.length}</strong></span>
          <span>⚠️ Missing: <strong style="color:#f87171;">${missing.length}</strong></span>
          <span>★ Earned: <strong style="color:#eab308;">+${Number(totalEarned) || 0} Pts</strong></span>
        `;
      }

      let html = '';

      if (missing.length > 0) {
        html += `<div style="font-size:12px; font-weight:800; color:#f87171; text-transform:uppercase; margin-bottom:8px;">⚠️ Missing / Incomplete Tasks (${missing.length})</div>`;
        html += missing.map(m => `
          <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(239,68,68,0.12); border:1px solid #991b1b; padding:10px 12px; border-radius:10px; margin-bottom:8px;">
            <div>
              <div style="font-weight:800; color:#fca5a5; font-size:13px;">${escHtml(m.taskName)}</div>
              <div style="font-size:10px; color:#94a3b8;">Issued: ${escHtml(m.date || 'Class Task')} • Submit to teacher to earn points</div>
            </div>
            <span style="background:#7f1d1d; color:#fecaca; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:800;">MISSING (+${Number(m.points) || 0} Pts)</span>
          </div>
        `).join('');
      }

      html += `<div style="font-size:12px; font-weight:800; color:#4ade80; text-transform:uppercase; margin:14px 0 8px;">✅ Completed Tasks (${completed.length})</div>`;
      if (completed.length === 0) {
        html += `<div style="color:#94a3b8; font-size:12px; padding:12px; text-align:center; background:#1e293b; border-radius:10px;">No tasks recorded yet.</div>`;
      } else {
        html += completed.map(c => `
          <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(16,185,129,0.1); border:1px solid #065f46; padding:10px 12px; border-radius:10px; margin-bottom:8px;">
            <div>
              <div style="font-weight:800; color:#f8fafc; font-size:13px;">${escHtml(c.taskName)}</div>
              <div style="font-size:10px; color:#94a3b8;">Recorded: ${escHtml(c.date || 'Completed')}</div>
            </div>
            <span style="color:#4ade80; font-weight:900; font-size:13px;">+${Number(c.points) || 0} Pts</span>
          </div>
        `).join('');
      }

      contentEl.innerHTML = html;
    } catch (err) {
      contentEl.innerHTML = `<div style="color:#f87171; text-align:center; padding:20px;">Failed to load tasks: ${escHtml(err.message)}</div>`;
    }
  }

  function spawnFloorEnemy() {
    const floor = hero.towerFloor;
    const isBoss = floor % 10 === 0;
    const enemyCP = getEnemyCombatPower(floor, isBoss);

    let candidates = enemyPool.filter(e => (isBoss ? e.type === 'boss' : e.type === 'monster') && assetMatchesFloor(e, floor));
    if (candidates.length === 0) candidates = enemyPool.filter(e => assetMatchesFloor(e, floor));
    if (candidates.length === 0) candidates = enemyPool;

    const chosenSprite = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    const baseName = chosenSprite ? chosenSprite.name : (isBoss ? 'Abyssal Overlord' : 'Shadow Fiend');

    combat.enemy = {
      name: isBoss ? `👑 ${baseName}` : baseName,
      maxHp: Math.floor(enemyCP * 1.4),
      hp: Math.floor(enemyCP * 1.4),
      atk: Math.max(8, Math.floor(enemyCP * 0.14)),
      cp: enemyCP,
      isBoss,
      sprite: chosenSprite
    };

    const playerCP = getPlayerCombatPower();
    combat.playerMaxHp = Math.max(150, Math.floor(playerCP * 1.5));
    combat.playerHp = combat.playerMaxHp;
    combat.enemyAttackTimer = 0;
    combat.bossCycle = 0;

    document.getElementById('enemy-name').innerText = combat.enemy.name;
    document.getElementById('enemy-cp').innerText = `CP ${enemyCP.toLocaleString()}`;
    updateBattleBars();
  }

  function updateBattleBars() {
    const pPct = Math.max(0, Math.min(100, (combat.playerHp / combat.playerMaxHp) * 100));
    const ePct = Math.max(0, Math.min(100, (combat.enemy.hp / combat.enemy.maxHp) * 100));
    document.getElementById('player-hp-bar').style.width = `${pPct}%`;
    document.getElementById('enemy-hp-bar').style.width = `${ePct}%`;
  }

  function spawnAnimeSlashVFX(x, y, color, isHeavy = false) {
    combat.hitstopTimer = isHeavy ? 0.085 : 0.04;
    combat.shakeTimer = isHeavy ? 0.35 : 0.18;
    combat.flashAlpha = isHeavy ? 0.45 : 0.22;
    combat.flashColor = color;

    combat.particles.push({
      type: 'slash',
      x, y,
      angle: (Math.random() * 0.8) - 0.4,
      length: isHeavy ? 260 : 165,
      color,
      life: 0.25,
      maxLife: 0.25
    });

    combat.particles.push({
      type: 'ring',
      x, y,
      radius: 12,
      maxRadius: isHeavy ? 140 : 75,
      color,
      life: 0.3,
      maxLife: 0.3
    });

    const sparkCount = isHeavy ? 26 : 12;
    for (let i = 0; i < sparkCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (isHeavy ? 180 : 110) + Math.random() * 240;
      combat.particles.push({
        type: 'spark',
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: isHeavy ? 5 : 3.5,
        color: i % 2 === 0 ? color : '#ffffff',
        life: 0.35 + Math.random() * 0.2,
        maxLife: 0.55
      });
    }
  }

  function playerAttack(isSkill = false) {
    if (combat.enemy.hp <= 0) return;

    const playerCP = getPlayerCombatPower();
    let dmg = Math.max(12, Math.floor(playerCP * (0.22 + Math.random() * 0.08)));
    let isCrit = Math.random() < Math.min(0.45, hero.stats.agi * 0.015);
    const skillInfo = getSkillTierInfo();

    if (isSkill) {
      if (!combat.ultimateReady) return;
      dmg = Math.floor(dmg * skillInfo.mult);
      combat.ultimateReady = false;
      combat.playerStamina = 0;
      combat.skillCutinTimer = 0.75;
      combat.skillCutinName = skillInfo.name;
      playAnimeSFX('skill');
      spawnAnimeSlashVFX(canvas.width * 0.72, canvas.height * 0.56, skillInfo.color, true);
    } else {
      if (isCrit) {
        dmg = Math.floor(dmg * 1.9);
        playAnimeSFX('crit');
        spawnAnimeSlashVFX(canvas.width * 0.72, canvas.height * 0.58, '#facc15', true);
      } else {
        playAnimeSFX('slash');
        spawnAnimeSlashVFX(canvas.width * 0.72, canvas.height * 0.60, '#38bdf8', false);
      }
      combat.playerStamina = Math.min(100, combat.playerStamina + 25);
      if (combat.playerStamina >= 100) combat.ultimateReady = true;
    }

    combat.heroAnimState = 'attack';
    combat.heroAnimTimer = 0.36;
    combat.heroFrame = 0;
    combat.afterimages.push({ x: canvas.width * 0.30, y: canvas.height * 0.60, alpha: 0.65 });
    combat.afterimages.push({ x: canvas.width * 0.44, y: canvas.height * 0.60, alpha: 0.4 });

    combat.enemy.hp = Math.max(0, combat.enemy.hp - dmg);
    combat.floatingTexts.push({
      x: canvas.width * 0.72 + (Math.random() * 40 - 20),
      y: canvas.height * 0.46,
      text: isSkill ? `⚡ -${dmg.toLocaleString()}!` : (isCrit ? `💥 CRIT -${dmg.toLocaleString()}!` : `-${dmg.toLocaleString()}`),
      color: isSkill ? skillInfo.color : (isCrit ? '#facc15' : '#ffffff'),
      life: 1.0,
      scale: isSkill || isCrit ? 1.45 : 1.0
    });

    updateHUD();
    updateBattleBars();

    if (combat.enemy.hp <= 0) {
      onEnemyDefeated();
    }
  }

  function onEnemyDefeated() {
    const expGain = getFloorExpReward(hero.towerFloor, combat.enemy.isBoss);
    hero.stats.exp += expGain;
    hero.towerFloor += 1;

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

    if (leveledUp) {
      playAnimeSFX('levelup');
      combat.floatingTexts.push({
        x: canvas.width * 0.32,
        y: canvas.height * 0.35,
        text: `🌟 LEVEL UP! Lv.${hero.stats.level} (+ALL STATS)`,
        color: '#4ade80',
        life: 1.6,
        scale: 1.4
      });
    } else {
      combat.floatingTexts.push({
        x: canvas.width * 0.5,
        y: canvas.height * 0.35,
        text: `+${expGain.toLocaleString()} EXP${isWeekendClient() ? ' (2X!)' : ''}`,
        color: '#38bdf8',
        life: 1.1,
        scale: 1.1
      });
    }

    queueSave();
    updateHUD();
    setTimeout(spawnFloorEnemy, 450);
  }

  function toggleAutoBattle() {
    combat.autoBattle = !combat.autoBattle;
    const btn = document.getElementById('btn-auto');
    btn.innerText = combat.autoBattle ? '🔄 Auto: ON' : '🔄 Auto: OFF';
    btn.style.background = combat.autoBattle ? '#10b981' : '#334155';
    btn.style.color = combat.autoBattle ? '#000' : '#fff';
  }

  function openSummonModal() {
    document.getElementById('modal-summon').classList.remove('hidden');
    document.getElementById('summon-points-display').innerText = hero.unspentPoints;
    document.getElementById('pity-epic').innerText = `${hero.avatar.pityEpic || 0}/10`;
    document.getElementById('pity-leg').innerText = `${hero.avatar.pityLeg || 0}/25`;
    document.getElementById('pity-secret').innerText = `${hero.avatar.pitySecret || 0}/50`;
    document.getElementById('pity-divine').innerText = `${hero.avatar.pityDivine || 0}/100`;

    const weekendNotice = document.getElementById('summon-weekend-notice');
    if (weekendNotice) {
      if (isWeekendClient()) {
        weekendNotice.classList.remove('hidden');
      } else {
        weekendNotice.classList.add('hidden');
      }
    }
    renderCollection();
  }

  async function rollGacha(count) {
    const cost = count === 5 ? 22 : 5;
    if (hero.unspentPoints < cost) return alert(`Not enough Class Points! Need ★ ${cost} Pts.`);

    const now = Date.now();
    if (now - lastGachaRequestTime < 1500) {
      return showToast("Please wait a moment before summoning again.", "#f59e0b");
    }
    lastGachaRequestTime = now;

    showToast("Summoning heroes...", "#7e22ce");
    try {
      const json = await apiPost({
        action: 'rollGacha',
        token: sessionToken,
        studentId: hero.studentId,
        count
      });
      hideToast();

      hero.avatar = Object.assign(hero.avatar, json.data.avatar || {});
      hero.unspentPoints = Number(json.data.unspentPoints) || 0;
      playAnimeSFX('levelup');

      const resultsEl = document.getElementById('summon-results');
      resultsEl.innerHTML = json.data.pullResults.map(r => `<div>✨ ${escHtml(r)}</div>`).join('');

      document.getElementById('summon-points-display').innerText = hero.unspentPoints;
      document.getElementById('pity-epic').innerText = `${hero.avatar.pityEpic || 0}/10`;
      document.getElementById('pity-leg').innerText = `${hero.avatar.pityLeg || 0}/25`;
      document.getElementById('pity-secret').innerText = `${hero.avatar.pitySecret || 0}/50`;
      document.getElementById('pity-divine').innerText = `${hero.avatar.pityDivine || 0}/100`;

      renderCollection();
      updateHUD();
    } catch (err) {
      hideToast();
      alert("Summon Error: " + err.message);
    }
  }

  function renderCollection() {
    const grid = document.getElementById('collection-grid');
    if (gachaPool.length === 0) {
      grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:#94a3b8;">No heroes uploaded by teacher yet.</p>`;
      return;
    }

    grid.innerHTML = gachaPool.map(char => {
      const unlocked = (hero.avatar.unlockedChars || []).find(u => u.id === char.assetId);
      const isEquipped = hero.avatar.equippedChar === char.assetId;
      const cfg = rarityConfig[char.rarity] || rarityConfig.Common;
      const cols = Math.max(1, char.meta?.cols || 1);
      const rows = Math.max(1, char.meta?.rows || 1);
      const bgSize = rows > 1 ? `${cols * 100}% ${rows * 128}%` : `${cols * 100}% 100%`;
      const bgPos = rows > 1 ? '0% 6%' : '0% 0%';

      return `
        <div class="char-card ${unlocked ? '' : 'locked'} ${isEquipped ? 'equipped' : ''}"
             style="border-color:${isEquipped ? '#eab308' : cfg.color};"
             onclick="${unlocked ? `equipCharacter('${escHtml(char.assetId)}')` : ''}">
          <div class="rarity-tag" style="background:${cfg.color}; color:#000;">${cfg.badge}</div>
          <div style="width:64px; height:64px; margin:6px auto; background-image:url(${escHtml(char.imageData)}); background-size:${bgSize}; background-position:${bgPos}; background-repeat:no-repeat; image-rendering:pixelated;"></div>
          <div style="font-weight:800; font-size:12px;">${escHtml(char.name)}</div>
          <div style="font-size:11px; color:#facc15;">${unlocked ? `★ ${unlocked.stars || 1}` : '🔒 LOCKED'}</div>
        </div>
      `;
    }).join('');
  }

  function equipCharacter(assetId) {
    hero.avatar.equippedChar = assetId;
    renderCollection();
    updateHUD();
    queueSave();
  }

  function openEquipModal() {
    document.getElementById('modal-equip').classList.remove('hidden');
    renderEquipScreen();
  }

  function renderEquipScreen() {
    const slots = ['head', 'armor', 'boots', 'weapon', 'accessory'];
    const labels = { head: '👑 Head', armor: '🛡️ Armor', boots: '👢 Boots', weapon: '⚔️ Weapon', accessory: '🔮 Accessory' };
    document.getElementById('equip-slots-ui').innerHTML = slots.map(slot => {
      const item = hero.equipped[slot];
      return `
        <div style="background:#1e293b; border:1px solid #334155; padding:10px; border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:11px; color:#94a3b8;">${labels[slot]}</div>
            <div style="font-weight:800; color:${item ? '#f8fafc' : '#64748b'};">${item ? `${escHtml(item.icon)} ${escHtml(item.name)} (+${Number(item.power) || 0} PWR)` : 'Empty Slot'}</div>
          </div>
          ${item ? `<button class="btn-outline" style="padding:4px 8px; font-size:11px;" onclick="unequipSlot('${slot}')">Unequip</button>` : ''}
        </div>
      `;
    }).join('');

    const bagEl = document.getElementById('inventory-list-ui');
    if (hero.inventory.length === 0) {
      bagEl.innerHTML = `<p style="color:#94a3b8; font-size:12px;">Defeat Tower enemies to drop equipment!</p>`;
      return;
    }

    bagEl.innerHTML = hero.inventory.map((item, idx) => `
      <div style="background:#1e293b; border:1px solid #334155; padding:8px 10px; border-radius:8px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span style="font-weight:800; font-size:12px;">${escHtml(item.icon)} ${escHtml(item.name)}</span>
          <span style="font-size:11px; color:#4ade80; margin-left:6px;">+${Number(item.power) || 0} PWR</span>
        </div>
        <button class="btn-gold" style="padding:4px 10px; font-size:11px;" onclick="equipFromBag(${idx})">Equip</button>
      </div>
    `).join('');
  }

  function equipFromBag(idx) {
    const item = hero.inventory[idx];
    if (!item) return;
    hero.equipped[item.slot] = item;
    renderEquipScreen();
    updateHUD();
    queueSave();
  }

  function unequipSlot(slot) {
    hero.equipped[slot] = null;
    renderEquipScreen();
    updateHUD();
    queueSave();
  }

  function getPvpNetScore(wins, losses) {
    return ((Number(wins) || 0) * 10) - ((Number(losses) || 0) * 6);
  }

  function clearPvpActionTimers() {
    pvpActionTimers.forEach(t => clearTimeout(t));
    pvpActionTimers = [];
  }

  function openPvpModal() {
    document.getElementById('modal-pvp').classList.remove('hidden');
    pvpBattle = null;
    clearPvpActionTimers();
    document.getElementById('pvp-lobby-shell').classList.remove('hidden');
    document.getElementById('pvp-view-battle').classList.add('hidden');
    switchPvpTab('lobby');
    loadPvpLobby();
  }

  function closePvpModal() {
    if (pvpBattle && pvpBattle.mode === 'guild' && !pvpBattle.finished) {
      if (!confirm("⚠️ WARNING: Leaving an active Guild Battle counts as an immediate DEFEAT and steals Guild War Points! Are you sure you want to forfeit?")) {
        return;
      }
      finishGuildBattle(false);
      return;
    }
    pvpBattle = null;
    clearPvpActionTimers();
    document.getElementById('modal-pvp').classList.add('hidden');
    refreshActiveLeaderboard();
  }

  function switchPvpTab(tab) {
    document.getElementById('pvp-view-lobby').classList.toggle('hidden', tab !== 'lobby');
    document.getElementById('pvp-view-squad').classList.toggle('hidden', tab !== 'squad');
    document.getElementById('tab-pvp-lobby').style.background = tab === 'lobby' ? '#9333ea' : '#334155';
    document.getElementById('tab-pvp-squad').style.background = tab === 'squad' ? '#9333ea' : '#334155';
    if (tab === 'squad') renderPvpSquadBuilder();
  }

  async function loadPvpLobby() {
    const listEl = document.getElementById('pvp-opponents-list');
    listEl.innerHTML = `<div style="text-align:center; padding:24px; color:#94a3b8;">Loading Arena Fighters...</div>`;

    try {
      const json = await apiPost({ action: 'getPvpData', studentId: hero.studentId });
      pvpPlayersCache = json.data.leaderboard || [];
      hero.avatar.pvpWins = json.data.myPvpWins || 0;
      hero.avatar.pvpLosses = json.data.myPvpLosses || 0;
      hero.avatar.pvpPoints = json.data.myPvpPoints ?? 1000;
      if (Array.isArray(json.data.defeatedOpponents)) {
        hero.avatar.defeatedOpponents = json.data.defeatedOpponents.map(String);
      }

      const defeatedSet = new Set((hero.avatar.defeatedOpponents || []).map(String));
      const myNet = getPvpNetScore(hero.avatar.pvpWins, hero.avatar.pvpLosses);
      const myNetStr = myNet >= 0 ? `+${myNet}` : `${myNet}`;

      document.getElementById('pvp-my-record').innerText = `${hero.avatar.pvpWins}W - ${hero.avatar.pvpLosses}L (${myNetStr} Net Pts)`;
      document.getElementById('pvp-my-cp').innerText = `3v3 Team CP: ${getMyPvpTeamCP().toLocaleString()}`;

      if (pvpPlayersCache.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:24px; color:#94a3b8;">No fighters registered in the Arena yet. Summon a hero to enter!</div>`;
        return;
      }

      listEl.innerHTML = pvpPlayersCache.map((p, idx) => {
        const isMe = String(p.studentId) === String(hero.studentId);
        const alreadyDefeated = !isMe && defeatedSet.has(String(p.studentId));
        const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const pNet = getPvpNetScore(p.wins, p.losses);
        const pNetStr = pNet >= 0 ? `+${pNet}` : `${pNet}`;
        const pNetColor = pNet >= 0 ? '#4ade80' : '#f87171';

        const squadThumbs = (p.squad || []).map(s => {
          const asset = gachaPool.find(a => a.assetId === s.assetId);
          const cols = Math.max(1, asset?.meta?.cols || 1);
          const rows = Math.max(1, asset?.meta?.rows || 1);
          const bgSize = rows > 1 ? `${cols * 100}% ${rows * 128}%` : `${cols * 100}% 100%`;
          const bgPos = rows > 1 ? '0% 6%' : '0% 0%';
          return `
            <div style="text-align:center;">
              <div style="width:40px; height:40px; border-radius:8px; border:1px solid ${rarityConfig[s.rarity]?.color || '#475569'}; background:#0f172a; background-image:url(${escHtml(asset?.imageData || '')}); background-size:${bgSize}; background-position:${bgPos}; background-repeat:no-repeat; image-rendering:pixelated;"></div>
              <div style="font-size:9px; color:#facc15;">★${Number(s.stars) || 1}</div>
            </div>
          `;
        }).join('');

        let actionHtml = '';
        if (isMe) {
          actionHtml = `<span style="font-size:11px; color:#a855f7; font-weight:800;">YOUR SQUAD</span>`;
        } else if (alreadyDefeated) {
          actionHtml = `<button disabled style="padding:7px 12px; font-size:11px; border-radius:8px; border:1px solid #166534; background:#14532d; color:#86efac; font-weight:800; cursor:not-allowed; opacity:0.85;">✓ DEFEATED TODAY</button>`;
        } else {
          actionHtml = `<button class="btn-gold" style="padding:8px 14px; font-size:12px;" onclick="startPvpBattle('${escHtml(p.studentId)}')">⚔️ BATTLE</button>`;
        }

        return `
          <div style="display:flex; justify-content:space-between; align-items:center; background:${isMe ? 'rgba(147,51,234,0.18)' : (alreadyDefeated ? 'rgba(20,83,45,0.22)' : '#1e293b')}; border:1px solid ${isMe ? '#9333ea' : (alreadyDefeated ? '#166534' : '#334155')}; padding:10px 12px; border-radius:12px; margin-bottom:8px; gap:10px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:800; font-size:14px; color:#f8fafc;">${rankBadge} ${escHtml(p.name)} <span style="font-size:11px; color:#38bdf8;">[${escHtml(p.className)}]</span></div>
              <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
                Net Score: <strong style="color:${pNetColor};">${pNetStr} Pts</strong> • ${Number(p.wins) || 0}W / ${Number(p.losses) || 0}L • CP: <strong style="color:#eab308;">${Number(p.teamCP || 0).toLocaleString()}</strong>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              ${squadThumbs}
            </div>
            <div>
              ${actionHtml}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      listEl.innerHTML = `<div style="color:#f87171; text-align:center; padding:20px;">Failed to load Arena: ${escHtml(err.message)}</div>`;
    }
  }

  function getActivePvpSquadIds() {
    const ownedIds = (hero.avatar.unlockedChars || []).map(u => u.id);
    const saved = (hero.avatar.pvpSquad || []).filter(id => ownedIds.includes(id));
    if (saved.length > 0) return saved.slice(0, 3);
    return ownedIds.slice(0, 3);
  }

  function getMyPvpTeamCP() {
    const ids = getActivePvpSquadIds();
    const eqBonus = getEquipPowerBonus();
    const base = (hero.stats.str * 15) + (hero.stats.agi * 12) + (hero.stats.vit * 12) + (hero.stats.int * 15) + (eqBonus * 10);
    return ids.reduce((sum, id) => {
      const asset = gachaPool.find(a => a.assetId === id);
      const u = (hero.avatar.unlockedChars || []).find(x => x.id === id);
      const mult = asset ? (rarityConfig[asset.rarity]?.mult || 1) : 1;
      const starMult = u ? (1 + ((u.stars || 1) - 1) * 0.1) : 1;
      return sum + Math.floor(base * mult * starMult);
    }, 0);
  }

  function renderPvpSquadBuilder() {
    if (pvpSquadDraft.length === 0) pvpSquadDraft = [...getActivePvpSquadIds()];

    const slotsEl = document.getElementById('pvp-selected-slots');
    slotsEl.innerHTML = [0, 1, 2].map(i => {
      const id = pvpSquadDraft[i];
      const asset = gachaPool.find(a => a.assetId === id);
      if (!asset) {
        return `<div style="width:90px; height:105px; border:2px dashed #475569; border-radius:10px; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:11px;">Slot ${i + 1}</div>`;
      }
      const cols = Math.max(1, asset.meta?.cols || 1);
      const rows = Math.max(1, asset.meta?.rows || 1);
      const bgSize = rows > 1 ? `${cols * 100}% ${rows * 128}%` : `${cols * 100}% 100%`;
      const bgPos = rows > 1 ? '0% 6%' : '0% 0%';
      return `
        <div onclick="togglePvpDraftHero('${escHtml(id)}')" style="width:90px; height:105px; border:2px solid #eab308; background:#1e293b; border-radius:10px; text-align:center; padding:6px; cursor:pointer;">
          <div style="font-size:10px; color:#eab308; font-weight:800;">#${i + 1}</div>
          <div style="width:48px; height:48px; margin:2px auto; background-image:url(${escHtml(asset.imageData)}); background-size:${bgSize}; background-position:${bgPos}; background-repeat:no-repeat; image-rendering:pixelated;"></div>
          <div style="font-size:10px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(asset.name)}</div>
        </div>
      `;
    }).join('');

    const owned = hero.avatar.unlockedChars || [];
    const rosterEl = document.getElementById('pvp-squad-roster');
    if (owned.length === 0) {
      rosterEl.innerHTML = `<p style="grid-column:1/-1; color:#94a3b8; text-align:center;">Summon characters first!</p>`;
      return;
    }

    rosterEl.innerHTML = owned.map(u => {
      const asset = gachaPool.find(a => a.assetId === u.id);
      if (!asset) return '';
      const selectedIdx = pvpSquadDraft.indexOf(u.id);
      const cfg = rarityConfig[asset.rarity] || rarityConfig.Common;
      const cols = Math.max(1, asset.meta?.cols || 1);
      const rows = Math.max(1, asset.meta?.rows || 1);
      const bgSize = rows > 1 ? `${cols * 100}% ${rows * 128}%` : `${cols * 100}% 100%`;
      const bgPos = rows > 1 ? '0% 6%' : '0% 0%';

      return `
        <div class="char-card ${selectedIdx !== -1 ? 'equipped' : ''}" style="border-color:${selectedIdx !== -1 ? '#eab308' : cfg.color};" onclick="togglePvpDraftHero('${escHtml(u.id)}')">
          <div class="rarity-tag" style="background:${cfg.color}; color:#000;">${selectedIdx !== -1 ? `IN SQUAD #${selectedIdx + 1}` : cfg.badge}</div>
          <div style="width:56px; height:56px; margin:4px auto; background-image:url(${escHtml(asset.imageData)}); background-size:${bgSize}; background-position:${bgPos}; background-repeat:no-repeat; image-rendering:pixelated;"></div>
          <div style="font-weight:800; font-size:11px;">${escHtml(asset.name)}</div>
          <div style="font-size:10px; color:#facc15;">★ ${u.stars || 1}</div>
        </div>
      `;
    }).join('');
  }

  function togglePvpDraftHero(assetId) {
    const idx = pvpSquadDraft.indexOf(assetId);
    if (idx !== -1) {
      pvpSquadDraft.splice(idx, 1);
    } else {
      if (pvpSquadDraft.length >= 3) return alert("Your 3v3 Squad is full! Click a selected hero to remove them first.");
      pvpSquadDraft.push(assetId);
    }
    renderPvpSquadBuilder();
  }

  async function savePvpSquad() {
    if (pvpSquadDraft.length === 0) return alert("Select at least 1 hero for your PvP squad.");
    showToast("Saving 3v3 Squad...", "#7e22ce");
    try {
      const json = await apiPost({
        action: 'savePvpSquad',
        token: sessionToken,
        studentId: hero.studentId,
        squad: pvpSquadDraft
      });
      hero.avatar.pvpSquad = json.data.pvpSquad;
      showToast("3v3 Squad Saved!", "#10b981");
      setTimeout(hideToast, 1800);
      switchPvpTab('lobby');
      loadPvpLobby();
    } catch (err) {
      hideToast();
      alert("Save Error: " + err.message);
    }
  }

  function buildMyPvpTeam() {
    const ids = getActivePvpSquadIds();
    const eqBonus = getEquipPowerBonus();
    const base = (hero.stats.str * 15) + (hero.stats.agi * 12) + (hero.stats.vit * 12) + (hero.stats.int * 15) + (eqBonus * 10);

    return ids.map(id => {
      const asset = gachaPool.find(a => a.assetId === id);
      const u = (hero.avatar.unlockedChars || []).find(x => x.id === id);
      const rarity = asset?.rarity || 'Common';
      const stars = u?.stars || 1;
      const mult = (rarityConfig[rarity]?.mult || 1) + ((stars - 1) * 0.1);
      const cp = Math.max(100, Math.floor(base * mult));
      return {
        assetId: id,
        name: asset?.name || 'Hero',
        rarity,
        stars,
        cp,
        maxHp: Math.floor(cp * 1.6),
        hp: Math.floor(cp * 1.6),
        atk: Math.max(15, Math.floor(cp * 0.24)),
        stamina: 50
      };
    });
  }

  function hydrateServerSquad(serverSquad) {
    return (serverSquad || []).map(s => {
      const cp = Math.max(100, Number(s.cp) || 150);
      return {
        assetId: s.assetId,
        name: s.name || 'Fighter',
        rarity: s.rarity || 'Common',
        stars: s.stars || 1,
        cp,
        maxHp: Math.floor(cp * 1.6),
        hp: Math.floor(cp * 1.6),
        atk: Math.max(15, Math.floor(cp * 0.24)),
        stamina: 50
      };
    });
  }

  async function startPvpBattle(opponentId) {
    const defeatedSet = new Set((hero.avatar.defeatedOpponents || []).map(String));
    if (defeatedSet.has(String(opponentId))) {
      return alert("You already defeated this challenger today! Come back tomorrow for the daily reset.");
    }

    const opp = pvpPlayersCache.find(p => String(p.studentId) === String(opponentId));
    if (!opp) return;

    const myTeam = buildMyPvpTeam();
    if (myTeam.length === 0) return alert("You need at least 1 unlocked hero!");

    showToast("⚔️ Entering 3v3 PvP Arena...", "#7e22ce");
    let matchId = '';
    try {
      const startRes = await apiPost({
        action: 'startPvpMatch',
        token: sessionToken,
        studentId: hero.studentId,
        opponentId: opp.studentId
      });
      matchId = startRes.data.matchId;
      hideToast();
    } catch (err) {
      hideToast();
      return alert("PvP Match Error: " + err.message);
    }

    const oppTeam = hydrateServerSquad(opp.squad);

    clearPvpActionTimers();
    pvpBattle = {
      mode: 'pvp',
      matchId,
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

  function triggerPvpFighterAnim(side, type, dmgText, color) {
    const spriteEl = document.getElementById(side === 'my' ? 'pvp-b-mysprite' : 'pvp-b-oppsprite');
    const fxEl = document.getElementById(side === 'my' ? 'pvp-b-myfx' : 'pvp-b-oppfx');
    if (spriteEl) {
      spriteEl.classList.remove('pvp-lunge-right', 'pvp-lunge-left', 'pvp-hit-shake');
      void spriteEl.offsetWidth;
      if (type === 'attack') {
        spriteEl.classList.add(side === 'my' ? 'pvp-lunge-right' : 'pvp-lunge-left');
      } else if (type === 'hit') {
        spriteEl.classList.add('pvp-hit-shake');
      }
    }
    if (fxEl && dmgText) {
      fxEl.innerText = dmgText;
      fxEl.style.color = color || '#fff';
      fxEl.classList.remove('pvp-dmg-pop');
      void fxEl.offsetWidth;
      fxEl.classList.add('pvp-dmg-pop');
    }
  }

  function renderPvpBattleUI() {
    if (!pvpBattle) return;
    const myHero = pvpBattle.myTeam[pvpBattle.myActiveIdx];
    const oppHero = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];

    document.getElementById('pvp-b-myteam-icons').innerHTML = pvpBattle.myTeam.map((h, i) => `
      <span style="padding:2px 6px; border-radius:6px; font-size:10px; font-weight:800; background:${h.hp > 0 ? (i === pvpBattle.myActiveIdx ? '#eab308' : '#1e293b') : '#450a0a'}; color:${h.hp > 0 ? (i === pvpBattle.myActiveIdx ? '#000' : '#f8fafc') : '#f87171'};">
        ${escHtml(h.name)} ${h.hp > 0 ? '' : '💀'}
      </span>
    `).join('');

    document.getElementById('pvp-b-oppteam-icons').innerHTML = pvpBattle.oppTeam.map((h, i) => `
      <span style="padding:2px 6px; border-radius:6px; font-size:10px; font-weight:800; background:${h.hp > 0 ? (i === pvpBattle.oppActiveIdx ? '#ef4444' : '#1e293b') : '#450a0a'}; color:${h.hp > 0 ? '#fff' : '#f87171'};">
        ${escHtml(h.name)} ${h.hp > 0 ? '' : '💀'}
      </span>
    `).join('');

    document.getElementById('pvp-b-myhero').innerText = `${myHero.name} ★${myHero.stars}`;
    document.getElementById('pvp-b-myhp-text').innerText = `${myHero.hp} / ${myHero.maxHp} HP`;
    document.getElementById('pvp-b-myhp-bar').style.width = `${Math.max(0, (myHero.hp / myHero.maxHp) * 100)}%`;

    document.getElementById('pvp-b-opphero').innerText = `${oppHero.name} ★${oppHero.stars}`;
    document.getElementById('pvp-b-opphp-text').innerText = `${oppHero.hp} / ${oppHero.maxHp} HP`;
    document.getElementById('pvp-b-opphp-bar').style.width = `${Math.max(0, (oppHero.hp / oppHero.maxHp) * 100)}%`;

    const myAsset = gachaPool.find(a => a.assetId === myHero.assetId);
    const oppAsset = gachaPool.find(a => a.assetId === oppHero.assetId);
    applySpriteToDiv('pvp-b-mysprite', myAsset, pvpBattle.myActing);
    applySpriteToDiv('pvp-b-oppsprite', oppAsset, pvpBattle.oppActing);

    const canAct = pvpBattle.turn === 'player' && !pvpBattle.finished;
    document.getElementById('pvp-btn-atk').disabled = !canAct;
    const skillBtn = document.getElementById('pvp-btn-skill');
    skillBtn.disabled = !canAct || myHero.stamina < 100;
    skillBtn.innerText = `⚡ ULTIMATE (${myHero.stamina}%)`;
    skillBtn.style.background = myHero.stamina >= 100 ? '#eab308' : '#334155';
    skillBtn.style.color = myHero.stamina >= 100 ? '#000' : '#fff';
  }

  function applySpriteToDiv(elId, asset, isActing = false) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!asset) {
      el.style.backgroundImage = 'none';
      el.innerText = '🛡️';
      el.style.fontSize = '54px';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      return;
    }
    el.innerText = '';
    const cols = Math.max(1, asset.meta?.cols || 1);
    const rows = Math.max(1, asset.meta?.rows || 1);
    el.style.backgroundImage = `url(${asset.imageData})`;
    el.style.backgroundSize = rows > 1 ? `${cols * 100}% ${rows * 128}%` : `${cols * 100}% 100%`;
    if (rows > 1) {
      const targetRow = isActing && rows >= 3 ? 2 : 0;
      const yPct = rows > 1 ? (targetRow / (rows - 1)) * 90 + 4 : 6;
      const xPct = isActing && cols > 1 ? 50 : 0;
      el.style.backgroundPosition = `${xPct}% ${yPct}%`;
    } else {
      el.style.backgroundPosition = isActing && cols > 1 ? '50% 0%' : '0% 0%';
    }
  }

  function pvpExecuteMove(isSkill) {
    if (!pvpBattle || pvpBattle.turn !== 'player' || pvpBattle.finished) return;

    const myHero = pvpBattle.myTeam[pvpBattle.myActiveIdx];
    const oppHero = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];

    if (isSkill && myHero.stamina < 100) return;

    pvpBattle.turn = 'busy';
    pvpBattle.myActing = true;
    renderPvpBattleUI();

    let dmg = Math.floor(myHero.atk * (0.9 + Math.random() * 0.25));
    if (isSkill) {
      dmg = Math.floor(dmg * 2.4);
      myHero.stamina = 0;
      playAnimeSFX('skill');
      triggerPvpFighterAnim('my', 'attack');
      triggerPvpFighterAnim('opp', 'hit', `⚡ -${dmg}!`, '#facc15');
      document.getElementById('pvp-battle-log').innerHTML = `⚡ <strong style="color:#facc15;">${escHtml(myHero.name)}</strong> unleashes ULTIMATE on ${escHtml(oppHero.name)} for <strong>-${dmg}</strong>!`;
    } else {
      myHero.stamina = Math.min(100, myHero.stamina + 50);
      playAnimeSFX('slash');
      triggerPvpFighterAnim('my', 'attack');
      triggerPvpFighterAnim('opp', 'hit', `-${dmg}`, '#38bdf8');
      document.getElementById('pvp-battle-log').innerHTML = `⚔️ <strong style="color:#38bdf8;">${escHtml(myHero.name)}</strong> strikes ${escHtml(oppHero.name)} for <strong>-${dmg}</strong>!`;
    }

    oppHero.hp = Math.max(0, oppHero.hp - dmg);

    pvpActionTimers.push(setTimeout(() => {
      if (!pvpBattle) return;
      pvpBattle.myActing = false;
      renderPvpBattleUI();
    }, 420));

    if (oppHero.hp <= 0) {
      const nextOppIdx = pvpBattle.oppTeam.findIndex(h => h.hp > 0);
      if (nextOppIdx === -1) {
        if (pvpBattle.mode === 'guild') finishGuildBattle(true);
        else finishPvpBattle(true);
        return;
      } else {
        pvpBattle.oppActiveIdx = nextOppIdx;
        pvpActionTimers.push(setTimeout(() => {
          if (!pvpBattle || pvpBattle.finished) return;
          document.getElementById('pvp-battle-log').innerText = `💀 ${oppHero.name} fell! ${pvpBattle.oppTeam[nextOppIdx].name} enters the arena!`;
          renderPvpBattleUI();
        }, 550));
      }
    }

    pvpActionTimers.push(setTimeout(pvpEnemyTurn, 950));
  }

  function pvpEnemyTurn() {
    if (!pvpBattle || pvpBattle.finished) return;
    const myHero = pvpBattle.myTeam[pvpBattle.myActiveIdx];
    const oppHero = pvpBattle.oppTeam[pvpBattle.oppActiveIdx];

    pvpBattle.oppActing = true;
    renderPvpBattleUI();

    const useSkill = oppHero.stamina >= 100;
    let dmg = Math.floor(oppHero.atk * (0.9 + Math.random() * 0.25));
    if (useSkill) {
      dmg = Math.floor(dmg * 2.2);
      oppHero.stamina = 0;
      playAnimeSFX('skill');
      triggerPvpFighterAnim('opp', 'attack');
      triggerPvpFighterAnim('my', 'hit', `💥 -${dmg}!`, '#f87171');
      document.getElementById('pvp-battle-log').innerHTML = `🔥 Enemy <strong style="color:#f87171;">${escHtml(oppHero.name)}</strong> uses ULTIMATE for <strong>-${dmg}</strong>!`;
    } else {
      oppHero.stamina = Math.min(100, oppHero.stamina + 50);
      playAnimeSFX('slash');
      triggerPvpFighterAnim('opp', 'attack');
      triggerPvpFighterAnim('my', 'hit', `-${dmg}`, '#fca5a5');
      document.getElementById('pvp-battle-log').innerHTML = `💢 Enemy <strong style="color:#f87171;">${escHtml(oppHero.name)}</strong> attacks ${escHtml(myHero.name)} for <strong>-${dmg}</strong>!`;
    }

    myHero.hp = Math.max(0, myHero.hp - dmg);

    pvpActionTimers.push(setTimeout(() => {
      if (!pvpBattle) return;
      pvpBattle.oppActing = false;
      renderPvpBattleUI();
    }, 420));

    if (myHero.hp <= 0) {
      const nextMyIdx = pvpBattle.myTeam.findIndex(h => h.hp > 0);
      if (nextMyIdx === -1) {
        if (pvpBattle.mode === 'guild') finishGuildBattle(false);
        else finishPvpBattle(false);
        return;
      } else {
        pvpBattle.myActiveIdx = nextMyIdx;
        pvpActionTimers.push(setTimeout(() => {
          if (!pvpBattle || pvpBattle.finished) return;
          document.getElementById('pvp-battle-log').innerText = `💀 ${myHero.name} fell! ${pvpBattle.myTeam[nextMyIdx].name} tags in!`;
          renderPvpBattleUI();
        }, 550));
      }
    }

    pvpBattle.turn = 'player';
    renderPvpBattleUI();
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
      const json = await apiPost({
        action: 'recordPvpResult',
        token: sessionToken,
        studentId: hero.studentId,
        opponentId: pvpBattle.opponentId,
        matchId: pvpBattle.matchId,
        won: won
      });

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

  // ============================================================================
  // GUILD SYSTEM, CUSTOM EMBLEMS, COUNTDOWN & WEEKEND STEAL BATTLES
  // ============================================================================

  function renderEmblemVisual(emblem, sizePx = 36) {
    const val = String(emblem || '🛡️');
    if (val.startsWith('data:image/')) {
      return `<img src="${val}" alt="Guild Emblem" style="width:${sizePx}px; height:${sizePx}px; border-radius:8px; object-fit:cover; border:1px solid #f59e0b; flex-shrink:0;" />`;
    }
    return `<span style="font-size:${Math.floor(sizePx * 0.78)}px; line-height:1; display:inline-flex; align-items:center; justify-content:center; width:${sizePx}px; height:${sizePx}px;">${escHtml(val)}</span>`;
  }

  function processEmblemImageFile(fileInput, targetMode) {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      return alert('Please choose a valid image file (PNG, JPG, WebP).');
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvasTmp = document.createElement('canvas');
        const size = 96;
        canvasTmp.width = size;
        canvasTmp.height = size;
        const c2d = canvasTmp.getContext('2d');
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        c2d.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        const dataUrl = canvasTmp.toDataURL('image/webp', 0.8);
        if (targetMode === 'create') {
          pendingGuildEmblem = dataUrl;
          const prev = document.getElementById('guild-create-emblem-preview');
          if (prev) prev.innerHTML = renderEmblemVisual(dataUrl, 40);
        } else {
          editGuildEmblem = dataUrl;
          const prev = document.getElementById('guild-edit-emblem-preview');
          if (prev) prev.innerHTML = renderEmblemVisual(dataUrl, 40);
        }
        showToast('✅ Guild photo ready!', '#10b981');
        setTimeout(hideToast, 1500);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(totalSec / 86400);
    const hrs = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return days > 0 ? `${days}d ${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s` : `${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`;
  }

  function startGuildWarCountdown(warTiming) {
    if (guildTimerInterval) clearInterval(guildTimerInterval);
    if (!warTiming || !warTiming.targetEpochMs) return;

    const clockOffset = warTiming.serverNowMs ? (warTiming.serverNowMs - Date.now()) : 0;

    const tick = () => {
      const el = document.getElementById('guild-war-timer-text');
      if (!el) return;
      const nowAdjusted = Date.now() + clockOffset;
      const remaining = warTiming.targetEpochMs - nowAdjusted;
      if (remaining <= 0) {
        el.innerText = '00h 00m 00s (Refreshing...)';
        clearInterval(guildTimerInterval);
        loadGuildHub();
        return;
      }
      el.innerText = formatCountdown(remaining);
    };

    tick();
    guildTimerInterval = setInterval(tick, 1000);
  }

  function openGuildModal() {
    document.getElementById('modal-guild').classList.remove('hidden');
    loadGuildHub();
  }

  function closeGuildModal() {
    if (guildTimerInterval) clearInterval(guildTimerInterval);
    document.getElementById('modal-guild').classList.add('hidden');
  }

  async function loadGuildHub() {
    const contentEl = document.getElementById('guild-modal-content');
    const bannerEl = document.getElementById('guild-war-banner');
    contentEl.innerHTML = `<div style="text-align:center; padding:24px; color:#94a3b8;">Loading Guild Hall...</div>`;

    try {
      const json = await apiPost({ action: 'getGuildHub', studentId: hero.studentId });
      guildHubData = json.data;
      hero.avatar.guildId = guildHubData.myGuild ? guildHubData.myGuild.guildId : null;
      if (guildHubData.unspentPoints !== undefined) {
        hero.unspentPoints = Number(guildHubData.unspentPoints) || 0;
        updateHUD();
      }

      if (guildHubData.claimedGuildReward) {
        showToast(`🏆 Guild Rank #${guildHubData.claimedGuildReward.rank} Reward: +${guildHubData.claimedGuildReward.points} Class Pts!`, '#10b981');
        setTimeout(hideToast, 3200);
      }

      const isWeekend = guildHubData.isWeekend;
      const timing = guildHubData.warTiming || {};
      const myWarPts = guildHubData.myWarPts ?? 500;
      const cooldownMs = guildHubData.cooldownRemainingMs || 0;

      if (isWeekend) {
        bannerEl.style.background = 'linear-gradient(90deg, rgba(220,38,38,0.28), rgba(234,179,8,0.22))';
        bannerEl.style.borderColor = '#ef4444';
        bannerEl.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="font-weight:900; font-size:13px; color:#fde047;">🔥 WEEKEND GUILD WAR — BATTLE DAY LIVE!</div>
              <div style="font-size:11px; color:#cbd5e1;">Your Guild War Stash: <strong style="color:#4ade80;">${myWarPts} Pts</strong> • Win steals 25% of target's points!</div>
            </div>
            <div style="text-align:right; background:rgba(15,23,42,0.75); padding:6px 10px; border-radius:8px; border:1px solid #ef4444;">
              <div style="font-size:9px; color:#fca5a5; font-weight:800;">WAR ENDS IN</div>
              <div id="guild-war-timer-text" style="font-size:12px; font-weight:900; color:#facc15;">--:--:--</div>
            </div>
          </div>
        `;
      } else {
        bannerEl.style.background = 'rgba(30,41,59,0.85)';
        bannerEl.style.borderColor = '#38bdf8';
        bannerEl.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="font-weight:800; font-size:12px; color:#38bdf8;">🛡️ PREPARATION DAY — RECRUIT & TRAIN</div>
              <div style="font-size:11px; color:#94a3b8;">Each member starts Saturday with <strong>500 Guild War Points</strong>. Rank #1 wins <strong>+500 Class Pts/member</strong>!</div>
            </div>
            <div style="text-align:right; background:rgba(15,23,42,0.75); padding:6px 10px; border-radius:8px; border:1px solid #38bdf8;">
              <div style="font-size:9px; color:#7dd3fc; font-weight:800;">WAR STARTS IN</div>
              <div id="guild-war-timer-text" style="font-size:12px; font-weight:900; color:#38bdf8;">--:--:--</div>
            </div>
          </div>
        `;
      }

      startGuildWarCountdown(timing);
      renderGuildHubContent(cooldownMs);
    } catch (err) {
      contentEl.innerHTML = `<div style="color:#f87171; text-align:center; padding:20px;">Failed to load Guilds: ${escHtml(err.message)}</div>`;
    }
  }

  function renderGuildHubContent(cooldownMs = 0) {
    const contentEl = document.getElementById('guild-modal-content');
    const { myGuild, guilds = [], isWeekend } = guildHubData;

    let html = '';

    if (cooldownMs > 0 && !myGuild) {
      const minsLeft = Math.ceil(cooldownMs / 60000);
      html += `
        <div style="background:rgba(234,179,8,0.16); border:1px solid #eab308; padding:10px 12px; border-radius:10px; margin-bottom:12px; font-size:12px; color:#fde047;">
          ⏳ <strong>Guild Cooldown Active:</strong> You recently left a guild. You can join or create a new guild in <strong>${minsLeft} minute(s)</strong>.
        </div>
      `;
    }

    if (myGuild) {
      const isOwner = String(myGuild.ownerId) === String(hero.studentId);
      editGuildEmblem = myGuild.emblem || '🛡️';

      html += `
        <div style="background:linear-gradient(135deg, rgba(245,158,11,0.16), rgba(30,41,59,0.92)); border:1px solid #f59e0b; border-radius:12px; padding:14px; margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
            <div style="display:flex; align-items:center; gap:10px;">
              ${renderEmblemVisual(myGuild.emblem, 46)}
              <div>
                <div style="font-size:16px; font-weight:900; color:#fde047;">
                  ${escHtml(myGuild.name)}
                  ${isWeekend && myGuild.rank ? `<span style="font-size:11px; background:#f59e0b; color:#000; padding:2px 7px; border-radius:6px; margin-left:6px;">RANK #${myGuild.rank} (+${myGuild.projectedPayout} Pts)</span>` : ''}
                </div>
                <div style="font-size:12px; color:#cbd5e1; font-style:italic;">"${escHtml(myGuild.motto || 'United we conquer!')}"</div>
                <div style="font-size:11px; color:#94a3b8; margin-top:4px;">
                  Members: <strong>${myGuild.memberCount}/20</strong> • Combined Guild War Pts: <strong style="color:#4ade80;">${Number(myGuild.totalPoints).toLocaleString()}</strong> • Record: <strong>${myGuild.wins}W - ${myGuild.losses}L</strong>
                </div>
              </div>
            </div>
            <div style="display:flex; gap:6px;">
              ${isOwner ? `<button class="btn-outline" style="padding:6px 10px; font-size:11px;" onclick="toggleGuildEditForm()">✏️ Edit</button>` : ''}
              <button style="background:#7f1d1d; color:#fecaca; border:1px solid #ef4444; padding:6px 10px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;" onclick="leaveCurrentGuild()">🚪 Leave</button>
            </div>
          </div>

          ${isOwner ? `
            <div id="guild-edit-box" class="hidden" style="margin-top:12px; padding-top:12px; border-top:1px solid #334155;">
              <div style="font-size:11px; font-weight:800; color:#f59e0b; margin-bottom:6px;">EDIT GUILD PROFILE & PHOTO</div>
              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                <input id="edit-guild-name" value="${escHtml(myGuild.name)}" maxlength="28" style="flex:1; min-width:150px; padding:8px; border-radius:8px; border:1px solid #475569; background:#0f172a; color:#fff;" placeholder="Guild Name" />
                <input id="edit-guild-motto" value="${escHtml(myGuild.motto || '')}" maxlength="80" style="flex:2; min-width:180px; padding:8px; border-radius:8px; border:1px solid #475569; background:#0f172a; color:#fff;" placeholder="Guild Motto" />
              </div>
              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <div id="guild-edit-emblem-preview">${renderEmblemVisual(myGuild.emblem, 38)}</div>
                  <label style="background:#334155; color:#fff; padding:6px 10px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;">
                    📷 Upload Guild Photo
                    <input type="file" accept="image/*" style="display:none;" onchange="processEmblemImageFile(this, 'edit')" />
                  </label>
                </div>
                <button class="btn-gold" style="padding:7px 14px; font-size:12px;" onclick="saveGuildProfileEdit()">Save Changes</button>
              </div>
            </div>
          ` : ''}

          ${isOwner && (myGuild.pendingDetails || []).length > 0 ? `
            <div style="margin-top:12px; padding-top:10px; border-top:1px solid #334155;">
              <div style="font-size:11px; font-weight:800; color:#38bdf8; margin-bottom:6px;">📩 JOIN REQUESTS (${myGuild.pendingDetails.length})</div>
              ${myGuild.pendingDetails.map(req => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:8px 10px; border-radius:8px; margin-bottom:6px;">
                  <div style="font-size:12px;"><strong>${escHtml(req.name)}</strong> <span style="color:#94a3b8;">[${escHtml(req.className)} • CP ${Number(req.cp || 0).toLocaleString()}]</span></div>
                  <div style="display:flex; gap:6px;">
                    <button class="btn-gold" style="padding:4px 10px; font-size:11px;" onclick="respondGuildRequest('${escHtml(req.studentId)}', true)">✓ Accept</button>
                    <button class="btn-outline" style="padding:4px 10px; font-size:11px;" onclick="respondGuildRequest('${escHtml(req.studentId)}', false)">✕ Decline</button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <div style="margin-top:12px; padding-top:10px; border-top:1px solid #334155;">
            <div style="font-size:11px; font-weight:800; color:#94a3b8; margin-bottom:6px;">GUILD ROSTER & WAR POINTS</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:6px;">
              ${(myGuild.memberDetails || []).map(m => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:7px 10px; border-radius:8px; font-size:11px;">
                  <div>
                    <div style="font-weight:700;">${m.isOwner ? '👑' : '⚔️'} ${escHtml(m.name)}</div>
                    <div style="color:#4ade80; font-size:10px; font-weight:800;">War Pts: ${m.warPts} ${m.stolenNet >= 0 ? `(+${m.stolenNet})` : `(${m.stolenNet})`}</div>
                  </div>
                  ${isOwner && !m.isOwner ? `<button onclick="kickGuildMember('${escHtml(m.studentId)}', '${escHtml(m.name)}')" style="background:none; border:none; color:#f87171; cursor:pointer; font-size:11px; font-weight:800;">Kick</button>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    } else if (cooldownMs <= 0) {
      const emblems = ['🛡️', '⚔️', '🐉', '🔥', '👑', '⚡', '🐺', '🦅'];
      html += `
        <div style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:14px; margin-bottom:14px;">
          <div style="font-size:13px; font-weight:900; color:#f59e0b; margin-bottom:8px;">🏰 CREATE A NEW GUILD</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
            <input id="new-guild-name" maxlength="28" placeholder="Guild Name (3-28 chars)" style="flex:1; min-width:160px; padding:9px; border-radius:8px; border:1px solid #475569; background:#0f172a; color:#fff;" />
            <input id="new-guild-motto" maxlength="80" placeholder="Guild Motto (e.g. Conquer the Tower!)" style="flex:2; min-width:200px; padding:9px; border-radius:8px; border:1px solid #475569; background:#0f172a; color:#fff;" />
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <div id="guild-create-emblem-preview">${renderEmblemVisual(pendingGuildEmblem, 38)}</div>
              ${emblems.map(em => `
                <button type="button" onclick="selectGuildEmblem('${em}', this)" class="guild-emblem-btn" style="padding:5px 8px; border-radius:8px; border:1px solid ${pendingGuildEmblem === em ? '#f59e0b' : '#475569'}; background:#0f172a; font-size:15px; cursor:pointer;">${em}</button>
              `).join('')}
              <label style="background:#334155; color:#fff; padding:6px 10px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;">
                📷 Upload Photo
                <input type="file" accept="image/*" style="display:none;" onchange="processEmblemImageFile(this, 'create')" />
              </label>
            </div>
            <button class="btn-gold" style="padding:9px 16px;" onclick="createNewGuild()">✨ Create Guild</button>
          </div>
        </div>
      `;
    }

    html += `
      <div style="background:rgba(15,23,42,0.65); border:1px solid #334155; border-radius:10px; padding:10px 12px; margin-bottom:10px; font-size:11px; color:#cbd5e1;">
        🏆 <strong>Weekend Guild War Payouts (Every Member Receives):</strong>
        <span style="color:#facc15; font-weight:800;">#1: +500 Pts</span> •
        <span style="color:#e2e8f0; font-weight:800;">#2: +400 Pts</span> •
        <span style="color:#fdba74; font-weight:800;">#3: +300 Pts</span> •
        <span>#4: +200 Pts</span> •
        <span>#5: +100 Pts</span> •
        <span>#6+: +50 Pts</span>
      </div>
    `;

    html += `<div style="font-size:13px; font-weight:900; color:#f8fafc; margin-bottom:8px;">${isWeekend ? '🔥 WEEKEND GUILD WAR LEADERBOARD & RAID TARGETS' : '🌍 ALL GUILDS (PREPARATION ROSTER)'}</div>`;

    if (guilds.length === 0) {
      html += `<div style="text-align:center; padding:20px; color:#94a3b8;">No guilds founded yet. Be the first to create one!</div>`;
    } else {
      html += guilds.map(g => {
        const isMine = myGuild && myGuild.guildId === g.guildId;
        const rankLabel = isWeekend && g.rank
          ? (g.rank === 1 ? '🥇 #1' : g.rank === 2 ? '🥈 #2' : g.rank === 3 ? '🥉 #3' : `#${g.rank}`)
          : '🛡️';

        let actionBtn = '';
        if (isMine) {
          actionBtn = `<span style="font-size:11px; color:#f59e0b; font-weight:800;">YOUR GUILD</span>`;
        } else if (myGuild && isWeekend) {
          actionBtn = `<button class="btn-gold" style="padding:7px 12px; font-size:11px;" onclick="toggleGuildTargetPicker('${escHtml(g.guildId)}')">⚔️ PICK TARGET</button>`;
        } else if (myGuild && !isWeekend) {
          actionBtn = `<span style="font-size:10px; color:#38bdf8; font-weight:700;">War Opens Sat</span>`;
        } else if (!myGuild && cooldownMs <= 0) {
          if (g.hasRequested) {
            actionBtn = `<span style="font-size:11px; color:#38bdf8; font-weight:800;">⏳ Requested</span>`;
          } else if (g.memberCount >= 20) {
            actionBtn = `<span style="font-size:11px; color:#64748b;">FULL (20/20)</span>`;
          } else {
            actionBtn = `<button class="btn-outline" style="padding:6px 12px; font-size:11px;" onclick="requestJoinGuild('${escHtml(g.guildId)}')">📩 Join</button>`;
          }
        }

        const targetsHtml = (myGuild && isWeekend && !isMine) ? `
          <div id="guild-targets-${escHtml(g.guildId)}" class="hidden" style="margin-top:10px; padding-top:10px; border-top:1px solid #334155;">
            <div style="font-size:11px; font-weight:800; color:#facc15; margin-bottom:6px;">🎯 SELECT A RIVAL PLAYER TO STEAL 25% OF THEIR GUILD WAR POINTS:</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:6px;">
              ${(g.memberDetails || []).map(m => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; border:1px solid ${m.warPts > 0 ? '#475569' : '#7f1d1d'}; padding:7px 10px; border-radius:8px;">
                  <div>
                    <div style="font-size:12px; font-weight:800; color:#f8fafc;">${escHtml(m.name)}</div>
                    <div style="font-size:10px; color:#94a3b8;">CP ${Number(m.cp || 0).toLocaleString()} • War Pts: <strong style="color:${m.warPts > 0 ? '#4ade80' : '#f87171'};">${m.warPts}</strong></div>
                  </div>
                  ${m.warPts > 0
                    ? `<button class="btn-gold" style="padding:5px 9px; font-size:10px;" onclick="startGuildWarBattle('${escHtml(g.guildId)}', '${escHtml(m.studentId)}')">⚔️ Steal +${m.stealReward}</button>`
                    : `<span style="font-size:10px; color:#f87171; font-weight:800;">0 Pts</span>`
                  }
                </div>
              `).join('')}
            </div>
          </div>
        ` : '';

        return `
          <div style="background:${isMine ? 'rgba(245,158,11,0.12)' : '#1e293b'}; border:1px solid ${isMine ? '#f59e0b' : '#334155'}; border-radius:12px; padding:11px 13px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-weight:900; font-size:13px; color:#fde047;">${rankLabel}</span>
                ${renderEmblemVisual(g.emblem, 38)}
                <div>
                  <div style="font-weight:800; font-size:14px; color:#f8fafc;">
                    ${escHtml(g.name)}
                    <span style="font-size:11px; color:#94a3b8; font-weight:400;">(${g.memberCount}/20)</span>
                  </div>
                  <div style="font-size:11px; color:#94a3b8;">"${escHtml(g.motto || '')}"</div>
                  <div style="font-size:11px; margin-top:2px;">
                    ${isWeekend ? `Guild War Pts: <strong style="color:#4ade80;">${Number(g.totalPoints).toLocaleString()}</strong> • Payout: <strong style="color:#facc15;">+${g.projectedPayout} Pts/ea</strong> • ` : ''}
                    Record: <strong style="color:#38bdf8;">${g.wins}W - ${g.losses}L</strong>
                  </div>
                </div>
              </div>
              <div>${actionBtn}</div>
            </div>
            ${targetsHtml}
          </div>
        `;
      }).join('');
    }

    contentEl.innerHTML = html;
  }

  function toggleGuildTargetPicker(guildId) {
    const el = document.getElementById(`guild-targets-${guildId}`);
    if (el) el.classList.toggle('hidden');
  }

  function selectGuildEmblem(em, btn) {
    pendingGuildEmblem = em;
    const prev = document.getElementById('guild-create-emblem-preview');
    if (prev) prev.innerHTML = renderEmblemVisual(em, 38);
    document.querySelectorAll('.guild-emblem-btn').forEach(b => {
      b.style.borderColor = '#475569';
    });
    if (btn) btn.style.borderColor = '#f59e0b';
  }

  function toggleGuildEditForm() {
    const box = document.getElementById('guild-edit-box');
    if (box) box.classList.toggle('hidden');
  }

  async function createNewGuild() {
    const now = Date.now();
    if (now - lastGuildActionTime < 1500) return;
    lastGuildActionTime = now;

    const name = document.getElementById('new-guild-name').value.trim();
    const motto = document.getElementById('new-guild-motto').value.trim();
    if (name.length < 3) return alert("Guild name must be at least 3 characters.");

    showToast("Founding Guild...", "#d97706");
    try {
      const json = await apiPost({
        action: 'createGuild',
        token: sessionToken,
        studentId: hero.studentId,
        name,
        emblem: pendingGuildEmblem,
        motto
      });
      hideToast();
      guildHubData = json.data;
      hero.avatar.guildId = guildHubData.myGuild?.guildId || null;
      renderGuildHubContent(guildHubData.cooldownRemainingMs || 0);
      showToast(`🏰 Guild "${name}" Founded!`, "#10b981");
      setTimeout(hideToast, 2200);
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function requestJoinGuild(guildId) {
    const now = Date.now();
    if (now - lastGuildActionTime < 1500) return;
    lastGuildActionTime = now;

    showToast("Sending Join Request...", "#0369a1");
    try {
      const json = await apiPost({
        action: 'requestJoinGuild',
        token: sessionToken,
        studentId: hero.studentId,
        guildId
      });
      hideToast();
      guildHubData = json.data;
      renderGuildHubContent(guildHubData.cooldownRemainingMs || 0);
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function respondGuildRequest(targetStudentId, approve) {
    if (!guildHubData?.myGuild) return;
    showToast(approve ? "Accepting member..." : "Declining request...", "#0369a1");
    try {
      const json = await apiPost({
        action: 'respondGuildRequest',
        token: sessionToken,
        studentId: hero.studentId,
        guildId: guildHubData.myGuild.guildId,
        targetStudentId,
        approve
      });
      hideToast();
      guildHubData = json.data;
      renderGuildHubContent(guildHubData.cooldownRemainingMs || 0);
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function saveGuildProfileEdit() {
    if (!guildHubData?.myGuild) return;
    const name = document.getElementById('edit-guild-name').value.trim();
    const motto = document.getElementById('edit-guild-motto').value.trim();
    showToast("Updating Guild...", "#d97706");
    try {
      const json = await apiPost({
        action: 'updateGuildProfile',
        token: sessionToken,
        studentId: hero.studentId,
        guildId: guildHubData.myGuild.guildId,
        name,
        emblem: editGuildEmblem,
        motto
      });
      hideToast();
      guildHubData = json.data;
      renderGuildHubContent(guildHubData.cooldownRemainingMs || 0);
      showToast("Guild Updated!", "#10b981");
      setTimeout(hideToast, 1800);
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function leaveCurrentGuild() {
    if (!confirm("Leave your current guild? A 1-hour cooldown applies before you can join or create another guild.")) return;
    showToast("Leaving Guild...", "#7f1d1d");
    try {
      const json = await apiPost({
        action: 'leaveGuild',
        token: sessionToken,
        studentId: hero.studentId
      });
      hideToast();
      guildHubData = json.data;
      hero.avatar.guildId = null;
      renderGuildHubContent(guildHubData.cooldownRemainingMs || 0);
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function kickGuildMember(targetStudentId, targetName) {
    if (!guildHubData?.myGuild) return;
    if (!confirm(`Remove ${targetName} from the guild?`)) return;
    showToast("Removing member...", "#7f1d1d");
    try {
      const json = await apiPost({
        action: 'kickGuildMember',
        token: sessionToken,
        studentId: hero.studentId,
        guildId: guildHubData.myGuild.guildId,
        targetStudentId
      });
      hideToast();
      guildHubData = json.data;
      renderGuildHubContent(guildHubData.cooldownRemainingMs || 0);
    } catch (err) {
      hideToast();
      alert(err.message);
    }
  }

  async function startGuildWarBattle(targetGuildId, targetMemberId) {
    const now = Date.now();
    if (now - lastGuildActionTime < 1500) return;
    lastGuildActionTime = now;

    showToast("⚔️ Entering Weekend Guild War...", "#b91c1c");
    try {
      const json = await apiPost({
        action: 'startGuildBattle',
        token: sessionToken,
        studentId: hero.studentId,
        targetGuildId,
        targetMemberId
      });
      hideToast();

      const match = json.data;
      const myTeam = hydrateServerSquad(match.myTeam);
      const oppTeam = hydrateServerSquad(match.oppTeam);

      clearPvpActionTimers();
      pvpBattle = {
        mode: 'guild',
        matchId: match.matchId,
        myGuild: match.myGuild,
        oppGuild: match.oppGuild,
        defenderName: match.defenderName,
        potentialSteal: match.potentialSteal,
        potentialLoss: match.potentialLoss,
        myTeam,
        oppTeam,
        myActiveIdx: 0,
        oppActiveIdx: 0,
        turn: 'player',
        myActing: false,
        oppActing: false,
        finished: false
      };

      closeGuildModal();
      document.getElementById('modal-pvp').classList.remove('hidden');
      document.getElementById('pvp-battle-mode-tag').innerText = `🔥 GUILD WAR: ${match.myGuild.name} vs ${match.oppGuild.name}`;
      document.getElementById('pvp-lobby-shell').classList.add('hidden');
      document.getElementById('pvp-view-battle').classList.remove('hidden');

      document.getElementById('pvp-b-myname').innerText = `${hero.name} (${match.myGuild.name})`;
      document.getElementById('pvp-b-oppname').innerText = `${match.defenderName} (${match.oppGuild.name})`;
      document.getElementById('pvp-battle-log').innerText = `🔥 Steal Battle vs ${match.defenderName}! Win: Steal +${match.potentialSteal} War Pts | Lose: Lose -${match.potentialLoss} War Pts`;

      renderPvpBattleUI();
    } catch (err) {
      hideToast();
      alert("Guild Battle Error: " + err.message);
    }
  }

  async function finishGuildBattle(won) {
    if (!pvpBattle || pvpBattle.finished) return;
    pvpBattle.finished = true;
    clearPvpActionTimers();
    renderPvpBattleUI();

    const ptsMsg = won
      ? `STEALING +${pvpBattle.potentialSteal} GUILD WAR PTS`
      : `LOSING -${pvpBattle.potentialLoss} GUILD WAR PTS`;

    document.getElementById('pvp-battle-log').innerHTML = won
      ? `<span style="color:#4ade80; font-weight:900;">🏆 GUILD VICTORY! ${ptsMsg}...</span>`
      : `<span style="color:#f87171; font-weight:900;">💀 GUILD DEFEAT! ${ptsMsg}...</span>`;

    try {
      const json = await apiPost({
        action: 'finishGuildBattle',
        token: sessionToken,
        studentId: hero.studentId,
        matchId: pvpBattle.matchId,
        won
      });

      const stolen = json.data.stolenPoints || 0;
      if (won) playAnimeSFX('levelup');
      showToast(
        won
          ? `🏆 Guild Victory! Stole +${stolen} Guild War Points!`
          : `💀 Guild Defeat! Lost -${stolen} Guild War Points!`,
        won ? "#10b981" : "#dc2626"
      );
      setTimeout(hideToast, 2800);
    } catch (err) {
      alert("Guild Battle Record Error: " + err.message);
    }

    setTimeout(() => {
      pvpBattle = null;
      document.getElementById('modal-pvp').classList.add('hidden');
      openGuildModal();
    }, 1700);
  }

  // ============================================================================
  // ANIME TOWER CANVAS RENDERER
  // ============================================================================

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  let lastTime = performance.now();

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function drawSpriteFrame(asset, x, y, drawSize, frameIdx, targetRow, flipX = false) {
    const img = asset ? getLoadedImage(asset.imageData) : null;
    if (!img || !img.complete || img.naturalWidth === 0) {
      ctx.save();
      ctx.fillStyle = flipX ? '#ef4444' : '#3b82f6';
      ctx.beginPath();
      ctx.arc(x, y - drawSize * 0.4, drawSize * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const cols = Math.max(1, asset.meta?.cols || 1);
    const rows = Math.max(1, asset.meta?.rows || 1);
    const fw = img.naturalWidth / cols;
    const fh = img.naturalHeight / rows;
    const col = frameIdx % cols;
    const row = Math.min(rows - 1, targetRow);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    if (flipX) ctx.scale(-1, 1);

    const aspect = fw / fh;
    const w = drawSize * aspect;
    const h = drawSize;
    ctx.drawImage(img, col * fw, row * fh, fw, fh, -w / 2, -h + 14, w, h);
    ctx.restore();
  }

  function gameLoop(now) {
    const rawDt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (combat.hitstopTimer > 0) {
      combat.hitstopTimer -= rawDt;
      requestAnimationFrame(gameLoop);
      return;
    }

    const dt = rawDt;
    combat.frameTick += dt;
    if (combat.frameTick >= 0.14) {
      combat.frameTick = 0;
      combat.heroFrame++;
      combat.enemyFrame++;
    }

    if (combat.heroAnimTimer > 0) {
      combat.heroAnimTimer -= dt;
      if (combat.heroAnimTimer <= 0) combat.heroAnimState = 'idle';
    }

    if (combat.autoBattle && combat.enemy.hp > 0) {
      if (combat.ultimateReady) playerAttack(true);
      else if (Math.random() < dt * 2.4) playerAttack(false);
    }

    if (combat.enemy.hp > 0) {
      combat.enemyAttackTimer += dt;
      if (combat.enemyAttackTimer >= 2.2) {
        combat.enemyAttackTimer = 0;
        let eDmg = combat.enemy.atk;

        if (combat.enemy.isBoss) {
          combat.bossCycle++;
          if (combat.bossCycle % 3 === 0) {
            eDmg = Math.floor(eDmg * 2.2);
            combat.floatingTexts.push({
              x: canvas.width * 0.30,
              y: canvas.height * 0.42,
              text: `🔥 BOSS DEVASTATION -${eDmg}!`,
              color: '#f97316',
              life: 1.1,
              scale: 1.3
            });
          }
        }

        combat.playerHp = Math.max(0, combat.playerHp - eDmg);
        combat.shakeTimer = 0.14;
        combat.floatingTexts.push({
          x: canvas.width * 0.30 + (Math.random() * 24 - 12),
          y: canvas.height * 0.48,
          text: `-${eDmg}`,
          color: '#f87171',
          life: 0.9,
          scale: 1.0
        });
        updateBattleBars();

        if (combat.playerHp <= 0) {
          if (hero.towerFloor > 1) {
            hero.towerFloor -= 1;
            queueSave();
            updateHUD();
          }
          spawnFloorEnemy();
        }
      }
    }

    ctx.save();
    if (combat.shakeTimer > 0) {
      combat.shakeTimer -= dt;
      const mag = combat.shakeTimer * 38;
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    const activeBg = bgPool.find(b => assetMatchesFloor(b, hero.towerFloor)) || bgPool[0];
    const bgImg = activeBg ? getLoadedImage(activeBg.imageData) : null;
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, '#090d16');
      grad.addColorStop(0.65, '#1e1b4b');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const groundY = canvas.height * 0.68;

    const activeChar = gachaPool.find(c => c.assetId === hero.avatar.equippedChar);
    const charCols = Math.max(1, activeChar?.meta?.cols || 1);
    const charRows = Math.max(1, activeChar?.meta?.rows || 1);
    const isAttacking = combat.heroAnimState === 'attack';

    const heroTargetRow = charRows >= 3 ? (isAttacking ? 2 : 0) : 0;
    const heroFrameToUse = charRows >= 3
      ? combat.heroFrame
      : (isAttacking ? Math.max(1, Math.floor(charCols / 2) + (combat.heroFrame % Math.max(1, Math.ceil(charCols / 2)))) : (combat.heroFrame % Math.max(1, Math.ceil(charCols / 2))));

    combat.afterimages.forEach(ai => {
      ai.alpha -= dt * 2.2;
      if (ai.alpha > 0 && activeChar) {
        ctx.save();
        ctx.globalAlpha = ai.alpha * 0.55;
        drawSpriteFrame(activeChar, ai.x, groundY, 155, heroFrameToUse, heroTargetRow, false);
        ctx.restore();
      }
    });
    combat.afterimages = combat.afterimages.filter(ai => ai.alpha > 0);

    const heroX = isAttacking ? canvas.width * 0.54 : canvas.width * 0.28;
    const enemyX = canvas.width * 0.72;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.ellipse(heroX, groundY + 8, 44, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(enemyX, groundY + 8, combat.enemy.isBoss ? 68 : 44, 14, 0, 0, Math.PI * 2); ctx.fill();

    drawSpriteFrame(activeChar, heroX, groundY, 155, heroFrameToUse, heroTargetRow, false);
    drawSpriteFrame(combat.enemy.sprite, enemyX, groundY, combat.enemy.isBoss ? 215 : 150, combat.enemyFrame, 0, true);

    combat.particles.forEach(p => {
      p.life -= dt;
      if (p.life <= 0) return;
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.type === 'slash') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 7 * alpha;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(-p.length / 2, 0);
        ctx.lineTo(p.length / 2, 0);
        ctx.stroke();
      } else if (p.type === 'ring') {
        const r = p.radius + (p.maxRadius - p.radius) * (1 - alpha);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4 * alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'spark') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.restore();
    });
    combat.particles = combat.particles.filter(p => p.life > 0);

    if (combat.flashAlpha > 0) {
      ctx.fillStyle = combat.flashColor;
      ctx.globalAlpha = combat.flashAlpha;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      combat.flashAlpha -= dt * 1.8;
    }

    if (combat.skillCutinTimer > 0) {
      combat.skillCutinTimer -= dt;
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(0, canvas.height * 0.24, canvas.width, 64);
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, canvas.height * 0.24, canvas.width, 64);
      ctx.font = 'italic 900 24px system-ui';
      ctx.fillStyle = '#fde047';
      ctx.textAlign = 'center';
      ctx.fillText(`⚡ ${combat.skillCutinName} ⚡`, canvas.width / 2, canvas.height * 0.24 + 40);
      ctx.restore();
    }

    combat.floatingTexts.forEach(ft => {
      ft.y -= 55 * dt;
      ft.life -= dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.font = `900 ${Math.floor(20 * (ft.scale || 1))}px system-ui`;
      ctx.fillStyle = ft.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4;
      ctx.textAlign = 'center';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });
    combat.floatingTexts = combat.floatingTexts.filter(ft => ft.life > 0);

    ctx.restore();
    requestAnimationFrame(gameLoop);
  }

  // Expose UI callbacks to HTML inline handlers
  Object.assign(window, {
    studentLogin,
    refreshPoints,
    switchLeaderboardTab,
    openTasksModal,
    playerAttack,
    toggleAutoBattle,
    openSummonModal,
    rollGacha,
    equipCharacter,
    openEquipModal,
    equipFromBag,
    unequipSlot,
    openPvpModal,
    closePvpModal,
    switchPvpTab,
    togglePvpDraftHero,
    savePvpSquad,
    startPvpBattle,
    pvpExecuteMove,
    openGuildModal,
    closeGuildModal,
    processEmblemImageFile,
    toggleGuildTargetPicker,
    selectGuildEmblem,
    toggleGuildEditForm,
    createNewGuild,
    requestJoinGuild,
    respondGuildRequest,
    saveGuildProfileEdit,
    leaveCurrentGuild,
    kickGuildMember,
    startGuildWarBattle
  });
})();
