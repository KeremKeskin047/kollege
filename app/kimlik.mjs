// Bilgisayar ve lisans anahtarı kuralları (saf; ekranda, ana süreçte, sunucuda ve testlerde aynısı kullanılır).
const GENERIC = /^(to be filled( by o\.?e\.?m\.?)?|default string|system serial number|base board serial number|not applicable|not specified|not available|serial number|o\.?e\.?m\.?|none|n\/?a|unknown|invalid|empty|chassis serial number)\.?$/i;
/** Bazı üreticilerin bütün anakartlara yazdığı numaralar */
const SHARED_UUID = new Set(['03000200-0400-0500-0006-000700080009', '00020003-0004-0005-0006-000700080009', '12345678-1234-5678-90ab-cddeefaabbcc']);

/** Anlamlı değer ya da null */
export function usable(v) {
  const s = String(v ?? '').trim().toLowerCase();
  const bare = s.replace(/[^a-z0-9]/g, '');
  if (bare.length < 4 || GENERIC.test(s) || SHARED_UUID.has(s) || /^(.)\1*$/.test(bare) || /^0*123456789?0?$/.test(bare)) return null;
  return s;
}
export function usableUuid(v) {
  const s = usable(v);
  return s && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s) ? s : null;
}

/** Aynı bilgisayar mı? UUID varsa o belirler; yoksa anakart ve disk birlikte; o da yoksa Windows kurulumu. */
export function sameComputer(x, y) {
  if (!x || !y) return false;
  if (x.u && y.u) return x.u === y.u;
  if (x.b && y.b && x.d && y.d) return x.b === y.b && x.d === y.d;
  return !!x.g && x.g === y.g;
}

export const hasIdentity = (f) => !!(f && (f.u || (f.b && f.d) || f.g));
/** Sunucuya ya da dosyadan gelen özet nesnesi biçimce doğru mu? */
export const validFactors = (f) => !!f && typeof f === 'object' && !Array.isArray(f) && Object.entries(f).every(([k, v]) => 'ubdg'.includes(k) && k.length === 1 && typeof v === 'string' && /^[A-Za-z0-9_-]{27}$/.test(v)) && hasIdentity(f);

/** Lisans anahtarı: KOL-XXXXX-XXXXX-XXXXX. Küçük harf, boşluk ve eksik tire kabul edilir; O→0, I/L→1. */
export function normalizeKey(text) {
  const s = String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^K[O0]L/, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{15}$/.test(s) ? `KOL-${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10)}` : null;
}
