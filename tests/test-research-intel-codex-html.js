#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const {
  buildCodexHtmlPrompt,
  buildHtmlEnhancementPrompt,
  buildCodexInlineHtmlPrompt,
  buildHtmlRepairPrompt,
  buildCodexHtmlTmuxEnvEntries,
  buildCodexHtmlTmuxLaunchCommand,
  buildCodexHtmlTmuxRunPaths,
  buildCodexHtmlTmuxSessionName,
  buildEvidenceManifest,
  buildDeterministicFallbackHtml,
  findPlaceholderMarkers,
  inspectHtmlQuality,
  captureValidationScreenshot,
  chooseEvidencePages,
  cleanHtmlResponse,
  ensureLocalKatexAssets,
  inlineLocalImageAssetRefs,
  injectEvidenceGallery,
  inlineKatexAssetsInHtml,
  normalizeLocalImageAssetRefs,
  replaceFigurePlaceholdersWithEvidence,
  resolveBrowserExecutablePath,
  resolveAttachedPageImages,
  runCodexHtmlGeneration,
  rewriteHtmlToLocalKatexAssets
} = require('../scripts/research-intel/lib/codex-html');

test('resolveAttachedPageImages keeps every page and sorts naturally', () => {
  const actual = resolveAttachedPageImages([
    '/tmp/page-10.jpg',
    '/tmp/page-2.jpg',
    '/tmp/page-1.jpg'
  ]);

  assert.deepEqual(actual, [
    '/tmp/page-1.jpg',
    '/tmp/page-2.jpg',
    '/tmp/page-10.jpg'
  ]);
});

test('buildCodexHtmlTmuxSessionName creates a paper-scoped tmux-safe identifier', () => {
  const sessionName = buildCodexHtmlTmuxSessionName({
    workingDir: '/tmp/research-intel/papers/2603.08403',
    targetHtmlPath: '/tmp/research-intel/papers/2603.08403/index.html',
    finalMessagePath: '/tmp/research-intel/papers/2603.08403/repair/attempt-2.response.txt'
  });

  assert.match(sessionName, /^research-intel-html-2603-08403-attempt-2-[a-f0-9]{8}$/);
  assert.ok(sessionName.length <= 64);
});

test('buildCodexHtmlTmuxRunPaths keeps detached-runner artifacts together', () => {
  const paths = buildCodexHtmlTmuxRunPaths({
    workingDir: '/tmp/research-intel/papers/2603.08403',
    targetHtmlPath: '/tmp/research-intel/papers/2603.08403/index.html',
    finalMessagePath: '/tmp/research-intel/papers/2603.08403/enhancement-response.txt'
  });

  assert.match(paths.runtimeDir, /\/\.codex-html-runs\/enhancement-response-[a-f0-9]{8}$/);
  assert.match(paths.promptPath, /\/prompt\.md$/);
  assert.match(paths.configPath, /\/runner-config\.json$/);
  assert.match(paths.statusPath, /\/status\.json$/);
  assert.match(paths.stdoutPath, /\/stdout\.log$/);
  assert.match(paths.stderrPath, /\/stderr\.log$/);
});

test('buildCodexHtmlTmuxLaunchCommand invokes the detached runner from the paper workspace', () => {
  const command = buildCodexHtmlTmuxLaunchCommand({
    workingDir: '/tmp/research-intel/papers/2603.08403',
    runnerScriptPath: '/repo/scripts/research-intel/lib/detached-command-runner.js',
    configPath: '/tmp/research-intel/papers/2603.08403/.codex-html-runs/enhancement-response-a1b2c3d4/runner-config.json'
  });

  assert.match(command, /^cd '\/tmp\/research-intel\/papers\/2603\.08403'/);
  assert.match(command, /exec '.*node.*' '\/repo\/scripts\/research-intel\/lib\/detached-command-runner\.js' '\/tmp\/research-intel\/papers\/2603\.08403\/\.codex-html-runs\/enhancement-response-a1b2c3d4\/runner-config\.json'/);
});

test('buildCodexHtmlTmuxEnvEntries keeps provider and proxy variables while dropping empty values', () => {
  const entries = buildCodexHtmlTmuxEnvEntries({
    CODEX_HOME: '/tmp/codex-home',
    GGBOOM_API_KEY: 'sk-test',
    OPENAI_API_KEY: 'sk-openai',
    OPENAI_ORGANIZATION: 'org-test',
    OPENAI_PROJECT: 'proj-test',
    AZURE_OPENAI_API_VERSION: '2024-10-21',
    AWS_REGION: 'us-west-2',
    BEDROCK_MODEL_ID: 'anthropic.claude-v2',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    NODE_EXTRA_CA_CERTS: '/etc/ssl/custom.pem',
    EMPTY_VALUE: '',
    MULTILINE_SECRET: 'line1\nline2'
  });

  assert.deepEqual(entries, [
    'AWS_REGION=us-west-2',
    'AZURE_OPENAI_API_VERSION=2024-10-21',
    'BEDROCK_MODEL_ID=anthropic.claude-v2',
    'CODEX_HOME=/tmp/codex-home',
    'GGBOOM_API_KEY=sk-test',
    'HTTPS_PROXY=http://127.0.0.1:7890',
    'NODE_EXTRA_CA_CERTS=/etc/ssl/custom.pem',
    'OPENAI_API_KEY=sk-openai',
    'OPENAI_ORGANIZATION=org-test',
    'OPENAI_PROJECT=proj-test'
  ]);
});

test('runCodexHtmlGeneration completes through a tmux-backed fake codex binary', async t => {
  const tmuxCheck = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (tmuxCheck.status !== 0) {
    t.skip('tmux is not available in this environment');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-html-'));
  const binDir = path.join(tempDir, 'bin');
  const targetHtmlPath = path.join(tempDir, 'index.html');
  const finalMessagePath = path.join(tempDir, 'model-response.txt');
  const fakeCodexPath = path.join(binDir, 'codex');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeCodexPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'output_path=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o)',
    '      output_path="$2"',
    '      shift 2',
    '      ;;',
    '    -i|-m|-C|-c|-s)',
    '      shift 2',
    '      ;;',
    '    exec|--ephemeral|--skip-git-repo-check|--dangerously-bypass-approvals-and-sandbox|-)',
    '      shift',
    '      ;;',
    '    *)',
    '      shift',
    '      ;;',
    '  esac',
    'done',
    'cat >/dev/null',
    'sleep 1',
    'cat <<\'HTML\' > "$output_path"',
    '<!DOCTYPE html><html><body><h1>研究动机</h1><h2>数学表示及建模</h2><h2>实验方法与实验设计</h2><h2>实验结果及核心结论</h2><h2>评论</h2><h2>Rebuttal 过程（如果有）</h2><h2>One More Thing</h2></body></html>',
    'HTML',
    'printf "fake stdout"',
    'printf "fake stderr" >&2'
  ].join('\n'), 'utf8');
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath}`;

  try {
    const result = await runCodexHtmlGeneration({
      workingDir: tempDir,
      targetHtmlPath,
      finalMessagePath,
      promptText: 'Generate a page.',
      attachedPageImages: [],
      timeoutMs: 5000
    });

    assert.match(result.sessionName, /^research-intel-html-/);
    assert.equal(result.status.status, 'completed');
    assert.equal(result.status.stdoutBytes > 0, true);
    assert.equal(fs.existsSync(targetHtmlPath), true);
    assert.match(fs.readFileSync(targetHtmlPath, 'utf8'), /<!DOCTYPE html>/);
    assert.equal(result.stdout, 'fake stdout');
    assert.equal(result.stderr, 'fake stderr');
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runCodexHtmlGeneration recovers working-dir index.html when codex skips final message output', async t => {
  const tmuxCheck = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (tmuxCheck.status !== 0) {
    t.skip('tmux is not available in this environment');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-html-fallback-'));
  const binDir = path.join(tempDir, 'bin');
  const targetHtmlPath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'index.html');
  const finalMessagePath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'model-response.txt');
  const fakeCodexPath = path.join(binDir, 'codex');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeCodexPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o|-i|-m|-C|-c|-s)',
    '      shift 2',
    '      ;;',
    '    exec|--ephemeral|--skip-git-repo-check|--dangerously-bypass-approvals-and-sandbox|-)',
    '      shift',
    '      ;;',
    '    *)',
    '      shift',
    '      ;;',
    '  esac',
    'done',
    'cat >/dev/null',
    'cat <<\'HTML\' > index.html',
    '<!DOCTYPE html><html><body><h1>研究动机</h1><h2>数学表示及建模</h2><h2>实验方法与实验设计</h2><h2>实验结果及核心结论</h2><h2>评论</h2><h2>Rebuttal 过程（如果有）</h2><h2>One More Thing</h2></body></html>',
    'HTML',
    'printf "fallback stderr" >&2'
  ].join('\n'), 'utf8');
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath}`;

  try {
    const result = await runCodexHtmlGeneration({
      workingDir: tempDir,
      targetHtmlPath,
      finalMessagePath,
      promptText: 'Generate a page by editing index.html directly.',
      attachedPageImages: [],
      timeoutMs: 5000
    });

    assert.equal(result.recoveredFromWorkingDir, true);
    assert.equal(result.recoveredWorkingDirHtmlPath, path.join(tempDir, 'index.html'));
    assert.equal(fs.existsSync(finalMessagePath), true);
    assert.equal(fs.existsSync(targetHtmlPath), true);
    assert.match(fs.readFileSync(finalMessagePath, 'utf8'), /<!DOCTYPE html>/);
    assert.match(fs.readFileSync(targetHtmlPath, 'utf8'), /<!DOCTYPE html>/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runCodexHtmlGeneration recovers working-dir index.html after timeout', async t => {
  const tmuxCheck = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (tmuxCheck.status !== 0) {
    t.skip('tmux is not available in this environment');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-html-timeout-fallback-'));
  const binDir = path.join(tempDir, 'bin');
  const targetHtmlPath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'index.html');
  const finalMessagePath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'model-response.txt');
  const fakeCodexPath = path.join(binDir, 'codex');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeCodexPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o|-i|-m|-C|-c|-s)',
    '      shift 2',
    '      ;;',
    '    exec|--ephemeral|--skip-git-repo-check|--dangerously-bypass-approvals-and-sandbox|-)',
    '      shift',
    '      ;;',
    '    *)',
    '      shift',
    '      ;;',
    '  esac',
    'done',
    'cat >/dev/null',
    'cat <<\'HTML\' > index.html',
    '<!DOCTYPE html><html><body><h1>研究动机</h1><h2>数学表示及建模</h2><h2>实验方法与实验设计</h2><h2>实验结果及核心结论</h2><h2>评论</h2><h2>Rebuttal 过程（如果有）</h2><h2>One More Thing</h2></body></html>',
    'HTML',
    'printf "timeout fallback stderr" >&2',
    'sleep 3'
  ].join('\n'), 'utf8');
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath}`;

  try {
    const result = await runCodexHtmlGeneration({
      workingDir: tempDir,
      targetHtmlPath,
      finalMessagePath,
      promptText: 'Generate a page, but imagine provider-side completion never terminates cleanly.',
      attachedPageImages: [],
      timeoutMs: 500
    });

    assert.equal(result.recoveredFromWorkingDir, true);
    assert.equal(fs.existsSync(finalMessagePath), true);
    assert.equal(fs.existsSync(targetHtmlPath), true);
    assert.match(fs.readFileSync(finalMessagePath, 'utf8'), /<!DOCTYPE html>/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runCodexHtmlGeneration recovers working-dir index.html after post-write idle instead of waiting for full timeout', async t => {
  const tmuxCheck = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (tmuxCheck.status !== 0) {
    t.skip('tmux is not available in this environment');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-html-idle-fallback-'));
  const binDir = path.join(tempDir, 'bin');
  const targetHtmlPath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'index.html');
  const finalMessagePath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'model-response.txt');
  const fakeCodexPath = path.join(binDir, 'codex');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeCodexPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o|-i|-m|-C|-c|-s)',
    '      shift 2',
    '      ;;',
    '    exec|--ephemeral|--skip-git-repo-check|--dangerously-bypass-approvals-and-sandbox|-)',
    '      shift',
    '      ;;',
    '    *)',
    '      shift',
    '      ;;',
    '  esac',
    'done',
    'cat >/dev/null',
    'cat <<\'HTML\' > index.html',
    '<!DOCTYPE html><html><body><h1>研究动机</h1><h2>数学表示及建模</h2><h2>实验方法与实验设计</h2><h2>实验结果及核心结论</h2><h2>评论</h2><h2>Rebuttal 过程（如果有）</h2><h2>One More Thing</h2></body></html>',
    'HTML',
    'printf "idle fallback stderr" >&2',
    'sleep 30'
  ].join('\n'), 'utf8');
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath}`;

  try {
    const startedAt = Date.now();
    const result = await runCodexHtmlGeneration({
      workingDir: tempDir,
      targetHtmlPath,
      finalMessagePath,
      promptText: 'Generate a page, then hang forever after writing index.html.',
      attachedPageImages: [],
      timeoutMs: 5000,
      workingDirRecoveryIdleMs: 500
    });
    const durationMs = Date.now() - startedAt;

    assert.equal(result.recoveredFromWorkingDir, true);
    assert.equal(result.status.status, 'recovered_from_working_dir');
    assert.equal(fs.existsSync(finalMessagePath), true);
    assert.equal(fs.existsSync(targetHtmlPath), true);
    assert.match(fs.readFileSync(finalMessagePath, 'utf8'), /<!DOCTYPE html>/);
    assert.ok(durationMs < 5000, `expected early recovery before timeout, got ${durationMs}ms`);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runCodexHtmlGeneration allows a longer silent window after codex enters html write phase', async t => {
  const tmuxCheck = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (tmuxCheck.status !== 0) {
    t.skip('tmux is not available in this environment');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-html-write-phase-'));
  const binDir = path.join(tempDir, 'bin');
  const targetHtmlPath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'index.html');
  const finalMessagePath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'model-response.txt');
  const fakeCodexPath = path.join(binDir, 'codex');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeCodexPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'output_path=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o)',
    '      output_path="$2"',
    '      shift 2',
    '      ;;',
    '    -i|-m|-C|-c|-s)',
    '      shift 2',
    '      ;;',
    '    exec|--ephemeral|--skip-git-repo-check|--dangerously-bypass-approvals-and-sandbox|-)',
    '      shift',
    '      ;;',
    '    *)',
    '      shift',
    '      ;;',
    '  esac',
    'done',
    'cat >/dev/null',
    'printf "准备开始落文件了\\n" >&2',
    'printf "开始写 index.html。\\n" >&2',
    'sleep 4',
    'mkdir -p "$(dirname "$output_path")"',
    'cat <<\'HTML\' > "$output_path"',
    '<!DOCTYPE html><html><body><h1>研究动机</h1><h2>数学表示及建模</h2><h2>实验方法与实验设计</h2><h2>实验结果及核心结论</h2><h2>评论</h2><h2>Rebuttal 过程（如果有）</h2><h2>One More Thing</h2></body></html>',
    'HTML'
  ].join('\n'), 'utf8');
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath}`;

  try {
    const result = await runCodexHtmlGeneration({
      workingDir: tempDir,
      targetHtmlPath,
      finalMessagePath,
      promptText: 'Generate a page, then spend a while silently producing the final html.',
      attachedPageImages: [],
      timeoutMs: 8000,
      noOutputStallMs: 1000,
      writePhaseNoOutputStallMs: 5000
    });

    assert.equal(result.status.status, 'completed');
    assert.equal(fs.existsSync(finalMessagePath), true);
    assert.equal(fs.existsSync(targetHtmlPath), true);
    assert.match(fs.readFileSync(finalMessagePath, 'utf8'), /<!DOCTYPE html>/);
    assert.match(fs.readFileSync(targetHtmlPath, 'utf8'), /<!DOCTYPE html>/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runCodexHtmlGeneration fails fast when codex stalls before writing html', async t => {
  const tmuxCheck = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (tmuxCheck.status !== 0) {
    t.skip('tmux is not available in this environment');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-codex-html-stall-'));
  const binDir = path.join(tempDir, 'bin');
  const targetHtmlPath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'index.html');
  const finalMessagePath = path.join(tempDir, 'generation_attempts', 'attempt-01', 'model-response.txt');
  const fakeCodexPath = path.join(binDir, 'codex');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(fakeCodexPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o|-i|-m|-C|-c|-s)',
    '      shift 2',
    '      ;;',
    '    exec|--ephemeral|--skip-git-repo-check|--dangerously-bypass-approvals-and-sandbox|-)',
    '      shift',
    '      ;;',
    '    *)',
    '      shift',
    '      ;;',
    '  esac',
    'done',
    'cat >/dev/null',
    'printf "stalling before html" >&2',
    'sleep 30'
  ].join('\n'), 'utf8');
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath}`;

  try {
    const startedAt = Date.now();
    await assert.rejects(
      runCodexHtmlGeneration({
        workingDir: tempDir,
        targetHtmlPath,
        finalMessagePath,
        promptText: 'Generate a page, but get stuck before any html is written.',
        attachedPageImages: [],
        timeoutMs: 5000,
        noOutputStallMs: 500
      }),
      /stalled without new output/
    );
    const durationMs = Date.now() - startedAt;
    assert.ok(durationMs < 5000, `expected fast failure before timeout, got ${durationMs}ms`);
    assert.equal(fs.existsSync(targetHtmlPath), false);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('buildCodexHtmlPrompt encodes the hard requirements for direct Codex generation', () => {
  const prompt = buildCodexHtmlPrompt({
    templatePath: '/templates/base.html',
    targetHtmlPath: '/out/index.html',
    paperMetaPath: '/paper/paper_meta.json',
    paperTextPath: '/paper/paper_text.txt',
    openreviewSummaryPath: '/paper/openreview_summary.md',
    openreviewThreadPath: '/paper/openreview_thread.json',
    attachedPageImages: ['/paper/pages/page-1.jpg', '/paper/pages/page-2.jpg']
  });

  assert.match(prompt, /顶级的 AI researcher/);
  assert.match(prompt, /苹果官网/);
  assert.match(prompt, /必须直接写出并保存到 \/out\/index\.html/);
  assert.match(prompt, /attached images .*论文 PDF .*关键页面证据/);
  assert.match(prompt, /不得只依赖提取文本/);
  assert.match(prompt, /如果你不确定某个数字、表格项或 figure 细节，要明确标注“不确定”/);
  assert.match(prompt, /所有面向读者的导航、按钮、说明、标签、卡片标题都必须使用中文/);
  assert.match(prompt, /Research Product Page/);
  assert.match(prompt, /页面要有“作品感”/);
  assert.match(prompt, /暖色研究专题页/);
  assert.match(prompt, /冷色研究简报/);
  assert.match(prompt, /不要把正文默认设成 opacity: 0/);
  assert.match(prompt, /研究动机/);
  assert.match(prompt, /实验方法与实验设计/);
  assert.match(prompt, /Rebuttal/);
  assert.match(prompt, /单一、完整、可本地打开的 index\.html/);
});

test('buildCodexInlineHtmlPrompt forces raw html-only output', () => {
  const prompt = buildCodexInlineHtmlPrompt({
    templateHtml: '<html></html>',
    paperPdfPath: '/paper/paper.pdf',
    paperMetaPath: '/paper/paper_meta.json',
    paperMetaJson: '{"title":"x"}',
    paperTextPath: '/paper/paper_text.txt',
    paperTextPreviewPath: '/paper/paper_text_preview.txt',
    paperTextPreview: 'body',
    openreviewSummaryPath: '/paper/openreview_summary.md',
    openreviewSummary: 'none',
    pageImagesDir: '/paper/pages',
    pageTextsDir: '/paper/page_texts',
    pageImageCount: 3
  });

  assert.match(prompt, /最终回复必须只包含完整的 index\.html 源码/);
  assert.match(prompt, /苹果官网设计美学/);
  assert.match(prompt, /研究产品页/);
  assert.match(prompt, /手写 CSS/);
  assert.match(prompt, /暖色研究专题页/);
  assert.match(prompt, /冷色研究简报/);
  assert.match(prompt, /指标卡可以有，但只能作为概览信息带的一部分/);
  assert.match(prompt, /不要把正文默认设成 opacity: 0/);
  assert.match(prompt, /attached images 数量：3/);
  assert.match(prompt, /模板视觉语言参考/);
  assert.match(prompt, /可见标题（h1\/h2\/h3）中必须直接出现这些字样/);
  assert.match(prompt, /研究动机/);
  assert.match(prompt, /数学表示及建模/);
  assert.match(prompt, /实验方法与实验设计/);
  assert.match(prompt, /实验结果及核心结论/);
  assert.match(prompt, /评论/);
  assert.match(prompt, /不要使用 Tailwind CDN/);
  assert.match(prompt, /不要使用 Google Fonts/);
  assert.match(prompt, /证据优先级/);
  assert.match(prompt, /paper\.pdf 是唯一真相来源/);
  assert.match(prompt, /如果辅助材料与 paper\.pdf 冲突，以 paper\.pdf 为准/);
  assert.match(prompt, /公开细节覆盖率/);
  assert.match(prompt, /如果论文公开了 prompt、system prompt、instruction template、超参数、数据切分、评估设置/);
  assert.match(prompt, /如果论文没有公开某项细节，要明确写“论文未公开”或“不确定”/);
  assert.match(prompt, /paper_meta\.json 里如果存在 recommendation_context/);
  assert.match(prompt, /user_profile/);
  assert.match(prompt, /你可以读取当前论文工作目录里的这些本地文件/);
  assert.match(prompt, /\/paper\/paper\.pdf/);
  assert.match(prompt, /\/paper\/paper_text\.txt/);
  assert.match(prompt, /\/paper\/paper_text_preview\.txt/);
  assert.match(prompt, /\/paper\/pages/);
  assert.match(prompt, /\/paper\/page_texts/);
  assert.match(prompt, /OpenReview \/ rebuttal \/ review thread（如果有）/);
  assert.match(prompt, /如果论文没有 OpenReview/);
  assert.match(prompt, /行内公式统一使用 .*\\\( ... \\\)/);
  assert.match(prompt, /块级公式统一使用 \$\$ ... \$\$/);
  assert.match(prompt, /这是一次非交互的一次性生成/);
  assert.match(prompt, /你已经被授权直接完成最终交付/);
  assert.match(prompt, /不要再请求确认、许可、回复“确认”/);
  assert.match(prompt, /不要尝试落盘修改本地文件；只需要把完整的 index\.html 源码作为最终回复输出/);
  assert.match(prompt, /不得把页面图像里看不清的表格数字编造成具体数值/);
  assert.match(prompt, /所有面向读者的导航、按钮、说明、标签、卡片标题都必须使用中文/);
  assert.doesNotMatch(prompt, /<html><\/html>/);
});

test('buildCodexInlineHtmlPrompt includes layered context and keeps paper pdf highest priority', () => {
  const prompt = buildCodexInlineHtmlPrompt({
    templateHtml: '<html></html>',
    paperPdfPath: '/paper/paper.pdf',
    paperMetaPath: '/paper/paper_meta.json',
    paperMetaJson: '{"title":"x"}',
    paperTextPath: '/paper/paper_text.txt',
    paperTextPreviewPath: '/paper/paper_text_preview.txt',
    paperTextPreview: 'body',
    openreviewSummaryPath: '/paper/openreview_summary.md',
    openreviewSummary: 'none',
    pageImagesDir: '/paper/pages',
    pageTextsDir: '/paper/page_texts',
    pageImageCount: 3,
    routeContextJson: JSON.stringify({
      route_logic: '先基础，再主方法。',
      ordered_paper_ids: ['paper:a', 'paper:b']
    }),
    dependencyCardsJson: JSON.stringify([
      {
        paper_id: 'paper:a',
        title: 'Paper A',
        compare_axes: ['feedback loop']
      }
    ])
  });

  assert.match(prompt, /机器可读补充上下文/);
  assert.match(prompt, /前序依赖卡摘要/);
  assert.match(prompt, /feedback loop/);
  assert.match(prompt, /当前 paper\.pdf 仍然高于所有前序依赖卡/);
  assert.match(prompt, /不要让这些前序依赖卡改变页面的主叙事重心/);
});

test('buildHtmlRepairPrompt patches the current html against validation findings', () => {
  const prompt = buildHtmlRepairPrompt({
    paperPdfPath: '/paper/paper.pdf',
    paperTextPath: '/paper/paper_text.txt',
    currentHtmlPath: '/paper/index.html',
    currentHtml: [
      '<html><body><h2>1. 核心痛点</h2>',
      '<img src="data:image/png;base64,AAAA">',
      '<style data-research-intel-evidence-gallery>.ri-evidence-gallery{display:block}</style>',
      '<section class="ri-evidence-gallery" data-research-intel-evidence-gallery="true">',
      '<img src="data:image/jpeg;base64,BBBB">',
      '</section>',
      '</body></html>'
    ].join(''),
    validationReport: {
      missingMarkers: ['研究动机', '评论'],
      consoleErrors: ['Failed to load resource'],
      consoleWarnings: ['cdn.tailwindcss.com should not be used in production']
    },
    paperMetaJson: '{"title":"CogSearch"}',
    openreviewSummary: '暂无公开 OpenReview 信息。',
    paperTextPreview: 'paper text preview'
  });

  assert.match(prompt, /你现在是在修补一份已经生成过的 index\.html/);
  assert.match(prompt, /必须基于当前 HTML 修改/);
  assert.match(prompt, /不要推倒重写视觉风格/);
  assert.match(prompt, /不要把页面修成普通文档页/);
  assert.match(prompt, /hero、信息带、双栏内容区/);
  assert.match(prompt, /missingMarkers/);
  assert.match(prompt, /研究动机/);
  assert.match(prompt, /评论/);
  assert.match(prompt, /当前 HTML 精简预览如下/);
  assert.match(prompt, /当前 HTML 文件路径: \/paper\/index\.html/);
  assert.match(prompt, /paper\.pdf 是唯一真相来源/);
  assert.match(prompt, /\/paper\/paper\.pdf/);
  assert.match(prompt, /\/paper\/paper_text\.txt/);
  assert.match(prompt, /如果论文没有 OpenReview/);
  assert.match(prompt, /不要因为修一个 JS\/KaTeX 问题把整页内容重写/);
  assert.match(prompt, /这是一次非交互的一次性修补/);
  assert.match(prompt, /你已经被授权直接输出最终 HTML/);
  assert.match(prompt, /不要说“如果你确认我再继续”之类的话/);
  assert.match(prompt, /Tailwind CDN/);
  assert.match(prompt, /不要机械复制那一大段 base64 图库/);
  assert.match(prompt, /所有面向读者的导航、按钮、说明、标签、卡片标题都必须使用中文/);
  assert.match(prompt, /data:embedded-asset-omitted-for-repair-prompt/);
  assert.match(prompt, /research-intel evidence gallery omitted from repair prompt preview/);
  assert.doesNotMatch(prompt, /data:image\/png;base64,AAAA/);
  assert.doesNotMatch(prompt, /data:image\/jpeg;base64,BBBB/);
  assert.doesNotMatch(prompt, /data-research-intel-evidence-gallery="true"/);
});

test('buildHtmlRepairPrompt stays below Codex input limits when current html contains massive inline assets', () => {
  const hugeBase64 = 'A'.repeat(1_300_000);
  const prompt = buildHtmlRepairPrompt({
    paperPdfPath: '/paper/paper.pdf',
    paperTextPath: '/paper/paper_text.txt',
    currentHtmlPath: '/paper/index.html',
    currentHtml: `<html><body><img src="data:image/jpeg;base64,${hugeBase64}"></body></html>`,
    validationReport: {
      consoleErrors: ['Failed to load resource']
    },
    paperMetaJson: '{"title":"Huge Inline Asset"}',
    openreviewSummary: '',
    paperTextPreview: 'paper text preview'
  });

  assert.ok(prompt.length < 1_048_576);
  assert.match(prompt, /data:embedded-asset-omitted-for-repair-prompt/);
  assert.doesNotMatch(prompt, /A{1024}/);
});

test('buildHtmlEnhancementPrompt preserves the existing draft structure while asking codex to deepen content and use evidence', () => {
  const prompt = buildHtmlEnhancementPrompt({
    currentHtml: '<!DOCTYPE html><html><body><section class="hero">draft</section></body></html>',
    paperMetaJson: '{"title":"Group-Evolving Agents"}',
    paperTextPreview: 'paper text preview',
    openreviewSummary: 'review summary',
    webCoverageJson: '{"chineseBlogs":[{"title":"长文"}]}',
    evidenceManifestJson: '[{"pageNumber":4,"imagePath":"pages/page-04.jpg","caption":"Table 1"}]'
  });

  assert.match(prompt, /基于当前 HTML 深化和修补/);
  assert.match(prompt, /尽量保留当前初稿里已经成立的视觉结构/);
  assert.match(prompt, /真实页面证据/);
  assert.match(prompt, /web coverage/);
  assert.match(prompt, /evidence manifest/);
  assert.match(prompt, /这是一次非交互的一次性增强/);
  assert.match(prompt, /你已经被授权直接输出最终 HTML/);
  assert.match(prompt, /不要说“如果你确认我再继续”之类的话/);
  assert.match(prompt, /研究动机/);
  assert.match(prompt, /评论/);
  assert.match(prompt, /placeholder|占位/);
  assert.match(prompt, /所有面向读者的导航、按钮、说明、标签、卡片标题都必须使用中文/);
});

test('buildEvidenceManifest annotates evidence pages with roles, tags, and compact text excerpts', () => {
  const manifest = buildEvidenceManifest([
    {
      pageNumber: 5,
      imagePath: '/tmp/page-05.jpg',
      textPath: '/tmp/page-05.txt',
      text: 'Table 2 main benchmark results. We compare against strong baselines and include ablation details.'
    },
    {
      pageNumber: 12,
      imagePath: '/tmp/page-12.jpg',
      textPath: '/tmp/page-12.txt',
      text: 'Appendix A. Training details, hyperparameters, prompts, and implementation notes for reproducibility.'
    }
  ]);

  assert.equal(manifest.length, 2);
  assert.equal(manifest[0].pageRole, 'ablation_or_results');
  assert.ok(manifest[0].signalTags.includes('table'));
  assert.ok(manifest[0].signalTags.includes('benchmark'));
  assert.ok(manifest[0].textExcerpt.includes('Table 2 main benchmark results.'));
  assert.equal(manifest[1].pageRole, 'appendix_or_setup');
  assert.ok(manifest[1].signalTags.includes('appendix'));
  assert.ok(manifest[1].signalTags.includes('hyperparameter'));
});

test('buildDeterministicFallbackHtml preserves structure but is flagged as a degraded fallback page', () => {
  const html = buildDeterministicFallbackHtml({
    meta: {
      title: 'SPIRAL',
      summary: 'A closed-loop reflective planning framework for long-horizon action world models.',
      authors: ['Alice', 'Bob'],
      published: '2026-03-09T14:00:36Z',
      arxiv: {
        id: '2603.08403'
      }
    },
    openreviewSummary: 'OpenReview 暂无公开 rebuttal，但作者强调 closed-loop planning 与 critic feedback 的必要性。',
    paperTextPreview: 'Method: plan, act, reflect, and update memory. Experiments: benchmark results improve semantic alignment.',
    webCoverage: {
      chineseBlogs: [
        { title: '中文长文解读' }
      ],
      codeRepos: [
        { name: 'spiral-repo' }
      ]
    }
  });

  assert.match(html, /研究动机/);
  assert.match(html, /数学表示及建模/);
  assert.match(html, /实验方法与实验设计/);
  assert.match(html, /实验结果及核心结论/);
  assert.match(html, /评论/);
  assert.match(html, /One More Thing/);
  assert.doesNotMatch(html, /todo|placeholder/i);

  const quality = inspectHtmlQuality(html, []);
  assert.equal(quality.ok, false);
  assert.equal(quality.placeholderMarkers.length, 0);
  assert.deepEqual(quality.missingMarkers, []);
  assert.ok(quality.issues.some(issue => issue.code === 'degraded_fallback_page'));
});

test('inspectHtmlQuality rejects pages that hide primary content behind scroll-triggered reveal animations', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<style>',
    '.fade-up { opacity: 0; transform: translateY(18px); transition: opacity .6s ease, transform .6s ease; }',
    '.fade-up.is-visible { opacity: 1; transform: translateY(0); }',
    '</style>',
    '</head>',
    '<body>',
    '<section class="fade-up"><h2>研究动机</h2><p>动机内容。</p></section>',
    '<section class="fade-up"><h2>数学表示及建模</h2><p>数学内容。</p></section>',
    '<section class="fade-up"><h2>实验方法与实验设计</h2><p>实验设计。</p></section>',
    '<section class="fade-up"><h2>实验结果及核心结论</h2><p>结果内容。</p></section>',
    '<section class="fade-up"><h2>评论</h2><p>评论内容。</p></section>',
    '<section class="fade-up"><h2>Rebuttal 过程（如果有）</h2><p>无。</p></section>',
    '<section class="fade-up"><h2>One More Thing</h2><p>补充内容。</p></section>',
    '<script>',
    'const fades = document.querySelectorAll(".fade-up");',
    'const observer = new IntersectionObserver((entries) => {',
    '  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add("is-visible"); });',
    '});',
    'fades.forEach(el => observer.observe(el));',
    '</script>',
    '</body>',
    '</html>'
  ].join('');

  const quality = inspectHtmlQuality(html, []);
  assert.equal(quality.ok, false);
  assert.ok(quality.issues.some(issue => issue.code === 'scroll_gated_primary_content'));
});

test('cleanHtmlResponse strips code fences and leading chatter', () => {
  const cleaned = cleanHtmlResponse('Here is the file\n```html\n<!DOCTYPE html><html><body>x</body></html>\n```');
  assert.equal(cleaned, '<!DOCTYPE html><html><body>x</body></html>');
});

test('cleanHtmlResponse keeps only the first complete html document when a model repeats the page twice', () => {
  const duplicated = [
    '<!DOCTYPE html><html><body><h1>first</h1></body></html>',
    '<!DOCTYPE html><html><body><h1>second</h1></body></html>'
  ].join('');

  const cleaned = cleanHtmlResponse(duplicated);
  assert.equal(cleaned, '<!DOCTYPE html><html><body><h1>first</h1></body></html>');
  assert.equal((cleaned.match(/<!DOCTYPE html/gi) || []).length, 1);
  assert.equal((cleaned.match(/<body/gi) || []).length, 1);
});

test('ensureLocalKatexAssets can satisfy validation assets from bundled repo files without network', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-katex-assets-'));
  const assetDir = path.join(tempDir, 'assets', 'katex');

  try {
    await ensureLocalKatexAssets(assetDir);
    assert.equal(fs.existsSync(path.join(assetDir, 'katex.min.css')), true);
    assert.equal(fs.existsSync(path.join(assetDir, 'katex.min.js')), true);
    assert.equal(fs.existsSync(path.join(assetDir, 'auto-render.min.js')), true);
    assert.equal(fs.existsSync(path.join(assetDir, 'fonts', 'KaTeX_Main-Regular.woff2')), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rewriteHtmlToLocalKatexAssets rewrites remote katex assets to local relative paths', () => {
  const input = [
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">',
    '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>'
  ].join('\n');

  const rewritten = rewriteHtmlToLocalKatexAssets(input, 'assets/katex');
  assert.match(rewritten, /href="assets\/katex\/katex\.min\.css"/);
  assert.match(rewritten, /src="assets\/katex\/katex\.min\.js"/);
  assert.match(rewritten, /src="assets\/katex\/auto-render\.min\.js"/);
  assert.doesNotMatch(rewritten, /cdn\.jsdelivr\.net/);
});

test('rewriteHtmlToLocalKatexAssets handles arbitrary katex CDN versions and strips preconnect links', () => {
  const input = [
    '<link rel="preconnect" href="https://cdn.jsdelivr.net">',
    '<link rel="preconnect" href="https://unpkg.com" crossorigin>',
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css?cache=1">',
    '<script src="https://unpkg.com/katex@0.16.10/dist/katex.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/contrib/auto-render.min.js#hash"></script>'
  ].join('\n');

  const rewritten = rewriteHtmlToLocalKatexAssets(input, 'assets/katex');
  assert.match(rewritten, /href="assets\/katex\/katex\.min\.css"/);
  assert.match(rewritten, /src="assets\/katex\/katex\.min\.js"/);
  assert.match(rewritten, /src="assets\/katex\/auto-render\.min\.js"/);
  assert.doesNotMatch(rewritten, /preconnect/);
  assert.doesNotMatch(rewritten, /cdn\.jsdelivr\.net|unpkg\.com/);
});

test('inlineKatexAssetsInHtml converts local katex references into a standalone html payload', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-katex-'));
  const assetDir = path.join(tempDir, 'assets', 'katex');
  const fontsDir = path.join(assetDir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'katex.min.css'), "@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format('woff2')} body{color:#111;}", 'utf8');
  fs.writeFileSync(path.join(assetDir, 'katex.min.js'), 'window.katexLoaded = true;', 'utf8');
  fs.writeFileSync(path.join(assetDir, 'auto-render.min.js'), 'window.renderMathInElement = function(){};', 'utf8');
  fs.writeFileSync(path.join(fontsDir, 'KaTeX_Main-Regular.woff2'), Buffer.from('fakefont'));

  const input = [
    '<link rel="stylesheet" href="assets/katex/katex.min.css">',
    '<script src="assets/katex/katex.min.js"></script>',
    '<script src="assets/katex/auto-render.min.js"></script>'
  ].join('\n');

  const standalone = inlineKatexAssetsInHtml(input, assetDir, 'assets/katex');
  assert.match(standalone, /<style data-katex-inline="css">/);
  assert.match(standalone, /data:font\/woff2;base64/);
  assert.match(standalone, /<script data-katex-inline="js">/);
  assert.match(standalone, /<script data-katex-inline="auto-render">/);
  assert.doesNotMatch(standalone, /assets\/katex\/katex\.min\.css/);
  assert.doesNotMatch(standalone, /assets\/katex\/katex\.min\.js/);
  assert.doesNotMatch(standalone, /assets\/katex\/auto-render\.min\.js/);
});

test('inlineKatexAssetsInHtml only replaces real asset tags and removes forbidden remote dependencies', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-katex-safe-'));
  const assetDir = path.join(tempDir, 'assets', 'katex');
  const fontsDir = path.join(assetDir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'katex.min.css'), "@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format('woff2')} body{color:#111;}", 'utf8');
  fs.writeFileSync(path.join(assetDir, 'katex.min.js'), 'window.katexLoaded = true;', 'utf8');
  fs.writeFileSync(path.join(assetDir, 'auto-render.min.js'), 'window.renderMathInElement = function(){};', 'utf8');
  fs.writeFileSync(path.join(fontsDir, 'KaTeX_Main-Regular.woff2'), Buffer.from('fakefont'));

  const input = [
    '<html><head>',
    '<script>const sentinel = \'<script src="assets/katex/katex.min.js"></script>\';</script>',
    '<link rel="stylesheet" href="assets/katex/katex.min.css">',
    '<script src="assets/katex/katex.min.js"></script>',
    '<script src="assets/katex/auto-render.min.js"></script>',
    '<script src="https://cdn.tailwindcss.com"></script>',
    '<style>@import url(\'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap\'); body{font-family:Inter,sans-serif;}</style>',
    '</head><body><h1>demo</h1></body></html>'
  ].join('\n');

  const standalone = inlineKatexAssetsInHtml(input, assetDir, 'assets/katex');
  assert.match(standalone, /const sentinel = '<script src="assets\/katex\/katex\.min\.js"><\/script>';/);
  assert.match(standalone, /<style data-katex-inline="css">/);
  assert.match(standalone, /<script data-katex-inline="js">/);
  assert.match(standalone, /<script data-katex-inline="auto-render">/);
  assert.doesNotMatch(standalone, /<script[^>]*src="https:\/\/cdn\.tailwindcss\.com"/);
  assert.doesNotMatch(standalone, /fonts\.googleapis\.com/);
});

test('captureValidationScreenshot falls back to viewport capture when full-page capture fails', async () => {
  const calls = [];
  const fakePage = {
    async screenshot(options) {
      calls.push(options);
      if (options.fullPage) {
        throw new Error('Protocol error (Page.captureScreenshot): Unable to capture screenshot');
      }
    }
  };

  const result = await captureValidationScreenshot(fakePage, '/tmp/out.png', {
    getPageMetrics: async () => ({
      viewportWidth: 1215,
      scrollHeight: 14948
    }),
    getPngDimensions: () => null
  });
  assert.equal(result.mode, 'viewport');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].fullPage, true);
  assert.equal(calls[1].fullPage, false);
});

test('captureValidationScreenshot re-captures with an exact clip when full-page dimensions drift from DOM metrics', async () => {
  const calls = [];
  const fakePage = {
    async screenshot(options) {
      calls.push(options);
    }
  };

  const result = await captureValidationScreenshot(fakePage, '/tmp/out.png', {
    getPageMetrics: async () => ({
      viewportWidth: 1215,
      scrollHeight: 14948
    }),
    getPngDimensions: () => ({
      width: 1215,
      height: 24455
    })
  });

  assert.equal(result.mode, 'full-page-clip');
  assert.match(result.warning, /dimensions mismatched DOM metrics/i);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].fullPage, true);
  assert.deepEqual(calls[1].clip, {
    x: 0,
    y: 0,
    width: 1215,
    height: 14948
  });
  assert.equal(calls[1].captureBeyondViewport, true);
});

test('inlineKatexAssetsInHtml inserts script bodies verbatim without expanding replacement tokens', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-katex-dollar-'));
  const assetDir = path.join(tempDir, 'assets', 'katex');
  const fontsDir = path.join(assetDir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'katex.min.css'), 'body{color:#111;}', 'utf8');
  fs.writeFileSync(path.join(assetDir, 'katex.min.js'), 'const token = "$&";', 'utf8');
  fs.writeFileSync(path.join(assetDir, 'auto-render.min.js'), 'const token2 = "$1";', 'utf8');

  const input = [
    '<link rel="stylesheet" href="assets/katex/katex.min.css">',
    '<script src="assets/katex/katex.min.js"></script>',
    '<script src="assets/katex/auto-render.min.js"></script>'
  ].join('\n');

  const standalone = inlineKatexAssetsInHtml(input, assetDir, 'assets/katex');
  assert.match(standalone, /const token = "\$&";/);
  assert.match(standalone, /const token2 = "\$1";/);
  assert.doesNotMatch(standalone, /<script src="assets\/katex\/katex\.min\.js"><\/script>/);
  assert.doesNotMatch(standalone, /<script src="assets\/katex\/auto-render\.min\.js"><\/script>/);
});

test('chooseEvidencePages keeps early context pages and high-signal experiment pages', () => {
  const pages = [
    { pageNumber: 1, imagePath: '/tmp/page-01.jpg', text: 'title abstract introduction' },
    { pageNumber: 2, imagePath: '/tmp/page-02.jpg', text: 'method overview algorithm 1' },
    { pageNumber: 3, imagePath: '/tmp/page-03.jpg', text: 'related work preliminaries' },
    { pageNumber: 4, imagePath: '/tmp/page-04.jpg', text: 'experiment setup table 1 benchmark results' },
    { pageNumber: 5, imagePath: '/tmp/page-05.jpg', text: 'ablation study figure 3 figure 4' },
    { pageNumber: 6, imagePath: '/tmp/page-06.jpg', text: 'appendix proofs' }
  ];

  const selected = chooseEvidencePages(pages, 4);
  assert.deepEqual(selected.map(item => item.pageNumber), [1, 2, 4, 5]);
});

test('injectEvidenceGallery appends inline page evidence when the html draft has no real images', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-evidence-gallery-'));
  const imagePath = path.join(tempDir, 'page-01.jpg');
  fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const nextHtml = injectEvidenceGallery('<!DOCTYPE html><html><body><main><h2>研究动机</h2></main></body></html>', [
    {
      pageNumber: 1,
      imagePath,
      text: 'Figure 1 overview and Table 1 results'
    }
  ]);

  assert.match(nextHtml, /论文页面证据/);
  assert.match(nextHtml, /data:image\/jpeg;base64/);
  assert.match(nextHtml, /第 1 页/);
});

test('replaceFigurePlaceholdersWithEvidence swaps placeholder copy for embedded page evidence cards', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-inline-evidence-'));
  const imagePath = path.join(tempDir, 'page-01.jpg');
  fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const input = [
    '<!DOCTYPE html>',
    '<html><head><title>demo</title></head><body>',
    '<section>',
    '<p>[Figure 1: Core War 模拟器与演化概览]</p>',
    '</section>',
    '</body></html>'
  ].join('');

  const replaced = replaceFigurePlaceholdersWithEvidence(input, [
    {
      pageNumber: 4,
      imagePath,
      text: 'Figure 1 overview of the Core War simulator and the evolutionary loop.'
    }
  ]);

  assert.match(replaced, /data-research-intel-inline-evidence/);
  assert.match(replaced, /论文图表证据/);
  assert.match(replaced, /data:image\/jpeg;base64/);
  assert.match(replaced, /Core War 模拟器与演化概览/);
  assert.doesNotMatch(replaced, /\[Figure 1: Core War 模拟器与演化概览\]/);
});

test('inspectHtmlQuality flags placeholder figures and weak evidence grounding', () => {
  const report = inspectHtmlQuality(
    [
      '<!DOCTYPE html>',
      '<html><body>',
      '<h2>研究动机</h2>',
      '<h2>实验结果及核心结论</h2>',
      '<p>[Figure 1: 结果图占位]</p>',
      '<h2>评论</h2>',
      '<p>整体还行。</p>',
      '</body></html>'
    ].join('\n'),
    [
      { pageNumber: 4, imagePath: '/tmp/page-04.jpg', text: 'Figure 1 benchmark results and Table 1 ablation' }
    ]
  );

  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.code === 'placeholder_marker'));
  assert.ok(report.issues.some(issue => issue.code === 'weak_figure_grounding'));
});

test('findPlaceholderMarkers ignores todo-like substrings inside embedded data urls', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html><body>',
    '<h2>研究动机</h2>',
    '<img src="data:image/png;base64,AAAATodOAAAA">',
    '<p>正文没有脏标记。</p>',
    '</body></html>'
  ].join('');

  assert.deepEqual(findPlaceholderMarkers(html), []);
});

test('findPlaceholderMarkers ignores placeholder-like substrings inside inline script and style blocks', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html><head>',
    '<style>.demo::before{content:"placeholder";}</style>',
    '</head><body>',
    '<h2>研究动机</h2>',
    '<script>const internalTodo = "ToDo"; const hiddenPlaceholder = "placeholder";</script>',
    '<p>正文没有脏标记。</p>',
    '</body></html>'
  ].join('');

  assert.deepEqual(findPlaceholderMarkers(html), []);
});

test('findPlaceholderMarkers ignores contextual discussion of source-paper placeholders inside normal prose', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html><body>',
    '<h2>评论</h2>',
    '<p>论文参考文献里还保留了一个 GPT-OSS placeholder，这属于原文自己的瑕疵，不是本页待补内容。</p>',
    '<p>作者甚至留下了 “TODO: Add GPT-OSS reference” 这样的原文痕迹，所以这里需要指出问题，而不是静默删掉。</p>',
    '</body></html>'
  ].join('');

  assert.deepEqual(findPlaceholderMarkers(html), []);
});

test('findPlaceholderMarkers ignores benign Chinese technical phrases containing 占位', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html><body>',
    '<h2>实验结果及核心结论</h2>',
    '<table><tbody>',
    '<tr><td>payload 在向量空间中形成占位优势，未来无关查询也可能被挟持</td></tr>',
    '</tbody></table>',
    '</body></html>'
  ].join('');

  assert.deepEqual(findPlaceholderMarkers(html), []);
});

test('resolveBrowserExecutablePath prefers explicit env override and known system browser paths', () => {
  const explicit = resolveBrowserExecutablePath({
    env: { RESEARCH_INTEL_CHROME_PATH: '/custom/chrome' },
    existsSync: filePath => filePath === '/custom/chrome'
  });
  assert.equal(explicit, '/custom/chrome');

  const fallbackToSystem = resolveBrowserExecutablePath({
    env: {},
    existsSync: filePath => filePath === '/usr/bin/chromium'
  });
  assert.equal(fallbackToSystem, '/usr/bin/chromium');

  const noBrowser = resolveBrowserExecutablePath({
    env: {},
    existsSync: () => false
  });
  assert.equal(noBrowser, null);
});

test('resolveBrowserExecutablePath skips broken overrides and falls back to Playwright browser caches', () => {
  const resolved = resolveBrowserExecutablePath({
    env: {
      RESEARCH_INTEL_CHROME_PATH: '/broken/chrome',
      PLAYWRIGHT_BROWSERS_PATH: '/pw-cache',
      HOME: '/home/tester'
    },
    existsSync: filePath => filePath === '/pw-cache/chromium-1208/chrome-linux64/chrome',
    realpathSync: filePath => filePath,
    readdirSync: dirPath => {
      if (dirPath === '/pw-cache') {
        return ['chromium-1208'];
      }
      return [];
    }
  });

  assert.equal(resolved, '/pw-cache/chromium-1208/chrome-linux64/chrome');
});

test('resolveBrowserExecutablePath falls back to research-intel browser cache roots', () => {
  const resolved = resolveBrowserExecutablePath({
    env: {
      HOME: '/home/tester'
    },
    existsSync: filePath =>
      filePath === '/home/tester/.cache/research-intel-browser/chrome/linux-146.0.7680.80/chrome-linux64/chrome',
    realpathSync: filePath => filePath,
    readdirSync: dirPath => {
      if (dirPath === '/home/tester/.cache/research-intel-browser/chrome') {
        return ['linux-146.0.7680.80'];
      }
      return [];
    }
  });

  assert.equal(
    resolved,
    '/home/tester/.cache/research-intel-browser/chrome/linux-146.0.7680.80/chrome-linux64/chrome'
  );
});

test('normalizeLocalImageAssetRefs rewrites file urls and zero-padded page refs to real relative assets', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-local-images-'));
  const htmlPath = path.join(tempDir, 'index.html');
  const pagesDir = path.join(tempDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, 'page-2.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const input = [
    '<!DOCTYPE html>',
    '<html><body>',
    `<img src="${pathToFileURL(path.join(pagesDir, 'page-02.jpg')).toString()}">`,
    '<img src="pages/page-02.jpg">',
    '</body></html>'
  ].join('\n');

  const normalized = normalizeLocalImageAssetRefs(input, { htmlPath });
  assert.match(normalized, /src="pages\/page-2\.jpg"/);
  assert.doesNotMatch(normalized, /file:\/\//);
  assert.doesNotMatch(normalized, /page-02\.jpg/);
});

test('normalizeLocalImageAssetRefs resolves paper page assets from nested generation attempt directories', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-nested-local-images-'));
  const paperDir = path.join(tempDir, 'paper');
  const attemptDir = path.join(paperDir, 'generation_attempts', 'attempt-01');
  const htmlPath = path.join(attemptDir, 'index.html');
  const pagesDir = path.join(paperDir, 'pages');
  fs.mkdirSync(attemptDir, { recursive: true });
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, 'page-5.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const input = [
    '<!DOCTYPE html>',
    '<html><body>',
    '<img src="pages/page-05.jpg">',
    '</body></html>'
  ].join('\n');

  const normalized = normalizeLocalImageAssetRefs(input, { htmlPath });
  assert.match(normalized, /src="\.\.\/\.\.\/pages\/page-5\.jpg"/);
  assert.doesNotMatch(normalized, /pages\/page-05\.jpg/);
});

test('normalizeLocalImageAssetRefs rewrites prior-attempt katex asset refs for nested validation runs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-nested-katex-assets-'));
  const paperDir = path.join(tempDir, 'paper');
  const attemptOneDir = path.join(paperDir, 'generation_attempts', 'attempt-01');
  const attemptTwoDir = path.join(paperDir, 'generation_attempts', 'attempt-02');
  const htmlPath = path.join(attemptTwoDir, 'index.html');
  const assetDir = path.join(attemptOneDir, 'assets', 'katex');
  fs.mkdirSync(assetDir, { recursive: true });
  fs.mkdirSync(attemptTwoDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'katex.min.css'), 'body{}');
  fs.writeFileSync(path.join(assetDir, 'katex.min.js'), 'window.renderMathInElement=()=>{};');

  const input = [
    '<!DOCTYPE html>',
    '<html><head>',
    '<link rel="stylesheet" href="generation_attempts/attempt-01/assets/katex/katex.min.css">',
    '<script src="generation_attempts/attempt-01/assets/katex/katex.min.js"></script>',
    '</head><body></body></html>'
  ].join('\n');

  const normalized = normalizeLocalImageAssetRefs(input, { htmlPath });
  assert.match(normalized, /href="\.\.\/attempt-01\/assets\/katex\/katex\.min\.css"/);
  assert.match(normalized, /src="\.\.\/attempt-01\/assets\/katex\/katex\.min\.js"/);
  assert.doesNotMatch(normalized, /generation_attempts\/attempt-01\/assets\/katex/);
});

test('inlineLocalImageAssetRefs converts local page images into embedded data urls', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intel-inline-local-images-'));
  const htmlPath = path.join(tempDir, 'index.html');
  const pagesDir = path.join(tempDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, 'page-2.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const input = [
    '<!DOCTYPE html>',
    '<html><body>',
    '<img src="pages/page-02.jpg">',
    '</body></html>'
  ].join('\n');

  const standalone = inlineLocalImageAssetRefs(input, { htmlPath });
  assert.match(standalone, /src="data:image\/jpeg;base64,/);
  assert.doesNotMatch(standalone, /pages\/page-02\.jpg/);
});
