# AgentDesk 项目协作规则

## 项目定位

AgentDesk 是一个 Electron + React 的本地 Agent 工作台，核心运行时为 Claude Agent SDK。产品目标是把模型调用、工具权限、工作区文件、实时活动流与人工审批做成可学习、可验证的桌面端体验，而不是通用 IDE 或企业生产控制面。

## 核心代码边界

- `src/main/agent-runtime.ts`：SDK 会话、流式消息、工具授权、子 Agent、模型切换与预算控制。
- `src/main/policy.ts`：工作区访问和工具审批的后端边界。
- `src/main/providers.ts`：Anthropic、DeepSeek 与兼容服务商配置、能力映射。
- `src/main/workspace-files.ts`：受限项目目录与文件预览。
- `src/preload/index.ts`：唯一允许暴露给渲染进程的 IPC 接口。
- `src/renderer/src/`：对话、叙事活动流、审批卡、项目检查器和模型设置。
- `src/shared/event-mapper.ts`：底层 SDK 事件到用户可见活动流的映射；不要让界面直接渲染原始 SDK 事件。
- `tests/`：权限、事件映射、上下文、存储、终端与 Git 服务的核心回归测试，默认保留。

## 输出与界面文案

- 默认使用简体中文，包括面向用户的回复、界面文案、状态、任务标题、报告和发布说明。
- 仅在用户明确要求英文，或必须保留技术标识、命令、路径、文件名、代码片段时使用英文。
- 用户可见活动流只展示可验证的阶段意图、发现、操作摘要和结论；不得展示原始思维链、token 增量、心跳或子 Agent 原始对话。

## 开发约束

- 修改源代码后，至少执行 `npm.cmd run typecheck` 与 `npm.cmd test -- --run`；涉及打包或渲染结构时再执行 `npm.cmd run build`。
- 通过 `apply_patch` 修改或删除源码与文档；不得用破坏性 Git 命令覆盖用户现有改动。
- 读取或写入项目文件时必须以当前工作区为边界。用户直接选择的图片可以作为当次视觉输入，但不得持久化其 base64 数据。
- API Key、Authorization、Cookie 和自定义敏感 Header 不得写入代码、日志、README、任务标题或聊天文本。
- 不要为了“清理”删除 `tests/`、构建配置、锁文件或仍被导入的样式；先确认无引用，再删除明确废弃的源文件。

## 运行产物清理

- `node_modules/` 是本地运行依赖，默认保留；`out/`、`coverage/`、`*.tsbuildinfo` 和旧 `release-*` 是可再生产物，可在不再需要时清理。
- 清理前必须核对目标的解析后绝对路径位于 `D:\Agent\CodexDemo` 内，禁止使用宽泛路径、未验证通配符或删除项目外目录。
- 每次 Windows 安装包发布到唯一命名的 `release-*` 目录，绝不覆盖已有发布目录。
- 新安装包成功后，核验准确的 `AgentDesk Setup *.exe` 路径，仅保留最新且已核验的发布目录。
- 若执行环境阻止删除，不得声称清理成功；应报告保留目录及具体阻塞原因。
