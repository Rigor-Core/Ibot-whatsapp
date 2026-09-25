# Ibot v2

Bot de WhatsApp construido con Node.js, Express, MongoDB y Baileys. Cada usuario tiene su cuenta en el panel y vincula a ella su propio WhatsApp mediante QR. El administrador gestiona el sistema desde un panel separado.

## Roles

| Rol | Panel | Qué puede hacer |
| --- | --- | --- |
| **Administrador** (`owner`) | `/admin.html` | Ver estadísticas, crear/suspender/eliminar usuarios, cambiar contraseñas, controlar las conexiones de WhatsApp, asignar cuentas sin dueño y editar los ajustes del sistema. No vincula WhatsApp. |
| **Usuario** (`account`) | `/` | Vincular su WhatsApp, configurar grupos, respuestas, modos, comandos, contactos y mensajes programados. No tiene acceso al panel de administración. |

Cada rol es redirigido a su propio panel y la API lo respeta: `/api/bot/*` es solo para usuarios y `/api/admin/*` solo para administradores.

## Funciones

- Cuenta por usuario con su propio WhatsApp vinculado (se crea automáticamente la primera vez que el usuario entra a su panel).
- Modos principales (exclusivos):
  - `repartidor`: responde al instante los pedidos de los grupos activos. Mantiene en caché los dispositivos de los participantes y precalienta las sesiones de cifrado para que la primera respuesta tras un rato sin actividad no espere consultas a WhatsApp.
  - `normal`: solo comandos de grupo, bienvenidas y despedidas.
  - `watch`: solo observa y guarda los mensajes de los grupos.
  - `ia`: responde con IA por WhatsApp. El usuario elige cuándo: desactivada, a todos los mensajes, con un comando (`/chat ...`) o cuando el mensaje contiene un texto específico. Con Dipisik cada usuario tiene su propio profile automático. Proveedores: Dipisik (con profile dedicado), DeepSeek, OpenAI, Z.ai, Gemini, Groq, OpenRouter y, si el administrador lo permite, cualquier endpoint compatible con OpenAI. Las claves de los usuarios se guardan cifradas.
- Gestión y monitoreo de grupos.
- Directorio de contactos agrupado por grupo y contactos externos de Watch.
- Mensajes programados persistentes con zona horaria configurable.
- Comandos administrativos independientes por grupo: `help`, `status`, `ban`, `demote`, `group` y `promote`.
- Permisos de comandos por nivel de WhatsApp: user, admin y owner.
- Mensajes configurables de bienvenida y despedida.
- Consola y chats observados en tiempo real; Inicio y Grupos se actualizan solos (sin recargar) cuando cambia el estado del WhatsApp, los contadores o los grupos.
- Notificaciones push (Web Push estándar con VAPID, sin Firebase): WhatsApp desconectado o sesión cerrada, QR pendiente, pedido tomado, grupo en su límite y mensaje programado fallido. Cada usuario elige cuáles recibe desde Configuración. Requieren HTTPS; en iPhone hay que agregar el panel a la pantalla de inicio (iOS 16.4+).
- Panel de administración con gráficas de respuestas, mensajes observados, nuevos usuarios, estado de conexiones y mensajes programados.

## Requisitos

- Node.js 20.18 o superior.
- MongoDB. Se recomienda un replica set (por ejemplo MongoDB Atlas) para que los cambios del panel lleguen al bot al instante; sin replica set funciona por polling cada 5 segundos.
- pnpm 11 (la configuración de pnpm vive en `pnpm-workspace.yaml`).

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
DIPISIK_API_KEY=
DIPISIK_BASE_URL=https://dipisik.rigorcore.com/v1
```

`PANEL_ALLOW_PUBLIC_REGISTRATION` es solo el valor inicial: el administrador puede abrir o cerrar el registro público desde **Configuración** en su panel, junto con la zona horaria predeterminada y el límite de usuarios.

## Ejecución

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm start
```

## Uso

1. La primera vez, `register.html` crea al **administrador** (o usa `pnpm create:admin`).
2. El administrador crea los usuarios desde **Usuarios → Nuevo usuario** (o abre el registro público).
3. Cada usuario inicia sesión, enciende su WhatsApp desde Inicio y escanea el QR.
4. El usuario configura sus grupos, respuestas y modos principales.
5. Configura la zona horaria en Configuración.
6. Activa y define permisos en Comandos.
7. Habilita los comandos dentro de cada grupo y personaliza su prefijo, bienvenida y despedida.

Los comandos y los eventos de bienvenida/despedida son independientes del modo principal. Si el sistema global de comandos o el comando del grupo está desactivado, también quedan desactivados los mensajes de bienvenida y despedida de ese grupo.

Para el modo IA con Dipisik configura `DIPISIK_API_KEY` (y opcionalmente `DIPISIK_BASE_URL`, por ejemplo `http://127.0.0.1:9040/v1` si corre en el mismo VPS) en el `.env` del servidor; nunca en el repositorio. El administrador decide si los usuarios pueden usar esa clave compartida. Para los demás proveedores cada usuario escribe su propia API key en Configuración. Modelos de Dipisik: `deepseek-chat`, `deepseek-reasoner` y `deepseek-search`.

## Cuentas de WhatsApp sin dueño

Si un WhatsApp quedó vinculado a una cuenta que no pertenece a ningún usuario (por ejemplo, el que usaba el administrador antes de separar los paneles), sigue funcionando con su configuración y aparece en **Conexiones WhatsApp** con el botón **Asignar**. También se puede asignar al crear un usuario nuevo. La asignación transfiere la sesión, los grupos y la configuración sin borrar nada.

## Seguridad

- Contraseñas con PBKDF2 (600 000 iteraciones) y cookie de sesión firmada `HttpOnly`.
- Protección CSRF (double submit cookie) en todas las peticiones que modifican datos.
- Cambiar la contraseña o suspender a un usuario cierra todas sus sesiones abiertas.
- Límite estricto de intentos en login y registro.
