# Flowboard 插件仓库约束

- 产品界面与文档使用中文，代码标识符使用英文。
- Host 与 Client 必须分别编译，禁止在浏览器代码中引入 Node.js 能力。
- 浏览器不得读取上游 API Token。
- Agent 工具与浏览器 Remote 必须调用同一个 `FlowboardService`。
- 所有写操作必须经过授权、运行时校验、幂等处理、乐观锁、审计和事务。
- 浏览器只发布一个 DSH bundle；源码按业务领域拆分，只在真实运行时边界上拆包。
- 页面遵循 DSH token 和原生 UI primitives，创建/编辑使用统一模态表单，删除使用确认对话框。
- 修改完成后必须执行 `pnpm run check` 和插件 manifest 校验。
