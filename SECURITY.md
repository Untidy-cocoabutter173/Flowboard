# 安全策略

## 支持范围

Flowboard 当前处于 Alpha。安全修复只针对 npm `alpha` tag 指向的最新版本和 `main` 分支；旧 Alpha 版本不保证回补。

## 报告漏洞

请使用 GitHub 仓库的 **Security > Report a vulnerability** 私密报告，不要创建公开 Issue，也不要在可公开访问的日志、录屏或示例数据库中包含令牌、会议内容和业务数据。

报告请包含：

- 受影响版本、DSH 版本、Node.js 版本和平台；
- 漏洞影响、复现条件和最小复现步骤；
- 已知缓解方式或建议修复（如有）；
- 是否已在其他渠道披露。

维护者会尽快确认收到报告，并在完成影响评估后同步修复与披露计划。修复发布前，请为项目保留合理的处置时间。

## 安全边界

- 浏览器不得读取 Flowboard API Token，所有浏览器请求经 DSH Remote 进入 Host。
- 嵌入模式每次启动生成随机 Token；独立 server 必须显式配置至少 16 字符的 `FLOWBOARD_TOKEN`。
- 插件卸载不会删除 `$DSH_HOME/flowboard`，备份和介质清理由部署者负责。
- Whisper 原生二进制与模型随包发布，并通过仓库中的 SHA-256 基线校验。
- SQLite 适用于本地或小团队部署；当前版本不声明多租户互联网暴露场景的生产加固能力。
