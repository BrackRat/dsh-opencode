# dsh-opencode-session

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）
兼容插件：为 `opencode` / `opencode-go` 路由补上 opencode.ai 网关要求的
`x-opencode-session` 请求头。

## 问题

Console Go 网关会拒绝缺少 `x-opencode-session` 头的请求：

```
400: {"type":"MissingSessionID","message":"Error from provider (Console Go):
Request is missing x-opencode-session and cannot be routed efficiently. Please
see https://opencode.ai/docs/go/#where-can-i-use-it"}
```

该头用于标识请求属于哪个会话，网关据此把请求路由到持有该会话缓存的节点。
pi coding agent 在自身的 provider-attribution 层发送了这个头，但 dsh 在这些
路由上使用的共享库（`@earendil-works/pi-ai` 0.85.1）尚未实现，因此从 dsh
发起的每一次 opencode / opencode-go 模型调用都会失败。

本插件用于补齐这个能力。

## 安装

```bash
# 从 npm 安装（发布后）
dsh plugin --profile web add dsh-opencode-session

# 直接从 GitHub 安装
dsh plugin --profile web add github:<you>/dsh-opencode

# 从本地目录或 tarball 安装
dsh plugin --profile web add /path/to/dsh-opencode
dsh plugin --profile web add ./dsh-opencode-session-0.1.0.tgz
```

包内声明了 `dsh.bundle`，因此 `dsh plugin add` 会自动把它加入
`dsh.profile.bundles`，无需手改 profile。装完重启 `dsh web` 即可。

## 验证

```bash
dsh --profile web --dump-config | grep -A 2 opencode-session-header
```

组合后的树里应能看到该插件条目；用 opencode-go 模型对话应正常回复而不再报
`MissingSessionID`。

## 卸载

```bash
dsh plugin --profile web remove dsh-opencode-session
```

## 工作原理

- 插件注册在 dsh 官方的 `llm/stream` waterfall 上（模型调用的文档化拦截点）。
- 每次请求前，从即将处理该请求的 adapter 上取到**正在使用的那份** pi-ai
  `Models` 实例，对它的 prototype 安装一次包装（幂等，进程内只装一次）。
- 包装器为 `opencode`、`opencode-go` 或任何 baseUrl 位于 `opencode.ai` 的模型
  注入 `x-opencode-session: <会话 ID>` 与 `x-opencode-client: dsh`——与
  pi coding agent 的判断一致。
- pi-ai 在三种协议（`openai-completions`、`anthropic-messages`、
  `openai-responses`）中都会**最后**合并 `options.headers`，因此你在 provider
  或 model 上显式配置的 header 始终优先。
- 不修改任何磁盘文件：包装只存在于内存，每次启动自动重装，dsh 升级、
  插件重装都不受影响。
- 失败安全：如果未来 dsh 或 pi-ai 内部结构变化，插件只记一条 warning 并让位，
  绝不弄挂请求。

## 兼容性

已在 dsh `0.1.5-rc.1` + `@earendil-works/pi-ai` `0.85.1` 上验证。

当 pi-ai 上游自己实现了该头后，可以卸载本插件；若继续保留，对已经带该头的
请求它不会产生任何影响。

## 开发

```bash
npm test        # node:test，零依赖
npm pack        # 查看实际发布的文件集合
```

## 许可证

MIT
