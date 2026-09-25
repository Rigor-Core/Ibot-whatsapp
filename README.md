# Ibot v2

Bot de WhatsApp construido con Node.js, Express, MongoDB y Baileys. Cada usuario del panel administra exclusivamente su propio bot y vincula su propio WhatsApp mediante QR.

## Funciones

- Un bot de WhatsApp por usuario registrado.
- Registro público controlado por `PANEL_ALLOW_PUBLIC_REGISTRATION`.
- Modos principales independientes: `normal`, `watch` e `ia` con API compatible con DeepSeek.
- Gestión y monitoreo de grupos.
- Directorio de contactos agrupado por grupo y contactos externos de Watch.
- Mensajes programados persistentes con zona horaria configurable.
- Comandos administrativos independientes por grupo: `help`, `status`, `ban`, `demote`, `group` y `promote`.
- Permisos de comandos por nivel de WhatsApp: user, admin y owner.
- Mensajes configurables de bienvenida y despedida.
- Consola y chats observados en tiempo real.

## Requisitos

- Node.js 20.18 o superior.
- MongoDB.
- pnpm 11.

## Configuración

```env
PORT=4310
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=Ibotv2
PANEL_AUTH_ENABLED=true
PANEL_ALLOW_PUBLIC_REGISTRATION=false
PANEL_SECRET=cambia_este_secreto
COOKIE_SECURE=false
NODE_ENV=development
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://dipisik.rigorcore.com/v1
DEEPSEEK_MODEL=deepseek-chat
```

Cuando `PANEL_ALLOW_PUBLIC_REGISTRATION=true`, cualquier persona con acceso a la página de registro puede crear su usuario. El sistema crea automáticamente su único bot y ese usuario puede vincular su propio WhatsApp sin compartir sesiones con otros usuarios.

## Ejecución

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm start
```

## Uso

1. Crea un usuario desde `register.html` cuando el registro esté permitido.
2. Inicia sesión en el panel.
3. Desde Inicio, enciende el bot y escanea el QR con el WhatsApp que administrará ese usuario.
4. Configura los grupos, respuestas y modos principales.
5. Configura la zona horaria en Configuración.
6. Activa y define permisos en Comandos.
7. Habilita los comandos dentro de cada grupo y personaliza su prefijo, bienvenida y despedida.

Los comandos y los eventos de bienvenida/despedida son independientes del modo principal. Si el sistema global de comandos o el comando del grupo está desactivado, también quedan desactivados los mensajes de bienvenida y despedida de ese grupo.

Para usar el modo IA, configura `DEEPSEEK_API_KEY` en el entorno o ingresa la clave desde Configuración. El endpoint predeterminado usa `deepseek-chat`; también admite `deepseek-search` y `deepseek-reasoner`.
