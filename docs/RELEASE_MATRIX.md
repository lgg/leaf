# Leaf desktop — multi-platform distribution matrix

**Scope decision (2026-11-23):** Keep the proven Windows Portable ZIP and existing .NET per-user Setup EXE. Do **not** build NSIS/MSI installers, register `.md`/`.txt` file associations or implement the separate signed Tauri updater. The current explicit user-approved Windows GitHub Releases updater remains supported (official HTTPS, asset size and SHA-256 verification, no forced downloads or installations).

Windows **v1.11.2-lgg.1-windows-rc.1** is already published as an unsigned prerelease after successful exact-`main` Windows CI and publisher validation. This is not a claim that all real GUI acceptance scenarios have passed. General release may proceed only after complete manual acceptance in **#11**.

## Target assets

| Platform | Release assets | Runner |
| --- | --- | --- |
| Windows x64 | Existing `Leaf-Windows-10-11-x64-Portable.zip` and `Leaf-Windows-10-11-x64-Setup.exe` (per-user .NET) | Existing self-hosted `leaf-runner-ci` |
| Linux x64 | `Leaf-linux-x64.deb`, `Leaf-linux-x64.AppImage` | Self-hosted Linux `leaf-linux-ci` |
| macOS universal | `Leaf-macos-universal.dmg`, `Leaf-macos-universal-app.tar.gz` (.app with arm64 + x86_64) | Self-hosted macOS `leaf-runner-macos-ci` |

Do not use GitHub-hosted runners. Do not install system software, Rust/Node/toolchains, SDKs or download bundler prerequisites onto any self-hosted runner without the owner's explicit authorization. Mac runner belongs to a friend and must remain no-install/offline per existing workflow safeguards. Bundle prerequisites must be preinstalled and cached before launching build workflows.

## Windows

`desktop-windows.yml` builds, privacy-scans and retains the EXE and Portable ZIP and packages the existing unsigned **.NET per-user Setup** on the same exact commit; no NSIS dependency or optional installer switch. `windows-preview-release.yml` publishes both from validated `main` workflow artifacts with SHA-256 and binary provenance checks. Real-device GUI acceptance and updater smoke checks belong in **#11**.

No installer file associations, Explorer `Open with` integration or signed Tauri updater are planned. Native in-app Open/Save As, drag-and-drop and the user-approved Windows update flow remain supported.

## Linux

`desktop-linux.yml` prepares `.deb` and AppImage after JS/Rust tests; requires a pre-provisioned Linux x64 self-hosted runner, Rust/Node/cargo-tauri, `webkit2gtk-4.1` development files, `pkg-config`, `dpkg-deb` and approved AppImage bundler prerequisites. Prefer an older-compatible build host; AppImage still needs supported WebKitGTK runtime on the target desktop.

## macOS

`desktop-macos.yml` targets universal Apple Silicon + Intel `.app` and `.dmg` using pre-existing local tools, both Rust targets and an Apple SDK. It is **manual-dispatch only**, fails if prerequisites are missing, uses `CARGO_NET_OFFLINE=true` and `RUSTUP_AUTO_INSTALL=0`. No toolchain or dependency download may be initiated on the friend's machine. The initial app is ad-hoc signed (not Developer ID notarized) and may require explicit user approval in macOS System Settings.

## Release gates

1. Finish independent Linux and macOS packaging code/runner prerequisites and produce successful artifacts from the **same exact main SHA** as Windows.
2. Verify provenance, binary privacy checks and SHA-256 for every package.
3. Complete actual Windows, Linux and macOS GUI/manual acceptance in **#11** using synthetic documents; CI success alone is insufficient.
4. The `desktop-release.yml` full-matrix publisher must require both existing Windows assets, Linux DEB/AppImage, macOS app/DMG. A `publish=true` full release must reject an open #11; drafts may be prepared while acceptance is pending.
5. Preserve the working opt-in Windows update experience; no forced/silent installation and no unapproved runner changes.

Tracking: **#12** is the distribution umbrella. Platform-specific implementation tasks are linked there, and **#11** owns all manual acceptance. Historical #22 is superseded by the consolidated #11 checklist.

## Cross-platform source hardening (coding issues #38/#39/#40)

The desktop bridge uses a native compile-time `desktop_platform` command to label Linux/macOS editions correctly and suppress Windows PowerShell/update controls outside Windows. Desktop HTML also has a build-time platform marker for CSS-only hiding before the native bridge loads. Windows updater and its exact downloaded-asset verification remain unchanged.

Linux packaging produces `SHA256SUMS.linux.txt` alongside its .deb/AppImage candidates. The macOS workflow uses Mach-O `arm64` (Rust target `aarch64-apple-darwin`) and `x86_64` when verifying both universal slices with `lipo`, and produces `SHA256SUMS.macos.txt`. These are **source/workflow improvements, not proof of completed builds**. Until approved self-hosted platform runs succeed and manual #11 is checked, do not claim Linux/macOS artifacts are ready.
