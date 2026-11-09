// src/main/core/bg-session.ts
// Phiên chạy mô hình bằng onnxruntime-node (CPU). Nạp thư viện ở lần dùng đầu tiên để lỗi thư viện không làm app không khởi động được.
import fs from "fs";
import { UserFacingError } from "./douyin.js";
import type { MaskSession } from "./bgremove.js";

export interface OrtMaskSession extends MaskSession { release(): Promise<void>; }

/** Thư viện chạy AI có dùng được không (để giao diện báo lỗi rõ ràng thay vì treo). */
export function isOrtAvailable(): boolean {
  try { require.resolve("onnxruntime-node"); return true; } catch { return false; }
}

export async function createOrtSession(modelPath: string, threads: number): Promise<OrtMaskSession> {
  let ort: typeof import("onnxruntime-node");
  try { ort = require("onnxruntime-node"); }
  catch (e) { throw new UserFacingError(`Không nạp được bộ chạy AI (onnxruntime): ${(e as Error).message}. Hãy cài lại MediaGet.`); }

  // Nạp mô hình từ bộ nhớ (không truyền đường dẫn) để không phụ thuộc cách onnxruntime xử lý đường dẫn Unicode trên Windows.
  let bytes: Buffer;
  try { bytes = fs.readFileSync(modelPath); }
  catch { throw new UserFacingError("Không đọc được file mô hình. Hãy tải lại mô hình."); }

  let session;
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["cpu"], graphOptimizationLevel: "all", intraOpNumThreads: Math.max(1, threads),
      enableCpuMemArena: false, enableMemPattern: false,      // giảm ~25% RAM đỉnh, không chậm hơn (đã đo)
    });
  } catch (e) {
    throw new UserFacingError(`Không khởi tạo được mô hình (file hỏng hoặc thiếu RAM): ${(e as Error).message}`);
  }
  const inName = session.inputNames[0], outName = session.outputNames[0];
  return {
    async run(input, size) {
      const t = new ort.Tensor("float32", input, [1, 3, size, size]);
      try {
        const r = await session.run({ [inName]: t }, [outName]);
        return r[outName].data as Float32Array;
      } catch (e) {
        const msg = (e as Error).message;
        throw new UserFacingError(/alloc|memory/i.test(msg) ? "Không đủ RAM để xử lý ảnh với model này. Hãy chọn model nhẹ hơn." : `Mô hình báo lỗi: ${msg}`);
      }
    },
    async release() { try { await session.release(); } catch { /* ignore */ } },
  };
}
