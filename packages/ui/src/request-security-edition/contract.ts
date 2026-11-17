/**
 * ui-request-security-edition 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 * 每个方法注释写清：前置/后置条件、幂等性、发出哪些事件、是否等待持久化。
 */
import type { ICodingPlanSubscriptionService } from "@zcode/services";
import type { RequestVerificationProof } from "@zcode/shared";

/**
 * 领取前准备验证证明。
 * - 前置：浏览器环境（renderer）；signal 未中止。
 * - 后置：返回 proof（空对象=服务器未开启验证码，照常提交由服务端裁决）；
 *   undefined 表示验证未完成（配置读取失败/验证码未产出参数），调用方应取消领取并提示重试。
 * - 幂等性：不幂等——每次调用都可能触发一次新的验证码交互；内部串行化，并发调用排队。
 */
export type PrepareRequestVerificationClaim = (
  service: ICodingPlanSubscriptionService,
  signal: AbortSignal,
  onVerifying: () => void,
) => Promise<RequestVerificationProof | undefined>;

/** Banner 可见且已登录时预热（加载 SDK、初始化实例）；失败静默，点击领取时重试。 */
export type RequestVerificationPrewarm = (visible: boolean) => void;

export interface UiRequestSecurityEditionContract {
  prepareRequestVerificationClaim: PrepareRequestVerificationClaim;
  useRequestVerificationPrewarm: RequestVerificationPrewarm;
}
