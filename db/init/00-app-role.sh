#!/bin/sh
set -eu

mot_de_passe="${DB_APP_PASSWORD:-courtier_app_local}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=mot_de_passe="$mot_de_passe" <<-'SQL'
SELECT format(
  'CREATE ROLE courtier_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'mot_de_passe'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'courtier_app') \gexec
ALTER ROLE courtier_app WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL
