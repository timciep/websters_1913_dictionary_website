import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://example.com',
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
