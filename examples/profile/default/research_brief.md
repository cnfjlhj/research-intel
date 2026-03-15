---
timezone: Asia/Shanghai
send_time: "06:00"
min_papers: 3
target_papers: 5
max_papers: 8
---

# Research Brief

## Current Goal
- 系统化跟踪 tool-using LLM agents、verifier loops、memory augmentation 与 long-horizon planning 相关论文。
- 当前阶段优先积累“可复用机制”和“评估方法”，而不是只看某个单一 benchmark 的 leaderboard 结果。
- 希望推荐结果能明确回答：这篇论文补的是工具调用、记忆、反馈、规划还是验证能力。
- 对纯提示技巧、小幅 prompt 工程增益、以及没有可迁移机制的应用论文降低权重。
- 这个公开示例画像只用于演示结构，不代表任何真实个人研究计划。

## Focus Keywords
- tool-using agents
- verifier loop
- retrieval memory
- planning agent
- long-horizon reasoning
- self-refinement
- reflective agent
- literature review agent
- scientific assistant
- evaluation harness

## Positive Signals
- explicit tool feedback
- retrieval memory
- reflection
- verifier loop
- execution trace
- trajectory memory
- planning decomposition
- environment interaction
- grounded evaluation
- strong ablation
- failure analysis
- reusable agent component

## Negative Signals
- pure survey
- benchmark ranking without mechanism
- product wrapper without new method
- closed demo without evaluation
- application-only paper without reusable design
- prompt trick without failure analysis

## Reading Preference
- 更偏向近两年的方法论文，但允许少量经典工作作为锚点。
- 当前以“积累机制”为主，优先能拆出 tool use、memory、reflection、verification、planning 等组件的论文。
- 推荐理由要说明：为什么今天该看、它补的是哪块机制拼图、以及和已读锚点的关系。
- 每天推荐 3 到 8 篇，目标 5 篇；宁可少而准，也不要为了凑数塞进弱相关论文。
