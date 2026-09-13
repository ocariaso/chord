# Docker and Compose

## Files

| File | Role |
| --- | --- |
| [`docker-compose.yml`](../../docker-compose.yml) | the base stack — both services, CPU defaults |
| [`docker-compose.gpu.yml`](../../docker-compose.gpu.yml) | overlay adding CUDA and NVIDIA device reservations |
| [`server/Dockerfile`](../../server/Dockerfile) | the FastAPI image |
| [`web/Dockerfile`](../../web/Dockerfile) | multi-stage build → nginx image |
| [`scripts/start.sh`](../../scripts/start.sh) | picks the overlay and brings the stack up |
| [`scripts/stop.sh`](../../scripts/stop.sh) | brings it down |

## The base stack

```yaml
name: chord

services:
  server:
    build:
      context: ./server
      args:
        TORCH_INDEX_URL: ${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}
    image: chord-server
    container_name: chord-server
    environment:
      DEVICE: ${DEVICE:-cpu}
    volumes:
      - ./server/data:/app/data
    expose:
      - "8000"
    restart: unless-stopped

  web:
    build:
      context: ./web
    image: chord-web
    container_name: chord-web
    ports:
      - "${PORT:-8080}:80"
    depends_on:
      - server
    restart: unless-stopped
```

Points worth noting:

- **`name: chord`** pins the Compose project name, so resource names don't change if the
  checkout directory is renamed.
- **`expose`, not `ports`, on the server.** It's reachable only on the Compose network, under
  the DNS name `server` — which is exactly the hostname nginx proxies to. To reach FastAPI's
  `/docs` from the host you'd add a temporary `ports: ["8000:8000"]`, or go through the proxy at
  `http://localhost:8080/api/docs`.
- **`depends_on` is start-order only**, not readiness. nginx starts before uvicorn is listening;
  early requests to `/api` get a 502 until the server is up. There is no healthcheck.
- **The only persistent state is the bind mount** `./server/data:/app/data` — database, job
  artifacts and the Demucs weights cache. See [../data/README.md](../data/README.md).

## The GPU overlay

```yaml
services:
  server:
    build:
      args:
        TORCH_INDEX_URL: https://download.pytorch.org/whl/cu124
    environment:
      DEVICE: cuda
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

It changes two things at once, and the distinction matters:

- **`TORCH_INDEX_URL` is a build argument** — it selects the CUDA 12.4 torch wheel instead of
  the CPU one. Changing it requires a **rebuild**, not just a restart.
- **`DEVICE` is runtime** — it tells [`separation.py`](../../server/app/pipeline/separation.py)
  to ask for CUDA. That module falls back to CPU if `torch.cuda.is_available()` is false, so a
  CUDA-built image on a machine with no visible GPU degrades rather than crashing.

## `start.sh`

```bash
COMPOSE_FILES=(-f docker-compose.yml)
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  echo "NVIDIA GPU detected — building with CUDA support."
  COMPOSE_FILES+=(-f docker-compose.gpu.yml)
else
  echo "No NVIDIA GPU detected — building CPU-only (slower stem separation)."
fi
docker compose "${COMPOSE_FILES[@]}" up -d --build --remove-orphans
```

It probes for a GPU by both *finding* `nvidia-smi` and *running* it successfully — a driver can
be installed but non-functional. `cd "$(dirname "${BASH_SOURCE[0]}")/.."` first, so it works
from any directory.

`--build` on every invocation: Docker's layer cache makes a no-change rebuild fast, and it means
you can never accidentally run a stale image. `--remove-orphans` cleans up containers from
renamed or removed services.

To force the CPU path on a GPU machine, invoke Compose directly:

```bash
docker compose -f docker-compose.yml up -d --build
```

## Images

### `server/Dockerfile`

```dockerfile
FROM python:3.10-slim
RUN apt-get install ffmpeg build-essential pkg-config libopus-dev
WORKDIR /app
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install torch torchaudio --extra-index-url ${TORCH_INDEX_URL}
COPY requirements.txt . && RUN pip install -r requirements.txt
RUN pip install cython wheel && pip install madmom --no-build-isolation
COPY scripts/patch_madmom.sh … && RUN bash scripts/patch_madmom.sh
COPY app app
RUN groupadd -g 1000 chord && useradd -u 1000 -g chord -m chord && chown -R chord:chord /app
USER chord
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- **Python 3.10** is pinned by madmom's compatibility ceiling, not by preference.
- Layer order is deliberate: system packages, then torch (huge, rarely changes), then
  requirements, then madmom, then application code last — so an edit to `app/` rebuilds only the
  final layers.
- **madmom is installed separately** from `requirements.txt` and then patched in place. Full
  explanation: [../architecture/server.md](../architecture/server.md#the-madmom-problem).
- `ffmpeg` is a runtime dependency (yt-dlp, cover-art extraction, ffprobe metadata, librosa
  decoding). `build-essential` / `pkg-config` / `libopus-dev` serve madmom's C extensions and the
  audio stack.
- **Runs as non-root `chord` (uid/gid 1000).** The host's `./server/data` must be writable by
  uid 1000 — the most common first-run failure.

### `web/Dockerfile`

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build          # tsc -b && vite build
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Standard two-stage build. `npm ci` runs before the source copy so a code change doesn't
reinstall dependencies. Because `npm run build` includes `tsc -b`, **a type error fails the image
build** — the type check is not skippable in the Docker path.

## nginx

[`web/nginx.conf`](../../web/nginx.conf) does three jobs:

```nginx
location /api/ {
    proxy_pass http://server:8000/;      # trailing slash strips the /api prefix
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_http_version 1.1;

    proxy_buffering off;                 # SSE: deliver events as they arrive
    proxy_set_header Connection "";      # SSE: don't send "close"
    proxy_read_timeout 1h;               # SSE: survive a long separation
}

location / { try_files $uri $uri/ /index.html; }   # SPA fallback
```

- The **trailing slash** on `proxy_pass` is what maps `/api/jobs/…` to the server's `/jobs/…`.
  Removing it would break every route.
- The three SSE directives are all required. Without `proxy_buffering off` the progress stream
  arrives in one lump at the end; without the timeout it drops mid-separation.
- `client_max_body_size` is **not set**, so nginx's 1 MB default applies to uploads through the
  proxy. See [troubleshooting.md](troubleshooting.md#uploads-fail-with-413).

## Common commands

```bash
docker compose logs -f server          # follow the pipeline's logs
docker compose logs -f web
docker compose ps
docker compose exec server bash        # poke around inside (as the chord user)
docker compose up -d --build server    # rebuild one service
docker compose down --remove-orphans   # stop everything
docker compose down -v                 # ...and named volumes (there are none; the bind mount stays)
```

Note `down -v` does **not** delete `server/data` — it's a bind mount, not a volume. To reset
state, see [../data/retention.md](../data/retention.md#cleaning-up).

## Changing the published port

`PORT` is read by Compose, not by the app:

```bash
PORT=9000 ./scripts/start.sh
```

Or put it in a `.env` beside `docker-compose.yml`. Nothing inside either container knows about
it — nginx always listens on 80.
