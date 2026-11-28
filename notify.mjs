/**
 * notify.mjs —— 票夹动作 → 聊天框通知
 *
 * 面板上的「签发票据 / 签发鲸圆券 / 作废票据」是用户亲手做的，agent 不该事后靠
 * `wallet_list` 去猜。这里把成功的动作翻成一条 **notice 形态**的用户消息，递给
 * 「最近有真人打过字的活跃会话」：
 *   - notice 形态在 GUI 里是一枚可展开的通知行（不是用户气泡），摘要一句话；
 *   - 目标会话按「最后一条 `source.kind === 'user'` 的消息」排序 —— proactive 闹钟、
 *     a2a、子 agent 的注入消息都不算，抢不走通知；
 *   - 一个这样的会话都没有就**不发**：冷会话不会被叫醒，也不去打扰别的窗口。
 *
 * 消息对象交给宿主的 `createUserMessage` 造：session-format v4 要求消息带
 * producer-owned 的 source kind（`plugin:<插件名>`），手搓对象容易在写盘时被格式
 * 校验拒掉。宿主的这棵树里没有 dsh-llm 时，通知直接跳过（记一条 info），不影响
 * 签票本身。
 */

/** 本插件在 session-format v4 里的 producer-owned source kind。 */
export const NOTICE_KIND = 'plugin:dsh-coupon'
/** notice 摘要上限（宿主自己也会截到 120）。 */
export const SUMMARY_MAX = 120
/** 每条通知末尾的回复口径：别把一个通知演成一场汇报。 */
const REPLY_RULE = '这是票夹的通知，不是新任务：一句话回应就够，不用为此调用工具，也不用复述票面。'

/** 按宿主的 120 字口径截断一行摘要。 */
export function boundSummary(summary) {
  const text = String(summary ?? '').trim()
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}…`
}

/**
 * 把一个动作翻成通知正文 + 一行摘要。
 * @param {'issue'|'fund'|'trash'} action
 * @param {object} data 动作结果（见 routes.mjs 的 notify 调用点）
 * @returns {{text:string, summary:string}|null} 不认识的动作用 null
 */
export function buildNotice(action, data = {}) {
  const note = String(data.note ?? '').trim()
  const serials = Array.isArray(data.serials) ? data.serials.filter(Boolean).slice(0, 8) : []
  const serialLine = serials.length > 0 ? `票号：${serials.join('、')}` : ''

  if (action === 'issue') {
    const type = String(data.type ?? '').trim()
    const count = Math.max(1, Math.floor(Number(data.count) || 1))
    if (!type) return null
    const lines = ['[dsh-coupon 票夹通知]', `用户刚签发给你 ${count} 张「${type}」。`]
    if (note) lines.push(`备注：${note}`)
    if (serialLine) lines.push(serialLine)
    lines.push(REPLY_RULE)
    return {
      text: lines.join('\n'),
      summary: boundSummary(`用户签发给你 ${count} 张「${type}」${note ? `：${note}` : ''}`),
    }
  }

  if (action === 'fund') {
    const amount = Math.floor(Number(data.amount) || 0)
    if (amount <= 0) return null
    const balance = Number(data.balance)
    const lines = ['[dsh-coupon 票夹通知]', `用户刚给你的账户签发了 ${amount} 鲸圆券。`]
    if (note) lines.push(`备注：${note}`)
    if (Number.isFinite(balance)) lines.push(`账户余额：${balance} 鲸圆券`)
    lines.push(REPLY_RULE)
    return {
      text: lines.join('\n'),
      summary: boundSummary(`用户给你账户签发 ${amount} 鲸圆券${note ? `：${note}` : ''}`),
    }
  }

  if (action === 'trash') {
    const type = String(data.type ?? '').trim()
    if (!type) return null
    const lines = ['[dsh-coupon 票夹通知]', `用户刚作废了你手里 1 张「${type}」。`]
    if (serialLine) lines.push(serialLine)
    if (note) lines.push(`原票备注：${note}`)
    lines.push(REPLY_RULE)
    return {
      text: lines.join('\n'),
      summary: boundSummary(`用户作废了你手里的 1 张「${type}」${note ? `：${note}` : ''}`),
    }
  }

  return null
}

/**
 * 会话日志：0.1.1 线是 `.events`，0.1.2 线是 `snapshotEvents()`，两条都认。
 * 没有可读日志（会话还没建好）时返回空数组。
 */
export function sessionLogOf(session) {
  if (!session) return []
  if (Array.isArray(session.events)) return session.events
  if (typeof session.snapshotEvents === 'function') {
    try {
      const events = session.snapshotEvents()
      return Array.isArray(events) ? events : []
    } catch {
      return []
    }
  }
  return []
}

function epochOf(event) {
  const time = event?.time
  if (typeof time === 'number' && Number.isFinite(time)) return time
  if (typeof time === 'string') {
    const parsed = Date.parse(time)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** 最后一条**真人**发来的消息时间；没有就 undefined。 */
export function lastHumanEpoch(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    const epoch = epochOf(event)
    if (epoch !== undefined) return epoch
  }
  return undefined
}

/**
 * 从活跃 agent 里挑通知目标：最近一次真人打字的会话。
 * 没有活人会话、或活着的会话都没被打过字 → undefined（宁可不发）。
 */
export function pickTarget(agents) {
  let best
  for (const agent of Array.isArray(agents) ? agents : []) {
    const epoch = lastHumanEpoch(sessionLogOf(agent?.session))
    if (epoch === undefined) continue
    if (best === undefined || epoch > best.epoch) best = { agent, epoch }
  }
  return best?.agent
}

/**
 * 发一条通知。投递本身是同步排队（`followup`），出错只记日志，不往面板上抛。
 * @returns {boolean} 是否真的交给宿主了
 */
export function deliverNotice({ agent, text, summary, createUserMessage, log }) {
  if (!agent || typeof agent.followup !== 'function') return false
  if (typeof createUserMessage !== 'function') {
    log?.('info', 'dsh-coupon: host dsh-llm unavailable; wallet notice skipped.')
    return false
  }
  try {
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: NOTICE_KIND, form: 'notice', summary: boundSummary(summary) },
      }),
    )
    return true
  } catch (e) {
    log?.('warn', `dsh-coupon: wallet notice failed: ${e && e.message ? e.message : e}`)
    return false
  }
}

/**
 * 动作 → 挑会话 → 发通知，一把梭。失败一律返回原因，调用方（HTTP handler）
 * 不因为通知失败就回 500：票已经签了，通知是附赠的。
 */
export function notifyWalletAction({ agents, createUserMessage, log, action, data }) {
  const notice = buildNotice(action, data)
  if (notice === null) return { ok: false, reason: 'unknown-action' }
  if (!agents || typeof agents.roots !== 'function') return { ok: false, reason: 'agents-unavailable' }
  let roots = []
  try {
    roots = agents.roots()
  } catch (e) {
    log?.('warn', `dsh-coupon: cannot list live agents: ${e && e.message ? e.message : e}`)
    return { ok: false, reason: 'agents-unavailable' }
  }
  const target = pickTarget(roots)
  if (target === undefined) return { ok: false, reason: 'no-live-session' }
  const delivered = deliverNotice({ agent: target, text: notice.text, summary: notice.summary, createUserMessage, log })
  return delivered ? { ok: true, reason: 'delivered' } : { ok: false, reason: 'not-delivered' }
}
