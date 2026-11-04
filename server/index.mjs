import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {GitRepository,GitError} from './git.mjs';
const project=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
export async function createApp({repoPath=process.env.PINDORAMA_REPO,port=4317,persist=true,configPath,distPath}={}){
 let repository=null,initialError='',mutations=0;
 const config=configPath||path.join(project,'.pindorama','settings.json');
 if(!repoPath&&persist){try{repoPath=JSON.parse(await readFile(config,'utf8')).repository;}catch{}}
 if(repoPath){try{repository=await GitRepository.open(repoPath);}catch(e){initialError=e.message;}}
 const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,'127.0.0.1:5173','localhost:5173']);
 const origins=new Set([...allowedHosts].map(h=>'http://'+h));
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 async function body(req){let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>1000000)throw new GitError('Requisição muito grande.',413);}try{return data?JSON.parse(data):{};}catch{throw new GitError('JSON inválido.');}}
 const server=http.createServer(async(req,res)=>{
  try{
   if(!allowedHosts.has(req.headers.host))return send(res,403,{error:'Host não permitido. Use localhost.'});
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname.startsWith('/api/')){
    if(req.headers.origin&&!origins.has(req.headers.origin))return send(res,403,{error:'Origem não permitida.'});
    if(req.headers['x-pindorama-client']!=='local')return send(res,403,{error:'Use a interface local do Briar.'});
    if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Método não permitido.'});
    if(req.method==='POST'&&(!req.headers.origin||!String(req.headers['content-type']).startsWith('application/json')))return send(res,403,{error:'Requisição local JSON obrigatória.'});
    if(url.pathname==='/api/state'&&req.method==='GET')return send(res,200,{status:repository?await repository.status():null,history:repository?await repository.history():null,initialError});
    if(req.method!=='POST')return send(res,404,{error:'Rota não encontrada.'});
    const input=await body(req);
    if(url.pathname==='/api/repository'){
     if(mutations)throw new GitError('Aguarde a operação Git terminar antes de trocar de clone.',409);
     const next=await GitRepository.open(input.path);repository=next;initialError='';
     if(persist){await mkdir(path.dirname(config),{recursive:true});await writeFile(config,JSON.stringify({repository:next.root},null,2),{mode:0o600});}
     return send(res,200,{ok:true});
    }
    const repo=repository;if(!repo)throw new GitError('Abra um clone local primeiro.');
    if(url.pathname==='/api/diff')return send(res,200,{diff:await repo.diff(input)});
    if(url.pathname==='/api/commit-files')return send(res,200,await repo.commitFiles(input.sha));
    if(url.pathname==='/api/merge-preview')return send(res,200,await repo.mergePreview(input));
    const actions={stage:()=>repo.stage(input.paths),unstage:()=>repo.unstage(input.paths),commit:()=>repo.commit(input),switch:()=>repo.switchBranch(input.branch),fetch:()=>repo.fetch(),pull:()=>repo.pull(input),push:()=>repo.push(),branch:()=>repo.createBranch(input),merge:()=>repo.merge(input),'merge-abort':()=>repo.abortMerge(),resolve:()=>repo.resolve(input)};
    const key=url.pathname.slice(5);const action=Object.hasOwn(actions,key)?actions[key]:null;if(!action)throw new GitError('Ação não encontrada.',404);
    mutations++;try{const output=await action();return send(res,200,{ok:true,output:output||''});}finally{mutations--;}
   }
   if(req.method!=='GET')return send(res,405,{error:'Método não permitido.'});
   const dist=distPath||path.join(project,'dist');let file=path.resolve(dist,'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(dist+path.sep)&&file!==dist)return send(res,403,{error:'Caminho inválido.'});
   if(path.basename(file).startsWith('.'))return send(res,404,{error:'Não encontrado.'});
   try{const actual=await realpath(file);if(!actual.startsWith(dist+path.sep))throw new Error();const data=await readFile(actual);const ext=path.extname(file);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'})[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(data);}catch{
    try{const html=await readFile(path.join(dist,'index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);}catch{send(res,404,{error:'Frontend não compilado. Use npm run dev ou npm run build.'});}
   }
  }catch(e){send(res,e.status||500,{error:e.message||'Falha no servidor local.'});}
 });
 return {server,getRepository:()=>repository};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await createApp();app.server.on('error',e=>{console.error('Servidor Git:',e.message);process.exit(1);});app.server.listen(4317,'127.0.0.1',()=>console.log('Briar Git local: http://127.0.0.1:4317 (API somente neste computador)'));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>process.exit(0)));
}
