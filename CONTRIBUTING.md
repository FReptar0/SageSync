# Guía de Contribución

¡Gracias por tu interés en contribuir a SageSync! Esta guía te ayudará a entender cómo puedes participar en el desarrollo de este proyecto comercial.

## ⚠️ Importante: Proyecto Comercial

**SageSync es un software comercial propietario.** Antes de contribuir, es esencial que entiendas las implicaciones:

- El código está protegido por una licencia comercial restrictiva
- Las contribuciones requieren autorización previa
- Se requiere un Acuerdo de Licencia de Contribuyente (CLA)
- No se acepta código sin autorización expresa

## 🔐 Proceso de Autorización

### Antes de Contribuir

1. **Contacto Inicial**
   - Email: [fmemije00@gmail.com](mailto:fmemije00@gmail.com)
   - Asunto: `[CONTRIBUTING] SageSync - Solicitud de Contribución`
   - Incluye: Descripción de tu propuesta de contribución

2. **Información Requerida**
   - Tu experiencia técnica relevante
   - Descripción detallada de la contribución propuesta
   - Motivación para contribuir
   - Disponibilidad de tiempo

3. **Acuerdo de Contribuyente**
   - Firma de CLA (Contributor License Agreement)
   - Términos de confidencialidad cuando sea aplicable
   - Acuerdo sobre propiedad intelectual

## 📋 Tipos de Contribuciones Aceptadas

### ✅ Contribuciones Bienvenidas

- **Reportes de Bugs**: Problemas verificables con pasos de reproducción
- **Mejoras de Documentación**: Correcciones, aclaraciones, ejemplos
- **Sugerencias de Features**: Ideas bien fundamentadas y alineadas con el roadmap
- **Optimizaciones de Performance**: Mejoras medibles y probadas
- **Mejoras de Seguridad**: Fortalecimiento de aspectos de seguridad

### ❌ Contribuciones No Aceptadas

- Cambios arquitecturales mayores sin aprobación previa
- Features que cambien la dirección del producto
- Código que introduzca dependencias problemáticas
- Modificaciones que comprometan la seguridad
- Trabajos derivados sin licencia apropiada

## 🛠 Proceso de Desarrollo

### 1. Setup del Entorno

```bash
# Clonar el repositorio (solo con autorización)
git clone <authorized-repo-url>
cd SageSync

# Instalar dependencias
npm install

# Configurar entorno de desarrollo
cp .env.example .env
# Editar .env con tus credenciales de desarrollo
```

### 2. Branching Strategy

```bash
# Crear rama para tu contribución
git checkout -b feature/descripcion-breve

# O para fixes
git checkout -b fix/descripcion-del-problema
```

### 3. Desarrollo

#### Estándares de Código

```javascript
// ✅ Correcto - Comentarios claros
/**
 * Sincroniza inventario desde Sage300 a Fracttal
 * @param {Array} items - Items de inventario de Sage300
 * @returns {Promise<Object>} Resumen de la sincronización
 */
async function syncInventory(items) {
    // Implementación...
}

// ✅ Correcto - Manejo de errores
try {
    const result = await fracttalClient.updateItem(itemData);
    logger.info('Item actualizado exitosamente', { itemCode: result.code });
} catch (error) {
    logger.error('Error actualizando item', { 
        itemCode: itemData.code, 
        error: error.message 
    });
    throw error;
}
```

#### Requisitos de Calidad

- **Cobertura de Tests**: Mínimo 80% para código nuevo
- **Documentación**: JSDoc para funciones públicas
- **Logging**: Usar el sistema de logging existente
- **Validación**: Validar todas las entradas
- **Seguridad**: No hardcodear credenciales

### 4. Testing

```bash
# Ejecutar todos los tests
npm test

# Tests específicos
npm run test:fracttal
npm run test:sage

# Coverage
npm run test:coverage

# Tests de integración (requiere credenciales válidas)
npm run test:integration
```

### 5. Documentación

- Actualizar README.md si es necesario
- Documentar cambios en configuración
- Actualizar comentarios de código
- Incluir ejemplos cuando sea apropiado

## 📝 Proceso de Pull Request

### 1. Preparación

```bash
# Asegurar que el código esté actualizado
git fetch origin
git rebase origin/main

# Ejecutar tests finales
npm test
npm run maintenance
```

### 2. Commit Messages

```bash
# ✅ Formato correcto
git commit -m "feat: agregar validación de códigos de item

- Implementa validación de formato para códigos de item
- Agrega tests para casos edge
- Actualiza documentación de API

Closes #123"

# ✅ Tipos de commit válidos
feat:     # Nueva funcionalidad
fix:      # Corrección de bug
docs:     # Cambios en documentación
style:    # Cambios de formato (sin afectar lógica)
refactor: # Refactoring de código
test:     # Agregar o modificar tests
chore:    # Tareas de mantenimiento
```

### 3. Pull Request

- **Título**: Descripción clara y concisa
- **Descripción**: Explicación detallada de los cambios
- **Testing**: Evidencia de que el código funciona
- **Breaking Changes**: Documentar cambios que rompan compatibilidad

## 🔍 Review Process

### Criterios de Aprobación

1. **Funcionalidad**
   - El código funciona según especificaciones
   - No introduce regresiones
   - Cumple con los requisitos de performance

2. **Calidad**
   - Sigue estándares de código establecidos
   - Incluye tests apropiados
   - Documentación adecuada

3. **Seguridad**
   - No introduce vulnerabilidades
   - Maneja datos sensibles apropiadamente
   - Sigue mejores prácticas de seguridad

4. **Compatibilidad**
   - Compatible con versiones soportadas
   - No rompe APIs existentes sin justificación

### Timeline

- **Review Inicial**: 3-5 días hábiles
- **Feedback**: Dentro de 2 días hábiles después del review
- **Re-review**: 1-2 días hábiles después de correcciones
- **Merge**: 1 día hábil después de aprobación final

## 🐛 Reportar Issues

### Bug Reports

Use la siguiente plantilla:

```markdown
## Descripción del Bug
Descripción clara y concisa del problema.

## Pasos para Reproducir
1. Vaya a '...'
2. Haga click en '....'
3. Desplácese hacia abajo hasta '....'
4. Vea el error

## Comportamiento Esperado
Descripción clara de lo que esperaba que pasara.

## Comportamiento Actual
Descripción de lo que realmente pasó.

## Capturas de Pantalla
Si es aplicable, agregue capturas de pantalla.

## Ambiente
- OS: [e.g. Windows 10, macOS 12.0]
- Node.js: [e.g. 16.14.0]
- SageSync: [e.g. 1.0.2]
- Sage300: [e.g. 2022]

## Logs

```mardown
Incluir logs relevantes aquí
```

## Información Adicional

```markdown
Cualquier otra información sobre el problema.
```

### Feature Requests

```markdown
## Resumen del Feature
Descripción breve del feature solicitado.

## Motivación
¿Por qué es necesario este feature? ¿Qué problema resuelve?

## Descripción Detallada
Descripción detallada de cómo debería funcionar.

```markdown
## Resumen del Feature
Descripción breve del feature solicitado.

## Motivación
¿Por qué es necesario este feature? ¿Qué problema resuelve?

## Descripción Detallada
Descripción detallada de cómo debería funcionar.

## Casos de Uso
Ejemplos específicos de cómo se usaría.

## Alternativas Consideradas
¿Qué otras opciones consideró?

## Impacto
¿Cómo afectaría a usuarios existentes?
```

## 📞 Contacto y Soporte

### Para Contribuyentes

- **Email**: [fmemije00@gmail.com](mailto:fmemije00@gmail.com)
- **Asunto**: `[CONTRIBUTING] SageSync - Su consulta`
- **Respuesta**: 48-72 horas (días hábiles)

### Recursos Útiles

- [Documentación Técnica](README.md)
- [Política de Seguridad](SECURITY.md)
- [Código de Conducta](CODE_OF_CONDUCT.md)
- [Licencia Comercial](LICENSE)

## 🏆 Reconocimientos

Los contribuyentes aprobados serán reconocidos en:

- Archivo CONTRIBUTORS.md
- Release notes relevantes
- Documentación del proyecto (cuando sea apropiado)

---

**Gracias por tu interés en mejorar SageSync!**

Tu contribución ayuda a hacer este proyecto mejor para toda la comunidad de usuarios de Sage300 y Fracttal.

---

**Última actualización**: 23 de julio de 2025  
**Versión**: 1.0
