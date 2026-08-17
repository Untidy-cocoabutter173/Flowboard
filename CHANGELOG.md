# 更新日志

本项目的重要变化记录在此。版本遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

## [0.1.2-alpha.3] - 2026-08-17

### Fixed

- 将兼容的 DSH CLI 固定为工作区开发依赖，修复 GitHub runner 无法执行 pnpm 全局安装的问题。

## [0.1.2-alpha.2] - 2026-08-17

### Fixed

- 为尚未生成的 Typert Remote 声明补充编译期类型边界，修复干净 checkout 的 Client 类型检查。
- 测试环境直接解析内部 workspace 源码，避免依赖构建后才存在的 `lib` 入口。

## [0.1.2-alpha.1] - 2026-08-17

### Changed

- 将 Flowboard 收敛为由 DSH 托管的单一官方插件 `@flowboard/dsh`。
- 开发与 CI 改用真实 tarball 和 `dsh plugin add`，移除 workspace 软链接及临时 patch 路径。
- Host、Client、Typert、Server 和 Contracts 聚合进同一公开包，内部包设为私有。
- Whisper CLI、共享库和完整 `ggml-small` 模型随插件包发布并执行 SHA-256 校验。
- 嵌入运行时改为随机访问令牌，数据目录改为 `$DSH_HOME/flowboard`。
- 修复 npm tarball 安装后 `whisper-cli` 丢失执行权限导致的 `EACCES`。

### Added

- DSH 原生插件架构与发布规范。
- manifest、Whisper、真实安装启动和 release 全链路校验。
- 开源贡献、安全、行为准则、第三方声明及 GitHub 模板和工作流。
- 团队任务、项目看板、多维任务表、资料和会议工作空间。
- 浏览器 VAD、本地 Whisper 转录、会议 Supervisor 和意图账本。
- 权限、幂等、乐观锁、事务、审计及 SQLite 持久化。
