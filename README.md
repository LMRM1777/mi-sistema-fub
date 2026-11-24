# Mi Sistema FUB — v2 (reemplazo de CallAction)

Sistema propio de Lake Michigan Realty: números de rastreo por fuente, drips de texto con frenos, y textos/llamadas registrados en Follow Up Boss.

## Cómo funciona
1. **Arrancar una campaña:** en FUB le pones al lead el tag de la campaña (ej. `drip-llamada`). FUB avisa al servidor y el lead queda inscrito.
2. **Antes de cada texto** el servidor revisa, y si algo falla **no manda**:
   - pidió STOP · tiene tag de bloqueo (`AI_OPT_OUT`, `SMS_OPT_OUT`, `DNC`…) · stage de cita/cliente/cerrado
   - contestó después de inscribirse · horario permitido (9am–8pm Michigan, sin domingos; si no, se reprograma)
3. **Cuando el lead contesta:** se registra en el timeline de FUB, se frena su drip y se avisa en Slack.
4. **STOP:** se marca opt-out, se detienen todas sus campañas y se pone el tag `SMS_OPT_OUT` en FUB.
5. **CASA / HOME:** crea el lead, contesta la confirmación (español/inglés) y arranca `drip-casa`.
6. **Llamadas:** se desvían al celular configurado, se registran en FUB con la fuente del número, y una llamada perdida avisa en Slack.

## Editar sin tocar código (`config/`)
- `campaigns.json` — campañas, pasos, horarios y textos (es/en). Cada texto debe decir "Lake Michigan Realty" y "STOP" o el servidor no arranca.
- `numbers.json` — cada número de rastreo: fuente en FUB, a dónde desviar llamadas, tag opcional.
- `rules.json` — horario, tags y stages que bloquean, palabras clave.

## Campañas copiadas de CallAction
- `config/callaction-import.json` — las 41 campañas tal cual (referencia).
- `node scripts/convert-callaction.mjs 18 19` — convierte las que elijas a `campaigns.json`: agrega "Lake Michigan Realty" y STOP, y las deja **inactivas** (`"active": false`).
- Formato estilo CallAction: cada paso usa `after: {n, unit}` (tiempo **desde el paso anterior**) y `at` opcional (hora). Tipos: `texto`, `imagen`, `vcard` salen al lead; `recordatorio`, `voz`, `video`, `audio` crean una **tarea en FUB** para el agente.
- Variables soportadas: {{contact_first_name}}, {{user_first_name}}, {{user_full_name}}, {{greeting}}, {{today_day}}, {{from_N_days_ago}}, {{in_N_days}}, {{contact_in_Nmin}}, {{lead_email_address}}, {{user_company}}, {{user_website}}, {{lead_first_contact_month}}…
- Para prender una: cambia `"active": false` a `true` (el servidor revisa STOP y marca) y **apaga la misma campaña en CallAction** para no mandar doble.

## Seguridad
- `SMS_SENDING_ENABLED=false` → modo prueba: nada sale, todo se escribe en el log.
- Los números de Alex/Sofía (Vapi) NO van en este sistema.

## Webhooks a configurar
- Twilio (cada número de rastreo): Voz → `POST {BASE_URL}/webhook/twilio/voz`; el servicio de mensajes → `POST {BASE_URL}/webhook/twilio/sms`
- FUB: webhook del evento `peopleTagsCreated` → `{BASE_URL}/webhook/fub`

## Pruebas
`npm test` — 17 pruebas con FUB y Twilio simulados (no manda nada).

`legacy/` = código de mayo 2026, como referencia.
