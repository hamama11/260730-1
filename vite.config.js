import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        student: resolve(__dirname, 'student.html'),
        teacherMonitor: resolve(__dirname, 'teacherMonitor.html')
      }
    }
  }
});

