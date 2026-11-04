import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  site: 'https://websters1913.timcieplowski.com',
  integrations: [
    sitemap({
      // The results page is client-rendered from ?q= and marked noindex.
      filter: (page) => !/\/search\/?$/.test(new URL(page).pathname),
    }),
  ],
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
