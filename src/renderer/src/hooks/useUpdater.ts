// src/renderer/src/hooks/useUpdater.ts
import { useEffect, useState, useCallback } from "react";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "ready"
  | "error"
  | "dismissed";

export interface UpdaterState {
  phase: UpdatePhase;
  version?: string;
  releaseNotes?: string;
  percent?: number;       // 0-100 while downloading
  errorMsg?: string;
}

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });

  useEffect(() => {
    const off = (window as any).api?.onUpdaterStatus?.((raw: any) => {
      switch (raw?.phase) {
        case "checking":
          setState({ phase: "checking" });
          break;
        case "available":
          setState({ phase: "available", version: raw.version, releaseNotes: raw.releaseNotes });
          break;
        case "not-available":
          setState({ phase: "not-available" });
          break;
        case "downloading":
          setState(prev => ({ ...prev, phase: "downloading", percent: raw.percent ?? 0 }));
          break;
        case "ready":
          setState({ phase: "ready", version: raw.version });
          break;
        case "error":
          setState({ phase: "error", errorMsg: raw.message });
          break;
        default:
          break;
      }
    });
    return () => off?.();
  }, []);

  const dismiss = useCallback(() => {
    setState(prev => ({ ...prev, phase: "dismissed" }));
  }, []);

  const downloadNow = useCallback(async () => {
    setState(prev => ({ ...prev, phase: "downloading", percent: 0 }));
    await (window as any).api?.downloadUpdate?.();
  }, []);

  const installNow = useCallback(async () => {
    await (window as any).api?.installUpdate?.();
  }, []);

  return { state, dismiss, downloadNow, installNow };
}
