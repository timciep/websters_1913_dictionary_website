import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://websters1913.timcieplowski.com',
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
