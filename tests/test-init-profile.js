const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFeedbackRecords,
  buildResearchBrief,
  parseBranchSpecs,
  parseList,
  parseSeedSpecs
} = require('../scripts/bootstrap/init-profile.js');

test('parseList supports Chinese and English separators', () => {
  assert.deepEqual(
    parseList('agent, verifier；memory\narchive'),
    ['agent', 'verifier', 'memory', 'archive']
  );
});

test('parseBranchSpecs builds structured branch definitions', () => {
  const branches = parseBranchSpecs('为什么 baseline 不够::缺了什么；什么在演化::哪一层被改写');
  assert.equal(branches.length, 2);
  assert.equal(branches[0].title, '为什么 baseline 不够');
  assert.equal(branches[1].question, '哪一层被改写');
});

test('parseSeedSpecs supports title and notes', () => {
  const seeds = parseSeedSpecs('Paper A|锚点 A；Paper B|锚点 B');
  assert.equal(seeds.length, 2);
  assert.equal(seeds[0].title, 'Paper A');
  assert.equal(seeds[1].notes, '锚点 B');
});

test('buildFeedbackRecords marks positive and negative signals correctly', () => {
  const records = buildFeedbackRecords(['verifier'], ['pure survey']);
  assert.equal(records[0].liked, true);
  assert.equal(records[1].liked, false);
  assert.equal(records[1].status, 'archived');
});

test('buildResearchBrief includes frontmatter and preference section', () => {
  const text = buildResearchBrief({
    timezone: 'Asia/Shanghai',
    sendTime: '06:00',
    minPapers: 3,
    targetPapers: 5,
    maxPapers: 8,
    direction: 'self-evolving agents',
    currentGoal: '积累方法组件',
    focusKeywords: ['self-evolving agents'],
    positiveSignals: ['verifier loop'],
    negativeSignals: ['pure survey'],
    readingPreference: '先解释为什么今天看'
  });

  assert.match(text, /timezone: Asia\/Shanghai/);
  assert.match(text, /## Reading Preference/);
  assert.match(text, /verifier loop/);
});
