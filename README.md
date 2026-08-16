# Flowboard 插件

Flowboard 是面向 DeepSeek Harness（DSH）的 AI 工作空间。它把项目、任务、会议、资料、人员与团队放在同一套关系模型中，并让 AI 以会议秘书身份持续听取转录、创建任务、沉淀资料和完成会后整理。

作者：构序科技

## 产品结构

- 左侧是完整工作区菜单：首页、我的任务、个人看板、个人日程、会议、资料、人员、团队和项目分组；项目分组展开为每个可访问项目。
- 当前人物视角固定显示在菜单顶部，可跨项目查看该人员的任务、看板和日程，但不会改变服务端登录身份或权限。
- 每个项目包含概览、Jira 面板、任务列表、会议、资料和人员。
- Jira 面板使用 Dnd Kit 支持任务拖放、状态列配置、负责人、优先级、进度和截止时间编辑。
- 任务列表采用多维表格交互，内置字段可原位编辑，自定义表头支持文本、数字、勾选、日期、单选、多选和人员类型。
- 静态界面以 Ant Design 5 的主题、菜单、表格、弹窗、选择器和日期控件为统一设计系统，TanStack Table 提供任务筛选与行模型，CSS Modules 只负责工作台布局和领域样式。
- 项目成员决定任务可选负责人；个人任务和个人看板按负责人跨项目聚合。
- 任务详情、会议总结和项目资料可作为 Markdown 打开、编辑和预览。
- 项目、会议、资料是显式多对多关系；任务归属一个主项目，并可关联多个会议和资料。
- 我的任务、日历和个人看板跨项目聚合，不复制业务数据。
- 首页可直接开始 AI 会议。浏览器使用 VAD 自动分段，转写持续写入 DSH composer，静音后自动提交给 AI。
- 会议结束进入 `finalizing`，AI 使用结构化工具写入总结、决议、风险、行动项、资料和操作记录，完成后进入 `ended`。

## 运行边界

```text
静态 Client -> Typert Remote -> FlowboardService ┐
动态 Client -> host.call -> 动态 Host             ├-> HTTP v2 -> SQLite
Agent 工具  -> 静态/动态 Host                     ┘
PCM/WAV 分段 -> 一次性上传票据 -> 内嵌 Whisper Worker -> utterance
```

- 浏览器不持有 Flowboard API Token。
- 音频票据统一使用不含 codec 参数的小写 MIME；动态 Host 按 Base64 填充精确计算上传字节数，票据与实际音频长度保持一致。
- 静态 Agent 工具直接使用 `FlowboardService` 拥有的 HTTP Client，不自调用 Typert Remote。
- `flowboard_snapshot {}` 读取轻量 `/v1/summary`；指定项目或会议时才读取完整快照。
- Agent 写工具使用 DSH `callId` 生成稳定幂等键。
- 服务端统一负责鉴权、授权、幂等、乐观锁、审计、历史版本、事务和变更游标。
- 数据库 schema 固定为 v2。检测到旧 schema 会拒绝启动并提示删除开发数据库，不执行迁移或兼容读取。

## 静态插件（默认开发与发布方式）

| 包 | 职责 |
| --- | --- |
| `@flowboard/contracts` | API v2 DTO、命令联合类型和 Zod 校验 |
| `@flowboard/server` | Fastify API、SQLite v2 仓储、上传、转写 Worker 和随包发布的 Whisper 运行时 |
| `@flowboard/dsh-service` | Host HTTP Client、Typert Remote、细粒度 Agent 工具和内嵌服务生命周期 |
| `@flowboard/dsh-client` | Ant Design 工作空间、Jira/多维表格、VAD 会议 owner 与 composer Dock |
| `@flowboard/dsh` | 可安装的静态 DSH 组合包 |

开发启动只有一条命令：

```sh
pnpm dev
```

脚本会依次校验动态降级源码、类型检查、构建静态 Host/Client，生成只在本次进程使用的绝对路径 patch，然后启动 DSH Web。`FlowboardService` 同时拥有 API、SQLite 和转写 Worker 的生命周期；停止 DSH 时这些资源会一并关闭。

默认地址是 DSH Web `http://127.0.0.1:3080`、Flowboard API `http://127.0.0.1:8787`。脚本不会安装或重装插件，也不改 profile manifest；它只幂等维护 `@flowboard/dsh-service` 与 `@flowboard/dsh-client` 的本地 workspace 软链接，使 DSH 保留包身份并发布浏览器 Client。浏览器直接编码 16 kHz PCM WAV，`@flowboard/server` 随包携带 Linux x64 `whisper-cli`、共享库和多语言 `ggml-base` 模型，因此不要求系统安装 Whisper、ffmpeg、模型或配置环境变量。

## 动态插件（实验与应急入口）

仓库直接维护可传给 `cordis_define.code.host/client` 的函数体：

- `dynamic/flowboard.host.js`
- `dynamic/flowboard.client.js`

动态 Client 是纯 JavaScript、React `createElement`，不包含 import、TypeScript、JSX、Node 能力或 `fetch`。它保留关键导航、任务、会议、资料、人员和 Markdown 编辑能力，但不承诺与静态版逐像素同步；浏览器统一通过 `host.call` 访问动态 Host。Host 从环境读取：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FLOWBOARD_API_BASE` | `http://127.0.0.1:8787` | Flowboard API |
| `FLOWBOARD_TOKEN` | 无 | 必填的 Bearer Token |

验证动态源码：

```sh
pnpm run dynamic:check
```

正式发布或部署时运行：

```sh
pnpm run build
pnpm --filter @flowboard/dsh pack --pack-destination ../../artifacts
dsh plugin --profile <配置名> add ./artifacts/flowboard-dsh-0.1.2.tgz
```

动态 Host 上传音频后立即返回 `jobId`，动态 Client 再用短调用轮询转写状态，因此慢 ASR 不会触发单次 `host.call` 超时。

## 独立服务调试

正常开发不需要这一节，只运行 `pnpm dev`。单独调试服务端时可使用：

```sh
FLOWBOARD_TOKEN=local-secret pnpm run server
pnpm run worker
```

独立 Worker 默认也使用随包发布的 Whisper。`FLOWBOARD_TRANSCRIBE_COMMAND` 与 `FLOWBOARD_TRANSCRIBE_ARGS` 仅保留为高级调试覆盖，不是启动前提。

## 文档

- [系统架构](docs/architecture/system-overview.md)
- [工作空间与 AI 会议重构](docs/dev/flowboard-workspace-ai-refactor.md)
