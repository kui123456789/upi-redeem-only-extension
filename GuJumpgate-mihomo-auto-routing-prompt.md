# GuJumpgate Mihomo 自动分流提示词

将下面这段提示词复制给你电脑上的 AI，让它自动检测本机正在使用的 mihomo 配置，并添加 GuJumpgate 美国轮询分流。

````text
请你在我的电脑上自动检测正在使用的 mihomo / Clash Meta / Clash Verge / Clash Verge Rev / Clash Nyanpasu / Mihomo Party / FlClash 等 mihomo 内核客户端，找到当前实际加载的 YAML 配置文件，然后修改该配置。

目标：

新增一个美国节点轮询策略组，命名为：

GuJumpgate自动轮询

并让以下域名规则放在 rules: 最前面，优先且仅走 GuJumpgate自动轮询：

- paypal.com
- www.paypal.com
- recaptcha.net
- midtrans.com
- checkout.stripe.com
- pay.openai.com
- chatgpt.com
- openai.com
- auth.openai.com

实现要求：

1. 先自动定位当前 mihomo 实际加载的配置文件，不要随便修改无关 YAML。
2. 修改前必须备份原配置，例如生成 原文件名.bak_时间戳。
3. 优先用 YAML 解析/结构化方式修改，避免用简单字符串拼接破坏格式。
4. 在 proxy-groups: 最前面新增策略组：

```yaml
- name: "GuJumpgate自动轮询"
  type: load-balance
  strategy: round-robin
  include-all: true
  include-all-proxies: true
  include-all-providers: true
  filter: '(?i)(美国|美國|西美|united[ -]?states|\bus\b|\busa\b|america|🇺🇸)'
  exclude-filter: '(?i)(剩余流量|距离下次重置剩余|下次重置剩余|重置剩余|套餐到期|到期时间|流量重置|traffic|expire|expiration|subscription|subscribe|reset|plan|建议)'
  url: "https://www.gstatic.com/generate_204"
  interval: 300
  lazy: false
  expected-status: 204
````

5. 如果当前 mihomo 版本或客户端不支持 include-all / include-all-proxies / include-all-providers，则改为扫描当前所有代理和 provider 节点名称，筛出美国节点，写成显式 proxies: 列表。
6. 在 rules: 最前面插入以下规则，必须排在原有 openai、paypal、stripe、geolocation-!cn、MATCH 等规则之前：

```yaml
- DOMAIN,www.paypal.com,GuJumpgate自动轮询
- DOMAIN-SUFFIX,paypal.com,GuJumpgate自动轮询
- DOMAIN-SUFFIX,recaptcha.net,GuJumpgate自动轮询
- DOMAIN-SUFFIX,midtrans.com,GuJumpgate自动轮询
- DOMAIN,checkout.stripe.com,GuJumpgate自动轮询
- DOMAIN,pay.openai.com,GuJumpgate自动轮询
- DOMAIN,chatgpt.com,GuJumpgate自动轮询
- DOMAIN,openai.com,GuJumpgate自动轮询
- DOMAIN,auth.openai.com,GuJumpgate自动轮询
```

7. 避免重复添加：如果已经存在 GuJumpgate自动轮询 或上述规则，请更新/去重，而不是重复插入。
8. 修改完成后验证 YAML 可以被正常解析，并检查：
   - GuJumpgate自动轮询 存在于 proxy-groups
   - 上述规则位于 rules 顶部
   - 规则目标策略组名称完全一致
   - 至少能匹配到一个美国节点；如果匹配不到，请提示我手动检查节点命名
9. 不要改动与本需求无关的代理、订阅、端口、DNS、TUN、其他规则。
10. 最后告诉我修改了哪个配置文件、备份文件在哪里、插入了哪些规则、是否验证通过。

参考逻辑：

实现方式类似在 mihomo 配置中新增一个美国 round-robin 轮询组，并把指定域名规则优先指向该轮询组。请适配我当前电脑上的实际 mihomo 配置，不要假设固定文件路径。
```
