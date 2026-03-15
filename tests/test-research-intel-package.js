#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildTelegramPaperBundleEntries,
  buildTelegramLedgerBundleEntries
} = require('../scripts/research-intel/lib/package');

test('buildTelegramLedgerBundleEntries keeps only the iterative method tree artifacts', () => {
  const entries = buildTelegramLedgerBundleEntries();
  assert.deepEqual(entries, [
    'method_tree.md',
    'method_tree.json'
  ]);
});

test('buildTelegramPaperBundleEntries keeps only the readable html surface', () => {
  const entries = buildTelegramPaperBundleEntries();
  assert.ok(entries.includes('index.html'));
  assert.ok(entries.includes('assets'));
  assert.ok(!entries.includes('paper.pdf'));
  assert.ok(!entries.includes('paper_meta.json'));
  assert.ok(!entries.includes('paper_card.json'));
  assert.ok(!entries.includes('web_coverage.md'));
  assert.ok(!entries.includes('openreview_summary.md'));
  assert.ok(!entries.includes('pages'));
  assert.ok(!entries.includes('page_texts'));
});

test('package.json exposes safe first-run scripts for public users', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );

  assert.equal(packageJson.scripts.start, 'node scripts/research-intel/web-server.js');
  assert.equal(packageJson.scripts['daily:no-telegram'], 'node scripts/research-intel/daily-run.js --no-telegram');
  assert.equal(packageJson.scripts['profile:example'], 'node scripts/bootstrap/init-profile.js --use-example');
});
