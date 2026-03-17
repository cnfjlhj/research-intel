#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CODEX_HTML_MODEL,
  DEFAULT_CODEX_HTML_REASONING_EFFORT,
  DEFAULT_CODEX_HTML_TIMEOUT_MS,
  resolveCodexEnhancementConfig
} = require('../scripts/research-intel/lib/codex-enhancement-config');

test('DEFAULT_CODEX_HTML_TIMEOUT_MS matches the baohe-safe default window', () => {
  assert.equal(DEFAULT_CODEX_HTML_TIMEOUT_MS, 1800000);
});

test('resolveCodexEnhancementConfig enables Codex HTML generation by default', () => {
  const config = resolveCodexEnhancementConfig({});

  assert.equal(config.enabled, true);
  assert.equal(config.model, DEFAULT_CODEX_HTML_MODEL);
  assert.equal(config.reasoningEffort, DEFAULT_CODEX_HTML_REASONING_EFFORT);
  assert.equal(config.timeoutMs, DEFAULT_CODEX_HTML_TIMEOUT_MS);
});

test('resolveCodexEnhancementConfig disables Codex HTML generation when model is explicitly blank', () => {
  const config = resolveCodexEnhancementConfig({
    RESEARCH_INTEL_CODEX_HTML_MODEL: '   '
  });

  assert.equal(config.enabled, false);
  assert.equal(config.model, '');
  assert.equal(config.reasoningEffort, DEFAULT_CODEX_HTML_REASONING_EFFORT);
  assert.equal(config.timeoutMs, DEFAULT_CODEX_HTML_TIMEOUT_MS);
});

test('resolveCodexEnhancementConfig trims model and accepts runtime overrides', () => {
  const config = resolveCodexEnhancementConfig({
    RESEARCH_INTEL_CODEX_HTML_MODEL: ' gpt-5.4 ',
    RESEARCH_INTEL_CODEX_HTML_REASONING_EFFORT: ' high ',
    RESEARCH_INTEL_CODEX_HTML_TIMEOUT_MS: '45000'
  });

  assert.equal(config.enabled, true);
  assert.equal(config.model, 'gpt-5.4');
  assert.equal(config.reasoningEffort, 'high');
  assert.equal(config.timeoutMs, 45000);
});

test('resolveCodexEnhancementConfig falls back to the default timeout for invalid values', () => {
  const config = resolveCodexEnhancementConfig({
    RESEARCH_INTEL_CODEX_HTML_MODEL: 'gpt-5.4',
    RESEARCH_INTEL_CODEX_HTML_TIMEOUT_MS: '0'
  });

  assert.equal(config.enabled, true);
  assert.equal(config.reasoningEffort, DEFAULT_CODEX_HTML_REASONING_EFFORT);
  assert.equal(config.timeoutMs, DEFAULT_CODEX_HTML_TIMEOUT_MS);
});
