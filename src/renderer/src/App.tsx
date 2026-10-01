// src/renderer/src/App.tsx
import { useState, useEffect } from "react";
import { useDownload }         from "./hooks/useDownload";
import { useUpdater }          from "./hooks/useUpdater";
import { useYtdlpUpdater }     from "./hooks/useYtdlpUpdater";
import { DownloadForm }        from "./components/DownloadForm";
import { DownloadItemRow }     from "./components/DownloadItem";
import { StatusBar }           from "./components/StatusBar";
import { Titlebar }            from "./components/Titlebar";
import { UpdateDialog }        from "./components/UpdateDialog";
import { YtdlpUpdateBanner }   from "./components/YtdlpUpdateBanner";
import { Sidebar, NavId }      from "./components/Sidebar";
import { SettingsPage }        from "./components/SettingsPage";
import { AboutPage }           from "./components/AboutPage";
import { ConfirmDialog }       from "./components/ConfirmDialog";
import { VideoQuality }        from "../../shared/ipc-types";

const SIDEBAR_KEY = "mediaget.sidebarCollapsed";

interface DialogState {
  title:        string;
  message:      string;
  confirmText?: string;
  cancelText?:  string | null;
  danger?:      boolean;
  onConfirm:    () => void;
}

export default function App() {
  const [outputDir, setOutputDir]   = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [nav, setNav]               = useState<NavId>("download");
  const [dialog, setDialog]         = useState<DialogState | null>(null);
  const [clearKey, setClearKey]     = useState(0);
  const [collapsed, setCollapsed]   = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "1"; }
    catch { return false; }
  });

  const {
    items, history, addDownload, cancelDownload, retryDownload, removeItem, clearCompleted,
    removeHistory, clearHistory, findDuplicate, selectOutputDir, stats,
  } = useDownload(outputDir);
  const { state: updaterState, dismiss, downloadNow, installNow } = useUpdater();
  const { state: ytdlpState, checkNow, forceUpdate, dismiss: dismissYtdlp } = useYtdlpUpdater();

  useEffect(() => {
    window.api?.getDefaultDir?.().then(d => { if (d) setOutputDir(d); }).catch(() => {});
    (window as any).api?.getAppVersion?.().then((v: string) => { if (v) setAppVersion(v); }).catch(() => {});
    setTimeout(() => { (window as any).api?.checkForUpdate?.(); }, 2000);
  }, []);

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  async function handleSelectDir() {
    const dir = await selectOutputDir();
    if (dir) setOutputDir(dir);
  }

  function startNew(url: string, quality: VideoQuality, dir: string) {
    addDownload(url, quality, dir);
    setClearKey(k => k + 1);   // chỉ xoá ô nhập khi link thực sự được nhận
    setNav("download");
  }

  function handleSubmit(url: string, quality: VideoQuality, dir: string) {
    const dup = findDuplicate(url);

    if (dup?.state === "active") {
      setDialog({
        title: "Link đang được tải",
        message: "Link này đang tải hoặc đang chờ trong hàng đợi.",
        confirmText: "Đã hiểu",
        cancelText: null,
        onConfirm: () => setDialog(null),
      });
      return;
    }

    if (dup?.state === "done") {
      setDialog({
        title: "Link đã tải trước đó",
        message: `Link này đã được tải xong trước đây${dup.item.filename ? `:\n${dup.item.filename}` : "."}\n\nBạn vẫn muốn tải lại?`,
        confirmText: "Tải lại",
        cancelText: "Không",
        onConfirm: () => { setDialog(null); startNew(url, quality, dir); },
      });
      return;
    }

    startNew(url, quality, dir);
  }

  function handleRetry(id: string) {
    retryDownload(id);
    setNav("download");
  }

  function handleOpenFolder(id: string) {
    const item = items.find(i => i.id === id) ?? history.find(i => i.id === id);
    if (item) (window as any).api?.openPath?.(item.filepath || item.outputDir);
  }

  return (
    <div className="relative flex flex-col h-screen bg-[#0f1117] text-text overflow-hidden">
      <Titlebar activeCount={stats.active} />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          active={nav}
          collapsed={collapsed}
          onSelect={setNav}
          onToggleCollapse={toggleCollapsed}
          activeDownloads={stats.active}
          historyCount={history.length}
        />

        <div className="flex flex-col flex-1 min-w-0">
          {nav === "download" && (
            <>
              <DownloadForm
                outputDir={outputDir}
                onOutputDirChange={setOutputDir}
                onSelectDir={handleSelectDir}
                onSubmit={handleSubmit}
                clearKey={clearKey}
              />
              <YtdlpUpdateBanner
                state={ytdlpState}
                onForce={forceUpdate}
                onDismiss={dismissYtdlp}
              />
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
                      onRetry={handleRetry}
                      onOpenFolder={handleOpenFolder}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {nav === "history" && (
            <div className="flex-1 flex flex-col min-h-0">
              {history.length > 0 && (
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#1e2333] text-[11px] text-muted shrink-0">
                  <span>{history.length} mục đã lưu — dùng để phát hiện link trùng</span>
                  <button
                    onClick={() => setDialog({
                      title: "Xoá toàn bộ lịch sử?",
                      message: "Sau khi xoá, app sẽ không còn nhận ra các link đã tải để cảnh báo trùng.",
                      confirmText: "Xoá lịch sử",
                      cancelText: "Huỷ",
                      danger: true,
                      onConfirm: () => { clearHistory(); setDialog(null); },
                    })}
                    className="hover:text-danger transition-colors"
                  >
                    Xoá lịch sử
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {history.length === 0 ? (
                  <EmptyHistory />
                ) : (
                  history.map(item => (
                    <DownloadItemRow
                      key={item.id}
                      item={item}
                      onCancel={cancelDownload}
                      onRemove={removeHistory}
                      onRetry={handleRetry}
                      onOpenFolder={handleOpenFolder}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {nav === "settings" && (
            <SettingsPage
              outputDir={outputDir}
              onSelectDir={handleSelectDir}
              ytdlpState={ytdlpState}
              onCheckYtdlp={checkNow}
              onForceYtdlp={forceUpdate}
              updaterState={updaterState}
              onCheckAppUpdate={() => (window as any).api?.checkForUpdate?.()}
              version={appVersion}
            />
          )}

          {nav === "about" && <AboutPage version={appVersion} />}

          {(nav === "convert" || nav === "trim" || nav === "compress" || nav === "audio") && (
            <ComingSoon page={nav} />
          )}
        </div>
      </div>

      <StatusBar
        total={stats.total}
        active={stats.active}
        queued={stats.queued}
        done={stats.done}
        failed={stats.failed}
        version={appVersion}
        onClearCompleted={clearCompleted}
      />

      <ConfirmDialog
        open={!!dialog}
        title={dialog?.title ?? ""}
        message={dialog?.message ?? ""}
        confirmText={dialog?.confirmText}
        cancelText={dialog?.cancelText}
        danger={dialog?.danger}
        onConfirm={() => dialog?.onConfirm()}
        onCancel={() => setDialog(null)}
      />

      <UpdateDialog
        state={updaterState}
        currentVersion={appVersion}
        onConfirm={downloadNow}
        onDismiss={dismiss}
        onInstall={installNow}
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

function EmptyHistory() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted select-none">
      <p className="text-[13px] text-subtle">Chưa có lịch sử tải</p>
      <p className="text-[11px]">Các mục hoàn thành, lỗi hoặc đã hủy sẽ hiện ở đây</p>
    </div>
  );
}

const COMING_SOON: Record<"convert" | "trim" | "compress" | "audio", { title: string; desc: string }> = {
  convert:  { title: "Chuyển đổi", desc: "Đổi định dạng video/audio (MP4, MKV, MP3, ...)" },
  trim:     { title: "Cắt/Ghép",   desc: "Cắt đoạn video hoặc ghép nhiều file lại với nhau" },
  compress: { title: "Nén file",   desc: "Giảm dung lượng video mà vẫn giữ chất lượng" },
  audio:    { title: "Tách nhạc",  desc: "Tách phần âm thanh ra khỏi video" },
};

function ComingSoon({ page }: { page: keyof typeof COMING_SOON }) {
  const { title, desc } = COMING_SOON[page];
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted select-none">
      <p className="text-[15px] text-text font-semibold">{title}</p>
      <p className="text-[12px] text-subtle">{desc}</p>
      <span className="mt-2 text-[10px] px-2 py-0.5 rounded-full bg-[#181c27] border border-[#252a38]">
        Đang phát triển
      </span>
    </div>
  );
}
