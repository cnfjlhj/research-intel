#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { findRelatedSeeds: findRelatedSeedsFromCore } = require('./core');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bulletList(items) {
  return items.map(item => `<li>${escapeHtml(item)}</li>`).join('\n');
}

function markdownLink(title, url) {
  if (!title || !url) {
    return '暂无';
  }
  return `[${title}](${url})`;
}

function summarizeCodeRepos(codeRepos) {
  if (!(codeRepos || []).length) {
    return '暂无';
  }
  const repo = codeRepos[0];
  return markdownLink(repo.full_name || repo.title || '代码仓库', repo.html_url || repo.url);
}

function summarizeChineseBlogs(blogs) {
  if (!(blogs || []).length) {
    return '暂无';
  }
  return blogs.slice(0, 2).map(blog => markdownLink(blog.title, blog.url)).join('；');
}

function summarizeCoverageLinks(items) {
  if (!(items || []).length) {
    return '暂无';
  }
  return items.slice(0, 2).map(item => markdownLink(item.title, item.url)).join('；');
}

function summarizeMotivation(paper) {
  return paper.motivationSummary
    || paper.paperCard?.core_problem?.find(item => item && !/命中关键词/.test(item))
    || paper.paperCard?.summary_anchor
    || paper.reasonWhyToday
    || '暂无';
}

function summarizeMethodTakeaway(paper) {
  if (paper.methodTakeaway) {
    return paper.methodTakeaway;
  }
  const tags = [
    ...(paper.paperCard?.method_tags || []),
    ...(paper.matchedKeywords || []),
    ...(paper.matchedSignals || [])
  ].filter(Boolean);
  if (tags.length > 0) {
    return `主要切口：${tags.slice(0, 3).join('、')}`;
  }
  return '暂无';
}

function summarizeEvidenceCounts(paper) {
  return `代码 ${(paper.webCoverage?.codeRepos || []).length} / 中文博客 ${(paper.webCoverage?.chineseBlogs || []).length} / 外部报道 ${(paper.webCoverage?.coverage || []).length}`;
}

function summarizeWatchlistReason(paper) {
  if (paper.watchlistReason) {
    return paper.watchlistReason;
  }
  const reasons = new Set((paper.reasons || []).map(reason => String(reason || '').trim()).filter(Boolean));
  if (paper.selectionBand === 'strong') {
    return '和今日主线高度相关，但优先级暂时排在主推之后。';
  }
  if (paper.selectionBand === 'borderline') {
    return '方向接近且有直接方法证据，但今天先不进入主推。';
  }
  if (reasons.has('very_old')) {
    return '方法线相关，但发布时间较早，先作为回补材料保留。';
  }
  if (reasons.has('stale_without_core')) {
    return '与当前主线相邻，但核心证据还不够集中，先观察。';
  }
  return '与当前方向相关，但今天先保留在观察池。';
}

function buildHjfyUrl(paper) {
  const arxivId = String(
    paper?.pdfUrl
    || paper?.absUrl
    || paper?.paperMeta?.arxiv?.pdf_url
    || paper?.paperMeta?.arxiv?.abs_url
    || paper?.arxivId
    || paper?.paperMeta?.arxiv?.id
    || ''
  ).trim();
  const match = arxivId.match(/(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,}(?:v\d+)?|[a-zA-Z.\-]+\/\d+(?:v\d+)?)(?:\.pdf)?/i);
  const normalized = match ? match[1] : arxivId;
  return normalized ? `https://hjfy.top/arxiv/${encodeURIComponent(normalized)}` : '';
}

function buildCoverageMarkdown({ paperTitle, webCoverage }) {
  const lines = [
    `# ${paperTitle} 外部线索`,
    '',
    `- 检索时间：${webCoverage?.queriedAt || 'unknown'}`,
    ''
  ];

  lines.push('## 中文博客');
  if ((webCoverage?.chineseBlogs || []).length === 0) {
    lines.push('- 暂无');
  } else {
    for (const item of webCoverage.chineseBlogs) {
      lines.push(`- ${item.title}: ${item.url}`);
    }
  }
  lines.push('');

  lines.push('## 外部报道');
  if ((webCoverage?.coverage || []).length === 0) {
    lines.push('- 暂无');
  } else {
    for (const item of webCoverage.coverage) {
      lines.push(`- ${item.title}: ${item.url}`);
    }
  }
  lines.push('');

  lines.push('## 开源代码');
  if ((webCoverage?.codeRepos || []).length === 0) {
    lines.push('- 暂无');
  } else {
    for (const item of webCoverage.codeRepos) {
      lines.push(`- ${item.full_name}: ${item.html_url} (stars: ${item.stargazers_count || 0})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderPaperHtml({ paper, summary, relatedSeeds = [] }) {
  const titleShort = paper.title.split(':')[0];
  const seedText = relatedSeeds.length
    ? relatedSeeds.map(seed => seed.title).join('；')
    : '暂无直接锚点匹配';
  const hjfyUrl = buildHjfyUrl(paper);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(titleShort)} - 深度解读</title>
    <meta name="description" content="${escapeHtml(paper.title)} 单篇研究解读页">
    <link rel="icon" href="data:,">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        :root { --apple-bg:#f5f5f7; --apple-text:#1d1d1f; --apple-blue:#0066cc; --apple-blue-soft:#eaf3ff; --apple-card:rgba(255,255,255,.82); --apple-border:rgba(255,255,255,.45); --apple-muted:#6e6e73; }
        body { font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; background:radial-gradient(circle at top left, rgba(0,102,204,.10), transparent 28%), radial-gradient(circle at top right, rgba(120,180,255,.12), transparent 22%), linear-gradient(180deg, #ffffff 0%, var(--apple-bg) 100%); color:var(--apple-text); line-height:1.7; overflow-x:hidden; }
        .apple-container { max-width:1080px; margin:0 auto; padding:0 20px; }
        .glass-card { background:var(--apple-card); backdrop-filter:blur(22px); border-radius:24px; border:1px solid var(--apple-border); box-shadow:0 10px 30px rgba(15,23,42,.06); }
        .section-title { font-size:2.4rem; font-weight:700; letter-spacing:-0.03em; margin-bottom:2rem; text-align:center; }
        .highlight-text { color:var(--apple-blue); font-weight:600; }
        .hero-gradient { background:linear-gradient(180deg, rgba(255,255,255,.75) 0%, rgba(245,245,247,.95) 100%); }
        .tag { display:inline-block; padding:6px 14px; border-radius:999px; background:var(--apple-blue-soft); color:var(--apple-blue); font-size:.82rem; font-weight:600; margin-right:8px; margin-bottom:8px; }
        .quote-box { border-left:4px solid var(--apple-blue); padding:18px 20px; background:rgba(0,102,204,.05); border-radius:0 16px 16px 0; }
        .katex-display { overflow-x:auto; overflow-y:hidden; padding:12px 0; }
    </style>
</head>
<body>
    <section class="hero-gradient py-20 px-4 text-center">
        <div class="apple-container">
            <p class="text-sm font-semibold tracking-widest text-gray-500 uppercase mb-5">${escapeHtml(paper.arxivId || 'Latest Paper')} · ${escapeHtml((paper.categories || []).join(' / '))}</p>
            <h1 class="text-5xl md:text-7xl font-bold mb-6 tracking-tight">${escapeHtml(titleShort)}</h1>
            <p class="text-2xl md:text-3xl font-light text-gray-600 mb-10">${escapeHtml(paper.title)}</p>
            <div class="flex flex-wrap justify-center gap-3 mb-8">
                ${(paper.matchedKeywords || []).slice(0, 4).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
            <div class="flex flex-wrap justify-center gap-4 text-gray-500 text-sm italic mb-8">
                <span>${escapeHtml((paper.authors || []).join(' · '))}</span>
            </div>
            <div class="flex flex-wrap justify-center gap-3 text-sm">
                <a class="px-4 py-2 rounded-full bg-black text-white" href="${escapeHtml(paper.absUrl || '#')}" target="_blank" rel="noreferrer">Abstract</a>
                <a class="px-4 py-2 rounded-full bg-white border border-gray-200" href="${escapeHtml(paper.pdfUrl || '#')}" target="_blank" rel="noreferrer">PDF</a>
                ${hjfyUrl ? `<a class="px-4 py-2 rounded-full bg-white border border-gray-200" href="${escapeHtml(hjfyUrl)}" target="_blank" rel="noreferrer">双栏对照</a>` : ''}
            </div>
        </div>
    </section>

    <section class="py-12 apple-container">
        <div class="glass-card p-10">
            <p class="text-sm text-gray-500 uppercase tracking-wider mb-3">Why Today</p>
            <p class="text-lg text-gray-800">${escapeHtml(paper.reasonWhyToday || summary.hook || paper.summary || '')}</p>
            <p class="mt-4 text-sm text-gray-500">关联锚点：${escapeHtml(seedText)}</p>
        </div>
    </section>

    <section class="py-16 apple-container">
        <h2 class="section-title">1. 研究动机</h2>
        <div class="glass-card p-10"><p>${escapeHtml(summary.motivation)}</p></div>
    </section>

    <section class="py-16 bg-white">
        <div class="apple-container">
            <h2 class="section-title">2. 研究意义与核心创新</h2>
            <div class="glass-card p-10">
                <p class="mb-6">${escapeHtml(summary.significance)}</p>
                <ul class="list-disc pl-6 space-y-3 text-gray-700">${bulletList(summary.core_innovations || [])}</ul>
            </div>
        </div>
    </section>

    <section class="py-16 apple-container">
        <h2 class="section-title">3. 方法流程</h2>
        <div class="glass-card p-10">
            <ol class="list-decimal pl-6 space-y-3 text-gray-700">${bulletList(summary.method_pipeline || [])}</ol>
        </div>
    </section>

    <section class="py-16 bg-white">
        <div class="apple-container">
            <h2 class="section-title">4. 实验设计</h2>
            <div class="glass-card p-10">
                <ul class="list-disc pl-6 space-y-3 text-gray-700">${bulletList(summary.experimental_design || [])}</ul>
            </div>
        </div>
    </section>

    <section class="py-16 apple-container">
        <h2 class="section-title">5. 关键结果</h2>
        <div class="glass-card p-10">
            <ul class="list-disc pl-6 space-y-3 text-gray-700">${bulletList(summary.key_results || [])}</ul>
        </div>
    </section>

    <section class="py-16 bg-white">
        <div class="apple-container">
            <h2 class="section-title">6. 审稿与 Rebuttal</h2>
            <div class="glass-card p-10">
                <ul class="list-disc pl-6 space-y-3 text-gray-700">${bulletList(summary.rebuttal || ['暂无公开 OpenReview 信息。'])}</ul>
            </div>
        </div>
    </section>

    <section class="py-16 apple-container">
        <h2 class="section-title">7. 我的锐评</h2>
        <div class="glass-card p-10">
            <div class="grid md:grid-cols-2 gap-8">
                <div>
                    <h3 class="text-xl font-bold mb-4">这篇工作的强点</h3>
                    <ul class="list-disc pl-6 space-y-3 text-gray-700">${bulletList(summary.critique_strengths || [])}</ul>
                </div>
                <div>
                    <h3 class="text-xl font-bold mb-4">这篇工作的短板</h3>
                    <ul class="list-disc pl-6 space-y-3 text-gray-700">${bulletList(summary.critique_weaknesses || [])}</ul>
                </div>
            </div>
            <div class="mt-8 quote-box">
                <p class="font-semibold mb-2">One More Thing</p>
                <p>${escapeHtml(summary.one_more_thing || '')}</p>
            </div>
        </div>
    </section>

    <script>
        document.addEventListener('DOMContentLoaded', function () {
            renderMathInElement(document.body, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\\\(', right: '\\\\)', display: false }
                ],
                throwOnError: false
            });
        });
    </script>
</body>
</html>`;
}

function buildBriefMarkdown(selectedPapers, dateString, dailyCuration = null, watchlistPapers = []) {
  const lines = [
    `# ${dateString} Paper Brief`,
    ''
  ];

  if (dailyCuration?.overview) {
    lines.push('## 今日主线');
    lines.push(`- ${dailyCuration.overview}`);
    lines.push('');
  }

  if (dailyCuration?.route_logic) {
    lines.push('## 阅读策略');
    lines.push(`- ${dailyCuration.route_logic}`);
    lines.push('');
  }

  lines.push('| 论文 | 研究动机 | 方法切口 | 为什么今天看 | 线索 |');
  lines.push('| --- | --- | --- | --- | --- |');

  for (const paper of selectedPapers) {
    lines.push(`| ${paper.title} | ${summarizeMotivation(paper)} | ${summarizeMethodTakeaway(paper)} | ${paper.reasonWhyToday} | ${summarizeEvidenceCounts(paper)} |`);
  }

  lines.push('');
  lines.push('## Quick Takes');
  lines.push('');
  selectedPapers.forEach((paper, index) => {
    lines.push(`### ${index + 1}. ${paper.title}`);
    lines.push(`- 研究动机：${summarizeMotivation(paper)}`);
    lines.push(`- 方法切口：${summarizeMethodTakeaway(paper)}`);
    lines.push(`- 今日理由：${paper.reasonWhyToday}`);
    lines.push(`- 关联锚点：${(paper.relatedSeeds || []).map(seed => seed.title).join('；') || '暂无'}`);
    lines.push(`- 线索：${summarizeEvidenceCounts(paper)}`);
    lines.push(`- 代码：${summarizeCodeRepos(paper.webCoverage?.codeRepos)}`);
    lines.push(`- 中文博客：${summarizeChineseBlogs(paper.webCoverage?.chineseBlogs)}`);
    lines.push(`- 外部报道：${summarizeCoverageLinks(paper.webCoverage?.coverage)}`);
    lines.push('');
  });

  if ((watchlistPapers || []).length > 0) {
    lines.push('## 观察池 / Watchlist');
    lines.push('');
    lines.push('| 论文 | 为什么先放观察池 | 方法切口 | 线索 |');
    lines.push('| --- | --- | --- | --- |');
    for (const paper of watchlistPapers) {
      lines.push(`| ${paper.title} | ${summarizeWatchlistReason(paper)} | ${summarizeMethodTakeaway(paper)} | ${summarizeEvidenceCounts(paper)} |`);
    }
    lines.push('');

    watchlistPapers.forEach((paper, index) => {
      lines.push(`### Watch ${index + 1}. ${paper.title}`);
      lines.push(`- 观察理由：${summarizeWatchlistReason(paper)}`);
      lines.push(`- 研究动机：${summarizeMotivation(paper)}`);
      lines.push(`- 方法切口：${summarizeMethodTakeaway(paper)}`);
      lines.push(`- 关联锚点：${(paper.relatedSeeds || []).map(seed => seed.title).join('；') || '暂无'}`);
      lines.push('');
    });
  }
  return lines.join('\n');
}

function buildReadingOrderMarkdown(selectedPapers, dateString, dailyCuration = null) {
  const lines = [
    `# ${dateString} Reading Order`,
    '',
    '## 建议阅读顺序',
    ''
  ];

  if (dailyCuration?.route_logic) {
    lines.push(`- 路线说明：${dailyCuration.route_logic}`);
    lines.push('');
  }

  selectedPapers.forEach((paper, index) => {
    lines.push(`${index + 1}. ${paper.title}`);
    if (paper.readingStage) {
      lines.push(`   阶段：${paper.readingStage}`);
    }
    lines.push(`   排序理由：${paper.readingReason}`);
    lines.push(`   研究动机：${summarizeMotivation(paper)}`);
    lines.push(`   方法切口：${summarizeMethodTakeaway(paper)}`);
    if ((paper.matchedKeywords || []).length > 0) {
      lines.push(`   关键词：${paper.matchedKeywords.join('；')}`);
    }
    if ((paper.webCoverage?.codeRepos || []).length > 0 || (paper.webCoverage?.chineseBlogs || []).length > 0) {
      lines.push(`   外部线索：${summarizeEvidenceCounts(paper)}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

function buildTelegramMessage({ dateString, selectedPapers, watchlistPapers = [], artifactPackage }) {
  const lines = [
    `Research Intelligence ${dateString}`,
    '',
    `今天推荐 ${selectedPapers.length} 篇，方向聚焦 self-evolving agents / automated discovery。`,
    ''
  ];

  selectedPapers.forEach((paper, index) => {
    lines.push(`${index + 1}. ${paper.title}`);
    lines.push(`- ${paper.reasonWhyToday}`);
    lines.push(`- 代码 ${(paper.webCoverage?.codeRepos || []).length} / 中文博客 ${(paper.webCoverage?.chineseBlogs || []).length} / 外部报道 ${(paper.webCoverage?.coverage || []).length}`);
  });

  if (watchlistPapers.length > 0) {
    lines.push('');
    lines.push(`观察池 ${watchlistPapers.length} 篇（站点 / brief 内查看）：`);
    watchlistPapers.slice(0, 3).forEach((paper, index) => {
      lines.push(`- ${index + 1}. ${paper.title}`);
    });
  }

  lines.push('');
  lines.push(`文件包：${path.basename(artifactPackage)}`);
  return lines.join('\n');
}

function buildMethodTreeDeltaMarkdown({ dateString, delta, paperCards }) {
  const lines = [
    `# ${dateString} Method Tree Delta`,
    '',
    `- ${delta?.summary || '暂无知识树变化摘要'}`,
    ''
  ];

  lines.push('## Added Branches');
  if (!(delta?.addedBranches || []).length) {
    lines.push('- 暂无');
  } else {
    for (const branch of delta.addedBranches.slice(0, 20)) {
      lines.push(`- ${branch.title}`);
    }
  }
  lines.push('');

  lines.push('## Added Shared Concepts');
  if (!(delta?.addedSharedConcepts || []).length) {
    lines.push('- 暂无');
  } else {
    for (const concept of delta.addedSharedConcepts.slice(0, 20)) {
      lines.push(`- ${concept.branchTitle}: ${concept.concept}`);
    }
  }
  lines.push('');

  lines.push('## Added Papers');
  if (!(delta?.addedPapers || []).length) {
    lines.push('- 暂无');
  } else {
    for (const paper of delta.addedPapers.slice(0, 20)) {
      lines.push(`- ${paper.branchTitle}: ${paper.title}`);
    }
  }
  lines.push('');

  lines.push('## New Paper Cards');
  if (!(paperCards || []).length) {
    lines.push('- 暂无');
  } else {
    for (const card of paperCards) {
      lines.push(`- ${card.title}`);
      if ((card.relation_to_seeds || []).length) {
        lines.push(`  关联锚点：${card.relation_to_seeds.join('；')}`);
      }
      if ((card.method_tags || []).length) {
        lines.push(`  方法标签：${card.method_tags.join('；')}`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

function findRelatedSeeds(paper, seeds) {
  return findRelatedSeedsFromCore(paper, seeds, 2);
}

module.exports = {
  buildBriefMarkdown,
  buildCoverageMarkdown,
  buildMethodTreeDeltaMarkdown,
  buildReadingOrderMarkdown,
  buildTelegramMessage,
  findRelatedSeeds,
  renderPaperHtml
};
