# UPI Redeem Only

这是 UPI 专用副本。原插件目录不需要删除或移动，本目录只保留 UPI 注册、2FA、AT、Free/Plus 分组和卡密兑换能力。

## 配置使用说明

见 [docs/CONFIG-USAGE.md](docs/CONFIG-USAGE.md)。

## 加载目录

推荐加载脱敏发布包解压后的目录；开发调试时也可以直接加载本项目根目录。

```text
chrome://extensions/
```

开启“开发者模式”，点击“加载已解压的扩展程序”。

## 保留能力

- 邮箱注册与邮箱验证码获取。
- 创建并保存 GPT 登录密码。
- 开通 TOTP 2FA。
- 读取 access token。
- UPI 试用资格检测。
- Free / Plus 分组管理。
- Free 补 AT、识别 Plus、AT + 卡密兑换。
- 远端成功后进入 Plus。
- Free / Plus 导入导出。

## 已清理范围

已移除旧支付流程、旧外部钱包支付、旧网络切换、手机验证取码、本地支付 helper 和对应隐藏 UI。

邮箱取码不是 取码，注册流程仍保留邮箱 provider。

## 脱敏打包

发布包应排除本地密钥和开发数据：

- `manifest.json` 中的 `key`
- `config.json`
- `.git`
- `.codegraph`
- `_metadata`
- `release-artifacts`
- 本地运行历史、日志和缓存



