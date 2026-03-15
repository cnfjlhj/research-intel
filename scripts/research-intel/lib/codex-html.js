#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer-core');

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
  return [...new Set(
    [...String(html || '').matchAll(/(?:placeholder|TODO|待补|占位|lorem ipsum)/gi)]
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
  if (placeholderMarkers.length > 0) {
    issues.push({
      code: 'placeholder_marker',
      markers: placeholderMarkers
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
    placeholderMarkers
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

function runCodexHtmlGeneration({
  workingDir,
  targetHtmlPath,
  finalMessagePath,
  promptText,
  attachedPageImages,
  model = 'gpt-5.4-mini'
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

  const result = spawnSync('codex', args, {
    input: promptText,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30 * 60 * 1000
  });

  if (result.status !== 0) {
    throw new Error(`codex exec failed (${result.status}): ${result.stderr || result.stdout}`);
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
    const requiredMarkers = ['研究动机', '实验', '结果', '评论'];
    const missingMarkers = requiredMarkers.filter(marker => !headingTexts.some(text => text.includes(marker)));

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
