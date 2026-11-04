import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// Modo navegador (npm run dev): a interface em 5173 repassa /api para o servidor Git local em 4317.
export default defineConfig({plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true,allowedHosts:['localhost','127.0.0.1'],proxy:{'/api':{target:'http://127.0.0.1:4317',changeOrigin:false}}}});
