# Research Intel

`Research Intel` 把论文跟踪收敛成一条更重交付的研究主链：以 `paper.pdf` 作为唯一真相来源，为每篇论文建立独立工作目录，再由 paper-scoped、tmux-backed Codex 生成并校验一个可复查的 HTML 档案，同时持续维护研究画像、种子论文、反馈与方法账本。

<p align="center">
  <img src="docs/assets/readme/hero-system.svg" alt="Research Intel overview" width="100%">
</p>

## 它不是在做什么

- 不是靠关键词一次抓几十篇论文然后群发
- 不是只产出一段短摘要，第二天就作废
- 不是把长期研究状态锁进黑盒数据库

## 它在交付什么

- 更小但更像主线的每日论文集合
- paper-scoped HTML archive，而不是 throwaway summary
- file-backed research memory：`research_brief.md`、`seed_papers.jsonl`、`feedback.jsonl`、`method_tree_notes.md`
- 单一公开主链：`paper.pdf -> paper-scoped workspace -> tmux-backed Codex -> validated archive`

## 公开主链

README 现在只保留一条公开主链叙事：`PDF-first, paper-scoped, tmux-backed Codex`。

这表示文档默认收敛到以下工作方式：以 `paper.pdf` 作为真相来源，辅助文本和页面图像只用于定位与核对；每篇论文一个独立工作目录；每篇论文一个独立 tmux-backed Codex session；主链是 fresh generation、standalone、browser validation，而不是公开叙事里的 repair/fallback。

<p align="center">
  <img src="docs/assets/readme/pipeline-pdf-first.svg" alt="PDF-first tmux-backed Codex mainline" width="100%">
</p>

## 单篇论文页应该长什么样

GitHub 首页应该展示的是“单篇论文已经成为一个可读、可批判、可验证的页面交付物”，而不是脚本列表或环境变量清单。下面这张图表达的就是 README 想提前呈现的页面结构。

<p align="center">
  <img src="docs/assets/readme/paper-archive.svg" alt="Per-paper archive structure" width="100%">
</p>

下面这张不是概念图，而是 `baohe` 上 `2026-03-17` 单篇 smoke test 的真实浏览器校验截图：

<p align="center">
  <img src="docs/assets/readme/smoke-paper-validation-2026-03-17.png" alt="Real baohe smoke validation screenshot on 2026-03-17" width="100%">
</p>

## 当前验证边界

截至 `2026-03-17`，README 只会宣传已经重新拿到验证证据的范围：本地相关测试、`baohe` 上最小真实 tmux-backed Codex HTML 生成、以及使用临时 `profile/base/records/history` 的单篇论文 smoke test。

<p align="center">
  <img src="docs/assets/readme/status-2026-03-16.svg" alt="Verification status on 2026-03-17" width="100%">
</p>

可以公开说的范围：

- `baohe` 上可以按需跑出新的 per-paper HTML archive 样本，并附带浏览器验证 PNG/JSON
- README 的默认架构方向已经明确收敛为 `PDF-first, paper-scoped, tmux-backed Codex`
- 本地测试、`baohe` 最小 tmux Codex 任务与单篇 smoke 都可以作为工程硬化证据

现在还不能说的范围：

- 不能把多篇批量调度等同于“所有生产场景都已经无风险”
- 不能把旧 repair/fallback 叙事包装成当前公开主链
- 不能把尚未复核的本地图或旧链路样本包装成 `baohe` 最新稳定态

## 适合谁

- 需要每天获取 3 到 8 篇高相关论文，而不是几十篇关键词噪声
- 希望推荐逻辑能随着自己读过的论文和反馈持续变化
- 想把“看过什么、为什么今天看、它补了哪块方法拼图”沉淀为长期账本
- 希望整套系统能自托管、可审计、可改造

## 快速开始

### 0. 先确认 Codex CLI 可用

Research Intel 的公开默认路径是：让 tmux-backed Codex 围绕 `paper.pdf` 生成并验证单篇论文 HTML。
这个仓库不负责你的 Codex 登录、provider、base URL 或 key 配置；这些要先在 Codex CLI 自己的配置层完成。下面这条 `codex exec` 只用于确认 CLI/provider 已就绪，不代表 README 的公开主链会绕过 tmux orchestration。

最简单的宿主机自检方式：

```bash
codex exec --skip-git-repo-check -C /tmp -m gpt-5.4 "Reply with OK only."
```

如果这条命令在你的机器上还没通，先把 Codex CLI 配好，再继续下面的仓库初始化。

### 1. 三分钟试跑

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

这条路径默认**不会触发 Telegram 推送**，适合第一次试跑公开主链。

### 2. 安装依赖

```bash
npm install
cp .env.example .env
```

然后至少把 `.env` 里的这些项目级配置改成自己的值：

- Codex HTML 主链路
  - `RESEARCH_INTEL_CODEX_HTML_MODEL`：默认 `gpt-5.4`
  - `RESEARCH_INTEL_CODEX_HTML_REASONING_EFFORT`：可选，默认 `medium`
  - `RESEARCH_INTEL_CODEX_HTML_TIMEOUT_MS`：可选，默认 `600000`
- Telegram 推送（可选下游分发）
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
  - 如果你本机访问 Telegram API 需要代理，再设置 `TELEGRAM_USE_PROXY=true` 与 `TELEGRAM_PROXY_URL`
- Web 控制台
  - `RESEARCH_INTEL_WEB_PASSWORD`
  - `RESEARCH_INTEL_WEB_SESSION_SECRET`
- 调度模式
  - `RESEARCH_INTEL_RUN_MODE=codex`

如果你只是按公开默认路径使用，这些补充配置可以留空：

- `RESEARCH_INTEL_API_BASE_URL`
- `RESEARCH_INTEL_API_KEY`
- `RESEARCH_INTEL_HTML_MODELS`
- `RESEARCH_INTEL_CURATION_MODELS`
- `RESEARCH_INTEL_CHAT_TIMEOUT_MS`

`RESEARCH_INTEL_CODEX_HTML_MODEL` 默认值是 `gpt-5.4`：

- 保持默认：每篇论文在独立 tmux session 中调用 Codex，这是公开默认路径
- README 不展开内部调试路径；对外只保留这一条主链

### 3. 初始化研究画像

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

如果你更喜欢 Web 首次填写，而不是在终端里逐题回答：

1. 先启动 Web 控制台
   ```bash
   npm run web:start
   ```
2. 打开 `http://127.0.0.1:3086/research-intel/`
3. 登录后进入 `编辑区`
4. 先填写 `首次使用 / 研究画像向导`
5. 如果你手上已经有感兴趣论文，再用 `论文导入 / 批量种子录入` 补进去
6. 勾选“保存后立即触发一次今日运行”，或稍后手动执行 `npm run daily:no-telegram`

仓库里的 `examples/profile/default/` 只是一个公开演示样例，用来展示画像文件长什么样，不会自动覆盖你的真实运行画像。
如果你手动执行 `npm run profile:example`，它会把示例画像写入 `work/research-intel/profile/`，因此更适合第一次试跑或空白环境。

### 4. 先跑一轮主链

```bash
npm run daily:no-telegram
```

如果链路通了，再按需要打开 Telegram 这种下游分发能力。

如果你已经把 Telegram 配置填好，可以直接跑：

```bash
npm run daily
```

第一次建议先用 `daily:no-telegram` 验证 PDF-first Codex HTML 主链，再切到真实推送。

### 5. 启动 Web 控制台

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

## 默认运行模式

默认稳定路径是 `codex`：

- 通过 `codex-supervisor.js` 启动 tmux worker、心跳监控和恢复逻辑
- 这是文档默认假设的运行方式
- 如果你没有特别的调试需求，不需要切别的模式，也不需要理解内部调试分支

通过 `.env` 里的 `RESEARCH_INTEL_RUN_MODE` 保持默认值：

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

Compose 镜像会安装 `codex` CLI，并默认把宿主机 `${HOME}/.codex` 挂载到容器内的 `/root/.codex`，这样容器里的 Web 手动触发、`daily-no-telegram` 和调度循环都能复用你宿主机已经配置好的 Codex 认证状态。

如果你的 Docker 运行环境拿不到宿主机 `${HOME}/.codex`，优先使用宿主机模式，不要假设容器会自动完成 Codex 登录。

容器里默认会挂载：

- `./work -> /app/work`
- `./research-intel-records -> /app/research-intel-records`
- `./logs -> /app/logs`

这样重建镜像不会丢失画像、账本和日报历史。

如果你要用自己的画像而不是示例画像，可以把 `profile-example` 换成交互式的 `init-profile`。

## 前置条件

### 宿主机模式

- Node.js 20+
- `pdftotext`
  - Debian / Ubuntu: `sudo apt-get install poppler-utils`
- Chrome / Chromium
  - 用于 HTML 浏览器校验
- `tmux` 与 `codex`
  - 默认部署路径需要这两项
  - 开始前先确保当前 shell 里 `codex exec -m gpt-5.4 ...` 已经能独立跑通

### Docker 模式

- Docker Engine
- Docker Compose

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
  - Web 导入的单篇/批量论文也会沉淀到这里的 `seed_papers.jsonl`
- `research-intel-records/daily/<date>/`
  - 当天的 brief、reading order、method tree 和单篇 HTML 档案
- `http://127.0.0.1:3086/research-intel/`
  - 登录后的 Web 控制台，可查看历史日报、知识账本和运行状态
  - `编辑区` 可继续修改研究画像、导入论文、再触发一轮运行

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
