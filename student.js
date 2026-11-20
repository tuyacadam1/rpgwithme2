const API_URL = "https://script.google.com/macros/s/AKfycbxPN7yKyqOwyyxIarj2BTkIcuMOomlfc52zCo2vK4AcVWg8TRofqKaRR-kj1yKiLiENWA/exec";

let hero = null;
let hasUnsaved = false;

const HAIR_COLORS = ['#4a2e1b', '#1f2937', '#d97706', '#dc2626', '#93c5fd', '#e5e7eb'];
const ARMOR_COLORS = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#d97706', '#334155'];

// Master Loot Table (Unique IDs ensure duplicated weapons are never added)
const LOOT_TABLE = [
  { id: 'w_iron', slot: 'weapon', icon: '🗡️', name: 'Iron Broadsword', rarity: 'Common', power: 8, bladeColor: '#cbd5e1' },
  { id: 'h_cap', slot: 'head', icon: '🪖', name: 'Scout Hood', rarity: 'Common', power: 6 },
  { id: 'a_leather', slot: 'armor', icon: '🦺', name: 'Brigandine Vest', rarity: 'Common', power: 10 },
  { id: 'b_boots', slot: 'boots', icon: '👢', name: 'Swift Greaves', rarity: 'Rare', power: 15 },
  { id: 'w_arcane', slot: 'weapon', icon: '⚔️', name: 'Enchanted Greatsword', rarity: 'Rare', power: 22, bladeColor: '#38bdf8' },
  { id: 'h_circlet', slot: 'head', icon: '👑', name: 'Scholar Circlet', rarity: 'Rare', power: 18 },
  { id: 'a_guardian', slot: 'armor', icon: '🛡️', name: 'Guardian Plate Tunic', rarity: 'Epic', power: 38 },
  { id: 'ac_pendant', slot: 'accessory', icon: '🔮', name: 'Crystal Pendant', rarity: 'Epic', power: 32 },
  { id: 'w_excal', slot: 'weapon', icon: '🔥', name: 'Solaris Dragonblade', rarity: 'Legendary', power: 85, bladeColor: '#fbbf24' },
  { id: 'ac_crown', slot: 'accessory', icon: '💎', name: 'Heart of the Tower', rarity: 'Legendary', power: 75 }
];

// --- 1. LOGIN & INITIALIZATION ---
async function loginStudent() {
  const studentId = document.getElementById('student-id-input').value.trim();
  if (!studentId) return alert("Please enter your Student ID.");

  showToast("Summoning Hero...", "#3b82f6");
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'studentLogin', studentId })
    });
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);

    hero = json.data;
    if (!hero.gender) hero.gender = 'Male';
    if (!hero.avatar || !hero.avatar.hairColor) {
      hero.avatar = { hairColor: '#4a2e1b', armorColor: '#2563eb' };
    }

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');

    initSwatches();
    renderAll();
    hideToast();
  } catch (err) {
    hideToast();
    alert("Login Error: " + err.message);
  }
}

// --- 2. LIVE SVG CHARACTER RENDERER (Zero Image Lag!) ---
function renderCharacterSVG() {
  const svg = document.getElementById('hero-canvas');
  const isFemale = hero.gender === 'Female';
  const hair = hero.avatar.hairColor || '#4a2e1b';
  const armor = hero.avatar.armorColor || '#2563eb';
  const weapon = hero.equipped.weapon;
  const bladeColor = weapon ? (weapon.bladeColor || '#94a3b8') : null;
  const hasHeadgear = Boolean(hero.equipped.head);

  // Dynamic SVG Sprite that changes hair, gender silhouette, armor color, circlet, and held weapon!
  svg.innerHTML = `
    <!-- Weapon Behind/Held -->
    ${weapon ? `
      <g transform="translate(135, 35) rotate(22)">
        <rect x="-4" y="0" width="8" height="115" rx="3" fill="${bladeColor}" stroke="#fff" stroke-width="1.5"/>
        <rect x="-14" y="110" width="28" height="7" rx="2" fill="#f59e0b"/>
        <rect x="-4" y="117" width="8" height="22" fill="#78350f"/>
      </g>
    ` : ''}

    <!-- Cape -->
    <path d="M65,95 L42,205 L158,205 L135,95 Z" fill="${armor}" opacity="0.65"/>

    <!-- Back Hair (Longer for Female) -->
    ${isFemale ? `<path d="M62,55 Q52,115 65,145 L135,145 Q148,115 138,55 Z" fill="${hair}"/>` : ''}

    <!-- Boots & Legs -->
    <rect x="74" y="165" width="18" height="58" rx="6" fill="#334155"/>
    <rect x="108" y="165" width="18" height="58" rx="6" fill="#334155"/>
    <rect x="72" y="195" width="22" height="30" rx="5" fill="#78350f"/>
    <rect x="106" y="195" width="22" height="30" rx="5" fill="#78350f"/>

    <!-- Torso / Armor -->
    <path d="${isFemale ? 'M72,92 L128,92 L122,168 L78,168 Z' : 'M66,92 L134,92 L126,168 L74,168 Z'}"
      fill="${armor}" stroke="#e2e8f0" stroke-width="2"/>
    <!-- Chest Trim -->
    <path d="M82,92 L100,122 L118,92" fill="none" stroke="#fbbf24" stroke-width="3"/>
    <!-- Belt -->
    <rect x="74" y="152" width="52" height="10" rx="3" fill="#451a03"/>
    <rect x="94" y="150" width="12" height="14" rx="2" fill="#fbbf24"/>

    <!-- Shoulder Pauldrons -->
    <circle cx="64" cy="102" r="14" fill="${armor}" stroke="#fbbf24" stroke-width="2"/>
    <circle cx="136" cy="102" r="14" fill="${armor}" stroke="#fbbf24" stroke-width="2"/>

    <!-- Arms -->
    <rect x="52" y="110" width="14" height="45" rx="6" fill="#fcd34d"/>
    <rect x="134" y="110" width="14" height="45" rx="6" fill="#fcd34d"/>

    <!-- Head -->
    <circle cx="100" cy="64" r="28" fill="#fde68a"/>
    <!-- Anime Eyes -->
    <ellipse cx="90" cy="66" rx="3.5" ry="5" fill="#1e293b"/>
    <ellipse cx="110" cy="66" rx="3.5" ry="5" fill="#1e293b"/>
    <circle cx="91" cy="64" r="1.2" fill="#fff"/>
    <circle cx="111" cy="64" r="1.2" fill="#fff"/>
    <path d="M95,77 Q100,81 105,77" fill="none" stroke="#92400e" stroke-width="2" stroke-linecap="round"/>

    <!-- Front Spiky/Styled Hair -->
    <path d="M68,60 Q70,26 100,28 Q130,26 132,60 Q122,42 110,52 Q100,38 90,52 Q78,42 68,60 Z" fill="${hair}"/>

    <!-- Equipped Headgear Circlet/Crown -->
    ${hasHeadgear ? `
      <path d="M74,46 Q100,54 126,46" fill="none" stroke="#38bdf8" stroke-width="4"/>
      <polygon points="100,42 105,50 100,56 95,50" fill="#fbbf24"/>
    ` : ''}
  `;
}

// --- 3. CUSTOMIZER CONTROLS ---
function initSwatches() {
  document.getElementById('hair-swatches').innerHTML = HAIR_COLORS.map(c =>
    `<div class="swatch ${hero.avatar.hairColor === c ? 'active' : ''}" style="background:${c}" onclick="setHair('${c}')"></div>`
  ).join('');

  document.getElementById('armor-swatches').innerHTML = ARMOR_COLORS.map(c =>
    `<div class="swatch ${hero.avatar.armorColor === c ? 'active' : ''}" style="background:${c}" onclick="setArmor('${c}')"></div>`
  ).join('');
}

function setGender(g) {
  hero.gender = g;
  hasUnsaved = true;
  renderAll();
}
function setHair(c) {
  hero.avatar.hairColor = c;
  hasUnsaved = true;
  initSwatches();
  renderCharacterSVG();
}
function setArmor(c) {
  hero.avatar.armorColor = c;
  hasUnsaved = true;
  initSwatches();
  renderCharacterSVG();
}

// --- 4. STATS & COMBAT POWER ---
function getTotalCP() {
  const s = hero.stats;
  let cp = (s.str * 15) + (s.agi * 12) + (s.vit * 12) + (s.int * 15);
  Object.values(hero.equipped).forEach(item => {
    if (item) cp += (item.power * 10);
  });
  return cp;
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

// --- 5. 5-SLOT EQUIPMENT & ARMORY (NO DUPLICATES) ---
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
      <div class="gear-stat">${item ? `[${item.rarity}] +${item.power}` : 'Tap to Equip'}</div>
    `;
  });
}

function openArmory(slotFilter) {
  const modal = document.getElementById('armory-modal');
  const list = document.getElementById('armory-items');
  document.getElementById('armory-title').innerText = slotFilter === 'all' ? '🎒 All Unlocked Gear' : `🎒 Select ${slotFilter.toUpperCase()}`;

  const items = slotFilter === 'all'
    ? hero.inventory
    : hero.inventory.filter(i => i.slot === slotFilter);

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
  `).join('') || '<p style="text-align:center; color:var(--muted); padding:20px;">No gear found for this slot yet. Climb the Tower Raid!</p>';

  modal.classList.remove('hidden');
}

function closeArmory() {
  document.getElementById('armory-modal').classList.add('hidden');
}

function equipGear(itemId) {
  const item = hero.inventory.find(i => i.id === itemId);
  if (!item) return;
  hero.equipped[item.slot] = item;
  hasUnsaved = true;
  closeArmory();
  renderAll();
}

// --- 6. INFINITE TOWER RAID ---
function getFloorEnemy(floor) {
  const isBoss = floor % 10 === 0;
  const reqCP = Math.floor(250 * Math.pow(1.15, floor - 1));
  return {
    isBoss,
    reqCP,
    name: isBoss ? `FLOOR ${floor}: Dragon Overlord (BOSS)` : `FLOOR ${floor}: Cave Orc Guard`,
    icon: isBoss ? '🐉' : '👹'
  };
}

function renderTower() {
  const enemy = getFloorEnemy(hero.towerFloor);
  document.getElementById('tower-floor-label').innerText = enemy.name;
  document.getElementById('tower-req-cp').innerText = enemy.reqCP.toLocaleString() + " CP";
  document.getElementById('tower-monster-icon').innerText = enemy.icon;
}

function challengeTower() {
  const enemy = getFloorEnemy(hero.towerFloor);
  const myCP = getTotalCP();
  const resBox = document.getElementById('raid-result');

  if (myCP >= enemy.reqCP) {
    // Overwrite floor progress (+1)
    hero.towerFloor++;
    hasUnsaved = true;

    // Rarity Roll
    const roll = Math.random() * 100;
    let rarity = 'Common';
    if (enemy.isBoss) {
      rarity = roll < 30 ? 'Legendary' : roll < 75 ? 'Epic' : 'Rare';
    } else {
      rarity = roll < 4 ? 'Legendary' : roll < 18 ? 'Epic' : roll < 50 ? 'Rare' : 'Common';
    }

    const pool = LOOT_TABLE.filter(i => i.rarity === rarity);
    const drop = pool[Math.floor(Math.random() * pool.length)];

    // Duplicate Check
    const exists = hero.inventory.some(i => i.id === drop.id);
    if (!exists) {
      hero.inventory.push(drop);
      resBox.innerHTML = `<span style="color:#4ade80;">🎉 VICTORY! Obtained [${drop.rarity}] ${drop.name}!</span>`;
    } else {
      resBox.innerHTML = `<span style="color:#fbbf24;">⚔️ VICTORY! Floor cleared! (Duplicate ${drop.name} converted)</span>`;
    }

    renderAll();
    if (enemy.isBoss) syncProgress(); // Auto-save on Boss clear
  } else {
    resBox.innerHTML = `<span style="color:#f87171;">💀 Defeated! Need ${(enemy.reqCP - myCP).toLocaleString()} more CP.</span>`;
  }
}

// --- 7. MASTER RENDER & CLOUD SYNC ---
function renderAll() {
  document.getElementById('hud-name').innerText = hero.name;
  document.getElementById('hud-id').innerText = hero.studentId;
  document.getElementById('hud-floor').innerText = hero.towerFloor;
  document.getElementById('hud-cp').innerText = getTotalCP().toLocaleString();
  document.getElementById('hud-pts').innerText = hero.unspentPoints;
  document.getElementById('panel-pts').innerText = hero.unspentPoints;
  document.getElementById('top-gender-icon').innerText = hero.gender === 'Male' ? '♂️' : '♀️';

  document.getElementById('btn-male').classList.toggle('active', hero.gender === 'Male');
  document.getElementById('btn-female').classList.toggle('active', hero.gender === 'Female');

  renderCharacterSVG();
  renderSlots();
  renderStats();
  renderTower();
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
  t.innerText = msg;
  t.style.background = bg;
  t.style.display = 'block';
}
function hideToast() {
  document.getElementById('toast').style.display = 'none';
}

window.addEventListener('beforeunload', (e) => {
  if (hasUnsaved) { e.preventDefault(); e.returnValue = ''; }
});
