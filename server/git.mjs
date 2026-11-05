import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath,stat,readFile,lstat,readlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
const exec=promisify(execFile);
export class GitError extends Error {constructor(message,status=400){super(message);this.status=status;}}
export class GitRepository {
 constructor(root){this.root=root;this.lastFetch=null;this.audit=[];this.tail=Promise.resolve();}
 static async open(input){
  if(typeof input!=='string'||!input.trim()||input.includes('\0'))throw new GitError('Informe o caminho de um clone Git local.');
  let root;try{root=await realpath(path.resolve(input==='~'?homedir():input.startsWith('~/')?path.join(homedir(),input.slice(2)):input));}catch{throw new GitError('A pasta não existe ou não pode ser lida.');}
  const repo=new GitRepository(root);
  try{const top=(await repo.git(['rev-parse','--show-toplevel'])).trim();repo.root=await realpath(top);}catch{throw new GitError('Essa pasta não pertence a um repositório Git de trabalho.');}
  return repo;
 }
 async git(args,{allow=[0],timeout=30000,audit=false}={}){
  const command='git '+args.map(s=>/^[\w@{}.:/=-]+$/.test(s)?s:JSON.stringify(s)).join(' ');
  try{const r=await exec('git',['--literal-pathspecs','-C',this.root,'--no-pager',...args],{encoding:'utf8',maxBuffer:16*1024*1024,timeout,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat',LC_ALL:'C'}});if(audit)this.record(command,r.stdout||r.stderr,true);return r.stdout;
  }catch(e){if(allow.includes(e.code))return e.stdout||'';const output=(e.stderr||e.stdout||e.message||'Git falhou.').slice(0,12000);if(audit)this.record(command,output,false);throw new GitError(e.killed?'O Git excedeu o tempo limite. Verifique a autenticação no terminal.':output,409);}
 }
 record(command,output,success){this.audit.unshift({command,output:output.slice(0,12000),success,date:new Date().toISOString()});this.audit=this.audit.slice(0,20);}
 mutate(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
 async head(){return (await this.git(['rev-parse','--verify','HEAD'],{allow:[0,128]})).trim()||null;}
 async files(){const raw=await this.git(['status','--porcelain=v1','-z','--untracked-files=all']);const parts=raw.split('\0');const files=[];for(let i=0;i<parts.length;i++){const v=parts[i];if(!v)continue;const index=v[0],worktree=v[1],name=v.slice(3);let oldPath;if(index==='R'||index==='C'||worktree==='R'||worktree==='C')oldPath=parts[++i];files.push({path:name,oldPath,index,worktree,untracked:index==='?'&&worktree==='?',conflicted:['DD','AU','UD','UA','DU','AA','UU'].includes(index+worktree),staged:index!==' '&&index!=='?',unstaged:worktree!==' '||index==='?'});}return files;}
 async refs(){const raw=await this.git(['for-each-ref','--format=%(refname)%00%(objectname)%00%(*objectname)','refs/heads/','refs/remotes/','refs/tags/']);const branches=[],tags=[];for(const row of raw.split('\n')){if(!row)continue;const [ref,sha,peeled]=row.split('\0');if(ref.endsWith('/HEAD'))continue;if(ref.startsWith('refs/tags/'))tags.push({name:ref.slice(10),sha:peeled||sha});else branches.push({name:ref.replace(/^refs\/(heads|remotes)\//,''),sha,remote:ref.startsWith('refs/remotes/')});}return {branches,tags};}
 async indexFingerprint(){return createHash('sha256').update(await this.git(['ls-files','--stage','-z'])).digest('hex');}
 async status(){
  const [files,branch,head,refs,indexFingerprint,remotes]=await Promise.all([this.files(),this.git(['branch','--show-current']),this.head(),this.refs(),this.indexFingerprint(),this.git(['remote'])]);
  let upstream=null,ahead=0,behind=0,remote=null;
  if(head){try{upstream=(await this.git(['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'])).trim();const values=(await this.git(['rev-list','--left-right','--count',`HEAD...${upstream}`])).trim().split(/\s+/);ahead=Number(values[0]);behind=Number(values[1]);remote=(await this.git(['config','--get',`branch.${branch.trim()}.remote`],{allow:[0,1]})).trim()||null;}catch{upstream=null;}}
  let fetchDate=this.lastFetch;
  if(!fetchDate){try{const fp=(await this.git(['rev-parse','--git-path','FETCH_HEAD'])).trim();const s=await stat(path.resolve(this.root,fp));fetchDate=s.mtime.toISOString();}catch{}}
  const merging=await this.mergeState();
  const lastTag=(await this.git(['for-each-ref','--sort=-creatordate','--count=1','--format=%(refname:strip=2)','refs/tags/'])).trim()||null;
  return {root:this.root,lastTag,branch:branch.trim()||null,head,files,merging,branches:refs.branches,tags:refs.tags,upstream,ahead,behind,remote,remotes:remotes.trim().split('\n').filter(Boolean),lastFetch:fetchDate,indexFingerprint,conflicted:files.some(f=>f.conflicted),audit:this.audit};
 }
 async history(){
  const format='%H%x00%P%x00%an%x00%aI%x00%B%x00';const head=await this.head();if(!head)return {repository:path.basename(this.root),defaultBranch:(await this.git(['branch','--show-current'])).trim()||'main',branches:[],tags:[],commits:[],truncated:false};
  const [all,current,refs,branch]=await Promise.all([this.git(['log','--exclude=refs/stash','--all','--topo-order','-n','300',`--format=${format}`]),this.git(['log','HEAD','--topo-order','-n','300',`--format=${format}`]),this.refs(),this.git(['branch','--show-current'])]);
  const commits=new Map();for(const raw of [all,current]){const parts=raw.split('\0');for(let i=0;i<parts.length-5;i+=5){const [id,parents,author,date,message]=parts.slice(i,i+5);const sha=id.trim();if(sha)commits.set(sha,{sha,parents:parents.split(' ').filter(Boolean),author:author||'Autor desconhecido',date,message:message.trim()||'(sem mensagem)'});}}
  const list=[...commits.values()];return {repository:path.basename(this.root),defaultBranch:branch.trim()||'HEAD',branches:refs.branches.filter(b=>commits.has(b.sha)),tags:refs.tags.filter(t=>commits.has(t.sha)),commits:list,truncated:list.some(c=>c.parents.some(p=>!commits.has(p)))};
 }
 async verifyFiles(paths,staged=false){if(!Array.isArray(paths)||!paths.length||paths.length>2000||paths.some(p=>typeof p!=='string'||!p||p.includes('\0')))throw new GitError('Selecione arquivos válidos.');const files=await this.files();for(const p of paths){if(!files.some(f=>f.path===p&&(staged?f.staged:f.unstaged)))throw new GitError('O estado dos arquivos mudou. Atualize e tente novamente.',409);}return files;}
 async stage(paths){return this.mutate(async()=>{const files=await this.verifyFiles(paths);if(files.some(f=>paths.includes(f.path)&&f.conflicted))throw new GitError('Resolva o conflito no editor antes de preparar esse arquivo.');const add=[...new Set(paths.flatMap(p=>{const f=files.find(x=>x.path===p);return f.oldPath?[p,f.oldPath]:[p];}))];await this.git(['add','--',...add],{audit:true});});}
 async unstage(paths){return this.mutate(async()=>{const files=await this.verifyFiles(paths,true);const targets=[...new Set(paths.flatMap(p=>{const f=files.find(x=>x.path===p);return f.oldPath?[p,f.oldPath]:[p];}))];await this.git(await this.head()?['restore','--staged','--',...targets]:['rm','--cached','--',...targets],{audit:true});});}
 // Descartar = guardar as alterações dos arquivos num stash ("Briar: descartado …") e devolvê-los ao último commit.
 // Nada se perde de vez: dá para desfazer (undoDiscard) ou recuperar depois com git stash apply.
 async discard(paths){return this.mutate(async()=>{
  if(!Array.isArray(paths)||!paths.length||paths.length>2000||paths.some(p=>typeof p!=='string'||!p||p.includes('\0')))throw new GitError('Selecione arquivos válidos.');
  const files=await this.files();
  const chosen=paths.map(p=>files.find(f=>f.path===p));
  if(chosen.some(f=>!f))throw new GitError('O estado dos arquivos mudou. Atualize e tente novamente.',409);
  if(await this.mergeState())throw new GitError('Conclua ou aborte o merge em andamento antes de descartar alterações.',409);
  if(chosen.some(f=>f.conflicted))throw new GitError('Arquivos em conflito se resolvem no editor de conflitos, não com descarte.');
  if(!await this.head())throw new GitError('Ainda não há commits neste repositório: não existe versão anterior para voltar.');
  const targets=[...new Set(chosen.flatMap(f=>f.oldPath?[f.path,f.oldPath]:[f.path]))];
  const before=await this.stashTop();
  const names=chosen.map(f=>f.path);
  const label=`Briar: descartado ${new Date().toLocaleString('pt-BR')} · ${names.slice(0,3).join(', ')}${names.length>3?` e mais ${names.length-3}`:''}`;
  await this.git(['stash','push','--include-untracked','-m',label,'--',...targets],{audit:true});
  const stash=await this.stashTop();
  if(!stash||stash===before)throw new GitError('O Git não encontrou alterações para descartar nesses arquivos.',409);
  return {stash,count:names.length,message:`${names.length===1?names[0]+' descartado':names.length+' arquivos descartados'}. Dá para desfazer.`};
 });}
 async stashTop(){return (await this.git(['rev-parse','--verify','--quiet','refs/stash'],{allow:[0,1]})).trim()||null;}
 async undoDiscard(stash){return this.mutate(async()=>{
  if(typeof stash!=='string'||!/^[a-f0-9]{40,64}$/.test(stash))throw new GitError('Descarte inválido.');
  const list=(await this.git(['stash','list','--format=%H'])).split('\n').map(l=>l.trim());
  const n=list.indexOf(stash);
  if(n<0)throw new GitError('Esse descarte não está mais no stash.',409);
  try{await this.git(['stash','apply','--index',`stash@{${n}}`],{audit:true});}
  catch(e){throw new GitError('Não deu para restaurar automaticamente: os arquivos mudaram depois do descarte. As alterações continuam guardadas no stash ("Briar: descartado …"); use git stash apply quando quiser.\n\n'+e.message,409);}
  await this.git(['stash','drop',`stash@{${n}}`],{audit:true});
  return {message:'Descarte desfeito: as alterações voltaram.'};
 });}
 async commit({message,expectedHead,expectedIndex}){return this.mutate(async()=>{
  if(typeof message!=='string'||!message.trim()||message.length>10000||message.includes('\0'))throw new GitError('Escreva uma mensagem de commit (até 10.000 caracteres).');
  const s=await this.status();if(s.head!==expectedHead||s.indexFingerprint!==expectedIndex)throw new GitError('O HEAD ou os arquivos preparados mudaram. Revise o commit novamente.',409);
  if(!s.branch)throw new GitError('Crie ou selecione uma branch antes de commitar em HEAD destacado.');if(s.conflicted)throw new GitError('Existem conflitos não resolvidos.');if(!s.merging&&!s.files.some(f=>f.staged))throw new GitError('Prepare pelo menos um arquivo antes de commitar.');
  return this.git(['commit','-m',message.trim()],{audit:true,timeout:60000});
 });}
 async switchBranch(name){return this.mutate(()=>this.switchUnlocked(name));}
 // Checkout "inteligente": branch remota com local de mesmo nome troca para a local
 // (e adianta até o remoto quando dá), em vez de recusar.
 async switchUnlocked(name){
  const s=await this.status();const target=s.branches.find(b=>b.name===name);
  if(!target)throw new GitError('Branch não encontrada.');
  if(s.merging)throw new GitError('Conclua ou aborte o merge em andamento antes de trocar de branch.',409);
  if(s.files.some(f=>!f.untracked))throw new GitError('Há alterações locais. Faça commit ou organize os arquivos antes de trocar de branch.',409);
  if(!target.remote){
   if(target.name===s.branch)return {branch:name,message:`Você já está em ${name}.`};
   await this.git(['switch','--',name],{audit:true});return {branch:name,message:`Agora em ${name}.`};
  }
  const local=this.localNameOf(name,s.remotes);
  if(!local)throw new GitError('Referência remota inválida.');
  const remoteRef='refs/remotes/'+name;
  if(!s.branches.some(b=>!b.remote&&b.name===local)){
   await this.git(['check-ref-format','--branch',local]);
   await this.git(['switch','--track','-c',local,remoteRef],{audit:true});
   return {branch:local,message:`Branch ${local} criada a partir de ${name}.`};
  }
  if(s.branch!==local)await this.git(['switch','--',local],{audit:true});
  const behind=Number((await this.git(['rev-list','--count',`HEAD..${remoteRef}`])).trim());
  if(!behind)return {branch:local,message:`Agora em ${local}, em dia com ${name}.`};
  if(await this.isAncestor('HEAD',remoteRef)){
   await this.git(['merge','--ff-only',remoteRef],{audit:true});
   return {branch:local,message:`Agora em ${local}, atualizada com ${behind} ${behind===1?'commit':'commits'} de ${name}.`};
  }
  return {branch:local,warning:true,message:`Agora em ${local}. Ela e ${name} divergiram (${behind} ${behind===1?'commit':'commits'} só no remoto): arraste ${name} sobre ${local} para fazer o merge.`};
 }
 localNameOf(name,remotes){const r=[...remotes].sort((a,b)=>b.length-a.length).find(r=>name.startsWith(r+'/'));return r?name.slice(r.length+1):'';}
 async isAncestor(a,b){try{await this.git(['merge-base','--is-ancestor',a,b]);return true;}catch{return false;}}
 async fetch(){return this.mutate(async()=>{const s=await this.status();const remote=s.remote&&s.remote!=='.'?s.remote:s.remotes.includes('origin')?'origin':s.remotes[0];if(!remote)throw new GitError('Este clone não tem remoto configurado.');const result=await this.git(['fetch','--prune','--',remote],{audit:true,timeout:90000});this.lastFetch=new Date().toISOString();return result;});}
 async pull({mode='ff'}={}){return this.mutate(async()=>{
  const s=await this.status();
  if(s.merging)throw new GitError('Conclua ou aborte o merge em andamento antes do pull.',409);
  if(s.files.some(f=>!f.untracked))throw new GitError('Faça commit das alterações antes de atualizar a branch.',409);
  if(!s.upstream||!s.remote||s.remote==='.')throw new GitError('A branch precisa acompanhar um remoto. Faça push primeiro para criar o upstream.');
  if(mode==='merge'){
   try{const out=await this.git(['pull','--no-rebase','--no-edit'],{audit:true,timeout:120000});this.lastFetch=new Date().toISOString();return {output:out,conflicts:[]};}
   catch(e){this.lastFetch=new Date().toISOString();const conflicts=(await this.files()).filter(f=>f.conflicted).map(f=>f.path);if(conflicts.length)return {output:e.message,conflicts};throw e;}
  }
  try{const result=await this.git(['pull','--ff-only'],{audit:true,timeout:120000});this.lastFetch=new Date().toISOString();return {output:result,conflicts:[]};}
  catch(e){if(/fast-forward|diverg/i.test(e.message))throw new GitError('As branches divergiram: há commits locais e remotos. Use "Pull com merge" para integrar.',409);throw e;}
 });}
 async mergeState(){
  const head=(await this.git(['rev-parse','--git-path','MERGE_HEAD'])).trim();
  try{await stat(path.resolve(this.root,head));}catch{return null;}
  let message='';
  try{message=await readFile(path.resolve(this.root,(await this.git(['rev-parse','--git-path','MERGE_MSG'])).trim()),'utf8');}catch{}
  message=message.split('\n').filter(l=>!l.startsWith('#')).join('\n').trim();
  const m=/^Merge (?:remote-tracking )?branch(?:es)? '([^']+)'/.exec(message);
  return {message:message||'Merge',source:m?m[1]:null};
 }
 async validBranchName(name){
  if(typeof name!=='string')throw new GitError('Nome de branch inválido.');
  const clean=name.trim();
  if(!clean||clean.length>200||clean.startsWith('-')||clean.includes('\0'))throw new GitError('Nome de branch inválido.');
  try{await this.git(['check-ref-format','--branch',clean]);}catch{throw new GitError('Nome de branch inválido para o Git (evite espaços, "..", "~", "^", ":" e "?").');}
  return clean;
 }
 async resolveRef(name){
  const s=await this.status();
  const target=s.branches.find(b=>b.name===name);
  if(!target)throw new GitError('Branch não encontrada.');
  return {s,target,ref:name.startsWith('-')?(target.remote?'refs/remotes/':'refs/heads/')+name:name};
 }
 async createBranch({name,from,checkout=true}={}){return this.mutate(async()=>{
  const clean=await this.validBranchName(name);
  const s=await this.status();
  if(s.merging)throw new GitError('Conclua ou aborte o merge em andamento primeiro.',409);
  if(s.branches.some(b=>!b.remote&&b.name===clean))throw new GitError(`A branch ${clean} já existe.`);
  let start=s.head;
  if(from){if(typeof from!=='string'||!/^[a-f0-9]{40,64}$/.test(from))throw new GitError('Commit de origem inválido.');start=from;}
  if(!start)throw new GitError('Crie o primeiro commit antes de criar branches.');
  await this.git(['cat-file','-e',start+'^{commit}']).catch(()=>{throw new GitError('Commit de origem não encontrado.');});
  if(checkout)return this.git(['switch','-c',clean,start],{audit:true});
  return this.git(['branch',clean,start],{audit:true});
 });}
 // Destino do merge: a branch atual ou outra (arrastar e soltar). Destino remoto vira a branch local equivalente.
 async mergeDestination(s,into){
  if(!into||into===s.branch)return {name:s.branch,ref:'HEAD',needsCheckout:false,remote:false};
  const t=s.branches.find(b=>b.name===into);
  if(!t)throw new GitError('Branch de destino não encontrada.');
  if(!t.remote)return {name:t.name,ref:'refs/heads/'+t.name,needsCheckout:true,remote:false};
  const local=this.localNameOf(t.name,s.remotes);
  if(!local)throw new GitError('Referência remota inválida.');
  const localRef='refs/heads/'+local;const exists=s.branches.some(b=>!b.remote&&b.name===local);
  const ref=exists&&!(await this.isAncestor(localRef,'refs/remotes/'+t.name))?localRef:'refs/remotes/'+t.name;
  return {name:local,ref,needsCheckout:local!==s.branch,remote:true};
 }
 async mergePreview({branch,into}={}){
  const {s,target}=await this.resolveRef(branch);
  if(!s.head)throw new GitError('Não há commits nesta branch.');
  const dest=await this.mergeDestination(s,into);
  if(!dest.name)throw new GitError('Selecione uma branch (não HEAD destacado) como destino.');
  if(!target.remote&&target.name===dest.name)throw new GitError(`${target.name} já é o destino. Para levar ${target.name} ao remoto, use Push.`);
  const incoming=(await this.git(['rev-list','--count',`${dest.ref}..${target.sha}`])).trim();
  const fastForward=await this.isAncestor(dest.ref,target.sha);
  let conflicts=[];
  if(!fastForward&&Number(incoming)>0){
   const out=await this.git(['merge-tree','--write-tree','--name-only','--no-messages',dest.ref,target.sha],{allow:[0,1]});
   conflicts=[...new Set(out.split('\n').slice(1).map(l=>l.trim()).filter(Boolean))];
  }
  return {branch:target.name,current:s.branch,into:dest.name,needsCheckout:dest.needsCheckout,intoRemote:dest.remote,incoming:Number(incoming),fastForward,conflicts};
 }
 async merge({branch,into}={}){return this.mutate(async()=>{
  let {s,target,ref}=await this.resolveRef(branch);
  if(s.merging)throw new GitError('Já existe um merge em andamento. Conclua ou aborte primeiro.',409);
  if(s.files.some(f=>!f.untracked))throw new GitError('Faça commit das alterações locais antes do merge.',409);
  const dest=await this.mergeDestination(s,into);
  if(!dest.name)throw new GitError('Selecione uma branch (não HEAD destacado) antes do merge.');
  if(!target.remote&&target.name===dest.name)throw new GitError('Não é possível fazer merge de uma branch nela mesma.');
  if(dest.needsCheckout||dest.remote){await this.switchUnlocked(into);({s,target,ref}=await this.resolveRef(branch));}
  try{const output=await this.git(['merge','--no-edit',ref],{audit:true,timeout:60000});return {output,conflicts:[],into:dest.name};}
  catch(e){const conflicts=(await this.files()).filter(f=>f.conflicted).map(f=>f.path);if(conflicts.length)return {output:e.message,conflicts,into:dest.name};throw e;}
 });}
 async abortMerge(){return this.mutate(async()=>{
  if(!await this.mergeState())throw new GitError('Não há merge em andamento.');
  return this.git(['merge','--abort'],{audit:true});
 });}
 async resolve({path:filename,side,content}={}){return this.mutate(async()=>{
  if(!['ours','theirs','mark','content'].includes(side))throw new GitError('Escolha como resolver o conflito.');
  const files=await this.files();const f=files.find(x=>x.path===filename);
  if(!f||!f.conflicted)throw new GitError('Esse arquivo não está mais em conflito. Atualize a tela.',409);
  const markers=t=>/^(<{7}|>{7})( |$)/m.test(t)||/^={7}\r?$/m.test(t);
  if(side==='content'){
   if(typeof content!=='string'||content.length>2000000||content.includes('\0'))throw new GitError('Conteúdo inválido.');
   if(markers(content))throw new GitError('O resultado ainda contém marcadores de conflito (<<<<<<<, =======, >>>>>>>).');
   const target=path.resolve(this.root,filename);
   if(!target.startsWith(this.root+path.sep))throw new GitError('Arquivo fora do repositório.');
   try{if((await lstat(target)).isSymbolicLink())throw new GitError('Link simbólico em conflito: escolha um dos lados.');}catch(e){if(e instanceof GitError)throw e;}
   await writeFile(target,content);
  }else if(side==='mark'){
   const target=path.resolve(this.root,filename);
   if(!target.startsWith(this.root+path.sep))throw new GitError('Arquivo fora do repositório.');
   try{const text=await readFile(target,'utf8');if(/^(<{7}|>{7}) /m.test(text)||/^={7}$/m.test(text))throw new GitError('O arquivo ainda contém marcadores de conflito (<<<<<<<, =======, >>>>>>>). Edite e salve antes de marcar como resolvido.');}
   catch(e){if(e instanceof GitError)throw e;}
  }else{
   await this.git(['checkout',side==='ours'?'--ours':'--theirs','--',filename],{audit:true}).catch(async e=>{
    if(/does not have/i.test(e.message))return this.git(['rm','--',filename],{audit:true});throw e;});
  }
  return this.git(['add','-A','--',filename],{audit:true});
 });}
 // ---- Tags e exclusão de branches (menu do botão direito) ----
 defaultRemote(s){const r=s.remote&&s.remote!=='.'?s.remote:s.remotes.includes('origin')?'origin':s.remotes[0];if(!r||r.startsWith('-'))throw new GitError('Este clone não tem remoto configurado.');return r;}
 async validTagName(name){
  if(typeof name!=='string')throw new GitError('Nome de tag inválido.');
  const clean=name.trim();
  if(!clean||clean.length>200||clean.startsWith('-')||clean.includes('\0'))throw new GitError('Nome de tag inválido.');
  try{await this.git(['check-ref-format','refs/tags/'+clean]);}catch{throw new GitError('Nome de tag inválido para o Git (evite espaços, "..", "~", "^", ":" e "?").');}
  return clean;
 }
 async createTag({name,sha,message,push=false}={}){return this.mutate(async()=>{
  const clean=await this.validTagName(name);
  const s=await this.status();
  if(s.tags.some(t=>t.name===clean))throw new GitError(`A tag ${clean} já existe. Escolha outro nome (por exemplo, o próximo número).`,409);
  if(typeof sha!=='string'||!/^[a-f0-9]{40,64}$/.test(sha))throw new GitError('Commit da tag inválido.');
  await this.git(['cat-file','-e',sha+'^{commit}']).catch(()=>{throw new GitError('Commit da tag não encontrado.');});
  if(message!==undefined&&(typeof message!=='string'||message.length>10000||message.includes('\0')))throw new GitError('Mensagem da tag inválida.');
  const text=(message||'').trim();
  await this.git(text?['tag','-a','-m',text,'--',clean,sha]:['tag','--',clean,sha],{audit:true});
  if(!push)return {message:`Tag ${clean} criada (só local).`};
  const remote=this.defaultRemote(s);
  try{await this.git(['push','--',remote,`refs/tags/${clean}`],{audit:true,timeout:120000});}
  catch(e){throw new GitError(`A tag ${clean} foi criada aqui, mas o push para ${remote} falhou. Tente de novo pelo botão direito na tag → Push.\n\n${e.message}`,409);}
  return {message:`Tag ${clean} criada e enviada para ${remote}.`};
 });}
 async pushTag(name){return this.mutate(async()=>{
  const s=await this.status();
  if(!s.tags.some(t=>t.name===name))throw new GitError('Tag não encontrada.');
  const remote=this.defaultRemote(s);
  await this.git(['push','--',remote,`refs/tags/${name}`],{audit:true,timeout:120000});
  return {message:`Tag ${name} enviada para ${remote}.`};
 });}
 async deleteTag({name,local=false,remote=false}={}){return this.mutate(async()=>{
  if(!local&&!remote)throw new GitError('Escolha onde apagar a tag.');
  const s=await this.status();
  if(typeof name!=='string'||!s.tags.some(t=>t.name===name))throw new GitError('Tag não encontrada.');
  const done=[];
  if(remote){const r=this.defaultRemote(s);await this.git(['push','--',r,`:refs/tags/${name}`],{audit:true,timeout:120000});done.push(`no ${r}`);}
  if(local){await this.git(['tag','-d','--',name],{audit:true});done.push('local');}
  return {message:`Tag ${name} apagada (${done.join(' e ')}).`};
 });}
 // Apaga a branch local, a remota ou as duas. Se os commits dela não estiverem em nenhuma outra
 // branch (local ou remota), recusa sem "force" para não perder trabalho.
 async deleteBranch({branch,scope='local',force=false}={}){return this.mutate(async()=>{
  if(!['local','remote','both'].includes(scope))throw new GitError('Escolha onde apagar a branch.');
  const s=await this.status();
  const entry=s.branches.find(b=>b.name===branch);
  if(!entry)throw new GitError('Branch não encontrada.');
  let local=null,remote=null;
  if(entry.remote){
   const r=[...s.remotes].sort((a,b)=>b.length-a.length).find(r=>branch.startsWith(r+'/'));
   if(!r)throw new GitError('Referência remota inválida.');
   remote={remote:r,name:branch.slice(r.length+1),full:branch,sha:entry.sha};
   const ln=remote.name;const l=s.branches.find(b=>!b.remote&&b.name===ln);if(l)local={name:ln,sha:l.sha};
  }else{
   local={name:branch,sha:entry.sha};
   const up=(await this.git(['rev-parse','--abbrev-ref','--symbolic-full-name',`refs/heads/${branch}@{upstream}`],{allow:[0,128]})).trim();
   const r=s.remotes.find(r=>up.startsWith(r+'/'))||null;
   const full=r?up:s.remotes.map(r=>`${r}/${branch}`).find(n=>s.branches.some(b=>b.remote&&b.name===n));
   if(full){const rr=s.remotes.find(r=>full.startsWith(r+'/'));const rb=s.branches.find(b=>b.remote&&b.name===full);if(rb)remote={remote:rr,name:full.slice(rr.length+1),full,sha:rb.sha};}
  }
  const delLocal=scope!=='remote',delRemote=scope!=='local';
  if(delLocal&&!local)throw new GitError(`Não existe branch local ${entry.remote?branch.slice(branch.indexOf('/')+1):branch}.`);
  if(delRemote&&!remote)throw new GitError(`A branch ${branch} não existe no remoto (faça fetch se acabou de ser criada).`);
  if(delLocal&&local.name===s.branch)throw new GitError(`${local.name} é a branch atual. Faça checkout de outra branch antes de apagá-la.`,409);
  if(delRemote&&remote.name.startsWith('-'))throw new GitError('Nome de branch inválido.');
  if(!force){
   const gone=new Set([...(delLocal?['refs/heads/'+local.name]:[]),...(delRemote?['refs/remotes/'+remote.full]:[])]);
   for(const sha of new Set([delLocal&&local.sha,delRemote&&remote.sha].filter(Boolean))){
    const holders=(await this.git(['for-each-ref','--contains',sha,'--format=%(refname)','refs/heads/','refs/remotes/'])).split('\n').filter(r=>r&&!r.endsWith('/HEAD')&&!gone.has(r));
    if(!holders.length&&!(s.head&&await this.isAncestor(sha,'HEAD')))throw new GitError(`Os commits de ${branch} não estão em nenhuma outra branch: apagar faria perder esse trabalho. Faça merge antes, ou marque "Apagar mesmo assim".`,409);
   }
  }
  const done=[];
  if(delRemote){await this.git(['push','--',remote.remote,`:refs/heads/${remote.name}`],{audit:true,timeout:120000});done.push(remote.full);}
  if(delLocal){await this.git(['branch','-D','--',local.name],{audit:true});done.push(`${local.name} (local)`);}
  return {message:`Apagada: ${done.join(' e ')}.`};
 });}
 async push(){return this.mutate(async()=>{
  const s=await this.status();
  if(!s.branch)throw new GitError('Selecione uma branch antes do push.');
  if(s.merging)throw new GitError('Conclua o merge antes do push.',409);
  if(s.branch.startsWith('-'))throw new GitError('Nome de branch inválido.');
  if(s.upstream&&s.remote&&s.remote!=='.'){
   if(s.behind)throw new GitError('O remoto tem commits que você ainda não tem. Faça pull antes do push.',409);
   const merge=(await this.git(['config','--get',`branch.${s.branch}.merge`],{allow:[0,1]})).trim()||`refs/heads/${s.branch}`;
   const out=await this.git(['push','--',s.remote,`refs/heads/${s.branch}:${merge}`],{audit:true,timeout:120000});
   return out;
  }
  const remote=s.remotes.includes('origin')?'origin':s.remotes[0];
  if(!remote||remote.startsWith('-'))throw new GitError('Este clone não tem remoto configurado.');
  return this.git(['push','--set-upstream','--',remote,`refs/heads/${s.branch}:refs/heads/${s.branch}`],{audit:true,timeout:120000});
 });}
 async diff({path:filename,staged=false,sha}){
  if(typeof filename!=='string'||filename.length>2000||filename.includes('\0'))throw new GitError('Caminho inválido.');
  if(sha){if(!/^[a-f0-9]{40,64}$/.test(sha))throw new GitError('Hash inválido.');const h=await this.history();if(!h.commits.some(c=>c.sha===sha))throw new GitError('Commit fora do histórico carregado.');const result=await this.git(['show','--format=','--no-ext-diff','--no-textconv',sha,'--',filename]);return result.slice(0,250000);}
  const files=await this.files(),f=files.find(f=>f.path===filename);if(!f)throw new GitError('Arquivo não está mais na lista de alterações.');
  if(f.conflicted){const target=path.resolve(this.root,filename);if(!target.startsWith(this.root+path.sep))throw new GitError('Arquivo fora do repositório.');let b;try{const actual=await realpath(target);if(!actual.startsWith(this.root+path.sep))throw new Error();b=await readFile(actual);}catch{return 'O arquivo foi removido em um dos lados do merge. Escolha a sua versão ou a versão deles.';}if(b.length>250000)return 'Arquivo maior que 250 KB. Resolva o conflito no seu editor.';return b.includes(0)?'Arquivo binário em conflito. Escolha a sua versão ou a versão deles.':b.toString('utf8');}
  if(f.untracked){const target=path.resolve(this.root,filename);if(!target.startsWith(this.root+path.sep))throw new GitError('Arquivo fora do repositório.');const info=await lstat(target);if(info.isSymbolicLink())return `Novo link simbólico: ${filename}\n→ ${await readlink(target)}`;const actual=await realpath(target);if(!actual.startsWith(this.root+path.sep))throw new GitError('Arquivo aponta para fora do repositório.');if(info.size>250000)return 'Arquivo novo maior que 250 KB. Abra-o no seu editor para revisar.';const b=await readFile(target);return b.includes(0)?'Arquivo binário novo. Revise no aplicativo apropriado.':`Arquivo novo: ${filename}\n\n${b.toString('utf8')}`;}
  const out=await this.git(['diff','--no-ext-diff','--no-textconv',...(staged?['--cached']:[]),'--',filename]);return out.length>250000?out.slice(0,250000)+'\n[diff truncado em 250 KB]':out||'Nenhuma diferença textual nesta seleção.';
 }
 async commitFiles(sha){if(!/^[a-f0-9]{40,64}$/.test(sha))throw new GitError('Hash inválido.');const h=await this.history();const commit=h.commits.find(c=>c.sha===sha);if(!commit)throw new GitError('Commit fora do histórico carregado.');if(commit.parents.length>1)return {files:[],merge:true};const raw=await this.git(['diff-tree','--root','--no-commit-id','--numstat','-r','-z',sha]);const files=[];const parts=raw.split('\0');for(let i=0;i<parts.length;i++){const row=parts[i].split('\t');if(row.length<3)continue;let filename=row.slice(2).join('\t');if(!filename){i++;filename=parts[++i];}files.push({path:filename,additions:Number(row[0])||0,deletions:Number(row[1])||0,binary:row[0]==='-'});}return {files,merge:false};}
}
