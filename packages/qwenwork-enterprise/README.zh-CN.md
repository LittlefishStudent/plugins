# @magpie-community/opencode-qwenwork-enterprise-auth

千问办公（QwenWork）接入 OpenCode 和 magpie。

[English](README.md)

把你的千问办公订阅接成 OpenCode provider：用千问办公自己的设备登录流程登录，
再通过千问办公自己的 agent 端点调用它的模型 —— 宿主 agent 的工具会随请求下发。

一个插件，两个 provider：

| Provider id | 服务 | 登录方式 |
|---|---|---|
| `qwenwork` | 千问办公公有云（`gateway.qwenwork.cn`） | 手机号/邮箱（跳浏览器，与桌面端一致） |
| `qwenwork-enterprise` | 千问办公**企业旗舰版（VPC 私有化）** | 登录时**输入你企业的域名**，跳企业自己的登录页（邮箱验证码 / SSO） |

> 非官方插件，与阿里巴巴无关。安装前请先看代码。

## 安装

```sh
magpie plugin add @magpie-community/opencode-qwenwork-enterprise
```

装好后：

- **公有云**：`magpie plugin login qwenwork`
- **企业旗舰版**：`magpie plugin login qwenwork-enterprise`，按提示输入企业域名
  （就是企业管理后台地址栏里的那个，例如 `your-company.vpc.qwenwork.cn`），
  浏览器会打开**你企业自己的**千问办公登录页，用邮箱验证码或企业 SSO 完成授权。

给某个 agent 选模型即可，例如 `magpie claude qwenwork-enterprise/flash`。

## 企业旗舰版说明

- **域名**：登录时输入，或用环境变量 `QWENWORK_ENT_DOMAIN` 预设（预设后登录不再询问）。
- **登录页 5 分钟过期**：超时就重跑一次 `magpie plugin login qwenwork-enterprise`。
- **模型目录**：旗舰版目前未部署公有云的模型目录服务（接口返回 503），插件内置了与
  公有云一致的模型清单（`flash` / `pro` / `qwen3.8-max-preview`），不影响对话。
  旗舰版上新模型时，改 `index.mjs` 里的 `QWORK_FALLBACK_LISTING` / `QWORK_MODELS` 即可。
- **账号前提**：用「邮箱验证码」登录企业的成员，其邮箱必须已绑定到千问办公账号
  （管理后台 → 用户 → 编辑，填上邮箱）。没绑邮箱会报「用户不存在」。
- **原理**：旗舰版把 web/openapi/api 三个面合并在企业自己的域名上，且设备流
  `/device/selectAccounts` 不接受 `redirect_uri` 参数 —— 与千问办公桌面客户端的
  「企业模式」行为一致。本插件按同样规则构造请求。

## 配置（可选）

所有端点可用环境变量覆盖。公有云用 `QWENWORK_*`，企业版用 `QWENWORK_ENT_*`：

```sh
QWENWORK_ENT_DOMAIN=your-company.vpc.qwenwork.cn   # 预设企业域名（登录不再询问）
QWENWORK_WEB / QWENWORK_OPENAPI / QWENWORK_API     # 公有云端点（默认 gateway.qwenwork.cn）
QWENWORK_ENT_WEB / ...                             # 企业端点（一般不用改，域名覆盖即可）
QWENWORK_ENT_CLIENT_ID / QWENWORK_ENT_RSA_PUBLIC_KEY / QWENWORK_ENT_COSY_VERSION
```

`defaults.json` 与环境变量同名的键也能覆盖。

## 用量

magpie 会在 provider 旁边显示账号积分（来自登录时已在读的 account-context，不发额外请求）。

## 常见问题

| 现象 | 处理 |
|---|---|
| 企业登录页提示「用户不存在」 | 该成员在企业里没绑邮箱，请管理员在后台补绑 |
| `the sign-in timed out` | 登录页 5 分钟过期，重跑登录命令 |
| 模型列表报 503 | 预期行为（旗舰版无目录服务），已内置静态清单 |
| 对话 401 | 登录态过期（约 10 天），重新登录 |

## 致谢

协议实现（设备流、COSY 签名、请求编解码）移植自
[magpie-community/plugins](https://github.com/magpie-community/plugins)（MIT）的
Qoder 插件，又源自 [CLIProxyAPI](https://github.com/ufec/CLIProxyAPI)（MIT）；
公有云部分沿袭 [harwinvoid/magpie-plugin-qwenwork](https://github.com/harwinvoid/magpie-plugin-qwenwork)。

## License

MIT
