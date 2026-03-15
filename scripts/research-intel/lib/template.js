#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function uniqueCandidates(candidates) {
  const seen = new Set();
  const result = [];

  for (const item of candidates) {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function resolveHtmlTemplateReference({
  rootDir,
  profileDir,
  env = process.env
}) {
  const normalizedRoot = path.resolve(rootDir || process.cwd());
  const normalizedProfile = profileDir
    ? path.resolve(profileDir)
    : path.join(normalizedRoot, 'work', 'research-intel', 'profile');

  const candidates = uniqueCandidates([
    env.RESEARCH_INTEL_HTML_TEMPLATE_PATH,
    path.join(normalizedProfile, 'html_template.html'),
    path.join(normalizedRoot, 'scripts', 'research-intel', 'assets', 'html-template-reference.html')
  ]);

  for (const candidate of candidates) {
    const resolvedPath = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(normalizedRoot, candidate);
    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    return {
      templatePath: resolvedPath,
      templateHtml: fs.readFileSync(resolvedPath, 'utf8')
    };
  }

  return {
    templatePath: '',
    templateHtml: ''
  };
}

module.exports = {
  resolveHtmlTemplateReference
};
