# HTTP API

FastAPI service, documented endpoint by endpoint.

| Page | Covers |
| --- | --- |
| [jobs.md](jobs.md) | create, list, read, cancel, resume, discard, and the SSE progress stream |
| [artifacts.md](artifacts.md) | thumbnail, individual stems, the all-stems zip |
| [analysis.md](analysis.md) | chords, the lyrics lookup, and pasted lyrics |
| [contract-sync.md](contract-sync.md) | keeping the Pydantic models and the TypeScript types in agreement |

## Base paths

Every route is mounted under **`/jobs`** (there is no `/api` prefix on the server) plus a
standalone `GET /health`.

The `/api` the browser calls is added by whatever sits in front:

| Environment | Browser calls | Reaches the server as |
| --- | --- | --- |
| Docker | `/api/jobs/…` | nginx `proxy_pass http://server:8000/` strips `/api` → `/jobs/…` |
| Local dev | `/api/jobs/…` | Vite proxy rewrites `^/api` → `` → `/jobs/…` |

`API_BASE = "/api"` is a literal in [`client.ts`](../../web/src/api/client.ts); there is no
configurable host. See [../operations/local-development.md](../operations/local-development.md)
for a live discrepancy in the Vite proxy's target port.

## Conventions

- **Errors** are FastAPI's default shape, `{"detail": "message"}` — except request-validation
  failures (422), whose `detail` is a list. The client's write functions (`createJob`,
  `createJobFromUrl`, `cancelJob`, `resumeJob`, `saveLyrics`) throw an `ApiError` carrying a
  string `detail` verbatim, so every `HTTPException` message on those paths is copy the user
  reads; a list `detail` falls back to a generic *"… (status)"* message. The read functions
  (`getJob`, `getChords`, `getLyrics`) ignore `detail` and throw a generic message with the
  status.
- **A 413 comes from nginx, not FastAPI** — an HTML page with no `detail`, which `createJob`
  turns into *"That file is larger than the server accepts."* See [jobs.md](jobs.md#post-jobs).
- **202 Accepted** on both create endpoints and on resume — work is queued, not done.
- **Job ids** are `uuid4().hex` (32 lowercase hex chars).
- **Timestamps** are ISO-8601 UTC strings from `datetime.now(timezone.utc).isoformat()`, stored
  and returned as `TEXT`. The client parses them only to subtract one from another —
  `ProcessingScreen` times each stage from `updated_at` values, so the browser's clock never
  enters.
- **No authentication anywhere.** No API keys, no sessions, no per-user scoping. `GET /jobs`
  returns every job on the instance.

## Interactive docs

FastAPI generates them automatically:

| URL | What |
| --- | --- |
| `/docs` | Swagger UI |
| `/redoc` | ReDoc |
| `/openapi.json` | the OpenAPI schema |

Reachable at `http://localhost:8000/docs` when running the server directly. In the Docker
deployment the server isn't published to the host, so reach them through the proxy
(`http://localhost:8080/api/docs`) or publish port 8000 temporarily.

## Endpoint summary

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | liveness — `{"status": "ok"}` |
| `POST` | `/jobs` | [create from an uploaded file](jobs.md#post-jobs) |
| `POST` | `/jobs/from-url` | [create from a link](jobs.md#post-jobsfrom-url) |
| `GET` | `/jobs` | [list every job](jobs.md#get-jobs) |
| `GET` | `/jobs/{job_id}` | [read one job](jobs.md#get-jobsjob_id) |
| `GET` | `/jobs/{job_id}/events` | [SSE progress stream](jobs.md#get-jobsjob_idevents) |
| `POST` | `/jobs/{job_id}/cancel` | [cancel a running job](jobs.md#post-jobsjob_idcancel) |
| `POST` | `/jobs/{job_id}/resume` | [re-queue a cancelled job](jobs.md#post-jobsjob_idresume) |
| `POST` | `/jobs/{job_id}/discard` | [cancel or delete](jobs.md#post-jobsjob_iddiscard) |
| `GET` | `/jobs/{job_id}/thumbnail.jpg` | [cover art](artifacts.md#get-jobsjob_idthumbnailjpg) |
| `GET` | `/jobs/{job_id}/stems/{stem}.flac` | [one stem as stored, for playback](artifacts.md#get-jobsjob_idstemsstem_nameflac) |
| `GET` | `/jobs/{job_id}/stems/{stem}.wav` | [one stem as WAV, converted as it streams](artifacts.md#get-jobsjob_idstemsstem_namewav) |
| `GET` | `/jobs/{job_id}/download` | [all stems, zipped](artifacts.md#get-jobsjob_iddownload) |
| `GET` | `/jobs/{job_id}/chords` | [chord segments](analysis.md#get-jobsjob_idchords) |
| `GET` | `/jobs/{job_id}/lyrics` | [lyrics](analysis.md#get-jobsjob_idlyrics) |
| `PUT` | `/jobs/{job_id}/lyrics` | [replace lyrics with pasted text](analysis.md#put-jobsjob_idlyrics) |
