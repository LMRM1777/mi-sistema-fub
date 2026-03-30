# Mi Sistema FUB

Sistema de llamadas integrado con Follow Up Boss.
Captura llamadas entrantes/salientes via Twilio y las sincroniza en FUB automáticamente.

## Qué hace este sistema

- Recibe llamadas entrantes en tu número de Twilio
- Conecta la llamada al agente
- Graba la llamada
- Registra todo en el lead de FUB (duración, resultado, grabación)
- Crea leads nuevos si no existen en FUB
- Usa una cola para no sobrepasar el rate limit de FUB

## Estructura de archivos

```
mi-sistema-fub/
├── src/
│   ├── index.js                  ← Servidor principal (Express)
│   ├── routes/
│   │   ├── twilio.routes.js      ← Webhooks de Twilio
│   │   └── api.routes.js         ← Endpoints para tu app
│   ├── services/
│   │   ├── fub.client.js         ← Cliente HTTP para FUB
│   │   ├── fub.service.js        ← Funciones: crearLead, registrarLlamada, etc.
│   │   ├── queue.js              ← Cola de trabajos (Bull + Redis)
│   │   └── llamada.service.js    ← Iniciar llamadas salientes
│   └── workers/
│       └── fub.worker.js         ← Procesador de la cola
├── .env.example                  ← Plantilla de variables de entorno
├── .gitignore
└── package.json
```

## Configuración paso a paso

### 1. Instalar dependencias
```bash
npm install
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
# Edita .env con tus valores reales
```

### 3. Variables que necesitas llenar en .env

| Variable | Dónde conseguirla |
|---|---|
| `FUB_USER_API_KEY` | FUB → Admin → API → Create API Key |
| `FUB_SYSTEM_NAME` | El nombre que elijas para tu sistema |
| `FUB_SYSTEM_KEY` | Email a support@followupboss.com |
| `TWILIO_ACCOUNT_SID` | twilio.com → Console Dashboard |
| `TWILIO_AUTH_TOKEN` | twilio.com → Console Dashboard |
| `TWILIO_TRACKING_NUMBER` | twilio.com → Phone Numbers |
| `AGENT_PHONE_NUMBER` | Teléfono del agente que recibe llamadas |
| `REDIS_URL` | upstash.com → crear base de datos Redis |
| `BASE_URL` | URL de tu app en Railway (la obtienes después del deploy) |

### 4. Configurar Twilio

En tu número de Twilio, configura el webhook de llamadas entrantes:
```
https://tu-app.railway.app/webhook/twilio/entrante
```

### 5. Deploy en Railway

1. Sube este proyecto a GitHub
2. Ve a railway.app → New Project → GitHub Repository
3. Selecciona este repositorio
4. Agrega todas las variables del paso 3 en Railway → Variables
5. Railway despliega automáticamente

### 6. Arrancar el worker (en Railway)

El worker es un proceso separado. En Railway:
1. Ve a tu proyecto → Settings → Add Service → Worker
2. Comando de inicio: `npm run worker`
3. Agrega las mismas variables de entorno

## Endpoints disponibles

### Webhooks (Twilio los llama automáticamente)
- `POST /webhook/twilio/entrante` — Llamada entrante
- `POST /webhook/twilio/estado` — Cuando termina la llamada
- `POST /webhook/twilio/grabacion` — Cuando la grabación está lista

### API (tú los llamas)
- `GET  /api/salud` — Verificar que el servidor está activo
- `POST /api/llamar` — Iniciar llamada saliente `{ leadPhone, fubPersonId }`
- `POST /api/lead` — Crear lead en FUB `{ nombre, telefono, email, fuente }`
- `POST /api/nota` — Agregar nota `{ personId, texto }`

## Costo estimado por mes

| Servicio | Costo |
|---|---|
| Railway (servidor) | ~$5 |
| Upstash Redis (cola) | $0 gratis |
| Twilio (número) | ~$1 |
| Twilio (llamadas) | ~$0.01/min |
| **Total base** | **~$6-10/mes** |
