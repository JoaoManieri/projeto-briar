const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('briar',{
  desktop:true,
  pickFolder:()=>ipcRenderer.invoke('briar:pick-folder'),
  update:{
    state:()=>ipcRenderer.invoke('briar:update-state'),
    check:()=>ipcRenderer.invoke('briar:update-check'),
    install:()=>ipcRenderer.invoke('briar:update-install'),
    onChange:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('briar:update',listener);return()=>ipcRenderer.removeListener('briar:update',listener);},
  },
});
