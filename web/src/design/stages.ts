import type { Job } from "../api/client";
import { processingCopy } from "./copy";

/**
 * The template's stage list (README §4). A fixed contract, so the layout never jumps: a skipped stage
 * shows as done. The labels are also the API's `stage_message` values.
 */
export const PROCESSING_STAGES = processingCopy.stages;

export const QUEUED_STAGE = 0;
export const SEPARATING_STAGE = 2;
const DETECTING_TEMPO_STAGE = 3;
export const DETECTING_CHORDS_STAGE = 4;

/** An index into PROCESSING_STAGES from `status` and `stage_message`, or its length once the job is past them all. */
export function processingStage(job: Job): number {
  switch (job.status) {
    case "queued":
      return QUEUED_STAGE;
    case "fetching":
      return 1;
    case "separating":
      // Tempo detection runs under the separating status; only the stage message tells them apart.
      return job.stage_message === PROCESSING_STAGES[DETECTING_TEMPO_STAGE] ? DETECTING_TEMPO_STAGE : SEPARATING_STAGE;
    case "analyzing":
      return DETECTING_CHORDS_STAGE;
    default:
      return PROCESSING_STAGES.length;
  }
}
