#!/bin/sh
# Arma una base desde cero con las migraciones y corre las pruebas de permisos.
#
# Uso: supabase/pruebas/correr.sh <url de una base vacía>
# Ejemplo: supabase/pruebas/correr.sh postgres://postgres@localhost:5432/postgres
set -e
cd "$(dirname "$0")/.."
export PGOPTIONS="-c client_min_messages=error"
sql() { psql "$1" -v ON_ERROR_STOP=1 -q -o /dev/null -f "$2"; }

sql "$1" pruebas/supabase-simulado.sql
for m in migrations/*.sql; do sql "$1" "$m"; done
sql "$1" pruebas/permisos.sql
echo "permisos: todo en orden"
