<p align="center">
  <img src="assets/hero.svg" width="860" alt="dsh-plugin-health-check：DeepSeek Harness 插件体检">
</p>

<p align="center">
  <strong>装 DSH 插件之前，先模拟一遍。</strong><br>
  只读、静态，在你真实的 profile 上按官方算法合成，再告诉你哪里会出问题。
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#原理">原理</a> ·
  <a href="#示例输出">示例输出</a> ·
  <a href="#安装前模拟">安装前模拟</a> ·
  <a href="#边界">边界</a> ·
  <a href="docs/dsh.md">参考文档</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/GlariaLuminous/dsh-plugin-health-check/actions/workflows/ci.yml"><img src="https://github.com/GlariaLuminous/dsh-plugin-health-check/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-43853d.svg" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/DSH-0.2.1--rc.2-5378f6.svg" alt="已在 DSH Desktop 0.2.1-rc.2 验证">
  <img src="https://img.shields.io/badge/status-experimental-f59e0b.svg" alt="实验性">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

---

DSH 的插件不是装进 `node_modules` 就生效。能不能加载，取决于 profile 选了哪些 bundle、patch 按什么顺序覆盖、包声明的版本 DSH 认不认。这些问题大多要重启之后才暴露，表现往往只是“某个东西悄悄没了”。

`dsh-plugin-health-check` 沿着 **profile → bundle → patch → 配置条目** 把这条链路在装之前走一遍。它不启动任何插件，不执行任何命令，不改动你的配置。

| 你遇到的现象 | 常见原因 | 对应发现 |
|---|---|---|
| 装完重启，插件没出现 | bundle 解析不到、没声明 `dsh.bundle.patch`、版本不被当前 DSH 接纳 | `DSH_PACKAGE` · `DSH_VERSION` |
| 配置被另一层悄悄换掉 | patch 按 id 整体替换 `config`；id 重复、覆盖未命中、include 成环 | `DSH_PATCH` |
| 两个 MCP 服务只剩一个 | 同一作用域里 `serverName` 重复，重复注册会被拒绝 | `R1` · `R8` |
| 检查结果为空，不知道算不算健康 | 动态表达式、未解析的模块、服务隔离 | `DSH_COVERAGE`，状态为 `incomplete` |

## 安装

作为 DSH 插件装进 profile，一条命令：

```bash
dsh plugin --profile web add github:GlariaLuminous/dsh-plugin-health-check
```

重启 DSH，然后直接对 agent 说：

> 检查我的 DSH 插件。

> 我想装 `/path/to/plugin`，会不会和现有插件冲突？

agent 会调用只读工具 `plugin_health_check`，后一句会把目录作为 `candidate` 传进去。

> **状态：实验性。** 检查引擎（命令行）已在 DSH Desktop 0.2.1-rc.2 上验证。agent 工具入口较新：注册流程有不依赖宿主的测试覆盖，但还没有在真实 DSH 里长期使用。DSH 仍是开发者预览版，升级后请重新检查。遇到问题请带上 DSH 版本提交 issue。

只想跑命令行、不装进 profile：

```bash
git clone https://github.com/GlariaLuminous/dsh-plugin-health-check.git
cd dsh-plugin-health-check
npm ci --ignore-scripts
node scripts/dsh_health_check.mjs --profile desktop
```

需要 **Node.js 22+**。默认读取 `$DSH_HOME`，未设置时使用 `~/.dsh`；`--profile web` 检查 Web profile，`--json` 输出结构化报告。参数全表见 [参考文档](docs/dsh.md)。

## 原理

<p align="center">
  <img src="assets/flow.svg" width="860" alt="流程：profile 选出 bundle，patch 按官方 Cordis 算法逐层合成，静态扫描条目并给出发现；运行时行为不在检查范围内">
</p>

- **按宿主的规则读，不自己发明规则。** patch 合成用的是官方 `@deepseek-ai/cordis-plugin-include` 的算法；版本准入遵循 DSH 的 `engines.dsh` 优先、否则看 DSH peers 的规则，预发布版本参与比较。
- **覆盖层顺序一致。** bundle → profile → home → 命令行 `--patch`，处理 disabled、分组、静态 include 和循环引用。
- **读得到 Desktop 内置包。** 直接读取 Electron ASAR 里的包元数据，不需要启动 Electron。

## 示例输出

<p align="center">
  <img src="assets/demo.svg" width="860" alt="示意输出：同一作用域内 MCP serverName 重复，结果 STATIC FAIL">
</p>

| 退出码 | 状态 | 含义 |
|---|---|---|
| `0` | `pass` | 已覆盖的静态配置检查通过 |
| `1` | `fail` | 存在致命发现 |
| `2` | `error` | 参数、路径或运行环境错误 |
| `3` | `incomplete` | 覆盖不完整，需要补充信息或运行态核实 |

JSON 报告包含 `packages`、`entries`、`findings`、`coverage`、`status` 和 `exit_code`。配置正文、凭据和 YAML 错误片段不会写进报告；本地安装路径会保留，便于定位，分享报告前请留意。

## 安装前模拟

把候选插件的本地源码或解包目录交给 `--candidate`：

```bash
node scripts/dsh_health_check.mjs --profile desktop --candidate /path/to/plugin --json
```

- 候选包**不会被安装**，也不会执行它的构建脚本或 `apply`。
- 同名包按包身份替换旧版本，不会被重复计入；否则作为新的一层加入。
- 报告只列出**新增**的问题，并保留原环境的 baseline。原环境本身失败或不完整时，不会给出干净的通过结论。

## 边界

这是静态检查。**未验证**的内容：运行时注册的工具、命令和 hook，Agent preset 的激活，MCP 的实际连接与 `tools/list`，会话里的实际权限。`!!js` 表达式只当数据，不会求值。

所以 `STATIC PASS` 的意思是“已覆盖的配置没有发现问题”，不是“插件能成功运行”，更不是“插件是安全的”。没有发现插件、版本未知或遇到动态配置时，结果会标记为 `incomplete`，不会因为没采集到数据就说“一切正常”。

## 相关工具

DSH 生态里已有几个体检类项目，侧重点不同，有重叠，也互补。以下据各项目的公开说明，细节以它们自己的 README 为准。

| 项目 | 侧重 |
|---|---|
| [dsh-plugin-doctor](https://github.com/zoahdev/dsh-plugin-doctor) | 插件作者侧：manifest、patch、入口、文件、构建，以及打包后在全新 profile 里的安装验证 |
| [dsh-doctor](https://github.com/asdf17128/dsh-doctor) | profile 层：被整体替换丢掉的配置字段、指向不存在条目 id 的 patch、工具名冲突 |
| [dsh-xray](https://socket.dev/npm/package/dsh-xray) | 运行中的 DSH：实际加载了什么、上下文成本、运行时健康 |
| **dsh-plugin-health-check** | 用户侧：在你真实的 profile 上按官方算法合成后做静态检查，并支持安装前模拟候选插件 |

## 作为 skill 使用

不装成插件时，也可以把完整仓库放到下面任一位置，并在该目录执行 `npm ci --ignore-scripts`：

- `$DSH_HOME/skills/dsh-plugin-health-check/`
- `<项目根目录>/.dsh/skills/dsh-plugin-health-check/`

保留 `SKILL.md` 和 `scripts/` 的相对位置，然后使用 `/dsh-plugin-health-check`，或直接说“检查我的 DSH 插件”。skill 会指引 agent 从自己的目录执行检查，并在总结里保留覆盖范围。

## 开发

```bash
npm ci --ignore-scripts
npm test
```

测试会创建临时 profile 和 ASAR，不依赖本机 DSH。CI 在 Ubuntu 和 Windows 上，用 Node 22 与 24 运行。

```text
src/                        # DSH 插件入口与 plugin_health_check 工具
  index.js  tool.js  report.js
cordis.patch.yml            # bundle patch：把插件插入 profile
scripts/
  dsh_health_check.mjs      # 命令行入口
  plugin_health_check.py    # 可选 Python 启动器
  dsh/                      # 包解析 · patch 合成 · 静态扫描
tests/                      # 回归测试
docs/dsh.md                 # 参考文档
SKILL.md                    # skill 工作流
```

遇到漏报或误报，欢迎提交最小的 DSH profile/patch 示例、宿主版本和预期行为。分享前请移除配置里的凭据和个人路径。

[MIT](LICENSE)
