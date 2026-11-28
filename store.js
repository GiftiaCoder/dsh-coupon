/**
 * dsh-coupon · store —— 票夹 + 账户的纯文件层（不依赖 DSH / cordis，可单独跑测试）
 *
 * 目录：`$DSH_WALLET_DIR`（默认 `~/wallet/`）
 *
 *   templates/            票种模板（可自定义，加一个 md 就多一个票种）
 *     犯错卡.md 等        kind=card，价格写在模板头部
 *
 *  默认票种在 repo 的 defaults/templates/*.md，首次运行时由 ensureTemplates() 拷进票夹。
 *
 *   <票种>-<md5>.md       卡券：签发时把正文 md5 写进文件名；核销时追加时间，md5 失配即跳过
 *   鲸圆券.md             账户：余额 + 流水 + 校验（每次变动重算 md5 写回，文件不换名）
 *   ledger.jsonl          只追加的账本（面板时间线用，判断状态不依赖它）
 *
 * 账户不是模板：它由 currencyPath() 单独管，不进 templates/，也不出现在模板列表里。
 * 时间用本机时区。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex')

/** 账户名。改名等于换账户：旧文件文件名和校验都对不上，换名前先迁移。 */
export const CURRENCY_ID = String(process.env.DSH_WALLET_CURRENCY || '').trim() || '鲸圆券'

/** 花票/领票的名义主体：一台机器一个署名人（DSH_WALLET_AGENT） */
export function agentName() {
  const v = String(process.env.DSH_WALLET_AGENT || '').trim()
  return v || 'agent'
}
const CURRENCY_FILE = `${CURRENCY_ID}.md`
export const MAX_ISSUE = 20
export const MAX_REDEEM = 3
export const MAX_EXCHANGE = 10

/** 内置模板目录：repo 里的 defaults/templates/*.md —— 真文件，改文案不用动代码。 */
const DEFAULTS_DIR = fileURLToPath(new URL('./defaults/templates/', import.meta.url))

/**
 * 读默认模板文件（按文件名排序）。目录缺失就返回空数组：
 * 插件仍可用，只是新票夹里不预置票种。
 */
export function defaultTemplates() {
  let names = []
  try {
    names = fs.readdirSync(DEFAULTS_DIR).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }
  const out = []
  for (const name of names.sort()) {
    try {
      // 计价货币跟随账户名，改 DSH_WALLET_CURRENCY 时不会对不上
      const tpl = parseTemplateFile(path.join(DEFAULTS_DIR, name))
      out.push({ ...tpl, kind: 'card', currency: CURRENCY_ID })
    } catch {
      /* 坏文件跳过 */
    }
  }
  return out
}

/** 内置模板：首次运行由 ensureTemplates() 写到 templates/，已有同名文件不覆盖。 */
export const DEFAULT_TEMPLATES = defaultTemplates()

/** 票夹根目录 */
export function walletDir() {
  const dir = process.env.DSH_WALLET_DIR || path.join(os.homedir(), 'wallet')
  return path.resolve(dir)
}

export function templatesDir(dir = walletDir()) {
  return path.join(dir, 'templates')
}

export function currencyPath(dir = walletDir()) {
  return path.join(dir, CURRENCY_FILE)
}

export function ledgerPath(dir = walletDir()) {
  return path.join(dir, 'ledger.jsonl')
}

/** 本机时区的时间戳（票面和流水用） */
export function localNow(now = Date.now()) {
  const d = new Date(now)
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return {
    date,
    datetime: `${date} ${time}`,
    time,
    seq: `${date.replaceAll('-', '')}${time.replaceAll(':', '')}`,
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
}

// 进程内单调递增的签发计数器：同一毫秒连发也能排出先后（seq 写进票面、参与 md5）
let issueCounter = 0

// ───────────────────────────────── 模板 ─────────────────────────────────

function renderTemplateFile(t) {
  const lines = []
  lines.push('---')
  lines.push(`id: ${t.id}`)
  lines.push(`kind: ${t.kind}`)
  lines.push(`price: ${t.price}`)
  lines.push(`currency: ${t.currency}`)
  lines.push('---')
  lines.push('')
  lines.push(`# ${t.id}`)
  lines.push('')
  lines.push('## 用途')
  lines.push('')
  lines.push(t.blurb)
  lines.push('')
  if (t.rules.length > 0) {
    lines.push('## 规矩')
    lines.push('')
    for (const r of t.rules) lines.push(`- ${r}`)
    lines.push('')
  }
  if (t.exceptions.length > 0) {
    lines.push('## 不可使用')
    lines.push('')
    for (const e of t.exceptions) lines.push(`- ${e}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** 首次运行时把内置模板写盘；已有文件绝不覆盖（改价/改字以后以文件为准） */
export function ensureTemplates(dir = walletDir()) {
  const tdir = templatesDir(dir)
  ensureDir(tdir)
  for (const t of DEFAULT_TEMPLATES) {
    const file = path.join(tdir, `${t.id}.md`)
    if (!fs.existsSync(file)) fs.writeFileSync(file, renderTemplateFile(t), { mode: 0o644 })
  }
}

function parseSection(body, title) {
  const re = new RegExp(`(?:^|\\n)## ${title}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`)
  const m = re.exec(body)
  if (!m) return ''
  return m[1].trim()
}

function parseTemplateFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  const meta = {}
  let body = text
  if (fm) {
    body = text.slice(fm[0].length)
    for (const line of fm[1].split('\n')) {
      const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim())
      if (m) meta[m[1]] = m[2].trim()
    }
  }
  const h1 = /^#\s+(.+)$/m.exec(body)
  const id = (meta.id || (h1 ? h1[1].trim() : path.basename(file, '.md'))).trim()
  const kind = meta.kind === 'currency' ? 'currency' : 'card'
  const price = Number(meta.price ?? 0)
  const list = (title) =>
    parseSection(body, title)
      .split('\n')
      .map((s) => s.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
  return {
    id,
    kind,
    price: Number.isFinite(price) && price >= 0 ? price : 0,
    currency: meta.currency || CURRENCY_ID,
    group: (meta.group || '').trim(),
    blurb: parseSection(body, '用途') || '',
    rules: list('规矩'),
    exceptions: list('不可使用'),
    file,
  }
}

/** 读全部模板（不存在就先写内置的）；账户（鲸圆券）不是模板，永远不在这里出现 */
export function loadTemplates(dir = walletDir()) {
  const tdir = templatesDir(dir)
  ensureDir(dir)
  ensureTemplates(dir)
  const out = []
  for (const name of fs.readdirSync(tdir)) {
    if (!name.endsWith('.md')) continue
    if (name === CURRENCY_FILE) continue // 旧版遗留的账户模板文件：不列、不管
    try {
      const tpl = parseTemplateFile(path.join(tdir, name))
      if (tpl.id === CURRENCY_ID) continue
      out.push(tpl)
    } catch {
      /* 坏模板跳过 */
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

export function templateOf(id, dir = walletDir()) {
  return loadTemplates(dir).find((t) => t.id === id)
}

/**
 * 保存模板（面板编辑用）：按统一格式写 templates/<id>.md。
 * @returns {{ok:true,id:string}|{ok:false,error:string}}
 */
export function saveTemplate(t) {
  const id = String(t?.id ?? '').trim()
  if (!id) return { ok: false, error: '模板 id 不能为空' }
  if (id.length > 40) return { ok: false, error: '模板 id 最多 40 个字' }
  if (/[\\/]/.test(id) || id === '.' || id === '..') return { ok: false, error: '模板 id 不能包含路径分隔符' }
  const dir = walletDir()
  const tdir = templatesDir(dir)
  ensureDir(tdir)
  if (id === CURRENCY_ID) {
    return { ok: false, error: `${CURRENCY_ID} 是票夹账户，不走模板；充值请用面板的「签发」` }
  }
  if (t.kind === 'currency') {
    return { ok: false, error: `票夹只有一个账户（${CURRENCY_ID}），模板只能是卡券（kind: card）` }
  }
  const kind = 'card'
  const file = path.join(tdir, `${id}.md`)
  const price = Math.floor(Number(t.price) || 0)
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: `价格必须是非负整数（${CURRENCY_ID}）` }
  if (price > 1000000000) return { ok: false, error: '价格太大了' }
  const norm = (v) =>
    Array.isArray(v)
      ? v.map((x) => String(x ?? '').trim()).filter(Boolean)
      : String(v ?? '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
  const tpl = {
    id,
    kind,
    price,
    currency: String(t.currency ?? CURRENCY_ID).trim() || CURRENCY_ID,
    blurb: String(t.blurb ?? '').trim(),
    rules: norm(t.rules),
    exceptions: norm(t.exceptions),
  }
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, renderTemplateFile(tpl), { mode: 0o644 })
  fs.renameSync(tmp, file)
  return { ok: true, id }
}

/** 删除一个模板文件（票面/账户不受影响）。 */
export function deleteTemplate(id) {
  const name = String(id ?? '').trim()
  if (!name) return { ok: false, error: '缺少模板 id' }
  if (/[\\/]/.test(name) || name === '.' || name === '..') return { ok: false, error: '非法模板 id' }
  const file = path.join(templatesDir(), `${name}.md`)
  if (!fs.existsSync(file)) return { ok: false, error: `模板不存在：${name}` }
  fs.unlinkSync(file)
  return { ok: true, id: name }
}

// ───────────────────────────────── 账户（鲸圆券） ─────────────────────────────────

function renderCurrency(balance, flows) {
  const fingerprint = md5(`${CURRENCY_ID}|${balance}|${flows.join('\n')}`)
  const lines = []
  lines.push(`# ${CURRENCY_ID}`)
  lines.push('')
  lines.push('```')
  lines.push(`余额：${balance}`)
  lines.push(`校验：${fingerprint}`)
  lines.push('```')
  lines.push('')
  lines.push('## 流水')
  lines.push('')
  for (const f of flows) lines.push(`- ${f}`)
  if (flows.length === 0) lines.push('- （还没有流水）')
  lines.push('')
  return lines.join('\n')
}

function parseCurrency(text) {
  const balanceHit = /余额：(-?\d+)/.exec(text)
  const checkHit = /校验：([0-9a-f]{32})/.exec(text)
  const flowBlock = /## 流水\s*\n([\s\S]*?)$/.exec(text)
  const flows = (flowBlock ? flowBlock[1] : '')
    .split('\n')
    .map((s) => s.replace(/^-\s*/, '').trim())
    .filter((s) => s && s !== '（还没有流水）')
  const balance = balanceHit ? Number(balanceHit[1]) : 0
  const expect = md5(`${CURRENCY_ID}|${balance}|${flows.join('\n')}`)
  return { balance, flows, ok: checkHit ? checkHit[1] === expect : false }
}

/** 读账户；文件不存在则以 0 余额初始化并落盘 */
export function readCurrency(dir = walletDir()) {
  ensureDir(dir)
  const file = currencyPath(dir)
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, renderCurrency(0, []), { mode: 0o644 })
    return { balance: 0, flows: [], ok: true, path: file }
  }
  const parsed = parseCurrency(fs.readFileSync(file, 'utf8'))
  return { ...parsed, path: file }
}

/** 写账户：重算 md5 封账，原子替换 */
function writeCurrency(balance, flows, dir = walletDir()) {
  const file = currencyPath(dir)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, renderCurrency(balance, flows), { mode: 0o644 })
  fs.renameSync(tmp, file)
  appendLedger({ at: new Date().toISOString(), event: 'balance', type: CURRENCY_ID, balance })
}

/**
 * 签发鲸圆券 = 充值（面板或审批通过后调用）。
 * @returns {{ok:true,balance:number}|{ok:false,error:string}}
 */
export function addFunds(amount, note = '', issuer = '用户') {
  const n = Math.floor(Number(amount))
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: '充值金额必须是正整数' }
  const cur = readCurrency()
  const flows = [...cur.flows, `${localNow().datetime} ${issuer} 签发 +${n}${note ? `（${note}）` : ''}`]
  writeCurrency(cur.balance + n, flows)
  return { ok: true, balance: cur.balance + n }
}

/** 扣款（内部用；调用方先校验余额）。负数即退回，流水按符号写 +N / -N */
function spendFunds(amount, note) {
  const cur = readCurrency()
  const sign = amount >= 0 ? '-' : '+'
  const flows = [...cur.flows, `${localNow().datetime} ${note} ${sign}${Math.abs(amount)}`]
  writeCurrency(cur.balance - amount, flows)
  return cur.balance - amount
}

/**
 * 退回：把扣掉的钱还回去（业务上是「没成交」，不是错账冲正）。
 * 仅用于「扣款已成功、发卡失败」的补偿路径，所以自己不再抛异常——
 * 抛出去只会让调用方拿不到失败原因，账户也不会变好。
 * @returns {boolean} 是否真的退回去了
 */
function refundFunds(amount, note) {
  try {
    spendFunds(-amount, note)
    return true
  } catch {
    return false
  }
}

// ───────────────────────────────── 卡券 ─────────────────────────────────

const FILE_RE = /^(.+?)-([0-9a-f]{32})\.md$/

function cardBody(tpl, issuedAt, seq, nonce, note, issuer, price, source) {
  const lines = []
  lines.push(`# ${tpl.id}`)
  lines.push('')
  lines.push('```')
  lines.push(`类型：${tpl.id}`)
  lines.push(`价格：${price} ${tpl.currency}`)
  lines.push(`签发：${issuer}`)
  lines.push(`签发时间：${issuedAt}`)
  lines.push(`签发序号：${seq}`)
  lines.push(`防伪码：${nonce}`)
  if (note) lines.push(`备注：${note}`)
  if (source) lines.push(`来源：${source}`)
  lines.push('状态：未使用')
  lines.push('```')
  lines.push('')
  lines.push('## 用途')
  lines.push('')
  lines.push(tpl.blurb)
  lines.push('')
  if (tpl.rules.length > 0) {
    lines.push('## 规矩')
    lines.push('')
    for (const r of tpl.rules) lines.push(`- ${r}`)
    lines.push('')
  }
  if (tpl.exceptions.length > 0) {
    lines.push('## 不可使用（例外）')
    lines.push('')
    for (const e of tpl.exceptions) lines.push(`- ${e}`)
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('> 本票的 md5 与文件名绑定，票面一改即视为已消耗。')
  lines.push('> 核销会追加消耗时间；文件保留，用于对账。')
  lines.push('')
  return lines.join('\n')
}

function parseCard(dir, name) {
  const m = FILE_RE.exec(name)
  if (!m) return null
  const [, type, hash] = m
  const full = path.join(dir, name)
  let text
  try {
    text = fs.readFileSync(full, 'utf8')
  } catch {
    return null
  }
  let mtime = 0
  try {
    mtime = fs.statSync(full).mtimeMs
  } catch {
    mtime = 0
  }
  const current = md5(text)
  const valid = current === hash
  const grab = (re) => {
    const hit = re.exec(text)
    return hit ? hit[1].trim() : ''
  }
  const consumed = grab(/消耗时间：(.+)/)
  const voided = grab(/作废时间：(.+)/)
  return {
    id: name,
    serial: hash,
    short: hash.slice(0, 8),
    type,
    md5: hash,
    currentMd5: current,
    valid,
    mark: voided ? { kind: 'voided', at: voided } : consumed ? { kind: 'consumed', at: consumed } : valid ? null : { kind: 'modified', at: '' },
    issuedAt: grab(/签发时间：(.+)/),
    seq: grab(/签发序号：(\d+)/),
    note: grab(/备注：(.+)/),
    what: grab(/事由：(.+)/),
    price: Number(grab(/价格：(\d+)/)) || 0,
    source: grab(/来源：(.+)/),
    path: full,
    mtime,
  }
}

export function listAll(dir = walletDir()) {
  ensureDir(dir)
  const valid = []
  const spent = []
  for (const name of fs.readdirSync(dir)) {
    const card = parseCard(dir, name)
    if (!card) continue
    if (card.valid) valid.push(card)
    else spent.push(card)
  }
  valid.sort((a, b) => (a.seq || '').localeCompare(b.seq || '') || a.mtime - b.mtime)
  spent.sort((a, b) => String(b.mark?.at || '').localeCompare(String(a.mark?.at || '')))
  return { valid, spent }
}

export function listCards(dir = walletDir()) {
  return listAll(dir).valid
}

/**
 * 签发卡券（面板签发 / 兑换发）。价格按模板当前价快照进票面。
 * @returns {{ok:true,cards:object[]}|{ok:false,error:string}}
 */
export function issue(templateId, count = 1, note = '', issuer = '用户', opts = {}) {
  if (templateId === CURRENCY_ID) return { ok: false, error: `${CURRENCY_ID} 是账户，请用充值（签发）接口，不按张发` }
  const tpl = templateOf(templateId)
  if (!tpl) return { ok: false, error: `不认识的票据模板：${templateId}` }
  if (tpl.kind === 'currency') return { ok: false, error: `「${tpl.id}」被标成了 currency；模板只能是卡券（kind: card）` }
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: '张数必须 ≥ 1' }
  if (n > MAX_ISSUE) return { ok: false, error: `一次最多签发 ${MAX_ISSUE} 张` }

  const dir = walletDir()
  ensureDir(dir)
  const price = opts.price ?? tpl.price
  const source = opts.source || ''
  const cards = []
  for (let i = 0; i < n; i += 1) {
    const nonce = randomBytes(6).toString('hex')
    const now = localNow()
    const issuedAt = now.datetime
    const seq = `${now.seq}${String(issueCounter++ % 10000).padStart(4, '0')}`
    const body = cardBody(tpl, issuedAt, seq, nonce, note, issuer, price, source)
    const hash = md5(body)
    const file = path.join(dir, `${tpl.id}-${hash}.md`)
    const tmp = path.join(dir, `.${tpl.id}-${hash}.md.tmp`)
    fs.writeFileSync(tmp, body, { mode: 0o644 })
    fs.renameSync(tmp, file)
    cards.push({ id: path.basename(file), serial: hash, short: hash.slice(0, 8), type: tpl.id, issuedAt, date: issuedAt.slice(0, 10), seq, note, price, path: file })
  }
  appendLedger({ at: new Date().toISOString(), event: 'issue', type: tpl.id, count: n, note, serials: cards.map((c) => c.serial) })
  return { ok: true, cards }
}

/**
 * 用鲸圆券兑换卡券：先扣款、再发卡；发卡失败自动退回。
 * @returns {{ok:true,used:number,balance:number,cards:object[],say:string}|{ok:false,error:string}}
 */
export function exchange(templateId, count = 1, note = '') {
  if (templateId === CURRENCY_ID) return { ok: false, error: `${CURRENCY_ID} 是账户，不能按张兑换` }
  const tpl = templateOf(templateId)
  if (!tpl) return { ok: false, error: `不认识的票据模板：${templateId}` }
  if (tpl.kind === 'currency') return { ok: false, error: `「${tpl.id}」被标成了 currency；模板只能是卡券（kind: card）` }
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: '张数必须 ≥ 1' }
  if (n > MAX_EXCHANGE) return { ok: false, error: `一次最多兑换 ${MAX_EXCHANGE} 张` }
  const price = Number(tpl.price) || 0
  const total = price * n
  const cur = readCurrency()
  if (!cur.ok) return { ok: false, error: `${CURRENCY_ID}账户校验失败（余额或流水被动过），兑换拒绝` }
  if (total > 0 && cur.balance < total) {
    return { ok: false, error: `${CURRENCY_ID}不够：需要 ${total}，账户只有 ${cur.balance}` }
  }
  if (total > 0) spendFunds(total, `兑换 ${n} 张「${tpl.id}」`)

  // 发卡这一步会写盘：磁盘满、目录只读、模板 id 带路径分隔符……都可能直接抛异常。
  // 抛出去就等于「钱扣了、票没发、也没退」——所以这里必须兜住，把补偿做掉再报错。
  let issued
  try {
    issued = issue(tpl.id, n, note, `${agentName()}（${CURRENCY_ID}兑换）`, { price, source: `${CURRENCY_ID}兑换 · ${localNow().datetime}` })
  } catch (e) {
    const detail = e && e.message ? e.message : String(e)
    if (total <= 0) return { ok: false, error: `发卡异常：${detail}` }
    const refunded = refundFunds(total, `退回 · 兑换「${tpl.id}」（发卡异常）`)
    return refunded
      ? { ok: false, error: `发卡异常，已退回 ${total} ${CURRENCY_ID}：${detail}` }
      : { ok: false, error: `发卡异常，且退回也失败（余额可能已不一致，请人工核对）：${detail}` }
  }
  if (!issued.ok) {
    if (total <= 0) return { ok: false, error: issued.error }
    const refunded = refundFunds(total, `退回 · 兑换「${tpl.id}」（发卡失败）`)
    return refunded
      ? { ok: false, error: `${issued.error}（已退回 ${total} ${CURRENCY_ID}）` }
      : { ok: false, error: `${issued.error}（退回也失败，余额可能已不一致，请人工核对）` }
  }
  appendLedger({ at: new Date().toISOString(), event: 'exchange', type: tpl.id, count: n, total, note })
  const balance = readCurrency().balance
  return { ok: true, used: total, balance, cards: issued.cards, say: `兑换 ${n} 张「${tpl.id}」，花掉 ${total} ${CURRENCY_ID}，余额 ${balance}。` }
}

/** 核销：追加消耗时间，文件保留；枚举按 md5 跳过。 */
export function redeem(templateId, what = '', count = 1) {
  if (templateId === CURRENCY_ID) return { ok: false, error: `${CURRENCY_ID} 是账户，没有可核销的票` }
  const tpl = templateOf(templateId)
  if (!tpl) return { ok: false, error: `不认识的票据模板：${templateId}` }
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: '张数必须 ≥ 1' }
  if (n > MAX_REDEEM) return { ok: false, error: `一次最多核销 ${MAX_REDEEM} 张` }

  const cards = listCards().filter((c) => c.type === tpl.id)
  if (cards.length < n) return { ok: false, error: `${tpl.id}不够：手里只有 ${cards.length} 张，要花 ${n} 张` }
  const used = cards.slice(0, n)
  const stamp = localNow().datetime
  try {
    for (const card of used) {
      const block = ['', '## 使用记录', '', `- 消耗时间：${stamp}`, ...(what ? [`- 事由：${what}`] : []), ''].join('\n')
      fs.appendFileSync(card.path, block, 'utf8')
    }
  } catch (e) {
    return { ok: false, error: `追加消耗记录失败：${e && e.message ? e.message : e}` }
  }
  const remaining = listCards().filter((c) => c.type === tpl.id).length
  const say = `已核销。（${tpl.id} -${n}，剩 ${remaining} 张）`
  appendLedger({ at: new Date().toISOString(), event: 'redeem', type: tpl.id, count: n, what, serials: used.map((c) => c.serial), remaining })
  return { ok: true, used: used.map((c) => c.serial), remaining, say }
}

/** 作废：追加作废时间，文件保留。返回值带上票种/票号/原票备注，通知用得上。 */
export function trash(serial) {
  const { valid } = listAll()
  const card = valid.find((c) => c.serial === serial || c.id === serial || c.short === serial)
  if (!card) return { ok: false, error: `没有这张可用票：${serial}` }
  try {
    const block = ['', '## 作废记录', '', `- 作废时间：${localNow().datetime}`, ''].join('\n')
    fs.appendFileSync(card.path, block, 'utf8')
  } catch (e) {
    return { ok: false, error: `作废失败：${e && e.message ? e.message : e}` }
  }
  appendLedger({ at: new Date().toISOString(), event: 'trash', type: card.type, serials: [card.serial] })
  return { ok: true, serial: card.serial, short: card.short, type: card.type, note: card.note || '' }
}

function appendLedger(entry) {
  const dir = walletDir()
  ensureDir(dir)
  fs.appendFileSync(ledgerPath(dir), `${JSON.stringify(entry)}\n`, { mode: 0o644 })
}

export function recentLedger(limit = 20) {
  const file = ledgerPath()
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const out = []
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    try {
      out.push(JSON.parse(lines[i]))
    } catch {
      /* 坏行跳过 */
    }
  }
  return out
}

/** 面板 / 工具共用的完整快照。 */
export function snapshot() {
  const { valid, spent } = listAll()
  const cur = readCurrency()
  const templates = loadTemplates().map((t) => ({
    id: t.id,
    kind: t.kind,
    price: t.price,
    currency: t.currency,
    group: t.group,
    blurb: t.blurb,
    rules: t.rules,
    exceptions: t.exceptions,
    count: t.kind === 'currency' ? 0 : valid.filter((c) => c.type === t.id).length,
  }))
  return {
    ok: true,
    dir: walletDir(),
    templatesDir: templatesDir(),
    currency: { id: CURRENCY_ID, balance: cur.balance, ok: cur.ok, flows: cur.flows.slice(-12) },
    templates,
    cards: valid.map((c) => ({ id: c.id, serial: c.serial, short: c.short, type: c.type, date: c.issuedAt.slice(0, 10), issuedAt: c.issuedAt, note: c.note, price: c.price })),
    spent: spent.map((c) => ({ id: c.id, serial: c.serial, short: c.short, type: c.type, issuedAt: c.issuedAt, note: c.note, mark: c.mark })),
    ledger: recentLedger(20),
  }
}
