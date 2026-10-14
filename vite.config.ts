import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';
import { userdataPlugin } from './server/userdata-plugin.ts';

// GitHub Pages serves the site from /<repo-name>/.
const REPO_BASE = '/banban-weight-tracking-program/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  plugins: [
    // Writes each profile's CSV files to ./testdata while running npm run dev / preview.
    userdataPlugin(fileURLToPath(new URL('./testdata', import.meta.url))),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Banban Weight Tracker',
        short_name: 'Weight',
        description: 'Private, offline weight tracking. Data stays on this device.',
        theme_color: '#af5a3f',
        background_color: '#fdf8f4',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
}));
