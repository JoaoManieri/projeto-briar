import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {GitRepository} from '../server/git.mjs';
import {DeviceLogin} from '../server/github.mjs';
import {gitIdentity,setGitIdentity,findGit} from '../server/setup.mjs';
import {createApp} from '../server/index.mjs';
const exec=promisify(execFile);
// Mesmo ambiente do git.test.mjs, mais um config global isolado (o do usuário nunca é tocado).
const home=await mkdtemp(path.join(os.tmpdir(),'briar-setup-home-'));
Object.assign(process.env,{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.autocrlf',GIT_CONFIG_VALUE_0:'false',GIT_CONFIG_GLOBAL:path.join(home,'gitconfig'),GIT_CONFIG_NOSYSTEM:'1'});
const git=async(p,...args)=>(await exec('git',['-C',p,...args],{encoding:'utf8'})).stdout.trim();
async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'briar-setup-repo-'));await git(root,'init','-b','main');await git(root,'config','user.name','T');await git(root,'config','user.email','t@example.invalid');await writeFile(path.join(root,'a.txt'),'a\n');await git(root,'add','.');await git(root,'commit','-m','a');return GitRepository.open(root);}
const until=async(fn,ms=3000)=>{const end=Date.now()+ms;while(!fn()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));};

test('Git encontrado com versão',async()=>{const g=await findGit();assert.equal(g.installed,true);assert.match(g.version,/^\d+\.\d+/);});

test('fetch/pull/push em https://github.com levam o token da conta conectada; outros servidores e comandos locais não',async()=>{
 const repo=await fixture();
 const header='AUTHORIZATION: basic '+Buffer.from('x-access-token:tok123').toString('base64');
 const urlmatch=(env,url)=>exec('git',['config','--get-urlmatch','http.extraheader',url],{env,encoding:'utf8'}).then(r=>r.stdout.trim());
 repo.githubToken=async()=>'tok123';
 for(const cmd of ['fetch','pull','push','ls-remote']){const env=await repo.envFor([cmd,'origin']);assert.equal(await urlmatch(env,'https://github.com/dono/projeto.git'),header);assert.equal(env.GIT_CONFIG_KEY_0,'core.autocrlf');}
 const env=await repo.envFor(['fetch','origin']);
 await assert.rejects(()=>urlmatch(env,'https://gitlab.com/dono/projeto.git'));
 await assert.rejects(()=>urlmatch(env,'https://github.com.evil.invalid/dono/projeto.git'));
 assert.equal((await repo.envFor(['status'])).GIT_CONFIG_COUNT,'1');
 repo.githubToken=async()=>null;
 assert.equal((await repo.envFor(['push','origin'])).GIT_CONFIG_COUNT,'1');
 // O token nunca aparece no histórico de comandos.
 repo.githubToken=async()=>'tok123';
 await repo.git(['ls-remote','--','.'],{audit:true});
 assert.ok(!JSON.stringify(repo.audit).includes('tok123'));
});

test('nome e e-mail dos commits: valida, grava no config global e lê de volta',async()=>{
 assert.deepEqual(await gitIdentity(),{name:'',email:''});
 await assert.rejects(()=>setGitIdentity({name:'',email:'a@b.co'}),/nome/);
 await assert.rejects(()=>setGitIdentity({name:'Ana\nSouza',email:'a@b.co'}),/nome/);
 await assert.rejects(()=>setGitIdentity({name:'Ana',email:'sem-arroba'}),/e-mail/);
 await assert.rejects(()=>setGitIdentity({name:'Ana',email:'a@b'}),/e-mail/);
 assert.deepEqual(await setGitIdentity({name:'  Ana Souza ',email:'1+ana@users.noreply.github.com'}),{name:'Ana Souza',email:'1+ana@users.noreply.github.com'});
 assert.match(await readFile(process.env.GIT_CONFIG_GLOBAL,'utf8'),/name = Ana Souza/);
});

// GitHub falso: /login/device/code e /login/oauth/access_token respondem como o de verdade.
async function fakeGitHub(answers){
 const calls=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;const q=Object.fromEntries(new URLSearchParams(body));calls.push({url:req.url,...q});
  res.setHeader('Content-Type','application/json');
  if(req.url==='/login/device/code')return res.end(JSON.stringify({device_code:'dev-1',user_code:'ABCD-1234',verification_uri:'https://github.com/login/device',expires_in:900,interval:1}));
  if(req.url==='/login/oauth/access_token')return res.end(JSON.stringify(answers.shift()||{error:'authorization_pending'}));
  res.statusCode=404;res.end('{}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {base:`http://127.0.0.1:${server.address().port}`,calls,close:()=>new Promise(r=>server.close(r))};
}

test('login pelo navegador: mostra o código, espera, respeita slow_down e entrega o token',async()=>{
 const gh=await fakeGitHub([{error:'authorization_pending'},{error:'slow_down',interval:1},{access_token:'gho_abcdefghijklmnopqrstuvwxyz',token_type:'bearer',scope:'repo'}]);
 try{
  const got=[];
  const login=new DeviceLogin(async t=>{got.push(t);},{base:gh.base,clientId:'cid-123',unit:5});
  const v=await login.start();
  assert.deepEqual([v.state,v.code,v.url],['pending','ABCD-1234','https://github.com/login/device']);
  const ask=gh.calls[0];assert.equal(ask.client_id,'cid-123');assert.match(ask.scope,/\brepo\b/);assert.match(ask.scope,/\bworkflow\b/);assert.equal(ask.client_secret,undefined);
  await until(()=>login.view().state!=='pending');
  assert.equal(login.view().state,'done');
  assert.deepEqual(got,['gho_abcdefghijklmnopqrstuvwxyz']);
  const polls=gh.calls.filter(c=>c.url==='/login/oauth/access_token');
  assert.equal(polls.length,3);assert.ok(polls.every(p=>p.device_code==='dev-1'&&p.grant_type==='urn:ietf:params:oauth:grant-type:device_code'));
 }finally{await gh.close();}
});

test('login pelo navegador: recusa, token que não valida, cancelar e Client ID ausente',async()=>{
 const gh=await fakeGitHub([{error:'access_denied'},{access_token:'gho_abcdefghijklmnopqrstuvwxyz'}]);
 try{
  const login=new DeviceLogin(async()=>{throw new Error('O GitHub recusou o acesso: o token é inválido ou expirou.');},{base:gh.base,clientId:'cid',unit:5});
  await login.start();await until(()=>login.view().state!=='pending');
  assert.equal(login.view().state,'error');assert.match(login.view().error,/recusada/);
  await login.start();await until(()=>login.view().state!=='pending');
  assert.equal(login.view().state,'error');assert.match(login.view().error,/token é inválido/);
  await login.start();assert.equal(login.cancel().state,'idle');
  const before=gh.calls.length;await new Promise(r=>setTimeout(r,40));assert.equal(gh.calls.length,before);
  assert.equal(new DeviceLogin(()=>{},{clientId:''}).available,false);
  await assert.rejects(()=>new DeviceLogin(()=>{},{clientId:''}).start(),/não está disponível/);
 }finally{await gh.close();}
});

test('API do primeiro uso: estado, nome/e-mail, concluir e lembrar',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'briar-setup-cfg-'));const configPath=path.join(dir,'settings.json');const port=14319;
 const gitconfig=process.env.GIT_CONFIG_GLOBAL;process.env.GIT_CONFIG_GLOBAL=path.join(dir,'gitconfig');
 const app=await createApp({port,configPath,oauth:{clientId:''}});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
 const base=`http://127.0.0.1:${port}`;const h={'X-Pindorama-Client':'local','Content-Type':'application/json','Origin':base};
 const get=async route=>(await fetch(base+'/api/'+route,{headers:{'X-Pindorama-Client':'local'}})).json();
 const post=async(route,body)=>{const r=await fetch(base+'/api/'+route,{method:'POST',headers:h,body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  let s=await get('setup');
  assert.equal(s.git.installed,true);assert.deepEqual(s.identity,{name:'',email:''});assert.equal(s.needed,true);assert.equal(s.done,false);assert.equal(s.plan,null);
  assert.equal((await post('setup/identity',{name:'Ana',email:'x'})).status,400);
  assert.deepEqual((await post('setup/identity',{name:'Ana',email:'ana@example.com'})).data,{name:'Ana',email:'ana@example.com'});
  s=await get('setup');assert.equal(s.needed,true,'instalação nova sem GitHub ainda mostra o assistente');
  assert.equal((await post('github/device/start',{})).status,400,'sem Client ID o login pelo navegador não começa');
  s=(await post('setup/done',{})).data;assert.equal(s.done,true);assert.equal(s.needed,false);
  assert.equal(JSON.parse(await readFile(configPath,'utf8')).setupDone,true);
 }finally{await new Promise(r=>app.server.close(r));process.env.GIT_CONFIG_GLOBAL=gitconfig;}
 // Reabrindo o Briar, o assistente não volta.
 const again=await createApp({port,configPath,oauth:{clientId:''}});await new Promise(r=>again.server.listen(port,'127.0.0.1',r));
 try{const s=await (await fetch(base+'/api/setup',{headers:{'X-Pindorama-Client':'local'}})).json();assert.equal(s.done,true);}
 finally{await new Promise(r=>again.server.close(r));}
});
