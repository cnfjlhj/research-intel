#!/usr/bin/env node

const DEFAULT_CODEX_HTML_TIMEOUT_MS = 300000;
const DEFAULT_CODEX_HTML_MODEL = 'gpt-5.4';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function resolveCodexEnhancementConfig(env = process.env) {
  const rawModel = Object.prototype.hasOwnProperty.call(env, 'RESEARCH_INTEL_CODEX_HTML_MODEL')
    ? env.RESEARCH_INTEL_CODEX_HTML_MODEL
    : DEFAULT_CODEX_HTML_MODEL;
  const model = String(rawModel || '').trim();
  return {
    enabled: model.length > 0,
    model,
    timeoutMs: parsePositiveInt(env.RESEARCH_INTEL_CODEX_HTML_TIMEOUT_MS, DEFAULT_CODEX_HTML_TIMEOUT_MS)
  };
}

module.exports = {
  DEFAULT_CODEX_HTML_MODEL,
  DEFAULT_CODEX_HTML_TIMEOUT_MS,
  resolveCodexEnhancementConfig
};
