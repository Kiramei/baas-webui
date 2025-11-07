import path from 'path';
import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react';
import compression from "vite-plugin-compression";
// import {visualizer} from "rollup-plugin-visualizer";

export default defineConfig(() => {
  return {
    base: "/",
    clearScreen: false,
    define: {
      global: 'window'
    },
    server: {
      host: "127.0.0.1",
      port: 8192,
      strictPort: true,
    },
    plugins: [
      react(),
      tailwindcss(),
      compression({
        algorithm: "brotliCompress",
        ext: ".br",
        threshold: 1024,
        deleteOriginFile: false
      })
      // Consider using this plugin to analyze the chunk :)
      // visualizer({
      //   filename: 'dist/stats.html',
      //   open: true,
      // })
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            motion: [
              'framer-motion'
            ],
            highlight: [
              'rehype-highlight'
            ],
            markdown: [
              'remark-gfm',
              'react-markdown'
            ],
            misc: [
              'react',
              "i18next",
              "zustand",
              'react-dom',
              "next-themes",
              'react-window',
              "lucide-react",
              "react-i18next",
              "tailwind-merge",
              "class-variance-authority"
            ],
            ui: [
              'sonner',
              'date-fns',
              'react-day-picker',
              "@headlessui/react",
              '@radix-ui/react-popover',
              '@radix-ui/react-select',
              '@radix-ui/react-separator',
              '@radix-ui/react-slot',
              '@radix-ui/react-switch',
              '@radix-ui/react-tabs',
              '@radix-ui/react-tooltip'
            ]
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    }
  };
});
