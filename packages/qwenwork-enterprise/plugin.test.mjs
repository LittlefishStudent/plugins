// Loads the package the way check.mjs does and checks what it returns, with
// fetch mocked so no request leaves the test: the two providers' sign-in
// shapes, an enterprise account's chat, models, refresh and usage all going
// to its own domain and nothing to gateway.qwenwork.cn, the 503 catalog
// fallback (and that a 500 isn't one), and the domain input's rules.
import { test, expect } from "bun:test"

const client = { app: { log: async () => {} }, auth: { set: async () => {} }, tui: { showToast: async () => {} }, config: { get: async () => ({ data: {} }) } }
const load = async () => {
  const mod = await import("./index.mjs")
  const pub = await mod.QwenWorkAuthPlugin({ client, directory: process.cwd(), worktree: process.cwd(), $: undefined, project: {} })
  const ent = await mod.QwenWorkEnterpriseAuthPlugin({ client, directory: process.cwd(), worktree: process.cwd(), $: undefined, project: {} })
  return { pub, ent }
}

// every URL a mocked fetch saw, and a hook to answer each one
const seen = []
let answer = async () => new Response("{}", { status: 404 })
const mockFetch = () => {
  const saved = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen.push(String(url))
    return answer(String(url), init)
  }
  return () => { globalThis.fetch = saved; seen.length = 0 }
}

test("serves the public cloud and the enterprise flagship", async () => {
  const { pub, ent } = await load()
  expect(pub.auth.methods[0].label).toBe("Sign in with QwenWork")
  expect(ent.auth.methods[0].label).toContain("QwenWork 企业版")
})

test("the enterprise device flow sends no redirect_uri; the public one keeps its own", async () => {
  const { pub, ent } = await load()
  const m = ent.auth.methods[0]
  const flow = await m.authorize({ domain: "your-company.vpc.qwenwork.cn" })
  expect(flow.url.startsWith("https://your-company.vpc.qwenwork.cn/device/selectAccounts?")).toBe(true)
  expect(flow.url.includes("redirect_uri")).toBe(false)
  const pubFlow = await pub.auth.methods[0].authorize()
  expect(pubFlow.url.startsWith("https://gateway.qwenwork.cn/device/selectAccounts?")).toBe(true)
  expect(pubFlow.url.includes("redirect_uri=qwenwork-cn%3A%2F%2F")).toBe(true)
})

test("an enterprise account's usage goes to its own domain, nothing to the public cloud", async () => {
  const { ent } = await load()
  const restore = mockFetch()
  answer = async (url) => {
    if (url.startsWith("https://acme.example.com/")) {
      return new Response(JSON.stringify({ data: { plan: { name: "Enterprise" }, quota: { total: 100, remaining: 60 } } }), { status: 200 })
    }
    return new Response("{}", { status: 404 })
  }
  try {
    const account = { type: "oauth", access: "ent-token", refresh: "r", expires: Date.now() + 3_600_000, vpcDomain: "acme.example.com" }
    const usage = await ent.auth.usage(async () => account)
    expect(seen.some((u) => u === "https://acme.example.com/api/v1/adapter/user/account-context?include=user,plan,quota")).toBe(true)
    expect(seen.some((u) => u.includes("gateway.qwenwork.cn"))).toBe(false)
    expect(usage.plan).toBe("Enterprise")
    expect(usage.windows[0].display).toBe("40 / 100 credits")
  } finally {
    restore()
  }
})

test("an expired account with a refresh token is not marked lapsed by usage", async () => {
  const { ent } = await load()
  const restore = mockFetch()
  answer = async () => new Response("{}", { status: 404 })
  try {
    const account = { type: "oauth", access: "t", refresh: "r", expires: Date.now() - 1_000, vpcDomain: "acme.example.com" }
    const usage = await ent.auth.usage(async () => account)
    expect(usage.signIn).toBe("kept")
    // and one with no refresh pair is
    const lapsed = { type: "oauth", access: "t", expires: Date.now() - 1_000, vpcDomain: "acme.example.com" }
    const gone = await ent.auth.usage(async () => lapsed)
    expect(gone.signIn).toBe("expired")
  } finally {
    restore()
  }
})

test("a 503 catalog gives the fallback list; a 500 is an error, not a fallback", async () => {
  const { ent } = await load()
  const cred = { type: "oauth", uid: "u1", name: "Alice", machineId: "m1", access: "a", refresh: "r", expires: Date.now() + 3_600_000, deviceToken: "dt", deviceRefresh: "dtr", vpcDomain: "acme.example.com" }
  const restore = mockFetch()
  answer = async (url) => {
    if (url.includes("/model/list")) return new Response(JSON.stringify({ code: "503", message: "Model catalog is unavailable" }), { status: 503 })
    return new Response("{}", { status: 200 })
  }
  try {
    const models = await ent.provider.models({ models: {} }, { auth: cred })
    expect(Object.keys(models)).toContain("flash")
    // every request the listing made went to the enterprise domain
    expect(seen.every((u) => !u.includes("gateway.qwenwork.cn"))).toBe(true)
  } finally {
    restore()
  }
  answer = async () => new Response("nope", { status: 500 })
  try {
    const models = await ent.provider.models({ models: {} }, { auth: cred })
    expect(Object.keys(models)).not.toContain("flash")
  } finally {
    restore()
  }
})

test("the domain prompt refuses loopback, intranet, ports, paths and IPs", async () => {
  const { ent } = await load()
  const validate = ent.auth.methods[0].prompts.find((p) => p.key === "domain").validate
  for (const bad of [
    "not a domain", "1.2.3.4", "localhost", "foo.localhost", "foo.local",
    "foo.internal", "https://acme.example.com:8443", "https://acme.example.com/path",
    "http://acme.example.com", "https://user:pw@acme.example.com",
  ]) {
    expect(validate(bad)).toBeString()
  }
  for (const good of ["your-company.vpc.qwenwork.cn", "https://your-company.vpc.qwenwork.cn", "https://your-company.vpc.qwenwork.cn/"]) {
    expect(validate(good)).toBeUndefined()
  }
})

test("QWENWORK_ENT_DOMAIN presets the enterprise domain", async () => {
  process.env.QWENWORK_ENT_DOMAIN = "your-company.vpc.qwenwork.cn"
  try {
    const mod = await import("./index.mjs?preset")
    const ent = await mod.QwenWorkEnterpriseAuthPlugin({ client, directory: process.cwd(), worktree: process.cwd(), $: undefined, project: {} })
    const m = ent.auth.methods[0]
    expect(m.prompts.length).toBe(0)
    const flow = await m.authorize({})
    expect(flow.url.startsWith("https://your-company.vpc.qwenwork.cn/")).toBe(true)
  } finally {
    delete process.env.QWENWORK_ENT_DOMAIN
  }
})

test("the enterprise sign-in completes on the enterprise's own host", async () => {
  const { ent } = await load()
  const m = ent.auth.methods[0]
  const flow = await m.authorize({ domain: "acme.example.com" })
  expect(flow.url.startsWith("https://acme.example.com/")).toBe(true)
  // a completed device flow on that host names the account with its domain,
  // as qoder's VPC accounts are: "<email|uid> (<domain>)"
  const restore = mockFetch()
  answer = async (url) => {
    if (url.includes("/api/v1/deviceToken/poll")) return new Response(JSON.stringify({ token: "dt", refresh_token: "dtr", user_id: "u1" }), { status: 200 })
    if (url.includes("/api/v1/adapter/user/account-context")) return new Response(JSON.stringify({ data: { user: { id: "u1", name: "Alice", email: "alice@acme.example.com" } } }), { status: 200 })
    return new Response("{}", { status: 404 })
  }
  try {
    const acct = await flow.callback()
    expect(acct.accountId).toBe("alice@acme.example.com (acme.example.com)")
    expect(acct.vpc).toBe("acme.example.com")
    expect(acct.vpcDomain).toBe("acme.example.com")
    expect(seen.every((u) => u.startsWith("https://acme.example.com/"))).toBe(true)
  } finally {
    restore()
  }
})
