# wick notes

*Your notes. Your server. Your knowledge.*

Base de conocimiento en Markdown, autoalojada y colaborativa. La visión completa
está en [PRODUCT.md](PRODUCT.md).

> **Estado:** en desarrollo. Ya hay usuarios con inicio de sesión, y se pueden
> crear, renombrar y eliminar notas y editarlas entre varias personas en tiempo
> real, con guardado automático. Todas las personas con cuenta ven y editan todas
> las notas (los espacios de trabajo y permisos por nota llegarán después).

## Instalación (Docker Compose)

Requisitos: Docker con Compose v2.

```bash
git clone <repository-url>
cd wick-notes
cp .env.example .env
# Edita .env y cambia como mínimo POSTGRES_PASSWORD (y DATABASE_URL si vas a desarrollar).
docker compose up -d
```

Abre <http://localhost:3120>. La primera vez verás un asistente para crear la
cuenta de **administrador**. Haz ese paso nada más instalar: cualquiera que
llegue antes a la página podría crearla. Después, el administrador da de alta al
resto de personas desde **Usuarios** (menú de tu nombre, abajo a la izquierda).

`docker compose up -d` construye la imagen, arranca PostgreSQL, aplica las
migraciones pendientes (servicio `migrate`) y levanta la web y el servidor de
colaboración. Los datos viven en el volumen `postgres-data`.

| Servicio   | Qué hace                                   | Puerto por defecto        |
|------------|--------------------------------------------|---------------------------|
| `web`      | Interfaz web y API (Nuxt)                   | `127.0.0.1:3120`          |
| `collab`   | Colaboración en tiempo real (WebSocket)     | `127.0.0.1:3121`          |
| `postgres` | Base de datos                               | `127.0.0.1:5433`          |
| `migrate`  | Aplica migraciones y termina                | —                         |

> Usa una contraseña sin caracteres especiales de URL (`@ : / ? #`) en
> `POSTGRES_PASSWORD`, o codifícala, porque forma parte de `DATABASE_URL`.
> `openssl rand -hex 24` genera una válida.

### Actualizar

```bash
git pull
docker compose up -d --build
```

Las migraciones se aplican solas y nunca borran datos. `docker compose down`
conserva los datos; **`docker compose down -v` los elimina**.

### Acceso desde la red

Por defecto la web y la colaboración solo escuchan en la propia máquina. Para
usarlas desde otros equipos de tu red, en `.env`:

```bash
BIND_ADDRESS=0.0.0.0
```

El navegador se conecta al WebSocket en el mismo host que la web y el puerto
`COLLAB_PORT`, y se autentica con la misma cookie de sesión. Por eso web y
colaboración deben servirse **bajo el mismo nombre de host** (cualquier puerto).

Con un proxy inverso delante (HTTPS):

- Indica la URL del WebSocket en `NUXT_PUBLIC_COLLAB_URL`, en el mismo dominio
  que la web (por ejemplo `wss://notas.midominio.lan/collab`).
- Pon `NUXT_TRUST_PROXY=true` para que se usen la IP real del cliente (límite de
  intentos de login) y el esquema HTTPS (cookie `Secure`). Sin proxy, déjalo en
  `false`: si no, cualquiera podría falsear su IP con cabeceras.

### Usuarios y seguridad

- Las cuentas las crea un administrador. No hay registro abierto.
- Las contraseñas se guardan con `scrypt` (sal aleatoria) y piden al menos 10 caracteres.
- La sesión es una cookie `httpOnly` y `SameSite=Lax`, válida 30 días desde el
  último uso. En la base de datos solo se guarda su hash.
- Tras 8 intentos fallidos de login para un usuario desde la misma IP, se
  bloquea ese origen 15 minutos.
- Las cuentas no se borran: se desactivan (se cierran sus sesiones y sus notas
  se conservan). Restablecer o cambiar una contraseña también cierra las demás sesiones.

## Desarrollo

Requisitos: Node 24 y pnpm 12.

```bash
cp .env.example .env              # y ajusta las contraseñas
docker compose up -d postgres     # solo la base de datos
pnpm install
pnpm db:deploy                    # aplica migraciones
pnpm dev                          # web en :3120 y colaboración en :3121 (solo localhost,
                                  # o la interfaz de DEV_HOST en .env)
```

| Comando           | Para qué                                                     |
|-------------------|--------------------------------------------------------------|
| `pnpm dev`        | Web + colaboración con recarga en caliente                   |
| `pnpm test`       | Tests de `core` y de colaboración (usan la BD `<nombre>_test`) |
| `pnpm typecheck`  | Comprobación de tipos de todo el monorepo                    |
| `pnpm db:migrate` | Crea una migración nueva tras cambiar `schema.prisma`        |

### Estructura

```
apps/
  web/       Nuxt 4 + Nuxt UI: interfaz y API REST (/api/documents)
  collab/    Servidor Hocuspocus: sincroniza y guarda el estado Yjs
packages/
  core/      Reglas de negocio. Web, colaboración (y en el futuro CLI y MCP) pasan por aquí
  db/        Esquema Prisma, migraciones y cliente de PostgreSQL
```

El contenido de cada nota se guarda como estado **Yjs** (la fuente de verdad
durante la edición). El servidor de colaboración lo guarda con 2 s de
inactividad, como mucho cada 10 s mientras se escribe, y siempre al apagarse.

### API

Todas las rutas exigen sesión salvo `/api/health` y `/api/auth/*`. Las
peticiones que modifican datos desde un navegador deben venir del mismo origen.

| Método   | Ruta                   | Descripción                          |
|----------|------------------------|--------------------------------------|
| `GET`    | `/api/auth/state`      | ¿Falta crear el admin? ¿Quién soy?   |
| `POST`   | `/api/auth/setup`      | Crea el primer admin (solo sin usuarios) |
| `POST`   | `/api/auth/login`      | `{ username, password }` → cookie de sesión |
| `POST`   | `/api/auth/logout`     | Cierra la sesión actual              |
| `POST`   | `/api/auth/password`   | Cambia la contraseña propia          |
| `GET`    | `/api/users`           | Lista usuarios (admin)               |
| `POST`   | `/api/users`           | Crea un usuario (admin)              |
| `PATCH`  | `/api/users/:id`       | Nombre, rol o desactivar (admin)     |
| `POST`   | `/api/users/:id/password` | Restablece la contraseña (admin)  |
| `GET`    | `/api/documents`       | Lista, de la más reciente a la más antigua |
| `POST`   | `/api/documents`       | Crea (`{ "title"?: string }`)        |
| `GET`    | `/api/documents/:id`   | Metadatos de una nota                |
| `PATCH`  | `/api/documents/:id`   | Renombra (`{ "title": string }`)     |
| `DELETE` | `/api/documents/:id`   | Elimina                              |

## Licencia

Pendiente de definir.
