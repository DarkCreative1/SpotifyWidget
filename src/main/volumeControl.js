'use strict';

/*  Spotify oturum sesi (ISimpleAudioVolume) kontrolü.
    PowerShell süreci kalıcı olarak arka planda çalışır (bir kere başlar),
    komutlar stdin üzerinden gönderilir, cevaplar stdout'tan okunur.
    Bu sayede her komut ~50-100ms sürer (eskiden ~1-2 saniyeydi). */

const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'volume-control.ps1');

let worker = null;        // çalışan PowerShell süreci
let ready  = false;       // READY sinyali alındı mı
let queue  = [];          // süreci bekleyen komutlar { resolve, line }
let pending = null;       // şu an cevap beklenen komut { resolve }
let buf    = '';          // stdout tamponu

function startWorker() {
  if (worker) return;

  worker = spawn('powershell', [
    '-sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT
  ], { windowsHide: true });

  worker.stdout.setEncoding('utf8');
  worker.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);

      if (!ready) {
        if (line.trim() === 'READY') {
          ready = true;
          flushQueue();
        }
        continue;
      }

      if (pending) {
        const { resolve } = pending;
        pending = null;
        try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, raw: line }); }
        flushQueue();
      }
    }
  });

  worker.on('close', () => {
    worker = null;
    ready  = false;
    buf    = '';
    // Bekleyen komutları hata ile bitir
    if (pending) { pending.resolve({ ok: false, error: 'worker-closed' }); pending = null; }
    queue.forEach(({ resolve }) => resolve({ ok: false, error: 'worker-closed' }));
    queue = [];
  });

  worker.on('error', () => {
    worker = null; ready = false; buf = '';
    if (pending) { pending.resolve({ ok: false, error: 'spawn-failed' }); pending = null; }
    queue.forEach(({ resolve }) => resolve({ ok: false, error: 'spawn-failed' }));
    queue = [];
  });

  // stderr'i yut (Add-Type hataları vs.)
  worker.stderr && worker.stderr.resume();
}

function flushQueue() {
  if (pending || queue.length === 0) return;
  const item = queue.shift();
  pending = { resolve: item.resolve };
  worker.stdin.write(item.line + '\n');
}

function control(cmd, level = 0) {
  return new Promise((resolve) => {
    // Worker yoksa başlat
    if (!worker) startWorker();

    let line;
    if (cmd === 'set') {
      const lvl = Math.max(0, Math.min(1, Number(level) || 0));
      line = `set ${lvl.toFixed(4)}`;
    } else {
      const VALID = new Set(['get', 'mute', 'unmute', 'ping']);
      if (!VALID.has(cmd)) { resolve({ ok: false, error: 'invalid-cmd' }); return; }
      line = cmd;
    }

    // Kuyruk zaman aşımı: 5 saniye içinde cevap gelmezse hata ver
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Kuyruktan çıkar
      queue = queue.filter(q => q.resolve !== resolve);
      resolve({ ok: false, error: 'timeout' });
    }, 5000);

    queue.push({
      line,
      resolve: (val) => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve(val);
      }
    });

    if (ready && !pending) flushQueue();
  });
}

// Uygulama kapanırken worker'ı temizle
process.on('exit', () => { try { worker && worker.kill(); } catch {} });

module.exports = { control };
