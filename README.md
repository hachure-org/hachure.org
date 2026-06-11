# hachure.org

Landing site for **Hachure — an open trust format**.

## Stack

Pure static HTML/CSS with minimal vanilla JS (IntersectionObserver scroll-reveal only). No build step. Deploys as-is.

## Deploy: Cloudflare Pages

1. Connect this repository to Cloudflare Pages.
2. **Build command:** *(leave empty — no build step)*
3. **Output directory:** `/` (repo root)

Cloudflare Pages will serve `index.html` directly from the repository root.

## Files

| File | Purpose |
|---|---|
| `index.html` | Main page |
| `styles.css` | All styles — CSS variables, layout, typography, animation |
| `hachure-ridge.svg` | Hero illustration: hachure strokes rendering a survey-plate ridge |
| `favicon.svg` | SVG favicon |
| `robots.txt` | Search crawler directives |
| `_redirects` | Cloudflare Pages redirect rules (hachure.dev → hachure.org, www → apex) |

## Domain redirects

`_redirects` handles:
- `https://hachure.dev/*` → `https://hachure.org/:splat` (301)
- `https://www.hachure.org/*` → `https://hachure.org/:splat` (301)

## Spec

The Hachure format spec lives at [github.com/kontourai/surface](https://github.com/kontourai/surface) — `spec/` directory.
