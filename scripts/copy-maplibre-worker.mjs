// MapLibre v6 loads its web worker as a separate file resolved relative to the
// module URL (new URL('./maplibre-gl-worker.mjs', import.meta.url)). Vite
// bundles the library into a hashed chunk without emitting that file, so the
// runtime request 404s and the map never renders. This script stages the
// worker (and the shared chunk it imports) into public/, and the map code
// points MapLibre at it with setWorkerUrl().
import { copyFileSync, mkdirSync } from 'node:fs';

const destination = new URL('../public/vendor/maplibre/', import.meta.url);
mkdirSync(destination, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(
    new URL(`../node_modules/maplibre-gl/dist/${file}`, import.meta.url),
    new URL(file, destination),
  );
}
