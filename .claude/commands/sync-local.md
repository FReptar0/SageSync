---
description: Run the canonical 10-step Fracttal sandbox workflow (npm run test:workflow) with sanity checks first. Use to validate changes that touch FracttalClient or the three-case sync logic before promoting.
allowed-tools: Read, Bash, Grep
---

You are running the SageSync canonical sandbox workflow to validate Fracttal API interactions end-to-end. This test hits a real Fracttal sandbox tenant (`TEST001` warehouse) and exercises create + associate + adjust + read.

## Preflight (do these in order)

1. **Confirm we're not on the user's production `.env`.** Read the current `.env` (or its presence) — if `FRACTTAL_BASE_URL` looks production-ish (e.g., the client's tenant, not `app.fracttal.com` sandbox account), STOP and ask the user before continuing.
   - Note: `app.fracttal.com` itself is fine. The discriminator is the `FRACTTAL_CLIENT_ID` / `CLIENT_SECRET` pair — they must be the sandbox pair.
2. **Confirm the test file path:** `tests/manual/test-workflow.js`.
3. **Verify Node is installed:**
   ```bash
   node --version
   ```
   Expect `v18.x` or higher.
4. **Run the workflow:**
   ```bash
   npm run test:workflow
   ```
   Capture full stdout + stderr.
5. **Parse the result.** The test prints a summary header `RESUMEN` or "X/Y steps passing". The expected baseline is **9/9 passing, 0 errors** (against `TEST001`).

## Reporting

After the run, present:

- **Outcome** — passed / failed.
- **Step-by-step status** — for each of the 10 steps the test runs, mark OK / FAIL.
- **Errors** — for any failing step, paste the exact error line(s) plus the Fracttal status code/body if relevant.
- **Token state** — note whether `.fracttal-token` was newly created or reused (check timestamps before/after).
- **Recommended action** — if all green, say so; if something failed, suggest the most likely cause (rotated credentials, sandbox module changes, code regression in `fracttalClient.js`).

## Constraints

- Do NOT commit any artifact created by the test (the test sometimes writes JSON dumps to `logs/`).
- Do NOT print full OAuth tokens. If you must reference a token in the report, redact to first 8 chars + `…`.
- Do NOT modify code based on the test failing — that's a separate task. Report and stop.

$ARGUMENTS
