export type JobStatus = "queued" | "fetching" | "separating" | "analyzing" | "done" | "error" | "cancelled";

export interface Job {
  id: string;
  original_filename: string;
  author: string | null;
  status: JobStatus;
  progress: number;
  stage_message: string | null;
  error_message: string | null;
  stems_model: string | null;
  duration_seconds: number | null;
  key_estimate: string | null;
  key_confidence: number | null;
  tempo_bpm: number | null;
  created_at: string;
  updated_at: string;
  stem_names: string[];
  has_thumbnail: boolean;
}

export interface ChordSegment {
  start: number;
  end: number;
  chord: string;
  confidence: number;
}

export interface LyricsLine {
  time: number;
  text: string;
}

export interface Lyrics {
  synced: LyricsLine[] | null;
  plain: string | null;
}

const API_BASE = "/api";

export async function createJob(file: File): Promise<Job> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/jobs`, { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function createJobFromUrl(url: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed to start download (${res.status})`);
  }
  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Failed to fetch job (${res.status})`);
  return res.json();
}

export function jobEventsUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/events`;
}

export function cancelJobUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/cancel`;
}

export function discardJobUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/discard`;
}

export async function cancelJob(jobId: string): Promise<Job> {
  const res = await fetch(cancelJobUrl(jobId), { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed to cancel job (${res.status})`);
  }
  return res.json();
}

export function stemUrl(jobId: string, stemName: string): string {
  return `${API_BASE}/jobs/${jobId}/stems/${stemName}.wav`;
}

export function thumbnailUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/thumbnail.jpg`;
}

export function downloadAllUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/download`;
}

export async function getChords(jobId: string): Promise<ChordSegment[]> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/chords`);
  if (!res.ok) throw new Error(`Failed to fetch chords (${res.status})`);
  return res.json();
}

/** Returns null if no lyrics were found for this job. */
export async function getLyrics(jobId: string): Promise<Lyrics | null> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/lyrics`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch lyrics (${res.status})`);
  return res.json();
}
