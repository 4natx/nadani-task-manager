import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const basePath = '/nadani-task-manager/';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function serve(port = 4174) {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (path === '/') {
        response.writeHead(302, { Location: basePath }).end();
        return;
      }
      const relative = path.slice(basePath.length) || 'index.html';
      const isPublic = /^index\.html$|^(?:css|js|assets)\/[a-z0-9_/-]+\.(?:css|js|svg)$/i.test(relative);
      if (!path.startsWith(basePath) || !isPublic) {
        response.writeHead(404).end('Not found');
        return;
      }
      const content = await readFile(new URL(`../${relative}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': contentTypes[extname(relative)] }).end(content);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveServer(server));
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = await serve(Number(process.env.PORT ?? 4174));
  console.log(`http://127.0.0.1:${server.address().port}${basePath}`);
}