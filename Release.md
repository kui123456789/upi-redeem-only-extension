# Release Notes

## UPI Redeem Only V0.2.0

本版本完成 UPI-only 清理，只保留 UPI 注册、2FA、AT、Free/Plus 分组、卡密兑换、Plus 识别/验证和导入导出。

### 主要变化

- 移除旧支付流程 内容脚本和后台入口。
- 移除旧外部钱包支付、旧网络切换、手机验证取码、本地支付 helper 相关 UI 和入口。
- 侧栏只保留 UPI、账号、邮箱、设置密码、2FA、Free/Plus、卡密相关配置。
- 第 7 步仍只做开通 2FA、读取 AT、检测资格、保存 Free，不自动兑换卡密。
- Free 组支持导入、导出、补 AT、识别 Plus、一键兑换卡密。
- Plus 组支持验证、导出、删除。
- 保留 `content/signup-page.js` 第六步错误页 Try again 自动重试和 `readyState=interactive` 兼容逻辑。

### 配置

请在侧栏填写：

- `UPI Key`
- `UPI Client ID`
- `UPI 卡密池`
- `失败账号重试`

详细说明见 [docs/CONFIG-USAGE.md](docs/CONFIG-USAGE.md)。

### 脱敏要求

发布包必须排除本地密钥、配置、运行历史和开发缓存。不要把浏览器本地 storage、私钥、API Key 或卡密池打进公开包。



