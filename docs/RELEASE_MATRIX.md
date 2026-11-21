# Leaf desktop — multi-platform release matrix

**Status (2026-11-21): source and CI wiring only; cross-platform builds and real GUI acceptance are not yet verified. Do not describe an artifact as a public release until every gate below passes.**

## Target outputs

| Platform | Required release assets | Runner |
| --- | --- | --- |
| Windows x64 | Portable `leaf-desktop.exe` (ZIP), unsigned NSIS setup `.exe` | Existing self-hosted `leaf-runner-ci` |
| Linux x64 | `Leaf-linux-x64.deb`, `Leaf-linux-x64.AppImage` | Self-hosted Linux x64, label `leaf-linux-ci` |
| macOS universal | `Leaf-macos-universal.dmg`, `Leaf-macos-universal-app.tar.gz` (.app for arm64 + x86_64) | Self-hosted macOS, label `leaf-macos-ci` |

No GitHub-hosted runners are used. Neither CI workflow installs system packages, Rust targets, Tauri CLI, NSIS or SDKs. Build tools and native UI dependencies must already be available; fail closed if not. The Tauri bundlers may fetch helper assets into tool caches, so installer packaging is opt-in, and Linux/macOS workflows are only manually dispatched after the maintainer approves and provisions the machine.

## Windows

The normal `desktop-windows.yml` push workflow builds and privacy-scans the EXE, then creates the portable ZIP. The optional `workflow_dispatch` input `build_installer=true` also attempts an **unsigned NSIS installer** if `cargo-tauri` and `makensis.exe` are already available, using the already-checked release executable. If either tool is absent, it fails the requested installer step rather than publishing a partial installer. It may still need pre-cached Tauri NSIS bundle assets.

Windows OS file associations require an installer; portable EXE is intentionally not presented as having them. Check exact-commit build hashes and the `Verify compiled EXE contains no private workstation paths` gate before any distribution.

## Linux

`desktop-linux.yml` builds .deb and AppImage for x64, after JavaScript/Rust tests. Recommended oldest supported build host is Ubuntu 22.04 or Debian 12 to avoid new glibc dependencies. Pre-provision Rust, cargo-tauri, Node, `webkit2gtk-4.1` development headers, `pkg-config`, `dpkg-deb` and AppImage bundler requirements. WebKitGTK is a native system prerequisite; an AppImage is not a promise of completely standalone runtime support. No silent provisioning.

## macOS

`desktop-macos.yml` builds a universal x86_64 + arm64 app and a DMG, using preinstalled Rust targets on a real macOS runner. System `sips`/`iconutil` generate an `.icns` from the committed PNG. Bundles are **ad-hoc signed** (`signingIdentity: "-"`) rather than Developer ID signed or notarized. Gatekeeper warnings may require user approval in System Settings on macOS; do not bypass OS security controls automatically.

## Release gates

1. Merge all validated code and ensure Windows `main` CI and Pages checks are green at the exact release commit.
2. Run Windows installer packaging via manual workflow and verify portable and installer run on Windows with synthetic files. Document all scenarios in issue #11, including stale-file and recovery edge cases.
3. Provision Linux and macOS self-hosted runners; dispatch both platform workflows on the *same exact main commit*. Confirm uploads contain every matrix asset; smoke-test binaries on actual machines.
4. Freeze commit, pin release tag only to it, generate a SHA-256 manifest for downloaded assets, publish GitHub Release with platform-specific artifacts and clear notice about unsigned installers.
5. Do not claim signed automatic updates; the app only checks GitHub Releases and offers manual downloads. A future opt-in signed updater requires signing secrets.

The remaining distribution prerequisites are tracked in issue #12. A green CI build alone is not evidence of real desktop GUI acceptance.
