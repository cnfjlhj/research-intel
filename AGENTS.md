# Research Intel 协作说明

这个仓库只放 `research-intel` 公开版，不再混入其他通知系统、代理脚本或私有运维工具。

## 目标

- 保持仓库可公开、可自托管、可快速上手
- 保持每日情报链路可验证，而不是只“生成了文件”
- 保持研究画像、日报产物和长期账本之间的逻辑一致

## 强约束

- 不要提交 `.env`、`work/`、`research-intel-records/`、`logs/`
- 不要把真实论文 PDF、真实运行生成的 HTML、失败截图、发送历史直接放进公开仓
- 任何宣称“HTML 可用”的改动，都要经过本地浏览器校验
- 任何改动推荐逻辑的改动，都要说明对 `must_read / watchlist`、阅读顺序、长期账本的影响
- 面向用户的文档默认使用中文

## 推荐开发路径

1. 先跑 `npm test`
2. 再做代码修改
3. 对 Web 或 HTML 相关改动，补本地实际验证
4. 对调度、推送、幂等性相关改动，检查重复发送与历史回写

## 默认目录语义

- `examples/profile/default/`: 示例画像，不含私密信息
- `work/research-intel/profile/`: 真实运行画像
- `work/research-intel/runtime/`: 心跳、会话、PID 等运行态
- `research-intel-records/`: 日报、账本、历史记录

如果要改目录结构，必须同时更新：

- README
- 初始化脚本
- Docker Compose
- 相关测试
