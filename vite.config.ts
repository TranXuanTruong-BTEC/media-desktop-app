import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Content-Security-Policy chỉ chèn vào bản BUILD (bản dev cần script inline của Vite HMR).
// - script-src 'self'      : cấm script inline / eval → chặn XSS thực thi mã
// - style-src 'unsafe-inline': cần cho thuộc tính style={{...}} của React (thanh tiến trình)
// - connect-src 'self'     : renderer không có lý do gọi mạng; mọi thứ đi qua IPC
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

function injectCsp(): Plugin {
  return {
    name: "inject-csp",
    apply: "build",
    transformIndexHtml(html) {
      // đặt sau <meta charset> (charset phải nằm trong 1024 byte đầu của tài liệu)
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), injectCsp()],
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
