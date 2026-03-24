#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CLAUDE_CODE_HTML_MODEL,
  DEFAULT_CLAUDE_CODE_HTML_TIMEOUT_MS,
  resolveClaudeCodeEnhancementConfig
} = require('../scripts/research-intel/lib/claude-code-enhancement-config');

test('defaults are sensible', () => {
  assert.equal(DEFAULT_CLAUDE_CODE_HTML_MODEL, 'claude-sonnet-4-6');
  assert.equal(DEFAULT_CLAUDE_CODE_HTML_TIMEOUT_MS, 1800000);
});

test('resolveClaudeCodeEnhancementConfig returns defaults when env is empty', () => {
  const config = resolveClaudeCodeEnhancementConfig({});
  assert.deepEqual(config, {
    enabled: true,
    model: 'claude-sonnet-4-6',
    timeoutMs: 1800000
  });
});

test('resolveClaudeCodeEnhancementConfig respects env overrides', () => {
  const config = resolveClaudeCodeEnhancementConfig({
    RESEARCH_INTEL_CLAUDE_CODE_HTML_MODEL: 'claude-opus-4-6',
    RESEARCH_INTEL_CLAUDE_CODE_HTML_TIMEOUT_MS: '900000'
  });
  assert.equal(config.model, 'claude-opus-4-6');
  assert.equal(config.timeoutMs, 900000);
});

test('resolveClaudeCodeEnhancementConfig disabled when model is empty', () => {
  const config = resolveClaudeCodeEnhancementConfig({
    RESEARCH_INTEL_CLAUDE_CODE_HTML_MODEL: ''
  });
  assert.equal(config.enabled, false);
  assert.equal(config.model, '');
});
