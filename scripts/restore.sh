#!/usr/bin/env bash
# Restaura un respaldo hecho con scripts/backup.sh. REEMPLAZA todos los datos actuales.
#
#   scripts/restore.sh <fichero.dump> [--yes]
#
# Antes de tocar nada:
#   1. Comprueba que el fichero es un respaldo válido.
#   2. Guarda un respaldo del estado actual en backups/antes-de-restaurar/.
#   3. Para la web y el servidor de colaboración (si no, podría volver a guardar
#      notas antiguas que tenga abiertas en memoria encima de lo restaurado).
# Al terminar cierra todas las sesiones, para que ningún navegador abierto vuelva
# a subir su versión de las notas (todo el mundo tiene que volver a entrar).
# Restaura en una sola transacción: si algo falla, los datos actuales quedan intactos.
# Después aplica las migraciones pendientes (por si el respaldo es de una versión
# anterior) y vuelve a arrancar los servicios.
#
# Si usas `pnpm dev`, páralo antes de restaurar.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose}

file=""
yes=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) yes=1 ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Opción desconocida: $arg" >&2; exit 2 ;;
    *) file="$arg" ;;
  esac
done
[[ -n "$file" ]] || { echo "Uso: scripts/restore.sh <fichero.dump> [--yes]" >&2; exit 2; }
[[ -r "$file" ]] || { echo "No se puede leer $file" >&2; exit 1; }

if ! $COMPOSE exec -T postgres pg_isready -q >/dev/null 2>&1; then
  echo "PostgreSQL no está en marcha. Arráncalo con: $COMPOSE up -d postgres" >&2
  exit 1
fi
if ! $COMPOSE exec -T postgres pg_restore --list < "$file" > /dev/null 2>&1; then
  echo "$file no es un respaldo válido de wick notes (formato de pg_dump)." >&2
  exit 1
fi

if [[ -z "$yes" ]]; then
  echo "Vas a REEMPLAZAR todos los datos actuales (notas, usuarios, tokens) por los de:"
  echo "  $file"
  read -r -p "Escribe «restaurar» para continuar: " answer
  [[ "$answer" == "restaurar" ]] || { echo "Cancelado."; exit 1; }
fi

echo "→ Respaldo de seguridad del estado actual…"
scripts/backup.sh backups/antes-de-restaurar

echo "→ Parando web y colaboración…"
$COMPOSE stop web collab >/dev/null 2>&1 || true

echo "→ Restaurando…"
$COMPOSE exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error' < "$file"

echo "→ Aplicando migraciones pendientes…"
if ! migrate_out=$($COMPOSE run --rm migrate 2>&1); then
  echo "$migrate_out" >&2
  echo "Las migraciones fallaron. Los datos están restaurados, pero revisa el error antes de arrancar." >&2
  exit 1
fi

# Se cierran todas las sesiones. Un navegador con una nota abierta tiene en memoria
# la versión posterior al respaldo; si pudiera reconectar, Yjs la fusionaría con la
# restaurada y deshacería la restauración. Sin sesión, vuelve al login y la descarta.
echo "→ Cerrando todas las sesiones…"
$COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -c "DELETE FROM \"Session\""'

echo "→ Arrancando servicios…"
$COMPOSE up -d web collab >/dev/null 2>&1 || true

echo "Restaurado: $file"
echo "Todas las personas tienen que volver a iniciar sesión. Los tokens de API siguen como estaban en el respaldo."
