---
description: Curl the local SageSync /api/system/license endpoint (or a remote one if a URL is passed) and explain the response. Decodes state, expiry, HMAC config, and stale-check timings into operator-friendly language.
argument-hint: [base-url]
allowed-tools: Bash
---

You are reporting on the current license state of a SageSync instance.

## Target

If `$ARGUMENTS` is non-empty, use it as the base URL (e.g., `https://client-server:3000`). Otherwise, default to `http://localhost:3000`.

Endpoint: `{base}/api/system/license`.

## Fetch

```bash
curl --max-time 5 -s "{base}/api/system/license"
```

If the request fails (timeout, connection refused), report that the service is not reachable and stop.

## Decoding the response

The endpoint returns JSON with these fields:

| Field | Meaning |
|-------|---------|
| `state` | `VALID` / `INVALID` / `ERROR` / `UNKNOWN` — the cached license state |
| `active` | boolean — last known active flag from the server |
| `expiresAt` | ISO timestamp — when the license expires (or null) |
| `lastChecked` | ISO — last time the validator hit the server |
| `lastSuccessfulCheck` | ISO — last VALID or INVALID response (NOT ERROR) |
| `hmacConfigured` | boolean — whether HMAC_SECRET is set in the running process |

## Interpretation rules

- `state: "VALID"` → app is licensed and operational. Sync runs, HTTP endpoints open.
- `state: "INVALID"` → license explicitly inactive or revoked. App locked, every endpoint except this one returns 503.
- `state: "ERROR"` → most recent check failed (network, HMAC mismatch, stale timestamp). The app uses the last successful state for up to 24h after `lastSuccessfulCheck`. After 24h, promotes to INVALID.
- `state: "UNKNOWN"` → app started but the validator hasn't run yet (shouldn't be seen in normal operation).

Compute and report:

- **Time since last check** — `now - lastChecked`. Should be small (cron runs every 2 AM by default, but startup also runs it; if the value is more than 24h, it's a red flag).
- **Time since last successful check** — `now - lastSuccessfulCheck`. If `state: "ERROR"`, this is the countdown to forced INVALID demotion (24h cap).
- **Time to expiry** — `expiresAt - now`. If less than 30 days, mention it (the dashboard's expiry badge shows in this window).
- **HMAC configured?** — if false, the app is misconfigured.

## Output format

```
SageSync License Status (<base-url>)

State:       <STATE> (color: green/red/yellow)
Active:      <true|false>
Expires at:  <ISO>   (in <X> days / EXPIRED)
Last check:  <ISO>   (<Y> minutes ago)
Last good:   <ISO>   (<Z> minutes ago)
HMAC:        <configured|MISSING>

Diagnosis:
<one paragraph interpretation. Cite specific reason if INVALID/ERROR.>

Recommended action:
<one of: nothing / rotate key / check connectivity / restart service / contact Tersoft admin>
```

## Boundaries

- Do NOT print the full URL of the license server or any secret material.
- If the response shape is unexpected (e.g., the deny middleware caught the request and returned an error), report the raw status code + body and stop.
- If `hmacConfigured: false`, surface it loudly — the app cannot validate signatures without HMAC_SECRET.
