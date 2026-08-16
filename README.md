# Flowboard 插件

Flowboard 是面向 DeepSeek Harness（DSH）的 AI 工作空间。它把项目、任务、会议、资料、人员与团队放在同一套关系模型中，并让 AI 以会议秘书身份持续听取转录、创建任务、沉淀资料和完成会后整理。

作者：构序科技

## 产品结构

- 左侧导航：首页、项目树、会议、资料、我的工作、组织。
- 每个项目包含概览、看板、任务表、会议、资料和成员。
- 项目、会议、资料是显式多对多关系；任务归属一个主项目，并可关联多个会议和资料。
- 我的任务、日历和个人看板跨项目聚合，不复制业务数据。
- 首页可直接开始 AI 会议。浏览器使用 VAD 自动分段，转写持续写入 DSH composer，静音后自动提交给 AI。
- 会议结束进入 `finalizing`，AI 使用结构化工具写入总结、决议、风险、行动项、资料和操作记录，完成后进入 `ended`。

## 运行边界

```text
静态 Client -> Typert Remote -> FlowboardService ┐
动态 Client -> host.call -> 动态 Host             ├-> HTTP v2 -> SQLite
Agent 工具  -> 静态/动态 Host                     ┘
音频分段    -> 一次性上传票据 -> 转写 Worker -> utterance
```

- 浏览器不持有 Flowboard API Token。
- 静态 Agent 工具直接使用 `FlowboardService` 拥有的 HTTP Client，不自调用 Typert Remote。
- `flowboard_snapshot {}` 读取轻量 `/v1/summary`；指定项目或会议时才读取完整快照。
- Agent 写工具使用 DSH `callId` 生成稳定幂等键。
- 服务端统一负责鉴权、授权、幂等、乐观锁、审计、历史版本、事务和变更游标。
- 数据库 schema 固定为 v2。检测到旧 schema 会拒绝启动并提示删除开发数据库，不执行迁移或兼容读取。

## 动态插件（默认开发方式）

仓库直接维护可传给 `cordis_define.code.host/client` 的函数体：

- `dynamic/flowboard.host.js`
- `dynamic/flowboard.client.js`

动态 Client 是纯 JavaScript、React `createElement`，不包含 import、TypeScript、JSX、Node 能力或 `fetch`。浏览器通过 `host.call` 访问动态 Host。Host 从环境读取：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FLOWBOARD_API_BASE` | `http://127.0.0.1:8787` | Flowboard API |
| `FLOWBOARD_TOKEN` | 无 | 必填的 Bearer Token |

验证动态源码：

```sh
pnpm run dynamic:check
```

日常开发不需要生成静态 bundle。把两个文件内容分别作为 `cordis_define` 的 `code.host` 和 `code.client`，定义后使用返回的 `pluginId/packageId` 运行即可。

## 静态插件（发布时按需构建）

| 包 | 职责 |
| --- | --- |
| `@flowboard/contracts` | API v2 DTO、命令联合类型和 Zod 校验 |
| `@flowboard/server` | Fastify API、SQLite v2 仓储、上传与转写 Worker |
| `@flowboard/dsh-service` | Host HTTP Client、Typert Remote 和细粒度 Agent 工具 |
| `@flowboard/dsh-client` | DSH 工作空间、VAD 会议 owner 与 composer Dock |
| `@flowboard/dsh` | 可安装的静态 DSH 组合包 |

只有发布或部署静态插件时运行：

```sh
pnpm run build
pnpm --filter @flowboard/dsh pack --pack-destination ../../artifacts
dsh plugin --profile <配置名> add ./artifacts/flowboard-dsh-0.1.2.tgz
```

## 本地服务

要求 Node.js 22.19+ 和 pnpm 11.7+。

```sh
pnpm install
pnpm run check
FLOWBOARD_TOKEN=local-secret pnpm run server
```

默认监听 `127.0.0.1:8787`，数据库位于 `data/flowboard.db`。转写 Worker 与 API 使用同一数据库：

```sh
FLOWBOARD_TRANSCRIBE_COMMAND=whisper \
FLOWBOARD_TRANSCRIBE_ARGS='["--model","small","--output_format","txt"]' \
pnpm run worker
```

## 文档

- [系统架构](docs/architecture/system-overview.md)
- [工作空间与 AI 会议重构](docs/dev/flowboard-workspace-ai-refactor.md)
