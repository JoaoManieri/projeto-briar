import {useEffect,useState,type ReactNode} from 'react';
import {ArrowRight,Check,Download,LoaderCircle,LogOut,RefreshCw,Sprout,X} from 'lucide-react';
import {api} from './api';
import {GitHubConnect,sourceLabel,type GitHubStatus} from './GitHub';

export type SetupState={needed:boolean;done:boolean;git:{installed:boolean;version:string|null};identity:{name:string;email:string};plan:{method:'winget'|'download'|'pkexec'|null;command:string|null}|null;install:{running:boolean;phase:string;percent:number|null;error:string|null;done:boolean};platform:string};
type Suggest={name:string|null;emails:{email:string;noreply?:boolean;primary?:boolean}[]};

function Step({n,title,done,summary,action,children}:{n:number;title:string;done:boolean;summary?:ReactNode;action?:ReactNode;children?:ReactNode}){
  return <section className={`setup-step ${done?'done':''}`}>
    <div className="setup-step-head"><span className="setup-num">{done?<Check size={13}/>:n}</span><span className="setup-step-title">{title}</span>{summary&&<span className="setup-step-summary">{summary}</span>}<span className="grow"/>{action}</div>
    {children&&<div className="setup-step-body">{children}</div>}
  </section>;
}

const INSTALL_NOTE={
  winget:'Usa o winget, o instalador de programas do próprio Windows. O Windows vai pedir permissão de administrador.',
  download:'Baixa o instalador oficial do Git for Windows e confere a assinatura digital antes de rodar. O Windows vai pedir permissão de administrador.',
  pkexec:'Usa o gerenciador de pacotes do sistema. Vai pedir a sua senha.',
};

// Primeiro uso: Git instalado, conta do GitHub conectada e nome/e-mail dos commits. Cada passo mostra
// o que já está pronto; só o Git é obrigatório. No fim (onFinish) a tela inicial abre em Clonar quando
// o GitHub foi conectado.
export function SetupWizard({initial,onFinish}:{initial:SetupState;onFinish:(github:boolean)=>void}){
  const [setup,setSetup]=useState(initial);
  const [gh,setGh]=useState<GitHubStatus|null>(null);
  const [suggest,setSuggest]=useState<Suggest|null>(null);
  const [name,setName]=useState(initial.identity.name);
  const [email,setEmail]=useState(initial.identity.email);
  const [editIdentity,setEditIdentity]=useState(!initial.identity.name||!initial.identity.email);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const git=setup.git.installed,install=setup.install,plan=setup.plan;
  const identityDone=!!setup.identity.name&&!!setup.identity.email&&!editIdentity;

  async function reload(){const s:SetupState=await api('setup');setSetup(s);return s;}
  useEffect(()=>{api('github').then(setGh).catch(e=>setError((e as Error).message));},[]);
  // Instalação do Git em andamento: acompanha até terminar.
  useEffect(()=>{
    if(!install.running)return;
    const t=setInterval(()=>{reload().then(s=>{if(s.install.error)setError(s.install.error);}).catch(()=>{});},1000);
    return()=>clearInterval(t);
  },[install.running]);
  // Com o GitHub conectado, sugere o nome e o e-mail da conta (sem apagar o que já foi digitado).
  useEffect(()=>{
    if(!gh?.connected)return;
    api('github/identity').then((s:Suggest)=>{setSuggest(s);setName(n=>n.trim()?n:s.name||'');setEmail(m=>m.trim()?m:s.emails[0]?.email||'');}).catch(()=>{});
  },[gh?.connected]);

  async function installGit(){
    setError('');
    try{const st=await api('setup/install-git',{});setSetup(s=>({...s,install:st}));if(st.done)await reload();}
    catch(e){setError((e as Error).message);}
  }
  async function recheck(){setBusy('recheck');setError('');try{const s=await reload();if(!s.git.installed)setError('O Git ainda não foi encontrado. Se acabou de instalar, feche e abra o Briar.');}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function saveIdentity(){
    const id=await api('setup/identity',{name:name.trim(),email:email.trim()});
    setSetup(s=>({...s,identity:id}));setEditIdentity(false);
  }
  async function submitIdentity(e:React.FormEvent){e.preventDefault();setBusy('identity');setError('');try{await saveIdentity();}catch(err){setError((err as Error).message);}finally{setBusy('');}}
  async function disconnect(){try{setGh(await api('github/disconnect',{}));setSuggest(null);}catch(e){setError((e as Error).message);}}
  async function finish(){
    setBusy('finish');setError('');
    try{
      // Nome e e-mail preenchidos mas não salvos: salva junto.
      if(git&&editIdentity&&name.trim()&&email.trim())await saveIdentity();
      await api('setup/done',{});onFinish(!!gh?.connected);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }

  const avatar=gh?.user?.avatar?gh.user.avatar+(gh.user.avatar.includes('?')?'&':'?')+'s=40':null;
  return <div className="welcome-card setup-card">
    <span className="brand"><span className="brand-icon"><Sprout size={18}/></span><span>Briar</span></span>
    <h1>Vamos deixar tudo pronto</h1>
    <p className="setup-lead">Três passos e você já pode clonar seus repositórios. Dá para mudar tudo depois em <b>Configurar Git e GitHub</b>, na tela inicial.</p>
    <div className="setup-steps">
      <Step n={1} title="Git" done={git} summary={git?`versão ${setup.git.version}`:null}>
        {!git&&<>
          <p className="modal-text">O Briar trabalha com o Git instalado no computador, e ele ainda não foi encontrado.</p>
          {install.running?<div className="clone-progress" role="status">
            <div className={`clone-bar ${install.percent==null?'indeterminate':''}`}><span style={{width:`${install.percent??30}%`}}/></div>
            <div className="clone-status"><LoaderCircle size={13} className="spinning"/><span>{install.phase}{install.percent!=null&&` ${install.percent}%`}</span></div>
          </div>
          :<>
            <div className="connect-actions">
              {plan?.method&&<button className="btn primary" onClick={installGit}><Download size={14}/>Instalar o Git</button>}
              <button className="btn ghost" disabled={!!busy} onClick={recheck}><RefreshCw size={13}/>{busy==='recheck'?'Procurando…':'Já instalei, verificar'}</button>
            </div>
            {plan?.method&&<p className="muted small">{INSTALL_NOTE[plan.method]}</p>}
            {plan?.command&&plan.method!=='winget'&&plan.method!=='download'&&<><p className="muted small">{plan.method?'Ou instale pelo terminal:':'Instale pelo terminal:'}</p><pre className="cmd">{plan.command}</pre></>}
            {!plan?.command&&<p className="muted small">Baixe em <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">git-scm.com/downloads</a>.</p>}
          </>}
        </>}
      </Step>

      <Step n={2} title="Conta do GitHub" done={!!gh?.connected}
        summary={!gh?<LoaderCircle size={12} className="spinning"/>:gh.connected?<span className="setup-account">{avatar&&<img src={avatar} alt="" width={18} height={18}/>}<b>{gh.user?.login}</b><span className="muted"> · via {sourceLabel(gh.source)}</span></span>:<span className="muted">opcional</span>}
        action={gh?.connected&&<button className="btn ghost xs" onClick={disconnect}><LogOut size={12}/>Desconectar</button>}>
        {gh&&!gh.connected&&<GitHubConnect status={gh} onConnected={setGh} onForget={disconnect} intro="Para escolher entre os seus repositórios, inclusive os privados e os das organizações, e fazer fetch, pull e push em https://github.com sem configurar mais nada."/>}
      </Step>

      <Step n={3} title="Nome e e-mail dos commits" done={identityDone}
        summary={identityDone?<span>{setup.identity.name} <span className="muted">&lt;{setup.identity.email}&gt;</span></span>:null}
        action={identityDone&&<button className="btn ghost xs" onClick={()=>{setName(setup.identity.name);setEmail(setup.identity.email);setEditIdentity(true);}}>Alterar</button>}>
        {!git?<p className="muted small">Disponível depois de instalar o Git.</p>
        :editIdentity&&<form onSubmit={submitIdentity}>
          <p className="modal-text">Vão em cada commit que você fizer, em qualquer repositório deste computador.</p>
          <div className="clone-grid identity-grid">
            <label className="field"><span>Nome</span><input value={name} onChange={e=>setName(e.target.value)} placeholder="Seu nome" autoComplete="name" spellCheck={false}/></label>
            <label className="field"><span>E-mail</span><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@exemplo.com" autoComplete="email" spellCheck={false}/></label>
          </div>
          {!!suggest?.emails.length&&<div className="chips" aria-label="E-mails da sua conta do GitHub">{suggest.emails.map(e=><button type="button" key={e.email} className={`chip ${email.trim()===e.email?'on':''}`} onClick={()=>setEmail(e.email)} title={e.email}>{e.noreply?'Privado (noreply do GitHub)':e.email}{e.primary&&<span className="muted"> · principal</span>}</button>)}</div>}
          {suggest?.emails.some(e=>e.noreply)&&<p className="muted small">O endereço <b>noreply</b> liga os commits à sua conta do GitHub sem mostrar o seu e-mail para quem vê o histórico.</p>}
          <div className="connect-actions"><button className="btn ghost" type="submit" disabled={!!busy||!name.trim()||!email.trim()}><Check size={13}/>{busy==='identity'?'Salvando…':'Salvar'}</button></div>
        </form>}
      </Step>
    </div>
    {error&&<div className="inline-error" role="alert">{error}<button aria-label="Dispensar" onClick={()=>setError('')}><X size={13}/></button></div>}
    <div className="setup-actions">
      {!git&&<span className="muted small grow">Sem o Git, o Briar não consegue abrir repositórios.</span>}
      {!(git&&identityDone&&gh?.connected)&&<button className="btn ghost" disabled={!!busy||install.running} onClick={finish}>Pular por agora</button>}
      <button className="btn primary" disabled={!!busy||!git||install.running} onClick={finish}>{busy==='finish'?'Salvando…':<>Começar a usar<ArrowRight size={14}/></>}</button>
    </div>
  </div>;
}
