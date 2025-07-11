# 🚀 Guía Rápida de Deploy - Render.com

## ⚡ Deploy en 5 minutos

### 1. Preparar repositorio
```bash
# Asegúrate de que todos los archivos estén committeados
git add .
git commit -m "Migración a Render.com completada"
git push origin main
```

### 2. Crear servicio en Render
1. Ve a [dashboard.render.com](https://dashboard.render.com)
2. **"New +"** → **"Background Worker"**
3. Conecta GitHub y selecciona tu repo
4. **Build Command:** `npm install`
5. **Start Command:** `npm start`

### 3. Configurar variables de entorno
En la sección **Environment** agrega:

```bash
# OBLIGATORIAS
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-clave-anonima

# OPCIONALES
OPENAI_API_KEY=sk-tu-clave-openai
ENABLE_EMBEDDINGS=true
TRIBUNAL=Corte_Suprema
START_DATE=01/01/2024
END_DATE=31/12/2024
MAX_SENTENCIAS=100
DELAY_BETWEEN_REQUESTS=2000
DEBUG=false
```

### 4. Deploy
Clic en **"Create Background Worker"**

## 🔧 Configuración de Supabase

### Ejecutar SQL
1. Ve a tu proyecto Supabase
2. **SQL Editor** → **New Query**
3. Copia y ejecuta el contenido de `schema.sql`

## ✅ Verificar funcionamiento

1. Ve a la pestaña **"Logs"** en Render
2. Deberías ver:
```
[INFO] Inicializando scraper para Render.com...
[INFO] Supabase inicializado correctamente
[INFO] Scraper inicializado correctamente para Render.com
```

## 🐛 Troubleshooting

### Error: "Supabase no inicializado"
- Verificar `SUPABASE_URL` y `SUPABASE_ANON_KEY`
- Confirmar que la tabla `jurisprudencia_cs` existe

### Error: "Puppeteer timeout"
- Aumentar `DELAY_BETWEEN_REQUESTS` a 5000
- Verificar conectividad de red

### Error: "Build failed"
- Verificar que `package.json` existe
- Confirmar que `main.js` es el punto de entrada

## 📊 Monitoreo

- **Logs en tiempo real:** Pestaña "Logs" en Render
- **Estadísticas:** Al finalizar el scraper
- **Base de datos:** Tabla `jurisprudencia_cs` en Supabase

## 🔄 Programación

Para ejecutar periódicamente:
1. **Cron Job:** Cambiar a "Cron Job" en lugar de "Background Worker"
2. **Schedule:** `0 2 * * *` (diario a las 2 AM)

---

**¡Listo! Tu scraper está funcionando en Render.com** 🎉 