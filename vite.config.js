import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': process.env.CHATBOT_PROXY_TARGET
          || environment.CHATBOT_PROXY_TARGET
          || 'http://127.0.0.1:3002',
      },
    },
  };
});
