# 第三方软件声明

Flowboard 使用并分发多个开源依赖。各依赖仍受其原始许可证和版权声明约束；npm 依赖的完整许可证随对应包提供。

## 随插件分发的 Whisper 资产

| 组件 | 用途 | 来源 | 许可证 |
| --- | --- | --- | --- |
| whisper.cpp 1.9.2 | Linux x64 `whisper-cli` 与 `libwhisper` | <https://github.com/ggml-org/whisper.cpp> | MIT |
| ggml | Whisper 推理共享库 | whisper.cpp/ggml | MIT |
| OpenAI Whisper `small` 模型 | 多语言语音识别权重，转换为 `ggml-small.bin` | <https://github.com/openai/whisper> | MIT |

whisper.cpp 的许可证副本保存在 `packages/server/vendor/whisper/LICENSE.whisper.cpp`，并随 `@flowboard/dsh` 发布。二进制和模型校验值记录在 `packages/server/vendor/whisper/SHA256SUMS`。

## 主要运行时依赖

Flowboard 的主要 JavaScript 依赖包括 DeepSeek Harness/Cordis、React、Fastify、Zod、Ant Design、TanStack Table、Dnd Kit、Radix UI 和 Day.js。发布前应通过 lockfile 和包内许可证复核新增依赖；不得引入与 MIT 发布方式不兼容或来源不明的二进制资产。

本文件用于提供第三方归属信息，不替代各上游项目的许可证正文。
