import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import {
  CURRENCY_ID,
  DEFAULT_TEMPLATES,
  addFunds,
  agentName,
  exchange,
  issue,
  listAll,
  listCards,
  loadTemplates,
  readCurrency,
  redeem,
  saveTemplate,
  templateOf,
} from '../store.js'

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex')

let dir
const saved = {}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-coupon-'))
  for (const k of ['DSH_WALLET_DIR', 'DSH_WALLET_AGENT', 'DSH_WALLET_CURRENCY']) saved[k] = process.env[k]
  process.env.DSH_WALLET_DIR = dir
  delete process.env.DSH_WALLET_AGENT
  delete process.env.DSH_WALLET_CURRENCY
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

test('内置四个默认票种，账户不在模板列表里', () => {
  const tpls = loadTemplates()
  assert.equal(tpls.length, 4)
  assert.deepEqual(
    new Set(tpls.map((t) => t.id)),
    new Set(['犯错卡', '奶茶券', '阿拉丁的灯', '娱乐券Token1M']),
  )
  assert.ok(tpls.every((t) => t.kind === 'card'))
  assert.ok(tpls.every((t) => t.id !== CURRENCY_ID))
  assert.equal(templateOf(CURRENCY_ID), undefined)
})

test('默认票面来自 defaults/templates 下的真实 md 文件', () => {
  const dir = new URL('../defaults/templates/', import.meta.url)
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()
  assert.equal(files.length, 4)
  assert.deepEqual(
    new Set(DEFAULT_TEMPLATES.map((t) => t.id)),
    new Set(files.map((n) => n.replace(/\.md$/, ''))),
  )
})

test('默认模板里不夹带私有梗', () => {
  const text = JSON.stringify(DEFAULT_TEMPLATES)
  for (const bad of ['虎鲸', '赛博', '本鱼', '老板', '诶嘿', '刷 B 站', 'ASR', '幼儿园']) {
    assert.ok(!text.includes(bad), `默认模板不该出现「${bad}」`)
  }
})

test('签发的票，正文 md5 与文件名一致', () => {
  const r = issue('奶茶券', 1, '给测试用', 'tester')
  assert.equal(r.ok, true)
  const card = r.cards[0]
  const body = fs.readFileSync(card.path, 'utf8')
  assert.equal(md5(body), card.serial)
  assert.equal(path.basename(card.path), `${card.type}-${card.serial}.md`)
  assert.equal(listCards().length, 1)
})

test('核销后票面追加消耗时间、文件保留、枚举跳过', () => {
  issue('奶茶券', 1, '', 'tester')
  const r = redeem('奶茶券', '拿去换了个东西', 1)
  assert.equal(r.ok, true)
  assert.equal(r.remaining, 0)
  assert.match(r.say, /已核销/)
  assert.equal(listCards().length, 0)
  const spent = listAll().spent
  assert.equal(spent.length, 1)
  assert.ok(fs.existsSync(spent[0].path))
  assert.match(fs.readFileSync(spent[0].path, 'utf8'), /消耗时间：/)
})

test('票面被改一个字就算已消耗', () => {
  const r = issue('奶茶券', 1, '', 'tester')
  const file = r.cards[0].path
  fs.appendFileSync(file, '\n偷偷改一下\n', 'utf8')
  assert.equal(listCards().length, 0)
  assert.equal(listAll().spent[0].mark.kind, 'modified')
})

test('账户校验：余额被改后兑换一律拒绝', () => {
  assert.equal(readCurrency().ok, true)
  assert.equal(addFunds(100, '测试充值').ok, true)
  const file = path.join(dir, `${CURRENCY_ID}.md`)
  const text = fs.readFileSync(file, 'utf8').replace('余额：100', '余额：999999')
  fs.writeFileSync(file, text)
  assert.equal(readCurrency().ok, false)
  const r = exchange('奶茶券', 1)
  assert.equal(r.ok, false)
  assert.match(r.error, /校验失败/)
})

test('兑换：先扣款再发卡，余额和票都对', () => {
  addFunds(1000, '测试充值')
  const r = exchange('奶茶券', 1, '测试兑换')
  assert.equal(r.ok, true)
  assert.equal(r.used, 100)
  assert.equal(r.balance, 900)
  assert.equal(listCards().length, 1)
  assert.match(r.say, /余额 900/)
})

test('兑换发卡失败：自动退回，-N / +N 两条流水都保留', () => {
  addFunds(1000, '测试充值')
  const original = fs.renameSync
  let n = 0
  fs.renameSync = (...args) => {
    n += 1
    if (n === 2) throw new Error('disk full')
    return original(...args)
  }
  try {
    const r = exchange('奶茶券', 1)
    assert.equal(r.ok, false)
    assert.match(r.error, /已退回/)
  } finally {
    fs.renameSync = original
  }
  const cur = readCurrency()
  assert.equal(cur.ok, true)
  assert.equal(cur.balance, 1000)
  assert.ok(cur.flows.some((f) => / -100$/.test(f)))
  assert.ok(cur.flows.some((f) => / \+100$/.test(f)))
  assert.equal(listCards().length, 0)
})

test('模板只能是卡券：currency 和账户名都拒绝保存', () => {
  assert.equal(saveTemplate({ id: '测试券', kind: 'currency', price: 1 }).ok, false)
  assert.equal(saveTemplate({ id: CURRENCY_ID, kind: 'card', price: 1 }).ok, false)
  assert.equal(saveTemplate({ id: '测试券', kind: 'card', price: 5 }).ok, true)
  assert.equal(templateOf('测试券').price, 5)
})

test('账户不能按张签发、兑换或核销', () => {
  assert.equal(issue(CURRENCY_ID, 1).ok, false)
  assert.equal(exchange(CURRENCY_ID, 1).ok, false)
  assert.equal(redeem(CURRENCY_ID, 'x', 1).ok, false)
})

test('署名人可用 DSH_WALLET_AGENT 覆盖，默认是中性名', () => {
  assert.equal(agentName(), 'agent')
  process.env.DSH_WALLET_AGENT = '小虎'
  assert.equal(agentName(), '小虎')
})
