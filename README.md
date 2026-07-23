# AgentDesk

AgentDesk 是一个面向学习与实验的 Windows 本地桌面 Agent 工作台。界面借鉴 Codex 的清晰工作流，运行时使用 Claude Agent SDK；它将多模型、工具调用、工作区边界、人工审批和可追溯执行记录组合在一个 Electron 应用中。

## 能做什么

- 在项目工作区内发起连续对话任务，并保留同一任务的 SDK 会话上下文。
- 使用 Anthropic、DeepSeek 或 Anthropic 兼容服务商模型；可在输入框右侧切换已配置模型。
- 直接发送 PNG、JPG、GIF、WebP 图片给声明支持视觉能力的模型；图片数据仅用于当次请求，不写入会话存储。
- 以“叙事活动流”展示任务：阶段意图、关键发现、操作证据和最终结论分层呈现，工具细节默认折叠。
- 在右侧查看运行记录、项目文件目录与待审批变更；工作区外的路径和高风险写入会被策略拦截或要求确认。
- 提供项目文件预览、Git Diff、轻量 PowerShell 终端和 SDK 实验设置。

## 核心架构

```text
React Renderer
  ├─ 对话、活动流、审批卡、项目检查器
  └─ 受限 IPC（preload）
Electron Main
  ├─ agent-runtime：Claude Agent SDK 会话、流式事件、工具审批、子 Agent
  ├─ policy：工作区与工具边界
  ├─ providers：模型服务商与能力映射
  ├─ workspace-files / git-service / terminal-manager
  └─ store：本地 JSON 数据与安全存储的密钥
Shared
  └─ types / event-mapper：把 SDK 原始事件转为用户可见活动流
```

## 快速开始

前提：Windows、Node.js 22+、npm，以及一个可用的 Anthropic 或兼容 API 服务。

```powershell
cd D:\Agent\CodexDemo
npm install
npm run dev
```

如果企业网络或 npm 安装策略没有自动下载 Electron，可执行：

```powershell
node node_modules\electron\install.js
npm run dev
```

启动后：先创建或选择项目工作区，再在“模型设置”配置服务商和密钥；回到对话输入框右下角选择模型后即可发送任务。

## 模型与图片能力

- 只有服务商配置中声明 `images` 能力的模型，才可以发送图片。
- 图片必须由输入框附件按钮直接选择；不要把本地图片路径作为文本交给 Agent，这不会自动变成视觉输入。
- 兼容服务商的主模型和备用模型不能填写为同一个模型 ID；若无独立备用模型，请留空。
- Web 搜索、Web Fetch、MCP 等能力取决于所选模型、服务商端点及其工具配置，不是所有兼容模型都支持。

## 安全与审批边界

- 读取、搜索等低风险操作按任务策略处理；写文件、执行命令、MCP 和高风险操作可要求用户批准。
- 项目文件工具只能访问当前工作区；直接选择的图片是唯一允许跨工作区提交的附件类型。
- 所有用户可见的执行过程经过事件路由和聚合；不会把 token 增量、心跳或子 Agent 原始对话直接塞进聊天记录。
- API Key 使用 Electron `safeStorage` 保存；不要把密钥写入 README、任务消息或代码库。

## 开发与验证

```powershell
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run build
```

测试目录是核心回归保障，覆盖权限策略、事件映射、上下文、存储、终端和 Git 服务，不应作为“无关文件”删除。

## 目录说明

```text
src/main/                 Electron 主进程与 Agent 运行时
src/preload/              渲染进程可调用的受限 IPC API
src/renderer/src/         React 界面、活动流、侧栏与检查器
src/shared/               主进程与渲染进程共享的类型和事件映射
tests/                    核心行为回归测试
AGENTS.md                 本项目的长期协作、输出与发布规则
```

`node_modules/`、`out/`、`release-*`、`coverage/` 和 `*.tsbuildinfo` 都是依赖、构建或发布产物，不属于核心源码；其中 `node_modules/` 是本地运行所需依赖，其他产物可以在确认不再需要后清理。

## Windows 安装包

```powershell
npx.cmd electron-builder --win nsis --config.directories.output=release-YYYYMMDD-description
```

每次发布必须使用新的唯一 `release-*` 目录。成功后核验安装包路径，只保留最新且已核验的发布目录；若环境安全策略阻止删除旧目录，必须明确报告，不能声称清理已完成。

## 已知边界

- 这是本地学习与实验工作台，不提供账号体系、云同步、团队协作、浏览器/电脑自动化或 macOS/Linux 安装包。
- 内置终端是 PowerShell 输出通道，不等同完整 PTY；全屏交互式程序支持有限。
- 应用层审批策略不能代替企业级后端授权、沙箱、审计和网络隔离。
