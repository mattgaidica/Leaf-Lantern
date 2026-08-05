# Leaf & Lantern — Website

<p align="center">
  <a href="https://mattgaidica.github.io/Leaf-Lantern/"><strong>Visit the site →</strong></a>
</p>

A GitHub Pages–deployable website for **Leaf & Lantern**, a seasonal gathering place concept for
Southeast Michigan. It has two faces:

1. **The mock consumer site** — Home, The Seasons, Events, The Market, Visit, plus
   one-click-in program pages (Schools & Camps, Groups & Rentals, For Makers, Our Story) that
   make the business feel real without diluting the core value proposition.
2. **The investor reading experience** at `/plan` — the full business plan restyled as a rich
   long-form document with a sticky table of contents, reading progress, key-metric cards,
   branded tables, a seasonal revenue chart, and a phased development roadmap. It is reachable
   from the "For Investors" link in the top bar and the "Read the Business Plan" button in the
   footer.

Built with [Astro](https://astro.build). Brand identity (Fraunces + Source Sans 3, the
Parchment/Deep Pine/Cider palette, "modern heritage" tone) follows the design contract in
[`assets/deep-research-report.md`](assets/deep-research-report.md).

## Local development

Requires Node 20+.

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
npm run preview  # serve the production build locally
```

## Deploying to GitHub Pages

1. Push this repository to GitHub (any repo name works — the base path is derived
   automatically).
2. In the repository settings, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
3. Push to `main`. The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   builds and deploys the site to `https://<your-username>.github.io/<repo-name>/`.

## Images

Existing brand concept images live in `public/images/`. Scene prompts and save paths are
documented in [`assets/image-prompts.md`](assets/image-prompts.md) for future regenerations.

## Project structure

```
src/
  layouts/Base.astro        # header (4 nav links + CTA), footer with investor button
  components/               # Hero, SeasonCard, EventCard, BrandImage (placeholder-aware)
  pages/                    # index, seasons, events (+ detail), visit, market,
                            # schools-camps, groups-rentals, makers, about, plan
  data/events.ts            # mock event records
  styles/global.css         # brand design tokens and shared styles
assets/
  deep-research-report.md   # source business plan
  image-prompts.md          # ChatGPT prompts for remaining imagery
```
