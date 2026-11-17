import { useEffect, useState } from "react";
import type { DealRow, Keys, Report, StartupProfile, VerifiedDeal } from "./types";

const SETTINGS = "tinyfund.settings";
const RUNS = "tinyfund.runs";

export function loadKeys(): Keys {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SETTINGS) ?? "{}");
  } catch {
    return {};
  }
}
export function saveKeys(k: Keys) {
  localStorage.setItem(SETTINGS, JSON.stringify(k));
  window.dispatchEvent(new Event("tinyfund-settings"));
}

export function useKeys(): Keys {
  const [k, setK] = useState<Keys>({});
  useEffect(() => {
    const up = () => setK(loadKeys());
    up();
    window.addEventListener("tinyfund-settings", up);
    return () => window.removeEventListener("tinyfund-settings", up);
  }, []);
  return k;
}

export interface RunRecord {
  id: string;
  datasetId: string;
  createdAt: string;
  profile: StartupProfile;
  phase: "populating" | "verifying" | "discovering" | "ranking" | "done" | "error" | "cancelled";
  /** phase the run was in when it errored or was cancelled */
  stoppedFrom?: RunRecord["phase"] | undefined;
  deals: DealRow[];
  verified?: VerifiedDeal[] | undefined;
  report?: Report | undefined;
  error?: string | undefined;
}

export function loadRuns(): RunRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RUNS) ?? "[]");
  } catch {
    return [];
  }
}
export function getRun(datasetId: string) {
  return loadRuns().find((r) => r.datasetId === datasetId);
}
export function saveRun(r: RunRecord) {
  const all = loadRuns().filter((x) => x.datasetId !== r.datasetId);
  localStorage.setItem(RUNS, JSON.stringify([r, ...all].slice(0, 30)));
}
export function deleteRun(datasetId: string) {
  localStorage.setItem(RUNS, JSON.stringify(loadRuns().filter((x) => x.datasetId !== datasetId)));
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
