# Keep CHORD local by default

Make CHORD reachable only from the machine it runs on, unless the user chooses otherwise.

## Today

- [`docker-compose.yml`](../../docker-compose.yml) publishes the web container as
  `"${PORT:-8080}:80"`, which listens on **every network interface**, not only `localhost`. On Linux,
  Docker's port publishing also bypasses `ufw` firewall rules.
- CHORD has no authentication, by design for a local tool. So anyone on the same network (a café,
  office or shared flat) can open `http://<your-ip>:8080` and:
  - list every job with `GET /jobs`, and download their stems;
  - cancel or discard jobs;
  - submit URL jobs, which make yt-dlp on your machine fetch any URL, including addresses on your
    private network such as a router's admin page ([`source.py`](../../server/app/pipeline/source.py)
    passes the URL to yt-dlp after checking only that it isn't blank).
- Websites open in the user's own browser can also send requests to `http://localhost:8080`. CORS
  stops them reading responses, but not sending simple requests: a `multipart/form-data`
  `POST /api/jobs` from another site needs no preflight, so it will be accepted and queued.

## Why

People who download a local tool expect it to be local. Exposing it to the network should be a
choice they make, not a default they don't know about.

## Change

- **Bind to localhost by default.** Publish as `"${BIND_ADDRESS:-127.0.0.1}:${PORT:-8080}:80"`.
  Document `BIND_ADDRESS=0.0.0.0` for users who want to open CHORD from another device, with a note
  about what that exposes, and that the speed control needs a secure origin, which a LAN IP over HTTP
  isn't ([../features/speed-and-loop.md](../features/speed-and-loop.md)).
- **Reject cross-site requests.** In nginx or FastAPI middleware, reject state-changing requests
  (`POST`, `PUT`) whose `Origin` header is present and isn't the app's own origin. The app's own
  requests and `sendBeacon` discards are same-origin, so they pass.
- **Reject unexpected hosts.** Accept only `localhost`, `127.0.0.1` and `[::1]` in the `Host`
  header (plus whatever `BIND_ADDRESS` allows), which blocks DNS rebinding.
- **Restrict URL jobs.** Accept only `http`/`https`, and reject hostnames that resolve to private,
  loopback or link-local addresses. It matters less once CHORD is bound to localhost, but still
  applies to users who open it up.
- **Remove `GET /jobs`.** The web client never calls it, and the cleanup recipes in
  [../data/retention.md](../data/retention.md) can use `sqlite3` instead.

## Done when

- With default settings, `http://<machine LAN IP>:8080` isn't reachable from another device, and
  `http://localhost:8080` works.
- With `BIND_ADDRESS=0.0.0.0`, another device can use CHORD.
- An HTML page on another origin that auto-submits a form to `http://localhost:8080/api/jobs` gets a
  `403`, and no job is created.
- A URL job for `http://192.168.1.1/` or `http://localhost:8000/health` is rejected at creation, and
  YouTube and SoundCloud links still work.
- Upload, playback, export, cancel, resume and discard-on-leave work as before.

## Works with

Independent.

## Docs to update

[../operations/docker.md](../operations/docker.md),
[../operations/configuration.md](../operations/configuration.md) (`BIND_ADDRESS`),
[../features/ingest.md](../features/ingest.md), [../api/jobs.md](../api/jobs.md),
[../data/retention.md](../data/retention.md), a security note in the project README, and the map
entries for `docker-compose.yml`, `nginx.conf` and `routes_jobs.py`.
