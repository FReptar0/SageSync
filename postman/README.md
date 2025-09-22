# :clipboard: Guía de Uso - Colección Postman Fracttal

## :rocket: Importación Rápida

### 1. Importar los archivos en Postman

1. Abre Postman
2. Ve a **File** → **Import**
3. Importa ambos archivos:
   - `Fracttal_Collection.json` (La colección)
   - `Fracttal_Environment.json` (Las variables de entorno)

### 2. Activar el Environment

1. En la esquina superior derecha, selecciona **"Fracttal Environment"**
2. Verifica que esté marcado como activo (icono de check verde)

## :wrench: Configuración de Variables

### Variables que DEBES configurar

#### :key: Credenciales Fracttal (Requeridas)

```env
fracttal_client_id = TU_CLIENT_ID_AQUI
fracttal_client_secret = TU_CLIENT_SECRET_AQUI
```

[!IMPORTANT] :bangbang: Usa tus credenciales reales de Fracttal.

#### :factory: URLs Preconfiguradas

```env
fracttal_base_url = https://app.fracttal.com/api
fracttal_oauth_url = https://one.fracttal.com/oauth/token
```

#### :dart: Variables Auto-gestionadas (NO tocar)

```env
fracttal_access_token = (se actualiza automáticamente)
fracttal_refresh_token = (se actualiza automáticamente)
fracttal_token_type = Bearer
fracttal_expires_in = (se actualiza automáticamente)
```

## :books: Flujo de Autenticación y Renovación

### :lock: Paso 1: Autenticación Inicial

- Este endpoint obtiene el **access_token** y **refresh_token**
- Ambos tokens se guardan automáticamente en las variables
- :clock: El access_token expira en **2 horas**

### :arrows_counterclockwise: Paso 2: Renovación Automática (Opcional)

- Usa el refresh_token para obtener un nuevo access_token
- **NO requiere credenciales** - usa el refresh_token guardado
- Se ejecuta automáticamente cuando detecta error 401
- :clock: Renueva por otras **2 horas** más

### :department_store: Paso 3: Usar las APIs

```
:department_store: Warehouses → List Warehouses
:package: Items → List Items
:bust_in_silhouette: User → Get User Profile
```

## :arrows_counterclockwise: Manejo Inteligente de Tokens

La colección incluye **scripts automáticos** que:

1. **:inbox_tray: Al autenticarse:** Guarda automáticamente access_token Y refresh_token
2. **:warning: Al expirar (401):** Te sugiere usar "Refresh Token" en lugar de reautenticarte
3. **:arrows_counterclockwise: Al renovar:** Actualiza automáticamente el access_token y extiende por 2 horas más
4. **:bar_chart: Logs informativos:** Te muestra cuándo expira y el estado de los tokens

## :rotating_light: Solución de Problemas

### :x: Error 401 "Unauthorized"

**:arrows_counterclockwise: Solución Rápida (Recomendada):**

1. Ejecuta `:lock: Authentication → Refresh Token`
2. :white_check_mark: Token renovado automáticamente por 2 horas más

**:lock: Solución Completa (Si refresh falla):**

1. Ejecuta `:lock: Authentication → OAuth Token`
2. :white_check_mark: Nueva autenticación completa

### :x: Error "UNAUTHORIZED_ENDPOINT"

**Causa:** Tu cuenta no tiene módulos de Inventario/Almacenes
**Solución:** Verificar permisos en tu cuenta Fracttal

### :x: Error "Refresh token inválido"

**Causa:** El refresh_token expiró o es inválido
**Solución:** Ejecutar OAuth Token completo nuevamente

## :memo: Variables de Ejemplo

| Variable | Valor por Defecto | Propósito |
|----------|------------------|-----------|
| `warehouse_id` | `1` | ID de almacén para pruebas |
| `item_id` | `1` | ID de item para pruebas |
| `item_code` | `TEST001` | Código de item para búsquedas |

## :dart: Endpoints Disponibles

### :lock: Autenticación

- **OAuth Token** - Autenticación completa (access + refresh tokens)
- **Refresh Token** - Renovación rápida (solo refresh token)

### :department_store: Almacenes

- **List Warehouses** - Lista todos los almacenes  
- **Get Warehouse by ID** - Obtiene almacén específico
- **Create Warehouse** - Crear nuevo almacén

### :package: Items

- **List Items** - Lista todos los items
- **Get Item by ID** - Obtiene item específico  
- **Create Item** - Crear nuevo item
- **Update Item** - Actualizar item existente

### :bust_in_silhouette: Usuario

- **Get User Profile** - Información del usuario actual

## :bulb: Tips de Productividad

1. **:lock: Autentica solo UNA vez** - El refresh token te mantiene logueado
2. **:clock: Renueva cada 2 horas** - Usa "Refresh Token" cuando veas error 401
3. **:bar_chart: Revisa la consola** - Los scripts te muestran información útil sobre tokens
4. **:arrows_counterclockwise: Flujo recomendado:** OAuth Token → Usar APIs → Refresh Token (cuando sea necesario) → Repetir

## :zap: Ventajas del Refresh Token

- **:rocket: Sin re-autenticación:** No necesitas ingresar credenciales cada 2 horas
- **:lock: Más seguro:** El access_token se renueva frecuentemente
- **:zap: Más rápido:** Renovación instantánea vs autenticación completa
- **:robot: Automático:** Los scripts te guían sobre cuándo renovar

¡Listo para usar Fracttal API sin interrupciones! :rocket:
