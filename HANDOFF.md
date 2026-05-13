# Handoff de SageSync

> Documento de entrada para el nuevo responsable del proyecto. El dueño anterior (Fernando Rodriguez Memije, `fmemije00@gmail.com`) traspasa el proyecto el **2026-05-12**. Si estás llegando frío al repo, empieza aquí.

Este documento es deliberadamente largo: prefiere completitud a brevedad. Si una sección no aplica, sáltala. Si necesitas el "código vivo" del sistema, salta a [`ARCHITECTURE.md`](./ARCHITECTURE.md). Si necesitas operar el servicio, salta a [`RUNBOOK.md`](./RUNBOOK.md). Si quieres entender por qué el código se ve como se ve, lee [`docs/MEMORY.md`](./docs/MEMORY.md).

---

## 1. ¿Qué es SageSync?

SageSync es un servicio Node.js que **sincroniza inventario de Sage300 (ERP, Windows) hacia Fracttal (plataforma de gestión de activos, SaaS)**. La dirección del flujo es **unidireccional**: Sage300 es la fuente de verdad, Fracttal es el destino. No hay sincronización de regreso; nada que cambie en Fracttal vuelve a Sage300.

El servicio se ejecuta on-premise en el servidor Windows de cada cliente de Tersoft, generalmente como Windows Service (gestionado por **Servy**). Expone un dashboard web local (puerto 3000) para monitoreo y trae integrado un sistema de licencias remoto que permite a Tersoft "apagar" la app de cualquier cliente en cuestión de minutos.

El código fuente vive en este repo (`SageSync`, privado). El código que se despliega al cliente vive en `SageSync-dist` (también privado), un repo separado que recibe **el mismo código pero ofuscado** vía GitHub Actions. El cliente nunca ve el código fuente legible.

---

## 2. Estado actual (2026-05-12)

**Versión:** 1.1 — Sistema de control de licencias completo.

**Milestones cerrados:**

| Milestone | Estado | Qué entregó |
|-----------|--------|-------------|
| v1.0 — Core Sync Engine | Shipped (pre-GSD) | Lector MSSQL de Sage300, cliente Fracttal con OAuth2, cron, dashboard Express, auto-creación de almacenes, servicio Windows, pipeline de ofuscación |
| v1.1 — License Control System | Shipped 2026-04-08 | LicenseValidator con HMAC + freshness + DNS-bypass detection, middleware `requireLicense`, banner frontend, endpoint `/api/system/license` |

**Fix de inventario críticamente importante:** en febrero 2026 se descubrió y corrigió un bug grave donde los items se creaban en Fracttal vía `POST /items/` (huérfanos, sin almacén, no aparecían en inventario). El fix usa `POST /inventories/` + `PUT /inventories_adjustment/`. Detalle completo en [`docs/MEMORY.md`](./docs/MEMORY.md).

**Pendientes / blockers conocidos:**

- Un test fallaba antes del fix de febrero y sigue fallando: `tests/services/fracttalClient.test.js > FracttalClient > API methods > updateWarehouseItem > should update warehouse item successfully`. Espera PUT a `/items/item1` pero la implementación correcta llama `/inventories_adjustment/item1`. Ver `.planning/phases/02-enforcement-surface/deferred-items.md`. Hay que **actualizar el test, no la implementación**.
- No hay roadmap activo para v1.2. El proyecto está en modo mantenimiento.

**Producción:** desplegado en al menos un cliente real (referido internamente como "AMP"). Aún no validado con carga masiva (>5000 items) en producción.

---

## 3. ¿Quién usa esto y cómo?

- **Operador del sistema:** Tersoft (la empresa para la que trabaja el dueño anterior). Tersoft controla las licencias remotamente.
- **Cliente final:** empresas que ya pagan tanto Sage300 como Fracttal y quieren mantener su inventario sincronizado sin doble captura. El primer cliente real es uno con almacén en Hacienda Nueva, Morelos, Zacatecas.
- **Cuentas requeridas por cliente:**
  - Usuario lector de SQL Server contra la BD de Sage300 (típicamente `COPDAT`)
  - API Client ID + Client Secret de Fracttal del tenant del cliente (el cliente los pide a soporte de Fracttal)
  - Una llave (`SAGESYNC_API_KEY`) emitida desde el servidor de licencias de Tersoft

---

## 4. Arquitectura de un vistazo

```
                ┌─────────────────┐
                │  Servidor Win   │ (on-premise, cliente)
                │  ┌───────────┐  │
   ┌─SQL 1433──►│  │ SageSync  │──HTTPS 443──► api.fracttal.com (inventario)
   │            │  │  node     │  │           one.fracttal.com (OAuth)
Sage300         │  └─────┬─────┘  │           sageconnect-license.vercel.app
(MSSQL)         │        │        │
                │     :3000       │
                │   (dashboard)   │
                └─────────────────┘
```

- **Capas internas:** `config/`, `middleware/`, `routes/`, `controllers/`, `services/`, `utils/`. Entry points: `src/main.js` (server+cron), `src/app.js` (lógica de sync), `src/sync.js` (one-shot CLI), `src/maintenance.js` (utilidades).
- **Servicios clave:**
  - `SageService` (lee MSSQL)
  - `FracttalClient` (REST + OAuth2 con persistencia en `.fracttal-token`)
  - `LicenseValidator` (HMAC-SHA256 contra `sageconnect-license.vercel.app`, tres estados: VALID/INVALID/ERROR, TTL 24h, retry exponencial)
  - `SyncStateManager` (estado in-memory del último sync para el dashboard)
- **Frontend:** `public/index.html` (un único archivo, ~1500 líneas), incluye banner de licencia, overlay, expiry badge, polling cada 60s a `/api/system/license`.

Para detalles completos abre [`ARCHITECTURE.md`](./ARCHITECTURE.md) (en inglés, pegado al código).

---

## 5. Stack técnico

| Componente | Versión | Notas |
|------------|---------|-------|
| Node.js | 18.x | Validado en LTS 18; el CI usa Node 18 |
| Express | ^4.18.2 | Dashboard + API local |
| mssql | ^10.0.1 | Driver oficial; pool de 10 conexiones |
| axios | ^1.6.0 | HTTP client para Fracttal y license server |
| node-cron | ^3.0.3 | Scheduler; default `0 2 * * *` (2 AM local) |
| node-windows | ^1.0.0-beta.8 | Soporte de servicio (no se usa en runtime — se usa Servy en producción) |
| winston | ^3.11.0 | Logger singleton, rotación 10MB × 5 archivos |
| moment | ^2.29.4 | Parsing de fechas |
| dotenv | ^16.3.1 | Carga de `.env` |
| Jest | ^29.7.0 | Tests unitarios + integración |
| supertest | ^6.3.4 | Tests HTTP del Express |
| javascript-obfuscator | ^5.4.1 | Pipeline de ofuscación para el dist |

Sistema operativo destino: **Windows Server**. Servicio gestionado por **Servy** (`winget install servy`). Node se instala vía MSI estándar.

---

## 6. Cómo correr localmente

### Requisitos previos

- Node 18+ (`node --version`)
- Acceso de red a un SQL Server con la BD `COPDAT` de Sage300 (o usar mocks; ver `tests/`)
- Credenciales OAuth2 de Fracttal (sandbox o productivas)
- Llave de licencia válida o cuenta de admin del servidor de licencias

### Setup

```bash
git clone https://github.com/FReptar0/SageSync.git
cd SageSync
npm install
```

Crear `.env` en la raíz (ver tabla en sección 12 — Variables de entorno). Mínimo necesario para arrancar:

```ini
LICENSE_API_URL=https://sageconnect-license.vercel.app
HMAC_SECRET=...
SAGESYNC_API_KEY=...
DB_HOST=...
DB_PORT=1433
DB_NAME=COPDAT
DB_USER=...
DB_PASSWORD=...
FRACTTAL_BASE_URL=https://app.fracttal.com/api
FRACTTAL_OAUTH_URL=https://one.fracttal.com/oauth/token
FRACTTAL_CLIENT_ID=...
FRACTTAL_CLIENT_SECRET=...
```

### Comandos

```bash
npm start                # Arranca server+cron (entry: src/main.js)
npm run sync             # Ejecuta UN sync y termina (entry: src/sync.js)
npm run sync-only        # Arranca src/app.js (cron sin dashboard)
npm run dev              # Modo desarrollo con nodemon
npm test                 # Tests Jest (unitarios + integración)
npm run test:workflow    # Workflow E2E contra sandbox Fracttal (REQUIERE credenciales reales)
npm run maintenance      # Tareas de mantenimiento (clean logs, renew token, etc.)
```

Dashboard local: `http://localhost:3000`. Health de licencia: `http://localhost:3000/api/system/license`.

---

## 7. Cómo desplegar a producción

**Guía completa:** [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) (12 pasos, en español, incluye checklist final).

Resumen ejecutivo:

1. Registrar nueva licencia en el dashboard de `sageconnect-license.vercel.app` → obtener API key.
2. En el servidor del cliente: instalar Node 18 + Servy + git.
3. `git clone https://github.com/FReptar0/SageSync-dist.git E:\SageSync` (el repo **dist** es código ofuscado).
4. `npm install --production`.
5. Crear `.env` con credenciales del cliente.
6. `node scripts/setup-automap.js` — descubre ubicaciones de Sage300, crea almacenes en Fracttal, genera `config.json`.
7. Validación manual: `node src/main.js`, verificar dashboard y `/api/system/license`.
8. Probar kill switch (desactivar licencia, ver banner rojo).
9. Carga inicial: `node src/sync.js`.
10. Instalar como Windows Service: `.\scripts\install-service.ps1` (como Administrador).
11. Reiniciar servidor para confirmar auto-start.

---

## 8. Sistema de licencias (v1.1)

Esta es la pieza más crítica para Tersoft. Léela con atención.

### Cómo funciona

- En cada arranque, SageSync llama `GET https://sageconnect-license.vercel.app/api/validate?key=<SAGESYNC_API_KEY>`.
- La respuesta incluye `{ active, expiresAt, ts, sig }`. `sig` es un HMAC-SHA256 sobre el payload usando `HMAC_SECRET`.
- SageSync verifica:
  1. Firma HMAC válida (timing-safe compare).
  2. `ts` no más viejo que 5 minutos ni más de 60s en el futuro (freshness).
  3. Estado se cachea en memoria como `VALID | INVALID | ERROR | UNKNOWN`.
- Si `ERROR` (server inalcanzable), conserva el último estado bueno hasta 24 horas; pasadas las 24h, fuerza `INVALID`.
- **Re-validación periódica:** cada ciclo de cron (default 2 AM). Si está `INVALID` cuando dispara el cron, el sync se salta con un warning en logs.
- **Startup gate:** en boot, hace 3 reintentos con backoff exponencial (1s, 2s, 4s). Si falla los 3, `process.exit(1)`.
- **Defense-in-depth DNS check:** resuelve el hostname del license server vía `dns.resolve4()` (bypassea `hosts` file). Si resuelve a IP privada/loopback, loguea warning. NO bloquea — el HMAC sigue siendo la barrera primaria.

### Cómo se emiten las llaves

El servidor de licencias **`sageconnect-license`** (repo separado, hospedado en Vercel) tiene un dashboard de admin donde Tersoft:

1. Crea un cliente (`SageSync — [Cliente]`).
2. Genera una API key (UUID v4).
3. Marca `active: true` y opcionalmente una fecha de expiración.

La llave se entrega al técnico de despliegue, que la pone en el `.env` del cliente como `SAGESYNC_API_KEY`.

### `HMAC_SECRET`

El mismo `HMAC_SECRET` se comparte entre el servidor de licencias y SageSync. Está hardcodeado/configurado del lado del servidor (Vercel env var) y se pone en el `.env` del cliente. Es **el mismo secreto que usa SageConnect** (proyecto hermano). Si rotas, hay que rotar en todos los clientes desplegados.

### Qué pasa cuando una licencia está inválida

- Cualquier petición HTTP excepto `GET /api/system/license` responde **503**.
- El dashboard frontend muestra un banner rojo + overlay opaco.
- Los crons se saltan silenciosamente (con warning en logs).
- El endpoint `/api/system/license` **siempre** responde (200) con el estado actual. Esto permite que el dashboard o los técnicos de soporte vean qué está pasando.

---

## 9. Pipeline de ofuscación

El código fuente de SageSync **no se entrega al cliente**. En cada push a `main` (y bajo demanda), GitHub Actions:

1. Hace checkout del repo.
2. Corre `node scripts/obfuscate.js` (ver script para el detalle de opciones de `javascript-obfuscator`).
3. Copia `package.json`, `public/`, `config.json` (sin .env) y la carpeta `src/` ofuscada a `dist/`.
4. Pushea `dist/` a la rama `main` del repo `FReptar0/SageSync-dist` con `--force`.

**Repo destino:** `https://github.com/FReptar0/SageSync-dist`.

**Workflow:** `.github/workflows/obfuscate-deploy.yml`. Triggers: cambios en `src/**`, `public/**`, `package.json`, `package-lock.json`, o manualmente desde la UI de GitHub.

**Secreto requerido:** `OBFUSCATED_REPO_TOKEN` (PAT con permiso de push al repo dist). Configurado en Settings → Secrets → Actions del repo SageSync.

**No corras ofuscación local ni pushees al repo dist a mano.** El workflow lo hace y es la fuente de verdad.

Opciones del ofuscador (resumen):

- `controlFlowFlattening`, `deadCodeInjection`, `stringArray` (base64), `transformObjectKeys`, target `node`.
- `selfDefending: false` y `debugProtection: false` para no romper en server-side ni complicar troubleshooting.
- `renameGlobals: false` para no romper `require/module.exports`.

---

## 10. Pruebas

### Tests automatizados

```bash
npm test               # Todo Jest
npm run test:fracttal  # Solo FracttalClient
npm run test:sage      # Solo SageService
npm run test:integration # Sólo integración (incluye licenseEnforcement.test.js)
npm run test:coverage  # Cobertura
```

Cobertura aproximada actual: alta en `LicenseValidator` (8 requisitos cubiertos), `requireLicense`, `SageService`, `FracttalClient`. Hay un test rojo conocido (ver Sección 2, Pendientes).

### Tests manuales (requieren credenciales reales)

Viven en `tests/manual/`. Pensados para validar contra la API real de Fracttal.

```bash
npm run test:workflow      # Workflow completo 10 pasos contra TEST001 (sandbox)
npm run test:api           # Test detallado con logs
npm run test:credentials   # Validar OAuth funciona
```

**Credenciales de sandbox:** no se commitean en este repo. El dueño anterior las guardaba en un password manager y las ponía como variables de entorno temporales antes de correr. Si necesitas el sandbox, pide acceso al admin de Tersoft o al dueño anterior — la URL es `https://app.fracttal.com/signin`.

---

## 11. Archivos y carpetas críticas

| Path | Qué hay | Tocar con cuidado |
|------|---------|-------------------|
| `src/main.js` | Entry point del server: license gate → Express → cron → routes | No agregar lógica de sync aquí; va en `app.js` |
| `src/app.js` | Lógica de sincronización (los 3 casos de inventario) | Cualquier cambio aquí afecta producción directamente |
| `src/sync.js` | Wrapper CLI para correr UN sync y salir | Se invoca desde `npm run sync` y para cargas iniciales |
| `src/maintenance.js` | Utilidades: limpiar logs, renovar token, backup config | OK editar |
| `src/services/LicenseValidator.js` | **NO TOCAR sin entender HMAC y los 3 estados.** Cualquier cambio rompe enforcement | Validación crítica |
| `src/services/fracttalClient.js` | Cliente axios con OAuth + retry + 7 métodos de warehouse inventory | Sigue el patrón existente (axios + interceptor + logger) al agregar métodos |
| `src/services/sageService.js` | Queries SQL contra Sage300, mapeo Sage location → Fracttal warehouse | Las queries van sobre `COPDAT.dbo.ICILOC` y `ICITEM` |
| `src/services/syncStateManager.js` | Estado in-memory del último sync (para dashboard) | OK editar |
| `src/middleware/requireLicense.js` | El gate síncrono que retorna 503 si licencia inválida | NO mover ni cambiar la firma |
| `src/config/*.js` | Logger, database pool, license config, server config, configManager | configManager maneja `config.json` y `.fracttal-token` |
| `src/routes/`, `src/controllers/` | HTTP API: `/api/status`, `/api/sync`, `/api/sage/*`, `/api/fracttal/*`, `/api/logs*`, `/api/system/license` | Single-file por concern |
| `src/utils/validateEnv.js` | Valida env vars al arranque (3 grupos: license, db, fracttal) | Mantén la lista alineada con `.env.example` |
| `src/utils/logParser.js` | Parser de logs winston para el dashboard | OK editar |
| `public/index.html` | Dashboard completo, 1 archivo HTML+CSS+JS | Banner z-index 1050, overlay 1049, polling 60s |
| `config.json` | Mapeo ubicación Sage → almacén Fracttal + reglas especiales | Se genera por `setup-automap.js` |
| `scripts/setup-automap.js` | Auto-discovery + auto-creación de almacenes + generador de `config.json` | Solo se corre una vez por despliegue |
| `scripts/install-service.ps1` | Instalador del Windows Service vía Servy | Idempotente; requiere Admin |
| `scripts/obfuscate.js` | Build de distribución (copia + ofusca + opcionalmente pushea) | El workflow de Actions lo invoca |
| `.github/workflows/obfuscate-deploy.yml` | CI que pushea a `SageSync-dist` | Necesita secreto `OBFUSCATED_REPO_TOKEN` |
| `.fracttal-token` | Token OAuth2 persistido. **gitignored.** | Se borra y se regenera con `npm run maintenance:token` |
| `logs/` | Logs winston (rotación 10MB × 5). **gitignored.** | Limpia con `npm run maintenance:clean` |
| `.planning/` | Artefactos GSD: PROJECT, MILESTONES, REQUIREMENTS, ROADMAP, STATE, phases/ | No tocar (historial del proyecto) |
| `docs/DEPLOYMENT.md` | Guía de despliegue paso a paso | Mantener sincronizada con scripts |
| `docs/MEMORY.md` | Memoria histórica del proyecto (decisiones, gotchas, API hallazgos) | Apéndice este documento al evolucionar |

---

## 12. Variables de entorno

Todas viven en `.env` en la raíz. **`.env` está en `.gitignore` — nunca lo commitees.**

| Variable | Grupo | Sensible | Descripción | Ejemplo |
|----------|-------|:--------:|-------------|---------|
| `LICENSE_API_URL` | license | No | URL base del servidor de licencias | `https://sageconnect-license.vercel.app` |
| `HMAC_SECRET` | license | **Sí** | Secreto compartido para verificar firmas HMAC | (de Vercel env vars del license server) |
| `SAGESYNC_API_KEY` | license | **Sí** | API key específica del cliente | UUID v4 |
| `DB_HOST` | database | Parcial | Hostname o IP del SQL Server de Sage300 | `192.168.1.50` |
| `DB_PORT` | database | No | Puerto SQL Server | `1433` |
| `DB_NAME` | database | No | Nombre de la BD | `COPDAT` |
| `DB_USER` | database | **Sí** | Usuario SQL (idealmente solo-lectura) | `sageviewer` |
| `DB_PASSWORD` | database | **Sí** | Contraseña SQL | — |
| `DB_ENCRYPT` | database | No | `true` para encrypt TLS | `true` |
| `DB_TRUST_SERVER_CERTIFICATE` | database | No | `true` si el server usa cert auto-firmado | `true` |
| `FRACTTAL_BASE_URL` | fracttal | No | Base URL de la API REST | `https://app.fracttal.com/api` |
| `FRACTTAL_OAUTH_URL` | fracttal | No | URL del endpoint OAuth | `https://one.fracttal.com/oauth/token` |
| `FRACTTAL_CLIENT_ID` | fracttal | **Sí** | Client ID OAuth2 del tenant | — |
| `FRACTTAL_CLIENT_SECRET` | fracttal | **Sí** | Client Secret OAuth2 del tenant | — |
| `SYNC_CRON_SCHEDULE` | sync | No | Expresión cron | `0 2 * * *` (2 AM diario) |
| `SYNC_TIMEOUT` | sync | No | Timeout HTTP para Fracttal en ms | `30000` |
| `SYNC_ON_STARTUP` | sync | No | Si `true`, corre un sync al boot | `false` |
| `SYNC_BATCH_SIZE` | sync | No | Tamaño de batch (informativo; no se usa hoy) | `100` |
| `LOG_LEVEL` | logs | No | `error`/`warn`/`info`/`debug` | `info` |
| `LOG_FILE` | logs | No | Path al archivo de log principal | `logs/sagesync.log` |
| `LOG_MAX_SIZE` | logs | No | Tamaño máximo por archivo | `10m` |
| `LOG_MAX_FILES` | logs | No | Cuántos archivos rotar | `5` |
| `PORT` | server | No | Puerto del dashboard | `3000` |
| `NODE_ENV` | server | No | `production` o `development` | `production` |

El validador (`src/utils/validateEnv.js`) chequea solo los grupos `license`, `database`, `fracttal` y aborta el proceso si falta cualquiera de esas. Los demás tienen defaults razonables.

---

## 13. Operaciones diarias / runbook

Las recetas exactas viven en [`RUNBOOK.md`](./RUNBOOK.md). Resumen de qué encuentra ahí:

- Cómo verificar salud (`/api/system/license`, `/api/status`, `logs/sagesync.log`).
- Cómo correr un sync manual de emergencia.
- Cómo rotar el token OAuth de Fracttal (cuando expira o se vuelve inválido).
- Cómo rotar `SAGESYNC_API_KEY`.
- Cómo limpiar logs viejos.
- Cómo desinstalar y reinstalar el servicio Windows.
- Qué hacer cuando Sage300 está caído, Fracttal devuelve 401, o la licencia falla.

---

## 14. Memoria histórica del proyecto

[`docs/MEMORY.md`](./docs/MEMORY.md) recoge:

- Decisiones de arquitectura clave (por ejemplo, por qué se portó `LicenseValidator` desde SageConnect en vez de escribirlo nuevo).
- Descubrimientos sobre la API de Fracttal (los 7 endpoints que se necesitaron, por qué `POST /items/` está casi obsoleto, etc.).
- Gotchas y bugs importantes que ya se arreglaron (el "items huérfanos sin almacén").
- Convenciones internas (logging, manejo de errores, naming en español/inglés mezclado).
- Cómo y dónde están guardadas las credenciales de sandbox (sin commitearlas).

Si te encuentras pensando "¿por qué se hizo esto así?", probablemente la respuesta está ahí.

---

## 15. Contactos y accesos requeridos

Antes de empezar a operar, asegúrate de tener:

| Acceso | Quién lo da | Para qué |
|--------|-------------|----------|
| GitHub `FReptar0/SageSync` (push) | Owner anterior / Tersoft IT | Trabajar sobre el código fuente |
| GitHub `FReptar0/SageSync-dist` (push) | Owner anterior / Tersoft IT | Solo para emergencias; normalmente lo escribe el CI |
| GitHub Actions secrets de SageSync | Owner anterior / Tersoft IT | Rotar `OBFUSCATED_REPO_TOKEN` si caduca |
| Dashboard de `sageconnect-license.vercel.app` | Admin de Tersoft | Emitir/revocar licencias, ver activaciones |
| Vercel project del license server | Admin de Tersoft | Rotar HMAC_SECRET, leer logs |
| Cuenta admin en Fracttal del cliente | Cliente | Verificar items/almacenes desde la UI cuando falla algo |
| RDP al servidor Windows del cliente | Cliente / IT del cliente | Operar el servicio, leer logs, reinstalar |
| Credenciales SQL Server del cliente | DBA del cliente | Diagnosticar problemas de queries o conectividad |
| Credenciales sandbox Fracttal | Owner anterior | Correr `npm run test:workflow` antes de promover cambios |

> Nota: el repositorio hermano **sageconnect-license** (servidor de licencias) vive en `../sageconnect-license` localmente y en GitHub como `FReptar0/sageconnect-license` (o el repo de Tersoft equivalente). **Está fuera del scope de este handoff**, pero conviene saber que existe porque rotaciones de `HMAC_SECRET` requieren coordinarse con ese repo.

---

## 16. Roadmap pendiente

El dueño anterior no dejó milestone activo. El roadmap (`.planning/ROADMAP.md`) muestra:

- v1.0: completado pre-GSD.
- v1.1 (License Control System): **completado** 2026-04-08, todos los requisitos verificados.

**Ideas que quedaron flotando sin compromiso de fecha:**

- Sync incremental (sólo items modificados desde la última corrida) — hoy la sync es full sweep cada vez.
- Email alerts al admin cuando una sync falla o un cliente pierde licencia — el dueño anterior opted-out explícitamente, pero podría reabrirse si los clientes lo piden.
- Dashboard con histórico de syncs persistido (hoy es in-memory en `SyncStateManager`, máximo 10 corridas).
- Multi-locación con reglas de mapeo más sofisticadas (hoy soporta keywords; podría ser por categoría/jerarquía de Sage).
- Soporte para Linux (hoy solo Windows; el código en sí es portable, pero el installer y Servy son Windows-only).

Cualquiera de estas puede convertirse en milestone v1.2 si Tersoft lo pide. Empieza creando un nuevo milestone en `.planning/MILESTONES.md`.

---

## 17. Preguntas frecuentes

**1. ¿Por qué los nombres de variables están en español en `app.js` pero en inglés en `LicenseValidator.js`?**
Convención mixta heredada: `app.js`, `sageService.js`, `fracttalClient.js` se escribieron originalmente en español; `LicenseValidator.js` se portó desde SageConnect (que estaba en inglés). El logger sí está consistente: mensajes en español. No vale la pena rebrandear; mantén el estilo del archivo donde edites.

**2. ¿Por qué hay dos entry points (`src/main.js` y `src/app.js`)?**
`main.js` levanta el server Express + cron. `app.js` exporta `syncInventory()` y también tiene su propio `start()` si lo corres directo (modo "headless cron"). Se invocan según el caso de uso: `npm start` → `main.js`; `npm run sync-only` → `app.js`; `npm run sync` → `sync.js` (wrapper que llama `syncInventory()` una vez y exit). Esto data del v1.0 y nunca se consolidó; no lo cambies sin pensarlo bien porque los scripts de despliegue dependen de los tres paths.

**3. ¿Por qué `POST /items/` está marcado como deprecado en el código de Fracttal?**
Porque crea **assets huérfanos** sin asociación a almacén. Se descubrió en febrero 2026 cuando se reportó que items "no aparecían" en Fracttal. Reemplazo: `POST /inventories/` (crea + asocia) + `PUT /inventories_adjustment/{code}` (set stock). Ver [`docs/MEMORY.md`](./docs/MEMORY.md) sección "Descubrimientos de la API de Fracttal".

**4. ¿Qué pasa si Fracttal devuelve `UNAUTHORIZED_ENDPOINT`?**
Significa que el módulo de Inventarios/Almacenes no está habilitado en el tenant del cliente. SageSync detecta este caso específicamente (`error.isUnauthorizedEndpoint = true`) y no intenta renovar el token; loguea un mensaje claro y aborta la operación. El cliente debe contactar a soporte de Fracttal para habilitar el módulo.

**5. ¿Cómo desconectar un cliente sin tocar su servidor?**
Marcar la licencia como `active: false` en el dashboard de `sageconnect-license`. En el siguiente poll (≤60s) el dashboard del cliente muestra banner rojo y todo endpoint devuelve 503. Para reconectar: vuelve a activar.

**6. ¿El servicio se reinicia solo si crashea?**
Sí. Servy está configurado con `--maxRestartAttempts=5`, heartbeat de 30s, `--maxFailedChecks=3`. Si crashea 5 veces seguidas, Servy se rinde — eso casi siempre indica problema de `.env` o de licencia, no de código.

**7. ¿Por qué no hay tests para `main.js`?**
Porque `main.js` arranca cron + listener + valida licencia con HTTP real, y eso es lo que cubren los tests de integración (`tests/integration/licenseEnforcement.test.js`) que reproducen un Express idéntico con mocks. Ver `beforeAll` ahí para el patrón. Si tocas `main.js`, asegúrate de que el integration test sigue pasando.

**8. ¿Por qué `.codex/skills/` y `.opencode/skills/` son symlinks?**
Son apuntadores a `.agents/skills/browser-use` para que distintas herramientas AI (Codex, OpenCode, Claude Code, etc.) compartan la misma skill sin duplicar archivos. Si una herramienta no la usa, ignórala.

---

## Siguiente paso

1. Lee [`ARCHITECTURE.md`](./ARCHITECTURE.md) y abre `src/main.js` mientras la lees.
2. Levanta el proyecto localmente (Sección 6).
3. Si te toca operar producción, abre [`RUNBOOK.md`](./RUNBOOK.md).
4. Si te toca evolucionar el código, lee [`docs/MEMORY.md`](./docs/MEMORY.md) primero.

Bienvenido al proyecto.
