//! Where things go. The profile is the folder the Gecko side names (beside the browser, on the drive it
//! was put on: never under %APPDATA% / %LOCALAPPDATA% by choice).
use std::{path::PathBuf, sync::OnceLock};

static PROFILE: OnceLock<PathBuf> = OnceLock::new();

pub fn set_profile(p: PathBuf) {
    let _ = PROFILE.set(p);
}

pub fn profile_dir() -> PathBuf {
    PROFILE.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("Wings"))
}

pub fn downloads_default() -> PathBuf {
    dirs::download_dir().unwrap_or_else(|| profile_dir().join("downloads"))
}

#[allow(dead_code)]
pub fn pictures_dir() -> PathBuf {
    dirs::picture_dir().map(|p| p.join("Wings")).unwrap_or_else(|| profile_dir().join("screenshots"))
}
