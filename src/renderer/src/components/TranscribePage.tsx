// src/renderer/src/components/TranscribePage.tsx
import React from "react";
import type { TranscribeApi } from "../hooks/useTranscribe";
import type { TranscribeSegment } from "../../../shared/ipc-types";

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#252a38] bg-[#181c27] p-4">
      <h2 className="text-[13px] font-semibold text-text">{title}</h2>
      {hint && <p className="text-[11px] text-muted mt-0.5 mb-3">{hint}</p>}
      {!hint && <div className="h-3" />}
      {children}
    </section>
  );
}

function fmtSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

/** 83450 → "01:23.4"; từ 1 giờ trở lên → "1:01:23.4". Cắt xuống 1/10 giây (không làm tròn, tránh "00:60.0"). */
export function fmtTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 100);
  const h = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const s = Math.floor((tenths % 600) / 10);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}.${tenths % 10}` : `${mm}:${ss}.${tenths % 10}`;
}

const STAGE_LABEL: Record<string, string> = {
  tools: "Chuẩn bị công cụ", model: "Tải mô hình", audio: "Trích âm thanh", recognize: "Nhận diện giọng nói",
};

function SegmentRow({ seg }: { seg: TranscribeSegment }) {
  return (
    <div className="flex gap-3 py-1.5 border-b border-[#252a38] last:border-0">
      <span className="shrink-0 w-[118px] font-mono text-[11px] text-muted pt-[1px] select-none">
        {fmtTime(seg.startMs)} → {fmtTime(seg.endMs)}
      </span>
      <span className="text-[13px] text-text leading-relaxed whitespace-pre-wrap break-words select-text">{seg.text}</span>
    </div>
  );
}

export function TranscribePage({ api }: { api: TranscribeApi }) {
  const { state, pickFile, setModel, start, cancel, saveSrt, copyText } = api;
  const { file, model, status, phase, progress, segments, error, notice, noticeIsError } = state;
  const running = phase === "running";
  const selected = status?.models.find(m => m.id === model);
  const needsDownload = !!status && (!status.toolsInstalled || !selected?.installed);
  const btn = "h-8 px-3 rounded text-[12px] transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div>
        <h1 className="text-[15px] font-semibold text-text">Trích xuất văn bản</h1>
        <p className="text-[12px] text-subtle mt-0.5">
          Nhận diện giọng nói tiếng Trung trong file âm thanh/video thành văn bản kèm mốc thời gian, xuất ra file phụ đề <span className="font-mono">transcript.srt</span>.
          Chạy hoàn toàn trên máy bạn, không gửi file đi đâu.
        </p>
      </div>

      <Card title="1. Chọn file" hint="Hỗ trợ MP3, WAV, M4A, FLAC, MP4, MKV, MOV, WEBM... (âm thanh được tách tự động từ video).">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={pickFile} disabled={running}
            className={`${btn} bg-accent/15 hover:bg-accent/25 text-accent font-medium`}>
            {file ? "Chọn file khác..." : "Chọn file..."}
          </button>
          {file ? (
            <span className="text-[12px] text-text break-all min-w-0" title={file.name}>
              {file.name} <span className="text-muted">· {fmtSize(file.sizeBytes)}</span>
            </span>
          ) : (
            <span className="text-[12px] text-muted">Chưa chọn file</span>
          )}
        </div>
      </Card>

      <Card title="2. Chất lượng nhận diện"
        hint={needsDownload
          ? "Lần đầu dùng, app sẽ tải công cụ và mô hình (một lần duy nhất, cần mạng). Các lần sau chạy offline."
          : "Mô hình lớn hơn chính xác hơn nhưng chạy chậm hơn."}>
        <div className="space-y-2" role="radiogroup" aria-label="Chất lượng nhận diện">
          {(status?.models ?? []).map(m => (
            <label key={m.id}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors
                ${model === m.id ? "border-accent/60 bg-accent/5" : "border-[#252a38] hover:border-[#3a4258]"}
                ${running ? "opacity-60 pointer-events-none" : ""}`}>
              <input type="radio" name="whisper-model" className="mt-1 accent-[#3b82f6]"
                checked={model === m.id} onChange={() => setModel(m.id)} disabled={running} />
              <span className="flex-1 min-w-0">
                <span className="text-[13px] text-text font-medium">{m.label}</span>
                <span className="text-[11px] text-muted"> · {m.sizeMb} MB</span>
                <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full border
                  ${m.installed ? "border-emerald-500/40 text-emerald-400" : "border-[#3a4258] text-muted"}`}>
                  {m.installed ? "Đã tải" : "Cần tải"}
                </span>
                <span className="block text-[11px] text-subtle mt-0.5">{m.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {!running ? (
          <button type="button" onClick={start} disabled={!file || !status}
            className={`${btn} h-9 px-5 bg-accent hover:brightness-110 text-white font-medium`}>
            Bắt đầu trích xuất
          </button>
        ) : (
          <button type="button" onClick={cancel}
            className={`${btn} h-9 px-5 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>
            Huỷ
          </button>
        )}
        {!file && phase === "idle" && <span className="text-[12px] text-muted">Hãy chọn một file để bắt đầu.</span>}
      </div>

      {running && progress && (
        <Card title={STAGE_LABEL[progress.stage] ?? "Đang xử lý"}>
          <div className="h-2 rounded-full bg-[#252a38] overflow-hidden" role="progressbar"
            aria-valuenow={Math.round(progress.percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="flex justify-between mt-2 text-[12px]">
            <span className="text-subtle break-words min-w-0">{progress.message}</span>
            <span className="text-muted tabular-nums shrink-0 ml-3">{Math.round(progress.percent)}%</span>
          </div>
          {progress.stage === "recognize" && (
            <p className="text-[11px] text-muted mt-2">File dài có thể mất vài phút. Bạn có thể chuyển sang tab khác, việc nhận diện vẫn tiếp tục.</p>
          )}
        </Card>
      )}

      {phase === "error" && error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-[12px] text-red-400 whitespace-pre-wrap break-words">
          {error}
        </div>
      )}

      {phase === "done" && (
        <Card title={`Kết quả · ${segments.length} đoạn`}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button type="button" onClick={saveSrt} className={`${btn} bg-accent/15 hover:bg-accent/25 text-accent font-medium`}>
              Lưu transcript.srt
            </button>
            <button type="button" onClick={copyText} className={`${btn} bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>
              Sao chép văn bản
            </button>
            {notice && <span className={`text-[12px] ${noticeIsError ? "text-red-400" : "text-emerald-400"}`}>{notice}</span>}
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-lg bg-[#0f1117] border border-[#252a38] px-3">
            {segments.map((s, i) => <SegmentRow key={i} seg={s} />)}
          </div>
          <p className="text-[11px] text-muted mt-2">
            Kết quả do AI nhận diện nên có thể sai ở tên riêng, từ hiếm hoặc đoạn nhiều tạp âm — hãy đọc lại trước khi dùng.
          </p>
        </Card>
      )}

      {phase !== "done" && notice && (
        <p className={`text-[12px] ${noticeIsError ? "text-red-400" : "text-emerald-400"}`}>{notice}</p>
      )}
    </div>
  );
}
