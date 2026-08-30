import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.{js,jsx}'],
    passWithNoTests: true,
  },
  experimental: {
    viteModuleRunner: false, // Vite 8 / Rolldown transformer edge-case fix
  },
});
