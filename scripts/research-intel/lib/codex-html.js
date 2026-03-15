#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { runCommandWithTimeout } = require('./process-runner');

const KATEX_VERSION = '0.16.9';
const KATEX_PRIMARY_BASE_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist`;
const KATEX_FALLBACK_BASE_URL = `https://unpkg.com/katex@${KATEX_VERSION}/dist`;
const BUNDLED_KATEX_ASSET_DIR = path.join(__dirname, '..', 'assets', 'katex');
const REQUIRED_VISIBLE_HEADINGS = [
  '研究动机',
  '数学表示及建模',
  '实验方法与实验设计',
  '实验结果及核心结论',
  '评论',
  'Rebuttal 过程（如果有）',
  'One More Thing'
];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength = 220) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function coerceStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => normalizeWhitespace(typeof item === 'string' ? item : item?.name || item?.title || item?.full_name || ''))
    .filter(Boolean);
}

function extractSentences(text, limit = 8) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const matches = normalized.match(/[^。！？.!?]+[。！？.!?]?/g) || [normalized];
  return [...new Set(matches.map(item => normalizeWhitespace(item)).filter(Boolean))].slice(0, limit);
}

function pickSentencesByKeyword(text, keywords, limit = 2) {
  const loweredKeywords = (keywords || []).map(keyword => String(keyword || '').toLowerCase());
  return extractSentences(text, 16)
    .filter(sentence => loweredKeywords.some(keyword => sentence.toLowerCase().includes(keyword)))
    .slice(0, limit);
}

function formatDateLabel(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '日期信息未提供';
  }
  return parsed.toISOString().slice(0, 10);
}

function pickSummaryText(meta = {}, paperTextPreview = '') {
  const candidates = [
    meta.summary,
    meta.tldr,
    meta.abstract,
    paperTextPreview
  ];

  for (const candidate of candidates) {
    const normalized = truncateText(candidate, 260);
    if (normalized) {
      return normalized;
    }
  }
  return '当前自动化流程已经拿到论文题目与局部正文，但还没有更多可稳定引用的外部材料。';
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function findMissingVisibleHeadings(html) {
  const headingTexts = [...String(html || '').matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map(match => stripTags(match[1]));

  return REQUIRED_VISIBLE_HEADINGS.filter(marker => !headingTexts.some(text => text.includes(marker)));
}

function buildTemplateDesignReference(templateHtml = '') {
  const normalized = String(templateHtml || '');
  const hasGlassCard = /glass-card/.test(normalized);
  const hasHeroGradient = /hero-gradient/.test(normalized);
  const hasAppleVars = /--apple-bg/.test(normalized) && /--apple-text/.test(normalized);
  const hasWideSections = /section-title/.test(normalized) || /apple-container/.test(normalized);

  return [
    '模板视觉语言参考（只借鉴风格，不复用原论文内容）：',
    '- 整体方向是苹果官网式长页面叙事，而不是普通博客文章或简单白底报告页。',
    `- ${hasHeroGradient ? '保留' : '建议使用'} 大幅 hero 区、柔和渐变背景和明显的首屏叙事感。`,
    `- ${hasGlassCard ? '保留' : '建议使用'} 半透明/玻璃感信息卡片，但不要整页都堆成同一种卡片。`,
    `- ${hasWideSections ? '保留' : '建议使用'} 宽幅留白、清晰分区、桌面端双栏或多栏与移动端单栏的自适应切换。`,
    `- ${hasAppleVars ? '保留' : '建议使用'} 苹果系浅色中性背景、克制的高亮色、细腻阴影与圆角。`,
    '- 页面需要有强层次感：hero、概览信息带、正文分区、证据卡、表格区、锐评区、结尾收束区。',
    '- 即使不能使用 Tailwind CDN 或 Google Fonts，也要靠手写 CSS 维持精致感，不能退化成朴素文档页。',
    '- 避免“从头到尾只有一列堆叠白卡片”的保守布局，至少要出现几种不同的模块形态。'
  ].join('\n');
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function resolveAttachedPageImages(imagePaths) {
  return [...imagePaths].sort(naturalCompare);
}

function scoreEvidencePage(text) {
  const normalized = String(text || '').toLowerCase();
  let score = 0;
  const weightedTerms = [
    ['figure', 4],
    ['table', 4],
    ['algorithm', 4],
    ['experiment', 3],
    ['results', 3],
    ['ablation', 3],
    ['benchmark', 3],
    ['appendix', 2],
    ['setup', 2],
    ['overview', 2],
    ['method', 2]
  ];

  for (const [term, weight] of weightedTerms) {
    if (normalized.includes(term)) {
      score += weight;
    }
  }
  return score;
}

function chooseEvidencePages(pageEntries, maxImages = 8) {
  if (pageEntries.length <= maxImages) {
    return [...pageEntries].sort((left, right) => left.pageNumber - right.pageNumber);
  }

  const earlyPages = pageEntries
    .filter(entry => entry.pageNumber <= 2)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  const selectedNumbers = new Set(earlyPages.map(entry => entry.pageNumber));
  const ranked = pageEntries
    .map(entry => ({
      ...entry,
      evidenceScore: scoreEvidencePage(entry.text)
    }))
    .filter(entry => !selectedNumbers.has(entry.pageNumber))
    .sort((left, right) => right.evidenceScore - left.evidenceScore || left.pageNumber - right.pageNumber);

  const selected = [...earlyPages];
  for (const entry of ranked) {
    if (selected.length >= maxImages) {
      break;
    }
    selected.push(entry);
    selectedNumbers.add(entry.pageNumber);
  }

  return selected.sort((left, right) => left.pageNumber - right.pageNumber);
}

function compactEvidenceText(text, maxLength = 420) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function inferEvidencePageRole(text) {
  const normalized = String(text || '').toLowerCase();
  if (/ablation|benchmark|results|table\s*\d+/i.test(normalized)) {
    return 'ablation_or_results';
  }
  if (/appendix|hyperparameter|training detail|implementation|prompt|setup/i.test(normalized)) {
    return 'appendix_or_setup';
  }
  if (/algorithm|pseudo ?code|method|optimization/i.test(normalized)) {
    return 'method_or_algorithm';
  }
  if (/overview|framework|architecture|system overview|figure\s*1/i.test(normalized)) {
    return 'overview_or_architecture';
  }
  return 'general_evidence';
}

function extractEvidenceSignalTags(text) {
  const normalized = String(text || '').toLowerCase();
  const tags = [];
  const maybeAdd = (condition, tag) => {
    if (condition && !tags.includes(tag)) {
      tags.push(tag);
    }
  };

  maybeAdd(/figure\s*\d+|图\s*\d+/.test(normalized), 'figure');
  maybeAdd(/table\s*\d+|表\s*\d+/.test(normalized), 'table');
  maybeAdd(/algorithm|pseudo ?code/.test(normalized), 'algorithm');
  maybeAdd(/benchmark/.test(normalized), 'benchmark');
  maybeAdd(/ablation/.test(normalized), 'ablation');
  maybeAdd(/appendix/.test(normalized), 'appendix');
  maybeAdd(/hyperparameter|training detail|implementation|setup|prompt/.test(normalized), 'hyperparameter');

  return tags;
}

function buildEvidenceManifest(evidencePages = []) {
  return (evidencePages || []).map(entry => ({
    pageNumber: entry.pageNumber,
    imagePath: entry.imagePath,
    textPath: entry.textPath || '',
    pageRole: inferEvidencePageRole(entry.text),
    signalTags: extractEvidenceSignalTags(entry.text),
    textExcerpt: compactEvidenceText(entry.text),
    mentionedItems: [...new Set(
      String(entry.text || '')
        .match(/(?:Figure|Table|图|表)\s*\d+/gi) || []
    )]
  }));
}

function buildCodexHtmlPrompt({
  templatePath,
  targetHtmlPath,
  paperMetaPath,
  paperTextPath,
  openreviewSummaryPath,
  openreviewThreadPath,
  attachedPageImages
}) {
  const imageList = attachedPageImages.map(filePath => `- ${filePath}`).join('\n');

  return [
    '你是一位顶级的 AI researcher、全栈开发者和学术信息设计师。',
    '你的任务不是写摘要，而是把一篇复杂论文转化为一个真正可阅读、可审美、可复盘的动态 HTML 网页。',
    '网页风格应接近苹果官网的长页面叙事体验：克制、清晰、精致，但绝不能因为好看而牺牲技术细节。',
    '',
    '交付物：',
    `1. 你必须直接写出并保存到 ${targetHtmlPath}。`,
    '2. 产物必须是单一、完整、可本地打开的 index.html。',
    '3. 你的最终回复不需要解释过程，只需要说明已写入哪个路径，以及最可能需要人工复核的 1-3 个点。',
    '',
    '页面必须深度覆盖并重点展示：',
    '- 研究动机：发现了什么问题，为什么需要解决，本文的 significance 是什么。',
    '- 核心想法与方法总览：先让我快速建立“这篇论文到底做了什么”的整体心智模型。',
    '- 数学表示及建模：从符号、公式、推导、算法流程到关键设计选择，尽量把形式化部分讲透。',
    '- 实验方法与实验设计：模型、数据、训练/推理设置、超参数、prompt、appendix 细节，尽量达到可复现程度。',
    '- 实验结果及核心结论：baseline、主结果、ablation、insight、failure case、作者声称与证据的关系。',
    '- 你的评论：像一个真正犀利但公正的 reviewer 一样评价优点、不足、可疑点和后续改进方向。',
    '- Rebuttal 过程（如果有）：把 OpenReview 中的争议点、回应点、审稿人错误理解与作者补充澄清整理清楚。',
    '- One More Thing：任何你认为值得额外提醒我的内容，可以是图表、局限、方法谱系、启发式读法等。',
    '',
    '设计与内容硬要求：',
    '1. attached images 是论文 PDF 的关键页面证据，必须认真查看。',
    '2. 不得只依赖提取文本；正文提取只能辅助定位，图表、表格、算法框、appendix 细节必须结合页面图像判断。',
    '3. 如果你不确定某个数字、表格项或 figure 细节，要明确标注“不确定”，不要编造。',
    '4. 如果论文没有 OpenReview / rebuttal 信息，不要伪造该部分。',
    '5. 除公式和必要术语外，尽量使用中文。',
    '6. 页面要有“作品感”，不能退化成普通单栏摘要页或一串机械堆叠的白色卡片。',
    '7. 至少包含这些视觉层次中的大部分：沉浸式 hero、概览信息带、目录/导航、双栏或多栏内容区、figure/table 证据卡、评议区、结尾收束区。',
    '8. 可见标题（h1/h2/h3）中必须直接出现这些字样，可以在前后加编号或副标题，但不能替换这些词：',
    ...REQUIRED_VISIBLE_HEADINGS.map(item => `   - ${item}`),
    '9. 使用 KaTeX 处理行内和块级公式；行内公式统一使用 \\( ... \\)，块级公式统一使用 $$ ... $$。',
    '10. 对每个关键 figure/table 尽量给出具体编号、页码、作用和你从页面中读到的关键信息。',
    '11. 若无法直接嵌入原图，可用高质量占位块标记 Figure/Table 编号、页码与作用，但内容必须来自论文而不是猜测。',
    '12. 除 KaTeX 外，不要引入其他外部脚本、外部字体或远程样式；不要使用 Tailwind CDN，不要使用 Google Fonts，CSS 直接内联在 <style> 中。',
    '',
    '请先阅读这些本地文件：',
    `- 模板: ${templatePath}`,
    `- 论文元信息: ${paperMetaPath}`,
    `- 论文文本抽取（仅辅助）: ${paperTextPath}`,
    `- OpenReview 摘要: ${openreviewSummaryPath}`,
    openreviewThreadPath ? `- OpenReview 原始线程: ${openreviewThreadPath}` : '- OpenReview 原始线程: 无',
    '',
    '证据优先级：',
    '1. attached images / PDF 页面图像',
    '2. 论文元信息与正文提取文本',
    '3. OpenReview / rebuttal / review thread（如果有）',
    '4. 其他外部材料（如果有）',
    '',
    '额外提醒：',
    '- 读者读完这个页面后，应该能把握论文 90% 左右的核心内容与复现关键，而不是只记住一句结论。',
    '- 页面应当“像一个精致的研究产品页”，而不是“模型把材料塞进几个卡片里”。',
    '- 数学、实验、图表、评论这几个部分不能失衡。',
    '',
    'attached images 列表：',
    imageList || '- 无',
    '',
    '完成后：',
    '- 只需要在最终回复中简短说明你写到了哪个路径，以及你认为最可能还需要人工复核的 1-3 个点。',
    '- 不要把完整 HTML 贴在最终回复里。'
  ].join('\n');
}

function buildCodexInlineHtmlPrompt({
  templateHtml,
  paperMetaJson,
  paperTextPreview,
  openreviewSummary,
  pageImageCount
}) {
  const templateReference = buildTemplateDesignReference(templateHtml);

  return [
    '你是一位顶级的 AI researcher 以及全栈开发者，同时也是一位精通学术内容解读与数据可视化的信息设计师。',
    '你的任务是将一篇复杂的学术论文，转化为一个符合苹果官网设计美学、交互流畅、信息层级分明的动态 HTML 网页。',
    '你输出的不是摘要、不是提纲、不是解释，而是最终完整的 index.html。',
    '',
    '请将当前这篇论文，严格按照要求生成一个单一、完整、可直接本地打开的 index.html 文件。',
    '网页需深度解析并重点展示论文的：',
    '- 研究动机：发现了什么问题，为什么需要解决这个问题，本文研究的 significance 是什么。',
    '- 核心想法与方法总览：先让我快速建立“这篇论文到底做了什么”的整体心智模型。',
    '- 数学表示及建模：从符号/表示到公式，以及公式推导和算法流程，注意支持 LaTeX 渲染。',
    '- 实验方法与实验设计：系统性整理实验细节（模型、数据、超参数、prompt、appendix 细节等），尽可能达到可复现程度。',
    '- 实验结果及核心结论：对比了哪些 baseline，达到了什么效果，揭示了什么结论与 insight。',
    '- 你的评论：作为一个犀利但公正的 reviewer，整体锐评这篇工作，指出优势、不足以及可能的改进方向。',
    '- Rebuttal 过程（如果有）：整理 OpenReview 上的重要争议点、作者回应与审稿意见变化。',
    '- One More Thing：任何你认为真正重要、值得额外讲给我听的内容。',
    '',
    '这次的工程化附加约束如下：',
    '不要运行 shell，不要读仓库里的其他文件；你只基于本条消息给你的材料和 attached images 完成任务。',
    '最终回复必须只包含完整的 index.html 源码，不能有 markdown code fence，不能有前言后记。',
    '不要调用任何额外模型，不要把输出退化成解释性文本。',
    '',
    '证据优先级：',
    '1. attached images / 论文 PDF 页面图像',
    '2. 论文元信息与正文提取文本',
    '3. OpenReview / rebuttal / review thread（如果有）',
    '4. 其他外部材料（如果有）',
    '',
    '强要求：',
    '- attached images 是论文 PDF 的关键页面图像证据，你必须认真查看，用它们判断 figure/table/算法框/实验页的内容。',
    '- 不得只依赖提取文本；文本只作为辅助。',
    '- 如果你不确定某个数字、表格项或 figure 细节，要明确标注“不确定”，不要编造。',
    '- 如果论文没有 OpenReview / rebuttal 信息，不要伪造该部分。',
    '- 必须使用 KaTeX 支持数学渲染。',
    '- 行内公式统一使用 \\( ... \\)。',
    '- 块级公式统一使用 $$ ... $$。',
    '- 必须覆盖：论文概览、研究动机、核心想法与方法总览、数学表示及建模、实验方法与实验设计、实验结果及核心结论、你的评论、Rebuttal 过程（如果有）、One More Thing。',
    '- 页面必须看起来像经过认真设计的研究产品页，而不是普通 markdown 长文或“从头到尾一列白卡片”的保守排版。',
    '- 至少要出现这些视觉模块中的大部分：沉浸式 hero、概览信息带、目录或快速导航、双栏/多栏正文区、figure/table 证据卡、reviewer note / rebuttal 区、结尾总结区。',
    '- 即使不能使用 Tailwind CDN 或 Google Fonts，也必须靠手写 CSS 做出高级感、节奏感和层次感。',
    '- 可见标题（h1/h2/h3）中必须直接出现这些字样，可以加编号或副标题，但这些短语本身必须原样出现：',
    ...REQUIRED_VISIBLE_HEADINGS.map(item => `  - ${item}`),
    '- 不要使用 Tailwind CDN，不要使用 Google Fonts；CSS 直接写进 <style>。',
    '- 除 KaTeX CSS/JS 外，不要再引入其他外部脚本、外部字体或远程样式。',
    '- 在 <head> 中加入 <link rel="icon" href="data:,">，避免无意义的 favicon 报错。',
    '- 页面风格参考模板的视觉语言，但内容必须根据当前论文真实材料重写。',
    '- 不得把页面图像里看不清的表格数字编造成具体数值。',
    '- 对每个关键 figure/table 尽量给出编号、页码、作用和它支持的论点。',
    '- 对论文中的关键实验表格，尽量把真实表格数据整理进页面，而不是只写一句“效果很好”。',
    '- 你的评论部分要有洞见，不能只是礼貌复述作者贡献。',
    '- 除公式以及少量必要英文术语外，尽可能用中文。',
    '',
    `attached images 数量：${pageImageCount}`,
    '',
    templateReference,
    '',
    '下面是论文元信息 JSON：',
    '```json',
    paperMetaJson,
    '```',
    '',
    '下面是 OpenReview 摘要：',
    '```md',
    openreviewSummary || '暂无公开 OpenReview 信息。',
    '```',
    '',
    '下面是论文文本提取预览（仅辅助，优先级低于页面图像）：',
    '```text',
    paperTextPreview,
    '```',
    '',
    '在输出最终 HTML 之前，请你在内部完成自检，但不要把自检过程写出来：',
    '- 是否只输出 HTML',
    '- 是否同时满足“苹果官网式质感”和“深度论文解读”这两个目标',
    '- 是否避免退化成普通单栏摘要页、普通博客页或机械堆卡片页面',
    '- 是否保留 KaTeX 且没有其他远程依赖',
    '- 是否覆盖研究动机、方法、数学、实验、结果、评论、Rebuttal（如有）、One More Thing',
    '- 如果没有 OpenReview，是否避免伪造该部分',
    '- 是否存在“TODO / 待补 / placeholder”式垃圾占位',
    '- 是否有明显编造的表格数值、超参数或实验结果',
    '- 是否让读者读完后足以把握论文约 90% 的核心信息与复现关键'
  ].join('\n');
}

function buildHtmlRepairPrompt({
  currentHtml,
  validationReport,
  paperMetaJson,
  openreviewSummary,
  paperTextPreview
}) {
  return [
    '你现在是在修补一份已经生成过的 index.html。',
    '这不是从零生成；你必须基于当前 HTML 修改，使其通过本地浏览器验收。',
    '最终回复必须只包含完整的 index.html 源码，不能有 markdown code fence，不能有解释。',
    '',
    '修补原则：',
    '- 必须基于当前 HTML 修改，不能丢掉已有的有效内容。',
    '- 不要推倒重写视觉风格；保留原有布局、信息层次和整体审美，除非某部分正是故障根源。',
    '- 不要把页面修成普通文档页、普通博客页或一串保守的堆叠卡片。',
    '- 如果需要移除外部依赖，应该用手写 CSS / 原生实现补回视觉层次，而不是直接把设计感削没。',
    '- 尽量保留 hero、信息带、双栏内容区、figure/table 证据块、reviewer note、结尾收束区等结构。',
    '- 优先修复 validation report 中指出的问题。',
    '- 如果是外部依赖导致问题，优先删掉不必要的外链依赖，改成内联 CSS 或更稳妥的实现。',
    '- 如果 validation report 提到 Tailwind CDN 警告，你必须移除 https://cdn.tailwindcss.com，并把实际用到的样式内联到 <style> 中。',
    '- 不要因为修一个 JS/KaTeX 问题把整页内容重写。',
    '- 若某个内容不确定，可以保留“不确定”标记，但不能编造。',
    '- 如果论文没有 OpenReview / rebuttal 信息，不要为了凑结构硬写一大段不存在的审稿讨论。',
    '- KaTeX 仍然必须保留。',
    '- 评论部分仍然要有洞见，不能在修补时被你删成客套话。',
    '- 可见标题（h1/h2/h3）中必须直接出现这些字样：',
    ...REQUIRED_VISIBLE_HEADINGS.map(item => `  - ${item}`),
    '',
    'validation report 如下：',
    '```json',
    JSON.stringify(validationReport, null, 2),
    '```',
    '',
    '论文元信息如下：',
    '```json',
    paperMetaJson,
    '```',
    '',
    'OpenReview 摘要如下：',
    '```md',
    openreviewSummary || '暂无公开 OpenReview 信息。',
    '```',
    '',
    '论文文本提取预览如下：',
    '```text',
    paperTextPreview,
    '```',
    '',
    '当前 HTML 如下：',
    '```html',
    currentHtml,
    '```'
  ].join('\n');
}

function buildHtmlEnhancementPrompt({
  currentHtml,
  paperMetaJson,
  paperTextPreview,
  openreviewSummary,
  webCoverageJson,
  evidenceManifestJson
}) {
  return [
    '你现在要基于当前 HTML 深化和修补一份论文页面，而不是从零另起炉灶。',
    '目标是：保留 Gemini 初稿里已经成立的视觉质感和页面节奏，但把内容深度、证据密度、图表呈现和 reviewer 视角补足。',
    '最终回复必须只包含完整的 index.html 源码，不能有 markdown code fence，不能有解释。',
    '',
    '硬要求：',
    '- 尽量保留 Gemini 初稿里已经成立的视觉结构、hero、信息带和模块节奏，不要退化成普通博客页。',
    '- 必须补强研究动机、数学表示及建模、实验方法与实验设计、实验结果及核心结论、评论、One More Thing。',
    '- 如果 OpenReview 信息存在，要把争议点和 rebuttal 过程说清楚；如果没有，不要伪造。',
    '- 真实页面证据比提取文本更重要。你会收到 evidence manifest，请根据这些页码和图像线索补 Figure/Table 的具体编号、作用与结论。',
    '- 如果当前 HTML 里还有 placeholder、占位图、TODO、待补 Figure/Table 之类的痕迹，优先把它们替换成真实 Figure/Table 编号、页码、用途与结论；不能把 placeholder 原样留到最终版本。',
    '- 至少把 2 处最关键的 Figure/Table/页面证据融入正文相应章节，而不是只在页面最后额外挂一组附图。',
    '- web coverage 里如果有中文长文、代码仓库、媒体报道，要合理吸收到页面里，别浪费。',
    '- 评论部分不能客气话复读，必须像认真看过论文的研究者。',
    '- 最终 HTML 只能保留一份完整文档：只能出现一个 <!DOCTYPE html>、一个 <html>、一个 <body>。不要把旧页面整份复制到新页面后面。',
    '- 至少把 2 个关键 figure/table 证据块真正放进相关章节，而不是只在结尾泛泛提一句“见图表”。',
    '- 如果 appendix 或实验页里给出了可复现细节，要补进实验方法与实验设计，而不是停留在高层摘要。',
    '',
    '你要读取并综合这些材料：',
    '1. 当前 HTML（保留其视觉优点）',
    '2. 论文元信息 JSON',
    '3. 论文文本预览',
    '4. OpenReview 摘要',
    '5. web coverage JSON',
    '6. evidence manifest JSON',
    '',
    '下面是当前 HTML：',
    '```html',
    currentHtml,
    '```',
    '',
    '下面是论文元信息 JSON：',
    '```json',
    paperMetaJson,
    '```',
    '',
    '下面是 OpenReview 摘要：',
    '```md',
    openreviewSummary || '暂无公开 OpenReview 信息。',
    '```',
    '',
    '下面是 web coverage JSON：',
    '```json',
    webCoverageJson || '{"coverage":[],"chineseBlogs":[],"codeRepos":[]}',
    '```',
    '',
    '下面是 evidence manifest JSON：',
    '```json',
    evidenceManifestJson || '[]',
    '```',
    '',
    '下面是论文文本预览：',
    '```text',
    paperTextPreview,
    '```'
  ].join('\n');
}

function buildDeterministicFallbackHtml({
  meta = {},
  openreviewSummary = '',
  paperTextPreview = '',
  webCoverage = {}
}) {
  const title = normalizeWhitespace(meta.title) || '未命名论文';
  const summary = pickSummaryText(meta, paperTextPreview);
  const authors = coerceStringList(meta.authors);
  const chineseBlogs = coerceStringList(webCoverage.chineseBlogs);
  const codeRepos = coerceStringList(webCoverage.codeRepos);
  const methodSignals = pickSentencesByKeyword(
    `${meta.abstract || ''} ${paperTextPreview || ''}`,
    ['method', 'framework', 'model', 'agent', 'planning', 'reflect', 'memory', 'module', 'reasoning', 'segmentation'],
    3
  );
  const experimentSignals = pickSentencesByKeyword(
    paperTextPreview,
    ['experiment', 'benchmark', 'dataset', 'baseline', 'ablation', 'training', 'evaluation', 'setup', 'prompt', 'hyperparameter'],
    3
  );
  const resultSignals = pickSentencesByKeyword(
    `${meta.abstract || ''} ${paperTextPreview || ''}`,
    ['result', 'results', 'improve', 'performance', 'benchmark', 'ablation', 'gain', 'outperform', 'alignment'],
    3
  );
  const quickFacts = [
    ['发布日期', formatDateLabel(meta.published)],
    ['arXiv', normalizeWhitespace(meta?.arxiv?.id || meta.arxivId || '') || '未提供'],
    ['作者', authors.length ? truncateText(authors.join(', '), 120) : '当前元数据未完整暴露作者列表'],
    ['社区线索', `${chineseBlogs.length} 条中文长文 / ${codeRepos.length} 个代码仓线索`]
  ];
  const readingChecklist = [
    '先读 Hero 与一页速览，建立问题域和贡献边界。',
    '再看“数学表示及建模”和“实验方法与实验设计”，确认方法闭环与复现条件。',
    '最后结合末尾的论文页面证据区，交叉检查表格、图示和附录细节。'
  ];
  const reviewAngles = [
    `优点：${title} 明显在试图把任务流程做成完整闭环，而不是只在某个局部模块上做小修小补。`,
    '风险：如果核心增益主要来自更长推理链、更重工程堆叠或更强提示词，而不是建模本身，那么跨任务迁移性需要额外验证。',
    '建议：重点对照证据页中的主结果、消融实验和附录设置，确认结论是否由关键设计稳定支撑。'
  ];
  const rebuttalText = truncateText(openreviewSummary, 420);
  const insightCards = [
    {
      title: '核心问题',
      body: `这篇工作围绕“${title}”对应的问题设置展开，目标是把论文题目中的关键能力落到一个可以复盘、可以比较、也可以讨论局限的技术框架里。`
    },
    {
      title: '一句话把握',
      body: summary
    },
    {
      title: '验证重点',
      body: '阅读时优先核对方法闭环、实验边界、主结果是否和证据页一致，而不是只看摘要式宣传。'
    }
  ];

  const renderList = items => items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const renderCards = cards => cards.map(card => [
    '<article class="ri-insight-card">',
    `<h3>${escapeHtml(card.title)}</h3>`,
    `<p>${escapeHtml(card.body)}</p>`,
    '</article>'
  ].join('')).join('');
  const renderFactCards = quickFacts.map(([label, value]) => [
    '<div class="ri-fact-card">',
    `<span class="ri-fact-label">${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(value)}</strong>`,
    '</div>'
  ].join('')).join('');
  const renderSignalList = (items, fallbackItems) => {
    const source = items.length ? items : fallbackItems;
    return source.map(item => `<li>${escapeHtml(truncateText(item, 220))}</li>`).join('');
  };

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta name="color-scheme" content="light">',
    '  <link rel="icon" href="data:,">',
    `  <title>${escapeHtml(title)}</title>`,
    '  <style>',
    '    :root {',
    '      --ri-bg: #f4f1ea;',
    '      --ri-surface: rgba(255, 252, 247, 0.78);',
    '      --ri-panel: rgba(255, 255, 255, 0.72);',
    '      --ri-border: rgba(24, 34, 54, 0.14);',
    '      --ri-text: #172033;',
    '      --ri-muted: #51607b;',
    '      --ri-accent: #bf5b2c;',
    '      --ri-accent-soft: rgba(191, 91, 44, 0.12);',
    '      --ri-shadow: 0 24px 70px rgba(24, 34, 54, 0.12);',
    '      --ri-radius: 28px;',
    '    }',
    '    * { box-sizing: border-box; }',
    '    html { scroll-behavior: smooth; }',
    '    body {',
    '      margin: 0;',
    '      min-height: 100vh;',
    '      color: var(--ri-text);',
    '      background:',
    '        radial-gradient(circle at top left, rgba(238, 199, 116, 0.22), transparent 32%),',
    '        radial-gradient(circle at top right, rgba(112, 146, 255, 0.18), transparent 30%),',
    '        linear-gradient(180deg, #fbf8f2 0%, var(--ri-bg) 52%, #efe9de 100%);',
    '      font-family: "Charter", "Iowan Old Style", Georgia, serif;',
    '      line-height: 1.72;',
    '    }',
    '    a { color: inherit; }',
    '    .ri-shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 24px 0 64px; }',
    '    .ri-topbar {',
    '      display: flex;',
    '      align-items: center;',
    '      justify-content: space-between;',
    '      gap: 16px;',
    '      padding: 12px 18px;',
    '      border: 1px solid var(--ri-border);',
    '      border-radius: 999px;',
    '      background: rgba(255, 255, 255, 0.58);',
    '      backdrop-filter: blur(18px);',
    '      box-shadow: 0 10px 30px rgba(23, 32, 51, 0.08);',
    '      position: sticky;',
    '      top: 16px;',
    '      z-index: 30;',
    '    }',
    '    .ri-topbar nav { display: flex; flex-wrap: wrap; gap: 10px 14px; font-size: 13px; color: var(--ri-muted); }',
    '    .ri-topbar nav a { text-decoration: none; }',
    '    .ri-brand { font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ri-accent); }',
    '    .ri-hero {',
    '      margin-top: 24px;',
    '      padding: 44px;',
    '      border-radius: calc(var(--ri-radius) + 8px);',
    '      background: linear-gradient(135deg, rgba(255,255,255,0.82), rgba(255,248,240,0.66));',
    '      border: 1px solid rgba(255,255,255,0.6);',
    '      box-shadow: var(--ri-shadow);',
    '      overflow: hidden;',
    '      position: relative;',
    '    }',
    '    .ri-hero::after {',
    '      content: "";',
    '      position: absolute;',
    '      inset: auto -14% -28% auto;',
    '      width: 340px;',
    '      height: 340px;',
    '      border-radius: 50%;',
    '      background: radial-gradient(circle, rgba(191, 91, 44, 0.18) 0%, rgba(191, 91, 44, 0) 68%);',
    '      pointer-events: none;',
    '    }',
    '    .ri-kicker { font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ri-accent); }',
    '    h1, h2, h3 { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.08; }',
    '    h1 { margin-top: 12px; font-size: clamp(34px, 6vw, 62px); max-width: 14ch; }',
    '    .ri-hero p { max-width: 60ch; margin: 20px 0 0; font-size: 18px; color: #24314c; }',
    '    .ri-chip-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }',
    '    .ri-chip {',
    '      padding: 10px 14px;',
    '      border-radius: 999px;',
    '      background: rgba(23, 32, 51, 0.06);',
    '      border: 1px solid rgba(23, 32, 51, 0.1);',
    '      font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '      color: var(--ri-muted);',
    '    }',
    '    .ri-facts {',
    '      display: grid;',
    '      grid-template-columns: repeat(4, minmax(0, 1fr));',
    '      gap: 16px;',
    '      margin-top: 22px;',
    '    }',
    '    .ri-fact-card, .ri-panel, .ri-insight-card {',
    '      border: 1px solid var(--ri-border);',
    '      background: var(--ri-panel);',
    '      backdrop-filter: blur(18px);',
    '      border-radius: 22px;',
    '      box-shadow: 0 12px 28px rgba(23, 32, 51, 0.08);',
    '    }',
    '    .ri-fact-card { padding: 18px; }',
    '    .ri-fact-label { display: block; font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ri-muted); margin-bottom: 8px; }',
    '    .ri-fact-card strong { display: block; font-size: 17px; }',
    '    .ri-insight-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 28px; }',
    '    .ri-insight-card { padding: 24px; }',
    '    .ri-insight-card p { margin: 12px 0 0; color: #2d3a53; }',
    '    .ri-layout { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(290px, 0.9fr); gap: 24px; margin-top: 28px; }',
    '    main { display: grid; gap: 20px; }',
    '    .ri-panel { padding: 28px; }',
    '    .ri-panel h2 { font-size: clamp(24px, 3vw, 34px); margin-bottom: 18px; }',
    '    .ri-panel p { margin: 0 0 14px; color: #293751; }',
    '    .ri-panel ul { margin: 0; padding-left: 20px; color: #293751; }',
    '    .ri-panel li + li { margin-top: 10px; }',
    '    .ri-subgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 18px; }',
    '    .ri-subcard { padding: 18px; border-radius: 18px; background: rgba(191, 91, 44, 0.06); border: 1px solid rgba(191, 91, 44, 0.12); }',
    '    .ri-subcard h3 { font-size: 17px; margin-bottom: 10px; }',
    '    .ri-aside { display: grid; gap: 18px; align-self: start; position: sticky; top: 84px; }',
    '    .ri-note { padding: 22px; }',
    '    .ri-note h3 { font-size: 18px; margin-bottom: 12px; }',
    '    .ri-note ol, .ri-note ul { margin: 0; padding-left: 20px; }',
    '    .ri-quote { margin: 0; padding: 18px 20px; border-left: 4px solid var(--ri-accent); background: var(--ri-accent-soft); border-radius: 18px; color: #22314a; }',
    '    .ri-foot { margin-top: 18px; font-size: 14px; color: var(--ri-muted); }',
    '    @media (max-width: 980px) {',
    '      .ri-facts, .ri-insight-grid, .ri-layout, .ri-subgrid { grid-template-columns: 1fr; }',
    '      .ri-aside { position: static; }',
    '      .ri-hero { padding: 30px 24px; }',
    '      .ri-topbar { border-radius: 24px; align-items: flex-start; }',
    '    }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div class="ri-shell">',
    '    <header class="ri-topbar">',
    '      <div class="ri-brand">research intel fallback</div>',
    '      <nav>',
    '        <a href="#motivation">研究动机</a>',
    '        <a href="#math">数学表示及建模</a>',
    '        <a href="#experiment">实验方法与实验设计</a>',
    '        <a href="#results">实验结果及核心结论</a>',
    '        <a href="#comment">评论</a>',
    '        <a href="#rebuttal">Rebuttal 过程（如果有）</a>',
    '        <a href="#omt">One More Thing</a>',
    '      </nav>',
    '    </header>',
    '    <section class="ri-hero">',
    '      <div class="ri-kicker">Deterministic Research Page</div>',
    `      <h1>${escapeHtml(title)}</h1>`,
    `      <p>${escapeHtml(summary)}</p>`,
    '      <div class="ri-chip-row">',
    `        <span class="ri-chip">发布日期：${escapeHtml(formatDateLabel(meta.published))}</span>`,
    `        <span class="ri-chip">arXiv：${escapeHtml(normalizeWhitespace(meta?.arxiv?.id || meta.arxivId || '') || '未提供')}</span>`,
    `        <span class="ri-chip">作者数：${escapeHtml(String(authors.length || 0))}</span>`,
    `        <span class="ri-chip">社区线索：${escapeHtml(String(chineseBlogs.length + codeRepos.length))} 条</span>`,
    '      </div>',
    `      <div class="ri-facts">${renderFactCards}</div>`,
    `      <div class="ri-insight-grid">${renderCards(insightCards)}</div>`,
    '    </section>',
    '    <div class="ri-layout">',
    '      <main>',
    '        <section class="ri-panel" id="motivation">',
    '          <h2>研究动机</h2>',
    `          <p>从题目、摘要和当前可用正文抽取来看，这篇论文主要在处理“${escapeHtml(title)}”所对应的问题闭环。它关注的不只是单点模型效果，而是要把任务定义、决策逻辑、反馈信号和后续迭代放进同一个分析框架里。</p>`,
    `          <p>${escapeHtml(summary)} 这说明作者希望给出一套更稳的任务解释路径，而不是只靠一句高层结论让读者接受方法有效。</p>`,
    '          <div class="ri-subgrid">',
    '            <div class="ri-subcard">',
    '              <h3>问题压力</h3>',
    '              <p>如果没有更强的闭环或结构化设计，复杂任务通常会在长链路推理、信息累积或控制稳定性上出现掉点。</p>',
    '            </div>',
    '            <div class="ri-subcard">',
    '              <h3>阅读重点</h3>',
    '              <p>应优先判断作者提出的新结构到底改变了什么信息流，而不是先被包装性的叙述带着走。</p>',
    '            </div>',
    '          </div>',
    '        </section>',
    '        <section class="ri-panel" id="math">',
    '          <h2>数学表示及建模</h2>',
    '          <p>当前自动抽取文本没有稳定暴露完整符号表和公式推导，因此这里不伪造具体公式，而是先保留问题建模骨架：系统状态、候选动作、反馈或评价信号、以及更新后的内部记忆或策略状态。</p>',
    '          <ul>',
    renderSignalList(methodSignals, [
      '从可见文本判断，方法更像是把“规划/推理/执行/反思/更新”串成一个可反复迭代的闭环，而不是单次前向预测。',
      '如果正文或附录有显式目标函数、损失项或状态转移定义，应重点检查它们是否真的支撑了作者声称的泛化能力。',
      '建模部分最值得核对的是：哪些变量是被显式维护的，哪些改进来自结构，哪些只来自更长的上下文或提示词。'
    ]),
    '          </ul>',
    '        </section>',
    '        <section class="ri-panel" id="experiment">',
    '          <h2>实验方法与实验设计</h2>',
    '          <p>复现实验时，最关键的是把任务设置、数据来源、基线范围、训练或推理配置、以及附录里补充的实现条件一并看齐。否则只看主文主表，很容易高估方法的真实可迁移性。</p>',
    '          <ul>',
    renderSignalList(experimentSignals, [
      '优先确认论文到底比较了哪些强基线，以及这些基线是否在同一资源预算下被公平实现。',
      '如果论文涉及多阶段流程，需要分别看清每一阶段的输入、输出、评价信号和停止条件。',
      '附录中的训练设置、推理轮数、提示模板或超参数通常决定方法是否可复现，不应在阅读时被跳过。'
    ]),
    '          </ul>',
    '        </section>',
    '        <section class="ri-panel" id="results">',
    '          <h2>实验结果及核心结论</h2>',
    '          <p>这部分的判断标准不该只是“有没有赢”，而是“赢在什么任务、什么设置、什么代价下”，以及这些提升是否被消融实验和错误分析共同支撑。</p>',
    '          <ul>',
    renderSignalList(resultSignals, [
      '主结果需要和 baseline 对照、消融实验以及附录中的额外表格一起看，才能判断增益是否稳定。',
      '如果论文把结论建立在复杂链路或多组件交互上，最应该检查的是各组件拆开后是否仍然有足够解释力。',
      '当自动抽取没有暴露完整数字时，应把证据页中的表格和图示作为最终核验依据，而不是自行脑补精确幅度。'
    ]),
    '          </ul>',
    '        </section>',
    '        <section class="ri-panel" id="comment">',
    '          <h2>评论</h2>',
    '          <p>这篇工作的亮点，在于它至少试图把论文题目对应的问题变成一个更完整的系统，而不是只在局部技巧上堆名词。只要实验设置没有偷换边界，这种闭环化思路通常比单点 patch 更值得关注。</p>',
    '          <ul>',
    renderList(reviewAngles),
    '          </ul>',
    '        </section>',
    '        <section class="ri-panel" id="rebuttal">',
    '          <h2>Rebuttal 过程（如果有）</h2>',
    rebuttalText
      ? `          <blockquote class="ri-quote">${escapeHtml(rebuttalText)}</blockquote>`
      : '          <blockquote class="ri-quote">当前公开材料里没有稳定可用的 rebuttal 细节；这并不等于没有争议，只是当前自动流程不额外编造。</blockquote>',
    '          <p class="ri-foot">如果后续补到完整 OpenReview 线程，这一节最应该补的是：审稿人真正质疑了什么、作者回应了哪些证据、哪些误解被澄清、哪些问题仍然悬而未决。</p>',
    '        </section>',
    '        <section class="ri-panel" id="omt">',
    '          <h2>One More Thing</h2>',
    '          <p>这份页面是 deterministic fallback：它的目标不是替代高质量人工解读，而是在模型输出不稳定时，至少保留一份结构完整、可继续阅读、也不会误导后续自动链路的论文页面。</p>',
    '          <div class="ri-subgrid">',
    '            <div class="ri-subcard">',
    '              <h3>中文长文线索</h3>',
    `              <p>${escapeHtml(chineseBlogs.length ? truncateText(chineseBlogs.join('；'), 180) : '当前抓取里还没有稳定命中的中文长文。')}</p>`,
    '            </div>',
    '            <div class="ri-subcard">',
    '              <h3>代码仓线索</h3>',
    `              <p>${escapeHtml(codeRepos.length ? truncateText(codeRepos.join('；'), 180) : '当前抓取里还没有确认的公开代码仓。')}</p>`,
    '            </div>',
    '          </div>',
    '        </section>',
    '      </main>',
    '      <aside class="ri-aside">',
    '        <section class="ri-panel ri-note">',
    '          <h3>阅读顺序建议</h3>',
    '          <ol>',
    renderList(readingChecklist),
    '          </ol>',
    '        </section>',
    '        <section class="ri-panel ri-note">',
    '          <h3>复现时别跳过</h3>',
    '          <ul>',
    renderList([
      '基线是否同预算',
      '附录是否给了关键配置',
      '主结果是否被消融支撑',
      '证据页中的图表是否和正文说法一致'
    ]),
    '          </ul>',
    '        </section>',
    '      </aside>',
    '    </div>',
    '  </div>',
    '</body>',
    '</html>'
  ].join('\n');
}

function countPdfPages(pdfPath) {
  const result = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`pdfinfo failed: ${result.stderr || result.stdout}`);
  }

  const match = result.stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) {
    throw new Error(`Could not parse page count from pdfinfo output for ${pdfPath}`);
  }

  return Number(match[1]);
}

function renderPdfPagesToImages({ pdfPath, outputDir, dpi = 110 }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const prefix = path.join(outputDir, 'page');
  const result = spawnSync(
    'pdftoppm',
    ['-jpeg', '-jpegopt', 'quality=82', '-r', String(dpi), pdfPath, prefix],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );

  if (result.status !== 0) {
    throw new Error(`pdftoppm failed: ${result.stderr || result.stdout}`);
  }

  const pageCount = countPdfPages(pdfPath);
  const pageImages = fs.readdirSync(outputDir)
    .filter(name => /^page-\d+\.jpg$/i.test(name))
    .map(name => path.join(outputDir, name));

  const sorted = resolveAttachedPageImages(pageImages);
  if (sorted.length !== pageCount) {
    throw new Error(`Expected ${pageCount} page images, found ${sorted.length}`);
  }
  return sorted;
}

function extractPdfPageText({ pdfPath, pageNumber, outputPath }) {
  const result = spawnSync(
    'pdftotext',
    ['-layout', '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, outputPath],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(`pdftotext page ${pageNumber} failed: ${result.stderr || result.stdout}`);
  }
}

function selectEvidencePageImages({ pdfPath, pageImages, textOutputDir, maxImages = 8 }) {
  fs.mkdirSync(textOutputDir, { recursive: true });
  const pageEntries = resolveAttachedPageImages(pageImages).map((imagePath, index) => {
    const pageNumber = index + 1;
    const textPath = path.join(textOutputDir, `page-${String(pageNumber).padStart(2, '0')}.txt`);
    extractPdfPageText({ pdfPath, pageNumber, outputPath: textPath });
    const text = fs.readFileSync(textPath, 'utf8');
    return {
      pageNumber,
      imagePath,
      text,
      textPath
    };
  });

  return chooseEvidencePages(pageEntries, maxImages);
}

function cleanHtmlResponse(text) {
  let cleaned = String(text || '').trim();
  cleaned = cleaned.replace(/^```html\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '').trim();
  const htmlStart = cleaned.toLowerCase().indexOf('<!doctype html');
  const htmlTagStart = cleaned.toLowerCase().indexOf('<html');
  const startIndex = htmlStart !== -1 ? htmlStart : htmlTagStart;
  if (startIndex > 0) {
    cleaned = cleaned.slice(startIndex).trim();
  }
  const completeDoctypeDocument = cleaned.match(/<!doctype html[\s\S]*?<\/html>/i);
  if (completeDoctypeDocument) {
    return completeDoctypeDocument[0].trim();
  }
  const completeHtmlDocument = cleaned.match(/<html\b[\s\S]*?<\/html>/i);
  if (completeHtmlDocument) {
    return completeHtmlDocument[0].trim();
  }
  const nextDocumentStart = [
    cleaned.toLowerCase().indexOf('<!doctype html', 15),
    cleaned.toLowerCase().indexOf('<html', 6)
  ].filter(index => index > 0).sort((left, right) => left - right)[0];
  if (Number.isInteger(nextDocumentStart)) {
    cleaned = cleaned.slice(0, nextDocumentStart).trim();
  }
  return cleaned;
}

function inferEvidenceCaption(entry) {
  const text = String(entry?.text || '').replace(/\s+/g, ' ').trim();
  const lines = [];
  if (entry?.pageNumber) {
    lines.push(`第 ${entry.pageNumber} 页`);
  }
  if (/table/i.test(text)) {
    lines.push('包含关键表格证据');
  }
  if (/figure/i.test(text)) {
    lines.push('包含关键图示证据');
  }
  if (/ablation|benchmark|results|experiment/i.test(text)) {
    lines.push('结果与实验页');
  } else if (/algorithm|method|overview/i.test(text)) {
    lines.push('方法与算法页');
  }
  const preview = text.slice(0, 140);
  if (preview) {
    lines.push(preview);
  }
  return lines.join(' · ');
}

function imageMimeType(imagePath) {
  const normalized = String(imagePath || '').toLowerCase();
  if (normalized.endsWith('.png')) {
    return 'image/png';
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function injectEvidenceGallery(html, evidencePages = []) {
  const source = String(html || '');
  if (!evidencePages.length || /data-research-intel-evidence-gallery/.test(source)) {
    return source;
  }

  const galleryItems = evidencePages
    .filter(entry => entry?.imagePath && fs.existsSync(entry.imagePath))
    .map(entry => {
      const mimeType = imageMimeType(entry.imagePath);
      const encoded = fs.readFileSync(entry.imagePath).toString('base64');
      const caption = inferEvidenceCaption(entry);
      return [
        '<figure class="ri-evidence-card">',
        `<img src="data:${mimeType};base64,${encoded}" alt="${caption.replace(/"/g, '&quot;')}">`,
        `<figcaption>${caption}</figcaption>`,
        '</figure>'
      ].join('');
    });

  if (galleryItems.length === 0) {
    return source;
  }

  const galleryHtml = [
    '<style data-research-intel-evidence-gallery>',
    '.ri-evidence-gallery{margin:56px auto 0;padding:36px 0 0;border-top:1px solid rgba(20,20,20,0.08)}',
    '.ri-evidence-gallery h2{margin:0 0 12px}',
    '.ri-evidence-gallery p{margin:0 0 18px;color:#5e5248;line-height:1.7}',
    '.ri-evidence-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}',
    '.ri-evidence-card{margin:0;padding:14px;border-radius:22px;background:rgba(255,255,255,0.82);border:1px solid rgba(20,20,20,0.08);box-shadow:0 18px 42px rgba(32,24,18,0.08)}',
    '.ri-evidence-card img{display:block;width:100%;height:auto;border-radius:14px;background:#f3eee6}',
    '.ri-evidence-card figcaption{margin-top:10px;color:#544941;font-size:13px;line-height:1.65}',
    '</style>',
    '<section class="ri-evidence-gallery" data-research-intel-evidence-gallery="true">',
    '<h2>论文页面证据</h2>',
    '<p>下面这组页面证据由本地 PDF 实页直接内嵌进 HTML，用来补足图表、算法框、实验表格和 appendix 细节，避免页面只剩文字概述。</p>',
    `<div class="ri-evidence-grid">${galleryItems.join('')}</div>`,
    '</section>'
  ].join('');

  if (/<\/body>/i.test(source)) {
    return source.replace(/<\/body>/i, `${galleryHtml}\n</body>`);
  }
  return `${source}\n${galleryHtml}`;
}

function findPlaceholderMarkers(html) {
  const searchable = String(html || '')
    .replace(/data:[^"')\s>]+/gi, 'data:embedded-asset');
  return [...new Set(
    [...searchable.matchAll(/(?:placeholder|TODO|待补|占位|lorem ipsum)/gi)]
      .map(match => match[0])
  )];
}

function buildInlineEvidenceCard(entry, label = '') {
  if (!entry?.imagePath || !fs.existsSync(entry.imagePath)) {
    return '';
  }

  const mimeType = imageMimeType(entry.imagePath);
  const encoded = fs.readFileSync(entry.imagePath).toString('base64');
  const caption = label || inferEvidenceCaption(entry);
  return [
    '<figure class="ri-inline-evidence-card" data-research-intel-inline-evidence="true">',
    `<img src="data:${mimeType};base64,${encoded}" alt="${caption.replace(/"/g, '&quot;')}">`,
    '<figcaption>',
    '<strong>论文图表证据</strong><br>',
    `${caption}`,
    '</figcaption>',
    '</figure>'
  ].join('');
}

function findEvidenceEntryForPlaceholder(evidencePages = [], placeholderText = '') {
  const normalizedPlaceholder = String(placeholderText || '');
  const figureMatch = normalizedPlaceholder.match(/figure\s*(\d+)|图\s*(\d+)|table\s*(\d+)|表\s*(\d+)/i);
  const targetNumber = figureMatch ? Number(figureMatch[1] || figureMatch[2] || figureMatch[3] || figureMatch[4]) : null;

  if (targetNumber) {
    const direct = (evidencePages || []).find(entry => {
      const text = String(entry?.text || '');
      return new RegExp(`(?:figure|table)\\s*${targetNumber}\\b`, 'i').test(text);
    });
    if (direct) {
      return direct;
    }
  }

  return (evidencePages || [])[0] || null;
}

function replaceFigurePlaceholdersWithEvidence(html, evidencePages = []) {
  const source = String(html || '');
  if (!source || !(evidencePages || []).length) {
    return source;
  }

  return source.replace(/\[(Figure|图|Table|表)\s*([0-9]+)\s*[:：]\s*([^\]]+)\]/gi, (fullMatch) => {
    const entry = findEvidenceEntryForPlaceholder(evidencePages, fullMatch);
    if (!entry) {
      return fullMatch;
    }
    return buildInlineEvidenceCard(entry, fullMatch.replace(/^\[|\]$/g, ''));
  });
}

function inspectHtmlQuality(html, evidencePages = []) {
  const issues = [];
  const placeholderMarkers = findPlaceholderMarkers(html);
  const missingMarkers = findMissingVisibleHeadings(html);
  if (placeholderMarkers.length > 0) {
    issues.push({
      code: 'placeholder_marker',
      markers: placeholderMarkers
    });
  }

  if (missingMarkers.length > 0) {
    issues.push({
      code: 'missing_visible_heading',
      markers: missingMarkers
    });
  }

  const hasPlaceholderFigure = /\[(Figure|图|Table|表)\s*[0-9]+[:：][^\]]+\]/i.test(String(html || ''));
  const hasInlineEvidence = /data-research-intel-inline-evidence/i.test(String(html || ''));
  if (hasPlaceholderFigure && (evidencePages || []).length > 0 && !hasInlineEvidence) {
    issues.push({
      code: 'weak_figure_grounding',
      message: 'HTML 仍存在图表占位，但没有把 PDF 页面证据真正融入正文。'
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    placeholderMarkers,
    missingMarkers
  };
}

function rewriteHtmlToLocalKatexAssets(html, assetBasePath = 'assets/katex') {
  const replacements = [
    [`${KATEX_PRIMARY_BASE_URL}/katex.min.css`, `${assetBasePath}/katex.min.css`],
    [`${KATEX_PRIMARY_BASE_URL}/katex.min.js`, `${assetBasePath}/katex.min.js`],
    [`${KATEX_PRIMARY_BASE_URL}/contrib/auto-render.min.js`, `${assetBasePath}/auto-render.min.js`],
    [`${KATEX_FALLBACK_BASE_URL}/katex.min.css`, `${assetBasePath}/katex.min.css`],
    [`${KATEX_FALLBACK_BASE_URL}/katex.min.js`, `${assetBasePath}/katex.min.js`],
    [`${KATEX_FALLBACK_BASE_URL}/contrib/auto-render.min.js`, `${assetBasePath}/auto-render.min.js`]
  ];

  return replacements.reduce(
    (current, [remoteUrl, localPath]) => current.split(remoteUrl).join(localPath),
    String(html || '')
  );
}

function resolveBrowserExecutablePath({
  env = process.env,
  existsSync = fs.existsSync
} = {}) {
  const candidates = [
    env.RESEARCH_INTEL_CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function escapeForRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitHtmlByTagBlocks(html, tagName) {
  const pattern = tagName === 'script'
    ? /(<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>)/gi
    : new RegExp(`(<${tagName}\\b[\\s\\S]*?<\\/${tagName}>)`, 'gi');
  return String(html || '').split(pattern);
}

function replaceOutsideTagBlocks(html, { pattern, replacement, blockedTagName = 'script' }) {
  const parts = splitHtmlByTagBlocks(html, blockedTagName);
  const replacementValue = typeof replacement === 'function'
    ? replacement
    : () => replacement;
  return parts
    .map((part, index) => (index % 2 === 1 ? part : part.replace(pattern, replacementValue)))
    .join('');
}

function rewriteStyleBlocks(html, updater) {
  return String(html || '').replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (fullMatch, attributes, cssText) => {
    const nextCssText = updater(cssText);
    return `<style${attributes}>${nextCssText}</style>`;
  });
}

function stripForbiddenRemoteDependencies(html) {
  let nextHtml = String(html || '');
  nextHtml = replaceOutsideTagBlocks(nextHtml, {
    pattern: /<script[^>]*src=(["'])https?:\/\/cdn\.tailwindcss\.com(?:\/[^"']*)?\1[^>]*>\s*<\/script>\s*/gi,
    replacement: ''
  });
  nextHtml = replaceOutsideTagBlocks(nextHtml, {
    pattern: /<link[^>]*href=(["'])https?:\/\/fonts\.(?:googleapis|gstatic)\.com\/[^"']*\1[^>]*>\s*/gi,
    replacement: ''
  });
  nextHtml = rewriteStyleBlocks(nextHtml, cssText => String(cssText || '')
    .replace(/@import\s+url\((['"]?)https?:\/\/fonts\.googleapis\.com\/[^)]+\1\)\s*;?/gi, '')
    .replace(/@import\s+['"]https?:\/\/fonts\.googleapis\.com\/[^'"]+['"]\s*;?/gi, '')
  );
  return nextHtml;
}

function findRemoteAssetRefs(html) {
  const refs = new Set();
  const source = String(html || '');
  const assetTagPattern = /<(script|link|img|iframe|video|audio|source|embed|object)\b[^>]*(?:src|href|poster)=(["'])(https?:\/\/[^"']+)\2/gi;
  const cssImportPattern = /@import\s+url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi;

  for (const match of source.matchAll(assetTagPattern)) {
    refs.add(match[3]);
  }

  for (const match of source.matchAll(cssImportPattern)) {
    refs.add(match[2]);
  }

  return [...refs].sort();
}

function fontMimeType(fileName) {
  const normalized = String(fileName || '').toLowerCase();
  if (normalized.endsWith('.woff2')) {
    return 'font/woff2';
  }
  if (normalized.endsWith('.woff')) {
    return 'font/woff';
  }
  if (normalized.endsWith('.ttf')) {
    return 'font/ttf';
  }
  if (normalized.endsWith('.otf')) {
    return 'font/otf';
  }
  return 'application/octet-stream';
}

function inlineKatexFonts(cssText, assetDir) {
  return String(cssText || '').replace(/url\((?:'|")?(fonts\/[^)'"]+)(?:'|")?\)/g, (fullMatch, relativePath) => {
    const localPath = path.join(assetDir, relativePath);
    if (!fs.existsSync(localPath)) {
      return fullMatch;
    }
    const mimeType = fontMimeType(localPath);
    const encoded = fs.readFileSync(localPath).toString('base64');
    return `url(data:${mimeType};base64,${encoded})`;
  });
}

function inlineKatexAssetsInHtml(html, assetDir, assetBasePath = 'assets/katex') {
  const cssPath = path.join(assetDir, 'katex.min.css');
  const jsPath = path.join(assetDir, 'katex.min.js');
  const autoRenderPath = path.join(assetDir, 'auto-render.min.js');

  const cssText = fs.existsSync(cssPath)
    ? inlineKatexFonts(fs.readFileSync(cssPath, 'utf8'), assetDir)
    : '';
  const jsText = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
  const autoRenderText = fs.existsSync(autoRenderPath) ? fs.readFileSync(autoRenderPath, 'utf8') : '';

  const cssPattern = new RegExp(
    `<link[^>]*href=(["'])${escapeForRegex(`${assetBasePath}/katex.min.css`)}\\1[^>]*>`,
    'i'
  );
  const jsPattern = new RegExp(
    `<script[^>]*src=(["'])${escapeForRegex(`${assetBasePath}/katex.min.js`)}\\1[^>]*><\\/script>`,
    'i'
  );
  const autoRenderPattern = new RegExp(
    `<script[^>]*src=(["'])${escapeForRegex(`${assetBasePath}/auto-render.min.js`)}\\1[^>]*><\\/script>`,
    'i'
  );

  let nextHtml = stripForbiddenRemoteDependencies(String(html || ''));
  if (cssText) {
    nextHtml = replaceOutsideTagBlocks(nextHtml, {
      pattern: cssPattern,
      replacement: `<style data-katex-inline="css">\n${cssText}\n</style>`
    });
  }
  if (jsText) {
    nextHtml = replaceOutsideTagBlocks(nextHtml, {
      pattern: jsPattern,
      replacement: `<script data-katex-inline="js">\n${jsText}\n</script>`
    });
  }
  if (autoRenderText) {
    nextHtml = replaceOutsideTagBlocks(nextHtml, {
      pattern: autoRenderPattern,
      replacement: `<script data-katex-inline="auto-render">\n${autoRenderText}\n</script>`
    });
  }
  return nextHtml;
}

async function fetchBufferWithFallback(urls, { timeoutMs = 20000 } = {}) {
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = new Error(`${url} -> ${error.message}`);
    }
  }

  throw new Error(`Failed to download asset: ${lastError ? lastError.message : 'unknown error'}`);
}

function copyBundledKatexAssets(assetDir) {
  if (!fs.existsSync(BUNDLED_KATEX_ASSET_DIR)) {
    return false;
  }

  fs.cpSync(BUNDLED_KATEX_ASSET_DIR, assetDir, {
    recursive: true
  });
  return true;
}

function extractKatexFontFiles(cssText) {
  return [...new Set(
    [...String(cssText || '').matchAll(/url\((?:'|")?(fonts\/[^)'"]+)(?:'|")?\)/g)]
      .map(match => match[1].split('?')[0])
  )];
}

async function ensureLocalKatexAssets(assetDir) {
  fs.mkdirSync(assetDir, { recursive: true });
  const fontsDir = path.join(assetDir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });

  copyBundledKatexAssets(assetDir);

  const cssPath = path.join(assetDir, 'katex.min.css');
  const jsPath = path.join(assetDir, 'katex.min.js');
  const autoRenderPath = path.join(assetDir, 'auto-render.min.js');

  if (!fs.existsSync(cssPath)) {
    const cssBuffer = await fetchBufferWithFallback([
      `${KATEX_PRIMARY_BASE_URL}/katex.min.css`,
      `${KATEX_FALLBACK_BASE_URL}/katex.min.css`
    ]);
    fs.writeFileSync(cssPath, cssBuffer);
  }

  const cssText = fs.readFileSync(cssPath, 'utf8');
  const fontFiles = extractKatexFontFiles(cssText);
  for (const relativeFontPath of fontFiles) {
    const fontFileName = path.basename(relativeFontPath);
    const localFontPath = path.join(fontsDir, fontFileName);
    if (fs.existsSync(localFontPath)) {
      continue;
    }

    const downloadUrls = [
      `${KATEX_PRIMARY_BASE_URL}/${relativeFontPath}`,
      `${KATEX_FALLBACK_BASE_URL}/${relativeFontPath}`
    ];
    const fontBuffer = await fetchBufferWithFallback(downloadUrls);
    fs.writeFileSync(localFontPath, fontBuffer);
  }

  if (!fs.existsSync(jsPath)) {
    const jsBuffer = await fetchBufferWithFallback([
      `${KATEX_PRIMARY_BASE_URL}/katex.min.js`,
      `${KATEX_FALLBACK_BASE_URL}/katex.min.js`
    ]);
    fs.writeFileSync(jsPath, jsBuffer);
  }

  if (!fs.existsSync(autoRenderPath)) {
    const autoRenderBuffer = await fetchBufferWithFallback([
      `${KATEX_PRIMARY_BASE_URL}/contrib/auto-render.min.js`,
      `${KATEX_FALLBACK_BASE_URL}/contrib/auto-render.min.js`
    ]);
    fs.writeFileSync(autoRenderPath, autoRenderBuffer);
  }
}

async function prepareHtmlForLocalValidation(htmlPath) {
  const assetDir = path.join(path.dirname(htmlPath), 'assets', 'katex');
  await ensureLocalKatexAssets(assetDir);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const rewrittenHtml = rewriteHtmlToLocalKatexAssets(html, 'assets/katex');
  if (rewrittenHtml !== html) {
    fs.writeFileSync(htmlPath, rewrittenHtml, 'utf8');
  }
}

async function makeHtmlStandalone(htmlPath) {
  await prepareHtmlForLocalValidation(htmlPath);
  const assetDir = path.join(path.dirname(htmlPath), 'assets', 'katex');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const standaloneHtml = inlineKatexAssetsInHtml(html, assetDir, 'assets/katex');
  fs.writeFileSync(htmlPath, standaloneHtml, 'utf8');
}

async function captureValidationScreenshot(page, screenshotPath) {
  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: 'png'
    });
    return {
      mode: 'full-page',
      warning: ''
    };
  } catch (error) {
    const message = error?.message || '';
    if (!/Page\.captureScreenshot|Unable to capture screenshot/i.test(message)) {
      throw error;
    }
    await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      type: 'png'
    });
    return {
      mode: 'viewport',
      warning: message
    };
  }
}

async function runCodexHtmlGeneration({
  workingDir,
  targetHtmlPath,
  finalMessagePath,
  promptText,
  attachedPageImages,
  model = 'gpt-5.4-mini',
  timeoutMs = 120000
}) {
  const args = [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '-s',
    'read-only',
    '-m',
    model,
    '-C',
    workingDir,
    '-o',
    finalMessagePath
  ];

  for (const imagePath of resolveAttachedPageImages(attachedPageImages)) {
    args.push('-i', imagePath);
  }
  args.push('-');

  const result = await runCommandWithTimeout({
    command: 'codex',
    args,
    cwd: workingDir,
    input: promptText,
    timeoutMs,
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.code !== 0) {
    throw new Error(`codex exec failed (${result.code}${result.signal ? `, signal=${result.signal}` : ''}): ${result.stderr || result.stdout}`);
  }

  const rawFinalMessage = fs.existsSync(finalMessagePath) ? fs.readFileSync(finalMessagePath, 'utf8') : '';
  const html = cleanHtmlResponse(rawFinalMessage);
  if (!/^<!doctype html/i.test(html) && !/^<html/i.test(html)) {
    throw new Error(`Codex final message did not look like HTML: ${rawFinalMessage.slice(0, 300)}`);
  }
  fs.writeFileSync(targetHtmlPath, `${html}\n`, 'utf8');

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    finalMessage: rawFinalMessage
  };
}

async function validateHtmlWithBrowser({ htmlPath, screenshotPath, evidencePages = [] }) {
  await prepareHtmlForLocalValidation(htmlPath);
  const htmlSource = fs.readFileSync(htmlPath, 'utf8');
  const remoteAssetRefs = findRemoteAssetRefs(htmlSource);
  const placeholderMarkers = findPlaceholderMarkers(htmlSource);
  const qualityReport = inspectHtmlQuality(htmlSource, evidencePages);
  const executablePath = resolveBrowserExecutablePath();
  const browser = await puppeteer.launch({
    headless: 'new',
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  const consoleWarnings = [];
  const requestFailures = [];
  const pageErrors = [];
  const remoteRequests = [];
  const remoteRequestUrls = new Set();

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    } else if (message.type() === 'warning' || message.type() === 'warn') {
      consoleWarnings.push(message.text());
    }
  });
  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });
  page.on('request', request => {
    const url = request.url();
    if (/^(file:|data:|about:blank$)/i.test(url)) {
      return;
    }
    if (remoteRequestUrls.has(url)) {
      return;
    }
    remoteRequestUrls.add(url);
    remoteRequests.push({
      url,
      resourceType: request.resourceType()
    });
  });
  page.on('requestfailed', request => {
    requestFailures.push({
      url: request.url(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText || ''
    });
  });

  try {
    await page.goto(pathToFileURL(htmlPath).toString(), {
      waitUntil: 'networkidle2',
      timeout: 120000
    });
    const screenshot = await captureValidationScreenshot(page, screenshotPath);

    const title = await page.title();
    const headingTexts = await page.$$eval('h1, h2, h3', nodes => nodes.map(node => node.textContent || ''));
    const missingMarkers = REQUIRED_VISIBLE_HEADINGS.filter(marker => !headingTexts.some(text => text.includes(marker)));

    return {
      ok: consoleErrors.length === 0
        && pageErrors.length === 0
        && requestFailures.length === 0
        && remoteAssetRefs.length === 0
        && remoteRequests.length === 0
        && placeholderMarkers.length === 0
        && qualityReport.ok
        && missingMarkers.length === 0,
      title,
      consoleErrors,
      consoleWarnings,
      pageErrors,
      requestFailures,
      remoteAssetRefs,
      remoteRequests,
      placeholderMarkers,
      qualityIssues: qualityReport.issues,
      missingMarkers,
      screenshotMode: screenshot.mode,
      screenshotWarning: screenshot.warning,
      screenshotPath
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  buildCodexHtmlPrompt,
  buildDeterministicFallbackHtml,
  buildHtmlEnhancementPrompt,
  buildCodexInlineHtmlPrompt,
  buildHtmlRepairPrompt,
  buildEvidenceManifest,
  captureValidationScreenshot,
  chooseEvidencePages,
  cleanHtmlResponse,
  ensureLocalKatexAssets,
  inspectHtmlQuality,
  findRemoteAssetRefs,
  findPlaceholderMarkers,
  injectEvidenceGallery,
  inlineKatexAssetsInHtml,
  makeHtmlStandalone,
  replaceFigurePlaceholdersWithEvidence,
  resolveBrowserExecutablePath,
  rewriteHtmlToLocalKatexAssets,
  renderPdfPagesToImages,
  resolveAttachedPageImages,
  runCodexHtmlGeneration,
  selectEvidencePageImages,
  validateHtmlWithBrowser
};
