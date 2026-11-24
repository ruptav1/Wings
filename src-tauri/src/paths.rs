//! Where the profile lives. Never under %APPDATA% / %LOCALAPPDATA% by choice: those are on C:, and the
//! browser should stay on the drive it was put on. Order:
//!   1. UNK_PROFILE (a folder of one's own: portable use, testing)
//!   2. <project>/profile when run from `cargo`/`tauri dev` (target\debug or target\release)
//!   3. <folder of the exe>/profile, when that folder can be written to
//!   4. %LOCALAPPDATA%\UnknowWeb as a last resort (an install under Program Files)
use std::{env, fs, path::PathBuf};

pub fn profile_dir() -> PathBuf {
    if let Ok(p) = env::var("UNK_PROFILE") {
        let p = PathBuf::from(p);
        if fs::create_dir_all(&p).is_ok() {
            return p;
        }
    }
    if let Some(exe_dir) = env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        // dev builds: src-tauri\target\<profile>\UnknowWeb.exe -> <project>\profile
        let s = exe_dir.to_string_lossy().to_lowercase();
        if s.ends_with("\\target\\debug") || s.ends_with("\\target\\release") {
            if let Some(project) = exe_dir.parent().and_then(|t| t.parent()).and_then(|s| s.parent()) {
                let p = project.join("profile");
                if writable(&p) {
                    return p;
                }
            }
        }
        let p = exe_dir.join("profile");
        if writable(&p) {
            return p;
        }
    }
    let p = dirs::data_local_dir().unwrap_or_else(env::temp_dir).join("UnknowWeb");
    let _ = fs::create_dir_all(&p);
    p
}

fn writable(p: &PathBuf) -> bool {
    if fs::create_dir_all(p).is_err() {
        return false;
    }
    let probe = p.join(".write-test");
    let ok = fs::write(&probe, b"ok").is_ok();
    let _ = fs::remove_file(probe);
    ok
}

pub fn downloads_default() -> PathBuf {
    dirs::download_dir().unwrap_or_else(|| profile_dir().join("downloads"))
}

pub fn pictures_dir() -> PathBuf {
    dirs::picture_dir().map(|p| p.join("UnknowWeb")).unwrap_or_else(|| profile_dir().join("screenshots"))
}
