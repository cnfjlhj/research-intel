#!/usr/bin/env node

const DEFAULT_CLAUDE_CODE_HTML_TIMEOUT_MS = 1800000;
const DEFAULT_CLAUDE_CODE_HTML_MODEL = 'claude-sonnet-4-6';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function resolveClaudeCodeEnhancementConfig(env = process.env) {
  const rawModel = Object.prototype.hasOwnProperty.call(env, 'RESEARCH_INTEL_CLAUDE_CODE_HTML_MODEL')
    ? env.RESEARCH_INTEL_CLAUDE_CODE_HTML_MODEL
    : DEFAULT_CLAUDE_CODE_HTML_MODEL;
  const model = String(rawModel || '').trim();
  return {
    enabled: model.length > 0,
    model,
    timeoutMs: parsePositiveInt(env.RESEARCH_INTEL_CLAUDE_CODE_HTML_TIMEOUT_MS, DEFAULT_CLAUDE_CODE_HTML_TIMEOUT_MS)
  };
}

module.exports = {
  DEFAULT_CLAUDE_CODE_HTML_MODEL,
  DEFAULT_CLAUDE_CODE_HTML_TIMEOUT_MS,
  resolveClaudeCodeEnhancementConfig
};
