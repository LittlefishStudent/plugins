// QwenWork (千问办公) for magpie / OpenCode — two providers from one package:
//
//   qwenwork              the public cloud (gateway.qwenwork.cn), exactly as
//                         the upstream plugin served it
//   qwenwork-enterprise   the enterprise flagship (旗舰版 / VPC) edition: the
//                         sign-in asks for the enterprise's own domain (its
//                         web / openapi / api faces all live on that one
//                         host), and the device flow there sends no
//                         redirect_uri — the desktop client's enterprise mode
//                         behaves the same.
//
// Chat completions are rewritten as QwenWork's own agent_chat_generation
// request by the vendored adapter (vendor/qoder.mjs): the host's tools ride
// along, tool calls come back structured, and the host agent keeps its loop.
// COSY signing, the request codec and the endpoints stay in the adapter.
//
// Endpoints can be overridden with QWENWORK_* (public) and QWENWORK_ENT_*
// (enterprise) environment variables; the enterprise domain can be preset
// with QWENWORK_ENT_DOMAIN so sign-in asks nothing.
import { createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'

const defaults = JSON.parse(readFileSync(new URL('./defaults.json', import.meta.url), 'utf8'))
// The provider's picture, as magpie reads it: a data:image URI on the auth hook.
const pluginIcon = (() => {
  try { return `data:image/png;base64,${readFileSync(new URL('./icon.png', import.meta.url)).toString('base64')}` } catch { return '' }
})()

function makeSetting(prefix) {
  return function setting(name) {
    const value = (process.env[prefix + name] ?? defaults[name])?.trim()
    if (!value) throw new Error(`${prefix}${name} is not configured`)
    return value
  }
}
function originOf(setting) {
  return function origin(name) {
    let url
    try { url = new URL(setting(name)) } catch { throw new Error(`${name} must be an https address`) }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(`${name} must be an https origin`)
    return url.origin
  }
}

// num renders a credit count as magpie shows it: no trailing zeros, at most
// two decimals (1982.1652 -> "1982.17", 2000 -> "2000").
const num = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 100) / 100)
}

// qwenworkUsage reads the account's credits for magpie's usage bar, from the
// account-context the sign-in already reads: quota {total, used, remaining,
// exceeded} and plan {name, next_refresh / next_due}.
function qwenworkUsage(openapi, who) {
  return async (getAuth) => {
    let signIn = 'kept'
    try {
      const a = await getAuth()
      if (a?.type !== 'oauth' || !String(a.access ?? '').trim() || (a.expires > 0 && a.expires <= Date.now())) return { error: `${who}: not signed in`, signIn: 'expired' }
      const res = await fetch(`${openapi}/api/v1/adapter/user/account-context?include=user,plan,quota`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${a.access}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status === 401 || res.status === 403) return { error: `${who}: the sign-in lapsed — sign in again`, signIn: 'expired' }
      if (!res.ok) return { error: `${who}: usage read failed (HTTP ${res.status})`, signIn }
      const ctx = (await res.json())?.data ?? {}
      const q = ctx.quota
      const out = { signIn }
      if (ctx.plan?.name) out.plan = String(ctx.plan.name)
      const refresh = ctx.plan?.next_refresh_date ?? ctx.plan?.next_due_date
      if (refresh) out.until = new Date(refresh).toISOString()
      if (q && typeof q === 'object') {
        const total = Number(q.total)
        const remaining = Number(q.remaining)
        const used = Number.isFinite(Number(q.used)) ? Number(q.used) : total - remaining
        if (Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0) {
          out.windows = [{ name: 'Credits', used: Math.min(100, (100 * used) / total), display: `${num(used)} / ${num(total)} credits` }]
        }
      }
      if (!out.windows) out.error = `${who}: the account reports no credits`
      return out
    } catch (e) {
      return { error: String(e?.message ?? e), signIn }
    }
  }
}

// The models the public cloud lists today, as the enterprise fallback: the
// flagship edition serves the same qwork scene, but its model-catalog service
// answers 503 ("Model catalog is unavailable"), so fetchListing falls back to
// this (see vendor/qoder.mjs).
const QWORK_MODELS = [
  { id: 'flash', name: '标准' },
  { id: 'pro', name: '高级' },
  { id: 'qwen3.8-max-preview', name: 'Qwen3.8-Max' },
]
const QWORK_FALLBACK_LISTING = {
  qwork: [
    { key: 'flash', display_name: '标准', is_vl: false, is_reasoning: false, max_input_tokens: 131072 },
    { key: 'pro', display_name: '高级', is_vl: false, is_reasoning: false, max_input_tokens: 131072 },
    { key: 'qwen3.8-max-preview', display_name: 'Qwen3.8-Max', is_vl: false, is_reasoning: false, max_input_tokens: 131072 },
  ],
}

const SYSTEM_PROMPT = 'You are QwenWork (qw), a helpful assistant. Use the instructions below and the tools available to you to assist the user.'

// The shared shape: everything the vendored makePlugin takes, plus the pieces
// this file wires (usage, icon).
function baseSite({ id, name, setting, web, openapi, api, redirect, fallbackModels }) {
  const rsa = setting('RSA_PUBLIC_KEY').replaceAll('\\n', '\n')
  try { if (createPublicKey(rsa).asymmetricKeyType !== 'rsa') throw new Error() } catch { throw new Error('RSA_PUBLIC_KEY must be an RSA public key in PEM form') }
  return {
    id, name, clientId: setting('CLIENT_ID'), web, openapi, api, rsaKey: rsa,
    cosyVersion: setting('COSY_VERSION'), redirect,
    deviceOnly: true, deviceRefreshTarget: 'c', modelScene: 'qwork', listAllModels: true,
    clientType: '6', businessProduct: 'qoder_work', sessionType: 'qoder_work',
    userInfoPath: '/api/v1/adapter/user/account-context?include=user,plan,quota,page,data_sharing',
    normalizeUser: v => (v?.data ?? v)?.user ?? (v?.data ?? v),
    fallbackModels,
    models: QWORK_MODELS.map((m) => ({ ...m })),
    systemPrompt: SYSTEM_PROMPT,
  }
}

// ---- provider 1: the public cloud ------------------------------------------

export async function QwenWorkAuthPlugin({ client }) {
  const setting = makeSetting('QWENWORK_')
  const origin = originOf(setting)
  const site = baseSite({
    id: 'qwenwork', name: 'QwenWork', setting,
    web: origin('WEB'), openapi: origin('OPENAPI'), api: origin('API'),
    redirect: 'qwenwork-cn://',
    fallbackModels: undefined,
  })
  const { makePlugin } = await import('./vendor/qoder.mjs')
  const plugin = await makePlugin(site)({ client })
  plugin.auth.usage = qwenworkUsage(site.openapi, 'QwenWork')
  plugin.auth.icon = pluginIcon
  return plugin
}

// ---- provider 2: the enterprise flagship (旗舰版 / VPC) ---------------------

// enterpriseDomain reads what the user entered as their enterprise's address,
// as the desktop client's enterprise mode reads its endpoint override: a bare
// host, or an https:// address with no path. Anything else names none.
function enterpriseDomain(input) {
  let e = String(input ?? '').trim().toLowerCase()
  if (!e) return undefined
  if (/^[a-z][a-z\d+.-]*:\/\//.test(e)) {
    let u
    try { u = new URL(e) } catch { return undefined }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || (u.pathname !== '' && u.pathname !== '/')) return undefined
    if (e.endsWith('/')) e = e.slice(0, -1)
    if (u.hostname + '' !== e.slice('https://'.length)) return undefined
    e = u.hostname
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(e)) return undefined // a bare IP is not a domain
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(e)) return undefined
  return e
}

export async function QwenWorkEnterpriseAuthPlugin({ client }) {
  const { makePlugin, vendorDeviceSignIn } = await import('./vendor/qoder.mjs')
  const setting = makeSetting('QWENWORK_ENT_')
  const origin = originOf(setting)
  const presetDomain = enterpriseDomain(process.env.QWENWORK_ENT_DOMAIN ?? process.env.QWENWORK_ENTERPRISE_DOMAIN ?? '')

  // The site magpie's plugin host builds: the public cloud by default, so the
  // provider and its models are listed before anyone signs in; the enterprise
  // sign-in swaps in the enterprise site per domain.
  const site = baseSite({
    id: 'qwenwork-enterprise', name: 'QwenWork 企业版', setting,
    web: origin('WEB'), openapi: origin('OPENAPI'), api: origin('API'),
    redirect: 'qwenwork-cn://',
    fallbackModels: QWORK_FALLBACK_LISTING,
  })
  const enterpriseSiteFor = (domain) => ({
    ...baseSite({
      id: 'qwenwork-enterprise', name: 'QwenWork 企业版', setting,
      web: `https://${domain}`, openapi: `https://${domain}`, api: `https://${domain}`,
      redirect: '', // the flagship's device flow takes no redirect_uri
      fallbackModels: QWORK_FALLBACK_LISTING,
    }),
    enterpriseDomain: domain, // the account carries it: chats go to the enterprise host
  })

  const plugin = await makePlugin(site)({ client })

  plugin.auth.methods.splice(0, plugin.auth.methods.length, {
    type: 'oauth',
    label: presetDomain ? `Sign in with QwenWork 企业版 (${presetDomain})` : 'Sign in with QwenWork 企业版（输入企业域名）',
    prompts: presetDomain ? [] : [
      {
        type: 'text',
        key: 'domain',
        message: '你企业的千问办公旗舰版域名（企业管理后台地址栏的域名，如 your-company.vpc.qwenwork.cn）',
        placeholder: 'your-company.vpc.qwenwork.cn 或 https://your-company.vpc.qwenwork.cn',
        validate: (v) => (enterpriseDomain(v) ? undefined : '请输入企业域名（或 https:// 开头的完整地址），不要带路径'),
      },
    ],
    authorize: (inputs) => {
      const domain = presetDomain || enterpriseDomain(inputs?.domain)
      if (!domain) throw new Error('请输入企业域名（或设置 QWENWORK_ENT_DOMAIN 环境变量）')
      return vendorDeviceSignIn(enterpriseSiteFor(domain))
    },
  })

  plugin.auth.usage = qwenworkUsage(site.openapi, 'QwenWork 企业版')
  plugin.auth.icon = pluginIcon
  return plugin
}
