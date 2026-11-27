// Kollege Windows programı (Electron ana süreci). Kayıtlar %APPDATA%\Kollege içinde, programın kendisi Program Files'tadır.
// Güvenlik: sayfa Node'a erişemez (sandbox + contextIsolation); yalnız preload.cjs'teki dar köprü vardır ve yalnız programın kendi sayfası kullanabilir.
import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, safeStorage, screen, session, shell } from 'electron';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computerNumber, factors, hasIdentity, readHardware } from './computer.mjs';
import { CSP, Folder, ORIGIN, SyncFolder, cloudDrive, deviceNumber, freeBackupFolder, isExternal, isOwn, isOwnBlob, oldDataDir, oldDeviceNumber, parseUpdate, readJson, resolveAsset, sameDrive, writeJson } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')); // eşzamanlı: 'ready' olayından önce bitmeli
const WEB = join(HERE, 'web');
const DEV = !app.isPackaged;
const MAC = process.platform === 'darwin';
/** Pencere metinleri: Türkçe, Almanca, diğer bilgisayarlarda İngilizce (arayüzün dili src/i18n/lang.ts) */
// Pencere metinleri bilgisayarın dilinde; tabloda yoksa İngilizce
const TX = {
  'Cut': { fr: 'Couper', es: 'Cortar', nl: 'Knippen', pl: 'Wytnij', ar: 'قص' },
  'Copy': { fr: 'Copier', es: 'Copiar', nl: 'Kopiëren', pl: 'Kopiuj', ar: 'نسخ' },
  'Paste': { fr: 'Coller', es: 'Pegar', nl: 'Plakken', pl: 'Wklej', ar: 'لصق' },
  'Select all': { fr: 'Tout sélectionner', es: 'Seleccionar todo', nl: 'Alles selecteren', pl: 'Zaznacz wszystko', ar: 'تحديد الكل' },
  'The window closed unexpectedly. Your records are on this computer.': { fr: 'La fenêtre s’est fermée de façon inattendue. Vos données sont sur cet ordinateur.', es: 'La ventana se cerró inesperadamente. Sus registros están en este ordenador.', nl: 'Het venster is onverwacht gesloten. Uw gegevens staan op deze computer.', pl: 'Okno zamknęło się nieoczekiwanie. Wpisy są na tym komputerze.', ar: 'أُغلقت النافذة بشكل غير متوقع. سجلاتك على هذا الحاسوب.' },
  'Reopen': { fr: 'Rouvrir', es: 'Reabrir', nl: 'Opnieuw openen', pl: 'Otwórz ponownie', ar: 'إعادة الفتح' },
  'Rescue': { fr: 'Secours', es: 'Rescate', nl: 'Redding', pl: 'Ratunek', ar: 'الإنقاذ' },
  'Backup folder (OneDrive, USB or another disk)': { fr: 'Dossier de sauvegarde (OneDrive, USB ou autre disque)', es: 'Carpeta de copias (OneDrive, USB u otro disco)', nl: 'Back-upmap (OneDrive, USB of andere schijf)', pl: 'Folder kopii (OneDrive, USB lub inny dysk)', ar: 'مجلد النسخ الاحتياطي (OneDrive أو USB أو قرص آخر)' },
  'Folder with the backup': { fr: 'Dossier contenant la sauvegarde', es: 'Carpeta con la copia', nl: 'Map met de back-up', pl: 'Folder z kopią', ar: 'المجلد الذي فيه النسخة' },
};
const tx = (tr, de, en) => { const l = app.getLocale().toLowerCase().split('-')[0]; return l === 'tr' ? tr : l === 'de' ? de : (TX[en]?.[l] ?? en); };

// Veri klasörü sabittir (program güncellense/yeniden kurulsa da aynı kalır). Deneme için yalnız paketlenmemiş sürümde değiştirilebilir.
app.setPath('userData', (DEV && process.env.KL_VERI) || join(app.getPath('appData'), 'Kollege'));
app.setName('Kollege');
app.setAppUserModelId('app.kollege.masaustu');
const DATA = app.getPath('userData');
const SETTINGS = join(DATA, 'ayar.json');
const LICENSE = join(DATA, 'lisans.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'kollege', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let win = null;
let closing = false;
const settings = { folder: null, backupOff: false, syncFolder: null, window: null };

async function start() {
  Object.assign(settings, await readJson(SETTINGS, {}));
  await app.whenReady();
  // macOS'ta menü yoksa Kopyala/Yapıştır ve Çıkış kısayolları çalışmaz
  Menu.setApplicationMenu(MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  protocol.handle('kollege', async (req) => {
    const a = await resolveAsset(WEB, req.url);
    if (!a) return new Response('Yok', { status: 404 });
    return new Response(await readFile(a.file), {
      headers: { 'content-type': a.type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-cache' },
    });
  });
  // Kamera, konum, bildirim vb. istenmez; yalnız panoya yazma ve kalıcı depolama
  const allowed = new Set(['clipboard-sanitized-write', 'persistent-storage']);
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(allowed.has(p) && isOwn(wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, p, origin) => allowed.has(p) && origin.startsWith(ORIGIN));
  session.defaultSession.on('will-download', (_e, item) => item.setSaveDialogOptions({ defaultPath: join(app.getPath('documents'), item.getFilename()) }));
  open();
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.on('window-all-closed', () => app.quit());

// Bütün pencereler (yazdırma pencereleri dahil): dışarı gezinme yok, yabancı bağlantı tarayıcıda açılır
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (e, url) => {
    if (isOwn(url) || isOwnBlob(url)) return;
    e.preventDefault();
    if (isExternal(url)) void shell.openExternal(url);
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (isOwn(url) || isOwnBlob(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1000, height: 820, autoHideMenuBar: true, icon: join(HERE, 'icon.ico'), webPreferences: prefs() } };
    if (isExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('context-menu', (_ev, p) => {
    const items = [];
    if (p.isEditable) items.push({ label: tx('Kes', 'Ausschneiden', 'Cut'), role: 'cut', enabled: p.editFlags.canCut }, { label: tx('Kopyala', 'Kopieren', 'Copy'), role: 'copy', enabled: p.editFlags.canCopy }, { label: tx('Yapıştır', 'Einfügen', 'Paste'), role: 'paste', enabled: p.editFlags.canPaste }, { label: tx('Tümünü seç', 'Alles auswählen', 'Select all'), role: 'selectAll' });
    else if (p.selectionText) items.push({ label: tx('Kopyala', 'Kopieren', 'Copy'), role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown' || !(MAC ? i.meta : i.control)) return;
    const z = wc.getZoomLevel();
    if (i.key === '+' || i.key === '=') wc.setZoomLevel(Math.min(z + 0.5, 4));
    else if (i.key === '-') wc.setZoomLevel(Math.max(z - 0.5, -3));
    else if (i.key === '0') wc.setZoomLevel(0);
    else return;
    e.preventDefault();
  });
});

const prefs = () => ({ preload: join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, spellcheck: false, devTools: DEV });

function open() {
  const w = settings.window;
  const visible = w && screen.getAllDisplays().some((d) => w.x < d.bounds.x + d.bounds.width - 100 && w.x + w.width > d.bounds.x + 100 && w.y >= d.bounds.y - 10 && w.y < d.bounds.y + d.bounds.height - 100);
  win = new BrowserWindow({
    ...(visible ? { x: w.x, y: w.y, width: w.width, height: w.height } : { width: 1400, height: 900, center: true }),
    minWidth: 940, minHeight: 620, show: false, title: 'Kollege', icon: join(HERE, 'icon.ico'), backgroundColor: '#141517', autoHideMenuBar: true, webPreferences: prefs(),
  });
  if (w?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    const c = dialog.showMessageBoxSync(win, { type: 'error', title: 'Kollege', message: tx('Ekran beklenmedik şekilde kapandı. Kayıtlarınız bu bilgisayarda duruyor.', 'Das Fenster wurde unerwartet geschlossen. Ihre Daten liegen auf diesem Computer.', 'The window closed unexpectedly. Your records are on this computer.'), buttons: [tx('Yeniden aç', 'Erneut öffnen', 'Reopen'), tx('Kurtarma', 'Rettung', 'Rescue')], cancelId: 0 });
    void win.loadURL(`${ORIGIN}${c === 1 ? '/kurtar.html' : '/'}`);
  });
  // Kapanırken son yedek alınır (en çok 10 sn beklenir)
  win.on('close', (e) => {
    const b = win.getNormalBounds();
    settings.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
    void writeJson(SETTINGS, settings).catch(() => undefined);
    if (closing) return;
    e.preventDefault();
    closing = true;
    const finish = () => win?.destroy();
    const timer = setTimeout(finish, 10_000);
    ipcMain.once('terra:closed', () => {
      clearTimeout(timer);
      finish();
    });
    win.webContents.send('terra:closing');
  });
  win.on('closed', () => {
    win = null;
    app.quit();
  });
  void win.loadURL(`${ORIGIN}/`);
}

// ---------------------------------------------------------------------------------------------
// Köprü
// ---------------------------------------------------------------------------------------------
/** Yedek yerleri: 'ic' = veri klasöründe (kendiliğinden), 'dis' = kullanıcının seçtiği klasör, 'geri' = geri yüklenecek klasör */
const inner = new Folder(join(DATA, 'Yedek'));
let restoreFolder = null;
function folder(slot) {
  const f = slot === 'ic' ? inner : slot === 'dis' ? (settings.folder ? new Folder(settings.folder) : null) : slot === 'geri' ? restoreFolder : null;
  if (!f) throw new Error('folder_missing');
  return f;
}
const handle = (name, fn) =>
  ipcMain.handle(name, (e, ...args) => {
    if (!e.senderFrame || !isOwn(e.senderFrame.url) || e.senderFrame !== e.sender.mainFrame) throw new Error('forbidden');
    return fn(e, ...args);
  });

const pickFolder = async (e, title) => {
  if (DEV && process.env.KL_TEST_KLASOR) return process.env.KL_TEST_KLASOR; // yalnız paketlenmemiş deneme
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title, properties: ['openDirectory', 'createDirectory'], defaultPath: settings.folder ?? process.env.OneDrive ?? app.getPath('documents') });
  return r.canceled ? null : r.filePaths[0];
};
let guid = null;
const machineGuid = () =>
  MAC
    ? readHardware(execFile).then((h) => h.uuid ?? null)
    : new Promise((res) =>
      execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true, timeout: 5_000 }, (_err, out) => res(/MachineGuid\s+REG_SZ\s+([0-9a-f-]{20,})/i.exec(out ?? '')?.[1] ?? null)),
    );
/** Donanım özetleri; o an okunamazsa aynı Windows kurulumunda en son okunan kullanılır */
const HARDWARE = join(DATA, 'donanim.json');
let known = null;
async function device() {
  if (known) return known;
  guid = await machineGuid();
  if (!guid) {
    // Okunamazsa bu kuruluma özgü kalıcı bir numara
    const f = join(DATA, 'bilgisayar.json');
    const s = await readJson(f, null);
    guid = s?.id ?? randomUUID();
    if (!s?.id) await writeJson(f, { id: guid });
  }
  const mark = createHash('sha256').update(`kurulum|${guid}`).digest('base64url');
  const last = await readJson(HARDWARE, null);
  const use = (f) => (known = { device: computerNumber(f), oldDevices: [deviceNumber(guid), oldDeviceNumber(guid)], f });
  const read = async () => {
    let f = await factors(await readHardware(execFile), guid).catch(() => ({}));
    if (!f.u && last?.mark === mark && last.f?.u) f = last.f;
    if (!hasIdentity(f)) f = await factors({}, guid);
    if (last?.mark !== mark || JSON.stringify(last?.f) !== JSON.stringify(f)) await writeJson(HARDWARE, { mark, f }).catch(() => undefined);
    return use(f);
  };
  // Donanımı okumak birkaç saniye sürer: aynı kurulumda önceki okuma hemen kullanılır, yenisi arkada yapılır
  if (last?.mark === mark && last.f?.u) {
    void read().catch(() => undefined);
    return use(last.f);
  }
  return read();
}
// Aynı anda birden çok istekte tek okuma
let reading = null;
const identity = () => (reading ??= device().catch((e) => {
  reading = null;
  throw e;
}));

handle('terra:info', async () => ({ version: PKG.version, dataDir: DATA, backupDir: settings.folder, licenseSite: serverBase(), ...(await identity()) }));
handle('terra:pick', async (e) => {
  const p = await pickFolder(e, tx('Yedek klasörü (OneDrive, USB ya da başka bir disk)', 'Sicherungsordner (OneDrive, USB oder andere Festplatte)', 'Backup folder (OneDrive, USB or another disk)'));
  if (!p) return null;
  settings.folder = p;
  settings.backupOff = false;
  await writeJson(SETTINGS, settings);
  return { path: p, sameDrive: sameDrive(p, DATA) };
});
// Otomatik yedek sorulmadan açılır: varsa OneDrive, yoksa Belgeler. Kullanıcı kapattıysa yeniden açılmaz.
handle('terra:autoFolder', async (_e, firm) => {
  if (!/^[0-9a-f-]{36}$/.test(String(firm))) throw new Error('bad_request');
  if (settings.backupOff) return null;
  // Paketlenmemiş denemede gerçek OneDrive'a ve Belgeler'e dokunulmaz
  const test = DEV ? process.env.KL_TEST_KLASOR : null;
  const drive = test || (await cloudDrive(process.platform, process.env, app.getPath('home')));
  const p = await freeBackupFolder(settings.folder, drive || app.getPath('documents'), String(firm));
  if (!p) return null;
  settings.folder = p;
  await writeJson(SETTINGS, settings);
  // Seçili klasör OneDrive içinde de olabilir
  const cloud = !!drive && p.toLowerCase().startsWith(drive.toLowerCase());
  return { path: p, cloud, sameDrive: !cloud && sameDrive(p, DATA) };
});
handle('terra:forget', async () => {
  settings.folder = null;
  settings.backupOff = true;
  await writeJson(SETTINGS, settings);
});
handle('terra:pickRestore', async (e) => {
  const p = await pickFolder(e, tx('Yedeğin bulunduğu klasör', 'Ordner mit der Sicherung', 'Folder with the backup'));
  restoreFolder = p ? new Folder(p) : null;
  return p ? { path: p, files: await restoreFolder.list() } : null;
});
handle('terra:write', async (_e, slot, name, text) => {
  if (slot === 'geri' || typeof text !== 'string') throw new Error('bad_request');
  if (slot === 'ic') await mkdir(inner.root, { recursive: true });
  await folder(slot).write(name, text);
});
handle('terra:read', (_e, slot, name) => folder(slot).read(name));
handle('terra:list', (_e, slot, sub) => folder(slot).list(sub ?? ''));
handle('terra:remove', (_e, slot, name) => {
  if (slot === 'geri') throw new Error('bad_request');
  return folder(slot).remove(name);
});
// Ortak klasör (ikinci bilgisayar): seçilen klasörde yalnız `Kollege-Esitleme/…` yolları okunur/yazılır
const syncDir = () => {
  if (!settings.syncFolder) throw new Error('folder_missing');
  return new SyncFolder(settings.syncFolder);
};
handle('terra:syncPick', async (e) => {
  const p = await pickFolder(e, tx('Ortak klasör (OneDrive ya da ağ klasörü)', 'Gemeinsamer Ordner (OneDrive oder Netzwerkordner)', 'Shared folder (OneDrive or network folder)'));
  if (!p) return null;
  settings.syncFolder = p;
  await writeJson(SETTINGS, settings);
  return { name: basename(p) };
});
handle('terra:syncInfo', async () => (settings.syncFolder && (await new SyncFolder(settings.syncFolder).exists()) ? { name: basename(settings.syncFolder) } : null));
handle('terra:syncForget', async () => {
  settings.syncFolder = null;
  await writeJson(SETTINGS, settings);
});
handle('terra:syncList', (_e, dir) => syncDir().list(dir));
handle('terra:syncRead', (_e, p) => syncDir().read(p));
handle('terra:syncWrite', (_e, p, text, overwrite) => {
  if (typeof text !== 'string' || text.length > 20_000_000) throw new Error('bad_request');
  return syncDir().write(p, text, overwrite === true);
});
handle('terra:syncRemove', (_e, p) => syncDir().remove(p));
// Eşitleme anahtarı: Windows hesabına (macOS'ta Keychain'e) bağlı saklanır; klasörde durmaz
const SYNC_KEYS = join(DATA, 'esitleme-anahtar.json');
handle('terra:syncKeyGet', async (_e, firm) => {
  if (!/^[0-9a-f-]{36}$/.test(String(firm))) throw new Error('bad_request');
  const v = (await readJson(SYNC_KEYS, {}))[firm];
  if (!v) return null;
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString('utf8');
});
handle('terra:syncKeySet', async (_e, firm, key) => {
  if (!/^[0-9a-f-]{36}$/.test(String(firm)) || typeof key !== 'string' || key.length > 200) throw new Error('bad_request');
  const all = await readJson(SYNC_KEYS, {});
  all[firm] = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8')).toString('base64');
  await writeJson(SYNC_KEYS, all);
});
// Programın kendi ürettiği yedek kodu: kullanıcı yazdırabilsin diye Windows hesabına bağlı (safeStorage) saklanır
const BACKUP_CODES = join(DATA, 'yedek-kodu.json');
handle('terra:backupCodeGet', async (_e, firm) => {
  if (!/^[0-9a-f-]{36}$/.test(String(firm))) throw new Error('bad_request');
  const v = (await readJson(BACKUP_CODES, {}))[firm];
  if (!v) return null;
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString('utf8');
});
handle('terra:backupCodeSet', async (_e, firm, code) => {
  if (!/^[0-9a-f-]{36}$/.test(String(firm)) || typeof code !== 'string' || code.length > 100) throw new Error('bad_request');
  const all = await readJson(BACKUP_CODES, {});
  all[firm] = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(code) : Buffer.from(code, 'utf8')).toString('base64');
  await writeJson(BACKUP_CODES, all);
});
handle('terra:showData', () => shell.openPath(DATA));
// Ad değişmeden önce etkinleştirilmiş lisans (yalnız kurulu programda)
handle('terra:license', async () => readJson(LICENSE, DEV ? null : await readJson(join(oldDataDir(app.getPath('appData')), 'lisans.json'), null)));
handle('terra:saveLicense', async (_e, v) => {
  if (!v || typeof v !== 'object') throw new Error('bad_request');
  const out = { code: String(v.code ?? '').slice(0, 2_000), firstRun: String(v.firstRun ?? '').slice(0, 40) };
  for (const k of ['movedAt', 'started', 'grace', 'seen', 'why', 'skew']) if (v[k]) out[k] = String(v[k]).slice(0, 40);
  for (const k of ['trial', 'key', 'doc', 'asked']) if (v[k]) out[k] = String(v[k]).slice(0, 2_000);
  await writeJson(LICENSE, out);
});
// Lisans sunucusu: yalnız bu dört uç, yalnız https (denemede yerel adres). Donanım özeti burada eklenir; firma verisi gönderilmez.
const SERVER_PATHS = new Set(['deneme', 'etkinlestir', 'yenile', 'cikar']);
const serverBase = () => (DEV && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KL_LISANS_ADRESI ?? '') ? process.env.KL_LISANS_ADRESI : /^https:\/\/[a-z0-9.-]+$/.test(PKG.kollegeLicense ?? '') ? PKG.kollegeLicense : null);
handle('terra:server', async (_e, path, body) => {
  const base = serverBase();
  if (!base || !SERVER_PATHS.has(path) || !body || typeof body !== 'object') return null;
  const { f } = await identity();
  const send = { f, ...(body.key ? { key: String(body.key).slice(0, 40) } : {}), ...(body.ad ? { ad: String(body.ad).slice(0, 40) } : {}), ...(body.id ? { id: Number(body.id) } : {}) };
  try {
    const r = await net.fetch(`${base}/v1/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(send), redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10_000) });
    return { status: r.status, body: await r.json() };
  } catch {
    return null;
  }
});
// İkinci bilgisayar aracısı: yalnız bu uçlar, yalnız lisans sunucusuna; gövde şifreli dosyadır
const RELAY_CMDS = new Set(['durum', 'liste', 'oku', 'yaz', 'sil', 'katilim-koy', 'katilim-al', 'katilim-sil']);
handle('terra:relay', async (_e, cmd, body) => {
  const base = serverBase();
  if (!base || !RELAY_CMDS.has(cmd) || !body || typeof body !== 'object') return null;
  try {
    const r = await net.fetch(`${base}/v1/oda/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(45_000) });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return null;
  }
});
handle('terra:buy', () => {
  if (/^https:\/\//.test(PKG.kollegeBuy ?? '')) return shell.openExternal(PKG.kollegeBuy);
});
handle('terra:pdf', async (e, name) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(w, { defaultPath: join(app.getPath('documents'), `${String(name ?? 'belge').replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return false;
  await writeFile(r.filePath, await e.sender.printToPDF({ printBackground: true, preferCSSPageSize: true }));
  return true;
});
handle('terra:update', async () => {
  const feed = PKG.kollegeUpdate;
  if (!feed) return null;
  try {
    const r = await net.fetch(feed, { redirect: 'error', cache: 'no-store', credentials: 'omit' });
    return r.ok ? parseUpdate(await r.json(), feed, PKG.version) : null;
  } catch {
    return null;
  }
});
handle('terra:openUpdate', (_e, url) => {
  const feed = PKG.kollegeUpdate;
  if (feed && isExternal(url) && new URL(url).host === new URL(feed).host) return shell.openExternal(url);
});

// Tek pencere: ikinci kez açılırsa var olan öne gelir
if (!app.requestSingleInstanceLock()) app.quit();
else void start();
