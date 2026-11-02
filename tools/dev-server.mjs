/**
 * tools/dev-server.mjs —— 开发服务器
 *
 * 两个根：
 *   /        → public/
 *   /src/    → src/
 * 这样 index.html 里可以直接写 /src/app/bootstrap.js，不用打包器。
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const base = clean.startsWith('/src/') ? ROOT : join(ROOT, 'public');
  const rel = clean.startsWith('/src/') ? clean.slice(1) : clean === '/' ? 'index.html' : clean.slice(1);
  const full = normalize(join(base, rel));
  // 目录穿越防护
  if (!full.startsWith(ROOT + sep)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // 开发用回传口：无头浏览器跑完探针后把结果 POST 回来，方便在终端看
  if (url.startsWith('/__report')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      console.log('\n[probe] ' + body.slice(0, 2000) + '\n');
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    });
    return;
  }

  const full = resolvePath(url);
  if (!full) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(full);
    const target = info.isDirectory() ? join(full, 'index.html') : full;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + req.url);
  }
});

server.listen(PORT, () => {
  console.log(`圈问 dev server → http://localhost:${PORT}`);
});
