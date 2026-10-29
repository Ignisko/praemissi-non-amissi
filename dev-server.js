// Local static server with the /api/prayers handler (in-memory, no Redis).
const http = require('http');
const fs = require('fs');
const path = require('path');
const handler = require('./api/prayers.js');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const port = process.env.PORT || 8000;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/prayers') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try { req.body = body ? JSON.parse(body) : undefined; } catch (e) { req.body = undefined; }
      res.status = code => { res.statusCode = code; return res; };
      res.json = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
      handler(req, res);
    });
    return;
  }
  const file = path.join(__dirname, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(__dirname) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
