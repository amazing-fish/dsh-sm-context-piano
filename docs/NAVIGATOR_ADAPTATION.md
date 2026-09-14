# DSH Navigator 适配方案

## 1. 基线与结论

本方案核对的源码基线：

- Piano：`95b5c8abe6e8b2290b83468cfaca3f43fa5876bc`，插件版本 `1.2.0`。
- DSH：`c291e7961a515f6d7af9304e7fd1d257929aef26`，源码版本 `0.1.5-rc.2`。

这是明确的适配目标，不代表已经验证用户本机或所有后续 DSH 版本。此次不发布 npm、不自动合并、不改模型上下文。

**产品分工：官方右侧 Navigator 负责全会话 Turn 导航；Piano 左侧负责已加载内容中的 user / assistant 可见输出段。** 保留固定窗口、波形悬停、设置和稳定节点 key，不把 Piano 改成官方导航的重复皮肤。

## 2. 核实后的兼容断点

旧 Piano 从 `session.getSnapshot().chat` 读取节点。当前官方 Chat 从 `ctx.uiConversation.binding(sessionBinding).target('chat')` 获取 snapshot，节点内容还通过 `snapshot.nodes.source(key)` 独立发布。仅订阅 Session 或仅比较 order，均不足以证明流式预览正确。

类型也已经按领域拆分：

| 类型/服务 | 公开所有者入口 |
| --- | --- |
| Context | `@deepseek-ai/cordis` |
| SessionBinding / sessions | `@deepseek-ai/dsh-api-session-controller/client` |
| SessionId | `@deepseek-ai/dsh-session/types` |
| ChatSnapshot / ChatConversationViewNode | `@deepseek-ai/dsh-client-ui-chat/client` |
| uiConversation | `@deepseek-ai/dsh-client-ui-conversation/client` |
| SettingsScope | `@deepseek-ai/dsh-client-ui-settings/client` |

不再通过旧 `dsh-client-runtime` 聚合入口导入这些类型或装配客户端。

## 3. 本轮实现

```text
SessionBinding
    -> uiConversation.binding(binding).target('chat')
    -> Chat target + keyed node subscriptions
    -> buildNavigationNodes()
    -> Piano fixed-window renderer
```

`chat-source.ts` 只负责读取和订阅。结构变化重排订阅；相同 key 的 source 被替换时释放旧订阅；移除节点、卸载和切换会话时释放全部订阅。微任务合并同一批变更，已排队的旧会话回调在 dispose 后失效。不新建持久化索引，不自行加载历史。

`keys.ts` 保留原有输出段投影，同时排除 `visibility: hidden`，优先采用官方 location 的 Turn identity。不同 Turn 或无法确定同属一轮的相邻输出不推测性合并；工具、推理和隐藏节点仍切断连续性。预览只写入 textContent。

`strip.ts` 绑定官方 Chat target，并处理同一 Session ID 的 binding 实例替换。定位仍使用现有 DOM 锚点，但排除 hidden 行及其后代；点击时重新测量坐标，避免沿用流式重排前的缓存位置。只操作已有共享 scrollport，不修改官方 Navigator、ChatView、DOM 私有事件或模块私有函数。

## 4. 明确不做

本轮不实现 `turn-placeholder`，不接入未加载历史跳转，不隐藏官方导航，不复制官方 TurnNavigator，不新增滚动状态机，不扩展网络权限。

DSH `turnOutline` 可提供完整 Turn 大纲，`session.loadThrough(seq)` 也有公共入口，但**加载能力不等于完整导航能力**。当前 `navigateToTurn`、pending jump、bottom-follow、分页锚点和 `chatScroll` 恢复状态由 ChatView 管理；官方没有在本次核对的 Chat 扩展契约中暴露一个可直接替换的 navigator seat 或通用 jump action。不能把这些私有实现当成插件 API。

Piano 当前仍是行级定位：同一行的多个输出段可能跳到同一行起点。这不是段落级精确锚点。

## 5. 后续阶段的进入条件

下一阶段只有在确认可复用的官方导航动作/扩展点，并有真实浏览器测试后，才考虑加入完整历史：

- 大纲只表达 Turn，不伪造未加载 Turn 的内部 segment 数量。
- 加载后的 segment 取代该 Turn 占位；稳定身份使用 session + turn + node key。
- 加载失败、连续点击不同目标、用户取消、会话切换、断线重连和加载中继续滚动均有验收。
- 共享官方 scroll ownership，而不是维护另一份 chatScroll 或私自调用内部模块。

若没有合适扩展点，继续维持“官方全局 Turn + Piano 局部 segment”的分工，比复制官方状态机更合适。

## 6. 验证层级

1. 隔离契约测试：Chat target 读取、keyed-only 流式更新、批次合并、prepend、source 替换、节点删除、卸载取消，以及可见性/Turn 分组/预览边界。
2. 现有 jsdom 交互测试迁移到新版 fixture：Session snapshot 不再提供 chat；由 uiConversation 提供 target；流式用 keyed source 发布。
3. 构建和类型检查必须针对精确 DSH `0.1.5-rc.2` 开发依赖；不能用旧版类型检查替代新版验证。
4. 真实 DSH + 浏览器手工验收：左右导航共存、compact 模式、分页前插、持续流式、会话切换/恢复、窄容器、减少动画。jsdom 的模拟滚动不等同于官方 scroll restoration 端到端测试。

### Windows / PowerShell

在 PR 分支、Node 24 环境中运行：

```powershell
node --version
pnpm install --no-frozen-lockfile
pnpm verify
# 将依赖变更生成的 pnpm-lock.yaml 一并提交，再检查可复现安装：
pnpm install --frozen-lockfile
```

合并门禁：依赖锁文件与 manifest 同步，构建/类型检查/测试通过，真实 DSH 的关键手工场景留下记录。尚未执行的项目必须明确标为未验证，不能由 mock 测试推断“全面兼容”。

## 7. 参考源码

- [官方 Chat 装配](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-chat/src/client/apply.ts)
- [Chat snapshot 与 keyed sources](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-chat/src/client/contract/snapshot.ts)
- [Chat 扩展契约](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-chat/src/client/contract/slots.ts)
- [完整 Turn 大纲与加载窗口合并](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-chat/src/client/chat/turn-rail-items.ts)

## 8. Issue 状态

本次向该仓库创建独立 Issue 时，GitHub 返回 HTTP 410：`Issues has been disabled in this repository.` 因而设计与验收暂由本文件和关联 PR 承载，没有虚构 Issue 编号。启用 Issues 后可将第 3 节与第 5 节分别拆为兼容实现和后续导航能力跟踪项。
