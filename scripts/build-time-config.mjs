/**
 * 桌面构建期可选能力的唯一解析入口：ARMS RUM 上报、事件上报、自动更新。
 * FORK POLICY (reclaw17/ZCode): telemetry is hard-disabled. Upstream resolved
 * ARMS RUM and the zcode.z.ai event reporter from build env or
 * config/private/build-defaults.json (see docs/desktop/build-time-optional-capabilities.md);
 * this fork ignores both sources so neither an accidental env var nor a dropped-in
 * private defaults file can re-enable either reporter.
 *
 * Auto-update keeps the upstream env-only gate (ZCODE_AUTO_UPDATE=1|true|yes at
 * build time): the mechanism stays available for manual update checks, while the
 * private-defaults path is gone with the rest of the file resolution.
 */
const ENABLED_VALUES = new Set(["1", "true", "yes"]);

export async function resolveBuildTimeConfig(
  env = process.env,
  _options = {},
) {
  return {
    armsRumEndpoint: "",
    telemetryReportEndpoint: "",
    autoUpdateEnabled: ENABLED_VALUES.has(
      String(env.ZCODE_AUTO_UPDATE ?? "").trim().toLowerCase(),
    ),
  };
}

export function createBuildTimeConfigDefines(config) {
  return {
    __ZCODE_ARMS_RUM_ENDPOINT__: JSON.stringify(config.armsRumEndpoint),
    __ZCODE_TELEMETRY_REPORT_ENDPOINT__: JSON.stringify(config.telemetryReportEndpoint),
    __ZCODE_AUTO_UPDATE_ENABLED__: JSON.stringify(config.autoUpdateEnabled),
  };
}
