#!/usr/bin/env bash
# Copia de seguridad completa de wick notes (notas, usuarios, tokens…).
#
#   scripts/backup.sh [carpeta] [--keep N]
#
#   carpeta   Dónde guardar el respaldo (por defecto: ./backups)
#   --keep N  Conserva solo los N respaldos más recientes de esa carpeta
#
# Ejemplo para cron (cada noche a las 3:30, conservando 14):
#   30 3 * * *  cd /ruta/a/wick-notes && scripts/backup.sh /srv/backups/wick --keep 14
#
# Se puede ejecutar con todo en marcha: pg_dump hace una foto coherente.
# Lo escrito en los últimos segundos que el servidor de colaboración aún no
# haya guardado (como mucho 10 s) no entra en el respaldo.
set -euo pipefail
cd "$(dirname "$0")/.."

# Permite apuntar a otro proyecto de Compose, p. ej. COMPOSE="docker compose -p otro".
COMPOSE=${COMPOSE:-docker compose}

dir="backups"
keep=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) keep="${2:?--keep necesita un número}"; shift 2 ;;
    --keep=*) keep="${1#--keep=}"; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Opción desconocida: $1" >&2; exit 2 ;;
    *) dir="$1"; shift ;;
  esac
done
if [[ -n "$keep" && ! "$keep" =~ ^[1-9][0-9]*$ ]]; then echo "--keep debe ser un número positivo" >&2; exit 2; fi

if ! $COMPOSE exec -T postgres pg_isready -q >/dev/null 2>&1; then
  echo "PostgreSQL no está en marcha. Arráncalo con: $COMPOSE up -d postgres" >&2
  exit 1
fi

mkdir -p "$dir"
file="$dir/wick-notes-$(date +%Y%m%d-%H%M%S).dump"
partial="$file.partial"
trap 'rm -f "$partial"' EXIT

$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' > "$partial"

# Solo se da por bueno un respaldo que PostgreSQL puede leer.
if ! $COMPOSE exec -T postgres pg_restore --list < "$partial" > /dev/null; then
  echo "El respaldo generado no es válido; no se ha guardado." >&2
  exit 1
fi
mv "$partial" "$file"
trap - EXIT

counts=$($COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F" " -c "SELECT (SELECT count(*) FROM \"Document\"), (SELECT count(*) FROM \"User\")"' 2>/dev/null || echo "? ?")
read -r notes users <<< "$counts"
size=$(du -h "$file" | cut -f1)
echo "Respaldo guardado: $file ($size · $notes notas · $users usuarios)"

if [[ -n "$keep" ]]; then
  # Los más recientes primero; se borra a partir del N+1.
  mapfile -t old < <(ls -1t "$dir"/wick-notes-*.dump 2>/dev/null | tail -n +$((keep + 1)))
  for f in "${old[@]}"; do rm -f -- "$f" && echo "Borrado respaldo antiguo: $f"; done
fi
