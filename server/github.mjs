// Conta do GitHub para listar repositórios e clonar com um clique.
// Duas formas de conectar, sem o Briar nunca pedir senha:
//  - o login do GitHub CLI (`gh auth token`), quando ele está instalado e logado;
//  - um token de acesso pessoal colado pelo usuário.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {GitError} from './git.mjs';
const exec=promisify(execFile);
const API='https://api.github.com';
const quiet={timeout:10000,windowsHide:true,env:{...process.env,GH_PROMPT_DISABLED:'1',NO_COLOR:'1'}};

export const validToken=t=>typeof t==='string'&&/^[\w-]{20,255}$/.test(t.trim());

export async function ghCliToken(){try{const {stdout}=await exec('gh',['auth','token','--hostname','github.com'],quiet);const t=stdout.trim();return validToken(t)?t:null;}catch{return null;}}
// Protocolo que o usuário escolheu no `gh auth login` (ssh ou https); null se o gh não existe.
export async function ghCliProtocol(){try{const {stdout}=await exec('gh',['config','get','git_protocol','--host','github.com'],quiet);const p=stdout.trim();return p==='ssh'||p==='https'?p:null;}catch{return null;}}

async function call(token,route){
 let r;
 try{r=await fetch(API+route,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'Briar-Git-Client'},signal:AbortSignal.timeout(20000)});}
 catch{throw new GitError('Não foi possível falar com o GitHub. Verifique a internet.',502);}
 if(r.status===401)throw new GitError('O GitHub recusou o acesso: o token é inválido ou expirou.',401);
 if((r.status===403||r.status===429)&&r.headers.get('x-ratelimit-remaining')==='0')throw new GitError('Limite de consultas ao GitHub atingido. Tente de novo em alguns minutos.',429);
 if(!r.ok)throw new GitError(`O GitHub respondeu com erro ${r.status}.`,502);
 return {data:await r.json(),link:r.headers.get('link')||''};
}

export async function githubUser(token){const {data}=await call(token,'/user');return {login:String(data.login||''),name:data.name?String(data.name):null,avatar:data.avatar_url?String(data.avatar_url):null};}

// Repositórios da conta, das organizações e onde a pessoa colabora; os mais recentes primeiro (até 1000).
export async function githubRepos(token){
 const out=[];
 for(let page=1;page<=10;page++){
  const {data,link}=await call(token,`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`);
  if(!Array.isArray(data))break;
  for(const r of data)out.push({fullName:r.full_name,owner:r.owner?.login||'',name:r.name,private:!!r.private,fork:!!r.fork,archived:!!r.archived,description:r.description||'',pushedAt:r.pushed_at||r.updated_at||null,https:r.clone_url,ssh:r.ssh_url});
  if(!/rel="next"/.test(link))break;
 }
 return out;
}
