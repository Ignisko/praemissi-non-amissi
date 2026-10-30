// GET  /api/prayers            -> { date, counts: { [profId]: n } }
// POST /api/prayers {id, delta} -> same shape; delta is 1 or -1
const MAX_ID = 100000;
const TTL_SECONDS = 60 * 60 * 48;

const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_TCP_URL = process.env.REDIS_URL || process.env.STORAGE_URL;

// Day boundary is midnight in Poland.
function todayWarsaw() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

// In-memory fallback
const memory = {};

// TCP Client (when REDIS_URL is provided, e.g. redis://...)
let tcpClient = null;
async function getTcpClient() {
  if (!REDIS_TCP_URL) return null;
  if (tcpClient && tcpClient.isOpen) return tcpClient;
  try {
    const { createClient } = require('redis');
    tcpClient = createClient({ url: REDIS_TCP_URL });
    tcpClient.on('error', (err) => console.error('Redis TCP error:', err));
    await tcpClient.connect();
    return tcpClient;
  } catch (err) {
    console.error('Failed to connect to Redis TCP:', err);
    return null;
  }
}

// REST pipeline fallback (when Upstash REST keys are provided)
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

function toCounts(flat) {
  const counts = {};
  for (let i = 0; i < flat.length; i += 2) {
    const n = parseInt(flat[i + 1], 10);
    if (n > 0) counts[flat[i]] = n;
  }
  return counts;
}

async function readCounts(key) {
  const client = await getTcpClient();
  if (client) {
    const data = await client.hGetAll(key);
    const counts = {};
    for (const [k, v] of Object.entries(data || {})) {
      const n = parseInt(v, 10);
      if (n > 0) counts[k] = n;
    }
    return counts;
  }
  if (REST_URL) {
    const [flat] = await redisRest([['HGETALL', key]]);
    return toCounts(flat || []);
  }
  return { ...(memory[key] || {}) };
}

async function addPrayer(key, id, delta) {
  const client = await getTcpClient();
  if (client) {
    const n = await client.hIncrBy(key, String(id), delta);
    await client.expire(key, TTL_SECONDS);
    if (n < 0) await client.hSet(key, String(id), '0');
    return;
  }
  if (REST_URL) {
    const [n] = await redisRest([
      ['HINCRBY', key, String(id), delta],
      ['EXPIRE', key, TTL_SECONDS],
    ]);
    if (n < 0) await redisRest([['HSET', key, String(id), 0]]);
    return;
  }
  const day = (memory[key] = memory[key] || {});
  day[id] = Math.max(0, (day[id] || 0) + delta);
  if (!day[id]) delete day[id];
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const date = todayWarsaw();
  const key = `prayers:${date}`;
  try {
    if (req.method === 'POST') {
      const { id, delta } = req.body || {};
      if (!Number.isInteger(id) || id < 1 || id > MAX_ID || (delta !== 1 && delta !== -1)) {
        return res.status(400).json({ error: 'invalid body' });
      }
      await addPrayer(key, id, delta);
    } else if (req.method !== 'GET') {
      return res.status(405).json({ error: 'method not allowed' });
    }
    res.status(200).json({ date, counts: await readCounts(key) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
};
