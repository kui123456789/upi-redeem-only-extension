# UPI Redeem Only

这是 UPI 卡密兑换专用版 Chrome 扩展。当前版本只保留 UPI 主流程：邮箱注册、邮箱验证码、设置 GPT 密码、第 7 步开通 2FA、读取 AT、Free/Plus 分组、卡密兑换、Plus 识别/验证、导入导出。

完整配置说明见 [docs/CONFIG-USAGE.md](docs/CONFIG-USAGE.md)。

## 保留能力

- 自动注册邮箱账号并读取邮箱验证码。
- 设置 GPT 登录密码。
- 第 7 步开通 TOTP 2FA、读取 access token、检测是否有试用资格。
- 资格通过后保存到 Free 组。
- Free 组导入、导出、补充 AT、一键识别 Plus、一键兑换卡密。
- 远端兑换成功并确认会员后移动到 Plus 组。
- Plus 组验证、导出、删除。
- 单账号登录、手动移动 Free/Plus 分组。

## 已移除

- 旧支付流程 流程。
- 旧外部钱包支付流程。
- 旧网络切换配置和切换模块。
- 旧手机验证模块。
- 本地支付 helper、支付转换网络切换和相关隐藏 UI。

邮箱验证码能力保留，因为注册和设置 GPT 密码仍需要邮箱取码。

## 安装

1. 打开 Chrome：`chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录，或选择脱敏发布包解压后的目录。
5. 修改代码或更新包后，回到扩展管理页点击“重新加载”。

## 必填配置

侧栏中需要填写：

- `UPI Key`：后端提供的 `X-External-Api-Key`，不要加 `Bearer`。
- `UPI Client ID`：可留空，扩展会自动生成并保存到本地。
- `UPI 卡密池`：一行一个卡密。
- `失败账号重试`：失败账号随机换卡重试的上限，`0` 表示关闭。

默认远端：

- 兑换接口：`https://chong.nerver.cc/api/external/cdkey-redeems`
- 资格/会员查询：`https://cha.nerver.cc`

## 主流程

当前自动注册主流程只有 7 步：

1. 导入或获取注册邮箱。
2. 打开 ChatGPT 官网并提交邮箱。
3. 设置注册密码。
4. 读取并提交邮箱验证码。
5. 填写资料。
6. 等待注册完成。
7. 开通 2FA、读取 AT、检测 UPI 试用资格。

第 7 步不会自动兑换卡密。资格通过后账号进入 Free 组。

## Free / Plus

Free 导出格式：

```text
邮箱---密码---2fa---at---时间戳
```

Plus 导出格式：

```text
邮箱----密码---2fa---时间戳
```

远端兑换成功并确认会员后，对应 AT 的邮箱才进入 Plus。失败、取消、等待中的账号会保留在 Free，并记录原因和时间戳。

## 脱敏发布

对外发布时应使用脱敏包，排除本地密钥和运行数据：

- `manifest.json` 中的 `key`
- `config.json`
- `.git`
- `.codegraph`
- `_metadata`
- `release-artifacts`
- 本地日志、缓存和运行历史




