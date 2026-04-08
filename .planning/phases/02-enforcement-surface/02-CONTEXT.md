# Phase 2: Enforcement Surface - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire license state into every operational path: require-license middleware on all routes (503 when invalid), cron guard that skips sync cycles, GET /api/system/license status endpoint (always accessible), and frontend dashboard banner showing license state and expiry countdown.

</domain>

<decisions>
## Implementation Decisions

### 503 Behavior
- Block EVERYTHING when license is invalid — including the dashboard (/) static HTML
- Only GET /api/system/license stays accessible (for programmatic checks)
- 503 response includes license state info (INVALID/ERROR) so admin can diagnose from API response
- Message format: "Licencia inactiva. Contacte a su proveedor." + state field in JSON

### License Status Endpoint
- GET /api/system/license returns full status: state, active, expiresAt, lastChecked, lastSuccessfulCheck, hmacConfigured
- Matches sageconnect's implementation
- Always accessible regardless of license state — no middleware on this route
- Add as new route in systemRoutes.js

### Dashboard Banner
- Show expiry countdown: warning at ≤30 days (yellow/orange), danger at ≤7 days (red)
- When license is INVALID: full red banner with "Licencia inactiva. Contacte a su proveedor."
- Poll /api/system/license every 60 seconds from frontend JS
- Banner should block interaction when license is actually INVALID (not just expiring)

### Cron Guard
- Phase 1 already wires periodic `validateLicense()` calls in cron callbacks
- This phase adds the `isValid()` check in the require-license middleware for HTTP routes
- Cron guard behavior: skip cycle silently with Winston warning log when license not VALID

### Claude's Discretion
- Banner styling approach (native dark theme CSS vars vs sageconnect red bar)
- Middleware implementation details (Express middleware function shape)
- Where to add the JS polling logic in index.html (inline script or separate file)
- Exact 503 JSON response structure

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/LicenseValidator.js`: Already exports `isValid()` and `getStatus()` — middleware just calls these
- `src/routes/systemRoutes.js`: Has GET /status and GET /test/connections — add GET /license here
- `public/index.html`: Dark theme dashboard with CSS vars (--accent-error, --accent-warning) — use for banner
- sageconnect `src/middleware/require-license.js`: 10-line reference for the middleware pattern

### Established Patterns
- Routes: flat-mounted in routes/index.js via `router.use('/', routeFile)`
- Middleware: errorHandler at `src/middleware/errorHandler.js` — follow same export pattern
- Frontend: single index.html with inline CSS and inline JS (no build step)

### Integration Points
- `routes/index.js`: Add requireLicense middleware before all route mounts except systemRoutes license endpoint
- `src/main.js`: Static file serving at line 21 — middleware must intercept before `express.static`
- `public/index.html`: Add license polling JS and banner HTML

</code_context>

<specifics>
## Specific Ideas

- sageconnect's require-license middleware is 10 lines — simple `isValid()` check returning 503
- sageconnect's frontend polls every 60s and shows badge with "Expira en X dias"
- SageSync dashboard already uses --accent-error (#ff4444) and --accent-warning (#ffaa00) CSS vars

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-enforcement-surface*
*Context gathered: 2026-04-07*
