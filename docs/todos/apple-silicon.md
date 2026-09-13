# Apple Silicon GPU support

Let Mac users separate on the Apple GPU (PyTorch's `mps` backend) instead of the CPU.

## Today

- Docker on macOS runs a Linux VM with no access to the Apple GPU, so `./scripts/start.sh` on a Mac
  always runs separation on the CPU: several minutes per four-minute track.
- `DEVICE` accepts `cpu` or `cuda`. `_resolve_device()` in
  [`separation.py`](../../server/app/pipeline/separation.py) only knows how to fall back from `cuda`;
  `DEVICE=mps` would be passed to Demucs untested, with no fallback.
- Running without Docker is documented in
  [../operations/local-development.md](../operations/local-development.md), but as a development
  setup, and madmom's build and patch steps haven't been checked on arm64 macOS.

## Why

Many people who would run a local music tool are on Macs. Demucs supports `mps`, and on an M-series
chip it should be several times faster than the CPU path they get today. That needs measuring
([Done when](#done-when)).

## Change

- Accept `DEVICE=mps`, and add `DEVICE=auto` (the new default) that picks `cuda`, then `mps`, then
  `cpu`, based on what torch reports.
- Fall back from `mps` to `cpu` the same way as from `cuda`, and report it
  ([device-visibility.md](device-visibility.md)).
- Check that `htdemucs_6s` runs on `mps` without unsupported-op errors. If some ops aren't supported,
  set `PYTORCH_ENABLE_MPS_FALLBACK=1` and measure whether it's still faster than CPU.
- Add a native launcher for macOS (for example `scripts/start-native.sh`): create a venv on Python
  3.10, install torch, the requirements and madmom with its patches, build the web app, and serve it.
  Fix any madmom arm64 build problems in
  [`patch_madmom.sh`](../../server/scripts/patch_madmom.sh).
- `start.sh` on macOS prints that Docker will use the CPU, and points to the native launcher.

## Done when

- On an M-series Mac, the native launcher runs a job end to end with separation on `mps`.
- Separation time for the same four-minute track is recorded for `mps` and for the CPU Docker image,
  and `mps` is clearly faster. If it isn't, this page's conclusion is to document that and stop.
- Stems from `mps` sound the same as stems from CPU (no artifacts from op fallbacks).
- `DEVICE=auto` picks the right device on a CUDA Linux machine, a Mac, and a machine with neither.

## Works with

Independent. Pairs with [device-visibility.md](device-visibility.md) and
[prebuilt-releases.md](prebuilt-releases.md) (the native path doesn't use images).

## Docs to update

[../operations/README.md](../operations/README.md) (requirements per platform),
[../operations/local-development.md](../operations/local-development.md),
[../operations/configuration.md](../operations/configuration.md) (`DEVICE`),
[../features/stem-separation.md](../features/stem-separation.md), the project README, and the map
entries for `separation.py`, `config.py` and any new script.
