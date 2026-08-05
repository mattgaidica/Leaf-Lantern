import { defineConfig } from 'astro/config';

// SITE_URL and BASE_PATH are injected by the GitHub Actions deploy workflow
// so the site works when hosted at https://<user>.github.io/<repo>/.
// Locally they default to a root-hosted dev server.
export default defineConfig({
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  base: process.env.BASE_PATH ?? '/',
});
