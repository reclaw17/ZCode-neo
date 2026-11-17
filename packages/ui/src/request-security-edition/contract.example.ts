/**
 * ui-request-security-edition 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { UiRequestSecurityEditionContract } from "./contract.js";

export function exampleUiRequestSecurityEdition(contract: UiRequestSecurityEditionContract): void {
  // 领取动作（见 MarketingTouchProvider）：先取证明，undefined 时取消领取。
  void (async () => {
    const controller = new AbortController();
    const proof = await contract.prepareRequestVerificationClaim(
      contractServicePlaceholder(),
      controller.signal,
      () => {},
    );
    if (!proof) return;
    await claimManualPlanPlaceholder({ planId: "zcode-v3-start-plan-0817", ...proof });
  })();
}

// 示意占位：真实调用方持有 services 与 RPC 代理，这里仅保证示例可编译。
function contractServicePlaceholder(): Parameters<
  UiRequestSecurityEditionContract["prepareRequestVerificationClaim"]
>[0] {
  throw new Error("example only");
}
function claimManualPlanPlaceholder(_request: { planId: string }): Promise<void> {
  throw new Error("example only");
}
