#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildDeliveryPlan,
  summarizeDeliveryStatus
} = require('../scripts/research-intel/lib/delivery');

test('buildDeliveryPlan reuses same-day receipts for identical files and marks only missing items as pending', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-delivery-'));
  const historyDir = path.join(rootDir, 'history');
  const papersDir = path.join(rootDir, 'papers');
  fs.mkdirSync(historyDir, { recursive: true });
  fs.mkdirSync(papersDir, { recursive: true });

  const paperOnePath = path.join(papersDir, 'paper-1.html');
  const paperTwoPath = path.join(papersDir, 'paper-2.html');
  const ledgerPath = path.join(rootDir, 'method_tree.md');
  fs.writeFileSync(paperOnePath, '<html>paper one</html>\n', 'utf8');
  fs.writeFileSync(paperTwoPath, '<html>paper two</html>\n', 'utf8');
  fs.writeFileSync(ledgerPath, '# ledger\n', 'utf8');

  const initialPlan = buildDeliveryPlan({
    dateString: '2026-03-15',
    historyDir,
    paperFiles: [
      { title: 'Paper One', filePath: paperOnePath },
      { title: 'Paper Two', filePath: paperTwoPath }
    ],
    ledgerPath
  });

  const paperOne = initialPlan.items.find(item => item.title === 'Paper One');
  assert.ok(paperOne);
  fs.writeFileSync(
    path.join(historyDir, 'telegram_receipts.jsonl'),
    `${JSON.stringify({
      date: '2026-03-15',
      kind: paperOne.kind,
      title: paperOne.title,
      fileHash: paperOne.fileHash,
      messageId: 101
    })}\n`,
    'utf8'
  );

  const plan = buildDeliveryPlan({
    dateString: '2026-03-15',
    historyDir,
    paperFiles: [
      { title: 'Paper One', filePath: paperOnePath },
      { title: 'Paper Two', filePath: paperTwoPath }
    ],
    ledgerPath
  });

  assert.equal(plan.expectedCount, 3);
  assert.equal(plan.completedCount, 1);
  assert.equal(plan.pendingCount, 2);
  assert.equal(plan.items.find(item => item.title === 'Paper One').status, 'already_sent_same_hash');
  assert.equal(plan.items.find(item => item.title === 'Paper Two').status, 'pending');
  assert.equal(plan.items.find(item => item.kind === 'ledger').status, 'pending');
});

test('summarizeDeliveryStatus counts sent and missing items from a persisted status payload', () => {
  const summary = summarizeDeliveryStatus({
    expectedCount: 4,
    items: [
      { status: 'sent' },
      { status: 'already_sent_same_hash' },
      { status: 'failed' },
      { status: 'pending' }
    ]
  });

  assert.deepEqual(summary, {
    expectedCount: 4,
    completedCount: 2,
    failedCount: 1,
    pendingCount: 1,
    missingCount: 2,
    ok: false
  });
});
