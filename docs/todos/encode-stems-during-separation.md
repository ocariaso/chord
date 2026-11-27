# Encode the stems while separation runs

Write each stem's FLAC as its audio becomes final, during the model's pass, instead of converting
and encoding all six after it.

## Today

- [`separate()`](../../server/app/pipeline/separation.py) does three things in a row: decode the
  track, run the model over it chunk by chunk (`_separate`), then `_write_stems` — convert each stem
  to 16-bit on the device (`_to_pcm16`) and encode it to FLAC on a few threads.
- Measured on an RTX 4060 under Docker Desktop with 2 CPUs, for a 6:20 track from a 48 kHz source:
  about 0.8 s decoding, a pass of about 7.0 s, then **2.2–3.8 s converting and encoding**. That
  tail is the second largest part of the job, and the part that varies most, because it is the
  CPU's: about 1.9 s of encoding across the encoder threads, the conversions one after another on
  the worker thread, and 130 MB written to the data directory.
- The pass no longer needs the CPU. Replayed from a
  [recorded CUDA graph](../architecture/decisions.md#the-separation-model-is-replayed-from-a-recorded-cuda-graph),
  a chunk costs the worker thread about 6 ms, and the analysis beside it is done within the first
  few seconds. For most of those 7 s the cores are idle while the encoding waits its turn.
- The progress bar shows the tail as a hold near 85%
  ([troubleshooting](../operations/troubleshooting.md#the-progress-bar-sits-at-10)).

## Why

It is the largest thing left in a GPU job that isn't the model, and the work is already there to
be overlapped: nothing about encoding a stem's first minute depends on its last, with one
exception (the clip rescale, below).

## Change

In `_apply_model`, a stretch of the overlap-add is final once the next chunk's start has passed
it: every chunk that covers it has been added. So after each chunk:

- Normalize the newly final stretch in place (`out[..., a:b] /= total_weight[a:b]`), in place of the
  one division at the end, and hand it on. Dividing each sample once by its final weight gives the
  same values.
- Apply to a copy of that stretch what `_separate` applies to the whole track afterwards — the
  bag's source weight and the denormalization, elementwise, so the same in pieces — then the
  16-bit conversion, and send each stem's block to its encoder.
- Keep one open `soundfile.SoundFile` per stem, in `stems.partial/` as now, and write its blocks in
  order: one thread per stem, or a few threads with each stem always on the same one. libFLAC cuts
  frames by sample count, not by write call, so the file should come out byte for byte the one a
  single `sf.write` makes; check that.
- With a recording in use the loop already waits for every chunk, so a stretch can be queued
  behind the *next* chunk's replay and read back when that wait ends. The GPU then never idles for
  it.

Three things need care:

- **`prevent_clip`.** `_to_pcm16` scales a stem down as a whole when `1.01 × peak` exceeds 1, and
  the peak isn't known until the stem is finished. Encode at scale 1, which is right for every stem
  that stays under 1/1.01; keep a running peak per stem on the GPU; and at the end re-encode, from
  the whole stem as today, any stem that went over. The whole separated track therefore still stays
  on the GPU for the length of the pass, as it does now. On a loud master, expect a stem or two to
  be encoded twice.
- **48 kHz sources.** Stems from one are resampled back from the model's 44.1 kHz with
  `julius.resample_frac`, which today sees a whole stem. In pieces, each piece needs the kernel's
  26 samples of real audio either side (replicated samples only at the track's two ends) and must
  start on a multiple of 147 input samples, which become 160 output samples. The arithmetic per
  output sample is the same, but a convolution over a different length may not round the same
  way, so the result can differ from the whole-stem resample in the last bit. Either show that it
  doesn't, or accept that 48 kHz stems are no longer bit for bit what
  [the FLAC record](../architecture/decisions.md#stems-are-stored-as-flac-and-exported-as-wav)
  says they are, and say so there.
- **What stays as it is.** A bag of more than one model adds the models' estimates after the last
  pass, so nothing is final during any of them; a GPU without room for the track accumulates in
  RAM; a CPU has no idle cores to use. All three keep `_write_stems`. So does a pass that half
  precision has to [run again](../features/stem-separation.md#how-a-chunk-runs-on-a-gpu) — the
  files started for it have to be thrown away first.

A pass abandoned by a cancel has open files: close them on the way out. `stems.partial/` is still
renamed into place only when every stem is complete, so nothing about
[resume](../features/stem-separation.md#resume) changes.

## Done when

- For a 44.1 kHz source the six FLACs are byte-identical to today's, with the same random shift.
  For a 48 kHz source they are too, or the difference is measured and documented.
- A track loud enough that a stem clips produces the same files as today, by way of the re-encode.
- A 6:20 job on the reference machine is shorter by most of the tail: about 9 s where it is 10.6
  to 12.6 s.
- A cancel in the middle of a pass leaves no open file handles, and the next attempt starts clean.
- A multi-model bag, a CPU run and a run with `DEMUCS_CUDA_GRAPH=false` still produce correct stems.

## Works with

Independent. It makes [tests-and-ci.md](tests-and-ci.md) more worth having: the byte-for-byte
comparison above is exactly a test.

## Docs to update

[../features/stem-separation.md](../features/stem-separation.md) (*Output*, *Progress* — the hold
near 85% goes — and *Cost and timing*), the costs of
[the FLAC record](../architecture/decisions.md#stems-are-stored-as-flac-and-exported-as-wav) and of
[the chunk loop record](../architecture/decisions.md#chord-runs-demucs-chunk-loop-itself),
[../operations/troubleshooting.md](../operations/troubleshooting.md) (*The progress bar sits at
10%*, *Where a job's time goes*), and the map entry for `separation.py`.
