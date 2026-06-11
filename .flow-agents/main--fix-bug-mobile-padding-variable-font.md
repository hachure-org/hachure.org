# BUG: Mobile padding and variable-name typography are inconsistent

branch: main
worktree: /Users/brian/dev/github/hachure-org/hachure.org
created: 2026-06-11
status: diagnosing
type: fix-bug
iteration: 0

## Bug Report

Source: user description
Mobile layout in hachure.org has inconsistent left/right padding .. in alot of places it's non-existant and makes things hard to read.. as well as the variable names looking like weird font mixed in with normal font

## Diagnosis

Root cause is in `styles.css`: `.site-wrapper` defines the horizontal page gutter at lines 88-93, but most page landmarks combine `.site-wrapper` with another class whose later shorthand `padding` declaration resets the inline padding back to `0`.

Affected selectors:

- `.site-header.site-wrapper` in `index.html:23` and `trust.html:114`: `.site-header { padding: 2rem 0 1.5rem; }` at `styles.css:99-107` overrides `.site-wrapper { padding: 0 var(--gutter); }`.
- `.hero.site-wrapper` in `index.html:41`: `.hero { padding: 3rem 0 0; }` at `styles.css:150-154` overrides the wrapper gutter.
- `.section.site-wrapper` throughout `index.html` and `trust.html`: `.section { padding: 4rem 0; }` at `styles.css:305-308` overrides the wrapper gutter.
- `.status-footer.site-wrapper` in `index.html:446` and `trust.html:185`: `.status-footer { padding: 3.5rem 0 2.5rem; }` at `styles.css:694-696` overrides the wrapper gutter.

Why it is most visible on mobile: the fixed decorative plate border is hidden at `styles.css:884-886`, but the content still has no inline page gutter in the affected areas, so paragraphs, cards, tables, and footer text sit hard against the viewport edge. The `--gutter` token itself is not being applied in the common landmark cases where it matters.

The variable-name typography issue is also CSS-level. Global `code { font-family: var(--font-mono); }` at `styles.css:945-947`, plus repeated inline-code rules such as `.hero-namespace code`, `.footer-col-body code`, `.trust-intro code`, and `.recompute-note code`, force body-prose variable names into IBM Plex Mono. That is appropriate for nav labels, plate labels, formulas, and technical panels, but it makes inline schema field names in prose look like a different font mixed into Fraunces body copy.

## Plan

Definition of Done: On mobile widths, all main content, header, sections, cards/grids, trust page content, and footers retain a readable left/right gutter; inline variable names inside prose read as part of the body text while intentionally technical UI labels/formulas can remain monospace; desktop layout and existing visual identity remain unchanged.

Wave 1 - CSS gutter fix in `styles.css`

1. Preserve `.site-wrapper` as the single horizontal gutter source, but stop later component padding rules from resetting inline padding.
2. Replace shorthand padding that includes horizontal `0` with logical block-only declarations:
   - `.site-header`: use `padding-block: 2rem 1.5rem` or equivalent `padding-top` / `padding-bottom`; do not set `padding-inline`.
   - `.hero`: use `padding-block-start: 3rem`; do not set `padding-inline`.
   - `.section`: use `padding-block: 4rem`; do not set `padding-inline`.
   - `.status-footer`: use `padding-block: 3.5rem 2.5rem`; do not set `padding-inline`.
3. Add a small mobile adjustment if needed, e.g. at `@media (max-width: 600px)` set `--gutter: clamp(1rem, 5vw, 1.5rem);` or `--gutter: 1.25rem;`, so content has enough breathing room without becoming too narrow.

Acceptance evidence:

- At 375px and 390px viewport widths, `getComputedStyle(document.querySelector('.section.site-wrapper')).paddingLeft` and `.paddingRight` are non-zero.
- Same check passes for `.site-header.site-wrapper`, `.hero.site-wrapper`, and `.status-footer.site-wrapper`.
- Manual/Playwright screenshot check confirms text no longer touches either viewport edge on `/` and `/trust.html`.

Wave 2 - Inline variable typography fix in `styles.css` and `trust.html`

1. Change the broad global `code` treatment so inline code inherits the surrounding text face by default, with subtle code styling kept via weight, background, border, and/or sizing.
2. Keep intentional monospace contexts explicitly monospace:
   - `.site-nav a`, `.plate-label`, `.section-label`, `.verb-number`, `.status-formula code`, `.formula-label`, `.status-list-title`, `.status-table td:first-child`, `.mono-note`, `.record-name`, `.interop-standard`, footer labels/badges/base text, and trust panel UI.
3. Update page-specific inline rules in `trust.html`:
   - `.trust-intro code` and `.recompute-note code` should inherit the body font for prose variables/commands unless a more specific technical block needs monospace.
   - `surface-trust-panel { --k-font-ui: ... }` can remain monospace because the embedded panel is a compact technical component, not prose.
4. For long inline tokens, add `overflow-wrap: anywhere` on prose inline code if screenshots reveal overflow.

Acceptance evidence:

- Body prose examples such as `index.html:106-107`, `index.html:281-283`, `index.html:336-338`, and `trust.html:142-154` render without IBM Plex Mono unless inside an intentional technical UI context.
- Formula text in `.status-formula code` remains monospace.
- No line overflows appear at 375px on `/` or `/trust.html`.

Wave 3 - Verification

1. Serve the static directory locally with a simple static server.
2. Use Playwright or browser checks at mobile widths for `/` and `/trust.html`.
3. Capture evidence in this session file under `## Verification Report` before marking fixed.

Stop-short risks:

- A broad global `code` change can unintentionally alter visual identity in places that were meant to be technical labels. Keep monospace via explicit selectors for labels/formulas/panels.
- The trust panel uses Shadow DOM CSS in `assets/trust-panel.js`; avoid changing it unless the embedded panel itself has mobile padding issues after the outer gutter fix.
- Do not edit generated or external trust JSON; the issue is presentation only.

## Execution Progress

- Updated `styles.css` so `.site-header`, `.hero`, `.section`, and `.status-footer` use logical block padding instead of shorthand padding with inline `0`; `.site-wrapper` remains the single source of horizontal gutter.
- Updated global inline `code` styling in `styles.css` to inherit surrounding typography by default, with wrapping for long tokens. Existing intentional monospace contexts remain explicit, including nav, plate/section labels, formulas, status table labels, records, interop labels, and footer code/badges.
- Updated `trust.html` prose inline code rules for `.trust-intro code` and `.recompute-note code` to inherit the surrounding body typography while preserving the existing subtle background/border treatment.

## Verification Report

- PASS: `python3 -m http.server 8765` served the static site successfully after sandbox escalation.
- PASS: `curl -I http://127.0.0.1:8765/` returned `HTTP/1.0 200 OK`.
- PASS: `curl -I http://127.0.0.1:8765/trust.html` returned `HTTP/1.0 200 OK`.
- PASS: Source inspection confirms the targeted same-specificity landmark selectors no longer use padding shorthands that reset inline padding to `0`.
- PASS: Source inspection confirms prose inline code now inherits text typography by default, while intentional code-like UI keeps explicit monospace selectors.
- NOT_VERIFIED: Playwright/mobile screenshot and computed-style browser checks were not run because no Playwright CLI or local `playwright` Node module is available in this static site checkout.

## Mobile Browser Verification - 2026-06-11

- PASS: Served the static site locally from `hachure.org` on `http://127.0.0.1:8787`; `/` and `/trust.html` both returned `HTTP/1.0 200 OK`.
- PASS: Captured headless Chrome screenshots at `390x844`:
  - `.flow-agents/mobile-home-390x844.png`
  - `.flow-agents/mobile-trust-390x844.png`
- PASS: Chrome DevTools computed-style probe at `390x844` showed no horizontal overflow on `/` or `/trust.html` (`scrollWidth: 390`, `clientWidth: 390` for both).
- PASS: Shared page gutters are present and consistent. On `/`, `.site-header.site-wrapper`, `.hero.site-wrapper`, `.section.site-wrapper`, and `.status-footer.site-wrapper` all computed to `padding-left: 25.5px` and `padding-right: 25.5px`. On `/trust.html`, `.site-header.site-wrapper`, `.section.site-wrapper`, and `.status-footer.site-wrapper` computed to the same `25.5px` inline padding.
- PASS: Trust prose inline variable names inherit normal prose typography. `.trust-intro code` for `@kontourai/surface` computed to `Fraunces, Georgia, "Times New Roman", serif` and `display: inline`.
- PASS: Intentional technical UI remains acceptable. `/` `.status-formula code` still computes to `"IBM Plex Mono", "Courier New", monospace`; the trust transparency panel rendered within the mobile gutter (`left: 26`, `right: 365`, `width: 339`).

## Verification Report - Auditor 2026-06-11

Overall verdict: PASS, with browser screenshot/computed-style coverage unavailable in this checkout.

Checks run:

- PASS: `git diff --stat` shows only production static-site files `styles.css` and `trust.html` changed, plus untracked `.flow-agents` artifacts.
- PASS: `python3 -m http.server 8765` served the static directory after sandbox escalation.
- PASS: `curl -I http://127.0.0.1:8765/` returned `HTTP/1.0 200 OK`.
- PASS: `curl -I http://127.0.0.1:8765/trust.html` returned `HTTP/1.0 200 OK`.
- PASS: `python3 -m html.parser index.html` and `python3 -m html.parser trust.html` completed without parser errors.
- PASS: Static assertion script confirmed `.site-wrapper` still owns `padding: 0 var(--gutter);`, while `.site-header`, `.hero`, `.section`, and `.status-footer` use block-only padding declarations.
- PASS: Static assertion script confirmed global `code` inherits font family, `.trust-intro code` and `.recompute-note code` inherit font family, and `.status-formula code` plus `.footer-col-body code` keep explicit `var(--font-mono)`.
- NOT_VERIFIED: No local Playwright CLI, package.json, node_modules Playwright package, or Playwright config is present, so visual screenshots and real computed-style checks were not collected.

Acceptance criteria:

1. PASS: Mobile sections/header/footer keep a consistent left/right gutter. Evidence: `styles.css:89-92` keeps `.site-wrapper` horizontal padding; `styles.css:99-100`, `styles.css:150-152`, `styles.css:303-304`, and `styles.css:694-695` no longer reset inline padding to `0`.
2. PASS: Prose variable names no longer render as jarring monospace inline snippets. Evidence: `styles.css:945-948`, `trust.html:26-33`, and `trust.html:100-107` set prose inline code to inherit surrounding typography and wrap long tokens; affected prose tokens are present in `index.html` and `trust.html`.
3. PASS: Intentional formula/code UI still uses monospace where useful. Evidence: `.status-formula code` remains monospace at `styles.css:444-448`, and footer/status UI code remains explicitly monospace at `styles.css:737-744`.
4. PASS: No production files other than minimal necessary static site files are changed. Evidence: `git diff --stat` reports production changes only in `styles.css` and `trust.html`; verification writes are confined to `.flow-agents`.

## History
