#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });

const {
  datePartsInTimezone,
  loadScheduleConfig
} = require('./lib/schedule');

const ROOT_DIR = path.join(__dirname, '../..');
const PROFILE_DIR = path.join(ROOT_DIR, 'work', 'research-intel', 'profile');
const RUNTIME_DIR = path.join(ROOT_DIR, 'work', 'research-intel', 'runtime');
const STATE_PATH = path.join(RUNTIME_DIR, 'scheduler-state.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(value) {
  ensureDir(path.dirname(STATE_PATH));
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function commandForDailyRun() {
  return {
    file: path.join(ROOT_DIR, 'scripts', 'research-intel', 'codex-supervisor.js'),
    args: []
  };
}

function executeNodeScript(scriptFile, args = []) {
  const result = spawnSync(process.execPath, [scriptFile, ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${scriptFile} ${args.join(' ')}`.trim());
  }
}

async function main() {
  ensureDir(RUNTIME_DIR);
  const pollSeconds = Number(process.env.RESEARCH_INTEL_SCHEDULE_POLL_SECONDS || '60');
  const verifyDelayMinutes = Number(process.env.RESEARCH_INTEL_VERIFY_DELAY_MINUTES || '40');

  console.log('research-intel scheduler started (mainline: codex-supervisor)');

  while (true) {
    const schedule = loadScheduleConfig({
      profileDir: PROFILE_DIR,
      env: {
        ...process.env,
        RESEARCH_INTEL_VERIFY_DELAY_MINUTES: String(verifyDelayMinutes)
      }
    });
    const timezone = schedule.timezone;
    const sendTime = schedule.sendTime;
    const verifyTime = schedule.verifyTime;
    const now = datePartsInTimezone(timezone);
    const state = readState();

    try {
      if (now.minuteString === sendTime && state.lastDailyDate !== now.dateString) {
        const command = commandForDailyRun();
        console.log(`[scheduler] trigger daily for ${now.dateString} at ${now.minuteString}`);
        executeNodeScript(command.file, command.args);
        writeState({
          ...state,
          lastDailyDate: now.dateString,
          lastDailyAt: new Date().toISOString()
        });
      }

      if (now.minuteString === verifyTime && state.lastVerifyDate !== now.dateString) {
        console.log(`[scheduler] trigger verify for ${now.dateString} at ${now.minuteString}`);
        executeNodeScript(
          path.join(ROOT_DIR, 'scripts', 'research-intel', 'verify-daily.js'),
          ['--date', now.dateString, '--resend-missing']
        );
        writeState({
          ...readState(),
          lastVerifyDate: now.dateString,
          lastVerifyAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error(`[scheduler] ${error.stack || error.message || error}`);
    }

    await sleep(Math.max(5, pollSeconds) * 1000);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  datePartsInTimezone
};
