'use strict';

/*  SMTC medya kontrolü — kalıcı PowerShell worker üzerinden.
    Aynı worker tüm uygulama ömrü boyunca yaşar; her komut ~5-20ms sürer. */

const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'smtc-control.ps1');
const VALID  = new Set(['caps', 'play', 'pause', 'toggle', 'next', 'prev',
                        'stop', 'shuffle', 'repeat', 'seek', 'ping']);

let worker  = null;
let ready   = false;
let queue   = [];
let pending = null;
let buf     = '';

function startWorker() {
  if (worker) return;

  worker = spawn('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT
  ], { windowsHide: true });

  worker.stdout.setEncoding('utf8');
  worker.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);

      if (!ready) {
        if (line.trim() === 'READY') { ready = true; flushQueue(); }
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
    worker = null; ready = false; buf = '';
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

  worker.stderr && worker.stderr.resume();
}

function flushQueue() {
  if (pending || queue.length === 0) return;
  const item = queue.shift();
  pending = { resolve: item.resolve };
  worker.stdin.write(item.line + '\n');
}

function control(cmd, positionMs = 0) {
  return new Promise((resolve) => {
    if (!VALID.has(cmd)) { resolve({ ok: false, error: 'invalid-cmd' }); return; }
    if (!worker) startWorker();

    const line = cmd === 'seek'
      ? `seek ${Math.max(0, Math.round(positionMs))}`
      : cmd;

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
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

process.on('exit', () => { try { worker && worker.kill(); } catch {} });

module.exports = { control };
