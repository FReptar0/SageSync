# Phase 2: Enforcement Surface - Research

**Researched:** 2026-04-07
**Domain:** Express.js middleware, route protection, frontend polling, dashboard UI
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Block EVERYTHING when license is invalid — including the dashboard (/) static HTML
- Only GET /api/system/license stays accessible (for programmatic checks)
- 503 response includes license state info (INVALID/ERROR) so admin can diagnose from API response
- Message format: "Licencia inactiva. Contacte a su proveedor." + state field in JSON
- GET /api/system/license returns full status: state, active, expiresAt, lastChecked, lastSuccessfulCheck, hmacConfigured
- Matches sageconnect's implementation
- Always accessible regardless of license state — no middleware on this route
- Add as new route in systemRoutes.js
- Show expiry countdown: warning at ≤30 days (yellow/orange), danger at ≤7 days (red)
- When license is INVALID: full red banner with "Licencia inactiva. Contacte a su proveedor."
- Poll /api/system/license every 60 seconds from frontend JS
- Banner should block interaction when license is actually INVALID (not just expiring)
- Phase 1 already wires periodic validateLicense() calls in cron callbacks
- This phase adds the isValid() check in the require-license middleware for HTTP routes
- Cron guard behavior: skip cycle silently with Winston warning log when license not VALID

### Claude's Discretion
- Banner styling approach (native dark theme CSS vars vs sageconnect red bar)
- Middleware implementation details (Express middleware function shape)
- Where to add the JS polling logic in index.html (inline script or separate file)
- Exact 503 JSON response structure

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENF-01 | All API routes except /api/system/license return 503 when license is invalid | Middleware pattern from sageconnect require-license.js; Express `app.use()` placement before `express.static` in main.js |
| ENF-02 | Cron sync cycles are skipped when license is invalid | Already partially implemented in main.js cron callback (isValid() guard present); requirement is confirmed working pattern, verify logger.warn not logger.error |
| STS-01 | GET /api/system/license endpoint returns current license state (always accessible) | sageconnect system-routes.js GET /license pattern; LicenseValidator.getStatus() already exports all needed fields |
| STS-02 | Frontend dashboard shows license status banner when invalid/expiring | sageconnect shared.js checkLicenseStatus() pattern; index.html uses --accent-error (#ff4444) and --accent-warning (#ffaa00) CSS vars already defined |
</phase_requirements>

---

## Summary

Phase 2 wires license enforcement into the three operational paths not yet covered by Phase 1: HTTP routes (all except the license endpoint), the dashboard static HTML serve, and the frontend display layer. The work is almost entirely plumbing — connecting Phase 1's already-working `isValid()` and `getStatus()` calls to Express middleware, a new route handler, and a frontend polling loop. No new libraries are needed.

The critical architectural constraint is that `express.static` must be intercepted before it serves `index.html` when the license is invalid. In `main.js`, `express.static` is mounted at line 34 before any routes. The require-license middleware must be inserted into the Express chain BEFORE `app.use(express.static(...))` — or the static serve must be converted to an explicit `app.get('/')` route that is itself gated. Since the current code already has `app.get('/')` at line 69 that sends `index.html`, the middleware can be placed after `express.json()` but before `express.static` to catch both the API and the HTML serve path.

The sageconnect reference implementation covers all four deliverables: `require-license.js` is a 10-line function, the `GET /license` endpoint in `system-routes.js` is 10 lines, and the `checkLicenseStatus()` + polling pattern in `shared.js` is the exact pattern to adapt for SageSync's inline-JS dashboard.

**Primary recommendation:** Copy sageconnect patterns directly — middleware, route handler, and frontend poller — adapting only the response envelope shape (SageSync uses plain JSON objects, not `errorResult()`/`successResult()` helpers) and the banner CSS (use native `--accent-error` / `--accent-warning` CSS vars already defined in index.html).

---

## Standard Stack

### Core (all already in package.json — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^4.18.2 | Middleware chain + routing | Already the HTTP framework |
| winston | ^3.11.0 | Warning logs for cron skip | Already the logger singleton |
| jest + supertest | ^29.7.0 / ^6.3.4 | Unit + integration tests for middleware and route | Already dev dependencies |

### No New Dependencies
This phase requires zero new npm packages. All capabilities already exist in the project.

---

## Architecture Patterns

### Recommended File Changes

```
src/
├── middleware/
│   ├── errorHandler.js        (existing — do not modify)
│   └── requireLicense.js      (NEW — ~15 lines)
├── routes/
│   ├── index.js               (MODIFY — apply requireLicense before route mounts)
│   └── systemRoutes.js        (MODIFY — add GET /license handler)
├── main.js                    (MODIFY — apply requireLicense before express.static)
public/
└── index.html                 (MODIFY — add license banner HTML + polling JS)
```

### Pattern 1: requireLicense Middleware

**What:** Express middleware that reads `isValid()` from LicenseValidator singleton (synchronous, no HTTP) and returns 503 if false.

**When to use:** Mounted in main.js before `express.static` so it gates BOTH the static HTML serve AND the API routes.

**Key insight for SageSync:** `main.js` mounts `express.static` at line 34, before the route at line 69 (`app.get('/')`). If the middleware is only placed in `routes/index.js`, the static serve at line 34 bypasses it entirely. The middleware must also be applied in `main.js` before the static serve.

```javascript
// src/middleware/requireLicense.js
// Source: sageconnect/src/middleware/require-license.js (adapted)
const { isValid, getStatus } = require('../services/LicenseValidator');

function requireLicense(req, res, next) {
    if (!isValid()) {
        const status = getStatus();
        return res.status(503).json({
            error: 'Licencia inactiva. Contacte a su proveedor.',
            state: status.state,
        });
    }
    next();
}

module.exports = { requireLicense };
```

SageSync does NOT have `errorResult()` / `successResult()` helpers — use plain JSON. The `state` field (INVALID/ERROR) satisfies the diagnostic requirement from CONTEXT.md.

### Pattern 2: Mounting Strategy in main.js

**What:** Middleware is inserted at exactly the right position in the Express chain.

**Critical ordering:**
```javascript
// src/main.js (modified)
app.use(express.json());

// --- INSERT requireLicense HERE (before express.static) ---
const { requireLicense } = require('./middleware/requireLicense');
// Exempt /api/system/license from the middleware
app.use((req, res, next) => {
    if (req.path === '/api/system/license') return next();
    requireLicense(req, res, next);
});

app.use(express.static(path.join(__dirname, '../public')));
// ... rest unchanged
```

**Alternative — simpler, preferred:** Mount the exemption-aware wrapper once in main.js rather than scattering it across route files. This single location guarantees the static serve is also gated.

### Pattern 3: GET /api/system/license Endpoint

**What:** New route in `systemRoutes.js` that always returns full license status. No middleware applied to this route.

**Key:** `getStatus()` in LicenseValidator already returns `{ active, expiresAt, lastChecked, state, lastSuccessfulCheck }`. Only `hmacConfigured` needs to be added (check `licenseConfig.hmacSecret` truthy).

```javascript
// src/routes/systemRoutes.js — add this handler
// Source: sageconnect/src/routes/system-routes.js GET /license
const licenseConfig = require('../config/license');
const { getStatus } = require('../services/LicenseValidator');

router.get('/license', (_req, res) => {
    const status = getStatus();
    res.json({
        ...status,
        hmacConfigured: Boolean(licenseConfig.hmacSecret),
    });
});
```

This route is mounted under `/api` in main.js via `app.use('/api', apiRoutes)` and `routes/index.js` mounts systemRoutes at `/`. The final path is `/api/license` — confirm the exemption path in the middleware matches exactly.

**Important path check:** The route will be reachable at `GET /api/license` (systemRoutes mounts at `/` under `/api`). The CONTEXT.md and requirements say `/api/system/license`. Check if `routes/index.js` or `main.js` adds a `/system` prefix. Current `routes/index.js` shows `router.use('/', systemRoutes)` — no `/system` prefix. The current routes in systemRoutes are `/status` and `/test/connections`, which would be `/api/status` and `/api/test/connections`. The user and CONTEXT.md say `/api/system/license`. This means either there is a `/system` prefix somewhere not visible in `routes/index.js`, or the endpoint should be registered as `router.get('/system/license', ...)`. **This must be resolved in planning — verify the actual URL for `/api/status` by checking what systemController serves or how routes/index.js prefixes.**

### Pattern 4: Frontend License Polling

**What:** Inline JS in `public/index.html` that calls `GET /api/system/license` every 60s and renders a banner.

**Adaptation from sageconnect:** SageSync's `index.html` has no sidebar (sageconnect's badge injection uses `#sidebar hr`). The banner must be injected at `document.body` start (same as sageconnect's inactive banner) or inside `.container` as first child.

**SageSync-native CSS vars to use:**
- `--accent-error: #ff4444` — INVALID state banner background / border
- `--accent-warning: #ffaa00` — expiry warning ≤30 days
- `--bg-card: #161616` — banner background fill

```javascript
// To add in index.html <script> block — adapted from sageconnect/public/js/shared.js
async function checkLicenseStatus() {
    try {
        var res = await fetch('/api/system/license', { headers: { 'Accept': 'application/json' } });
        var json = await res.json();
        if (!json.state) return;  // plain JSON (not success envelope)

        var state = json.state;
        var expiresAt = json.expiresAt;

        // --- INVALID banner ---
        var banner = document.getElementById('license-banner');
        if (state === 'INVALID' || state === 'ERROR') {
            if (!banner) {
                document.body.insertAdjacentHTML('afterbegin',
                    '<div id="license-banner" style="' +
                    'background: var(--accent-error); color: #fff; text-align: center; ' +
                    'padding: 12px; font-weight: 700; position: sticky; top: 0; z-index: 1050; ' +
                    'pointer-events: none;">' +
                    'Licencia inactiva. Contacte a su proveedor. [' + state + ']' +
                    '</div>'
                );
            }
        } else {
            if (banner) banner.remove();
        }

        // --- Expiry countdown ---
        var existingBadge = document.getElementById('license-expiry-badge');
        if (existingBadge) existingBadge.remove();

        if (expiresAt && state === 'VALID') {
            var days = Math.ceil((new Date(expiresAt) - Date.now()) / 86400000);
            if (days <= 30) {
                var color = days <= 7 ? 'var(--accent-error)' : 'var(--accent-warning)';
                var dayLabel = days === 1 ? 'dia' : 'dias';
                document.querySelector('.header').insertAdjacentHTML('beforeend',
                    '<div id="license-expiry-badge" style="' +
                    'display:inline-block; background:' + color + '; color:#000; ' +
                    'padding:4px 12px; border-radius:4px; font-size:0.85rem; margin-top:8px;">' +
                    'Expira en ' + days + ' ' + dayLabel +
                    '</div>'
                );
            }
        }
    } catch (err) {
        // silent — license UI is non-critical
    }
}

// In DOMContentLoaded:
checkLicenseStatus();
setInterval(checkLicenseStatus, 60000);
```

**Note on response shape:** The `GET /api/system/license` endpoint (Pattern 3) returns plain JSON — no `.data` wrapper. Sageconnect's frontend reads `json.data.state` but SageSync's endpoint returns `json.state` directly. The frontend code must match.

### Pattern 5: Cron Guard (ENF-02)

**What:** Already partially implemented in `main.js` (line 52-55). Needs verification that the log level is `logger.warn` not `logger.error`.

Current code in main.js:
```javascript
await validateLicense();
if (!isValid()) {
    logger.error('License invalid — skipping scheduled sync');  // <-- currently logger.error
    return;
}
```

**CONTEXT.md says:** "Cron guard behavior: skip cycle silently with Winston warning log." Change `logger.error` to `logger.warn`. The current code already satisfies ENF-02 behaviorally — only the log level needs adjustment.

### Anti-Patterns to Avoid

- **Placing requireLicense only in routes/index.js:** Static files served by `express.static` bypass the API router entirely. Middleware must be in `main.js` before the static serve call.
- **Using `router.use(requireLicense)` in all route files individually:** More points of failure; a single exemption-aware wrapper in `main.js` is sufficient and complete.
- **Wrapping the license endpoint in the require-license middleware:** The license endpoint must be callable when the license is invalid. Always check path before applying middleware.
- **Reading `json.data.state` from frontend:** SageSync's endpoint returns plain JSON (not a `successResult()` envelope). Frontend must read `json.state` directly.
- **Injecting the expiry badge into `#sidebar hr`:** SageSync has no sidebar. Inject into `.header` or another stable anchor.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| License state check | Custom state storage | `LicenseValidator.isValid()` / `getStatus()` (already built in Phase 1) | Already handles all three states + ERROR TTL |
| 503 response | Custom error middleware | Inline `res.status(503).json(...)` in requireLicense | No need for error-throw pattern here; direct response is clearer |
| HMAC verification | Anything new | Already in LicenseValidator — not this phase's concern | Phase 1 complete |
| Frontend fetch | Custom HTTP wrapper | Native `fetch()` | No deps needed; sageconnect pattern works without axios |

---

## Common Pitfalls

### Pitfall 1: Static File Bypass
**What goes wrong:** If `requireLicense` is only mounted in `app.use('/api', apiRoutes)`, then `GET /` and `GET /index.html` are served by `express.static` before the API router is consulted, so the dashboard loads even when the license is invalid.
**Why it happens:** `express.static` is a standalone middleware, not part of the API router. It runs before `app.use('/api', ...)`.
**How to avoid:** Mount the license check in `main.js` before `app.use(express.static(...))`. The check should skip only `/api/system/license` (or `/api/license` — confirm actual path).
**Warning signs:** Dashboard HTML loads successfully but all API calls return 503.

### Pitfall 2: Wrong Exemption Path
**What goes wrong:** The exemption in the middleware checks `req.path === '/api/system/license'` but the route is actually mounted at `/api/license` (no `/system` prefix), or vice versa.
**Why it happens:** `routes/index.js` uses `router.use('/', systemRoutes)` — no `/system` prefix is added. The full path depends on what prefix is used in `main.js`'s `app.use('/api', apiRoutes)`.
**How to avoid:** Confirm the actual URL by tracing: `main.js` → `app.use('/api', apiRoutes)` → `routes/index.js` → `router.use('/', systemRoutes)` → `systemRoutes.js` → `router.get('/license', ...)` = `/api/license`. If the requirements say `/api/system/license`, the route must be registered as `router.get('/system/license', ...)` in systemRoutes.js.
**Warning signs:** `GET /api/system/license` returns 503 (the exemption path doesn't match).

### Pitfall 3: Response Shape Mismatch (Frontend)
**What goes wrong:** Frontend reads `json.data.state` (sageconnect envelope shape) but the endpoint returns `{ state, active, ... }` directly (plain JSON).
**Why it happens:** Copying sageconnect's frontend code without adapting to SageSync's response shape.
**How to avoid:** SageSync's `GET /api/system/license` returns plain JSON — read `json.state`, not `json.data.state`.
**Warning signs:** `state` is always `undefined`, banner never appears.

### Pitfall 4: Cron Log Level
**What goes wrong:** `logger.error` vs `logger.warn` for the cron skip. CONTEXT.md says "silently with Winston warning log" — using `error` level may cause noise or trigger alerting.
**How to avoid:** Change the existing `logger.error('License invalid — skipping...')` in main.js to `logger.warn`.

---

## Code Examples

### requireLicense Middleware (complete, verified pattern)
```javascript
// src/middleware/requireLicense.js
// Source: adapted from sageconnect/src/middleware/require-license.js
const { isValid, getStatus } = require('../services/LicenseValidator');

function requireLicense(req, res, next) {
    if (!isValid()) {
        const status = getStatus();
        return res.status(503).json({
            error: 'Licencia inactiva. Contacte a su proveedor.',
            state: status.state,
        });
    }
    next();
}

module.exports = { requireLicense };
```

### Middleware mounting in main.js (insertion point)
```javascript
// After: app.use(express.json());
// Before: app.use(express.static(...));

const { requireLicense } = require('./middleware/requireLicense');
const LICENSE_EXEMPT_PATH = '/api/system/license';  // confirm exact path

app.use((req, res, next) => {
    if (req.path === LICENSE_EXEMPT_PATH) return next();
    requireLicense(req, res, next);
});
```

### GET /license route handler
```javascript
// In src/routes/systemRoutes.js
// Source: adapted from sageconnect/src/routes/system-routes.js
const licenseConfig = require('../config/license');
const { getStatus } = require('../services/LicenseValidator');

router.get('/system/license', (_req, res) => {
    const status = getStatus();
    res.json({
        ...status,
        hmacConfigured: Boolean(licenseConfig.hmacSecret),
    });
});
```

### LicenseValidator.getStatus() return shape (confirmed from Phase 1 source)
```javascript
// Returns (synchronous, no HTTP):
{
    active: false,           // boolean
    expiresAt: null,         // ISO string or null
    lastChecked: null,       // ISO string or null
    state: 'UNKNOWN',        // 'VALID' | 'INVALID' | 'ERROR' | 'UNKNOWN'
    lastSuccessfulCheck: null // ISO string or null
}
// + hmacConfigured added by route handler
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| Phase 1 only gates startup + cron | Phase 2 adds HTTP middleware gate | All operational paths covered |
| Dashboard accessible regardless | Dashboard blocked when license invalid | Consistent enforcement |

---

## Open Questions

1. **Exact path for the license endpoint: `/api/license` or `/api/system/license`?**
   - What we know: `routes/index.js` mounts systemRoutes at `router.use('/', systemRoutes)`. With `app.use('/api', apiRoutes)`, this makes paths like `/api/status` and `/api/test/connections`.
   - What's unclear: The requirements and CONTEXT.md consistently say `/api/system/license`, but existing routes (`/status`, `/test/connections`) have no `/system` prefix.
   - Recommendation: Register the new route as `router.get('/system/license', ...)` to match the documented URL. Update middleware exemption to use `/api/system/license`.

2. **Does `pointer-events: none` on the INVALID banner sufficiently "block interaction"?**
   - What we know: CONTEXT.md says "Banner should block interaction when license is actually INVALID."
   - What's unclear: Whether a pointer-events overlay is enough vs. a modal/overlay that truly prevents clicks on the page.
   - Recommendation: Use `pointer-events: none` on the banner itself but add a full-page overlay (`position:fixed; inset:0; z-index:1049`) with high opacity to visually block. This is within Claude's discretion per CONTEXT.md.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | jest.config.js (root) |
| Quick run command | `npx jest tests/services/requireLicense.test.js --no-coverage` |
| Full suite command | `npx jest --no-coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENF-01 | requireLicense returns 503 when isValid()=false; calls next() when isValid()=true | unit | `npx jest tests/services/requireLicense.test.js -t "returns 503" --no-coverage` | ❌ Wave 0 |
| ENF-01 | GET /api/status returns 503 when license invalid; GET /api/system/license returns 200 always | integration | `npx jest tests/integration/licenseEnforcement.test.js --no-coverage` | ❌ Wave 0 |
| ENF-02 | Cron callback calls logger.warn and returns early when isValid()=false | unit | `npx jest tests/services/requireLicense.test.js -t "cron" --no-coverage` | ❌ Wave 0 |
| STS-01 | GET /api/system/license returns all required fields (state, active, expiresAt, lastChecked, lastSuccessfulCheck, hmacConfigured) | integration | `npx jest tests/integration/licenseEnforcement.test.js -t "status endpoint" --no-coverage` | ❌ Wave 0 |
| STS-02 | Frontend polling function populates banner element correctly | manual | N/A — no headless browser in test suite | manual only |

### Sampling Rate
- **Per task commit:** `npx jest tests/services/requireLicense.test.js --no-coverage`
- **Per wave merge:** `npx jest --no-coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/services/requireLicense.test.js` — unit tests for ENF-01 (middleware), ENF-02 (cron log level)
- [ ] `tests/integration/licenseEnforcement.test.js` — supertest integration for ENF-01 (route blocking), STS-01 (endpoint fields)
- [ ] Shared supertest app setup in `tests/integration/` (if not already present)

*(STS-02 frontend banner is manual-only — no headless browser in test infrastructure)*

---

## Sources

### Primary (HIGH confidence)
- Direct file read: `sageconnect/src/middleware/require-license.js` — middleware pattern
- Direct file read: `sageconnect/src/routes/system-routes.js` — GET /license endpoint pattern
- Direct file read: `sageconnect/public/js/shared.js` — checkLicenseStatus() + polling pattern
- Direct file read: `SageSync/src/services/LicenseValidator.js` — getStatus() return shape, isValid() behavior
- Direct file read: `SageSync/src/main.js` — Express chain order, static serve position, cron code
- Direct file read: `SageSync/src/routes/systemRoutes.js` — existing route structure
- Direct file read: `SageSync/public/index.html` — CSS vars, body structure, DOMContentLoaded pattern
- Direct file read: `SageSync/src/middleware/errorHandler.js` — middleware export pattern to follow

### Secondary (MEDIUM confidence)
- `SageSync/jest.config.js` + `package.json` — test framework confirmed as Jest 29 + supertest

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all libraries already installed
- Architecture: HIGH — reference implementation read directly from sageconnect, all integration points confirmed from source
- Pitfalls: HIGH — identified from direct code inspection (static serve bypass, path mismatch, response shape mismatch are concrete observable issues)

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable domain — Express middleware patterns are stable)
