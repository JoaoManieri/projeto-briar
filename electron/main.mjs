// Briar como aplicativo de desktop: sobe o servidor Git local (server/index.mjs) numa porta livre
// de 127.0.0.1 e abre a interface numa janela do Electron.
import {app,BrowserWindow,dialog,ipcMain,safeStorage,shell} from 'electron';
import net from 'node:net';
import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/index.mjs';
import {setupUpdates} from './updater.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const screenshot=process.env.BRIAR_SCREENSHOT;

function freePort(preferred){
  return new Promise(resolve=>{
    const probe=net.createServer();
    probe.once('error',()=>{const any=net.createServer();any.listen(0,'127.0.0.1',()=>{const {port}=any.address();any.close(()=>resolve(port));});});
    probe.listen(preferred,'127.0.0.1',()=>probe.close(()=>resolve(preferred)));
  });
}

// Cofre do sistema (Keychain, DPAPI, libsecret/KWallet) para o token do GitHub. No Linux sem chaveiro o
// Electron cai num modo que só embaralha o texto: aí o token não é salvo e vale só até fechar o Briar.
const secrets={
  available:()=>safeStorage.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text',
  encrypt:text=>safeStorage.encryptString(text).toString('base64'),
  decrypt:data=>safeStorage.decryptString(Buffer.from(data,'base64')),
};

let win=null;
async function start(){
  const port=await freePort(4317);
  const {server}=await createApp({
    port,
    repoPath:process.env.BRIAR_REPO||undefined,
    configPath:path.join(app.getPath('userData'),'settings.json'),
    distPath:path.join(root,'dist'),
    secrets,
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  app.on('before-quit',()=>server.close());

  win=new BrowserWindow({
    width:1440,height:880,minWidth:1024,minHeight:640,
    backgroundColor:'#1a1e24',title:'Briar',
    icon:path.join(root,'build','icon.png'),
    autoHideMenuBar:true,show:!screenshot,
    webPreferences:{preload:path.join(root,'electron','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true},
  });
  win.setMenuBarVisibility(false);
  const home=`http://127.0.0.1:${port}/`;
  // Links externos vão para o navegador; a janela só navega dentro do Briar.
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url)&&!url.startsWith(home))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith(home))e.preventDefault();});
  if(!screenshot)setupUpdates(()=>win);
  await win.loadURL(home);
  if(screenshot)await devScreenshot();
}

// Só para desenvolvimento: BRIAR_SCREENSHOT=saida.png [BRIAR_EVAL=js] electron .
async function devScreenshot(){
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await wait(1800);
  if(process.env.BRIAR_EVAL){await win.webContents.executeJavaScript(process.env.BRIAR_EVAL).catch(e=>console.error('EVAL',e));await wait(1800);}
  writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
  app.quit();
}

ipcMain.handle('briar:pick-folder',async(_event,options)=>{
  const title=typeof options?.title==='string'?options.title.slice(0,200):'Escolher o clone Git';
  const defaultPath=typeof options?.defaultPath==='string'?options.defaultPath:undefined;
  const r=await dialog.showOpenDialog(win,{title,defaultPath,properties:['openDirectory','createDirectory']});
  return r.canceled?null:r.filePaths[0]||null;
});

if(!screenshot&&!app.requestSingleInstanceLock()){
  app.quit();
}else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(start).catch(e=>{dialog.showErrorBox('Briar não pôde iniciar',String(e?.message||e));app.quit();});
  app.on('window-all-closed',()=>app.quit());
}
