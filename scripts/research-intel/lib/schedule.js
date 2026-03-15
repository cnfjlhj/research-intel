#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { parseResearchBrief } = require('./core');

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_SEND_TIME = '06:00';
const DEFAULT_VERIFY_DELAY_MINUTES = 40;

function normalizeTimezone(value) {
  const timezone = String(value || '').trim();
  return timezone || DEFAULT_TIMEZONE;
}

function normalizeSendTime(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return DEFAULT_SEND_TIME;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return DEFAULT_SEND_TIME;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseVerifyDelayMinutes(value) {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) {
    return DEFAULT_VERIFY_DELAY_MINUTES;
  }
  return Math.max(0, Math.trunc(parsed));
}

function addMinutes(hhmm, deltaMinutes) {
  const [hoursRaw, minutesRaw] = normalizeSendTime(hhmm).split(':');
  const total = (Number(hoursRaw) * 60) + Number(minutesRaw) + Number(deltaMinutes || 0);
  const normalized = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = String(Math.floor(normalized / 60)).padStart(2, '0');
  const minutes = String(normalized % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function datePartsInTimezone(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return {
    dateString: `${values.year}-${values.month}-${values.day}`,
    minuteString: `${values.hour}:${values.minute}`
  };
}

function todayInTimezone(timezone, date = new Date()) {
  return datePartsInTimezone(timezone, date).dateString;
}

function splitCronTime(hhmm) {
  const [hour, minute] = normalizeSendTime(hhmm).split(':');
  return { hour, minute };
}

function shellEscape(value) {
  return String(value || '').replace(/(["\\$`])/g, '\\$1');
}

function buildCronLine({ hhmm, projectDir, scriptPath, tag }) {
  const { hour, minute } = splitCronTime(hhmm);
  return `${minute} ${hour} * * * cd "${shellEscape(projectDir)}" && "${shellEscape(scriptPath)}" ${tag}`;
}

function loadScheduleConfig({ profileDir, env = process.env }) {
  const briefPath = path.join(profileDir, 'research_brief.md');
  const brief = fs.existsSync(briefPath)
    ? parseResearchBrief(fs.readFileSync(briefPath, 'utf8'))
    : {};
  const timezone = normalizeTimezone(brief.timezone || env.RESEARCH_INTEL_TIMEZONE);
  const sendTime = normalizeSendTime(brief.sendTime || env.RESEARCH_INTEL_SEND_TIME);
  const verifyDelayMinutes = parseVerifyDelayMinutes(env.RESEARCH_INTEL_VERIFY_DELAY_MINUTES);

  return {
    timezone,
    sendTime,
    verifyDelayMinutes,
    verifyTime: addMinutes(sendTime, verifyDelayMinutes)
  };
}

module.exports = {
  DEFAULT_SEND_TIME,
  DEFAULT_TIMEZONE,
  DEFAULT_VERIFY_DELAY_MINUTES,
  addMinutes,
  buildCronLine,
  datePartsInTimezone,
  loadScheduleConfig,
  normalizeSendTime,
  normalizeTimezone,
  parseVerifyDelayMinutes,
  splitCronTime,
  todayInTimezone
};
