#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { appendJsonl, deliveryReceiptsPath, summarizeDeliveryStatus, updateDeliveryStatus } = require('./lib/delivery');
const { sendTelegramDocument } = require('./lib/telegram');

const ROOT_DIR = path.join(__dirname, '../..');
const DEFAULT_PROFILE_DIR = path.join(ROOT_DIR, 'work/research-intel/profile');
const DEFAULT_RECORDS_DIR = path.join(ROOT_DIR, 'research-intel-records');
const BLOCKED_DISCOVERY_SOURCE_PATTERNS = [
  /\bmanual_backup_rebuild\b/i,
  /\bbackup_rebuild\b/i,
  /\bhistory_rebuild\b/i,
  /\bmanual[_ -]?shortlist\b/i,
  /\bbackup[_ -]?shortlist\b/i,
  /\bfallback\b/i,
  /\bunsent\b/i
];

function parseArgs(argv) {
  const options = {
    rootDir: ROOT_DIR,
    profileDir: DEFAULT_PROFILE_DIR,
    recordsDir: DEFAULT_RECORDS_DIR,
    dateString: '',
    resendMissing: false,
    disableNotification: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--date') {
      options.dateString = argv[index + 1] || '';
      index += 1;
    } else if (value === '--root-dir') {
      options.rootDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--profile-dir') {
      options.profileDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--records-dir') {
      options.recordsDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--resend-missing') {
      options.resendMissing = true;
    } else if (value === '--disable-notification') {
      options.disableNotification = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function resolveDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return source
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function readJsonIfExists(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return fallback;
  }
  return readJson(filePath);
}

function resolveRepoPath(rootDir, relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) {
    return '';
  }
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(rootDir, relativeOrAbsolutePath);
}

function fileExistsWithContent(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  return String(fs.readFileSync(filePath, 'utf8')).trim().length > 0;
}

function hasBlockedDiscoverySource(value) {
  const source = String(value || '').trim();
  return BLOCKED_DISCOVERY_SOURCE_PATTERNS.some(pattern => pattern.test(source));
}

function inspectDiscoveryIntegrity(runDir) {
  const queryResultsPath = path.join(runDir, 'query_results.json');
  const candidatePoolPath = path.join(runDir, 'candidate_pool.jsonl');
  const failures = [];

  if (!fs.existsSync(queryResultsPath)) {
    failures.push({
      issue: 'missing_query_results',
      path: queryResultsPath
    });
  } else {
    const queryResults = readJson(queryResultsPath);
    if (!Array.isArray(queryResults) || queryResults.length === 0) {
      failures.push({
        issue: 'empty_query_results',
        path: queryResultsPath
      });
    } else {
      const healthyQueries = queryResults.filter(result => {
        const query = String(result?.query || '').trim();
        const error = String(result?.error || '').trim();
        if (!query) {
          failures.push({
            issue: 'missing_query_source',
            path: queryResultsPath
          });
          return false;
        }
        if (hasBlockedDiscoverySource(query)) {
          failures.push({
            issue: 'blocked_query_source',
            path: queryResultsPath,
            value: query
          });
          return false;
        }
        return error.length === 0;
      });

      if (healthyQueries.length === 0) {
        failures.push({
          issue: 'no_successful_query_results',
          path: queryResultsPath
        });
      }
    }
  }

  if (!fs.existsSync(candidatePoolPath)) {
    failures.push({
      issue: 'missing_candidate_pool',
      path: candidatePoolPath
    });
  } else {
    const candidates = readJsonl(candidatePoolPath);
    if (candidates.length === 0) {
      failures.push({
        issue: 'empty_candidate_pool',
        path: candidatePoolPath
      });
    } else {
      for (const candidate of candidates) {
        const sourceMarkers = [
          candidate?.query,
          candidate?.source,
          candidate?.discoverySource
        ].filter(Boolean);
        for (const marker of sourceMarkers) {
          if (hasBlockedDiscoverySource(marker)) {
            failures.push({
              issue: 'blocked_candidate_source',
              path: candidatePoolPath,
              title: candidate?.title || '',
              value: marker
            });
          }
        }
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures
  };
}

function inspectReleaseArtifacts(rootDir, runDir) {
  const manifestPath = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest not found for release verification: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);
  const failures = [];
  for (const paper of manifest.papers || []) {
    const generationMethod = String(paper.generationMethod || '');
    const htmlPath = resolveRepoPath(rootDir, paper.htmlPath || '');
    const paperDir = htmlPath ? path.dirname(htmlPath) : '';
    const promptPath = paperDir ? path.join(paperDir, 'generation_prompt.md') : '';
    const finalMessagePath = paperDir ? path.join(paperDir, 'codex_final_message.txt') : '';
    const initialHtmlPath = paperDir ? path.join(paperDir, 'index.initial.html') : '';
    const htmlValidationPath = resolveRepoPath(rootDir, paper.htmlValidationPath || '');
    const standaloneValidationPath = resolveRepoPath(rootDir, paper.standaloneValidationPath || '');
    const htmlValidation = readJsonIfExists(htmlValidationPath, {});
    const standaloneValidation = readJsonIfExists(standaloneValidationPath, {});
    const issues = [];

    if (generationMethod !== 'codex-tmux-pdf-first-single-chain') {
      issues.push(`generationMethod=${generationMethod || '(empty)'}`);
    }
    if (/fallback|deterministic/i.test(generationMethod)) {
      issues.push(`blocked_generation_method=${generationMethod}`);
    }
    if (!fileExistsWithContent(promptPath)) {
      issues.push('missing_generation_prompt');
    }
    if (!fileExistsWithContent(finalMessagePath)) {
      issues.push('missing_codex_final_message');
    }
    if (!fileExistsWithContent(initialHtmlPath)) {
      issues.push('missing_initial_html');
    }
    if (!htmlValidation?.ok) {
      issues.push('html_validation_not_ok');
    }
    if (!standaloneValidation?.ok) {
      issues.push('standalone_validation_not_ok');
    }

    if (issues.length > 0) {
      failures.push({
        title: paper.title || '(untitled)',
        issues
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtimeEnvPath = path.join(options.profileDir, 'runtime.env');
  if (fs.existsSync(runtimeEnvPath)) {
    dotenv.config({ path: runtimeEnvPath, quiet: true, override: true });
  }

  const dateString = options.dateString || resolveDateString();
  const runDir = path.join(options.recordsDir, 'daily', dateString);
  const discoveryRunDir = path.join(options.rootDir, 'work', 'research-intel', 'daily', dateString);
  const statusPath = path.join(runDir, 'delivery_status.json');
  if (!fs.existsSync(statusPath)) {
    throw new Error(`delivery status not found for ${dateString}: ${statusPath}`);
  }

  const discoveryInspection = inspectDiscoveryIntegrity(discoveryRunDir);
  if (!discoveryInspection.ok) {
    throw new Error(`discovery integrity inspection failed: ${JSON.stringify(discoveryInspection.failures)}`);
  }

  const artifactInspection = inspectReleaseArtifacts(options.rootDir, runDir);
  if (!artifactInspection.ok) {
    throw new Error(`release artifact inspection failed: ${JSON.stringify(artifactInspection.failures)}`);
  }

  const status = readJson(statusPath);
  status.date = dateString;
  status.items = (status.items || []).map(item => ({
    ...item,
    absoluteFilePath: resolveRepoPath(options.rootDir, item.filePath)
  }));

  if (options.resendMissing) {
    for (const item of status.items) {
      if (!['pending', 'failed'].includes(String(item.status || ''))) {
        continue;
      }
      if (!item.absoluteFilePath || !fs.existsSync(item.absoluteFilePath)) {
        item.status = 'failed';
        item.error = `artifact missing: ${item.filePath || '(empty)'}`;
        updateDeliveryStatus(statusPath, status);
        continue;
      }

      const caption = item.kind === 'ledger'
        ? `${item.title || 'Research Ledger'} ${dateString}`
        : `HTML: ${String(item.title || '').slice(0, 80)}`;
      const telegramResult = await sendTelegramDocument({
        filePath: item.absoluteFilePath,
        caption,
        disableNotification: options.disableNotification
      });
      item.status = 'sent';
      item.sentAt = new Date().toISOString();
      item.messageId = telegramResult?.message_id || telegramResult?.messageId || null;
      appendJsonl(deliveryReceiptsPath(path.join(options.recordsDir, 'history')), [{
        date: dateString,
        kind: item.kind,
        title: item.title,
        filePath: item.filePath,
        fileHash: item.fileHash,
        messageId: item.messageId,
        sentAt: item.sentAt,
        runDir: path.relative(options.rootDir, runDir)
      }]);
      updateDeliveryStatus(statusPath, status);
    }
  }

  const summary = summarizeDeliveryStatus(status);
  console.log(JSON.stringify({
    date: dateString,
    statusPath,
    ...summary
  }, null, 2));

  if (!summary.ok) {
    process.exit(1);
  }
}

module.exports = {
  BLOCKED_DISCOVERY_SOURCE_PATTERNS,
  parseArgs,
  resolveDateString,
  inspectDiscoveryIntegrity,
  inspectReleaseArtifacts
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[research-intel verify] ${error.stack || error.message}`);
    process.exit(1);
  });
}
