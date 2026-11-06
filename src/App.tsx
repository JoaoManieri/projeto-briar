import {useCallback,useEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {
  Archive,ArchiveRestore,FastForward,ArrowDown,ArrowDownToLine,Download,LoaderCircle,RotateCw,ArrowLeft,ArrowUp,ArrowUpToLine,Check,ChevronDown,ChevronRight,CircleAlert,CircleHelp,Cloud,Copy,
  FileCode2,FolderGit2,GitBranch,GitBranchPlus,GitCommitHorizontal,GitMerge,Laptop,LockKeyhole,Maximize2,Minus,Pencil,Plus,
  RefreshCw,Search,Send,Sprout,Tag,Terminal,Trash2,TriangleAlert,Undo2,X
} from 'lucide-react';
import {ancestors,layoutGraph,palette,type History,type Commit} from './history';

type FileState={path:string;oldPath?:string;index:string;worktree:string;staged:boolean;unstaged:boolean;untracked:boolean;conflicted:boolean};
type BranchRef={name:string;sha:string;remote:boolean;upstream?:string|null;ahead?:number;behind?:number};
type Stash={sha:string;index:number;base:string|null;untracked:boolean;date:string;branch:string|null;message:string};
type Status={root:string;lastTag:string|null;branch:string|null;head:string|null;files:FileState[];merging:{message:string;source?:string|null}|null;branches:BranchRef[];tags:{name:string;sha:string}[];upstream:string|null;ahead:number;behind:number;remote:string|null;remotes:string[];lastFetch:string|null;autoFetchError:string|null;stashes:Stash[];indexFingerprint:string;conflicted:boolean;audit:{command:string;output:string;date:string;success:boolean}[]};
type State={status:Status|null;history:(History&{truncated?:boolean})|null;initialError:string};
type Dialog='operations'|'help'|'branch'|'merge'|'push'|'pull'|'discard'|'tag'|'delete-branch'|'delete-tag'|'stash'|'stash-branch'|null;
type MenuItem={label:string;icon?:ReactNode;danger?:boolean;disabled?:boolean;title?:string;run:()=>void}|'sep';
type Menu={x:number;y:number;title:string;items:MenuItem[]};
// Próxima versão a partir da última tag: v1.0.4 → v1.0.5 (soma 1 no último número), sem repetir uma existente.
function nextTag(last:string|null,existing:string[]){
  const bump=(t:string)=>{const m=/(\d+)(?!.*\d)/.exec(t);if(!m)return t+'.1';return t.slice(0,m.index)+String(Number(m[1])+1).padStart(m[1].length,'0')+t.slice(m.index+m[1].length);};
  let next=last?bump(last):'v1.0.0';for(let i=0;i<500&&existing.includes(next);i++)next=bump(next);return next;
}
type Workspace={tabs:{root:string;name:string}[];active:string|null;recent:{root:string;name:string;open:boolean}[];initialError:string};
type Choice={path:string;staged:boolean;sha?:string;conflicted?:boolean;stash?:boolean};
type Label={key:string;text:string;local?:string;remote?:string;tag?:boolean;current:boolean;sha:string};
type Preview={branch:string;current:string|null;into:string;needsCheckout:boolean;intoRemote:boolean;incoming:number;fastForward:boolean;inPlace?:boolean;conflicts:string[]};
type Segment={type:'text';lines:string[]}|{type:'conflict';ours:string[];theirs:string[]};
type Pick='ours'|'theirs'|'both'|'both-rev';
type Update={current:string;kind:string;auto:boolean;status:'disabled'|'idle'|'checking'|'none'|'available'|'downloading'|'ready'|'installing'|'error';version?:string;percent?:number;error?:string;checkedAt?:number};
declare global{interface Window{briar?:{desktop:boolean;pickFolder:()=>Promise<string|null>;update?:{state:()=>Promise<Update>;check:()=>Promise<Update>;install:()=>Promise<void>;onChange:(cb:(u:Update)=>void)=>()=>void}}}}
const DRAG='text/x-briar-branch';

// Divide o arquivo em trechos comuns e blocos <<<<<<< ======= >>>>>>> (diff3 incluso).
function parseConflict(text:string):Segment[]{
  const out:Segment[]=[];let common:string[]=[];let block:{ours:string[];base:string[];theirs:string[]}|null=null;let part:'ours'|'base'|'theirs'='ours';
  for(const line of text.split('\n')){
    const l=line.replace(/\r$/,'');
    if(!block&&/^<{7}( |$)/.test(l)){if(common.length)out.push({type:'text',lines:common});common=[];block={ours:[],base:[],theirs:[]};part='ours';}
    else if(block&&part==='ours'&&/^\|{7}( |$)/.test(l))part='base';
    else if(block&&part!=='theirs'&&l==='=======')part='theirs';
    else if(block&&part==='theirs'&&/^>{7}( |$)/.test(l)){out.push({type:'conflict',ours:block.ours,theirs:block.theirs});block=null;}
    else if(block)block[part].push(line);
    else common.push(line);
  }
  if(block)return [{type:'text',lines:text.split('\n')}];
  if(common.length)out.push({type:'text',lines:common});
  return out;
}
const pickLines=(seg:{ours:string[];theirs:string[]},p:Pick)=>p==='ours'?seg.ours:p==='theirs'?seg.theirs:p==='both'?[...seg.ours,...seg.theirs]:[...seg.theirs,...seg.ours];

function ConflictEditor({text,ours,theirs,busy,onSave}:{text:string;ours:string;theirs:string;busy:boolean;onSave:(content:string)=>void}){
  const segments=useMemo(()=>parseConflict(text),[text]);
  const total=segments.filter(x=>x.type==='conflict').length;
  const [picks,setPicks]=useState<Record<number,Pick>>({});
  const done=Object.keys(picks).length;
  function compose(){let i=0;const lines:string[]=[];for(const seg of segments){if(seg.type==='text')lines.push(...seg.lines);else lines.push(...pickLines(seg,picks[i++]));}return lines.join('\n');}
  let index=0;
  return <div className="cedit">
    {segments.map((seg,k)=>{
      if(seg.type==='text'){const many=seg.lines.length>10;const shown=many?[...seg.lines.slice(0,4),null,...seg.lines.slice(-4)]:seg.lines;return <pre key={k} className="cctx">{shown.map((l,j)=>l===null?<span key={j} className="cfold">… {seg.lines.length-8} linhas iguais nos dois lados …{'\n'}</span>:<span key={j}>{l}{'\n'}</span>)}</pre>;}
      const i=index++;const pick=picks[i];
      return <div key={k} className={`cblock ${pick?'done':''}`}>
        <div className="cblock-title"><TriangleAlert size={13}/>Conflito {i+1} de {total}{pick&&<span className="cblock-ok"><Check size={12}/>resolvido</span>}</div>
        <div className="csides">
          <div className={`cside ours ${pick&&pick!=='theirs'?'chosen':''} ${pick==='theirs'?'dropped':''}`}><div className="cside-label">SUA VERSÃO · {ours}</div><pre>{seg.ours.join('\n')||'(vazio)'}</pre></div>
          <div className={`cside theirs ${pick&&pick!=='ours'?'chosen':''} ${pick==='ours'?'dropped':''}`}><div className="cside-label">RECEBIDA · {theirs}</div><pre>{seg.theirs.join('\n')||'(vazio)'}</pre></div>
        </div>
        <div className="cacts">
          {([['ours','Usar a minha','ours'],['theirs','Usar a recebida','theirs'],['both','As duas (minha primeiro)','ghost'],['both-rev','As duas (recebida primeiro)','ghost']] as [Pick,string,string][]).map(([v,label,cls])=><button key={v} className={`btn sm ${cls} ${pick===v?'picked':''}`} onClick={()=>setPicks(p=>({...p,[i]:v}))}>{label}</button>)}
        </div>
        {(pick==='both'||pick==='both-rev')&&<div className="cresult"><div className="cside-label">RESULTADO</div><pre>{pickLines(seg,pick).join('\n')}</pre></div>}
      </div>;
    })}
    <div className="cfoot"><span className="grow muted">{done} de {total} {total===1?'conflito resolvido':'conflitos resolvidos'} neste arquivo</span>
      <button className="btn sm ours" onClick={()=>setPicks(Object.fromEntries(Array.from({length:total},(_,i)=>[i,'ours'])))}>Tudo meu</button>
      <button className="btn sm theirs" onClick={()=>setPicks(Object.fromEntries(Array.from({length:total},(_,i)=>[i,'theirs'])))}>Tudo recebido</button>
      <button className="btn primary" disabled={busy||done<total} onClick={()=>onSave(compose())}><Check size={13}/>Salvar e marcar resolvido</button></div>
  </div>;
}

async function api(route:string,body?:unknown,signal?:AbortSignal,repo?:string){
  const r=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-Pindorama-Client':'local',...(repo?{'X-Briar-Repo':encodeURIComponent(repo)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||'O servidor Git não respondeu.');
  return data;
}
const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
const fmt=(d:string,full=false)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',...(full?{year:'numeric',hour:'2-digit',minute:'2-digit'}:{}),timeZone:tz}).format(new Date(d));
const color=(n:number)=>palette[n%palette.length];
const short=(s:string)=>s.slice(0,7);
const initials=(s:string)=>s.split(/\s+/).filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase()||'?';
const subject=(m:string)=>m.split('\n')[0];
const splitPath=(p:string)=>{const i=p.lastIndexOf('/');return i<0?['',p]:[p.slice(0,i+1),p.slice(i+1)];};
const WIP='WIP';

function statusLetter(f:FileState,staged:boolean){
  if(f.conflicted)return {letter:'!',cls:'st-conflict',title:'Em conflito'};
  const c=staged?f.index:f.untracked?'?':f.worktree;
  const map:Record<string,[string,string]>={'?':['st-add','Novo'],A:['st-add','Adicionado'],M:['st-mod','Modificado'],D:['st-del','Removido'],R:['st-ren','Renomeado'],C:['st-ren','Copiado'],T:['st-mod','Tipo alterado']};
  const [cls,title]=map[c]||['st-mod',c];
  return {letter:c==='?'?'+':c,cls,title};
}

type RepoProps={root:string;active:boolean;updatePill:ReactNode;versionLabel:ReactNode;onHome:()=>void;onClose:()=>void;onMeta:(root:string,meta:{busy:boolean;changes:number;branch:string|null;conflict:boolean})=>void};
function Repo({root,active,updatePill,versionLabel,onHome,onClose,onMeta}:RepoProps){
  const call=(route:string,body?:unknown,signal?:AbortSignal)=>api(route,body,signal,root);
  const activeRef=useRef(active);activeRef.current=active;
  const [state,setState]=useState<State|null>(null);
  const [loadError,setLoadError]=useState('');
  const [discardPaths,setDiscardPaths]=useState<string[]>([]);
  const [undo,setUndo]=useState<{stash:string;text:string;kind:'discard'|'drop';message?:string}|null>(null);
  const [stashSel,setStashSel]=useState<string|null>(null);
  const [stashFiles,setStashFiles]=useState<{path:string;additions:number;deletions:number;binary?:boolean;untracked?:boolean}[]|null>(null);
  const [stashMsg,setStashMsg]=useState('');
  const [stashUntracked,setStashUntracked]=useState(true);
  const [stashStaged,setStashStaged]=useState(false);
  const [stashTarget,setStashTarget]=useState<Stash|null>(null);
  const [menu,setMenu]=useState<Menu|null>(null);
  const [tagTarget,setTagTarget]=useState<{sha:string;label:string}|null>(null);
  const [tagName,setTagName]=useState('');
  const [tagMessage,setTagMessage]=useState('');
  const [tagPush,setTagPush]=useState(true);
  const [delBranch,setDelBranch]=useState<{branch:string;scope:'local'|'remote'|'both';local?:string;remote?:string}|null>(null);
  const [delForce,setDelForce]=useState(false);
  const [delTag,setDelTag]=useState<{name:string;local:boolean;remote:boolean}|null>(null);
  const [selected,setSelected]=useState('');
  const [highlight,setHighlight]=useState('all');
  const [query,setQuery]=useState('');
  const [author,setAuthor]=useState('all');
  const [dialog,setDialog]=useState<Dialog>(null);
  const [busy,setBusy]=useState('');
  const [autoFetching,setAutoFetching]=useState(false);
  const [error,setError]=useState('');
  const [toast,setToast]=useState('');
  const [zoom,setZoom]=useState(1);
  const [tab,setTab]=useState<'files'|'info'>('files');
  const [message,setMessage]=useState('');
  const [description,setDescription]=useState('');
  const [choice,setChoice]=useState<Choice|null>(null);
  const [diff,setDiff]=useState('');
  const [commitFiles,setCommitFiles]=useState<{files:{path:string;additions:number;deletions:number;binary?:boolean}[];merge:boolean}|null>(null);
  const [target,setTarget]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [previewError,setPreviewError]=useState('');
  const [branchName,setBranchName]=useState('');
  const [branchFrom,setBranchFrom]=useState<'head'|'selected'>('head');
  const [branchCheckout,setBranchCheckout]=useState(true);
  const [pullMode,setPullMode]=useState<'ff'|'merge'>('ff');
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>({});
  const [sideFilter,setSideFilter]=useState('');
  const [updated,setUpdated]=useState('');
  const [into,setInto]=useState('');
  const [drag,setDrag]=useState<string|null>(null);
  const [dropOn,setDropOn]=useState<string|null>(null);
  const [dragRow,setDragRow]=useState<string|null>(null);
  const [rawConflict,setRawConflict]=useState(false);
  const autoOpened=useRef(false);
  const search=useRef<HTMLInputElement>(null),scroll=useRef<HTMLDivElement>(null),modal=useRef<HTMLDivElement>(null),busyRef=useRef(false),seq=useRef(0),autoRef=useRef(false),statusRef=useRef<Status|null>(null);

  const h=state?.history,s=state?.status;
  const hasWip=!!s&&(s.files.length>0||!!s.merging);
  const graphCommits=useMemo<Commit[]>(()=>{
    const list=h?.commits||[];
    if(!hasWip||!s?.head||!list.some(c=>c.sha===s.head))return list;
    return [{sha:WIP,parents:[s.head],message:'// WIP',author:'',date:'9999-12-31T00:00:00Z'},...list];
  },[h,hasWip,s?.head]);
  const layout=useMemo(()=>layoutGraph(graphCommits,hasWip?WIP:s?.head),[graphCommits,hasWip,s?.head]);
  const rows=layout.rows;
  const realCommits=useMemo(()=>rows.filter(c=>c.sha!==WIP),[rows]);
  const current=selected===WIP&&hasWip?null:rows.find(c=>c.sha===selected&&c.sha!==WIP)||null;
  const showWip=hasWip&&(selected===WIP||!current);
  const shownCommit=showWip?null:current||realCommits.find(c=>c.sha===s?.head)||realCommits[0]||null;
  const authors=useMemo(()=>[...new Set(realCommits.map(c=>c.author))],[realCommits]);
  const allBranches=s?.branches||[];
  const localBranches=allBranches.filter(b=>!b.remote);
  const remoteBranches=allBranches.filter(b=>b.remote);
  const remoteOf=(name:string)=>[...(s?.remotes||[])].sort((a,b)=>b.length-a.length).find(r=>name.startsWith(r+'/'))||name.split('/')[0];

  const headChain=useMemo(()=>{const set=new Set<string>();const byId=new Map(rows.map(c=>[c.sha,c]));let id:string|undefined=hasWip?WIP:s?.head||undefined;while(id&&byId.has(id)&&!set.has(id)){set.add(id);id=byId.get(id)!.parents[0];}return set;},[rows,hasWip,s?.head]);
  const highlightIds=useMemo(()=>highlight==='all'?null:ancestors(allBranches.find(b=>b.name===highlight)?.sha||'',realCommits),[highlight,allBranches,realCommits]);
  const matches=useMemo(()=>new Set(rows.filter(c=>c.sha===WIP||((!highlightIds||highlightIds.has(c.sha))&&(author==='all'||c.author===author)&&`${c.message} ${c.sha} ${c.author}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(c=>c.sha)),[rows,highlightIds,author,query]);
  const filtering=highlight!=='all'||query!==''||author!=='all';

  const labels=useMemo(()=>{
    const map=new Map<string,Label[]>();
    const push=(l:Label)=>{if(!layout.cols.has(l.sha))return;const list=map.get(l.sha)||[];list.push(l);map.set(l.sha,list);};
    const used=new Set<string>();
    for(const b of localBranches){
      const twin=remoteBranches.find(r=>r.sha===b.sha&&r.name.slice(remoteOf(r.name).length+1)===b.name);
      if(twin)used.add(twin.name);
      push({key:'l:'+b.name,text:b.name,local:b.name,remote:twin?.name,current:b.name===s?.branch,sha:b.sha});
    }
    for(const r of remoteBranches)if(!used.has(r.name))push({key:'r:'+r.name,text:r.name,remote:r.name,current:false,sha:r.sha});
    for(const t of s?.tags||[])push({key:'t:'+t.name,text:t.name,tag:true,current:false,sha:t.sha});
    for(const list of map.values())list.sort((a,b)=>Number(b.current)-Number(a.current)||Number(!!a.tag)-Number(!!b.tag)||Number(!a.local)-Number(!b.local));
    return map;
  },[s,layout]);

  const laneW=Math.round(22*zoom),rowH=Math.round(34*zoom),refW=200;
  const graphW=Math.max(60,16+layout.width*laneW);
  const gx=(col:number)=>14+col*laneW+laneW/2-4,gy=(row:number)=>row*rowH+rowH/2;
  const staged=s?.files.filter(f=>f.staged&&!f.conflicted)||[];
  const unstaged=s?.files.filter(f=>f.unstaged&&!f.conflicted)||[];
  const conflicts=s?.files.filter(f=>f.conflicted)||[];

  async function refresh(showError=true){const id=++seq.current;try{const next=await call('state');if(id===seq.current){setState(next);setLoadError('');setUpdated(new Date().toISOString());}}catch(e){if(!state)setLoadError((e as Error).message);else if(showError)setError((e as Error).message);}}
  statusRef.current=s||null;
  // Fetch automático e silencioso da aba visível: ao abrir/trocar de aba e quando a janela volta ao
  // foco (se o último fetch tem mais de 1 min) e, com a janela aberta, a cada 3 min. O servidor
  // segura o ritmo e, se falhar (sem rede/credencial), espera 5 min antes de tentar de novo.
  async function autoFetch(minAge:number){
    const st=statusRef.current;
    if(autoRef.current||busyRef.current||!activeRef.current||document.hidden||(st&&!st.remotes.length))return;
    if(st?.lastFetch&&Date.now()-Date.parse(st.lastFetch)<minAge)return;
    autoRef.current=true;const spin=setTimeout(()=>setAutoFetching(true),300);
    try{const r=await call('auto-fetch',{minAge});const o=r?.output||{};if((o.fetched||o.error)&&!busyRef.current)await refresh(false);}
    catch{}finally{clearTimeout(spin);autoRef.current=false;setAutoFetching(false);}
  }
  // Só a aba visível consulta o Git a cada 15 s; as outras se atualizam ao voltar a ficar visíveis.
  useEffect(()=>{if(!active)void refresh(false);},[]);
  useEffect(()=>{if(!active)return;void refresh(false).then(()=>autoFetch(60000));
    const focus=()=>{if(document.hidden||busyRef.current)return;void refresh(false);void autoFetch(60000);};
    const tick=()=>{if(document.hidden||busyRef.current)return;void refresh(false);void autoFetch(180000);};
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);const interval=setInterval(tick,15000);
    return()=>{window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);clearInterval(interval);};},[active]);
  useEffect(()=>{onMeta(root,{busy:!!busy,changes:state?.status?.files.length||0,branch:state?.status?.branch||null,conflict:!!state?.status?.merging});},[busy,state]);
  useEffect(()=>{if(undo){const t=setTimeout(()=>setUndo(null),15000);return()=>clearTimeout(t);}},[undo]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(t);}},[toast]);
  useEffect(()=>{if(!shownCommit)return;setCommitFiles(null);const c=new AbortController();call('commit-files',{sha:shownCommit.sha},c.signal).then(setCommitFiles).catch(e=>{if(e.name!=='AbortError')setCommitFiles(null);});return()=>c.abort();},[shownCommit?.sha,s?.root]);
  const stashShown=stashSel?s?.stashes.find(x=>x.sha===stashSel)||null:null;
  useEffect(()=>{if(!stashShown){setStashFiles(null);return;}setStashFiles(null);const c=new AbortController();call('stash-files',{sha:stashShown.sha},c.signal).then(r=>setStashFiles(r.files)).catch(e=>{if(e.name!=='AbortError')setStashFiles([]);});return()=>c.abort();},[stashShown?.sha]);
  useEffect(()=>{if(!choice){setDiff('');return;}setDiff('Carregando diferenças…');const c=new AbortController();call('diff',{path:choice.path,staged:choice.staged,sha:choice.sha,stash:choice.stash},c.signal).then(r=>setDiff(r.diff)).catch(e=>{if(e.name!=='AbortError')setDiff(e.message);});return()=>c.abort();},[choice,s?.indexFingerprint]);
  useEffect(()=>{if(choice&&!choice.sha&&s&&!s.files.some(f=>f.path===choice.path))setChoice(null);},[s?.files]);
  useEffect(()=>{if(s?.merging&&!message)setMessage(subject(s.merging.message));},[s?.merging?.message]);
  useEffect(()=>{if(dialog!=='merge'||!target){setPreview(null);setPreviewError('');return;}setPreview(null);setPreviewError('');const c=new AbortController();call('merge-preview',{branch:target,into:into||undefined},c.signal).then(setPreview).catch(e=>{if(e.name!=='AbortError')setPreviewError(e.message);});return()=>c.abort();},[dialog,target,into,s?.head]);
  // Merge com conflito: abre o primeiro arquivo em conflito ao entrar (inclusive ao reabrir o app).
  useEffect(()=>{const list=s?.files.filter(f=>f.conflicted)||[];if(!s?.merging){autoOpened.current=false;return;}if(list.length&&!autoOpened.current){autoOpened.current=true;setSelected(WIP);setChoice({path:list[0].path,staged:false,conflicted:true});}},[s?.merging,s?.files]);
  useEffect(()=>{setRawConflict(false);},[choice?.path]);

  function select(id:string,ensure=false){setSelected(id);setStashSel(null);setChoice(null);if(ensure)requestAnimationFrame(()=>scroll.current?.querySelector(`[data-sha="${id}"]`)?.scrollIntoView({block:'nearest',behavior:'smooth'}));}
  function reset(){setHighlight('all');setQuery('');setAuthor('all');}
  function jump(delta:number){const list=rows.filter(c=>matches.has(c.sha));const cur=showWip?WIP:shownCommit?.sha;const i=list.findIndex(c=>c.sha===cur);const next=list[Math.max(0,Math.min(list.length-1,i+delta))];if(next)select(next.sha,true);}
  useEffect(()=>{function key(e:KeyboardEvent){if(menu&&e.key==='Escape'){setMenu(null);return;}if(!activeRef.current||dialog||(e.target as HTMLElement).closest('input,textarea,select'))return;if(e.key==='/'){e.preventDefault();search.current?.focus();}if(e.key==='Escape'&&choice)setChoice(null);if(e.key==='ArrowDown'){e.preventDefault();jump(1);}if(e.key==='ArrowUp'){e.preventDefault();jump(-1);}}window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});
  useEffect(()=>{if(!dialog)return;const prev=document.activeElement as HTMLElement;const controls=()=>[...(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea,select')||[])];(modal.current?.querySelector<HTMLElement>('[data-autofocus]')||controls()[1]||controls()[0])?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busyRef.current)setDialog(null);if(e.key==='Tab'){const list=controls(),first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);prev?.focus?.();};},[dialog]);

  async function action(name:string,body:unknown={},success='Operação concluída.'):Promise<any>{
    if(busyRef.current)return null;busyRef.current=true;setBusy(name);setError('');
    try{const r=await call(name,body);await refresh();setToast(r?.output?.message||success);return r;}
    catch(e){setError((e as Error).message);await refresh(false);return null;}
    finally{busyRef.current=false;setBusy('');}
  }
  function afterMerge(r:any,ok:string){
    const list:string[]=r?.output?.conflicts||[];
    if(list.length){setToast('');setStashSel(null);setError(`Conflitos em ${list.length} ${list.length===1?'arquivo':'arquivos'}. Resolva no painel à direita.`);setSelected(WIP);setChoice({path:list[0],staged:false,conflicted:true});}
    else setToast(ok);
  }
  async function commit(){if(!s)return;const text=message.trim()+(description.trim()?'\n\n'+description.trim():'');if(await action('commit',{message:text,expectedHead:s.head,expectedIndex:s.indexFingerprint},s.merging?'Merge concluído.':'Commit criado.')){setMessage('');setDescription('');setChoice(null);setSelected('');}}
  async function copy(text:string,done='Hash copiado.'){try{await navigator.clipboard.writeText(text);setToast(done);}catch{setToast('Não foi possível copiar.');}}
  function openMerge(name='',dest=''){const d=dest&&dest!==s?.branch?dest:'';setInto(d);setTarget(name||allBranches.find(b=>b.name!==(d||s?.branch))?.name||'');setDialog('merge');}
  // Checkout direto, sem diálogo: o servidor troca para a local quando ela já existe.
  async function openSwitch(name:string){if(!name||name===s?.branch)return;if(await action('switch',{branch:name},`Agora em ${name}.`)){setSelected('');reset();}}
  function dropMerge(source:string,dest:string){if(source===dest)return;if(s?.merging){setError('Já existe um merge em andamento. Resolva os conflitos ou aborte antes.');return;}openMerge(source,dest);}
  const dnd=(name:string,canDrag=true)=>({draggable:canDrag,
    onDragStart:(e:React.DragEvent)=>{e.stopPropagation();e.dataTransfer.setData(DRAG,name);e.dataTransfer.effectAllowed='move';setTimeout(()=>setDrag(name),0);}, // mexer na tela dentro do dragstart pode cancelar o arrastar no Chromium
    onDragEnd:()=>{setDrag(null);setDropOn(null);setDragRow(null);},
    onDragOver:(e:React.DragEvent)=>{if(!e.dataTransfer.types.includes(DRAG)||drag===name)return;e.preventDefault();e.dataTransfer.dropEffect='move';if(dropOn!==name)setDropOn(name);},
    onDragLeave:(e:React.DragEvent)=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDropOn(d=>d===name?null:d);},
    onDrop:(e:React.DragEvent)=>{e.preventDefault();e.stopPropagation();const src=e.dataTransfer.getData(DRAG)||drag;setDrag(null);setDropOn(null);setDragRow(null);if(src&&src!==name)dropMerge(src,name);}});
  useEffect(()=>{if(!drag)return;const end=()=>{setDrag(null);setDropOn(null);setDragRow(null);};document.addEventListener('dragend',end);document.addEventListener('drop',end);return()=>{document.removeEventListener('dragend',end);document.removeEventListener('drop',end);};},[drag]);
  function openBranch(fromSelected=false){setBranchName('');setBranchFrom(fromSelected?'selected':'head');setBranchCheckout(true);setDialog('branch');}
  function openPull(){setPullMode(s&&s.ahead>0&&s.behind>0?'merge':'ff');setDialog('pull');}
  async function runMerge(){const dest=preview?.into||into||s?.branch;const r=await action('merge',{branch:target,into:into||undefined},`${target} integrada em ${dest}.`);if(r){setDialog(null);afterMerge(r,r.output?.message||(r.output?.fastForward?`${dest} avançou até ${target} (fast-forward).`:`${target} integrada em ${dest}.`)+(preview?.intoRemote?' Faça Push para publicar.':''));}}
  async function runPull(){const r=await action('pull',{mode:pullMode},'Branch atualizada.');if(r){setDialog(null);afterMerge(r,'Branch atualizada.');}}
  async function runPush(){if(await action('push',{},'Push concluído.'))setDialog(null);}
  async function runBranch(e:React.FormEvent){e.preventDefault();const from=branchFrom==='selected'&&shownCommit?shownCommit.sha:undefined;if(await action('branch',{name:branchName,from,checkout:branchCheckout},`Branch ${branchName.trim()} criada.`)){setDialog(null);setSelected('');}}
  async function resolve(path:string,side:'ours'|'theirs'|'mark'|'content',content?:string){const ok=await action('resolve',{path,side,content},side==='mark'||side==='content'?`${path} resolvido.`:side==='ours'?'Mantida a sua versão.':'Mantida a versão recebida.');if(ok){const next=conflicts.find(f=>f.path!==path);setChoice(next?{path:next.path,staged:false,conflicted:true}:{path,staged:true});}}

  // ---- Menu do botão direito: branches, tags e commits ----
  const mainRemote=()=>s?(s.remote&&s.remote!=='.'?s.remote:s.remotes.includes('origin')?'origin':s.remotes[0]||''):'';
  function openMenu(e:React.MouseEvent,title:string,items:MenuItem[]){e.preventDefault();e.stopPropagation();const h=items.reduce((n,i)=>n+(i==='sep'?9:29),36);setMenu({x:Math.min(e.clientX,window.innerWidth-260),y:Math.max(8,Math.min(e.clientY,window.innerHeight-h-8)),title,items});}
  function openTag(sha:string,label:string){if(!s)return;setTagTarget({sha,label});setTagName(nextTag(s.lastTag,s.tags.map(t=>t.name)));setTagMessage('');setTagPush(s.remotes.length>0);setDialog('tag');}
  function openDeleteBranch(branch:string,scope:'local'|'remote'|'both',local?:string,remote?:string){setDelBranch({branch,scope,local,remote});setDelForce(false);setDialog('delete-branch');}
  function openDeleteTag(name:string,local:boolean,remote:boolean){setDelTag({name,local,remote});setDialog('delete-tag');}
  const canFF=(b?:BranchRef)=>!!b&&!b.remote&&!!b.upstream&&!!b.behind&&!b.ahead;
  async function fastForward(b:BranchRef){if(!b.upstream)return;await action('fast-forward',{branch:b.name,to:b.upstream},`${b.name} atualizada até ${b.upstream}.`);}
  function branchMenu(e:React.MouseEvent,name:string){
    if(!s)return;const b=allBranches.find(x=>x.name===name);if(!b)return;
    const localName=b.remote?b.name.slice(remoteOf(b.name).length+1):b.name;
    const local=localBranches.find(x=>x.name===localName)?.name;
    const remote=b.remote?b.name:[mainRemote(),...s.remotes].map(r=>`${r}/${b.name}`).find(n=>remoteBranches.some(x=>x.name===n));
    const isCurrent=!b.remote&&b.name===s.branch,localIsCurrent=!!local&&local===s.branch;
    const items:MenuItem[]=[];
    if(!isCurrent)items.push({label:`Checkout de ${b.name}`,icon:<Laptop size={13}/>,disabled:!!busy,run:()=>openSwitch(b.name)});
    if(!isCurrent&&s.branch)items.push({label:`Merge em ${s.branch}`,icon:<GitMerge size={13}/>,disabled:!!busy||!!s.merging,run:()=>openMerge(b.name)});
    const lb=localBranches.find(x=>x.name===local);
    if(lb?.upstream&&lb.behind){items.push(canFF(lb)
      ?{label:`Fast-forward ${lb.name} até ${lb.upstream} (${lb.behind})`,icon:<FastForward size={13}/>,disabled:!!busy||(lb.name===s.branch&&!!s.merging),run:()=>fastForward(lb)}
      :{label:`Fast-forward até ${lb.upstream}`,icon:<FastForward size={13}/>,disabled:true,title:`${lb.name} e ${lb.upstream} divergiram (${lb.ahead} só aqui, ${lb.behind} só lá): use merge.`,run:()=>{}});}
    if(items.length)items.push('sep');
    items.push({label:'Criar tag aqui…',icon:<Tag size={13}/>,disabled:!!busy,run:()=>openTag(b.sha,b.name)});
    items.push({label:'Copiar nome',icon:<Copy size={13}/>,run:()=>copy(b.name,'Nome copiado.')});
    items.push('sep');
    if(local)items.push({label:`Apagar branch local (${local})`,icon:<Trash2 size={13}/>,danger:true,disabled:!!busy||localIsCurrent,title:localIsCurrent?'É a branch atual: faça checkout de outra antes.':undefined,run:()=>openDeleteBranch(b.name,'local',local,remote)});
    if(remote)items.push({label:`Apagar no remoto (${remote})`,icon:<Cloud size={13}/>,danger:true,disabled:!!busy,run:()=>openDeleteBranch(b.name,'remote',local,remote)});
    if(local&&remote)items.push({label:'Apagar local e no remoto',icon:<Trash2 size={13}/>,danger:true,disabled:!!busy||localIsCurrent,title:localIsCurrent?'É a branch atual: faça checkout de outra antes.':undefined,run:()=>openDeleteBranch(b.name,'both',local,remote)});
    openMenu(e,b.remote?`Branch remota ${b.name}`:`Branch ${b.name}`,items);
  }
  function tagMenu(e:React.MouseEvent,name:string,sha:string){
    if(!s)return;const r=mainRemote();
    openMenu(e,`Tag ${name}`,[
      {label:r?`Push para ${r}`:'Push (sem remoto)',icon:<Send size={13}/>,disabled:!!busy||!r,run:()=>action('tag-push',{name},`Tag ${name} enviada.`)},
      {label:'Localizar no grafo',icon:<Search size={13}/>,disabled:!layout.cols.has(sha),run:()=>select(sha,true)},
      {label:'Copiar nome',icon:<Copy size={13}/>,run:()=>copy(name,'Nome copiado.')},
      'sep',
      {label:'Apagar local',icon:<Trash2 size={13}/>,danger:true,disabled:!!busy,run:()=>openDeleteTag(name,true,false)},
      {label:r?`Apagar no remoto (${r})`:'Apagar no remoto',icon:<Cloud size={13}/>,danger:true,disabled:!!busy||!r,run:()=>openDeleteTag(name,false,true)},
      {label:'Apagar local e no remoto',icon:<Trash2 size={13}/>,danger:true,disabled:!!busy||!r,run:()=>openDeleteTag(name,true,true)},
    ]);
  }
  function commitMenu(e:React.MouseEvent,c:Commit){
    openMenu(e,`Commit ${short(c.sha)}`,[
      {label:'Criar tag aqui…',icon:<Tag size={13}/>,disabled:!!busy,run:()=>openTag(c.sha,short(c.sha))},
      {label:'Criar branch aqui…',icon:<GitBranchPlus size={13}/>,disabled:!!busy,run:()=>{select(c.sha);setBranchName('');setBranchFrom('selected');setBranchCheckout(true);setDialog('branch');}},
      {label:'Copiar hash',icon:<Copy size={13}/>,run:()=>copy(c.sha)},
    ]);
  }
  async function runTag(e:React.FormEvent){e.preventDefault();if(!tagTarget)return;const name=tagName.trim();if(await action('tag',{name,sha:tagTarget.sha,message:tagMessage,push:tagPush},`Tag ${name} criada.`))setDialog(null);}
  async function runDeleteBranch(){if(!delBranch)return;if(await action('branch-delete',{branch:delBranch.branch,scope:delBranch.scope,force:delForce},'Branch apagada.')){setDialog(null);if(highlight===delBranch.local||highlight===delBranch.remote)setHighlight('all');}}
  async function runDeleteTag(){if(!delTag)return;if(await action('tag-delete',delTag,'Tag apagada.'))setDialog(null);}
  function openDiscard(paths:string[]){if(!paths.length)return;setDiscardPaths(paths);setDialog('discard');}
  async function runDiscard(){const r=await action('discard',{paths:discardPaths},'Alterações descartadas.');if(r){setDialog(null);if(choice&&discardPaths.includes(choice.path))setChoice(null);if(r.output?.stash){setToast('');setUndo({stash:r.output.stash,text:r.output.message,kind:'discard'});}}}
  async function undoDiscard(){if(!undo)return;const u=undo;setUndo(null);if(u.kind==='drop')await action('stash-restore',{sha:u.stash,message:u.message},'Stash recuperado.');else await action('undo-discard',{stash:u.stash},'Descarte desfeito.');}
  // ---- Stash ----
  const stashLabel=(x:Stash)=>`stash@{${x.index}}`;
  function openStash(){setStashMsg('');setStashUntracked(true);setStashStaged(false);setDialog('stash');}
  async function runStash(e:React.FormEvent){e.preventDefault();if(await action('stash-push',{message:stashMsg.trim()||`WIP em ${s?.branch||'HEAD'}`,untracked:stashUntracked,staged:stashStaged},'Alterações guardadas no stash.')){setDialog(null);setChoice(null);}}
  async function applyStash(x:Stash,pop:boolean){const r=await action('stash-apply',{sha:x.sha,pop},pop?'Stash aplicado e removido.':'Stash aplicado.');if(!r)return;setChoice(null);setStashSel(null);setSelected(WIP);afterMerge(r,r.output?.message||'Stash aplicado.');}
  async function dropStash(x:Stash){if(await action('stash-drop',{sha:x.sha},'Stash apagado.')){if(stashSel===x.sha){setStashSel(null);setChoice(null);}setToast('');setUndo({stash:x.sha,kind:'drop',message:x.message,text:`Stash "${x.message}" apagado.`});}}
  function openStashBranch(x:Stash){setStashTarget(x);setBranchName('');setDialog('stash-branch');}
  async function runStashBranch(e:React.FormEvent){e.preventDefault();if(!stashTarget)return;if(await action('stash-branch',{sha:stashTarget.sha,name:branchName},`Branch ${branchName.trim()} criada com o stash.`)){setDialog(null);setStashSel(null);setChoice(null);setSelected(WIP);}}
  function showStash(x:Stash){setStashSel(x.sha);setChoice(null);}
  function stashMenu(e:React.MouseEvent,x:Stash){
    const blocked=!!busy||!!s?.merging||conflicts.length>0;const why=s?.merging?'Há um merge em andamento.':conflicts.length?'Resolva os conflitos atuais antes.':undefined;
    openMenu(e,`${stashLabel(x)} · ${x.message}`,[
      {label:'Pop (aplicar e remover)',icon:<ArchiveRestore size={13}/>,disabled:blocked,title:why,run:()=>applyStash(x,true)},
      {label:'Aplicar (manter guardado)',icon:<Download size={13}/>,disabled:blocked,title:why,run:()=>applyStash(x,false)},
      {label:'Ver arquivos',icon:<FileCode2 size={13}/>,run:()=>showStash(x)},
      {label:'Criar branch com este stash…',icon:<GitBranchPlus size={13}/>,disabled:!!busy,run:()=>openStashBranch(x)},
      {label:'Copiar hash',icon:<Copy size={13}/>,run:()=>copy(x.sha)},
      'sep',
      {label:'Apagar stash',icon:<Trash2 size={13}/>,danger:true,disabled:!!busy,run:()=>dropStash(x)},
    ]);
  }
  const brand=<span className="brand"><span className="brand-icon"><Sprout size={18}/></span><span>Briar</span></span>;

  if(!state||!s||!h)return <div className="welcome" hidden={!active}><div className="welcome-card">{brand}<h1>{root.split('/').pop()}</h1>{loadError||state?.initialError?<><div className="inline-error" role="alert">{loadError||state?.initialError}</div><div className="connect-actions"><button className="btn ghost" onClick={()=>{setLoadError('');void refresh();}}><RefreshCw size={14}/>Tentar de novo</button><button className="btn danger" onClick={onClose}><X size={14}/>Fechar aba</button></div></>:<p className="muted">Lendo o repositório…</p>}<p className="welcome-note"><FolderGit2 size={13}/>{root}</p></div></div>;

  const toolButton=(icon:ReactNode,label:string,onClick:()=>void,opts:{badge?:number;disabled?:boolean;spin?:boolean;title?:string}={})=><button className="tool" onClick={onClick} disabled={!!busy||opts.disabled} title={opts.title||label}><span className="tool-icon">{icon}{!!opts.badge&&<span className="tool-badge">{opts.badge}</span>}</span><span>{label}</span></button>;

  const sideSection=(id:string,title:ReactNode,count:number,children:ReactNode)=><div className="side-section"><button className="side-heading" onClick={()=>setCollapsed(c=>({...c,[id]:!c[id]}))}>{collapsed[id]?<ChevronRight size={13}/>:<ChevronDown size={13}/>}{title}<span className="count">{count}</span></button>{!collapsed[id]&&children}</div>;
  const sf=sideFilter.toLocaleLowerCase();
  const remotesGrouped=s.remotes.map(r=>({remote:r,list:remoteBranches.filter(b=>remoteOf(b.name)===r&&b.name.toLocaleLowerCase().includes(sf))}));
  const laneOfBranch=(sha:string)=>layout.cols.get(sha);

  const branchItem=(b:BranchRef)=>{const cur=!b.remote&&b.name===s.branch;const lane=laneOfBranch(b.sha);const text=b.remote?b.name.slice(remoteOf(b.name).length+1):b.name;return <div key={b.name} {...dnd(b.name)} onContextMenu={e=>branchMenu(e,b.name)} className={`side-branch ${cur?'current':''} ${highlight===b.name?'highlighted':''} ${dropOn===b.name?'drop':''} ${drag===b.name?'dragging':''}`} style={{'--lane':lane===undefined?'#5b6670':color(lane)} as CSSProperties}>
    <button className="side-branch-main" title={`${b.name}\nClique: localizar no grafo · Duplo clique: checkout · Arraste sobre outra branch: merge`} onClick={()=>{if(layout.cols.has(b.sha))select(b.sha,true);}} onDoubleClick={()=>openSwitch(b.name)}>
      {cur?<Check size={13} className="cur-check"/>:<span className="lane-dot"/>}<span className="side-branch-name">{text}</span>
      {dropOn===b.name&&drag&&<span className="drop-hint">soltar: merge de {drag}</span>}
      {cur&&s.merging&&conflicts.length>0&&<span className="conflict-badge">CONFLITO</span>}
      {cur?s.upstream&&(s.ahead>0||s.behind>0)&&<span className="sync-mini">{s.behind>0&&<><ArrowDown size={10}/>{s.behind}</>}{s.ahead>0&&<><ArrowUp size={10}/>{s.ahead}</>}</span>
        :!b.remote&&b.upstream&&(!!b.ahead||!!b.behind)&&<span className="sync-mini" title={`${b.behind||0} atrás e ${b.ahead||0} à frente de ${b.upstream}`}>{!!b.behind&&<><ArrowDown size={10}/>{b.behind}</>}{!!b.ahead&&<><ArrowUp size={10}/>{b.ahead}</>}</span>}
    </button>
    <span className="side-actions">
      <button title={highlight===b.name?'Remover destaque':'Destacar no grafo'} onClick={()=>setHighlight(highlight===b.name?'all':b.name)}><Search size={12}/></button>
      {canFF(b)&&<button title={`Fast-forward de ${b.name} até ${b.upstream} (${b.behind} ${b.behind===1?'commit':'commits'}), sem checkout`} onClick={()=>fastForward(b)} disabled={!!busy}><FastForward size={12}/></button>}
      {!cur&&<button title={`Checkout de ${b.name}`} onClick={()=>openSwitch(b.name)} disabled={!!busy}><Laptop size={12}/></button>}
      {!cur&&s.branch&&<button title={`Merge de ${b.name} em ${s.branch}`} onClick={()=>openMerge(b.name)} disabled={!!busy||!!s.merging}><GitMerge size={12}/></button>}
    </span>
  </div>;};

  const pill=(l:Label,row:number)=>{const lane=layout.cols.get(l.sha)??0;const ref=l.local||l.remote;return <span key={l.key} {...(ref?dnd(ref):{})} className={`ref-pill ${l.current?'current':''} ${l.tag?'tag':''} ${ref&&dropOn===ref?'drop':''}`} style={{'--lane':color(lane)} as CSSProperties} title={[l.local&&`Local: ${l.local}`,l.remote&&`Remota: ${l.remote}`,l.tag&&`Tag: ${l.text}`,l.current&&'(branch atual · HEAD)'].filter(Boolean).join('\n')}
    onDoubleClick={e=>{e.stopPropagation();if(l.local||l.remote)openSwitch(l.local||l.remote!);}} onContextMenu={e=>l.tag?tagMenu(e,l.text,l.sha):branchMenu(e,l.local||l.remote!)} data-row={row}>
    {l.current&&<Check size={11} className="pill-check"/>}
    {l.tag?<Tag size={11}/>:null}
    <span className="pill-text">{l.text}</span>
    {l.local&&<Laptop size={11} className="pill-icon"/>}
    {l.remote&&<Cloud size={11} className="pill-icon"/>}
  </span>;};

  const diffView=choice&&<div className="diff-view">
    <div className="diff-head">
      <button className="btn ghost" onClick={()=>setChoice(null)}><ArrowLeft size={14}/>Grafo</button>
      <FileCode2 size={14}/><span className="diff-path" title={choice.path}>{choice.path}</span>
      <span className={`diff-kind ${choice.conflicted?'conflict':''}`}>{choice.conflicted?'Em conflito':choice.stash?'Stash':choice.sha?`Commit ${short(choice.sha)}`:choice.staged?'Preparado':'Não preparado'}</span>
      {choice.conflicted&&<span className="diff-actions">
        <button className="btn ours" disabled={!!busy} onClick={()=>resolve(choice.path,'ours')}>Usar a minha ({s.branch||'HEAD'})</button>
        <button className="btn theirs" disabled={!!busy} onClick={()=>resolve(choice.path,'theirs')}>Usar a recebida</button>
        <button className="btn primary" disabled={!!busy} onClick={()=>resolve(choice.path,'mark')}><Check size={13}/>Marcar resolvido</button>
      </span>}
    </div>
    {choice.conflicted&&diff.includes('<<<<<<<')&&!rawConflict&&<><div className="conflict-help"><TriangleAlert size={14}/><span>Escolha, em cada trecho, a <b className="ours-t">sua versão</b> ({s.branch}), a <b className="theirs-t">recebida</b> ({s.merging?.source||'outra branch'}) ou as duas. Depois clique em <b>Salvar e marcar resolvido</b>. <button className="linkish" onClick={()=>setRawConflict(true)}>Ver arquivo bruto</button></span></div>
      <ConflictEditor key={choice.path+diff.length} text={diff} ours={s.branch||'HEAD'} theirs={s.merging?.source||'recebida'} busy={!!busy} onSave={content=>resolve(choice.path,'content',content)}/></>}
    {choice.conflicted&&(!diff.includes('<<<<<<<')||rawConflict)&&<div className="conflict-help"><TriangleAlert size={14}/><span>{rawConflict&&<><button className="linkish" onClick={()=>setRawConflict(false)}>Voltar à resolução por trechos</button>. </>}Trechos entre <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> e <code>=======</code> são a <b className="ours-t">sua versão</b>; entre <code>=======</code> e <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>, a <b className="theirs-t">versão recebida</b>. Escolha um lado inteiro acima, ou edite o arquivo no seu editor, apague os marcadores, salve e clique em <b>Marcar resolvido</b>.</span></div>}
    {!(choice.conflicted&&diff.includes('<<<<<<<')&&!rawConflict)&&<pre className="diff-code">{choice.conflicted?(()=>{let zone='';return diff.split('\n').map((line,i)=>{let cls=zone;if(/^<{7}( |$)/.test(line)){zone='ours';cls='marker ours';}else if(/^={7}$/.test(line)&&zone){zone='theirs';cls='marker';}else if(/^>{7}( |$)/.test(line)){zone='';cls='marker theirs';}else if(/^\|{7}( |$)/.test(line)){zone='base';cls='marker';}return <span key={i} className={`dl ${cls}`}><span className="ln">{i+1}</span>{line||' '}</span>;});})()
      :diff.split('\n').map((line,i)=><span className={`dl ${line.startsWith('+')&&!line.startsWith('+++')?'add':line.startsWith('-')&&!line.startsWith('---')?'del':line.startsWith('@@')?'hunk':/^(diff|index|---|\+\+\+) /.test(line)?'meta':''}`} key={i}>{line||' '}</span>)}</pre>}
  </div>;

  const fileRow=(f:FileState,kind:'unstaged'|'staged')=>{const st=statusLetter(f,kind==='staged');const [dir,name]=splitPath(f.path);const active=choice&&!choice.sha&&choice.path===f.path&&choice.staged===(kind==='staged');return <div key={kind+f.path} className={`file-row ${active?'active':''}`}>
    <span className={`st ${st.cls}`} title={st.title}>{st.letter}</span>
    <button className="file-name" title={f.oldPath?`${f.oldPath} → ${f.path}`:f.path} onClick={()=>setChoice({path:f.path,staged:kind==='staged'})}><span className="fn">{name}</span><span className="fd">{dir}</span></button>
    <button className="file-act discard" title={`Descartar as alterações de ${f.path}`} aria-label={`Descartar ${f.path}`} disabled={!!busy||!!s.merging} onClick={()=>openDiscard([f.path])}><Trash2 size={12}/></button>
    {kind==='unstaged'
      ?<button className="file-act stage" disabled={!!busy} onClick={()=>action('stage',{paths:[f.path]},'Arquivo preparado.')}>Stage</button>
      :<button className="file-act unstage" disabled={!!busy} onClick={()=>action('unstage',{paths:[f.path]},'Arquivo retirado.')}>Unstage</button>}
  </div>;};

  const wipPanel=<div className="panel-body">
    <div className="panel-title"><Pencil size={14}/><span>{s.files.length} {s.files.length===1?'alteração':'alterações'} em <b>{s.branch||'HEAD destacado'}</b></span><span className="grow"/>{s.files.length>0&&<button className="btn ghost xs" disabled={!!busy||!!s.merging||conflicts.length>0||!s.head} onClick={openStash} title="Guardar as alterações num stash"><Archive size={12}/>Stash</button>}</div>
    {s.merging&&<div className="merge-box"><div className="merge-box-title"><GitMerge size={14}/>Merge em andamento</div><p>{subject(s.merging.message)}</p><p className="muted">{conflicts.length?`${conflicts.length} ${conflicts.length===1?'arquivo em conflito':'arquivos em conflito'}. Resolva todos para concluir.`:'Todos os conflitos resolvidos. Escreva a mensagem e conclua o merge.'}</p><button className="btn danger" disabled={!!busy} onClick={()=>action('merge-abort',{},'Merge abortado. Branch restaurada.')}><X size={13}/>Abortar merge</button></div>}
    {conflicts.length>0&&<div className="file-group conflict-group"><div className="group-head"><TriangleAlert size={13}/>Conflitos<span className="count">{conflicts.length}</span></div>{conflicts.map(f=>{const [dir,name]=splitPath(f.path);return <div key={'c'+f.path} className={`file-row ${choice?.conflicted&&choice.path===f.path?'active':''}`}><span className="st st-conflict">!</span><button className="file-name" title={f.path} onClick={()=>setChoice({path:f.path,staged:false,conflicted:true})}><span className="fn">{name}</span><span className="fd">{dir}</span></button><button className="file-act" onClick={()=>setChoice({path:f.path,staged:false,conflicted:true})}>Resolver</button></div>;})}</div>}
    <div className="file-group"><div className="group-head">Unstaged<span className="count">{unstaged.length}</span>{unstaged.length>0&&<><button className="group-act discard" title="Descartar todas as alterações não preparadas" disabled={!!busy||!!s.merging} onClick={()=>openDiscard(unstaged.map(f=>f.path))}><Trash2 size={11}/>Descartar</button><button className="group-act stage" disabled={!!busy} onClick={()=>action('stage',{paths:unstaged.map(f=>f.path)},'Todos os arquivos preparados.')}>Stage all</button></>}</div>{unstaged.length?unstaged.map(f=>fileRow(f,'unstaged')):<p className="files-empty">Nada pendente.</p>}</div>
    <div className="file-group"><div className="group-head">Staged<span className="count">{staged.length}</span>{staged.length>0&&<button className="group-act unstage" disabled={!!busy} onClick={()=>action('unstage',{paths:staged.map(f=>f.path)},'Todos os arquivos retirados.')}>Unstage all</button>}</div>{staged.length?staged.map(f=>fileRow(f,'staged')):<p className="files-empty">Use Stage para incluir arquivos no commit.</p>}</div>
    <div className="commit-box"><input placeholder={s.merging?'Mensagem do merge':'Resumo do commit'} value={message} maxLength={300} onChange={e=>setMessage(e.target.value)} aria-label="Resumo do commit"/><textarea placeholder="Descrição (opcional)" rows={3} value={description} maxLength={9500} onChange={e=>setDescription(e.target.value)} aria-label="Descrição do commit"/>
      <button className="btn primary wide" disabled={!!busy||(!staged.length&&!s.merging)||!message.trim()||s.conflicted||!s.branch} onClick={commit}>{busy==='commit'?'Criando commit…':s.merging?(s.conflicted?'Resolva os conflitos primeiro':'Concluir merge'):staged.length?`Commit de ${staged.length} ${staged.length===1?'arquivo':'arquivos'}`:'Prepare arquivos para commitar'}</button>
      {!s.branch&&<p className="muted small">HEAD destacado: crie uma branch antes de commitar.</p>}</div>
  </div>;

  const commitPanel=shownCommit&&<div className="panel-body">
    <div className="commit-head"><div className="commit-sha"><span>{shownCommit.parents.length>1?'merge':'commit'}:</span><button title="Copiar hash" onClick={()=>copy(shownCommit.sha)}><code>{short(shownCommit.sha)}</code><Copy size={11}/></button></div><h2>{subject(shownCommit.message)}</h2>{shownCommit.message.includes('\n')&&<p className="commit-body">{shownCommit.message.split('\n').slice(1).join('\n').trim()}</p>}
      <div className="author-line"><span className="avatar" style={{'--lane':color(layout.cols.get(shownCommit.sha)||0)} as CSSProperties}>{initials(shownCommit.author)}</span><div><b>{shownCommit.author}</b><span>{fmt(shownCommit.date,true)}</span></div></div>
      <div className="parents">pais: {shownCommit.parents.length?shownCommit.parents.map(p=><button key={p} disabled={!layout.cols.has(p)} onClick={()=>select(p,true)}><code>{short(p)}</code></button>):<span className="muted">nenhum (commit inicial)</span>}</div>
      {(labels.get(shownCommit.sha)||[]).length>0&&<div className="commit-refs">{(labels.get(shownCommit.sha)||[]).map(l=><div key={l.key} className="commit-ref">{pill(l,-1)}{!l.tag&&!l.current&&<><button className="btn ghost xs" disabled={!!busy} onClick={()=>openSwitch(l.local||l.remote!)}>Checkout</button>{s.branch&&<button className="btn ghost xs" disabled={!!busy} onClick={()=>openMerge(l.local||l.remote!)}>Merge em {s.branch}</button>}</>}</div>)}</div>}
      <div className="commit-actions"><button className="btn ghost sm" disabled={!!busy} onClick={()=>openBranch(true)}><GitBranchPlus size={13}/>Criar branch aqui</button><button className="btn ghost sm" disabled={!!busy} onClick={()=>openTag(shownCommit.sha,short(shownCommit.sha))}><Tag size={13}/>Criar tag aqui</button></div>
    </div>
    <div className="tabs"><button className={tab==='files'?'on':''} onClick={()=>setTab('files')}>Arquivos{commitFiles&&!commitFiles.merge&&<span className="count">{commitFiles.files.length}</span>}</button><button className={tab==='info'?'on':''} onClick={()=>setTab('info')}>Detalhes</button></div>
    {tab==='files'?<div className="file-group">{!commitFiles?<p className="files-empty">Carregando…</p>:commitFiles.merge?<p className="files-empty">Commit de merge. Selecione um dos pais para ver as alterações.</p>:commitFiles.files.map(f=>{const [dir,name]=splitPath(f.path);return <div key={f.path} className={`file-row ${choice?.sha===shownCommit.sha&&choice.path===f.path?'active':''}`}><span className="st st-mod">M</span><button className="file-name" title={f.path} onClick={()=>setChoice({path:f.path,staged:false,sha:shownCommit.sha})}><span className="fn">{name}</span><span className="fd">{dir}</span></button><span className="numstat">{f.binary?'bin':<><b className="plus">+{f.additions}</b><b className="minus">−{f.deletions}</b></>}</span></div>;})}</div>
    :<div className="info-grid"><span>Hash</span><code>{shownCommit.sha}</code><span>Autor</span><span>{shownCommit.author}</span><span>Data</span><span>{fmt(shownCommit.date,true)}</span><span>Pais</span><span>{shownCommit.parents.map(short).join(', ')||'—'}</span></div>}
  </div>;

  const stashBlocked=!!s.merging||conflicts.length>0;
  const stashPanel=stashShown&&<div className="panel-body">
    <div className="commit-head"><div className="commit-sha"><span>stash:</span><button title="Copiar hash" onClick={()=>copy(stashShown.sha)}><code>{stashLabel(stashShown)}</code><Copy size={11}/></button></div><h2>{stashShown.message}</h2>
      <div className="stash-meta"><Archive size={12}/>{stashShown.branch?<>feito em <b>{stashShown.branch}</b> · </>:null}{fmt(stashShown.date,true)}</div>
      {stashBlocked&&<p className="muted small">{s.merging?'Há um merge em andamento: conclua ou aborte antes de aplicar.':'Resolva os conflitos atuais antes de aplicar.'}</p>}
      <div className="stash-actions">
        <button className="btn primary sm" disabled={!!busy||stashBlocked} onClick={()=>applyStash(stashShown,true)} title="Traz as alterações de volta para o WIP e apaga o stash"><ArchiveRestore size={13}/>{busy==='stash-apply'?'Aplicando…':'Pop'}</button>
        <button className="btn ghost sm" disabled={!!busy||stashBlocked} onClick={()=>applyStash(stashShown,false)} title="Traz as alterações de volta e mantém o stash guardado"><Download size={13}/>Aplicar</button>
        <button className="btn ghost sm" disabled={!!busy} onClick={()=>openStashBranch(stashShown)} title="Cria uma branch no commit onde o stash foi feito e aplica o stash nela"><GitBranchPlus size={13}/>Branch</button>
        <button className="btn danger sm" disabled={!!busy} onClick={()=>dropStash(stashShown)} title="Apaga o stash (dá para desfazer logo depois)"><Trash2 size={13}/>Apagar</button>
      </div>
    </div>
    <div className="file-group"><div className="group-head">Arquivos{stashFiles&&<span className="count">{stashFiles.length}</span>}</div>{!stashFiles?<p className="files-empty">Carregando…</p>:!stashFiles.length?<p className="files-empty">Nenhum arquivo.</p>:stashFiles.map(f=>{const [dir,name]=splitPath(f.path);return <div key={f.path} className={`file-row ${choice?.stash&&choice.sha===stashShown.sha&&choice.path===f.path?'active':''}`}><span className={`st ${f.untracked?'st-add':'st-mod'}`} title={f.untracked?'Arquivo novo':'Modificado'}>{f.untracked?'A':'M'}</span><button className="file-name" title={f.path} onClick={()=>setChoice({path:f.path,staged:false,sha:stashShown.sha,stash:true})}><span className="fn">{name}</span><span className="fd">{dir}</span></button><span className="numstat">{f.binary?'bin':<><b className="plus">+{f.additions}</b><b className="minus">−{f.deletions}</b></>}</span></div>;})}</div>
  </div>;

  const nonCurrentBranches=allBranches.filter(b=>b.name!==(into||s.branch));
  // Fast-forward não precisa de WIP limpo: no lugar (outra branch) ou --ff-only na atual.
  const ffOk=!!preview&&preview.fastForward&&preview.incoming>0&&(!!preview.inPlace||(!preview.needsCheckout&&preview.into===s.branch));
  const pushCmd=s.upstream&&s.remote&&s.remote!=='.'?`git push ${s.remote} ${s.branch}`:`git push -u ${s.remotes.includes('origin')?'origin':s.remotes[0]||'origin'} ${s.branch}`;

  return <div className="app" hidden={!active}>
    <header className="toolbar">
      {brand}
      <div className="repo-switch"><button className="crumb" onClick={onHome} title={`${s.root}\nClique para abrir outro repositório numa nova aba`}><span className="crumb-label">repositório</span><span className="crumb-value"><FolderGit2 size={13}/>{h.repository}<ChevronDown size={12}/></span></button>
        <div className={`crumb ${s.branch&&dropOn===s.branch?'drop':''}`} {...(s.branch?dnd(s.branch,false):{})} title="Solte uma branch aqui para fazer merge na branch atual"><span className="crumb-label">branch</span><span className="crumb-value branch-select"><GitBranch size={13}/><select aria-label="Trocar de branch" value={s.branch||''} disabled={!!busy} onChange={e=>openSwitch(e.target.value)}>{!s.branch&&<option value="">HEAD destacado</option>}<optgroup label="Local">{localBranches.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</optgroup>{remoteBranches.length>0&&<optgroup label="Remota">{remoteBranches.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</optgroup>}</select></span></div>
      </div>
      <div className="tools">
        {toolButton(<ArrowDownToLine size={18}/>,'Pull',openPull,{badge:s.behind,disabled:!s.remotes.length,title:s.upstream?`Trazer commits de ${s.upstream}`:'A branch não acompanha um remoto'})}
        {toolButton(<ArrowUpToLine size={18}/>,'Push',()=>setDialog('push'),{badge:s.ahead,disabled:!s.remotes.length||!s.branch,title:'Enviar commits ao remoto'})}
        {toolButton(<RefreshCw size={18} className={busy==='fetch'||(autoFetching&&!busy)?'spinning':''}/>,'Fetch',()=>action('fetch',{},'Referências remotas atualizadas.'),{disabled:!s.remotes.length,title:'git fetch --prune'})}
        <span className="tool-sep"/>
        {toolButton(<GitBranchPlus size={18}/>,'Branch',()=>openBranch(false),{disabled:!s.head})}
        {toolButton(<GitMerge size={18}/>,'Merge',()=>openMerge(),{disabled:!s.branch||!!s.merging})}
        <span className="tool-sep"/>
        {toolButton(<Archive size={18}/>,'Stash',openStash,{disabled:!s.files.length||!!s.merging||conflicts.length>0||!s.head,title:s.files.length?'Guardar as alterações do WIP num stash':'Nada para guardar'})}
        {toolButton(<ArchiveRestore size={18}/>,'Pop',()=>{if(s.stashes[0])void applyStash(s.stashes[0],true);},{badge:s.stashes.length,disabled:!s.stashes.length||!!s.merging||conflicts.length>0,title:s.stashes[0]?`Aplicar e remover o stash mais recente: ${s.stashes[0].message}`:'Nenhum stash guardado'})}
      </div>
      <div className="toolbar-right">
        {updatePill}
        <button className="icon-btn" title="Recarregar estado" onClick={()=>refresh()} disabled={!!busy}><RefreshCw size={15}/></button>
        <button className="icon-btn" title="Operações Git desta sessão" onClick={()=>setDialog('operations')}><Terminal size={15}/>{s.audit.length>0&&<span className="dot-count">{s.audit.length}</span>}</button>
        <button className="icon-btn" title="Ajuda" onClick={()=>setDialog('help')}><CircleHelp size={15}/></button>
      </div>
    </header>

    <div className="body">
      <aside className="sidebar">
        <label className="side-filter"><Search size={12}/><input placeholder="Filtrar branches" value={sideFilter} onChange={e=>setSideFilter(e.target.value)}/></label>
        <div className="side-scroll">
          {sideSection('local',<><Laptop size={13}/>LOCAL</>,localBranches.length,localBranches.filter(b=>b.name.toLocaleLowerCase().includes(sf)).map(branchItem))}
          {sideSection('remote',<><Cloud size={13}/>REMOTE</>,remoteBranches.length,remotesGrouped.map(g=><div key={g.remote} className="remote-group"><button className="remote-name" onClick={()=>setCollapsed(c=>({...c,['r:'+g.remote]:!c['r:'+g.remote]}))}>{collapsed['r:'+g.remote]?<ChevronRight size={12}/>:<ChevronDown size={12}/>}<Cloud size={12}/>{g.remote}</button>{!collapsed['r:'+g.remote]&&g.list.map(branchItem)}</div>))}
          {sideSection('tags',<><Tag size={13}/>TAGS</>,s.tags.length,s.tags.filter(t=>t.name.toLocaleLowerCase().includes(sf)).map(t=><button key={t.name} className="side-tag" title={`${t.name}\nBotão direito: push ou apagar`} onContextMenu={e=>tagMenu(e,t.name,t.sha)} onClick={()=>{if(layout.cols.has(t.sha))select(t.sha,true);}}><Tag size={11}/>{t.name}</button>))}
          {sideSection('stashes',<><Archive size={13}/>STASHES</>,s.stashes.length,s.stashes.length?s.stashes.filter(x=>x.message.toLocaleLowerCase().includes(sf)||(x.branch||'').toLocaleLowerCase().includes(sf)).map(x=><div key={x.sha} className={`side-stash ${stashSel===x.sha?'on':''}`} onContextMenu={e=>stashMenu(e,x)}>
            <button className="side-stash-main" title={`${stashLabel(x)}: ${x.message}${x.branch?`\nfeito em ${x.branch}`:''}\n${fmt(x.date,true)}\nClique: opções · Botão direito: menu`} onClick={e=>{showStash(x);stashMenu(e,x);}}><Archive size={11}/><span className="side-stash-text"><span className="side-stash-msg">{x.message}</span><span className="side-stash-sub">{x.branch||'?'} · {fmt(x.date)}</span></span></button>
            <span className="side-actions"><button title="Pop: aplicar e remover" disabled={!!busy||stashBlocked} onClick={()=>applyStash(x,true)}><ArchiveRestore size={12}/></button><button title="Apagar" disabled={!!busy} onClick={()=>dropStash(x)}><Trash2 size={12}/></button></span>
          </div>):<p className="side-empty">Nenhum stash. Use <b>Stash</b> no topo para guardar o WIP.</p>)}
        </div>
        <div className="side-foot"><span className={`work-state ${s.files.length?'dirty':'clean'}`}><span/>{s.files.length?`${s.files.length} ${s.files.length===1?'alteração':'alterações'} não commitadas`:'Área de trabalho limpa'}</span></div>
      </aside>

      <main className="center">
        {s.merging&&<div className={`merge-banner ${conflicts.length?'has-conflicts':'ready'}`}><span className="pulse"/><GitMerge size={15}/><span><b>{conflicts.length?'Conflito no merge':'Conflitos resolvidos'}</b> — {s.merging.source?<>{s.merging.source} → {s.branch}</>:subject(s.merging.message)}. {conflicts.length?`${conflicts.length} ${conflicts.length===1?'arquivo esperando':'arquivos esperando'} resolução. O repositório fica assim até alguém resolver ou abortar.`:'Escreva a mensagem no painel à direita e clique em Concluir merge.'}</span><button className="btn ghost sm" onClick={()=>{setSelected(WIP);if(conflicts[0])setChoice({path:conflicts[0].path,staged:false,conflicted:true});}}>Ver conflitos</button><button className="btn danger sm" disabled={!!busy} onClick={()=>action('merge-abort',{},'Merge abortado.')}>Abortar</button></div>}
        {diffView||<>
          <div className="graph-bar">
            <label className="search"><Search size={13}/><input ref={search} placeholder="Buscar commits (mensagem, autor, hash)" value={query} onChange={e=>setQuery(e.target.value)}/>{query?<button onClick={()=>setQuery('')} aria-label="Limpar busca"><X size={12}/></button>:<kbd>/</kbd>}</label>
            <select aria-label="Destacar branch" value={highlight} onChange={e=>setHighlight(e.target.value)}><option value="all">Destacar: todas</option>{allBranches.map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</select>
            <select aria-label="Filtrar autor" value={author} onChange={e=>setAuthor(e.target.value)}><option value="all">Todos os autores</option>{authors.map(a=><option key={a}>{a}</option>)}</select>
            {filtering&&<button className="btn ghost sm" onClick={reset}><X size={12}/>Limpar</button>}
            <span className="grow"/>
            <span className="muted small">{realCommits.length} commits</span>
            <div className="zoom"><button aria-label="Diminuir" disabled={zoom<=.75} onClick={()=>setZoom(z=>Math.max(.75,z-.125))}><Minus size={12}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Aumentar" disabled={zoom>=1.5} onClick={()=>setZoom(z=>Math.min(1.5,z+.125))}><Plus size={12}/></button><button aria-label="Ir ao topo" onClick={()=>{setZoom(1);scroll.current?.scrollTo({top:0});}}><Maximize2 size={12}/></button></div>
          </div>
          <div className="graph-head" style={{gridTemplateColumns:`${refW}px ${graphW}px minmax(200px,1fr) 150px 120px 76px`}}><span>BRANCH / TAG</span><span>GRAFO</span><span>MENSAGEM DO COMMIT</span><span>AUTOR</span><span>DATA</span><span>HASH</span></div>
          <div className={`graph-scroll ${drag?'dnd-active':''}`} ref={scroll} tabIndex={0} aria-label="Histórico de commits">
            {!rows.length&&<div className="empty"><GitCommitHorizontal size={26}/><b>Nenhum commit ainda.</b><p>Prepare arquivos e faça o primeiro commit.</p></div>}
            <div className="graph-stage" style={{height:rows.length*rowH}}>
              {rows.map((c,i)=>{const lane=layout.cols.get(c.sha)||0;const isWip=c.sha===WIP;const sel=isWip?showWip:c.sha===shownCommit?.sha;const ls=labels.get(c.sha)||[];const isHead=c.sha===s.head;return <div key={c.sha} data-sha={c.sha} role="button" tabIndex={-1}
                className={`row ${sel?'selected':''} ${matches.has(c.sha)?'':'dim'} ${headChain.has(c.sha)?'on-head':''} ${isWip?'wip':''}`}
                style={{top:i*rowH,height:rowH,gridTemplateColumns:`${refW}px ${graphW}px minmax(200px,1fr) 150px 120px 76px`,'--lane':color(lane)} as CSSProperties}
                onClick={()=>select(c.sha)} onContextMenu={e=>{if(!isWip)commitMenu(e,c);}}>
                <span className={`refs ${ls.length>1?'multi':''} ${dragRow===c.sha?'open':''}`} onDragEnter={()=>{if(drag&&ls.length>1&&dragRow!==c.sha)setDragRow(c.sha);}} onDragLeave={e=>{if(dragRow===c.sha&&!e.currentTarget.contains(e.relatedTarget as Node))setDragRow(null);}}>{isWip?<span className="ref-pill wip-pill" style={{'--lane':color(lane)} as CSSProperties}><Pencil size={11}/><span className="pill-text">WIP</span></span>:<>{ls.slice(0,1).map(l=>pill(l,i))}{ls.length>1&&<span className="more">+{ls.length-1}</span>}
                  {ls.length>1&&<span className={`refs-pop ${i>=4&&i>=rows.length-4?'up':''}`} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}>
                    <span className="refs-pop-title">{ls.length} referências neste commit · clique para fazer checkout</span>
                    {ls.map(l=>{const ref=l.local||l.remote;return <button key={l.key} type="button" {...(ref?dnd(ref):{})} className={`refs-pop-item ${l.current?'current':''} ${ref&&dropOn===ref?'drop':''}`} disabled={!!busy} aria-disabled={l.current||undefined} style={{'--lane':color(lane)} as CSSProperties}
                      title={ref?(l.current?`${l.text} é a branch atual`:`Checkout de ${ref} · arraste sobre outra branch para fazer merge`):`Tag ${l.text}`}
                      onContextMenu={e=>l.tag?tagMenu(e,l.text,l.sha):branchMenu(e,ref!)}
                      onClick={()=>{if(l.current)return;if(ref)void openSwitch(ref);else select(l.sha,true);}}>
                      {l.current?<Check size={12}/>:l.tag?<Tag size={12}/>:l.local?<Laptop size={12}/>:<Cloud size={12}/>}
                      <span className="refs-pop-name">{l.text}</span>
                      {l.local&&l.remote&&<Cloud size={11} className="muted"/>}
                      <span className="refs-pop-act">{l.current?'atual':ref?'checkout':'tag'}</span>
                    </button>;})}
                  </span>}</>}{(ls.length>0||isWip)&&<span className="ref-line"/>}</span>
                <span/>
                <span className="msg">{isWip?<span className="wip-msg">// WIP <span className="muted">{s.merging?'merge em andamento · ':''}{s.files.length} {s.files.length===1?'arquivo':'arquivos'}</span>{conflicts.length>0&&<span className="wip-conflict"><TriangleAlert size={11}/>{conflicts.length} em conflito</span>}</span>:<>{isHead&&<span className="head-tag">HEAD</span>}<span className="subject">{subject(c.message)}</span></>}</span>
                <span className="author">{!isWip&&c.author}</span>
                <span className="date">{!isWip&&fmt(c.date)}</span>
                <code className="sha">{!isWip&&short(c.sha)}</code>
              </div>;})}
              <svg className="graph-svg" width={graphW} height={rows.length*rowH} style={{left:refW}} aria-hidden="true">
                {rows.map((c,i)=>(labels.get(c.sha)?.length||c.sha===WIP)?<line key={'l'+c.sha} x1={0} x2={gx(layout.cols.get(c.sha)||0)} y1={gy(i)} y2={gy(i)} stroke={color(layout.cols.get(c.sha)||0)} strokeWidth="1.5" opacity={matches.has(c.sha)?.7:.15} strokeDasharray={c.sha===WIP?'3 3':undefined}/>:null)}
                {layout.edges.map((e,k)=>{const x1=gx(e.fromCol),y1=gy(e.fromRow),xv=gx(e.via),x2=gx(e.toCol),y2=e.dangling?y1+rowH*.8:gy(e.toRow);const R=rowH;let d=`M ${x1} ${y1}`;
                  if(e.toRow-e.fromRow<=1&&!e.dangling&&(x1!==x2))d+=` C ${x1} ${y1+R*.6}, ${x2} ${y2-R*.6}, ${x2} ${y2}`;
                  else{let cy=y1;if(xv!==x1){d+=` C ${x1} ${y1+R*.6}, ${xv} ${y1+R*.4}, ${xv} ${y1+R}`;cy=y1+R;}
                    if(xv!==x2){if(y2-R>cy)d+=` L ${xv} ${y2-R}`;d+=` C ${xv} ${y2-R*.4}, ${x2} ${y2-R*.6}, ${x2} ${y2}`;}else d+=` L ${x2} ${y2}`;}
                  const from=rows[e.fromRow];const thick=headChain.has(from.sha)&&e.via===e.fromCol&&from.parents[0]===rows[e.toRow]?.sha;
                  const vis=!filtering||matches.has(from.sha);
                  return <path key={k} d={d} fill="none" stroke={color(e.via)} strokeWidth={thick?3.2:2} strokeLinecap="round" strokeDasharray={e.dashed?'4 4':undefined} opacity={vis?(thick?1:.85):.15}/>;})}
                {rows.map((c,i)=>{const col=layout.cols.get(c.sha)||0,cx=gx(col),cy=gy(i),cl=color(col);const sel=c.sha===WIP?showWip:c.sha===shownCommit?.sha;const op=matches.has(c.sha)?1:.25;const r=Math.round(9*Math.min(zoom,1.2));
                  if(c.sha===WIP)return <g key={c.sha} opacity={op}><circle cx={cx} cy={cy} r={r} fill="var(--bg)" stroke={cl} strokeWidth="2" strokeDasharray="3 2.5"/>{sel&&<circle cx={cx} cy={cy} r={r+4} fill="none" stroke={cl} strokeOpacity=".4" strokeWidth="2"/>}</g>;
                  if(c.parents.length>1)return <g key={c.sha} opacity={op}>{sel&&<circle cx={cx} cy={cy} r={r} fill={cl} opacity=".25"/>}<circle cx={cx} cy={cy} r={4.5} fill={cl} stroke="var(--bg)" strokeWidth="1.5"/></g>;
                  return <g key={c.sha} opacity={op}>{sel&&<circle cx={cx} cy={cy} r={r+4} fill="none" stroke={cl} strokeOpacity=".45" strokeWidth="2.5"/>}<circle cx={cx} cy={cy} r={r} fill={c.sha===s.head?cl:'var(--node)'} stroke={cl} strokeWidth="2"/><text x={cx} y={cy+3.2} textAnchor="middle" fontSize={Math.round(8*Math.min(zoom,1.2))} fontWeight="700" fill={c.sha===s.head?'#0d1116':cl}>{initials(c.author)}</text></g>;})}
              </svg>
            </div>
          </div>
        </>}
      </main>

      <aside className="panel">{stashPanel||(showWip?wipPanel:commitPanel)||<div className="panel-empty"><GitCommitHorizontal size={26}/><p>Selecione um commit.</p></div>}</aside>
    </div>

    <footer className="statusbar"><span title={s.root}><FolderGit2 size={12}/>{s.root}</span><span>{s.upstream?<>↑{s.ahead} ↓{s.behind} · {s.upstream}</>:'sem upstream'}</span><span>{autoFetching?'buscando novidades no remoto…':s.lastFetch?`último fetch ${fmt(s.lastFetch,true)}`:'fetch ainda não executado'}</span>{s.autoFetchError&&<span className="warn" title={`O fetch automático falhou e tenta de novo em alguns minutos:\n${s.autoFetchError}`}><TriangleAlert size={11}/>fetch automático falhou</span>}<span className="grow"/><span>{updated?`atualizado ${new Date(updated).toLocaleTimeString('pt-BR')}`:''}</span>{versionLabel}<span><LockKeyhole size={11}/>local</span></footer>

    {dialog&&<div className="backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setDialog(null);}}><div className="modal" ref={modal} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <button className="modal-close icon-btn" aria-label="Fechar" disabled={!!busy} onClick={()=>setDialog(null)}><X size={16}/></button>
      {dialog==='branch'&&<form onSubmit={runBranch}><h2 id="dialog-title"><GitBranchPlus size={17}/>Nova branch</h2><label className="field"><span>Nome</span><input data-autofocus value={branchName} onChange={e=>setBranchName(e.target.value.replace(/\s/g,'-'))} placeholder="feature/minha-tarefa" spellCheck={false} autoComplete="off"/></label>
        <div className="field"><span>A partir de</span><label className="radio"><input type="radio" checked={branchFrom==='head'} onChange={()=>setBranchFrom('head')}/><span>HEAD atual {s.branch&&<b>({s.branch} · {short(s.head||'')})</b>}</span></label>{shownCommit&&shownCommit.sha!==s.head&&<label className="radio"><input type="radio" checked={branchFrom==='selected'} onChange={()=>setBranchFrom('selected')}/><span>Commit selecionado <b>{short(shownCommit.sha)}</b> <span className="muted">{subject(shownCommit.message).slice(0,40)}</span></span></label>}</div>
        <label className="check"><input type="checkbox" checked={branchCheckout} onChange={e=>setBranchCheckout(e.target.checked)}/>Fazer checkout da nova branch</label>
        <pre className="cmd">{branchCheckout?`git switch -c ${branchName||'<nome>'}`:`git branch ${branchName||'<nome>'}`} {branchFrom==='selected'&&shownCommit?short(shownCommit.sha):''}</pre>
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button className="btn primary" type="submit" disabled={!!busy||!branchName.trim()}>{busy==='branch'?'Criando…':'Criar branch'}</button></div></form>}
      {dialog==='merge'&&<><h2 id="dialog-title"><GitMerge size={17}/>Merge em <span className="hl">{into||s.branch}</span></h2><label className="field"><span>Trazer as alterações de</span><select data-autofocus value={target} onChange={e=>setTarget(e.target.value)}><optgroup label="Local">{nonCurrentBranches.filter(b=>!b.remote).map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</optgroup><optgroup label="Remota">{nonCurrentBranches.filter(b=>b.remote).map(b=><option key={b.name} value={b.name}>{b.name}</option>)}</optgroup></select></label>
        <div className="merge-flow"><span className="ref-pill" style={{'--lane':color(laneOfBranch(allBranches.find(b=>b.name===target)?.sha||'')??3)} as CSSProperties}><span className="pill-text">{target||'?'}</span></span><ChevronRight size={14}/><span className="ref-pill current" style={{'--lane':color(0)} as CSSProperties}><Check size={11} className="pill-check"/><span className="pill-text">{into||s.branch}</span></span></div>
        {preview?.inPlace&&<p className="note"><FastForward size={13}/><span><b>{preview.into}</b> só está atrás, na mesma linha: o Briar apenas a avança, sem checkout. Você continua em <b>{s.branch||'HEAD'}</b> e o WIP não é tocado.</span></p>}
        {preview?.needsCheckout&&<p className="note"><Laptop size={13}/>O Briar faz checkout de <b>{preview.into}</b> antes do merge.</p>}
        {preview?.intoRemote&&<p className="note"><Cloud size={13}/>{into} é remota: o merge acontece na branch local <b>{preview.into}</b>. Depois use <b>Push</b> para publicar.</p>}
        <div className="preview">{previewError?<div className="inline-error">{previewError}</div>:!preview?<p className="muted">Analisando…</p>:preview.incoming===0?<p className="ok"><Check size={14}/>{preview.into} já contém todos os commits de {preview.branch}. Nada a integrar.</p>:preview.fastForward?<p className="ok"><Check size={14}/>{preview.incoming} {preview.incoming===1?'commit':'commits'} · fast-forward, sem conflitos.</p>:preview.conflicts.length?<><p className="warn"><TriangleAlert size={14}/>{preview.incoming} {preview.incoming===1?'commit':'commits'} · <b>conflitos previstos em {preview.conflicts.length} {preview.conflicts.length===1?'arquivo':'arquivos'}</b>:</p><ul className="conflict-list">{preview.conflicts.map(f=><li key={f}><code>{f}</code></li>)}</ul><p className="muted small">Você poderá resolvê-los aqui depois do merge, ou abortar.</p></>:<p className="ok"><Check size={14}/>{preview.incoming} {preview.incoming===1?'commit':'commits'} · merge automático, sem conflitos previstos.</p>}</div>
        {s.files.some(f=>!f.untracked)&&!ffOk&&<div className="inline-error">Faça commit das alterações locais antes do merge.</div>}
        <pre className="cmd">{preview?.inPlace?`git update-ref refs/heads/${preview.into} ${target}`:ffOk?`git merge --ff-only ${target}`:`${preview?.needsCheckout?`git switch ${preview.into}\n`:''}git merge --no-edit ${target}`}</pre>
        <div className="modal-actions"><button className="btn ghost" onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button className="btn primary" disabled={!!busy||!target||!!previewError||(s.files.some(f=>!f.untracked)&&!ffOk)||preview?.incoming===0} onClick={runMerge}>{busy==='merge'?'Integrando…':ffOk?<><FastForward size={13}/>Fast-forward</>:preview?.conflicts.length?'Fazer merge e resolver conflitos':'Fazer merge'}</button></div></>}
      {dialog==='push'&&<><h2 id="dialog-title"><ArrowUpToLine size={17}/>Push de <span className="hl">{s.branch}</span></h2><p className="modal-text">{!s.upstream?`A branch ainda não existe no remoto. Ela será criada e passará a ser acompanhada (upstream).`:s.ahead?`${s.ahead} ${s.ahead===1?'commit será enviado':'commits serão enviados'} para ${s.upstream}.`:`Nenhum commit local novo em relação a ${s.upstream} (desde o último fetch).`}</p>{s.behind>0&&<div className="inline-error">O remoto tem {s.behind} {s.behind===1?'commit':'commits'} que você não tem. Faça pull primeiro.</div>}<pre className="cmd">{pushCmd}</pre><p className="muted small">Usa a autenticação Git/SSH já configurada no computador. Nunca faz force push.</p><div className="modal-actions"><button className="btn ghost" onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button className="btn primary" data-autofocus disabled={!!busy||s.behind>0} onClick={runPush}>{busy==='push'?'Enviando…':'Push'}</button></div></>}
      {dialog==='pull'&&<><h2 id="dialog-title"><ArrowDownToLine size={17}/>Pull em <span className="hl">{s.branch}</span></h2><p className="modal-text">{!s.upstream?'Esta branch não acompanha um remoto. Faça push primeiro.':s.ahead&&s.behind?`Históricos divergentes: ${s.ahead} commits locais e ${s.behind} remotos. É preciso um merge.`:s.behind?`${s.behind} ${s.behind===1?'commit remoto':'commits remotos'} para trazer de ${s.upstream}.`:`Nada novo conhecido em ${s.upstream}. O pull também consulta o remoto.`}</p>
        <label className="radio"><input type="radio" checked={pullMode==='ff'} onChange={()=>setPullMode('ff')}/><span><b>Somente fast-forward</b> <span className="muted">— seguro, falha se houver divergência</span></span></label>
        <label className="radio"><input type="radio" checked={pullMode==='merge'} onChange={()=>setPullMode('merge')}/><span><b>Pull com merge</b> <span className="muted">— integra commits divergentes; pode gerar conflitos</span></span></label>
        {s.files.some(f=>!f.untracked)&&<div className="inline-error">Faça commit das alterações locais antes do pull.</div>}
        <pre className="cmd">{pullMode==='ff'?'git pull --ff-only':'git pull --no-rebase --no-edit'}</pre>
        <div className="modal-actions"><button className="btn ghost" onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button className="btn primary" data-autofocus disabled={!!busy||!s.upstream||s.files.some(f=>!f.untracked)} onClick={runPull}>{busy==='pull'?'Atualizando…':'Pull'}</button></div></>}
      {dialog==='tag'&&tagTarget&&(()=>{const name=tagName.trim();const exists=s.tags.some(t=>t.name===name);const r=mainRemote();const suggestion=nextTag(s.lastTag,s.tags.map(t=>t.name));return <form onSubmit={runTag}><h2 id="dialog-title"><Tag size={17}/>Nova tag em <span className="hl">{tagTarget.label}</span></h2>
        <label className="field"><span>Nome</span><input data-autofocus value={tagName} onChange={e=>setTagName(e.target.value.replace(/\s/g,''))} placeholder="v1.0.0" spellCheck={false} autoComplete="off"/></label>
        {s.lastTag?<p className="muted small tag-hint">Última tag criada: <code>{s.lastTag}</code>{name!==suggestion&&!exists&&<> · <button type="button" className="linkish" onClick={()=>setTagName(suggestion)}>usar {suggestion}</button></>}</p>:<p className="muted small tag-hint">Ainda não há tags neste repositório.</p>}
        {exists&&<div className="inline-error">A tag {name} já existe{name===s.lastTag?' (é a última criada)':''}. Mude o nome, por exemplo <button type="button" className="linkish" onClick={()=>setTagName(suggestion)}>{suggestion}</button>.</div>}
        <label className="field"><span>Mensagem <span className="muted">(opcional: com mensagem vira tag anotada)</span></span><input value={tagMessage} maxLength={500} onChange={e=>setTagMessage(e.target.value)} placeholder={`Versão ${name.replace(/^v/,'')||'…'}`}/></label>
        <label className="check"><input type="checkbox" checked={tagPush&&!!r} disabled={!r} onChange={e=>setTagPush(e.target.checked)}/>Enviar a tag para {r?<b>{r}</b>:'o remoto'} (push) logo depois de criar</label>
        <pre className="cmd">{`git tag ${tagMessage.trim()?'-a -m "…" ':''}${name||'<nome>'} ${short(tagTarget.sha)}`}{tagPush&&r?`\ngit push ${r} refs/tags/${name||'<nome>'}`:''}</pre>
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button className="btn primary" type="submit" disabled={!!busy||!name||exists}>{busy==='tag'?'Criando…':tagPush&&r?'Criar tag e enviar':'Criar tag'}</button></div></form>;})()}
      {dialog==='delete-branch'&&delBranch&&(()=>{const r=delBranch.remote?remoteOf(delBranch.remote):'';const rn=delBranch.remote?delBranch.remote.slice(r.length+1):'';const loc=delBranch.scope!=='remote',rem=delBranch.scope!=='local';return <><h2 id="dialog-title" className="danger-title"><Trash2 size={17}/>{delBranch.scope==='local'?'Apagar branch local':delBranch.scope==='remote'?'Apagar branch no remoto':'Apagar branch local e no remoto'}</h2>
        <ul className="conflict-list discard-list">{loc&&<li><Laptop size={13}/><code>{delBranch.local}</code><span className="muted">local, só neste computador</span></li>}{rem&&<li><Cloud size={13}/><code>{delBranch.remote}</code><span className="muted">no servidor, some para todo o time</span></li>}</ul>
        {rem&&<p className="modal-text">Quem já tem essa branch continua com a cópia local, mas ela deixa de existir em {r}.</p>}
        <label className="check"><input type="checkbox" checked={delForce} onChange={e=>setDelForce(e.target.checked)}/>Apagar mesmo assim, ainda que os commits dela não estejam em nenhuma outra branch</label>
        <pre className="cmd">{[rem&&`git push ${r} --delete ${rn}`,loc&&`git branch -D ${delBranch.local}`].filter(Boolean).join('\n')}</pre>
        <div className="modal-actions"><button className="btn ghost" data-autofocus onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button className="btn danger-solid" disabled={!!busy} onClick={runDeleteBranch}><Trash2 size={13}/>{busy==='branch-delete'?'Apagando…':'Apagar'}</button></div></>;})()}
      {dialog==='delete-tag'&&delTag&&(()=>{const r=mainRemote();return <><h2 id="dialog-title" className="danger-title"><Trash2 size={17}/>Apagar a tag <span className="hl">{delTag.name}</span></h2>
        <ul className="conflict-list discard-list">{delTag.local&&<li><Laptop size={13}/><code>{delTag.name}</code><span className="muted">local, só neste computador</span></li>}{delTag.remote&&<li><Cloud size={13}/><code>{delTag.name}</code><span className="muted">no {r}, some para todo o time</span></li>}</ul>
        {!delTag.local&&<p className="modal-text">A tag continua aqui. Dá para enviar de novo depois com Push.</p>}
        <pre className="cmd">{[delTag.remote&&`git push ${r} --delete refs/tags/${delTag.name}`,delTag.local&&`git tag -d ${delTag.name}`].filter(Boolean).join('\n')}</pre>
        <div className="modal-actions"><button className="btn ghost" data-autofocus onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button className="btn danger-solid" disabled={!!busy} onClick={runDeleteTag}><Trash2 size={13}/>{busy==='tag-delete'?'Apagando…':'Apagar'}</button></div></>;})()}
      {dialog==='discard'&&<><h2 id="dialog-title" className="danger-title"><Trash2 size={17}/>Descartar {discardPaths.length===1?'alterações do arquivo':`alterações de ${discardPaths.length} arquivos`}</h2><p className="modal-text">{discardPaths.length===1?'O arquivo volta':'Os arquivos voltam'} a ficar como no último commit. Arquivos novos são removidos e arquivos apagados voltam. Vale tanto para o que está em Staged quanto para o que está em Unstaged.</p><ul className="conflict-list discard-list">{discardPaths.slice(0,12).map(p=>{const f=s.files.find(x=>x.path===p);const st=f?statusLetter(f,!f.unstaged):null;return <li key={p}>{st&&<span className={`st ${st.cls}`} title={st.title}>{st.letter}</span>}<code>{p}</code></li>;})}{discardPaths.length>12&&<li className="muted">e mais {discardPaths.length-12}…</li>}</ul><p className="muted small"><Undo2 size={12}/> Dá para desfazer logo depois pelo aviso que aparece embaixo. As alterações também ficam guardadas no stash do Git como "Briar: descartado…".</p><div className="modal-actions"><button className="btn ghost" data-autofocus onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button className="btn danger-solid" disabled={!!busy} onClick={runDiscard}><Trash2 size={13}/>{busy==='discard'?'Descartando…':'Descartar'}</button></div></>}
      {dialog==='operations'&&<><h2 id="dialog-title"><Terminal size={17}/>Operações Git desta sessão</h2><div className="audit">{s.audit.length?s.audit.map((a,i)=><div className="audit-entry" key={a.date+i}><span className={a.success?'plus':'minus'}>{a.success?'ok':'falhou'} · {new Date(a.date).toLocaleTimeString('pt-BR')}</span><code>{a.command}</code>{a.output&&<pre>{a.output}</pre>}</div>):<p className="muted">Nenhuma operação executada ainda.</p>}</div></>}
      {dialog==='stash'&&<form onSubmit={runStash}><h2 id="dialog-title"><Archive size={17}/>Guardar no stash</h2><p className="modal-text">As alterações saem do WIP e ficam guardadas. Depois é só dar <b>Pop</b> (ou clicar no stash na lateral) para trazê-las de volta, nesta ou em outra branch.</p>
        <label className="field"><span>Mensagem (opcional)</span><input data-autofocus value={stashMsg} maxLength={300} onChange={e=>setStashMsg(e.target.value)} placeholder={`WIP em ${s.branch||'HEAD'}`} autoComplete="off"/></label>
        <label className="check"><input type="checkbox" checked={stashStaged} disabled={!staged.length} onChange={e=>setStashStaged(e.target.checked)}/>Só o que está em Staged ({staged.length})</label>
        <label className="check"><input type="checkbox" checked={stashUntracked&&!stashStaged} disabled={stashStaged} onChange={e=>setStashUntracked(e.target.checked)}/>Incluir arquivos novos (não rastreados)</label>
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button type="submit" className="btn primary" disabled={!!busy}><Archive size={13}/>{busy==='stash-push'?'Guardando…':'Guardar'}</button></div></form>}
      {dialog==='stash-branch'&&stashTarget&&<form onSubmit={runStashBranch}><h2 id="dialog-title"><GitBranchPlus size={17}/>Branch a partir do stash</h2><p className="modal-text">Cria a branch no commit em que <b>{stashTarget.message}</b> foi feito, troca para ela e aplica o stash ali, sem conflito. O stash é removido em seguida.</p>
        <label className="field"><span>Nome</span><input data-autofocus value={branchName} onChange={e=>setBranchName(e.target.value.replace(/\s/g,'-'))} placeholder="feature/do-stash" spellCheck={false} autoComplete="off"/></label>
        {s.files.some(f=>!f.untracked)&&<div className="inline-error">Há alterações no WIP. Faça commit ou stash delas antes.</div>}
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setDialog(null)} disabled={!!busy}>Cancelar</button><button type="submit" className="btn primary" disabled={!!busy||!branchName.trim()||s.files.some(f=>!f.untracked)}>{busy==='stash-branch'?'Criando…':'Criar branch'}</button></div></form>}
      {dialog==='help'&&<><h2 id="dialog-title"><CircleHelp size={17}/>Como usar</h2><div className="help"><p><b>Grafo:</b> cada coluna é uma linha de desenvolvimento. A branch atual fica na primeira coluna, com traço mais grosso e rótulo destacado com <Check size={11}/>. <Laptop size={11}/> = local, <Cloud size={11}/> = remota.</p><p><b>// WIP:</b> linha no topo com seus arquivos ainda não commitados. Clique nela para fazer stage e commit no painel à direita.</p><p><b>Branches:</b> clique para localizar no grafo; duplo clique faz checkout (se a branch local já existe, o Briar troca para ela e a atualiza com o remoto). <b>Arraste uma branch sobre outra</b> (na lateral, no grafo ou no seletor de branch do topo) para abrir o merge.</p><p><b>Fast-forward:</b> se a branch de destino só está atrás, na mesma linha, o merge apenas a avança, sem checkout e sem precisar de WIP limpo. Branches locais atrás do remoto mostram <ArrowDown size={11}/>N na lateral, e o botão <FastForward size={11}/> as atualiza sem trocar de branch.</p><p><b>Merge:</b> mostra antes quais arquivos terão conflito. Se houver, cada arquivo aparece em "Conflitos" e o aviso vermelho fica no topo até alguém resolver: escolha trecho a trecho a sua versão, a recebida ou as duas, ou edite no editor e marque como resolvido. Depois clique em <b>Concluir merge</b> — ou <b>Abortar</b> para voltar ao estado anterior.</p><p><b>Botão direito</b> numa branch, tag ou commit abre o menu: criar tag (já sugere o próximo número), push de tag e apagar branch ou tag, local ou no remoto.</p><p><b>Stash:</b> <b>Stash</b> no topo (ou no painel do WIP) guarda as alterações e limpa o WIP. Os stashes ficam na lateral: clique num deles para ver os arquivos e as opções (<b>Pop</b>, <b>Aplicar</b>, <b>Branch</b>, <b>Apagar</b>). <b>Pop</b> no topo traz de volta o mais recente. Se der conflito, o stash continua guardado.</p><p><b>Pull / Push / Fetch:</b> usam a autenticação Git já configurada. Nunca há force push.</p><p><kbd>/</kbd> busca · <kbd>↑</kbd><kbd>↓</kbd> navegam · <kbd>esc</kbd> fecha.</p></div></>}
      {error&&<div className="inline-error" role="alert">{error}<button aria-label="Dispensar" onClick={()=>setError('')}><X size={13}/></button></div>}
    </div></div>}
    {error&&!dialog&&<div className="error-toast" role="alert"><CircleAlert size={15}/><span>{error}</span><button aria-label="Dispensar erro" onClick={()=>setError('')}><X size={14}/></button></div>}
    {menu&&<div className="ctx-backdrop" onMouseDown={()=>setMenu(null)} onContextMenu={e=>{e.preventDefault();setMenu(null);}}><div className="ctx-menu" role="menu" style={{left:menu.x,top:menu.y}} onMouseDown={e=>e.stopPropagation()}>
      <div className="ctx-title">{menu.title}</div>
      {menu.items.map((it,i)=>it==='sep'?<div key={i} className="ctx-sep"/>:<button key={i} role="menuitem" className={`ctx-item ${it.danger?'danger':''}`} disabled={it.disabled} title={it.title} onClick={()=>{setMenu(null);it.run();}}>{it.icon}<span>{it.label}</span></button>)}
    </div></div>}
    {toast&&!undo&&<div className="toast" role="status"><Check size={15}/>{toast}</div>}
    {undo&&<div className="toast undo-toast" role="status">{undo.kind==='drop'?<Archive size={15}/>:<Trash2 size={15}/>}{undo.text}<button className="btn ghost sm" disabled={!!busy} onClick={undoDiscard}><Undo2 size={13}/>Desfazer</button><button aria-label="Dispensar" onClick={()=>setUndo(null)}><X size={13}/></button></div>}
  </div>;
}

type Meta={busy:boolean;changes:number;branch:string|null;conflict:boolean};
// Abas no estilo GitKraken: cada repositório aberto é uma aba com estado próprio (seleção, mensagem de
// commit, operação em andamento). Trocar de aba não interrompe o que está rodando nas outras.
export default function App(){
  const [ws,setWs]=useState<Workspace|null>(null);
  const [home,setHome]=useState(false);
  const [meta,setMeta]=useState<Record<string,Meta>>({});
  const [error,setError]=useState('');
  const [toast,setToast]=useState('');
  const [update,setUpdate]=useState<Update|null>(null);
  const [repoPath,setRepoPath]=useState('');
  const [opening,setOpening]=useState(false);
  const showHome=home||!ws?.tabs.length;

  useEffect(()=>{api('workspace').then((w:Workspace)=>{setWs(w);if(w.initialError)setError(w.initialError);}).catch(e=>setError((e as Error).message));},[]);
  useEffect(()=>{const u=window.briar?.update;if(!u)return;u.state().then(setUpdate).catch(()=>{});return u.onChange(setUpdate);},[]);
  useEffect(()=>{if(update?.status==='ready'&&update.error)setError(update.error);},[update?.error]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(t);}},[toast]);
  const onMeta=useCallback((root:string,m:Meta)=>setMeta(x=>({...x,[root]:m})),[]);
  const onHome=useCallback(()=>{setError('');setHome(true);},[]);

  async function openPath(p:string){if(!p.trim()||opening)return;setOpening(true);setError('');try{const r=await api('workspace/open',{path:p.trim()});setWs(r.workspace);setHome(false);setRepoPath('');}catch(e){setError((e as Error).message);}finally{setOpening(false);}}
  function activate(root:string){setHome(false);setError('');if(ws?.active===root)return;setWs(w=>w&&{...w,active:root});api('workspace/activate',{root}).catch(()=>{});}
  async function close(root:string){try{const r=await api('workspace/close',{root});setWs(r.workspace);setMeta(({[root]:_,...rest})=>rest);}catch(e){setError((e as Error).message);}}
  async function forget(root:string){try{const r=await api('workspace/forget',{root});setWs(r.workspace);}catch(e){setError((e as Error).message);}}
  async function pick(){const dir=await window.briar?.pickFolder();if(dir)await openPath(dir);}
  async function checkUpdate(){const u=window.briar?.update;if(!u)return;const r=await u.check().catch(e=>({status:'error',error:String(e?.message||e)}) as Update);if(r.status==='none')setToast(`O Briar já está na versão mais nova (${r.current}).`);else if(r.status==='error')setError(`Não foi possível procurar atualização: ${r.error}`);}

  // Ctrl+T: nova aba · Ctrl+Tab / Ctrl+Shift+Tab: próxima / anterior · Esc na tela inicial volta para a aba.
  useEffect(()=>{function key(e:KeyboardEvent){
    if(!ws)return;
    if(e.ctrlKey&&e.key.toLowerCase()==='t'){e.preventDefault();onHome();return;}
    if(e.ctrlKey&&e.key==='Tab'&&ws.tabs.length){e.preventDefault();const i=showHome?-1:ws.tabs.findIndex(t=>t.root===ws.active);const n=ws.tabs.length;activate(ws.tabs[((e.shiftKey?i-1:i+1)%n+n)%n].root);return;}
    if(e.key==='Escape'&&home&&ws.tabs.length&&!(e.target as HTMLElement).closest('input'))setHome(false);
  }window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});

  const updatePill=update&&(update.status==='downloading'?<span className="update-pill busy" title="A nova versão está sendo baixada em segundo plano."><LoaderCircle size={13} className="spinning"/>Baixando {update.version} · {update.percent||0}%</span>
    :update.status==='ready'?<button className="update-pill ready" onClick={()=>window.briar?.update?.install()} title={update.kind==='deb'?'Instala a nova versão (pede a senha de administrador) e reabre o Briar.':'Fecha, instala a nova versão e reabre o Briar.'}><RotateCw size={13}/>Reiniciar para atualizar · {update.version}</button>
    :update.status==='installing'?<span className="update-pill busy"><LoaderCircle size={13} className="spinning"/>Instalando {update.version}…</span>
    :update.status==='available'?<button className="update-pill ready" onClick={()=>window.briar?.update?.install()} title="Abre a página de download da nova versão."><Download size={13}/>Versão {update.version} disponível</button>
    :null);
  const versionLabel=update&&update.status!=='disabled'&&<button className="status-link" onClick={checkUpdate} disabled={update.status==='checking'||update.status==='downloading'||update.status==='installing'} title={update.status==='error'?`Falha ao procurar atualização: ${update.error}\nClique para tentar de novo.`:'Procurar atualização'}>{update.status==='checking'?<LoaderCircle size={11} className="spinning"/>:update.status==='error'?<TriangleAlert size={11}/>:<Sprout size={11}/>}Briar {update.current}</button>;

  if(!ws)return <div className="shell"><div className="welcome"><div className="welcome-card"><span className="brand"><span className="brand-icon"><Sprout size={18}/></span><span>Briar</span></span>{error?<div className="inline-error" role="alert">{error}</div>:<p className="muted">Conectando ao servidor Git local…</p>}</div></div></div>;

  const recent=ws.recent;
  return <div className="shell">
    <nav className="tabbar" aria-label="Repositórios abertos">
      <span className="tabbar-icon"><Sprout size={14}/></span>
      {ws.tabs.map(t=>{const m=meta[t.root];const on=!showHome&&ws.active===t.root;return <div key={t.root} className={`tab ${on?'on':''}`} title={`${t.root}${m?.branch?`\nbranch ${m.branch}`:''}${m?.changes?`\n${m.changes} ${m.changes===1?'alteração':'alterações'} não commitadas`:''}`}>
        <button className="tab-main" onClick={()=>activate(t.root)} onAuxClick={e=>{if(e.button===1)void close(t.root);}}>
          {m?.busy?<LoaderCircle size={13} className="spinning"/>:m?.conflict?<TriangleAlert size={13} className="tab-warn"/>:<FolderGit2 size={13}/>}
          <span className="tab-name">{t.name}</span>{m?.branch&&<span className="tab-branch">{m.branch}</span>}{!!m?.changes&&<span className="tab-dot" aria-label="alterações não commitadas"/>}
        </button>
        <button className="tab-close" aria-label={`Fechar ${t.name}`} title="Fechar aba (botão do meio do mouse também fecha)" onClick={()=>close(t.root)}><X size={12}/></button>
      </div>;})}
      <button className={`tab-add ${showHome?'on':''}`} onClick={onHome} title="Abrir repositório em nova aba (Ctrl+T)" aria-label="Nova aba"><Plus size={15}/></button>
    </nav>
    {ws.tabs.map(t=><Repo key={t.root} root={t.root} active={!showHome&&ws.active===t.root} updatePill={updatePill} versionLabel={versionLabel} onHome={onHome} onClose={()=>close(t.root)} onMeta={onMeta}/>)}
    {showHome&&<div className="welcome home"><div className="welcome-card home-card">
      <span className="brand"><span className="brand-icon"><Sprout size={18}/></span><span>Briar</span></span>
      <h1>Abrir repositório</h1>
      {recent.length>0&&<><div className="recent-title">Repositórios salvos</div><div className="recent">{recent.map(r=><div key={r.root} className="recent-row">
        <button className="recent-main" disabled={opening} onClick={()=>r.open?activate(r.root):openPath(r.root)} title={r.open?'Ir para a aba':'Abrir numa nova aba'}><FolderGit2 size={15}/><span className="recent-text"><b>{r.name}</b><span>{r.root}</span></span>{r.open&&<span className="recent-open">aberto</span>}</button>
        {!r.open&&<button className="recent-forget" title="Tirar da lista (não apaga nada do disco)" aria-label={`Tirar ${r.name} da lista`} onClick={()=>forget(r.root)}><X size={13}/></button>}
      </div>)}</div></>}
      <form className="connect-form" onSubmit={e=>{e.preventDefault();void openPath(repoPath);}}><label htmlFor="repo-path">{recent.length?'Outro clone neste computador':'Caminho do clone neste computador'}</label><input id="repo-path" autoFocus value={repoPath} onChange={e=>setRepoPath(e.target.value)} placeholder="~/Projetos/projeto-pindorama" autoComplete="off" spellCheck={false}/><p>O aplicativo usa o Git instalado na sua máquina. Cada repositório abre numa aba e fica salvo nesta lista.</p><div className="connect-actions">{window.briar?.desktop&&<button type="button" className="btn ghost" disabled={opening} onClick={pick}><FolderGit2 size={15}/>Escolher pasta…</button>}<button disabled={opening||!repoPath.trim()} className="btn primary" type="submit"><FolderGit2 size={15}/>{opening?'Abrindo…':'Abrir repositório'}</button></div></form>
      {error&&<div className="inline-error" role="alert">{error}<button aria-label="Dispensar" onClick={()=>setError('')}><X size={13}/></button></div>}
      <p className="welcome-note"><LockKeyhole size={13}/>Servidor local em 127.0.0.1. Nada é enviado para hospedagem.{ws.tabs.length>0&&<> · <kbd>Esc</kbd> volta para a aba</>}</p>
      {updatePill&&<div className="welcome-update">{updatePill}</div>}
    </div></div>}
    {!showHome&&error&&<div className="error-toast" role="alert"><CircleAlert size={15}/><span>{error}</span><button aria-label="Dispensar erro" onClick={()=>setError('')}><X size={14}/></button></div>}
    {toast&&<div className="toast" role="status"><Check size={15}/>{toast}</div>}
  </div>;
}
