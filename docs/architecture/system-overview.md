# 系统架构总览

> 🆕 本文以当前源码为准，描述 Flowboard 0.1.0 的真实运行边界。

## 一句话架构

Flowboard 是“一个共享契约、一个 Host Service、一个服务端写入口、一个浏览器 bundle”：页面和 Agent 可以有不同入口，但不会形成两套业务逻辑。

## 分层

```text
┌──────────────── DSH ────────────────┐
│ 浏览器 Client        Agent Tools    │
│       │                  │          │
│ Typert Remote ─── FlowboardService  │
└───────────────────│─────────────────┘
                    │ Bearer HTTP
┌───────────────────▼─────────────────┐
│ Fastify API -> Sqlite Repository    │
│                    │                │
│         当前状态 / 版本 / 审计 / 游标 │
└───────────────────│─────────────────┘
                    ▼
              SQLite 数据库
```

| 层 | 唯一职责 | 禁止事项 |
| --- | --- | --- |
| Contracts | 定义线协议和运行时校验 | 不访问数据库或 UI |
| Client | 展示、局部导航、提交命令 | 不保存 Token，不直连普通 API |
| Host Service | 上游访问、Token、Remote、Agent 工具 | 不复制业务存储 |
| HTTP API | 路由、解析和错误响应 | 不绕过仓储写数据库 |
| Repository | 权限与事务业务规则 | 不处理页面状态 |
| Worker | 异步转写和文件清理 | 不提供第二套会议写入规则 |

## 浏览器主流程

1. `FlowboardController` 通过 Remote 获取 `FlowboardSnapshot`。
2. 当前项目和当前页签保存在浏览器内存。
3. 用户提交 `ClientCommand`，控制器补充 UUID 幂等键。
4. 命令成功后立即刷新快照。
5. 后台按 cursor 长轮询；网络失败时以 1 秒到 15 秒退避重试。

## 会议转写流程

1. 页面向 Host 申请与会议、MIME、字节数绑定的上传票据。
2. 浏览器只使用该票据直传音频，不携带 API Token。
3. 服务端校验票据未过期、未使用且 MIME/大小完全一致，再创建转写任务。
4. Worker 原子领取 pending 任务，调用配置的外部转写命令。
5. 成功时在同一事务写入会议记录、版本、审计和变更游标；失败时记录错误。
6. 无论成功或失败，Worker 都删除临时音频。

## 数据事实源

SQLite 是当前唯一持久化事实源。业务实体使用软删除；`entity_versions` 保存不可变版本，`audit_events` 保存操作者与动作，`change_events` 只承担轻量同步游标。幂等表不是第二业务状态源。

PostgreSQL 尚未实现。未来适配时应新增仓储实现并保持 contracts、HTTP 语义和写入不变量不变。
