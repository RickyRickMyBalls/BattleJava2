import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only helper: POST a data-URL to /__save?name=foo to write debug/foo.jpg.
// Used by tooling to capture in-game screenshots headlessly.
function debugSavePlugin() {
  return {
    name: 'debug-save',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const url = new URL(req.url, 'http://x');
            const name = (url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
            const ext = url.searchParams.get('ext') === 'png' ? 'png' : 'jpg';
            // dir=textures writes into the served asset tree (for generated tiling textures)
            const dir = url.searchParams.get('dir') === 'textures'
              ? path.resolve('source/other/textures')
              : path.resolve('debug');
            const m = body.match(/^data:image\/\w+;base64,(.+)$/);
            if (!m) { res.statusCode = 400; res.end('bad'); return; }
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${name}.${ext}`), Buffer.from(m[1], 'base64'));
            res.end('ok');
          } catch (e) { res.statusCode = 500; res.end(String(e)); }
        });
      });
    },
  };
}

export default defineConfig({
  // Serve the raw asset kit directly: /UNSC/..., /animations/..., /Maps/...
  publicDir: 'source',
  plugins: [debugSavePlugin()],
  server: {
    port: 5199,
    host: '127.0.0.1'
  }
});
