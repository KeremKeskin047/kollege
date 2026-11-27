// Açılış bekçisi: program yüklenemezse ya da uzun süre açılmazsa beyaz sayfa/“Yükleniyor” yerine yol gösterir.
// Ana programdan bağımsızdır (eski tarayıcıda da çalışsın diye sade yazılmıştır). window.__klReady() çağrılınca susar.
(function () {
  var WAIT = 15000;
  var box = null;
  var ready = false;
  function show(text) {
    if (ready || box) return;
    box = document.createElement('div');
    box.id = 'kl-boot';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#1e2023;color:#f2f2f2;border-top:2px solid #3da885;padding:16px;font:16px/1.5 system-ui,Segoe UI,sans-serif;text-align:center';
    var p = document.createElement('p');
    p.style.margin = '0 0 12px';
    p.textContent = text;
    box.appendChild(p);
    var row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:480px;margin:0 auto';
    function add(label, href, primary) {
      var a = document.createElement('a');
      a.textContent = label;
      a.href = href;
      a.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:48px;border:1px solid #3da885;border-radius:8px;text-decoration:none;font-weight:600;' + (primary ? 'background:#3da885;color:#1a1a1a' : 'color:#f2f2f2');
      row.appendChild(a);
    }
    add('Yeniden dene', location.pathname + location.search, false);
    add('Kurtarma', '/kurtar.html', true);
    box.appendChild(row);
    document.body.appendChild(box);
  }
  window.__klReady = function () {
    ready = true;
    clearTimeout(timer);
    if (box) box.remove();
    box = null;
  };
  var timer = setTimeout(function () {
    show('Program beklenenden uzun sürede açılıyor. Kayıtlarınız bu cihazda duruyor. Başka sekmede açıksa kapatıp yeniden deneyin.');
  }, WAIT);
  // Program dosyası indirilemedi ya da çalışırken durdu
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (ready) return;
    if ((t && t.tagName === 'SCRIPT') || e.error) setTimeout(function () { show('Program açılamadı. Kayıtlarınız bu cihazda duruyor.'); }, 2000);
  }, true);
})();
