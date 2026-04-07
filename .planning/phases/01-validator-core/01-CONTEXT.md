# Phase 1: Validator Core - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

LicenseValidator service that validates against the remote license server on startup and periodically. Includes config wiring, HMAC-SHA256 verification, timestamp freshness, three-state cache (VALID/INVALID/ERROR), startup gate that blocks all entry points, and DNS bypass detection. No email alerts.

</domain>

<decisions>
## Implementation Decisions

### Entry Point Gating
- ALL three entry points must be gated: main.js (Express+cron), app.js (sync-only), sync.js (direct execution)
- No way to run SageSync without a valid license — full lockdown
- App exits with code 1 if license validation fails after 3 retries at startup

### Env Var Validation
- Validate that ALL critical env vars exist before the app attempts to start — not just license vars
- If any required env var is missing, fail immediately with a clear error message listing what's missing
- License-specific vars: LICENSE_API_URL, HMAC_SECRET, SAGESYNC_API_KEY

### Adaptation Approach
- Port LicenseValidator.js from sageconnect and adapt (do NOT rewrite from scratch)
- Swap sageconnect's LogGenerator → SageSync's Winston logger
- Swap sageconnect's flat config.js references → SageSync config structure
- Remove email alert logic (nodemailer not needed)
- Preserve all security logic verbatim: HMAC verification, timestamp freshness, DNS check, three-state cache, 24h ERROR→INVALID TTL

### API Key Naming
- Environment variable: SAGESYNC_API_KEY (mirrors SAGECONNECT_API_KEY pattern)
- Register as new client on existing sageconnect-license.vercel.app

### Claude's Discretion
- Whether license config goes in config/server.js or a new config/license.js
- Exact structure of the env var validation (order, grouping, error format)
- Whether to add a shared validate-env utility or inline in each entry point

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config/logger.js`: Winston singleton — use for all license logging instead of sageconnect's LogGenerator
- `config/server.js`: Env var config with dotenv — license vars should follow same pattern
- `config/configManager.js`: Has validateConfig() for business config — similar pattern for env validation

### Established Patterns
- Config: env vars in config/server.js, business config in config.json via ConfigManager class
- Logging: Winston with file rotation (error.log + sagesync.log), console in non-production
- Entry points: main.js creates Express app + cron, app.js is standalone sync, sync.js is direct execution

### Integration Points
- main.js line 61: `app.listen()` — license gate must run BEFORE server starts
- app.js line 174: `cron.schedule()` — license gate must run BEFORE cron starts
- sync.js: direct `syncInventory()` call — license gate before execution
- config/server.js: add license env vars alongside existing config

</code_context>

<specifics>
## Specific Ideas

- "Make sure that NOTHING works without that key"
- "Validate that all the rest important ones exist" — env var validation beyond just license vars
- Reference implementation: sageconnect/src/services/LicenseValidator.js (306 lines, proven in production)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-validator-core*
*Context gathered: 2026-04-07*
