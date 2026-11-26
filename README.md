# PulsePlanSecure

Hardened, HTML5-modernised edition of PulsePlan (Company Roadmap & Utilisation Planner). The original `PulsePlan` repository remains untouched.

## Included Improvements

- **Service Worker (`sw.js`):** Deduplicated `CORE_ASSETS` to cache `./index.html` as the single canonical app shell instead of storing two separate 1.1 MB copies for `./` and `./index.html`.
- **Web App Manifest (`manifest.webmanifest`):** Aligned `theme_color` with the light-mode `<meta name="theme-color">` value to avoid splash-screen colour mismatches.
- **Subresource Integrity (`scripts/verify-sri.mjs`):** Zero-dependency Node.js utility to compute verified SHA-384 `integrity` attributes for `jspdf` and `jspdf-autotable` directly from the bytes served by `cdnjs.cloudflare.com`.
- **Automated CI (`.github/workflows/ci.yml`):** Runs `node build.mjs` and `node test.mjs` automatically on every push and pull request to `main`.

## Importing Source Files Locally

Copy `src/`, `build.mjs`, `test.mjs`, and icon assets from your local `PulsePlan` checkout into `PulsePlanSecure`, then run:

```bash
node scripts/verify-sri.mjs
node build.mjs
node test.mjs
```

## Licence

Copyright © 2026 PulsePlanSecure Contributors.

Licensed under the **European Union Public Licence v. 1.2 (EUPL-1.2)** — see [LICENSE](./LICENSE) for the full licence text and compatible licences list.
