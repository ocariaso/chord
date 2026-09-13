# Generated API types

Generate the web client's TypeScript types from the server's schema, instead of copying them by hand.

## Today

- [`schemas.py`](../../server/app/models/schemas.py) (Pydantic) and
  [`client.ts`](../../web/src/api/client.ts) (TypeScript) describe the same contract, kept in agreement
  by hand. Nothing checks that they match, so a rename on one side breaks the other silently
  ([../api/contract-sync.md](../api/contract-sync.md)).
- The stage messages are part of the contract too: [`design/copy.ts`](../../web/src/design/copy.ts)
  and [`design/stages.ts`](../../web/src/design/stages.ts) match them word for word, and no type
  describes them.

## Why

Contributors will change one side and not know about the other. The rule is in `CLAUDE.md` and
`docs/api/`, but a check that fails is more reliable than a rule someone has to find.

## Change

- Generate types from FastAPI's `/openapi.json` with `openapi-typescript` into a generated file under
  `web/src/api/`, and have `client.ts` import them instead of declaring `Job`, `ChordSegment`,
  `Lyrics` and `JobStatus` itself.
- A script exports the schema without starting the server (import `app`, call `app.openapi()`). It
  still imports the pipeline, so run it in the server image or a venv with its requirements.
- CI regenerates the file and fails if it differs from the committed one.
- **Stage messages.** Move them into an enum or `Literal` on the server, so they appear in the schema
  and are generated too; or add a test that compares the server's list with
  `processingCopy.stages`.

## Done when

- Renaming a field in `JobResponse` without regenerating fails CI; after regenerating, `tsc -b` fails
  wherever the web app uses the old name.
- Changing a stage message on one side only fails CI.
- `client.ts` declares no hand-copied response types.

## Works with

Independent. Needs [tests-and-ci.md](tests-and-ci.md) for the CI check.

## Docs to update

[../api/contract-sync.md](../api/contract-sync.md),
[../architecture/decisions.md](../architecture/decisions.md#the-api-contract-is-duplicated-by-hand),
`CLAUDE.md` (*The API contract is duplicated by hand*), the field checklist in
[../map/tasks.md](../map/tasks.md), and the map entries for `client.ts` and the generated file.
