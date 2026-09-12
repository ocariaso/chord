# Keeping the two sides in sync

The API contract exists **twice**, by hand. Nothing checks that the copies agree.

| Concept | Server | Web |
| --- | --- | --- |
| Job | `JobResponse` in [`schemas.py`](../../server/app/models/schemas.py) | `Job` in [`client.ts`](../../web/src/api/client.ts) |
| Status | `JobStatus(str, Enum)` | `type JobStatus = "queued" \| …` |
| Chord segment | `ChordSegment` | `ChordSegment` |
| Lyrics | `LyricsResponse` / `LyricsLine` | `Lyrics` / `LyricsLine` |
| Stem names | `STEM_NAMES` | `SIMPLE_STEM_ORDER` (Simple), `STEM_ORDER` (Studio) |
| Terminal statuses | `TERMINAL_STATUSES` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py) | `TERMINAL_STATUSES` in [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts) |

A rename on one side is a **silent** break on the other: the field arrives as `undefined`, and
TypeScript is satisfied because the type says it exists. Nothing fails at build time.

## Checklist for a contract change

Adding a field to the job payload touches five places:

1. **`SCHEMA`** in [`database.py`](../../server/app/db/database.py) — for fresh databases.
2. **`MIGRATED_COLUMNS`** in the same file — for existing ones. Both are required; there is no
   migration framework and no version table. See [../data/schema.md](../data/schema.md).
3. **`JobResponse`** in `schemas.py`.
4. **`_row_to_response()`** in `routes_jobs.py` — it maps columns explicitly, field by field, so
   a new column is invisible until added here.
5. **`Job`** in `client.ts`.

Changing a status value additionally means updating both `TERMINAL_STATUSES` sets if the new
status is terminal.

Changing the stem set means `STEM_NAMES` *and* both view orderings — and note that
`_row_to_response` reports the constant `STEM_NAMES` rather than the directory contents, so a
mismatch with the actual Demucs model produces 404s on stem fetches. See
[../features/stem-separation.md](../features/stem-separation.md#model).

## Verifying agreement

FastAPI already publishes the truth:

```bash
curl -s http://localhost:8000/openapi.json | jq '.components.schemas.JobResponse.properties | keys'
```

Compare against the `Job` interface. For a one-off check after a change, that plus
`npm run build` (which runs `tsc -b`) is enough — `tsc` won't catch a contract drift, but it
will catch a client-side inconsistency introduced while editing.

## If this starts to hurt

Generate the client instead of writing it. The OpenAPI schema is already there, so
`openapi-typescript` (types only) or `openapi-generator` (types + fetch functions) would drop in
without server changes. The reason it hasn't been done: the contract is thirteen fields on one
model plus three small ones, and the hand-written client also owns the URL builders and the
404-as-`null` behavior for lyrics, which a generator wouldn't produce.

That tradeoff is recorded in
[../architecture/decisions.md](../architecture/decisions.md#the-api-contract-is-duplicated-by-hand).
