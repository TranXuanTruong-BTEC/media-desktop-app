import react from "@vitejs/plugin-react";

export default {
  plugins: [react()],
  root: "src/renderer",
  base: "./", // Quan trọng: dùng đường dẫn tương đối để load đúng khi chạy từ file:// (app đóng gói)
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
};