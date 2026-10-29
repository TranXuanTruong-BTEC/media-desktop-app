import React, { useState } from "react";
import type { TranscribeApi } from "../hooks/useTranscribe";

interface Props {
  t: TranscribeApi;
  outputDir: string;
  onSelectDir: () => void;
  onOpenPath: (p: string) => void;
}

const STAGE: Record<string, string> = {
  extract:    "Đang tách âm thanh…",
  transcribe: "Đang nhận diện giọng nói…",
  finalize:   "Đang lưu file…",
};

function fmtSize(mb: number) { return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`; }

export function TranscribePage({ t, outputDir, onSelectDir, onOpenPath }: Props) {
  const [over, setOver] = useState(false);
  const { info, file, modelId, dl, dlMsg, job } = t;
  const model   = info?.models.find(m => m.id === modelId);
  const running = job.status === "running";
  const missing = info && (!info.whisperFound || !info.ffmpegFound);
  const canStart = !!file && !!model?.installed && !running && !!outputDir && !missing;
  const btn = "h-8 px-3 rounded text-[12px] transition-colors whitespace-nowrap disabled:opacity-50";

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      <div>
        <h1 className="text-[15px] font-semibold text-text">Trích xuất văn bản</h1>
        <p className="text-[12px] text-subtle mt-0.5">
          Nhận diện lời nói tiếng Trung từ video/audio, xuất file <code className="text-accent">transcript.srt</code> kèm mốc thời gian (nhập thẳng vào CapCut). Chạy hoàn toàn trên máy bạn.
        </p>
      </div>

      {missing && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-300">
          {!info!.whisperFound
            ? "Thiếu thành phần nhận diện giọng nói (whisper-cli). Hãy cài lại bản MediaGet mới nhất."
            : "Không tìm thấy ffmpeg."}
        </div>
      )}

      {/* 1. File */}
      <section
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) t.dropFile(f); }}
        onClick={() => !running && t.pickFile()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${over ? "border-accent bg-accent/10" : "border-[#3a4258] bg-[#181c27] hover:border-[#4b5568]"}`}
      >
        {file ? (
          <>
            <p className="text-[13px] text-text font-medium break-all">{file.name}</p>
            <p className="text-[11px] text-muted mt-1">Bấm hoặc thả file khác vào để đổi</p>
          </>
        ) : (
          <>
            <p className="text-[13px] text-subtle">Thả video/audio vào đây, hoặc bấm để chọn file</p>
            <p className="text-[11px] text-muted mt-1">MP4, MKV, MOV, MP3, M4A, WAV…</p>
          </>
        )}
      </section>

      {/* 2. Model */}
      <section className="rounded-xl border border-[#252a38] bg-[#181c27] p-4">
        <h2 className="text-[13px] font-semibold text-text">Model nhận diện</h2>
        <p className="text-[11px] text-muted mt-0.5 mb-3">Lần đầu cần tải model về máy (một lần duy nhất), sau đó dùng offline.</p>
        <div className="space-y-2">
          {info?.models.map(m => {
            const selected = m.id === modelId;
            const downloading = dl?.id === m.id;
            return (
              <div key={m.id}
                onClick={() => !running && t.selectModel(m.id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${selected ? "border-accent bg-accent/10" : "border-[#252a38] hover:border-[#3a4258]"}`}>
                <span className={`w-3.5 h-3.5 rounded-full border ${selected ? "border-accent bg-accent" : "border-[#4b5568]"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-text">{m.label} <span className="text-muted">· {fmtSize(m.sizeMB)}</span></p>
                  <p className="text-[11px] text-muted">{m.desc}</p>
                  {downloading && (
                    <div className="mt-1.5 h-1.5 rounded bg-[#0f1117] overflow-hidden">
                      <div className="h-full bg-accent transition-all" style={{ width: `${dl!.percent}%` }} />
                    </div>
                  )}
                </div>
                {m.installed ? (
                  <span className="text-[11px] text-emerald-400 shrink-0">Đã tải</span>
                ) : downloading ? (
                  <button type="button" className={`${btn} bg-[#252a38] text-subtle hover:text-text`}
                    onClick={e => { e.stopPropagation(); t.cancelModelDownload(m.id); }}>
                    Huỷ {dl!.percent}%
                  </button>
                ) : (
                  <button type="button" disabled={!!dl}
                    className={`${btn} bg-accent/15 hover:bg-accent/25 text-accent font-medium`}
                    onClick={e => { e.stopPropagation(); void t.downloadModel(m.id); }}>
                    Tải model
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {dlMsg && <p className={`mt-2 text-[12px] ${dlMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{dlMsg.text}</p>}
      </section>

      {/* 3. Output */}
      <section className="rounded-xl border border-[#252a38] bg-[#181c27] p-4">
        <h2 className="text-[13px] font-semibold text-text">Lưu kết quả</h2>
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 min-w-0 truncate text-[12px] text-subtle" title={outputDir}>{outputDir || "…"}</p>
          <button type="button" disabled={running} onClick={onSelectDir}
            className={`${btn} bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>Đổi thư mục</button>
        </div>
        <p className="text-[11px] text-muted mt-1.5 break-all">
          → {outputDir ? `${outputDir}\\` : ""}{file ? file.name.replace(/\.[^.]+$/, "") : "<tên file>"}\transcript.srt
        </p>
      </section>

      {/* 4. Run */}
      <section className="rounded-xl border border-[#252a38] bg-[#181c27] p-4">
        {job.status !== "running" && (
          <button type="button" disabled={!canStart} onClick={() => void t.start(outputDir)}
            className={`${btn} h-9 px-4 bg-accent text-white font-medium hover:opacity-90`}>
            Bắt đầu trích xuất
          </button>
        )}
        {!file && job.status === "idle" && <p className="text-[11px] text-muted mt-2">Chọn file video/audio để bắt đầu.</p>}
        {file && model && !model.installed && job.status === "idle" && (
          <p className="text-[11px] text-amber-300 mt-2">Cần tải model "{model.label}" trước.</p>
        )}

        {job.status === "running" && (
          <div>
            <div className="flex items-center justify-between text-[12px] mb-1.5">
              <span className="text-text">{STAGE[job.stage]}</span>
              <span className="text-subtle">{job.percent}%</span>
            </div>
            <div className="h-2 rounded bg-[#0f1117] overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${job.percent}%` }} />
            </div>
            {job.text && <p className="mt-2 text-[12px] text-subtle truncate">{job.text}</p>}
            <button type="button" onClick={t.cancel}
              className={`${btn} mt-3 bg-[#252a38] hover:bg-[#2f3547] text-subtle hover:text-text`}>Huỷ</button>
          </div>
        )}

        {job.status === "error" && <p className="mt-3 text-[12px] text-red-400 whitespace-pre-wrap">{job.message}</p>}

        {job.status === "done" && (
          <div className="mt-3">
            <p className="text-[12px] text-emerald-400">
              Hoàn tất: {job.result.segments} đoạn{job.result.dropped ? ` (đã lọc ${job.result.dropped} đoạn nhiễu/lặp)` : ""}.
            </p>
            <div className="mt-2 rounded-lg bg-[#0f1117] border border-[#252a38] p-2.5 space-y-1">
              {job.result.preview.map((l, i) => <p key={i} className="text-[12px] text-subtle truncate">{l}</p>)}
            </div>
            <p className="text-[11px] text-muted mt-2 break-all">{job.result.srtPath}</p>
            <button type="button" onClick={() => onOpenPath(job.result.srtPath)}
              className={`${btn} mt-2 bg-accent/15 hover:bg-accent/25 text-accent font-medium`}>Mở thư mục chứa file</button>
          </div>
        )}
      </section>
    </div>
  );
}
