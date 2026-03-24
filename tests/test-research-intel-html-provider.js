#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveHtmlProvider,
  resolveProviderConfig,
  providerGenerationSourceLabel,
  SUPPORTED_PROVIDERS
} = require('../scripts/research-intel/lib/html-provider');

test('SUPPORTED_PROVIDERS contains codex and claude-code', () => {
  assert.ok(SUPPORTED_PROVIDERS.has('codex'));
  assert.ok(SUPPORTED_PROVIDERS.has('claude-code'));
});

test('resolveHtmlProvider defaults to codex when unset', () => {
  assert.equal(resolveHtmlProvider({}), 'codex');
});

test('resolveHtmlProvider returns claude-code when explicitly set', () => {
  assert.equal(resolveHtmlProvider({ RESEARCH_INTEL_HTML_PROVIDER: 'claude-code' }), 'claude-code');
});

test('resolveHtmlProvider falls back to codex for unknown values', () => {
  assert.equal(resolveHtmlProvider({ RESEARCH_INTEL_HTML_PROVIDER: 'unknown' }), 'codex');
});

test('resolveHtmlProvider trims whitespace and lowercases', () => {
  assert.equal(resolveHtmlProvider({ RESEARCH_INTEL_HTML_PROVIDER: '  Claude-Code  ' }), 'claude-code');
});

test('resolveProviderConfig returns codex config by default', () => {
  const config = resolveProviderConfig({});
  assert.equal(config.provider, 'codex');
  assert.equal(config.model, 'gpt-5.4');
  assert.ok(config.timeoutMs > 0);
});

test('resolveProviderConfig returns claude-code config when selected', () => {
  const config = resolveProviderConfig({
    RESEARCH_INTEL_HTML_PROVIDER: 'claude-code'
  });
  assert.equal(config.provider, 'claude-code');
  assert.equal(config.model, 'claude-sonnet-4-6');
  assert.equal(config.reasoningEffort, '');
});

test('providerGenerationSourceLabel returns correct labels', () => {
  assert.equal(providerGenerationSourceLabel('codex'), 'codex-tmux-pdf-first-single-chain');
  assert.equal(providerGenerationSourceLabel('claude-code'), 'claude-code-print-pdf-first-single-chain');
});
