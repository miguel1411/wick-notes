# wick notes

*Your notes. Your server. Your knowledge.*

Base de conocimiento en Markdown, autoalojada y colaborativa. La visión completa
está en [PRODUCT.md](PRODUCT.md).

> **Estado:** en desarrollo, con todas las funciones básicas de PRODUCT.md:
> notas Markdown colaborativas en tiempo real, espacios de trabajo con
> permisos, carpetas, búsqueda, historial, CLI, MCP y respaldos.

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

Si vienes de una versión con el editor anterior (Milkdown), o restauras un
respaldo de entonces, las notas deben convertirse una vez al formato actual
(texto Markdown). El servidor de colaboración avisa al arrancar si encuentra
alguna. Para convertirlas, haz un respaldo (`scripts/backup.sh`), arranca una
vez la versión `c1cbd76` (`git checkout c1cbd76 && docker compose up -d --build`)
hasta ver «migración al editor Markdown: … convertidas» en
`docker compose logs collab`, y vuelve a la actual (`git checkout main`).

### Respaldos

```bash
scripts/backup.sh                          # → backups/wick-notes-AAAAMMDD-HHMMSS.dump
scripts/backup.sh /srv/backups/wick --keep 14
scripts/restore.sh backups/wick-notes-….dump
```

- El respaldo es la base de datos completa (`pg_dump`): notas con todo su
  estado, usuarios y tokens. Se puede hacer con todo en marcha; solo quedan
  fuera los últimos segundos que el servidor de colaboración aún no haya guardado.
- Un respaldo solo se da por bueno si PostgreSQL puede leerlo. `--keep N` borra
  los más antiguos de esa carpeta. Para hacerlo cada noche con cron:
  `30 3 * * *  cd /ruta/a/wick-notes && scripts/backup.sh /srv/backups/wick --keep 14`
- `restore.sh` **reemplaza todos los datos**. Antes guarda el estado actual en
  `backups/antes-de-restaurar/`, para la web y la colaboración y restaura en una
  sola transacción (si falla, no cambia nada). Después aplica migraciones y
  cierra todas las sesiones, para que ningún navegador abierto vuelva a subir su
  versión de las notas.
- Guarda los respaldos **fuera de este servidor**. La carpeta `backups/` está en
  `.gitignore`.
- Para una copia portable en Markdown (sin usuarios ni historial):
  `wick notes export --all -o carpeta`.

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

### Espacios de trabajo, carpetas y permisos

Las notas viven en **espacios de trabajo** (selector arriba en la barra lateral)
y, dentro de ellos, en **carpetas** anidadas.

| Rol en el espacio | Puede |
|-------------------|-------|
| Propietario       | Todo lo de editor, y cambiar nombre, miembros y borrar el espacio |
| Editor            | Leer, crear, editar, mover y borrar notas y carpetas |
| Solo lectura      | Leer (el editor no deja escribir y el servidor descarta cualquier cambio) |

- El espacio **General** es *para todos*: cualquier persona con cuenta, también
  las nuevas, es editora. Al actualizar desde una versión sin espacios, todas
  las notas pasan a General, así que nadie pierde acceso a nada.
- Cualquiera puede crear espacios (empiezan privados: solo quien los crea) e
  invitar a otras personas desde *Ajustes del espacio*. Un espacio privado y sus
  notas no aparecen para nadie más: ni en la lista, ni en la búsqueda, ni por la
  API, la CLI o MCP. Los administradores de la instancia ven todos.
- Mover una nota a otro espacio cambia quién puede verla.
- Borrar una carpeta no borra notas: su contenido pasa a la carpeta superior.
  Un espacio solo se puede borrar vacío.

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
| `pnpm wick …`     | La CLI desde el código fuente                                |
| `pnpm build`      | Compila la web y la CLI                                      |
| `pnpm test`       | Tests de `core` y de colaboración (usan la BD `<nombre>_test`) |
| `pnpm typecheck`  | Comprobación de tipos de todo el monorepo                    |
| `pnpm db:migrate` | Crea una migración nueva tras cambiar `schema.prisma`        |

### Estructura

```
apps/
  web/       Nuxt 4 + Nuxt UI: interfaz y API REST (/api/documents)
  collab/    Servidor Hocuspocus: sincroniza y guarda el estado Yjs
  cli/       CLI `wick` (un único fichero sin dependencias: dist/wick.mjs)
packages/
  core/      Reglas de negocio. Web, colaboración (y en el futuro CLI y MCP) pasan por aquí
  db/        Esquema Prisma, migraciones y cliente de PostgreSQL
```

### Búsqueda

Botón **Buscar** de la barra lateral o `Ctrl+K` / `⌘K`. Busca en títulos y
contenido; aparecen las notas que contienen **todas** las palabras, sin
distinguir mayúsculas, tildes ni guiones («wifi» encuentra «Wi-Fi»). Primero las
que coinciden en el título, y cada resultado muestra un fragmento.

El índice se actualiza cada vez que se guarda una nota (pocos segundos después
de escribir). Las notas anteriores a la búsqueda se indexan solas al arrancar
el servidor de colaboración. Está pensado para equipos pequeños (miles de
notas) y no necesita extensiones de PostgreSQL.

### Historial de versiones

Menú «…» de la nota → **Historial**. Se guarda una versión:

- mientras se edita, como mucho una cada 10 minutos y solo si el contenido cambió;
- siempre antes de que la API, la CLI o un agente **reemplacen** el contenido;
- siempre antes de **restaurar** otra versión;
- cuando alguien pulsa *Guardar versión ahora*.

Restaurar devuelve el contenido y el título a como estaban, y llega en vivo a
quien tenga la nota abierta. Nunca se pierde nada: lo actual queda antes en el
historial. Se conservan las 100 versiones más recientes de cada nota. Los
agentes (MCP) pueden consultar el historial pero no restaurar: esa decisión es
de una persona (`wick notes restore` o la web).

### Tokens de API

Para usar wick notes desde la terminal, agentes de IA o scripts, crea un token
en **Mi cuenta → Tokens de acceso** y envíalo como cabecera:

```bash
curl -H "Authorization: Bearer wick_…" http://localhost:3120/api/documents
```

- **Solo lectura** (listar, leer) o **lectura y escritura** (también crear,
  modificar y borrar notas). Actúan con la identidad de quien los crea.
- Solo sirven para la API de notas (`/api/documents…`, `/api/workspaces…`,
  `/api/folders…`) y `/api/auth/state`, y siempre con los permisos de su dueño:
  con un token no se gestionan usuarios, contraseñas ni otros tokens.
- Caducidad opcional; se revocan al momento desde la misma pantalla. Si se
  desactiva la cuenta, sus tokens dejan de funcionar. Solo se guarda su hash.

### CLI (`wick`)

Tus notas desde cualquier terminal (macOS, Linux, Windows; requiere Node 20+).
La propia instancia sirve la CLI ya empaquetada, sin npm ni internet:

```bash
curl -fsSL http://servidor:3120/cli/wick.mjs -o ~/.local/bin/wick && chmod +x ~/.local/bin/wick
wick login --server http://servidor:3120 --token wick_…   # token de Mi cuenta → Tokens de acceso
```

```bash
wick workspaces                         # tus espacios y tu rol
wick tree                               # árbol de espacios, carpetas y notas (-w espacio, --ids)
wick notes list                         # recientes primero (-w espacio, --json para scripts)
wick notes search postgres réplica      # en títulos y contenido, con fragmento
wick notes get "red de casa"            # por id, principio del id o título
wick notes create "Nueva nota" "texto"  # o -f nota.md, o -f - para leer de stdin
wick notes edit backups                 # abre $VISUAL/$EDITOR; lo que otros escriban mientras tanto se conserva
journalctl -n 50 | wick notes append "Incidencias" -f -
wick notes replace red "DNS: 1.1.1.1" "DNS: 9.9.9.9"   # cambia un fragmento sin abrir el editor ("" lo borra)
wick notes export --all -o ./copia      # un .md por nota, con `# Título`
wick notes export backups --pdf         # la nota en PDF (también con --all)
wick notes import *.md
wick notes from-photo pag1.jpg pag2.jpg -i "para el examen"   # nota desde fotos (IA, si está activada)
wick notes history backups              # versiones; con un id de versión, su contenido
wick notes restore backups cmx1…        # lo actual queda en el historial
```

Al crear un token, la web muestra estos comandos ya rellenados. En Windows,
descarga `wick.mjs` y ejecútalo con `node wick.mjs …`. La configuración se guarda
en `~/.config/wick-notes/config.json` (permisos 600); también se pueden usar las
variables `WICK_SERVER` y `WICK_TOKEN`. Desde el repositorio: `pnpm wick notes list`.

### MCP para agentes de IA

La instancia es un servidor [MCP](https://modelcontextprotocol.io) en `/mcp`
(Streamable HTTP), autenticado con un token de API:

```bash
claude mcp add --transport http wick http://servidor:3120/mcp \
  --header "Authorization: Bearer wick_…"
# o, para clientes que solo lanzan procesos locales (usa la config de `wick login`):
claude mcp add wick -- wick mcp
```

| Herramienta     | Qué hace                                               | Token  |
|-----------------|--------------------------------------------------------|--------|
| `notes_list`    | Lista notas recientes (opcional: de un espacio)        | lectura |
| `notes_search`  | Busca en títulos y contenido, con fragmentos           | lectura |
| `notes_read`    | Lee una nota (por id o título) en Markdown, con su revisión | lectura |
| `notes_create`  | Crea una nota (opcional: en un espacio)                | escritura |
| `notes_append`  | Añade al final de una nota                             | escritura |
| `notes_edit`    | Cambia fragmentos concretos (buscar → sustituir) sin tocar el resto | escritura |
| `notes_update`  | Reescribe una nota entera (con la revisión leída) y/o la renombra | escritura |
| `notes_history` | Versiones de una nota, o el contenido de una           | lectura |
| `notes_tree`    | Árbol completo: espacios, carpetas anidadas y notas    | lectura |
| `notes_move`    | **Propone** mover una nota a una carpeta o espacio (no la mueve) | escritura |
| `notes_move_requests` | Estado de las solicitudes de movimiento          | lectura |

Con un token de solo lectura, el agente no ve las herramientas de escritura.

**Mover notas siempre requiere tu aprobación.** `notes_move` solo crea una
solicitud; en la barra lateral de wick notes aparece «N movimientos por aprobar»
y en esa página apruebas o rechazas cada una (o todas). Aprobar solo es posible
con sesión de navegador: un token, y por tanto un agente, no puede aprobar sus
propias solicitudes. Al aprobar se vuelven a comprobar tus permisos.
Lo que escribe un agente aparece al momento en el editor de quien tenga la nota
abierta, **sin pisar lo que esa persona esté escribiendo**:

- `notes_edit` y `notes_append` solo tocan su fragmento o el final. Si el
  fragmento ya no está (alguien lo cambió), no se cambia nada y el agente vuelve
  a leer la nota.
- `notes_update` exige la revisión que dio `notes_read`. El cambio se calcula
  sobre lo que el agente leyó y se une con lo que otras personas escribieron
  mientras tanto (como dos personas escribiendo a la vez), en lugar de
  borrarlo. Si escriben en el mismo punto, el texto de la persona queda delante.

### Nota desde foto (IA, opcional)

Convierte fotos de **apuntes escritos a mano** (cuaderno, hojas, pizarrón) en una
nota limpia y estructurada. Viene **desactivada**: wick funciona igual sin IA.

- **Activarla:** menú de usuario → *Inteligencia artificial* (solo
  administradores). Ahí se elige el proveedor (en esta versión, Anthropic), se
  guarda la clave de API (botón *Probar conexión*), el modelo
  (`claude-opus-5-5` por defecto), si se permite investigar en internet, las
  búsquedas máximas por nota y cuántas notas con IA puede crear cada usuario al
  día. Los cambios se aplican al momento.
- **Usarla:** botón de la cámara junto a *Nueva nota* (o
  `wick notes from-photo`). De 1 a 4 fotos del mismo tema forman una nota; en
  el celular se pueden tomar ahí mismo, también por HTTP. Opcionalmente:
  investigar en internet e indicaciones («es para el examen»).
- **Qué hace:** comprueba que las fotos estén escritas a mano (si una no lo está,
  avisa y no crea nada), las transcribe sin inventar (`[ilegible]` donde no se
  lee), busca notas relacionadas tuyas, investiga si se lo pides y redacta la
  nota. Lo que añade o corrige la IA va marcado (`> **Ampliación (IA):**`,
  `> **Corrección (IA):**`) y con su fuente; añade diagramas Mermaid cuando
  ayudan. La nota queda en la raíz de una carpeta con tu nombre en el espacio
  actual (se crea si no existe; si la renombras o la mueves, se sigue usando).
- **Privacidad:** antes de enviar, un aviso dice a qué proveedor van las fotos.
  Se envían las fotos, tus indicaciones y el título y un fragmento de hasta 5
  notas relacionadas. Las fotos no se guardan en ningún sitio (ni disco, ni base
  de datos, ni logs).
- **Clave de API:** se guarda cifrada (AES-256-GCM) con una clave maestra que
  sale de `WICK_SECRET_KEY` o, si no está definida, de `DATABASE_URL`. Si cambia,
  hay que volver a escribir la clave en la web.
- **Costo y límites:** del orden de 0,20–0,50 USD por nota con investigación.
  Cada uso queda registrado (tokens y búsquedas, sin contenido). El límite diario
  cuenta las notas creadas; además, cada usuario tiene como mucho el triple de
  intentos al día (rechazados o fallidos incluidos). Fotos: JPEG, PNG o WebP, hasta
  5 MB cada una (la web las reduce sola; con la CLI, redúcelas antes si pesan más).
- **Seguridad:** las notas relacionadas salen solo del espacio donde se crea la
  nota, y las imágenes que proponga el modelo quedan como enlaces (no se cargan).

### Editor

Se escribe Markdown con vista previa en vivo (CodeMirror 6):
los símbolos (`##`, `**`, `[texto](url)`, `>`…) se ocultan y el texto se ve con
formato; donde está el cursor reaparecen y se corrigen como texto normal. Los
títulos de una línea se ven con su tamaño mientras se escriben.

- Listas: Enter continúa la lista (o la cita, o la tarea); Enter en un elemento
  vacío la termina. `Tab` / `Shift+Tab` sangran.
- Tareas `- [ ]`: la casilla se marca con un clic.
- Enlaces: `Ctrl`/`⌘` + clic los abre en otra pestaña.
- Atajos: `Ctrl+B` negrita, `Ctrl+I` cursiva, `Ctrl+E` código, `Ctrl+Shift+X`
  tachado, `Ctrl+K` enlace. Pegar una URL con texto seleccionado crea un enlace.
- Deshacer (`Ctrl+Z`) solo deshace lo propio, no lo que escriben los demás.
- Imágenes `![descripción](https://…)`: se ven en la nota; con el cursor encima
  reaparece su Markdown. Solo se cargan URLs `http(s)`, sin enviar la dirección de
  la nota (`Referer`). No se suben imágenes: se enlazan las que ya están en la web.
- Tablas: se ven como tabla (con la alineación de cada columna); un clic en una
  celda pone ahí el cursor y la tabla vuelve a su Markdown para editarla. El
  ancho de las columnas sale de los guiones de la segunda fila (como en Pandoc):
  con `|--|------|` la segunda columna ocupa el triple que la primera y la tabla
  todo el ancho; con los mismos guiones en todas, se ajusta al contenido. El PDF
  respeta los mismos anchos.
- Diagramas: un bloque ` ```mermaid ` se dibuja como diagrama
  ([Mermaid](https://mermaid.js.org): flujo, secuencia, mapa mental…); con el
  cursor dentro se edita su código. Si tiene un error, se indica en qué línea.
  La librería solo se descarga al abrir una nota con diagramas. En el PDF, por
  ahora, el diagrama sale como su código.
- Ayuda: `?` muestra todos los atajos de teclado; el menú «…» de la nota abre la
  guía de Markdown (con buscador), que se puede tener abierta mientras se escribe.

Las fórmulas se ven, por ahora, como su Markdown.

### Markdown

Cada nota **es** su texto Markdown (CommonMark + GFM: tablas, tareas, tachado).
No hay conversión: lo que se escribe es lo que se guarda, se exporta y leen la
CLI y los agentes, carácter por carácter.

- **Exportar:** menú «…» de la nota → *Descargar Markdown*. El fichero empieza
  por `# Título`.
- **PDF:** menú «…» de la nota → *Descargar PDF* (o `GET /api/documents/:id/pdf`,
  `wick notes export <nota> --pdf`). Lo genera el propio servidor con
  [Typst](https://typst.app), sin navegador ni internet, y con sus fuentes
  incluidas. Las imágenes quedan como enlace (no se descargan) y los emojis no
  se ven. Tamaño de página: `NUXT_PDF_PAPER=a4` (por defecto) o `us-letter`.
- **Importar:** botón junto a *Nueva nota* (admite varios `.md`). Si el fichero
  empieza por `# Algo`, eso pasa a ser el título; si no, el nombre del fichero.
- **Escribir por la API** (`PUT /api/documents/:id/markdown`): se aplica sobre el
  documento vivo calculando diferencias. Para reescribir una nota que leíste
  antes, envía `baseRevision` con la cabecera `X-Wick-Revision` de esa lectura:
  lo que otras personas escribieron desde entonces se conserva. Las revisiones
  viven en memoria un día; si caducan (o se reinicia el servidor), la respuesta
  es `409` y hay que volver a leer. Para cambios concretos, `PATCH` con
  `{ edits: [{ find, replace }] }`.

La web habla con el servidor de colaboración por una API interna protegida con
un secreto derivado de `DATABASE_URL` (o `WICK_SERVICE_SECRET` si se define).

El contenido de cada nota se guarda como estado **Yjs** con el texto Markdown
dentro (la fuente de verdad durante la edición). El servidor de colaboración lo guarda con 2 s de
inactividad, como mucho cada 10 s mientras se escribe, y siempre al apagarse.

### API

Todas las rutas exigen sesión (cookie) o token de API (`Authorization: Bearer`),
salvo `/api/health` y `/api/auth/*`. Las peticiones que modifican datos desde un
navegador deben venir del mismo origen.

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
| `GET`    | `/api/tokens`          | Mis tokens de API (solo con sesión)  |
| `POST`   | `/api/tokens`          | `{ name, scope: "read" \| "write", expiresInDays? }` → token (una vez) |
| `DELETE` | `/api/tokens/:id`      | Revoca un token propio               |
| `GET`    | `/api/workspaces`      | Mis espacios y mi rol en cada uno     |
| `POST`   | `/api/workspaces`      | `{ name, everyone? }` (quien lo crea es propietario) |
| `PATCH`/`DELETE` | `/api/workspaces/:id` | Renombrar / *para todos* / borrar (vacío) |
| `GET`    | `/api/workspaces/:id/members` | Miembros                       |
| `PUT`/`DELETE` | `/api/workspaces/:id/members/:userId` | `{ role: "owner" \| "editor" \| "viewer" }` / quitar |
| `GET`/`POST` | `/api/workspaces/:id/folders` | Carpetas / `{ name, parentId? }` |
| `PATCH`/`DELETE` | `/api/folders/:id` | `{ name?, parentId? }` / borrar (el contenido sube) |
| `GET`    | `/api/documents`       | Lista, de la más reciente a la más antigua (`?workspace=`, `?q=` título, `?limit=`) |
| `POST`   | `/api/documents`       | Crea (`{ title?, workspaceId?, folderId? }`) |
| `GET`    | `/api/documents/:id`   | Metadatos de una nota                |
| `PATCH`  | `/api/documents/:id`   | `{ title?, workspaceId?, folderId? }` (renombrar y/o mover) |
| `DELETE` | `/api/documents/:id`   | Elimina                              |
| `GET`    | `/api/move-requests`   | Movimientos propuestos por mis agentes (`?status=pending`). Solo con sesión |
| `POST`   | `/api/move-requests/:id/approve` · `/reject` | Aprobar (mueve la nota) o rechazar. Solo con sesión |
| `GET`    | `/api/documents/search` | Búsqueda en título y contenido (`?q=`, `?limit=`) con fragmentos |
| `GET`    | `/api/documents/:id/markdown` | Contenido en Markdown (`?download=1`: fichero con `# Título`); cabecera `X-Wick-Revision` |
| `PUT`    | `/api/documents/:id/markdown` | `{ markdown, mode: "replace" \| "append", baseRevision? }` → `{ revision, merged }` |
| `PATCH`  | `/api/documents/:id/markdown` | `{ edits: [{ find, replace }] }`: cada `find` debe aparecer una vez (si no, `409`) → `{ revision }` |
| `GET`    | `/api/documents/:id/versions` | Historial de la nota |
| `POST`   | `/api/documents/:id/versions` | Guarda una versión del contenido actual |
| `GET`    | `/api/documents/:id/versions/:vid/markdown` | Contenido de una versión |
| `POST`   | `/api/documents/:id/versions/:vid/restore` | Restaura una versión (contenido y título) |
| `POST`   | `/api/documents/import` | Nota nueva desde `{ markdown, title?, filename? }` |

## Licencia

Copyright (C) 2026 Miguel Corona

wick notes es software libre con licencia [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

- Puedes usarlo, estudiarlo, modificarlo y redistribuirlo, también con fines comerciales.
- Si distribuyes una versión modificada, o la ofreces como servicio en red a otras personas, tienes que publicar su código fuente con la misma licencia.
- Se ofrece sin garantía de ningún tipo. El texto completo, en `LICENSE`, es el que vale.
