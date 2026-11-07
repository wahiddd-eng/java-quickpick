import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, strictPort: true, host: true },
  preview: { port: 5175 },
});
