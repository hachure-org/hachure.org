/**
 * Version-drift gate.
 *
 * Two layers of enforcement:
 *
 *  1. LOCAL AGREEMENT — every version the site copy advertises (index.html)
 *     must match advertised-versions.json. You cannot change one without the
 *     other.
 *
 *  2. PUBLISHED AGREEMENT — advertised-versions.json must match the latest
 *     published `hachure` npm package (registry version, its declared
 *     statusFunctionVersion, and the schemaVersion enum in
 *     trust-bundle.schema.json). When a new spec version is published, this
 *     check fails until someone explicitly updates advertised-versions.json
 *     and sweeps the site copy — which is the intended trigger for a
 *     marketing/docs refresh session.
 *
 * Run: node scripts/check-version-drift.mjs [--offline]
 *   --offline skips layer 2 (no network), for local dev.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OFFLINE = process.argv.includes('--offline');

const advertised = JSON.parse(readFileSync(join(ROOT, 'advertised-versions.json'), 'utf-8'));
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf-8');

const failures = [];

function expectAll(label, matches, expected) {
  if (matches.length === 0) {
    failures.push(`${label}: no occurrences found in index.html — extraction regex may be stale`);
    return;
  }
  for (const found of matches) {
    if (found !== String(expected)) {
      failures.push(`${label}: index.html advertises "${found}" but advertised-versions.json says "${expected}"`);
    }
  }
}

// --- Layer 1: site copy vs advertised-versions.json -------------------------

// statusFunctionVersion appears as: statusFunctionVersion = "2" (formula label),
// statusFunctionVersion: <strong>"2"</strong> (mono note),
// <code>statusFunctionVersion</code> (currently <code>"2"</code>) (footer).
const sfvMatches = [
  ...indexHtml.matchAll(/statusFunctionVersion\s*=\s*"(\d+)"/g),
  ...indexHtml.matchAll(/statusFunctionVersion:\s*<strong>"(\d+)"<\/strong>/g),
  ...indexHtml.matchAll(/<code>statusFunctionVersion<\/code>\s*\(currently\s*<code>"(\d+)"<\/code>\)/g),
].map(m => m[1]);
expectAll('statusFunctionVersion', sfvMatches, advertised.statusFunctionVersion);

// schemaVersion appears as: schemaVersion: <strong>5</strong> (mono note),
// <code>schemaVersion</code> (currently <code>5</code>) (footer).
const schemaMatches = [
  ...indexHtml.matchAll(/schemaVersion:\s*<strong>(\d+)<\/strong>/g),
  ...indexHtml.matchAll(/<code>schemaVersion<\/code>\s*\(currently\s*<code>(\d+)<\/code>\)/g),
].map(m => m[1]);
expectAll('schemaVersion', schemaMatches, advertised.schemaVersion);

// --- Layer 2: advertised-versions.json vs published package -----------------

if (!OFFLINE) {
  let pkg;
  try {
    const res = await fetch('https://registry.npmjs.org/hachure/latest');
    if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
    pkg = await res.json();
  } catch (err) {
    failures.push(`could not fetch hachure from npm registry: ${err.message}`);
  }

  if (pkg) {
    if (pkg.version !== advertised.hachureNpmVersion) {
      failures.push(
        `published hachure npm version is ${pkg.version} but advertised-versions.json says ${advertised.hachureNpmVersion} — ` +
        `a new spec release is out; update advertised-versions.json and sweep the site copy`
      );
    }
    if (String(pkg.statusFunctionVersion) !== String(advertised.statusFunctionVersion)) {
      failures.push(
        `published statusFunctionVersion is "${pkg.statusFunctionVersion}" but advertised-versions.json says "${advertised.statusFunctionVersion}"`
      );
    }

    try {
      const res = await fetch(`https://unpkg.com/hachure@${pkg.version}/schemas/trust-bundle.schema.json`);
      if (!res.ok) throw new Error(`unpkg HTTP ${res.status}`);
      const schema = await res.json();
      // The current schemaVersion is the highest accepted enum value; older
      // entries are compatibility floors (e.g. [5, 6] means 6 is current).
      const enumValues = schema?.properties?.schemaVersion?.enum;
      const published = Array.isArray(enumValues) ? Math.max(...enumValues) : undefined;
      if (published === undefined) {
        failures.push('could not extract schemaVersion enum from published trust-bundle.schema.json — schema layout changed?');
      } else if (published !== advertised.schemaVersion) {
        failures.push(
          `published schemaVersion is ${published} but advertised-versions.json says ${advertised.schemaVersion}`
        );
      }
    } catch (err) {
      failures.push(`could not fetch published trust-bundle.schema.json: ${err.message}`);
    }
  }
}

// --- Report ------------------------------------------------------------------

if (failures.length > 0) {
  console.error('\nVERSION DRIFT DETECTED:\n');
  for (const f of failures) console.error('  ✗ ' + f);
  console.error(
    '\nTo resolve: update advertised-versions.json to the latest published versions,' +
    '\nthen update every advertised version in index.html (and review trust.html prose).' +
    '\nThis gate exists so the marketing site cannot silently fall behind the spec.\n'
  );
  process.exit(1);
}

console.log(
  `version drift check passed — advertising hachure@${advertised.hachureNpmVersion}, ` +
  `schemaVersion ${advertised.schemaVersion}, statusFunctionVersion "${advertised.statusFunctionVersion}"` +
  (OFFLINE ? ' (offline: published-package check skipped)' : '')
);
