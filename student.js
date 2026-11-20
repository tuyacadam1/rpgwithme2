const API_URL = "https://script.google.com/macros/s/AKfycbxPN7yKyqOwyyxIarj2BTkIcuMOomlfc52zCo2vK4AcVWg8TRofqKaRR-kj1yKiLiENWA/exec";

let hero = null;
let hasUnsaved = false;
let pointsSpentSinceSync = 0;
let animFrame = 0;
let heroAnimRow = 0; // 0 = Idle, 1 = Slash, 2 = Ultimate

let idlePaused = false;
let autoClimb = true;
let heroHP = 100;
let heroMaxHP = 100;
let enemyHP = 100;
let enemyMaxHP = 100;
let idleTurn = 'hero';

const RARITY_MULT = { Common: 1.0, Rare: 1.2, Epic: 1.5, Legendary: 2.0 };

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

const LOOT_TABLE = [
  { id: 'w_iron', slot: 'weapon', icon: '🗡️', name: 'Iron Broadsword', rarity: 'Common', power: 8 },
  { id: 'h_cap', slot: 'head', icon: '🪖', name: 'Scout Hood', rarity: 'Common', power: 6 },
  { id: 'a_leather', slot: 'armor', icon: '🦺', name: 'Brigandine Vest', rarity: 'Common', power: 10 },
  { id: 'b_boots', slot: 'boots', icon: '👢', name: 'Swift Greaves', rarity: 'Rare', power: 15 },
  { id: 'w_arcane', slot: 'weapon', icon: '⚔️', name: 'Enchanted Greatsword', rarity: 'Rare', power: 22 },
  { id: 'h_circlet', slot: 'head', icon: '👑', name: 'Scholar Circlet', rarity: 'Rare', power: 18 },
  { id: 'a_guardian', slot: 'armor', icon: '🛡️', name: 'Guardian Plate Tunic', rarity: 'Epic', power: 38 },
  { id: 'ac_pendant', slot: 'accessory', icon: '🔮', name: 'Crystal Pendant', rarity: 'Epic', power: 32 },
  { id: 'w_excal', slot: 'weapon', icon: '🔥', name: 'Solaris Dragonblade', rarity: 'Legendary', power: 85 },
  { id: 'ac_crown', slot: 'accessory', icon: '💎', name: 'Heart of the Tower', rarity: 'Legendary', power: 75 }
];

// --- 1. LOGIN ---
async function loginStudent() {
  const studentId = document.getElementById('student-id-input').value.trim();
  if (!studentId) return alert("Enter your Student ID.");

  showToast("Summoning World...", "#3b82f6");
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'studentLogin', studentId })
    });
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);

    hero = json.data;
    pointsSpentSinceSync = 0;

    if (!hero.avatar || !Array.isArray(hero.avatar.unlockedChars)) {
      hero.avatar = { unlockedChars: [], equippedChar: null };
    }
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

// --- 2. SPRITE SHEET ANIMATION LOOP ---
function startSpriteAnimationLoop() {
  setInterval(() => {
    animFrame++;
    const charObj = getEquippedCharacterObj();
    const enemyObj = getFloorEnemy(hero.towerFloor).asset;

    if (charObj) {
      applySpriteFrame(document.getElementById('stage-hero-sprite'), charObj, animFrame, 0);
      applySpriteFrame(document.getElementById('arena-hero-sprite'), charObj, animFrame, heroAnimRow);
    } else {
      setSilhouette(document.getElementById('stage-hero-sprite'));
      setSilhouette(document.getElementById('arena-hero-sprite'));
    }

    applySpriteFrame(document.getElementById('arena-enemy-sprite'), enemyObj, animFrame, 0);
  }, 130);
}

function setSilhouette(el) {
  if (!el) return;
  el.style.backgroundImage = `url("${EMPTY_SLOT_SILHOUETTE}")`;
  el.style.backgroundSize = 'contain';
  el.style.backgroundPosition = 'center';
}

function applySpriteFrame(el, asset, frameIdx, targetRow) {
  if (!el || !asset) return;
  const cols = Math.max(1, asset.meta?.cols || 1);
  const rows = Math.max(1, asset.meta?.rows || 1);
  const col = frameIdx % cols;
  const row = Math.min(rows - 1, targetRow);

  el.style.backgroundImage = `url(${asset.imageData})`;
  el.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
  const xPct = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const yPct = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  el.style.backgroundPosition = `${xPct}% ${yPct}%`;
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
    // Automatically boost all stats on level up and overwrite in-place
    hero.stats.str += 1;
    hero.stats.agi += 1;
    hero.stats.vit += 1;
    hero.stats.int += 1;
    leveledUp = true;
  }

  hasUnsaved = true;
  if (leveledUp) {
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
    if (idlePaused || !hero) return;

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
      heroAnimRow = isCrit ? 2 : 1;
      heroSprite.classList.add('lunge-right');

      setTimeout(() => {
        enemySprite.classList.add('hit-flash');
        enemyHP -= dmg;
        spawnFloatingDamage('combatant-enemy', dmg, isCrit ? '#fbbf24' : '#ffffff');
        updateHPBars();
      }, 180);

      setTimeout(() => {
        heroAnimRow = 0;
        heroSprite.classList.remove('lunge-right');
        enemySprite.classList.remove('hit-flash');

        if (enemyHP <= 0) {
          handleIdleVictory(enemy);
        } else {
          idleTurn = 'enemy';
        }
      }, 480);

    } else {
      const enemyDmg = Math.floor(enemy.reqCP * 0.95);
      enemySprite.classList.add('lunge-left');

      setTimeout(() => {
        heroSprite.classList.add('hit-flash');
        heroHP -= enemyDmg;
        spawnFloatingDamage('combatant-hero', enemyDmg, '#f87171');
        updateHPBars();
      }, 180);

      setTimeout(() => {
        enemySprite.classList.remove('lunge-left');
        heroSprite.classList.remove('hit-flash');

        if (heroHP <= 0) {
          resBox.innerHTML = `<span style="color:#f87171;">⚠️ Enemy too strong! Respawning to keep idle farming EXP...</span>`;
          resetCombatRound();
        } else {
          idleTurn = 'hero';
        }
      }, 480);
    }
  }, 1150);
}

function handleIdleVictory(enemy) {
  const resBox = document.getElementById('raid-result');
  const clearedFloor = hero.towerFloor;

  // Award EXP based on floor (Boss floors give 3x EXP)
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

  const pool = LOOT_TABLE.filter(i => i.rarity === rarity);
  const drop = pool[Math.floor(Math.random() * pool.length)];

  const exists = hero.inventory.some(i => i.id === drop.id);
  if (!exists) {
    hero.inventory.push(drop);
    hasUnsaved = true;
    resBox.innerHTML = `<span style="color:#4ade80;">🎉 +${expGain} EXP! Found [${drop.rarity}] ${drop.name}!</span>`;
  } else {
    resBox.innerHTML = `<span style="color:#38bdf8;">⚔️ +${expGain} EXP! Advancing to Floor ${hero.towerFloor}...</span>`;
  }

  // Overwrite save automatically on Boss floors so sheet data stays clean & updated
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
  btn.innerText = autoClimb ? '🔄 Auto-Climb: ON' : '🔁 Farm Current Floor';
  btn.style.background = autoClimb ? '#059669' : '#d97706';
}

function toggleIdlePause() {
  idlePaused = !idlePaused;
  document.getElementById('pause-idle-btn').innerText = idlePaused ? '▶️ Resume Idle' : '⏸️ Pause Idle';
}

// --- 5. GACHA SYSTEM (USES TEACHER CLASS POINTS) ---
function rollGacha(count) {
  const cost = count === 5 ? 22 : 5;
  if (hero.unspentPoints < cost) return alert(`Need ${cost} Class Points to summon!`);

  const charPool = (hero.assets || []).filter(a => a.type === 'character');
  if (charPool.length === 0) return alert("Your teacher hasn't uploaded Gacha Characters yet!");

  hero.unspentPoints -= cost;
  pointsSpentSinceSync += cost;
  hasUnsaved = true;
  const pullResults = [];

  for (let i = 0; i < count; i++) {
    const roll = Math.random() * 100;
    let rarity = 'Common';
    if (roll < 5) rarity = 'Legendary';
    else if (roll < 20) rarity = 'Epic';
    else if (roll < 50) rarity = 'Rare';

    let candidates = charPool.filter(c => c.rarity === rarity);
    if (candidates.length === 0) candidates = charPool;
    const pulled = candidates[Math.floor(Math.random() * candidates.length)];

    const existing = hero.avatar.unlockedChars.find(u => u.id === pulled.assetId);
    if (existing) {
      existing.stars = (existing.stars || 1) + 1;
      pullResults.push(`[${pulled.rarity}] ${pulled.name} (★${existing.stars} Up!)`);
    } else {
      hero.avatar.unlockedChars.push({ id: pulled.assetId, stars: 1 });
      pullResults.push(`NEW! [${pulled.rarity}] ${pulled.name}`);
    }

    if (!hero.avatar.equippedChar) {
      hero.avatar.equippedChar = pulled.assetId;
    }
  }

  document.getElementById('gacha-result-log').innerHTML =
    `<span style="color:#e879f9;">🎉 ${pullResults.join(' • ')}</span>`;

  resetCombatRound();
  renderAll();
}

function equipCharacter(assetId) {
  hero.avatar.equippedChar = assetId;
  hasUnsaved = true;
  resetCombatRound();
  renderAll();
}

function renderUnlockedCharacters() {
  const row = document.getElementById('unlocked-chars-row');
  const cards = hero.avatar.unlockedChars.map(u => ({
    id: u.id,
    stars: u.stars || 1,
    asset: (hero.assets || []).find(a => a.assetId === u.id)
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
        <div class="char-thumb" style="background-image:url(${a.imageData}); background-size:${a.meta.cols * 100}% ${a.meta.rows * 100}%; background-position:0% 0%;"></div>
        <div style="font-size:10px; font-weight:800; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.name}</div>
        <div style="font-size:9px; color:var(--gold);">★${c.stars} (${RARITY_MULT[a.rarity]}x)</div>
      </div>
    `;
  }).join('');
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
      <div class="gear-stat">${item ? `[${item.rarity}] +${item.power}` : 'Equip'}</div>
    `;
  });
}

function openArmory(slotFilter) {
  const modal = document.getElementById('armory-modal');
  const list = document.getElementById('armory-items');
  document.getElementById('armory-title').innerText = slotFilter === 'all' ? '🎒 All Gear' : `🎒 ${slotFilter.toUpperCase()} Slot`;

  const items = slotFilter === 'all' ? hero.inventory : hero.inventory.filter(i => i.slot === slotFilter);
  list.innerHTML = items.map(item => `
    <div class="rpg-card rarity-${item.rarity}" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:26px;">${item.icon}</span>
        <div>
          <div style="font-weight:800; font-size:13px;">${item.name}</div>
          <div style="font-size:11px; color:var(--muted);">[${item.rarity}] ${item.slot.toUpperCase()} • +${item.power * 10} CP</div>
        </div>
      </div>
      <button class="plus-btn" onclick="equipGear('${item.id}')">EQUIP</button>
    </div>
  `).join('') || '<p style="text-align:center; color:var(--muted); padding:20px;">No gear unlocked yet. Let your hero idle in the Tower!</p>';

  modal.classList.remove('hidden');
}

function closeArmory() { document.getElementById('armory-modal').classList.add('hidden'); }

function equipGear(itemId) {
  const item = hero.inventory.find(i => i.id === itemId);
  if (!item) return;
  hero.equipped[item.slot] = item;
  hasUnsaved = true;
  closeArmory();
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

// --- 9. CLOUD SYNC (OVERWRITES IN PLACE) & LEADERBOARD ---
async function syncProgress() {
  showToast("☁️ Saving Hero...", "#10b981");
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveStudentState',
        studentId: hero.studentId,
        state: {
          avatar: hero.avatar,
          pointsSpent: pointsSpentSinceSync,
          stats: hero.stats,
          towerFloor: hero.towerFloor,
          equipped: hero.equipped,
          inventory: hero.inventory
        }
      })
    });
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);

    pointsSpentSinceSync = 0;
    hero.unspentPoints = Number(json.data.unspentPoints) || 0;
    hasUnsaved = false;
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
        const livePts = Math.max(0, (Number(json.data.unspentPoints) || 0) - pointsSpentSinceSync);
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

function showToast(msg, bg) {
  const t = document.getElementById('toast');
  t.innerText = msg; t.style.background = bg; t.style.display = 'block';
}
function hideToast() { document.getElementById('toast').style.display = 'none'; }

window.addEventListener('beforeunload', (e) => {
  if (hasUnsaved) { e.preventDefault(); e.returnValue = ''; }
});
