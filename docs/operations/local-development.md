# Local development

Running the two halves directly, without Docker. Useful for the web app (instant HMR) and
occasionally necessary for the server (debugger, faster iteration on the pipeline).

> **A live inconsistency:** the Vite dev proxy targets port **8787**, but the server's documented
> and default port is **8000**. See [the port mismatch](#the-vite-proxy-port-mismatch) below
> before you start.

## Web only

The fastest loop, and enough for any UI work — point the dev server at a server running in
Docker.

```bash
cd web
npm install
npm run dev            # http://localhost:5173
```

Scripts, from [`package.json`](../../web/package.json):

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | `tsc -b && vite build` — **the type check is part of the build** |
| `npm run lint` | oxlint, then [`scripts/check-design.mjs`](../../web/scripts/check-design.mjs), which checks `src/` against the design's rules: tokens and classes the vendored stylesheets define, no new colours or fonts, only `--v`, `--l`, `--p` and `--stem` set inline, no classes defined in app CSS ([the rules](../conventions/design.md)) |
| `npm run preview` | serve the production build locally |

### The dev proxy

[`vite.config.ts`](../../web/vite.config.ts):

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8787',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
}
```

The `rewrite` mirrors what nginx's trailing-slash `proxy_pass` does in production — strip `/api`
so requests reach the server's `/jobs/…` routes. `API_BASE` in the client stays `"/api"` in
every environment.

### The Vite proxy port mismatch

`target` is `http://localhost:8787`. Nothing in this repo serves 8787:

- [`server/README.md`](../../server/README.md) documents `uvicorn … --port 8000`.
- The Dockerfile's `CMD` uses `--port 8000` and `EXPOSE 8000`.
- nginx proxies to `server:8000`.

So `npm run dev` against a server on 8000 will fail every API call with a proxy error. Pick one:

```bash
# match the proxy
uvicorn app.main:app --reload --port 8787

# or point Docker's server at the host port the proxy expects
#   (add to docker-compose.yml's server service)
#   ports: ["8787:8000"]
```

…or change `target` to `http://localhost:8000`, which is the likelier intent. This doc doesn't
assume which, because either is a real choice — be deliberate about it.

### Secure-context features

`http://localhost:5173` counts as a secure origin, so AudioWorklet — which pitch-preserving speed
runs in — and the async Clipboard API both work. Reach the dev server from another device by LAN
address (`npm run dev -- --host`) and neither does: the speed chip is disabled, and *Copy log*
falls back to a hidden textarea and `document.execCommand("copy")`. The same applies to the Docker
deployment reached by LAN address.

### The design

The UI was built from a design template that has since been removed. Its rules now live in
[../conventions/design.md](../conventions/design.md), the design standard, and the screens in
[`web/src/screens/`](../../web/src/screens/) are its reference implementation. To check a layout
change, follow [Checking a UI change](../conventions/design.md#checking-a-ui-change);
[Screens and their states](../conventions/design.md#screens-and-their-states) lists every state a
screen has to render. The original template can still be read from git history, for example
`git show "2a9783e:web/template/CHORD Template.dc.html"` or
`git show 2a9783e:web/template/template/INSTRUCTIONS.md`.

### Development-only behavior

Two things happen under `npm run dev` that a production build never does:

- **Stems download twice.** `StrictMode` runs `ResultsScreen`'s mount effect twice, so it creates a
  `PlaybackEngine`, disposes it, and creates another. Nothing aborts the first engine's fetches —
  they finish and are thrown away — so a finished job's six WAVs cross the network twice.
- **Editing code can discard the job you're watching.** The discard beacon is sent from an effect
  cleanup in `useJobEvents`, and React Fast Refresh re-runs effects when you save a module `App`
  depends on — `App.tsx` itself, or a non-component module such as `useJobEvents.ts`. A running
  job is cancelled; a finished one is deleted. Start a fresh job after such an edit.

## Server only

Heavier, because of madmom. Follow [`server/README.md`](../../server/README.md) — reproduced here
with the reasoning.

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate

# 1. torch first, matched to your CUDA driver (or the CPU index)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# 2. everything else
pip install -r requirements.txt

# 3. madmom, which cannot be a plain requirements line
sudo apt-get install -y python3.10-dev build-essential   # Python.h for its C extensions
pip install cython wheel
pip install madmom --no-build-isolation
bash scripts/patch_madmom.sh
```

Why each step:

1. **torch first, separately** — the right wheel depends on your CUDA driver, so
   `requirements.txt` deliberately doesn't pin it and carries a comment saying so.
2. **`--no-build-isolation`** — madmom's `setup.py` imports numpy and Cython at build time and
   can't declare them as build dependencies, so pip's isolated build environment fails.
3. **`patch_madmom.sh`** rewrites the *installed* package in site-packages for two breakages:
   `collections.MutableSequence` (moved in Python 3.10) and the removed `np.float`/`np.int`/etc.
   aliases (numpy 1.24+). It resolves site-packages via `sysconfig.get_paths()["purelib"]` and
   **errors out if madmom isn't on the active interpreter's path — so activate the venv first.**

Full background: [../architecture/server.md](../architecture/server.md#the-madmom-problem).

Then run it:

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000     # or 8787, per the mismatch above
```

`--reload` restarts on code changes. Remember that a restart **drops the in-memory job queue** —
any job mid-flight is orphaned in a non-terminal status, and cancelling then resuming it through
the API is the only way to run it again. See
[../data/retention.md](../data/retention.md#stale-rows).

Python 3.10 specifically: the Dockerfile pins `python:3.10-slim`, and the patch script targets
3.10's `collections` move. Newer Pythons may need additional patches.

### System dependencies

Needed on the host as well as in the image:

| Tool | Used by |
| --- | --- |
| `ffmpeg` | yt-dlp's audio extraction, cover-art extraction, thumbnail conversion, librosa decoding |
| `ffprobe` | ID3 artist tag reading ([`metadata.py`](../../server/app/pipeline/metadata.py)) |
| libsndfile | duration and format (`read_audio_info`), the source sample rate in `separation.py`, reading the vocals stem for the lyrics offset — shipped inside the `soundfile` wheel |
| a C toolchain | madmom's Cython extensions |

The ffmpeg and ffprobe paths degrade rather than crash — a missing `ffprobe` means no `author`.
libsndfile doesn't: a file it can't open fails the job, because nothing after that step can run
without a duration.

## Both, without Docker

Two terminals:

```bash
# terminal 1
cd server && source .venv/bin/activate && uvicorn app.main:app --reload --port 8787

# terminal 2
cd web && npm run dev
```

Open http://localhost:5173. CORS doesn't come into play because the Vite proxy makes the browser
see one origin — which is also why `cors_origins` defaulting to `http://localhost:5173` is
belt-and-braces rather than load-bearing.

Data lands in `server/data/` exactly as it does under Docker, so you can switch between the two
and keep your jobs. The one thing to watch: the container runs as uid 1000, so files it created
may not be writable by your user (or vice versa).

## First run is slow

Outside Docker the weights aren't baked in. The first separation downloads `htdemucs_6s` (about
53 MB) from the Hugging Face Hub into `~/.cache/huggingface` — not `server/data/models_cache/`,
which demucs uses only on its fallback path — and logs the Hub's *unauthenticated requests*
warning, which is harmless. Subsequent jobs reuse them. On CPU, expect several minutes per
four-minute track after that.

## No test suite

There are no tests in either half, and no CI. The practical verification loop is:

```bash
cd web && npm run build      # tsc -b catches type errors; vite build catches the rest
cd web && npm run lint       # oxlint, then the design check
```

and for the server, running a real job end to end. `GET /health` confirms the process is up;
`sqlite3 server/data/db.sqlite3 "SELECT status, stage_message FROM jobs ORDER BY created_at DESC LIMIT 5;"`
shows exactly what the UI would display.
