import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  site: 'https://websters1913.timcieplowski.com',
  integrations: [sitemap()],
  build: {
    format: 'directory',
  },
  vite: {
    build: {
      // ~115k pages — give Vite a bit of headroom for the manifest.
      assetsInlineLimit: 0,
    },
  },
});
