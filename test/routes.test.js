/**
 * routes.test.js —— 面板路由的访问检查
 *
 * 这一组测试守的是「面板接口必须过宿主鉴权」这条线：
 *   ① 被拒绝的请求在碰任何状态之前就被回掉（签票、充值不许发生）；
 *   ② 拒绝码原样透传（403 来源不可信 / 401 未登录）；
 *   ③ 宿主没有 connection 服务时干脆一条路由都不装（fail closed）。
 */
import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { installWalletRoutes, rejectUnadmitted, walletRouteHandlers } from '../routes.mjs'
import { addFunds, listAll, listCards } from '../store.js'

const saved = {}
let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-coupon-routes-'))
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

/** 假的 connection：`x-test-reject` 请求头写多少就回多少（缺省放行）。 */
function fakeConnection(rejection) {
  return {
    calls: 0,
    requestRejection(req) {
      this.calls += 1
      const v = req && req.headers ? req.headers['x-test-reject'] : undefined
      return v === undefined ? rejection : Number(v)
    },
  }
}

function makeReq({ method = 'GET', headers = {}, body } = {}) {
  if (body === undefined) {
    return { method, headers, on() {}, destroy() {} }
  }
  const stream = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')])
  stream.method = method
  stream.headers = headers
  return stream
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(chunk) {
      if (chunk !== undefined) this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      this.done = true
    },
  }
  return res
}

function routeOf(connection, pathname) {
  const route = walletRouteHandlers(connection).find((r) => r.path === pathname)
  assert.ok(route, `没找到路由 ${pathname}`)
  return route
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

test('rejectUnadmitted：放行返回 false，拒绝返回 true 并回掉请求', () => {
  const allow = fakeConnection(undefined)
  const res1 = makeRes()
  assert.equal(rejectUnadmitted(allow, makeReq(), res1), false)
  assert.equal(res1.done, undefined)

  const deny = fakeConnection(403)
  const res2 = makeRes()
  assert.equal(rejectUnadmitted(deny, makeReq(), res2), true)
  assert.equal(res2.statusCode, 403)
  assert.match(JSON.parse(res2.body).error, /来源不可信/)
})

test('拒绝码透传：403 与 401 分别给出不同提示', () => {
  const res403 = makeRes()
  routeOf(fakeConnection(403), '/api/wallet/state').handler(makeReq(), res403)
  assert.equal(res403.statusCode, 403)

  const res401 = makeRes()
  routeOf(fakeConnection(401), '/api/wallet/state').handler(makeReq(), res401)
  assert.equal(res401.statusCode, 401)
  assert.match(JSON.parse(res401.body).error, /未登录/)
})

test('放行时 /api/wallet/state 正常返回快照', () => {
  const res = makeRes()
  routeOf(fakeConnection(undefined), '/api/wallet/state').handler(makeReq(), res)
  assert.equal(res.statusCode, 200)
  const snap = JSON.parse(res.body)
  assert.ok(snap.currency, '快照里应当有账户')
  assert.equal(snap.dir, path.resolve(dir))
})

test('被拒的 /api/wallet/action 不会签发任何票（检查在副作用之前）', async () => {
  const body = { action: 'issue', type: '奶茶券', count: 1, note: '被拒的请求' }
  const res = makeRes()
  routeOf(fakeConnection(403), '/api/wallet/action').handler(makeReq({ method: 'POST', body }), res)
  await tick()
  assert.equal(res.statusCode, 403)
  assert.equal(listCards().length, 0, '被拒的请求不该签发任何票')
  assert.equal(listAll().spent.length, 0)
})

test('被拒的充值不会动余额', async () => {
  addFunds(10, '起始')
  const body = { action: 'fund', amount: 9999, note: '被拒的充值' }
  const res = makeRes()
  routeOf(fakeConnection(401), '/api/wallet/action').handler(makeReq({ method: 'POST', body }), res)
  await tick()
  assert.equal(res.statusCode, 401)
  const state = makeRes()
  routeOf(fakeConnection(undefined), '/api/wallet/state').handler(makeReq(), state)
  assert.equal(JSON.parse(state.body).currency.balance, 10)
})

test('放行的 POST /api/wallet/action 签发成功并回快照', async () => {
  const body = { action: 'issue', type: '奶茶券', count: 1, note: '正常签发' }
  const res = makeRes()
  routeOf(fakeConnection(undefined), '/api/wallet/action').handler(makeReq({ method: 'POST', body }), res)
  await tick()
  assert.equal(res.statusCode, 200)
  const snap = JSON.parse(res.body)
  assert.equal(snap.cards.length, 1)
  assert.equal(listCards().length, 1)
})

test('放行但方法不对：/api/wallet/action 只收 POST', () => {
  const res = makeRes()
  routeOf(fakeConnection(undefined), '/api/wallet/action').handler(makeReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 405)
})

test('票样图也要过检查；放行时才吐 jpg', () => {
  const denied = makeRes()
  routeOf(fakeConnection(403), '/api/wallet/note').handler(makeReq(), denied)
  assert.equal(denied.statusCode, 403)

  const ok = makeRes()
  routeOf(fakeConnection(undefined), '/api/wallet/note').handler(makeReq(), ok)
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.headers['content-type'], 'image/jpeg')
  assert.match(ok.headers['cache-control'], /private/, '登录后才给的内容不该进共享缓存')
})

test('没有 webServer：不装路由、不报错', () => {
  const logs = []
  const dispose = installWalletRoutes({ webserver: undefined, connection: fakeConnection(undefined), log: (l, m) => logs.push([l, m]) })
  assert.equal(dispose, undefined)
  assert.match(logs.map((x) => x[1]).join('\n'), /no webserver/)
})

test('没有 connection：fail closed，一条路由都不装', () => {
  const registered = []
  const webserver = { register: (route) => registered.push(route.path) }
  const logs = []
  const dispose = installWalletRoutes({ webserver, connection: undefined, log: (l, m) => logs.push([l, m]) })
  assert.equal(dispose, undefined)
  assert.deepEqual(registered, [], '拿不到 requestRejection 就不该注册任何路由')
  assert.match(logs.map((x) => x[1]).join('\n'), /fail closed/)
})

test('有 connection 但没 requestRejection：同样 fail closed', () => {
  const registered = []
  const webserver = { register: (route) => registered.push(route.path) }
  const dispose = installWalletRoutes({ webserver, connection: {}, log: () => {} })
  assert.equal(dispose, undefined)
  assert.deepEqual(registered, [])
})

test('齐活时注册三条路由，dispose 全部撤掉', () => {
  const registered = []
  const disposed = []
  const webserver = {
    register: (route) => {
      registered.push(route.path)
      return () => disposed.push(route.path)
    },
  }
  const dispose = installWalletRoutes({ webserver, connection: fakeConnection(undefined), log: () => {} })
  assert.deepEqual(registered.sort(), ['/api/wallet/action', '/api/wallet/note', '/api/wallet/state'])
  dispose()
  assert.deepEqual(disposed.sort(), ['/api/wallet/action', '/api/wallet/note', '/api/wallet/state'])
})
