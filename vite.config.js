import fs from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const localCaddyfile = () => ({
  name: 'local-caddyfile',
  configureServer(server) {
    server.middlewares.use('/local-test/Caddyfile', async (_req, res) => {
      try {
        const content = await fs.readFile(path.resolve(process.cwd(), 'Caddyfile'), 'utf8');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(content);
      } catch {
        res.statusCode = 404;
        res.end('Caddyfile not found');
      }
    });
  },
});

const localMonaco = () => ({
  name: 'local-monaco',
  configureServer(server) {
    const monacoRoot = path.resolve(process.cwd(), 'node_modules/monaco-editor/min');
    server.middlewares.use('/vendor/monaco', async (req, res, next) => {
      try {
        const requested = decodeURIComponent(String(req.url || '/')).replace(/^\/+/, '');
        const file = path.resolve(monacoRoot, requested);
        if (!file.startsWith(`${monacoRoot}${path.sep}`)) return next();
        const content = await fs.readFile(file);
        const extension = path.extname(file);
        const contentTypes = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
        res.setHeader('Content-Type', contentTypes[extension] || 'application/octet-stream');
        res.end(content);
      } catch {
        next();
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), localCaddyfile(), localMonaco()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
