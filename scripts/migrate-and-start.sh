#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed or is not available in PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or is not available in PATH." >&2
  exit 1
fi

echo "Starting Docker Compose services..."
docker compose up -d

echo "Waiting for PostgreSQL to accept connections..."
max_attempts=30
attempt=1

until docker compose exec -T postgres pg_isready -U vida -d vida_rider >/dev/null 2>&1; do
  if (( attempt >= max_attempts )); then
    echo "Error: PostgreSQL was not ready after ${max_attempts} attempts." >&2
    docker compose logs postgres >&2
    exit 1
  fi

  sleep 2
  ((attempt += 1))
done

echo "Running database migrations..."
npm run migration:run

echo "Starting the application..."
exec npm run start:dev
