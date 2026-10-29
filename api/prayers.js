// GET  /api/prayers            -> { date, counts: { [profId]: n } }
// POST /api/prayers {id, delta} -> same shape; delta is 1 or -1
const MAX_ID = 100000;
const TTL_SECONDS = 60 * 60 * 48;

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Day boundary is midnight in Poland.
function todayWarsaw() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

// In-memory fallback for local runs without Redis.
const memory = {};

async function redis(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
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
  if (!REDIS_URL) return { ...(memory[key] || {}) };
  const [flat] = await redis([['HGETALL', key]]);
  return toCounts(flat || []);
}

async function addPrayer(key, id, delta) {
  if (!REDIS_URL) {
    const day = (memory[key] = memory[key] || {});
    day[id] = Math.max(0, (day[id] || 0) + delta);
    if (!day[id]) delete day[id];
    return;
  }
  const [n] = await redis([
    ['HINCRBY', key, String(id), delta],
    ['EXPIRE', key, TTL_SECONDS],
  ]);
  if (n < 0) await redis([['HSET', key, String(id), 0]]);
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
