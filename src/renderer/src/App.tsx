// src/renderer/src/App.tsx
import { useState, useEffect } from "react";
import { useDownload } from "./hooks/useDownload";
import { DownloadForm } from "./components/DownloadForm";
import { DownloadItemRow } from "./components/DownloadItem";
import { StatusBar } from "./components/StatusBar";
import { Titlebar } from "./components/Titlebar";
import { VideoQuality } from "../../shared/ipc-types";

export default function App() {
  const [outputDir, setOutputDir] = useState("");
  const { items, addDownload, cancelDownload, removeItem, clearCompleted, selectOutputDir, stats } = useDownload(outputDir);

  useEffect(() => {
    window.api?.getDefaultDir?.().then(d => { if (d) setOutputDir(d); }).catch(() => {});
  }, []);

  async function handleSelectDir() {
    const dir = await selectOutputDir();
    if (dir) setOutputDir(dir);
  }

  function handleSubmit(url: string, quality: VideoQuality, dir: string) {
    addDownload(url, quality, dir);
  }

  function handleOpenFolder(id: string) {
    const item = items.find(i => i.id === id);
    if (item) {
      (window as any).api?.openPath?.(item.outputDir);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#0f1117] text-text overflow-hidden">
      {/* Title bar */}
      <Titlebar activeCount={stats.active} />

      {/* Add download form */}
      <DownloadForm
        outputDir={outputDir}
        onOutputDirChange={setOutputDir}
        onSelectDir={handleSelectDir}
        onSubmit={handleSubmit}
      />

      {/* Download list */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <Empty />
        ) : (
          items.map(item => (
            <DownloadItemRow
              key={item.id}
              item={item}
              onCancel={cancelDownload}
              onRemove={removeItem}
              onOpenFolder={handleOpenFolder}
            />
          ))
        )}
      </div>

      {/* Status bar */}
      <StatusBar
        total={stats.total}
        active={stats.active}
        done={stats.done}
        failed={stats.failed}
        onClearCompleted={clearCompleted}
      />
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted select-none">
      <div className="w-12 h-12 rounded-xl bg-[#181c27] border border-[#252a38] flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
          <path d="M12 3v12M9 12l3 3 3-3M5 19h14" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div className="text-center">
        <p className="text-[13px] text-subtle mb-1">Chưa có video nào trong hàng đợi</p>
        <p className="text-[11px]">Dán link vào ô trên để bắt đầu tải</p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center mt-1">
        {["YouTube", "TikTok", "Facebook", "Twitter", "Instagram"].map(s => (
          <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-[#181c27] border border-[#252a38] text-muted">{s}</span>
        ))}
      </div>
    </div>
  );
}
