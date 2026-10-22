// The site hooks another package on this protocol (QwenWork's) uses:
// every one defaults to what Qoder's own sites do, and the ones that
// change behaviour do change it. No network, no sign-in.
import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { protocol } from "./index.mjs"
const { makePlugin, deviceSignIn, openapi, siteOf } = protocol

const client = { app: { log: async () => {} }, auth: { set: async () => {} }, tui: { showToast: async () => {} }, config: { get: async () => ({ data: {} }) } }
const load = async () => {
  const mod = await import("./index.mjs")
  return mod
}

const enterpriseDomainSite = {
  id: "t-ent", name: "T Ent", clientId: "c",
  web: "https://public.example", openapi: "https://public.example", api: "https://public.example",
  redirect: "", deviceOnly: true, deviceRefreshTarget: "c", modelScene: "qwork",
  userInfoPath: "/api/v1/adapter/user/account-context", normalizeUser: v => (v?.data ?? v)?.user,
  enterpriseDomain: "acme.example.com",
}

test("siteOf routes an account naming a domain to it, all three faces", () => {
  const a = { vpc: "acme.example.com", vpcDomain: "acme.example.com" }
  const s = siteOf({ id: "t", name: "T", web: "https://public.example", openapi: "https://public.example", api: "https://public.example" }, a)
  expect(s.web).toBe("https://acme.example.com")
  expect(s.openapi).toBe("https://acme.example.com")
  expect(s.api).toBe("https://acme.example.com")
})

test("siteOf leaves an account naming no domain alone", () => {
  const site = { id: "t", name: "T", web: "w", openapi: "o", api: "a" }
  expect(siteOf(site, {})).toBe(site)
  expect(siteOf(site, { vpc: "" })).toBe(site)
})

test("deviceSignIn skips the job token and names the account by a device-only site's rules", async () => {
  const saved = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(String(url))
    const u = String(url)
    if (u.includes("/api/v1/deviceToken/poll")) {
      return new Response(JSON.stringify({ token: "dt", refresh_token: "dtr", user_id: "u1" }), { status: 200 })
    }
    if (u.includes("/api/v1/adapter/user/account-context")) {
      return new Response(JSON.stringify({ data: { user: { id: "u1", name: "Alice", email: "a@t.example" } } }), { status: 200 })
    }
    return new Response("{}", { status: 404 })
  }
  try {
    const flow = await deviceSignIn(enterpriseDomainSite)
    const acct = await flow.callback()
    expect(calls.some((c) => c.includes("/api/v1/me/jobToken"))).toBe(false) // deviceOnly: no job token
    expect(acct.access).toBe("dt")
    expect(acct.deviceChat).toBe(true)
    expect(acct.accountId).toBe("Alice")           // device-only: name first
    expect(acct.vpc).toBe("acme.example.com")      // the domain carried
    expect(acct.vpcDomain).toBe("acme.example.com")
  } finally {
    globalThis.fetch = saved
  }
})

test("the 503 fallback reaches the provider's model list, and a 500 does not", async () => {
  const fallback = { qwork: [{ key: "flash", display_name: "F", is_vl: false, is_reasoning: false, max_input_tokens: 4096 }] }
  const plugin = await makePlugin({ ...enterpriseDomainSite, fallbackModels: fallback, listAllModels: true })({ client })
  const cred = { type: "oauth", uid: "u1", name: "Alice", machineId: "m1", access: "a", refresh: "r", expires: Date.now() + 3_600_000, deviceToken: "dt", deviceRefresh: "dtr" }
  const saved = globalThis.fetch
  const saw = []
  globalThis.fetch = async (url) => {
    saw.push(String(url))
    if (String(url).includes("/model/list")) return new Response(JSON.stringify({ code: "503", message: "Model catalog is unavailable" }), { status: 503 })
    return new Response("{}", { status: 200 })
  }
  try {
    const models = await plugin.provider.models({ models: {} }, { auth: cred })
    expect(Object.keys(models)).toContain("flash")
  } finally {
    globalThis.fetch = saved
  }
  // a 500 is an error, not a fallback: no model is served from it
  globalThis.fetch = async () => new Response("nope", { status: 500 })
  try {
    const models500 = await plugin.provider.models({ models: {} }, { auth: cred })
    expect(Object.keys(models500)).not.toContain("flash")
  } finally {
    globalThis.fetch = saved
  }
})

test("makePlugin serves a site with the hooks", async () => {
  const plugin = await makePlugin(enterpriseDomainSite)({ client })
  expect(plugin.auth.methods.length).toBeGreaterThan(0)
})
