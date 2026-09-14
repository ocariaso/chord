#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p server/data

COMPOSE_FILES=(-f docker-compose.yml)
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  echo "NVIDIA GPU detected — building with CUDA support."
  COMPOSE_FILES+=(-f docker-compose.gpu.yml)
else
  echo "No NVIDIA GPU detected — building CPU-only (slower stem separation)."
fi

docker compose "${COMPOSE_FILES[@]}" up -d --build --remove-orphans

echo
echo "CHORD is running at http://localhost:${PORT:-8080}"
echo "Stop it with ./scripts/stop.sh"
