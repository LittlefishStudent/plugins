// Loads the package the way check.mjs does, and checks what it returns:
// two providers, the enterprise sign-in asking for the enterprise's domain,
// and the device flow it builds taking no redirect_uri (the flagship's rule).
import { test } from "bun:test"

const client = { app: { log: async () => {} }, auth: { set: async () => {} }, tui: { showToast: async () => {} }, config: { get: async () => ({ data: {} }) } }
const load = async () => {
  const mod = await import("./index.mjs")
  const pub = await mod.QwenWorkAuthPlugin({ client, directory: process.cwd(), worktree: process.cwd(), $: undefined, project: {} })
  const ent = await mod.QwenWorkEnterpriseAuthPlugin({ client, directory: process.cwd(), worktree: process.cwd(), $: undefined, project: {} })
  return { pub, ent }
}

test("serves the public cloud and the enterprise flagship", async () => {
  const { pub, ent } = await load()
  if (pub.auth.methods[0].label !== "Sign in with QwenWork") throw new Error("public method")
  const m = ent.auth.methods[0]
  if (!m.label.includes("QwenWork 企业版")) throw new Error("enterprise method")
})

test("the enterprise sign-in asks for the domain", async () => {
  const { ent } = await load()
  const m = ent.auth.methods[0]
  if (!m.prompts.some((p) => p.key === "domain")) throw new Error("no domain prompt")
  // a bad name is refused
  if (m.prompts[0].validate("not a domain") === undefined) throw new Error("took a bad domain")
  // a bare IP is refused
  if (m.prompts[0].validate("1.2.3.4") === undefined) throw new Error("took an IP")
})

test("the enterprise device flow sends no redirect_uri", async () => {
  const { ent } = await load()
  const m = ent.auth.methods[0]
  const flow = await m.authorize({ domain: "your-company.vpc.qwenwork.cn" })
  if (!flow.url.startsWith("https://your-company.vpc.qwenwork.cn/device/selectAccounts?")) throw new Error(flow.url)
  if (flow.url.includes("redirect_uri")) throw new Error("the flagship takes no redirect_uri")
  if (typeof flow.callback !== "function") throw new Error("no callback")
})

test("the public device flow keeps its redirect_uri", async () => {
  const { pub } = await load()
  const flow = await pub.auth.methods[0].authorize()
  if (!flow.url.startsWith("https://gateway.qwenwork.cn/device/selectAccounts?")) throw new Error(flow.url)
  if (!flow.url.includes("redirect_uri=qwenwork-cn%3A%2F%2F")) throw new Error("public sends its redirect")
})

test("QWENWORK_ENT_DOMAIN presets the enterprise domain", async () => {
  process.env.QWENWORK_ENT_DOMAIN = "your-company.vpc.qwenwork.cn"
  try {
    const mod = await import("./index.mjs?preset")
    const ent = await mod.QwenWorkEnterpriseAuthPlugin({ client, directory: process.cwd(), worktree: process.cwd(), $: undefined, project: {} })
    const m = ent.auth.methods[0]
    if (m.prompts.length !== 0) throw new Error("preset still asks")
    const flow = await m.authorize({})
    if (!flow.url.startsWith("https://your-company.vpc.qwenwork.cn/")) throw new Error(flow.url)
  } finally {
    delete process.env.QWENWORK_ENT_DOMAIN
  }
})
