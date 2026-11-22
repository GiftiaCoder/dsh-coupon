# dsh-coupon · 票夹

给 [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) agent 用的票夹插件：把「承诺」做成一张张可以签发、兑换、核销的票。

纯文件、无数据库：票面是 markdown，账户是 markdown，状态靠 md5 和文件名判定，`git diff` 能看、`cp` 能备份。

![test](https://github.com/GiftiaCoder/dsh-coupon/actions/workflows/test.yml/badge.svg)

## 它是什么

票夹 = **模板** + **账户** + **卡券**。

- **模板**：票种登记处。`~/wallet/templates/<票种>.md` 里加一个文件就多一个票种，价格写在文件头部，改价不用改代码。
- **账户**：唯一的一个账户文件（默认 `~/wallet/鲸圆券.md`），余额 + 流水 + md5 校验。每次充值/扣款都重算校验、原子写回。
- **卡券**：签发票据，文件名是 `<票种>-<正文 md5>.md`。核销时往票面追加「消耗时间」，文件保留；下次枚举重算 md5，对不上就视为已消耗，进「已消耗档案」。

```
~/wallet/
  templates/
    犯错卡.md
    奶茶券.md
    阿拉丁的灯.md
    娱乐券Token1M.md           # 四个内置票种，价格和规则都能改
    咖啡券.md                  # 自己加的
  奶茶券-<md5>.md              # 手里还能用的票
  奶茶券-<md5>.md（核销后）    # 文件还在，md5 失配 → 跳过
  鲸圆券.md                    # 账户：余额 + 流水 + 校验
  ledger.jsonl                 # 只追加的时间线（面板用，不参与状态判定）
```

## 内置票种

首次运行会写四个默认模板（已有的同名文件不会被覆盖）：

| 票种 | 价格 | 用途 |
| --- | --- | --- |
| 犯错卡 | 999999 | 自己发现犯错时，免掉一段情绪表演，不减免事实和补救 |
| 奶茶券 | 100 | 兑换一杯奶茶，24 小时内有效 |
| 阿拉丁的灯 | 10000 | 一次向用户许愿要票的机会，拿到即核销 |
| 娱乐券Token1M | 1000 | 任意会话消费 1M token 的娱乐额度，可叠加 |

价格只是起手式，面板里能改；不喜欢哪个直接删模板，已签发的票不受影响。

## 安装

要求：Node.js >= 22，DSH >= 0.2.0（在 0.2.0-rc.2 上实测）。

```bash
git clone https://github.com/GiftiaCoder/dsh-coupon.git
cd dsh-coupon
bash install.sh          # 复制到 ~/.dsh/profiles/web/node_modules/dsh-coupon 并登记 bundle
# 然后重启 DSH web 进程
```

`install.sh` 是幂等的；`DSH_PROFILE_DIR` 可指定别的 profile。它故意**不跑 pnpm install**：宿主插件只需要文件就位 + bundle 登记，装依赖反而可能冲掉 profile 里别的补丁。

卸载：从 profile `package.json` 的 `dsh.profile.bundles` 里删掉 `"dsh-coupon"`，删掉 `node_modules/dsh-coupon`，重启。`~/wallet/` 不受影响。

## 工具

插件按 agent 注册 5 个工具，任何会话可见：

| 工具 | 作用 |
| --- | --- |
| `wallet_templates` | 列出全部模板：票种、价格、用途、规矩、例外 |
| `wallet_list` | 查账户余额、余票、已消耗档案、最近记录（只读） |
| `wallet_request` | 向用户申请卡券或账户余额 → 弹授权界面，批准才签发 |
| `wallet_exchange` | 用账户余额自主兑换卡券：先扣款、再发卡，发卡失败自动退回 |
| `wallet_redeem` | 核销一张：说明用在什么事上 → 追加消耗时间 |

设计上把「发」和「花」分开：**签发**要人点头（`wallet_request` 走 DSH 的 approval），**兑换**是 agent 花自己账户里的余额，不需要再授权；两边都有额度上限。

## 面板

DSH Web 的「设置 → 票夹」里有一页面板：账户余额与流水（带票样插图）、模板卡片、签发/兑换/作废、模板编辑（新建、改价、改规矩、删除）、票墙；已消耗档案默认折叠，点开才看。

![票样](assets/note.jpg)

## 自定义票种

```md
---
id: 咖啡券
kind: card
price: 60
currency: 鲸圆券
---

# 咖啡券

## 用途

凭票兑换一杯咖啡，美式拿铁随点。

## 规矩

- 一票一杯。

## 不可使用

- （可选，每行一条）
```

`kind` 只能是 `card`：账户不走模板系统。`price` 是兑换要花的账户余额，`0` 表示免费票。

`examples/templates/` 里有一个可以直接拷的示例（免打扰券）。

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_WALLET_DIR` | `~/wallet` | 票夹目录 |
| `DSH_WALLET_AGENT` | `agent` | 票面署名人；多台机器共用一个仓时各署各的 |
| `DSH_WALLET_CURRENCY` | `鲸圆券` | 账户名。**改名等于换账户**：旧文件名和校验都对不上，换名前先迁移 |

## 设计细节

**md5 绑定**：签发时 `md5(票面正文)` 写进文件名。核销/作废只是往正文追加一段记录，于是当前 md5 和文件名不再相等 —— 这张票就「消失」了。不需要数据库，不需要状态字段，文件系统本身就是账本。

**账户校验**：`md5(账户名|余额|流水)` 写进账户文件。余额或流水被手改，校验就对不上，兑换直接拒绝。

**退回**：兑换是「先扣款、再发卡」。发卡写盘失败时把扣掉的余额加回去，流水里 `-N` 和 `+N` 两条都保留，不合并净额 —— 方便对账。

**时间**：票面和流水用运行机器的本地时区。

## 票样插图

`assets/note.jpg` 是「鲸圆券」的票样配图（蜡笔版），面板和上面这张图都用它；`assets/note-engraved.jpg` 是另一版雕版风格，留给需要更「纸币」质感的场合。

两张图都由项目作者提供，**不在 MIT 许可范围内**；转发或再使用时请保留出处。

## 安全边界

- **md5 不是加密**。它防手滑、防 agent 乱改，不防有意的伪造：能改文件的人也能重算 md5。要真防篡改，得换签名方案。
- **面板接口等同于管理员**。`POST /api/wallet/action` 能签发票据、给账户充值；它依赖 DSH Web 自身的鉴权，不要把 DSH Web 裸暴露在不可信网络上。
- 账户文件和票面是明文 markdown；票夹目录的权限按普通用户数据处理。

## 开发

```bash
npm test        # node --test，覆盖签发 / 核销 / 篡改检测 / 账户校验 / 兑换失败退回
```

- `store.js`：纯文件层，不依赖 DSH / cordis，可以单独跑
- `index.js`：宿主半边，注册工具和 `/api/wallet/*` 路由
- `client.js`：浏览器半边，自注册脚本，挂到「设置」页
- `hostdeps.mjs`：从宿主树里取 `defineTool`，取不到时用本地等价实现兜底

`client.js` 依赖 DSH 客户端的 settings 插槽，DSH 升级时这部分最可能先动；升级后如果面板消失，先看 `node_modules/dsh-coupon` 是否被覆盖。

## License

MIT © 2026 GiftiaCoder
