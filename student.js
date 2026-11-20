const API_URL = "https://script.google.com/macros/s/AKfycbxPN7yKyqOwyyxIarj2BTkIcuMOomlfc52zCo2vK4AcVWg8TRofqKaRR-kj1yKiLiENWA/exec";

let hero = null;
let hasUnsaved = false;
let isBattling = false;

// Built-in SVG fallback sprites so the game looks great even before the teacher uploads custom art
const DEFAULT_SPRITES = {
  Male: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><circle cx="80" cy="48" r="22" fill="#fde68a"/><path d="M56,44 Q60,18 80,20 Q100,18 104,44 Q92,30 80,38 Q68,30 56,44 Z" fill="#3b2314"/><rect x="56" y="74" width="48" height="62" rx="10" fill="#2563eb"/><rect x="60" y="136" width="16" height="48" rx="5" fill="#1e293b"/><rect x="84" y="136" width="16" height="48" rx="5" fill="#1e293b"/><rect x="112" y="30" width="7" height="95" rx="3" fill="#38bdf8"/></svg>`),
  Female: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><path d="M52,44 Q45,95 56,120 L104,120 Q115,95 108,44 Z" fill="#92400e"/><circle cx="80" cy="48" r="21" fill="#fde68a"/><path d="M58,44 Q62,18 80,20 Q98,18 102,44 Z" fill="#92400e"/><path d="M60,74 L100,74 L106,136 L54,136 Z" fill="#7c3aed"/><rect x="62" y="136" width="14" height="48" rx="5" fill="#1e293b"/><rect x="84" y="136" width="14" height="48" rx="5" fill="#1e293b"/><rect x="112" y="30" width="7" height="95" rx="3" fill="#fbbf24"/></svg>`),
  Mob: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 180"><ellipse cx="80" cy="100" rx="52" ry="46" fill="#16a34a"/><circle cx="62" cy="88" r="8" fill="#fef08a"/><circle cx="98" cy="88" r="8" fill="#fef08a"/><circle cx="62" cy="88" r="4" fill="#000"/><circle cx="98" cy="88" r="4" fill="#000"/><path d="M58,118 Q80,104 102,118" stroke="#052e16" stroke-width="5" fill="none"/></svg>`),
  Boss: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 190"><polygon points="30,40 60,70 45,90" fill="#dc2626"/><polygon points="150,40 120,70 135,90" fill="#dc2626"/><ellipse cx="90" cy="105" rx="60" ry="54" fill="#7f1d1d" stroke="#fbbf24" stroke-width="4"/><circle cx="68" cy="92" r="10" fill="#fbbf24"/><circle cx="112" cy="92" r="10" fill="#fbbf24"/><path d="M60,126 L75,116 L90,126 L105,116 L120,126" stroke="#fff" stroke-width="4" fill="none"/></svg>`)
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

async function loginStudent() {
  const studentId = document.getElementById('student-id-input').value.trim();
  if (!studentId) return alert("Enter your Student ID.");

  showToast("Loading Hero...", "#3b82f6");
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'studentLogin', studentId })
    });
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);

    hero = json.data;
    if (!hero.gender) hero.gender = 'Male';
    if (!hero.avatar) hero.avatar = {};

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');

    renderAll();
    hideToast();
  } catch (err) {
    hideToast();
    alert("Login Error: " + err.message);
  }
}

// --- CHARACTER DESIGN & GENDER ---
function getActiveHeroSprite() {
  if (hero.avatar.selectedAssetId) {
    const found = (hero.assets || []).find(a => a.assetId === hero.avatar.selectedAssetId);
    if (found) return found.imageData;
  }
  return DEFAULT_SPRITES[hero.gender] || DEFAULT_SPRITES.Male;
}

function setGender(g) {
  hero.gender = g;
  // Auto-select first matching teacher character design for that gender if available
  const matching = (hero.assets || []).filter(a => a.type === 'character' && a.gender === g);
  hero.avatar.selectedAssetId = matching.length > 0 ? matching[0].assetId : null;
  hasUnsaved = true;
  renderAll();
}

function selectCharacterSkin(assetId) {
  hero.avatar.selectedAssetId = assetId;
  hasUnsaved = true;
  renderAll();
}

function renderCharacterOptions() {
  const container = document.getElementById('character-options');
  const genderSkins = (hero.assets || []).filter(a => a.type === 'character' && a.gender === hero.gender);

  // Include default hero + any teacher-uploaded designs for the chosen gender
  const options = [
    { assetId: null, name: `Default ${hero.gender}`, imageData: DEFAULT_SPRITES[hero.gender] },
    ...genderSkins
  ];

  container.innerHTML = options.map(opt => `
    <div class="char-option ${hero.avatar.selectedAssetId === opt.assetId ? 'active' : ''}"
         onclick="selectCharacterSkin(${opt.assetId ? `'${opt.assetId}'` : 'null'})">
      <img src="${opt.imageData}">
      <div style="font-size:10px; font-weight:700; margin-top:3px;">${opt.name}</div>
    </div>
  `).join('');
}

// --- STATS & CP ---
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

// --- 5-SLOT GEAR & ARMORY (NO DUPLICATES) ---
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
  `).join('') || '<p style="text-align:center; color:var(--muted); padding:20px;">No items unlocked yet. Defeat Tower floors!</p>';

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

// --- MISCRITS-STYLE TOWER ARENA & TEACHER MOBS/BOSSES ---
function getFloorEnemy(floor) {
  const isBoss = floor % 10 === 0;
  const reqCP = Math.floor(250 * Math.pow(1.15, floor - 1));
  const assets = hero.assets || [];

  // Match teacher-uploaded Boss or Mob by floor rule
  const targetType = isBoss ? 'boss' : 'mob';
  const specific = assets.find(a => a.type === targetType && a.floorRule === String(floor));
  const generalPool = assets.filter(a => a.type === targetType && a.floorRule === 'all');
  const chosen = specific || (generalPool.length > 0 ? generalPool[(floor - 1) % generalPool.length] : null);

  return {
    isBoss,
    reqCP,
    name: chosen ? chosen.name : (isBoss ? `Floor ${floor} Boss` : `Floor ${floor} Guardian`),
    image: chosen ? chosen.imageData : (isBoss ? DEFAULT_SPRITES.Boss : DEFAULT_SPRITES.Mob)
  };
}

function renderArena() {
  const enemy = getFloorEnemy(hero.towerFloor);
  document.getElementById('tower-floor-badge').innerText = enemy.isBoss ? `🔥 FLOOR ${hero.towerFloor} BOSS` : `FLOOR ${hero.towerFloor}`;
  document.getElementById('arena-hero-name').innerText = hero.name;
  document.getElementById('arena-hero-cp').innerText = getTotalCP().toLocaleString() + " CP";
  document.getElementById('arena-enemy-name').innerText = enemy.name;
  document.getElementById('arena-enemy-cp').innerText = enemy.reqCP.toLocaleString() + " CP";

  document.getElementById('arena-hero-img').src = getActiveHeroSprite();
  document.getElementById('arena-enemy-img').src = enemy.image;
  document.getElementById('hero-hp-bar').style.width = '100%';
  document.getElementById('enemy-hp-bar').style.width = '100%';
}

function battleTower() {
  if (isBattling) return;
  isBattling = true;

  const enemy = getFloorEnemy(hero.towerFloor);
  const myCP = getTotalCP();
  const heroImg = document.getElementById('arena-hero-img');
  const enemyImg = document.getElementById('arena-enemy-img');
  const resBox = document.getElementById('raid-result');

  // Step 1: Hero lunges forward (Miscrits attack feel)
  heroImg.classList.add('lunge-right');
  setTimeout(() => {
    enemyImg.classList.add('hit-flash');
    document.getElementById('enemy-hp-bar').style.width = myCP >= enemy.reqCP ? '0%' : '65%';
  }, 180);

  setTimeout(() => {
    heroImg.classList.remove('lunge-right');
    enemyImg.classList.remove('hit-flash');

    if (myCP >= enemy.reqCP) {
      // Victory! Overwrite floor progress (+1)
      hero.towerFloor++;
      hasUnsaved = true;

      const roll = Math.random() * 100;
      let rarity = 'Common';
      if (enemy.isBoss) rarity = roll < 30 ? 'Legendary' : roll < 75 ? 'Epic' : 'Rare';
      else rarity = roll < 4 ? 'Legendary' : roll < 18 ? 'Epic' : roll < 50 ? 'Rare' : 'Common';

      const pool = LOOT_TABLE.filter(i => i.rarity === rarity);
      const drop = pool[Math.floor(Math.random() * pool.length)];

      // Duplicate check
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
      // Enemy counter-attack!
      enemyImg.classList.add('lunge-left');
      setTimeout(() => {
        heroImg.classList.add('hit-flash');
        document.getElementById('hero-hp-bar').style.width = '10%';
      }, 180);
      setTimeout(() => {
        enemyImg.classList.remove('lunge-left');
        heroImg.classList.remove('hit-flash');
        resBox.innerHTML = `<span style="color:#f87171;">💀 Defeated! Need ${(enemy.reqCP - myCP).toLocaleString()} more CP.</span>`;
      }, 450);
    }
    isBattling = false;
  }, 450);
}

// --- MASTER RENDER & CLOUD SYNC ---
function renderAll() {
  document.getElementById('hud-name').innerText = hero.name;
  document.getElementById('hud-id').innerText = hero.studentId;
  document.getElementById('hud-floor').innerText = hero.towerFloor;
  document.getElementById('hud-cp').innerText = getTotalCP().toLocaleString();
  document.getElementById('hud-pts').innerText = hero.unspentPoints;
  document.getElementById('panel-pts').innerText = hero.unspentPoints;

  document.getElementById('btn-male').classList.toggle('active', hero.gender === 'Male');
  document.getElementById('btn-female').classList.toggle('active', hero.gender === 'Female');

  document.getElementById('hero-sprite-display').src = getActiveHeroSprite();
  renderCharacterOptions();
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
  t.innerText = msg; t.style.background = bg; t.style.display = 'block';
}
function hideToast() { document.getElementById('toast').style.display = 'none'; }

window.addEventListener('beforeunload', (e) => {
  if (hasUnsaved) { e.preventDefault(); e.returnValue = ''; }
});
