# Research Intel

`Research Intel` 不是又一个“按关键词抓几篇 arXiv 然后群发”的论文推送器。

它想解决的是另一件事：把“每天的论文提醒”变成一套可以持续积累的研究操作闭环。系统会维护你的研究画像、锚点论文、正负反馈、单篇 HTML 档案，以及一个长期演化的方法账本。Telegram 和 Web 只是入口，真正重要的是这些文件化、可追踪、可迭代的研究上下文。

## 适合谁

- 需要每天获取 3 到 8 篇高相关论文，而不是几十篇关键词噪声
- 希望推荐逻辑能随着自己读过的论文和反馈持续变化
- 想把“看过什么、为什么今天看、它补了哪块方法拼图”沉淀为长期账本
- 希望整套系统能自托管、可审计、可改造

## 卖点

- 双池推荐而不是单一列表
  - `must_read` 负责当天主线
  - `watchlist` 保留临近但不够主线的候选
- 单篇论文不是一段摘要，而是完整 HTML 档案
  - 包含研究动机、方法、实验、结果、批评、OpenReview 线索
  - 生成后会做本地浏览器校验
- 文件即记忆
  - `research_brief.md`、`seed_papers.jsonl`、`feedback.jsonl`、`method_tree_notes.md` 都是可编辑文件
  - 不依赖黑盒数据库才能理解系统状态
- 长期方法账本
  - 每天日报之外，还会持续维护 `method_tree.md/json`
  - 让研究主线越来越清晰，而不是每天看完就散掉
- 自托管友好
  - 可直接跑 `daily-run.js`
  - 也可以启用 `Codex worker + heartbeat monitor` 高级模式
  - 提供 Web 控制台、Docker Compose 与宿主机脚本

## 仓库结构

```text
research-intel/
├── examples/profile/default/        # 公开示例画像（演示用，可替换为任意研究领域）
├── scripts/bootstrap/               # 冷启动初始化脚本
├── scripts/research-intel/          # 核心调度、HTML、Web、推送逻辑
├── tests/                           # 单元测试
├── work/                            # 运行态（git ignore）
└── research-intel-records/          # 产物与历史（git ignore）
```

公开仓只包含代码、示例画像和文档。你的真实 `work/`、`research-intel-records/`、`.env` 不应该进入版本库。

## 前置条件

### 宿主机模式

- Node.js 20+
- `pdftotext`
  - Debian / Ubuntu: `sudo apt-get install poppler-utils`
- Chrome / Chromium
  - 用于 HTML 浏览器校验
- `tmux` 与 `codex`
  - 仅当你要启用 `RESEARCH_INTEL_RUN_MODE=codex`

### Docker 模式

- Docker Engine
- Docker Compose

## 快速开始

### 0. 三分钟试跑

如果你只是想先看看这套系统跑出来是什么样，不想先回答一轮初始化问题：

```bash
npm install
cp .env.example .env
npm run profile:example
npm run daily:no-telegram
npm run web:start
```

如果你偏好 Docker：

```bash
cp .env.example .env
docker compose up -d web
docker compose run --rm profile-example
docker compose run --rm daily-no-telegram
```

这条路径默认**不会触发 Telegram 推送**，适合第一次试跑。

### 1. 安装依赖

```bash
npm install
cp .env.example .env
```

然后把 `.env` 里的模型、Telegram、Web 密码等配置改成自己的值。

### 2. 初始化研究画像

两种方式都支持：

- 交互式初始化
  ```bash
  npm run profile:init
  ```
- 复制公开示例画像
  ```bash
  npm run profile:example
  ```

交互式脚本会逐步问你：

- 研究方向是什么
- 当前阶段想解决什么问题
- 哪些关键词该高权重
- 哪些信号该降权
- 每天想看几篇
- 长期账本第一层要按哪些问题展开
- 哪些论文是你的锚点

生成结果会写入 `work/research-intel/profile/`。

仓库里的 `examples/profile/default/` 只是一个公开演示样例，用来展示画像文件长什么样，不会自动覆盖你的真实运行画像。
如果你手动执行 `npm run profile:example`，它会把示例画像写入 `work/research-intel/profile/`，因此更适合第一次试跑或空白环境。

### 3. 先跑一轮日报

```bash
npm run daily:no-telegram
```

如果链路通了，再去掉 `--no-telegram`。

### 4. 启动 Web 控制台

```bash
npm run web:start
```

默认访问地址：

```text
http://127.0.0.1:3086/research-intel/
```

### 5. 启动每日调度

两种方式都支持：

- 宿主机 cron
  ```bash
  npm run cron:install
  ```
- Docker / 容器调度循环
  ```bash
  docker compose up -d scheduler
  ```

## 默认运行模式与高级模式

`Research Intel` 有两种执行模式：

- `direct`
  - 直接执行 `daily-run.js`
  - 面向开源用户，依赖少、部署简单
- `codex`
  - 通过 `codex-supervisor.js` 启动 tmux worker、心跳监控、恢复路径
  - 更适合已经把 Codex 工作流接进自己环境的人

通过 `.env` 里的 `RESEARCH_INTEL_RUN_MODE` 切换：

```env
RESEARCH_INTEL_RUN_MODE=direct
```

或：

```env
RESEARCH_INTEL_RUN_MODE=codex
```

## Docker Compose

```bash
docker compose up -d web
docker compose run --rm profile-example
docker compose run --rm daily-no-telegram
docker compose up -d scheduler
```

容器里默认会挂载：

- `./work -> /app/work`
- `./research-intel-records -> /app/research-intel-records`
- `./logs -> /app/logs`

这样重建镜像不会丢失画像、账本和日报历史。

如果你要用自己的画像而不是示例画像，可以把 `profile-example` 换成交互式的 `init-profile`。

## 宿主机 Cron

```bash
npm run cron:install
```

这个脚本会：

- 从 `work/research-intel/profile/research_brief.md` 读取 `timezone` 和 `send_time`
- 用 `RESEARCH_INTEL_VERIFY_DELAY_MINUTES` 计算验证任务时间
- 安装每日主运行和验证补发两条 cron

改完画像时间后，重新执行一次 `npm run cron:install` 即可覆盖旧配置。

## 跑完之后会看到什么

第一次安全试跑完成后，你通常会得到这几类结果：

- `work/research-intel/profile/`
  - 你的画像文件、锚点论文和长期偏好入口
- `research-intel-records/daily/<date>/`
  - 当天的 brief、reading order、method tree 和单篇 HTML 档案
- `http://127.0.0.1:3086/research-intel/`
  - 登录后的 Web 控制台，可查看历史日报、知识账本和运行状态

如果当天链路已经跑完，但发现有漏发或想做补发验证，可以执行：

```bash
npm run verify
```

## 数据与隐私边界

这些东西默认不应该进 Git：

- `.env`
- `work/`
- `research-intel-records/`
- 日报 HTML、PDF、失败截图、运行日志、历史发送记录

如果你要公开自己的实例，建议只公开：

- 代码
- 脱敏后的 `examples/profile/`
- 少量演示截图

不要直接公开真实运行产物和真实研究历史。

## 文档

- [架构说明](docs/架构说明.md)
- [部署说明](docs/部署说明.md)
- [初始化画像说明](docs/初始化画像说明.md)
- [数据目录说明](docs/数据目录说明.md)

## 测试

```bash
npm test
```

## 许可证

MIT
