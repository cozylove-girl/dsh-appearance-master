# 外观总控 · dsh-appearance-master

[![ci](https://github.com/cozylove-girl/dsh-appearance-master/actions/workflows/ci.yml/badge.svg)](https://github.com/cozylove-girl/dsh-appearance-master/actions/workflows/ci.yml)

**DeepSeek Harness（DSH）的外观管理面板**，集中切换皮肤、主题、背景动画和装饰件，支持保存与应用整套外观方案。

入口：**设置 → 外观总控**。

## 项目初衷

同时使用多套皮肤、主题、视频背景和挂件时，外观设置分散在不同插件中。切换一套搭配需要反复打开多个面板；多个插件修改相同配置时，也容易出现覆盖与冲突。

我希望有一个统一入口，能够快速选择当前使用的外观、关闭某一层效果，并把常用搭配保存下来。因此做了外观总控，将皮肤、主题、背景和装饰件分层管理，让整套外观的切换更直接。

皮肤的具体样式仍可在皮肤管理器中调整，外观总控负责快捷切换和方案管理。

## 功能

| 层 | 管理内容 | 选择方式 |
|---|---|---|
| 皮肤 | 页面布局 | 单选，支持关闭所有皮肤 |
| 主题 | 配色与质感 | 单选 |
| 背景 / 动画 | 视频、壁纸、开机动画 | 单选 |
| 装饰件 | 挂件、桌宠、状态条 | 多选 |

- 将当前选择保存为整套方案，随时重新应用。
- 通过配置受管区块管理启停状态，保留其他插件的配置内容。
- 直接修改补丁文件前自动生成 `cordis.patch.yml.master-bak` 备份。

## 安装

面向 DSH 0.2 系列，`package.json` 声明的兼容范围为 `>=0.2.0-rc.2 <0.3.0-0`。插件包含宿主端与 Web 客户端，通过 `dsh.bundle` 加载，无需额外构建。声明范围不代表逐个版本均经过实机验证。

以下命令使用 `desktop` profile；使用其他 profile 时，请替换对应名称。

### 从 npm 安装

```bash
dsh plugin --profile desktop add dsh-appearance-master
```

发布版本见 [npm 包页面](https://www.npmjs.com/package/dsh-appearance-master)。

### 从 GitHub 安装

```bash
dsh plugin --profile desktop add git+https://github.com/cozylove-girl/dsh-appearance-master.git
```

### 从本地目录安装

克隆或解压仓库后，将命令中的路径替换为实际绝对路径：

```bash
dsh plugin --profile desktop add /绝对路径/dsh-appearance-master
```

也可以在 **设置 → 插件** 的安装入口填写本地目录路径。

安装完成后，重启 DSH 并刷新页面。

### 从插件市场安装

项目经社区目录收录、且插件市场更新对应索引后，可搜索 `dsh-appearance-master` 安装。直接安装可使用上面的 GitHub 命令。

社区目录收录与 npm 发布是独立流程，GitHub 源码安装不要求发布 npm 包。

<details>
<summary>手动配置 profile</summary>

将以下字段合并到 profile 的 `package.json`，保留已有依赖和 bundles，再运行 `pnpm install`：

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

如需清理保留的启停配置，可在 profile 和 DSH home 的 `cordis.patch.yml` 中移除
`# --- appearance-master managed` 至 `# --- end appearance-master managed ---` 的完整受管区块。
如需使用 `.master-bak` 恢复，请先确认备份内容，避免覆盖备份生成后所做的其他配置修改。

## 使用

1. 为皮肤、主题、背景各选择一项，按需勾选装饰件。选择“关闭所有皮肤”可停用皮肤层。
2. 点击 **应用并刷新**，写入配置并重新加载页面。
3. 为常用组合命名并保存，之后可从方案列表重新应用。

“已加载 / 已停用”反映读取到的启停配置；尚未应用的选择显示为“待应用”。

## 配合其他外观插件使用

| 插件 | 用途 |
|---|---|
| 外观总控（本项目） | 分层切换、关闭皮肤、管理整套方案 |
| 皮肤管理器 `@smalltailqwq/dsh-client-ui-skin-deep-whale-manager` | 皮肤切换、桌面图标跟随及皮肤细调 |
| 皮肤市场 `dsh-skin-market` | 浏览、安装与卸载皮肤 |

这些插件可按需搭配使用。外观总控与皮肤管理器读取相同的皮肤启停配置，在一处切换后，可刷新另一处查看状态。
安装新的外观插件后，刷新外观总控即可重新扫描。

## 数据与文件访问

插件扫描本地已安装的外观插件及其配置，浏览器通过同源接口与 DSH 宿主通信。外观管理功能不调用外部网络服务，也不读取会话内容。

| 文件 | 用途 |
|---|---|
| `<profile>/cordis.patch.yml` | profile 层的外观启停配置 |
| `<DSH home>/cordis.patch.yml` | home 层的外观启停配置；该层优先级更高 |
| `<DSH home>/appearance-presets.json` | 保存的外观方案 |
| `<DSH home>/appearance-master.heartbeat.json` | 启动诊断信息 |
| `cordis.patch.yml.master-bak` | 补丁修改前的备份，位于相应补丁文件旁 |

DSH home 由 `DSH_HOME` 指定，默认使用 `~/.dsh`。启停操作优先使用宿主插件管理接口；需要直接修改补丁时，写入本插件的受管区块并保留其他配置。

## 兼容性说明

- 应用外观选择后会刷新页面，以重新加载客户端外观插件。宿主提示需要重启时，请重启 DSH。
- 视频素材、主题细节、挂件角色等插件内部选项，仍在对应插件的设置中调整。
- 多个管理器修改相同启停项时，最终状态受配置层级与写入顺序影响。建议完成一次切换后刷新其他管理面板。
- 自动备份用于恢复最近一次补丁修改，连续应用会更新备份。

## 开发与验证

项目未声明需要单独安装的 npm 依赖，React 与 DSH 客户端服务由宿主提供。开发检查无需安装依赖或执行构建。修改 `lib/` 后重启 DSH 验证运行效果。

```bash
npm test                        # 运行全部八项离线检查
node scripts/pre-publish.mjs     # 校验发布元数据并运行测试
node scripts/preview.mjs         # 只读预览本机配置及待写入内容
```

测试使用临时 profile；清单检查在本机存在已链接插件时还会只读比较版本。
离线测试覆盖配置写入、两层优先级、宿主接口、客户端选择语义和皮肤细调协议；实际界面效果需在 DSH 中验证。

版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 社区收录与发布

收录流程与可直接使用的投稿材料见 [社区发布指南](https://github.com/cozylove-girl/dsh-appearance-master/blob/main/docs/community-release.md)。

社区收录要求仓库提供可安装的 `dsh.bundle`、真实可用的代码、`dsh-plugin` topic，并满足仓库创建时间要求。
提交内容为社区目录中的一个 YAML 文件，具体以[社区贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)为准。

npm 发布为可选分发方式，用于按包名安装与展示下载量。发布包的 `repository` 必须回指本仓库；本项目已配置包信息、MIT 许可和发布前校验。

## 许可

[MIT](LICENSE) · Copyright (c) 2026 cozylove-girl
