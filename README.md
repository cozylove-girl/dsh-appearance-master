# 外观总控 · dsh-appearance-master

[![ci](https://github.com/cozylove-girl/dsh-appearance-master/actions/workflows/ci.yml/badge.svg)](https://github.com/cozylove-girl/dsh-appearance-master/actions/workflows/ci.yml)

给 **DeepSeek Harness**（DSH）用的外观总控面板：皮肤、主题、背景动画、装饰件分层管理，
一层一个开关，写回 profile 的 `cordis.patch.yml`，应用后刷新一次页面生效。

设置 → **外观总控**（排在皮肤管理之后）。

---

## 为什么会有这个东西

我一口气装了两套皮肤、一个主题、一段视频背景，还有那只余额小鲸鱼。它们单独看都很好，
凑在一起就开始打架：

- 谁生效，取决于哪一行 patch **最后**被写进 `cordis.patch.yml` —— 而它们各写各的；
- 皮肤管理器只认包里的 `skin.json`，管不到改 CSS 变量的主题插件，也管不到铺视频的；
- 想「把皮肤全关掉、只留主题」，翻遍设置也没找到那个开关；
- 换身打扮要改好几个文件，第二天想换回去，已经想不起早上是什么样了。

所以我写了这个面板：把四类东西摆进同一张表，用同一套机制开关，顺手能把「现在这身」存成方案。
它不替别的插件做主，只做那个**总开关**和**备忘录**——皮肤管理器管得到的地方，它照样放行。

## 它做什么

| 层 | 管什么 | 怎么选 |
|---|---|---|
| 皮肤 | 整页布局 | 单选，含「关闭所有皮肤」 |
| 主题 | 配色与质感 | 单选 |
| 背景 / 动画 | 视频、壁纸、开机动画 | 单选 |
| 装饰件 | 挂件、桌宠、状态条 | 多选 |

- **一键切回**：把当前四层的选择存成「整套方案」，之后一点换回；
- **只动自己那一段**：区块之外、以及区块里别人的行，一律保留；
- 每次写入前自动备份成 `cordis.patch.yml.master-bak`。

## 安装

需要 DSH 0.2 系列（支持 `dsh.client` 插件与 loader patch）。

### 方式一：插件市场里点一下（最省事）

先装插件市场（如果还没有）：

```bash
dsh plugin --profile desktop add dshmarket
```

打开 **插件 → 发现**，搜 `dsh-appearance-master`，点**安装**。装好刷新页面；没出现就重启一次 DSH。

> 这条路依赖包已经发布到 npm、并被目录收录；还没上架时用下面两种。

### 方式二：一条命令（本地目录 / git 都行）

```bash
# 已经 clone 或解压到本机
dsh plugin --profile desktop add /绝对路径/dsh-appearance-master

# 或者直接从仓库
dsh plugin --profile desktop add git+https://github.com/cozylove-girl/dsh-appearance-master.git
```

### 方式三：图形界面

**设置 → 插件** → 安装时填上面那个本地目录路径，效果和命令行一样。

装好后**重启 DSH、刷新页面**。没有 `dsh` 命令也不影响方式一和方式三。

<details>
<summary>手动接进 profile（不想用 CLI 的话）</summary>

在 profile 的 `package.json` 里加两条，再 `pnpm install`：

```json
{
  "dependencies": { "dsh-appearance-master": "link:/绝对路径/dsh-appearance-master" },
  "dsh": { "profile": { "bundles": ["dsh-appearance-master"] } }
}
```

</details>

### 卸载

```bash
dsh plugin --profile desktop remove dsh-appearance-master
```

之后可选：把 `cordis.patch.yml` 里 `# --- appearance-master managed ---` 那段删掉，
或者用旁边的 `.master-bak` 覆盖回去。

## 推荐搭配

这三个是一套，配合起来才顺手 —— 它们写的是同一批 `ui-skin-*` 行，所以天生同步：

| 插件 | 干什么 | 为什么配它 |
|---|---|---|
| **外观总控**（本项目） | 四层总开关、整套方案 | 决定「这一刻加载哪些外观」 |
| **皮肤管理器**<br>`@smalltailqwq/dsh-client-ui-skin-deep-whale-manager` | 换皮肤、桌面图标跟随、每套皮肤的细调 | 本面板只管快捷切换与全关，**细调在它那里**；两边选中的永远是同一套 |
| **皮肤市场**<br>`dsh-skin-market` | 带界面的皮肤商店，逛、装、卸载皮肤 | 新皮肤装好后，会自动出现在上面两边的列表里 |

```bash
dsh plugin --profile desktop add dsh-skin-market
dsh plugin --profile desktop add @smalltailqwq/dsh-client-ui-skin-deep-whale-manager
```

配合起来的样子：

- 想**快速换一套**、或者**一个皮肤都不开** → 用本面板，点完刷新就是；
- 想调这套皮肤的**颜色、字号、显隐时段** → 去「设置 → 皮肤管理」；
- 想**找新皮肤** → 逛皮肤市场，装完回来刷新一下；
- 不管在哪边切换，另一边刷新后都是同一套——因为它们读的是同一份配置。

## 用起来

1. 每层选一个；皮肤那层点「关闭所有皮肤」＝ 一个都不加载。
2. 点 **应用并刷新**。写完配置会刷新一次页面——外观插件是页面启动时装进去的，只有重新加载才算数。
3. 常用组合起个名字存成方案，以后一键切回。

「已加载 / 已停用」是配置里的真实状态；你自己点了还没应用的，会标成「待应用」。

## 它会改哪些文件

| 文件 | 改什么 |
|---|---|
| `<profile>/cordis.patch.yml` | 自己那一段受管区块（`- id` + `disabled`） |
| `<home>/cordis.patch.yml` | 同上（home 层优先级更高，两边都写才压得住） |
| `$DSH_HOME/appearance-presets.json` | 整套方案 |
| `$DSH_HOME/appearance-master.heartbeat.json` | 启动心跳，只用于诊断 |

不联网、不读会话、不碰 `node_modules`、不碰别人的配置。

## 已知边界

- **应用后要刷新一次页面**：这是外观插件的加载方式决定的，不是偷懒。
- 有些插件自己还有一层开关（视频背景、主题素材、挂件角色），那一层不在本面板里。
- 和「官方插件管理器 / 皮肤管理器」同时写同一行时，后写者生效——本面板的写总排在最后一段。

## 发布到社区（维护者）

想把「一键安装」真正打开，需要三件事，缺一件就只剩路径安装：

1. **发布到 npm**：`npm publish --access public`。目录装的正是 `name@version`。
2. **`repository` 指回 GitHub**：目录会校验「npm 包名回指同一个仓库」。仓库里已经写好了
   `git+https://github.com/cozylove-girl/dsh-appearance-master.git`，改仓库就同步改它。
3. **被目录收录**：插件市场的目录来自
   [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
   （CI 每日刷新，data 与 `scripts/build-site.mjs` 在那边），按其 `contributing.md` 提交收录。
   dsh 0.2.1+ 的「插件 → 发现 → 索引源」也能直接加任何 format 1 索引。

`engines.dsh` 已写在 `package.json` 里（`>=0.2.0-rc.2 <0.3.0-0`），市场会据此标兼容性。

发布守门：`npm publish` 前会自动跑 `scripts/pre-publish.mjs` —— 检查清单字段、
`repository` 回指、CHANGELOG 有没有当前版本、八个离线测试是否全绿，任何一项不过就中止发布。
也可以手动跑：

```bash
node scripts/pre-publish.mjs
```

## 开发

没有构建步骤，改完 `lib/` 重启 DSH 即可。自检全部离线、自带临时 profile，不碰你真机：

```bash
npm test                       # 下面这些一次跑完
node test/regressions.mjs      # 外观归属 / 冲突 / 刷新 / 皮肤同步 的回归
node test/smoke-host.mjs       # 路由、确认门控、方案增删、心跳
node test/smoke-client.mjs     # 前端模块形状与选择语义
node test/write-safety.mjs     # CRLF、noop、状态保留、拒绝非 profile、回滚
node test/two-layers.mjs       # 两层补丁的优先级
node test/nudge.mjs            # 交给官方插件管理器的那条通道
node test/tuning-protocol.mjs  # 皮肤细调协议（与皮肤管理器共用）
node test/check-manifest.mjs   # package.json 字段
```

只读诊断（不动任何文件）：

```bash
node scripts/preview.mjs       # 现在的状态 + 下一次应用会写哪几行
```

历史与每一版的来龙去脉在 [CHANGELOG.md](CHANGELOG.md)。

## 许可

MIT
