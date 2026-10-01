import React from "react";

export type NavId =
  | "download"
  | "history"
  | "convert"
  | "trim"
  | "compress"
  | "audio"
  | "settings"
  | "about";

interface NavItem {
  id: NavId;
  label: string;
  badge?: number;
  icon: React.ReactNode;
}

interface Props {
  active: NavId;
  collapsed: boolean;
  onSelect: (id: NavId) => void;
  onToggleCollapse: () => void;
  activeDownloads: number;
  historyCount: number;
}

const ICON = "w-[22px] h-[22px]";
const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...S}>
      <path d="M12 3v12M7.5 11 12 15.5 16.5 11M4 20h16" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.4 2" />
    </svg>
  );
}

function IconConvert() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...S}>
      <path d="M4 8h14M14.5 4.5 18 8l-3.5 3.5M20 16H6M9.5 12.5 6 16l3.5 3.5" />
    </svg>
  );
}

function IconTrim() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...S}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M8 7.8 20 18M8 16.2 20 6" />
    </svg>
  );
}

function IconCompress() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...S}>
      <path d="M4 4l6 6M10 5.5V10H5.5M20 4l-6 6M14 5.5V10h4.5M4 20l6-6M10 18.5V14H5.5M20 20l-6-6M14 18.5V14h4.5" />
    </svg>
  );
}

function IconAudio() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...S}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 20 20" className={ICON} fill="none">
      <path
        d="M8.2 2.8h3.6l.5 1.7a5.8 5.8 0 011.6.9l1.7-.5 1.8 3.1-1.2 1.3c.1.5.2 1 .2 1.5s-.1 1-.2 1.5l1.2 1.3-1.8 3.1-1.7-.5a5.8 5.8 0 01-1.6.9l-.5 1.7H8.2l-.5-1.7a5.8 5.8 0 01-1.6-.9l-1.7.5-1.8-3.1 1.2-1.3A6 6 0 013.6 10c0-.5.1-1 .2-1.5L2.6 7.2 4.4 4.1l1.7.5a5.8 5.8 0 011.6-.9l.5-1.7z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconAbout() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" strokeWidth={1.9} />
    </svg>
  );
}

export function Sidebar({
  active,
  collapsed,
  onSelect,
  onToggleCollapse,
  activeDownloads,
  historyCount,
}: Props) {
  const mainItems: NavItem[] = [
    { id: "download", label: "Tải xuống",  badge: activeDownloads, icon: <IconDownload /> },
    { id: "history",  label: "Lịch sử",    badge: historyCount,    icon: <IconHistory /> },
    { id: "convert",  label: "Chuyển đổi", icon: <IconConvert /> },
    { id: "trim",     label: "Cắt/Ghép",   icon: <IconTrim /> },
    { id: "compress", label: "Nén file",   icon: <IconCompress /> },
    { id: "audio",    label: "Tách nhạc",  icon: <IconAudio /> },
  ];

  const bottomItems: NavItem[] = [
    { id: "settings", label: "Cài đặt",    icon: <IconSettings /> },
    { id: "about",    label: "Giới thiệu", icon: <IconAbout /> },
  ];

  function renderItem(item: NavItem) {
    const isActive = item.id === active;
    const showBadge = (item.badge ?? 0) > 0;
    return (
      <button
        key={item.id}
        type="button"
        title={collapsed ? item.label : undefined}
        aria-current={isActive ? "page" : undefined}
        onClick={() => onSelect(item.id)}
        className={`relative w-full flex flex-col items-center justify-center rounded-lg mb-1 transition-colors
          ${collapsed ? "h-10" : "gap-1 py-2 px-1"}
          ${isActive
            ? "bg-accent/90 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
            : "text-subtle hover:bg-white/5 hover:text-text"}`}
      >
        {item.icon}
        {!collapsed && (
          <span className="text-[11px] leading-none font-medium whitespace-nowrap">{item.label}</span>
        )}
        {showBadge && (
          <span
            className={
              collapsed
                ? "absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-success"
                : "absolute top-1 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-success text-white text-[10px] leading-4 font-semibold text-center"
            }
          >
            {!collapsed && item.badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <aside
      aria-label="Menu chính"
      className={`flex flex-col shrink-0 bg-[#121826] border-r border-[#1e2333] transition-[width] duration-200 ${
        collapsed ? "w-[56px]" : "w-[88px]"
      }`}
    >
      <nav className="flex-1 overflow-y-auto pt-2 px-1.5">{mainItems.map(renderItem)}</nav>

      <div className="px-1.5 pt-1 border-t border-[#1e2333]">
        {bottomItems.map(renderItem)}
      </div>

      <div className="p-1.5 border-t border-[#1e2333]">
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
          className="w-full h-7 rounded-md flex items-center justify-center text-muted hover:text-text hover:bg-white/5 transition-colors"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={`w-3.5 h-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`}
          >
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
