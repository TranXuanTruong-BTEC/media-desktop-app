// src/renderer/src/hooks/useBgRemove.ts — trạng thái trang "Tách nền ảnh". Đặt ở App để giữ khi chuyển tab.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BgBackground, BgDone, BgImage, BgInfo, BgModelId, BgModelProgress, BgPickResult, BgProgress } from "../../../shared/ipc-types";

export type BgChoice = "transparent" | "white" | "black" | "custom" | "mask";

export interface BgItem extends BgImage {
  status: "pending" | "processing" | "done" | "error";
  result?: { preview: string; width: number; height: number; hasAlpha: boolean; ms: number };
  error?: string;
}

const LS = { model: "mediaget.bg.model", bg: "mediaget.bg.choice", color: "mediaget.bg.color", refine: "mediaget.bg.refine" };
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), x => x.toString(16).padStart(2, "0")).join("");

export function toBackground(choice: BgChoice, custom: string): BgBackground {
  switch (choice) {
    case "white": return { type: "color", color: "#ffffff" };
    case "black": return { type: "color", color: "#000000" };
    case "custom": return { type: "color", color: custom };
    case "mask": return { type: "mask" };
    default: return { type: "transparent" };
  }
}

export function useBgRemove() {
  const [info, setInfo] = useState<BgInfo | null>(null);
  const [items, setItems] = useState<BgItem[]>([]);
  const [modelId, setModelId] = useState<BgModelId>(() => (["fast", "general", "portrait"].includes(get(LS.model) ?? "") ? get(LS.model) as BgModelId : "general"));
  const [choice, setChoice] = useState<BgChoice>(() => (["transparent", "white", "black", "custom", "mask"].includes(get(LS.bg) ?? "") ? get(LS.bg) as BgChoice : "transparent"));
  const [customColor, setCustomColorState] = useState<string>(() => (/^#[0-9a-f]{6}$/i.test(get(LS.color) ?? "") ? get(LS.color)! : "#00c853"));
  const [refine, setRefineState] = useState<boolean>(() => get(LS.refine) !== "0");
  const [dl, setDl] = useState<BgModelProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BgProgress | null>(null);
  const [lastDone, setLastDone] = useState<BgDone | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const jobId = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, error = false) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ text, error });
    timer.current = setTimeout(() => setNotice(null), 7000);
  }, []);

  const refresh = useCallback(async () => { try { setInfo(await window.api.getBgInfo()); } catch { /* ignore */ } }, []);

  useEffect(() => {
    void refresh();
    const offM = window.api.onBgModelProgress(p => setDl(p));
    const offP = window.api.onBgProgress(p => {
      if (p.id !== jobId.current) return;
      setProgress(p);
    });
    const offD = window.api.onBgItemDone(d => {
      if (d.id !== jobId.current) return;
      setItems(list => list.map(it => it.token === d.token ? { ...it, status: "done", error: undefined, result: { preview: d.preview, width: d.width, height: d.height, hasAlpha: d.hasAlpha, ms: d.ms } } : it));
    });
    const offE = window.api.onBgItemError(e => {
      if (e.id !== jobId.current) return;
      setItems(list => list.map(it => it.token === e.token ? { ...it, status: "error", error: e.message } : it));
    });
    const offF = window.api.onBgDone(d => {
      if (d.id !== jobId.current) return;
      setRunning(false); setProgress(null); setLastDone(d);
      setItems(list => list.map(it => it.status === "processing" ? { ...it, status: "pending" } : it));   // bị huỷ giữa chừng
    });
    return () => { offM(); offP(); offD(); offE(); offF(); if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);

  const addImages = useCallback((r: BgPickResult) => {
    if (r.canceled) return;
    if (!r.ok || !r.images) { say(r.error ?? "Không thêm được ảnh.", true); return; }
    setItems(list => {
      const have = new Set(list.map(i => i.token));
      return [...list, ...r.images!.filter(i => !have.has(i.token)).map<BgItem>(i => ({ ...i, status: "pending" }))];
    });
    if (r.skipped) say(`Đã bỏ qua ${r.skipped} file không phải ảnh hợp lệ.`, false);
  }, [say]);

  const pick = useCallback(async () => { addImages(await window.api.pickBgImages()); }, [addImages]);
  const drop = useCallback(async (files: File[]) => {
    const paths = files.map(f => window.api.getPathForFile(f)).filter(Boolean);
    if (!paths.length) { say("Không lấy được đường dẫn file đã thả vào.", true); return; }
    addImages(await window.api.addDroppedBgImages(paths));
  }, [addImages, say]);

  const removeItem = useCallback((token: string) => setItems(l => l.filter(i => i.token !== token)), []);
  const clearAll = useCallback(async () => { const r = await window.api.clearBg(); if (!r.ok) { say(r.error ?? "Không xoá được.", true); return; } setItems([]); setLastDone(null); }, [say]);

  const selectModel = useCallback((id: BgModelId) => { setModelId(id); put(LS.model, id); }, []);
  const setBg = useCallback((c: BgChoice) => { setChoice(c); put(LS.bg, c); }, []);
  const setCustomColor = useCallback((c: string) => { setCustomColorState(c); put(LS.color, c); }, []);
  const setRefine = useCallback((v: boolean) => { setRefineState(v); put(LS.refine, v ? "1" : "0"); }, []);

  const downloadModel = useCallback(async (id: BgModelId) => {
    setDl({ id, percent: 0, message: "Đang bắt đầu tải..." });
    try {
      const r = await window.api.downloadBgModel(id);
      if (!r.ok && !r.canceled) say(r.error ?? "Tải model thất bại.", true);
    } finally { setDl(null); void refresh(); }
  }, [refresh, say]);
  const cancelDownload = useCallback((id: BgModelId) => window.api.cancelBgModelDownload(id), []);

  /** all=true: xử lý lại cả ảnh đã xong (dùng khi đổi model/nền). */
  const start = useCallback(async (all = false) => {
    const target = items.filter(i => all || i.status === "pending" || i.status === "error");
    if (!target.length || running) return;
    const id = uid();
    jobId.current = id;
    setRunning(true); setLastDone(null); setProgress({ id, index: 0, total: target.length, name: "", percent: 0, message: "Đang chuẩn bị..." });
    const tokens = new Set(target.map(t => t.token));
    setItems(list => list.map(i => tokens.has(i.token) ? { ...i, status: "processing", error: undefined } : i));
    const r = await window.api.startBg({ id, tokens: target.map(t => t.token), model: modelId, background: toBackground(choice, customColor), refine });
    if (!r.ok) {
      jobId.current = null; setRunning(false); setProgress(null);
      setItems(list => list.map(i => tokens.has(i.token) ? { ...i, status: "pending" } : i));
      say(r.error ?? "Không bắt đầu được.", true);
    }
  }, [items, running, modelId, choice, customColor, refine, say]);

  const cancel = useCallback(() => { if (jobId.current) window.api.cancelBg(jobId.current); }, []);

  const save = useCallback(async (token: string) => {
    if (!jobId.current) return;
    const r = await window.api.saveBgImage(jobId.current, token);
    if (!r.canceled) say(r.ok ? "Đã lưu ảnh." : (r.error ?? "Không lưu được."), !r.ok);
  }, [say]);
  const saveAll = useCallback(async () => {
    if (!jobId.current) return;
    const r = await window.api.saveAllBg(jobId.current);
    if (!r.canceled) say(r.ok ? `Đã lưu ${r.saved ?? 0} ảnh.` : (r.error ?? "Không lưu được."), !r.ok);
  }, [say]);
  const copy = useCallback(async (token: string) => {
    if (!jobId.current) return;
    const r = await window.api.copyBgImage(jobId.current, token);
    say(r.ok ? "Đã sao chép ảnh — dán (Ctrl+V) vào CapCut, Photoshop, Word..." : (r.error ?? "Không sao chép được."), !r.ok);
  }, [say]);

  return { info, items, modelId, choice, customColor, refine, dl, running, progress, lastDone, notice,
    refresh, pick, drop, removeItem, clearAll, selectModel, setBg, setCustomColor, setRefine, downloadModel, cancelDownload, start, cancel, save, saveAll, copy };
}
export type BgApi = ReturnType<typeof useBgRemove>;
