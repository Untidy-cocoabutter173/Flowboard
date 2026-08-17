# @flowboard/dsh

[English](README.md) | **简体中文**

**让工作在 Harness 中自然发生，让团队在不额外管理的情况下始终保持一致。**

Flowboard 是运行在 DeepSeek Harness（DSH）中的开源办公协作与团队管理插件。它把目标、会议、人员、Agent 执行、进度和资料放进同一套办公逻辑，让工作从讨论到执行再到沉淀持续流动。任务不是产品的边界，而是支撑这套办公方式的工作骨架。

> **Alpha**：当前版本仍可能发生不兼容变化，适合本地体验和小团队试用，不应按稳定生产版本部署。

## 不管理，即管理

传统任务管理要求员工完成工作后，再到另一套系统创建任务、更新进度和搬运资料。Flowboard 让任务状态直接从 Harness 中的真实工作形成：

- 目标和会议行动项形成任务、负责人和计划；
- 成员与 Agent 沿同一任务上下文继续执行；
- 进度、问题、文档和结论回到原任务与项目；
- 下一位成员或 Agent 从团队共享的真实状态继续工作。

```text
目标 / 会议
    ↓
Harness Agent 理解与执行
    ↓
Flowboard 任务、责任和资料
    ↓
团队与 Agent 持续接力
```

Harness 是人与 Agent 的办公入口，Flowboard 是其中的办公协作与组织记忆层。员工仍然在推进工作，但不再额外维护一份脱离真实工作的管理副本。

## 主要能力

- Jira 式项目看板、工作流、拖放、负责人、优先级、进度和截止时间。
- 多维任务表及文本、数字、日期、单选、多选和人员等自定义字段。
- 我的任务、个人看板、个人日程和跨项目聚合视角。
- 浏览器 VAD、本地 Whisper 转录、会议 Supervisor、意图修订和会后总结。
- 项目、会议、任务与 Markdown 资料之间的可追踪关联。
- 页面与 Agent 共用的权限、校验、幂等、乐观锁、事务和审计链路。

这个插件 tarball 是唯一公开发行单元，同时包含 Host、Web Client、Agent 工具、SQLite 服务和 Linux x64 Whisper 运行时及完整 `ggml-small` 模型。

## 安装

要求 Linux x64、Node.js `22.19+` 或 `24+`、DeepSeek Harness `0.1.0-rc.6`，并预留约 500 MB 磁盘空间。

从 GitHub Alpha prerelease 下载 `.tgz` 与 `SHA256SUMS` 并校验后安装：

```sh
dsh plugin --profile web add ./flowboard-dsh-*.tgz
dsh web
```

打开 `http://127.0.0.1:3080`，在 DSH 会话主视图中选择 **Flowboard**。

## 第一次使用

1. 首次启动会创建本地 Owner、默认团队和默认项目；可以先把它们改成真实名称。
2. 回到 DSH 对话，让 Agent 创建第一批任务，例如：“为产品 Alpha 上线建立项目，并拆分设计评审、插件打包和安装验证任务。”
3. 在 Flowboard 首页点击 **开始一场会议 → 立即开始**，允许麦克风后正常讨论。
4. 结束会议后，到项目看板查看从讨论中形成的任务、负责人、风险、资料和总结。
5. 回到 Harness，让负责人或 Agent 沿这些任务继续执行并更新结果。

还可以直接对 Agent 说：

```text
整理我本周负责但还没有截止时间的任务。

汇总产品项目最近三场会议中仍未解决的风险。

把这次讨论形成的技术决策整理成项目资料，并关联对应任务。
```

## 数据与升级

默认数据保存在 `$DSH_HOME/flowboard`；未设置 `DSH_HOME` 时为 `~/.dsh/flowboard`。升级和卸载插件不会自动删除该目录。

```sh
# 升级已下载的 Alpha
dsh plugin --profile web add --force ./flowboard-dsh-*.tgz

# 卸载插件
dsh plugin --profile web remove @flowboard/dsh
```

浏览器不读取 Flowboard API Token；嵌入模式每次启动生成随机 Token，仅在 Host 内部使用。Whisper CLI、共享库和模型均随包提供，默认转录不依赖系统 Whisper 或 ffmpeg。

完整产品说明、GitHub Release 安装、当前限制、架构、开发和开源规范见 [Flowboard 仓库](https://github.com/juntaoding/Flowboard#readme)。
