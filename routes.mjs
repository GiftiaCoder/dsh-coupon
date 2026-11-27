/**
 * routes.mjs —— 面板的三条 HTTP 路由
 *
 * 安全有一个家，就在这个文件里：每条 handler 动手之前先问一次宿主 composition 的
 * `connection` 服务（`requestRejection(req)`）。它做两件事：
 *   ① Host / Origin 围栏：挡掉 DNS rebinding 和跨站调用（`Origin` 与 `Host` 不一致、
 *      或 `Sec-Fetch-Site: cross-site` 的一律 403）；
 *   ② 浏览器登录态：DSH Web 的登录 cookie 缺失或过期 → 401。
 * 这是 DSH 自带 Web 插件（如 `open-in-app`）的同一套做法；不接这一层，面板接口就等于
 * 绕过了宿主鉴权——浏览器里开着的任何页面都能 POST `/api/wallet/action` 去签票、充值。
 *
 * 宿主没给 `connection`（老版本或非 Web composition）时，`installWalletRoutes` 选择
 * **fail closed**：一条路由都不装，面板自己消失，既不冒风险也不假装安全。
 */
import fs from 'node:fs'

import { addFunds, deleteTemplate, issue, saveTemplate, snapshot, trash } from './store.js'

const BODY_MAX_BYTES = 64 * 1024
const NOTE_FILE = new URL('./assets/note.jpg', import.meta.url)
let noteCache = null

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** 拒绝码 → 面板上能看懂的一句话。 */
function rejectionMessage(code) {
  if (code === 401) return '未登录：请先在 DSH 页面登录，再打开票夹'
  return '请求被拒绝：来源不可信（Host / Origin 不在宿主的信任列表里）'
}

/**
 * 宿主访问检查。返回 true 表示这个请求已经被回掉了，handler 必须立刻 return。
 * `connection` 必须是带 `requestRejection` 的那个宿主服务（由 installWalletRoutes 保证）。
 */
export function rejectUnadmitted(connection, req, res) {
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  sendJson(res, rejection, { ok: false, error: rejectionMessage(rejection) })
  return true
}

/** 票夹面板的三条路由；每个 handler 第一句都是访问检查。 */
export function walletRouteHandlers(connection) {
  const denied = (req, res) => rejectUnadmitted(connection, req, res)

  return [
    // 票样图片：面板里「账户」那一栏用；文件缺失时返回 404，不影响其它功能。
    // 图片同样要过检查——否则未登录的人也能把票面拉走（虽然只是张配图）。
    {
      kind: 'exact',
      path: '/api/wallet/note',
      handler: (req, res) => {
        if (denied(req, res)) return
        try {
          if (!noteCache) noteCache = fs.readFileSync(NOTE_FILE)
          res.writeHead(200, {
            'content-type': 'image/jpeg',
            'cache-control': 'private, max-age=86400',
            'content-length': noteCache.length,
          })
          res.end(noteCache)
        } catch (e) {
          sendJson(res, 404, { ok: false, error: `票样图片缺失：${e && e.message ? e.message : e}` })
        }
      },
    },

    {
      kind: 'exact',
      path: '/api/wallet/state',
      handler: (req, res) => {
        if (denied(req, res)) return
        try {
          sendJson(res, 200, snapshot())
        } catch (e) {
          sendJson(res, 500, { ok: false, error: e && e.message ? e.message : String(e) })
        }
      },
    },

    {
      kind: 'exact',
      path: '/api/wallet/action',
      handler: (req, res) => {
        // 先过人再看方法：被拒的请求连 405 都不给它，直接 401/403。
        if (denied(req, res)) return
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'POST only' })
          return
        }
        readBody(req, BODY_MAX_BYTES)
          .then((body) => {
            const action = typeof body['action'] === 'string' ? body['action'] : ''
            let result
            if (action === 'issue') {
              const type = typeof body['type'] === 'string' ? body['type'] : ''
              const count = Number(body['count'] ?? 1)
              const note = typeof body['note'] === 'string' ? body['note'].slice(0, 200) : ''
              result = issue(type, count, note)
            } else if (action === 'trash') {
              const serial = typeof body['serial'] === 'string' ? body['serial'] : ''
              result = trash(serial)
            } else if (action === 'fund') {
              const amount = Number(body['amount'] ?? 0)
              const note = typeof body['note'] === 'string' ? body['note'].slice(0, 200) : ''
              result = addFunds(amount, note)
            } else if (action === 'exchange') {
              // 账户余额是 agent 自己的钱，面板不给人类开兑换口子；要兑什么让 agent 用 wallet_exchange。
              result = { ok: false, error: '面板不提供兑换：账户余额只能由 agent 用 wallet_exchange 工具花' }
            } else if (action === 'template_save') {
              result = saveTemplate({
                id: body['id'],
                kind: body['kind'],
                price: body['price'],
                currency: body['currency'],
                blurb: body['blurb'],
                rules: body['rules'],
                exceptions: body['exceptions'],
              })
            } else if (action === 'template_delete') {
              result = deleteTemplate(body['id'])
            } else {
              result = { ok: false, error: `unknown action: ${action}` }
            }
            sendJson(res, result.ok ? 200 : 400, result.ok ? snapshot() : result)
          })
          .catch((e) => sendJson(res, 400, { ok: false, error: e && e.message ? e.message : String(e) }))
      },
    },
  ]
}

/**
 * 把三条路由挂到宿主 `webServer` 上。
 * - 没有 `webServer`（headless / CLI 宿主）：不装路由，工具照常可用。
 * - 没有可用的 `connection`：不装路由（fail closed），并留一条 warn。
 * @returns 撤销函数，或 undefined（什么都没装）。
 */
export function installWalletRoutes({ webserver, connection, log }) {
  if (!webserver) {
    log?.('info', 'dsh-coupon: no webserver composed; wallet panel routes not installed.')
    return undefined
  }
  if (!connection || typeof connection.requestRejection !== 'function') {
    log?.(
      'warn',
      'dsh-coupon: host has no connection.requestRejection(); wallet panel routes not installed (fail closed). ' +
        'Upgrade DSH or use the wallet tools instead of the panel.',
    )
    return undefined
  }
  const disposers = walletRouteHandlers(connection).map((route) => webserver.register(route))
  return () => {
    for (const d of disposers) d()
  }
}
