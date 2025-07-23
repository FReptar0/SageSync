# Política de Seguridad

## Versiones Soportadas

Actualmente se proporciona soporte de seguridad para las siguientes versiones de SageSync:

| Versión | Soporte de Seguridad |
| ------- | ------------------- |
| 1.0.x   | ✅ Sí |
| < 1.0   | ❌ No |

## Reportar una Vulnerabilidad

La seguridad de SageSync es una prioridad. Agradecemos los esfuerzos responsables para revelar vulnerabilidades de seguridad.

### Cómo Reportar

**⚠️ NO cree un issue público para vulnerabilidades de seguridad.**

Para reportar una vulnerabilidad de seguridad:

1. **Email Directo**: Envíe un email detallado a `fmemije00@gmail.com`
2. **Asunto**: Use el formato `[SECURITY] SageSync - Descripción breve`
3. **Información Requerida**:
   - Descripción detallada de la vulnerabilidad
   - Pasos para reproducir el problema
   - Impacto potencial
   - Cualquier mitigación temporal sugerida

### Qué Esperar

- **Confirmación**: Respuesta dentro de 48 horas
- **Evaluación**: Análisis completo dentro de 5 días hábiles
- **Resolución**: Plan de acción comunicado dentro de 7 días hábiles
- **Parche**: Liberación de corrección según la severidad

### Niveles de Severidad

| Nivel | Descripción | Tiempo de Respuesta |
|-------|-------------|-------------------|
| **Crítica** | Vulnerabilidades que pueden comprometer sistemas inmediatamente | 24 horas |
| **Alta** | Vulnerabilidades con alto impacto pero requieren condiciones específicas | 72 horas |
| **Media** | Vulnerabilidades con impacto limitado | 7 días |
| **Baja** | Vulnerabilidades menores o mejoras de seguridad | 14 días |

## Áreas de Seguridad Críticas

### 🔐 Autenticación y Autorización
- Tokens OAuth2 de Fracttal
- Credenciales de base de datos Sage300
- Almacenamiento seguro de credenciales

### 🗄️ Manejo de Datos
- Conexiones a base de datos SQL Server
- Transmisión de datos hacia API de Fracttal
- Logs que pueden contener información sensible

### 🌐 Comunicaciones de Red
- Conexiones HTTPS con Fracttal API
- Conexiones TLS con SQL Server
- Validación de certificados

### 📁 Sistema de Archivos
- Archivos de configuración
- Tokens persistentes
- Logs y archivos temporales

## Mejores Prácticas de Seguridad

### Para Usuarios

1. **Variables de Entorno**
   ```bash
   # ✅ Correcto - usar .env
   FRACTTAL_CLIENT_SECRET=your_secret_here
   
   # ❌ Incorrecto - hardcoded en código
   const secret = "your_secret_here";
   ```

2. **Permisos de Archivos**
   ```bash
   # Proteger archivos sensibles
   chmod 600 .env
   chmod 600 .fracttal-token
   ```

3. **Conexiones de Base de Datos**
   - Use autenticación Windows cuando sea posible
   - Implemente principio de menor privilegio
   - Use conexiones encriptadas (TLS)

4. **Logs**
   - Configure rotación de logs
   - No registre credenciales en logs
   - Proteja directorios de logs

### Para Desarrolladores

1. **Validación de Entrada**
   ```javascript
   // Validar datos antes de procesar
   if (!itemCode || typeof itemCode !== 'string') {
       throw new Error('Código de item inválido');
   }
   ```

2. **Manejo de Errores**
   ```javascript
   // No exponer información sensible en errores
   catch (error) {
       logger.error('Error de autenticación', { 
           message: error.message 
           // NO incluir error.stack en producción
       });
   }
   ```

3. **Sanitización**
   ```javascript
   // Sanitizar datos antes de queries SQL
   const cleanItemCode = itemCode.replace(/[^A-Za-z0-9]/g, '');
   ```

## Configuración de Seguridad

### Archivos Protegidos

Asegúrese de que estos archivos estén protegidos:

```
.env                 # Variables de entorno
.fracttal-token      # Token OAuth2
config.json          # Configuración (verificar datos sensibles)
logs/               # Directorio de logs
```

### Variables de Entorno Críticas

```env
# Database (requeridas)
DB_PASSWORD=        # Contraseña de base de datos
DB_USER=           # Usuario de base de datos

# Fracttal API (requeridas)
FRACTTAL_CLIENT_SECRET=  # Secret OAuth2
FRACTTAL_CLIENT_ID=      # Client ID OAuth2
```

## Auditoría y Monitoreo

### Logs de Seguridad

SageSync registra eventos de seguridad relevantes:

- Intentos de autenticación fallidos
- Accesos a datos sensibles
- Errores de conexión de red
- Modificaciones de configuración

### Monitoreo Recomendado

1. **Monitorear archivos**:
   ```bash
   # Vigilar cambios en archivos críticos
   /path/to/sagesync/.env
   /path/to/sagesync/.fracttal-token
   /path/to/sagesync/config.json
   ```

2. **Monitorear conexiones**:
   - Conexiones inusuales a la base de datos
   - Llamadas API fuera de horarios normales
   - Fallos de autenticación repetidos

## Contacto de Seguridad

Para consultas relacionadas con seguridad:

- **Email**: fmemije00@gmail.com
- **Asunto**: `[SECURITY] SageSync - Su consulta`
- **Tiempo de respuesta**: 48 horas (días hábiles)

## Historial de Vulnerabilidades

*Actualmente no hay vulnerabilidades reportadas.*

---

**Última actualización**: 23 de julio de 2025  
**Versión del documento**: 1.0
