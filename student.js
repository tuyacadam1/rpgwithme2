const API_URL = "https://script.google.com/macros/s/AKfycbxPN7yKyqOwyyxIarj2BTkIcuMOomlfc52zCo2vK4AcVWg8TRofqKaRR-kj1yKiLiENWA/exec";

let hero = null;
let unsavedChanges = false;

// Master Loot Table (Unique IDs prevent duplicates)
const LOOT_POOL = [
  { id: 'w1', slot: 'weapon', name: 'Rusty Blade', rarity: 'Common', power: 5 },
  { id: 'h1', slot: 'head', name: 'Leather Cap', rarity: 'Common', power: 4 },
  { id: 'a1', slot: 'armor', name: 'Tunic of Focus', rarity: 'Common', power: 6 },
  { id: 'b1', slot: 'boots', name: 'Swift Sandals', rarity: 'Rare', power: 12 },
  { id: 'w2', slot: 'weapon', name: 'Scholar Greatsword', rarity: 'Rare', power: 18 },
  { id: 'ac1', slot: 'accessory', name: 'Crystal Pendant', rarity: 'Epic', power: 30 },
  { id: 'a2', slot: 'armor', name: 'Dragonplate Mail', rarity: 'Epic', power: 35 },
  { id: 'w3', slot: 'weapon', name: 'Excalibur of Wisdom', rarity: 'Legendary', power: 75 },
  { id: 'h2', slot: 'head', name: 'Crown of the Archmage', rarity: 'Legendary', power: 65 }
];

async function loginStudent() {
  const studentId = document.getElementById('s-id').value.trim();
  if (!studentId) return alert("Enter Student ID");

  const toast = document.getElementById('toast');
  toast.innerText = "Loading Hero...";
  toast.style.display = 'block';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'studentLogin', studentId })
    });
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);

    hero = json.data;
    document.getElementById('login-view').classList.add('hidden');

    // Check if character gender is set
    if (!hero.gender) {
      hero.gender = 'Male';
      hero.avatar = { color: '#3b82f6' };
      document.getElementById('char-create-view').classList.remove('hidden');
      updatePreview();
    } else {
      initGameUI();
    }
  } catch (e) {
    alert(e.message);
  } finally {
    toast.style.display = 'none';
  }
}

// --- CHARACTER CREATION ---
function selectGender(g) {
  hero.gender = g;
  updatePreview();
}

function updatePreview() {
  const color = document.getElementById('avatar-color').value;
  hero.avatar.color = color;
  const prev = document.getElementById('avatar-preview');
  prev.innerText = hero.gender === 'Male' ? '🧙🏽‍♂️' : '🧙🏽‍♀️';
  prev.style.border = `3px solid ${color}`;
}

async function confirmCharacter() {
  document.getElementById('char-create-view').classList.add('hidden');
  initGameUI();
  await syncToCloud(); // Save initial character creation immediately
}

// --- GAME UI & CALCULATIONS ---
function initGameUI() {
  document.getElementById('app-shell').classList.remove('hidden');
  refreshHUD();
  renderStats();
  renderEquipment();
  renderTower();
}

function calculateTotalCP() {
  const s = hero.stats;
  let base = (s.str * 3) + (s.agi * 2) + (s.vit * 2) + (s.int * 3);
  Object.values(hero.equipped).forEach(item => {
    if (item) base += item.power;
  });
  return base;
}

function refreshHUD() {
  const av = document.getElementById('hud-avatar');
  av.innerText = hero.gender === 'Male' ? '🧙🏽‍♂️' : '🧙🏽‍♀️';
  av.style.border = `2px solid ${hero.avatar.color || '#3b82f6'}`;
  
  document.getElementById('hud-name').innerText = hero.name;
  document.getElementById('hud-floor').innerText = hero.towerFloor;
  document.getElementById('hud-cp').innerText = calculateTotalCP();
  document.getElementById('hud-points').innerText = hero.unspentPoints;
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-view').forEach(el => el.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// --- 1. STATS ALLOCATION (Instant Local Update) ---
function renderStats() {
  const labels = { str: '💪 Strength (ATK)', agi: '⚡ Agility (SPD)', vit: '❤️ Vitality (HP)', int: '🧠 Intellect (MAG)' };
  document.getElementById('stats-list').innerHTML = Object.keys(labels).map(key => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #334155;">
      <div>
        <b>${labels[key]}</b>
        <div style="color:var(--gold); font-size:14px;">Level ${hero.stats[key]}</div>
      </div>
      <button class="btn btn-sm" ${hero.unspentPoints <= 0 ? 'disabled style="opacity:0.4"' : ''} onclick="addStat('${key}')">+1</button>
    </div>
  `).join('');
}

function addStat(key) {
  if (hero.unspentPoints <= 0) return;
  hero.unspentPoints--;
  hero.stats[key]++;
  unsavedChanges = true;
  refreshHUD();
  renderStats();
}

// --- 2. EQUIPMENT (5 SLOTS, NO DUPLICATES) ---
function renderEquipment() {
  const slots = ['head', 'weapon', 'armor', 'boots', 'accessory'];
  const icons = { head: '🪖', weapon: '⚔️', armor: '🛡️', boots: '👢', accessory: '💍' };

  document.getElementById('equipped-slots').innerHTML = slots.map(slot => {
    const item = hero.equipped[slot];
    return `
      <div class="equip-slot ${item ? 'rarity-' + item.rarity : ''}">
        <div style="font-size:20px;">${icons[slot]}</div>
        <div style="text-transform:uppercase; font-size:9px; color:var(--muted);">${slot}</div>
        <div style="font-weight:bold; margin-top:4px;">${item ? item.name : 'Empty'}</div>
        ${item ? `<div style="font-size:10px;">+${item.power} CP</div>` : ''}
      </div>
    `;
  }).join('');

  document.getElementById('inventory-list').innerHTML = hero.inventory.map(item => `
    <div class="card rarity-${item.rarity}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; margin-bottom:8px;">
      <div>
        <b>[${item.rarity}] ${item.name}</b>
        <div style="font-size:11px; color:var(--muted);">Slot: ${item.slot.toUpperCase()} | +${item.power} CP</div>
      </div>
      <button class="btn btn-sm" onclick="equipItem('${item.id}')">Equip</button>
    </div>
  `).join('') || '<p style="font-size:12px; color:var(--muted);">Defeat Tower floors to unlock gear!</p>';
}

function equipItem(itemId) {
  const item = hero.inventory.find(i => i.id === itemId);
  if (!item) return;
  hero.equipped[item.slot] = item; // Overwrites slot cleanly
  unsavedChanges = true;
  refreshHUD();
  renderEquipment();
}

// --- 3. INFINITE TOWER RAID ---
function renderTower() {
  const floor = hero.towerFloor;
  const isBoss = floor % 10 === 0;
  const enemyPower = Math.floor(25 * Math.pow(1.12, floor - 1));

  document.getElementById('tower-title').innerText = isBoss ? `🔥 FLOOR ${floor} - TOWER GUARDIAN BOSS` : `Floor ${floor} - Tower Monster`;
  document.getElementById('enemy-sprite').innerText = isBoss ? '🐉' : '👺';
  document.getElementById('enemy-power').innerText = enemyPower;
}

function battleFloor() {
  const floor = hero.towerFloor;
  const isBoss = floor % 10 === 0;
  const enemyPower = Math.floor(25 * Math.pow(1.12, floor - 1));
  const playerCP = calculateTotalCP();
  const log = document.getElementById('battle-log');

  if (playerCP >= enemyPower) {
    // Victory! Overwrite floor progress (+1)
    hero.towerFloor++;
    unsavedChanges = true;

    // Rarity-based Drop Roll
    const roll = Math.random() * 100;
    let rarity = 'Common';
    if (isBoss) {
      rarity = roll < 25 ? 'Legendary' : roll < 70 ? 'Epic' : 'Rare';
    } else {
      rarity = roll < 3 ? 'Legendary' : roll < 15 ? 'Epic' : roll < 45 ? 'Rare' : 'Common';
    }

    const candidates = LOOT_POOL.filter(i => i.rarity === rarity);
    const drop = candidates[Math.floor(Math.random() * candidates.length)];

    // Duplicate Check: Only add if NOT already in inventory
    const alreadyOwned = hero.inventory.some(i => i.id === drop.id);
    if (!alreadyOwned) {
      hero.inventory.push(drop);
      log.innerHTML = `<span style="color:#4ade80;">🎉 Victory! Dropped <b class="rarity-${drop.rarity}">[${drop.rarity}] ${drop.name}</b>!</span>`;
    } else {
      log.innerHTML = `<span style="color:#4ade80;">🎉 Victory! Found duplicate <b>${drop.name}</b> (Converted to dust, inventory kept clean!).</span>`;
    }

    refreshHUD();
    renderEquipment();
    renderTower();

    // Auto-sync on Boss victories so progress is never lost
    if (isBoss) syncToCloud();

  } else {
    log.innerHTML = `<span style="color:#f87171;">💀 Defeated! You need ${enemyPower - playerCP} more CP. Earn class points or equip better gear!</span>`;
  }
}

// --- CLOUD SYNC (Single Batch Overwrite) ---
async function syncToCloud() {
  const toast = document.getElementById('toast');
  toast.innerText = "☁️ Saving Progress...";
  toast.style.display = 'block';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveStudentState',
        studentId: hero.studentId,
        state: {
          gender: hero.gender,
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
    unsavedChanges = false;
    toast.innerText = "✅ Saved!";
    setTimeout(() => toast.style.display = 'none', 1500);
  } catch (e) {
    alert("Save failed: " + e.message);
    toast.style.display = 'none';
  }
}

// Warn before closing tab if unsaved changes exist
window.addEventListener('beforeunload', (e) => {
  if (unsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});
