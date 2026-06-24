'use strict';

/* Equalizer APO kontrolcüsü — sesi %100 üstüne boost + EQ presetleri.

   Tasarım: Program Files'a sürekli admin'le yazmamak için, TEK SEFERLİK
   admin kurulumunda config altında kendi alt klasörümüzü açıp o klasöre
   yazma izni veriyoruz (icacls). Bundan sonra eq dosyasını admin'siz
   güncelliyoruz; Equalizer APO değişikliği canlı (yeniden başlatmasız) yükler.

   Güvenlik: toplam pozitif kazanç (preamp + en yüksek EQ bandı) +12 dB ile
   sınırlanır; clipping/hoparlör hasarı riskini azaltmak için preamp,
   EQ'nun pozitif kazancını otomatik telafi eder. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const APP_DIR_NAME = 'SpotifySeffaf';   // config altındaki alt klasörümüz
const EQ_FILE_NAME = 'eq.txt';
const INCLUDE_LINE = `Include: ${APP_DIR_NAME}\\${EQ_FILE_NAME}`;
// Include satırını tek/çift ters-bölü, büyük-küçük harf fark etmeden eşleştir
const INCLUDE_RE = new RegExp(`^\\s*Include:\\s*${APP_DIR_NAME}[\\\\/]+${EQ_FILE_NAME.replace('.', '\\.')}\\s*$`, 'im');
const HARD_CAP_DB = 30;                  // üst sınır (pratikte sınırsız; 30 dB çok yüksek)

/* ---- Tespit ---- */
function regQuery(view) {
  // Boş view (varsayılan görünüm) için ekstra boş argüman geçme — reg.exe bozulur
  const viewArgs = view ? [view] : [];
  try {
    const out = execFileSync('reg',
      ['query', 'HKLM\\SOFTWARE\\EqualizerAPO', '/v', 'ConfigPath', ...viewArgs],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/ConfigPath\s+REG_SZ\s+(.+)/i);
    if (m) return m[1].trim();
  } catch {}
  try {
    const out = execFileSync('reg',
      ['query', 'HKLM\\SOFTWARE\\EqualizerAPO', '/v', 'InstallPath', ...viewArgs],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/InstallPath\s+REG_SZ\s+(.+)/i);
    if (m) return path.join(m[1].trim(), 'config');
  } catch {}
  return null;
}

function findConfigDir() {
  // 64-bit görünüm önce, sonra varsayılan görünüm, sonra bilinen yollar
  return regQuery('/reg:64')
    || regQuery('/reg:32')
    || regQuery('')
    || [
      'C:\\Program Files\\EqualizerAPO\\config',
      'C:\\Program Files (x86)\\EqualizerAPO\\config',
    ].find((p) => { try { return fs.existsSync(p); } catch { return false; } })
    || null;
}

function deviceEnabled() {
  // "Child APOs" alt anahtarı varsa APO en az bir cihaza bağlı demektir
  try {
    execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\EqualizerAPO\\Child APOs', '/reg:64'],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
}

// Cihaz seçici/Configurator'ı bul — sürüme göre adı değişir:
// yeni sürümlerde DeviceSelector.exe, eskilerde Configurator.exe.
function findConfigurator(installDir) {
  if (!installDir) return null;
  for (const name of ['DeviceSelector.exe', 'Configurator.exe']) {
    const p = path.join(installDir, name);
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function detect() {
  const configDir = findConfigDir();
  const installed = !!configDir && fs.existsSync(configDir);
  const installDir = configDir ? path.dirname(configDir) : null;
  const configTxt = configDir ? path.join(configDir, 'config.txt') : null;
  const ourDir = configDir ? path.join(configDir, APP_DIR_NAME) : null;
  const ourFile = ourDir ? path.join(ourDir, EQ_FILE_NAME) : null;
  const configurator = installed ? findConfigurator(installDir) : null;

  let includePresent = false;
  let ourDirWritable = false;
  if (installed) {
    try {
      const cfg = fs.existsSync(configTxt) ? fs.readFileSync(configTxt, 'utf8') : '';
      includePresent = INCLUDE_RE.test(cfg);
    } catch {}
    try {
      if (ourDir && fs.existsSync(ourDir)) {
        fs.accessSync(ourDir, fs.constants.W_OK);
        ourDirWritable = true;
      }
    } catch {}
  }

  return {
    installed,
    configDir,
    configTxt,
    ourDir,
    ourFile,
    includePresent,
    ourDirWritable,
    configurator,
    deviceEnabled: installed ? deviceEnabled() : false,
    // Kurulum tamamen hazır mı? (Include var + klasör yazılabilir)
    ready: installed && includePresent && ourDirWritable,
  };
}

/* ---- Preset tanımları (Filter satırları) ----
   gain pozitifse clipping koruması için preamp otomatik düşürülür. */
const PRESETS = {
  flat: { label: 'Düz (kapalı EQ)', filters: [] },
  bass: {
    label: 'Bas Boost',
    filters: [
      'Filter 1: ON LS Fc 110 Hz Gain 6 dB Q 0.7',
      'Filter 2: ON PK Fc 60 Hz Gain 3 dB Q 1.0',
    ],
  },
  vocal: {
    label: 'Vokal / Netlik',
    filters: [
      'Filter 1: ON PK Fc 300 Hz Gain -2 dB Q 1.0',
      'Filter 2: ON PK Fc 3000 Hz Gain 3 dB Q 1.2',
      'Filter 3: ON HS Fc 9000 Hz Gain 2 dB',
    ],
  },
  treble: {
    label: 'Tiz Boost',
    filters: [
      'Filter 1: ON HS Fc 8000 Hz Gain 5 dB',
      'Filter 2: ON PK Fc 12000 Hz Gain 2 dB Q 1.0',
    ],
  },
  loudness: {
    label: 'Loudness (V şekli)',
    filters: [
      'Filter 1: ON LS Fc 100 Hz Gain 5 dB Q 0.7',
      'Filter 2: ON PK Fc 1000 Hz Gain -2 dB Q 1.0',
      'Filter 3: ON HS Fc 10000 Hz Gain 5 dB',
    ],
  },
};

function maxPositiveGain(filters) {
  let max = 0;
  for (const f of filters) {
    const m = f.match(/Gain\s+(-?\d+(\.\d+)?)\s*dB/i);
    if (m) max = Math.max(max, parseFloat(m[1]));
  }
  return max;
}

/* Ayarlardan eq.txt içeriğini üret (clipping korumalı). */
function buildConfig(audio) {
  const enabled = !!audio.enabled;
  const presetKey = PRESETS[audio.preset] ? audio.preset : 'flat';
  const preset = PRESETS[presetKey];
  const filters = (presetKey === 'custom' && Array.isArray(audio.customBands))
    ? audio.customBands : preset.filters;

  let boost = Number(audio.boostDb) || 0;
  boost = Math.max(0, Math.min(HARD_CAP_DB, boost));

  const lines = [
    '# === Spotify Seffaf Overlay tarafindan yonetilir - elle duzenlemeyin ===',
    `# preset: ${presetKey}, boost: ${boost} dB`,
  ];

  if (!enabled) {
    lines.push('Preamp: 0 dB');
    return lines.join('\r\n') + '\r\n';
  }

  const gMax = Math.max(0, maxPositiveGain(filters));
  // Hedef tepe kazanç = boost (0..HARD_CAP). Preamp, EQ'nun pozitif tepe
  // kazancını telafi eder; böylece toplam tepe (preamp + gMax) = boost olur
  // ve HARD_CAP'i asla aşmaz (clipping/hoparlör hasarı koruması).
  const peak = Math.min(boost, HARD_CAP_DB);
  const preamp = Math.round((peak - gMax) * 10) / 10;

  lines.push(`Preamp: ${preamp} dB`);
  for (const f of filters) lines.push(f);
  return lines.join('\r\n') + '\r\n';
}

/* eq.txt'i atomik yaz (kurulumdan sonra admin gerekmez). */
function writeEq(audio) {
  const info = detect();
  if (!info.installed) return { ok: false, reason: 'not-installed' };
  if (!info.ready) return { ok: false, reason: 'not-setup' };

  const content = buildConfig(audio);
  try {
    fs.mkdirSync(info.ourDir, { recursive: true });
    const tmp = path.join(info.ourDir, `.eq.${process.pid}.tmp`);
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, info.ourFile);   // atomik
    return { ok: true, content };
  } catch (err) {
    return { ok: false, reason: 'write-failed', error: err.message };
  }
}

/* config.txt metninden bizim (bozuk/çift ters-bölü dahil) Include + yorum
   satırlarını çıkar, doğrusunu (tek ters-bölü) bir kez ekle. Kullanıcının
   diğer ayarlarına dokunmaz. */
function normalizeConfig(cfgText) {
  let lines = (cfgText || '').split(/\r?\n/)
    .filter((ln) => !INCLUDE_RE.test(ln) && ln.trim() !== '# Spotify Seffaf Overlay');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push('# Spotify Seffaf Overlay');
  lines.push(INCLUDE_LINE);
  lines.push('');
  return lines.join('\r\n');
}

/* Admin'siz doğrudan kurulum — EqualizerAPO config klasörü genelde
   kullanıcı tarafından yazılabilir; bu durumda UAC hiç gerekmez. */
function trySetupDirect(info) {
  try {
    fs.mkdirSync(info.ourDir, { recursive: true });
    if (!fs.existsSync(info.ourFile)) fs.writeFileSync(info.ourFile, 'Preamp: 0 dB\r\n', 'utf8');
    const cfg = fs.existsSync(info.configTxt) ? fs.readFileSync(info.configTxt, 'utf8') : '';
    const next = normalizeConfig(cfg);
    if (next !== cfg) fs.writeFileSync(info.configTxt, next, 'utf8');
    return { ok: true, mode: 'direct' };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code };
  }
}

function openConfigurator(info) {
  const cfgr = info.configurator || findConfigurator(info.configDir ? path.dirname(info.configDir) : null);
  if (cfgr) { try { spawn(cfgr, [], { detached: true, stdio: 'ignore' }).unref(); } catch {} }
}

// PowerShell tek-tırnak literali (ters-bölü kaçışı YOK → çift ters-bölü hatası önlenir)
function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

/* ---- Kurulum ----
   1) Önce admin'siz Node ile dene (config yazılabilirse → UAC YOK).
   2) Yazılamıyorsa yükseltilmiş (UAC) PowerShell + icacls ile. */
function runSetup({ launchConfigurator = false } = {}) {
  return new Promise((resolve) => {
    const info = detect();
    if (!info.installed) { resolve({ ok: false, reason: 'not-installed' }); return; }

    // 1) Admin'siz yol
    const direct = trySetupDirect(info);
    if (direct.ok) {
      if (launchConfigurator) openConfigurator(info);
      resolve({ ok: true, mode: 'direct' });
      return;
    }

    // 2) UAC ile yükseltilmiş yol
    const flagFile = path.join(os.tmpdir(), `seffaf-setup-${process.pid}.done`);
    const incPattern = `Include:\\s*${APP_DIR_NAME}[\\\\/]+${EQ_FILE_NAME.replace('.', '\\.')}`;
    const psLines = [
      '$ErrorActionPreference = "Stop"',
      `$ourDir = ${psQuote(info.ourDir)}`,
      `$cfgTxt = ${psQuote(info.configTxt)}`,
      `$eqFile = ${psQuote(info.ourFile)}`,
      `$incLine = ${psQuote(INCLUDE_LINE)}`,           // tek ters-bölü, literal
      `$flag = ${psQuote(flagFile)}`,
      `$pat = ${psQuote(incPattern)}`,
      'try {',
      '  New-Item -ItemType Directory -Force -Path $ourDir | Out-Null',
      "  if (-not (Test-Path -LiteralPath $eqFile)) { Set-Content -LiteralPath $eqFile -Value 'Preamp: 0 dB' -Encoding UTF8 }",
      // Kullanıcıya yazma izni (sonraki güncellemeler admin istemez): SID, olmazsa BUILTIN\\Users
      '  $grantOk = $false',
      '  try {',
      '    $sid = (New-Object System.Security.Principal.NTAccount($env:USERDOMAIN, $env:USERNAME)).Translate([System.Security.Principal.SecurityIdentifier]).Value',
      '    icacls $ourDir /grant ("*" + $sid + ":(OI)(CI)F") /T | Out-Null',
      '    if ($LASTEXITCODE -eq 0) { $grantOk = $true }',
      '  } catch {}',
      '  if (-not $grantOk) { icacls $ourDir /grant "*S-1-5-32-545:(OI)(CI)F" /T | Out-Null }',
      // Bozuk/duplike Include satırlarını temizle, doğrusunu ekle
      '  $lines = @()',
      '  if (Test-Path -LiteralPath $cfgTxt) { $lines = @(Get-Content -LiteralPath $cfgTxt) }',
      '  $lines = $lines | Where-Object { ($_ -notmatch $pat) -and ($_.Trim() -ne "# Spotify Seffaf Overlay") }',
      '  $lines += "# Spotify Seffaf Overlay"',
      '  $lines += $incLine',
      '  Set-Content -LiteralPath $cfgTxt -Value $lines -Encoding UTF8',
      '  Set-Content -LiteralPath $flag -Value "ok" -Encoding UTF8',
      '} catch {',
      '  Set-Content -LiteralPath $flag -Value ("err: " + $_.Exception.Message) -Encoding UTF8',
      '}',
    ];
    if (launchConfigurator && info.configurator) {
      psLines.push(`if (Test-Path -LiteralPath ${psQuote(info.configurator)}) { Start-Process ${psQuote(info.configurator)} }`);
    }

    const scriptPath = path.join(os.tmpdir(), `seffaf-setup-${process.pid}.ps1`);
    try { fs.writeFileSync(scriptPath, psLines.join('\r\n'), 'utf8'); }
    catch (e) { resolve({ ok: false, reason: 'script-write-failed', error: e.message }); return; }
    try { if (fs.existsSync(flagFile)) fs.unlinkSync(flagFile); } catch {}

    const inner = `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden ` +
      `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(scriptPath)}`;
    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', inner], { windowsHide: true });
    } catch (e) { resolve({ ok: false, reason: 'spawn-failed', error: e.message }); return; }

    child.on('exit', () => {
      let result;
      try {
        const flag = fs.readFileSync(flagFile, 'utf8').trim();
        result = (flag === 'ok') ? { ok: true, mode: 'elevated' } : { ok: false, reason: 'setup-error', error: flag };
      } catch {
        result = { ok: false, reason: 'cancelled' };   // UAC reddedildi / iptal
      }
      try { fs.unlinkSync(scriptPath); } catch {}
      try { fs.unlinkSync(flagFile); } catch {}
      resolve(result);
    });
    child.on('error', (err) => resolve({ ok: false, reason: 'spawn-failed', error: err.message }));
  });
}

/* Equalizer APO indirme sayfası */
const DOWNLOAD_URL = 'https://sourceforge.net/projects/equalizerapo/files/latest/download';

module.exports = {
  detect,
  writeEq,
  buildConfig,
  runSetup,
  PRESETS,
  HARD_CAP_DB,
  DOWNLOAD_URL,
};
