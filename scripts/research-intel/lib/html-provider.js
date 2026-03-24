#!/usr/bin/env node

const { resolveCodexEnhancementConfig } = require('./codex-enhancement-config');
const { resolveClaudeCodeEnhancementConfig } = require('./claude-code-enhancement-config');
const { runCodexHtmlGeneration, buildCodexHtmlTmuxRunPaths } = require('./codex-html');
const { runClaudeCodeHtmlGeneration, buildClaudeCodeHtmlRunPaths } = require('./claude-code-html');

const SUPPORTED_PROVIDERS = new Set(['codex', 'claude-code']);

function resolveHtmlProvider(env = process.env) {
  const raw = String(env.RESEARCH_INTEL_HTML_PROVIDER || '').trim().toLowerCase();
  if (SUPPORTED_PROVIDERS.has(raw)) {
    return raw;
  }
  return 'codex';
}

function resolveProviderConfig(env = process.env) {
  const provider = resolveHtmlProvider(env);
  if (provider === 'claude-code') {
    const config = resolveClaudeCodeEnhancementConfig(env);
    return {
      provider,
      model: config.model,
      timeoutMs: config.timeoutMs,
      reasoningEffort: '',
      enabled: config.enabled
    };
  }
  const config = resolveCodexEnhancementConfig(env);
  return {
    provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    timeoutMs: config.timeoutMs,
    enabled: config.enabled
  };
}

function buildProviderRunPaths({ provider, workingDir, targetHtmlPath, finalMessagePath }) {
  if (provider === 'claude-code') {
    return buildClaudeCodeHtmlRunPaths({ workingDir, targetHtmlPath, finalMessagePath });
  }
  return buildCodexHtmlTmuxRunPaths({ workingDir, targetHtmlPath, finalMessagePath });
}

async function runHtmlGeneration({
  provider,
  workingDir,
  targetHtmlPath,
  finalMessagePath,
  promptText,
  attachedPageImages,
  model,
  reasoningEffort,
  timeoutMs,
  ...rest
}) {
  if (provider === 'claude-code') {
    return runClaudeCodeHtmlGeneration({
      workingDir,
      targetHtmlPath,
      finalMessagePath,
      promptText,
      attachedPageImages,
      model,
      timeoutMs,
      ...rest
    });
  }

  return runCodexHtmlGeneration({
    workingDir,
    targetHtmlPath,
    finalMessagePath,
    promptText,
    attachedPageImages,
    model,
    reasoningEffort,
    timeoutMs,
    ...rest
  });
}

function providerGenerationSourceLabel(provider) {
  if (provider === 'claude-code') {
    return 'claude-code-print-pdf-first-single-chain';
  }
  return 'codex-tmux-pdf-first-single-chain';
}

module.exports = {
  buildProviderRunPaths,
  providerGenerationSourceLabel,
  resolveHtmlProvider,
  resolveProviderConfig,
  runHtmlGeneration,
  SUPPORTED_PROVIDERS
};
