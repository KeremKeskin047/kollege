// Windows programının Electron'dan bağımsız parçaları (testlenebilir): yol denetimi, sunulan dosyalar, yedek klasörleri, bilgisayar numarası.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

export const ORIGIN = 'kollege://app';

/** Programın kendi sayfası mı? (yalnız bu adres köprüyü kullanabilir) */
export function isOwn(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'kollege:' && u.host === 'app';
  } catch {
    return false;
  }
}
/** Programın açtığı geçici belge (PDF/resim önizlemesi) */
export const isOwnBlob = (url) => url.startsWith(`blob:${ORIGIN}/`);

/** Dışarıda (varsayılan tarayıcı/e-posta) açılabilecek bağlantı */
export function isExternal(url) {
  try {
    return ['https:', 'mailto:', 'tel:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.icc': 'application/octet-stream',
};
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; font-src 'self' data:; connect-src 'self' https://nominatim.openstreetmap.org https://api.open-meteo.com; worker-src 'self' blob:; object-src 'self' blob:; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/** Adres → program klasöründeki dosya. Klasör dışına çıkılamaz; sayfa adresleri index.html'e düşer. null: yok. */
export async function resolveAsset(root, url) {
  if (!isOwn(url)) return null;
  let path;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  const base = resolve(root);
  let file = normalize(join(base, path));
  if (file !== base && !file.startsWith(base + sep)) return null;
  if (path === '/kurtar') file = join(base, 'kurtar.html');
  else if (path === '/' || !extname(path)) file = join(base, 'index.html');
  try {
    if (!(await stat(file)).isFile()) return null;
  } catch {
    return null;
  }
  return { file, type: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' };
}

/** Yedek klasöründe program yalnız kendi adlandırdığı dosyalara dokunur */
// Eski adla yazılmış yedekler de okunur
const NAME = /^(belge\/)?(kollege|terrabuild)-[a-z0-9.-]{1,120}\.json$/i;
export const isBackupName = (n) => typeof n === 'string' && NAME.test(n) && !n.includes('..');

export class Folder {
  constructor(root) {
    this.root = root;
  }
  path(name) {
    if (!isBackupName(name)) throw new Error('bad_name');
    return join(this.root, ...name.split('/'));
  }
  async exists() {
    try {
      return (await stat(this.root)).isDirectory();
    } catch {
      return false;
    }
  }
  /** Önce geçici dosyaya yazılır ve diske zorlanır; yarım dosya asla yedeğin yerine geçmez */
  async write(name, text) {
    const p = this.path(name);
    if (!(await this.exists())) throw Object.assign(new Error('folder_missing'), { code: 'ENOENT' });
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    const h = await open(tmp, 'w');
    try {
      await h.writeFile(text, 'utf8');
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(tmp, p);
  }
  async read(name) {
    return readFile(this.path(name), 'utf8');
  }
  async list(sub = '') {
    if (sub !== '' && sub !== 'belge') throw new Error('bad_name');
    let names;
    try {
      names = await readdir(sub ? join(this.root, sub) : this.root);
    } catch (e) {
      if (e.code === 'ENOENT' && (sub || (await this.exists()))) return [];
      throw e;
    }
    return names.map((n) => (sub ? `${sub}/${n}` : n)).filter(isBackupName).sort();
  }
  async remove(name) {
    await rm(this.path(name), { force: true });
  }
}

/** Bilgisayarda kurulu OneDrive klasörü (yoksa null). Windows ortam değişkeninden, macOS `Library/CloudStorage` altından. */
export async function cloudDrive(platform, env, home) {
  const isDir = (d) => stat(d).then((s) => s.isDirectory(), () => false);
  if (platform === 'darwin') {
    const base = join(home, 'Library', 'CloudStorage');
    const name = (await readdir(base).catch(() => [])).filter((n) => /^OneDrive/i.test(n)).sort()[0];
    return name ? join(base, name) : null;
  }
  for (const d of [env.OneDrive, env.OneDriveCommercial, env.OneDriveConsumer]) if (d && (await isDir(d))) return d;
  return null;
}

/**
 * Sorulmadan açılan otomatik yedeğin klasörü: içinde bu firmanın yedeği OLMAYAN ilk aday. Böylece yeni anahtarla yazılan dosya,
 * başka (eski) anahtarla yazılmış bir yedeğin üzerine asla gelmez. Adaylar: seçili klasör, sonra `<kök>/Kollege-Yedek`, `… 2`, …
 */
export async function freeBackupFolder(current, base, firm) {
  const own = new RegExp(`-oto-${firm.slice(0, 8)}-\\d{4}-\\d{2}-\\d{2}\\.sifreli\\.json$`);
  const candidates = [...(current ? [current] : []), ...Array.from({ length: 20 }, (_, i) => join(base, i ? `Kollege-Yedek ${i + 1}` : 'Kollege-Yedek'))];
  for (const dir of candidates) {
    try {
      if (dir !== current) await mkdir(dir, { recursive: true });
      if (!(await readdir(dir)).some((n) => own.test(n))) return dir;
    } catch {
      /* bu aday kullanılamıyor: sıradaki */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Ortak klasör (iki bilgisayarın eşitlenmesi): yalnız dar bir yol düzeni kabul edilir
// ---------------------------------------------------------------------------------------------
export const SYNC_ROOT = 'Kollege-Esitleme';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SYNC_FILE = new RegExp(`^${SYNC_ROOT}/${UUID}/(?:(?:${UUID}|dosyalar)/)?[a-z0-9][a-z0-9._-]{0,79}$`);
const SYNC_DIR = new RegExp(`^${SYNC_ROOT}(?:/${UUID}(?:/(?:${UUID}|dosyalar))?)?$`);
export const isSyncPath = (p) => typeof p === 'string' && SYNC_FILE.test(p);
export const isSyncDir = (p) => typeof p === 'string' && SYNC_DIR.test(p);

/** Seçilen klasörün içindeki eşitleme klasörü. Yazma yeni dosyayı geçici dosya + yeniden adlandırma ile atomik koyar. */
export class SyncFolder {
  constructor(root) {
    this.root = root;
  }
  path(p, dir = false) {
    if (!(dir ? isSyncDir(p) : isSyncPath(p))) throw new Error('bad_name');
    return join(this.root, ...p.split('/'));
  }
  async exists() {
    try {
      return (await stat(this.root)).isDirectory();
    } catch {
      return false;
    }
  }
  async write(p, text, overwrite = false) {
    const f = this.path(p);
    if (!(await this.exists())) throw Object.assign(new Error('folder_missing'), { code: 'ENOENT' });
    if (!overwrite && (await stat(f).then(() => true, () => false))) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    await mkdir(dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    const h = await open(tmp, 'w');
    try {
      await h.writeFile(text, 'utf8');
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(tmp, f);
  }
  async read(p) {
    return readFile(this.path(p), 'utf8');
  }
  async list(dir) {
    const d = this.path(dir, true);
    try {
      return (await readdir(d)).filter((n) => !n.endsWith('.tmp')).sort();
    } catch (e) {
      if (e.code === 'ENOENT' && (await this.exists())) return [];
      throw e;
    }
  }
  async remove(p) {
    await rm(this.path(p), { force: true });
  }
}

/** Aynı disk mi? (aynı diskteki yedek, disk bozulunca işe yaramaz) */
export const sameDrive = (a, b) => resolve(a).slice(0, 2).toUpperCase() === resolve(b).slice(0, 2).toUpperCase();

/** Windows kurulumuna özgü numara → XXXX-XXXX-XXXX (geri çevrilemez) */
export const oldDataDir = (appData) => join(appData, 'TerraBuild');
/** Ad değişmeden önce verilmiş lisans kodları eski numaraya bağlıdır; o kodlar da geçerli kalır */
export const oldDeviceNumber = (machineGuid) => deviceNumber(machineGuid, 'terrabuild');
export function deviceNumber(machineGuid, name = 'kollege') {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const h = createHash('sha256').update(`${name}-bilgisayar|${String(machineGuid).trim().toLowerCase()}`).digest();
  let s = '';
  for (let i = 0; i < 12; i++) s += A[h[i] % 32];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** 1.10.0 > 1.9.3 */
export function newer(a, b) {
  const p = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
  const x = p(a), y = p(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Güncelleme bilgisi: indirme adresi yalnız aynı siteden, https */
export function parseUpdate(json, feed, current) {
  if (!json || typeof json !== 'object' || typeof json.version !== 'string' || typeof json.url !== 'string') return null;
  let u;
  try {
    u = new URL(json.url, feed);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.host !== new URL(feed).host || !newer(json.version, current)) return null;
  return { version: json.version, url: u.href };
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const h = await open(`${file}.tmp`, 'w');
  try {
    await h.writeFile(JSON.stringify(value), 'utf8');
    await h.sync();
  } finally {
    await h.close();
  }
  await rename(`${file}.tmp`, file);
}
