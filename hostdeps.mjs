/**
 * hostdeps.mjs —— 从宿主那棵树里取 `@deepseek-ai/dsh-tools` 的 defineTool
 * ============================================================================
 * 为什么要有它：
 *   profile 里 `@deepseek-ai/dsh-tools` 往往是 optional peer，不一定被 hoist 到
 *   profile 的 node_modules 根上；裸 `import '@deepseek-ai/dsh-tools'` 可能让整条
 *   插件不激活（DSH 只留一句 "warning: 1 entry did not activate"）。
 *
 * 策略：
 *   ① 依次在候选根里找 dsh-tools 的入口（file:// URL）import；
 *   ② 找不到再试裸 import（万一 profile 某天 hoist 上来了）；
 *   ③ 还不行就用**本地等价实现**顶上 —— 只做结构检查，不做宿主编译，
 *      绝不因为一个 import 让整条插件不激活。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), 'node_modules', '@deepseek-ai')

/** 可能藏着宿主 `@deepseek-ai` 包的地方（按可能性排序，不写死某台机器） */
export function candidateRoots() {
  const out = []
  const push = (p) => {
    if (p && !out.includes(p)) out.push(p)
  }
  push(process.env.DSH_HOST_MODULES)

  // 当前 node 可执行文件所在的安装树：<prefix>/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
  try {
    const prefix = join(dirname(process.execPath), '..')
    push(join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    push(join(prefix, 'lib', 'node_modules', '@deepseek-ai'))
  } catch {
    /* ignore */
  }

  // 全局 npm 位置（含 nvm 的 $NVM_DIR/versions/node/*/lib/node_modules）
  for (const p of (process.env.NODE_PATH || '').split(':')) {
    if (p) push(join(p, '@deepseek-ai'))
  }
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/local/lib/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai')

  // profile 树：有的机器上被别的插件 hoist 到 profile 根
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch {
    /* ignore */
  }

  push(SELF_MODULES)
  return out
}

function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string' ? dot : dot?.import || dot?.default || pkg.module || pkg.main
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch {
    return null
  }
}

async function fromHostTree(name) {
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue
    const url = entryUrlFor(root, name)
    if (!url) continue
    try {
      return await import(url)
    } catch {
      /* 继续试下一个根 */
    }
  }
  return null
}

function localDefineTool(options) {
  const check = (schema, where) => {
    if (!schema || typeof schema !== 'object') return
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      throw new Error(`defineTool(${options.name}): ${where} 是 object 却没写 additionalProperties`)
    }
    for (const [k, v] of Object.entries(schema.properties || {})) check(v, `${where}.properties.${k}`)
  }
  check(options.parameters, 'parameters')
  if (!options?.output || !options.output.schema || typeof options.output.render !== 'function') {
    throw new TypeError(`defineTool(${options?.name}): output { schema, render } 缺失或非法`)
  }
  check(options.output.schema, 'output.schema')
  return options
}

/**
 * `@deepseek-ai/dsh-llm` 的 `createUserMessage`：票夹通知要用它造消息对象。
 * 拿不到就返回 null —— 通知是附赠功能，不能因为它让整条插件不激活。
 * @returns {Promise<Function|null>}
 */
async function loadCreateUserMessage() {
  let mod = await fromHostTree('dsh-llm')
  if (!mod) {
    try {
      mod = await import('@deepseek-ai/dsh-llm')
    } catch {
      mod = null
    }
  }
  return typeof mod?.createUserMessage === 'function' ? mod.createUserMessage : null
}

/** @returns {Promise<{defineTool:Function, createUserMessage:Function|null, notes:string[]}>} */
export async function loadHostDeps() {
  const notes = []
  const log = (m) => notes.push(m)
  let mod = await fromHostTree('dsh-tools')
  if (!mod) {
    try {
      mod = await import('@deepseek-ai/dsh-tools')
      log('dsh-tools：宿主树里没有，用裸 import 那份')
    } catch {
      log('dsh-tools：裸 import 也不行，用本地等价实现顶上')
      mod = null
    }
  }
  const createUserMessage = await loadCreateUserMessage()
  if (!createUserMessage) log('dsh-llm：宿主树里没有 createUserMessage，票夹通知会静默跳过')
  return { defineTool: mod?.defineTool || localDefineTool, createUserMessage, notes }
}
