// src/renderer/src/hooks/useYtdlpUpdater.ts
import { useEffect, useState, useCallback } from "react";

export type YtdlpPhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "update-found"
  | "downloading"
  | "updated"
  | "error"
  | "not-found";

export interface YtdlpUpdaterState {
  phase:          YtdlpPhase;
  currentVersion?: string;
  latestVersion?:  string;
  percent?:        number;
  errorMsg?:       string;
}

export function useYtdlpUpdater() {
  const [state, setState] = useState<YtdlpUpdaterState>({ phase: "idle" });

  useEffect(() => {
    const api = (window as any).api;
    if (!api?.onYtdlpStatus) return;

    const off = api.onYtdlpStatus((raw: any) => {
      switch (raw?.phase) {
        case "checking":
          setState({ phase: "checking" });
          break;
        case "up-to-date":
          setState({ phase: "up-to-date", currentVersion: raw.version });
          break;
        case "update-found":
          setState({ phase: "update-found", currentVersion: raw.current, latestVersion: raw.latest });
          break;
        case "downloading":
          setState(prev => ({ ...prev, phase: "downloading", percent: raw.percent ?? 0, latestVersion: raw.latest }));
          break;
        case "updated":
          setState({ phase: "updated", currentVersion: raw.version });
          break;
        case "error":
          setState({ phase: "error", errorMsg: raw.message });
          break;
        case "not-found":
          setState({ phase: "not-found" });
          break;
      }
    });

    return () => off?.();
  }, []);

  const checkNow    = useCallback(() => (window as any).api?.checkYtdlp?.(),        []);
  const forceUpdate = useCallback(() => (window as any).api?.forceUpdateYtdlp?.(),  []);
  const dismiss     = useCallback(() => setState({ phase: "idle" }),                 []);

  return { state, checkNow, forceUpdate, dismiss };
}
