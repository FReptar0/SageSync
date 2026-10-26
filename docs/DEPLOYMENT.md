# SageSync — Guía de Despliegue

Guía completa para desplegar SageSync en un servidor de cliente (pruebas o producción).

---

## Prerrequisitos

### Software en el Servidor

- **Windows Server**
- **Node.js 18** — `node --version`
- **Servy** — `winget install servy` → reiniciar terminal → `servy-cli --version`
- **Git** — para clonar el repositorio

### Acceso de Red

| Destino | Puerto | Protocolo | Para qué |
|---------|--------|-----------|----------|
| SQL Server Sage300 | 1433 | TCP | Lectura de inventario |
| app.fracttal.com | 443 | HTTPS | API de Fracttal |
| one.fracttal.com | 443 | HTTPS | OAuth de Fracttal |
| sageconnect-license.vercel.app | 443 | HTTPS | Validación de licencia |

### Información Necesaria

- [ ] Credenciales SQL Server de Sage300 (host, usuario, contraseña, nombre BD)
- [ ] Client ID y Client Secret de Fracttal **del tenant del cliente**
- [ ] HMAC_SECRET del servidor de licencias (mismo que usa sageconnect)

---

## Paso 1: Registrar Licencia

1. Ir al dashboard de **sageconnect-license.vercel.app**
2. Crear nuevo cliente → **SageSync - [Nombre del Cliente]**
3. Establecer fecha de expiración (o sin expiración para pruebas)
4. Copiar el **API key** generado
5. Copiar el **HMAC_SECRET** de las variables del servidor de licencias

---

## Paso 2: Clonar y Preparar

```powershell
git clone https://github.com/FReptar0/SageSync-dist.git E:\SageSync
cd E:\SageSync
npm install --production
```

> **Nota:** SageSync-dist es el código ofuscado. No contiene código fuente.

---

## Paso 3: Crear `.env`

Crear `E:\SageSync\.env`:

```ini
# ====== LICENCIA (OBLIGATORIO — la app no arranca sin estas) ======
LICENSE_API_URL=https://sageconnect-license.vercel.app
HMAC_SECRET=<HMAC secret del servidor de licencias>
SAGESYNC_API_KEY=<API key del paso 1>

# ====== BASE DE DATOS — Sage300 ======
DB_HOST=<IP o hostname del SQL Server>
DB_PORT=1433
DB_NAME=<nombre de la BD de Sage300, ej: COPDAT>
DB_USER=<usuario SQL>
DB_PASSWORD=<contraseña SQL>
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true

# ====== FRACTTAL API ======
FRACTTAL_BASE_URL=https://app.fracttal.com/api
FRACTTAL_OAUTH_URL=https://one.fracttal.com/oauth/token
FRACTTAL_CLIENT_ID=<client ID de Fracttal del cliente>
FRACTTAL_CLIENT_SECRET=<client secret de Fracttal del cliente>

# ====== MAPEO DE ALMACENES ======
# Mapeo de ESTE servidor, fuera de git: los deploys no lo tocan (ver Paso 4)
CONFIG_PATH=config.local.json

# ====== SINCRONIZACIÓN ======
# Carga COMPLETA: no se programa; se corre a mano (dashboard o npm run sync)
SYNC_CRON_SCHEDULE=off
# Carga DIARIA/delta: a las 12:00, 16:00 y 23:00
SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *
# Zona horaria de todos los horarios
SYNC_TIMEZONE=America/Mexico_City
# true = este servidor solo simula: lee Sage y Fracttal pero no escribe (servicio, dashboard y npm run sync)
SYNC_DRY_RUN=false
SYNC_BATCH_SIZE=100
SYNC_TIMEOUT=30000
SYNC_ON_STARTUP=false

# ====== LOGS ======
LOG_LEVEL=info
LOG_FILE=logs/sagesync.log
LOG_MAX_SIZE=10m
LOG_MAX_FILES=5

# ====== SERVIDOR ======
PORT=3000
NODE_ENV=production
```

**Horarios de sincronización:**

- `SYNC_CRON_SCHEDULE` (carga COMPLETA): vacía = `0 2 * * *` (comportamiento anterior); `off`, `false`, `none` o `disabled` = no se programa. La carga completa siempre se puede correr a mano con el botón de sincronizar del dashboard (`POST /api/sync`) o con `npm run sync`.
- `SYNC_DAILY_CRON_SCHEDULE` (carga DIARIA/delta): vacía u `off` = no se programa. Solo toma lo que se movió hoy.
- `SYNC_TIMEZONE`: zona horaria IANA, default `America/Mexico_City`, independiente de la zona horaria del Windows Server.
- `SYNC_DRY_RUN`: `true` = modo simulación para todo el servidor. Las corridas programadas, el botón del dashboard, `SYNC_ON_STARTUP` y `npm run sync` leen Sage y Fracttal pero no escriben nada en Fracttal; el arranque lo anuncia con `Modo: SIMULACIÓN`. Vacía o `false` = escribe. Sirve para dejar el servicio corriendo en un servidor de pruebas que apunta a Fracttal de producción, o para instalarlo en producción antes de la carga inicial y pasarlo a `false` después.
- Cualquier valor inválido hace que el servicio NO arranque (exit 1); el mensaje nombra la variable y el valor (ver `logs/servy-stderr.log`).

**Mapeo de almacenes:**

- `CONFIG_PATH` es el archivo de mapeo que se usa en lugar de `config.json`: relativo a la carpeta de instalación o ruta absoluta, escrito sin comillas.
- Si `CONFIG_PATH` está definida y el archivo no existe, el servicio NO arranca; nunca cae a `config.json`. El archivo se crea en el Paso 4.

---

## Paso 4: Mapeo de almacenes de este servidor (`config.local.json`)

En un servidor desplegado desde `SageSync-dist`, cada actualización (`git reset --hard`) regresa `config.json` a la versión del repo. El mapeo real de este servidor vive en `config.local.json`: git lo ignora y los deploys nunca lo tocan. SageSync lo usa porque el `.env` tiene `CONFIG_PATH=config.local.json` (Paso 3).

### 4a. Crear `config.local.json`

```powershell
cd E:\SageSync
Copy-Item config.json config.local.json
```

### 4b. Editar el mapeo (solo en `config.local.json`)

Abrir `E:\SageSync\config.local.json` y verificar:
- Todas las ubicaciones de Sage300 están mapeadas en `locationMapping`, a los códigos reales de los almacenes en el Fracttal del cliente
- Las direcciones (`warehouseConfig`) son las del cliente
- **Cuidado:** la plantilla mapea `GRAL` → `ALM-AMP` (y `TEST` → `TEST001`), y con `warehouseCreationSettings.enabled: true` (el valor de la plantilla) SageSync crea cualquier almacén mapeado que no exista. Si se deja así, crearía `ALM-AMP` en el Fracttal del cliente y sincronizaría ahí.

> **Nunca edites `config.json` en el servidor:** el siguiente deploy lo sobrescribe y el servicio sincronizaría con el mapeo del repo.

> **Si una ubicación de Sage300 no tiene mapeo en `config.local.json`, sus items se saltan durante la sincronización con un warning en logs.**

Cada cambio posterior a `config.local.json` requiere `Restart-Service SageSync`: el mapeo se lee al arrancar.

### 4c. `setup-automap.js` no se usa en producción

`scripts/setup-automap.js` crea almacenes en Fracttal y escribe `config.json` (no `config.local.json`). No viene en el dist y **no** se ejecuta en producción. Para checkouts del código fuente, ver `ARCHITECTURE.md` §7.3.

---

## Paso 5: Verificar Arranque

```powershell
cd E:\SageSync
node src/main.js
```

**Resultado esperado:**
```
✅ Environment variables validated
[LICENSE] Valid -- expires ...
🚀 SageSync Server iniciado exitosamente!
📍 Dashboard disponible en: http://localhost:3000
📅 Sincronización programada: Completa: sin horario (manual) · Diaria: 0 12,16,23 * * * · Zona: America/Mexico_City
```

**Si falla:**

| Error | Causa | Solución |
|-------|-------|----------|
| `Missing required environment variables: LICENSE: ...` | Falta variable en .env | Agregar la variable faltante |
| `[LICENSE] Startup blocked` | Licencia inválida | Verificar SAGESYNC_API_KEY, LICENSE_API_URL, HMAC_SECRET |
| `Error conectando a la base de datos` | SQL Server inaccesible | Verificar DB_HOST, firewall, credenciales |
| `Error autenticación Fracttal` | Credenciales incorrectas | Verificar FRACTTAL_CLIENT_ID y SECRET |

Detener con `Ctrl+C` después de verificar.

---

## Paso 6: Verificar Dashboard y Licencia

1. Abrir navegador: `http://localhost:3000`
2. Dashboard debe cargar sin banner rojo
3. Verificar: `http://localhost:3000/api/system/license` → `"state": "VALID"`
4. Verificar: `http://localhost:3000/api/status` → estado del sistema

---

## Paso 7: Probar Kill Switch

1. En dashboard de licencias → cambiar SageSync a **inactivo**
2. Esperar ~60 segundos (siguiente poll)
3. Dashboard muestra **banner rojo**: "Licencia inactiva. Contacte a su proveedor."
4. Cualquier endpoint API retorna **503**
5. `http://localhost:3000/api/system/license` sigue respondiendo (siempre accesible)
6. Reactivar licencia → banner desaparece en siguiente poll
7. Verificar que todo vuelve a funcionar normalmente

---

## Paso 8: Carga Inicial del Inventario

Con el mapeo de `config.local.json` revisado (Paso 4), cargar los items.

### 8a. Ejecutar la sincronización manual

```powershell
cd E:\SageSync
node src/sync.js
```

### 8b. Monitorear el progreso

```
🔍 Verificando si almacén ALM-GRAL existe...
✅ Almacén ALM-GRAL ya existe
Creando item: ITEM001 en almacén ALM-GRAL
Progreso: 100/500 items procesados
...
RESUMEN DE SINCRONIZACIÓN:
- Total items en Sage300: 500
- Items procesados: 485
- Items actualizados: 0
- Items creados/asociados: 485
- Errores: 15
- Almacenes verificados/creados: ALM-GRAL, ALM-OTRA
```

### 8c. Verificar en Fracttal

- [ ] Almacenes existen con datos correctos
- [ ] Conteo de items coincide (Sage300 vs Fracttal)
- [ ] Stock de items al azar coincide con Sage300
- [ ] Costos unitarios coinciden
- [ ] Revisar errores en `logs/sagesync.log`

### Consideraciones

- **Volumen grande (>5000 items):** La carga puede tardar por rate limits de Fracttal. Ejecutar fuera de horario laboral.
- **Errores individuales no detienen el proceso** — continúa con el siguiente item.
- **La sync es full sweep** — recorre TODOS los items cada vez. No es incremental.

---

## Paso 9: Validar Actualización de Inventario

Verificar que detecta cambios en Sage300.

### 9a. Modificar un item en Sage300

Cambiar `QuantityOnHand` de un item conocido (vía Sage300 o SQL).
Anotar: código del item, valor anterior, valor nuevo.

### 9b. Ejecutar sync y verificar

```powershell
node src/sync.js
```

Verificar en Fracttal que el stock del item cambió al valor nuevo.

### 9c. Probar con cron automático

Cambiar temporalmente los horarios en `.env` para probar la carga DIARIA programada:

```ini
# Carga completa sin horario; carga diaria cada 5 minutos para pruebas
SYNC_CRON_SCHEDULE=off
SYNC_DAILY_CRON_SCHEDULE=*/5 * * * *
```

```powershell
node src/main.js
```

1. Modificar otro item en Sage300 (la carga diaria solo toma los items movidos HOY)
2. Esperar ~5 minutos
3. Verificar en Fracttal que cambió
4. **Restaurar** el horario de producción:

```ini
SYNC_DAILY_CRON_SCHEDULE=0 12,16,23 * * *
```

---

## Paso 10: Instalar Servicio con Servy

Una vez que todo funciona correctamente:

```powershell
# Ejecutar PowerShell como Administrador
cd E:\SageSync
.\scripts\install-service.ps1
```

El script viene en el dist (`scripts\install-service.ps1`). Sin `-InstallDir` usa la carpeta padre de `scripts\`, es decir, la carpeta de instalación desde la que se ejecuta.

> `npm run install-service` hace lo mismo (ejecuta este script con PowerShell, también como Administrador) y `npm run uninstall-service` desinstala el servicio con Servy (`servy-cli uninstall --name=SageSync`).

Parámetros opcionales:

```powershell
.\scripts\install-service.ps1 -InstallDir "D:\apps\SageSync" -NodePath "D:\nodejs\node.exe" -Port 3001
```

### Lo que Servy proporciona

| Característica | Configuración |
|---------------|---------------|
| Auto-inicio al arrancar Windows | `startupType: Automatic` |
| Recuperación ante caídas | Reinicia hasta 5 veces |
| Monitoreo de salud | Heartbeat cada 30s |
| Rotación de logs | 10MB máximo, mantiene 5 archivos |
| Apagado graceful | 30s timeout (SIGTERM) |

---

## Paso 11: Verificar el Servicio

```powershell
# Estado del servicio
Get-Service SageSync

# Puerto escuchando
netstat -ano | findstr :3000

# Logs de Servy
Get-Content E:\SageSync\logs\servy-stdout.log -Tail 50
Get-Content E:\SageSync\logs\servy-stderr.log -Tail 50

# Logs de la aplicación
Get-Content E:\SageSync\logs\sagesync.log -Tail 50

# Dashboard
Start-Process "http://localhost:3000"

# Licencia
curl http://localhost:3000/api/system/license
```

---

## Paso 12: Probar Reinicio del Servidor

1. Reiniciar el servidor Windows
2. `Get-Service SageSync` → debe estar **Running** automáticamente
3. Dashboard accesible: `http://localhost:3000`
4. Logs: `Get-Content E:\SageSync\logs\servy-stdout.log -Tail 20`

---

## Gestión del Servicio

```powershell
# Ver estado
Get-Service SageSync
servy-cli status --name=SageSync

# Reiniciar
Restart-Service SageSync

# Detener
servy-cli stop --name=SageSync

# Iniciar
servy-cli start --name=SageSync

# Desinstalar (requiere Admin)
servy-cli uninstall --name=SageSync
```

---

## Archivos en el Servidor

| Archivo | Origen | Contiene Secretos |
|---------|--------|:-:|
| Todo en `SageSync-dist` | `git clone` | No |
| `.env` | Crear manualmente | **Sí** |
| `config.json` | Viene en el dist (plantilla; cada deploy lo sobrescribe) | No |
| `config.local.json` | Copia de `config.json` editada en este servidor (Paso 4); git la ignora | No |
| `node_modules/` | `npm install` | No |
| `logs/` | Se crea automáticamente | No |

---

## Logs

| Archivo | Contenido |
|---------|-----------|
| `logs/sagesync.log` | Toda la actividad de la aplicación |
| `logs/error.log` | Solo errores |
| `logs/servy-stdout.log` | Salida estándar del proceso (Servy) |
| `logs/servy-stderr.log` | Errores del proceso (Servy) |

Rotación automática: 10MB por archivo, mantiene 5 archivos.

---

## Troubleshooting

### La app no arranca

```powershell
# Ver logs de error
Get-Content E:\SageSync\logs\servy-stderr.log -Tail 50

# Intentar arranque manual para ver errores directos
servy-cli stop --name=SageSync
cd E:\SageSync
node src/main.js
```

### Licencia falla

```powershell
# Verificar conectividad
curl https://sageconnect-license.vercel.app

# Verificar endpoint
curl http://localhost:3000/api/system/license
```

### Sync no encuentra items

```powershell
# Verificar conexión a Sage300
curl http://localhost:3000/api/test/connections

# Ejecutar sync manual con logs visibles
node src/sync.js
```

### Almacén no se crea en Fracttal

- Verificar que el módulo de Inventarios/Almacenes está habilitado en Fracttal
- Revisar `logs/sagesync.log` para el error específico
- Puede ser error de permisos del API key de Fracttal

### Servicio se reinicia constantemente

```powershell
# Ver últimos logs
Get-Content E:\SageSync\logs\servy-stderr.log -Tail 100

# Causas comunes:
# - .env incompleto → falla al validar env vars
# - CONFIG_PATH apunta a un archivo que no existe → crear config.local.json (Paso 4)
# - Licencia expirada → falla al arrancar
# - SQL Server caído → error de conexión
```

---

## Checklist Final

### Infraestructura
- [ ] Node.js 18 instalado
- [ ] Servy instalado
- [ ] Firewall configurado (salida a Fracttal, licencias; entrada SQL Server)
- [ ] Repo clonado y `npm install --production`

### Configuración
- [ ] `.env` creado con todas las variables (incluye `CONFIG_PATH=config.local.json`)
- [ ] `config.local.json` creado (copia de `config.json`) y mapeo revisado; `config.json` sin tocar
- [ ] Licencia registrada en servidor de licencias

### Validación de Licencia
- [ ] Arranque manual exitoso
- [ ] Dashboard carga sin errores
- [ ] `/api/system/license` retorna `VALID`
- [ ] Kill switch probado (banner rojo aparece/desaparece)

### Carga Inicial de Inventario
- [ ] `node src/sync.js` ejecutado
- [ ] Almacenes correctos en Fracttal
- [ ] Conteo de items Sage300 ≈ Fracttal
- [ ] Stock y costos verificados en items al azar
- [ ] Errores revisados en logs

### Actualización de Inventario
- [ ] Item modificado en Sage300 → sync → cambio en Fracttal
- [ ] Cron automático probado (schedule corto → verificar → restaurar)

### Servicio
- [ ] Servy instalado y servicio corriendo
- [ ] Log de arranque con `Configuración cargada exitosamente desde ...config.local.json`
- [ ] Reinicio del servidor probado (servicio arranca solo)
- [ ] Logs de Servy y aplicación sin errores
