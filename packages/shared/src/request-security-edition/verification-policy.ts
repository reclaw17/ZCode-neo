// OSS 版 Request Security Edition：官方闭源构建中这里是一整套阿里云验证码链路，
// 开源发布时被替换为空实现，导致 /api/v1/zcode-plan/billing/claim 一律被服务器
// 以 "captcha verify failed" 拒绝。本文件按官方 3.18.2 构建还原 claim 所需的
// 配置解析与请求头构造；模型请求验证管线（provider runtime headers）不随本
// 模块恢复，见 requiresRequestVerification 注释。
export interface RequestVerificationCaptchaConfig {
  enabled?: boolean;
  skipModelRequest?: boolean;
  region?: string;
  prefix?: string;
  sceneId?: string;
}
export type RequestVerificationConfig = Readonly<RequestVerificationCaptchaConfig>;
// /api/v1/client/configs → data.configs 的原始形态；captcha 块为 snake_case。
export interface RequestVerificationClientConfig {
  captcha?: {
    enabled?: unknown;
    skip_model_request?: unknown;
    region?: unknown;
    prefix?: unknown;
    sceneId?: unknown;
  } | null;
}
// claim 前端跑完验证码得到的证明；经 RPC 传给 Host 后映射为请求头。
// 服务器未开启验证码时为空对象，由服务端裁决是否放行。
export interface RequestVerificationProof {
  captchaVerifyParam?: string;
  captchaRegion?: string;
}
export const requestVerificationReasons = ["model-request"] as const;
export type RequestVerificationReason = (typeof requestVerificationReasons)[number];
export const requestVerificationTimeoutMessage =
  "Provider runtime headers request timed out. Please send your message again.";
export const REQUEST_VERIFICATION_REQUIRED = "coding_plan_security_verification_required";

const CAPTCHA_HEADER_NAMES = [
  "X-Aliyun-Captcha-Verify-Param",
  "X-Aliyun-Captcha-Verify-Region",
] as const;

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCaptchaConfig(
  configs: RequestVerificationClientConfig | null | undefined,
): RequestVerificationCaptchaConfig | null {
  const captcha = configs?.captcha;
  if (!captcha || typeof captcha !== "object" || Array.isArray(captcha)) return null;
  const region = readNonEmptyString(captcha.region);
  const prefix = readNonEmptyString(captcha.prefix);
  const sceneId = readNonEmptyString(captcha.sceneId);
  if (!region || !prefix || !sceneId) return null;
  return {
    region,
    prefix,
    sceneId,
    ...(typeof captcha.enabled === "boolean" ? { enabled: captcha.enabled } : {}),
    ...(typeof captcha.skip_model_request === "boolean"
      ? { skipModelRequest: captcha.skip_model_request }
      : {}),
  };
}

export function readRequestVerificationConfig(
  configs: RequestVerificationClientConfig | null | undefined,
): RequestVerificationConfig | null {
  return readCaptchaConfig(configs);
}

export function readValidatedRequestVerificationConfig(
  configs: RequestVerificationClientConfig | null | undefined,
): RequestVerificationConfig | null {
  const captcha = configs?.captcha;
  if (!captcha || typeof captcha !== "object" || Array.isArray(captcha)) return null;
  // 官方语义：配置块存在但类型坏掉时抛错，不能按“无配置”静默跳过校验。
  if (captcha.enabled !== undefined && typeof captcha.enabled !== "boolean") {
    throw new Error("Request verification configuration is invalid");
  }
  if (captcha.skip_model_request !== undefined && typeof captcha.skip_model_request !== "boolean") {
    throw new Error("Request verification configuration is invalid");
  }
  const config = readCaptchaConfig(configs);
  // 验证开启且不跳过模型请求时强制 region/prefix/sceneId 完整；关闭态缺少三元组
  // 视为无验证（readCaptchaConfig 返回 null），与官方“关闭即跳过”的下游行为一致。
  if (captcha.enabled !== false && captcha.skip_model_request !== true && !config) {
    throw new Error("Request verification configuration is invalid");
  }
  return config;
}

export function requestVerificationClaimHeaders(
  proof: RequestVerificationProof,
): Record<string, string> {
  const param = proof.captchaVerifyParam?.trim();
  const region = proof.captchaRegion?.trim();
  // 空证明（服务器未开启验证码）不能发送空头字段：空值同样会被网关按非法参数拒绝。
  return {
    ...(param ? { "X-Aliyun-Captcha-Verify-Param": param } : {}),
    ...(region ? { "X-Aliyun-Captcha-Verify-Region": region } : {}),
  };
}

export function withoutRequestVerificationHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!CAPTCHA_HEADER_NAMES.some((name) => name.toLowerCase() === key.trim().toLowerCase())) {
      next[key] = value;
    }
  }
  return next;
}

export function allowRequestVerificationHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = CAPTCHA_HEADER_NAMES.find(
      (candidate) => candidate.toLowerCase() === key.trim().toLowerCase(),
    );
    if (name && value.trim()) next[name] = value.trim();
  }
  return next;
}

export function isRequestVerificationMessage(message: string): boolean {
  return message.includes("请完成安全验证") || /security verification/i.test(message);
}

// 模型请求验证管线未随本模块恢复（renderer 没有 provider runtime headers 应答器），
// 保持关闭；当前服务器配置 skip_model_request=true，行为与官方一致。
export function requiresRequestVerification(
  _access: { mode: string } | undefined,
  _config?: RequestVerificationConfig | null,
): boolean {
  return false;
}

export function summarizeRequestVerificationHeaders(
  headers: Record<string, string>,
): Record<string, unknown> {
  const present = CAPTCHA_HEADER_NAMES.filter(
    (name) => Boolean(headers[name]?.trim()) || Boolean(headers[name.toLowerCase()]?.trim()),
  );
  return { requestVerificationHeaders: present };
}

export function requestVerificationDiagnostics(
  _input: Record<string, unknown>,
): Record<string, unknown> {
  return {};
}

// Renderer 侧交互式验证应答器未恢复；置 true 会让 zcodeAgentService 走
// providerRuntimeHeaders.request 事件并等待永不到来的应答。
export const requestVerificationInteractionAvailable = false;
