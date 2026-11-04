// Modo navegador com recarga automática: sobe o servidor Git (4317) e o Vite (5173).
// Uso: npm run dev [-- --repo /caminho/do/clone]
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const args=process.argv.slice(2);let repo=process.env.PINDORAMA_REPO;
for(let i=0;i<args.length;i++){
 if(args[i]==='--repo'&&args[i+1]){repo=args[++i];continue;}
 console.error('Uso: npm run dev -- --repo /caminho/do/clone');process.exit(1);
}
const env={...process.env,...(repo?{PINDORAMA_REPO:repo}:{})};
const children=[];let exiting=false;
function stop(code=0){if(exiting)return;exiting=true;for(const c of children)c.kill('SIGTERM');setTimeout(()=>process.exit(code),300).unref();}
for(const script of ['server/index.mjs','node_modules/vite/bin/vite.js']){
 const c=spawn(process.execPath,[script],{cwd:root,env,stdio:'inherit'});children.push(c);c.on('error',e=>{console.error(e.message);stop(1);});c.on('exit',(code)=>{if(!exiting)stop(code||0);});
}
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>stop());
