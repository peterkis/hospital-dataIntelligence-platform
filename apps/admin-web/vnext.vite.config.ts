import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:'/admin/vnext/',plugins:[react()],build:{outDir:'dist-vnext',rolldownOptions:{input:'vnext.html'}}});
