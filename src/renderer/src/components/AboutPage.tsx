import React from "react";
import appIcon from "../assets/icon.png";

interface Props {
  version: string;
}

const SITES = ["YouTube", "TikTok", "Facebook", "Twitter", "Instagram", "và 1000+ trang"];

export function AboutPage({ version }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center">
      <img src={appIcon} alt="" className="w-20 h-20 rounded-2xl shadow-[0_0_32px_rgba(59,130,246,0.25)]" />
      <h1 className="mt-4 text-[18px] font-semibold tracking-wide text-text">MediaGet</h1>
      <p className="text-[12px] text-muted mt-1">
        {version ? `Phiên bản ${version}` : "Media Desktop App"}
      </p>
      <p className="max-w-[360px] text-[12px] text-subtle mt-3 leading-relaxed">
        Tải video và audio từ YouTube, TikTok, Facebook và hơn 1000 trang khác ngay trên máy tính.
      </p>
      <div className="flex flex-wrap gap-1.5 justify-center mt-4">
        {SITES.map(site => (
          <span
            key={site}
            className="text-[10px] px-2 py-0.5 rounded-full bg-[#181c27] border border-[#252a38] text-muted"
          >
            {site}
          </span>
        ))}
      </div>
    </div>
  );
}
