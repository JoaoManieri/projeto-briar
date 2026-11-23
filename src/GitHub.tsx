import {useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronRight,Copy,CopyCheck,ExternalLink,KeyRound,LoaderCircle,X} from 'lucide-react';
import {api} from './api';

export type GitHubStatus={connected:boolean;source:'gh'|'token'|'oauth'|null;user:{login:string;name:string|null;avatar:string|null}|null;gh:boolean;oauth:boolean;canStore:boolean;protocol:'ssh'|'https';error?:string};
type Device={state:'idle'|'pending'|'done'|'error';code?:string;url?:string;expiresAt?:number;error?:string|null};

export const GitHubMark=({size=15}:{size?:number})=><svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>;
export const sourceLabel=(s:GitHubStatus['source'])=>s==='gh'?'GitHub CLI':s==='oauth'?'navegador':'token';

// Conectar a conta do GitHub. O principal é "Entrar com o GitHub": o Briar mostra um código, abre
// github.com/login/device no navegador e espera a pessoa autorizar. GitHub CLI e token ficam em
// "Outras formas" (abertas de cara quando o login pelo navegador não está disponível).
export function GitHubConnect({status,onConnected,onForget,intro}:{status:GitHubStatus;onConnected:(st:GitHubStatus)=>void;onForget?:()=>void;intro?:string}){
  const [device,setDevice]=useState<Device>({state:'idle'});
  const [busy,setBusy]=useState(false);
  const [more,setMore]=useState(!status.oauth);
  const [token,setToken]=useState('');
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState('');
  const waiting=device.state==='pending';
  const done=useRef(false);

  async function copy(code:string){try{await navigator.clipboard.writeText(code);setCopied(true);}catch{setCopied(false);}}
  async function startDevice(){
    setBusy(true);setError('');setCopied(false);
    try{const d:Device=await api('github/device/start',{});setDevice(d);if(d.code)void copy(d.code);if(d.url)window.open(d.url,'_blank','noopener');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function cancelDevice(){setDevice({state:'idle'});try{await api('github/device/cancel',{});}catch{}}
  // Enquanto espera a autorização, consulta o servidor (é ele que conversa com o GitHub).
  useEffect(()=>{
    if(!waiting)return;
    const t=setInterval(async()=>{
      try{const d:Device=await api('github/device');
        if(d.state==='done'&&!done.current){done.current=true;onConnected(await api('github'));return;}
        if(d.state==='idle')setDevice({state:'idle'});else setDevice(d);
        if(d.state==='error')setError(d.error||'O login não foi concluído.');}
      catch(e){setError((e as Error).message);}
    },1500);
    return()=>clearInterval(t);
  },[waiting]);
  // Saiu da tela no meio do login: o servidor para de perguntar ao GitHub.
  useEffect(()=>()=>{if(!done.current)void api('github/device/cancel',{}).catch(()=>{});},[]);

  async function connect(how:'gh'|'token'){
    setBusy(true);setError('');
    try{const st:GitHubStatus=await api('github/connect',how==='gh'?{source:'gh'}:{source:'token',token:token.trim()});setToken('');done.current=true;onConnected(st);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }

  return <div className="gh-connect">
    {status.error&&<p className="note warn-note">{status.error}</p>}
    {intro&&<p className="modal-text">{intro}</p>}
    {status.oauth&&(waiting&&device.code?<div className="device">
        <p className="modal-text">O navegador abriu em <a href={device.url} target="_blank" rel="noreferrer">github.com/login/device</a>. Digite este código lá e clique em <b>Authorize</b>:</p>
        <div className="device-code"><code>{device.code}</code><button className="btn ghost sm" onClick={()=>copy(device.code!)}>{copied?<><CopyCheck size={13}/>Copiado</>:<><Copy size={13}/>Copiar</>}</button><a className="btn ghost sm" href={device.url} target="_blank" rel="noreferrer"><ExternalLink size={13}/>Abrir de novo</a></div>
        <div className="device-wait"><LoaderCircle size={13} className="spinning"/><span className="muted">Esperando a autorização no navegador…</span><button className="btn ghost xs" onClick={cancelDevice}><X size={12}/>Cancelar</button></div>
      </div>
      :<button className="btn primary" disabled={busy} onClick={startDevice}><GitHubMark size={14}/>{busy?'Abrindo o GitHub…':'Entrar com o GitHub'}</button>)}
    {status.oauth&&!waiting&&<p className="muted small">Abre o GitHub no navegador para você autorizar o Briar. Sua senha fica só no GitHub; o Briar recebe um token{status.canStore?' que fica guardado cifrado neste computador':' que vale até fechar o Briar'}.</p>}
    {!waiting&&<>
      {status.oauth&&<button className="linkish small more-toggle" onClick={()=>setMore(m=>!m)}>{more?<ChevronDown size={12}/>:<ChevronRight size={12}/>}Outras formas de conectar</button>}
      {more&&<div className="gh-more">
        {status.gh&&<button className={`btn ${status.oauth?'ghost':'primary'}`} disabled={busy} onClick={()=>connect('gh')}><GitHubMark size={14}/>Usar o login do GitHub CLI</button>}
        <form onSubmit={e=>{e.preventDefault();void connect('token');}}>
          <label className="field"><span>{status.gh?'Ou um token de acesso pessoal':'Token de acesso pessoal'}</span><span className="input-row"><input type="password" value={token} onChange={e=>setToken(e.target.value)} placeholder="ghp_…  ou  github_pat_…" autoComplete="off" spellCheck={false}/><button className="btn ghost" type="submit" disabled={busy||!token.trim()}><KeyRound size={13}/>Conectar</button></span></label>
          <p className="muted small">Crie em <a href="https://github.com/settings/tokens/new?description=Briar&scopes=repo,workflow,read:org,user:email" target="_blank" rel="noreferrer">github.com/settings/tokens</a> com o escopo <code>repo</code>. {status.canStore?'O token fica guardado cifrado neste computador.':'O token vale até fechar o Briar.'}{!status.gh&&<> Com o <a href="https://cli.github.com" target="_blank" rel="noreferrer">GitHub CLI</a> logado (<code>gh auth login</code>), nem precisa de token.</>}</p>
        </form>
      </div>}
    </>}
    {status.source&&!status.connected&&onForget&&<button className="linkish small" onClick={onForget}>Esquecer a conexão salva</button>}
    {error&&<div className="inline-error" role="alert">{error}<button aria-label="Dispensar" onClick={()=>setError('')}><X size={13}/></button></div>}
  </div>;
}
