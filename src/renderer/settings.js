'use strict';

const $ = (id) => document.getElementById(id);
let S = null; // mevcut ayarlar anlık görüntüsü

/* ---- Yardımcılar ---- */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---- Canlı önizleme (şarkı) ---- */
function setStatus(text, off) {
  $('pvStatusText').textContent = text;
  $('pvStatus').className = 'np-status' + (off ? ' off' : '');
}
function renderTrack(t) {
  if (!t || !t.hasTrack) {
    $('pvTitle').textContent = 'Spotify çalmıyor';
    $('pvArtist').textContent = '—';
    $('pvArt').classList.remove('show');
    if (t && t.error === 'smtc-unavailable') {
      setStatus('SMTC kullanılamıyor (Windows 10 1809+ gerekir)', true);
    } else {
      setStatus('Spotify masaüstünde bir şarkı çal', true);
    }
    return;
  }
  $('pvTitle').textContent = t.title;
  $('pvArtist').textContent = t.artist || '';
  if (t.albumArt) { $('pvArt').src = t.albumArt; $('pvArt').classList.add('show'); }
  else $('pvArt').classList.remove('show');
  setStatus(t.isPlaying ? 'Çalıyor — overlay\'de görünüyor' : 'Duraklatıldı', !t.isPlaying);
}

/* ---- Sekme geçişi ---- */
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
    });
  });
}

/* ---- APO durumunu göster ---- */
function renderApo(apo) {
  const status = $('apoStatus');
  const blkInstall = $('apoInstall');
  const blkSetup = $('apoSetup');
  const blkControls = $('apoControls');
  blkInstall.classList.add('hidden');
  blkSetup.classList.add('hidden');
  blkControls.classList.add('hidden');

  if (!apo.installed) {
    status.textContent = '✖ Equalizer APO kurulu değil';
    status.className = 'apo-status bad';
    blkInstall.classList.remove('hidden');
    return;
  }
  if (!apo.ready) {
    status.textContent = '◐ Equalizer APO bulundu — kurulum gerekli';
    status.className = 'apo-status warn';
    blkSetup.classList.remove('hidden');
    $('apoDeviceWarn').classList.toggle('hidden', apo.deviceEnabled);
    return;
  }
  // Hazır
  status.textContent = apo.deviceEnabled
    ? '✔ Equalizer APO hazır'
    : '◐ Hazır ama oynatma cihazında etkin değil';
  status.className = 'apo-status ' + (apo.deviceEnabled ? 'ok' : 'warn');
  blkControls.classList.remove('hidden');
  $('apoDeviceWarn2').classList.toggle('hidden', apo.deviceEnabled);
}

/* ---- Ayarları forma yükle ---- */
function fillForm() {
  const o = S.overlay, a = S.audio, g = S.general;

  $('opacity').value = o.opacity; $('opacityVal').textContent = Math.round(o.opacity * 100) + '%';
  $('scale').value = o.scale; $('scaleVal').textContent = Math.round(o.scale * 100) + '%';
  $('showProgress').checked = o.showProgress !== false;
  $('showAlbumArt').checked = o.showAlbumArt !== false;
  $('locked').checked = !!o.locked;

  $('boost').value = a.boostDb; $('boostVal').textContent = a.boostDb + ' dB';
  $('audioEnabled').checked = !!a.enabled;
  $('capVal').textContent = S.hardCap;

  // Preset listesi
  const sel = $('preset');
  sel.innerHTML = '';
  for (const [key, label] of Object.entries(S.presets)) {
    const opt = document.createElement('option');
    opt.value = key; opt.textContent = label;
    if (key === a.preset) opt.selected = true;
    sel.appendChild(opt);
  }

  $('launch').checked = !!g.launchOnStartup;
  ['opacity', 'scale', 'boost'].forEach(fillSlider);
  renderApo(S.apo);
}

/* Slider'ın solunu yeşil doldur (görsel ilerleme geri bildirimi) */
function fillSlider(id) {
  const el = $(id);
  if (!el) return;
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.background =
    `linear-gradient(to right, var(--green) 0%, var(--green) ${pct}%, #3a3a45 ${pct}%, #3a3a45 100%)`;
}

/* ---- Overlay ayar değişiklikleri ---- */
async function pushOverlay(patch) {
  S.overlay = await window.api.setOverlay(patch);
}
$('opacity').addEventListener('input', (e) => {
  $('opacityVal').textContent = Math.round(e.target.value * 100) + '%';
  fillSlider('opacity');
  pushOverlay({ opacity: parseFloat(e.target.value) });
});
$('scale').addEventListener('input', (e) => {
  $('scaleVal').textContent = Math.round(e.target.value * 100) + '%';
  fillSlider('scale');
  pushOverlay({ scale: parseFloat(e.target.value) });
});
$('showProgress').addEventListener('change', (e) => pushOverlay({ showProgress: e.target.checked }));
$('showAlbumArt').addEventListener('change', (e) => pushOverlay({ showAlbumArt: e.target.checked }));
$('locked').addEventListener('change', (e) => pushOverlay({ locked: e.target.checked }));
$('btnReset').addEventListener('click', () => window.api.resetPosition());

/* ---- Ses ayar değişiklikleri ---- */
const pushAudio = debounce(async (patch) => {
  const res = await window.api.setAudio(patch);
  S.audio = res.audio;
  // Yazma başarısızsa APO durumunu tazele
  if (res.apply && !res.apply.ok) {
    S.apo = await window.api.apoDetect();
    renderApo(S.apo);
  }
}, 250);

$('boost').addEventListener('input', (e) => {
  $('boostVal').textContent = e.target.value + ' dB';
  fillSlider('boost');
  pushAudio({ boostDb: parseFloat(e.target.value) });
});
$('audioEnabled').addEventListener('change', (e) => pushAudio({ enabled: e.target.checked }));
$('preset').addEventListener('change', (e) => pushAudio({ preset: e.target.value }));

/* ---- Genel ---- */
$('launch').addEventListener('change', (e) => window.api.setGeneral({ launchOnStartup: e.target.checked }));

/* ---- Butonlar ---- */
$('btnToggleShow').addEventListener('click', async () => {
  const vis = S.overlay.visible !== false;
  S.overlay = await window.api.setOverlay({ visible: !vis });
});
$('btnDownload').addEventListener('click', () => window.api.apoOpenDownload());
$('btnConfigurator').addEventListener('click', () => window.api.apoOpenConfigurator());
$('btnConfigurator2').addEventListener('click', () => window.api.apoOpenConfigurator());

async function doSetup() {
  const btn = $('btnSetup');
  btn.disabled = true; btn.textContent = 'Yönetici izni bekleniyor…';
  const res = await window.api.apoSetup({ launchConfigurator: !S.apo.deviceEnabled });
  S.apo = res.apo;
  btn.disabled = false; btn.textContent = 'Kurulumu Tamamla';
  if (!res.setup.ok) {
    $('apoStatus').textContent = 'Kurulum iptal edildi / başarısız: ' + (res.setup.reason || '');
    $('apoStatus').className = 'apo-status bad';
  } else {
    // Audio'yu da tazele
    S.audio.enabled = true;
  }
  renderApo(S.apo);
  fillForm();
}
$('btnSetup').addEventListener('click', doSetup);

/* ---- Başlangıç ---- */
initTabs();
window.api.onTrack(renderTrack);
(async () => {
  S = await window.api.getSettings();
  fillForm();
})();
