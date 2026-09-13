# Map: repository root

```
chord/
├── README.md
├── LICENSE
├── .gitignore
├── .gitattributes
├── docker-compose.yml
├── docker-compose.gpu.yml
├── scripts/
│   ├── start.sh
│   ├── stop.sh
│   ├── start.cmd
│   └── stop.cmd
├── server/          → server.md
├── web/             → web.md
└── docs/            → this documentation
```

---

### `README.md` — project front page
**Notes:** name and expansion (Component Harmony & Orchestral Retrieval Decoder), a screenshot,
the two-command quick start, and a folder-structure tree. The tree names `server/` and `web/`
and must be updated if either is renamed again.

### `LICENSE` — MIT.

### `.gitignore`
**Notes:** ignores `.claude/` **except** `.claude/skills/`, which is negated so project skills
are version-controlled. Also `.scratch/`, `server/.venv/`, `server/data/`, Python caches,
`.env*`, `web/node_modules/`, `web/dist/`. The `server/data/` entry is what keeps every job
artifact and the SQLite database out of git.

### `.gitattributes`
**Notes:** `* text=auto eol=lf`, plus `*.png` and `*.ico` as binary. LF normalization matters
because the `.sh` files in [`scripts/`](../../scripts/) and
[`server/scripts/patch_madmom.sh`](../../server/scripts/patch_madmom.sh) are shell scripts that
break with CRLF line endings. `*.cmd` is the one exception, checked out as CRLF: cmd.exe
misparses batch files with LF endings (labels and `goto` in particular).

---

### `docker-compose.yml` — the base stack
**Notes:** `name: chord` pins the project name. Two services:

- **`server`** — build context `./server`, `image: chord-server`,
  `container_name: chord-server`, build arg `TORCH_INDEX_URL` (defaults to the CPU wheel index),
  env `DEVICE` (defaults `cpu`), bind mount `./server/data:/app/data`, `expose: 8000` (**not**
  published), `restart: unless-stopped`.
- **`web`** — build context `./web`, `image: chord-web`, `container_name: chord-web`,
  `ports: ${PORT:-8080}:80`, `depends_on: [server]`, `restart: unless-stopped`.

`depends_on` is start-order only — there is no healthcheck, so early `/api` requests can 502.
The bind mount is the only persistent state.
**See:** [../operations/docker.md](../operations/docker.md)

### `docker-compose.gpu.yml` — CUDA overlay
**Notes:** overrides the `server` service only: build arg `TORCH_INDEX_URL` → the cu124 wheel
index, `DEVICE: cuda`, and a `deploy.resources.reservations.devices` entry claiming all NVIDIA
GPUs. Applied by `start.sh` when `nvidia-smi` both exists and runs. Because the wheel index is a
**build** argument, switching CPU↔GPU requires a rebuild.

---

### `scripts/start.sh` — bring the stack up
**Notes:** `cd`s to the repo root relative to `BASH_SOURCE`, so it works from anywhere. Probes
for a GPU by both locating *and* successfully running `nvidia-smi`, appends the GPU overlay if
so, then `docker compose … up -d --build --remove-orphans`. Always rebuilds (the layer cache
makes a no-op fast, and it prevents running a stale image). Prints the URL, using
`${PORT:-8080}`.

### `scripts/stop.sh` — bring it down
**Notes:** `docker compose down --remove-orphans`. Does **not** delete `server/data` — that's a
bind mount, not a volume, so `down -v` wouldn't either. See
[../data/retention.md](../data/retention.md#cleaning-up).

Both `.sh` scripts are marked executable in git (mode 100755).

### `scripts/start.cmd` — Windows counterpart of `start.sh`
**Notes:** the same steps in batch: `cd /d "%~dp0.."` to the repo root, the same two-part
`nvidia-smi` probe, the same `docker compose … up -d --build --remove-orphans`, the same URL.
Batch rather than PowerShell because the default execution policy refuses an unsigned `.ps1`.
Messages use `-` instead of `—` and avoid parentheses, which would end the `if (…)` block they
sit in. `PORT` is read from the environment (`$env:PORT = 9000` in PowerShell). Must be kept in
step with `start.sh` by hand.

### `scripts/stop.cmd` — Windows counterpart of `stop.sh`
**Notes:** `docker compose down --remove-orphans` from the repo root.
