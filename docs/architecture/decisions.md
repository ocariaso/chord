# Design decisions

Why the code is shaped the way it is. Each entry names the constraint, the choice, and what the
choice costs — so that a future change can weigh the same tradeoff rather than rediscover it.

## Web Audio instead of `<audio>` elements

**Constraint:** six stems must play as one piece of music, sample-aligned, while being muted,
re-leveled, looped and re-timed live.

**Choice:** one `AudioContext`, one clock. At 1×, one `AudioBufferSourceNode` per stem, all
started at the same `when` with the same `offset`; at any other speed, one worklet producing all
six. See [audio-playback.md](audio-playback.md).

**Cost:** every stem must be fully downloaded and decoded before playback can begin — the
*Loading stems…* wait — and a song's six decoded buffers stay resident while the results are
open. Decoded audio is 32-bit float at the context's sample rate: about 23 MB per stereo stem per
minute at 48 kHz, so roughly 1.7 GB for a twelve-minute track. There is no streaming path and no
progressive start, and that number is why the
[duration limit](#a-duration-limit-checked-before-separation) exists. Stems arrive as
[FLAC](#stems-are-stored-as-flac-and-exported-as-wav), which shortens the download but not the
decode or the memory.

The context's rate is the stems' own. `decodeAudioData` resamples to its context's rate, and for
six 48 kHz stems on a 44.1 kHz output device that was a quarter of the decode (1.4 s against
1.03 s for a 6:20 track in Chrome). So before its first decode the engine reads the rate from the
first stem's FLAC header and, if the device's differs, reopens its context at the stems'; the
browser then converts the one mixed output as it plays. That costs a context opened and thrown
away on such a device, and a dependency on the stems being FLAC that goes beyond decoding them —
anything else, or a rate the browser refuses, falls back to resampling every stem as before. See
[audio-playback.md](audio-playback.md#the-context-runs-at-the-stems-sample-rate).

## Stems are stored as FLAC and exported as WAV

**Constraint:** every stem is downloaded whole before playback can start — about 10 MB per
stem-minute at 44.1 kHz as WAV, six at a time — while export promises *Uncompressed WAV, exactly as
separated*, and no feature may be removed to save bytes.

**Choice:** `separate()` writes each stem as a 16-bit FLAC in-process with libsndfile
(`soundfile.write(..., subtype="PCM_16")`), at compression level 4. The 16-bit samples are computed
where the stem was separated, with the arithmetic of Demucs' own `prevent_clip(mode="rescale")` — the
clip handling `save_audio` applied — and libsndfile's own scale and rounding, so they are bit for bit
what libsndfile would have written from the float stem; `save_audio` would also have started an
ffmpeg process per FLAC file. Each file is written through a 4 MiB buffer: libsndfile writes a
FLAC frame at a time, and on a data directory shared from the host's disk — what Docker Desktop
gives a bind mount — each of those writes was a round trip, 8–14 s for the six stems of a 6:20
track against 2.0 s buffered. Lossless, at about half WAV's bytes. Playback fetches `stems/<name>.flac` as stored, and
`decodeAudioData` reads it natively. Export fetches `stems/<name>.wav`, which the server converts as
it streams — a 44-byte header, then the FLAC decoded a block at a time — and the zip carries the same
converted WAVs, deflated at level 1 and streamed. A lossless 16-bit FLAC decodes to exactly the
separated samples, so the WAV the user saves is the one Demucs' output would have been.

**Cost:** encoding time for every separation — the one part of it left to the CPU,
[beside the model's pass](#stems-are-encoded-while-the-model-runs) where a GPU leaves the cores free
and after it everywhere else, 2.2–3.8 s for a 6:20 track on 2 CPUs — and a decode
on the server for every export — twice for a stem saved alone and in the zip. Still 16-bit whatever the source's
depth. A job directory written before the switch holds `.wav` stems, which `_stems_complete` doesn't
recognise and neither stem route serves, so resuming such a job separates it again. See
[../features/downloads.md](../features/downloads.md).

## Waveforms are CSS clip-path envelopes

**Constraint:** every stem row shows a waveform, audio truth already lives in `PlaybackEngine`,
and the design draws a waveform as a `.ch-wave` bar pattern.

**Choice:** no waveform library. [`waveformPolygon`](../../web/src/utils/peaks.ts) reduces each
decoded buffer to a 160-bin peak envelope expressed as a CSS `polygon()` — what the design template asked
for in place of its placeholder shapes — and
[`StemWaveform`](../../web/src/components/controls/StemWaveform.tsx) sets it as the element's
`clip-path`. This replaced WaveSurfer, which needed every stem fetched twice — an `ArrayBuffer` for
the engine, a media element for its cursor.

**Cost:** the playhead can't be drawn inside the clipped element, so `StemWaveform` wraps the wave
and lays the chord strip's `.ch-playhead` beside it; a waveform isn't a seek target, so position is
set on the chord strip and the transport. The envelope is coarse and fixed — 160 bins whatever the length, so
4.5 s per bin on a twelve-minute track — and it is computed on the main thread while the stems load.
In exchange: one fetch per stem, and one dependency fewer.

## Pitch-preserving speed in an AudioWorklet

**Constraint:** practicing along means slowing a song down without changing its key, across six
stems that must stay aligned. `AudioBufferSourceNode.playbackRate` changes pitch with speed (the
`preservesPitch` switch exists only on media elements, ruled out above), and rendering stretched
copies ahead of time would mean producing — and holding — six more full-length buffers on every
rate change.

**Choice:** a WSOLA time-stretch in an `AudioWorklet`
([`stretchProcessor.js`](../../web/src/audio/stretchProcessor.js)): one node produces every stem's
output, and all stems are cut at the same input positions, chosen by similarity on a
gain-weighted mix. The processor holds no audio; the main thread feeds it one-second blocks on
request. At 1× the buffer sources are used as before. The speed menu runs from 0.5× to 1.25×.

**Cost:**

- **A secure origin.** Browsers expose AudioWorklet only to HTTPS and `localhost`, so CHORD
  opened over plain HTTP from another machine plays at 1× only, with the speed chip disabled.
- **Main-thread block feeding.** Blocks are requested 3 s ahead and copied out of the decoded
  buffers on the main thread. A main thread busy long enough to leave a block unanswered is heard
  as silence.
- **WSOLA artifacts.** Output is assembled from 60 ms frames overlap-added at the best-matching
  offsets, and transients — drum hits especially — smear or double at the joins, most audibly
  when speeding up.
- Every rate change, and every seek while stretched, is a restart with an 80 ms gap, and the
  processor is plain JavaScript that `tsc -b` doesn't check.

## Metering from AnalyserNodes on the main thread

**Constraint:** the Console and Analog views need post-fader stem meters, master peak, true peak,
correlation and momentary loudness, moving every frame, on whatever origin CHORD is served from.

**Choice:** tap the graph with `AnalyserNode`s — after each stem's panner, after `masterGain`,
and after two K-weighting `IIRFilterNode`s — and compute every reading in `readMeters` on the
main thread, once per animation frame, only while a metering view is mounted. The views apply
ballistics and write the results straight to the DOM through `useAnimationFrame`, bypassing React
state. See [audio-playback.md](audio-playback.md#metering).

**Cost:** an AudioWorklet meter would see every sample; analysers give snapshots.

- **Per-frame reads.** Every frame copies twelve stem windows and two master windows, and the
  true-peak interpolation alone is about 150,000 multiply-adds.
- **Coverage depends on frame rate.** Below roughly 45 fps the 1024-sample stem windows stop
  covering the time between frames, and a short peak in the gap is never seen.
- **Approximate true peak.** A 12-tap kernel over the newest 2048 samples only — close enough for
  a display, not a compliance measurement. Loudness is momentary only: no short-term, integrated
  or gated value.

In exchange it works on any origin, needs no second worklet, and the Mixer view pays nothing.

## The playback position is read, not stored

**Constraint:** the playheads, the seek slider, the time readouts, the current chord and the lyric
line all follow a clock that moves every frame. Kept in `PlayerState`, that clock re-rendered the
whole results screen — bars, active view and transport — at frame rate while playing.

**Choice:** `PlayerState` has no time. `ResultsScreen` passes stable `getTime` and `getProgress`
callbacks over the engine's clock, and each display reads them itself:
[`usePlayhead`](../../web/src/hooks/usePlayhead.ts) writes `--p` onto its element every frame, as
the meters write `--l`, and [`useClockValue`](../../web/src/hooks/useClockValue.ts) re-reads a
derived primitive every frame — the elapsed `m:ss`, the active chord index, the lyric line — and
renders only when it changes. Under reduced motion `getTime` floors to whole seconds, so every
reader steps together.

**Cost:**

- **A loop per display.** Every playhead and clock value runs its own `requestAnimationFrame`
  callback, playing or paused — a Mixer runs one per stem row besides the chord bar's and the
  transport's — each doing a read and a compare per frame.
- **A frame of lag.** A clock value is recomputed on the next frame, so for one render after new
  segments or replaced lyrics it indexes the old ones; `ChordBar` guards those reads.
- **Position is invisible to render.** An element driven by `usePlayhead` must not set `--p` in its
  JSX, or React writes it back, and a derived value must be a primitive, or it renders every frame.
- Displays no longer share one sampled time per render, so two of them can differ by a frame.

In exchange playback renders a component only when what it shows changes — the chord bar on a chord,
lyric line or second, the transport's readouts once a second.

## A single serial worker thread, not a task queue

**Constraint:** Demucs wants the whole GPU; two concurrent separations are slower than two
sequential ones and can exhaust VRAM.

**Choice:** one `queue.Queue` and one daemon thread in-process
([`worker.py`](../../server/app/pipeline/worker.py)).

**Cost:** the queue is memory-only. A restart silently orphans every queued and in-progress job
— their rows sit in a non-terminal status forever, and the reaper deliberately skips them; a page still showing
such a job can revive it by cancelling and then resuming, and nothing else can. Nothing
de-duplicates entries either — a job id can sit in the queue twice — so `run_job` starts only on a
`queued` row, and the copy that reaches the worker after the job has run returns without doing
anything (see [job-lifecycle.md](job-lifecycle.md#resuming)). Multiple uvicorn workers would
break the model outright (one queue per process). Replacing this with Celery/RQ + Redis is the
obvious upgrade path and the reason the pipeline modules take no database handles. The one second
thread a job gets is its [analysis thread](#analysis-runs-beside-separation).

## Analysis runs beside separation

**Constraint:** tempo, chord and key detection read only the original mix, never the stems, and
were CPU work (librosa, madmom). On a GPU, separation of a four-minute track took tens of seconds, so
analysis run after it was most of the wait. (madmom's networks have since moved to torch — see
[the next record](#madmoms-networks-run-on-torch) — which shrank analysis to a few seconds; running it
beside separation still hides those.) And the first job after a start paid for loading every
model, including, then, about 19 s of numba compiling librosa's beat tracker.

**Choice:** when a job enters `separating`, `run_job` starts one `chord-analysis` thread
(`ThreadPoolExecutor(max_workers=1)`). It decodes the original once
([`decode.py`](../../server/app/pipeline/decode.py), mono 44.1 kHz — the shape madmom's models take
as it is) and runs tempo detection, then chord and key detection, on that one decode, while the worker
thread runs Demucs. After separation the worker collects the results in stage order, writing
*Detecting tempo* or *Detecting chords and key* only for a step still running, and writes
`chords.json`, `key.json` and the final row itself, so an abandoned run's analysis writes nothing.
The same thread first reads an upload's artist tag and embedded cover (`_read_tags`), which nothing
waits for; ahead of separation, as they were, they held every job up by about half a second.
Before its first job the worker calls `warm_up`: the Demucs model, tempo detection run once and
the madmom networks. See [job-lifecycle.md](job-lifecycle.md#progress-values).

**Cost:**

- **CPU contention.** On a CPU-only host Demucs and analysis compete for the same cores, so
  separation slows by some of what analysis takes; the gain is mostly on a GPU.
- **The GIL, and memory.** Two threads in one process share both. Launching a chunk's thousands
  of GPU operations from Python needed the GIL for each, so analysis running beside separation held
  every chunk up by a third or more — a pass of 9.1 s that takes 7.0 s now that a chunk is
  [one launch](#the-separation-model-is-replayed-from-a-recorded-cuda-graph). And librosa's tempo
  estimate held over a gigabyte for a six-minute track, enough to push a 4 GiB Docker VM into swap
  under the separation; it is [built in blocks](#tempo-is-librosas-assembled-in-blocks) for that
  reason.
- **The artist and the cover arrive late.** They reach the processing screen a moment after
  separation starts, not before it.
- **Analysis can't be cancelled.** `shutdown(cancel_futures=True)` drops only steps that haven't
  started. A cancelled, superseded or failed run's decode, tempo or chord step keeps running,
  unread, and can overlap the next job.
- **A failure waits for separation.** A decode, tempo or chord error surfaces only when its future
  is collected, after the whole separation has been spent.
- **Stage times measure the wait, not the work.** The processing screen times a stage by the
  snapshots it saw, so *Separating stems* can include most of analysis, a step that finished during
  separation shows done with no time, and a job can go from `separating` to `done` without ever
  reporting `analyzing`.
- The whole decoded track sits in memory while Demucs holds its own copy, and the warm-up delays a
  job submitted right after a start, which waits on *Queued*.

## madmom's networks run on torch

**Constraint:** madmom 0.16.1 — unmaintained since 2018, and the source of CHORD's chord and key
models — evaluates a convolution one input/output channel pair at a time with scipy. Chord and key
detection took about 43 s for two minutes of audio on one core: on an RTX 4060, more than three times
as long as separating it. The results had to stay madmom's.

**Choice:** `networks.run_on_torch` replaces only the `NeuralNetwork` steps inside madmom's processor
chains with `TorchNetwork`s — the same weights, from madmom's own model files, converted layer by
layer to `torch.nn.functional` calls on the job's device. madmom still computes the spectrograms and
runs the CRF. Checked layer by layer on random input and end to end on a real recording: identical
segments and key, features within 6e-7 of madmom's. To hold that on a GPU, `resolve_device()` turns
cuDNN's TF32 off for convolutions, process-wide: TF32 moved the chord features by 2e-4, enough to flip
a chord near a tie, and Demucs measured no slower without it. Two minutes of audio now take 0.9 s on
the CPU and 0.45 s on an RTX 4060. See
[../features/chords-and-key.md](../features/chords-and-key.md#the-networks-run-on-torch).

**Cost:** CHORD owns a reimplementation of five madmom layer types, and of madmom's max-pool edge
behavior, checked against madmom 0.16.1 only; a layer type it doesn't know raises at load, in the
warm-up, rather than computing something else. TF32 is off for every convolution in the process,
Demucs' included, which would cost speed on a GPU where TF32 convolutions are much faster than float32
ones. The networks share the GPU with Demucs, for well under a second a job.

## CHORD runs Demucs' chunk loop itself

**Constraint:** demucs' `Separator.separate_tensor` and `apply_model` keep the whole track in RAM.
Each chunk's output is copied back from the GPU and added up by the CPU — one torch thread, here — and
the finished track is copied whole several times over (overlap-add, shift trim, bag weighting,
denormalization) before the stems are resampled and converted on the CPU. With the stem encoding, that
was about half of separation's time on a GPU, and it holds several full copies of six stems in RAM.

**Choice:** `separation._separate` and `_apply_model` reimplement `separate_tensor` and `apply_model`
for Demucs' defaults — one random shift, overlapping chunks blended by a triangle, bags of models —
with the same arithmetic in the same order, but keep the overlap-add beside the model, in one buffer,
in place, when the GPU has room for twice the track plus 0.5 GiB; otherwise in RAM, still in one
buffer. Decoding, resampling and the 16-bit conversion run on the device too, and the stems leave it as
16-bit PCM. A minute of audio separates in 2.9 s instead of 6.1 s from a 44.1 kHz source, and 3.5 s
instead of 8.0 s from a 48 kHz one, with stems that differ from Demucs' only by float rounding — 69 dB
or more below the signal. See
[../features/stem-separation.md](../features/stem-separation.md#the-separation-pass).

**Cost:** CHORD owns about sixty lines that mirror demucs 4.1.0's inference — and, since the two
records below, three of demucs' helpers and the tail of its forward pass as well. A demucs upgrade that
changes it — a new default, another shift policy — doesn't reach CHORD until it is copied across, and
only the defaults exist here: one shift, chunked, linear blend. The GPU holds the whole separated track
for the length of the pass, where Demucs held a chunk — about 3.5 GiB of headroom for twelve minutes.
On a GPU without that room the model still runs there, but chunks are copied back and added up in RAM,
and the stems resampled and converted on the CPU: closer to the old speed.

## Separation runs in half precision where the GPU is faster at it

**Constraint:** with the chunk loop on the GPU, the model's own pass is most of a job, and the
GPU is busy for all of it — 99% on an RTX 4060. Batching chunks, TF32 and cuDNN's benchmark mode
had each been measured and bought little or cost memory. Half precision is the one setting that
makes the arithmetic itself cheaper, and it changes the result.

**Choice:** `DEMUCS_HALF_PRECISION`, on by default, and decided per machine. When the model is
loaded, `_settle_precision` times one full-length chunk in float32 and one under
`torch.autocast(dtype=float16)`, and turns half precision on only if it was faster: about 100 ms
against 135 on the RTX 4060. A card without tensor cores computes half precision slower than float32
and stays where it was. Only the network runs in it — its output is cast to float32 before
HTDemucs reads it as a complex spectrogram, which has no half-precision form, so the inverse STFT,
the overlap-add and the stems are float32 as before. After every pass a sum over the result says
whether anything in it is NaN or infinite; such a pass is run again in float32 and half precision
is off for the rest of the process. See
[../features/stem-separation.md](../features/stem-separation.md#how-a-chunk-runs-on-a-gpu).

**Cost:** the stems are no longer float32's. Against float32 with the same random shift, on the
one track measured: 62 dB below the signal on drums, bass and vocals, 56 dB on guitar, 42–45 dB on
two stems that were nearly silent there, and at most 41 of 32768 on a sample — 190 on a
three-second clip, 302 on one driven into clipping. The claim this rests on is that Demucs itself
is looser than that: it shifts its chunks at random on every run, and two float32 runs of that track
differ from each other by 0.4–27 dB and up to 3218 of 32768. That is an argument about audibility
on one track, not a measurement of separation quality, and nobody has listened for it across a
library. `DEMUCS_HALF_PRECISION=false` restores float32, in which CHORD's stems are byte for byte
what they were. The NaN check covers the failure half precision is known for, and nothing subtler:
it reruns a whole pass when it fires, and a model other than `HTDemucs` never gets half precision at
all. The choice also rests on two timings of one chunk at start-up, on a GPU the desktop is using
too; a wrong call there stands until the next start.

## The separation model is replayed from a recorded CUDA graph

**Constraint:** HTDemucs' forward pass is thousands of small GPU operations, and PyTorch launches
each one from Python. On the RTX 4060 that was about 70 ms of the worker thread's time for a chunk
the GPU computes in 100, and every launch takes the GIL — which the
[analysis thread](#analysis-runs-beside-separation) wants too. Beside a thread busy in Python a
chunk took 581 ms; beside the real analysis the pass over a 6:20 track took 9.1 s where it takes
6.5–7 s alone. A second process for the analysis would have ended the contention at the price of a
second copy of the Python stack in memory, on a machine where memory was already the problem.

**Choice:** record the forward pass once and replay it. `_RecordedModel` captures it with
`torch.cuda.graph` and replays it for every chunk: one launch of the same operations — 6 ms of the
thread's time, 120 ms a chunk beside that busy thread, and about 7.0 s for the 6:20 pass with the
analysis running. In float32 the replay equals the model bit for bit, and the stems are
byte-identical to the ones the previous code wrote. Three things make the forward recordable:

- A graph can't hold a step that leaves the GPU, and demucs' forward has three per chunk. `pad1d`
  asserts on a comparison made on the GPU, `spectro` builds its window on the CPU, and
  `create_2d_sin_embedding` computes the positional embedding there. `_keep_forward_on_gpu` replaces
  them, by module attribute, with equivalents that don't — the same arithmetic, and a wait saved per
  chunk even without a recording.
- `torch.istft` checks its window on the CPU, inside torch, where it can't be replaced. So the
  recording stops short of it: `_ispec` is swapped during capture for a stand-in that keeps the
  spectrogram and returns zero, and each replay finishes with the real inverse STFT and the sum.
- A recording is made at the first chunk of a pass and dropped with the pass. It takes about
  0.04 s, and a recording holds the model's working memory for as long as it lives; kept, it would
  be half a gigabyte of a shared GPU held between jobs.

Nothing replays a recording that hasn't been checked. `_settle_recording` runs a chunk of noise
through the model directly and from a recording when the model loads, and turns recording on only
if they agree within 2% of the peak (they agree exactly in float32, to about 8e-5 in half
precision); a recording that can't be made, then or later, ends recording for the process. In
either case, and when the warm-up itself failed, chunks run through the model as they always did.
`DEMUCS_CUDA_GRAPH=false` never tries.

**Cost:** more of demucs is CHORD's now, and held by its internals: three helpers replaced by
assigning to `demucs.htdemucs` and `demucs.transformer`, `_ispec` and `_mask` swapped on the model
object, and the knowledge that `forward` ends with an inverse STFT added to the waveform branch.
All of it describes demucs 4.1.0, which `requirements.txt` doesn't pin. The check at start-up is
what stands between a demucs that has moved and wrong stems, and it is one chunk of noise against a
2% tolerance: it catches a forward that no longer matches, not a small error. A capture bakes in
whatever the forward did once, so a model whose forward is random at inference would be recorded
wrong — `htdemucs_6s` isn't, and the check would see it — and only `HTDemucs` is recorded at all,
because only its chunks all have one shape. In half precision a replay and a direct run differ by
up to about a thousandth of the peak, so with both on, a job's stems depend on which path ran. And
a capture that fails inside CUDA leaves an error behind it; separation carried on correctly after
one in testing, and a later recording worked, but that is one driver on one card.

## Stems are encoded while the model runs

**Constraint:** converting six stems to 16-bit and encoding them was 2.2–3.8 s of a 6:20 track's
job on 2 CPUs — the largest part that wasn't the model — and it began only when the model's pass
had ended: a pass that, [replayed from a recording](#the-separation-model-is-replayed-from-a-recorded-cuda-graph),
asks 6 ms of a core for a chunk and leaves the rest idle. Encoding a stem's first minute doesn't
depend on its last, with two exceptions: a resampled stem's length, which julius rounds from the
whole track's, and the clip rescale, which needs the whole stem's peak. And the files had to stay
the ones the whole-stem path writes.

**Choice:** on a GPU that holds the track, with a bag of one model, `_StemStream` encodes each
stretch of the track as it settles — once the next chunk starts past it, no later chunk reaches it.
`_apply_model` divides a stretch by its weights then, in place of one division at the end;
`feed` takes up to ten seconds of settled audio, undoes the normalization on a copy, resamples it by
julius' own frames with the kernel's width of real audio either side, converts it to 16-bit and
hands each stem's block to a thread holding that stem's open file. Those threads run at niceness
10 and `feed` gives them nothing they have no room for, so on a host with no core to spare the
audio waits on the GPU and is encoded after the pass, as it always was, not in the pass's way. A
stem whose running peak fails the clip test is dropped from the stream there and then, and encoded
whole at the end with `_write_stems`, which is also still the path for a bag of several models, a
GPU without room for the track, and a CPU. In float32 the files are byte-identical to the
whole-stem path's on seven inputs, two of them driven into clipping. See
[../features/stem-separation.md](../features/stem-separation.md#encoded-while-the-model-runs).

**Cost:**

- **What it saves depends on spare cores, and has only been measured without them.** With another
  stack holding most of one of 2 CPUs: separation alone 12.6–13.1 s for 6:20 where it was
  15.5–18.3 s, and the whole job, analysis beside it, no faster — 22.8 s against 23.5 s — because
  there the CPU's total work sets the end, not its order.
- **A loud master gets less.** The stems that clip — drums and vocals on the test track, three of
  six on a clip driven into clipping — are still encoded whole after the pass, and whatever of
  them was encoded before their peak crossed the line was encoded for nothing.
- **The pass is longer:** about a second for 6:20 on that busy host, 12–14 ms a chunk spent in
  `feed`.
- **A second rendering of julius' resampler is CHORD's now:** its frames, its kernel's width, its
  replicated ends and its float32 output length. A julius that changed any of them would make a
  streamed 48 kHz stem differ from a whole one, and unlike the recording nothing checks that at
  start-up. Piecewise and whole resampling matched in every sample on one GPU; with cuDNN off they
  didn't, so elsewhere the last bit of a sample may differ.
- **Two paths write stems,** and nothing but a comparison by hand keeps them equal.
- A cancelled pass leaves six unfinished FLACs in `stems.partial/`, closed, where it left an empty
  directory. Each job starts six more threads, and a thread's own priority exists only on Linux:
  elsewhere the encoders compete with the pass as equals.

## Tempo is librosa's, assembled in blocks

**Constraint:** CHORD wants the tempo `librosa.beat.beat_track` reports and never read the beat
positions it also returns. librosa estimates that tempo from a tempogram: one eight-second
autocorrelation window for every frame of the onset envelope, built for the whole track at once on
top of the whole track's spectrogram. For a 6:20 track that peaked 1,122 MiB above the process's
baseline, and it grows with the track — about 2 GiB at twelve minutes — on the
[analysis thread](#analysis-runs-beside-separation), while separation holds the track too. In a
4 GiB Docker VM that was already using its swap, tempo detection took 11–16 s for that track where
it takes 3.3 s with memory to spare, and the time it took grew faster than the track did.

**Choice:** `tempo.py` assembles the same estimate from librosa's own parts, a block at a time.
The mel spectrogram under the onset envelope is built 2048 frames at a time and handed to
`librosa.onset.onset_strength` as its `S`; the tempogram is computed 512 frames at a time and only
its running sum kept; `librosa.feature.tempo` picks the BPM from the mean. The envelope is the same
to the bit and the mean differs in its last bits, so the BPM is librosa's — equal on every case
tried. Peak memory is 154 MiB for that track, flat in its length, and the estimate takes 1.2 s
where `beat_track` took 3.3 s. The beat tracker never runs. See
[../features/tempo-and-metronome.md](../features/tempo-and-metronome.md#detection).

Not running the tracker also removed most of what numba compiled at start-up. What is left is
compiled once, at image build: the [`Dockerfile`](../../server/Dockerfile)'s last step runs
`tempo.warm_up()` as the server's user, so numba's cache is in the image and a new container's
warm-up is about 6 s where it was 29–40 s.

**Cost:** CHORD owns the way librosa 0.11 turns audio into a tempo — its STFT's centring and
padding, its eight-second window, its 120 BPM prior — spelled out as constants that have to stay
librosa's defaults for the result to stay librosa's. A librosa that changes any of them changes
`beat_track` and not CHORD. The equality was checked on one recording cut several ways and on
synthetic input, not on a library. A first beat time, which the
[metronome](../features/tempo-and-metronome.md#phase-alignment) wants, is now a tracker run that has
to be added, where before it was a return value being thrown away. And the build's warm-up step
sits after `COPY app`, so every code change reruns it, and numba keys its cache on the CPU: an image
built on one machine and run on another compiles again at its first start.

## A link's audio is kept as FLAC

**Constraint:** a link's audio arrives in whatever codec the site serves — Opus or AAC, usually —
and the pipeline wants one known file it can decode twice, once for separation and once for
analysis. It used to be a 192 kbps MP3, which libsndfile and both decoders read, at the price of
encoding it: 6.0 s of ffmpeg for a 6:20 track, before any work on it, and a second lossy encoding
between the source and the separation.

**Choice:** `FFmpegExtractAudio` writes a 16-bit FLAC, `original.flac`. ffmpeg does that in 1.6 s
for the same track, and the separation hears the source as it decoded. 16-bit is forced
(`-sample_fmt s16`), since ffmpeg would write a lossy codec's decoded samples as 24-bit for nothing;
a link that is already a FLAC is copied as it is. Because the file no longer says what the source
was, the download reports it: `audio_format` for a link is the codec yt-dlp names, written with the
title — `OPUS 48 kHz` where it used to read `MP3 48 kHz`, which was never the source either. See
[../features/ingest.md](../features/ingest.md#the-download).

**Cost:** disk — about 42 MB for six minutes where the MP3 was 9 MB, held until the job is
discarded, and read twice across a shared data directory. The label is a guess when yt-dlp doesn't
name a codec: a direct link to an `.m4a` or `.mp3` is labelled by its extension, and one to a
`.webm` gets the converted file's `FLAC 16/48`, which reads as lossless and isn't. `audio_format`
now has two writers, on two sides of the attempt guard, and means the file for an upload and the
source for a link. A job directory from before the change holds `original.mp3`, which a resumed
link job no longer looks for, so it downloads again.

## The database row is the only progress channel

**Constraint:** the worker thread and the HTTP request handlers are different threads; the UI
needs sub-second progress, and a cancel or resume has to reach a running job.

**Choice:** stages `UPDATE` the row; the SSE endpoint re-reads the row every 0.25 s and yields on
change. Control travels the same way in reverse: cancel and resume are row writes, and the worker
discovers them by re-reading the row. No queues, no pub/sub, no shared memory between the two.

**Cost:** up to 250 ms of latency, one SELECT per subscriber per tick, and a blocking SQLite read
from inside the async event loop — about 5 ms each where the data directory is a share of the
host's disk, as under Docker Desktop, so four ticks a second are 2% of the loop for every open
processing screen. Measured separation progress adds up to 75 writes per job, one
per 1% of the bar and never two within 0.25 s: a write the stream won't read before the next one is
a commit — 13 ms on such a share — on the thread that is feeding the GPU. The worker also re-reads the row every 2 s during separation to notice a cancel. Trivially
correct and trivially debuggable (`sqlite3` the file and you can see exactly what the UI will
show), which is worth more here than the efficiency.

## Cooperative cancellation

**Constraint:** you cannot safely interrupt a torch forward pass, a yt-dlp download or a
librosa/madmom analysis mid-flight.

**Choice:** cancel writes `status=cancelled`; the worker re-reads the row between stages and
returns early. Separation, the longest stage, checks as well: Demucs calls CHORD's progress
callback as each chunk starts, and that callback re-reads the row at most every 2 s and raises to
abandon the pass. Nothing half-written survives, because stems go to `stems.partial/` and are
renamed into place only once all six exist.

**Cost:** a cancel during a download still burns the whole download. Tempo and chord detection run
on the job's [analysis thread](#analysis-runs-beside-separation) and can't be stopped at all: the run
returns at its next checkpoint, but a step already running finishes on its own, unread, possibly
while the next job separates. During separation the cancel takes effect at the first chunk start at
least 2 s after the previous check — up to that interval plus one chunk of work. The UI reports
*Cancelled* immediately, which overstates what happened. See [job-lifecycle.md](job-lifecycle.md#cancelling).

## An attempt counter makes resume safe

**Constraint:** a cancelled job should resume without redoing finished work — but its cancelled
run may still be inside a stage when the user resumes, and resume flips the row back to `queued`,
which a status check alone would read as "carry on".

**Choice:** an internal `attempt` column, incremented by `POST /jobs/{id}/resume`. `run_job`
reads it once at the start; every write it makes is `UPDATE … WHERE id = ? AND attempt = ? AND
status != 'cancelled'`, and every checkpoint asks `_is_superseded` — row gone, `cancelled`, or a
different attempt. The resumed run reuses what the cancelled one finished: `original.flac` for a
URL job, and `stems/` when all six FLACs are present, which the rename-into-place makes
trustworthy.

**Cost:** a superseded write is dropped silently — `_update_job` never checks how many rows it
matched — so anything a later attempt needs and can't produce again has to opt out of the guard.
The title, uploader and source format a download finds are that case: the resumed run skips the
download, so `_record_track_identity` writes them by id alone, and they survive a cancel that lands
mid-download.
Any new write of that kind needs the same deliberate exception. `attempt` isn't in `JobResponse`,
so only `sqlite3` shows it. Resume accepts only `cancelled` — not `error` — and re-runs tempo and
chord detection even when the cancelled attempt had finished them. And it enqueues without knowing
whether the job is still waiting in the queue, so a job can be queued twice; `run_job` starting only
on a `queued` row is what turns the extra entry into a no-op. See
[job-lifecycle.md](job-lifecycle.md#resuming).

## A user-facing message and a separate log

**Constraint:** a failed job must tell the user something they can act on, but the `str()` of an
arbitrary library exception reads as internal — and whoever debugs the failure still needs that
text.

**Choice:** two columns. A [`UserFacingError`](../../server/app/pipeline/errors.py) — which
`SourceDownloadError` and `TrackTooLongError` subclass — is written for a person: its text becomes
`error_message` verbatim, and the exception it was raised `from` becomes `error_log`. Any other
exception gets a fixed sentence for the stage that failed as the message, and `"TypeName: text"`
as the log. The failure panel shows the message as its body and the log in a monospace block, and
*Copy log* copies the log — or the message, when there is no log.

**Cost:** the log is one line of text, not a traceback — the traceback still goes only to stderr.
A new failure reaches users in its own words only if its exception type opts in by subclassing
`UserFacingError`. The stage is coarse (downloading, reading, separating, tempo, analyzing), and it
never reaches the panel's title: every job error is titled *Separation failed*, the template's title,
so a failed download or an unreadable file says what happened only in its body.

## A duration limit, checked before separation

**Constraint:** six decoded stems of a long track outgrow what a browser tab can hold (see
[Web Audio](#web-audio-instead-of-audio-elements) above), and separating a track nobody can play
wastes the only worker.

**Choice:** `MAX_DURATION_SECONDS`, 720 by default, `0` to disable. A URL job is refused from
yt-dlp's metadata through a `match_filter`, before any audio downloads; every job is checked again
with `soundfile` once its audio is on disk, before separation. Both raise `TrackTooLongError`,
whose message names the limit and the track's length, rounded up to the second so that a track a
moment over a whole-minute limit never reads as exactly the limit.

**Cost:** long material — DJ mixes, live sets, long classical movements — can't be processed at
all, and the limit is a proxy for browser memory, not a measurement of it. The landing page's
*"up to 12 minutes"* is hardcoded in [`design/copy.ts`](../../web/src/design/copy.ts), so changing
the setting makes that copy wrong. An upload is refused only after it has been uploaded and queued,
and so is a link whose metadata carries no duration.

## Lyrics are fetched by the API, not the pipeline

**Constraint:** lyrics come from a third-party service (lrclib.net), are frequently absent, and
are irrelevant to an instrumental.

**Choice:** `GET /jobs/{id}/lyrics` does the lookup on first request and caches the result — the
JSON *or* a literal `null` — to `analysis/lyrics.json`. `PUT` on the same path overwrites that
cache with lyrics the user pasted, a cached `null` included.

**Cost:** the one place where an API handler does real work and makes an outbound network call,
breaking the otherwise-strict layering. The lookup is synchronous, so the handler is a plain `def`
that FastAPI runs in its threadpool — a first lookup holds a pool thread for its seconds instead of
stalling the event loop. In exchange, a lrclib outage
can never fail or delay a job, and songs nobody asks about are never looked up. Caching the `null`
matters: it's what stops a miss from re-querying on every mount. Pasted timing is kept exactly as
pasted, without the offset correction a lookup's synced lyrics get.

## Discard-on-leave

**Constraint:** no accounts, no sessions, no storage budget. Lossless stems run to a hundred MB or
more per song.

**Choice:** the browser fires `navigator.sendBeacon` at the discard endpoint on `pagehide` and on
effect cleanup; the server deletes the row and the directory for a finished job.

**Cost:** **there is no history.** Clicking *New track* destroys the job you were looking at,
and a cancelled job can be resumed only while its page stays open. A hard tab crash skips the
beacon. The job then waits for the [reaper](../data/retention.md#the-reaper), which deletes a
terminal job `JOB_TTL_HOURS` (24) after it last changed or last had a heartbeat, so a crashed tab's
stems stay on disk for up to a day. The reaper is a backstop, not the mechanism: deleting on leave
frees the disk as soon as a job is closed, where the reaper waits out the TTL. An open page sends
a heartbeat every 5 minutes, because playback makes no requests and the reaper has no other way to
tell a job in use from an abandoned one. `GET /jobs` still exists and lists everything, so the data model could support a
library — the client never asks for one.

## Sharps everywhere, normalized at the boundary

**Constraint:** madmom's key model emits flat spellings (`Db major`); the chord model emits
`C#:min`-style labels; the UI wants one convention.

**Choice:** normalize on the way in, inside
[`chords.py`](../../server/app/pipeline/chords.py) — `_FLAT_TO_SHARP` maps the seven flat names
to enharmonic sharps, and `_madmom_label_to_chord` rewrites `X:maj` → `X`, `X:min` → `Xm`.
Everything downstream (JSON, database, UI, transposition) deals only in sharps.

**Cost:** keys that musicians would write in flats display in sharps (`A# minor`, not
`Bb minor`). The 12-name `NOTE_NAMES` array is duplicated in
[`transpose.ts`](../../web/src/utils/transpose.ts) — client-side transposition needs it and there
is no shared module.

## Relative-key disambiguation by chord duration

**Constraint:** a CNN key classifier confuses a major key with its relative minor constantly —
they share a pitch-class set.

**Choice:** `_resolve_relative_ambiguity` totals the played duration of the tonic chord for each
candidate and picks the heavier one.

**Cost:** a heuristic, not a theory-complete answer; it can be wrong on modal or chromatic
material. When it switches to the relative key it keeps the classifier's confidence for the key
it overruled, so the *"N% confident"* beside the key can describe a key other than the one shown.
The transpose control can't repair a relative-key mistake either: it moves the root and keeps the
mode.

## Transposition is client-side and display-only

**Constraint:** a detected key is often a semitone off, or the player wants a capo position.

**Choice:** `transpose` is part of the design's `PlayerState`, clamped to ±11 by
[`playerReducer`](../../web/src/screens/results/playerReducer.ts) with `MIN_TRANSPOSE` and
`MAX_TRANSPOSE`, which are declared once, in [`design/player.ts`](../../web/src/design/player.ts) —
twelve semitones is the same pitch class as zero. `transposeChord` / `transposeKeyLabel` rewrite
labels at render time: the key, the current and upcoming chords, and every segment of the chord
strip.

**Cost:** nothing is re-analyzed and no audio is pitch-shifted — the chords you read no longer
match the chords you hear. That is the intended behavior (the control's hint says *"chords
follow"*; it's for a player following along with a capo), but it is a real semantic gap, and it
is not persisted anywhere: every visit starts at 0.

## The fader law is dB-linear over 36 dB

**Constraint:** a fader position has to read as a level, and each console strip's tick column is
evenly spaced — 0 / −12 / −24 / −∞ beside a stem, 0 / −6 / −18 / −∞ beside the master — columns
the template's demo mapping, 0…1 onto −12…0 dB, couldn't fill.

**Choice:** keep the template's `db()` — its instructions said to change only its body when the
audio graph's taper differs — and give it a 36 dB span. In [`design/player.ts`](../../web/src/design/player.ts)
a stem fader's position maps linearly onto −36…0 dB, with position 0 silent. The stem meter scale,
`STEM_METER_SCALE`, is linear over the same 36 dB, so a fader cap sits level with its tick. Level
faders and knobs share that law. The master fader follows its own ticks instead: `masterDb` runs
position through `MASTER_TICKS` — −36, −18, −6 and 0 dB at each third of the travel, the bottom
silent — and `MASTER_METER_SCALE` is derived from the same anchors, so the master cap, its meter
and its tick labels agree. The engine only ever receives linear gain, through `dbToGain`.

**Cost:** there is no boost — the top of every fader is unity, so a stem can't be raised above
its separated level. The bottom of the travel is a cliff, from −36 dB straight to silence. A
keyboard step is fixed in position, so one arrow press is 0.36 dB anywhere on a stem fader but
anything from 0.18 dB near the top of the master to 0.54 dB near its bottom. And the two laws
disagree about the same position: halfway up is −18 dB on a stem and −12 dB on the master.

## The UI was built from a design template

**Constraint:** the design arrived as a template in a `web/template/` folder, not as components:
written rules (`INSTRUCTIONS.md` and `README.md`), vendored stylesheets, a markup harness
(`CHORD Template.dc.html`) and a static Mockups board (`CHORD Mockups.dc.html`). The four didn't
always agree with each other, and the app had grown behavior none of them drew. The originals can
still be read from git, as `git show 2a9783e:web/template/template/INSTRUCTIONS.md` and
`git show "2a9783e:web/template/CHORD Template.dc.html"`.

**Choice:** build to the template and, where it disagreed with itself, take the written rules
first, then the stylesheets, then the harness markup, then the Mockups board. Once the UI was
built, the template's binding rules moved into [../conventions/design.md](../conventions/design.md),
which is now the design standard, with the screens in [`web/src/screens/`](../../web/src/screens/)
as its reference implementation, and the folder was removed. The screens' copy lives in
[`design/copy.ts`](../../web/src/design/copy.ts), verbatim from the harness unless marked
app-authored, and the template's state model in [`design/player.ts`](../../web/src/design/player.ts).
The calls that took a decision:

- **Phones follow the written rules, not the harness's phone frame.** The template's responsive
  rules let the stylesheet stack `.ch-stemrow` with 44 px MUTE/SOLO on a phone. The harness's phone
  frame drew a different screen — stem cards, a compact header with key and tempo, an *Export*
  chip, two upcoming chords — which the app used to follow. The rules outranked the markup, so a
  phone now gets the desktop screen reflowed
  ([what that costs](#narrow-screens-keep-all-three-views-scrolling-instead-of-scaling)).
- **Two template lines are reworded, because they promise behavior the app doesn't have.** The
  cancelled panel's *"The upload is still in your queue for 24 hours"* reads *"The upload is kept
  until you leave this page"*, since [leaving discards the job](#discard-on-leave); the connection
  panel's *Work offline* names a mode that doesn't exist, so it reads *New track*. Both are marked
  where they live in `copy.ts`.
- **The footer stays**, though the template had none; its strings are app-authored in `copy.ts`.
- **Four things the app had and the template didn't draw were removed:** the sticky transport,
  the upload progress bar, the loop A/B markers on the chord strip, and the speed chip on phones.
- **Solo shows before mute.** The written rules gave `.is-active` to a soloed strip and `.is-off` to
  a muted one without saying which wins; the harness picked solo, so a soloed Console strip or Analog
  module reads *Soloed* and lifts even when it is also muted. The audio is unchanged —
  [mute still beats solo](audio-playback.md#mute-solo-and-volume).
- **Every control shows its value, the Analog Tone and Pan knobs included.** The template's ground
  rules asked for a visible label and value on every control; the harness drew those two knobs with
  a label only, so the written rule won.
- **Loading stems is the template's `processing-loading` state:** the processing screen at 100%,
  *Loading stems…*. `PlaybackEngine.load` no longer reports
  progress.

**Cost:**

- A soloed, muted stem's strip and its audio disagree: it reads *Soloed* and lifts, and is silent.
- Waiting has no measure. An upload reads *Submitting…* and stem loading sits at 100% on
  *Loading stems…*, however long either takes and whichever part is slow.
- A set loop shows only in the loop chip's label.
- Every job error is titled *Separation failed*, the template's title, a failed download or an
  unreadable file included, so the body has to carry the specifics.
- A stem the design has no name or hue for isn't loaded at all; a Demucs model with a different
  stem set needs `STEM_KEYS` changed with it.
- With the template gone, nothing outside the code shows a screen as designed: a UI change is
  checked by hand against design.md and the existing screens
  ([Checking a UI change](../conventions/design.md#checking-a-ui-change)), and `npm run lint` checks
  tokens, classes and colours against the stylesheets, not copy or layout.

## A per-track accent hue, driven by one custom property

**Constraint:** the design defines CHORD's look as a token system — six low-chroma stem hues, two
status hues, the Nocturne neutral and accent ramps — and its contrast floors hold only for those
values; the app also wants each track's accent to follow its cover art, as it once did through
`useDominantColors`, which clustered the thumbnail into two accent colors at runtime and pushed the
result out as hex through inline styles and effects.

**Choice:** every accent-family token in [`nocturne.css`](../../web/src/styles/nocturne.css)
(`--color-accent`, `--color-accent-2` and their 100–900 ramps) is defined as `oklch(L C
var(--accent-hue))`, holding the design's lightness and chroma at each step and reading only the
hue from a variable. The page ground in [`index.css`](../../web/src/index.css) does the same at its
own three stops' lightness and chroma, so the ambient background tints along with the accent.
[`useAccentHue`](../../web/src/hooks/useAccentHue.ts) samples the job's
`thumbnail.jpg` on a small offscreen canvas
([`extractDominantHue`](../../web/src/utils/dominantHue.ts)), averages each pixel's OKLab chroma
vector — weighted by its own chroma, and excluding near-black and near-white pixels, so vivid areas
outweigh muted ones and neither extreme skews the result — and returns the resulting hue in
degrees. The hook sets `--accent-hue` on `document.documentElement` — the actual `:root` element,
not a nested div — because `--color-accent`'s `var(--accent-hue)` is resolved where `--color-accent`
itself is declared (nocturne.css's `:root` rule), not where a descendant later overrides the
variable; setting the override anywhere else leaves every accent-family token silently pinned to the
default. `--accent-hue` is registered via `@property` (`syntax: "<number>"`) so `:root`'s
`transition: --accent-hue 0.8s ease` can animate it directly — every `oklch()` expression that reads
it cross-fades as a side effect, with no per-token transition needed. It falls back to nocturne.css's
default (229.6, the brand blue) with no thumbnail, no hue yet, or the landing screen. A failed
extraction is retried up to three times (0.5s/1.5s/3s) before giving up, since the thumbnail file can
still be mid-write the instant `has_thumbnail` first turns true. `--accent-hue` is a fifth entry in
`RUNTIME_PROPERTIES` ([`check-design.mjs`](../../web/scripts/check-design.mjs)), alongside `--v`,
`--l`, `--p` and `--stem` — a deliberate, documented exception to
[ground rule 6](../conventions/design.md#ground-rules), "no new color": every value the hue can
produce still holds the design's own lightness and chroma, so contrast floors survive; only the hue
moves.

**Cost:** an accent-family color function in `nocturne.css` no longer names a single fixed shade —
reading one requires resolving `--accent-hue` first, and that resolution only happens correctly at
`:root` itself, not at an arbitrary descendant. `chord-theme.css`'s stem hues stay hardcoded
`oklch()`, hue and all, so vocals (`var(--color-accent)`) shift with the track, and drums, bass,
guitar and piano don't — this reproduces the old per-song accent's asymmetry, not a new one. Cover
art is same-origin (served by this app's own API), so no canvas-taint fallback is needed, unlike the
original `useDominantColors`. A transient wrong hue can still show for roughly a second on some jobs
— the retry logic only re-tries a *failed* read, not a *successful* read of a not-yet-final
thumbnail file, and this hasn't been root-caused on the server side. Extraction happens once per job
after the thumbnail exists, and holds the default hue until a hue resolves or retries run out.

## Vendored stylesheets, driven by custom properties

**Constraint:** the design arrived as a stylesheet plus markup to diff against (the template, since
removed), not as components, and many controls change continuously — fader drags,
meters at frame rate.

**Choice:** vendor `chord-theme.css` unmodified and `nocturne.css` with only its font `@import`
removed, import both before Tailwind, reproduce the template's markup element for element, and pass
runtime state as custom properties — `--v`, `--l`, `--p`, `--stem` — that the classes map onto
geometry and color. App CSS defines no classes of its own. See [web.md](web.md#styling).

**Cost:** the class contract is stringly typed, and every custom property needs an
`as React.CSSProperties` cast. The design check in `npm run lint` catches a `ch-`, `is-`, `btn` or
`dialog` class the stylesheets don't define, and a custom property outside the four, but only when
someone runs it. The 720px breakpoint lives in the stylesheet and is repeated by hand in
`PHONE_QUERY` and in Tailwind `max-[720px]:` utilities. Because the check also rejects a class
defined in app CSS, a departure from the design can't be a local override: it has to be a
composition of the vendored classes plus inline layout, or nothing. Both sheets are global and
unscoped. In exchange, a control update is one property write.

## Prop threading instead of context or a store

**Constraint:** all playback state has exactly one owner (`ResultsScreen`) and all consumers are
its descendants, at most three levels below it.

**Choice:** pass props. Per-stem state goes down as one `stems: StemDisplay[]` array, each entry
carrying the design's `StemState`, and the per-stem callbacks as one `controls: StemControls`
object, both rebuilt every render; the metering views receive a single `readMeters` callback rather
than the engine. `PlayerState` itself changes only through one reducer.

**Cost:** verbosity — `Transport` alone takes twelve props — and every new piece of state
touches several signatures. Because `stems` and `controls` are new objects on every render,
memoizing a view would gain nothing: any change to playback state renders the whole results tree.
The clock is the exception — it is [read, not stored](#the-playback-position-is-read-not-stored),
so playback itself doesn't render the tree; a control change does. In exchange the data flow is completely explicit, and no descendant can mutate
playback except through a callback it was handed.

## Three result views over one state

**Constraint:** the design presents the same mix three ways — Mixer (rows with waveforms),
Console (vertical faders and meters), Analog (knobs and needle dials) — and switching between
them must not interrupt playback.

**Choice:** `ResultsScreen` renders exactly one view into a panel, from the same `stems` and
`controls`; the topbar, analysis bar, chord bar and transport sit outside the panel and stay
mounted. No view holds playback state. See [../features/results-views.md](../features/results-views.md).

**Cost:** each view has its own per-stem component — `StemRow`, `ConsoleStrip`, `AnalogModule` —
because each followed the template harness's markup rather than a shared strip, and the copies can
drift. `ConsoleStrip` and `AnalogModule` both pick `is-active` / `is-off` solo first, as the harness
did,
and nothing but review keeps the two in step. The views don't expose the same controls either: Pan
and Tone can be changed only on the Analog knobs, and the Console shows pan as text. A switch
unmounts the old view, so its meter ballistics start over, and the choice isn't remembered —
results always open on Mixer. The payoff is that switching mid-song is immediate and seamless: the
engine never stops.

## Narrow screens keep all three views, scrolling instead of scaling

**Constraint:** Console strips need 112 px each, Analog modules 120 px and its dials 180 px, or
their controls collapse; a phone is about 360 px wide; and the page must never scroll.

**Choice:** a single breakpoint at 720px, below which the Mixer's rows stack and the transport
becomes `.ch-m-bar` (play, seek, a *Click* metronome chip) — the template's responsive rules, now
[Responsive](../conventions/design.md#responsive). The view tabs, though, stay available at every
width: a phone that locked to the Mixer with no way to reach Console or Analog made two of the
three views simply unreachable there, which the owner asked to fix. Console and Analog can't
shrink to a phone's width without breaking the floors above, so `FitToPanel` stays off for them
below 720px the same as it always was — but rather than leave the strip a horizontal-scrolling row
(the first cut, which the owner asked to redo), `ConsoleStrip`, `MasterStrip` and `AnalogModule`
take a `compact`/`isPhone` prop that turns each one from a tall column into a short horizontal bar
— the Console strip's name, fader-and-meter and value/pan/routing groups side by side instead of
stacked, wrapping to a second line where they don't all fit; the Analog module's name, knobs and
routing the same way, routing always forced to its own line with `flex: 1 0 100%` (the Mixer row's
own phone rule does the same for its routing pair) — and `.ch-striprow` itself switches from a
horizontal-scrolling row to a `flex-direction: column` stack of these bars, one per stem, each at
full width and its controls' full floor size. `ConsoleView` renders the master strip first on a
phone, ahead of the stem stack, instead of beside it. The Console strip and master strip's fader
column drops to an 84px minimum on a phone (170px off it), with tighter gaps and padding
(`--space-3` in place of `--space-4`/`--space-6`), since a compact bar has no documented height
floor to hold — only `.ch-strip`/`.ch-module`'s 112/120px *width* floors and the 44px touch targets
are load-bearing. Only Analog's *Output level* dial grid keeps a horizontal scroll — it wasn't part
of the "make it horizontal" ask, and five 180px dials have no shorter form — but it now scrolls
itself (`.ch-dial-scroll`, its own `overflow-x: auto`) rather than the whole view panel, with a
right-edge `mask-image` fade so the cut-off reads as "more here" instead of clipped content; the
view panel no longer needs `overflowX: auto` at all, since nothing else on a phone overflows
horizontally once the strips stack.
**The whole app is one viewport and never scrolls**
([Responsive](../conventions/design.md#responsive)), by the owner's standing request, and nothing
in it is cropped or hidden: screens share out the height instead of overflowing, a results view
that doesn't fit — too short, or narrower than its floors add up to — is scaled down whole by
`FitToPanel`, and below 720px the results view panel scrolls vertically through the stacked bars
(and horizontally only around the Analog dial grid), so a phone gets Console and Analog at their
full floor sizes instead of shrunk or sideways-scrolling ones. An earlier `ScaleToFit`
transform-scaled fixed-width layouts all the time, text included, and was replaced by reflow, then
by a phone layout built from the harness's phone frame, which the template's written rules
outranked ([why](#the-ui-was-built-from-a-design-template)). `FitToPanel` brings scaling back only
as a middle ground for a window too small for a view but not phone-narrow.

**Cost:** in a window too small for a view but at or above 720px, that view — its text, knobs and
hit targets included — is drawn smaller than the design's sizes: the Console view below 1140px
wide, Analog below 1020px, and any view in a short window. Below 720px, a stem's controls now split
across two or three lines rather than reading as one block, and the dial grid at the top of Analog
still needs a horizontal swipe to reach the last two or three dials, the fade its only cue that
there's more. On a narrow screen Pan,
Tone, every meter, speed and A–B looping are unreachable through the `.ch-m-bar` transport
regardless of which view is open — it has no speed or loop chip, and no time readouts. A speed or
loop set before the window narrowed stays in force with no control to change it. Stacking every
stem's bar, in any view, makes a long page under the analysis and chord bars — longest for Console
and Analog, whose bars run taller than the Mixer's. Resizing across the breakpoint keeps whichever
view was open.

## SQLite, no ORM, hand-rolled additive migrations

**Constraint:** single-node app, one writer, tiny schema.

**Choice:** raw `sqlite3` with `row_factory = sqlite3.Row`, a new connection per `db_cursor()`
block, and `init_db()` diffing `PRAGMA table_info` against a hardcoded `MIGRATED_COLUMNS` list.

**Cost:** additive changes only — no rename, no drop, no down-migration, no version table. Adding
a column means editing `SCHEMA` *and* `MIGRATED_COLUMNS`, as `error_log`, `audio_format` and
`attempt` were; a `NOT NULL` column such as `attempt` can be added only because it has a non-null
default, which SQLite requires for `ADD COLUMN`. A per-call connection is wasteful but completely
sidesteps SQLite's cross-thread rules between the worker and request handlers.

## The API contract is duplicated by hand

**Constraint:** Pydantic models on one side, TypeScript on the other.

**Choice:** hand-mirror them. `JobResponse` ↔ `Job`, `ChordSegment` ↔ `ChordSegment`,
`LyricsResponse` ↔ `Lyrics`, `JobStatus` ↔ a string union; `SaveLyricsRequest` has no named twin,
since `saveLyrics` builds `{ text }` inline. Part of the contract is values no type describes: the
stage messages, which [`design/copy.ts`](../../web/src/design/copy.ts) mirrors verbatim as
`processingCopy.stages` and [`design/stages.ts`](../../web/src/design/stages.ts) matches against
`stage_message`.

**Cost:** nothing enforces agreement; a server field rename — or a reworded stage message — is a
silent client break. FastAPI already publishes an OpenAPI schema at `/openapi.json`, so generating
the types is available whenever the duplication starts to hurt, though it wouldn't cover the
stage messages. See [../api/contract-sync.md](../api/contract-sync.md).

## madmom is patched in place

**Constraint:** madmom is the best available open chord/key detector and has been unmaintained
since 2018. It does not install on a modern Python/numpy.

**Choice:** keep it out of `requirements.txt`, install it with `--no-build-isolation`, then
`sed` the installed package in site-packages
([`patch_madmom.sh`](../../server/scripts/patch_madmom.sh)).

**Cost:** the ugliest part of the build, and the reason the server is pinned to Python 3.10. The
patches are two known breakages (`collections.MutableSequence`, removed `np.*` aliases); a third
would mean extending the script. `enable_chord_detection=False` exists as the escape hatch.

## The Demucs weights are baked into the image

**Constraint:** demucs 4.1 loads a named model from the Hugging Face Hub and caches it under
`HF_HOME`, which defaults to the container's `~/.cache` — outside the data volume. `TORCH_HOME`,
which `main.py` points at the volume, covers only demucs' legacy fallback. Left to the first job,
the weights were downloaded again after every rebuild.

**Choice:** download the weights during the image build into `/opt/models/huggingface`, and run
the server with `HF_HUB_OFFLINE=1` ([`server/Dockerfile`](../../server/Dockerfile)). The build
step calls `demucs.hf.get_hf_model` directly, so a failed download fails the build instead of
falling back silently.

**Cost:** the model is a build-time choice — `DEMUCS_MODEL` is a build argument, and a runtime
override to a different model downloads it from demucs' legacy repo on the first job. The image
grows by the weights (~53 MB for `htdemucs_6s`), and building needs the Hub reachable. In exchange
no job downloads anything and separation needs no network.
