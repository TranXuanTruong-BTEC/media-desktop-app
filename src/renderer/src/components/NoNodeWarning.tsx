// src/renderer/src/components/NoNodeWarning.tsx
export function NoNodeWarning() {
  return (
    <div className="mx-3 mt-2 px-3 py-2 bg-warn/10 border border-warn/30 rounded text-[11px] text-warn/90 flex items-start gap-2">
      <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0 mt-0.5">
        <path d="M8 2L14 13H2L8 2z" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M8 6v3M8 10.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
      <span>
        <strong>Lưu ý:</strong> Để tải YouTube có âm thanh, hãy đặt{" "}
        <code className="bg-white/10 px-1 rounded">node.exe</code> vào thư mục{" "}
        <code className="bg-white/10 px-1 rounded">tools/</code>.{" "}
        Tải tại:{" "}
        <a
          href="https://nodejs.org/dist/latest/win-x64/node.exe"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-warn"
          onClick={e => { e.preventDefault(); /* open via shell */ }}
        >
          nodejs.org/dist/latest/win-x64/node.exe
        </a>
      </span>
    </div>
  );
}
