<p align="center">
  <img src="assets/hero.svg" width="860" alt="plugin-health-check 横幅">
</p>

<p align="center">
  <strong>装插件之前，先体检一下。</strong><br>
  面向 Claude Code / DSH / WorkBuddy 插件生态的冲突检测工具
</p>

<p align="center">
  <a href="#dsh-原生模式">DSH 原生模式</a> •
  <a href="#快速上手">目录模式</a> •
  <a href="#能查出什么">十条规则</a> •
  <a href="#两种用法">用法</a> •
  <a href="#老实交代">局限</a> •
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/GlariaLuminous/plugin-health-check/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/python-3.8%2B-3776AB.svg?logo=python&logoColor=white" alt="Python 3.8+">
  <img src="https://img.shields.io/badge/legacy_dependencies-0-brightgreen.svg" alt="目录模式零依赖；DSH 模式需要 Node.js 和 npm 依赖">
  <img src="https://img.shields.io/badge/rules-10-8b5cf6.svg" alt="10 条规则">
  <img src="https://img.shields.io/badge/tests-DSH%20%2B%20legacy-brightgreen.svg" alt="DSH 和目录模式回归测试">
</p>

---

大家装插件基本都是同一个姿势：看到别人推荐，手一滑就装上了。至于是不是和已装的插件打架、配置本身有没有毛病——等出问题再说。

问题是，这类事故爆发的时候都特别安静：

- 两个 MCP 服务器都暴露了个叫 `search_models` 的工具，然后**所有请求直接 400**，你根本想不到是插件在打架（[LM Studio #2497](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2497)）
- 插件的 `.mcp.json` 少包了一层 `mcpServers`，于是它的 MCP 服务器被**静默忽略**，你永远以为它装着呢（Context7 真实事故）
- 两个上下文压缩插件都尽职尽责地工作，合力把你需要的上下文压没了
- 某插件一口气带了 126 个 skill，结果 371 条 skill 描述被平台悄悄丢弃（Vercel 插件真实事故）

现在社区的标准解法是"禁用一半插件，二分排查"。这个工具把这件事变成一条命令。

## DSH 原生模式

按 DSH 的 **profile → bundle → patch** 检查原生插件。已在 DSH Desktop `0.2.1-rc.2` 做只读验证。

需要 Node.js 22+；Python 入口另需 Python 3.8+。在仓库根目录安装固定版本依赖：

```bash
git clone https://github.com/GlariaLuminous/plugin-health-check.git
cd plugin-health-check
npm ci --ignore-scripts
node scripts/dsh_health_check.mjs --profile desktop
```

也可以沿用 Python 入口：

```bash
python scripts/plugin_health_check.py --host dsh --profile desktop --json
python scripts/plugin_health_check.py --host dsh --profile web --candidate /path/to/plugin
```

默认读取 `$DSH_HOME` 或 `~/.dsh`。可用 `--dsh-home` 指定位置；宿主安装不在默认路径时，传入 `--dsh-install`，指向含 `node_modules` 的 DSH 安装目录。`--dsh-version` 可补充无法自动发现的运行时版本。

| 检查 | 行为 |
|---|---|
| profile 与原生 bundle | 只检查选中的 bundle，支持 scoped 包及 Desktop ASAR 内置包 |
| DSH 版本兼容 | `engines.dsh` 优先、DSH peers 回退、预发布范围与精确版本豁免 |
| patch 与 include | 使用官方 Cordis 合并算法；支持 bundle/profile/home/`--patch` 层、disabled、分组与静态 include |
| MCP 配置 | 检查静态同作用域的 serverName 重复、名称格式和基本 transport 配置 |
| 候选更新 | 按包身份替换旧版本，重算配置，仅报告新增发现并保留 baseline 状态 |
| 不完整检查 | 动态表达式、服务隔离或未解析入口显示覆盖不足；不执行插件代码或 `!!js` |

退出码：`0` 静态检查通过 · `1` 致命发现 · `2` 参数/环境错误 · `3` 检查不完整。

**静态通过不代表运行时已验证。** 运行期工具、命令、hook、Agent preset、MCP 连接和有效会话权限不在本版覆盖范围。DSH 模式不会套用下方目录模式的工具名截断、总描述预算或权限字段假设。详细参数和 skill 安装方式见 [DSH 使用说明](docs/dsh.md)。

## 快速上手

原有目录模式是独立 Python 脚本，Python 3.8+ 即可，无第三方依赖。下面的 R1–R10 适用于该模式；DSH 请使用上面的原生入口：

```bash
git clone https://github.com/GlariaLuminous/plugin-health-check.git
python plugin-health-check/scripts/plugin_health_check.py --root ~/.claude/plugins
```

想让 agent 替你跑，就把它装成 skill：

```bash
cp -r plugin-health-check ~/.claude/skills/plugin-health-check
```

之后直接说人话就行："**检查一下我的插件**"，或者装新插件前问一句"**这个插件能装吗**"。

跑完大概长这样：

<p align="center">
  <img src="assets/demo.svg" width="860" alt="终端演示：扫描 8 个插件，发现 1 个致命问题（两个插件抢了同一个 MCP 服务器名）、1 个高危（斜杠命令撞车）、2 个中危，结论 FAIL">
</p>

## 两种用法

| 你想干什么 | 怎么跑 |
|---|---|
| 把已装的插件全查一遍 | `python scripts/plugin_health_check.py --root <插件目录>` |
| 装之前先看看会不会打架 | 加 `--candidate <候选插件目录>` |
| 给 CI 用（要机器可读的输出） | 加 `--json` |
| 顺便查查上游仓库是不是停更了 | 加 `--online` |

退出码：`0` 没事 · `1` 有致命发现（可以拿来做 CI 门禁）· `2` 参数或路径错了。

## 能查出什么

一共十条规则，每条背后都有真实的事故报告，不是拍脑袋想的：

| 规则 | 级别 | 查什么 |
|---|---|---|
| R1 | 🔴 致命 | 多个插件定义了同名 MCP 服务器——其中一个会被静默覆盖 |
| R2 | 🟠 高危 | 工具名太长，64 字符截断后直接撞名（[openworker #746](https://github.com/andrewyng/openworker/issues/746)，31 个工具撞了 9 个） |
| R3 | 🟠 高危 | 两个插件抢同一个斜杠命令 |
| R4 | 🟡 中危 | 工具事件的 hook 用了 `*` 通配；或多个插件 hook 同一个工具 |
| R5 | 🟡 中危 | skill 描述触发词重叠——模型会加载错 skill，或者两个都加载 |
| R6 | 🟡 中危 | 多个插件干同一件事（比如两个浏览器 MCP）——模型犯选择困难症，反复问你 |
| R7 | ⚪ 低危 | 上游仓库 90 多天没更新了（需要 `--online`） |
| R8 | 🔴 致命 | 配置格式错误：缺 `mcpServers` 包裹层、JSON 写坏了、缺 SKILL.md |
| R9 | 🟠 高危 | skill 描述总量超 token 预算——超出的部分会被静默丢弃 |
| R10 | 🟣 安全 | 插件要求 bypassPermissions 或通配符权限——等于不问你直接动手 |

## 设计原则

- **只报告，不动手。** 扫描器是只读的，不会替你禁用、删除、"修复"任何东西——决定权在你。
- **目录模式零依赖。** 原有 Python 扫描器保持纯标准库；DSH 模式使用官方 Cordis patch 算法和固定版本的 YAML/SemVer 依赖。
- **不乱报警。** `SessionStart`、`Stop` 这类生命周期事件的 `*` matcher 是正常写法，只有工具事件（`PreToolUse` 之类）的通配符才会被标记。
- **规则库是活的。** R1-R10 都是从真实 GitHub issue 里提炼的。你在野外踩到新的冲突模式，提个 issue，它就变成下一条规则。

## 老实交代

- 这是静态分析，只读配置文件。R2 能查到的是插件**声明了**的工具名；运行时才发现的工具名碰撞查不到。
- R5 的重叠检测是关键词启发式，不是语义向量。会有少量误报，但换来零成本零联网。
- R7 要联网，只看公开的 GitHub 元数据。

一个敢说"你没病"的工具，说"你有病"的时候才值得信。

## 项目结构

```
plugin-health-check/
├── SKILL.md                       # skill 定义（触发条件 + 工作流）
├── scripts/
│   └── plugin_health_check.py     # 扫描器本体，可当 CLI 也可 import
├── tests/
│   └── run_tests.py               # 23 项断言，自带测试道具
├── assets/                        # banner 和演示图
└── README.md / README.en.md
```

## 贡献

最有价值的贡献是**新规则**：如果你碰到 R1-R10 没覆盖的插件冲突事故，开个 issue 描述一下故障现象，这个规则库就是这么长起来的。

```bash
python tests/run_tests.py   # passed: 23, failed: 0
npm test                   # DSH 配置、CLI、ASAR 和候选模式回归测试
```

## License

[MIT](LICENSE)——随便用。
