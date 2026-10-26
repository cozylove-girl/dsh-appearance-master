# 社区收录与发布指南

## 社区收录

投稿目标：[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
规则来源：[contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)，核对日期为 2026-10-26；提交前请查看是否有更新。

本项目提供以下材料：

| 项目 | 位置 |
|---|---|
| 插件清单、兼容范围与仓库信息 | 根目录 `package.json` |
| bundle 安装补丁 | 根目录 `cordis.patch.yml` |
| 开源许可 | 根目录 `LICENSE`（MIT） |
| 安装、使用及文件访问说明 | 根目录 `README.md` |
| 社区目录条目 | `community/data/plugins/cozylove-girl__dsh-appearance-master.yml` |
| 收录 PR 文案 | `community/pull-request.md`（首行为标题） |

目录条目使用 `ui` 分类：本项目提供外观管理面板，而非某一款皮肤或主题素材。
图标和截图是可选字段；只有实际可访问的素材才应填入条目。

### 提交时间

仓库创建于 **2026-10-26 22:04:57（北京时间）**。社区要求仓库创建满一天，因此建议在 **2026-10-27 22:05（北京时间）之后**提交。
GitHub 仓库已公开，并已设置 `dsh-plugin` topic（2026-10-26 核对）。

### 通过 GitHub 网页提交

1. 确保本项目的最新修改已推送到 GitHub。
2. 先[搜索已有收录 PR](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pulls?q=is%3Apr+dsh-appearance-master)，避免重复投稿。
3. 打开[社区目录的新建文件页面](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/new/main/data/plugins)。如果没有写权限，按 GitHub 提示 fork 并创建分支。
4. 文件名填写 `cozylove-girl__dsh-appearance-master.yml`，内容复制本项目 `community/data/plugins/` 中的同名文件。最终路径必须为 `data/plugins/cozylove-girl__dsh-appearance-master.yml`，不要带本项目的 `community/` 前缀。
5. 选择 **Propose changes / Create pull request**，目标仓库为 `awesome-dsh-plugin/awesome-dsh-plugin`，目标分支为 `main`。标题与正文使用 `community/pull-request.md`。
6. 确认 PR 只新增上述一个 YAML 文件。无需修改社区目录的 README，也无需添加 `npm:` 字段。
7. 等待 CI 和维护者评审。如需调整，修改同一 PR 分支中的文件；合并后社区目录自动重建，插件市场按其索引更新节奏显示结果。

收录不要求 npm 包。维护者还会核对功能描述、分类和代码，CI 通过不代表已获收录。

## npm 分发（可选）

npm 分发与社区收录可分别进行。项目已配置包名 `dsh-appearance-master`、`publishConfig.access: public`、文件白名单和发布前检查。这些配置用于准备发布；只有 `npm publish` 成功后，registry 才提供可安装的包版本。

2026-10-26 已完成 `dsh-appearance-master@0.9.1` 的首次公开发布，并核验官方 registry 的 `latest` 指向 `0.9.1`，包摘要与本地上传文件一致。包页面：[dsh-appearance-master](https://www.npmjs.com/package/dsh-appearance-master)。

可通过 `dsh plugin --profile desktop add dsh-appearance-master` 安装，或通过 `npm view dsh-appearance-master version` 查询当前版本。市场收录仍需单独提交 PR。

后续版本发布前需更新 `package.json` 版本号和 CHANGELOG。可在本机执行：

发布账户需要启用双重验证（2FA），或使用具备发布权限且允许 bypass 2FA 的 granular access token；仅 `npm whoami` 成功不代表拥有发布授权。可在 npm 网站的头像菜单 → Account → Two-Factor Authentication 中启用，具体见 [npm 官方说明](https://docs.npmjs.com/configuring-two-factor-authentication/)。

```bash
node scripts/pre-publish.mjs
npm pack --dry-run
npm login --registry=https://registry.npmjs.org/
npm view dsh-appearance-master --registry=https://registry.npmjs.org/
npm publish --access public
```

`npm login` 需要包维护者完成浏览器登录或验证。`npm view` 用于检查包名和已有版本：如果返回 E404，表示该 registry 中没有可见的同名包；如果包已存在，应先核对维护权限和版本号。同一版本不能重复发布。

项目还提供 `.github/workflows/publish.yml`，推送 `v*` tag 会尝试发布 npm 包。
启用这条路径前，在[仓库 Actions Secrets](https://github.com/cozylove-girl/dsh-appearance-master/settings/secrets/actions) 配置具有对应包发布权限、允许 bypass 2FA 的 granular access token，secret 名为 `NPM_TOKEN`。也可另行配置 npm Trusted Publisher 并调整工作流，使用 OIDC 发布。
本机首次发布与自动发布选择一种执行，同一个版本不要重复发布。社区收录无需配置该 secret，也无需推送 tag。

发布包的 `repository` 已指向本仓库，社区目录会自动尝试建立 npm 关联，无需在收录 YAML 中额外填写包名。
