---
description: Tail and summarize the most recent SageSync winston log lines into a readable health snapshot. Highlights the last sync result, the latest license check, and any errors in the last hour.
argument-hint: [lines]
allowed-tools: Bash, Read
---

You are summarizing the recent activity of a SageSync instance from its winston log files.

## Inputs

- `$ARGUMENTS` — optional integer for how many lines to inspect (default 200).

## Files to read

- `logs/sagesync.log` — main log, info+warn+error.
- `logs/error.log` — error-only mirror.

If neither file exists, report that and stop. The user is likely running outside a deployed install.

## Steps

1. Determine N (lines). Default 200. If `$ARGUMENTS` is a valid positive integer, use that.
2. Read the last N lines of `logs/sagesync.log`:
   ```bash
   tail -n <N> logs/sagesync.log
   ```
3. Read the last 50 lines of `logs/error.log` (always 50, regardless of N):
   ```bash
   tail -n 50 logs/error.log
   ```
4. Parse each line. Lines are JSON (winston `format.json()`) — use `JSON.parse` mentally; fall back to substring matching if a line isn't JSON.

## Extract and report

Build a compact summary with these sections:

### Header

- Time range covered (first timestamp → last timestamp in the inspected window).
- Total lines parsed; how many of each level (info / warn / error).

### Last sync

Look for entries like `Iniciando proceso de sincronización` and `RESUMEN DE SINCRONIZACIÓN`. Report:

- Started at: <ISO>.
- Completed at: <ISO> (or "not yet — last update X minutes ago").
- Summary numbers if available: total items, processed, updated, created, errors, warehouses verified.

### License check

Look for `[LICENSE]` entries. Report:

- Most recent state log (`License VALID. Expires: ...` / `License INVALID` / `HMAC signature mismatch` / `Startup retry ...` / `License invalid — skipping scheduled sync`).
- Timestamp of that entry.

### Errors in window

Group recent errors. For each unique error message (first ~80 chars), report:

- Count.
- First and last occurrence timestamps.
- Suggested category (DB, Fracttal API, License, Sage SQL, Other) based on keywords.

### Anomalies

Flag anything unusual:

- Repeated `Token expirado, renovando...` more than 2× in window.
- Repeated `[LICENSE] Validation request failed` more than 3× — possible license server issue.
- Any `UNAUTHORIZED_ENDPOINT` — module not enabled in Fracttal tenant.
- Any `Error conectando a la base de datos` — Sage300 reachability problem.

### One-line health summary

End with a single line: `Status: HEALTHY` / `Status: DEGRADED — <reason>` / `Status: BROKEN — <reason>`.

## Constraints

- Do NOT print full log lines verbatim if they contain anything that looks like a token, password, or API key. Redact aggressively.
- Do NOT execute any sync or restart commands. This is read-only diagnostic.
- If the log files exist but are empty, say so and stop.
