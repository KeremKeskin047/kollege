// Bilgisayarı tanıma. Ana süreç (Electron), lisans sunucusu ve testler aynı kuralları kullanır.
// Ham donanım değeri bilgisayardan ÇIKMAZ: her değer tuzlu scrypt özetiyle gönderilir (seri numaraları tahmin edilebilir olduğu için yavaş özet).
import { createHash, scrypt } from 'node:crypto';
import { usable, usableUuid } from './kimlik.mjs';

export * from './kimlik.mjs';

const SALT = 'kollege-donanim-1';
const hash = (kind, value) =>
  new Promise((res, rej) => scrypt(`${kind}|${value}`, SALT, 20, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k.toString('base64url')))));

/** Özetler: u = anakart UUID, b = anakart serisi, d = sistem diski serisi, g = Windows kurulumu (yalnız diğerleri yetmezse) */
export async function factors({ uuid, board, disk } = {}, guid = null) {
  const [u, b, d] = [usableUuid(uuid), usable(board), usable(disk)];
  const out = {};
  if (u) out.u = await hash('u', u);
  if (b) out.b = await hash('b', b);
  if (d) out.d = await hash('d', d);
  if (!u && !(b && d) && guid) out.g = await hash('g', String(guid).trim().toLowerCase());
  return out;
}

/** Ekranda görünen numara: XXXX-XXXX-XXXX */
export function computerNumber(f) {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const h = createHash('sha256').update(`kollege-bilgisayar-2|${f.u ?? (f.b && f.d ? `${f.b}|${f.d}` : f.g)}`).digest();
  const s = [...h.subarray(0, 12)].map((x) => A[x % 32]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const PS = `$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;
$n=(Get-Partition -DriveLetter $env:SystemDrive.Substring(0,1)).DiskNumber;
@{uuid=(Get-CimInstance Win32_ComputerSystemProduct).UUID;board=(Get-CimInstance Win32_BaseBoard).SerialNumber;disk=(Get-Disk -Number $n).SerialNumber}|ConvertTo-Json -Compress`;

/** macOS `ioreg` çıktısından anakart UUID'si ve bilgisayarın seri numarası */
export function parseIoreg(out) {
  const get = (k) => new RegExp(`"${k}"\\s*=\\s*"([^"]+)"`).exec(String(out ?? ''))?.[1];
  return { uuid: get('IOPlatformUUID'), board: get('IOPlatformSerialNumber') };
}

/** Donanımı okur (yönetici izni istemez). Okunamazsa boş nesne. */
export const readHardware = (execFile, platform = process.platform) =>
  new Promise((res) =>
    platform === 'darwin'
      ? execFile('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 20_000 }, (_e, out) => res(parseIoreg(out)))
      : execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20_000 }, (_e, out) => {
      try {
        res(JSON.parse(String(out).trim()) ?? {});
      } catch {
        res({});
      }
    }),
  );
