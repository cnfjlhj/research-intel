#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inspectDiscoveryIntegrity,
  inspectReleaseArtifacts
} = require('../scripts/research-intel/verify-daily');

test('inspectDiscoveryIntegrity rejects degraded discovery sources such as manual backup rebuilds', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-verify-discovery-'));
  const runDir = path.join(tempDir, 'daily', '2026-03-19');
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(path.join(runDir, 'query_results.json'), JSON.stringify([
    {
      query: 'manual_backup_rebuild',
      count: 5,
      error: ''
    }
  ], null, 2));
  fs.writeFileSync(path.join(runDir, 'candidate_pool.jsonl'), [
    JSON.stringify({
      title: 'Emergency candidate',
      query: 'manual_backup_rebuild'
    })
  ].join('\n'));

  const inspection = inspectDiscoveryIntegrity(runDir);

  assert.equal(inspection.ok, false);
  assert.ok(inspection.failures.some(item => item.issue === 'blocked_query_source'));
  assert.ok(inspection.failures.some(item => item.issue === 'blocked_candidate_source'));
});

test('inspectDiscoveryIntegrity accepts normal discovery sources', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-verify-discovery-ok-'));
  const runDir = path.join(tempDir, 'daily', '2026-03-19');
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(path.join(runDir, 'query_results.json'), JSON.stringify([
    {
      query: 'ti:(agentic system) AND submittedDate:[20260318 TO 20260319]',
      count: 7,
      error: ''
    }
  ], null, 2));
  fs.writeFileSync(path.join(runDir, 'candidate_pool.jsonl'), [
    JSON.stringify({
      title: 'Healthy candidate',
      query: 'ti:(agentic system) AND submittedDate:[20260318 TO 20260319]'
    })
  ].join('\n'));

  const inspection = inspectDiscoveryIntegrity(runDir);

  assert.equal(inspection.ok, true);
  assert.deepEqual(inspection.failures, []);
});

test('inspectReleaseArtifacts rejects fallback generation methods', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-verify-artifacts-'));
  const runDir = path.join(tempDir, 'daily', '2026-03-19');
  const paperDir = path.join(tempDir, 'papers', '01-test');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(paperDir, { recursive: true });

  const htmlPath = path.join(paperDir, 'index.html');
  fs.writeFileSync(htmlPath, '<!doctype html><html><body>test</body></html>\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
    papers: [
      {
        title: 'Fallback paper',
        generationMethod: 'deterministic-validated-report',
        htmlPath
      }
    ]
  }, null, 2));

  const inspection = inspectReleaseArtifacts(tempDir, runDir);

  assert.equal(inspection.ok, false);
  assert.ok(inspection.failures.some(item => item.title === 'Fallback paper'));
});
