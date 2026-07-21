# 学习笔记：理解认证流程

> 本笔记由 `/understand-learn` 在 session 完成时生成。

## 日期
2025-07-21

## 项目
Understand-Anything — D:\WorkSpace\Understand-Anything

## 学习目标
理解认证流程

## 涉及文件
- `middleware/auth.ts` — JWT 解析守卫 ✓
- `routes/login.ts` — 登录路由，签发 token ✓
- `services/user.ts` — 用户查询与密码校验 ✓
- `db/session.ts` — session 持久化 ✓

## 关键发现
- auth middleware 用 `Authorization: Bearer <token>` 格式，不走 cookie
- login 路由先调 service 层校验密码，再签 JWT，最后写 session 表——三层各司其职
- session 表有 TTL 字段，但清理由应用层定时任务触发，非数据库级 expire

## 我的预测 vs 实际

| 文件 | 预测 | 实际 | 偏差原因 |
|------|------|------|----------|
| auth.ts | 解析 token → 查用户 → 注入 context | ✓ 一致 | — |
| login.ts | 直接返回 JWT | 实际先查用户表再签发 | 忽略了密码校验在 service 层 |
| user.ts | 只做数据库查询 | 还做了 bcrypt 比较 | 把"校验"想简单了 |
| session.ts | 只写不读 | 有 read 供 auth 中间件用 | 没考虑 token 刷新场景 |

## 仍存疑问
- token 刷新走同一个 login 路由还是有独立 refresh 端点？
- session 表的 TTL 多久清一次？任务间隔可配置吗？

## 练习任务
给 login 路由加一个失败次数限制：同一 IP 5 分钟内连续 5 次失败后返回 429。

## 后续深入方向
- 把认证流程的链路学习笔记扩展为完整的安全模块学习
- 研究 refresh token 的实现路径

---

*由 [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) `/understand-learn` 生成*
