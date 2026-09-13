# Prebuilt releases

Let people run CHORD without building it, and give contributors what they need to get involved.

## Today

- `./scripts/start.sh` builds both images on the user's machine
  ([../operations/docker.md](../operations/docker.md)). The server build installs torch, compiles
  madmom with `--no-build-isolation`, patches it in place with `sed`, and downloads the Demucs
  weights. It's slow, needs a network connection to several package indexes, and is the most fragile
  part of the project ([../architecture/decisions.md](../architecture/decisions.md#madmom-is-patched-in-place)).
- There are no versions, tags, release notes or published images.
- The repository has a `LICENSE`, but no contributing guide, issue templates or changelog.

## Why

Most people who find an open-source music tool want to try it in a few minutes. A first run that
depends on compiling a patched 2018 library will lose many of them, and each broken build turns into
an issue report.

## Change

- **Published images.** CI builds and pushes `chord-server` and `chord-web` to GitHub Container
  Registry on each release tag, with `cpu` and `cuda` variants of the server (for example
  `ghcr.io/<owner>/chord-server:1.2.0-cuda`). Build `linux/amd64`; add `linux/arm64` for the CPU
  image if madmom builds there, so Docker on Apple Silicon doesn't run under emulation.
- **Compose uses them by default.** `docker-compose.yml` references the published images with
  `build:` kept as a fallback, so `./scripts/start.sh` pulls instead of builds. A `--build` flag (or
  `CHORD_BUILD=1`) keeps local builds for contributors.
- **Versions.** Tag releases with semantic versions, and keep a `CHANGELOG.md`.
- **Contributor files.** `CONTRIBUTING.md` (pointing at `docs/`, the map rule, `npm run build` and
  `npm run lint`, and how to run a job end to end), issue templates for bugs (asking for the OS, GPU,
  the logged device and `docker compose logs server`) and features, and a pull request template.
- **User README.** A quick start that fits on one screen: requirements per platform, one command to
  start, where the data lives, how to stop and clean up.

## Done when

- On a clean machine with Docker, `./scripts/start.sh` pulls images and serves CHORD without
  compiling anything.
- Pushing a `v*` tag publishes both images, in both server variants, with no manual step.
- A contributor can go from a fresh clone to a local build by following `CONTRIBUTING.md` alone.

## Works with

Independent. Uses the pipeline from [tests-and-ci.md](tests-and-ci.md) if it exists.
[device-visibility.md](device-visibility.md) makes the bug template's device question answerable.

## Docs to update

[../operations/README.md](../operations/README.md), [../operations/docker.md](../operations/docker.md),
[../operations/local-development.md](../operations/local-development.md), the project README, and
[../map/root.md](../map/root.md) for the new workflow, templates and root files.
