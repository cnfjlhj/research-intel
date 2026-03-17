const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  addMinutes,
  buildCronLine,
  loadScheduleConfig,
  normalizeSendTime,
  todayInTimezone
} = require('../scripts/research-intel/lib/schedule');

test('normalizeSendTime keeps valid hh:mm and falls back for invalid values', () => {
  assert.equal(normalizeSendTime('6:05'), '06:05');
  assert.equal(normalizeSendTime('25:00'), '06:00');
  assert.equal(normalizeSendTime('nope'), '06:00');
});

test('addMinutes wraps across midnight', () => {
  assert.equal(addMinutes('23:50', 20), '00:10');
  assert.equal(addMinutes('06:00', 40), '06:40');
});

test('buildCronLine converts hh:mm into cron syntax', () => {
  const line = buildCronLine({
    hhmm: '07:15',
    projectDir: '/tmp/research-intel',
    scriptPath: '/tmp/research-intel/scripts/research-intel/run-daily.sh',
    tag: '# research-intel-daily'
  });

  assert.equal(
    line,
    '15 07 * * * cd "/tmp/research-intel" && "/tmp/research-intel/scripts/research-intel/run-daily.sh" # research-intel-daily'
  );
});

test('loadScheduleConfig reads send_time and timezone from research_brief and derives verify time', () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-schedule-'));
  fs.writeFileSync(
    path.join(profileDir, 'research_brief.md'),
    [
      '---',
      'timezone: Europe/Berlin',
      'send_time: "07:15"',
      '---',
      '',
      '# Research Brief',
      '',
      '## Current Goal',
      '- demo'
    ].join('\n'),
    'utf8'
  );

  const config = loadScheduleConfig({
    profileDir,
    env: { RESEARCH_INTEL_VERIFY_DELAY_MINUTES: '50' }
  });

  assert.equal(config.timezone, 'Europe/Berlin');
  assert.equal(config.sendTime, '07:15');
  assert.equal(config.verifyDelayMinutes, 50);
  assert.equal(config.verifyTime, '08:05');
});

test('loadScheduleConfig falls back to the default verify delay when env is unset or blank', () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-schedule-'));
  fs.writeFileSync(
    path.join(profileDir, 'research_brief.md'),
    [
      '---',
      'timezone: Asia/Shanghai',
      'send_time: "06:00"',
      '---',
      '',
      '# Research Brief',
      '',
      '## Current Goal',
      '- demo'
    ].join('\n'),
    'utf8'
  );

  const unsetConfig = loadScheduleConfig({
    profileDir,
    env: {}
  });
  const blankConfig = loadScheduleConfig({
    profileDir,
    env: { RESEARCH_INTEL_VERIFY_DELAY_MINUTES: '   ' }
  });

  assert.equal(unsetConfig.verifyDelayMinutes, 40);
  assert.equal(unsetConfig.verifyTime, '06:40');
  assert.equal(blankConfig.verifyDelayMinutes, 40);
  assert.equal(blankConfig.verifyTime, '06:40');
});

test('todayInTimezone returns a stable YYYY-MM-DD string', () => {
  const value = todayInTimezone('Asia/Shanghai', new Date('2026-03-15T00:30:00Z'));
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
});
