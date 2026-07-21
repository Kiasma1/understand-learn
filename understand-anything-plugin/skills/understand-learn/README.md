<div align="center">

# understand-learn

> *「读十遍不如猜一遍——苏格拉底式代码导师，选中一条功能链路逐文件教学，中断能续，学完有练习。」*

[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-understand--learn-blueviolet)](skills/understand-learn/SKILL.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**把代码库变成带进度记忆的课程——不是解释代码，是让你能复现代码。**

[它解决什么问题](#它解决什么问题) · [效果示例](#效果示例) · [快速开始](#快速开始) · [触发方式](#触发方式) · [它和同类有什么不同](#它和同类有什么不同) · [安全边界](#安全边界)

</div>

---

## 它解决什么问题

你 clone 了一个新项目，打开 README 只有"快速开始"，打开源码从 `index.js` 读起——三小时后合上编辑器，你说不清请求是怎么从路由流到数据库的。

普通做法是让 Agent "给我讲讲这段代码"。它讲了，你点头了，第二天什么都不记得。这是因为**被动听讲不产生长期记忆**——学习科学把这叫做"流畅性错觉"。

`/understand-learn` 反过来：它让你**先猜**这个文件干了什么，再对照源码验证。猜错不是失败，是大脑记住正确答案的锚点。每学完一个文件问一个需要连接上下游的思考题。学完一条链路出一个小练习。下次打开终端 `--continue` 续上。

---

## 效果示例

```
> /understand-learn --goal "理解认证流程"

[图谱] 选中链路：middleware/auth.ts → routes/login.ts → services/user.ts → db/session.ts

文件 1/4：middleware/auth.ts
架构职责：拦截无 token 请求，解析 JWT，注入 user 到 context
在当前功能链路中的位置：请求入口，所有后续处理的前置守卫
主要输入：HTTP request headers
主要输出：context.user 或 401 响应
上游：无（边缘入口）
下游：routes/login.ts, routes/api/*.ts

在查看具体实现前，请预测这个文件完成任务时会经过哪些主要步骤。
可以用 3～6 条简短步骤回答。
```

---

## 快速开始

```bash
# 1. 先建知识图谱（必须）
/understand

# 2. 启动学习
/understand-learn --goal "你关心的功能"
```

装完对 Agent 说：

```text
/understand-learn --goal "理解支付流程"
```

---

## 触发方式

- `/understand-learn --goal "理解认证流程"`
- `/understand-learn --mode overview` — 只看项目地图，不进入教学
- `/understand-learn --mode file src/middleware/auth.ts` — 单文件深钻
- `/understand-learn --continue` — 中断后续学
- `/understand-learn --status` — 查看当前进度
- `/understand-learn --reset` — 清空进度，不删图谱
- "带我这个新手学会这个项目的核心链路"
- "我想搞懂请求是怎么从入口跑到数据库的"

---

## 能做什么 / 它会交付什么

| 能力 | 交付物 | 典型耗时 |
|------|--------|----------|
| 项目地图 | 架构层 + 入口 + 推荐阅读文件 | 1 轮 |
| 功能链路教学 | 逐文件预测-验证循环 | 每文件 1-2 轮 |
| 练习任务 | 1-3 文件小修改 + 验收标准 | 1 轮 |
| Diff 审查 | 影响范围分析（基于知识图谱 1-hop） | 1 轮 |
| 跨会话续学 | 进度持久化到 `.ua/learning/` | 自动 |

---

## 它和同类有什么不同

| 维度 | 同类做法 | 本 skill |
|------|----------|----------|
| 学习协议 | 单向解释（Agent 讲用户听） | 预测-验证苏格拉底循环 |
| 持久化 | 单次会话，关掉就忘 | 跨会话状态机，`--continue` 续上 |
| 教学粒度 | 概念级课程（不碰真实代码） | 真实功能链路逐文件 |
| 巩固机制 | 无练习 | 学完出练习 + diff 审查 |
| 与代码库关系 | 静止产物（HTML/PDF 课程） | 基于动态知识图谱，图过期自动警告 |

---

## 安全边界

- **不会修改你的业务代码**——除非你明确要求做练习
- **不会提交或推送 git**——学习状态只存本地 `.ua/learning/`
- **不会发送外部请求**——所有分析本地完成
- **不会用于**：代码生成、一次性解释（用 `/understand-chat`）、非代码主题
- **会停下来问你**：预测任务、理解检查、练习开始前

---

## 文件结构

```
understand-learn/
├── SKILL.md               # 技能主文件（工作流定义）
├── README.md              # 本文件
├── scripts/
│   └── learning-state.mjs # 状态机（原子写、损坏备份、跨会话归档）
├── templates/
│   └── learning-note.md   # 学习笔记模板（Mustache 风格）
├── references/
│   └── learning-method.md # 教学方法论依据
├── test-prompts.json      # 测试 prompt（dry_run 验证用）
└── examples/
    └── sample-note.md     # 真实学习笔记样例
```

---

## 验证与测试

```text
/understand-learn --mode overview
```

合格表现：输出包含项目概览 9 项（解决的问题、语言框架、入口、架构层、数据流、推荐文件、可忽略目录、复杂度热点），不超过一轮。

```text
/understand-learn --goal "理解X" --mode feature
```

合格表现：识别入口节点 → 追踪调用链 → 生成 3-7 文件学习路径 → 停在第一个文件等用户预测。

---

## 致谢

- 学习科学基础：Bjork 的"必要难度"、Roediger & Karpicke 的"测试效应"
- 预测-验证协议：受 [learn-code](https://github.com/huasanai/learn-code) 启发
- 课程流设计：受 [anything-to-course](https://github.com/lowwwbank/anything-to-course) 启发
- 状态持久化：受 [jig](https://github.com/ultima95/jig) 的 Project Memory 启发

---

## License

[MIT](LICENSE)
