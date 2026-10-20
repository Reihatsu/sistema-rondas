import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El proxy evita problemas de CORS en desarrollo: /api -> FastAPI (8000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
