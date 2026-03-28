// src/renderer/src/components/StatusBar.tsx
interface Props {
  total: number;
  active: number;
  done: number;
  failed: number;
  onClearCompleted: () => void;
}

export function StatusBar({ total, active, done, failed, onClearCompleted }: Props) {
  return (
    <div className="h-6 flex items-center justify-between px-3 bg-[#0a0d14] border-t border-[#1e2333] shrink-0 text-[10px] text-muted">
      <div className="flex items-center gap-3">
        {active > 0 && (
          <span className="text-accent">● {active} đang tải</span>
        )}
        {done > 0 && (
          <span className="text-success">✓ {done} hoàn thành</span>
        )}
        {failed > 0 && (
          <span className="text-danger">✗ {failed} lỗi</span>
        )}
        {total === 0 && <span>Sẵn sàng</span>}
      </div>

      <div className="flex items-center gap-3">
        {(done > 0 || failed > 0) && (
          <button
            onClick={onClearCompleted}
            className="hover:text-subtle transition-colors"
          >
            Xóa đã xong
          </button>
        )}
        <span>Hỗ trợ YouTube, TikTok, Facebook và 1000+ trang</span>
      </div>
    </div>
  );
}
