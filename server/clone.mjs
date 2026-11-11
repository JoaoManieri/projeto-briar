// Clonar repositórios: valida a URL e a pasta de destino, roda `git clone --progress` em segundo plano
// e expõe o andamento (fase, %, velocidade) para a interface consultar enquanto o clone acontece.
import {spawn} from 'node:child_process';
import {stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {GitError} from './git.mjs';

export const expandHome=p=>p==='~'?homedir():/^~[\\/]/.test(p)?path.join(homedir(),p.slice(2)):p;

// Aceita https/http/ssh/git://, file://, o formato scp do SSH (git@github.com:dono/projeto.git) e caminho local.
// Nada de transportes externos (ext::, fd::…) nem algo que o Git possa ler como opção.
export function parseCloneUrl(input){
 const url=typeof input==='string'?input.trim():'';
 if(!url)throw new GitError('Cole a URL do repositório.');
 if(url.length>2000||/[\s\0]/.test(url)||url.startsWith('-')||/^[\w+.-]+::/.test(url))throw new GitError('URL inválida.');
 const ok=/^(?:https?|ssh|git):\/\/[^/\s]+\/.+/i.test(url)||/^file:\/\/.+/i.test(url)||/^[\w.-]+@[\w.-]+:.+/.test(url)||/^(?:\/|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/.test(url);
 if(!ok)throw new GitError('Use uma URL https://…, git@servidor:dono/projeto.git ou o caminho de um repositório local.');
 return /^(?:\/|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/])/.test(url)?path.resolve(expandHome(url)):url;
}

// Nome da pasta sugerido pela URL: …/dono/projeto.git → projeto
export function repoName(url){const clean=String(url||'').trim().replace(/[\\/]+$/,'').replace(/\.git$/i,'');const m=/[^\\/:]+$/.exec(clean);return m?m[0]:'';}

function checkName(name){
 if(typeof name!=='string'||!name.trim())throw new GitError('Informe o nome da pasta do clone.');
 const n=name.trim();
 if(n.length>200||n==='.'||n==='..'||/[\\/\0:*?"<>|]/.test(n)||/[. ]$/.test(n))throw new GitError('Nome de pasta inválido.');
 return n;
}

async function checkParent(input){
 if(typeof input!=='string'||!input.trim()||input.includes('\0'))throw new GitError('Escolha a pasta onde o clone vai ficar.');
 const dir=path.resolve(expandHome(input.trim()));
 let st;try{st=await stat(dir);}catch{throw new GitError(`A pasta ${dir} não existe.`);}
 if(!st.isDirectory())throw new GitError(`${dir} não é uma pasta.`);
 return dir;
}

// Erros comuns do Git explicados em português; a saída original vem logo abaixo.
function explain(log){
 const out=log.replace(/\r/g,'\n').split('\n').map(l=>l.trim()).filter(l=>l&&!/^(?:remote: )?(?:Counting|Compressing|Receiving|Resolving|Enumerating|Total|Updating files)/.test(l)).slice(-12).join('\n');
 const hint=/could not read Username|terminal prompts disabled|Authentication failed|invalid username or password/i.test(log)?'O servidor pediu login. Conecte o GitHub no Briar, configure a autenticação HTTPS do Git (por exemplo, gh auth setup-git) ou use a URL SSH.'
  :/Permission denied \(publickey/i.test(log)?'A chave SSH foi recusada. Verifique se ela está cadastrada na sua conta (ssh -T git@github.com) ou use a URL HTTPS.'
  :/Host key verification failed/i.test(log)?'O SSH ainda não conhece esse servidor. Rode uma vez no terminal, por exemplo ssh -T git@github.com, e confirme.'
  :/Repository not found|does not appear to be a git repository|not found/i.test(log)?'Repositório não encontrado, ou sua conta não tem acesso a ele.'
  :/Could not resolve host|unable to access|Connection timed out|Network is unreachable/i.test(log)?'Não foi possível alcançar o servidor. Verifique a internet e a URL.'
  :'O clone falhou.';
 return out?`${hint}\n\n${out}`:hint;
}

const PHASES={'Enumerating objects':'Listando objetos','Counting objects':'Contando objetos','Compressing objects':'Comprimindo objetos','Receiving objects':'Recebendo objetos','Resolving deltas':'Resolvendo deltas','Updating files':'Criando os arquivos','Checking out files':'Criando os arquivos'};

// Soma pares de configuração ao ambiente sem apagar os que já existem (GIT_CONFIG_COUNT/KEY/VALUE).
// Diferente de `git -c`, não aparece na lista de processos e não fica gravado no .git/config do clone.
function withConfig(env,pairs){const n=Number(env.GIT_CONFIG_COUNT)||0;const next={...env,GIT_CONFIG_COUNT:String(n+pairs.length)};pairs.forEach(([k,v],i)=>{next[`GIT_CONFIG_KEY_${n+i}`]=k;next[`GIT_CONFIG_VALUE_${n+i}`]=v;});return next;}

export class CloneJobs{
 constructor(){this.jobs=new Map();}
 // token: só usado para https://github.com/…, via cabeçalho HTTP no ambiente do processo (nunca na URL).
 async start({url,parent,name,token}={},onDone){
  const source=parseCloneUrl(url);
  const dir=await checkParent(parent);
  const folder=checkName(name||repoName(source));
  const dest=path.join(dir,folder);
  try{const st=await stat(dest);if(!st.isDirectory()||(await readdir(dest)).length)throw new GitError(`Já existe "${folder}" em ${dir}. Escolha outro nome para a pasta.`,409);}catch(e){if(e instanceof GitError)throw e;}
  if([...this.jobs.values()].some(j=>!j.done&&!j.error&&j.dest===dest))throw new GitError('Esse clone já está em andamento.',409);
  const id=randomUUID();
  const job={id,url:source,dest,parent:dir,phase:'Conectando…',percent:null,detail:'',done:false,error:null,root:null};
  let env={...process.env,GIT_TERMINAL_PROMPT:'0',LC_ALL:'C',GIT_ALLOW_PROTOCOL:'https:http:ssh:git:file'};
  if(token&&/^https:\/\/github\.com\//i.test(source))env=withConfig(env,[['http.https://github.com/.extraheader',`AUTHORIZATION: basic ${Buffer.from('x-access-token:'+token).toString('base64')}`]]);
  let log='',cancelled=false;
  const child=spawn('git',['clone','--progress','--',source,dest],{cwd:dir,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  const progress=chunk=>{
   log=(log+chunk).slice(-20000);
   const last=log.split(/[\r\n]/).map(l=>l.trim()).filter(Boolean).pop()||'';
   const m=/^(?:remote: )?([A-Za-z ]+?):\s+(\d+)%(?:\s*\(([^)]*)\))?(?:,\s*(.*?))?(?:, done\.)?$/.exec(last);
   if(m){job.phase=PHASES[m[1]]||m[1];job.percent=Number(m[2]);job.detail=[m[3],(m[4]||'').replace(/(?:^|,\s*)done\.?$/,'').trim()].filter(Boolean).join(' · ');}
   else if(/^Cloning into/.test(last))job.phase='Conectando…';
  };
  child.stdout.setEncoding('utf8').on('data',progress);
  child.stderr.setEncoding('utf8').on('data',progress);
  job.cancel=()=>{cancelled=true;child.kill();};
  child.on('error',e=>{job.finishedAt=Date.now();job.error=e.code==='ENOENT'?'O Git não foi encontrado. Instale o Git (git-scm.com) e abra o Briar de novo.':String(e.message||e);job.cancel=null;});
  child.on('close',async code=>{
   job.cancel=null;job.finishedAt=Date.now();
   if(job.error)return;
   if(cancelled){job.error='Clone cancelado.';return;}
   if(code!==0){job.error=explain(log);return;}
   try{job.root=await onDone?.(dest)||dest;job.done=true;job.phase='Pronto';job.percent=100;}catch(e){job.error=e.message||String(e);}
  });
  this.jobs.set(id,job);
  // Jobs terminados somem depois de 10 min.
  for(const [k,j] of this.jobs)if(j.finishedAt&&Date.now()-j.finishedAt>600000)this.jobs.delete(k);
  return this.view(job);
 }
 get(id){const job=this.jobs.get(id);if(!job)throw new GitError('Esse clone não existe mais.',404);return this.view(job);}
 cancel(id){const job=this.jobs.get(id);if(!job)throw new GitError('Esse clone não existe mais.',404);job.cancel?.();return this.view(job);}
 view(j){return {id:j.id,url:j.url,dest:j.dest,phase:j.phase,percent:j.percent,detail:j.detail,done:j.done,error:j.error,root:j.root,running:!j.done&&!j.error};}
}
