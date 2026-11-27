// Mac programını derler (GitHub'ın Mac makinesinde çalışır): app/ → cikti/Kollege-Mac-<sürüm>.dmg (Apple ve Intel işlemci, tek dosya).
// Apple geliştirici imzası YOKTUR: yalnız yerel (ad-hoc) imza atılır; kullanıcı ilk açılışta Sistem Ayarları'ndan izin verir.
import { build, Platform, Arch } from 'electron-builder';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const pkg = JSON.parse(readFileSync('app/package.json', 'utf8'));
const out = resolve('cikti');
await build({
  projectDir: resolve('app'),
  targets: Platform.MAC.createTarget('dir', Arch.universal),
  publish: 'never',
  config: {
    appId: 'app.kollege.masaustu',
    productName: 'Kollege',
    electronVersion: JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version,
    directories: { output: out },
    files: ['**/*'],
    asar: true,
    npmRebuild: false,
    electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true },
    mac: {
      icon: resolve('icon.png'), category: 'public.app-category.business', identity: null,
      extendInfo: { NSDocumentsFolderUsageDescription: 'Kollege schreibt die verschlüsselte Sicherung in den Ordner „Dokumente“.' },
    },
  },
});
const bundle = join(out, 'mac-universal', 'Kollege.app');
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
// İmzasız ya da bozuk imzalı program Apple işlemcili Mac'te "hasarlı" diye hiç açılmaz: bütün paket yerel imzalanır ve doğrulanır
run('codesign', ['--force', '--deep', '--sign', '-', bundle]);
run('codesign', ['--verify', '--deep', '--strict', bundle]);
run('lipo', ['-archs', join(bundle, 'Contents', 'MacOS', 'Kollege')]);
const staging = join(out, 'dmg');
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(bundle, join(staging, 'Kollege.app'), { recursive: true, verbatimSymlinks: true });
symlinkSync('/Applications', join(staging, 'Applications'));
const dmg = join(out, `Kollege-Mac-${pkg.version}.dmg`);
run('hdiutil', ['create', '-volname', 'Kollege', '-srcfolder', staging, '-ov', '-format', 'UDZO', dmg]);
const data = readFileSync(dmg);
mkdirSync('sonuc', { recursive: true });
writeFileSync('sonuc/mac.json', JSON.stringify({ version: pkg.version, file: `Kollege-Mac-${pkg.version}.dmg`, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }, null, 2));
console.log(dmg, data.length);
