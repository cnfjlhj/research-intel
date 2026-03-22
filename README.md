# Research Intel

每天早上醒来，Telegram 上已经躺好了 3–8 篇和你研究方向最相关的论文，每篇都有一份完整的 HTML 档案——不是摘要，是从 PDF 原文拆出来的结构化笔记，随时能回头查。

这就是 Research Intel 在干的事。

<p align="center">
  <img src="docs/assets/readme/hero-ui.jpg" alt="Research Intel 实际运行界面" width="820" />
  <br/>
  <sub>左：控制台 / 右：今日论文页。真实运行截图，不是设计稿。</sub>
</p>

---

## 为什么做这个

arXiv 每天几千篇。现有工具要么给你一个噪声很大的关键词订阅，要么给你一段 GPT 摘要——看完就扔，第二天想回头看已经找不到了。

我想要的是：

- **只给我真正相关的**。不是关键词命中就推，而是根据我在做什么研究、读过什么论文、给过什么反馈来筛。
- **每篇论文有一份像样的档案**。研究动机、方法拆解、实验、评论都整理好，不是一次性消费品。
- **数据在我自己手里**。推荐逻辑、阅读历史、方法脉络都是本地文件，不锁在任何平台里。

## 工作流程

```
                          你的研究画像
                    (方向 / 关键词 / 种子论文 / 反馈)
                               │
                               ▼
                 ┌─────────────────────────────┐
                 │     arXiv 搜索 + 打分筛选     │
                 │   OpenReview 评审数据增强      │
                 └──────────────┬──────────────┘
                               │
                     ┌─────────┴─────────┐
                     ▼                   ▼
               must-read            watchlist
              (3-8 篇精选)         (备选池)
                     │
                     ▼
          ┌─────── 每篇论文 ───────┐
          │                        │
          │  1. 下载 paper.pdf     │
          │  2. 独立工作目录        │
          │  3. Codex 生成 HTML    │
          │  4. 浏览器校验          │
          │                        │
          └───────────┬────────────┘
                      │
           ┌──────────┼──────────┐
           ▼          ▼          ▼
      Telegram     Web 控制台   方法账本
     (每日推送)   (历史回看)   (长期积累)
```

几个值得一提的设计：

- **PDF 优先**。所有档案从原始 PDF 出发生成，不是拼二手摘要。
- **一篇一隔离**。每篇论文有自己的目录、自己的 Codex 会话，互不污染。
- **产物会落盘**。生成的 HTML 是独立文件，不依赖任何在线服务就能打开。
- **方法账本**。读过的论文会沉淀到一棵方法树里，时间久了就是你研究方向的知识图谱。

## 论文档案长什么样

每篇论文不是一段话的摘要，而是一份结构化的 HTML 页面：

| 板块 | 内容 |
|------|------|
| 研究动机 | 这篇论文要解决什么，为什么现在值得看 |
| 数学与建模 | 核心公式、模型结构拆解 |
| 实验设计 | 做了什么实验、对比了谁 |
| 结果与结论 | 关键指标、主要发现 |
| 评论 | 盲点、局限、不能轻信的地方 |
| 审稿回复 | OpenReview 上的审稿意见和 rebuttal（如有） |
| One More Thing | 延伸思考、和你研究的关联 |

每份档案都经过 Puppeteer 浏览器校验——远程依赖能不能加载、页面结构是否完整、控制台有没有报错——不是生成完就不管了。

## 快速开始

需要：Node.js 20+ / tmux / pdftotext / Chrome / [Codex CLI](https://github.com/openai/codex)

```bash
# 1. 克隆安装
git clone https://github.com/cnfjlhj/research-intel.git
cd research-intel && npm install

# 2. 配置
cp .env.example .env
# 编辑 .env，至少填 Web 密码。Telegram 先不急，等跑通再配。

# 3. 加载示例画像（先确认链路通了，再换成自己的方向）
npm run profile:example

# 4. 跑一轮试试
npm run daily:no-telegram
```

跑完之后 `research-intel-records/daily/` 下面会出现当天的产物。启动 Web 看结果：

```bash
npm run web:start
# 打开 http://127.0.0.1:3086/research-intel/
```

确认本地没问题了，再接 Telegram 推送和 cron 定时任务：

```bash
# .env 里补上 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID
npm run daily              # 带推送的完整流程
npm run cron:install       # 安装每日定时任务
```

> 详细的配置说明、部署选项和环境变量文档见 [部署说明](docs/部署说明.md)。

## 研究画像

推荐结果好不好，取决于你的画像写得好不好。画像就是几个 Markdown 和 JSONL 文件：

| 文件 | 作用 |
|------|------|
| `research_brief.md` | 你的研究方向、关键词、正负信号、每日篇数 |
| `seed_papers.jsonl` | 锚点论文，系统用来理解"你想看什么风格的东西" |
| `feedback.jsonl` | 你对推过的论文的反馈——喜欢、不喜欢、为什么 |
| `method_taxonomy.json` | 方法树结构，读得越多越丰富 |

初始化画像有三种方式：

- `npm run profile:example` — 用示例画像先跑通
- `npm run profile:init` — 终端交互式填写
- Web 控制台 → 编辑区 → 研究画像向导

## 仓库结构

```
research-intel/
├── scripts/research-intel/   # 主逻辑：调度、生成、推送、Web
│   └── lib/                  # 核心模块（~25 个文件）
├── scripts/bootstrap/        # 画像初始化
├── examples/profile/         # 示例画像
├── tests/                    # 测试
├── docs/                     # 文档
├── work/                     # 运行态数据 (gitignore)
└── research-intel-records/   # 产出档案 (gitignore)
```

## 常用命令

| 命令 | 干什么 |
|------|--------|
| `npm run daily` | 跑一轮完整流程（含 Telegram 推送） |
| `npm run daily:no-telegram` | 只生成不推送，适合本地调试 |
| `npm run web:start` | 启动 Web 控制台 |
| `npm run web:stop` | 停止 Web 控制台 |
| `npm run verify` | 检查并补发漏掉的推送 |
| `npm run profile:init` | 交互式初始化研究画像 |
| `npm run cron:install` | 安装每日 cron 定时任务 |
| `npm test` | 跑测试 |

## 不适合什么场景

说清楚边界比吹功能更重要：

- **想要团队协作**——这是给个人用的，没有多用户、没有权限管理。
- **不想自己部署**——需要一台 Linux 机器，需要自己配 Codex CLI。没有 SaaS 版本。
- **想覆盖所有论文源**——目前只接了 arXiv 和 OpenReview。Semantic Scholar 之类的没做。
- **对 AI 生成内容零容忍**——档案是 Codex 基于 PDF 生成的，质量很好但不是人工撰写。

## 隐私

你的研究数据存储在本地。对外通信仅限三处：arXiv API（查询论文）、Codex API（生成档案内容）、Telegram API（推送通知）。除此之外没有任何数据外发。`.env`、`work/`、`research-intel-records/` 都在 `.gitignore` 里。

## 文档

- [部署说明](docs/部署说明.md) — 完整的环境配置和部署方式
- [架构说明](docs/架构说明.md) — 系统设计和模块关系
- [初始化画像说明](docs/初始化画像说明.md) — 画像文件的详细格式
- [数据目录说明](docs/数据目录说明.md) — work/ 和 records/ 的目录结构

## License

MIT
