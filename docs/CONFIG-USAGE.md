# CDK Redeem Only 配置使用说明

本文档说明当前 `CDK Redeem Only V0.2.8` 的配置和常用操作。项目仓库与更新检查已统一为：

```text
https://github.com/kui123456789/cdk-redeem-only-extension
```

## 1. 安装加载

推荐从 GitHub Releases 下载最新发布包：

```text
https://github.com/kui123456789/cdk-redeem-only-extension/releases
```

1. 下载最新版本 zip 并解压。
2. 打开 Chrome：`chrome://extensions/`
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后的扩展目录。
6. 如果要在无痕窗口跑流程，进入扩展详情页，开启“在无痕模式下启用”。

更新代码或换包后，需要在 `chrome://extensions/` 里点击该扩展的“重新加载”，再重新打开侧边栏。

## 2. 脱敏说明

发布包不包含本地秘钥和运行数据：

- `manifest.json` 中的 `key` 已移除。
- 不包含 `config.json`。
- 不包含 `.git`、`.codegraph`、`_metadata`、`release-artifacts`。
- 不包含本地运行历史、日志和开发缓存。

`UPI Key`、`UPI Client ID`、`CDK 池` 等运行配置需要在侧边栏重新填写；填写后会保存在当前浏览器本地存储，不会写入公开仓库。

## 3. 必填配置

CDK 兑换流程固定使用下面两个远端服务：

- 兑换后端：`https://chong.nerver.cc/api/external/cdkey-redeems`
- 状态/资格/会员查询：`https://cha.nerver.cc`

侧边栏里通常需要配置：

1. `UPI Key`
   - 填后端提供的 `X-External-Api-Key`。
   - 只填 key 本身，不要加 `Bearer` 前缀。
   - 用于提交 CDK 兑换和刷新远端状态。

2. `UPI Client ID`
   - 可留空。
   - 留空时扩展会自动生成并保存在本地设置中。

3. `CDK 池`
   - 一行一个 CDK。
   - 可以像邮箱池一样粘贴导入。
   - 运行中或缺 CDK 停止后导入新 CDK，会自动继续剩余 Free 账号兑换。

```text
CDK-001
CDK-002
CDK-003
```

4. `兑换轮数`
   - 首轮结束后，失败账号会按轮继续。
   - 同一轮每个账号只尝试一张 CDK，失败后释放 CDK 并切换下一个账号。
   - 达到总轮数后账号保留在 Free，不再继续下一轮。
   - 填 `3` 表示最多 `3` 轮，界面会显示 `兑换轮 1/3`、`2/3`、`3/3`。
   - 设置为 `0` 表示只跑首轮。

5. `订阅 API`
   - 默认是 `https://cha.nerver.cc`。
   - 没有特殊要求不要改。

6. `操作间延迟`
   - 默认关闭，流程会更快。
   - 如果节点慢、页面加载不稳定、或频繁出现按钮未响应，可以手动开启。
   - 开启后，页面输入、点击、提交等操作后会额外等待约 2 秒。

## 4. 主流程规则

当前自动注册主流程只有 7 步：

1. 导入或获取注册邮箱。
2. 打开 ChatGPT 官网并提交邮箱。
3. 设置注册密码。
4. 读取并提交邮箱验证码。
5. 填写资料。
6. 等待注册完成。
7. 开通 2FA、读取 AT、检测 UPI 试用资格。

第 7 步不会自动兑换 CDK，只会在资格通过后保存到 Free 组。

Free 组保存格式为：

```text
邮箱---密码---2fa---at---时间戳
```

其中 `at` 是 ChatGPT access token。界面只显示脱敏 AT，导出 Free 时会包含原始 AT。

## 5. Free / Plus 分组

面板中 Free 组在上，Plus 组在下，两个分组同时显示。

### Free 组

Free 组用于保存有试用资格、但尚未远端确认 Plus 的账号。

支持导入格式：

```text
邮箱---密码---2fa
邮箱---密码---2fa---at
邮箱---密码---2fa---at---时间戳
```

不带 `at` 的账号会进入 Free 组，后续用 `一键补充 AT` 补齐。

导出格式固定为：

```text
邮箱---密码---2fa---at---时间戳
```

常用按钮：

- `导入 Free`：导入 Free TXT。
- `导出 Free`：导出 Free 组，自动注册运行中也允许导出。
- `删除 Free`：清空 Free 组本地记录。
- `一键补充 AT`：只处理 Free 组里缺 AT 的账号；只补 AT，不做资格删除。
- `一键识别 Plus`：把 Free 组里已有 AT 的账号发送到订阅 API；返回有效 Plus/Pro/Team 时进入 Plus。
- `一键兑换 CDK`：使用已保存 AT + 随机 CDK 提交远端；AT 缺失或失效时账号保留在 Free。
- 行内 `登录`：只登录账号、刷新 AT，不自动移动分组。
- 行内 `移动分组`：从 Free 移到 Plus 时会先用远端验证会员，确认 Plus/Pro/Team 才进入 Plus；验证失败仍保留 Free。

### Plus 组

远端兑换成功并确认会员成功后，账号才会进入 Plus 组。

Plus 导出格式：

```text
邮箱----密码---2fa---时间戳
```

Plus 组保留本地 AT 便于验证，但导出时不会带 AT。

常用按钮：

- `导出 Plus`：导出 Plus 组。
- `删除 Plus`：清空 Plus 组本地记录。
- `验证 Plus`：使用已保存 AT 查询会员；确认 Free 时移回 Free，确认 Plus/Pro/Team 时保留 Plus。
- 行内 `登录`：只登录账号、刷新 AT，不自动兑换。
- 行内 `移动分组`：Plus 移回 Free 只改本地分组；移回 Free 后仍可导出 AT。

## 6. CDK 兑换和轮次规则

一键兑换时：

1. 按当前可用 CDK 数量建立槽位。
2. 每个账号本轮最多匹配一个 CDK。
3. 远端返回成功并确认会员后，对应 AT 的邮箱进入 Plus。
4. 远端处于等待、处理中、已提交等状态时，账号留在 Free 等待刷新结果，CDK 不释放。
5. 后端手动取消后，账号自动回到待兑换，CDK 回到可用池。
6. 普通失败、超时、拒绝、取消、未找到时，账号保留 Free，旧 CDK 释放回可用池。
7. 同一轮失败后不会继续给同一个账号换 CDK，而是切换下一个账号。

失败 CDK 不会永久占用；未超过兑换轮数时，失败账号可在下一轮重新随机匹配 CDK。

## 7. CDK 状态规则

CDK 状态以远端返回为准：

- `兑换成功`
  - 远端确认成功并确认会员。
  - 对应账号进入 Plus。

- `等待/处理中`
  - 远端返回 `pending_dispatch`（等待兑换）、`dispatched`（已派发）、`running`（兑换中）、`submitted`、`processing`、`queued` 等。
  - 保持等待，不重新分配该 CDK。

- `已取消`
  - 远端返回 `cancelled` 或本地兼容值 `canceled`。
  - 账号回到待兑换，CDK 释放回可用池。

- `兑换失败`
  - 远端返回 `failed`（兑换失败）、`timeout`（兑换超时）、`rejected`、`approve-blocked` 等。
  - 账号保留在 Free。
  - 旧 CDK 释放回 CDK 池。
  - 未超过轮数时，账号可在下一轮自动随机匹配新 CDK。

- `未找到`
  - 远端返回 `not_found`。
  - 账号保留在 Free，旧 CDK 按失败类结果释放回可用池。

- `CDK 无效`
  - 不自动复用。
  - 建议手动删除或停用该 CDK。

CDK 行操作以状态查询接口返回的能力字段为准：

- `can_cancel=true`
  - 显示 `取消`。
  - 点击后调用 `/api/external/cdkey-jobs/cancel`，只取消后端任务，不重新提交 CDK。

- `can_retry=true`、`can_reuse_token=true`、`has_access_token=true`
  - 显示 `重试`。
  - 点击后调用 `/api/external/cdkey-jobs/retry`，复用后端已绑定的 `access_token` 重新入列。
  - 不读取新的 AT，也不提交新的 `access_token`。

- 已取消、未找到、没有后端 `access_token` 的任务
  - 不显示后端 `重试`。
  - 如需更换 AT 或重新兑换，使用 `一键兑换 CDK` 重新提交。

自动续兑时同样优先使用后端 `retry` 复用已绑定 token；只有后端不能复用 token 时，才回到原来的重新提交/重新匹配 CDK 流程。

## 8. 注册中按钮规则

自动注册运行中，Free / Plus 列表仍然显示。

允许：

- 查看 Free / Plus
- 导出 Free
- 导出 Plus

锁定：

- 导入 Free
- 补充 AT
- 一键兑换 CDK
- 删除
- 单账号重新核验
- 启用/禁用账号

## 9. 常见错误

### `UPI 远端接口认证失败 / HTTP 401 / HTTP 403`

检查 `UPI Key` 是否正确、是否有兑换接口权限。

### `CSRF verification failed`

这是远端接口拒绝了外部请求。通常需要后端允许外部 API Key 路径，或确认当前请求头/Key 权限配置正确。

### `access_token 不能为空`

账号缺少 AT。先在 Free 组点击 `一键补充 AT`，或重新导入带 AT 的 Free TXT。

### `ChatGPT session 已过期或当前会话失效`

AT 已过期或不可用。该账号会保留在 Free，需要重新补 AT 后再兑换。

### `账号登录态不一致`

读取 AT 时登录到的邮箱和目标邮箱不同。需要重新登录目标邮箱，再补 AT。

### `CDK 不足`

可用 CDK 数量不足。运行中或停止后导入新 CDK，会自动继续剩余 Free 账号兑换；也可以重新点击 `一键兑换 CDK`。

## 10. 推荐操作顺序

1. 加载最新发布包。
2. 填写 `UPI Key`。
3. 填写或自动生成 `UPI Client ID`。
4. 导入 CDK 池。
5. 自动注册账号。
6. 第 7 步后账号进入 Free。
7. 在 Free 组导出备份。
8. 点击 `一键兑换 CDK`。
9. 等远端刷新成功。
10. Plus 组导出成功账号。
