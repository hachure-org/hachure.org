/**
 * Cloudflare Pages catch-all function.
 * Routes GET/POST /.well-known/hachure/verify per the hachure.org/v1
 * verification-endpoint profile.
 *
 * This is a from-scratch implementation of the profile, written from the
 * spec's text alone with no implementation library imported —
 * self-containedness is proof the profile is implementable from its text.
 *
 * Assurance level: L0 — unsigned, producer-asserted.
 */

const VERIFY_PATH = '/.well-known/hachure/verify';
const SOURCE = 'hachure-org-site';

// ---------------------------------------------------------------------------
// Index builder — called once per request after loading the bundle.
// The spec says: index claims by id + every integrityRef / integrityAnchor
// value found on claims/evidence.
// ---------------------------------------------------------------------------
export function buildIndex(bundle) {
  // Map: ref-string => Set of claim IDs whose claim or associated evidence
  // carries that ref.
  const refToClaimIds = new Map();

  function addRef(ref, claimId) {
    if (!ref || typeof ref !== 'string') return;
    if (!refToClaimIds.has(ref)) refToClaimIds.set(ref, new Set());
    refToClaimIds.get(ref).add(claimId);
  }

  for (const claim of bundle.claims || []) {
    const cid = claim.id;
    // Index by claim id itself
    addRef(cid, cid);
    // Index by integrityRef (canonical field per spec)
    addRef(claim.integrityRef, cid);
    // currentIntegrityRef is the field the v0.11.0 bundle uses
    addRef(claim.currentIntegrityRef, cid);
    // integrityAnchor may be an object with a .value
    const ia = claim.integrityAnchor || claim.currentIntegrityAnchor;
    if (ia) {
      if (typeof ia === 'string') addRef(ia, cid);
      else if (ia && typeof ia.value === 'string') addRef(ia.value, cid);
    }
  }

  // Evidence refs — resolve back to owning claimId
  const evidenceByClaimId = new Map();
  for (const ev of bundle.evidence || []) {
    if (!ev.claimId) continue;
    if (!evidenceByClaimId.has(ev.claimId)) evidenceByClaimId.set(ev.claimId, []);
    evidenceByClaimId.get(ev.claimId).push(ev);
    addRef(ev.integrityRef, ev.claimId);
    const ia = ev.integrityAnchor;
    if (ia) {
      if (typeof ia === 'string') addRef(ia, ev.claimId);
      else if (ia && typeof ia.value === 'string') addRef(ia.value, ev.claimId);
    }
  }

  // Events by claimId
  const eventsByClaimId = new Map();
  for (const event of bundle.events || []) {
    if (!event.claimId) continue;
    if (!eventsByClaimId.has(event.claimId)) eventsByClaimId.set(event.claimId, []);
    eventsByClaimId.get(event.claimId).push(event);
  }

  // Authority traces by claimId (if present)
  const authorityTraceByClaimId = new Map();
  for (const at of bundle.authorityTrace || []) {
    const cid = at.claimId || at.id;
    if (!cid) continue;
    if (!authorityTraceByClaimId.has(cid)) authorityTraceByClaimId.set(cid, []);
    authorityTraceByClaimId.get(cid).push(at);
  }

  // Derive statusFunctionVersion from the bundle.
  // The release script records it in the claim whose fieldOrBehavior is
  // 'statusFunctionVersion'. With evaluatedAt: "generation" the reported
  // version reflects the bundle's generation time (verification-endpoint.md
  // §Response shape); "1" is the fallback for bundles predating that claim.
  let statusFunctionVersion = '1';
  for (const claim of bundle.claims || []) {
    if (claim.fieldOrBehavior === 'statusFunctionVersion' && claim.value) {
      statusFunctionVersion = String(claim.value);
      break;
    }
  }

  return {
    refToClaimIds,
    claimsById: Object.fromEntries((bundle.claims || []).map(c => [c.id, c])),
    evidenceByClaimId,
    eventsByClaimId,
    authorityTraceByClaimId,
    statusFunctionVersion,
    schemaVersion: bundle.schemaVersion,
    source: bundle.source || SOURCE,
  };
}

// ---------------------------------------------------------------------------
// Response assembler
// ---------------------------------------------------------------------------
export function assembleResponse(requestedRefs, index, nonce) {
  const unknownRefs = [];
  const matchedClaimIds = new Set();

  for (const ref of requestedRefs) {
    const cids = index.refToClaimIds.get(ref);
    if (!cids || cids.size === 0) {
      unknownRefs.push(ref);
    } else {
      for (const cid of cids) matchedClaimIds.add(cid);
    }
  }

  const claims = [];
  const evidence = [];
  const events = [];
  const authorityTrace = [];

  for (const cid of matchedClaimIds) {
    const claim = index.claimsById[cid];
    if (claim) claims.push(claim);

    const evs = index.evidenceByClaimId.get(cid) || [];
    evidence.push(...evs);

    const evts = index.eventsByClaimId.get(cid) || [];
    events.push(...evts);

    const ats = index.authorityTraceByClaimId.get(cid) || [];
    authorityTrace.push(...ats);
  }

  return {
    // Echo the served bundle's declared schemaVersion — the endpoint relays
    // producer records verbatim, so the response must not claim a newer schema
    // than the bundle it serves.
    schemaVersion: index.schemaVersion,
    source: SOURCE,
    claims,
    evidence,
    events,
    authorityTrace,
    metadata: {
      respondedAt: new Date().toISOString(),
      // Replay-resistance echo (verification-endpoint.md §"Replay resistance"):
      // present iff the request carried a nonce, byte-for-byte.
      ...(nonce !== undefined ? { nonce } : {}),
      statusFunctionVersion: index.statusFunctionVersion,
      // Static bundle server — version reflects generation time, not live evaluation.
      // See verification-endpoint.md §Response shape, "statusFunctionVersion source".
      evaluatedAt: 'generation',
      requestedRefs,
      unknownRefs,
      assurance: 'producer-asserted (unsigned)',
    },
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Schema $id dereferencing: every normative schema's $id lives under
  // https://hachure.org/schemas/. The files ship in the `hachure` npm package;
  // a real 302 (not the ASSETS-wrapped HTML interstitial) to unpkg@latest
  // keeps them in lockstep with the published release with no copies to drift.
  if (url.pathname.startsWith('/schemas/') && url.pathname.endsWith('.json')) {
    const target = 'https://unpkg.com/hachure@latest/schemas/' + url.pathname.slice('/schemas/'.length);
    return Response.redirect(target, 302);
  }

  // Only handle the verify path; pass everything else through to static assets.
  if (url.pathname !== VERIFY_PATH) {
    return env.ASSETS.fetch(request);
  }

  // Method check
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Allow': 'GET, POST',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Parse requested refs (and optional replay-resistance nonce)
  let requestedRefs = [];
  let nonce;

  if (request.method === 'GET') {
    requestedRefs = url.searchParams.getAll('ref');
    nonce = url.searchParams.get('nonce') ?? undefined;
  } else {
    // POST — parse JSON body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonError(400, 'Invalid JSON body');
    }
    if (!Array.isArray(body && body.refs)) {
      return jsonError(400, 'Body must be { "refs": [...] }');
    }
    requestedRefs = body.refs;
    if (body.nonce !== undefined) nonce = body.nonce;
  }

  if (nonce !== undefined && (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 128)) {
    return jsonError(400, 'nonce must be a string of 1-128 characters');
  }

  // 400 if no refs provided
  if (requestedRefs.length === 0) {
    return jsonError(400, 'At least one ref is required (GET ?ref=... or POST {"refs":[...]})');
  }

  // Validate ref types
  for (const ref of requestedRefs) {
    if (typeof ref !== 'string') {
      return jsonError(400, 'All refs must be strings');
    }
  }

  // Load the bundle via ASSETS binding (Workers runtime, no Node APIs)
  let bundle;
  try {
    const bundleUrl = new URL('/trust/latest-bundle.json', request.url);
    const resp = await env.ASSETS.fetch(new Request(bundleUrl.toString()));
    if (!resp.ok) {
      return jsonError(500, 'Failed to load trust bundle: HTTP ' + resp.status);
    }
    bundle = await resp.json();
  } catch (err) {
    return jsonError(500, 'Failed to load trust bundle: ' + err.message);
  }

  const index = buildIndex(bundle);
  const responseBody = assembleResponse(requestedRefs, index, nonce);

  return new Response(JSON.stringify(responseBody, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'X-Hachure-Assurance': 'producer-asserted (unsigned)',
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
