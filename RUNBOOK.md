# SageSync — Runbook operacional

Procedimientos paso a paso para operar SageSync en producción. Asume servidor Windows del cliente, instalación en `E:\SageSync` (default; ajusta si es otra ruta).

Para despliegue inicial: [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md). Para entender el sistema: [`ARCHITECTURE.md`](./ARCHITECTURE.md). Para preguntas frecuentes: [`HANDOFF.md`](./HANDOFF.md) sección 17.

---

## Convenciones

- Todos los comandos PowerShell asumen ejecución desde `E:\SageSync` salvo nota contraria.
- Comandos marcados con `[Admin]` requieren PowerShell elevado.
- Comandos marcados con `[RDP]` requieren acceso por escritorio remoto al servidor del cliente.
- El servicio Windows se llama por defecto `SageSync`.

---

## 1. Arrancar el servicio en un servidor recién instalado

Si la instalación ya pasó por `docs/DEPLOYMENT.md`, el servicio está en `Automatic` y arranca solo al boot. Para arrancarlo a mano:

```powershell
# [Admin]
Start-Service SageSync
Get-Service SageSync
```

Si está parado por error o no instalado, sigue `docs/DEPLOYMENT.md` paso 10.

---

## 2. Verificar salud rápida

Hay tres niveles de health checks. Hazlos en orden de superficial a profundo.

### 2.1 Servicio corriendo

```powershell
Get-Service SageSync          # Status debe ser Running
netstat -ano | findstr :3000  # Debe haber LISTENING en :3000
```

### 2.2 Licencia válida

```powershell
curl http://localhost:3000/api/system/license
```

Respuesta esperada cuando todo está bien:

```json
{
  "active": true,
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "lastChecked": "2026-05-12T03:00:00.000Z",
  "state": "VALID",
  "lastSuccessfulCheck": "2026-05-12T03:00:00.000Z",
  "hmacConfigured": true
}
```

Si `state !== "VALID"`, salta a sección 7 (Diagnóstico de fallas).

### 2.3 Conexiones a Sage y Fracttal

```powershell
curl http://localhost:3000/api/test/connections
```

Respuesta esperada:

```json
{
  "sage": { "connected": true, "status": "Conectado", "error": null },
  "fracttal": { "authenticated": true, "status": "Autenticado", "error": null }
}
```

Si algo falla, salta a las secciones específicas.

### 2.4 Maintenance script (más exhaustivo)

```powershell
node src/maintenance.js
```

Muestra: limpieza de logs, validación de `config.json`, estado del token OAuth, info de sistema, presencia de archivos críticos.

### 2.5 Logs

```powershell
Get-Content logs\sagesync.log -Tail 100
Get-Content logs\error.log -Tail 50
Get-Content logs\servy-stdout.log -Tail 50
Get-Content logs\servy-stderr.log -Tail 50
```

Lo que normalmente debes ver en `sagesync.log`:

- `[LICENSE] License VALID. Expires: ...` cada validación.
- `Sincronización programada: 0 2 * * *` al boot.
- En el cron: `RESUMEN DE SINCRONIZACIÓN` con totales y errores.

---

## 3. Correr un sync manual de emergencia

Cuando el cron no corrió, o se necesita propagar un cambio puntual a Fracttal sin esperar las 2 AM.

### Opción A — Vía API (dashboard o curl)

```powershell
curl -X POST http://localhost:3000/api/sync
# Responde inmediatamente con { message: "Sincronización iniciada", inProgress: true }

# Polling
curl http://localhost:3000/api/sync/status
```

El sync corre en background; el dashboard muestra el progreso. No bloquea otras requests.

### Opción B — Vía CLI directamente

```powershell
# Detener el servicio para evitar doble sync en el cron (opcional)
Stop-Service SageSync

cd E:\SageSync
node src\sync.js

# Una vez termina (mira el "RESUMEN DE SINCRONIZACIÓN")
Start-Service SageSync
```

Útil cuando el servicio Windows está caído o cuando quieres ver el output completo en consola con colores.

### Después del sync

Verifica en Fracttal (UI web) que los conteos coincidan con Sage300 en al menos 5 items al azar. Revisa `logs/sagesync.log` para errores individuales (`errors > 0` en el resumen).

---

## 4. Rotar token OAuth de Fracttal

Lo necesitas si:

- Las credenciales OAuth (`FRACTTAL_CLIENT_ID` / `FRACTTAL_CLIENT_SECRET`) cambiaron.
- El token persistido en `.fracttal-token` se corrompió.
- Fracttal devuelve `401` repetidamente y el refresh automático no resuelve.

```powershell
# Borrar el token y forzar nueva autenticación
del .fracttal-token

# Renovar manualmente
node src\maintenance.js renew-token
```

El siguiente request usará credentials del `.env` para autenticar y persistirá el nuevo token. Reinicia el servicio si quieres asegurarte que la siguiente ejecución use el token nuevo:

```powershell
# [Admin]
Restart-Service SageSync
```

---

## 5. Rotar `SAGESYNC_API_KEY` (licencia)

Lo necesitas si:

- Una llave fue comprometida.
- Se reemite tras cambiar la fecha de expiración de un cliente.
- Migración de cliente entre tenants.

### Pasos

1. **Generar nueva llave en el dashboard del license server:**
   - Login a `https://sageconnect-license.vercel.app` (admin).
   - Crear nueva entry o regenerar la existente.
   - Copiar la llave (UUID v4).
2. **Marcar la llave vieja como `active: false`** (si quieres expirar inmediatamente).
3. **Editar `E:\SageSync\.env`** en el servidor del cliente, reemplaza el valor de `SAGESYNC_API_KEY`.
4. **Reiniciar el servicio:**

```powershell
# [Admin]
Restart-Service SageSync
```

5. Verifica con `curl http://localhost:3000/api/system/license` que `state === "VALID"`.

> Si necesitas rotar `HMAC_SECRET` (compartido entre el license server y todos los clientes), coordina con el repo `sageconnect-license` y actualiza el `.env` de **cada cliente desplegado** antes de cambiarlo en Vercel — si lo cambias en Vercel primero, todos los clientes pasan a `INVALID` hasta que actualices su `.env`.

---

## 6. Limpiar logs

Los logs rotan automáticamente (10MB × 5 archivos), pero si quieres forzar limpieza:

```powershell
node src\maintenance.js clean-logs
```

Elimina archivos de log con más de 30 días de antigüedad. Si el disco está saturado y necesitas limpiar todo manualmente:

```powershell
# [Admin]
Stop-Service SageSync
del logs\*.log
del logs\servy-*.log
Start-Service SageSync
```

---

## 7. Diagnóstico de fallas comunes

### 7.1 Licencia inválida (banner rojo en el dashboard)

Sintomas:

- `state: "INVALID"` o `state: "ERROR"` en `/api/system/license`.
- Toda request API devuelve 503 excepto `/api/system/license`.
- Dashboard muestra banner + overlay.

Diagnóstico:

```powershell
# Verificar conectividad al license server
curl https://sageconnect-license.vercel.app

# Verificar el estado completo
curl http://localhost:3000/api/system/license
```

Causas y soluciones:

| `state` | `error` típico | Probable causa | Solución |
|---------|----------------|----------------|----------|
| `INVALID` | `null` | Llave revocada / expirada | Reactivar en dashboard del license server o rotar (sección 5) |
| `ERROR` | `HMAC signature mismatch` | `HMAC_SECRET` diferente entre cliente y server | Verifica `.env` del cliente vs Vercel env del server |
| `ERROR` | `Stale timestamp` | Reloj del servidor cliente desincronizado | Sincronizar NTP en el servidor Windows |
| `ERROR` | `Error TTL exceeded (24h without successful check)` | Conectividad caída >24h | Restaurar conectividad de red + reiniciar servicio |
| `ERROR` | `connect ETIMEDOUT` / `ENOTFOUND` | License server inalcanzable | Verificar firewall, DNS, Vercel status |

Después de cualquier cambio:

```powershell
# [Admin]
Restart-Service SageSync
```

### 7.2 Sage300 no conecta

Sintomas:

- `logs/sagesync.log` con `Error conectando a la base de datos`.
- `/api/test/connections` muestra `sage.connected: false`.
- El sync se aborta antes de obtener items.

Diagnóstico:

```powershell
# Verificar puerto SQL accesible
Test-NetConnection -ComputerName $env:DB_HOST -Port 1433

# Verificar credenciales con sqlcmd (si está instalado)
sqlcmd -S "$env:DB_HOST,1433" -d "$env:DB_NAME" -U "$env:DB_USER" -P "$env:DB_PASSWORD" -Q "SELECT 1"
```

Soluciones:

- Firewall del servidor SQL bloqueando — abrir 1433 inbound desde la IP del servidor de SageSync.
- Credenciales rotadas en Sage300 — actualizar `.env`.
- `DB_NAME` incorrecto — para Sage300 mexicano suele ser `COPDAT`.
- `DB_TRUST_SERVER_CERTIFICATE=false` cuando el cert es self-signed — cambiar a `true`.

### 7.3 Fracttal devuelve 401 persistente

Sintomas:

- Logs con `Token expirado, renovando...` repetidamente seguido de errores 401.
- `/api/test/connections` muestra `fracttal.authenticated: false`.

Soluciones:

1. Rotar token (sección 4): `del .fracttal-token && node src\maintenance.js renew-token`.
2. Verificar que `FRACTTAL_CLIENT_ID` y `FRACTTAL_CLIENT_SECRET` son los del tenant correcto. Cada cliente tiene los suyos.
3. Si el error específico es `UNAUTHORIZED_ENDPOINT`, el módulo de Inventarios o Almacenes no está habilitado en el tenant Fracttal del cliente. Contactar a soporte de Fracttal para habilitar el módulo.

### 7.4 El sync falla a media corrida con muchos errores

Sintomas:

- `RESUMEN DE SINCRONIZACIÓN` con `errors >> 0`.
- Logs llenos de errores per-item.

Diagnóstico:

```powershell
# Ver los últimos 50 errores
Get-Content logs\error.log -Tail 50

# Stats del cron en memoria (último resultado solamente)
curl http://localhost:3000/api/sync/status
```

Patrones comunes:

| Error en logs | Significa | Acción |
|---------------|-----------|--------|
| `Item sin código o ubicación válida` | Fila en Sage300 con `ITEMNO=null` o `LOCATION=null` | Limpiar datos en Sage; los items se saltan, no detienen el sync |
| `Ubicación X no soportada` | No hay entry en `config.json` para esa ubicación | Editar `config.json` agregando el mapeo, o re-correr `scripts/setup-automap.js` |
| `Error asegurando que el almacén X existe` | Fracttal rechazó crear el almacén | Crear manualmente en UI de Fracttal o ajustar `warehouseCreationSettings` en `config.json` |
| Items individuales con 400/500 de Fracttal | Datos inválidos en Sage (e.g. `LastCost` negativo) | Cada item se trata como aislado; revisar el item en cuestión |

### 7.5 El servicio se reinicia constantemente

Servy retry-limit (5 intentos) ya disparó:

```powershell
Get-Service SageSync                         # Status Stopped
Get-Content logs\servy-stderr.log -Tail 100
```

Causas más frecuentes:

- `.env` incompleto → `validateEnv()` aborta con la lista de variables faltantes.
- Licencia inválida en startup → tras 3 reintentos `process.exit(1)`.
- Puerto 3000 ya en uso por otra app — cambiar `PORT` en `.env`.
- Path de `src/main.js` movido — reinstalar servicio.

Solución rápida: arrancar a mano para ver el error real:

```powershell
# [Admin]
Stop-Service SageSync
cd E:\SageSync
node src\main.js
# Lee el error en pantalla, corrige .env o lo que sea
Start-Service SageSync
```

---

## 8. Desinstalar y reinstalar el servicio Windows

### Desinstalar

```powershell
# [Admin]
servy-cli uninstall --name=SageSync
```

El servicio se quita pero los archivos en `E:\SageSync` permanecen (incluyendo `.env` y `logs/`).

### Reinstalar

```powershell
# [Admin]
cd E:\SageSync
.\scripts\install-service.ps1
```

Idempotente: si el servicio ya existe, sale sin hacer nada y te pide desinstalar primero.

### Actualizar a una nueva versión

```powershell
# [Admin]
Stop-Service SageSync
cd E:\SageSync
git fetch origin
git reset --hard origin/main   # NUNCA `git pull` — el repo SageSync-dist está ofuscado, pull genera conflictos irrecuperables
npm install --production
Start-Service SageSync
```

Si la actualización tocó env vars nuevas, edita `.env` antes de `Start-Service`. Backup recomendado antes:

```powershell
node src\maintenance.js backup-config
```

---

## 9. Operaciones de emergencia

### 9.1 Apagar SageSync inmediatamente para un cliente

Sin tocar el servidor: **marcar la licencia como `active: false`** en el dashboard del license server. En ≤60s, todos los endpoints del cliente devuelven 503 y los crons se saltan. Reactivar: marcar `active: true`.

### 9.2 Backup de configuración antes de un cambio riesgoso

```powershell
node src\maintenance.js backup-config
# Crea backups/config-backup-{ISO_TIMESTAMP}.json
```

### 9.3 Detener el cron pero dejar el dashboard arriba

No hay un toggle limpio para esto. Workarounds:

- Cambiar `SYNC_CRON_SCHEDULE` a una expresión inválida o futura (e.g. `0 0 31 2 *` — 31 de febrero, no existe) y reiniciar.
- O simplemente parar el servicio: `Stop-Service SageSync`.

### 9.4 Saltarse la verificación de licencia para troubleshooting (NO USAR EN PRODUCCIÓN)

No es posible. Por diseño. Si un cliente legítimo está bloqueado por un problema del license server, la solución es:

1. Confirmar que `state === "ERROR"` y `lastSuccessfulCheck` está dentro de 24h.
2. Si está dentro de 24h, el servicio sigue funcionando con el último estado bueno (que era `VALID`). Sin acción.
3. Si pasó las 24h, el último estado se promueve a `INVALID`. Hay que resolver el problema del license server o forzar una nueva validación con conexión restaurada.

---

## 10. Logs útiles

| Archivo | Qué tiene | Cuándo lo lees |
|---------|-----------|----------------|
| `logs/sagesync.log` | Todo lo de la app (winston, JSON) | Operación normal, ver últimas corridas de sync |
| `logs/error.log` | Solo errores y warnings | Post-mortem de fallas |
| `logs/servy-stdout.log` | stdout del proceso node | Boot output del servicio Windows |
| `logs/servy-stderr.log` | stderr del proceso node | Crashes, exits no graceful |

Filtrar por palabra clave:

```powershell
Select-String "Error" logs\sagesync.log -SimpleMatch | Select-Object -Last 20
Select-String "LICENSE" logs\sagesync.log -SimpleMatch | Select-Object -Last 10
```

Logs vía API (lo que usa el dashboard):

```powershell
curl "http://localhost:3000/api/logs?type=error&lines=50"
curl "http://localhost:3000/api/logs/stats"
curl "http://localhost:3000/api/logs/dates"
```

---

## 11. Cuando necesitas ayuda

1. Captura: output completo de `node src\maintenance.js`, últimos 200 líneas de `logs/sagesync.log`, output de `curl http://localhost:3000/api/system/license` y `curl http://localhost:3000/api/test/connections`.
2. Confirma versión: `git rev-parse HEAD` en `E:\SageSync`.
3. Contacta al dueño anterior (`fmemije00@gmail.com`) o admin de Tersoft.

Para cosas que no puedes hacer desde el servidor (revocar licencia, ver logs del license server, etc.): contacto Tersoft IT.
