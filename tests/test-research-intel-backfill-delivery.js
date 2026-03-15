#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  backfillDeliveryHistory
} = require('../scripts/research-intel/backfill-delivery-history');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test('backfillDeliveryHistory creates receipts and already-sent delivery status from sent paper history', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-backfill-'));
  const recordsDir = path.join(rootDir, 'research-intel-records');
  const historyDir = path.join(recordsDir, 'history');
  const dateString = '2026-03-15';
  const runDir = path.join(rootDir, 'work', 'research-intel', 'daily', dateString);
  const recordsRunDir = path.join(recordsDir, 'daily', dateString);
  const paperOnePath = path.join(runDir, 'papers', '01-paper-one', 'index.html');
  const paperTwoPath = path.join(runDir, 'papers', '02-paper-two', 'index.html');
  const ledgerPath = path.join(runDir, 'method_tree.md');

  fs.mkdirSync(historyDir, { recursive: true });
  fs.mkdirSync(recordsRunDir, { recursive: true });
  fs.mkdirSync(path.dirname(paperOnePath), { recursive: true });
  fs.mkdirSync(path.dirname(paperTwoPath), { recursive: true });
  fs.writeFileSync(paperOnePath, '<html>paper one</html>\n', 'utf8');
  fs.writeFileSync(paperTwoPath, '<html>paper two</html>\n', 'utf8');
  fs.writeFileSync(ledgerPath, '# ledger\n', 'utf8');
  fs.writeFileSync(path.join(recordsRunDir, 'method_tree.md'), '# ledger\n', 'utf8');
  writeJson(path.join(recordsRunDir, 'selected_papers.json'), [
    { title: 'Paper One', htmlPath: 'work/research-intel/daily/2026-03-15/papers/01-paper-one/index.html' },
    { title: 'Paper Two', htmlPath: 'work/research-intel/daily/2026-03-15/papers/02-paper-two/index.html' }
  ]);

  fs.writeFileSync(path.join(historyDir, 'sent_papers.jsonl'), [
    JSON.stringify({
      date: dateString,
      title: 'Paper One',
      htmlPath: 'work/research-intel/daily/2026-03-15/papers/01-paper-one/index.html'
    }),
    JSON.stringify({
      date: dateString,
      title: 'Paper One',
      htmlPath: 'work/research-intel/daily/2026-03-15/papers/01-paper-one/index.html'
    }),
    JSON.stringify({
      date: dateString,
      title: 'Paper Two',
      htmlPath: 'work/research-intel/daily/2026-03-15/papers/02-paper-two/index.html'
    })
  ].join('\n') + '\n', 'utf8');

  const result = backfillDeliveryHistory({
    rootDir,
    recordsDir,
    nowIso: '2026-03-15T01:23:45.000Z'
  });

  assert.equal(result.createdReceipts, 3);
  assert.equal(result.updatedStatuses, 2);

  const receipts = readJsonl(path.join(historyDir, 'telegram_receipts.jsonl'));
  assert.equal(receipts.length, 3);
  assert.deepEqual(
    receipts.map(item => [item.kind, item.title]),
    [
      ['paper_html', 'Paper One'],
      ['paper_html', 'Paper Two'],
      ['ledger', 'Research Ledger']
    ]
  );

  const workStatus = readJson(path.join(runDir, 'delivery_status.json'));
  const recordsStatus = readJson(path.join(recordsRunDir, 'delivery_status.json'));
  assert.equal(workStatus.expectedCount, 3);
  assert.equal(workStatus.completedCount, 3);
  assert.equal(workStatus.pendingCount, 0);
  assert.ok(workStatus.items.every(item => item.status === 'already_sent_same_hash'));
  assert.deepEqual(
    recordsStatus.items.map(item => item.filePath),
    [
      'work/research-intel/daily/2026-03-15/papers/01-paper-one/index.html',
      'work/research-intel/daily/2026-03-15/papers/02-paper-two/index.html',
      'work/research-intel/daily/2026-03-15/method_tree.md'
    ]
  );
});

test('backfillDeliveryHistory is idempotent when receipts already exist', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-backfill-idempotent-'));
  const recordsDir = path.join(rootDir, 'research-intel-records');
  const historyDir = path.join(recordsDir, 'history');
  const dateString = '2026-03-16';
  const runDir = path.join(rootDir, 'work', 'research-intel', 'daily', dateString);
  const recordsRunDir = path.join(recordsDir, 'daily', dateString);
  const paperPath = path.join(runDir, 'papers', '01-paper-one', 'index.html');

  fs.mkdirSync(historyDir, { recursive: true });
  fs.mkdirSync(recordsRunDir, { recursive: true });
  fs.mkdirSync(path.dirname(paperPath), { recursive: true });
  fs.writeFileSync(paperPath, '<html>paper one</html>\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'method_tree.md'), '# ledger\n', 'utf8');
  fs.writeFileSync(path.join(recordsRunDir, 'method_tree.md'), '# ledger\n', 'utf8');

  fs.writeFileSync(path.join(historyDir, 'sent_papers.jsonl'), `${JSON.stringify({
    date: dateString,
    title: 'Paper One',
    htmlPath: 'work/research-intel/daily/2026-03-16/papers/01-paper-one/index.html'
  })}\n`, 'utf8');

  const first = backfillDeliveryHistory({ rootDir, recordsDir, nowIso: '2026-03-16T01:23:45.000Z' });
  const second = backfillDeliveryHistory({ rootDir, recordsDir, nowIso: '2026-03-16T01:24:45.000Z' });

  assert.equal(first.createdReceipts, 2);
  assert.equal(second.createdReceipts, 0);
  assert.equal(readJsonl(path.join(historyDir, 'telegram_receipts.jsonl')).length, 2);
});
