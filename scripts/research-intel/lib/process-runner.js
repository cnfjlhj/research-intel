#!/usr/bin/env node

const { spawn } = require('child_process');

function runCommandWithTimeout({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  input = '',
  timeoutMs = 120000,
  maxBuffer = 20 * 1024 * 1024
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let forceKillTimer = null;

    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      fn(value);
    };

    const terminateProcessGroup = signal => {
      if (!child.pid) {
        return;
      }

      try {
        if (process.platform === 'win32') {
          child.kill(signal);
        } else {
          process.kill(-child.pid, signal);
        }
      } catch {
        // Ignore races where the process already exited.
      }
    };

    const appendChunk = (target, chunk) => {
      const text = chunk.toString('utf8');
      if (target === 'stdout') {
        stdout += text;
        stdoutBytes += Buffer.byteLength(text);
        if (stdoutBytes > maxBuffer) {
          terminateProcessGroup('SIGTERM');
          finish(reject, new Error(`${command} stdout exceeded maxBuffer (${maxBuffer} bytes)`));
        }
      } else {
        stderr += text;
        stderrBytes += Buffer.byteLength(text);
        if (stderrBytes > maxBuffer) {
          terminateProcessGroup('SIGTERM');
          finish(reject, new Error(`${command} stderr exceeded maxBuffer (${maxBuffer} bytes)`));
        }
      }
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      terminateProcessGroup('SIGTERM');
      forceKillTimer = setTimeout(() => {
        terminateProcessGroup('SIGKILL');
      }, 5000);
      if (forceKillTimer.unref) {
        forceKillTimer.unref();
      }
    }, timeoutMs);
    if (timeoutHandle.unref) {
      timeoutHandle.unref();
    }

    child.stdout.on('data', chunk => appendChunk('stdout', chunk));
    child.stderr.on('data', chunk => appendChunk('stderr', chunk));

    child.on('error', error => {
      terminateProcessGroup('SIGTERM');
      finish(reject, error);
    });

    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(reject, new Error(`${command} timed out after ${timeoutMs}ms`));
        return;
      }

      finish(resolve, {
        code,
        signal,
        stdout,
        stderr
      });
    });

    if (input === undefined || input === null) {
      child.stdin.end();
    } else {
      child.stdin.end(input);
    }
  });
}

module.exports = {
  runCommandWithTimeout
};
