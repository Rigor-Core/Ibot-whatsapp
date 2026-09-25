📘 Guía de Uso de Dipisik API
Dipisik es una API compatible con OpenAI que permite interactuar con DeepSeek Web usando un pool rotativo de cuentas, failover automático, soporte para DeepThink, búsqueda web en tiempo real y subida de archivos/imágenes sin límites de base64.
---
🌐 Información General
URL Base: `https://dipisik.rigorcore.com`
Endpoint Principal: `POST /v1/chat/completions`
Autenticación: Cabecera `Authorization: Bearer <API_KEY>`
---
🔑 Autenticación
Todas las solicitudes a `/v1/chat/completions` y a los endpoints de gestión requieren tu API Key maestra en la cabecera:
```http
Authorization: Bearer TU_API_KEY
```
---
🚀 Modelos Disponibles
Puedes seleccionar el modo cambiando el parámetro `"model"` en el body:
Modelo	Descripción
`deepseek-chat`	Respuesta estándar rápida (DeepSeek-V3)
`deepseek-reasoner`	Activa DeepThink (pensamiento profundo paso a paso)
`deepseek-search`	Activa Búsqueda Web en tiempo real
---
💻 Ejemplos Prácticos de Integración
1. Petición Estándar (cURL)
```bash
curl -X POST https://dipisik.rigorcore.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_API_KEY" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      { "role": "user", "content": "Explica la teoría de la relatividad en 2 párrafos." }
    ]
  }'
```
---
2. Respuesta en Tiempo Real (Streaming / SSE)
Al enviar `"stream": true`, recibes el texto token por token en tiempo real:
```bash
curl -N -X POST https://dipisik.rigorcore.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_API_KEY" \
  -d '{
    "model": "deepseek-chat",
    "stream": true,
    "messages": [
      { "role": "user", "content": "Escribe un poema sobre el espacio." }
    ]
  }'
```
---
3. Subir Imágenes y Documentos (Multipart / Binario - Recomendado)
Envía archivos directamente desde tu disco (PDFs, imágenes, etc.) sin convertirlos a base64. El servidor los procesa y limpia el almacenamiento automáticamente:
```bash
curl -X POST https://dipisik.rigorcore.com/v1/chat/completions \
  -H "Authorization: Bearer TU_API_KEY" \
  -F "files=@/ruta/a/tu/comprobante.jpeg" \
  -F "messages=[{\"role\":\"user\",\"content\":\"Extrae el monto y el número de referencia de este comprobante.\"}]" \
  -F "model=deepseek-chat"
```
> **Nota:** Puedes adjuntar hasta 50 archivos por solicitud (máx. 100MB cada uno).
---
4. Uso con Imágenes en Base64 (Compatible con OpenAI Vision)
Si utilizas librerías que generan formato OpenAI Vision:
```json
{
  "model": "deepseek-chat",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "¿Qué se observa en esta imagen?" },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
          }
        }
      ]
    }
  ]
}
```
---
5. Integración en JavaScript / Node.js
```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://dipisik.rigorcore.com/v1",
  apiKey: "TU_API_KEY",
});

async function consultar() {
  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    messages: [{ role: "user", content: "Hola, ¿cómo estás?" }],
  });

  console.log(response.choices[0].message.content);
}

consultar();
```
---
6. Integración en Python
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://dipisik.rigorcore.com/v1",
    api_key="TU_API_KEY"
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "user", "content": "¿Cuál es la capital de Venezuela?"}
    ]
)

print(response.choices[0].message.content)
```
---
🔍 Monitoreo y Estado del Sistema
Comprobar Estado del Servicio (Health Check)
No requiere clave API:
```bash
curl https://dipisik.rigorcore.com/health
```
Respuesta esperada:
```json
{
  "ok": true,
  "status": {
    "totalAccounts": 4,
    "queueLength": 0,
    "gapMs": 6000,
    "accounts": [
      { "id": "acc_1", "status": "IDLE" },
      { "id": "acc_2", "status": "IDLE" }
    ]
  }
}
```
---
🛡️ Características de Resiliencia
Rotación Inteligente (Round-Robin): Las peticiones se distribuyen de forma equitativa entre todas las cuentas activas.
Failover Automático e Invisible: Si una cuenta encuentra un error temporal o límite de mensajes, el servidor reintenta inmediatamente con la siguiente cuenta sin que tu aplicación reciba un error.
Protección de Cuentas (Cooldown y GAP): Respeta intervalos mínimos entre consultas para evitar bloqueos por uso abusivo.