#!/usr/bin/env node

const DEFAULT_CODEX_HTML_TIMEOUT_MS = 120000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function resolveCodexEnhancementConfig(env = process.env) {
  const model = String(env.RESEARCH_INTEL_CODEX_HTML_MODEL || '').trim();
  return {
    enabled: model.length > 0,
    model,
    timeoutMs: parsePositiveInt(env.RESEARCH_INTEL_CODEX_HTML_TIMEOUT_MS, DEFAULT_CODEX_HTML_TIMEOUT_MS)
  };
}

module.exports = {
  DEFAULT_CODEX_HTML_TIMEOUT_MS,
  resolveCodexEnhancementConfig
};
