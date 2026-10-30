// src/main/core/whisper.ts
// Cấu hình whisper.cpp (nhận diện giọng nói chạy offline): phiên bản được ghim + checksum, danh mục mô hình,
// tham số dòng lệnh, giải thích mã lỗi. Thuần logic, không phụ thuộc electron.
import type { WhisperModelId } from "../../shared/ipc-types.js";

/** Bản whisper.cpp được ghim (file nhị phân Windows x64 chạy CPU, kèm các DLL ggml). */
export const WHISPER_TAG = "v1.9.2";
export const WHISPER_ZIP = {
  url:    `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`,
  sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
  sizeMb: 8,
};
export const WHISPER_EXE_REL = "Release/whisper-cli.exe";

export const HF_HOSTS: readonly string[] = ["huggingface.co", "hf.co"];
const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export interface WhisperModel {
  file: string;
  sha1: string;     // SHA-1 do whisper.cpp công bố trong models/README.md (v1.9.2)
  sizeMb: number;
  label: string;
  desc: string;
}

export const WHISPER_MODELS: Record<WhisperModelId, WhisperModel> = {
  base: {
    file: "ggml-base.bin", sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac", sizeMb: 142,
    label: "Nhanh", desc: "Nhẹ và nhanh nhất, độ chính xác thấp hơn — hợp để thử hoặc máy yếu.",
  },
  small: {
    file: "ggml-small.bin", sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5", sizeMb: 466,
    label: "Cân bằng", desc: "Cân bằng giữa tốc độ và độ chính xác — khuyên dùng.",
  },
  turbo: {
    file: "ggml-large-v3-turbo-q5_0.bin", sha1: "e050f7970618a659205450ad97eb95a18d69c9ee", sizeMb: 547,
    label: "Chính xác", desc: "Chính xác nhất, chậm hơn và cần nhiều RAM hơn (khoảng 2 GB).",
  },
};

export const MODEL_IDS = Object.keys(WHISPER_MODELS) as WhisperModelId[];

export function isWhisperModelId(v: unknown): v is WhisperModelId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(WHISPER_MODELS, v);
}

export function modelUrl(id: WhisperModelId): string {
  return `${HF_BASE}/${WHISPER_MODELS[id].file}`;
}

/** Gợi ý nhận diện chữ giản thể (không có gợi ý, Whisper hay trả lẫn chữ phồn thể cho tiếng Quan Thoại). */
export const WHISPER_PROMPT_ZH = "以下是普通话的句子。";

export function pickThreads(cpuCount: number): number {
  const n = Number.isFinite(cpuCount) ? Math.floor(cpuCount) : 4;
  return Math.max(1, Math.min(8, n - 1));
}

/**
 * Tham số cho whisper-cli. Mọi đường dẫn là TƯƠNG ĐỐI so với thư mục chạy (cwd) — whisper-cli trên Windows
 * có thể lỗi với đường dẫn chứa ký tự không phải ASCII (vd. tên người dùng tiếng Việt), nên ta chỉ truyền
 * tên do chính app đặt.
 */
export function buildWhisperArgs(o: { modelRel: string; wavRel: string; outBaseRel: string; threads: number }): string[] {
  return [
    "-m", o.modelRel,
    "-f", o.wavRel,
    "-l", "zh",
    "-t", String(o.threads),
    "-sns",                       // bỏ token phi lời nói ([nhạc], (vỗ tay)...)
    "-pp",                        // in tiến trình ra stderr
    "--prompt", WHISPER_PROMPT_ZH,
    "-osrt",
    "-of", o.outBaseRel,
  ];
}

/** Mã thoát bất thường của whisper-cli → thông báo dễ hiểu. */
export function explainWhisperExit(code: number | null, stderrTail: string): string {
  const u = code === null ? null : code >>> 0;
  if (u === 0xC0000135) {
    return "Máy thiếu thư viện Microsoft Visual C++ Redistributable (x64). Hãy cài bản 2015–2022 từ trang chủ Microsoft rồi thử lại.";
  }
  if (u === 0xC000001D) return "CPU của máy không hỗ trợ tập lệnh mà công cụ nhận diện yêu cầu.";
  if (u === 0xC0000005 || /out of memory|bad_alloc|failed to allocate|not enough memory/i.test(stderrTail)) {
    return "Không đủ bộ nhớ để chạy mô hình này. Hãy đóng bớt ứng dụng hoặc chọn mô hình nhẹ hơn (Nhanh/Cân bằng).";
  }
  const last = stderrTail.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  return `Công cụ nhận diện bị lỗi (mã ${u ?? "?"})${last ? `: ${last.slice(0, 200)}` : "."}`;
}
