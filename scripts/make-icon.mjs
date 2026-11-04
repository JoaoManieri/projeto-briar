// Gera build/icon.png (512x512) a partir de public/favicon.svg. Uso: npx electron scripts/make-icon.mjs
import {app,BrowserWindow} from 'electron';
import {readFileSync,writeFileSync} from 'node:fs';
const svg=readFileSync(new URL('../public/favicon.svg',import.meta.url),'utf8');
app.whenReady().then(async()=>{
  const w=new BrowserWindow({width:512,height:512,show:false,transparent:true,frame:false,useContentSize:true,webPreferences:{offscreen:true}});
  await w.loadURL('data:text/html,'+encodeURIComponent(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="512" height="512"></body></html>`));
  await new Promise(r=>setTimeout(r,500));
  const img=await w.webContents.capturePage({x:0,y:0,width:512,height:512});
  writeFileSync(new URL('../build/icon.png',import.meta.url),img.resize({width:512,height:512}).toPNG());
  app.quit();
});
