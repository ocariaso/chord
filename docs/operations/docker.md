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
- **The only persistent state is the bind mount** `./server/data:/app/data` — database and job
  artifacts. The Demucs weights are in the image, not here. See
  [../data/README.md](../data/README.md).

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
  the CPU one. Changing it requires a **rebuild**; a restart isn't enough.
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
ARG DEMUCS_MODEL=htdemucs_6s
ENV HF_HOME=/opt/models/huggingface DEMUCS_MODEL=${DEMUCS_MODEL}
RUN python -c "from demucs.hf import get_hf_model; get_hf_model('${DEMUCS_MODEL}')"
ENV HF_HUB_OFFLINE=1
COPY app app
RUN groupadd -g 1000 chord && useradd -u 1000 -g chord -m chord && chown -R chord:chord /app
USER chord
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- **Python 3.10** is pinned by madmom's compatibility ceiling, not by preference.
- Layer order is deliberate: system packages, then torch (huge, rarely changes), then
  requirements, then madmom, then the Demucs weights, then application code last — so an edit to
  `app/` rebuilds only the final layers.
- **madmom is installed separately** from `requirements.txt` and then patched in place. Full
  explanation: [../architecture/server.md](../architecture/server.md#the-madmom-problem).
- **The Demucs weights are baked in.** demucs 4.1 downloads a named model from the Hugging Face
  Hub into `HF_HOME`, which isn't on the data volume, so left to the first job the weights were
  fetched again after every rebuild — with an *unauthenticated requests to the HF Hub* warning
  each time. The build fetches them into `/opt/models/huggingface` instead, and
  `HF_HUB_OFFLINE=1` keeps the running server off the Hub. The step calls
  `demucs.hf.get_hf_model` rather than `get_model`, because `get_model` swallows a Hub failure and
  falls back to demucs' legacy AWS repo, which would leave the build green and the image without
  weights. `DEMUCS_MODEL` is a build argument that also becomes the runtime variable, so the
  server uses the model the image carries; see
  [configuration.md](configuration.md#demucs-weights).
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

[`web/nginx.conf`](../../web/nginx.conf) does four jobs:

```nginx
location /api/ {
    client_max_body_size 512m;           # uploads: nginx's default is 1 MB

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
- **`client_max_body_size 512m`**, scoped to `/api/`, is sized for a twelve-minute lossless
  upload; nginx's 1 MB default would refuse any real audio file. A larger body gets nginx's own
  HTML 413 page and never reaches FastAPI; the web client recognizes the status and shows *"That
  file is larger than the server accepts."* The server sets no limit of its own, so any other
  proxy put in front needs an equivalent setting. See
  [troubleshooting.md](troubleshooting.md#uploads-over-512-mb-fail).

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
