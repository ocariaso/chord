# Keeping the two sides in sync

The API contract exists **twice**, by hand. Nothing checks that the copies agree.

| Concept | Server | Web |
| --- | --- | --- |
| Job | `JobResponse` in [`schemas.py`](../../server/app/models/schemas.py) | `Job` in [`client.ts`](../../web/src/api/client.ts) |
| Status | `JobStatus(str, Enum)` | `type JobStatus = "queued" \| …` |
| Chord segment | `ChordSegment` | `ChordSegment` |
| Lyrics | `LyricsResponse` / `LyricsLine` | `Lyrics` / `LyricsLine` |
| Request bodies | `CreateJobFromUrlRequest`, `SaveLyricsRequest` | the object literals sent by `createJobFromUrl` and `saveLyrics` |
| Stem names | `STEM_NAMES` | `STEM_KEYS` in [`design/stems.ts`](../../web/src/design/stems.ts), typed by `StemKey` in [`design/player.ts`](../../web/src/design/player.ts) — the same six, in the same order |
| Terminal statuses | `TERMINAL_STATUSES` in [`routes_jobs.py`](../../server/app/api/routes_jobs.py) | `TERMINAL_STATUSES` in [`useJobEvents.ts`](../../web/src/hooks/useJobEvents.ts) |
| Stage messages | the `stage_message` literals in [`pipeline.py`](../../server/app/pipeline/pipeline.py) | `processingCopy.stages` in [`design/copy.ts`](../../web/src/design/copy.ts), read through `PROCESSING_STAGES` and `processingStage` in [`design/stages.ts`](../../web/src/design/stages.ts) |
| Separation's span of the bar | `_SEPARATION_PROGRESS = (0.1, 0.5)` in `pipeline.py` | `SEPARATION_PROGRESS_END = 0.5` in [`ProcessingScreen.tsx`](../../web/src/screens/processing/ProcessingScreen.tsx) |

A rename on one side is a **silent** break on the other: the field arrives as `undefined`, and
TypeScript is satisfied because the type says it exists. Nothing fails at build time.

The last two rows are easy to miss because they are strings and numbers rather than types. The
stage labels in `copy.ts` are the template's copy and the server's `stage_message` values at once —
the file's header says never to edit them there alone — except *Queued*, which no row carries: a
queued job's message is null, and the screen falls back to the label. `processingStage` tells tempo
detection apart from separation only by comparing `stage_message` with *"Detecting tempo"* (both run
under `status: "separating"`), and the processing screen prints the row's own `stage_message` above
the progress bar. Reword a message in `pipeline.py` and the processing screen files tempo detection
under *Separating stems*, and its headline stops matching its stage list. Move separation's span and
the processing screen's time-remaining estimate is computed against the wrong end point.

## Checklist for a contract change

Adding a field to the job payload touches five places — `error_log` and `audio_format` are the
most recent examples:

1. **`SCHEMA`** in [`database.py`](../../server/app/db/database.py) — for fresh databases.
2. **`MIGRATED_COLUMNS`** in the same file — for existing ones. Both are required; there is no
   migration framework and no version table. See [../data/schema.md](../data/schema.md).
3. **`JobResponse`** in `schemas.py`.
4. **`_row_to_response()`** in `routes_jobs.py` — it maps columns explicitly, field by field, so
   a new column is invisible until added here.
5. **`Job`** in `client.ts`.

A column only the server needs stops after step 2. `attempt` is one: it is in both lists and in
the pipeline's writes, and deliberately absent from `JobResponse` and `Job`.

Changing a status value additionally means updating both `TERMINAL_STATUSES` sets if the new
status is terminal, and `processingStage` in `design/stages.ts` if it isn't — an unrecognized status
falls through to "past every stage", so the processing screen would show all of them done.

Changing the stem set means `STEM_NAMES` *and* `STEM_KEYS` with its `StemKey` union, plus the
per-stem tables beside them — `TONE_PIVOT_HZ` and `STEM_HUES` in `design/stems.ts` and the labels in
`stemNames` in `design/copy.ts` — and a `--ch-<stem>` hue in the vendored `chord-theme.css`. `_row_to_response`
reports the constant `STEM_NAMES` rather than the directory contents, so a mismatch with the actual
Demucs model produces 404s on stem fetches — and `_stems_complete` never sees a complete set, so a
resumed job separates again. A name the server reports and `STEM_KEYS` lacks is dropped by
`templateStems` without a word: never fetched, never shown. Copy that counts the stems — *"Six stems:
vocals · drums · bass · guitar · piano · other"*, *Six-source model*, *Decoding six stems in your
browser* — is fixed in `copy.ts` too. See
[../features/stem-separation.md](../features/stem-separation.md#model).

## Verifying agreement

FastAPI already publishes the truth:

```bash
curl -s http://localhost:8000/openapi.json | jq '.components.schemas.JobResponse.properties | keys'
curl -s http://localhost:8000/openapi.json | jq '.components.schemas.SaveLyricsRequest'
```

Compare against the `Job` interface. For a one-off check after a change, that plus
`npm run build` (which runs `tsc -b`) is enough — `tsc` won't catch a contract drift, but it
will catch a client-side inconsistency introduced while editing. Neither sees the stage messages
or the progress span; grep for them.

## If this starts to hurt

Generate the client instead of writing it. The OpenAPI schema is already there, so
`openapi-typescript` (types only) or `openapi-generator` (types + fetch functions) would drop in
without server changes. The reason it hasn't been done: the contract is eighteen fields on one
model plus a handful of small ones, and the hand-written client also owns what a generator
wouldn't produce — the URL builders for `EventSource`, `sendBeacon` and `<img>`, the 404-as-`null`
behavior for lyrics, `ApiError`'s status, and the sentences the two create functions show for an
unreachable server, plus `createJob`'s for a 413. Generated types wouldn't cover the stage messages or the progress span either.

That tradeoff is recorded in
[../architecture/decisions.md](../architecture/decisions.md#the-api-contract-is-duplicated-by-hand).
