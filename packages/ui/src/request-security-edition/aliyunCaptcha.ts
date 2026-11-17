// 阿里云验证码最小运行时，按官方 3.18.2 构建的 request-security-edition 还原。
// 仅保留 claim 所需链路：加载 SDK → 初始化实例 → 无痕验证优先、交互兜底 →
// 产出 captchaVerifyParam。官方链路中的 ARMS 事件上报与诊断埋点不随本模块移植。
// 运行验证码所需的必填三元组；由 claim.ts 从服务器配置收窄后传入。
export interface AliyunCaptchaRuntimeConfig {
  region: string;
  prefix: string;
  sceneId: string;
}

const SDK_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
const CONTAINER_ID = "zcode-aliyun-captcha-container";
const ELEMENT_ID = "zcode-aliyun-captcha-element";
const BUTTON_ID = "zcode-aliyun-captcha-button";
const ELEMENT_SELECTOR = `#${ELEMENT_ID}`;
const BUTTON_SELECTOR = `#${BUTTON_ID}`;
const LOCALE_STORAGE_KEY = "zcode-locale-preference";
const INSTANCE_FRESH_MS = 20 * 60_000;
const INSTANCE_WAIT_TIMEOUT_MS = 10_000;
const VERIFY_TIMEOUT_MS = 120_000;

interface AliyunCaptchaInstance {
  show?: () => void;
  startTracelessVerification?: () => void;
}

interface InitAliyunCaptchaOptions {
  SceneId: string;
  region: string;
  prefix: string;
  mode: string;
  language: string;
  showErrorTip: boolean;
  element: string;
  button: string;
  getInstance: (instance: AliyunCaptchaInstance) => void;
  success: (captchaVerifyParam: string) => void;
  fail: (error: unknown) => void;
  onError: (error: unknown) => void;
}

declare global {
  interface Window {
    AliyunCaptchaConfig?: { region: string; prefix: string };
    initAliyunCaptcha?: (options: InitAliyunCaptchaOptions) => unknown;
  }
}

interface SdkResult {
  success?: boolean;
  verifyResult?: boolean;
  verifyCode?: string;
}

// 与官方校验语义一致：SDK 回调对象大小写字段两种形态都要认。
function readSdkResult(error: unknown): SdkResult {
  if (typeof error !== "object" || error === null) return {};
  const record = error as Record<string, unknown>;
  const verifyCode =
    typeof record.verifyCode === "string"
      ? record.verifyCode
      : typeof record.VerifyCode === "string"
        ? record.VerifyCode
        : undefined;
  return {
    ...(typeof record.success === "boolean" ? { success: record.success } : {}),
    ...(typeof record.verifyResult === "boolean" ? { verifyResult: record.verifyResult } : {}),
    ...(verifyCode ? { verifyCode } : {}),
  };
}

function readSdkCaptchaVerifyParam(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const raw =
    typeof record.captchaVerifyParam === "string"
      ? record.captchaVerifyParam
      : typeof record.CaptchaVerifyParam === "string"
        ? record.CaptchaVerifyParam
        : undefined;
  return raw?.trim() || undefined;
}

// T006 / success+verifyResult 双真：SDK 判定通过，即使走 fail 回调也可采信 param。
function isTerminalPass(result: SdkResult): boolean {
  return (result.success === true && result.verifyResult === true) || result.verifyCode === "T006";
}

// F015 / 空码 + verifyResult=false：无痕验证无法静默裁决，需要交互（滑块）补验。
function isAwaitingInteractive(result: SdkResult): boolean {
  return (
    result.success === true &&
    result.verifyResult === false &&
    (!result.verifyCode || result.verifyCode === "F015")
  );
}

function isDuplicateSubmission(result: SdkResult): boolean {
  return result.verifyCode === "F008";
}

let scriptLoad: Promise<void> | null = null;

function loadCaptchaScript(): Promise<void> {
  if (typeof window.initAliyunCaptcha === "function") return Promise.resolve();
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    const script = existing ?? document.createElement("script");
    const fail = () => {
      script.remove();
      scriptLoad = null;
      reject(new Error("Failed to load captcha script."));
    };
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return scriptLoad;
}

// SDK 要求页面内存在 element 与 button 挂载点；弹窗由 SDK 自行遮罩，容器本体保持离屏。
function ensureCaptchaContainer(): void {
  if (document.getElementById(CONTAINER_ID)) return;
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  const element = document.createElement("div");
  element.id = ELEMENT_ID;
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.style.display = "none";
  container.append(element, button);
  document.body.appendChild(container);
}

function triggerInteractiveChallenge(): void {
  document.querySelector<HTMLButtonElement>(BUTTON_SELECTOR)?.click();
}

function resolveCaptchaLanguage(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored === "zh-CN") return "cn";
  if (stored && stored !== "system") return "en";
  return (typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "").startsWith("zh")
    ? "cn"
    : "en";
}

interface ActiveAttempt {
  resolve: (param: string) => void;
  reject: (error: Error) => void;
  interactiveTriggered: boolean;
  cleanup: () => void;
}

let activeAttempt: ActiveAttempt | null = null;

function settleAttempt(attempt: ActiveAttempt, complete: () => void): void {
  if (activeAttempt !== attempt) return;
  activeAttempt = null;
  attempt.cleanup();
  complete();
}

function routeSdkSuccess(param: string): void {
  const attempt = activeAttempt;
  if (!attempt) return;
  settleAttempt(attempt, () => attempt.resolve(typeof param === "string" ? param : ""));
}

function routeSdkFailure(error: unknown, rejectInstance: (error: Error) => void): void {
  const attempt = activeAttempt;
  if (!attempt) {
    // 实例尚未被业务使用即失败：按官方语义让初始化 promise 失败，缓存作废。
    rejectInstance(error instanceof Error ? error : new Error("Captcha failed."));
    return;
  }
  const result = readSdkResult(error);
  if (isTerminalPass(result)) {
    const param = readSdkCaptchaVerifyParam(error);
    if (param) {
      settleAttempt(attempt, () => attempt.resolve(param));
      return;
    }
    // 通过但未带 param：SDK 可能稍后补发 success，继续等待直到超时。
    return;
  }
  if (isAwaitingInteractive(result)) {
    if (attempt.interactiveTriggered) {
      settleAttempt(attempt, () => attempt.reject(new Error("Captcha verification failed.")));
      return;
    }
    attempt.interactiveTriggered = true;
    triggerInteractiveChallenge();
    return;
  }
  if (isDuplicateSubmission(result)) {
    settleAttempt(attempt, () => attempt.reject(new Error("Captcha data was already submitted.")));
    return;
  }
  settleAttempt(attempt, () =>
    attempt.reject(error instanceof Error ? error : new Error("Captcha failed.")),
  );
}

function routeSdkError(error: unknown, rejectInstance: (error: Error) => void): void {
  const attempt = activeAttempt;
  const normalized = error instanceof Error ? error : new Error("Captcha errored.");
  if (!attempt) {
    rejectInstance(normalized);
    return;
  }
  settleAttempt(attempt, () => attempt.reject(normalized));
}

interface CaptchaInstanceEntry {
  key: string;
  initStartedAt: number;
  instance: Promise<AliyunCaptchaInstance>;
}

let instanceEntry: CaptchaInstanceEntry | null = null;

function readInstanceKey(config: AliyunCaptchaRuntimeConfig, language: string): string {
  return `${config.region}:${config.prefix}:${config.sceneId}:${language}`;
}

function getCaptchaInstance(
  config: AliyunCaptchaRuntimeConfig,
  language: string,
): Promise<AliyunCaptchaInstance> {
  const key = readInstanceKey(config, language);
  if (
    instanceEntry &&
    instanceEntry.key === key &&
    Date.now() - instanceEntry.initStartedAt < INSTANCE_FRESH_MS
  ) {
    return instanceEntry.instance;
  }
  // 缓存条目必须在首个 await 之前同步登记：预热与点击领取并发时，
  // 两个调用会共享同一次初始化，否则 SDK 会被 init 两次导致回调串扰。
  const instance = initializeCaptchaInstance(config, language);
  instanceEntry = { key, initStartedAt: Date.now(), instance };
  // 实例失败（含预热期超时）不能留在缓存里：20 分钟内同 key 复用会让下一次领取直接失败。
  void instance.catch(() => {
    if (instanceEntry?.instance === instance) instanceEntry = null;
  });
  return instance;
}

async function initializeCaptchaInstance(
  config: AliyunCaptchaRuntimeConfig,
  language: string,
): Promise<AliyunCaptchaInstance> {
  window.AliyunCaptchaConfig = { region: config.region, prefix: config.prefix };
  await loadCaptchaScript();
  const init = window.initAliyunCaptcha;
  if (typeof init !== "function") throw new Error("Captcha SDK is unavailable.");
  ensureCaptchaContainer();
  window.AliyunCaptchaConfig = { region: config.region, prefix: config.prefix };
  return await new Promise<AliyunCaptchaInstance>((resolve, rejectInstance) => {
    const timer = setTimeout(
      () =>
        rejectInstance(
          new Error(`Captcha instance timed out after ${INSTANCE_WAIT_TIMEOUT_MS}ms.`),
        ),
      INSTANCE_WAIT_TIMEOUT_MS,
    );
    try {
      const initResult = init({
        SceneId: config.sceneId,
        region: config.region,
        prefix: config.prefix,
        mode: "popup",
        language,
        showErrorTip: false,
        element: ELEMENT_SELECTOR,
        button: BUTTON_SELECTOR,
        getInstance: (ready) => {
          clearTimeout(timer);
          resolve(ready);
        },
        success: (param) => routeSdkSuccess(param),
        fail: (error) => routeSdkFailure(error, rejectInstance),
        onError: (error) => routeSdkError(error, rejectInstance),
      });
      if (
        typeof initResult === "object" &&
        initResult !== null &&
        typeof (initResult as PromiseLike<unknown>).then === "function"
      ) {
        void Promise.resolve(initResult).then(undefined, (error: unknown) => {
          clearTimeout(timer);
          rejectInstance(error instanceof Error ? error : new Error(String(error)));
        });
      }
    } catch (error) {
      clearTimeout(timer);
      rejectInstance(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

// 验证一次只跑一个：SDK 的 success/fail 回调没有请求标识，并发会串扰。
let verificationQueue: Promise<unknown> = Promise.resolve();

async function runVerification(
  config: AliyunCaptchaRuntimeConfig,
  signal: AbortSignal,
): Promise<string> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Captcha requires browser environment.");
  }
  if (activeAttempt) throw new Error("Captcha verification is already in progress.");
  const language = resolveCaptchaLanguage();
  const instance = await getCaptchaInstance(config, language);
  signal.throwIfAborted();
  return await new Promise<string>((resolve, reject) => {
    const attempt: ActiveAttempt = {
      resolve,
      reject,
      interactiveTriggered: false,
      cleanup: () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      },
    };
    const timer = setTimeout(() => {
      settleAttempt(attempt, () =>
        reject(new Error(`Captcha verification timed out after ${VERIFY_TIMEOUT_MS}ms.`)),
      );
    }, VERIFY_TIMEOUT_MS);
    const onAbort = () => {
      settleAttempt(attempt, () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // 先挂 attempt 再查 abort：否则 settleAttempt 的身份检查会让 promise 永不落定。
    activeAttempt = attempt;
    if (signal.aborted) {
      onAbort();
      return;
    }
    // 无痕验证优先：多数账号静默通过；SDK 不支持时直接走交互弹窗。
    if (typeof instance.startTracelessVerification === "function") {
      try {
        instance.startTracelessVerification();
      } catch (error) {
        settleAttempt(attempt, () =>
          reject(error instanceof Error ? error : new Error("Captcha failed.")),
        );
      }
      return;
    }
    triggerInteractiveChallenge();
  });
}

export async function resolveAliyunCaptchaVerifyParam(
  config: AliyunCaptchaRuntimeConfig,
  signal: AbortSignal,
): Promise<string> {
  const next = verificationQueue.then(
    () => runVerification(config, signal),
    () => runVerification(config, signal),
  );
  verificationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

// Banner 可见时预加载 SDK 与实例，点击 Claim 时无需等待脚本下载。
export async function prewarmAliyunCaptcha(config: AliyunCaptchaRuntimeConfig): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  await getCaptchaInstance(config, resolveCaptchaLanguage());
}
