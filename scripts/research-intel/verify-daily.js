#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { appendJsonl, deliveryReceiptsPath, summarizeDeliveryStatus, updateDeliveryStatus } = require('./lib/delivery');
const { sendTelegramDocument } = require('./lib/telegram');

const ROOT_DIR = path.join(__dirname, '../..');
const DEFAULT_PROFILE_DIR = path.join(ROOT_DIR, 'work/research-intel/profile');
const DEFAULT_RECORDS_DIR = path.join(ROOT_DIR, 'research-intel-records');

function parseArgs(argv) {
  const options = {
    rootDir: ROOT_DIR,
    profileDir: DEFAULT_PROFILE_DIR,
    recordsDir: DEFAULT_RECORDS_DIR,
    dateString: '',
    resendMissing: false,
    disableNotification: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--date') {
      options.dateString = argv[index + 1] || '';
      index += 1;
    } else if (value === '--root-dir') {
      options.rootDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--profile-dir') {
      options.profileDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--records-dir') {
      options.recordsDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--resend-missing') {
      options.resendMissing = true;
    } else if (value === '--disable-notification') {
      options.disableNotification = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function resolveDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveRepoPath(rootDir, relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) {
    return '';
  }
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(rootDir, relativeOrAbsolutePath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtimeEnvPath = path.join(options.profileDir, 'runtime.env');
  if (fs.existsSync(runtimeEnvPath)) {
    dotenv.config({ path: runtimeEnvPath, quiet: true, override: true });
  }

  const dateString = options.dateString || resolveDateString();
  const runDir = path.join(options.recordsDir, 'daily', dateString);
  const statusPath = path.join(runDir, 'delivery_status.json');
  if (!fs.existsSync(statusPath)) {
    throw new Error(`delivery status not found for ${dateString}: ${statusPath}`);
  }

  const status = readJson(statusPath);
  status.date = dateString;
  status.items = (status.items || []).map(item => ({
    ...item,
    absoluteFilePath: resolveRepoPath(options.rootDir, item.filePath)
  }));

  if (options.resendMissing) {
    for (const item of status.items) {
      if (!['pending', 'failed'].includes(String(item.status || ''))) {
        continue;
      }
      if (!item.absoluteFilePath || !fs.existsSync(item.absoluteFilePath)) {
        item.status = 'failed';
        item.error = `artifact missing: ${item.filePath || '(empty)'}`;
        updateDeliveryStatus(statusPath, status);
        continue;
      }

      const caption = item.kind === 'ledger'
        ? `${item.title || 'Research Ledger'} ${dateString}`
        : `HTML: ${String(item.title || '').slice(0, 80)}`;
      const telegramResult = await sendTelegramDocument({
        filePath: item.absoluteFilePath,
        caption,
        disableNotification: options.disableNotification
      });
      item.status = 'sent';
      item.sentAt = new Date().toISOString();
      item.messageId = telegramResult?.message_id || telegramResult?.messageId || null;
      appendJsonl(deliveryReceiptsPath(path.join(options.recordsDir, 'history')), [{
        date: dateString,
        kind: item.kind,
        title: item.title,
        filePath: item.filePath,
        fileHash: item.fileHash,
        messageId: item.messageId,
        sentAt: item.sentAt,
        runDir: path.relative(options.rootDir, runDir)
      }]);
      updateDeliveryStatus(statusPath, status);
    }
  }

  const summary = summarizeDeliveryStatus(status);
  console.log(JSON.stringify({
    date: dateString,
    statusPath,
    ...summary
  }, null, 2));

  if (!summary.ok) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`[research-intel verify] ${error.stack || error.message}`);
  process.exit(1);
});
