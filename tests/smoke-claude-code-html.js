#!/usr/bin/env node

/**
 * Smoke test: run Claude Code HTML generation on FormalEvolve paper.
 * Usage: node tests/smoke-claude-code-html.js
 */

const fs = require('fs');
const path = require('path');

const { buildCodexInlineHtmlPrompt, cleanHtmlResponse, validateHtmlWithBrowser } = require('../scripts/research-intel/lib/codex-html');
const { runClaudeCodeHtmlGeneration } = require('../scripts/research-intel/lib/claude-code-html');

const PAPER_DIR = path.join(__dirname, '..', 'work', 'research-intel', 'smoke-test-claude-code', 'formalevolve');
const TARGET_HTML = path.join(PAPER_DIR, 'index.html');
const FINAL_MESSAGE = path.join(PAPER_DIR, 'claude_code_final_message.txt');

async function main() {
  console.log('[smoke] Starting Claude Code HTML generation smoke test');
  console.log('[smoke] Paper dir:', PAPER_DIR);

  // Check files exist
  const requiredFiles = ['paper.pdf', 'paper_meta.json', 'paper_text_preview.txt', 'openreview_summary.md'];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(PAPER_DIR, file))) {
      throw new Error(`Missing required file: ${file}`);
    }
  }

  // Load evidence pages for image paths
  const evidencePages = JSON.parse(fs.readFileSync(path.join(PAPER_DIR, 'evidence_pages.json'), 'utf8'));
  // Update image paths to point to local copy
  const attachedPageImages = evidencePages
    .slice(0, 4)  // limit to 4 for speed
    .map(entry => {
      const localPath = path.join(PAPER_DIR, 'pages', path.basename(entry.imagePath));
      return fs.existsSync(localPath) ? localPath : entry.imagePath;
    })
    .filter(p => fs.existsSync(p));

  console.log('[smoke] Evidence images:', attachedPageImages.length);

  // Build prompt (reuse existing prompt builder)
  const metaJson = fs.readFileSync(path.join(PAPER_DIR, 'paper_meta.json'), 'utf8');
  const textPreview = fs.readFileSync(path.join(PAPER_DIR, 'paper_text_preview.txt'), 'utf8');
  const openreviewSummary = fs.readFileSync(path.join(PAPER_DIR, 'openreview_summary.md'), 'utf8');

  const promptText = buildCodexInlineHtmlPrompt({
    templateHtml: '',
    paperPdfPath: path.join(PAPER_DIR, 'paper.pdf'),
    paperMetaPath: path.join(PAPER_DIR, 'paper_meta.json'),
    paperMetaJson: metaJson,
    paperTextPath: path.join(PAPER_DIR, 'paper_text.txt'),
    paperTextPreviewPath: path.join(PAPER_DIR, 'paper_text_preview.txt'),
    paperTextPreview: textPreview,
    openreviewSummaryPath: path.join(PAPER_DIR, 'openreview_summary.md'),
    openreviewSummary: openreviewSummary,
    pageImagesDir: path.join(PAPER_DIR, 'pages'),
    pageTextsDir: path.join(PAPER_DIR, 'page_texts'),
    pageImageCount: attachedPageImages.length,
    routeContextJson: '{}',
    dependencyCardsJson: '[]'
  });

  console.log('[smoke] Prompt length:', promptText.length, 'chars');
  console.log('[smoke] Starting Claude Code HTML generation...');
  console.log('[smoke] Model: claude-sonnet-4-6');
  console.log('[smoke] Timeout: 600s (10 min)');

  // Remove old output
  if (fs.existsSync(TARGET_HTML)) fs.unlinkSync(TARGET_HTML);
  if (fs.existsSync(FINAL_MESSAGE)) fs.unlinkSync(FINAL_MESSAGE);

  const startMs = Date.now();
  try {
    const result = await runClaudeCodeHtmlGeneration({
      workingDir: PAPER_DIR,
      targetHtmlPath: TARGET_HTML,
      finalMessagePath: FINAL_MESSAGE,
      promptText,
      attachedPageImages,
      model: 'claude-sonnet-4-6',
      timeoutMs: 600000  // 10 min
    });

    const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[smoke] Generation completed in ${durationSec}s`);
    console.log('[smoke] Status:', JSON.stringify(result.status));
    console.log('[smoke] Recovered from working dir:', result.recoveredFromWorkingDir);
    console.log('[smoke] Session:', result.sessionName);

    // Check output
    if (fs.existsSync(TARGET_HTML)) {
      const html = fs.readFileSync(TARGET_HTML, 'utf8');
      console.log('[smoke] HTML size:', html.length, 'bytes');
      console.log('[smoke] Starts with <!doctype:', /^<!doctype html/i.test(html.trim()));
      console.log('[smoke] Has </html>:', /<\/html>/i.test(html));

      // Quick quality check
      const hasTitle = /<title>/i.test(html);
      const hasBody = /<body/i.test(html);
      const hasH1 = /<h1/i.test(html);
      console.log('[smoke] Has <title>:', hasTitle);
      console.log('[smoke] Has <body>:', hasBody);
      console.log('[smoke] Has <h1>:', hasH1);
      console.log('[smoke] SMOKE TEST PASSED');
    } else {
      console.error('[smoke] ERROR: No index.html produced!');
      console.error('[smoke] stdout (first 1000):', result.stdout?.slice(0, 1000));
      console.error('[smoke] stderr (first 1000):', result.stderr?.slice(0, 1000));
      process.exit(1);
    }
  } catch (error) {
    const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.error(`[smoke] FAILED after ${durationSec}s:`, error.message);
    // Print runtime logs if available
    const runtimeDir = path.join(PAPER_DIR, '.claude-code-html-runs');
    if (fs.existsSync(runtimeDir)) {
      const entries = fs.readdirSync(runtimeDir);
      for (const entry of entries) {
        const stderrLog = path.join(runtimeDir, entry, 'stderr.log');
        if (fs.existsSync(stderrLog)) {
          console.error('[smoke] stderr.log (last 2000):', fs.readFileSync(stderrLog, 'utf8').slice(-2000));
        }
      }
    }
    process.exit(1);
  }
}

main();
