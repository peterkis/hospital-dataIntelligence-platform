import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 4322,
    strictPort: true,
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "prototype-api-boundary",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.match(/^\/api(?:\/|\?|$)/)) {
            res.statusCode = 403;
            res.end("This standalone prototype has no API connection.");
            return;
          }
          next();
        });
      },
    },
  ],
});
