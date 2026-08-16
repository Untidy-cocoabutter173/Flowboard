# Flowboard 插件

Flowboard 是面向 DeepSeek Harness（DSH）的团队任务与会议协作插件，提供项目、任务看板、会议记录与转写、资料库、日历和成员管理。浏览器页面与 Agent 工具共用同一个 Host Service，因此令牌、权限、错误和上游访问只有一个入口。

作者：构序科技

## 核心架构

```text
浏览器页面 -> Typert Remote -> FlowboardService -> HTTP API -> SQLite
Agent 工具  -> FlowboardService ----------------------^
录音文件    -> 一次性上传票据 -> HTTP API -> 转写 Worker
```

- 浏览器只调用 DSH Remote，不接触 API Token。
- Agent 工具和页面写操作都经过 `FlowboardService`。
- 服务端统一负责鉴权、授权、幂等、乐观锁、审计、历史版本和事务。
- 客户端先读取快照，再使用变更游标长轮询；只有游标变化时才刷新快照。
- 录音上传使用五分钟有效、只能使用一次的票据，单文件上限为 32 MiB。

## 包说明

| 包 | 职责 |
| --- | --- |
| `@flowboard/contracts` | 业务类型、命令联合类型和 Zod 运行时校验 |
| `@flowboard/server` | Fastify API、SQLite 仓储、上传与转写 Worker |
| `@flowboard/dsh-service` | Host HTTP Client、Typert Remote 和 Agent 工具 |
| `@flowboard/dsh-client` | DSH 工作台页面；源码按领域拆分，产物为一个浏览器 bundle |
| `@flowboard/dsh` | 可安装的 DSH 组合包和 Cordis 配置补丁 |
| `@deepseek-ai/dsh-typert-protocol`（本地适配） | 仅向 rc.6 生成器提供 Remote 元数据，运行时转发官方协议包 |

当前持久化实现是 SQLite。仓储边界允许后续增加 PostgreSQL 实现，但本项目尚未提供 PostgreSQL adapter，不应按生产级横向扩展数据库使用。

## 本地开发

要求 Node.js 22.19+ 和 pnpm 11.7+。

```sh
pnpm install
pnpm run check
```

启动 API：

```sh
FLOWBOARD_TOKEN=local-secret pnpm run server
```

默认监听 `127.0.0.1:8787`，数据库位于 `data/flowboard.db`。可通过以下环境变量调整：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FLOWBOARD_HOST` | `127.0.0.1` | API 监听地址 |
| `FLOWBOARD_PORT` | `8787` | API 端口 |
| `FLOWBOARD_DB` | `data/flowboard.db` | SQLite 文件路径 |
| `FLOWBOARD_PUBLIC_URL` | 当前监听地址 | 上传票据中的公开地址 |
| `FLOWBOARD_UPLOAD_DIR` | `data/uploads` | 临时录音目录 |

转写 Worker 与 API 使用同一数据库。转写命令应从标准输出返回纯文本：

```sh
FLOWBOARD_TRANSCRIBE_COMMAND=whisper \
FLOWBOARD_TRANSCRIBE_ARGS='["--model","small","--output_format","txt"]' \
pnpm run worker
```

## 安装到 DSH

```sh
pnpm run build
pnpm --filter @flowboard/dsh pack --pack-destination ../../artifacts
dsh plugin --profile <配置名> add ./artifacts/flowboard-dsh-0.1.0.tgz
```

安装后在 `@flowboard/dsh-service` 的 Cordis 配置中设置 `apiBase` 和 `token`。令牌只保存在 DSH Host 进程，不会进入浏览器产物。

## 文档

- [系统架构](docs/architecture/system-overview.md)
- [完整重构方案与验收](docs/dev/flowboard-full-refactor.md)
