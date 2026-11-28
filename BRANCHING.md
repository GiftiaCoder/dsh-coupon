# 分支模型

本仓库维护两条线：

| 分支 | 用途 | 来源 |
| --- | --- | --- |
| `public` | 公开发布线：新功能、修复、版本号、tag、Release 都在这里；Gitea 上同时作为 GitHub 镜像 | 从零起步的公开版历史 |
| `private` | 内部私有版 = `public` + 私有差异层；Gitea 默认分支 | `public` 更新后 merge，再叠加私有差异 |
| `main` | 更早的旧私有线，历史与公开版无共同祖先，仅作存档，不再使用 | — |

## 规矩（2026-11-24 定）

1. **功能开发只在 `public` 上做。** 面板、工具、模板机制、修复、发版全走 public。
2. **`public` 更新后，`private` merge `public`。** 不要手工把同一批改动抄进 private——那会制造双份提交，下次 merge 冲突翻倍（2026-11-24 踩过）。
3. **`private` 只保留私有差异**：金色配色、赛博票夹话术、煎蛋徽记、兑换按钮、私有默认票面（如 `奶茶.md` 这一命名）、私有 README 段落。
4. 冲突应当只出现在私有差异附近（`client.js` 的配色/话术/按钮、README、`package.json` 的版本与描述、`defaults/` 票面）。解决时以私有差异为准，同时把公开版的新功能合并进来。
5. 版本号：`public` 用 `0.x.y`；`private` 用 `0.x.y-private.1`。
6. 以后的根治方向：把私有差异抽成 CSS 变量 / 文案文件 / 配置开关，让 `client.js` 不再有私有差异，merge 冲突可清零。
7. **不变式（随时可自检）**：`private` 必须始终是 `public` 的后代分支——即 `public` 的全部提交都在 `private` 的历史里，`private` 只多出「私有差异 + merge 提交」这一层。

```bash
# 在 private 工作区里跑，两条都必须成立
git fetch origin
git merge-base --is-ancestor origin/public HEAD && echo "✓ public 是 private 的祖先"
test "$(git rev-list --count HEAD..origin/public)" = 0 && echo "✓ 没有漏 merge 的公共提交"
```

## 最近一次执行

2026-11-28：`public` v0.6.4（`f165e3d`）→ `private` merge 得 `c892fd9`（`0.6.4-private.1`）。这一批连续发了 v0.6.0–v0.6.4（票夹通知、路由 `ctx.inject` 挂载、通知称呼「用户/老板」），每次都先 merge 再叠私有差异，测试 46 项全过。自检结果：`public` 是 `private` 的祖先，漏 merge 的公共提交 = 0，`private` 独有 9 个提交（5 个本次 merge + 4 个历史）。

2026-11-24：`public` v0.4.0（`1c1db95`）→ `private` merge 得 `1b1f655`（两个父：`9875b60` 与 `1c1db95`），冲突 4 个文件，11 项测试全过。
