import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {GitRepository,GitError} from './git.mjs';
const project=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
// Vários repositórios abertos ao mesmo tempo (abas). Cada pedido da interface diz qual aba é
// pelo cabeçalho X-Briar-Repo; sem ele, vale a aba ativa.
// settings.json: {tabs:[caminhos abertos], active:caminho, recent:[caminhos já usados]}.
export async function createApp({repoPath=process.env.PINDORAMA_REPO,port=4317,persist=true,configPath,distPath}={}){
 const config=configPath||path.join(project,'.pindorama','settings.json');
 const open=new Map();let active=null,recent=[],initialError='';
 let saved={};
 if(persist){try{saved=JSON.parse(await readFile(config,'utf8'));}catch{}}
 const wanted=repoPath?[repoPath]:Array.isArray(saved.tabs)?saved.tabs:saved.repository?[saved.repository]:[];
 recent=(Array.isArray(saved.recent)?saved.recent:saved.repository?[saved.repository]:[]).filter(p=>typeof p==='string');
 for(const p of wanted){try{const r=await GitRepository.open(p);open.set(r.root,r);}catch(e){initialError=`${p}: ${e.message}`;}}
 active=open.has(saved.active)?saved.active:[...open.keys()][0]||null;
 const remember=root=>{recent=[root,...recent.filter(p=>p!==root)].slice(0,30);};
 for(const root of open.keys())remember(root);
 async function save(){if(!persist)return;await mkdir(path.dirname(config),{recursive:true});await writeFile(config,JSON.stringify({tabs:[...open.keys()],active,recent},null,2),{mode:0o600});}
 const workspace=()=>({tabs:[...open.values()].map(r=>({root:r.root,name:path.basename(r.root)})),active,recent:recent.map(root=>({root,name:path.basename(root),open:open.has(root)})),initialError});
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
    let key=active;
    if(req.headers['x-briar-repo']){try{key=decodeURIComponent(String(req.headers['x-briar-repo']));}catch{throw new GitError('Repositório inválido.');}}
    const repo=key?open.get(key):null;
    if(url.pathname==='/api/workspace'&&req.method==='GET')return send(res,200,workspace());
    if(url.pathname==='/api/state'&&req.method==='GET'){
     if(!repo)return send(res,key?404:200,key?{error:'Essa aba não está mais aberta.'}:{status:null,history:null,initialError});
     return send(res,200,{status:await repo.status(),history:await repo.history(),initialError:''});
    }
    if(req.method!=='POST')return send(res,404,{error:'Rota não encontrada.'});
    const input=await body(req);
    // Abas: abrir (ou ir para) um repositório, ativar, fechar, tirar da lista de recentes.
    if(url.pathname==='/api/workspace/open'||url.pathname==='/api/repository'){
     const next=await GitRepository.open(input.path);
     if(!open.has(next.root))open.set(next.root,next);
     active=next.root;remember(next.root);initialError='';await save();
     return send(res,200,{ok:true,root:next.root,workspace:workspace()});
    }
    if(url.pathname==='/api/workspace/activate'){if(!open.has(input.root))throw new GitError('Essa aba não está aberta.',404);active=input.root;await save();return send(res,200,{ok:true,workspace:workspace()});}
    if(url.pathname==='/api/workspace/close'){
     const keys=[...open.keys()],i=keys.indexOf(input.root);
     if(i>=0){open.delete(input.root);if(active===input.root){const rest=[...open.keys()];active=rest[Math.min(i,rest.length-1)]||null;}await save();}
     return send(res,200,{ok:true,workspace:workspace()});
    }
    if(url.pathname==='/api/workspace/forget'){recent=recent.filter(p=>p!==input.root);await save();return send(res,200,{ok:true,workspace:workspace()});}
    if(!repo)throw new GitError(key?'Essa aba não está mais aberta.':'Abra um clone local primeiro.',key?404:400);
    if(url.pathname==='/api/diff')return send(res,200,{diff:await repo.diff(input)});
    if(url.pathname==='/api/stash-files')return send(res,200,await repo.stashFiles(input.sha));
    if(url.pathname==='/api/commit-files')return send(res,200,await repo.commitFiles(input.sha));
    if(url.pathname==='/api/merge-preview')return send(res,200,await repo.mergePreview(input));
    const actions={stage:()=>repo.stage(input.paths),unstage:()=>repo.unstage(input.paths),discard:()=>repo.discard(input.paths),'undo-discard':()=>repo.undoDiscard(input.stash),commit:()=>repo.commit(input),switch:()=>repo.switchBranch(input.branch),fetch:()=>repo.fetch(),'auto-fetch':()=>repo.autoFetch({minAge:Math.max(30000,Number(input.minAge)||60000)}),pull:()=>repo.pull(input),push:()=>repo.push(),branch:()=>repo.createBranch(input),merge:()=>repo.merge(input),'merge-abort':()=>repo.abortMerge(),tag:()=>repo.createTag(input),'tag-push':()=>repo.pushTag(input.name),'tag-delete':()=>repo.deleteTag(input),'branch-delete':()=>repo.deleteBranch(input),resolve:()=>repo.resolve(input),'stash-push':()=>repo.stashPush(input),'stash-apply':()=>repo.stashApply(input),'stash-drop':()=>repo.stashDrop(input),'stash-restore':()=>repo.stashRestore(input),'stash-branch':()=>repo.stashBranch(input)};
    const name=url.pathname.slice(5);const action=Object.hasOwn(actions,name)?actions[name]:null;if(!action)throw new GitError('Ação não encontrada.',404);
    const output=await action();return send(res,200,{ok:true,output:output||''});
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
 return {server,getRepository:()=>active?open.get(active)||null:null};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await createApp();app.server.on('error',e=>{console.error('Servidor Git:',e.message);process.exit(1);});app.server.listen(4317,'127.0.0.1',()=>console.log('Briar Git local: http://127.0.0.1:4317 (API somente neste computador)'));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>process.exit(0)));
}
