# 贡献指南

感谢参与 Flowboard。这个仓库交付的是一个由 DSH 托管的官方插件；设计和实现应保持 `@flowboard/dsh` 单一公开安装边界。

## 开始之前

- Bug、兼容性问题和功能建议请先创建 Issue；安全漏洞请按 [SECURITY.md](SECURITY.md) 私密报告。
- 大型功能、协议变化、数据库结构变化或新增平台运行时，请先通过 Issue 对齐范围。
- 参与项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 开发环境

要求 Linux x64、Node.js `22.19+` 或 `24+`、pnpm `11.7.0`、DSH `0.1.0-rc.6` 和 Git LFS。

```sh
git lfs install
git lfs pull
corepack enable
pnpm install --frozen-lockfile
pnpm run check
```

本地运行使用：

```sh
pnpm dev
```

该命令构建真实 npm tarball，并通过 `dsh plugin add` 安装到隔离的 `.dsh-dev`。不要向 DSH profile 创建 workspace 软链接，不要用临时 patch 代替插件安装。

## 实现约束

- 产品界面与文档使用中文，代码标识符使用英文。
- Host 与 Client 分别编译，浏览器代码不得引入 Node.js 能力或读取 API Token。
- Agent 工具、MeetingCoordinator 和浏览器 Remote 调用同一个 `FlowboardService`。
- 所有写操作必须经过授权、运行时校验、幂等、乐观锁、审计和事务。
- 只有 `packages/dsh` 可以公开发布；内部 workspace 包必须保持 `private: true`。
- Whisper 二进制、共享库和模型的变化必须更新 `SHA256SUMS`、第三方声明和平台说明。

## 提交与 Pull Request

提交信息建议使用 `feat:`、`fix:`、`refactor:`、`docs:`、`test:`、`build:` 或 `chore:` 前缀。每个 Pull Request 应说明问题、实现边界、验证结果和用户可见变化，避免混入无关格式化或生成文件。

提交前至少运行：

```sh
pnpm run check
pnpm run plugin:pack
pnpm run plugin:install-check
git diff --check
```

涉及用户可见行为或公共包内容时更新 README、相关架构文档和 `CHANGELOG.md`。涉及较大模型文件时确认 `git lfs ls-files` 能识别它，禁止提交 LFS pointer 作为构建输入。

## 发布

Alpha 阶段由维护者通过与 `packages/dsh/package.json` 版本一致的 `v*-alpha.*` tag 触发发布。发布工作流会重新执行完整检查、真实 DSH 安装启动测试、以 npm `alpha` dist-tag 和 provenance 发布，并生成标记为 prerelease 的 GitHub Release。内部包永不单独发布。
