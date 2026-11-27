// Sayfa ile program arasındaki dar köprü (window.terra). Başka hiçbir bilgisayar yetkisi sayfaya verilmez.
const { contextBridge, ipcRenderer } = require('electron');
const call = (name) => (...args) => ipcRenderer.invoke(`terra:${name}`, ...args);

contextBridge.exposeInMainWorld('terra', {
  info: call('info'),
  pick: call('pick'),
  forget: call('forget'),
  autoFolder: call('autoFolder'),
  backupCodeGet: call('backupCodeGet'),
  backupCodeSet: call('backupCodeSet'),
  pickRestore: call('pickRestore'),
  write: call('write'),
  read: call('read'),
  list: call('list'),
  remove: call('remove'),
  showData: call('showData'),
  syncPick: call('syncPick'),
  syncInfo: call('syncInfo'),
  syncForget: call('syncForget'),
  syncList: call('syncList'),
  syncRead: call('syncRead'),
  syncWrite: call('syncWrite'),
  syncRemove: call('syncRemove'),
  syncKeyGet: call('syncKeyGet'),
  syncKeySet: call('syncKeySet'),
  license: call('license'),
  saveLicense: call('saveLicense'),
  server: call('server'),
  relay: call('relay'),
  buy: call('buy'),
  pdf: call('pdf'),
  update: call('update'),
  openUpdate: call('openUpdate'),
  /** Program kapanırken: iş bitince kapanmaya izin verilir */
  onClosing: (fn) => {
    const on = () => {
      Promise.resolve()
        .then(fn)
        .catch(() => undefined)
        .finally(() => ipcRenderer.send('terra:closed'));
    };
    ipcRenderer.on('terra:closing', on);
    return () => ipcRenderer.removeListener('terra:closing', on);
  },
});
