# 🧪 Tests Manuales - SageSync

Tests manuales para validar la API de Fracttal con logs detallados.

## 📋 Tests Disponibles

### 1. **test-api-with-logs.js** - Test Completo con Logs Detallados

Ejecuta un test completo de todos los endpoints de Fracttal mostrando:
- ✅ Respuestas exitosas con estructura completa
- ❌ Errores detallados con códigos de estado
- 📊 Resumen final de resultados
- 💾 Archivo JSON con resultados guardados en `/logs`

**Ejecutar:**
```bash
npm run test:api
# o directamente:
node tests/manual/test-api-with-logs.js
```

**Endpoints probados:**
1. **Autenticación** - `POST /oauth/token`
2. **Almacenes** - `GET /warehouses`
3. **Items** - `GET /items`
4. **Item específico** - `GET /items/{code}`

**Salida:**
- Logs detallados en consola con emojis y formato
- Archivo JSON en `logs/test-api-results-{timestamp}.json`

### 2. **test-credentials.js** - Validación de Credenciales

Test simple para verificar que las credenciales de Fracttal funcionan.

**Ejecutar:**
```bash
npm run test:credentials
# o directamente:
node tests/manual/test-credentials.js
```

## 📊 Estructura de Resultados

El archivo JSON generado contiene:

```json
{
  "authentication": {
    "success": true,
    "token": "eyJ...",
    "tokenLength": 227,
    "expiry": "2025-12-18T20:41:08.645Z",
    "hasRefreshToken": true
  },
  "warehouses": {
    "success": false,
    "error": "Endpoint no autorizado: /warehouses",
    "isUnauthorizedEndpoint": true
  },
  "items": {
    "success": true,
    "statusResponse": true,
    "total": 150,
    "dataCount": 5,
    "firstItem": {
      "id": 12345,
      "code": "ITEM001",
      "field_1": "Nombre del item",
      "id_type_item": 4,
      "active": true,
      "hasWarehouses": true
    }
  }
}
```

## 🔍 Interpretación de Resultados

### ✅ Autenticación Exitosa
```
✅ RESULTADO:
   • Token obtenido: SÍ
   • Longitud del token: 227 caracteres
   • Expira: 2025-12-18T20:41:08.645Z
   • Tiene refresh token: SÍ
```

### ❌ Endpoint No Autorizado
```
🚫 ENDPOINT NO AUTORIZADO: /warehouses
💡 Este endpoint no está disponible con las credenciales actuales
📞 Contacta a Fracttal para habilitar el módulo necesario

❌ ERROR:
   • Mensaje: Endpoint no autorizado: /warehouses
   • Es endpoint no autorizado: true
```

**Solución:** Tu cuenta de Fracttal no tiene habilitado el módulo de Almacenes o Items. Contacta a soporte de Fracttal.

### ✅ Endpoint Exitoso
```
✅ RESULTADO:
   • Respuesta exitosa: true
   • Total de items: 150
   • Items en respuesta: 5
   • Primer item:
     - ID: 12345
     - Código: ITEM001
     - Nombre (field_1): Repuesto XYZ
```

## 🚀 Otros Tests Disponibles

### Tests Unitarios
```bash
npm run test:fracttal  # Tests del cliente Fracttal
npm run test:sage      # Tests del servicio Sage
npm test              # Todos los tests
npm run test:coverage # Tests con cobertura
```

## 📝 Agregar Nuevos Tests

Para agregar un nuevo test manual:

1. Crea el archivo en `tests/manual/test-nombre.js`
2. Usa la estructura de `test-api-with-logs.js` como referencia
3. Agrega el script en `package.json`:
   ```json
   "test:nombre": "node tests/manual/test-nombre.js"
   ```

## 💡 Tips

- Los resultados se guardan automáticamente en `/logs` con timestamp
- Usa los logs JSON para debugging o reportar issues
- Los tests manuales NO requieren la base de datos Sage
- Solo requieren las credenciales de Fracttal en `.env`

## 🔗 Enlaces Útiles

- [Documentación API Fracttal](https://api.fracttal.com/reference)
- [Colección Postman](../../postman/README.md)
