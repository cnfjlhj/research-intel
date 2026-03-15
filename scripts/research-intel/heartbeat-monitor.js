#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

const { sendTelegramMessage } = require('./lib/telegram');
const {
  ACTIVE_RUN_STATUSES,
  FINAL_RUN_STATUSES,
  buildRuntimePaths,
  buildHeartbeatSnapshot,
  reconcileCurrentRunWithHeartbeat
} = require('./lib/worker');

function parseArgs(argv) {
  const options = {
    sessionName: '',
    baseDir: '',
    staleAfterSec: 20 * 60,
    intervalSec: 20
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--session-name') {
      options.sessionName = argv[index + 1];
      index += 1;
    } else if (value === '--base-dir') {
      options.baseDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--stale-after-sec') {
      options.staleAfterSec = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--interval-sec') {
      options.intervalSec = Number(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!options.sessionName) {
    throw new Error('Missing --session-name');
  }
  if (!options.baseDir) {
    throw new Error('Missing --base-dir');
  }

  return options;
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sessionExists(sessionName) {
  const result = spawnSync('tmux', ['has-session', '-t', sessionName], {
    encoding: 'utf8'
  });
  return result.status === 0;
}

function capturePane(sessionName) {
  const result = spawnSync('tmux', ['capture-pane', '-t', sessionName, '-p'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`tmux capture-pane failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout || '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function removeFileIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    void error;
  }
}

async function sendSafeTelegram(text) {
  try {
    await sendTelegramMessage({ text, disableNotification: false });
  } catch (error) {
    console.error(`Telegram alert failed: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtimePaths = buildRuntimePaths(options.baseDir);
  const staleAfterMs = options.staleAfterSec * 1000;
  const intervalMs = options.intervalSec * 1000;

  ensureDir(runtimePaths.runtimeDir);
  const monitorState = readJsonIfExists(runtimePaths.monitorStatePath) || {};

  let lastPaneHash = monitorState.lastPaneHash || '';
  let lastChangeAt = monitorState.lastChangeAt || new Date().toISOString();
  let staleAlertSentAt = monitorState.staleAlertSentAt || '';
  let recoveryAlertSentAt = monitorState.recoveryAlertSentAt || '';
  let missingSessionAlertSentAt = monitorState.missingSessionAlertSentAt || '';

  const cleanup = () => {
    removeFileIfExists(runtimePaths.monitorPidPath);
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  while (true) {
    const checkedAt = new Date().toISOString();
    const currentRun = readJsonIfExists(runtimePaths.currentRunPath);

    if (!sessionExists(options.sessionName)) {
      const snapshot = buildHeartbeatSnapshot({
        sessionName: options.sessionName,
        paneText: '',
        checkedAt,
        lastChangeAt: checkedAt,
        currentRun,
        staleAfterMs,
        alive: false
      });
      writeJson(runtimePaths.heartbeatPath, snapshot);

      if (currentRun && ACTIVE_RUN_STATUSES.has(currentRun.status)) {
        const updatedRun = reconcileCurrentRunWithHeartbeat(currentRun, snapshot);
        writeJson(runtimePaths.currentRunPath, updatedRun);
        if (!missingSessionAlertSentAt) {
          await sendSafeTelegram(
            [
              'Research Intelligence worker 会话丢失。',
              `date: ${currentRun.date || ''}`,
              `session: ${options.sessionName}`,
              `status file: ${runtimePaths.currentRunPath}`
            ].join('\n')
          );
          missingSessionAlertSentAt = checkedAt;
        }
      }

      writeJson(runtimePaths.monitorStatePath, {
        sessionName: options.sessionName,
        checkedAt,
        lastChangeAt,
        staleAlertSentAt,
        recoveryAlertSentAt,
        missingSessionAlertSentAt,
        lastPaneHash
      });
      cleanup();
      return;
    }

    const paneText = capturePane(options.sessionName);
    const snapshot = buildHeartbeatSnapshot({
      sessionName: options.sessionName,
      paneText,
      checkedAt,
      lastChangeAt,
      currentRun,
      staleAfterMs,
      alive: true
    });

    if (snapshot.paneHash !== lastPaneHash) {
      lastPaneHash = snapshot.paneHash;
      lastChangeAt = checkedAt;
    }

    const refreshedSnapshot = buildHeartbeatSnapshot({
      sessionName: options.sessionName,
      paneText,
      checkedAt,
      lastChangeAt,
      currentRun,
      staleAfterMs,
      alive: true
    });
    writeJson(runtimePaths.heartbeatPath, refreshedSnapshot);

    const reconciledRun = reconcileCurrentRunWithHeartbeat(currentRun, refreshedSnapshot);
    if (JSON.stringify(reconciledRun) !== JSON.stringify(currentRun)) {
      writeJson(runtimePaths.currentRunPath, reconciledRun);
    }

    if (reconciledRun && ACTIVE_RUN_STATUSES.has(reconciledRun.status)) {
      if (refreshedSnapshot.stale && !staleAlertSentAt) {
        await sendSafeTelegram(
          [
            'Research Intelligence worker 疑似卡住。',
            `date: ${reconciledRun.date || ''}`,
            `session: ${options.sessionName}`,
            `seconds_since_change: ${refreshedSnapshot.secondsSinceChange}`,
            `attach: tmux attach -t ${options.sessionName}`
          ].join('\n')
        );
        staleAlertSentAt = checkedAt;
        recoveryAlertSentAt = '';
      } else if (!refreshedSnapshot.stale && staleAlertSentAt && !recoveryAlertSentAt) {
        await sendSafeTelegram(
          [
            'Research Intelligence worker 已恢复输出。',
            `date: ${reconciledRun.date || ''}`,
            `session: ${options.sessionName}`,
            `last_line: ${refreshedSnapshot.lastNonEmptyLine || '(empty)'}`
          ].join('\n')
        );
        recoveryAlertSentAt = checkedAt;
      }
    }

    writeJson(runtimePaths.monitorStatePath, {
      sessionName: options.sessionName,
      checkedAt,
      lastChangeAt,
      staleAlertSentAt,
      recoveryAlertSentAt,
      missingSessionAlertSentAt,
      lastPaneHash
    });

    if (reconciledRun && FINAL_RUN_STATUSES.has(reconciledRun.status)) {
      writeJson(runtimePaths.heartbeatPath, {
        ...refreshedSnapshot,
        alive: false,
        historical: true,
        endedAt: checkedAt,
        run: reconciledRun ? {
          date: reconciledRun.date || '',
          status: reconciledRun.status || '',
          sessionName: reconciledRun.sessionName || options.sessionName
        } : refreshedSnapshot.run
      });
      cleanup();
      return;
    }

    await sleep(intervalMs);
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
