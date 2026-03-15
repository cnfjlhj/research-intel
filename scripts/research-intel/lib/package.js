#!/usr/bin/env node

const { spawnSync } = require('child_process');

function buildTelegramLedgerBundleEntries() {
  return [
    'method_tree.md',
    'method_tree.json'
  ];
}

function buildTelegramPaperBundleEntries() {
  return [
    'index.html',
    'assets'
  ];
}

function createTarGz({ outputPath, cwd, entries }) {
  const result = spawnSync(
    'tar',
    ['-czf', outputPath, '-C', cwd, ...entries],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(`tar failed: ${result.stderr || result.stdout}`);
  }
}

module.exports = {
  buildTelegramPaperBundleEntries,
  buildTelegramLedgerBundleEntries,
  createTarGz
};
