import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const vnextPages = /^\/admin\/vnext(?:\/(?:catalog|contracts|parameter-definitions|imports|organizations|departments|location-usage-types|care-space(?:\/[^/]+){0,2}))?\/?$/;
const vnextEntry = {
 name:'vnext-html-entry',
 configureServer(server:import('vite').ViteDevServer){server.middlewares.use((request,_response,next)=>{const url=new URL(request.url??'/', 'http://localhost');if(vnextPages.test(url.pathname))request.url='/admin/vnext/vnext.html'+url.search;next();});},
 configurePreviewServer(server:import('vite').PreviewServer){server.middlewares.use((request,_response,next)=>{const url=new URL(request.url??'/', 'http://localhost');if(vnextPages.test(url.pathname))request.url='/admin/vnext/vnext.html'+url.search;next();});},
};
const apiProxy={'/api/vnext':{target:process.env.HDIP_MVP_API_TARGET??'http://127.0.0.1:4317'}};
export default defineConfig({base:'/admin/vnext/',appType:'mpa',cacheDir:process.env.HDIP_MVP_RUN_ROOT?process.env.HDIP_MVP_RUN_ROOT+'/tmp/vite-cache':undefined,plugins:[vnextEntry,react(),tailwindcss()],server:{proxy:apiProxy},preview:{proxy:apiProxy},build:{outDir:'dist-vnext',rolldownOptions:{input:'vnext.html'}}});
