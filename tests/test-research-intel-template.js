#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveHtmlTemplateReference } = require('../scripts/research-intel/lib/template');

function withTempDir(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-template-'));
  try {
    return run(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('resolveHtmlTemplateReference prefers explicit env override over repo defaults', () => withTempDir(tempDir => {
  const rootDir = path.join(tempDir, 'repo');
  const profileDir = path.join(rootDir, 'work', 'research-intel', 'profile');
  const assetsDir = path.join(rootDir, 'scripts', 'research-intel', 'assets');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const envTemplate = path.join(tempDir, 'external-template.html');
  const repoTemplate = path.join(assetsDir, 'html-template-reference.html');
  fs.writeFileSync(envTemplate, '<html>env template</html>\n', 'utf8');
  fs.writeFileSync(repoTemplate, '<html>repo template</html>\n', 'utf8');

  const resolved = resolveHtmlTemplateReference({
    rootDir,
    profileDir,
    env: {
      RESEARCH_INTEL_HTML_TEMPLATE_PATH: envTemplate
    }
  });

  assert.equal(resolved.templatePath, envTemplate);
  assert.match(resolved.templateHtml, /env template/);
}));

test('resolveHtmlTemplateReference falls back to repo asset template when no override exists', () => withTempDir(tempDir => {
  const rootDir = path.join(tempDir, 'repo');
  const profileDir = path.join(rootDir, 'work', 'research-intel', 'profile');
  const assetsDir = path.join(rootDir, 'scripts', 'research-intel', 'assets');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const repoTemplate = path.join(assetsDir, 'html-template-reference.html');
  fs.writeFileSync(repoTemplate, '<html>repo template</html>\n', 'utf8');

  const resolved = resolveHtmlTemplateReference({
    rootDir,
    profileDir,
    env: {}
  });

  assert.equal(resolved.templatePath, repoTemplate);
  assert.match(resolved.templateHtml, /repo template/);
}));

test('resolveHtmlTemplateReference returns empty values instead of throwing when no template exists', () => withTempDir(tempDir => {
  const rootDir = path.join(tempDir, 'repo');
  const profileDir = path.join(rootDir, 'work', 'research-intel', 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const resolved = resolveHtmlTemplateReference({
    rootDir,
    profileDir,
    env: {}
  });

  assert.equal(resolved.templatePath, '');
  assert.equal(resolved.templateHtml, '');
}));
