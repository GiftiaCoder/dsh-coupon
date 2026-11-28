/**
 * notify.test.js —— 票夹动作 → 聊天框通知
 *
 * 这一组守的线：
 *   ① 三种动作的正文/摘要对（有备注就带，没有就不硬塞）；
 *   ② 只挑「最近有真人打字」的活跃会话 —— proactive 通知、plugin 注入、a2a 都抢不走；
 *   ③ 没有活人会话 / 宿主没给 createUserMessage 时安静跳过，不抛；
 *   ④ 消息是 notice 形态、producer-owned source kind（session-format v4 的口径）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  NOTICE_KIND,
  SUMMARY_MAX,
  boundSummary,
  buildNotice,
  deliverNotice,
  lastHumanEpoch,
  notifyWalletAction,
  pickTarget,
} from '../notify.mjs'

const T0 = 1795000000000

function humanAt(epoch, text = '老板说话') {
  return { type: 'user/message', seq: 0, time: epoch, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } }
}

function pluginAt(epoch) {
  return { type: 'user/message', seq: 0, time: epoch, data: { content: [], source: { kind: 'plugin:dsh-proactive', form: 'notice' } } }
}

function assistantAt(epoch) {
  return { type: 'assistant/message', seq: 0, time: epoch, data: {} }
}

function fakeAgent(events) {
  const inbox = []
  return {
    session: { events },
    inbox,
    followup(message) {
      inbox.push(message)
    },
  }
}

/** 假 createUserMessage：只校验调用方给的形状，并加一个假 id。 */
function fakeCreateUserMessage(input) {
  return { id: 'msg-1', role: 'user', ...input }
}

test('buildNotice：签发带备注与票号', () => {
  const notice = buildNotice('issue', { type: '犯错卡', count: 2, note: '看你可怜', serials: ['aaaa1111', 'bbbb2222'] })
  assert.match(notice.text, /老板刚签发了 2 张「犯错卡」/)
  assert.match(notice.text, /备注：看你可怜/)
  assert.match(notice.text, /票号：aaaa1111、bbbb2222/)
  assert.match(notice.text, /不是新任务/)
  assert.equal(notice.summary, '老板签发了 2 张「犯错卡」：看你可怜')
})

test('buildNotice：签发没有备注时不写备注行', () => {
  const notice = buildNotice('issue', { type: '奶茶券', count: 1 })
  assert.doesNotMatch(notice.text, /备注/)
  assert.doesNotMatch(notice.text, /票号/)
  assert.equal(notice.summary, '老板签发了 1 张「奶茶券」')
})

test('buildNotice：签发鲸圆券带金额、备注、余额', () => {
  const notice = buildNotice('fund', { amount: 100, note: '赌注', balance: 320 })
  assert.match(notice.text, /签发了 100 鲸圆券/)
  assert.match(notice.text, /备注：赌注/)
  assert.match(notice.text, /账户余额：320 鲸圆券/)
  assert.equal(notice.summary, '老板签发 100 鲸圆券：赌注')
})

test('buildNotice：作废带票种、票号和原票备注', () => {
  const notice = buildNotice('trash', { type: '犯错卡', note: '大肥鱼申请：糊弄过去', serials: ['abcd1234'] })
  assert.match(notice.text, /老板刚作废了 1 张「犯错卡」/)
  assert.match(notice.text, /票号：abcd1234/)
  assert.match(notice.text, /原票备注：大肥鱼申请：糊弄过去/)
  assert.equal(notice.summary, '老板作废 1 张「犯错卡」：大肥鱼申请：糊弄过去')
})

test('buildNotice：不认识的动作用 null，金额非法也 null', () => {
  assert.equal(buildNotice('template_save', {}), null)
  assert.equal(buildNotice('fund', { amount: 0 }), null)
  assert.equal(buildNotice('issue', { type: '' }), null)
})

test('boundSummary：超过 120 字截断成 119 + …', () => {
  const long = '鲸'.repeat(SUMMARY_MAX + 10)
  const bounded = boundSummary(long)
  assert.equal(bounded.length, SUMMARY_MAX)
  assert.ok(bounded.endsWith('…'))
})

test('lastHumanEpoch：只认 source.kind === "user" 的消息', () => {
  const events = [humanAt(T0), pluginAt(T0 + 1000), assistantAt(T0 + 2000)]
  assert.equal(lastHumanEpoch(events), T0)
})

test('lastHumanEpoch：一条真人消息都没有 → undefined', () => {
  assert.equal(lastHumanEpoch([pluginAt(T0), assistantAt(T0 + 1)]), undefined)
  assert.equal(lastHumanEpoch([]), undefined)
})

test('lastHumanEpoch：ISO 字符串时间也认', () => {
  const iso = new Date(T0).toISOString()
  assert.equal(lastHumanEpoch([{ type: 'user/message', time: iso, data: { source: { kind: 'user' } } }]), T0)
})

test('pickTarget：挑最后被打过字的那台', () => {
  const quiet = fakeAgent([humanAt(T0)])
  const fresh = fakeAgent([humanAt(T0 + 5000)])
  const botOnly = fakeAgent([pluginAt(T0 + 9000)])
  assert.equal(pickTarget([quiet, fresh, botOnly]), fresh)
  assert.equal(pickTarget([botOnly]), undefined)
  assert.equal(pickTarget([]), undefined)
})

test('deliverNotice：notice 形态、producer-owned kind、摘要被截断', () => {
  const agent = fakeAgent([humanAt(T0)])
  const delivered = deliverNotice({
    agent,
    text: '正文',
    summary: '鲸'.repeat(SUMMARY_MAX + 20),
    createUserMessage: fakeCreateUserMessage,
    log: () => {},
  })
  assert.equal(delivered, true)
  assert.equal(agent.inbox.length, 1)
  const message = agent.inbox[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, NOTICE_KIND)
  assert.equal(message.source.kind.startsWith('plugin:'), true, 'v4 要求 producer-owned kind')
  assert.equal(message.source.form, 'notice')
  assert.equal(message.source.summary.length, SUMMARY_MAX)
  assert.equal(message.content[0].type, 'text')
  assert.equal(message.content[0].text, '正文')
})

test('deliverNotice：宿主没有 createUserMessage 时安静跳过', () => {
  const agent = fakeAgent([humanAt(T0)])
  const logs = []
  const delivered = deliverNotice({ agent, text: '正文', summary: '摘要', createUserMessage: null, log: (l, m) => logs.push([l, m]) })
  assert.equal(delivered, false)
  assert.equal(agent.inbox.length, 0)
  assert.match(logs.map((x) => x[1]).join('\n'), /dsh-llm/)
})

test('deliverNotice：followup 抛错不影响调用方', () => {
  const agent = { followup() { throw new Error('下班了') } }
  const logs = []
  assert.equal(deliverNotice({ agent, text: '正文', summary: '摘要', createUserMessage: fakeCreateUserMessage, log: (l, m) => logs.push([l, m]) }), false)
  assert.match(logs.map((x) => x[1]).join('\n'), /下班了/)
})

test('notifyWalletAction：命中目标并投递', () => {
  const agent = fakeAgent([humanAt(T0)])
  const result = notifyWalletAction({
    agents: { roots: () => [agent] },
    createUserMessage: fakeCreateUserMessage,
    log: () => {},
    action: 'fund',
    data: { amount: 50, note: '奖励', balance: 120 },
  })
  assert.deepEqual(result, { ok: true, reason: 'delivered' })
  assert.equal(agent.inbox.length, 1)
  assert.match(agent.inbox[0].content[0].text, /签发了 50 鲸圆券/)
})

test('notifyWalletAction：没有活人会话就不发', () => {
  const result = notifyWalletAction({
    agents: { roots: () => [fakeAgent([pluginAt(T0)])] },
    createUserMessage: fakeCreateUserMessage,
    log: () => {},
    action: 'issue',
    data: { type: '犯错卡', count: 1 },
  })
  assert.deepEqual(result, { ok: false, reason: 'no-live-session' })
})

test('notifyWalletAction：拿不到 agents 服务时返回 agents-unavailable', () => {
  const result = notifyWalletAction({ agents: undefined, createUserMessage: fakeCreateUserMessage, log: () => {}, action: 'issue', data: { type: '犯错卡' } })
  assert.deepEqual(result, { ok: false, reason: 'agents-unavailable' })
})
