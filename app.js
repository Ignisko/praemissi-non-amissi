// Application State
let currentLanguage = localStorage.getItem('pna_lang') || 'pl';
let currentFilter = 'all';
let searchQuery = '';
let activeProfId = null;
let leafletMap = null;
let markersMap = {};

// Local Storage Keys
const STORAGE_AUTH = 'pna_auth_session';
const STORAGE_ACTIONS_PREFIX = 'pna_actions_';

// Check if user is logged in
function getAuthUser() {
  try {
    const raw = localStorage.getItem(STORAGE_AUTH);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Get user prayer/visit actions for current account
function getUserActions() {
  const user = getAuthUser();
  if (!user) {
    return { prayed: {}, visited: {} };
  }
  const userKey = STORAGE_ACTIONS_PREFIX + user.username.toLowerCase();
  try {
    const raw = localStorage.getItem(userKey);
    return raw ? JSON.parse(raw) : { prayed: {}, visited: {} };
  } catch (e) {
    return { prayed: {}, visited: {} };
  }
}

function saveUserActions(actions) {
  const user = getAuthUser();
  if (!user) return;
  const userKey = STORAGE_ACTIONS_PREFIX + user.username.toLowerCase();
  localStorage.setItem(userKey, JSON.stringify(actions));
}

// Language Handling (PL / EN)
function setLanguage(lang) {
  currentLanguage = lang;
  localStorage.setItem('pna_lang', lang);

  document.body.classList.remove('is-pl', 'is-en');
  document.body.classList.add(`is-${lang}`);

  const btnPl = document.getElementById('btn-lang-pl');
  const btnEn = document.getElementById('btn-lang-en');

  if (lang === 'pl') {
    btnPl.className = 'px-2.5 py-1 rounded text-xs font-semibold bg-amber-900/60 text-amber-200 border border-amber-700/50';
    btnEn.className = 'px-2.5 py-1 rounded text-xs font-semibold text-stone-400 hover:text-stone-200';
    document.getElementById('search-input').placeholder = 'Wyszukaj po nazwisku, kwaterze (np. XVIII, LXVII), roczniku...';
  } else {
    btnEn.className = 'px-2.5 py-1 rounded text-xs font-semibold bg-amber-900/60 text-amber-200 border border-amber-700/50';
    btnPl.className = 'px-2.5 py-1 rounded text-xs font-semibold text-stone-400 hover:text-stone-200';
    document.getElementById('search-input').placeholder = 'Search by name, grave sector (e.g. XVIII, LXVII), year...';
  }

  updateAuthUI();
  renderCatalog();
  if (leafletMap) renderMapMarkers();
}

// Initialise App
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLanguage);
  updateAuthUI();
  renderCatalog();
  initMap();
  lucide.createIcons();
});

// Update Auth UI (Login state)
function updateAuthUI() {
  const user = getAuthUser();
  const label = document.getElementById('account-btn-label');
  const logoutBtn = document.getElementById('btn-logout');

  if (user) {
    label.innerHTML = `<span>${user.username}</span>`;
    logoutBtn.classList.remove('hidden');
  } else {
    label.innerHTML = currentLanguage === 'pl' 
      ? '<span class="lang-pl">Zaloguj się</span>' 
      : '<span class="lang-en">Sign In</span>';
    logoutBtn.classList.add('hidden');
  }

  updateStatsBadge();
}

// Stats Badge
function updateStatsBadge() {
  const actions = getUserActions();
  const prayedCount = Object.keys(actions.prayed).length;
  const visitedCount = Object.keys(actions.visited).length;

  document.getElementById('stat-prayed-count').innerText = prayedCount;
  document.getElementById('stat-visited-count').innerText = visitedCount;

  const jPrayed = document.getElementById('journal-prayed-count');
  const jVisited = document.getElementById('journal-visited-count');
  if (jPrayed) jPrayed.innerText = prayedCount;
  if (jVisited) jVisited.innerText = visitedCount;
}

// Navigation between tabs
function switchView(viewName) {
  const views = ['catalog', 'map', 'guide', 'journal'];
  views.forEach(v => {
    const sec = document.getElementById(`view-${v}`);
    const tab = document.getElementById(`tab-${v}`);
    if (v === viewName) {
      sec.classList.remove('hidden');
      tab.className = 'py-2.5 px-4 flex items-center gap-2 border-b-2 border-candle text-candle transition whitespace-nowrap';
    } else {
      sec.classList.add('hidden');
      tab.className = 'py-2.5 px-4 flex items-center gap-2 border-b-2 border-transparent text-stone-400 hover:text-stone-200 transition whitespace-nowrap';
    }
  });

  const filtersBar = document.getElementById('filters-bar');
  if (viewName === 'catalog') {
    filtersBar.classList.remove('hidden');
  } else {
    filtersBar.classList.add('hidden');
  }

  if (viewName === 'map' && leafletMap) {
    setTimeout(() => leafletMap.invalidateSize(), 200);
  }

  if (viewName === 'journal') {
    renderJournal();
  }

  lucide.createIcons();
}

// Search and Filter logic
function handleSearch() {
  searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
  renderCatalog();
}

function setFilter(filterType) {
  currentFilter = filterType;
  const buttons = ['all', 'uj', 'agh', 'prayed', 'visited', 'rector'];
  buttons.forEach(b => {
    const btn = document.getElementById(`btn-filter-${b}`);
    if (!btn) return;
    if (b === filterType) {
      btn.className = 'px-3 py-1.5 rounded-lg border bg-amber-500 text-black font-bold border-amber-400 whitespace-nowrap shadow-md transition';
    } else {
      btn.className = 'px-3 py-1.5 rounded-lg border bg-stone-900 text-stone-200 border-stone-700 hover:border-amber-400 whitespace-nowrap transition';
    }
  });
  renderCatalog();
}

function getFilteredProfessors() {
  const actions = getUserActions();
  return PROFESSORS_DATA.filter(prof => {
    const searchMatch = !searchQuery ||
      prof.name.toLowerCase().includes(searchQuery) ||
      prof.grave_location.toLowerCase().includes(searchQuery) ||
      prof.years.toLowerCase().includes(searchQuery) ||
      prof.biography.toLowerCase().includes(searchQuery);

    if (!searchMatch) return false;

    if (currentFilter === 'uj') {
      return prof.university === 'UJ';
    } else if (currentFilter === 'agh') {
      return prof.university === 'AGH';
    } else if (currentFilter === 'prayed') {
      return !!actions.prayed[prof.id];
    } else if (currentFilter === 'visited') {
      return !!actions.visited[prof.id];
    } else if (currentFilter === 'rector') {
      return prof.biography.toLowerCase().includes('rektor');
    }
    return true;
  });
}

// Render Catalog Grid
function renderCatalog() {
  const grid = document.getElementById('professors-grid');
  const empty = document.getElementById('empty-results');
  const filtered = getFilteredProfessors();
  const actions = getUserActions();
  const isEn = currentLanguage === 'en';

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = filtered.map(prof => {
    const isPrayed = !!actions.prayed[prof.id];
    const isVisited = !!actions.visited[prof.id];

    return `
      <div class="bg-tombstone rounded-2xl border border-stone-800/80 hover:border-stone-700 transition duration-300 overflow-hidden flex flex-col shadow-xl group">
        
        <!-- Card Image Header -->
        <div class="relative h-48 bg-stone-950 overflow-hidden flex items-center justify-center cursor-pointer" onclick="openProfModal(${prof.id})">
          ${prof.tomb_img ? `
            <img src="${prof.tomb_img}" alt="Grób ${prof.name}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500 opacity-75 group-hover:opacity-100" />
          ` : `
            <div class="text-stone-600 flex flex-col items-center">
              <i data-lucide="cross" class="w-8 h-8 mb-1"></i>
              <span class="text-xs">${isEn ? 'No photo available' : 'Brak zdjęcia'}</span>
            </div>
          `}

          <!-- Portrait Overlay Thumbnail -->
          ${prof.portrait ? `
            <div class="absolute bottom-2.5 left-3 w-16 h-16 rounded-xl border border-stone-800 overflow-hidden shadow-2xl bg-stone-900">
              <img src="${prof.portrait}" alt="${prof.name}" class="w-full h-full object-cover" />
            </div>
          ` : ''}

          <!-- Status badges -->
          <div class="absolute top-2.5 right-2.5 flex flex-col gap-1 items-end">
            ${isPrayed ? `
              <span class="bg-amber-950/90 border border-amber-600 text-amber-300 text-[11px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 shadow-md">
                <i data-lucide="flame" class="w-3 h-3 fill-amber-400"></i> ${isEn ? 'Prayed' : 'Omodlony'}
              </span>
            ` : ''}
            ${isVisited ? `
              <span class="bg-emerald-950/90 border border-emerald-600 text-emerald-300 text-[11px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 shadow-md">
                <i data-lucide="check" class="w-3 h-3"></i> ${isEn ? 'Visited' : 'Odwiedzony'}
              </span>
            ` : ''}
          </div>
        </div>

        <!-- Card Body -->
        <div class="p-5 flex-1 flex flex-col justify-between">
          <div>
            <h3 onclick="openProfModal(${prof.id})" class="text-base font-bold font-cinzel text-amber-100 hover:text-candle cursor-pointer transition">
              ${prof.name}
            </h3>
            <p class="text-xs text-stone-400 font-mono mb-3">${prof.years}</p>

            <div class="bg-stone-900/80 p-2.5 rounded-lg border border-stone-800/80 mb-3 text-xs flex items-start gap-2">
              <i data-lucide="map-pin" class="w-3.5 h-3.5 text-candle shrink-0 mt-0.5"></i>
              <span class="text-stone-300 leading-tight">${prof.grave_location || (isEn ? 'Rakowicki Cemetery' : 'Cmentarz Rakowicki')}</span>
            </div>

            <p class="text-xs text-stone-400 line-clamp-3 leading-relaxed mb-4">
              ${prof.biography.replace(/(\r\n|\n|\r)/gm, " ")}
            </p>
          </div>

          <!-- Action buttons -->
          <div class="grid grid-cols-2 gap-2 pt-3 border-t border-stone-800/80 text-xs">
            <button 
              onclick="handlePrayClick(${prof.id})" 
              class="py-2 px-3 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition ${isPrayed ? 'bg-amber-950/60 border-amber-600 text-amber-300' : 'bg-stone-900 border-stone-800 text-stone-300 hover:border-amber-600'}"
            >
              <i data-lucide="flame" class="w-3.5 h-3.5 ${isPrayed ? 'fill-amber-400 candle-flame' : ''}"></i>
              <span>${isPrayed ? (isEn ? 'I prayed' : 'Pomodliłem się') : (isEn ? 'I prayed' : 'Pomodliłem się')}</span>
            </button>

            <button 
              onclick="handleVisitClick(${prof.id})" 
              class="py-2 px-3 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition ${isVisited ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300' : 'bg-stone-900 border-stone-800 text-stone-300 hover:border-emerald-600'}"
            >
              <i data-lucide="check" class="w-3.5 h-3.5"></i>
              <span>${isVisited ? (isEn ? 'I visited' : 'Odwiedziłem') : (isEn ? 'I visited' : 'Odwiedziłem')}</span>
            </button>
          </div>

        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// Map Initialization
function initMap() {
  const rakowickiCenter = [50.0754, 19.9542];
  
  leafletMap = L.map('leaflet-map', {
    center: rakowickiCenter,
    zoom: 16,
    maxZoom: 19,
    minZoom: 14
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors | Praemissi Non Amissi'
  }).addTo(leafletMap);

  renderMapMarkers();
}

function renderMapMarkers() {
  if (!leafletMap) return;
  const actions = getUserActions();

  // Clear existing
  Object.values(markersMap).forEach(m => leafletMap.removeLayer(m));
  markersMap = {};

  PROFESSORS_DATA.forEach(prof => {
    const isVisited = !!actions.visited[prof.id];
    const isPrayed = !!actions.prayed[prof.id];

    const iconHtml = `
      <div class="grave-marker ${isVisited ? 'visited' : ''}" style="width: 26px; height: 26px;">
        ${isPrayed ? '🕯️' : prof.id}
      </div>
    `;

    const customIcon = L.divIcon({
      className: 'grave-div-icon',
      html: iconHtml,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const marker = L.marker([prof.lat, prof.lng], { icon: customIcon }).addTo(leafletMap);

    const isEn = currentLanguage === 'en';
    const popupHtml = `
      <div style="font-family: inherit; min-width: 200px; color: #1c1917;">
        <b style="font-size: 13px; color: #92400e; display: block; margin: 2px 0;">${prof.name}</b>
        <div style="font-size: 11px; color: #57534e; margin-bottom: 4px;">${prof.years}</div>
        <div style="font-size: 11px; margin-bottom: 6px;">📍 ${prof.grave_location}</div>
        <button onclick="openProfModal(${prof.id})" style="background: #a37036; color: white; border: none; padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; width: 100%;">
          ${isEn ? 'View Profile & Pray' : 'Szczegóły & Modlitwa'}
        </button>
      </div>
    `;

    marker.bindPopup(popupHtml);
    markersMap[prof.id] = marker;
  });
}

// Interaction Requirements: Check login first
function ensureLogin() {
  const user = getAuthUser();
  if (!user) {
    openLoginModal();
    return false;
  }
  return true;
}

function handlePrayClick(id) {
  if (!ensureLogin()) return;
  const actions = getUserActions();
  if (actions.prayed[id]) {
    delete actions.prayed[id];
  } else {
    actions.prayed[id] = new Date().toISOString();
  }
  saveUserActions(actions);
  updateStatsBadge();
  renderCatalog();
  renderMapMarkers();
  updateModalButtons(id);
}

function handleVisitClick(id) {
  if (!ensureLogin()) return;
  const actions = getUserActions();
  if (actions.visited[id]) {
    delete actions.visited[id];
  } else {
    actions.visited[id] = new Date().toISOString();
  }
  saveUserActions(actions);
  updateStatsBadge();
  renderCatalog();
  renderMapMarkers();
  updateModalButtons(id);
}

function handleModalPrayClick() {
  if (activeProfId) handlePrayClick(activeProfId);
}

function handleModalVisitClick() {
  if (activeProfId) handleVisitClick(activeProfId);
}

// Modal handling
function openProfModal(id) {
  activeProfId = id;
  const prof = PROFESSORS_DATA.find(p => p.id === id);
  if (!prof) return;

  const isEn = currentLanguage === 'en';
  document.getElementById('modal-prof-name').innerText = prof.name;
  document.getElementById('modal-prof-years').innerText = `${prof.years} • ${prof.death_info || ''}`;
  document.getElementById('modal-prof-grave').innerText = prof.grave_location;
  document.getElementById('modal-prof-bio').innerText = prof.biography;

  const photosBox = document.getElementById('modal-header-photos');
  let photosHtml = '';
  if (prof.portrait) {
    photosHtml += `
      <div class="h-44 rounded-xl overflow-hidden bg-stone-950 flex flex-col items-center justify-center border border-stone-800">
        <img src="${prof.portrait}" alt="${prof.name}" class="h-full object-contain" />
        <span class="text-[10px] text-stone-500 py-1">${isEn ? 'Portrait' : 'Portret'}</span>
      </div>
    `;
  }
  if (prof.tomb_img) {
    photosHtml += `
      <div class="h-44 rounded-xl overflow-hidden bg-stone-950 flex flex-col items-center justify-center border border-stone-800">
        <img src="${prof.tomb_img}" alt="Tomb ${prof.name}" class="h-full object-contain" />
        <span class="text-[10px] text-stone-500 py-1">${isEn ? 'Tomb Photo' : 'Fotografia nagrobka'}</span>
      </div>
    `;
  }
  photosBox.innerHTML = photosHtml || `<div class="text-xs text-stone-500 p-4 col-span-2 text-center">${isEn ? 'No photographs attached' : 'Brak dołączonych fotografii'}</div>`;

  updateModalButtons(id);

  document.getElementById('prof-modal').classList.remove('hidden');
  lucide.createIcons();
}

function updateModalButtons(id) {
  if (activeProfId !== id) return;
  const actions = getUserActions();
  const isPrayed = !!actions.prayed[id];
  const isVisited = !!actions.visited[id];
  const isEn = currentLanguage === 'en';

  const prayBtn = document.getElementById('modal-pray-btn');
  const visitBtn = document.getElementById('modal-visit-btn');

  if (isPrayed) {
    prayBtn.className = 'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border font-medium text-xs sm:text-sm transition bg-amber-950 border-amber-500 text-amber-200';
    prayBtn.innerHTML = `<i data-lucide="flame" class="w-4 h-4 fill-amber-400 candle-flame"></i> <span>${isEn ? 'I prayed for this soul' : 'Pomodliłem się za tę duszę'}</span>`;
  } else {
    prayBtn.className = 'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border font-medium text-xs sm:text-sm transition bg-stone-900 border-stone-800 text-stone-300 hover:border-amber-500';
    prayBtn.innerHTML = `<i data-lucide="flame" class="w-4 h-4"></i> <span>${isEn ? 'I prayed for this soul' : 'Pomodliłem się za tę duszę'}</span>`;
  }

  if (isVisited) {
    visitBtn.className = 'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border font-medium text-xs sm:text-sm transition bg-emerald-950 border-emerald-500 text-emerald-200';
    visitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-emerald-400"></i> <span>${isEn ? 'I visited this tomb' : 'Odwiedziłem ten grób'}</span>`;
  } else {
    visitBtn.className = 'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border font-medium text-xs sm:text-sm transition bg-stone-900 border-stone-800 text-stone-300 hover:border-emerald-500';
    visitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> <span>${isEn ? 'I visited this tomb' : 'Odwiedziłem ten grób'}</span>`;
  }

  lucide.createIcons();
}

function closeProfModal() {
  document.getElementById('prof-modal').classList.add('hidden');
  activeProfId = null;
}

// Login Modal
function openLoginModal() {
  const user = getAuthUser();
  if (user) {
    document.getElementById('login-name-input').value = user.username;
  }
  document.getElementById('login-modal').classList.remove('hidden');
  lucide.createIcons();
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.add('hidden');
}

function handleSimpleLogin(event) {
  if (event) event.preventDefault();
  const username = document.getElementById('login-name-input').value.trim();
  if (!username) return;

  const session = {
    username: username,
    loggedInAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_AUTH, JSON.stringify(session));

  updateAuthUI();
  renderCatalog();
  renderMapMarkers();
  closeLoginModal();

  // If user was attempting to click pray/visit, re-check
  if (activeProfId) {
    updateModalButtons(activeProfId);
  }
}

function handleLogout() {
  localStorage.removeItem(STORAGE_AUTH);
  updateAuthUI();
  renderCatalog();
  renderMapMarkers();
  closeLoginModal();
}

// Render Journal
function renderJournal() {
  const user = getAuthUser();
  const list = document.getElementById('journal-list');
  const isEn = currentLanguage === 'en';

  if (!user) {
    list.innerHTML = `
      <div class="text-center py-10 text-stone-400 bg-stone-900/60 rounded-xl border border-stone-800 p-6">
        <i data-lucide="lock" class="w-8 h-8 mx-auto mb-2 text-candle"></i>
        <p class="text-sm font-semibold mb-1">${isEn ? 'Sign In to see your personal journal' : 'Zaloguj się, aby zobaczyć swój prywatny dziennik'}</p>
        <p class="text-xs text-stone-500 mb-4">${isEn ? 'Your prayers and visits will be preserved securely on this device.' : 'Twoje modlitwy i odwiedzone groby będą bezpiecznie zachowane na tym urządzeniu.'}</p>
        <button onclick="openLoginModal()" class="px-4 py-2 bg-candle text-stone-950 font-bold rounded-lg text-xs">
          ${isEn ? 'Sign In Now' : 'Zaloguj się teraz'}
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const actions = getUserActions();
  const allIds = Array.from(new Set([...Object.keys(actions.prayed), ...Object.keys(actions.visited)]));

  if (allIds.length === 0) {
    list.innerHTML = `
      <div class="text-center py-10 text-stone-500 border border-dashed border-stone-800 rounded-xl p-6">
        <i data-lucide="book-open" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
        <p class="text-sm">${isEn ? 'No prayer candles lit or visits recorded yet.' : 'Nie zapaliłeś jeszcze znicza ani nie oznaczyłeś odwiedzonych grobów.'}</p>
        <p class="text-xs text-stone-600 mt-1">${isEn ? 'Browse the catalog or map to offer your prayers for professors.' : 'Przeglądaj katalog lub mapę, aby ofiarować modlitwę za zmarłych profesorów.'}</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  list.innerHTML = allIds.map(idStr => {
    const id = parseInt(idStr);
    const prof = PROFESSORS_DATA.find(p => p.id === id);
    if (!prof) return '';

    const isPrayed = !!actions.prayed[id];
    const isVisited = !!actions.visited[id];

    return `
      <div class="bg-stone-900/80 p-3.5 sm:p-4 rounded-xl border border-stone-800 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          ${prof.portrait ? `
            <img src="${prof.portrait}" alt="${prof.name}" class="w-12 h-12 rounded-lg object-cover border border-stone-700 shrink-0">
          ` : `
            <div class="w-12 h-12 rounded-lg bg-stone-950 flex items-center justify-center text-stone-600 shrink-0">
              <i data-lucide="cross" class="w-5 h-5"></i>
            </div>
          `}
          <div>
            <div class="font-bold text-amber-100 text-sm hover:underline cursor-pointer" onclick="openProfModal(${prof.id})">
              ${prof.name}
            </div>
            <div class="text-[11px] text-stone-400">${prof.grave_location}</div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          ${isPrayed ? `
            <span class="text-[11px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60 flex items-center gap-1">
              <i data-lucide="flame" class="w-3 h-3 fill-amber-400"></i> ${isEn ? 'Prayed' : 'Znicz'}
            </span>
          ` : ''}
          ${isVisited ? `
            <span class="text-[11px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 flex items-center gap-1">
              <i data-lucide="check" class="w-3 h-3"></i> ${isEn ? 'Visited' : 'Odwiedzono'}
            </span>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}
