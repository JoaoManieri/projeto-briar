const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('briar',{
  desktop:true,
  pickFolder:()=>ipcRenderer.invoke('briar:pick-folder'),
});
