---
phase: quick-261008-on6
plan: 01
subsystem: config-deployment
tags: [config, dotenv, CONFIG_PATH, obfuscation, dist, servy, powershell, jest]

# Dependency graph
requires:
  - phase: quick-261008-jdr
    provides: production .env schedule recipe (SYNC_CRON_SCHEDULE=off, SYNC_DAILY_CRON_SCHEDULE, SYNC_TIMEZONE, SYNC_ON_STARTUP) that the new CONFIG_PATH line joins
provides:
  - CONFIG_PATH env var selecting the per-server warehouse mapping file (absolute, or relative to the project root, never the cwd); unset/blank keeps config.json
  - Fail-fast Spanish error when the CONFIG_PATH file is missing (no fallback to the repo config.json)
  - ConfigManager loads .env itself; success log names the real file; saveConfig writes the active file
  - maintenance backup-config and critical-files checklist use the active file
  - config.local.json ignored in the source .gitignore and in the generated dist .gitignore
  - dist ships scripts/install-service.ps1 (only that file from scripts/); -InstallDir defaults to the script's install dir
  - Spanish production procedure in DEPLOYMENT/RUNBOOK/HANDOFF/README and English notes in ARCHITECTURE
affects: [production deploy this week, test server (unchanged, CONFIG_PATH unset), dist repo SageSync-dist, RUNBOOK operations, license-guard audits]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-server config file selected by an env var, resolved against the project root (never the cwd), with no fallback when the file is missing"
    - "The config module calls dotenv.config() itself so an env-selected path works whatever the entry point's require order"
    - "Tests that touch process.env or the cwd snapshot and restore them at file level, and restore the cwd BEFORE deleting temp dirs (Windows)"

key-files:
  created: []
  modified:
    - src/config/configManager.js
    - src/maintenance.js
    - tests/config/configManager.test.js
    - .gitignore
    - scripts/obfuscate.js
    - scripts/install-service.ps1
    - docs/DEPLOYMENT.md
    - RUNBOOK.md
    - HANDOFF.md
    - ARCHITECTURE.md
    - README.md

key-decisions:
  - "Production warehouse mapping lives in config.local.json (gitignored in source and dist), selected by CONFIG_PATH=config.local.json in .env; config.json stays the committed template that every dist deploy overwrites"
  - "A CONFIG_PATH pointing to a missing file stops boot with a Spanish error and never falls back to config.json (the fallback is exactly the production risk)"
  - "The dist ships only scripts/install-service.ps1 from scripts/; setup-automap.js (creates warehouses in Fracttal) never ships and is not run in production"

patterns-established:
  - "Operators confirm the loaded mapping with Select-String -Pattern \"cargada exitosamente desde\" on logs\\sagesync.log (ASCII pattern for Windows PowerShell 5.1)"

requirements-completed: [quick-261008-on6]

# Metrics
duration: 67min
completed: 2026-10-09
---

# Quick Task 261008-on6: Per-server warehouse mapping via CONFIG_PATH Summary

**`CONFIG_PATH=config.local.json` moves each server's Sage→Fracttal mapping into a gitignored file that `git reset --hard` deploys never touch, and a missing file now stops the service instead of silently using the repo's `GRAL → ALM-AMP` mapping. The dist also ships `scripts/install-service.ps1`, which defaults to the folder it is run from.**

## Performance

- **Duration:** ~67 min
- **Started:** 2026-10-09T16:40:52Z
- **Completed:** 2026-10-09T17:48:11Z
- **Tasks:** 3/3
- **Files modified:** 11 (exactly the plan's `files_modified`)

## Accomplishments

- `ConfigManager` resolves `CONFIG_PATH` against the project root:
  - an absolute value is used as-is, a relative one never resolves against the cwd, and unset or blank keeps `config.json`;
  - a missing file throws `CONFIG_PATH apunta a un archivo que no existe: <ruta>. ...` with no fallback;
  - `.env` is loaded inside the module, so every entry point honors it.
- `node src/maintenance.js backup-config` backs up the active file and prints `- Archivo origen: <ruta>`. The critical-files checklist checks the active path.
- `config.local.json` is ignored by git in the source repo (`.gitignore:176`) and in the generated dist (`dist/.gitignore` line 7).
- The dist now has `scripts/install-service.ps1`, byte-identical to the source. `-InstallDir` defaults to `Split-Path -Parent $PSScriptRoot`. The file stays ASCII-only with LF line endings and no BOM.
- The docs give the complete production recipe: the `.env` lines, the copy-then-edit procedure, the installer from the dist, what survives a deploy, and how to confirm which file was loaded.

## Task Commits

1. **Task 1: CONFIG_PATH in ConfigManager, active-file backup and checklist in maintenance, config.local.json ignored, tests:** `9e997a4` (feat). TDD RED was run locally with no separate commit, per D-10.
2. **Task 2: dist ships install-service.ps1 and ignores config.local.json; install-service.ps1 defaults to its own install dir:** `f52399c` (build)
3. **Task 3: docs for the per-server mapping and install-service.ps1 from the dist:** `c537a70` (docs)

Branch: the per-agent worktree branch `worktree-agent-a9c0cab11a8cf8249`, based on `8c30793`. Nothing was pushed.

## RED evidence (Task 1, against the unchanged configManager.js)

`npx jest tests/config/configManager.test.js` gave **6 failed, 7 passed, 13 total**, exactly as the plan predicted.

Failed (each for a behavioral reason, not a setup error):
- 1 `unset: loads the repo config.json`: the log said `...desde config.json`, not the absolute path.
- 3 `absolute: loads that file`: `configPath` was the repo config.json.
- 4 `relative: a relative path to another file is honored`: same.
- 6 `missing file: throws naming CONFIG_PATH and the path; never falls back to config.json`: nothing was thrown.
- 7 `saveConfig writes to the CONFIG_PATH file, not the repo config.json`: it stopped at the `configPath` guard before writing.
- 8 `dotenv.config() runs before CONFIG_PATH is read`: dotenv was called 0 times.

Passed by construction: 2 (blank), 5 (decoy cwd), and the 5 existing `getInventoryFilters` tests.

The repo `config.json` SHA-256 (`3c123bdf...`) was unchanged across every RED and GREEN run.

## Final test counts

- `npx jest --testPathIgnorePatterns fracttal.integration`: **11 suites / 150 tests, all green** (baseline was 11 / 142, plus 8 new).
- `CONFIG_PATH=/nonexistent/x.json npx jest tests/config/configManager.test.js`: **13 / 13 green**.
- Extra: `--randomize` with seeds 1-5 gave 13 / 13 every time.
- Extra, against the obfuscated build in `dist/`:
  - `dist/tests/config/configManager.test.js` gave 13 / 13 green;
  - the other 10 mocked suites gave 137 / 137 green.
- `tests/integration/fracttal.integration.test.js` was **never run**. Every run excluded it, confirmed with `--listTests`.

## Task 1 smoke outputs (no network)

`<T>` = `/private/tmp/claude-501/-Users-yahir-diaz-Tersoft-Projects-SageSync/187fb119-d0a9-401a-92c7-dd90ba7d0183/scratchpad/on6-smoke`

- **A (active path):**
  - `ACTIVE=<T>/config.local.json`
  - log: `info: Configuración cargada exitosamente desde <T>/config.local.json`
- **B (missing file):**
  - `THROWN: CONFIG_PATH apunta a un archivo que no existe: <T>/no-existe.json. Crea ese archivo (copia de config.json con el mapeo de este servidor) o corrige CONFIG_PATH en el .env; no se usa config.json como respaldo.`
  - `NO-THROW` never appeared, and there was no success log line.
- **C (backup-config):**
  - output: `- Archivo origen: <T>/config.local.json` then `✅ Backup creado: config-backup-2026-10-09T17-22-17-867Z.json`;
  - `cmp` against the source file gave **BACKUP-OK**;
  - the backup file and `backups/` were removed afterwards (`backups/` did not exist before).
- **D (critical-files checklist):** `✅ <T>/config.local.json`.
  - `.env` showed ❌ only because the worktree has no `.env`.
- **Extra (unset):** `DEFAULT=<worktree>/config.json`.
- **Extra (production-start simulation):**
  - Command: `CONFIG_PATH=config.local.json NODE_ENV=production` plus dummy, unreachable placeholder credentials, then `node src/main.js`, with no `config.local.json` present.
  - Result: an uncaught `Error: CONFIG_PATH apunta a un archivo que no existe: .../config.local.json. ...` from `app.js:18` (`new SageService()`), then **exit 1**.
  - This happens before the license gate and before any network call.
  - Under Servy that text goes to `logs/servy-stderr.log`, which is what the DEPLOYMENT and RUNBOOK troubleshooting now points to.
- After the smokes, the `logs/` dir created by winston was removed and `git status` was clean.

## Task 2 dist-check output (local build, NO `--push`)

- `node scripts/obfuscate.js` (no `--push`; every git call in it sits inside `if (shouldPush)`):
  - `✅ scripts/install-service.ps1`
  - `⏭ Omitido (no existe): .env.example`
- `cmp dist/scripts/install-service.ps1 scripts/install-service.ps1`: **identical**.
- `grep -nxF 'config.local.json' dist/.gitignore`: `7:config.local.json`.
- `dist/scripts/` contains only `install-service.ps1` (7361 B), and `dist/config.json` is present (2042 B).
- `dist/scripts/setup-automap.js` and `dist/scripts/obfuscate.js` are absent.
- So the result is **DIST-OK**, and `dist/` was then removed.
- `git diff --numstat -- scripts/obfuscate.js`: `2	0	scripts/obfuscate.js`.
- install-service.ps1 static checks:
  - exactly one new param line (`38:    [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),`);
  - nothing for the old `"E:\SageSync"` default;
  - no NONASCII lines;
  - no `??`, `&&` or `||`;
  - `0` changed `servy-cli` lines;
  - `file`: ASCII text, starting with `<#\n` (no BOM, LF).
- `$PSScriptRoot` in param defaults: checked against the MS docs (about_Automatic_Variables), which say it is valid in all scripts since PowerShell 3.0.

## Production steps (for the orchestrator to relay; the agent cannot do these)

Order matters:
- The server must run a dist that contains this change before `CONFIG_PATH` has any effect, because the old code ignores it.
- `config.local.json` must exist before `CONFIG_PATH` is added and the service restarts, because a missing file stops boot by design.

0. Push this work so CI rebuilds `SageSync-dist`. The workflow triggers on `src/**`, `scripts/**`, `tests/**`, ... Until then the dist has no `scripts\` folder.
1. On the server, after `git fetch` + `git reset --hard origin/<branch>`, run in the install dir: `Copy-Item config.json config.local.json`.
2. Edit ONLY `config.local.json`:
   - point `locationMapping` at the client's real production warehouses;
   - check `warehouseCreationSettings.enabled`. The template has `true`, and with the template's `GRAL → ALM-AMP` mapping it would create `ALM-AMP` in the client's Fracttal.
3. Add `CONFIG_PATH=config.local.json` to `.env` (no quotes), next to:
   - `SYNC_CRON_SCHEDULE=off`
   - `SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *`
   - `SYNC_TIMEZONE=America/Mexico_City`
   - `SYNC_ON_STARTUP=false`
4. When ready to enable the service, run `.\scripts\install-service.ps1` as Administrator from the install dir. Do NOT use `npm run install-service`: it points at a non-existent `src/service-installer.js` and fails.
5. Confirm the loaded file with `Select-String -Path logs\sagesync.log -Pattern "cargada exitosamente desde" | Select-Object -Last 1`.
   - The line must name `config.local.json`. Backslashes appear doubled in the JSON log.
   - If it names `config.json`, `CONFIG_PATH` is missing from `.env`.

The test server needs no change. With `CONFIG_PATH` unset it behaves exactly as before.

## Decisions Made

- Followed D-1 to D-10 as written.
- README note (orchestrator amendment, step 4b): placed right after the first sentence of "### 3. Configurar mapeo de almacenes", before the JSON example, as instructed. Nothing else in README was touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Safety] Test 7 cannot overwrite the repo config.json**
- **Found during:** Task 1 RED design.
- **Issue:** Against today's code (the RED run) or a regression, `updateLocationMapping` would write into the real `config.json`.
- **Fix:**
  - `expect(cm.configPath).toBe(abs)` runs before any write;
  - a `finally` restores `config.json` byte-for-byte if it changed.
  - The plan's assertions are unchanged.
- **Files modified:** tests/config/configManager.test.js
- **Verification:** the `config.json` SHA-256 was identical before and after RED and GREEN.
- **Committed in:** 9e997a4

**2. [Rule 1 - Doc accuracy] Paso 10 warning about `npm run install-service`**
- **Found during:** Task 3.
- **Issue:** The plan's wording says the command installs the service with node-windows. In fact `src/service-installer.js` does not exist and never existed in git history, so the command fails with "Cannot find module".
- **Fix:** The warning says it points at the node-windows installer, not Servy, that the file is not in the repo so the command fails, and that only `.\scripts\install-service.ps1` installs the service.
- **Files modified:** docs/DEPLOYMENT.md
- **Committed in:** c537a70

**3. [Rule 1 - Stale doc] Consistency one-liners made necessary by the Paso 4 rewrite**
- **Found during:** Task 3.
- **Issue:** Some text still implied that setup-automap runs in deployments, or pointed to the old file.
- **Fix:**
  - DEPLOYMENT Paso 8, first line: "Los almacenes ya fueron creados por el auto-setup (paso 4)" became "Con el mapeo de `config.local.json` revisado (Paso 4), cargar los items."
  - HANDOFF §11, the `scripts/setup-automap.js` row: "Solo se corre una vez por despliegue" became "No viene en el dist ni se corre en producción ...".
  - ARCHITECTURE §7.3: added one sentence, "Source checkouts only: it is not shipped in the dist, ignores `CONFIG_PATH` and is not run in production." DEPLOYMENT Paso 4c links there.
  - The kept Paso 4 blockquote about unmapped locations now says `config.local.json` instead of `config.json`.
  - The RUNBOOK §7.4 "Significa" cell now says "archivo de mapeo activo".
- **Files modified:** docs/DEPLOYMENT.md, HANDOFF.md, ARCHITECTURE.md, RUNBOOK.md
- **Committed in:** c537a70

**4. [Process] Smokes split into plain commands**
- **Issue:** The worktree isolation guard rejects compound `node -e` chains and commands that mention git inside loops or pipes. Those are needed for the single-call `$T` smoke and the grep-loop verify.
- **Fix:** The same commands and assertions ran as separate plain commands, using a fixed scratchpad dir instead of `mktemp -d`. The doc-check `git clean` grep used the pattern `clean -x`.
- **Impact:** None on the results.

**5. [Minor] Two tiny edits in maintenance.js**
- The comment next to the changed `backupConfig` line now reads `// Copiar el archivo de configuración activo (CONFIG_PATH o config.json)`.
- A whitespace-only line that the Edit tool had normalized was restored, keeping the diff minimal.
- **Committed in:** 9e997a4

---

**Total deviations:** 5 (1 safety, 2 doc accuracy/consistency, 1 process, 1 minor).
**Impact on plan:** No scope change. Code and test behavior is exactly D-1 to D-6. The doc changes only remove statements that became false.

## Issues Encountered

- **Wrong worktree base:** the branch was created from `3c4efe5` instead of `8c30793`. It was hard-reset to `8c30793` in the mandatory branch check, before any work.
- **Jest array option:** `--testPathIgnorePatterns` is an array option, so a positional path placed right after it was swallowed as a second ignore pattern.
  - The first extra dist run therefore executed the 10 other mocked suites (137 tests, all green) instead of 1.
  - The same argument order passed to `--listTests` confirmed that `fracttal.integration` was still excluded.
  - Re-ran with the path first.

## Out-of-scope observations (none changed)

From the plan:
- `.claude/commands/deploy-check.md` line 52 still reads `config.json`; it should read the active file.
- CLAUDE.md "State outside the repo" still describes `config.json` as generated by setup-automap.
- `scripts/setup-automap.js` ignores `CONFIG_PATH`. Its own local `CONFIG_PATH` constant is hard-wired to `config.json`.
- The workflow trigger lists in HANDOFF §9 and ARCHITECTURE §7.1 are stale. The workflow also triggers on `scripts/**`, `tests/**`, `config.json` and `jest.config.js`.
- The dist `.gitignore` does not ignore `backups/`.
- `tests/manual` inspector messages still say "config.json".

New:
- **`npm run install-service` / `uninstall-service` are broken.**
  - `package.json` points them at `src/service-installer.js`, which is not in the repo (and never was in git history).
  - `scripts/obfuscate.js` step 5 re-adds both to the dist `package.json` (lines ~274-275).
  - Fixing it touches `package.json` and the dist scripts whitelist, both off-limits for this task. See also the memory note about the hard-coded dist scripts list.
- HANDOFF §11 `src/config/*.js` row says "configManager maneja `config.json`". It is still accurate as the default, but could mention `CONFIG_PATH`.
- Every ConfigManager instance logs the success line, so boot shows it several times (app.js module level, SageService and FracttalClient in app.js and in `startServer`). It is harmless, and `Select-Object -Last 1` handles it.

## Known Stubs

None.

## User Setup Required

See "Production steps" above: the `.env` line, `config.local.json` on the client server, and the installer. The `.env` is off-limits to the agent, and the agent has no access to the server.

## Next Phase Readiness

- Ready to push. CI rebuilds the dist, and the user can then follow the production steps this week.
- The test server is unaffected while `CONFIG_PATH` stays unset.

## Self-Check: PASSED

- All 11 files in `files_modified` exist and are the exact set in `git diff --name-only HEAD~3 HEAD`.
- Commits `9e997a4`, `f52399c` and `c537a70` exist on `worktree-agent-a9c0cab11a8cf8249`. Each body has `Quick task: 261008-on6` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Not touched: LicenseValidator.js, app.js, main.js, schedules.js, syncScheduler.js, sageService.js, setup-automap.js, package.json, `.github/`, CLAUDE.md, `.env*`, `.claude/`, and `.planning/` (except this SUMMARY).
- No `dist/`, `backups/`, `logs/` or `config.local.json` is left in the worktree. Nothing was pushed.

---
*Quick task: 261008-on6*
*Completed: 2026-10-09*
