// src/renderer/src/components/BgRemovePage.tsx — Tách nền ảnh (AI chạy trên máy, không gửi ảnh đi đâu)
import React, { useState } from "react";
import type { BgApi, BgChoice } from "../hooks/useBgRemove";

const CHECKER: React.CSSProperties = {
  backgroundColor: "#1c2030",
  backgroundImage: "linear-gradient(45deg,#2b3042 25%,transparent 25%),linear-gradient(-45deg,#2b3042 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2b3042 75%),linear-gradient(-45deg,transparent 75%,#2b3042 75%)",
  backgroundSize: "16px 16px", backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
};

const BG_CHOICES: Array<{ id: BgChoice; label: string }> = [
  { id: "transparent", label: "Trong suốt" }, { id: "white", label: "Trắng" }, { id: "black", label: "Đen" },
  { id: "custom", label: "Màu khác" }, { id: "mask", label: "Chỉ mặt nạ" },
];

const btn = "h-8 px-3 rounded text-[12px] transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed";
const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#252a38] bg-[#181c27] p-4">
      <h2 className="text-[13px] font-semibold text-text">{title}</h2>
      {hint && <p className="text-[11px] text-muted mt-0.5">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function BgRemovePage({ api }: { api: BgApi }) {
  const { info, items, modelId, choice, customColor, refine, dl, running, progress, lastDone, notice } = api;
  const [over, setOver] = useState(false);
  const model = info?.models.find(m => m.id === modelId);
  const pending = items.filter(i => i.status === "pending" || i.status === "error").length;
  const doneCount = items.filter(i => i.status === "done").length;
  const missing = info && (!info.ffmpegFound || !info.runtimeOk);
  const canRun = !running && !missing && !!model?.installed && pending > 0;

  const previewBg = (): React.CSSProperties => choice === "white" ? { backgroundColor: "#fff" } : choice === "black" ? { backgroundColor: "#000" } : choice === "custom" ? { backgroundColor: customColor } : choice === "mask" ? { backgroundColor: "#000" } : CHECKER;

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      <div>
        <h1 className="text-[15px] font-semibold text-text">Tách nền ảnh</h1>
        <p className="text-[12px] text-subtle mt-0.5">
          AI tự tìm chủ thể và xoá nền, xuất PNG nền trong suốt (hoặc thay bằng màu). Chạy hoàn toàn trên máy bạn — ảnh không bị gửi đi đâu.
        </p>
      </div>

      {missing && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-300">
          {!info!.runtimeOk ? "Thiếu bộ chạy AI (onnxruntime). Hãy cài lại MediaGet bản mới nhất." : "Không tìm thấy ffmpeg.exe."}
        </div>
      )}

      {/* 1. Ảnh */}
      <section
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (!running) void api.drop(Array.from(e.dataTransfer.files ?? [])); }}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${over ? "border-accent bg-accent/10" : "border-[#3a4258] bg-[#181c27]"}`}
      >
        <p className="text-[13px] text-subtle">Thả nhiều ảnh vào đây, hoặc</p>
        <div className="mt-2 flex justify-center gap-2">
          <button type="button" disabled={running} onClick={() => void api.pick()} className={`${btn} h-9 px-4 bg-accent text-white font-medium hover:brightness-110`}>Chọn ảnh…</button>
          {items.length > 0 && <button type="button" disabled={running} onClick={() => void api.clearAll()} className={`${btn} h-9 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>Xoá danh sách</button>}
        </div>
        <p className="text-[11px] text-muted mt-2">PNG, JPG, WebP, BMP, GIF, TIFF · tối đa 100 ảnh mỗi lần · {items.length > 0 ? `${items.length} ảnh trong danh sách` : "chưa có ảnh"}</p>
      </section>

      {/* 2. Tuỳ chọn */}
      <Card title="Tuỳ chọn">
        <p className="text-[11px] text-subtle mb-1.5">Model AI</p>
        <div className="space-y-2">
          {info?.models.map(m => {
            const selected = m.id === modelId, downloading = dl?.id === m.id;
            return (
              <div key={m.id} onClick={() => !running && api.selectModel(m.id)}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${selected ? "border-accent/60 bg-accent/5" : "border-[#252a38] hover:border-[#3a4258]"}`}>
                <span className={`mt-1 w-3.5 h-3.5 shrink-0 rounded-full border ${selected ? "border-accent bg-accent" : "border-[#4b5568]"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-text">{m.label} <span className="text-muted">· {m.sizeMb} MB</span></p>
                  <p className="text-[11px] text-muted">{m.desc}</p>
                  {downloading && (
                    <div className="mt-1.5">
                      <div className="h-1.5 rounded bg-[#0f1117] overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${dl!.percent}%` }} /></div>
                      <p className="text-[10px] text-muted mt-0.5 break-words">{dl!.message}</p>
                    </div>
                  )}
                </div>
                {m.installed ? <span className="text-[11px] text-emerald-400 shrink-0 mt-0.5">Đã tải</span>
                  : downloading ? <button type="button" className={`${btn} bg-[#252a38] text-subtle hover:text-text`} onClick={e => { e.stopPropagation(); api.cancelDownload(m.id); }}>Huỷ</button>
                  : <button type="button" disabled={!!dl || running} className={`${btn} bg-accent/15 hover:bg-accent/25 text-accent font-medium`} onClick={e => { e.stopPropagation(); void api.downloadModel(m.id); }}>Tải model</button>}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted mt-1.5">Lần đầu cần tải model về máy (một lần duy nhất, kiểm tra toàn vẹn sau khi tải), sau đó dùng offline.</p>

        <p className="text-[11px] text-subtle mt-4 mb-1.5">Nền của kết quả</p>
        <div className="flex flex-wrap items-center gap-2">
          {BG_CHOICES.map(c => (
            <button key={c.id} type="button" disabled={running} onClick={() => api.setBg(c.id)}
              className={`${btn} border ${choice === c.id ? "border-accent/60 bg-accent/10 text-text" : "border-[#252a38] text-subtle hover:text-text hover:border-[#3a4258]"}`}>{c.label}</button>
          ))}
          {choice === "custom" && (
            <input type="color" value={customColor} disabled={running} onChange={e => api.setCustomColor(e.target.value)}
              className="h-8 w-10 rounded border border-[#3a4258] bg-transparent cursor-pointer" aria-label="Chọn màu nền" />
          )}
        </div>
        <label className="flex items-start gap-2 mt-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-[#3b82f6]" checked={refine} disabled={running} onChange={e => api.setRefine(e.target.checked)} />
          <span className="text-[12px] text-text">Làm sạch viền <span className="text-muted">(bớt quầng mờ quanh chủ thể; tắt nếu muốn giữ viền mềm tự nhiên như tóc/lông)</span></span>
        </label>
      </Card>

      {/* 3. Chạy */}
      <section className="rounded-xl border border-[#252a38] bg-[#181c27] p-4">
        <div className="flex flex-wrap items-center gap-2">
          {!running ? (
            <>
              <button type="button" disabled={!canRun} onClick={() => void api.start(false)} className={`${btn} h-9 px-5 bg-accent text-white font-medium hover:brightness-110`}>
                Tách nền{pending > 0 ? ` (${pending} ảnh)` : ""}
              </button>
              {doneCount > 0 && pending === 0 && !!model?.installed && !missing && (
                <button type="button" onClick={() => void api.start(true)} className={`${btn} h-9 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>Xử lý lại tất cả với cài đặt hiện tại</button>
              )}
              {doneCount > 1 && <button type="button" onClick={() => void api.saveAll()} className={`${btn} h-9 bg-accent/15 hover:bg-accent/25 text-accent font-medium`}>Lưu tất cả ({doneCount})…</button>}
            </>
          ) : (
            <button type="button" onClick={api.cancel} className={`${btn} h-9 px-5 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>Huỷ</button>
          )}
          {notice && <span className={`text-[12px] break-words ${notice.error ? "text-red-400" : "text-emerald-400"}`}>{notice.text}</span>}
        </div>
        {!items.length && <p className="text-[11px] text-muted mt-2">Chọn hoặc thả ảnh vào để bắt đầu.</p>}
        {items.length > 0 && model && !model.installed && !running && <p className="text-[11px] text-amber-300 mt-2">Cần tải model "{model.label}" trước.</p>}
        {running && progress && (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-[#252a38] overflow-hidden" role="progressbar" aria-valuenow={Math.round(progress.percent)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progress.percent}%` }} />
            </div>
            <div className="flex justify-between mt-2 text-[12px]">
              <span className="text-subtle break-words min-w-0">Ảnh {Math.min(progress.index + 1, progress.total)}/{progress.total}{progress.name ? ` · ${progress.name}` : ""} · {progress.message}</span>
              <span className="text-muted tabular-nums shrink-0 ml-3">{Math.round(progress.percent)}%</span>
            </div>
          </div>
        )}
        {!running && lastDone && (
          <p className="text-[12px] text-subtle mt-2">
            {lastDone.cancelled ? "Đã huỷ. " : ""}Xong {lastDone.ok} ảnh{lastDone.failed ? `, ${lastDone.failed} ảnh lỗi` : ""}.
          </p>
        )}
      </section>

      {/* 4. Kết quả */}
      {items.length > 0 && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
          {items.map(it => (
            <div key={it.token} className="rounded-xl border border-[#252a38] bg-[#181c27] overflow-hidden flex flex-col">
              <div className="relative aspect-square flex items-center justify-center" style={it.status === "done" ? previewBg() : { backgroundColor: "#141823" }}>
                {it.status === "done" && it.result
                  ? <img src={it.result.preview} alt={it.name} className="max-w-full max-h-full object-contain" draggable={false} />
                  : <img src={it.thumb} alt={it.name} className={`max-w-full max-h-full object-contain ${it.status === "processing" ? "opacity-50" : ""}`} draggable={false} />}
                {it.status === "done" && <img src={it.thumb} alt="Ảnh gốc" title="Ảnh gốc" className="absolute left-1.5 top-1.5 w-11 h-11 object-cover rounded border border-white/30 shadow" draggable={false} />}
                {it.status === "processing" && <span className="absolute bottom-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">Đang xử lý…</span>}
                {!running && <button type="button" onClick={() => api.removeItem(it.token)} title="Bỏ ảnh này" className="absolute right-1.5 top-1.5 w-5 h-5 rounded bg-black/55 text-white text-[11px] leading-none hover:bg-black/80">×</button>}
              </div>
              <div className="p-2.5 space-y-1.5">
                <p className="text-[12px] text-text truncate" title={it.name}>{it.name}</p>
                <p className="text-[10px] text-muted">{it.status === "done" && it.result ? `${it.result.width}×${it.result.height} · ${(it.result.ms / 1000).toFixed(1)} giây` : fmtSize(it.sizeBytes)}</p>
                {it.status === "error" && <p className="text-[11px] text-red-400 break-words">{it.error}</p>}
                {it.status === "done" && (
                  <div className="flex gap-1.5 pt-0.5">
                    <button type="button" onClick={() => void api.save(it.token)} className={`${btn} h-7 px-2.5 flex-1 bg-accent/15 hover:bg-accent/25 text-accent font-medium`}>Lưu…</button>
                    <button type="button" onClick={() => void api.copy(it.token)} className={`${btn} h-7 px-2.5 flex-1 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>Sao chép</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
