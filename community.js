// Shared "prayed today" counters.
//
// Model
//   community   = last confirmed server state { date, rev, counts }
//   pendingOps  = this device's writes the server hasn't confirmed yet
//   displayed   = community.counts + pendingOps  (optimistic, never negative)
//
// Reads  : adaptive polling (fast while things change, slow when quiet, paused
//          in hidden tabs, backoff on errors). The API response is CDN-cacheable,
//          so the server cost does not grow with the number of open pages.
// Writes : queued in localStorage, sent one at a time with an idempotency key and
//          retried with backoff, so a flaky connection at the cemetery neither
//          loses a prayer nor counts it twice.
// UI     : changes are reported as a list of professor ids (onCommunityChanged,
//          implemented in app.js) so only the affected badges are patched.
//          Nothing here re-renders lists, the map or open dialogs.

const STORAGE_COMMUNITY_PRAYERS = 'pna_community_prayers_daily';
const STORAGE_PENDING_OPS = 'pna_pending_prayer_ops';

const POLL_ACTIVE_MS = 5000;
const POLL_QUIET_MS = 15000;
const POLL_QUIET_AFTER = 12;       // polls without any change before slowing down
const POLL_MAX_BACKOFF_MS = 60000;
const MIN_RESYNC_GAP_MS = 2000;    // don't refetch on tab focus more often than this
const REV_REGRESS_GRACE_MS = 30000; // ignore older revs (stale CDN edge) for this long

// Today's date (YYYY-MM-DD) in Poland
const warsawDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' });

function warsawDate(date) {
  return warsawDateFormat.format(date);
}

function getTodayDateStr() {
  return warsawDate(new Date());
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

let community = { date: getTodayDateStr(), rev: 0, counts: {} };
let pendingOps = [];
let displayCache = null;
let lastAcceptedAt = 0;

(function restoreCommunityState() {
  const today = getTodayDateStr();
  const cached = readJson(STORAGE_COMMUNITY_PRAYERS);
  if (cached && cached.date === today && cached.counts && typeof cached.counts === 'object') {
    community = { date: cached.date, rev: Number(cached.rev) || 0, counts: cached.counts };
  }
  const saved = readJson(STORAGE_PENDING_OPS);
  if (Array.isArray(saved)) {
    pendingOps = saved.filter(op => op && op.date === today && Number.isInteger(op.id) && (op.delta === 1 || op.delta === -1) && typeof op.opId === 'string');
  }
})();

function getDisplayCounts() {
  if (displayCache) return displayCache;
  const out = { ...community.counts };
  for (const op of pendingOps) out[op.id] = (out[op.id] || 0) + op.delta;
  for (const k of Object.keys(out)) if (out[k] <= 0) delete out[k];
  displayCache = out;
  return out;
}

function getTodayCount(id) {
  return getDisplayCounts()[id] || 0;
}

// Runs a state mutation and reports exactly which professors' displayed counts changed.
function trackChanges(mutate) {
  const before = getDisplayCounts();
  mutate();
  displayCache = null;
  const after = getDisplayCounts();
  const changed = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((before[k] || 0) !== (after[k] || 0)) changed.push(Number(k));
  }
  if (changed.length && typeof onCommunityChanged === 'function') onCommunityChanged(changed);
  return changed.length > 0;
}

function persistPending() {
  writeJson(STORAGE_PENDING_OPS, pendingOps);
}

// Merge an authoritative server snapshot. Returns true if anything visible changed.
// `settle` is a confirmed pending op, removed in the same step so the badge doesn't blink.
function applyServerState(data, { isWrite = false, settle = null } = {}) {
  if (!data || typeof data.date !== 'string' || !data.counts || typeof data.counts !== 'object') return false;
  const rev = Number.isFinite(data.rev) ? data.rev : 0;
  if (data.date < community.date) return false;
  const sameDay = data.date === community.date;
  if (sameDay && !isWrite && rev < community.rev && Date.now() - lastAcceptedAt < REV_REGRESS_GRACE_MS) return false;

  const changed = trackChanges(() => {
    if (!sameDay) pendingOps = pendingOps.filter(op => op.date === data.date);
    if (settle) pendingOps = pendingOps.filter(op => op !== settle);
    community = { date: data.date, rev, counts: data.counts };
  });
  lastAcceptedAt = Date.now();
  writeJson(STORAGE_COMMUNITY_PRAYERS, community);
  persistPending();
  return changed;
}

// ---- Writes ----

let flushing = false;
let inflightOp = null;
let writeEpoch = 0;
let flushFailures = 0;
let flushTimer = null;

function newOpId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function registerCommunityPrayer(profId, increment = true) {
  const id = Number(profId);
  const delta = increment ? 1 : -1;
  trackChanges(() => {
    // A pray immediately followed by an un-pray (or vice versa) cancels out
    // locally, so nothing is sent unless the first one is already in flight.
    for (let i = pendingOps.length - 1; i >= 0; i--) {
      const op = pendingOps[i];
      if (op.id === id && op !== inflightOp && op.delta === -delta) {
        pendingOps.splice(i, 1);
        return;
      }
    }
    pendingOps.push({ opId: newOpId(), id, delta, date: getTodayDateStr() });
  });
  persistPending();
  pollQuietCount = 0;
  flushPendingOps();
}

function dropOp(op) {
  trackChanges(() => { pendingOps = pendingOps.filter(o => o !== op); });
  persistPending();
}

async function flushPendingOps() {
  if (flushing) return;
  flushing = true;
  writeEpoch++;
  clearTimeout(flushTimer);
  try {
    while (pendingOps.length) {
      const op = pendingOps[0];
      if (op.date < getTodayDateStr()) { dropOp(op); continue; }
      inflightOp = op;
      const res = await fetch('/api/prayers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: op.id, delta: op.delta, opId: op.opId, date: op.date }),
        keepalive: true,
      });
      if (res.ok) {
        applyServerState(await res.json(), { isWrite: true, settle: op });
        if (pendingOps.includes(op)) dropOp(op);
        flushFailures = 0;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        dropOp(op); // the server will never accept this one
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    }
  } catch (e) {
    flushFailures++;
    const delay = Math.min(POLL_MAX_BACKOFF_MS, 2000 * 2 ** Math.min(flushFailures, 5));
    flushTimer = setTimeout(flushPendingOps, delay * (0.8 + Math.random() * 0.4));
  } finally {
    inflightOp = null;
    flushing = false;
    writeEpoch++;
  }
}

// ---- Reads ----

let isSyncing = false;
let pollTimer = null;
let pollErrors = 0;
let pollQuietCount = 0;
let lastSyncAt = 0;

async function syncCommunityPrayers() {
  if (isSyncing || flushing) return;
  isSyncing = true;
  const epoch = writeEpoch;
  try {
    const res = await fetch('/api/prayers', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastSyncAt = Date.now();
    pollErrors = 0;
    // A write started or finished while we were waiting: its own response is
    // fresher than this one, so drop this snapshot instead of flickering.
    if (epoch !== writeEpoch) return;
    pollQuietCount = applyServerState(data) ? 0 : pollQuietCount + 1;
  } catch (e) {
    pollErrors = Math.min(pollErrors + 1, 4);
  } finally {
    isSyncing = false;
  }
}

function nextPollDelay() {
  if (pollErrors) return Math.min(POLL_MAX_BACKOFF_MS, POLL_ACTIVE_MS * 2 ** pollErrors);
  const base = pollQuietCount >= POLL_QUIET_AFTER ? POLL_QUIET_MS : POLL_ACTIVE_MS;
  return base * (0.8 + Math.random() * 0.4); // jitter so clients don't poll in lockstep
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(async () => {
    await syncCommunityPrayers();
    schedulePoll();
  }, nextPollDelay());
}

function resumeSync() {
  if (document.hidden) return;
  pollQuietCount = 0;
  if (Date.now() - lastSyncAt > MIN_RESYNC_GAP_MS) syncCommunityPrayers().then(schedulePoll);
  else schedulePoll();
  if (pendingOps.length) flushPendingOps();
}

function startCommunitySync() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(pollTimer);
    else resumeSync();
  });
  window.addEventListener('online', () => { flushFailures = 0; resumeSync(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) resumeSync(); });
  resumeSync();
}
