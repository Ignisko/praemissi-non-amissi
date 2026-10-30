// GET  /api/prayers
//   -> { date, rev, counts: { [profId]: n } }
//   Cacheable at the CDN for a few seconds, so any number of open pages costs
//   at most one origin hit (and one Redis read) per CACHE_SECONDS.
// POST /api/prayers { id, delta, opId?, date? }
//   -> same shape; delta is 1 or -1.
//   opId makes retries idempotent (a lost response can be re-sent safely).
//   date is the day the prayer was made; ops from a previous day are ignored
//   ({ stale: true }) so an offline queue flushed after midnight can't pollute
//   the new day.
// `rev` increases on every applied write; clients use it to discard
// out-of-order or CDN-stale responses.
const crypto = require('crypto');

const MAX_ID = 100000;
const TTL_SECONDS = 60 * 60 * 48;
const CACHE_SECONDS = 3;
const REV_FIELD = '_rev';

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_TCP_URL = process.env.REDIS_URL || process.env.STORAGE_URL;

// Day boundary is midnight in Poland.
function todayWarsaw() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

// Atomic: dedupe by op key, apply delta (never below zero), bump rev, refresh TTL,
// and return the whole hash so the writer gets the new state in a single round trip.
const APPLY_SCRIPT = `
if redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[3]) then
  local n = redis.call('HINCRBY', KEYS[1], ARGV[1], ARGV[2])
  if n <= 0 then redis.call('HDEL', KEYS[1], ARGV[1]) end
  redis.call('HINCRBY', KEYS[1], '${REV_FIELD}', 1)
  redis.call('EXPIRE', KEYS[1], ARGV[3])
end
return redis.call('HGETALL', KEYS[1])
`;

// In-memory fallback (local dev without Redis)
const memory = {};
const memoryOps = new Set();

let tcpClient = null;
let tcpConnecting = null;
async function getTcpClient() {
  if (!REDIS_TCP_URL) return null;
  if (tcpClient && tcpClient.isOpen) return tcpClient;
  if (!tcpConnecting) {
    tcpConnecting = (async () => {
      const { createClient } = require('redis');
      const client = createClient({ url: REDIS_TCP_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
      client.on('error', (err) => console.error('Redis TCP error:', err));
      await client.connect();
      tcpClient = client;
      return client;
    })().finally(() => { tcpConnecting = null; });
  }
  try {
    return await tcpConnecting;
  } catch (err) {
    console.error('Failed to connect to Redis TCP:', err);
    return null;
  }
}

// With Redis configured, never silently fall back to per-instance memory:
// that would show every visitor different counts.
async function requireTcpClient() {
  const client = await getTcpClient();
  if (!client && REDIS_TCP_URL) throw new Error('Redis unavailable');
  return client;
}

async function redisRest(commands) {
  const res = await fetch(`${REST_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  return (await res.json()).map(r => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

// Accepts a flat [k, v, k, v] reply or an object and returns { rev, counts }.
function parseHash(raw) {
  let entries;
  if (Array.isArray(raw)) {
    entries = [];
    for (let i = 0; i < raw.length; i += 2) entries.push([raw[i], raw[i + 1]]);
  } else {
    entries = Object.entries(raw || {});
  }
  let rev = 0;
  const counts = {};
  for (const [k, v] of entries) {
    const n = parseInt(v, 10);
    if (k === REV_FIELD) rev = n || 0;
    else if (n > 0) counts[k] = n;
  }
  return { rev, counts };
}

async function readState(key) {
  const client = await requireTcpClient();
  if (client) return parseHash(await client.hGetAll(key));
  if (REST_URL) {
    const [flat] = await redisRest([['HGETALL', key]]);
    return parseHash(flat);
  }
  const day = memory[key];
  return day ? { rev: day.rev, counts: { ...day.counts } } : { rev: 0, counts: {} };
}

async function applyPrayer(key, id, delta, opId) {
  const opKey = `${key}:op:${opId}`;
  const args = [String(id), String(delta), String(TTL_SECONDS)];
  const client = await requireTcpClient();
  if (client) {
    return parseHash(await client.eval(APPLY_SCRIPT, { keys: [key, opKey], arguments: args }));
  }
  if (REST_URL) {
    const [flat] = await redisRest([['EVAL', APPLY_SCRIPT, 2, key, opKey, ...args]]);
    return parseHash(flat);
  }
  const day = (memory[key] = memory[key] || { rev: 0, counts: {} });
  if (!memoryOps.has(opKey)) {
    memoryOps.add(opKey);
    const n = (day.counts[id] || 0) + delta;
    if (n > 0) day.counts[id] = n; else delete day.counts[id];
    day.rev += 1;
  }
  return { rev: day.rev, counts: { ...day.counts } };
}

module.exports = async function handler(req, res) {
  const date = todayWarsaw();
  const key = `prayers:${date}`;
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`);
      return res.status(200).json({ date, ...(await readState(key)) });
    }

    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

    const { id, delta, opId, date: opDate } = req.body || {};
    const validOpId = typeof opId === 'string' && /^[\w-]{8,64}$/.test(opId);
    if (!Number.isInteger(id) || id < 1 || id > MAX_ID || (delta !== 1 && delta !== -1) || (opId !== undefined && !validOpId)) {
      return res.status(400).json({ error: 'invalid body' });
    }
    if (opDate !== undefined && opDate !== date) {
      return res.status(200).json({ date, ...(await readState(key)), stale: true });
    }
    const state = await applyPrayer(key, id, delta, validOpId ? opId : crypto.randomUUID());
    res.status(200).json({ date, ...state });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
};
