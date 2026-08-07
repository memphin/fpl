import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, relative } from 'node:path';

const root = normalize(join(process.cwd(), 'public'));
const port = Number(process.env.PORT || 8080);
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

createServer(async (request, response) => {
  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const requested = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath).replace(/^[/\\]+/, '');
  const filePath = normalize(join(root, requested));
  if (relative(root, filePath).startsWith('..')) { response.writeHead(403).end('Forbidden'); return; }
  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(filePath).pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(port, () => console.log(`Public preview is running at http://localhost:${port}`));
