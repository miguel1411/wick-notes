# wick notes

*Your notes. Your server. Your knowledge.*

Base de conocimiento en Markdown, autoalojada y colaborativa. La visión completa
está en [PRODUCT.md](PRODUCT.md).

> **Estado:** primer paso del desarrollo. Ya se pueden crear, listar, renombrar y
> eliminar notas y editarlas entre varias personas en tiempo real, con guardado
> automático. **Todavía no hay usuarios ni login**: no expongas la instalación
> fuera de una red de confianza (ver [Acceso desde la red](#acceso-desde-la-red)).

## Instalación (Docker Compose)

Requisitos: Docker con Compose v2.

```bash
git clone <repository-url>
cd wick-notes
cp .env.example .env
# Edita .env y cambia como mínimo POSTGRES_PASSWORD (y DATABASE_URL si vas a desarrollar).
docker compose up -d
```

Abre <http://localhost:3120>.

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
`COLLAB_PORT`. Si pones un proxy inverso delante, indica la URL completa en
`NUXT_PUBLIC_COLLAB_URL` (por ejemplo `wss://notas.midominio.lan/collab`).

## Desarrollo

Requisitos: Node 24 y pnpm 12.

```bash
cp .env.example .env              # y ajusta las contraseñas
docker compose up -d postgres     # solo la base de datos
pnpm install
pnpm db:deploy                    # aplica migraciones
pnpm dev                          # web en :3120 y colaboración en :3121 (solo localhost)
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

| Método   | Ruta                   | Descripción                          |
|----------|------------------------|--------------------------------------|
| `GET`    | `/api/documents`       | Lista, de la más reciente a la más antigua |
| `POST`   | `/api/documents`       | Crea (`{ "title"?: string }`)        |
| `GET`    | `/api/documents/:id`   | Metadatos de una nota                |
| `PATCH`  | `/api/documents/:id`   | Renombra (`{ "title": string }`)     |
| `DELETE` | `/api/documents/:id`   | Elimina                              |

## Licencia

Pendiente de definir.
