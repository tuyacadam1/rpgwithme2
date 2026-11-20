const API_URL = "https://script.google.com/macros/s/AKfycbxPN7yKyqOwyyxIarj2BTkIcuMOomlfc52zCo2vK4AcVWg8TRofqKaRR-kj1yKiLiENWA/exec";

let hero = null;
let hasUnsaved = false;
let isBattling = false;
let animFrame = 0;
let heroAnimRow = 0; // 0 = Idle (Row 1), 1 = Attack (Row 2), 2 = Ultimate (Row 3)

const RARITY_MULT = { Common: 1.0, Rare: 1.2, Epic: 1.5, Legendary: 2.0 };

const DEFAULT_HERO = {
  assetId: 'default_novice',
  type: 'character',
  rarity: 'Common',
  name: 'Novice Knight',
  imageData: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><circle cx="80" cy="40" r="20" fill="#fde68a"/><rect x="58" y="64" width="44" height="54" rx="8" fill="#2563eb"/><rect x="62" y="118" width="14" height="34" rx="4" fill="#1e293b"/><rect x="84" y="118" width="14" height="34" rx="4" fill="#1e293b"/><rect x="110" y="25" width="7" height="85" rx="3" fill="#38bdf8"/></svg>`),
  meta: { cols: 1, rows: 1 }
};

const DEFAULT_MOB = {
  name: 'Tower Goblin',
  imageData: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><ellipse cx="80" cy="90" rx="48" ry="42" fill="#16a34a"/><circle cx="64" cy="80" r="7" fill="#fef08a"/><circle cx="96" cy="80" r="7" fill="#fef08a"/></svg>`),
  meta: { cols: 1, rows: 1 }
};

const DEFAULT_BOSS = {
  name: 'Tower Dragon Boss',
  imageData: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><ellipse cx="80" cy="92" rx="55" ry="48" fill="#7f1d1d" stroke="#fbbf24" stroke-width="4"/><circle cx="62" cy="80" r="9" fill="#fbbf24"/><circle cx="98" cy="80" r="9" fill="#fbbf24"/></svg>`),
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

// --- 1. LOGIN & SPRITE LOOP ENGINE ---
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
    if (!hero.avatar || !Array.isArray(hero.avatar.unlockedChars)) {
      hero.avatar = { unlockedChars: [], equippedChar: null };
    }

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');

    startSpriteAnimationLoop();
    renderAll();
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
  return DEFAULT_HERO;
}

// Smooth 60fps-friendly sprite sheet frame stepper for Idle (Row 1) & Attack (Row 2/3)
function startSpriteAnimationLoop() {
  setInterval(() => {
    animFrame++;
    const charObj = getEquippedCharacterObj();
    const enemyObj = getFloorEnemy(hero.towerFloor).asset;

    applySpriteFrame(document.getElementById('stage-hero-sprite'), charObj, animFrame, 0);
    applySpriteFrame(document.getElementById('arena-hero-sprite'), charObj, animFrame, heroAnimRow);
    applySpriteFrame(document.getElementById('arena-enemy-sprite'), enemyObj, animFrame, 0);
  }, 135);
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

// --- 2. GACHA SYSTEM (USES SAME CLASS POINTS POOL) ---
function rollGacha(count) {
  const cost = count === 5 ? 22 : 5;
  if (hero.unspentPoints < cost) return alert(`Need ${cost} Class Points to summon!`);

  const charPool = (hero.assets || []).filter(a => a.type === 'character');
  if (charPool.length === 0) return alert("Your teacher hasn't uploaded Gacha Characters yet!");

  hero.unspentPoints -= cost;
  hasUnsaved = true;
  const pullResults = [];

  for (let i = 0; i < count; i++) {
    const roll = Math.random() * 100;
    let rarity = 'Common';
    if (roll < 5) rarity = 'Legendary';
    else if (roll < 20) rarity = 'Epic';
    else if (roll < 50) rarity = 'Rare';

    let candidates = charPool.filter(c => c.rarity === rarity);
    if (candidates.length === 0) candidates = charPool; // Fallback if teacher only uploaded 1 rarity
    const pulled = candidates[Math.floor(Math.random() * candidates.length)];

    // Check if already unlocked -> increment Star level on duplicates!
    const existing = hero.avatar.unlockedChars.find(u => u.id === pulled.assetId);
    if (existing) {
      existing.stars = (existing.stars || 1) + 1;
      pullResults.push(`[${pulled.rarity}] ${pulled.name} (★${existing.stars} Up!)`);
    } else {
      hero.avatar.unlockedChars.push({ id: pulled.assetId, stars: 1 });
      pullResults.push(`NEW! [${pulled.rarity}] ${pulled.name}`);
    }

    // Auto-equip if student was still using the default knight
    if (!hero.avatar.equippedChar) {
      hero.avatar.equippedChar = pulled.assetId;
    }
  }

  document.getElementById('gacha-result-log').innerHTML =
    `<span style="color:#e879f9;">🎉 ${pullResults.join(' • ')}</span>`;

  renderAll();
}

function equipCharacter(assetId) {
  hero.avatar.equippedChar = assetId;
  hasUnsaved = true;
  renderAll();
}

function renderUnlockedCharacters() {
  const row = document.getElementById('unlocked-chars-row');
  const cards = [
    { id: null, stars: 1, asset: DEFAULT_HERO },
    ...hero.avatar.unlockedChars.map(u => ({
      id: u.id,
      stars: u.stars || 1,
      asset: (hero.assets || []).find(a => a.assetId === u.id)
    })).filter(x => x.asset)
  ];

  row.innerHTML = cards.map(c => {
    const a = c.asset;
    const isSelected = hero.avatar.equippedChar === c.id;
    return `
      <div class="char-card rarity-${a.rarity} ${isSelected ? 'active' : ''}" onclick="equipCharacter(${c.id ? `'${c.id}'` : 'null'})">
        <div class="char-thumb" style="background-image:url(${a.imageData}); background-size:${a.meta.cols * 100}% ${a.meta.rows * 100}%; background-position:0% 0%;"></div>
        <div style="font-size:10px; font-weight:800; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.name}</div>
        <div style="font-size:9px; color:var(--gold);">★${c.stars} (${RARITY_MULT[a.rarity]}x)</div>
      </div>
    `;
  }).join('');
}

// --- 3. COMBAT POWER & STATS (USES SAME CLASS POINTS POOL) ---
function getTotalCP() {
  const s = hero.stats;
  let base = (s.str * 15) + (s.agi * 12) + (s.vit * 12) + (s.int * 15);
  Object.values(hero.equipped).forEach(item => {
    if (item) base += (item.power * 10);
  });

  // Apply Gacha Character Rarity & Star Awakening Multiplier!
  const charObj = getEquippedCharacterObj();
  const unlockedEntry = hero.avatar.unlockedChars.find(u => u.id === charObj.assetId);
  const stars = unlockedEntry ? unlockedEntry.stars : 1;
  const mult = (RARITY_MULT[charObj.rarity] || 1.0) + ((stars - 1) * 0.1);

  return Math.floor(base * mult);
}

function renderStats() {
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
        <span style="width:65px; font-weight:700;">${m.icon} ${m.label}: ${val}</span>
        <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
        <button class="plus-btn" ${hero.unspentPoints <= 0 ? 'disabled' : ''} onclick="upgradeStat('${m.key}')">[+1]</button>
      </div>
    `;
  }).join('');
}

function upgradeStat(key) {
  if (hero.unspentPoints <= 0) return;
  hero.unspentPoints--;
  hero.stats[key]++;
  hasUnsaved = true;
  renderAll();
}

// --- 4. 5-SLOT GEAR & ARMORY (NO DUPLICATES) ---
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
  `).join('') || '<p style="text-align:center; color:var(--muted); padding:20px;">No gear unlocked yet. Raid the Tower!</p>';

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

// --- 5. INFINITE TOWER RAID (SPRITE SHEET ATTACK ANIMATION) ---
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
    asset: chosen || (isBoss ? DEFAULT_BOSS : DEFAULT_MOB)
  };
}

function renderArena() {
  const enemy = getFloorEnemy(hero.towerFloor);
  document.getElementById('tower-floor-badge').innerText = enemy.isBoss ? `🔥 FLOOR ${hero.towerFloor} BOSS` : `FLOOR ${hero.towerFloor}`;
  document.getElementById('arena-hero-name').innerText = getEquippedCharacterObj().name;
  document.getElementById('arena-hero-cp').innerText = getTotalCP().toLocaleString() + " CP";
  document.getElementById('arena-enemy-name').innerText = enemy.asset.name;
  document.getElementById('arena-enemy-cp').innerText = enemy.reqCP.toLocaleString() + " CP";

  document.getElementById('hero-hp-bar').style.width = '100%';
  document.getElementById('enemy-hp-bar').style.width = '100%';
}

function battleTower() {
  if (isBattling) return;
  isBattling = true;

  const enemy = getFloorEnemy(hero.towerFloor);
  const myCP = getTotalCP();
  const heroSprite = document.getElementById('arena-hero-sprite');
  const enemySprite = document.getElementById('arena-enemy-sprite');
  const resBox = document.getElementById('raid-result');

  // Trigger Row 2 (Attack) or Row 3 (Ultimate on Boss floors) of the sprite sheet!
  heroAnimRow = enemy.isBoss ? 2 : 1;
  heroSprite.classList.add('lunge-right');

  setTimeout(() => {
    enemySprite.classList.add('hit-flash');
    document.getElementById('enemy-hp-bar').style.width = myCP >= enemy.reqCP ? '0%' : '65%';
  }, 250);

  setTimeout(() => {
    heroAnimRow = 0; // Return to Row 1 Idle loop
    heroSprite.classList.remove('lunge-right');
    enemySprite.classList.remove('hit-flash');

    if (myCP >= enemy.reqCP) {
      hero.towerFloor++;
      hasUnsaved = true;

      const roll = Math.random() * 100;
      let rarity = 'Common';
      if (enemy.isBoss) rarity = roll < 30 ? 'Legendary' : roll < 75 ? 'Epic' : 'Rare';
      else rarity = roll < 4 ? 'Legendary' : roll < 18 ? 'Epic' : roll < 50 ? 'Rare' : 'Common';

      const pool = LOOT_TABLE.filter(i => i.rarity === rarity);
      const drop = pool[Math.floor(Math.random() * pool.length)];

      const exists = hero.inventory.some(i => i.id === drop.id);
      if (!exists) {
        hero.inventory.push(drop);
        resBox.innerHTML = `<span style="color:#4ade80;">🎉 VICTORY! Dropped [${drop.rarity}] ${drop.name}!</span>`;
      } else {
        resBox.innerHTML = `<span style="color:#fbbf24;">⚔️ VICTORY! Floor Cleared! (Duplicate ${drop.name} converted)</span>`;
      }

      renderAll();
      if (enemy.isBoss) syncProgress();
    } else {
      enemySprite.classList.add('lunge-left');
      setTimeout(() => {
        heroSprite.classList.add('hit-flash');
        document.getElementById('hero-hp-bar').style.width = '10%';
      }, 200);
      setTimeout(() => {
        enemySprite.classList.remove('lunge-left');
        heroSprite.classList.remove('hit-flash');
        resBox.innerHTML = `<span style="color:#f87171;">💀 Defeated! Need ${(enemy.reqCP - myCP).toLocaleString()} more CP.</span>`;
      }, 500);
    }
    isBattling = false;
  }, 700);
}

// --- 6. MASTER RENDER & CLOUD SYNC ---
function renderAll() {
  const charObj = getEquippedCharacterObj();
  document.getElementById('hud-name').innerText = hero.name;
  document.getElementById('hud-id').innerText = hero.studentId;
  document.getElementById('hud-floor').innerText = hero.towerFloor;
  document.getElementById('hud-cp').innerText = getTotalCP().toLocaleString();
  document.getElementById('hud-pts').innerText = hero.unspentPoints;
  document.getElementById('panel-pts').innerText = hero.unspentPoints;
  document.getElementById('gacha-pts-display').innerText = hero.unspentPoints;
  document.getElementById('active-char-badge').innerText = `[${charObj.rarity}] ${charObj.name}`;

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
          unspentPoints: hero.unspentPoints,
          stats: hero.stats,
          towerFloor: hero.towerFloor,
          equipped: hero.equipped,
          inventory: hero.inventory
        }
      })
    });
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    hasUnsaved = false;
    showToast("✅ Synced!", "#10b981");
    setTimeout(hideToast, 1500);
  } catch (err) {
    hideToast();
    alert("Sync failed: " + err.message);
  }
}

function showToast(msg, bg) {
  const t = document.getElementById('toast');
  t.innerText = msg; t.style.background = bg; t.style.display = 'block';
}
function hideToast() { document.getElementById('toast').style.display = 'none'; }

window.addEventListener('beforeunload', (e) => {
  if (hasUnsaved) { e.preventDefault(); e.returnValue = ''; }
});
