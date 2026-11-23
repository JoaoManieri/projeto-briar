// Conta do GitHub para listar repositórios, clonar com um clique e autenticar fetch/pull/push.
// Três formas de conectar, sem o Briar nunca pedir senha:
//  - entrar pelo navegador (OAuth device flow, o mesmo esquema do `gh auth login`);
//  - o login do GitHub CLI (`gh auth token`), quando ele está instalado e logado;
//  - um token de acesso pessoal colado pelo usuário.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
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

export async function githubUser(token){const {data}=await call(token,'/user');return {id:Number(data.id)||null,login:String(data.login||''),name:data.name?String(data.name):null,avatar:data.avatar_url?String(data.avatar_url):null};}

// E-mails para os commits: o endereço noreply do GitHub (liga o commit à conta sem expor o e-mail) e os
// e-mails verificados da conta, quando o token tem o escopo user:email.
export async function githubEmails(token,user){
 const out=[];
 if(user?.id&&user.login)out.push({email:`${user.id}+${user.login}@users.noreply.github.com`,noreply:true});
 try{const {data}=await call(token,'/user/emails');if(Array.isArray(data))for(const e of data.filter(e=>e.verified&&e.email&&!/noreply\.github\.com$/i.test(e.email)).sort((a,b)=>b.primary-a.primary))out.push({email:String(e.email),primary:!!e.primary});}catch{}
 return out;
}

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

// Login pelo navegador (OAuth device flow): o Briar pede um código ao GitHub, a pessoa confirma em
// github.com/login/device e o GitHub entrega o token. Esse fluxo não tem segredo de cliente, então o
// Client ID do OAuth App do Briar pode ficar no código aberto (BRIAR_GITHUB_CLIENT_ID troca por outro app;
// vazio = o botão "Entrar com o GitHub" some).
export const OAUTH_CLIENT_ID=process.env.BRIAR_GITHUB_CLIENT_ID||'Ov23lifScIlfTwhU0jCh';
// repo: clonar e enviar para privados · workflow: push que mexe em .github/workflows
// read:org: repositórios das organizações · user:email: sugerir o e-mail dos commits
export const OAUTH_SCOPES='repo workflow read:org user:email';

function explainOAuth(d){
 return d.error==='access_denied'?'A autorização foi recusada no GitHub.'
  :d.error==='expired_token'?'O código expirou. Clique em Entrar com o GitHub de novo.'
  :d.error==='device_flow_disabled'?'O login pelo navegador está desligado no OAuth App do Briar (opção Enable Device Flow).'
  :d.error==='incorrect_client_credentials'||d.error==='unauthorized_client'?'O Client ID do Briar não foi aceito pelo GitHub.'
  :`O GitHub recusou o login: ${d.error_description||d.error}`;
}

export class DeviceLogin{
 // onToken(token): valida e guarda o token; se lançar erro, o login falha com essa mensagem.
 // base/clientId/unit existem para os testes (unit = milissegundos por segundo de intervalo).
 constructor(onToken,{base='https://github.com',clientId=OAUTH_CLIENT_ID,unit=1000}={}){Object.assign(this,{onToken,base,clientId,unit,flow:null});}
 get available(){return !!this.clientId;}
 async post(route,params){
  let r;
  try{r=await fetch(this.base+route,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':'Briar-Git-Client'},body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});}
  catch{throw new GitError('Não foi possível falar com o GitHub. Verifique a internet.',502);}
  let data=null;try{data=await r.json();}catch{}
  if(!data||(!r.ok&&!data.error))throw new GitError(`O GitHub respondeu com erro ${r.status}.`,502);
  return data;
 }
 async start(){
  if(!this.clientId)throw new GitError('O login pelo navegador não está disponível nesta versão do Briar. Use o GitHub CLI ou um token.');
  this.cancel();
  const d=await this.post('/login/device/code',{client_id:this.clientId,scope:OAUTH_SCOPES});
  if(d.error||!d.device_code)throw new GitError(explainOAuth(d.error?d:{error:'resposta inválida'}));
  const flow={id:randomUUID(),code:String(d.user_code),url:String(d.verification_uri||'https://github.com/login/device'),expiresAt:Date.now()+(Number(d.expires_in)||900)*1000,interval:Math.max(1,Number(d.interval)||5),state:'pending',error:null,timer:null};
  this.flow=flow;
  const next=()=>{flow.timer=setTimeout(poll,flow.interval*this.unit);flow.timer.unref?.();};
  const fail=message=>{flow.state='error';flow.error=message;};
  const poll=async()=>{
   if(this.flow!==flow||flow.state!=='pending')return;
   if(Date.now()>flow.expiresAt)return fail('O código expirou. Clique em Entrar com o GitHub de novo.');
   let t;
   try{t=await this.post('/login/oauth/access_token',{client_id:this.clientId,device_code:d.device_code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'});}
   catch{if(this.flow===flow)next();return;} // rede oscilou: tenta de novo no próximo intervalo
   if(this.flow!==flow)return;
   if(t.access_token){try{await this.onToken(String(t.access_token));if(this.flow===flow)flow.state='done';}catch(e){fail(e.message||String(e));}return;}
   if(t.error==='authorization_pending')return next();
   if(t.error==='slow_down'){flow.interval=Math.max(flow.interval+5,Number(t.interval)||0);return next();}
   fail(explainOAuth(t));
  };
  next();
  return this.view();
 }
 view(){const f=this.flow;return f?{state:f.state,code:f.code,url:f.url,expiresAt:f.expiresAt,error:f.error}:{state:'idle'};}
 cancel(){if(this.flow){clearTimeout(this.flow.timer);this.flow=null;}return this.view();}
}
