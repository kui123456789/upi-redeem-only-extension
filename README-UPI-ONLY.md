# UPI Redeem Only

这是从原扩展单独剥离出来的 UPI 专用副本，原插件目录不删除、不移动。

## 加载目录

推荐使用脱敏发布包：

`release-artifacts/upi-redeem-only-0.2.0-sanitized.zip`

解压后在 Chrome 扩展管理页选择“加载已解压的扩展”，目录选择解压出来的文件夹。

## 配置使用说明

见 [docs/CONFIG-USAGE.md](docs/CONFIG-USAGE.md)。

## 保留能力

- 邮箱注册与验证码获取
- 创建/设置 GPT 登录密码
- 开通 TOTP 2FA
- UPI 试用资格检测
- Free / Plus 分组管理
- Free 分组补 AT
- Free 分组识别 Plus
- Free 分组 AT + 卡密兑换
- 远端确认成功后进入 Plus
- Free / Plus 分组导出

## 脱敏打包

发布包会排除本地秘钥和开发数据：

- `manifest.json` 中的 `key`
- `config.json`
- `.git`
- `.codegraph`
- `_metadata`
- `release-artifacts`
- 本地运行历史和日志

源码目录可以保留本地开发配置；对外使用发布包时，请使用 `sanitized` 压缩包。

## 处理方式

这个副本默认使用 UPI 流程。PayPal、GoPay、代理、接码等非 UPI 入口已经隐藏或移除。为了保证 UPI 注册、取码、2FA、会员核验能继续工作，必要的共享底层文件会保留在副本中。
