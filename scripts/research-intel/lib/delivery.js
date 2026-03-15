#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

function appendJsonl(filePath, records) {
  if (!records.length) {
    return;
  }
  ensureDir(path.dirname(filePath));
  const payload = records.map(record => JSON.stringify(record)).join('\n');
  fs.appendFileSync(filePath, `${payload}\n`, 'utf8');
}

function hashFile(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function deliveryReceiptsPath(historyDir) {
  return path.join(historyDir, 'telegram_receipts.jsonl');
}

function loadDeliveryReceipts(historyDir) {
  return readJsonl(deliveryReceiptsPath(historyDir));
}

function normalizeDeliveryTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function summarizeDeliveryStatus(status = {}) {
  const items = Array.isArray(status.items) ? status.items : [];
  const completedCount = items.filter(item => item.status === 'sent' || item.status === 'already_sent_same_hash').length;
  const failedCount = items.filter(item => item.status === 'failed').length;
  const pendingCount = items.filter(item => !item.status || item.status === 'pending').length;
  const expectedCount = Number(status.expectedCount || items.length || 0);
  return {
    expectedCount,
    completedCount,
    failedCount,
    pendingCount,
    missingCount: Math.max(0, expectedCount - completedCount),
    ok: expectedCount > 0 && completedCount === expectedCount && failedCount === 0
  };
}

function buildDeliveryPlan({
  dateString,
  historyDir,
  paperFiles = [],
  ledgerPath = ''
}) {
  const receipts = loadDeliveryReceipts(historyDir);
  const items = [
    ...(paperFiles || []).map(item => ({
      kind: 'paper_html',
      title: item.title,
      filePath: item.filePath
    })),
    ...(ledgerPath ? [{
      kind: 'ledger',
      title: 'Research Ledger',
      filePath: ledgerPath
    }] : [])
  ].map(item => {
    const fileHash = hashFile(item.filePath);
    const existingReceipt = receipts.find(receipt => (
      String(receipt.date || '') === String(dateString || '')
        && String(receipt.kind || '') === String(item.kind || '')
        && String(receipt.fileHash || '') === fileHash
        && normalizeDeliveryTitle(receipt.title) === normalizeDeliveryTitle(item.title)
    )) || null;

    return {
      ...item,
      fileHash,
      status: existingReceipt ? 'already_sent_same_hash' : 'pending',
      existingReceipt
    };
  });

  const summary = summarizeDeliveryStatus({
    expectedCount: items.length,
    items
  });

  return {
    date: dateString,
    items,
    expectedCount: items.length,
    completedCount: summary.completedCount,
    pendingCount: summary.pendingCount
  };
}

function updateDeliveryStatus(statusPath, status) {
  ensureDir(path.dirname(statusPath));
  fs.writeFileSync(statusPath, `${JSON.stringify({
    ...status,
    ...summarizeDeliveryStatus(status),
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`, 'utf8');
}

module.exports = {
  appendJsonl,
  buildDeliveryPlan,
  deliveryReceiptsPath,
  hashFile,
  loadDeliveryReceipts,
  summarizeDeliveryStatus,
  updateDeliveryStatus
};
