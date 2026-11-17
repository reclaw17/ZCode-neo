# ui-request-security-edition

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

意图：为 `claimManualPlan`（促销领取）补齐官方闭源构建里的阿里云验证码证明。OSS
发布把该链路替换成了空实现，服务器对没有证明的领取一律回 `captcha verify failed`。

不变量：

- 验证一次只跑一个：SDK 回调没有请求标识，并发会串扰（内部队列串行化）。
- 同一配置的实例 20 分钟内复用；实例失败必须立刻出缓存，否则下一次领取直接失败。
- 无痕验证优先，交互（滑块）只是兜底；证明未产出时绝不提交领取请求。
- 服务器未下发 captcha 配置或 `enabled=false` 时不跑验证码，按空证明提交（服务端裁决）。
- 模型请求验证管线（provider runtime headers）不属于本模块，保持关闭。

交集：`MarketingTouchProvider` 在 claim 动作里调用 `prepareRequestVerificationClaim`，
Banner 渲染时调用 `useRequestVerificationPrewarm`；配置读取走
`codingPlanSubscriptionService.getRequestVerificationConfig`（60s 缓存，预热与领取共享）。
