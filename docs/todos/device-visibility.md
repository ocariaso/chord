# Show which device separation runs on

Tell the user when separation is running on the CPU, instead of letting it be silently slow.

## Today

- `_resolve_device()` in [`separation.py`](../../server/app/pipeline/separation.py) returns `cpu`
  whenever `DEVICE=cuda` but `torch.cuda.is_available()` is false. Nothing logs or reports it.
- That happens after a driver update, without the NVIDIA Container Toolkit, when `start.sh` built the
  CPU image, and always on macOS under Docker.
- On CPU a four-minute track takes several minutes instead of tens of seconds. From the processing
  screen, that looks like CHORD is hanging.
- `GET /health` always returns `{"status": "ok"}` ([`main.py`](../../server/app/main.py)), so it
  can't be used to check either.

## Why

"It's really slow" will be the most common issue report from people running CHORD on their own
hardware, and today neither they nor a maintainer can tell why from what CHORD shows.

## Change

- Log the resolved device, the torch version and the GPU name once, when the model loads in
  `warm_up`. When `DEVICE=cuda` falls back, log a warning that says why and links to
  [../operations/troubleshooting.md](../operations/troubleshooting.md).
- Add the resolved device to `GET /health` (for example `{"status": "ok", "device": "cpu"}`), so
  `curl localhost:8080/api/health` answers the question.
- Optionally, show it on the processing screen while separating on CPU: a note that it will take
  several minutes. This adds a field to the contract (follow the checklist in
  [../map/tasks.md](../map/tasks.md)) and copy to [`design/copy.ts`](../../web/src/design/copy.ts),
  within [../conventions/design.md](../conventions/design.md).

## Done when

- Starting the GPU image with no GPU visible logs a warning naming the fallback.
- `GET /health` reports `cuda`, `mps` or `cpu` correctly.
- If the UI note is added: it appears for a CPU job and never for a GPU one.

## Works with

Independent. [apple-silicon.md](apple-silicon.md) adds `mps` as a device to report.

## Docs to update

[../features/stem-separation.md](../features/stem-separation.md),
[../operations/troubleshooting.md](../operations/troubleshooting.md), [../api/README.md](../api/README.md)
(`/health`), and the map entries for `separation.py` and `main.py`.
