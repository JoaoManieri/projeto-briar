// Primeiro uso: encontra o Git (ou instala), e lê/grava o nome e o e-mail dos commits.
// - Windows: winget; sem winget, o instalador oficial do Git for Windows (baixado das Releases dele e
//   conferido pela assinatura digital antes de rodar). O Windows pede a permissão de administrador.
// - Linux: o gerenciador de pacotes da distribuição via pkexec (janela de senha do sistema).
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,createWriteStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {GitError} from './git.mjs';
const exec=promisify(execFile);
const isWin=process.platform==='win32';
const quiet={timeout:15000,windowsHide:true,encoding:'utf8'};

async function gitVersion(){try{const {stdout}=await exec('git',['--version'],quiet);return stdout.trim().replace(/^git version\s*/,'')||null;}catch{return null;}}
async function runs(cmd,args){try{await exec(cmd,args,quiet);return true;}catch{return false;}}

// Onde o Git for Windows fica depois de instalado. O PATH deste processo é o de quando o Briar abriu, então
// um Git recém-instalado só é achado assim; a pasta entra no PATH do Briar e vale para todos os comandos.
const windowsGitDirs=()=>{const e=process.env;return [...new Set([e.ProgramW6432,e.ProgramFiles,e['ProgramFiles(x86)'],e.LOCALAPPDATA&&path.join(e.LOCALAPPDATA,'Programs')].filter(Boolean))].map(base=>path.join(base,'Git','cmd'));};

export async function findGit(){
 let version=await gitVersion();
 if(!version&&isWin){
  for(const dir of windowsGitDirs()){
   if(!existsSync(path.join(dir,'git.exe')))continue;
   process.env.PATH=`${dir}${path.delimiter}${process.env.PATH||''}`;
   if((version=await gitVersion()))break;
  }
 }
 return {installed:!!version,version};
}

const LINUX=[['apt-get',['install','-y','git'],'sudo apt install git'],['dnf',['install','-y','git'],'sudo dnf install git'],['pacman',['-S','--noconfirm','--needed','git'],'sudo pacman -S git'],['zypper',['--non-interactive','install','git'],'sudo zypper install git']];
// [caminho completo, argumentos, comando para mostrar]; chamado pelo caminho, sem depender do PATH.
const linuxManager=()=>{for(const [bin,args,command] of LINUX)for(const d of ['/usr/bin','/bin','/usr/sbin']){const full=path.join(d,bin);if(existsSync(full))return [full,args,command];}return null;};
const PKEXEC='/usr/bin/pkexec';

// Como instalar o Git nesta máquina. method null = só dá para mostrar o comando (ou o link do site).
// Calculado uma vez por execução (a interface consulta o estado a cada segundo durante a instalação).
let plan=null;
export async function installPlan(){return plan||=await detectPlan();}
async function detectPlan(){
 if(isWin)return {method:await runs('winget',['--version'])?'winget':'download',command:'winget install --id Git.Git -e --source winget'};
 if(process.platform==='linux'){const pm=linuxManager();return {method:pm&&existsSync(PKEXEC)?'pkexec':null,command:pm?.[2]||null};}
 if(process.platform==='darwin')return {method:null,command:'xcode-select --install'};
 return {method:null,command:null};
}

// Nome e e-mail dos commits (config global ou do sistema). Lido fora de qualquer repositório.
export async function gitIdentity(){
 const get=async key=>{try{return (await exec('git',['config','--get',key],{...quiet,cwd:os.tmpdir()})).stdout.trim();}catch{return '';}};
 const [name,email]=await Promise.all([get('user.name'),get('user.email')]);
 return {name,email};
}
export async function setGitIdentity({name,email}={}){
 const n=typeof name==='string'?name.trim():'',m=typeof email==='string'?email.trim():'';
 if(!n||n.length>200||/[\0\r\n<>]/.test(n))throw new GitError('Informe um nome válido.');
 if(m.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(m))throw new GitError('Informe um e-mail válido.');
 await exec('git',['config','--global','user.name',n],{...quiet,cwd:os.tmpdir()});
 await exec('git',['config','--global','user.email',m],{...quiet,cwd:os.tmpdir()});
 return gitIdentity();
}

// Instalação em segundo plano; a interface acompanha por GET /api/setup.
export class GitInstaller{
 constructor(){this.state={running:false,phase:'',percent:null,error:null,done:false};this.wingetFailed=false;}
 view(){return {...this.state};}
 async start(){
  if(this.state.running)return this.view();
  if((await findGit()).installed){this.state={running:false,phase:'',percent:null,error:null,done:true};return this.view();}
  const base=await installPlan();
  // Se o winget já falhou (sem rede, permissão negada…), o próximo clique usa o instalador oficial.
  const plan=base.method==='winget'&&this.wingetFailed?{...base,method:'download'}:base;
  if(!plan.method)throw new GitError(plan.command?`Instale pelo terminal: ${plan.command}`:'Instale o Git pelo site git-scm.com/downloads.');
  this.state={running:true,phase:'Preparando…',percent:null,error:null,done:false};
  const set=patch=>Object.assign(this.state,patch);
  (async()=>{
   if(plan.method==='winget'){
    set({phase:'Instalando pelo winget… confirme a permissão de administrador do Windows.'});
    try{await exec('winget',['install','--id','Git.Git','-e','--source','winget','--silent','--accept-package-agreements','--accept-source-agreements'],{windowsHide:true,timeout:20*60000});}catch{}
    // Não emenda outra tentativa sozinho: se a pessoa negou a permissão, um segundo pedido seria chato.
    if(!(await findGit()).installed){this.wingetFailed=true;throw new GitError('O winget não conseguiu instalar o Git (sem permissão de administrador ou sem acesso à loja). Clique em Instalar o Git de novo para usar o instalador oficial do Git for Windows.');}
   }
   else if(plan.method==='download')await officialInstaller(set);
   else{
    const [bin,args]=linuxManager();
    set({phase:'Instalando… digite a senha do sistema na janela que abrir.'});
    try{await exec(PKEXEC,[bin,...args],{timeout:20*60000});}
    catch(e){throw new GitError(e.code===126||e.code===127?`A instalação foi cancelada. Para instalar pelo terminal: ${plan.command}`:`A instalação falhou. Tente pelo terminal: ${plan.command}`);}
   }
   const git=await findGit();
   if(!git.installed)throw new GitError('A instalação terminou, mas o Git não foi encontrado. Feche e abra o Briar de novo.');
   set({running:false,done:true,phase:`Git ${git.version} instalado.`,percent:100});
  })().catch(e=>set({running:false,error:e.message||String(e),phase:''}));
  return this.view();
 }
}

// Instalador oficial do Git for Windows (Releases de git-for-windows/git). Antes de rodar, confere o
// SHA-256 publicado pelo GitHub e a assinatura digital do arquivo.
async function officialInstaller(set){
 set({phase:'Procurando a versão mais nova do Git…',percent:null});
 let rel;
 try{const r=await fetch('https://api.github.com/repos/git-for-windows/git/releases/latest',{headers:{Accept:'application/vnd.github+json','User-Agent':'Briar-Git-Client'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error();rel=await r.json();}
 catch{throw new GitError('Não foi possível consultar a versão do Git. Verifique a internet ou instale pelo site git-scm.com.');}
 const arch=process.arch==='arm64'?'arm64':'64-bit';
 const asset=(rel.assets||[]).find(a=>new RegExp(`^Git-[\\d.]+-${arch}\\.exe$`).test(a.name));
 if(!asset)throw new GitError('Não achei o instalador do Git para este Windows. Instale pelo site git-scm.com.');
 const dir=await mkdtemp(path.join(os.tmpdir(),'briar-git-'));
 const file=path.join(dir,asset.name);
 try{
  const res=await fetch(asset.browser_download_url,{headers:{'User-Agent':'Briar-Git-Client'},signal:AbortSignal.timeout(30*60000)});
  if(!res.ok||!res.body)throw new GitError(`O download do Git falhou (erro ${res.status}).`);
  const total=Number(res.headers.get('content-length'))||asset.size||0;
  const hash=createHash('sha256');let got=0;
  set({phase:`Baixando o Git ${rel.tag_name||''}…`.replace(' …','…'),percent:0});
  await pipeline(Readable.fromWeb(res.body),new Transform({transform(chunk,_e,cb){hash.update(chunk);got+=chunk.length;if(total)set({percent:Math.min(99,Math.floor(got*100/total))});cb(null,chunk);}}),createWriteStream(file));
  const sha=hash.digest('hex');
  if(typeof asset.digest==='string'&&asset.digest.startsWith('sha256:')&&asset.digest.slice(7).toLowerCase()!==sha)throw new GitError('O arquivo baixado não confere com o publicado pelo Git for Windows. Tente de novo.');
  set({phase:'Instalando… confirme a permissão de administrador do Windows.',percent:null});
  // Caminho pelo ambiente, nunca no texto do script.
  const script="$ErrorActionPreference='Stop';$f=$env:BRIAR_GIT_SETUP;if((Get-AuthenticodeSignature -LiteralPath $f).Status -ne 'Valid'){exit 90};try{$p=Start-Process -FilePath $f -ArgumentList '/VERYSILENT','/NORESTART','/NOCANCEL','/SP-','/SUPPRESSMSGBOXES' -Verb RunAs -Wait -PassThru}catch{exit 91};exit $p.ExitCode";
  try{await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,timeout:20*60000,env:{...process.env,BRIAR_GIT_SETUP:file}});}
  catch(e){throw new GitError(e.code===90?'A assinatura digital do instalador do Git não é válida. Nada foi instalado.':e.code===91?'O Windows não deu permissão de administrador, então o Git não foi instalado.':`O instalador do Git terminou com erro${typeof e.code==='number'?` (código ${e.code})`:''}.`);}
 }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
