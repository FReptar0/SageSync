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

# ====== SINCRONIZACIÓN ======
SYNC_CRON_SCHEDULE=0 2 * * *
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

---

## Paso 4: Auto-Setup (Descubrir Sage300 + Crear Almacenes en Fracttal + Generar config.json)

Este script se conecta a Sage300, descubre todas las ubicaciones con inventario, crea los almacenes en Fracttal, y genera `config.json` automáticamente.

### 4a. Primero ver qué encontraría (sin crear nada)

```powershell
cd E:\SageSync
node scripts/setup-automap.js --dry-run
```

Muestra:
- Tabla con todas las ubicaciones de Sage300
- Cantidad de items y stock por ubicación
- Mapeos propuestos (ej: `GRAL` → `ALM-GRAL`)
- El `config.json` que generaría

### 4b. Ejecutar el setup real

```powershell
node scripts/setup-automap.js --state "Zacatecas" --city "Morelos" --country "México"
```

Ajustar `--state`, `--city` y `--country` según la ubicación del cliente.

**Lo que hace:**
1. Conecta a Sage300 → descubre ubicaciones con inventario activo
2. Muestra tabla y propone mapeos → pide confirmación
3. Se autentica con Fracttal
4. Crea cada almacén en Fracttal (salta si ya existe)
5. Genera `config.json` con todos los mapeos

**Opciones disponibles:**

| Flag | Descripción | Default |
|------|-------------|---------|
| `--dry-run` | Solo muestra, no crea nada | — |
| `--prefix ALM` | Prefijo para códigos de almacén | `ALM` |
| `--state` | Estado para los almacenes | vacío |
| `--city` | Ciudad para los almacenes | vacío |
| `--country` | País | `México` |

### 4c. Revisar config.json

Abrir `E:\SageSync\config.json` y verificar:
- Todas las ubicaciones de Sage300 están mapeadas
- Los códigos de almacén son correctos
- Las direcciones son las del cliente (ajustar si es necesario)

> **Si una ubicación de Sage300 no tiene mapeo en config.json, sus items se saltan durante la sincronización con un warning en logs.**

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
📅 Sincronización programada: 0 2 * * *
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

Los almacenes ya fueron creados por el auto-setup (paso 4). Ahora cargar los items.

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

Cambiar temporalmente el schedule en `.env`:

```ini
# Cada 5 minutos para pruebas
SYNC_CRON_SCHEDULE=*/5 * * * *
```

```powershell
node src/main.js
```

1. Modificar otro item en Sage300
2. Esperar ~5 minutos
3. Verificar en Fracttal que cambió
4. **Restaurar** el schedule al horario deseado:

```ini
SYNC_CRON_SCHEDULE=0 2 * * *
```

---

## Paso 10: Instalar Servicio con Servy

Una vez que todo funciona correctamente:

```powershell
# Ejecutar PowerShell como Administrador
cd E:\SageSync
.\scripts\install-service.ps1
```

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
| `config.json` | Auto-generado por setup | No |
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
- [ ] `.env` creado con todas las variables
- [ ] Auto-setup ejecutado (`node scripts/setup-automap.js`)
- [ ] `config.json` generado y revisado
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
- [ ] Reinicio del servidor probado (servicio arranca solo)
- [ ] Logs de Servy y aplicación sin errores
