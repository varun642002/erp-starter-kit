import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

// One id per build. It is built into the app and also written to version.json, so a running app can ask the
// server "which version is current?" and switch itself over when the answer differs from its own.
const BUILD_ID = `${Date.now().toString(36)}`;

export default defineConfig(() => {
  return {
    define: {
      __APP_VERSION__: JSON.stringify(BUILD_ID),
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'write-version-file',
        apply: 'build' as const,
        closeBundle() {
          fs.mkdirSync('dist', { recursive: true });
          fs.writeFileSync('dist/version.json', JSON.stringify({ version: BUILD_ID, builtAt: new Date().toISOString() }));
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Libraries change rarely, so they live in their own files and stay cached between releases.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('firebase') || id.includes('@firebase')) return 'vendor-firebase';
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) return 'vendor-charts';
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
            return undefined;
          },
        },
      },
    },
    server: {
      // Set DISABLE_HMR=true to turn off hot reload.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
