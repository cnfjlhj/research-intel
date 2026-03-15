#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildCodexHtmlPrompt,
  buildHtmlEnhancementPrompt,
  buildCodexInlineHtmlPrompt,
  buildHtmlRepairPrompt,
  buildEvidenceManifest,
  inspectHtmlQuality,
  captureValidationScreenshot,
  chooseEvidencePages,
  cleanHtmlResponse,
  ensureLocalKatexAssets,
  injectEvidenceGallery,
  inlineKatexAssetsInHtml,
  replaceFigurePlaceholdersWithEvidence,
  resolveBrowserExecutablePath,
  resolveAttachedPageImages,
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
  assert.match(prompt, /页面要有“作品感”/);
  assert.match(prompt, /研究动机/);
  assert.match(prompt, /实验方法与实验设计/);
  assert.match(prompt, /Rebuttal/);
  assert.match(prompt, /单一、完整、可本地打开的 index\.html/);
});

test('buildCodexInlineHtmlPrompt forces raw html-only output', () => {
  const prompt = buildCodexInlineHtmlPrompt({
    templateHtml: '<html></html>',
    paperMetaJson: '{"title":"x"}',
    paperTextPreview: 'body',
    openreviewSummary: 'none',
    pageImageCount: 3
  });

  assert.match(prompt, /最终回复必须只包含完整的 index\.html 源码/);
  assert.match(prompt, /苹果官网设计美学/);
  assert.match(prompt, /研究产品页/);
  assert.match(prompt, /手写 CSS/);
  assert.match(prompt, /不要运行 shell/);
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
  assert.match(prompt, /OpenReview \/ rebuttal \/ review thread（如果有）/);
  assert.match(prompt, /如果论文没有 OpenReview/);
  assert.match(prompt, /行内公式统一使用 .*\\\( ... \\\)/);
  assert.match(prompt, /块级公式统一使用 \$\$ ... \$\$/);
  assert.match(prompt, /不得把页面图像里看不清的表格数字编造成具体数值/);
  assert.doesNotMatch(prompt, /<html><\/html>/);
});

test('buildHtmlRepairPrompt patches the current html against validation findings', () => {
  const prompt = buildHtmlRepairPrompt({
    currentHtml: '<html><body><h2>1. 核心痛点</h2></body></html>',
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
  assert.match(prompt, /当前 HTML 如下/);
  assert.match(prompt, /如果论文没有 OpenReview/);
  assert.match(prompt, /不要因为修一个 JS\/KaTeX 问题把整页内容重写/);
  assert.match(prompt, /Tailwind CDN/);
});

test('buildHtmlEnhancementPrompt preserves gemini layout while asking codex to deepen content and use evidence', () => {
  const prompt = buildHtmlEnhancementPrompt({
    currentHtml: '<!DOCTYPE html><html><body><section class="hero">draft</section></body></html>',
    paperMetaJson: '{"title":"Group-Evolving Agents"}',
    paperTextPreview: 'paper text preview',
    openreviewSummary: 'review summary',
    webCoverageJson: '{"chineseBlogs":[{"title":"长文"}]}',
    evidenceManifestJson: '[{"pageNumber":4,"imagePath":"pages/page-04.jpg","caption":"Table 1"}]'
  });

  assert.match(prompt, /基于当前 HTML 深化和修补/);
  assert.match(prompt, /尽量保留 Gemini 初稿里已经成立的视觉结构/);
  assert.match(prompt, /真实页面证据/);
  assert.match(prompt, /web coverage/);
  assert.match(prompt, /evidence manifest/);
  assert.match(prompt, /研究动机/);
  assert.match(prompt, /评论/);
  assert.match(prompt, /placeholder|占位/);
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

  const result = await captureValidationScreenshot(fakePage, '/tmp/out.png');
  assert.equal(result.mode, 'viewport');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].fullPage, true);
  assert.equal(calls[1].fullPage, false);
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
