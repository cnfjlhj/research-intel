#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');

const ROOT_DIR = path.join(__dirname, '../..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, 'work', 'research-intel', 'profile');
const EXAMPLE_DIR = path.join(ROOT_DIR, 'examples', 'profile', 'default');

function parseArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    useExample: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--output-dir') {
      options.outputDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === '--use-example') {
      options.useExample = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath, records) {
  writeText(
    filePath,
    records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '')
  );
}

function slugify(text, fallback = 'branch') {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}

function parseList(text) {
  return String(text || '')
    .split(/[\n,，;；]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseNumberOr(value, fallback) {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBranchSpecs(text) {
  return String(text || '')
    .split(/[\n;；]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [titleRaw, questionRaw] = entry.split('::');
      const title = (titleRaw || '').trim();
      const question = (questionRaw || `这个分支主要想回答什么问题？`).trim();
      return {
        id: slugify(title, `branch-${index + 1}`),
        title: title || `分支 ${index + 1}`,
        question,
        keywords: []
      };
    });
}

function parseSeedSpecs(text) {
  return String(text || '')
    .split(/[\n;；]/)
    .map(item => item.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [titleRaw, noteRaw] = entry.split('|');
      return {
        title: (titleRaw || '').trim(),
        status: 'read',
        anchor: true,
        liked: true,
        branchId: '',
        notes: (noteRaw || `锚点论文 ${index + 1}`).trim()
      };
    })
    .filter(item => item.title);
}

function buildResearchBrief({
  timezone,
  sendTime,
  minPapers,
  targetPapers,
  maxPapers,
  direction,
  currentGoal,
  focusKeywords,
  positiveSignals,
  negativeSignals,
  readingPreference
}) {
  return [
    '---',
    `timezone: ${timezone}`,
    `send_time: "${sendTime}"`,
    `min_papers: ${minPapers}`,
    `target_papers: ${targetPapers}`,
    `max_papers: ${maxPapers}`,
    '---',
    '',
    '# Research Brief',
    '',
    '## Current Goal',
    `- ${currentGoal}`,
    `- 当前研究方向：${direction}`,
    '',
    '## Focus Keywords',
    ...focusKeywords.map(item => `- ${item}`),
    '',
    '## Positive Signals',
    ...positiveSignals.map(item => `- ${item}`),
    '',
    '## Negative Signals',
    ...negativeSignals.map(item => `- ${item}`),
    '',
    '## Reading Preference',
    `- ${readingPreference}`,
    `- 每天推荐 ${minPapers} 到 ${maxPapers} 篇，目标 ${targetPapers} 篇。`,
    ''
  ].join('\n');
}

function buildFeedbackRecords(positiveSignals, negativeSignals) {
  return [
    ...positiveSignals.map(item => ({
      title: `Prefer ${item}`,
      status: 'read',
      anchor: false,
      liked: true,
      notes: `当前阶段偏好包含 “${item}” 信号的论文。`
    })),
    ...negativeSignals.map(item => ({
      title: `Avoid ${item}`,
      status: 'archived',
      anchor: false,
      liked: false,
      notes: `当前阶段尽量避免 “${item}” 这类论文。`
    }))
  ];
}

function buildMethodTreeNotes(direction, branchSpecs) {
  return [
    '# Method Tree Notes',
    '',
    `- 当前长期账本围绕 “${direction}” 展开。`,
    '- 第一层优先按研究问题组织，不要退化成关键词桶。',
    '- 每篇论文先回答它补了什么缺口，再回答它用了什么机制。',
    '- 当天阅读顺序要体现主线，而不是模板化理由复读。',
    ...branchSpecs.map(branch => `- 分支「${branch.title}」重点回答：${branch.question}`)
  ].join('\n') + '\n';
}

function copyExampleProfile(outputDir) {
  ensureDir(outputDir);
  for (const fileName of fs.readdirSync(EXAMPLE_DIR)) {
    const sourcePath = path.join(EXAMPLE_DIR, fileName);
    const targetPath = path.join(outputDir, fileName);
    fs.copyFileSync(sourcePath, targetPath);
  }
}

async function askQuestion(rl, question, defaultValue = '') {
  const suffix = defaultValue ? ` [默认：${defaultValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}\n> `)).trim();
  return answer || defaultValue;
}

async function interactiveInit(outputDir) {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const timezone = await askQuestion(rl, '时区是什么？', 'Asia/Shanghai');
    const sendTime = await askQuestion(rl, '每天几点推送？使用 HH:MM', '06:00');
    const direction = await askQuestion(rl, '你的研究方向是什么？', 'self-evolving agents');
    const currentGoal = await askQuestion(
      rl,
      '当前阶段的核心目标是什么？',
      '优先积累方法组件、问题框架与必要性分析，而不是堆泛主题综述。'
    );
    const focusKeywords = parseList(await askQuestion(
      rl,
      '重点关键词有哪些？多个可用逗号或分号分隔',
      'self-evolving agents, self-improving agents, open-ended evolution, automated discovery'
    ));
    const positiveSignals = parseList(await askQuestion(
      rl,
      '正向信号有哪些？什么样的论文更值得进主线？',
      'experience sharing, verifier loop, memory archive, minimal necessary structure'
    ));
    const negativeSignals = parseList(await askQuestion(
      rl,
      '负向信号有哪些？什么样的论文应该降权？',
      'pure survey, coding benchmark only, product workflow without new learning mechanism'
    ));
    const minPapers = parseNumberOr(await askQuestion(rl, '每天最少几篇？', '3'), 3);
    const targetPapers = parseNumberOr(await askQuestion(rl, '每天目标几篇？', '5'), 5);
    const maxPapers = parseNumberOr(await askQuestion(rl, '每天最多几篇？', '8'), 8);
    const readingPreference = await askQuestion(
      rl,
      '你希望系统如何解释“为什么今天看它”？',
      '优先解释它补了哪块方法拼图、为什么现在该看，以及它和锚点论文之间的关系。'
    );
    const branchSpecs = parseBranchSpecs(await askQuestion(
      rl,
      '长期账本第一层问题怎么分？使用 “标题::问题描述” ，多项用分号分隔',
      '为什么强 baseline 还不够::相比强 code agent baseline，还缺了什么；到底让什么在演化::模型、上下文、工具、架构、搜索策略到底改了哪一层；什么反馈在驱动改进::奖励、verifier、群体经验或搜索，哪种反馈真的有效'
    ));
    const seeds = parseSeedSpecs(await askQuestion(
      rl,
      '锚点论文有哪些？使用 “标题|备注” ，多项用分号分隔；可留空',
      ''
    ));

    ensureDir(outputDir);
    writeText(path.join(outputDir, 'research_brief.md'), buildResearchBrief({
      timezone,
      sendTime,
      minPapers,
      targetPapers,
      maxPapers,
      direction,
      currentGoal,
      focusKeywords,
      positiveSignals,
      negativeSignals,
      readingPreference
    }));
    writeJsonl(path.join(outputDir, 'seed_papers.jsonl'), seeds);
    writeJsonl(path.join(outputDir, 'feedback.jsonl'), buildFeedbackRecords(positiveSignals, negativeSignals));
    writeJson(path.join(outputDir, 'method_taxonomy.json'), {
      root_title: direction,
      branches: branchSpecs
    });
    writeText(path.join(outputDir, 'method_tree_notes.md'), buildMethodTreeNotes(direction, branchSpecs));

    console.log(`\n已生成研究画像：${outputDir}`);
    console.log('建议下一步：');
    console.log('1. 手动检查 work/research-intel/profile/ 下的文件');
    console.log('2. 运行 npm run daily -- --no-telegram');
    console.log('3. 确认链路无误后再开启 Telegram 推送');
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.useExample) {
    copyExampleProfile(options.outputDir);
    console.log(`已复制示例画像到 ${options.outputDir}`);
    return;
  }

  await interactiveInit(options.outputDir);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildFeedbackRecords,
  buildMethodTreeNotes,
  buildResearchBrief,
  parseBranchSpecs,
  parseList,
  parseSeedSpecs
};
