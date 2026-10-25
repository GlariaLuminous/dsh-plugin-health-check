<p align="center">
  <img src="assets/hero.svg" width="860" alt="plugin-health-check：DeepSeek Harness 插件体检">
</p>

<p align="center">
  <strong>装 DSH 插件之前，先检查它会不会出问题。</strong><br>
  面向 DeepSeek Harness 的只读插件检查工具
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#检查范围">检查范围</a> ·
  <a href="#安装前检查">安装前检查</a> ·
  <a href="docs/dsh.md">详细用法</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/GlariaLuminous/plugin-health-check/actions/workflows/ci.yml"><img src="https://github.com/GlariaLuminous/plugin-health-check/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-43853d.svg" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/DSH-0.2.1--rc.2-5378f6.svg" alt="已在 DSH Desktop 0.2.1-rc.2 验证">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

DSH 的插件不是装进 `node_modules` 就算生效。profile 选中了哪些 bundle、patch 最后覆盖了什么、包声明的版本能不能用，都可能决定插件是否加载。

`plugin-health-check` 沿着 **profile → bundle → patch → 配置条目** 检查这些问题，给出发现、来源和覆盖范围。项目只支持 DSH，不会启动被检查的插件，也不会改动你的配置。

## 作为 DSH 插件安装

一条命令装进 profile，重启 DSH 后 agent 就多了一个只读工具 `plugin_health_check`：

```bash
dsh plugin --profile web add github:GlariaLuminous/plugin-health-check
```

之后直接对 agent 说“检查我的 DSH 插件”，或者“我想装 /path/to/plugin，会不会和现有插件冲突？”，agent 会带着 `candidate` 参数调用它。工具只读文件，不启动插件、不执行命令、不改配置。

> **状态：实验性。** 检查引擎（CLI）已在 DSH Desktop 0.2.1-rc.2 上验证；agent 工具入口刚加入，只在不依赖宿主的测试里验证过注册流程，还没有在真实 DSH 里长期使用。遇到问题请带上 DSH 版本提交 issue。DSH 仍是开发者预览版，升级后请重新检查。

不想装进 profile，也可以直接用命令行：

```bash
npx dsh-plugin-health-check --profile web
```

## 快速开始

需要 **Node.js 22+**。

```bash
git clone https://github.com/GlariaLuminous/plugin-health-check.git
cd plugin-health-check
npm ci --ignore-scripts
node scripts/dsh_health_check.mjs --profile desktop
```

检查 Web profile，或输出 JSON：

```bash
node scripts/dsh_health_check.mjs --profile web
node scripts/dsh_health_check.mjs --profile desktop --json
```

默认读取 `$DSH_HOME`，未设置时使用 `~/.dsh`。自定义位置：

```bash
node scripts/dsh_health_check.mjs --dsh-home /path/to/.dsh --profile desktop
```

也提供 Python 3.8+ 启动器，使用相同的 DSH 参数，仍需 Node.js 和上述依赖：

```bash
python scripts/plugin_health_check.py --profile desktop --json
```

<p align="center">
  <img src="assets/demo.svg" width="860" alt="DSH 检查输出示意：两个 bundle 中发现同作用域 MCP serverName 冲突，结果 STATIC FAIL">
</p>

## 检查范围

| 检查 | 具体内容 |
|---|---|
| profile 和 bundle | 读取选中的 bundle，解析 scoped 包、pnpm 链接和 Desktop ASAR 内置包 |
| 版本兼容 | 按 DSH 规则检查 engines、DSH peers、预发布范围及精确版本豁免 |
| patch 与 include | 按官方 Cordis 算法合并 bundle、profile、home 和命令行覆盖层，处理 disabled、分组、静态 include 和循环引用 |
| MCP 配置 | 检查可确定作用域中的 serverName 重复、名称格式、基本 stdio/HTTP transport 配置 |
| 候选更新 | 按包身份替换已有版本，重新组合配置，报告新增问题与原环境状态 |
| 检查覆盖率 | 列出选中和已解析的 bundle 数，以及动态表达式、未解析模块、服务隔离等未知项 |

没有发现插件、版本未知或遇到动态配置时，结果会明确标记为 **incomplete**。不会因为没有采集到数据就判断“全部正常”。

## 安装前检查

将候选插件的本地源码或解包目录传给 `--candidate`：

```bash
node scripts/dsh_health_check.mjs --profile desktop --candidate /path/to/plugin --json
```

检查过程不安装候选包，不执行它的构建脚本或 `apply`。更新同名包时会替换旧身份，避免把同一个插件重复计入。报告同时保留原环境的 baseline；原环境检查失败或不完整时，不会给出干净的通过结论。

## 看懂结果

| 退出码 | 状态 | 含义 |
|---|---|---|
| `0` | `pass` | 已覆盖的静态配置检查通过 |
| `1` | `fail` | 存在致命发现 |
| `2` | `error` | 参数、路径或运行环境错误 |
| `3` | `incomplete` | 检查范围不完整，需要补充信息或运行态核实 |

JSON 包含 `packages`、经过筛选的 `entries`、`findings`、`coverage`、`status` 和 `exit_code`。配置正文、凭据和 YAML 错误片段不会写进报告；本地安装路径会保留，便于定位问题。

**当前是静态检查。** 运行时注册的工具、命令和 hook、Agent preset 激活、MCP 连接与工具发现、会话实际权限尚未验证。`!!js` 保持为数据，不会求值。`STATIC PASS` 表示已覆盖配置没有发现问题，不代表插件已经成功运行。

## 让 DSH agent 使用

将完整仓库放到以下任一位置，并在该目录执行 `npm ci --ignore-scripts`：

- `$DSH_HOME/skills/plugin-health-check/`
- `<项目根目录>/.dsh/skills/plugin-health-check/`

保留 `SKILL.md` 和 `scripts/` 的相对位置。随后使用 `/plugin-health-check`，或直接说“检查我的 DSH 插件”。skill 会指引 agent 从自己的目录执行检查，并在总结中保留覆盖范围。

## 参数和开发

完整参数、诊断分类和实现边界见 [DSH 使用说明](docs/dsh.md)。从早期版本升级时，直接使用 DSH 参数；`--host`、`--root`、`--online` 和 `--desc-budget` 已移除。

```bash
npm test
```

测试会创建临时 profile 和 ASAR，不依赖本机 DSH。验证 Python 启动器的测试还需 Python 3.8+。

```text
src/
  index.js                  # DSH 插件入口：注册 plugin_health_check 工具
  tool.js                   # 工具定义（依赖注入，测试不需要 DSH）
  report.js                 # 把扫描结果整理成 agent 能读的摘要和 JSON
cordis.patch.yml            # bundle patch：把插件插入 profile
scripts/
  dsh_health_check.mjs      # 命令行入口
  plugin_health_check.py   # 可选 Python 启动器
  dsh/
    packages.mjs           # 包、ASAR 和版本要求
    composition.mjs        # YAML 与官方 patch 算法
    scan.mjs               # DSH 静态检查与候选比较
tests/                     # DSH 回归测试
docs/dsh.md                # 详细用法
SKILL.md                   # DSH skill 工作流
```

遇到漏报或误报，欢迎提交最小的 DSH profile/patch 示例、宿主版本和预期行为。请在分享前移除配置中的凭据和个人路径。

[MIT](LICENSE)
