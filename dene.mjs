// Derlenen Mac programını GitHub'ın Mac makinesinde dener. Canlı lisans sunucusuna hiçbir istek göndermez.
//  1) Paket: kurulacak program açılıyor mu, bilgisayar numarası okunuyor mu (hiçbir düğmeye basılmaz).
//  2) İşleyiş: aynı program anahtarsız (deneme) olarak açılır: işletme kur, anahtar sakla, sorulmadan yedek, PDF önizleme, yazdırma sayfası.
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

mkdirSync('sonuc', { recursive: true });
const log = (...a) => {
  console.log(...a);
  appendFileSync('sonuc/dene.log', a.join(' ') + '\n');
};
let fails = 0;
const check = (ok, what) => {
  log(ok ? '✓' : '✗', what);
  if (!ok) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(command, args, env, port) {
  const p = spawn(command, [...args, `--remote-debugging-port=${port}`], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => appendFileSync(`sonuc/program-${port}.log`, d));
  let page;
  for (let i = 0; i < 120 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page' && x.url.startsWith('kollege://app'));
    } catch {
      /* henüz açılmadı */
    }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('program penceresi açılmadı');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const wait = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) wait.get(d.id)?.(d.result ?? d);
    else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]);
  };
  const cdp = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      const t = setTimeout(() => rej(new Error(`yanıt yok: ${method}`)), 40_000);
      wait.set(n, (v) => {
        clearTimeout(t);
        res(v);
      });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
    return r.result?.value;
  };
  await cdp('Runtime.enable');
  await cdp('DOM.enable');
  const until = async (expression, ms = 30_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await ev(expression).catch(() => false)) return true;
      await sleep(700);
    }
    return false;
  };
  const shot = async (name) => {
    const s = await cdp('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (s?.data) writeFileSync(`sonuc/${name}.png`, Buffer.from(s.data, 'base64'));
  };
  const close = async () => {
    cdp('Browser.close').catch(() => undefined);
    await sleep(3000);
    p.kill('SIGKILL');
  };
  return { cdp, ev, until, shot, close, errors };
}

const VERSION = JSON.parse(readFileSync('app/package.json', 'utf8')).version;
const NUMBER = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

async function packaged() {
  const A = await open(resolve('cikti/mac-universal/Kollege.app/Contents/MacOS/Kollege'), [], {}, 9333);
  check(await A.until('document.body.innerText.length > 80'), 'paket: program açıldı, ilk ekran geldi');
  const info = await A.ev('window.terra.info()');
  check(info.version === VERSION, `paket: sürüm ${info.version}`);
  check(NUMBER.test(info.device) && !!info.f?.u, 'paket: Mac donanım numarasından bilgisayar numarası okundu');
  await A.shot('paket');
  check(A.errors.length === 0, `paket: hata yok ${A.errors.slice(0, 3).join(' | ')}`);
  await A.close();
}

async function working() {
  cpSync('app', 'deneme-app', { recursive: true });
  const keys = ['h4IxaYs8XGxUVbcCS6G32ZlX6OWZ-S9gOXlKGw2iQOI', 'J8UsfwOUWPk8-q14BjL45R2PZmfWXOxtkbf-4N6vqfM']; // açık anahtarlar
  for (const f of readdirSync('deneme-app/web/assets').filter((n) => n.endsWith('.js'))) {
    const path = join('deneme-app/web/assets', f);
    let s = readFileSync(path, 'utf8');
    if (keys.some((k) => s.includes(k))) writeFileSync(path, keys.reduce((a, k) => a.replaceAll(k, ''), s));
  }
  const data = join(tmpdir(), 'kl-veri'), backup = join(tmpdir(), 'kl-yedek');
  mkdirSync(backup, { recursive: true });
  const A = await open(electron, [resolve('deneme-app'), '--lang=de'], { KL_VERI: data, KL_TEST_KLASOR: backup, KL_LISANS_ADRESI: 'http://127.0.0.1:1' }, 9334);
  check(await A.until(`!!document.getElementById('biz-name')`), 'işleyiş: işletme formu geldi');
  await A.ev(`(()=>{const e=document.getElementById('biz-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Mac Probe GmbH');e.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>e.form.requestSubmit(),200)})()`);
  check(await A.until(`document.body.innerText.includes('Mac Probe GmbH') && !document.getElementById('biz-name')`), 'işleyiş: işletme kuruldu');
  const id = '11111111-2222-4333-8444-555555555555';
  const key = await A.ev(`window.terra.syncKeySet('${id}','ZGVuZW1l').then(()=>window.terra.syncKeyGet('${id}'))`).catch((e) => e.message);
  check(key === 'ZGVuZW1l', `işleyiş: eşitleme anahtarı Anahtar Zinciri ile saklanıp okundu`);
  const files = () => {
    try {
      return readdirSync(join(backup, 'Kollege-Yedek'));
    } catch {
      return [];
    }
  };
  let found = false;
  for (let i = 0; i < 80 && !found; i++) {
    found = files().some((n) => /-oto-/.test(n));
    if (!found) await sleep(1000);
  }
  check(found, `işleyiş: sorulmadan şifreli yedek yazıldı (${files().join(', ')})`);
  await A.shot('genel');
  await A.ev(`history.pushState({},'','/sablonlar');dispatchEvent(new PopStateEvent('popstate'))`);
  check(await A.until(`document.querySelectorAll('section[role=region]').length >= 3`), 'işleyiş: şablonlar sayfası açıldı');
  await A.ev(`document.querySelectorAll('section[role=region]')[1].querySelector('.btn-primary').click()`);
  await A.until(`!!document.getElementById('ct-file')`);
  const doc = await A.cdp('DOM.getDocument', { depth: -1 });
  const node = await A.cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#ct-file' });
  await A.cdp('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [resolve('ornek-sozlesme.pdf')] });
  check(await A.until(`document.querySelector('.pdf-stage canvas')?.width > 400 && !document.querySelector('.pdf-stage .msg-error')`), 'işleyiş: PDF önizlemesi çizildi');
  await A.ev(`document.querySelector('.pdf-stage').scrollIntoView()`);
  await sleep(800);
  await A.shot('pdf');
  await A.ev(`window.print=()=>{};history.pushState({},'','/yazdir/anlagen/2026');dispatchEvent(new PopStateEvent('popstate'))`);
  check(await A.until(`!!document.querySelector('.pd-page')`), 'işleyiş: yazdırma sayfası açıldı');
  await A.shot('yazdirma');
  check(A.errors.length === 0, `işleyiş: hata yok ${A.errors.slice(0, 3).join(' | ')}`);
  await A.close();
}

for (const step of [packaged, working]) {
  try {
    await step();
  } catch (e) {
    check(false, `${step.name}: ${e.message}`);
  }
}
log(fails ? `${fails} adım BAŞARISIZ` : 'Hepsi tamam');
process.exit(fails ? 1 : 0);
