# @magpie-community/opencode-qwenwork-auth

QwenWork (千问办公) for OpenCode and magpie.

[中文说明](README.zh-CN.md)

Turn your QwenWork subscription into an OpenCode provider: sign in through
QwenWork's own device flow, then serve its models over its own agent endpoint —
with the host agent's tools riding along.

One package, two providers:

| Provider id | Service | Sign-in |
|---|---|---|
| `qwenwork` | QwenWork public cloud (`gateway.qwenwork.cn`) | phone / email (browser, as the desktop app) |
| `qwenwork-enterprise` | QwenWork **enterprise flagship** (VPC / private deployment) | **enter your enterprise's domain**, then its own login page (email OTP / SSO) |

> Unofficial plugin, not affiliated with Alibaba. Read the code before
> installing.

## Install

```sh
magpie plugin add @magpie-community/opencode-qwenwork-enterprise
```

Then:

- **Public cloud**: `magpie plugin login qwenwork`
- **Enterprise flagship**: `magpie plugin login qwenwork-enterprise`, enter
  your enterprise's domain when asked (the host your admin console lives on,
  e.g. `your-company.vpc.qwenwork.cn`), and finish the sign-in in the browser
  — on your enterprise's own login page, with email OTP or enterprise SSO.

Pick a model for an agent, e.g. `magpie claude qwenwork-enterprise/flash`.

## Enterprise notes

- **Domain**: asked at sign-in, or preset with `QWENWORK_ENT_DOMAIN` (then
  sign-in asks nothing).
- **The login page expires in 5 minutes**: re-run
  `magpie plugin login qwenwork-enterprise` if it times out.
- **Model catalog**: the flagship edition doesn't deploy the public cloud's
  model-catalog service (the endpoint answers 503), so this plugin ships the
  same list statically (`flash` / `pro` / `qwen3.8-max-preview`); chat works
  fine. To add a new model id, edit `QWORK_FALLBACK_LISTING` / `QWORK_MODELS`
  in `index.mjs`.
- **Prerequisite for email-OTP members**: the member's email must be bound to
  their QwenWork account (admin console → users → edit). Without it the login
  page says "用户不存在" (user not found).
- **How it works**: the flagship serves web / openapi / api on the enterprise's
  single domain, and its `/device/selectAccounts` takes no `redirect_uri` —
  the same as the desktop client's enterprise mode. This plugin builds its
  requests the same way.

## Configuration (optional)

Every endpoint can be overridden: `QWENWORK_*` for the public cloud,
`QWENWORK_ENT_*` for the enterprise edition.

```sh
QWENWORK_ENT_DOMAIN=your-company.vpc.qwenwork.cn   # preset the domain (sign-in then asks nothing)
QWENWORK_WEB / QWENWORK_OPENAPI / QWENWORK_API     # public endpoints
```

`QWENWORK_ENT_*` names only the pieces the sign-in needs when it lands on an
enterprise domain — `CLIENT_ID`, `RSA_PUBLIC_KEY`, `COSY_VERSION` — and an
enterprise account always uses its own domain for every call: the
`QWENWORK_ENT_WEB/OPENAPI/API` placeholders of the pre-sign-in listing are
never used for one.

## Usage display

magpie shows the account's credits beside the provider, from the
account-context the sign-in already reads (no extra requests).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Enterprise login says 用户不存在 | the member has no email bound; an admin adds it in the console |
| `the sign-in timed out` | the login page expired after 5 min; sign in again |
| Model list answers 503 | expected on the flagship (no catalog service); a static list is built in |
| Chat answers 401 | the sign-in lapsed (~10 days); sign in again |

## Credits

The protocol (device flow, COSY signing, the body codec) is ported from the
Qoder plugin of [magpie-community/plugins](https://github.com/magpie-community/plugins)
(MIT), which ported it from [CLIProxyAPI](https://github.com/ufec/CLIProxyAPI)
(MIT); the public-cloud provider follows
[harwinvoid/magpie-plugin-qwenwork](https://github.com/harwinvoid/magpie-plugin-qwenwork).

## License

MIT
