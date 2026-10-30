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

// "Prayed" on cards, in the modal and on the map means prayed today, like the shared counter.
// The journal and the "My prayers" filter keep the whole history.
function isPrayedToday(actions, id) {
  const ts = actions.prayed[id];
  return !!ts && warsawDate(new Date(ts)) === getTodayDateStr();
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
    document.getElementById('login-name-input').placeholder = 'np. Ignacy, Anna, Student...';
  } else {
    btnEn.className = 'px-2.5 py-1 rounded text-xs font-semibold bg-amber-900/60 text-amber-200 border border-amber-700/50';
    btnPl.className = 'px-2.5 py-1 rounded text-xs font-semibold text-stone-400 hover:text-stone-200';
    document.getElementById('search-input').placeholder = 'Search by name, grave sector (e.g. XVIII, LXVII), year...';
    document.getElementById('login-name-input').placeholder = 'e.g. Ignatius, Anna, Student...';
  }

  document.querySelectorAll('[data-alt-pl]').forEach(el => {
    el.alt = lang === 'pl' ? el.dataset.altPl : el.dataset.altEn;
  });

  updateAuthUI();
  renderCatalog();
  if (leafletMap) renderMapMarkers();
}

// Initialise App
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-prof-count]').forEach(el => { el.textContent = PROFESSORS_DATA.length; });
  updateFilterButtons();
  setLanguage(currentLanguage);
  updateAuthUI();
  renderCatalog();
  initMap();
  lucide.createIcons();
  startCommunitySync();
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

  if (viewName === 'map') {
    if (!leafletMap) {
      initMap();
    }
    setTimeout(() => leafletMap.invalidateSize(), 300);
  }

  if (viewName === 'journal') {
    renderJournal();
  }

  updateStaleChip();
  lucide.createIcons();
}

// Search and Filter logic
function handleSearch() {
  searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
  renderCatalog();
}

const FILTER_IDS = ['all', 'needs_prayer', 'prayed_today', 'uj', 'agh', 'prayed', 'visited', 'rector'];
const FILTER_BASE = 'px-3 py-1.5 rounded-lg border whitespace-nowrap transition flex items-center gap-1.5';
const FILTER_ACTIVE = `${FILTER_BASE} bg-amber-500 text-stone-950 font-bold border-amber-400 shadow-md`;
const FILTER_INACTIVE = `${FILTER_BASE} bg-stone-900 text-stone-200 border-stone-700 hover:border-amber-400`;
const FILTER_HIGHLIGHT = `${FILTER_BASE} bg-amber-950/60 text-amber-200 border-amber-600/80 hover:bg-amber-900/60 font-semibold`;

function updateFilterButtons() {
  FILTER_IDS.forEach(id => {
    const btn = document.getElementById(`btn-filter-${id}`);
    if (!btn) return;
    if (id === currentFilter) btn.className = FILTER_ACTIVE;
    else if (id === 'needs_prayer') btn.className = FILTER_HIGHLIGHT;
    else btn.className = FILTER_INACTIVE;
  });
}

function setFilter(filterType) {
  currentFilter = filterType;
  updateFilterButtons();
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

    if (currentFilter === 'needs_prayer') {
      // Za kogo dzisiaj nikt się jeszcze nie pomodlił
      return !getTodayCount(prof.id);
    } else if (currentFilter === 'prayed_today') {
      // Kto dzisiaj otrzymał modlitwę
      return getTodayCount(prof.id) > 0;
    } else if (currentFilter === 'uj') {
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

function prayersTodayLabel(n, isEn) {
  if (isEn) return `${n} ${n === 1 ? 'prayer' : 'prayers'} today`;
  const lastTwo = n % 100;
  const last = n % 10;
  let noun = 'modlitw';
  if (n === 1) noun = 'modlitwa';
  else if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) noun = 'modlitwy';
  return `${n} ${noun} dzisiaj`;
}

function communityBadgeHtml(id, isEn) {
  const n = getTodayCount(id);
  if (n > 0) {
    return `<span data-community-badge="${id}" class="bg-stone-950/90 border border-amber-600/70 text-amber-300 text-[11px] px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1 shadow-md backdrop-blur-sm" title="${isEn ? 'Prayers offered today' : 'Liczba modlitw ofiarowanych dzisiaj'}">
      <i data-lucide="flame" class="w-3 h-3 fill-amber-400"></i> ${prayersTodayLabel(n, isEn)}
    </span>`;
  }
  return `<span data-community-badge="${id}" class="bg-stone-950/90 border border-stone-700/80 text-stone-400 text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md backdrop-blur-sm">
    <i data-lucide="moon" class="w-3 h-3 text-stone-500"></i> ${isEn ? 'Waiting for prayer today' : 'Czeka na modlitwę dzisiaj'}
  </span>`;
}

function cardHtml(prof, actions, isEn) {
  const isPrayed = isPrayedToday(actions, prof.id);
  const isVisited = !!actions.visited[prof.id];

  return `
    <div data-card="${prof.id}" class="bg-tombstone rounded-2xl border border-stone-800/80 hover:border-stone-700 transition duration-300 overflow-hidden flex flex-col shadow-xl group">
      
      <!-- Card Image Header -->
      <div class="relative h-48 bg-stone-950 overflow-hidden flex items-center justify-center cursor-pointer" onclick="openProfModal(${prof.id})">
        ${prof.tomb_img ? `
          <img src="${prof.tomb_img}" alt="${isEn ? 'Tomb of' : 'Grób'} ${prof.name}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500 opacity-75 group-hover:opacity-100" />
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

        <!-- Status badges & Today prayer counter -->
        <div class="absolute top-2.5 right-2.5 flex flex-col gap-1 items-end">
          ${communityBadgeHtml(prof.id, isEn)}

          ${isPrayed ? `
            <span class="bg-amber-950/90 border border-amber-600 text-amber-300 text-[11px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 shadow-md">
              <i data-lucide="flame" class="w-3 h-3 fill-amber-400"></i> ${isEn ? 'Prayed by you' : 'Omodlony przez Ciebie'}
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
            <span>${isEn ? 'I prayed' : 'Pomodliłem się'}</span>
          </button>

          <button 
            onclick="handleVisitClick(${prof.id})" 
            class="py-2 px-3 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition ${isVisited ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300' : 'bg-stone-900 border-stone-800 text-stone-300 hover:border-emerald-600'}"
          >
            <i data-lucide="check" class="w-3.5 h-3.5"></i>
            <span>${isEn ? 'I visited' : 'Odwiedziłem'}</span>
          </button>
        </div>

      </div>
    </div>
  `;
}

// Ids currently shown in the grid. Live data never re-filters the grid under the
// user's finger; if the result set would differ we only offer a refresh (see updateStaleChip).
let renderedIds = [];

function renderCatalog() {
  const grid = document.getElementById('professors-grid');
  const empty = document.getElementById('empty-results');
  const filtered = getFilteredProfessors();
  const actions = getUserActions();
  const isEn = currentLanguage === 'en';

  renderedIds = filtered.map(p => p.id);
  updateStaleChip();

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = filtered.map(prof => cardHtml(prof, actions, isEn)).join('');
  lucide.createIcons();
}

// Re-render a single card in place (own pray/visit action).
function refreshCard(id) {
  const el = document.querySelector(`[data-card="${id}"]`);
  const prof = PROFESSORS_DATA.find(p => p.id === id);
  if (!el || !prof) return;
  el.outerHTML = cardHtml(prof, getUserActions(), currentLanguage === 'en');
  lucide.createIcons();
}

function updateStaleChip() {
  const chip = document.getElementById('stale-chip');
  if (!chip) return;
  if (document.getElementById('view-catalog').classList.contains('hidden')) {
    chip.classList.add('hidden');
    return;
  }
  const current = getFilteredProfessors().map(p => p.id);
  const same = current.length === renderedIds.length && current.every((id, i) => id === renderedIds[i]);
  chip.classList.toggle('hidden', same);
}

// Called by community.js with the ids whose "prayed today" count changed.
// Only the affected badges / counters are touched: no list, map or dialog is re-rendered.
function onCommunityChanged(ids) {
  const isEn = currentLanguage === 'en';
  ids.forEach(id => {
    const badge = document.querySelector(`[data-community-badge="${id}"]`);
    if (!badge) return;
    badge.outerHTML = communityBadgeHtml(id, isEn);
    const fresh = document.querySelector(`[data-community-badge="${id}"]`);
    if (fresh) fresh.classList.add('badge-pulse');
  });
  lucide.createIcons();
  if (activeProfId && ids.includes(activeProfId)) updateModalCount();
  updateStaleChip();
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
    attribution: '&copy; OpenStreetMap contributors | ZCK Kraków Locator'
  }).addTo(leafletMap);

  leafletMap.on('popupopen', () => lucide.createIcons());
  renderMapMarkers();
}

function makeMarkerIcon(prof, actions) {
  const isVisited = !!actions.visited[prof.id];
  const isPrayed = isPrayedToday(actions, prof.id);
  return L.divIcon({
    className: 'grave-div-icon',
    html: `<div class="grave-marker ${isPrayed ? 'prayed' : ''} ${isVisited ? 'visited' : ''}" style="width: 26px; height: 26px;">${prof.id}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

// Swap one marker's icon without touching the others, so an open popup stays open.
function updateMarker(id) {
  const marker = markersMap[id];
  const prof = PROFESSORS_DATA.find(p => p.id === id);
  if (marker && prof) marker.setIcon(makeMarkerIcon(prof, getUserActions()));
}

function renderMapMarkers() {
  if (!leafletMap) return;
  const actions = getUserActions();

  // Full rebuild: only for user-initiated changes (language, login), never for live data
  // Clear existing
  Object.values(markersMap).forEach(m => leafletMap.removeLayer(m));
  markersMap = {};

  const isEn = currentLanguage === 'en';

  PROFESSORS_DATA.forEach(prof => {
    const marker = L.marker([prof.lat, prof.lng], { icon: makeMarkerIcon(prof, actions) }).addTo(leafletMap);

    const popupHtml = `
      <div class="min-w-[220px]">
        <div class="font-cinzel font-bold text-sm text-amber-100 leading-snug">${prof.name}</div>
        <div class="text-[11px] text-stone-400 mb-2">${prof.years}</div>
        <div class="flex items-start gap-1.5 text-xs text-stone-300 mb-3">
          <i data-lucide="map-pin" class="w-3.5 h-3.5 text-candle shrink-0 mt-0.5"></i>
          <span>${prof.grave_location}</span>
        </div>
        <div class="flex gap-2">
          <button onclick="openProfModal(${prof.id})" class="flex-1 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold py-1.5 px-3 rounded-lg text-xs transition">
            ${isEn ? 'Details' : 'Szczegóły'}
          </button>
          <a href="https://www.zck-krakow.pl/locator" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 bg-stone-800 hover:bg-stone-700 text-amber-300 border border-stone-700 py-1.5 px-3 rounded-lg text-xs font-medium transition">
            ZCK <i data-lucide="external-link" class="w-3 h-3"></i>
          </a>
        </div>
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

function afterUserAction(id) {
  updateStatsBadge();
  refreshCard(id);
  updateMarker(id);
  updateModalButtons(id);
  updateStaleChip();
}

function handlePrayClick(id) {
  if (!ensureLogin()) return;
  const actions = getUserActions();
  if (isPrayedToday(actions, id)) {
    delete actions.prayed[id];
    registerCommunityPrayer(id, false);
  } else {
    actions.prayed[id] = new Date().toISOString();
    registerCommunityPrayer(id, true);
  }
  saveUserActions(actions);
  afterUserAction(id);
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
  afterUserAction(id);
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
  document.getElementById('modal-prof-years').innerText = prof.death_info ? `${prof.years} • ${prof.death_info}` : prof.years;
  document.getElementById('modal-prof-grave').innerText = prof.grave_location;
  document.getElementById('modal-prof-bio').innerText = prof.biography;

  const photosBox = document.getElementById('modal-header-photos');
  let photosHtml = '';
  if (prof.portrait) {
    photosHtml += `
      <div class="h-44 rounded-xl overflow-hidden bg-stone-950 flex flex-col items-center border border-stone-800">
        <img src="${prof.portrait}" alt="${prof.name}" class="w-full flex-1 min-h-0 object-contain" />
        <span class="text-[11px] text-stone-500 py-1 shrink-0">${isEn ? 'Portrait' : 'Portret'}</span>
      </div>
    `;
  }
  if (prof.tomb_img) {
    photosHtml += `
      <div class="h-44 rounded-xl overflow-hidden bg-stone-950 flex flex-col items-center border border-stone-800">
        <img src="${prof.tomb_img}" alt="${isEn ? 'Tomb of' : 'Grób'} ${prof.name}" class="w-full flex-1 min-h-0 object-contain" />
        <span class="text-[11px] text-stone-500 py-1 shrink-0">${isEn ? 'Tomb Photo' : 'Fotografia nagrobka'}</span>
      </div>
    `;
  }
  photosBox.innerHTML = photosHtml || `<div class="text-xs text-stone-500 p-4 col-span-2 text-center">${isEn ? 'No photographs attached' : 'Brak dołączonych fotografii'}</div>`;

  updateModalButtons(id);
  updateModalCount();

  document.getElementById('prof-modal').classList.remove('hidden');
  lucide.createIcons();
}

function updateModalButtons(id) {
  if (activeProfId !== id) return;
  const actions = getUserActions();
  const isPrayed = isPrayedToday(actions, id);
  const isVisited = !!actions.visited[id];
  const isEn = currentLanguage === 'en';

  const prayBtn = document.getElementById('modal-pray-btn');
  const visitBtn = document.getElementById('modal-visit-btn');

  if (isPrayed) {
    prayBtn.className = 'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border font-medium text-xs sm:text-sm transition bg-amber-950/60 border-amber-600 text-amber-300';
    prayBtn.innerHTML = `<i data-lucide="flame" class="w-4 h-4 fill-amber-400 candle-flame"></i> <span>${isEn ? 'I prayed for this soul' : 'Pomodliłem się za tę duszę'}</span>`;
  } else {
    prayBtn.className = 'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border font-medium text-xs sm:text-sm transition bg-stone-900 border-stone-800 text-stone-300 hover:border-amber-600';
    prayBtn.innerHTML = `<i data-lucide="flame" class="w-4 h-4"></i> <span>${isEn ? 'I prayed for this soul' : 'Pomodliłem się za tę duszę'}</span>`;
  }

  if (isVisited) {
    visitBtn.className = 'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border font-medium text-xs sm:text-sm transition bg-emerald-950/60 border-emerald-600 text-emerald-300';
    visitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> <span>${isEn ? 'I visited this tomb' : 'Odwiedziłem ten grób'}</span>`;
  } else {
    visitBtn.className = 'flex items-center justify-center gap-2 py-3 px-4 rounded-xl border font-medium text-xs sm:text-sm transition bg-stone-900 border-stone-800 text-stone-300 hover:border-emerald-600';
    visitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> <span>${isEn ? 'I visited this tomb' : 'Odwiedziłem ten grób'}</span>`;
  }

  lucide.createIcons();
}

function updateModalCount() {
  if (!activeProfId) return;
  const n = getTodayCount(activeProfId);
  const isEn = currentLanguage === 'en';
  document.getElementById('modal-today-count').textContent = n > 0
    ? prayersTodayLabel(n, isEn)
    : (isEn ? 'No one has prayed for this soul yet today' : 'Dziś nikt jeszcze nie pomodlił się za tę duszę');
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
        <button onclick="openLoginModal()" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-xs transition shadow-lg shadow-amber-500/25">
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
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-amber-950/90 text-amber-300 border border-amber-600 font-semibold flex items-center gap-1">
              <i data-lucide="flame" class="w-3 h-3 fill-amber-400"></i> ${isEn ? 'Prayed' : 'Omodlony'}
            </span>
          ` : ''}
          ${isVisited ? `
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-600 font-semibold flex items-center gap-1">
              <i data-lucide="check" class="w-3 h-3"></i> ${isEn ? 'Visited' : 'Odwiedzony'}
            </span>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}
