import react from "@vitejs/plugin-react";

export default {
  plugins: [react()],
  root: "src/renderer",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true
  }
};