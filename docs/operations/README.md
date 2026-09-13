# Operations

Running, building and debugging CHORD.

| Page | Covers |
| --- | --- |
| [docker.md](docker.md) | the Compose setup, images, containers, the GPU overlay, the helper scripts |
| [configuration.md](configuration.md) | every environment variable and build argument |
| [local-development.md](local-development.md) | running server and web directly, without Docker |
| [troubleshooting.md](troubleshooting.md) | known failure modes and their causes |

## The short version

```bash
./scripts/start.sh     # detects an NVIDIA GPU, builds, and brings both services up
./scripts/stop.sh      # docker compose down --remove-orphans
```

Then open **http://localhost:8080**.

## What runs

| Compose service | Image | Container | Published |
| --- | --- | --- | --- |
| `web` | `chord-web` | `chord-web` | `${PORT:-8080}` → 80 |
| `server` | `chord-server` | `chord-server` | nothing — `expose: 8000` only |

The Compose project is named `chord` (`name: chord` in
[`docker-compose.yml`](../../docker-compose.yml)), so it doesn't depend on the directory name.

Only nginx is reachable from the host. The server is reachable from the web container by the
service DNS name `server`, which is what
[`nginx.conf`](../../web/nginx.conf) proxies to:

```nginx
location /api/ { proxy_pass http://server:8000/; }
```

## Requirements

- **Docker** with Compose v2 (`docker compose`, not `docker-compose`).
- For the GPU path: an NVIDIA driver, `nvidia-smi` on `PATH`, and the NVIDIA Container Toolkit.
  Without them everything still works on CPU, several times slower.
- Disk: the server image, which carries torch and the Demucs weights, plus ~250 MB of stems per
  four-minute song being worked on (~830 MB for a twelve-minute track at 48 kHz).
- **A browser on a secure origin** for every feature. Pitch-preserving speed runs in an
  AudioWorklet, which browsers expose only over HTTPS or on `localhost`; reached over plain HTTP
  by LAN address, everything else works and the speed control is disabled. The tab also holds all
  six decoded stems — about half a gigabyte for a four-minute song.

## First run

Expect the first image build to be slow: it compiles madmom from source (`--no-build-isolation`,
plus a patch step), installs torch and downloads the `htdemucs_6s` weights into the image. Docker's
layer cache makes later builds fast, and the first job downloads nothing.
