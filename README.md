# SageSync - Sincronizador de Inventario Sage300 ↔ Fracttal

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/FReptar0/SageSync)

Sistema de sincronización automática de inventario entre Sage300 y Fracttal para gestión eficiente de almacenes.

## 📦 Handoff

Este proyecto fue traspasado a un nuevo responsable el **2026-05-12**. Si llegas frío al repo, **empieza por [`HANDOFF.md`](./HANDOFF.md)** — incluye estado actual, arquitectura, despliegue, sistema de licencias, runbook, decisiones históricas, FAQ y los contactos/accesos que necesitas pedir antes de operar.

Documentos relacionados:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — mapa del código (en inglés, junto a la implementación).
- [`RUNBOOK.md`](./RUNBOOK.md) — procedimientos operativos (verificar salud, sync de emergencia, rotar tokens, troubleshooting).
- [`docs/MEMORY.md`](./docs/MEMORY.md) — memoria histórica del proyecto: decisiones, descubrimientos de la API de Fracttal, gotchas resueltos.
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — guía de despliegue paso a paso a servidor cliente.
- [`CLAUDE.md`](./CLAUDE.md) — instrucciones para Claude Code (memoria de proyecto + comandos y subagents).

## 🚀 Características Principales

- **Sincronización Automatizada**: Sincronización programada vía cron jobs
- **Persistencia de Token**: Manejo automático de tokens OAuth2 con renovación automática
- **Auto-creación de Almacenes**: Crea almacenes en Fracttal automáticamente si no existen
- **Configuración Flexible**: Sistema de configuración basado en JSON
- **Manejo de Errores Robusto**: Logging detallado y manejo de errores por item
- **Mapeo Inteligente**: Reglas configurables para mapear ubicaciones Sage a almacenes Fracttal

## 📋 Requisitos del Sistema

- **Node.js**: >= 16.x
- **SQL Server**: Acceso a base de datos Sage300
- **Fracttal API**: Credenciales OAuth2 válidas
- **Sistema Operativo**: Windows/Linux/macOS

## 🛠 Instalación

### 1. Clonar e instalar dependencias

```bash
git clone <repository-url>
cd SageSync
npm install
```

### 2. Configurar variables de entorno

Crear archivo `.env` en la raíz del proyecto:

```env
# Base de datos Sage300
DB_HOST=tu-servidor-sql
DB_PORT=1433
DB_DATABASE=COPDAT
DB_USER=tu-usuario
DB_PASSWORD=tu-password

# Fracttal API
FRACTTAL_BASE_URL=https://app.fracttal.com/api
FRACTTAL_OAUTH_URL=https://one.fracttal.com/oauth/token
FRACTTAL_CLIENT_ID=tu-client-id
FRACTTAL_CLIENT_SECRET=tu-client-secret

# Configuración de sincronización
SYNC_TIMEOUT=30000
SYNC_CRON_SCHEDULE=0 2 * * *
SYNC_ON_STARTUP=false # Si true, sincroniza al iniciar

# Configuración de Logs
LOG_LEVEL=info
LOG_FILE=logs/sagesync.log
LOG_MAX_SIZE=10m
LOG_MAX_FILES=5

# Configuración del Servidor
PORT=3000
NODE_ENV=production
```

### 3. Configurar mapeo de almacenes

El archivo `config.json` ya está preconfigurado para usar solo ubicación GRAL:

```json
{
  "locationMapping": {
    "GRAL": {
      "fracttalWarehouseCode": "ALM-AMP",
      "name": "Almacén Principal",
      "specialRules": [
        {
          "name": "Items Explosivos",
          "keywords": ["EXPLOSIV", "DETONANTE", "FULMINANTE", "MECHA", "NONEL"],
          "fracttalWarehouseCode": "ALM-AMP"
        }
      ]
    }
  }
}
```

## 🔧 Comandos Disponibles

### Ejecución Principal

```bash
# Ejecutar sincronización una vez
npm start

# Modo desarrollo con auto-restart
npm run dev

# Sincronización manual
npm run sync
```

### Testing

```bash
# Ejecutar todos los tests
npm test

# Tests específicos
npm run test:fracttal    # Solo tests de FracttalClient
npm run test:sage        # Solo tests de SageService  
npm run test:integration # Tests de integración

# Tests en modo watch
npm run test:watch

# Coverage completo
npm run test:coverage
```

### Mantenimiento

```bash
# Ejecutar tareas de mantenimiento completas
npm run maintenance

# Limpiar logs antiguos
npm run maintenance:clean

# Renovar token OAuth2
npm run maintenance:token

# Crear backup de configuración
npm run maintenance:backup
```

## 📁 Estructura del Proyecto

```bash
SageSync/
├── src/
│   ├── app.js                 # Aplicación principal
│   ├── maintenance.js         # Script de mantenimiento
│   ├── config/
│   │   ├── configManager.js   # Gestor de configuración
│   │   ├── database.js        # Conexión a Sage300
│   │   └── logger.js          # Sistema de logging
│   └── services/
│       ├── fracttalClient.js  # Cliente API Fracttal
│       └── sageService.js     # Servicio Sage300
├── tests/
│   ├── manual/               # Tests manuales de API
│   ├── services/             # Tests unitarios
│   └── integration/          # Tests de integración
├── logs/                     # Archivos de log
├── config.json              # Configuración principal
└── .fracttal-token         # Token OAuth2 (auto-generado)
```

## 🔄 Funcionamiento

### Proceso de Sincronización

1. **Validación**: Verifica configuración y conexiones
2. **Extracción**: Obtiene items de inventario desde Sage300
3. **Mapeo**: Aplica reglas de mapeo de ubicaciones
4. **Verificación**: Asegura que almacenes existen en Fracttal
5. **Sincronización**: Actualiza o asocia items en Fracttal
6. **Reporte**: Genera resumen de la operación

### Manejo de Tokens

- Los tokens OAuth2 se guardan automáticamente en `.fracttal-token`
- Renovación automática antes de expiración
- Fallback a nueva autenticación si falla la renovación

### Configuración de Almacenes

- **Auto-creación**: Crea almacenes automáticamente si no existen
- **Mapeo flexible**: Reglas por ubicación y keywords
- **Validación**: Verifica configuración antes de ejecutar

## 📊 Monitoreo y Logs

### Archivos de Log

- `logs/sagesync.log`: Log principal del sistema
- `logs/error.log`: Solo errores críticos

### Métricas de Sincronización

```javascript
{
  totalItems: 4618,           // Items en Sage300
  processedItems: 4550,       // Items procesados
  updatedItems: 3200,         // Items actualizados
  createdItems: 1350,         // Items asociados a almacenes
  errors: 68,                 // Errores individuales
  warehousesCreated: [\"ALM-AMP\"] // Almacenes verificados/creados
}
```

## 🔧 Configuración Avanzada

### Reglas de Mapeo Especiales

```json
{
  "specialRules": [
    {
      "name": "Items Peligrosos",
      "keywords": ["EXPLOSIV", "QUÍMICO", "TÓXICO"],
      "fracttalWarehouseCode": "ALM-SEGURIDAD"
    },
    {
      "name": "Herramientas",
      "keywords": ["HERRAMIENTA", "EQUIPO"],
      "fracttalWarehouseCode": "ALM-HERRAMIENTAS"
    }
  ]
}
```

### Programación de Tareas

```env
# Diario a las 2 AM
SYNC_CRON_SCHEDULE=0 2 * * *

# Cada 4 horas
SYNC_CRON_SCHEDULE=0 */4 * * *

# Solo días laborables a las 6 AM
SYNC_CRON_SCHEDULE=0 6 * * 1-5
```

## 🚨 Troubleshooting

### Problemas Comunes

#### Error de conexión a Sage300

```bash
npm run maintenance  # Verificar configuración
```

#### Token expirado

```bash
npm run maintenance:token  # Renovar token
```

#### Logs muy grandes

```bash
npm run maintenance:clean  # Limpiar logs antiguos
```

### Verificación de Estado

```bash
npm run maintenance:status  # Verificar estado del sistema
```

```bash
# Estado completo del sistema
npm run maintenance

# Solo verificar configuración
node -e \"new (require('./src/config/configManager'))().validateConfig()\"
```

## 📞 Soporte

Para soporte técnico, revisar:

1. **Logs**: `logs/sagesync.log` y `logs/error.log`
2. **Configuración**: Ejecutar `npm run maintenance`
3. **Tests**: Ejecutar `npm test` para verificar funcionalidad

## 🔄 Actualización

Para actualizar el sistema:

1. **Backup**: `npm run maintenance:backup`
2. **Actualizar código**: `git pull`
3. **Instalar dependencias**: `npm install`
4. **Verificar**: `npm run maintenance`

---

**Versión**: 1.0.0 Production  
**Última actualización**: $(date)  
**Estado**: ✅ Listo para producción
