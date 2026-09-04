export type JobStatus = "queued" | "separating" | "analyzing" | "done" | "error";

export interface Job {
  id: string;
  original_filename: string;
  status: JobStatus;
  progress: number;
  stage_message: string | null;
  error_message: string | null;
  stems_model: string | null;
  duration_seconds: number | null;
  key_estimate: string | null;
  key_confidence: number | null;
  created_at: string;
  updated_at: string;
  stem_names: string[];
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

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Failed to fetch job (${res.status})`);
  return res.json();
}

export async function listJobs(): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/jobs`);
  if (!res.ok) throw new Error(`Failed to fetch jobs (${res.status})`);
  return res.json();
}

export function jobEventsUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/events`;
}

export function stemUrl(jobId: string, stemName: string): string {
  return `${API_BASE}/jobs/${jobId}/stems/${stemName}.wav`;
}
