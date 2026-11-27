/**
 * dsh-coupon —— 票夹（host 侧：模板 + 账户 + 兑换）
 *
 * 目录：`$DSH_WALLET_DIR`（默认 `~/wallet/`）
 *   templates/*.md   票种模板（可自定义，加一个文件就多一个票种）
 *   <票种>-<md5>.md  一次性卡券：核销 = 追加消耗时间，枚举按 md5 跳过
 *   <账户>.md        账户：余额 + 流水 + md5 校验，每次变动重算写回（默认 鲸圆券.md）
 *
 * 工具（按 agent 注册，任何会话可见）：
 *   wallet_templates  列出全部模板（agent 据此理解每个票种的功能与价格）
 *   wallet_list       查账户余额、余票、已消耗档案
 *   wallet_request    主动索要卡券或账户余额 → 弹授权界面，批准才签发
 *   wallet_exchange   用账户余额自主兑换卡券（先扣款、再发卡，失败自动退回）
 *   wallet_redeem     核销一张（说明用途 → 追加消耗时间）
 *
 * Web 面板：GET /api/wallet/state、POST /api/wallet/action（issue / trash / fund）
 *   注：面板不提供「兑换」——账户余额是 agent 的，只有 wallet_exchange 工具能动它。
 *   路由本体在 routes.mjs（每条 handler 都过宿主的 connection 访问检查）。
 */
import { loadHostDeps } from './hostdeps.mjs'
import { installWalletRoutes } from './routes.mjs'
import {
  CURRENCY_ID,
  MAX_EXCHANGE,
  addFunds,
  agentName,
  exchange,
  issue,
  listCards,
  listAll,
  loadTemplates,
  redeem,
  snapshot,
  templateOf,
  walletDir,
} from './store.js'

// 从宿主那棵树里取 defineTool（拿不到就本地等价实现；绝不因为一个 import 让插件不激活）
const hostDeps = await loadHostDeps()
const defineTool = hostDeps.defineTool

export const name = 'dsh-coupon'
export const inject = ['agents', 'tools']

const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true }

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function summarize(snap) {
  return {
    ok: true,
    dir: snap.dir,
    currency: { id: snap.currency.id, balance: snap.currency.balance, ok: snap.currency.ok, templatesDir: snap.templatesDir },
    templates: snap.templates.map((t) => ({
      id: t.id,
      kind: t.kind,
      price: t.price,
      currency: t.currency,
      count: t.count,
    })),
    cards: snap.cards.map((c) => ({ serial: c.short, type: c.type, date: c.date, note: c.note, price: c.price })),
    spent: snap.spent.slice(0, 10).map((c) => ({ serial: c.short, type: c.type, mark: c.mark })),
    recent: snap.ledger.slice(0, 8),
  }
}

function walletToolDefinitions(agent, services) {
  return [
    defineTool({
      name: 'wallet_templates',
      description:
        `列出票夹里所有票据模板：票种、价格（${CURRENCY_ID}）、用途、规矩、例外。` +
        `agent 靠这个理解每个模板对应什么票据、花多少 ${CURRENCY_ID} 能兑换；模板可以自定义，放在票夹目录的 templates/ 下（加一个 md 就多一个票种）。`,
      parameters: {},
      output: { schema: OUTPUT_SCHEMA, render: renderJson },
      async execute(_args, exec) {
        if (exec.agent !== agent) return { ok: false, error: 'wrong-agent' }
        const templates = loadTemplates().map((t) => ({
          id: t.id,
          kind: t.kind,
          price: t.price,
          currency: t.currency,
          blurb: t.blurb,
          rules: t.rules,
          exceptions: t.exceptions,
        }))
        return { ok: true, templates, dir: walletDir() }
      },
    }),

    defineTool({
      name: 'wallet_list',
      description:
        `查看票夹：${CURRENCY_ID}余额、每类票据还剩几张、票号、最近记录。只读，不需要授权。` +
        '票种由模板决定（可自定义）；账户余额不是票种。',
      parameters: {
        type: { type: 'string', description: '只看某一类票据（可选，填模板 id）' },
      },
      output: { schema: OUTPUT_SCHEMA, render: renderJson },
      async execute(args, exec) {
        if (exec.agent !== agent) return { ok: false, error: 'wrong-agent' }
        let snap = snapshot()
        const type = typeof args['type'] === 'string' ? args['type'].trim() : ''
        if (type === CURRENCY_ID) {
          snap = { ...snap, templates: [], cards: [], spent: [] }
        } else if (type) {
          if (!templateOf(type)) return { ok: false, error: `不认识的票据模板：${type}` }
          snap = {
            ...snap,
            templates: snap.templates.filter((t) => t.id === type),
            cards: snap.cards.filter((c) => c.type === type),
            spent: snap.spent.filter((c) => c.type === type),
          }
        }
        return summarize(snap)
      },
    }),

    defineTool({
      name: 'wallet_request',
      description:
        `向用户申请票据：卡券（按张）或${CURRENCY_ID}（按金额）。调用后会弹出授权界面，用户点头才会签发；被拒绝就老实说，不许换着法子再问。` +
        `卡券用 count（1–3 张）；${CURRENCY_ID}用 amount（正整数金额）。`,
      parameters: {
        type: { type: 'string', description: `票据模板 id（卡券填模板 id，充值填 ${CURRENCY_ID}）` },
        count: { type: 'integer', description: `卡券张数，1–3，默认 1（${CURRENCY_ID}忽略）` },
        amount: { type: 'integer', description: `${CURRENCY_ID}金额（正整数；卡券忽略）` },
        reason: { type: 'string', description: '为什么要，一句话说清楚（用户会在授权弹窗里看到）' },
      },
      output: { schema: OUTPUT_SCHEMA, render: renderJson },
      async execute(args, exec) {
        if (exec.agent !== agent) return { ok: false, error: 'wrong-agent' }
        const type = typeof args['type'] === 'string' ? args['type'].trim() : ''
        // 账户（CURRENCY_ID）不是模板，单独走充值；其余类型必须是已存在的卡券模板。
        const isCurrency = type === CURRENCY_ID
        const tpl = isCurrency ? null : templateOf(type)
        if (!isCurrency && !tpl) {
          const ids = loadTemplates().map((t) => t.id).join(' / ')
          return { ok: false, error: `不认识的票据模板：${type}（可选：${ids}）` }
        }
        const amount = Number.isFinite(Number(args['amount'])) ? Math.floor(Number(args['amount'])) : 0
        const count = Number.isFinite(Number(args['count'])) ? Math.floor(Number(args['count'])) : 1
        if (isCurrency) {
          if (amount < 1 || amount > 100000) return { ok: false, error: `${CURRENCY_ID}金额需要在 1–100000 之间` }
        } else if (count < 1 || count > 3) {
          return { ok: false, error: '一次最多申请 3 张，至少 1 张' }
        }
        const reason = typeof args['reason'] === 'string' ? args['reason'].trim().slice(0, 200) : ''
        const ask = isCurrency ? `${amount} ${CURRENCY_ID}` : `${count} 张「${type}」`

        const approval = exec.agent.ctx.get('approval', false)
        if (approval === undefined || approval === null || typeof approval.request !== 'function') {
          return { ok: false, outcome: 'unavailable', error: '这个宿主没有审批应答器，弹不出授权界面；换成直接问用户吧。' }
        }
        let outcome = 'unavailable'
        try {
          outcome = await approval.request({
            agent: exec.agent,
            toolName: 'wallet_request',
            callId: exec.callId,
            reason: `票夹申请：${ask}${reason ? ` —— ${reason}` : ''}`,
            signal: exec.signal,
          })
        } catch (e) {
          return { ok: false, outcome: 'error', error: `授权流程没跑成：${e && e.message ? e.message : e}` }
        }
        if (outcome !== 'allowed-once') {
          const messages = {
            rejected: '用户没批。',
            cancelled: '授权被撤回，没发。',
            unavailable: '没有可用的授权应答器，没发。',
          }
          return { ok: false, outcome, message: messages[outcome] || `授权结果：${outcome}` }
        }
        if (isCurrency) {
          const funded = addFunds(amount, reason ? `${agentName()}申请：${reason}` : `${agentName()}申请`, '用户（授权签发）')
          if (!funded.ok) return { ok: false, outcome: 'issue_failed', error: funded.error }
          services.log?.('info', `dsh-coupon: funded ${amount} by approval`)
          return {
            ok: true,
            outcome: 'allowed-once',
            balance: funded.balance,
            say: `到账 ${amount} ${CURRENCY_ID}，余额 ${funded.balance}。`,
          }
        }
        const issued = issue(type, count, reason ? `${agentName()}申请：${reason}` : `${agentName()}申请`, '用户（授权签发）')
        if (!issued.ok) return { ok: false, outcome: 'issue_failed', error: issued.error }
        services.log?.('info', `dsh-coupon: issued ${count} x ${type} by approval`)
        return {
          ok: true,
          outcome: 'allowed-once',
          issued: issued.cards.map((c) => c.short),
          wallet: summarize(snapshot()),
          say: `签发 ${count} 张「${type}」，现在手里 ${listCards().filter((c) => c.type === type).length} 张。`,
        }
      },
    }),

    defineTool({
      name: 'wallet_exchange',
      description:
        `用${CURRENCY_ID}自主兑换卡券：按模板价格扣款、签发目标票据，不需要用户授权（花的是账户里的余额）。` +
        `一次最多 ${MAX_EXCHANGE} 张；余额不够会拒绝。兑换后的票面会注明来源与兑换价。`,
      parameters: {
        template: { type: 'string', description: '要兑换的票据模板 id（用 wallet_templates 查价格）' },
        count: { type: 'integer', description: '张数，1–10，默认 1' },
        note: { type: 'string', description: '备注（可选）' },
      },
      output: { schema: OUTPUT_SCHEMA, render: renderJson },
      async execute(args, exec) {
        if (exec.agent !== agent) return { ok: false, error: 'wrong-agent' }
        const template = typeof args['template'] === 'string' ? args['template'].trim() : typeof args['type'] === 'string' ? args['type'].trim() : ''
        if (!template) return { ok: false, error: '缺少 template（票据模板 id）' }
        const count = Number.isFinite(Number(args['count'])) ? Math.floor(Number(args['count'])) : 1
        const note = typeof args['note'] === 'string' ? args['note'].trim().slice(0, 200) : ''
        const result = exchange(template, count, note)
        if (!result.ok) return { ok: false, error: result.error }
        services.log?.('info', `dsh-coupon: exchanged ${count} x ${template} for ${result.used}`)
        return {
          ok: true,
          used: result.used,
          balance: result.balance,
          cards: result.cards.map((c) => ({ serial: c.short, type: c.type, price: c.price })),
          say: result.say,
        }
      },
    }),

    defineTool({
      name: 'wallet_redeem',
      description:
        '核销一张卡券：说明这张票用在了什么事上。' +
        '票面会追加消耗时间、文件保留；余票枚举按 md5 校验跳过已消耗的票。' +
        '每张票的用途与例外以模板里的「用途 / 规矩 / 不可使用」为准；不符合规矩的票不许核销。',
      parameters: {
        type: { type: 'string', description: '票据模板 id；只有一个卡券模板时可省略' },
        what_happened: { type: 'string', description: '一句话说明这张票用在了什么上（只写事实）' },
        count: { type: 'integer', description: '核销张数，1–3，默认 1' },
      },
      output: { schema: OUTPUT_SCHEMA, render: renderJson },
      async execute(args, exec) {
        if (exec.agent !== agent) return { ok: false, error: 'wrong-agent' }
        let type = typeof args['type'] === 'string' ? args['type'].trim() : ''
        if (!type) {
          const cards = loadTemplates().filter((t) => t.kind !== 'currency')
          if (cards.length === 1) type = cards[0].id
        }
        if (!type) return { ok: false, error: '请指定票据模板 id（wallet_templates 可查）' }
        if (type === CURRENCY_ID) return { ok: false, error: `${CURRENCY_ID} 是账户，没有可核销的票` }
        if (!templateOf(type)) return { ok: false, error: `不认识的票据模板：${type}` }
        const what = typeof args['what_happened'] === 'string' ? args['what_happened'].trim().slice(0, 300) : ''
        if (!what) return { ok: false, error: '得先说明发生了什么（what_happened），哪怕一句话。' }
        const count = Number.isFinite(Number(args['count'])) ? Math.floor(Number(args['count'])) : 1
        const result = redeem(type, what, count)
        if (!result.ok) return { ok: false, error: result.error }
        return {
          ok: true,
          used: result.used,
          remaining: result.remaining,
          say: result.say,
          message: `${result.say} 事由：${what}`,
        }
      },
    }),
  ]
}

/**
 * 挂面板路由：Web 宿主装（每条 handler 自带 connection 访问检查，见 routes.mjs），
 * 没有 webServer 的宿主（headless / CLI）什么都不装，工具照常可用。
 */
function installRoutes(ctx) {
  return installWalletRoutes({
    webserver: ctx.get('webServer', false),
    connection: ctx.get('connection', false),
    log: (level, message) => {
      const fn = ctx.logger && typeof ctx.logger[level] === 'function' ? ctx.logger[level] : undefined
      if (fn) fn.call(ctx.logger, message)
    },
  })
}

export async function apply(ctx) {
  const log = (level, message) => {
    const fn = ctx.logger && typeof ctx.logger[level] === 'function' ? ctx.logger[level] : undefined
    if (fn) fn.call(ctx.logger, message)
  }
  log('info', `dsh-coupon: wallet dir = ${walletDir()}`)

  const registerOne = (agent) => {
    return agent.ctx.effect(() => {
      const disposers = walletToolDefinitions(agent, { log }).map((definition) => agent.ctx.tools.register(definition))
      return () => {
        for (const d of disposers) d()
      }
    }, 'dsh-coupon:tools')
  }

  const disposeCreated = ctx.on('agent/created', ({ agent }) => {
    registerOne(agent)
    return undefined
  })

  for (const existing of ctx.agents.roots()) registerOne(existing)

  const disposeRoutes = ctx.effect(() => {
    const dispose = installRoutes(ctx)
    return () => {
      if (dispose) dispose()
    }
  }, 'dsh-coupon:routes')

  return () => {
    disposeCreated()
    if (typeof disposeRoutes === 'function') disposeRoutes()
  }
}
