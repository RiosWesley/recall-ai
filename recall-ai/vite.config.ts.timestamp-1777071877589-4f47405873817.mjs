// vite.config.ts
import { defineConfig } from "file:///C:/Users/BIG4TECH/Documents/Wesley/recall-ai/recall-ai/node_modules/vite/dist/node/index.js";
import path from "node:path";
import electron from "file:///C:/Users/BIG4TECH/Documents/Wesley/recall-ai/recall-ai/node_modules/vite-plugin-electron/dist/simple.mjs";
import react from "file:///C:/Users/BIG4TECH/Documents/Wesley/recall-ai/recall-ai/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///C:/Users/BIG4TECH/Documents/Wesley/recall-ai/recall-ai/node_modules/@tailwindcss/vite/dist/index.mjs";
var __vite_injected_original_dirname = "C:\\Users\\BIG4TECH\\Documents\\Wesley\\recall-ai\\recall-ai";
var vite_config_default = defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        entry: {
          main: "electron/main.ts",
          "worker-worker": "src/main/services/worker-worker.ts",
          "brain-worker": "src/main/services/brain-worker.ts"
        },
        vite: {
          build: {
            rollupOptions: {
              // Native modules must be treated as external —
              // they cannot be bundled by Rollup/Vite
              external: ["better-sqlite3", "sqlite-vec", "node-llama-cpp"]
            }
          }
        }
      },
      preload: {
        input: path.join(__vite_injected_original_dirname, "electron/preload.ts")
      },
      renderer: process.env.NODE_ENV === "test" ? void 0 : {}
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxCSUc0VEVDSFxcXFxEb2N1bWVudHNcXFxcV2VzbGV5XFxcXHJlY2FsbC1haVxcXFxyZWNhbGwtYWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXEJJRzRURUNIXFxcXERvY3VtZW50c1xcXFxXZXNsZXlcXFxccmVjYWxsLWFpXFxcXHJlY2FsbC1haVxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvQklHNFRFQ0gvRG9jdW1lbnRzL1dlc2xleS9yZWNhbGwtYWkvcmVjYWxsLWFpL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcclxuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJ1xyXG5pbXBvcnQgZWxlY3Ryb24gZnJvbSAndml0ZS1wbHVnaW4tZWxlY3Ryb24vc2ltcGxlJ1xyXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnXHJcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tICdAdGFpbHdpbmRjc3Mvdml0ZSdcclxuXHJcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgcGx1Z2luczogW1xyXG4gICAgdGFpbHdpbmRjc3MoKSxcclxuICAgIHJlYWN0KCksXHJcbiAgICBlbGVjdHJvbih7XHJcbiAgICAgIG1haW46IHtcclxuICAgICAgICBlbnRyeToge1xyXG4gICAgICAgICAgbWFpbjogJ2VsZWN0cm9uL21haW4udHMnLFxyXG4gICAgICAgICAgJ3dvcmtlci13b3JrZXInOiAnc3JjL21haW4vc2VydmljZXMvd29ya2VyLXdvcmtlci50cycsXHJcbiAgICAgICAgICAnYnJhaW4td29ya2VyJzogJ3NyYy9tYWluL3NlcnZpY2VzL2JyYWluLXdvcmtlci50cydcclxuICAgICAgICB9LFxyXG4gICAgICAgIHZpdGU6IHtcclxuICAgICAgICAgIGJ1aWxkOiB7XHJcbiAgICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAvLyBOYXRpdmUgbW9kdWxlcyBtdXN0IGJlIHRyZWF0ZWQgYXMgZXh0ZXJuYWwgXHUyMDE0XHJcbiAgICAgICAgICAgICAgLy8gdGhleSBjYW5ub3QgYmUgYnVuZGxlZCBieSBSb2xsdXAvVml0ZVxyXG4gICAgICAgICAgICAgIGV4dGVybmFsOiBbJ2JldHRlci1zcWxpdGUzJywgJ3NxbGl0ZS12ZWMnLCAnbm9kZS1sbGFtYS1jcHAnXSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgICAgcHJlbG9hZDoge1xyXG4gICAgICAgIGlucHV0OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnZWxlY3Ryb24vcHJlbG9hZC50cycpLFxyXG4gICAgICB9LFxyXG4gICAgICByZW5kZXJlcjogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICd0ZXN0J1xyXG4gICAgICAgID8gdW5kZWZpbmVkXHJcbiAgICAgICAgOiB7fSxcclxuICAgIH0pLFxyXG4gIF0sXHJcbn0pXHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBa1csU0FBUyxvQkFBb0I7QUFDL1gsT0FBTyxVQUFVO0FBQ2pCLE9BQU8sY0FBYztBQUNyQixPQUFPLFdBQVc7QUFDbEIsT0FBTyxpQkFBaUI7QUFKeEIsSUFBTSxtQ0FBbUM7QUFPekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsWUFBWTtBQUFBLElBQ1osTUFBTTtBQUFBLElBQ04sU0FBUztBQUFBLE1BQ1AsTUFBTTtBQUFBLFFBQ0osT0FBTztBQUFBLFVBQ0wsTUFBTTtBQUFBLFVBQ04saUJBQWlCO0FBQUEsVUFDakIsZ0JBQWdCO0FBQUEsUUFDbEI7QUFBQSxRQUNBLE1BQU07QUFBQSxVQUNKLE9BQU87QUFBQSxZQUNMLGVBQWU7QUFBQTtBQUFBO0FBQUEsY0FHYixVQUFVLENBQUMsa0JBQWtCLGNBQWMsZ0JBQWdCO0FBQUEsWUFDN0Q7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxNQUNBLFNBQVM7QUFBQSxRQUNQLE9BQU8sS0FBSyxLQUFLLGtDQUFXLHFCQUFxQjtBQUFBLE1BQ25EO0FBQUEsTUFDQSxVQUFVLFFBQVEsSUFBSSxhQUFhLFNBQy9CLFNBQ0EsQ0FBQztBQUFBLElBQ1AsQ0FBQztBQUFBLEVBQ0g7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
