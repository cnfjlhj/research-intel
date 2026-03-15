#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  appendJsonl,
  buildDeliveryPlan,
  deliveryReceiptsPath,
  hashFile,
  loadDeliveryReceipts,
  updateDeliveryStatus
} = require('./lib/delivery');

const ROOT_DIR = path.join(__dirname, '../..');
const DEFAULT_RECORDS_DIR = path.join(ROOT_DIR, 'research-intel-records');

function parseArgs(argv) {
  const options = {
    rootDir: ROOT_DIR,
    recordsDir: DEFAULT_RECORDS_DIR,
    dateString: '',
    nowIso: new Date().toISOString(),
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root-dir') {
      options.rootDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--records-dir') {
      options.recordsDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--date') {
      options.dateString = argv[index + 1] || '';
      index += 1;
    } else if (value === '--now-iso') {
      options.nowIso = argv[index + 1] || options.nowIso;
      index += 1;
    } else if (value === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function repoRelativePath(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function buildReceiptKey(record) {
  return [
    String(record.date || ''),
    String(record.kind || ''),
    normalizeTitle(record.title),
    String(record.fileHash || '')
  ].join('::');
}

function groupSentEntriesByDate(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const dateString = String(entry.date || '').trim();
    if (!dateString) {
      continue;
    }
    if (!groups.has(dateString)) {
      groups.set(dateString, []);
    }
    groups.get(dateString).push(entry);
  }
  return groups;
}

function collectArtifactsForDate({ rootDir, recordsDir, dateString, entries }) {
  const uniquePaperKeys = new Set();
  const paperFiles = [];
  const missingFiles = [];

  for (const entry of entries) {
    const title = String(entry.title || '').trim();
    const htmlPath = String(entry.htmlPath || '').trim();
    if (!title || !htmlPath) {
      continue;
    }
    const uniqueKey = `${normalizeTitle(title)}::${htmlPath}`;
    if (uniquePaperKeys.has(uniqueKey)) {
      continue;
    }
    uniquePaperKeys.add(uniqueKey);

    const absoluteFilePath = path.resolve(rootDir, htmlPath);
    if (!fs.existsSync(absoluteFilePath)) {
      missingFiles.push(htmlPath);
      continue;
    }

    paperFiles.push({
      title,
      filePath: absoluteFilePath
    });
  }

  const workLedgerPath = path.join(rootDir, 'work', 'research-intel', 'daily', dateString, 'method_tree.md');
  const recordsLedgerPath = path.join(recordsDir, 'daily', dateString, 'method_tree.md');
  const ledgerPath = fs.existsSync(workLedgerPath)
    ? workLedgerPath
    : (fs.existsSync(recordsLedgerPath) ? recordsLedgerPath : '');

  return {
    paperFiles,
    ledgerPath,
    missingFiles
  };
}

function buildBackfillReceipts({ rootDir, dateString, paperFiles, ledgerPath, nowIso }) {
  const records = [];

  for (const paper of paperFiles) {
    const relativeFilePath = repoRelativePath(rootDir, paper.filePath);
    records.push({
      date: dateString,
      kind: 'paper_html',
      title: paper.title,
      filePath: relativeFilePath,
      fileHash: hashFile(paper.filePath),
      messageId: null,
      sentAt: nowIso,
      runDir: relativeFilePath.split('/papers/')[0] || path.posix.dirname(relativeFilePath)
    });
  }

  if (ledgerPath) {
    records.push({
      date: dateString,
      kind: 'ledger',
      title: 'Research Ledger',
      filePath: repoRelativePath(rootDir, ledgerPath),
      fileHash: hashFile(ledgerPath),
      messageId: null,
      sentAt: nowIso,
      runDir: repoRelativePath(rootDir, path.dirname(ledgerPath))
    });
  }

  return records;
}

function persistDeliveryStatusForDate({
  rootDir,
  recordsDir,
  historyDir,
  dateString,
  paperFiles,
  ledgerPath
}) {
  const workRunDir = path.join(rootDir, 'work', 'research-intel', 'daily', dateString);
  const recordsRunDir = path.join(recordsDir, 'daily', dateString);
  const deliveryPlan = buildDeliveryPlan({
    dateString,
    historyDir,
    paperFiles,
    ledgerPath
  });

  const persistedStatus = {
    ...deliveryPlan,
    runDir: repoRelativePath(rootDir, workRunDir),
    items: (deliveryPlan.items || []).map(item => ({
      ...item,
      filePath: item.filePath ? repoRelativePath(rootDir, item.filePath) : '',
      existingReceipt: item.existingReceipt ? {
        ...item.existingReceipt,
        filePath: item.existingReceipt.filePath ? String(item.existingReceipt.filePath) : ''
      } : null
    }))
  };

  const targets = [
    path.join(workRunDir, 'delivery_status.json'),
    path.join(recordsRunDir, 'delivery_status.json')
  ];

  for (const statusPath of targets) {
    ensureDir(path.dirname(statusPath));
    updateDeliveryStatus(statusPath, persistedStatus);
  }

  return targets.length;
}

function backfillDeliveryHistory({
  rootDir = ROOT_DIR,
  recordsDir = DEFAULT_RECORDS_DIR,
  dateString = '',
  nowIso = new Date().toISOString(),
  dryRun = false
} = {}) {
  const historyDir = path.join(recordsDir, 'history');
  const sentHistoryPath = path.join(historyDir, 'sent_papers.jsonl');
  const sentEntries = readJsonl(sentHistoryPath)
    .filter(entry => !dateString || String(entry.date || '') === String(dateString));
  const groupedEntries = groupSentEntriesByDate(sentEntries);
  const existingReceipts = loadDeliveryReceipts(historyDir);
  const existingReceiptKeys = new Set(existingReceipts.map(buildReceiptKey));
  const createdRecords = [];
  let updatedStatuses = 0;
  let skippedMissingFiles = 0;

  for (const [currentDate, entries] of groupedEntries.entries()) {
    const artifacts = collectArtifactsForDate({
      rootDir,
      recordsDir,
      dateString: currentDate,
      entries
    });
    skippedMissingFiles += artifacts.missingFiles.length;

    const nextRecords = buildBackfillReceipts({
      rootDir,
      dateString: currentDate,
      paperFiles: artifacts.paperFiles,
      ledgerPath: artifacts.ledgerPath,
      nowIso
    }).filter(record => {
      const key = buildReceiptKey(record);
      if (existingReceiptKeys.has(key)) {
        return false;
      }
      existingReceiptKeys.add(key);
      return true;
    });

    createdRecords.push(...nextRecords);

    if (!dryRun && (artifacts.paperFiles.length || artifacts.ledgerPath)) {
      updatedStatuses += persistDeliveryStatusForDate({
        rootDir,
        recordsDir,
        historyDir,
        dateString: currentDate,
        paperFiles: artifacts.paperFiles,
        ledgerPath: artifacts.ledgerPath
      });
    }
  }

  if (!dryRun) {
    appendJsonl(deliveryReceiptsPath(historyDir), createdRecords);
    if (createdRecords.length) {
      for (const currentDate of groupedEntries.keys()) {
        const artifacts = collectArtifactsForDate({
          rootDir,
          recordsDir,
          dateString: currentDate,
          entries: groupedEntries.get(currentDate)
        });
        if (!(artifacts.paperFiles.length || artifacts.ledgerPath)) {
          continue;
        }
        persistDeliveryStatusForDate({
          rootDir,
          recordsDir,
          historyDir,
          dateString: currentDate,
          paperFiles: artifacts.paperFiles,
          ledgerPath: artifacts.ledgerPath
        });
      }
    }
  }

  return {
    dates: [...groupedEntries.keys()],
    createdReceipts: createdRecords.length,
    updatedStatuses,
    skippedMissingFiles
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = backfillDeliveryHistory(options);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  backfillDeliveryHistory
};
