# hachure.org

Landing site for **Hachure — an open trust format**.

## Stack

Static HTML/CSS with minimal vanilla JS (IntersectionObserver scroll-reveal)
plus one Cloudflare Pages Function serving the verification endpoint. No build
step. Deploys as-is.

## Deploy: Cloudflare Pages

Deployed by `.github/workflows/deploy.yml` on push to `main`
(`wrangler pages deploy`, project `hachure-org`). CI first verifies HTML
well-formedness, version agreement with the published `hachure` npm package,
and runs the endpoint tests; a smoke job checks the live site after deploy.

## Files

| File | Purpose |
|---|---|
| `index.html` | Main page ("Plate I") |
| `trust.html` + `trust/` | Live TrustBundle demo ("Plate II — Receipts"): rendered bundle + raw JSON |
| `functions/[[path]].js` | Cloudflare Pages Function — the `hachure.org/v1` verification-endpoint profile at `/.well-known/hachure/verify`, implemented from the spec text alone |
| `assets/trust-panel.js` | `<surface-trust-panel>` web component |
| `test/verify-endpoint.test.mjs` | Endpoint tests (`node test/verify-endpoint.test.mjs`) — imports the real function module |
| `scripts/check-version-drift.mjs` | Fails CI when advertised spec versions drift from the published `hachure` npm package |
| `styles.css` | All styles — CSS variables, layout, typography, animation |
| `hachure-ridge.svg` | Hero illustration: hachure strokes rendering a survey-plate ridge |
| `favicon.svg` | SVG favicon |
| `robots.txt` / `sitemap.xml` | Search crawler directives |
| `_redirects` | Cloudflare Pages path-level redirect rules (host-level redirects live in Cloudflare zone rulesets, see `hachure-org/hachure-dns`) |

## Trust bundle refresh

`trust/latest.json` (report) and `trust/latest-bundle.json` (bundle) are
producer records — never hand-edit them; regenerate and commit.

They are the spec's own self-attestation, produced with nothing but the
`hachure` package itself: in
[hachure-org/spec](https://github.com/hachure-org/spec), run
`npm run trust-bundle` and copy `dist/trust/*` into `trust/` here.

### Release runbook (spec version bump)

1. In `hachure-org/spec`: merge changes, tag `v<version>` — CI publishes to npm.
2. The next push here fails the **version drift gate** (by design). Update
   `advertised-versions.json` to the published values.
3. Sweep `index.html` (the gate lists each stale spot) and review
   `trust.html` prose.
4. Regenerate the trust bundle (`npm run trust-bundle` in the spec repo), copy
   `dist/trust/*` to `trust/`, and confirm `node test/verify-endpoint.test.mjs`
   passes.

## Spec

The Hachure format spec lives at
[github.com/hachure-org/spec](https://github.com/hachure-org/spec) — prose,
normative JSON schemas, conformance test vectors, and a bundled
implementation. It is published to npm as
[`hachure`](https://www.npmjs.com/package/hachure). Known conforming
implementations are listed in the spec's
[Implementations](https://github.com/hachure-org/spec#implementations) table.
