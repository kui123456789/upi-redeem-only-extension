# GuJumpgate v0.2.0

发布日期：2026-06-09

## 本次更新

### 版本与发布包

- 扩展版本号升级到 `0.2.0`，侧边栏显示为 `GuJumpgate V0.2.0`。
- 发布包目录和 zip 文件统一使用 `v0.2.0` 命名。
- 新增 PPBoom 本地助手启动脚本：
  - Windows：`start-ppboom.bat`
  - macOS：`start-ppboom.command`
- Windows 发布包支持携带便携 Python 运行时，降低本机 Python 环境缺失或版本不一致导致的启动失败概率。

### PPBoom / PP爆破模式

- 新增 PPBoom 本地助手链路，步骤 6 可通过本地 helper 串行创建 PayPal 订阅入口。
- 侧边栏新增 `PP爆破模式` 配置区，支持启用/关闭、保存、清除、运行状态展示、暂停任务和继续任务。
- 新增 PPBoom 浏览器后端选择：
  - 当前浏览器
  - AdsPower
  - RoxyBrowser
- AdsPower / RoxyBrowser 支持配置 API 地址、API Key、窗口 ID，并由本地 helper 接管独立浏览器执行。
- PPBoom 支持分别配置 `JP` 初始阶段代理与 `US` Provider 阶段代理，手机号注册时可按阶段切换代理。
- 新增 PPBoom 运行参数：连续串行次数、支付页语言、Stripe Publishable Key、Device ID、User Agent、重建 Checkout 次数。
- 新增 PPBoom 专属流程定义，启用后步骤 6 显示为 `爆破 Plus Checkout`，并兼容邮箱注册、手机号注册、绑定邮箱后重登、Sub2API Session 与 CPA Session 流程。
- PPBoom 任务状态会回写扩展运行态，侧边栏可显示当前 attempt、pending/running/paused/succeeded/failed 状态。

### 支付完成与恢复链路

- PPBoom 命中 OpenAI 支付完成页后，会新开 ChatGPT 会话页复核 Plus 状态，确认 Plus 生效后再完成步骤 9。
- AdsPower / PPBoom 独立支付链路完成后，会读取 ChatGPT session，确认付费 plan 或订阅状态。
- PPBoom 返回 `User is already paid` / `already subscribed` 时，会按已有订阅处理并跳过后续支付节点。
- PayPal genericError / 授权页异常恢复时，会先清理 PayPal 会话再重建 Checkout。
- 清理 PayPal 会话时，除了 cookie，也会清理相关 PayPal 标签页的 `localStorage` / `sessionStorage`。
- `pm-redirects.stripe.com` 已纳入 PayPal 链路识别，步骤 8 会等待 Stripe 中转进入 PayPal 后再继续授权。
- Hosted Checkout 增加完成页文案识别，用于辅助判断支付完成或 checkout 会话结束状态。

### 邮箱来源

- 新增 `MoeMail` provider，接入邮箱生成、验证码轮询和主流程读取链路。
- 新增 `YYDS Mail` provider，接入邮箱生成、验证码轮询和主流程读取链路。
- 侧边栏新增对应 provider 配置项，并支持配置回填与状态恢复。

### Hosted Checkout / PayPal 填写

- Hosted Checkout 支持按模式保存和恢复 profile，自动运行恢复时会保留当前 `plusCheckoutMode`。
- Hosted Checkout 增强验证码提取与过滤，支持 `SmsCode` 字段，并避免把示例码、说明文本或无效响应当成真实验证码。
- Hosted Checkout 日区资料会规范都道府县、邮编、生日、信用卡有效期和密码格式。
- PayPal 授权页会优先识别可授权状态，再处理登录态，减少已进入授权页却继续走登录分支的问题。
- PayPal / Hosted Checkout 拒卡或 genericError 场景支持自动重建或换资料重试。

### 手机验证码与 WhatsApp 链路

- `requestAdditionalSms` 支持返回新的 activation，并立即刷新后台运行态，减少补码后沿用旧 activation 的错位问题。
- SMSPool 补发短信前会记录历史验证码，把旧码加入忽略列表，避免重复消费历史短信。
- 添加手机号页会校验国家选项和展示区号，避免选错国家后继续提交。
- 增强“无法向该号码发送短信 / 验证码”类中英文错误识别。
- WhatsApp 识别逻辑区分“纯 WhatsApp 页面”和“短信 / WhatsApp 选择器文案”，避免混合文案误触发重开。
- WA 自动重试默认次数调整为 `5` 次；添加手机号页提示短信切换到 WhatsApp 时，会刷新 add-phone 并重新取号。

### Hotmail 管理器

- Hotmail 管理器新增从后台主动回读最新状态的同步逻辑。
- 导入、保存、切换、校验、测试、删除后会立即刷新侧边栏数据。
- 修复保存空 payload 时可能覆盖已有账号列表的问题。

### 文档

- README 新增 PPBoom 本地助手启动说明。
- `RELEASING.md` 更新到 `v0.2.0` 发布流程。
- 新增 AdsPower PPBoom 架构设计文档，说明主扩展、helper、AdsPower / RoxyBrowser worker 的职责拆分。
- 发布检查新增提醒：Windows 发布包里的 `*.bat` 启动脚本需要保持 `CRLF` 换行。

## 使用提醒

- 启用 PPBoom / PP爆破模式前，请先运行 `start-ppboom.bat` 或 `start-ppboom.command`。
- 使用 AdsPower / RoxyBrowser 后端时，请提前确认对应窗口内已登录目标 ChatGPT 账号。
- RoxyBrowser 当前仅支持 Chrome 内核窗口。
