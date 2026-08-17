# Flowboard

**让工作在 Harness 中自然发生，让团队在不额外管理的情况下始终保持一致。**

Flowboard 是运行在 DeepSeek Harness（DSH）中的开源办公协作与团队管理插件。它把目标、会议、人员、Agent 执行、进度和资料放进同一套办公逻辑，让工作从讨论到执行再到沉淀持续流动。任务不是产品的边界，而是支撑这套办公方式的工作骨架。

> **Alpha**：`0.1.2-alpha.5` 仍处于早期验证阶段，接口、数据结构和安装方式可能不兼容变化。适合本地体验和小团队试用，不应按稳定生产版本部署。

## 不管理，即管理

传统任务管理要求员工做两遍工作：先开会、沟通和执行，再到另一个系统创建任务、填写负责人、更新进度、整理资料。管理系统记录的不是工作本身，而是员工事后维护的一份副本。只要没有人持续填报，看板就会失真。

AI 办公让这个问题更加明显。员工已经在 Harness 中让 Agent 调研、写作、分析、制定方案和执行任务；如果结果只留在个人 Session，团队仍然不知道谁在做什么、进展如何、产生了什么成果，最后还是要靠人工搬运和汇报。

Flowboard 改变的是任务信息的形成方式：

- 工作开始时，目标或会议行动项形成任务、负责人和计划。
- 工作进行时，成员与 Agent 沿同一任务上下文执行并更新进度。
- 工作完成时，文档、结论和资料回到原任务与项目。
- 团队协作时，每个人及其 Agent 读取同一份权威状态并继续接力。

员工仍然在做任务，但不再额外“管理任务”。**工作发生的同时，管理已经发生。**

## 一套贯穿整个 Harness 的办公逻辑

Harness 是人与 Agent 工作的入口，Flowboard 是其中的办公协作与组织记忆层。目标决定方向，会议形成共识，人与 Agent 共同执行，进度持续更新，资料沉淀结果；任务把这些环节连接起来，而不是要求员工维护一张会话之外的登记表。

```text
员工提出目标 / 团队召开会议
              ↓
Harness 中的 Agent 理解意图与现有上下文
              ↓
Flowboard 形成任务、责任、计划和关联资料
              ↓
成员与 Agent 在各自 Session 中继续执行
              ↓
进度、问题、文档和结论回到同一任务上下文
              ↓
下一位成员或 Agent 从真实状态继续工作
```

DSH 继续负责会话、模型、Agent 和插件生命周期；Flowboard 不建立第二个 Agent 入口，也不让 DSH 反向依赖一个独立应用。用户只安装 `@flowboard/dsh`，页面与 Agent 就能使用同一个 `FlowboardService`、同一份数据和同一套权限规则。

## 一次完整工作如何发生

以一次产品会议为例：

1. **会前准备**：成员让 Agent 读取项目进展、未完成任务和相关资料，自动整理会议上下文。
2. **会中理解**：Flowboard 在浏览器本地切分音频，通过随包 Whisper 转录；会议 Supervisor 持续理解行动项、决议、风险和资料。
3. **动态修订**：“交给张三”“不对，改成李四”“下周三前完成”会被理解为同一个意图的连续修订，而不是三个重复任务。
4. **会后成形**：任务、负责人、截止时间、决议、风险、会议总结和关联资料已经进入项目，不再等待人工二次录入。
5. **继续执行**：负责人回到自己的 Harness Session，让 Agent 调研、写作或执行；任务状态和产出继续沉淀到原上下文。

管理者看到的不是员工事后填写的周报，而是工作实际发生后形成的状态。

## 你会得到什么

| 能力 | 它改变了什么 |
| --- | --- |
| AI 原生办公协作 | Agent 可以读取团队上下文，连接目标、会议、任务和资料，不需要员工转录到另一套系统。 |
| Jira 式项目看板 | 使用待办、进行中、已完成等工作流管理任务，支持拖放、负责人、优先级、进度和截止时间。 |
| 多维任务表 | 高密度查看和原位编辑任务，支持文本、数字、日期、单选、多选和人员等自定义字段。 |
| AI 会议秘书 | 浏览器 VAD、本地 Whisper、实时转录、意图修订、行动项落库和会后总结形成完整闭环。 |
| 资料与组织记忆 | Markdown 资料可关联项目、会议和任务，Agent 能沿关系读取工作的来龙去脉。 |
| 个人与团队视角 | 我的任务、个人看板、个人日程与项目工作区共享同一业务事实，不复制数据。 |
| 权限与审计 | 页面与 Agent 写入都经过授权、运行时校验、幂等、乐观锁、事务、版本和审计。 |

## 快速开始

### 环境要求

- Linux x64；内置 Whisper 原生运行时目前只提供该平台版本。
- Node.js `22.19+` 或 `24+`。
- DeepSeek Harness `0.1.0-rc.6`，且 `dsh` 命令可用。
- 约 500 MB 可用磁盘空间；插件包含完整 `ggml-small` 模型。

### 从 GitHub Release 安装

每个 Alpha tag 都会生成 GitHub prerelease，直接附带完整插件 tarball 与 `SHA256SUMS`。插件包含完整 Whisper 模型，包体超过 npm 客户端可可靠发布的大小，因此 Alpha 统一从 GitHub Release 安装：

```sh
FLOWBOARD_VERSION=0.1.2-alpha.5
curl -LO "https://github.com/juntaoding/Flowboard/releases/download/v${FLOWBOARD_VERSION}/flowboard-dsh-${FLOWBOARD_VERSION}.tgz"
curl -LO "https://github.com/juntaoding/Flowboard/releases/download/v${FLOWBOARD_VERSION}/SHA256SUMS"
sha256sum -c SHA256SUMS
dsh plugin --profile web add "./flowboard-dsh-${FLOWBOARD_VERSION}.tgz"
dsh web
```

打开 `http://127.0.0.1:3080`，在 DSH 会话主视图中选择 **Flowboard**。

Release 附件包含完整 Whisper 模型，下载体积约 430 MB。请在校验和通过后再安装。

## 第一次使用

第一次启动会在本地创建一个 Owner、一个默认团队和一个默认项目，便于立即体验。数据默认保存在 `$DSH_HOME/flowboard`；未设置 `DSH_HOME` 时为 `~/.dsh/flowboard`。

### 1. 认识工作台

进入 **Flowboard** 后，左侧是完整办公导航：

- **首页**：今天的待办、日程、活跃项目和最近 AI 操作。
- **我的任务 / 个人看板 / 个人日程**：按当前人物跨项目聚合工作。
- **会议列表 / 资料列表**：查看团队会议与知识产出。
- **人员管理 / 团队管理**：维护组织和权限。
- **项目**：进入概览、Jira 面板、任务列表、会议、资料和成员页签。

可以先把 `Default Team` 和 `Default Project` 改成真实团队与项目，再添加成员、工作流和任务。

### 2. 让 Agent 建立第一批任务

回到 DSH 对话，直接描述工作，而不是先填完整表单：

```text
为产品 Alpha 上线建立项目，把设计评审、插件打包、安装验证和发布说明拆成任务。

把插件安装验证分配给我，优先级设为高，截止到本周五。

整理我负责但还没有截止时间的任务。
```

Flowboard 的 Agent 工具会读取当前工作空间，选择可写项目，并在权限范围内创建或更新真实任务。非关键字段缺失时可以先形成可修订的临时实体；删除和不可逆操作仍需确认。

### 3. 开始第一场 AI 会议

在 Flowboard 首页点击 **开始一场会议 → 立即开始**，允许浏览器使用麦克风，然后正常讨论。即时会议默认自动执行经过校验的安全操作；从会议列表新建会议时，也可以选择“只记录”“建议后执行”或“自动执行安全操作”。

会议进行中可以观察：

- 实时转录是否持续出现；
- Supervisor 是“待投递”“AI 正在分析”还是“AI 已追平”；
- 行动项是否被新增、修订或撤销；
- AI 提问、项目资料和操作记录是否进入同一会议上下文。

点击 **结束会议** 后，Flowboard 会先排空最后的音频片段，再等待转录和意图收敛，最后生成总结并结束会议。随后到项目看板查看形成的任务和资料。

### 4. 在 Harness 中继续推进

会议只是输入之一。之后可以继续对 Agent 说：

```text
汇总产品项目最近三场会议中仍未解决的风险。

把这次讨论形成的技术决策整理成项目资料，并关联对应任务。

读取 FLOW-12 的上下文，先完成调研，再更新任务进度和结论。
```

这就是 Flowboard 的核心使用方式：不离开 Harness，不重复维护任务系统，让 Agent 使用共享工作状态继续执行。

## 安装管理

升级到已下载的 Alpha：

```sh
dsh plugin --profile web add --force ./flowboard-dsh-*.tgz
```

卸载插件：

```sh
dsh plugin --profile web remove @flowboard/dsh
```

升级和卸载都不会自动删除 `$DSH_HOME/flowboard`。需要清理数据时，请先停止 DSH，备份并确认该目录后再操作。

## 数据与安全边界

- DSH 是唯一宿主和启动入口；Flowboard API、SQLite 与 Worker 随插件生命周期启动和停止。
- 浏览器只通过 DSH Typert Remote 调用 Host，不读取或保存上游 API Token。
- 嵌入模式每次启动生成随机 32 字节访问令牌，仅在 Host 内部使用。
- Whisper CLI、共享库和 `ggml-small` 模型都在插件包内，默认转录不依赖系统 Whisper 或 ffmpeg。
- 音频在本机 Flowboard 运行时处理；完成或失败的临时片段由 Worker 清理。
- 所有写操作统一进入服务端授权、校验、幂等、乐观锁、事务和审计链路。

更完整的实现边界见 [DSH 原生插件架构与发布规范](docs/architecture/dsh-native-plugin.md) 和 [系统架构总览](docs/architecture/system-overview.md)。

## Alpha 限制

- 当前默认使用单一本地 Owner；完整账号登录、邀请和令牌管理尚未接入。
- 当前持久化使用 SQLite，没有 PostgreSQL adapter 或分布式部署方案。
- 内置 Whisper 只支持 Linux x64，其他平台需要新增经过校验的 vendor 变体。
- 数据库 schema 仍在快速演进，当前不提供生产迁移链。
- Agent 已能读取工作空间、创建和更新项目/任务/资料并处理会议意图，但并非每个 DSH Session 都会自动绑定任务；更完整的跨 Session 执行追踪仍是产品演进方向。

## 本地开发

```sh
git lfs install
git lfs pull
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会执行完整检查、生成真实 npm tarball，通过 `dsh plugin --profile web add` 安装到隔离的 `.dsh-dev`，再启动 `dsh web`。它不使用 workspace 软链接或临时 `--patch`，因此验证的就是用户真实安装边界。

发布前检查：

```sh
pnpm run check
pnpm run plugin:pack
pnpm run plugin:package-check
pnpm run plugin:install-check
pnpm run release:check
```

只有 `@flowboard/dsh` 会公开发布；仓库内 Contracts、Server、Host、Client 和 Typert adapter 都是私有源码模块，构建时聚合进一个插件包。Whisper 模型通过 Git LFS 保存，源码、暂存目录和最终 tarball 都会校验 SHA-256 与执行权限。

## 开源与贡献

Flowboard 采用 [MIT License](LICENSE)。提交 Issue 或 Pull Request 前请阅读 [贡献指南](CONTRIBUTING.md)、[安全策略](SECURITY.md)、[行为准则](CODE_OF_CONDUCT.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。版本变化记录在 [CHANGELOG](CHANGELOG.md)。

Alpha 发布只接受 `v*-alpha.*` tag，GitHub Release 标记为 prerelease。发布包必须通过真实 DSH 安装、Web 启动、API 探活和 Whisper 资产审计。

## 文档

- [DSH 原生插件架构与发布规范](docs/architecture/dsh-native-plugin.md)
- [系统架构总览](docs/architecture/system-overview.md)
- [工作空间与 AI 会议设计](docs/dev/flowboard-workspace-ai-refactor.md)
- [会议 Supervisor 设计](docs/dev/flowboard-meeting-supervisor-refactor.md)
- [完整重构记录](docs/dev/flowboard-full-refactor.md)
