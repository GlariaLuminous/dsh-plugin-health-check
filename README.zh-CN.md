# plugin-health-check 中文文档

> [English README](README.md)

**给你的 agent 插件做体检**：安装前预检冲突，安装后定期审计。告别"看到好插件就装、出问题再人肉二分禁用"的死循环。

适用于 Claude Code / DSH / WorkBuddy 风格插件目录（`plugin.json` + `.mcp.json` + `skills/` + `commands/` + `hooks/`）。纯 Python 标准库，零依赖，3.8+ 可跑。

## 一分钟上手

```bash
git clone https://github.com/GlariaLuminous/plugin-health-check.git
python plugin-health-check/scripts/plugin_health_check.py --root ~/.claude/plugins
```

作为 skill 安装（让 agent 替你跑）：

```bash
cp -r plugin-health-check ~/.claude/skills/plugin-health-check
```

然后直接说："**检查一下我的插件**" 或装新插件前说 "**看看这个插件能不能装**"。

## 两种模式

| 你想做什么 | 运行 |
|---|---|
| 全量体检 | `--root <插件目录>` |
| 安装前预检 | `--root <插件目录> --candidate <候选插件目录>` |
| 机器可读输出（CI 门禁） | `--json` |
| 检查上游仓库是否停更 | `--online` |

退出码：`0` 无致命问题 · `1` 有 fatal 级发现 · `2` 用法错误。

## 检测规则

| 规则 | 级别 | 检测内容 |
|---|---|---|
| R1 | 🔴 fatal | 多插件定义同名 MCP 服务器（互相静默覆盖） |
| R2 | 🟠 high | 工具名过长，64 字符截断后撞名（openworker #746 真实事故） |
| R3 | 🟠 high | 多插件抢同一个斜杠命令 |
| R4 | 🟡 medium | 工具事件 hook 用 `*` 通配 / 多插件 hook 同一工具 |
| R5 | 🟡 medium | skill 描述触发词重叠（模型选错 skill） |
| R6 | 🟡 medium | 多插件提供同类能力（模型选择困难） |
| R7 | ⚪ low | 上游仓库 90+ 天未更新（`--online`） |
| R8 | 🔴 fatal | 配置格式错误（缺 `mcpServers` 包裹层 → MCP 被静默忽略） |
| R9 | 🟠 high | skill 描述总量超 token 预算（会被静默丢弃） |
| R10 | 🟣 security | 插件要求 bypassPermissions / 通配符权限 |

## 设计原则

- **只报告，不动手** —— 扫描器只读，禁用与否你说了算
- **零依赖** —— 纯标准库，粘到哪都能跑
- **不误报** —— `SessionStart`/`Stop` 等生命周期事件的 `*` matcher 是正常的，只标记工具事件
- **规则库持续生长** —— R1-R10 提炼自真实 GitHub issue；你遇到新冲突模式，欢迎提 issue 变成新规则

## 测试

```bash
python tests/run_tests.py   # passed: 23, failed: 0
```

## License

[MIT](LICENSE)
