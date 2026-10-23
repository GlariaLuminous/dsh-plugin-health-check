# plugin-health-check

给你的 agent 插件做"体检"：安装前预检冲突，安装后定期审计，告别"看到好插件就装、出问题再人肉二分禁用"的死循环。

适用于 Claude Code / DSH / WorkBuddy 风格的插件目录结构（`plugin.json` + `.mcp.json` + `skills/` + `commands/` + `hooks/`）。纯 Python 标准库，零依赖，Python 3.8+。

## 为什么需要它

真实世界里插件混装的事故比比皆是：

- 两个 MCP 服务器暴露同名工具 → 所有请求直接 400 报错（LM Studio #2497）
- 工具名超过 64 字符被截断 → 31 个工具里 9 个撞名，模型反复重试烧光预算（openworker #746）
- 两个上下文压缩插件同时启用 → 各自压缩，关键上下文被弄丢
- 插件 `.mcp.json` 缺 `mcpServers` 包裹层 → MCP 服务器被**静默忽略**（Context7 真实 bug）
- 某插件带 126 个 skill → 371 条 skill 描述被静默丢弃（Vercel 插件真实事故）

这些问题的共同点：**安装零门槛，代价后置且静默爆发**。本 skill 把社区手动排查方法论自动化。

## 检测规则（R1-R10）

| 规则 | 严重级 | 检测内容 |
|------|--------|---------|
| R1 | 🔴 fatal | 多个插件定义同名 MCP 服务器（互相静默覆盖） |
| R2 | 🟠 high | 声明的工具名过长，截断后会撞名或调用失败 |
| R3 | 🟠 high | 多个插件抢同一个斜杠命令 |
| R4 | 🟡 medium | 工具事件 hook 用 `*` 通配 / 多插件 hook 同一工具 |
| R5 | 🟡 medium | skill 描述触发词语义重叠（模型选错 skill） |
| R6 | 🟡 medium | 多个插件提供同类能力（模型选择困难、反复确认） |
| R7 | ⚪ low | 上游仓库 90+ 天未更新（需 `--online`） |
| R8 | 🔴 fatal | 配置格式错误：缺 `mcpServers` 包裹层、JSON 损坏、缺 SKILL.md 等 |
| R9 | 🟠 high | skill 描述总量超 token 预算（会被静默丢弃） |
| R10 | 🟣 security | 插件要求 `bypassPermissions` 或通配符权限 |

## 安装

作为 skill 安装（Claude Code / 兼容宿主）：

```bash
# 克隆到 skill 目录
git clone https://github.com/GlariaLuminous/plugin-health-check.git
cp -r plugin-health-check ~/.claude/skills/plugin-health-check
```

或者直接在对话中对 agent 说：

```
帮我安装这个 skill：https://github.com/GlariaLuminous/plugin-health-check
```

也可以只把扫描器当独立 CLI 用，不需要任何宿主。

## 使用

### 场景 1：全量体检

对 agent 说"**检查一下我安装的插件**"，或手动运行：

```bash
python scripts/plugin_health_check.py --root ~/.claude/plugins
```

加 `--online` 检查上游仓库活跃度；加 `--json` 输出机器可读报告。

### 场景 2：安装前预检

对 agent 说"**帮我看看这个插件能不能装**"，或手动运行：

```bash
# 先把候选插件拉下来
git clone <插件仓库> /tmp/candidate-plugin

# 预检：只报告它会和现有插件产生什么冲突
python scripts/plugin_health_check.py --root ~/.claude/plugins --candidate /tmp/candidate-plugin
```

输出结论分三档：**安全安装 / 谨慎安装 / 不建议安装**。

### 输出示例

```
plugin-health-check report
root: /home/me/.claude/plugins
plugins scanned: 8

findings: fatal: 1, high: 1, medium: 2

[FATAL] (R1) MCP server 'filesystem' defined by multiple plugins: fs-mcp, file-tools - one will silently override the other
    -> rename the server in one plugin or disable one of them
[HIGH] (R3) slash command '/review' claimed by multiple plugins: code-review, pr-helper - behavior is undefined
    -> disable one plugin or ask the author to namespace the command
[MEDIUM] (R6) category 'browser' is served by multiple plugins: playwright-mcp, browser-tools ...
    -> keep one entry point per capability

RESULT: FAIL - fatal issues present, fix before relying on these plugins
```

退出码：`0` 无致命问题，`1` 有 fatal 级发现（可用于 CI 门禁），`2` 用法/IO 错误。

## 设计原则

- **只报告，不动手**：扫描器绝不修改/禁用任何插件，决策权永远在用户
- **零依赖**：纯标准库，粘到任何环境都能跑
- **不误报生命周期 hook**：`SessionStart`/`Stop` 等事件的 `*` matcher 是正常的，只标记工具事件
- **规则库是活资产**：R1-R10 提炼自真实 GitHub issue，持续补充

## 项目结构

```
plugin-health-check/
├── SKILL.md                        # skill 定义（触发条件 + 工作流）
├── scripts/
│   └── plugin_health_check.py      # 核心扫描器（CLI + 可导入）
├── tests/
│   └── run_tests.py                # 测试套件（自建 fixtures，23 项断言）
└── README.md
```

## 测试

```bash
python tests/run_tests.py
# passed: 23, failed: 0
```

## License

MIT
