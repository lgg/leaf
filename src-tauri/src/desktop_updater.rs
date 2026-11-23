//! Local Windows-only update broker; no network URLs or filesystem paths come
//! from the renderer. The helper is compiled into Leaf, and receives only fixed
//! commands and an exact version tag. Unsigned-preview trust = GitHub HTTPS plus
//! the SHA-256 digest on the GitHub release asset (not equivalent to a signature).
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::{Path, PathBuf}, process::{Command, Stdio}, sync::Mutex};
use tauri::{Manager, State};
// GUI apps must suppress the Windows console at process creation: PowerShell's
// -WindowStyle Hidden alone can flash a blue console before it processes args.
#[cfg(target_os="windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os="windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const CURRENT_TAG: &str = "v1.11.5-lgg.1-windows-rc.1";
const ASSET_PORTABLE: &str = "Leaf-Windows-10-11-x64-Portable.zip";
const ASSET_SETUP: &str = "Leaf-Windows-10-11-x64-Setup.exe";
const HELPER: &str = include_str!("../../desktop/windows-update-agent.ps1");

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    pub tag: String,
    pub current_tag: String,
    pub notes: String,
    pub release_url: String,
    pub mode: String,
    pub bytes: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Downloaded {
    tag: String,
    mode: String,
    path: String,
    sha256: String,
    bytes: u64,
}
struct Pending {
    tag: String,
    path: PathBuf,
    sha256: String,
    mode: String,
}
#[derive(Default)]
pub(crate) struct UpdaterState {
    pending: Mutex<Option<Pending>>,
}
fn checked_tag(tag: &str) -> bool {
    let Some(rest) = tag.strip_prefix('v') else { return false; };
    let Some((version, rc)) = rest.split_once("-lgg.") else { return false; };
    let digits: Vec<_> = version.split('.').collect();
    if digits.len() != 3 || digits.iter().any(|x| x.is_empty() || !x.bytes().all(|c| c.is_ascii_digit())) {
        return false;
    }
    let (fork, candidate) = match rc.split_once("-windows-rc.") {
        Some(pair) => pair,
        None => (rc,""),
    };
    !fork.is_empty() && fork.bytes().all(|c| c.is_ascii_digit()) &&
        (candidate.is_empty() || candidate.bytes().all(|c| c.is_ascii_digit()))
}
fn mode() -> Result<&'static str,String> {
    let exe = std::env::current_exe().map_err(|_| "Cannot locate running Leaf executable.")?;
    let local = std::env::var_os("LOCALAPPDATA").ok_or("Local application data is unavailable.")?;
    let installed = PathBuf::from(local).join("Programs").join("Leaf").join("leaf-desktop.exe");
    if exe.to_string_lossy().eq_ignore_ascii_case(&installed.to_string_lossy()) { Ok("installed") }
    else { Ok("portable") }
}
#[tauri::command]
pub(crate) fn desktop_installation_mode() -> Result<String,String> {
    mode().map(str::to_owned)
}

fn script_path(app: &tauri::AppHandle) -> Result<PathBuf,String> {
    let folder = app.path().app_cache_dir().map_err(|_| "Cannot locate Leaf cache.")?.join("updates");
    fs::create_dir_all(&folder).map_err(|_| "Cannot create Leaf updater directory.")?;
    let file = folder.join("leaf-update-agent.ps1");
    // Always refresh script from trusted EXE rather than trusting a cached copy.
    let temp = folder.join(format!("leaf-update-agent-{}.tmp",std::process::id()));
    fs::write(&temp, HELPER).map_err(|_| "Cannot prepare the updater helper.")?;
    if file.exists() { fs::remove_file(&file).map_err(|_| "Cannot refresh updater helper.")?; }
    fs::rename(temp, &file).map_err(|_| "Cannot activate updater helper.")?;
    Ok(file)
}
fn invoke_helper(app: &tauri::AppHandle, arguments: &[String]) -> Result<String,String> {
    #[cfg(not(target_os="windows"))]
    { let _ = (app,arguments); return Err("Windows updater is unavailable on this platform.".into()); }
    #[cfg(target_os="windows")]
    {
        let script = script_path(app)?;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File"])
            .arg(script)
            .args(arguments)
            .creation_flags(CREATE_NO_WINDOW)
            .output().map_err(|_| "Cannot start built-in Windows update service.")?;
        if !output.status.success() { return Err("GitHub update check/download failed. Check connection, storage, or GitHub availability.".into()); }
        if output.stdout.len() > 16384 { return Err("Update metadata exceeded its limit.".into()); }
        String::from_utf8(output.stdout).map_err(|_| "Invalid update helper response.".into())
    }
}
fn agent_args(action: &str, version: Option<&str>, app_mode: &str, folder: Option<&Path>) -> Vec<String> {
    let mut args = vec!["-Mode".to_owned(),action.to_owned(),
        "-CurrentTag".to_owned(),CURRENT_TAG.to_owned(),
        "-AppMode".to_owned(),app_mode.to_owned()];
    if let Some(tag) = version { args.extend(["-Tag".to_owned(), tag.to_owned()]); }
    if let Some(folder) = folder { args.extend(["-CacheFolder".to_owned(),folder.to_string_lossy().into_owned()]); }
    args
}
fn check(app: &tauri::AppHandle) -> Result<Option<UpdateInfo>,String> {
    let app_mode = mode()?;
    let text = invoke_helper(app,&agent_args("Check",None,app_mode,None))?;
    let update: Option<UpdateInfo> = serde_json::from_str(text.trim()).map_err(|_| "GitHub release response is invalid.")?;
    if let Some(ref info) = update {
        if !checked_tag(&info.tag) || info.current_tag != CURRENT_TAG || info.mode != app_mode
            || !info.release_url.starts_with("https://github.com/lgg/leaf/releases/tag/")
            || info.bytes < 1024 || info.bytes > 104857600 {
            return Err("GitHub release metadata failed validation.".into());
        }
    }
    Ok(update)
}
fn sha_file(file: &Path) -> Result<String,String> {
    let mut handle = fs::File::open(file).map_err(|_| "Downloaded update cannot be read.")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8;65536];
    let mut total = 0u64;
    loop {
        let n = handle.read(&mut buffer).map_err(|_| "Cannot verify downloaded update.")?;
        if n == 0 { break }
        total += n as u64;
        if total > 104857600 { return Err("Update package exceeded 100MB.".into()) }
        hash.update(&buffer[..n]);
    }
    Ok(hex::encode(hash.finalize()))
}
#[tauri::command]
pub(crate) async fn desktop_check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>,String> {
    tauri::async_runtime::spawn_blocking(move || check(&app)).await.map_err(|_| "Update task interrupted.".to_owned())?
}
#[tauri::command]
pub(crate) async fn desktop_download_update(app: tauri::AppHandle, state: State<'_, UpdaterState>, tag: String) -> Result<UpdateInfo,String> {
    if !checked_tag(&tag) { return Err("Unknown release version.".into()); }
    let app_for_download = app.clone();
    let requested = tag.clone();
    let (info, record) = tauri::async_runtime::spawn_blocking(move || {
        let info = check(&app_for_download)?.ok_or("No newer Windows version available.")?;
        if info.tag != requested { return Err("Release has changed; check updates again.".into()); }
        let folder = app_for_download.path().app_cache_dir().map_err(|_| "Cannot locate download cache.")?
            .join("updates").join(&requested);
        let text = invoke_helper(&app_for_download, &agent_args("Download",Some(&requested),&info.mode,Some(&folder)))?;
        let file: Downloaded = serde_json::from_str(text.trim()).map_err(|_| "Invalid downloaded package status.")?;
        let expected_file = if info.mode == "installed" { ASSET_SETUP } else { ASSET_PORTABLE };
        let path = PathBuf::from(&file.path);
        if file.tag != requested || file.mode != info.mode || path != folder.join(expected_file) ||
            file.sha256.len() != 64 || !file.sha256.bytes().all(|b|b.is_ascii_hexdigit()) ||
            file.bytes != info.bytes || sha_file(&path)? != file.sha256 {
            return Err("Downloaded update failed provenance and integrity checks.".into());
        }
        Ok::<_,String>((info,Pending {tag:requested,path,sha256:file.sha256,mode:file.mode}))
    }).await.map_err(|_| "Update download interrupted.".to_owned())??;
    *state.pending.lock().map_err(|_| "Updater queue is unavailable.")? = Some(record);
    Ok(info)
}
#[tauri::command]
pub(crate) fn desktop_apply_update(app: tauri::AppHandle, state: State<'_, UpdaterState>, tag: String) -> Result<(),String> {
    #[cfg(not(target_os="windows"))]
    { let _ = (app,state,tag); return Err("Windows updater is unavailable.".into()); }
    #[cfg(target_os="windows")]
    {
        let guard = state.pending.lock().map_err(|_| "Updater queue unavailable.")?;
        let pending = guard.as_ref().ok_or("Download an update first.")?;
        if pending.tag != tag || !checked_tag(&pending.tag) || pending.mode != mode()?
            || sha_file(&pending.path)? != pending.sha256 {
            return Err("Update package changed; download it again.".into());
        }
        let target = std::env::current_exe().map_err(|_| "Cannot locate running Leaf executable.")?;
        let script = script_path(&app)?;
        Command::new("powershell.exe")
            .args(["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-File"])
            .arg(script)
            .args(["-Mode","Apply","-AppMode",&pending.mode,"-WaitPid"])
            .arg(std::process::id().to_string())
            .arg("-Package").arg(&pending.path)
            .arg("-ExpectedSha").arg(&pending.sha256)
            .arg("-Target").arg(&target)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn().map_err(|_| "Cannot launch the update handoff helper.")?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn updater_rejects_untrusted_versions() {
        assert!(checked_tag("v1.10.3-lgg.1-windows-rc.1"));
        assert!(checked_tag("v2.0.0-lgg.4"));
        for bad in ["http://github.com/","v2.0.0-lgg.1/evil","1.10.3","v1.0-lgg.1","v1.2.3-lgg.1-windows-rc.bad"] {
            assert!(!checked_tag(bad),"{bad}");
        }
    }
    #[test]
    fn downloaded_hash_is_bounded_and_exact() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("test.zip");
        fs::write(&file,b"Leaf").unwrap();
        assert_eq!(sha_file(&file).unwrap(), hex::encode(Sha256::digest(b"Leaf")));
    }
}
