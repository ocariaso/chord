# Todos

Planned improvements that aren't in the code yet. The rest of `docs/` describes CHORD as it is.
Bugs and small known issues stay where they already live, in the *Known issues* table of
[../map/tasks.md](../map/tasks.md#known-issues-worth-picking-up).

CHORD is a local tool that runs on the user's own machine and is meant to be open-sourced, not a
hosted service. These pages are written for that: one user, one machine, no accounts. Scaling work
(a shared database, object storage, a distributed queue, worker pools) is deliberately not here.

Each page is one self-contained improvement: what happens today, why to change it, the change,
when it's done, and which docs to update afterwards. They can be picked up in any order. Where one
makes another easier, the page says so under *Works with*.

## Running locally

| Page | Improvement |
| --- | --- |
| [local-network-exposure.md](local-network-exposure.md) | listen on localhost only by default, and reject cross-site requests and internal URLs |
| [restart-recovery.md](restart-recovery.md) | jobs interrupted by a stop or restart continue on the next start |
| [device-visibility.md](device-visibility.md) | report when separation falls back to the CPU |
| [apple-silicon.md](apple-silicon.md) | separation on the Apple GPU (`mps`) for Mac users |

## Open source

| Page | Improvement |
| --- | --- |
| [prebuilt-releases.md](prebuilt-releases.md) | published images so users don't build madmom, versions, contributor files |
| [tests-and-ci.md](tests-and-ci.md) | tests for both halves, run on every pull request |
| [generated-api-types.md](generated-api-types.md) | TypeScript types generated from the server's OpenAPI schema |

When an improvement ships, delete its page, remove its row here, and update the prose pages its
*Docs to update* section lists.
