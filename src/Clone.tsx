import {useEffect,useMemo,useRef,useState} from 'react';
import {CloudDownload,FolderOpen,Globe,Link,LoaderCircle,Lock,LogOut,RefreshCw,Search,X} from 'lucide-react';
import {api} from './api';
import {GitHubConnect,GitHubMark,sourceLabel,type GitHubStatus} from './GitHub';
type GhRepo={fullName:string;owner:string;name:string;private:boolean;fork:boolean;archived:boolean;description:string;pushedAt:string|null;https:string;ssh:string};
type Job={id:string;url:string;dest:string;phase:string;percent:number|null;detail:string;done:boolean;error:string|null;root:string|null;running:boolean};

// Mesma regra do servidor: …/dono/projeto.git → projeto
const repoName=(url:string)=>{const clean=url.trim().replace(/[\\/]+$/,'').replace(/\.git$/i,'');return /[^\\/:]+$/.exec(clean)?.[0]||'';};
const join=(dir:string,name:string)=>{const sep=dir.includes('\\')&&!dir.includes('/')?'\\':'/';return dir.replace(/[\\/]+$/,'')+sep+name;};
const rtf=new Intl.RelativeTimeFormat('pt-BR',{numeric:'auto'});
function ago(date:string|null){
  if(!date)return '';const s=(Date.parse(date)-Date.now())/1000;
  for(const [unit,n] of [['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60]] as [Intl.RelativeTimeFormatUnit,number][])if(Math.abs(s)>=n)return rtf.format(Math.round(s/n),unit);
  return 'agora';
}

// Clonar: colando a URL ou escolhendo na lista de repositórios da conta do GitHub. O clone roda no
// servidor local; aqui só acompanhamos o andamento. No fim, ele abre numa aba nova (onCloned).
export function ClonePanel({defaultDir,onCloned,onRunning,initialSource='url'}:{defaultDir:string;onCloned:(root:string)=>void;onRunning:(running:boolean)=>void;initialSource?:'url'|'github'}){
  const [source,setSource]=useState<'url'|'github'>(initialSource);
  const [url,setUrl]=useState('');
  const [parent,setParent]=useState(defaultDir);
  const [name,setName]=useState('');
  const [nameEdited,setNameEdited]=useState(false);
  const [gh,setGh]=useState<GitHubStatus|null>(null);
  const [ghBusy,setGhBusy]=useState(false);
  const [repos,setRepos]=useState<GhRepo[]|null>(null);
  const [filter,setFilter]=useState('');
  const [picked,setPicked]=useState<GhRepo|null>(null);
  const [protocol,setProtocol]=useState<'ssh'|'https'>('https');
  const [job,setJob]=useState<Job|null>(null);
  const [error,setError]=useState('');
  const finished=useRef('');
  const running=!!job?.running;

  const cloneUrl=source==='github'?(picked?(protocol==='ssh'?picked.ssh:picked.https):''):url.trim();
  const dest=parent.trim()&&name.trim()?join(parent.trim(),name.trim()):'';
  useEffect(()=>{if(!parent&&defaultDir)setParent(defaultDir);},[defaultDir]);
  useEffect(()=>{if(!nameEdited)setName(source==='github'?picked?.name||'':repoName(url));},[url,picked,source,nameEdited]);
  useEffect(()=>{onRunning(running);},[running]);

  async function loadRepos(refresh=false){try{setRepos((await api('github/repos'+(refresh?'?refresh=1':''))).repos);}catch(e){setError((e as Error).message);}}
  async function loadGh(){setGhBusy(true);setError('');try{const st:GitHubStatus=await api('github');setGh(st);setProtocol(st.protocol);if(st.connected)await loadRepos();}catch(e){setError((e as Error).message);}finally{setGhBusy(false);}}
  useEffect(()=>{if(source==='github'&&!gh&&!ghBusy)void loadGh();},[source]);
  function connected(st:GitHubStatus){setGh(st);setProtocol(st.protocol);setRepos(null);if(st.connected)void loadRepos();}
  async function disconnect(){try{setGh(await api('github/disconnect',{}));setRepos(null);setPicked(null);}catch(e){setError((e as Error).message);}}

  // Andamento do clone: consulta o servidor enquanto ele roda.
  useEffect(()=>{
    if(!job?.running)return;
    const t=setInterval(async()=>{
      try{const j:Job=await api('clone?id='+encodeURIComponent(job.id));setJob(j);
        if(j.done&&j.root&&finished.current!==j.id){finished.current=j.id;onCloned(j.root);}
        else if(j.error)setError(j.error);}
      catch(e){setError((e as Error).message);setJob(null);}
    },400);
    return()=>clearInterval(t);
  },[job?.id,job?.running]);
  async function start(e?:React.FormEvent){
    e?.preventDefault();if(!cloneUrl||running)return;setError('');
    try{setJob(await api('clone/start',{url:cloneUrl,parent:parent.trim(),name:name.trim(),protocol:source==='github'?protocol:undefined}));}
    catch(err){setError((err as Error).message);}
  }
  async function cancel(){if(job)try{setJob(await api('clone/cancel',{id:job.id}));}catch{}}
  async function pickParent(){const dir=await window.briar?.pickFolder({title:'Onde salvar o clone',defaultPath:parent||defaultDir});if(dir)setParent(dir);}

  const shown=useMemo(()=>{const q=filter.trim().toLocaleLowerCase();return (repos||[]).filter(r=>!q||`${r.fullName} ${r.description}`.toLocaleLowerCase().includes(q));},[repos,filter]);
  const avatar=gh?.user?.avatar?gh.user.avatar+(gh.user.avatar.includes('?')?'&':'?')+'s=48':null;

  return <div className="clone">
    <div className="seg" role="tablist" aria-label="De onde clonar">
      <button role="tab" aria-selected={source==='url'} className={source==='url'?'on':''} disabled={running} onClick={()=>setSource('url')}><Link size={13}/>URL</button>
      <button role="tab" aria-selected={source==='github'} className={source==='github'?'on':''} disabled={running} onClick={()=>setSource('github')}><GitHubMark size={13}/>GitHub</button>
    </div>

    {source==='url'&&<label className="field"><span>URL do repositório</span><input autoFocus value={url} disabled={running} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void start();}} placeholder="https://github.com/dono/projeto.git  ou  git@github.com:dono/projeto.git" spellCheck={false} autoComplete="off"/></label>}

    {source==='github'&&(!gh?<p className="muted gh-empty">{ghBusy?<><LoaderCircle size={13} className="spinning"/> Consultando o GitHub…</>:null}</p>
      :!gh.connected?<GitHubConnect status={gh} onConnected={connected} onForget={disconnect} intro="Conecte sua conta para escolher entre os seus repositórios, inclusive os privados e os das suas organizações."/>
      :<>
        <div className="gh-account">{avatar?<img src={avatar} alt="" width={22} height={22}/>:<GitHubMark size={18}/>}<span><b>{gh.user?.login}</b> <span className="muted">· via {sourceLabel(gh.source)}</span></span><span className="grow"/>
          <button className="icon-btn" title="Recarregar a lista" aria-label="Recarregar a lista" disabled={running} onClick={()=>{setRepos(null);void loadRepos(true);}}><RefreshCw size={13}/></button>
          <button className="btn ghost xs" disabled={running} onClick={disconnect}><LogOut size={12}/>Desconectar</button></div>
        <label className="side-filter gh-filter"><Search size={12}/><input autoFocus placeholder="Filtrar repositórios" value={filter} onChange={e=>setFilter(e.target.value)}/>{repos&&<span className="muted small">{shown.length}</span>}</label>
        <div className="gh-repos" role="listbox" aria-label="Repositórios do GitHub">
          {!repos?<p className="muted small gh-empty"><LoaderCircle size={13} className="spinning"/> Carregando repositórios…</p>
          :!shown.length?<p className="muted small gh-empty">Nenhum repositório{filter?' com esse nome':''}.</p>
          :shown.map(r=><button key={r.fullName} role="option" aria-selected={picked?.fullName===r.fullName} className={`gh-repo ${picked?.fullName===r.fullName?'on':''}`} disabled={running} title={r.description||r.fullName}
            onClick={()=>{setPicked(r);setNameEdited(false);}}>
            {r.private?<Lock size={13} className="gh-vis"/>:<Globe size={13} className="gh-vis"/>}
            <span className="gh-repo-text"><span className="gh-repo-name"><span className="muted">{r.owner}/</span><b>{r.name}</b>{r.fork&&<span className="gh-badge">fork</span>}{r.archived&&<span className="gh-badge">arquivado</span>}</span>{r.description&&<span className="gh-repo-desc">{r.description}</span>}</span>
            <span className="gh-repo-date">{ago(r.pushedAt)}</span>
          </button>)}
        </div>
      </>)}

    {(source==='url'||gh?.connected)&&<form className="clone-dest" onSubmit={start}>
      <div className="clone-grid">
        <label className="field"><span>Salvar em</span><span className="input-row"><input value={parent} disabled={running} onChange={e=>setParent(e.target.value)} placeholder={defaultDir} spellCheck={false} autoComplete="off"/>{window.briar?.desktop&&<button type="button" className="btn ghost" disabled={running} onClick={pickParent}><FolderOpen size={14}/>Escolher…</button>}</span></label>
        <label className="field"><span>Nome da pasta</span><input value={name} disabled={running} onChange={e=>{setName(e.target.value);setNameEdited(true);}} placeholder="projeto" spellCheck={false} autoComplete="off"/></label>
      </div>
      {source==='github'&&<div className="clone-protocol"><span>Clonar por</span><label className="radio"><input type="radio" disabled={running} checked={protocol==='ssh'} onChange={()=>setProtocol('ssh')}/>SSH</label><label className="radio"><input type="radio" disabled={running} checked={protocol==='https'} onChange={()=>setProtocol('https')}/>HTTPS</label></div>}
      {cloneUrl&&dest&&<pre className="cmd">git clone {cloneUrl} {dest}</pre>}
      {running&&job?<div className="clone-progress" role="status">
        <div className={`clone-bar ${job.percent==null?'indeterminate':''}`}><span style={{width:`${job.percent??30}%`}}/></div>
        <div className="clone-status"><LoaderCircle size={13} className="spinning"/><span>{job.phase}{job.percent!=null&&` ${job.percent}%`}</span>{job.detail&&<span className="muted">· {job.detail}</span>}<span className="grow"/><button type="button" className="btn ghost xs" onClick={cancel}><X size={12}/>Cancelar</button></div>
      </div>
      :<div className="connect-actions"><button className="btn primary" type="submit" disabled={!cloneUrl||!parent.trim()||!name.trim()}><CloudDownload size={15}/>Clonar e abrir</button>{source==='github'&&!picked&&gh?.connected&&<span className="muted small clone-hint">Escolha um repositório na lista.</span>}</div>}
    </form>}

    {error&&<div className="inline-error" role="alert">{error}<button aria-label="Dispensar" onClick={()=>setError('')}><X size={13}/></button></div>}
  </div>;
}
