#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

const {
  buildCronLine,
  loadScheduleConfig,
  todayInTimezone
} = require('./lib/schedule');

function parseArgs(argv) {
  const options = {
    projectDir: path.join(__dirname, '../..'),
    runScript: '',
    verifyScript: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--project-dir') {
      options.projectDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--run-script') {
      options.runScript = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--verify-script') {
      options.verifyScript = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  dotenv.config({ path: path.join(options.projectDir, '.env'), quiet: true });

  const schedule = loadScheduleConfig({
    profileDir: path.join(options.projectDir, 'work', 'research-intel', 'profile'),
    env: process.env
  });

  const output = {
    TIMEZONE: schedule.timezone,
    SEND_TIME: schedule.sendTime,
    VERIFY_TIME: schedule.verifyTime,
    VERIFY_DELAY_MINUTES: String(schedule.verifyDelayMinutes),
    TODAY: todayInTimezone(schedule.timezone)
  };

  if (options.runScript) {
    output.DAILY_CRON_LINE = buildCronLine({
      hhmm: schedule.sendTime,
      projectDir: options.projectDir,
      scriptPath: options.runScript,
      tag: '# research-intel-daily'
    });
  }

  if (options.verifyScript) {
    output.VERIFY_CRON_LINE = buildCronLine({
      hhmm: schedule.verifyTime,
      projectDir: options.projectDir,
      scriptPath: options.verifyScript,
      tag: '# research-intel-daily-verify'
    });
  }

  for (const [key, value] of Object.entries(output)) {
    console.log(`${key}=${value}`);
  }
}

if (require.main === module) {
  main();
}
