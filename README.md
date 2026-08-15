# ⚡ CHATTAIKO

## Despliegue seguro en Render

### Paso 1: Subir a GitHub (SIN claves)

Este repositorio solo contiene código. **Nunca** subas un archivo `.env` con claves reales.

```bash
git init
git add .
git commit -m "CHATTAIKO v1"
git push origin main
```

El `.gitignore` ya evita que se suban:
- `.env` (claves secretas)
- `*.db` (base de datos)
- `node_modules/`

### Paso 2: Crear Web Service en Render

1. Ve a [render.com](https://render.com) → **New** → **Web Service**
2. Conecta tu repositorio de GitHub
3. Configura:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free

### Paso 3: Añadir Environment Variables (🔒 SECRETAS)

En Render, ve a **Environment** y añade:

| Variable | Valor |
|---|---|
| `JWT_SECRET` | `tu-frase-super-larga-y-aleatoria-32-caracteres-minimo` |
| `ADMIN_PASSWORD` | `tu-password-admin` |
| `GROQ_API_KEY` | `gsk_...` (si tienes) |
| `GEMINI_API_KEY` | `AIzaSy...` (si tienes) |
| `MISTRAL_API_KEY` | `...` (si tienes) |

> **IMPORTANTE**: Estas variables **nunca** se guardan en GitHub. Solo existen en Render.

### Paso 4: Deploy

Render descarga tu código desde GitHub, instala dependencias, y ejecuta el servidor con tus claves secretas inyectadas.

---

## ¿Por qué NO eliminar el backend?

Si conviertes CHATTAIKO en una PWA estática:
- ❌ No hay registro/login de usuarios
- ❌ No se generan API keys
- ❌ No hay orquestador multi-API
- ❌ Los usuarios no pueden chatear con IA
- ❌ Es solo una página web bonita sin funcionalidad

El backend es necesario para que CHATTAIKO funcione como servicio.

---

## APIs soportadas

Groq · Cerebras · Mistral AI · Google Gemini · SiliconFlow · Together AI · xAI Grok · OpenRouter

Añade las que tengas en las Environment Variables de Render.

---

## Seguridad implementada

- ✅ JWT_SECRET obligatorio (servidor no arranca sin él)
- ✅ Admin con JWT propio (no texto plano)
- ✅ API keys separadas de tokens JWT
- ✅ CORS restringido
- ✅ Fallback entre proveedores
- ✅ Rate limiting
- ✅ Body limitado a 1MB
- ✅ Validación de status HTTP
- ✅ Manejo de errores en todas las queries

---
CHATTAIKO © 2026
