import type { ICodingPlanSubscriptionService } from "@zcode/services";
import type { RequestVerificationConfig, RequestVerificationProof } from "@zcode/shared";
import { useEffect } from "react";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { logger } from "@/logger.js";
import {
  prewarmAliyunCaptcha,
  resolveAliyunCaptchaVerifyParam,
} from "@/request-security-edition/aliyunCaptcha.js";

// 官方在 60s 内复用同一次配置读取；Banner 预热与点击领取共享该缓存。
const CONFIG_CACHE_TTL_MS = 60_000;
let cachedConfig: { promise: Promise<RequestVerificationConfig | null>; expiresAt: number } | null =
  null;

function readVerificationConfig(
  service: Pick<ICodingPlanSubscriptionService, "getRequestVerificationConfig">,
): Promise<RequestVerificationConfig | null> {
  if (cachedConfig && cachedConfig.expiresAt > Date.now()) return cachedConfig.promise;
  const promise = service.getRequestVerificationConfig();
  cachedConfig = { promise, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  void promise.catch(() => {
    if (cachedConfig?.promise === promise) cachedConfig = null;
  });
  return promise;
}

// 运行验证码要求三元组齐全；收窄成必填以便直接传给 SDK。
function isCaptchaActive(
  config: RequestVerificationConfig | null | undefined,
): config is RequestVerificationConfig & { region: string; prefix: string; sceneId: string } {
  return Boolean(
    config &&
    config.enabled !== false &&
    config.region?.trim() &&
    config.prefix?.trim() &&
    config.sceneId?.trim(),
  );
}

export function useRequestVerificationPrewarm(visible: boolean): void {
  const services = useServices();
  const user = useZCodeStore((state) => state.user);
  const loggedIn = Boolean(user);
  useEffect(() => {
    if (!visible || !loggedIn) return;
    let cancelled = false;
    const prewarm = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void readVerificationConfig(services.codingPlanSubscriptionService)
        .then((config) =>
          config && isCaptchaActive(config) ? prewarmAliyunCaptcha(config) : undefined,
        )
        .catch(() => logger.warn("[request-verification] captcha prewarm failed"));
    };
    prewarm();
    document.addEventListener("visibilitychange", prewarm);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", prewarm);
    };
  }, [visible, loggedIn, services]);
}

export async function prepareRequestVerificationClaim(
  service: ICodingPlanSubscriptionService,
  signal: AbortSignal,
  onVerifying: () => void,
): Promise<RequestVerificationProof | undefined> {
  onVerifying();
  signal.throwIfAborted();
  let config: RequestVerificationConfig | null;
  try {
    config = await readVerificationConfig(service);
  } catch (error) {
    if (signal.aborted) throw error;
    // 根因：配置读取失败时带空证明提交必然被服务器以 captcha verify failed 拒绝，
    // 且 UI 会误报“结果未确认”。此处直接终止领取并提示重试。
    logger.warn("[request-verification] claim config read failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
  signal.throwIfAborted();
  if (!isCaptchaActive(config)) {
    // 服务器未开启验证码：按原行为发送空证明，由服务端裁决。
    return {};
  }
  const param = await resolveAliyunCaptchaVerifyParam(config, signal);
  signal.throwIfAborted();
  if (!param.trim()) return undefined;
  return { captchaVerifyParam: param, captchaRegion: config.region };
}
