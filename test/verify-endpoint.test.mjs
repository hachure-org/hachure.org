/**
 * Local test harness for the Pages function.
 * Mimics the env.ASSETS interface used in Cloudflare Workers runtime.
 * Run with: node test/verify-endpoint.test.mjs
 *
 * Imports the real module from functions/[[path]].js — no duplicated copy of
 * the endpoint logic lives here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, '../trust/latest-bundle.json');
const FUNCTION_PATH = join(__dirname, '../functions/[[path]].js');

const { onRequest, buildIndex } = await import(pathToFileURL(FUNCTION_PATH).href);

const SOURCE = 'hachure-org-site';
const VERIFY_PATH = '/.well-known/hachure/verify';

// Read the bundle once
const bundleBytes = readFileSync(BUNDLE_PATH, 'utf-8');
const bundle = JSON.parse(bundleBytes);

// Minimal ASSETS mock
const mockAssets = {
  async fetch(req) {
    const url = typeof req === 'string' ? req : req.url;
    if (url.includes('/trust/latest-bundle.json')) {
      return {
        ok: true,
        status: 200,
        async json() { return JSON.parse(bundleBytes); },
      };
    }
    return { ok: false, status: 404 };
  }
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('  PASS', name);
    passed++;
  } catch (e) {
    console.error('  FAIL', name, '—', e.message);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function makeContext(method, url, bodyObj) {
  const init = { method };
  if (bodyObj !== undefined) {
    init.body = JSON.stringify(bodyObj);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return {
    request: new Request(url, init),
    env: { ASSETS: mockAssets },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
console.log('\nRunning verify-endpoint tests against real bundle...\n');

// Known claim IDs for assertions — derived from the live bundle, not
// hard-coded, so the suite survives bundle regeneration.
const KNOWN_CLAIM_ID = bundle.claims[0].id;
// The integrity ref changes every release. Pick the non-claim-id ref shared
// by the most claims — that is what the "multiple claims share a ref" test needs.
const KNOWN_INTEGRITY_REF = (() => {
  const claimIds = new Set(bundle.claims.map((c) => c.id));
  const { refToClaimIds } = buildIndex(bundle);
  let best = null;
  let bestCount = 1;
  for (const [ref, refClaimIds] of refToClaimIds) {
    if (claimIds.has(ref)) continue; // skip claim-id self-references
    if (refClaimIds.size > bestCount) { best = ref; bestCount = refClaimIds.size; }
  }
  if (!best) throw new Error('verify-endpoint test fixture: no integrity ref shared by multiple claims in trust/latest-bundle.json');
  return best;
})();
// The bundle's own declared versions — the endpoint must echo these, not
// assert newer ones (the endpoint relays producer records verbatim).
const BUNDLE_SCHEMA_VERSION = bundle.schemaVersion;
const BUNDLE_SFV = (() => {
  const c = (bundle.claims || []).find(c => c.fieldOrBehavior === 'statusFunctionVersion' && c.value);
  return c ? String(c.value) : '1';
})();
const UNKNOWN_REF = 'sha256:deadbeefdeadbeefdeadbeefdeadbeef00000000000000000000000000000000';

await test('GET known ref (claim id) returns 200 with matching claim', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}`);
  const res = await onRequest(ctx);
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(body.source === SOURCE, 'source mismatch');
  assert(Array.isArray(body.claims), 'claims not array');
  assert(body.claims.some(c => c.id === KNOWN_CLAIM_ID), 'claim not found');
  assert(Array.isArray(body.metadata.unknownRefs), 'unknownRefs missing');
  assert(body.metadata.unknownRefs.length === 0, 'should have no unknown refs');
  assert(body.metadata.requestedRefs.includes(KNOWN_CLAIM_ID), 'requestedRefs missing');
  assert(typeof body.metadata.respondedAt === 'string', 'respondedAt missing');
  assert(typeof body.metadata.statusFunctionVersion === 'string', 'statusFunctionVersion missing');
  assert(body.metadata.statusFunctionVersion === BUNDLE_SFV, `statusFunctionVersion should be "${BUNDLE_SFV}"`);
});

await test('Response schemaVersion echoes the served bundle', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}`);
  const res = await onRequest(ctx);
  const body = await res.json();
  assert(body.schemaVersion === BUNDLE_SCHEMA_VERSION,
    `expected schemaVersion ${BUNDLE_SCHEMA_VERSION}, got ${body.schemaVersion}`);
});

await test('GET known integrityRef returns 200 with multiple claims', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_INTEGRITY_REF)}`);
  const res = await onRequest(ctx);
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(body.claims.length > 1, 'expected multiple claims sharing integrityRef');
  assert(body.metadata.unknownRefs.length === 0, 'should have no unknown refs');
});

await test('GET unknown ref returns 200 with unknownRefs populated', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(UNKNOWN_REF)}`);
  const res = await onRequest(ctx);
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(body.claims.length === 0, 'should return no claims');
  assert(body.metadata.unknownRefs.includes(UNKNOWN_REF), 'unknown ref must be in unknownRefs');
  assert(body.metadata.requestedRefs.includes(UNKNOWN_REF), 'should be in requestedRefs');
});

await test('GET mixed known+unknown refs returns 200 with correct unknownRefs', async () => {
  const url = `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}&ref=${encodeURIComponent(UNKNOWN_REF)}`;
  const ctx = makeContext('GET', url);
  const res = await onRequest(ctx);
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(body.claims.some(c => c.id === KNOWN_CLAIM_ID), 'known claim should be present');
  assert(body.metadata.unknownRefs.includes(UNKNOWN_REF), 'unknown ref must be in unknownRefs');
  assert(!body.metadata.unknownRefs.includes(KNOWN_CLAIM_ID), 'known ref must not be in unknownRefs');
  assert(body.metadata.requestedRefs.length === 2, 'requestedRefs should have 2 items');
});

await test('GET no refs returns 400', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}`);
  const res = await onRequest(ctx);
  assert(res.status === 400, `status ${res.status}`);
});

await test('POST with refs array returns 200', async () => {
  const ctx = makeContext('POST', `https://hachure.org${VERIFY_PATH}`, { refs: [KNOWN_CLAIM_ID] });
  const res = await onRequest(ctx);
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(body.claims.some(c => c.id === KNOWN_CLAIM_ID), 'claim not found');
});

await test('POST empty refs returns 400', async () => {
  const ctx = makeContext('POST', `https://hachure.org${VERIFY_PATH}`, { refs: [] });
  const res = await onRequest(ctx);
  assert(res.status === 400, `status ${res.status}`);
});

await test('POST unknown ref returns 200 with unknownRefs', async () => {
  const ctx = makeContext('POST', `https://hachure.org${VERIFY_PATH}`, { refs: [UNKNOWN_REF] });
  const res = await onRequest(ctx);
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(body.metadata.unknownRefs.includes(UNKNOWN_REF), 'unknown ref must be reported');
});

await test('DELETE returns 405', async () => {
  const ctx = makeContext('DELETE', `https://hachure.org${VERIFY_PATH}`);
  const res = await onRequest(ctx);
  assert(res.status === 405, `status ${res.status}`);
});

await test('PUT returns 405', async () => {
  const ctx = makeContext('PUT', `https://hachure.org${VERIFY_PATH}`);
  const res = await onRequest(ctx);
  assert(res.status === 405, `status ${res.status}`);
});

await test('Schema $id URLs 302 to unpkg for the published package', async () => {
  const ctx = makeContext('GET', 'https://hachure.org/schemas/trust-bundle.schema.json');
  const res = await onRequest(ctx);
  assert(res.status === 302, `status ${res.status}`);
  const loc = res.headers.get('location');
  assert(loc === 'https://unpkg.com/hachure@latest/schemas/trust-bundle.schema.json', `location ${loc}`);
});

await test('Non-verify path passes through to ASSETS', async () => {
  const ctx = makeContext('GET', 'https://hachure.org/trust/latest.json');
  // Should call ASSETS — our mock returns 404 for non-bundle paths, which is fine
  // The test just checks that the function does NOT handle it as a verify request
  const res = await onRequest(ctx);
  // We just verify no crash and the function returned something
  assert(res !== undefined, 'should return a response');
});

await test('metadata.unknownRefs is present even when empty', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}`);
  const res = await onRequest(ctx);
  const body = await res.json();
  assert('unknownRefs' in body.metadata, 'unknownRefs must be present');
  assert(Array.isArray(body.metadata.unknownRefs), 'unknownRefs must be array');
});

await test('Response body includes required metadata keys', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}`);
  const res = await onRequest(ctx);
  const body = await res.json();
  const required = ['respondedAt', 'statusFunctionVersion', 'evaluatedAt', 'requestedRefs', 'unknownRefs'];
  for (const key of required) {
    assert(key in body.metadata, `metadata.${key} missing`);
  }
});

await test('statusFunctionVersion comes from claim.value in bundle', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}`);
  const res = await onRequest(ctx);
  const body = await res.json();
  assert(body.metadata.statusFunctionVersion === BUNDLE_SFV,
    `expected "${BUNDLE_SFV}" got "${body.metadata.statusFunctionVersion}"`);
});


await test('metadata.evaluatedAt is "generation" (static bundle server)', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}`);
  const res = await onRequest(ctx);
  const body = await res.json();
  assert(body.metadata.evaluatedAt === 'generation',
    `expected "generation" got "${body.metadata.evaluatedAt}"`);
});

await test('nonce echo: GET nonce is echoed byte-for-byte in metadata', async () => {
  const ctx = makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}&nonce=abc-123_XYZ`);
  const res = await onRequest(ctx);
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(body.metadata.nonce === 'abc-123_XYZ', `nonce echo mismatch: ${body.metadata.nonce}`);
});

await test('nonce echo: POST body nonce is echoed; absent nonce yields no metadata.nonce', async () => {
  const withNonce = await onRequest(makeContext('POST', `https://hachure.org${VERIFY_PATH}`, { refs: [KNOWN_CLAIM_ID], nonce: 'n-1' }));
  const b1 = await withNonce.json();
  assert(b1.metadata.nonce === 'n-1', 'POST nonce must be echoed');
  const without = await onRequest(makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}`));
  const b2 = await without.json();
  assert(!('nonce' in b2.metadata), 'metadata.nonce MUST be omitted when the request carried none');
});

await test('nonce validation: over-length nonce returns 400', async () => {
  const long = 'x'.repeat(129);
  const res = await onRequest(makeContext('GET', `https://hachure.org${VERIFY_PATH}?ref=${encodeURIComponent(KNOWN_CLAIM_ID)}&nonce=${long}`));
  assert(res.status === 400, `status ${res.status}`);
});

// Summary
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
