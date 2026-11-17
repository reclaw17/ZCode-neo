# ZCode-neo

A privacy-hardened fork of [ZCode](https://github.com/zai-org/ZCode) v3.18.2, the AI coding
workstation from Z.AI (desktop, web, and terminal agent). Same product, same models, no
telemetry.

The upstream client reports analytics to Alibaba ARMS RUM, ships events to a Z.AI collector,
tags every Anthropic-protocol request with a persistent device id, and embeds a geo hint in
every API call. This fork removes all of it at the source level, then proves the result with
a live network probe of the packaged app.

The full upstream READMEs (setup, development, packaging, repo layout) are preserved as
[README.upstream.zh.md](README.upstream.zh.md) and
[README.upstream.en.md](README.upstream.en.md); everything they document still applies to
this fork unless the table below says otherwise.

## What is removed or disabled

| Mechanism | Upstream behavior | This fork |
|---|---|---|
| ARMS RUM (`@arms/rum-*`) | Real-user monitoring, session replay snapshots, crash reports uploaded to the ARMS collector | Endpoint hardcoded empty at build time; SDK stays in the bundle as dead code; local store stays empty |
| Event reporter | Usage events posted to `zcode.z.ai/api/v1/event/report` | Endpoint hardcoded empty at build time |
| Device attribution in Anthropic requests | Persistent `deviceMid` UUID from `telemetry-state.json` sent as `metadata.user_id` on every model request | Resolver returns nothing; metadata key never set |
| Crash reporter | Remote crash upload through ARMS | Crash target is a non-resolvable `.invalid` host; dumps stay local |
| Auto-update | electron-updater with a remote feed | Disabled unless `ZCODE_AUTO_UPDATE=1\|true\|yes`; updates are a manual rebuild from this repo |
| Geo hint in API headers | `X-Client-Timezone` on every ZCode endpoint request | Header removed |
| Device id in update checks | `X-Device-Mid` sent with the electron update manifest request | Header removed |

Fork policy lives in `scripts/build-time-config.mjs`: telemetry is forced off by the build
resolver itself, so no environment variable and no private build defaults file can turn it
back on.

## What is kept, and why

Two identifiers survive, because the Z.AI server contract requires them and dropping either
one breaks a user-facing feature. This was measured, not assumed:

- `X-Device-Mid` on marketing-touch promo polling. Without it the promo endpoint answers
  `HTTP 400 code 3001` and all campaign banners and claim actions die. Promo campaigns are
  a paid feature of Coding Plan subscriptions.
- `X-Device-Mid` and `X-Client-Language` on core API requests. These identify the session to
  the server you are logged in to. `telemetry-state.json` with the device UUID is still
  generated locally; it never leaves the disk through any dead channel.

Everything else that leaves the machine goes where you would expect: `zcode.z.ai` and
`api.z.ai` for the product and OAuth, `bigmodel.cn` for inference, the CDN for plugin assets.
A full domain registry was compiled from the compiled bundle and reviewed endpoint by
endpoint.

## Verification

The audit that produced this fork is reproducible from the repo:

- Build the production AppImage, run it, watch its sockets. Zero connections to ARMS
  collectors or event endpoints over the whole session; a single product API connection.
- Contract tests cover the fork semantics: `scripts/test/build-time-config.test.mjs` (5),
  desktop telemetry field contracts (18), marketing-touch and arms-patch contracts (8).
- The full package suite passes except known environment classes: `@zcode/cli`, `@zcode/tui`
  and the MCP e2e files require Node 24.14 (the pinned `mise.toml` version) and fail on the
  Node 26 present on the build box; the same failures reproduce on clean upstream.

## Building the desktop AppImage

```bash
pnpm install
ZCODE_ENV=production pnpm bundle:desktop -- --os linux --arch x64
```

`ZCODE_ENV=production` matters: without it the bundle builds in the local flavor and the
OAuth login page on `zcode.z.ai` rejects the session. The AppImage lands in
`packages/desktop/dist/`. DEB/RPM/pacman targets need `libcrypt.so.1` and fail on modern
Arch; the AppImage target completes before them and is unaffected.

On Linux, register the `zcode://` deep link once so OAuth login can return to the app:
create `~/.local/share/applications/zcode-neo.desktop` pointing at the AppImage with
`MimeType=x-scheme-handler/zcode;` and run
`xdg-mime default zcode-neo.desktop x-scheme-handler/zcode`.

## Syncing upstream

Upstream tags source syncs (`chore: sync ZCode source vX.Y.Z`). To take an update:

```bash
git remote add upstream https://github.com/zai-org/ZCode.git
git fetch upstream
git merge upstream/main   # expect conflicts in the fork-policy files
```

The files this fork owns: `scripts/build-time-config.mjs` and its test,
`apps/zcode-cli/packages/adapters/src/model/anthropic-request-metadata.ts` and its test,
`packages/shared/src/zcode-source-headers.ts`,
`packages/desktop/src/main/manifestUpdateProvider.ts`,
`packages/services/src/marketing-touch/marketingTouchService.ts`, `pnpm-workspace.yaml`.
Re-apply the fork policy from the table above, rerun the contract tests, rebuild.

## Credits

All credit for the product itself goes to the Z.AI ZCode team; this repo only carries the
privacy patch layer. Apache 2.0, as upstream.
