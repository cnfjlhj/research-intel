# Baohe 基线归并表

## 决策原则

- `baohe` 现在正在运行、用户认可的行为，是产品基线
- 本地 dirty tree 里的增强，只能按“必要且不破坏基线契约”逐项吸收
- 先统一运行契约，再补功能，再发布 GitHub，再部署回 `baohe`

## 归并表

| 文件 | `baohe` 特征 | 本地 dirty 特征 | 归并决策 | 风险 |
|---|---|---|---|---|
| `README.md` | 更轻、更偏部署现实、`direct` 路径更突出 | 更重、更像实验分支说明，带 dual-artifact 契约 | 以 `baohe` 表述为主，吸收本地里真正有助首用引导的说明 | 中 |
| `docs/部署说明.md` | 更贴近当前部署行为 | 更贴近本地实验特性 | 以 `baohe` 部署实际为准重写，不直接照抄任一侧 | 中 |
| `scripts/research-intel/daily-run.js` | 更简单，接近当前运行主路径 | 更复杂，引入多 HTML 变体和更重打包 | 以 `baohe` 运行契约为主，只吸收必须的稳定性修复和新入口 | 高 |
| `scripts/research-intel/lib/codex-html.js` | prompt/生成契约更轻 | 更强校验、更强 fallback、更强数学约束 | 保留本地的安全/校验 hardening，但不能破坏 `baohe` 当前生成契约 | 高 |
| `scripts/research-intel/lib/web.js` | 更贴近当前站点 | 更强会话逻辑和更多入口 | 以 `baohe` Web 行为为主，增量补 onboarding / import 能力 | 高 |
| `tests/test-research-intel-codex-html.js` | 更贴近旧 prompt 契约 | 覆盖更强校验 | 跟随最终 `codex-html.js` 一起收敛 | 中 |
| `tests/test-research-intel-package.js` | 更轻 | 更偏多变体产物 | 跟随最终交付产物契约 | 中 |
| `scripts/research-intel/lib/codex-enhancement-config.js` | 缺失 | 本地新增 helper | 若保留本地 Codex 增强配置方式，则引入；否则不要半引入 | 高 |

## 当前建议的唯一主线

### 1. 先保住现有站点

- 不先切换到“Codex 主生成 + compare 多产物”大重构
- 不先把 `daily-run.js` 全量换成本地 dirty 版
- 先围绕 `baohe` 当前运行路径修 bug、补入口、补引导

### 2. 先补的功能

- 新用户研究画像引导
  - 在 Web 中明确提示该填写什么、为什么填
  - 把“研究方向 / 当前目标 / 关注关键词 / 正负信号 / 每天几篇”的入口做清楚
  - 不新发明另一套画像格式，直接复用 `scripts/bootstrap/init-profile.js`
- 论文直接导入
  - 单篇导入：arXiv URL / PDF URL / 标题 + 链接
  - 批量导入：多行文本 / JSONL / URL 列表
  - 进入 `seed_papers.jsonl`，并且必须能参与后续日报 / HTML 流程
- 话题启动研究
  - 输入感兴趣研究主题
  - 生成或更新画像
  - 触发一次发现 / 筛选 / HTML 流程

## 已补实证

- `baohe` 当前线上 profile 目录为 `work/research-intel/profile/`
- `baohe` 当前线上 `research_brief.md` 格式与本地 parser 契约一致
- 现有 Web 已经有 `settings + actions/run` 主路径，因此新功能应挂在这套契约上增量扩展
- `seed_papers.jsonl` / `feedback.jsonl` 确实被 `loadProfile()` 和 `scorePaper()` 消费，不是摆设
- 仅写入 `seed_papers.jsonl` 不能保证导入论文出现在 HTML 结果里；还必须把显式导入项并入 `daily-run.js` 候选池

## 已收敛的实现策略

### 首用引导

- 在 `/research-intel/settings` 增加一个“首次使用 / 研究画像向导”面板
- 字段复用 `init-profile.js`：
  - `direction`
  - `currentGoal`
  - `focusKeywords`
  - `positiveSignals`
  - `negativeSignals`
  - `readingPreference`
  - `min/target/maxPapers`
  - `sendTime`
  - `timezone`
  - `branchSpecs`
- 由服务端直接生成：
  - `research_brief.md`
  - `method_taxonomy.json`
  - `method_tree_notes.md`
- `feedback.jsonl` 只在用户明确勾选时按正负信号刷新，避免意外覆盖已有人工判断

### 单篇 / 批量导入

- 统一使用一个 import textarea，单篇就是一行，批量就是多行
- 导入优先支持：
  - arXiv ID
  - arXiv abs/pdf URL
  - `标题 | arXiv URL/ID | 备注`
  - `arXiv URL/ID | 备注`
- 写入 `seed_papers.jsonl` 时补充元数据字段：
  - `arxivId`
  - `absUrl`
  - `pdfUrl`
  - `source`
  - `directImport`
- 现有 seed 编辑表单需要保留这些隐藏字段，不能在二次保存时把导入元数据抹掉

### 话题启动研究

- 最小可行实现不是另开新 pipeline
- 直接复用 onboarding 表单更新画像，并允许“保存后立刻触发一次今日运行”
- 这样话题启动仍走现有 `/research-intel/actions/run` 主链路，避免再分叉第二套系统

### 3. 后补的功能

- 更复杂的 `multi-stage draft + compare.html + codex primary` 契约
- 更重的 bundle 产物设计
- 更大的 Web 结构升级

## 执行 TODO

- [ ] 冻结 `baohe` 当前代码目录与运行数据快照
- [ ] 写出 `baohe` 当前运行契约说明
- [ ] 修 clean baseline 中现存的 `chat-html` timeout 测试脆弱性
- [ ] 在 `baohe` 基线下收敛 `README.md` 与 `docs/部署说明.md`
- [ ] 审查当前 Web 已有的画像编辑能力，找出最缺的 onboarding 缺口
- [ ] 设计最小可交付的“单篇导入 / 批量导入 / 话题启动”数据流
- [ ] 先补测试，再实现功能
- [ ] 做本地实际流程验证
- [ ] 做 `baohe` 部署验证
- [ ] 推送 GitHub `main`
