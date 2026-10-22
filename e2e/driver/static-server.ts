/**
 * Minimal static file server for the web E2E run.
 *
 * Why not `rspeedy preview`? The E2E run has to be reproducible from a single
 * command, and it needs two things the preview server does not provide:
 *
 *   1. `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers.
 *      Lynx Web Platform's WASM engine needs `SharedArrayBuffer`, which the
 *      browser only exposes to cross-origin-isolated documents. Without these
 *      headers the engine silently falls back to a slower path.
 *   2. A known, fixed port so scenarios can address the page.
 *
 * The served directory is `dist/`, i.e. exactly what `pnpm build` produced —
 * the same bytes the preview server would hand out, so the E2E run exercises
 * the deployable artifact rather than a dev-server approximation.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bundle': 'application/octet-stream',
  '.ttml': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export interface StaticServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface StaticServerOptions {
  /** Directory to serve. Defaults to `<repo>/dist`. */
  root?: string;
  /** Preferred port. Falls back to an ephemeral port when taken. */
  port?: number;
}

/**
 * Start a static server over `root`.
 *
 * Cache invalidation is keyed on mtime + size. This is a correctness concern,
 * not an optimisation: a cached body that no longer matches the file on disk
 * makes an E2E run validate stale code, which reads as "the fix did not work".
 */
export function startStaticServer(
  options: StaticServerOptions = {},
): Promise<StaticServer> {
  const root = resolve(options.root ?? join(process.cwd(), 'dist'));
  const preferredPort = options.port ?? 0;

  if (!existsSync(root)) {
    return Promise.reject(
      new Error(
        `[e2e] dist/ not found at ${root}. Run \`pnpm build\` before the E2E run.`,
      ),
    );
  }

  const server: Server = createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    // The browser asks for a favicon on every page load. Answering with 204
    // keeps the request out of the console error log, which the E2E run
    // asserts on.
    if (requestPath === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    const relative = normalize(
      requestPath === '/' ? '/index.html' : requestPath,
    ).replace(/^(\.\.[/\\])+/, '');
    const filePath = resolve(root, `.${relative}`);

    // Never serve anything outside the root.
    if (!filePath.startsWith(root + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': statSync(filePath).size,
      // Required for SharedArrayBuffer (Lynx Web Platform's WASM engine).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.on('error', rejectPromise);
    server.listen(preferredPort, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address ? address.port : preferredPort;
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
