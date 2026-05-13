---
description: Walk the SageSync pre-deployment checklist (env vars, DNS reachability to Fracttal + license server, configured warehouse mapping, Windows service status). Use before promoting a new build to a client server.
allowed-tools: Read, Bash, Grep
---

You are running the SageSync pre-deployment checklist. The authoritative reference is `docs/DEPLOYMENT.md` (12-step guide). This command is the abbreviated readiness gate.

## Steps

Run each in order. Report `OK`, `WARN`, or `FAIL` per step with one sentence of detail.

### 1. Codebase sanity

- `git status` — working tree clean? If untracked changes exist, list them.
- `git rev-parse HEAD` — capture the SHA. State whether the SHA matches `origin/main`.
- `node --version` — must be `18.x` or later.

### 2. Dependencies

- `package-lock.json` present? Don't read; just check existence.
- `node_modules/` present? If not, suggest `npm install --production` for prod or `npm install` for dev.

### 3. Environment variables

Without reading `.env` (it is denied), check whether each variable is set in the current process environment. Use:

```bash
node -e "['LICENSE_API_URL','HMAC_SECRET','SAGESYNC_API_KEY','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','FRACTTAL_BASE_URL','FRACTTAL_OAUTH_URL','FRACTTAL_CLIENT_ID','FRACTTAL_CLIENT_SECRET'].forEach(k => console.log(k + ': ' + (process.env[k] ? 'SET' : 'MISSING')))"
```

Report any `MISSING`. Do NOT print secret values. Do NOT echo `.env` contents.

### 4. Network reachability

Use `curl` with a short timeout (`--max-time 5`) to check each endpoint:

- `curl --max-time 5 https://sageconnect-license.vercel.app` — license server reachable.
- `curl --max-time 5 https://app.fracttal.com/api` — Fracttal API base reachable (may 401 unauthenticated; that's fine — anything other than connect/timeout error counts as reachable).
- `curl --max-time 5 https://one.fracttal.com/oauth/token` — OAuth endpoint reachable.

Report each as OK / FAIL.

### 5. Local service (only if running on the target server)

- `curl --max-time 3 http://localhost:3000/api/system/license` — if running, capture `state` field.
- `curl --max-time 3 http://localhost:3000/api/test/connections` — if running, capture sage + fracttal status.

If localhost:3000 is not responding, the service may be down or not installed. Report accordingly.

### 6. Configuration sanity

- Read `config.json` and confirm `locationMapping` has at least one entry and `defaultWarehouse.code` is set.
- Confirm `.fracttal-token` is in `.gitignore` (grep `.gitignore` for the literal string).

### 7. Maintenance script (optional, takes ~5s)

If safe to run (i.e., `.env` is populated):

```bash
node src/maintenance.js
```

Capture the section that lists critical files and token status.

## Final report

A markdown table with columns: `Step | Status | Detail`. End with one of:

- **READY TO DEPLOY** — all OK or only minor WARN.
- **NOT READY** — at least one FAIL with the blocker named.

Never print credentials or tokens. If a step would require reading a secret to check it, skip and mark `SKIP — requires manual verification`.

$ARGUMENTS
