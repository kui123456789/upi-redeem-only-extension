# UPI Redeem Only

这是从原扩展单独剥离出来的 UPI 专用副本，原插件目录不删除、不移动。

## 加载目录

在 Chrome 扩展管理页选择“加载已解压的扩展”，目录选择：

`C:\Users\Z1803\Downloads\projict\upi-redeem-only-extension`

## 配置使用说明

见 [docs/CONFIG-USAGE.md](docs/CONFIG-USAGE.md)。

## 保留能力

- 邮箱注册与验证码获取
- 创建/设置 GPT 登录密码
- 开通 TOTP 2FA
- UPI 卡密兑换
- 会员状态核验
- 无会员备份账号补兑
- 成功账号导出：邮箱---GPT密码---2FA

## 处理方式

这个副本默认使用 UPI 流程，并隐藏 PayPal、GPC、GoPay、代理、手机号接码、CPA/SUB2 等非 UPI 配置入口。为了保证 UPI 注册、取码、2FA、会员核验能继续工作，相关共享底层文件会保留在副本中。
