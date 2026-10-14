#!/bin/sh
set -eu
# Railway mounts volumes after the image is built. Initialise only our directory,
# then drop privileges; never run Next.js as root or recursively chown the volume.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"
export DATABASE_PATH="${DATABASE_PATH:-/data/seo-health.db}"
case "$DATABASE_PATH" in /*) ;; *) echo 'DATABASE_PATH must be absolute in the container' >&2; exit 1 ;; esac
umask 077
db_dir="$(dirname "$DATABASE_PATH")"
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$db_dir"
  chown app "$db_dir"
  for suffix in '' -wal -shm -journal; do
    if [ -f "$DATABASE_PATH$suffix" ]; then chown app "$DATABASE_PATH$suffix"; fi
  done
  exec gosu app "$@"
fi
mkdir -p "$db_dir"
exec "$@"
