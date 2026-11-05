// Atualização do Briar pelas GitHub Releases de JoaoManieri/projeto-briar.
// - Instalador do Windows, AppImage e .deb: baixa sozinho em segundo plano e oferece "Reiniciar para atualizar"
//   (o .deb pede a senha de administrador na hora de instalar).
// - Executável portátil do Windows e outros casos: só avisa que há versão nova e abre a página de download.
import {app,ipcMain,net,shell} from 'electron';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import updater from 'electron-updater';

const {autoUpdater}=updater;
const REPO='JoaoManieri/projeto-briar';
const RELEASE_PAGE=`https://github.com/${REPO}/releases/latest`;
const EVERY=4*60*60*1000;

function installKind(){
  if(!app.isPackaged)return 'dev';
  if(process.platform==='win32')return process.env.PORTABLE_EXECUTABLE_FILE?'portable':'nsis';
  if(process.platform==='linux'){
    if(process.env.APPIMAGE)return 'appimage';
    try{if(readFileSync(path.join(process.resourcesPath,'package-type'),'utf8').trim()==='deb')return 'deb';}catch{}
  }
  return 'manual';
}

// Compara "1.2.3" com "1.10.0"; ignora o "v" e sufixos como "-beta".
export function newer(a,b){
  const parts=v=>String(v).replace(/^v/,'').split('-')[0].split('.').map(n=>parseInt(n,10)||0);
  const x=parts(a),y=parts(b);
  for(let i=0;i<Math.max(x.length,y.length);i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0);}
  return false;
}

export function setupUpdates(getWindow){
  const kind=installKind();
  const auto=['nsis','appimage','deb'].includes(kind);
  let state={current:app.getVersion(),kind,auto,status:kind==='dev'?'disabled':'idle'};
  let busy=false;
  const set=patch=>{state={...state,...patch};getWindow()?.webContents.send('briar:update',state);};
  const fail=e=>set({status:'error',error:String(e?.message||e).split('\n')[0]});

  if(auto){
    autoUpdater.autoDownload=true;
    // O .deb pede senha; instalar só quando a pessoa clicar, nunca de surpresa ao fechar o app.
    autoUpdater.autoInstallOnAppQuit=kind!=='deb';
    autoUpdater.logger={info:()=>{},warn:m=>console.warn('[atualização]',m),error:m=>console.error('[atualização]',m)};
    autoUpdater.on('checking-for-update',()=>set({status:'checking',error:undefined}));
    autoUpdater.on('update-not-available',()=>set({status:'none',checkedAt:Date.now()}));
    autoUpdater.on('update-available',info=>set({status:'downloading',version:info.version,percent:0,checkedAt:Date.now()}));
    autoUpdater.on('download-progress',p=>set({status:'downloading',percent:Math.round(p.percent)}));
    autoUpdater.on('update-downloaded',info=>set({status:'ready',version:info.version,percent:100}));
    autoUpdater.on('error',e=>state.status==='installing'?set({status:'ready',error:'A instalação foi cancelada ou falhou. Tente de novo.'}):fail(e));
  }

  async function check(){
    if(kind==='dev'||busy||state.status==='downloading'||state.status==='ready')return state;
    busy=true;
    try{
      if(auto){await autoUpdater.checkForUpdates();}
      else{
        set({status:'checking',error:undefined});
        const res=await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`,{headers:{Accept:'application/vnd.github+json'}});
        if(!res.ok)throw new Error(`GitHub respondeu ${res.status}`);
        const latest=String((await res.json()).tag_name||'').replace(/^v/,'');
        set(newer(latest,state.current)?{status:'available',version:latest,checkedAt:Date.now()}:{status:'none',checkedAt:Date.now()});
      }
    }catch(e){fail(e);}
    finally{busy=false;}
    return state;
  }

  ipcMain.handle('briar:update-state',()=>state);
  ipcMain.handle('briar:update-check',()=>check());
  ipcMain.handle('briar:update-install',()=>{
    if(state.status==='ready'){set({status:'installing'});setImmediate(()=>autoUpdater.quitAndInstall(false,true));}
    else shell.openExternal(RELEASE_PAGE);
  });

  if(kind!=='dev'){
    setTimeout(check,5000);
    setInterval(check,EVERY).unref?.();
  }
}
