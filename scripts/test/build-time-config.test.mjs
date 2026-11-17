import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { createBuildTimeConfigDefines, resolveBuildTimeConfig } from "../build-time-config.mjs";

const dir = await mkdtemp(join(tmpdir(), "zcode-build-time-config-"));
after(() => rm(dir, { recursive: true, force: true }));

async function writeDefaults(name, content) {
  const path = join(dir, name);
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

test("没有私有默认配置也没有环境变量时三项能力都关闭", async () => {
  const config = await resolveBuildTimeConfig({}, { defaultsPath: join(dir, "missing.json") });
  assert.deepEqual(config, {
    armsRumEndpoint: "",
      forkTag: "neo.3",
    telemetryReportEndpoint: "",
    autoUpdateEnabled: false,
  });
});

test("FORK POLICY: без телеметрии и автообновления даже при приватных дефолтах", async () => {
  const defaultsPath = await writeDefaults("defaults.json", {
    ZCODE_ARMS_RUM_ENDPOINT: " https://rum.example.com/x ",
    ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://report.example.com/event",
    ZCODE_AUTO_UPDATE: "1",
  });
  assert.deepEqual(await resolveBuildTimeConfig({}, { defaultsPath }), {
    armsRumEndpoint: "",
      forkTag: "neo.3",
    telemetryReportEndpoint: "",
    autoUpdateEnabled: false,
  });
});

test("FORK POLICY: телеметрия не включается env, автообновление — env-гейт остаётся", async () => {
  const defaultsPath = await writeDefaults("override.json", {
    ZCODE_ARMS_RUM_ENDPOINT: "https://rum.example.com/x",
    ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://report.example.com/event",
    ZCODE_AUTO_UPDATE: "true",
  });
  assert.deepEqual(
    await resolveBuildTimeConfig(
      {
        ZCODE_ARMS_RUM_ENDPOINT: "https://evil.example.com/rum",
        ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://other.example.com/event",
        ZCODE_AUTO_UPDATE: "1",
      },
      { defaultsPath },
    ),
    {
      armsRumEndpoint: "",
      forkTag: "neo.3",
      telemetryReportEndpoint: "",
      autoUpdateEnabled: true,
    },
  );
});

test("FORK POLICY: битый приватный конфиг игнорируется, ошибки нет", async () => {
  const defaultsPath = await writeDefaults("broken.json", "[1]");
  assert.deepEqual(await resolveBuildTimeConfig({}, { defaultsPath }), {
    armsRumEndpoint: "",
      forkTag: "neo.3",
    telemetryReportEndpoint: "",
    autoUpdateEnabled: false,
  });
});

test("define 以 JSON 字面量注入", () => {
  assert.deepEqual(
    createBuildTimeConfigDefines({
      forkTag: "neo.3",
      armsRumEndpoint: "https://rum.example.com/x",
      telemetryReportEndpoint: "",
      autoUpdateEnabled: true,
    }),
    {
      __ZCODE_FORK_TAG__: '"neo.3"',
      __ZCODE_ARMS_RUM_ENDPOINT__: '"https://rum.example.com/x"',
      __ZCODE_TELEMETRY_REPORT_ENDPOINT__: '""',
      __ZCODE_AUTO_UPDATE_ENABLED__: "true",
    },
  );
});
