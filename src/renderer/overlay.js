'use strict';

/* Overlay renderer — şarkı verisini gösterir + medya kontrollerini yönetir. */

const el = {
  body: document.body,
  card: document.getElementById('card'),
  art: document.getElementById('art'),
  artWrap: document.getElementById('artWrap'),
  title: document.getElementById('title'),
  titleScroll: document.getElementById('titleScroll'),
  artist: document.getElementById('artist'),
  bar: document.getElementById('bar'),
  barFill: document.getElementById('barFill'),
  barKnob: document.getElementById('barKnob'),
  curTime: document.getElementById('curTime'),
  durTime: document.getElementById('durTime'),
  // transport
  btnShuffle: document.getElementById('btnShuffle'),
  btnPrev: document.getElementById('btnPrev'),
  btnPlay: document.getElementById('btnPlay'),
  btnNext: document.getElementById('btnNext'),
  btnRepeat: document.getElementById('btnRepeat'),
  // volume
  btnVolume: document.getElementById('btnVolume'),
  volPopover: document.getElementById('volPopover'),
  volMute: document.getElementById('volMute'),
  volBar: document.getElementById('volBar'),
  volFill: document.getElementById('volFill'),
  volKnob: document.getElementById('volKnob'),
  volPct: document.getElementById('volPct'),
  // mini
  btnLock: document.getElementById('btnLock'),
  btnSettings: document.getElementById('btnSettings'),
  btnHide: document.getElementById('btnHide'),
};

let state = {
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  lastSync: Date.now(),
  hasTrack: false,
  lastTitle: null,
  showProgress: true,
};

function fmt(ms) {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/* ---- Şarkı güncellemesi ---- */
function applyTrack(t) {
  if (!t || !t.hasTrack) {
    state.hasTrack = false;
    state.isPlaying = false;
    state.lastTitle = null;            // <-- şarkı dönünce başlık tekrar yazılsın
    el.card.classList.remove('playing');
    el.card.classList.add('idle');
    el.title.textContent = 'Spotify bekleniyor…';
    el.title.classList.remove('marquee');
    el.artist.textContent = 'Şarkı çal, burada görünsün';
    el.art.classList.remove('show');
    el.barFill.style.width = '0%';
    el.curTime.textContent = '0:00';
    el.durTime.textContent = '0:00';
    return;
  }

  state.hasTrack = true;
  const wasPlaying = state.isPlaying;
  
  // İyimser oynat/duraklat penceresi içindeysek gelen durumu yok say (titreşim önler)
  if (Date.now() >= ignorePlayUntil) {
    state.isPlaying = !!t.isPlaying;
  }

  const newPos = t.positionMs || 0;
  const newDur = t.durationMs || 0;
  
  // Şarkı başlığı veya süre değişti mi?
  const newTitle = t.title || 'Bilinmeyen şarkı';
  const trackChanged = (newTitle !== state.lastTitle) || (Math.abs(state.durationMs - newDur) > 1000);
  const playStateChanged = (wasPlaying !== state.isPlaying);
  
  let currentLocalPos = state.positionMs;
  if (wasPlaying) currentLocalPos += Date.now() - state.lastSync;

  const diff = Math.abs(currentLocalPos - newPos);

  // Eğer şarkı değiştiyse veya büyük bir zaman atlaması varsa (seek): zamanı SMTC'den zorla al
  if (trackChanged || diff > 1800) {
    state.positionMs = newPos;
    state.lastSync = Date.now();
  } else if (playStateChanged) {
    // Çalma durumu değişti ve fark küçükse: lokal pozisyonda sabitle (duraklatırken veya başlatırken geri atlamasın)
    state.positionMs = currentLocalPos;
    state.lastSync = Date.now();
  }
  // İkisi de değilse (fark 1800ms'den küçük ve normal akış): 
  // state.positionMs ve state.lastSync DEĞİŞTİRİLMEZ! Böylece saniye ibresi pürüzsüzce ileri akmaya devam eder.

  state.durationMs = newDur;

  el.card.classList.toggle('playing', state.isPlaying);
  el.card.classList.toggle('idle', !state.isPlaying);

  // Başlık — her zaman yaz; marquee'yi sadece değişince yeniden hesapla
  el.title.textContent = newTitle;
  if (newTitle !== state.lastTitle) {
    const firstFill = state.lastTitle !== null;
    state.lastTitle = newTitle;
    // Şarkı değişince albüm kapağına "pop" animasyonu (ilk dolumda değil)
    if (firstFill) {
      el.artWrap.classList.remove('changed');
      void el.artWrap.offsetWidth;       // reflow → animasyonu yeniden başlat
      el.artWrap.classList.add('changed');
    }
    el.title.classList.remove('marquee');
    requestAnimationFrame(() => {
      const overflow = el.title.scrollWidth - el.titleScroll.clientWidth;
      if (overflow > 6) {
        el.title.style.setProperty('--marquee-shift', `${-(overflow + 24) / el.title.scrollWidth * 100}%`);
        el.title.classList.add('marquee');
      }
    });
  }
  el.artist.textContent = t.artist || '';

  if (t.albumArt) {
    if (el.art.src !== t.albumArt) el.art.src = t.albumArt;
    el.art.classList.add('show');
    // Accent yalnızca data: kapaklardan çıkarılır (https kapak canvas'ı kirletir → SecurityError)
    if (t.albumArt.startsWith('data:')) updateAccentFromArt();
    else setAccent(null);
  } else {
    el.art.classList.remove('show');
    el.art.removeAttribute('src');
    setAccent(null);
  }

  tick();
}

/* ---- İlerleme yerel saat ---- */
let seeking = false;
let ignorePlayUntil = 0;   // iyimser oynat/duraklat sonrası gelen durumu yok sayma penceresi
function tick() {
  if (!state.hasTrack || seeking) return;
  let pos = state.positionMs;
  if (state.isPlaying) pos += Date.now() - state.lastSync;
  if (state.durationMs > 0 && pos > state.durationMs) pos = state.durationMs;
  if (state.showProgress) {
    const pct = state.durationMs > 0 ? (pos / state.durationMs) * 100 : 0;
    const clamped = Math.min(100, Math.max(0, pct));
    el.barFill.style.width = `${clamped}%`;
    el.barKnob.style.left = `${clamped}%`;
    el.curTime.textContent = fmt(pos);
    el.durTime.textContent = fmt(state.durationMs);
  }
}
setInterval(tick, 250);

/* ---- Accent rengi (kapaktan) ---- */
const canvas = document.createElement('canvas');
function updateAccentFromArt() {
  const img = el.art;
  if (!img.complete || !img.naturalWidth) {
    img.addEventListener('load', updateAccentFromArt, { once: true });
    return;
  }
  try {
    const w = 24, h = 24;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const cr = px[i], cg = px[i + 1], cb = px[i + 2];
      const weight = (Math.max(cr, cg, cb) - Math.min(cr, cg, cb)) + 10;
      r += cr * weight; g += cg * weight; b += cb * weight; n += weight;
    }
    if (n > 0) setAccent(vivid(Math.round(r / n), Math.round(g / n), Math.round(b / n)));
  } catch { setAccent(null); }
}
function setAccent(color) {
  document.documentElement.style.setProperty('--accent', color || '#1db954');
}

/* Çıkarılan rengi kullanılabilir bir accent'e çevir:
   gri/düşük doygunluklu kapaklarda Spotify yeşiline düş, aksi halde canlandır. */
function vivid(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.18) return '#1db954';        // neredeyse gri → yeşil
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  s = Math.min(1, s * 1.25 + 0.1);       // doygunluğu artır
  const L = Math.min(0.62, Math.max(0.45, l)); // görünürlük için ışıklılığı sınırla
  // HSL -> RGB
  const c = (1 - Math.abs(2 * L - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = L - c / 2;
  let rr = 0, gg = 0, bb = 0;
  if (h < 60) { rr = c; gg = x; }
  else if (h < 120) { rr = x; gg = c; }
  else if (h < 180) { gg = c; bb = x; }
  else if (h < 240) { gg = x; bb = c; }
  else if (h < 300) { rr = x; bb = c; }
  else { rr = c; bb = x; }
  return `rgb(${Math.round((rr + m) * 255)}, ${Math.round((gg + m) * 255)}, ${Math.round((bb + m) * 255)})`;
}

/* ---- Ayarlar ---- */
let locked = false;
let curScale = 1;
function applySettings(s) {
  if (!s) return;
  state.showProgress = s.showProgress !== false;
  el.body.classList.toggle('no-progress', !state.showProgress);
  locked = !!s.locked;
  el.body.classList.toggle('locked', locked);
  el.card.dataset.theme = s.theme || 'auto';
  curScale = s.scale || 1;
  document.documentElement.style.setProperty('--scale', curScale);
  // Saydamlık: card.style.opacity tüm katmanı (yazı dahil) soluklaştırdığı için
  // bunun yerine arka plan alpha'larını --card-opacity ile ölçekliyoruz → cam zemin
  // gerçekten saydam olur, yazı/butonlar tam görünür kalır.
  const op = s.opacity != null ? s.opacity : 1;
  document.documentElement.style.setProperty('--card-opacity', op);
  el.card.style.opacity = '';
  el.artWrap.style.display = (s.showAlbumArt === false) ? 'none' : '';
  // Tıklama-geçirgenlik mantığı (aşağıdaki applyIgnoreMode'a bak):
  // pencere her zaman geçirgen başlar, sadece interaktif öğeler üzerine
  // gelince anlık olarak yakalar.
  applyIgnoreMode();
}

/* ---- Tıklama-geçirgenlik ----
   Her durumda overlay arka planı tıklama-geçirgendir (kart boş yerine
   tıklarsan alttaki uygulamaya — örn. Chrome'a — geçer). Sadece interaktif
   öğelerin (butonlar + progress bar; kilit AÇIKKEN ayrıca kart geneli
   sürükleme için) üzerine mouse geldiğinde ignore'u anlık kapatırız.
   forward:true → pencere geçirgen olsa bile mouse hareketleri JS'e gelir,
   böylece hover algılayıp doğru anda etkileşime geçebiliyoruz. */
function setPassthrough(on) {
  if (locked) {
    window.overlayAPI?.setIgnoreMouse(true, { forward: false });
    return;
  }
  if (on) window.overlayAPI?.setIgnoreMouse(true, { forward: true });
  else window.overlayAPI?.setIgnoreMouse(false);
}
function applyIgnoreMode() { setPassthrough(true); }

const INTERACTIVE_ALWAYS = '.tp, .ctl, #bar';
// Ses kontrolü kilitliyken de çalışabilmeli
const INTERACTIVE_VOL = '.vol-popover, #btnVolume';
function hitInteractive(target) {
  if (!target || !target.closest) return null;
  // Ses butonu ve popover her zaman etkileşimli (kilitli olsa bile)
  if (target.closest(INTERACTIVE_VOL)) return 'btn';
  if (locked) return null; // Kilitliyken diğer öğeler tıklama almaz
  if (target.closest(INTERACTIVE_ALWAYS)) return 'btn';
  // Kilit AÇIKKEN (locked=false) kart geneli de tıklama almalı ki sürükleme çalışsın
  if (!locked && target.closest('.card')) return 'card';
  return null;
}
document.addEventListener('mouseover', (e) => {
  if (hitInteractive(e.target)) setPassthrough(false);
}, true);
document.addEventListener('mouseout', (e) => {
  const from = hitInteractive(e.target);
  const to = hitInteractive(e.relatedTarget);
  if (from && !to) setPassthrough(true);
}, true);

/* ---- Medya kontrolleri ---- */
async function send(cmd, positionMs) {
  try { return await window.overlayAPI?.control(cmd, positionMs); } catch { return null; }
}

el.btnPlay.addEventListener('click', () => {
  // İyimser: anında değiştir + kısa süre gelen durumu yok say (titreşim önler)
  state.isPlaying = !state.isPlaying;
  state.positionMs = currentPos();
  state.lastSync = Date.now();
  ignorePlayUntil = Date.now() + 1200;
  el.card.classList.toggle('playing', state.isPlaying);
  el.card.classList.toggle('idle', !state.isPlaying);
  send('toggle');
});
el.btnNext.addEventListener('click', () => send('next'));
el.btnPrev.addEventListener('click', () => send('prev'));
el.btnShuffle.addEventListener('click', async () => {
  const r = await send('shuffle');
  if (r && r.ok) setShuffle(!!r.shuffleActive);
});
el.btnRepeat.addEventListener('click', async () => {
  const r = await send('repeat');
  if (r && r.ok && r.repeatMode != null) setRepeat(r.repeatMode);
});

function setShuffle(on) { el.btnShuffle.classList.toggle('active', on); }
function setRepeat(mode) {
  // 0 None, 1 Track(=tek), 2 List(=tümü)
  el.btnRepeat.classList.toggle('active', mode !== 0);
  el.btnRepeat.classList.toggle('repeat-one-on', mode === 1);
}

function currentPos() {
  let pos = state.positionMs;
  if (state.isPlaying) pos += Date.now() - state.lastSync;
  if (state.durationMs > 0 && pos > state.durationMs) pos = state.durationMs;
  return Math.max(0, pos);
}

/* ---- Sarma (progress bar tıkla/sürükle) ---- */
function pctFromEvent(e) {
  const rect = el.bar.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}
function previewSeek(pct) {
  el.barFill.style.width = `${pct * 100}%`;
  el.barKnob.style.left = `${pct * 100}%`;
  if (state.durationMs > 0) el.curTime.textContent = fmt(pct * state.durationMs);
}
el.bar.addEventListener('pointerdown', (e) => {
  if (!state.hasTrack || state.durationMs <= 0) return;
  seeking = true;
  el.bar.setPointerCapture(e.pointerId);
  previewSeek(pctFromEvent(e));
});
el.bar.addEventListener('pointermove', (e) => {
  if (!seeking) return;
  previewSeek(pctFromEvent(e));
});
el.bar.addEventListener('pointerup', (e) => {
  if (!seeking) return;
  const pct = pctFromEvent(e);
  seeking = false;
  const posMs = Math.round(pct * state.durationMs);
  state.positionMs = posMs;
  state.lastSync = Date.now();
  send('seek', posMs);
});

/* ---- Manuel sürükleme (kartın boş yerinden; buton/çubuk hariç) ---- */
function isInteractive(t) {
  return t && t.closest && t.closest('.tp, .ctl, #bar, button, .vol-popover');
}
let drag = null;
let pendingMove = null, moveRaf = null;
function flushMove() {
  moveRaf = null;
  if (pendingMove) { window.overlayAPI?.moveTo(pendingMove.x, pendingMove.y); pendingMove = null; }
}
el.card.addEventListener('pointerdown', async (e) => {
  if (locked || e.button !== 0 || isInteractive(e.target)) return;
  const b = await window.overlayAPI?.getBounds();
  if (!b) return;
  drag = { sx: e.screenX, sy: e.screenY, wx: b.x, wy: b.y };
  el.card.classList.add('dragging');
  try { el.card.setPointerCapture(e.pointerId); } catch {}
  e.preventDefault();
});
el.card.addEventListener('pointermove', (e) => {
  if (!drag) return;
  pendingMove = { x: drag.wx + (e.screenX - drag.sx), y: drag.wy + (e.screenY - drag.sy) };
  if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
});
function endDrag(e) {
  if (!drag) return;
  drag = null;
  flushMove();
  el.card.classList.remove('dragging');
  try { el.card.releasePointerCapture(e.pointerId); } catch {}
}
el.card.addEventListener('pointerup', endDrag);
el.card.addEventListener('pointercancel', endDrag);
// Güvence: pointerup pencere dışına düşse bile sürüklemeyi bitir (capture sızıntısı önlenir)
window.addEventListener('pointerup', endDrag);
// Native sürüklemeyi engelle (albüm kapağı "hayalet" sürükleme görüntüsü oluşturmasın)
window.addEventListener('dragstart', (e) => e.preventDefault());

/* ---- Ctrl + fare tekerleği ile boyutlandırma ---- */
el.card.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || locked) return;
  e.preventDefault();
  curScale = Math.max(0.7, Math.min(1.8, curScale + (e.deltaY < 0 ? 0.05 : -0.05)));
  curScale = Math.round(curScale * 100) / 100;
  window.overlayAPI?.setScale(curScale);
}, { passive: false });

/* ---- Sağ tık menüsü ---- */
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!locked) window.overlayAPI?.contextMenu();
});

/* ---- Mini kontroller ---- */
el.btnLock.addEventListener('click', () => window.overlayAPI?.toggleLock());
el.btnSettings.addEventListener('click', () => window.overlayAPI?.openSettings());
el.btnHide.addEventListener('click', () => window.overlayAPI?.hide());

/* ---- Spotify oturum sesi ---- */
/* ISimpleAudioVolume backend'i üzerinden yalnızca Spotify'in sesini ayarlar.
   Hover → popover açılır. İkona tık → mute toggle. Slider → seviye ayarı.
   Mute olunca son seviye (lastLevel) korunur, açınca geri yüklenir. */
let vol = { level: 1, muted: false, lastLevel: 1 };   // UI durumu
let volSeeking = false;
let volSetT = null;        // set komutu için debounce
let volHoverT = null;      // popover kapanma gecikmesi

async function volSend(cmd, level) {
  try { return await window.overlayAPI?.volumeControl(cmd, level); } catch { return null; }
}

function renderVol() {
  const pct = Math.round(vol.level * 100);
  el.volFill.style.width = `${vol.muted ? 0 : pct}%`;
  el.volKnob.style.left = `${vol.muted ? 0 : pct}%`;
  el.volPct.textContent = vol.muted ? '—' : pct;
  // İkon durumları (buton + popover)
  const low = !vol.muted && vol.level <= 0.4;
  el.btnVolume.classList.toggle('is-muted', vol.muted);
  el.btnVolume.classList.toggle('is-low', low);
  el.volPopover.classList.toggle('is-muted', vol.muted);
}

async function refreshVol() {
  const r = await volSend('get');
  if (r && r.ok) {
    vol.level = r.level != null ? r.level : vol.level;
    vol.muted = !!r.muted;
    renderVol();
  }
}

/* Hover ile popover aç/kapat (gecikmeli kapanma → kaydırırken kapanmasın) */
function openPopover() {
  clearTimeout(volHoverT);
  el.volPopover.classList.add('open');
  el.volPopover.setAttribute('aria-hidden', 'false');
}
function scheduleClosePopover() {
  clearTimeout(volHoverT);
  volHoverT = setTimeout(() => {
    el.volPopover.classList.remove('open');
    el.volPopover.setAttribute('aria-hidden', 'true');
  }, 220);
}
[el.btnVolume, el.volPopover].forEach((node) => {
  node.addEventListener('mouseenter', openPopover);
  node.addEventListener('mouseleave', scheduleClosePopover);
});

/* İkona tıkla → mute toggle */
el.btnVolume.addEventListener('click', async () => {
  if (vol.muted) {
    vol.muted = false;
    await volSend('unmute');
    // lastLevel'i geri yükle
    if (vol.lastLevel > 0 && vol.lastLevel !== vol.level) {
      vol.level = vol.lastLevel;
      await volSend('set', vol.level);
    }
  } else {
    if (vol.level > 0) vol.lastLevel = vol.level;
    vol.muted = true;
    await volSend('mute');
  }
  renderVol();
});
/* Popover içindeki mute butonu da aynı işi yapsın */
el.volMute.addEventListener('click', () => el.btnVolume.click());

/* Slider sürükle/tıkla → set (sarma mantığına benzer) */
function volPctFromEvent(e) {
  const rect = el.volBar.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}
function previewVol(pct) {
  // Sürüklerken UI anlık güncellensin (mute ise dokunmadan açılır)
  if (vol.muted) { vol.muted = false; volSend('unmute'); }
  vol.level = pct;
  if (pct === 0) vol.lastLevel = vol.lastLevel || 1;  // 0'a indirince son seviyeyi hatırla
  renderVol();
}
el.volBar.addEventListener('pointerdown', (e) => {
  volSeeking = true;
  setPassthrough(false); // Sürükleme boyunca fareyi overlay'e kilitle
  el.volBar.setPointerCapture(e.pointerId);
  previewVol(volPctFromEvent(e));
});
el.volBar.addEventListener('pointermove', (e) => {
  if (!volSeeking) return;
  previewVol(volPctFromEvent(e));
});
el.volBar.addEventListener('pointerup', () => {
  if (!volSeeking) return;
  volSeeking = false;
  commitVol();
  // Sürükleme bitti, passthrough'u normale döndür
  setPassthrough(true);
});
el.volBar.addEventListener('pointercancel', () => {
  if (!volSeeking) return;
  volSeeking = false;
  setPassthrough(true);
});

/* Debounce'lu set — sürüklerken her pikselde PowerShell açılmasın */
function commitVol() {
  clearTimeout(volSetT);
  volSetT = setTimeout(() => {
    if (vol.level <= 0) volSend('set', 0);   // ses 0 ama mute flag değil
    else volSend('set', vol.level);
  }, 150);
}

/* ---- IPC ---- */
if (window.overlayAPI) {
  // Pencere varsayılan olarak etkileşimli başlar; kilit durumu applySettings'te uygulanır.
  window.overlayAPI.onTrack(applyTrack);
  window.overlayAPI.onSettings(applySettings);
  window.overlayAPI.onVolumeUpdate((data) => {
    if (data) {
      vol.level = data.level != null ? data.level : vol.level;
      vol.muted = !!data.muted;
      renderVol();
    }
  });
  window.overlayAPI.requestInitial();
  // Açılışta shuffle/repeat durumunu senkronize et
  send('caps').then((r) => {
    if (r && r.ok) {
      setShuffle(!!r.shuffleActive);
      if (r.repeatMode != null) setRepeat(r.repeatMode);
    }
  });
  // Ses durumunu başlat + periyodik senkronize et (dışarıdan değişirse UI yansıtsın)
  renderVol();
  refreshVol();
  setInterval(refreshVol, 4000);
}
