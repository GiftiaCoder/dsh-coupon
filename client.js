/**
 * dsh-coupon —— 浏览器半边（「设置」里的一页：票夹）
 *
 * 模板（可自定义）+ 账户（余额/流水/md5 封账）+ 兑换
 *
 * ⭐ client bundle 是自注册脚本（不是 ESM）：
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 * ⭐ 进「设置」用 settings.section 插槽（label 就是左侧导航那一项）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-coupon',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/wallet'

    const CSS = `
[data-wallet-page]{display:flex;flex-direction:column;gap:14px;padding:0 2px 8px;max-width:780px;}
[data-wallet-head]{display:flex;align-items:center;gap:10px;}
[data-wallet-title]{display:flex;flex-direction:column;gap:2px;}
[data-wallet-title] b{font-size:17px;letter-spacing:.02em;}
[data-wallet-title] span{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-wallet-origin]{font-size:10px!important;opacity:.55;line-height:14px;}
[data-wallet-spacer]{flex:1;}
[data-wallet-btn]{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:var(--dsw-alias-bg-l1,transparent);
  color:inherit;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s;}
[data-wallet-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));}
[data-wallet-btn][data-primary]{background:#f0a500;border-color:#f0a500;color:#241a05;font-weight:600;}
[data-wallet-btn][data-primary]:hover{background:#ffb703;}
[data-wallet-btn][data-pay]{border-color:#0ea5e9;color:#0ea5e9;}
[data-wallet-btn][data-pay]:hover{background:rgba(14,165,233,.1);}
[data-wallet-btn]:disabled{opacity:.42;cursor:default;}
[data-wallet-sec]{display:flex;flex-direction:column;gap:8px;}
[data-wallet-h]{font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary,#9aa0a6);text-transform:uppercase;}
[data-wallet-money]{display:flex;align-items:baseline;gap:10px;border:1px solid rgba(240,165,0,.38);border-radius:14px;
  padding:12px 14px;background:linear-gradient(135deg,rgba(255,183,3,.14),rgba(255,183,3,.03) 55%,transparent);}
[data-wallet-money] .big{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;}
[data-wallet-money] .unit{font-size:12px;font-weight:600;opacity:.7;}
[data-wallet-money] .bad{font-size:10px;color:#e5484d;}
[data-wallet-money] .grow{flex:1;}
[data-wallet-note]{display:block;width:100%;max-width:420px;border-radius:12px;border:1px solid rgba(240,165,0,.28);}
[data-wallet-fold]{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer;}
[data-wallet-caret]{font-size:10px;opacity:.6;}
[data-wallet-fund]{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
[data-wallet-tpls]{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;}
[data-wallet-tpl]{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));border-radius:12px;padding:12px 14px;
  display:flex;flex-direction:column;gap:5px;background:linear-gradient(160deg,rgba(14,165,233,.05),transparent 60%);}
[data-wallet-tpl] .name{font-size:14px;font-weight:700;}
[data-wallet-tpl] .meta{font-size:10px;opacity:.65;display:flex;gap:8px;align-items:center;}
[data-wallet-tpl] .price{font-size:12px;font-weight:600;color:#b7791f;}
[data-wallet-tpl] .blurb{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-wallet-tpl] .ops{display:flex;gap:8px;margin-top:auto;flex-wrap:wrap;}
[data-wallet-form]{display:flex;flex-wrap:wrap;gap:8px;align-items:center;border:1px dashed var(--dsw-alias-border-l1,rgba(128,128,128,.3));
  border-radius:12px;padding:12px;}
[data-wallet-form] select,[data-wallet-form] input{font:inherit;font-size:12px;color:inherit;background:var(--dsw-alias-bg-l1,transparent);
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:8px;padding:6px 8px;outline:none;}
[data-wallet-form] select:focus,[data-wallet-form] input:focus{border-color:#f0a500;}
[data-wallet-form] input[type=number]{width:76px;}
[data-wallet-form] input[data-note]{flex:1;min-width:140px;}
[data-wallet-wall]{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;}
[data-wallet-stub]{position:relative;border-radius:10px;padding:12px 14px 12px 30px;
  border:1px solid rgba(240,165,0,.4);background:linear-gradient(150deg,rgba(255,183,3,.10),rgba(255,183,3,.02) 55%,transparent);
  overflow:hidden;}
[data-wallet-stub]:before{content:'';position:absolute;left:14px;top:0;bottom:0;border-left:1px dashed rgba(240,165,0,.45);}
[data-wallet-stub]:after{content:'';position:absolute;right:-6px;top:50%;width:12px;height:12px;border-radius:50%;
  transform:translateY(-50%);background:var(--dsw-alias-bg-l0,#1b1b1f);border:1px solid rgba(240,165,0,.4);}
[data-wallet-stub] .s{font-size:10px;letter-spacing:.08em;opacity:.65;font-variant-numeric:tabular-nums;}
[data-wallet-stub] .t{font-size:14px;font-weight:700;margin:3px 0 2px;}
[data-wallet-stub] .d{font-size:10px;opacity:.6;}
[data-wallet-stub] .p{font-size:10px;color:#b7791f;}
[data-wallet-stub] .note{font-size:10px;line-height:14px;margin-top:6px;opacity:.75;}
[data-wallet-stub] .ops{margin-top:8px;}
[data-wallet-stub] .ops button{font-size:10px;border:0;background:none;color:var(--dsw-alias-label-tertiary,#9aa0a6);cursor:pointer;padding:0;}
[data-wallet-stub] .ops button:hover{color:#e5484d;}
[data-wallet-stub][data-spent]{opacity:.58;border-color:rgba(128,128,128,.32);background:rgba(128,128,128,.05);}
[data-wallet-stub][data-spent]:before{border-left-color:rgba(128,128,128,.35);}
[data-wallet-stub][data-spent]:after{border-color:rgba(128,128,128,.35);}
[data-wallet-empty]{font-size:12px;opacity:.55;padding:10px 0;}
[data-wallet-rules]{border-radius:12px;padding:10px 14px;background:rgba(128,128,128,.06);font-size:11px;line-height:18px;}
[data-wallet-rules] ul{margin:4px 0 0;padding-left:18px;}
[data-wallet-ledger]{display:flex;flex-direction:column;gap:4px;font-size:11px;}
[data-wallet-ledger] .row{display:flex;gap:10px;align-items:baseline;opacity:.8;}
[data-wallet-ledger] .row .when{width:78px;flex:none;opacity:.6;font-variant-numeric:tabular-nums;}
[data-wallet-ledger] .row .what{flex:1;}
[data-wallet-flash]{font-size:11px;color:#2f9e44;min-height:14px;}
[data-wallet-flash][data-err]{color:#e5484d;}
[data-wallet-egg]{flex:none;filter:drop-shadow(0 2px 4px rgba(240,165,0,.25));}
[data-wallet-note]{font-size:10px;line-height:14px;opacity:.55;}
[data-wallet-editor]{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:12px;padding:12px;}
[data-wallet-editor] textarea{width:100%;box-sizing:border-box;font:inherit;font-size:12px;color:inherit;background:var(--dsw-alias-bg-l1,transparent);
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:8px;padding:8px;outline:none;resize:vertical;min-height:56px;}
[data-wallet-editor] textarea:focus{border-color:#f0a500;}
[data-wallet-editor] input:disabled{opacity:.6;}
`

    function Egg(size) {
      return h(
        'span',
        { 'data-wallet-egg': '' },
        h(
          'svg',
          { viewBox: '0 0 64 64', width: size || 46, height: size || 46, 'aria-hidden': 'true' },
          h('path', {
            d: 'M31 8.5c7.5-.4 14.6 3.2 19 9.4 4.2 5.9 5 13.4 2.4 20-2.4 6.2-8.1 11-14.6 12.6-6.3 1.6-13.2.2-18.2-3.9C14.4 41.9 11.6 36.2 11.4 30c-.2-6 2.6-11.8 7.4-15.4 3.5-2.6 7.8-4.4 12.2-6.1Z',
            fill: '#fffdf6',
            stroke: '#f0e2bd',
            strokeWidth: '1.6',
          }),
          h('path', {
            d: 'M20 18c4-3 10-4 15-2',
            fill: 'none',
            stroke: '#f7efda',
            strokeWidth: '5',
            strokeLinecap: 'round',
          }),
          h('circle', { cx: 34, cy: 34, r: 11.5, fill: '#ffb703' }),
          h('circle', { cx: 30.5, cy: 30.5, r: 4.2, fill: '#ffd166' }),
          h('circle', { cx: 41, cy: 26, r: 2.2, fill: '#f59e0b', opacity: '0.75' }),
          h('circle', { cx: 24, cy: 40, r: 1.6, fill: '#f0a500', opacity: '0.5' }),
        ),
      )
    }

    const jget = async (p) => {
      const res = await fetch(API + p, { credentials: 'same-origin' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) throw new Error((body && body.error) || `HTTP ${res.status}`)
      return body
    }
    const jpost = async (p, payload) => {
      const res = await fetch(API + p, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) throw new Error((body && body.error) || `HTTP ${res.status}`)
      return body
    }

    function when(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return String(iso)
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }

    const fmt = (n) => Number(n || 0).toLocaleString('zh-CN')

    function Panel() {
      const [state, setState] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [flash, setFlash] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [form, setForm] = React.useState({ type: '', count: 1, note: '' })
      const [fund, setFund] = React.useState({ amount: 100, note: '' })
      const [edit, setEdit] = React.useState(null)
      const [showSpent, setShowSpent] = React.useState(false)
      const CUR = (state && state.currency && state.currency.id) || '鲸圆券'

      const apply = React.useCallback((next, message) => {
        setState(next)
        setErr('')
        if (message) {
          setFlash(message)
          window.clearTimeout(Panel._t)
          Panel._t = window.setTimeout(() => setFlash(''), 2600)
        }
      }, [])

      const load = React.useCallback(async () => {
        try {
          const next = await jget('/state')
          apply(next)
          setForm((f) => (f.type && next.templates.some((t) => t.id === f.type) ? f : { ...f, type: (next.templates.find((t) => t.kind !== 'currency') || {}).id || '' }))
        } catch (e) {
          setErr(String(e.message || e))
        }
      }, [apply])

      React.useEffect(() => {
        load()
        return () => window.clearTimeout(Panel._t)
      }, [load])

      const post = async (payload, message) => {
        setBusy(true)
        try {
          apply(await jpost('/action', payload), message)
          return true
        } catch (e) {
          setErr(String(e.message || e))
          return false
        } finally {
          setBusy(false)
        }
      }

      const submit = () =>
        post({ action: 'issue', type: form.type, count: Number(form.count) || 1, note: form.note }, `签发 ${Number(form.count) || 1} 张「${form.type}」`).then((ok) => {
          if (ok) setForm((f) => ({ ...f, note: '' }))
        })

      const buy = (type) => post({ action: 'exchange', type, count: 1 }, `兑换 1 张「${type}」`)
      const fundIt = () =>
        post({ action: 'fund', amount: Number(fund.amount) || 0, note: fund.note }, `充值 ${Number(fund.amount) || 0} ${CUR}`).then((ok) => {
          if (ok) setFund((f) => ({ ...f, note: '' }))
        })
      const openNew = () =>
        setEdit({ isNew: true, id: '', kind: 'card', price: 0, currency: CUR, blurb: '', rules: '', exceptions: '' })
      const openEdit = (t) =>
        setEdit({
          isNew: false,
          id: t.id,
          kind: t.kind,
          price: t.price,
          currency: t.currency,
          blurb: t.blurb || '',
          rules: (t.rules || []).join('\n'),
          exceptions: (t.exceptions || []).join('\n'),
        })
      const lines = (v) =>
        String(v || '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
      const saveTpl = () =>
        post(
          {
            action: 'template_save',
            id: edit.id,
            kind: edit.kind,
            price: Number(edit.price) || 0,
            currency: edit.currency,
            blurb: edit.blurb,
            rules: lines(edit.rules),
            exceptions: lines(edit.exceptions),
          },
          `模板「${edit.id}」已保存`,
        ).then((ok) => {
          if (ok) setEdit(null)
        })
      const delTpl = () => {
        if (!edit || edit.isNew) return
        if (!window.confirm(`删除模板「${edit.id}」？\n已签发的票不受影响，但以后不能再签发这个票种。`)) return
        post({ action: 'template_delete', id: edit.id }, `模板「${edit.id}」已删除`).then((ok) => {
          if (ok) setEdit(null)
        })
      }

      const scrap = async (serial) => {
        if (!window.confirm(`作废这张票？\n${serial}`)) return
        await post({ action: 'trash', serial }, '已作废')
      }

      if (state === null) {
        return h('div', { 'data-wallet-page': '' }, err ? h('div', { 'data-wallet-flash': '', 'data-err': '' }, err) : h('div', { 'data-wallet-empty': '' }, '票夹正在打开…'))
      }

      const cardTemplates = state.templates.filter((t) => t.kind !== 'currency')
      const activeType = state.templates.find((t) => t.id === form.type) || cardTemplates[0]

      return h(
        'div',
        { 'data-wallet-page': '' },
        // 头
        h(
          'div',
          { 'data-wallet-head': '' },
          Egg(48),
          h(
            'div',
            { 'data-wallet-title': '' },
            h('b', {}, '票夹'),
            h('span', {}, 'md5 自校验 · 消耗留档'),
            h('span', { 'data-wallet-origin': '' }, '票面 md5 与文件名绑定：改一个字，这张票就算已消耗。'),
          ),
          h('div', { 'data-wallet-spacer': '' }),
          h('button', { 'data-wallet-btn': '', onClick: load, disabled: busy }, '刷新'),
        ),

        // 账户
        h(
          'div',
          { 'data-wallet-sec': '' },
          h('div', { 'data-wallet-h': '' }, CUR),
          h(
            'div',
            { 'data-wallet-money': '' },
            h('span', { className: 'big' }, fmt(state.currency.balance)),
            h('span', { className: 'unit' }, CUR),
            h('div', { className: 'grow' }),
            state.currency.ok ? null : h('span', { className: 'bad' }, '账户校验失败，兑换已锁定'),
          ),
          h(
            'div',
            { 'data-wallet-fund': '' },
            h('input', { type: 'number', min: 1, value: fund.amount, onChange: (e) => setFund((f) => ({ ...f, amount: e.target.value })) }),
            h('input', {
              'data-note': '',
              placeholder: '备注（可选）',
              value: fund.note,
              onChange: (e) => setFund((f) => ({ ...f, note: e.target.value })),
            }),
            h('button', { 'data-wallet-btn': '', 'data-primary': '', onClick: fundIt, disabled: busy }, `签发${CUR}`),
          ),
          h('img', { 'data-wallet-note': '', src: '/api/wallet/note', alt: `${CUR}票样`, loading: 'lazy' }),
        ),

        // 模板
        h(
          'div',
          { 'data-wallet-sec': '' },
          h('div', { 'data-wallet-h': '' }, `票据模板（${state.templates.length}）`),
          h(
            'div',
            { 'data-wallet-tpls': '' },
            state.templates.map((t) =>
              h(
                'div',
                { 'data-wallet-tpl': '', key: t.id },
                h('div', { className: 'name' }, t.id),
                h(
                  'div',
                  { className: 'meta' },
                  h('span', {}, t.kind === 'currency' ? '账户 / 货币' : `手里 ${t.count} 张`),
                  h('span', {}, t.currency),
                ),
                t.kind === 'currency'
                  ? h('div', { className: 'price' }, '按金额签发，不按张')
                  : h('div', { className: 'price' }, `价格 ${fmt(t.price)} ${CUR}`),
                h('div', { className: 'blurb' }, t.blurb),
                h(
                  'div',
                  { className: 'ops' },
                  t.kind !== 'currency'
                    ? h(
                        'button',
                        {
                          'data-wallet-btn': '',
                          'data-pay': '',
                          disabled: busy || !state.currency.ok || state.currency.balance < t.price,
                          onClick: () => buy(t.id),
                          title: state.currency.balance < t.price ? `${CUR}不够` : `用${CUR}兑换`,
                        },
                        `兑换 1 张（${fmt(t.price)}）`,
                      )
                    : null,
                  h('button', { 'data-wallet-btn': '', onClick: () => openEdit(t) }, '编辑'),
                ),
              ),
            ),
          ),
        ),

        // 签发
        h(
          'div',
          { 'data-wallet-sec': '' },
          h('div', { 'data-wallet-h': '' }, `签发（管理员，不扣${CUR}）`),
          h(
            'div',
            { 'data-wallet-form': '' },
            h(
              'select',
              { value: form.type, onChange: (e) => setForm((f) => ({ ...f, type: e.target.value })) },
              cardTemplates.map((t) => h('option', { key: t.id, value: t.id }, t.id)),
            ),
            h('input', {
              type: 'number',
              min: 1,
              max: 20,
              value: form.count,
              onChange: (e) => setForm((f) => ({ ...f, count: e.target.value })),
            }),
            h('input', {
              'data-note': '',
              placeholder: '备注（可选）：为什么发这张',
              value: form.note,
              onChange: (e) => setForm((f) => ({ ...f, note: e.target.value })),
              onKeyDown: (e) => {
                if (e.key === 'Enter') submit()
              },
            }),
            h('button', { 'data-wallet-btn': '', 'data-primary': '', onClick: submit, disabled: busy }, '签发'),
          ),
          h('div', { 'data-wallet-flash': '', 'data-err': err ? '' : undefined }, err || flash),
        ),

        // 票墙
        h(
          'div',
          { 'data-wallet-sec': '' },
          h('div', { 'data-wallet-h': '' }, `票墙（${state.cards.length}）`),
          state.cards.length === 0
            ? h('div', { 'data-wallet-empty': '' }, `票夹是空的。签发一张，或者用${CUR}兑换一张。`)
            : h(
                'div',
                { 'data-wallet-wall': '' },
                state.cards.map((c) =>
                  h(
                    'div',
                    { 'data-wallet-stub': '', key: c.id },
                    h('div', { className: 's' }, c.short || c.serial),
                    h('div', { className: 't' }, c.type),
                    h('div', { className: 'd' }, `签发日 ${c.date}`),
                    c.price ? h('div', { className: 'p' }, `票面价 ${fmt(c.price)} ${CUR}`) : null,
                    c.note ? h('div', { className: 'note' }, `备注：${c.note}`) : null,
                    h('div', { className: 'ops' }, h('button', { onClick: () => scrap(c.serial), disabled: busy }, '作废')),
                  ),
                ),
              ),
        ),

        // 已消耗档案（折叠，免得用完的票堆一屏）
        state.spent.length > 0
          ? h(
              'div',
              { 'data-wallet-sec': '' },
              h(
                'button',
                { 'data-wallet-fold': '', onClick: () => setShowSpent((v) => !v) },
                h('span', { 'data-wallet-h': '' }, `已消耗档案（${state.spent.length}）`),
                h('span', { 'data-wallet-caret': '' }, showSpent ? '收起' : '展开'),
              ),
              !showSpent
                ? null
                : h(
                    'div',
                    { 'data-wallet-wall': '' },
                    state.spent.map((c) =>
                      h(
                        'div',
                        { 'data-wallet-stub': '', 'data-spent': '', key: c.id },
                        h('div', { className: 's' }, c.short),
                        h('div', { className: 't' }, c.type),
                        h(
                          'div',
                          { className: 'd' },
                          c.mark && c.mark.at ? `${c.mark.kind === 'voided' ? '作废' : '消耗'}于 ${c.mark.at}` : '票面被动过，已跳过',
                        ),
                        c.note ? h('div', { className: 'note' }, `备注：${c.note}`) : null,
                      ),
                    ),
                  ),
            )
          : null,

        // 规矩
        activeType && (activeType.exceptions.length > 0 || activeType.rules.length > 0)
          ? h(
              'div',
              { 'data-wallet-rules': '' },
              h('div', {}, `${activeType.id}的规矩`),
              h('ul', {}, activeType.rules.map((r, i) => h('li', { key: `r${i}` }, r))),
              activeType.exceptions.length > 0
                ? h('div', { style: { marginTop: '6px' } }, h('b', {}, '不可使用：'), activeType.exceptions.join('；'))
                : null,
            )
          : null,

        // 账本
        h(
          'div',
          { 'data-wallet-sec': '' },
          h('div', { 'data-wallet-h': '' }, '最近记录'),
          state.ledger.length === 0
            ? h('div', { 'data-wallet-empty': '' }, '还没有记录。')
            : h(
                'div',
                { 'data-wallet-ledger': '' },
                state.ledger.map((row, i) =>
                  h(
                    'div',
                    { className: 'row', key: `${row.at}-${i}` },
                    h('span', { className: 'when' }, when(row.at)),
                    h(
                      'span',
                      { className: 'what' },
                      row.event === 'issue'
                        ? `签发 ${row.count} 张「${row.type}」${row.note ? `：${row.note}` : ''}`
                        : row.event === 'redeem'
                          ? `核销 ${row.count || 1} 张「${row.type}」${row.what ? `：${row.what}` : ''}`
                          : row.event === 'exchange'
                            ? `兑换 ${row.count || 1} 张「${row.type}」，花 ${fmt(row.total)} ${CUR}`
                            : row.event === 'balance'
                              ? `${CUR}余额 ${fmt(row.balance)}`
                              : `作废「${row.type}」${(row.serials || []).join(',')}`,
                    ),
                  ),
                ),
              ),
          // 模板编辑
          h(
            'div',
            { 'data-wallet-sec': '' },
            h('div', { 'data-wallet-h': '' }, '模板编辑'),
            h(
              'div',
              { 'data-wallet-form': '' },
              h('button', { 'data-wallet-btn': '', 'data-primary': '', onClick: openNew, disabled: busy }, '+ 新建模板'),
              h(
                'select',
                {
                  value: '',
                  onChange: (e) => {
                    const t = state.templates.find((x) => x.id === e.target.value)
                    if (t) openEdit(t)
                  },
                },
                h('option', { value: '' }, '选择要编辑的模板…'),
                state.templates.map((t) => h('option', { key: t.id, value: t.id }, t.id)),
              ),
            ),
            edit
              ? h(
                  'div',
                  { 'data-wallet-editor': '' },
                  h(
                    'div',
                    { 'data-wallet-form': '' },
                    h('input', {
                      placeholder: '模板 id（如 奶茶票）',
                      value: edit.id,
                      disabled: !edit.isNew,
                      onChange: (e) => setEdit({ ...edit, id: e.target.value }),
                    }),
                    h('input', {
                      type: 'number',
                      min: 0,
                      placeholder: `价格（${CUR}）`,
                      value: edit.price,
                      onChange: (e) => setEdit({ ...edit, price: e.target.value }),
                    }),
                  ),
                  h('textarea', {
                    placeholder: '用途（一段话，会印在票面上）',
                    value: edit.blurb,
                    onChange: (e) => setEdit({ ...edit, blurb: e.target.value }),
                  }),
                  h('textarea', {
                    placeholder: '规矩（每行一条）',
                    value: edit.rules,
                    onChange: (e) => setEdit({ ...edit, rules: e.target.value }),
                  }),
                  h('textarea', {
                    placeholder: '不可使用（每行一条，可留空）',
                    value: edit.exceptions,
                    onChange: (e) => setEdit({ ...edit, exceptions: e.target.value }),
                  }),
                  h(
                    'div',
                    { 'data-wallet-form': '' },
                    h('button', { 'data-wallet-btn': '', 'data-primary': '', onClick: saveTpl, disabled: busy }, '保存模板'),
                    h('button', { 'data-wallet-btn': '', onClick: () => setEdit(null), disabled: busy }, '取消'),
                    edit.isNew ? null : h('button', { 'data-wallet-btn': '', onClick: delTpl, disabled: busy }, '删除模板'),
                  ),
                )
              : h('div', { 'data-wallet-empty': '' }, `点「新建模板」，或从上面选一个来编辑。模板存成 ${state.templatesDir}/<id>.md。`),
          ),
          h('div', { 'data-wallet-note': '' }, '票据规则来自模板文件；核销只在票面追加时间，枚举时 md5 校验跳过。'),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-coupon')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-coupon: 票夹样式')

        const slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined
        if (!slots) return
        slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: 'wallet', order: 34, label: '票夹' }, () => h(Panel)),
        )
      },
    }
  },
})
