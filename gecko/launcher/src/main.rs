//! Wings' launcher: starts the browser's own application (app\, its interface and back
//! end) on Mozilla's Gecko core (engine\: the engine only, none of Firefox's interface), with the
//! profile kept beside it (profile\), so nothing of the browser's goes to %APPDATA% on drive C.
//! Links and files it is given (as the default browser, from Explorer) are passed on.
#![windows_subsystem = "windows"]
use std::{env, os::windows::process::CommandExt, process::Command};

fn main() {
    let Some(here) = env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) else { return };
    let engine = here.join("engine").join("Wings.exe");
    let app = here.join("app").join("application.ini");
    let profile = here.join("profile");
    let _ = std::fs::create_dir_all(&profile);
    let mut c = Command::new(&engine);
    c.arg("-app").arg(&app);
    c.arg("-profile").arg(&profile);
    c.args(env::args_os().skip(1));
    // (the engine's own small files, kept with the profile instead of %APPDATA% / %LOCALAPPDATA% on C:)
    c.env("MOZ_APP_DATA", profile.join("appdata"));
    c.env("MOZ_LOCAL_APP_DATA", profile.join("appdata-local"));
    // (no crash reports)
    c.env("MOZ_CRASHREPORTER_DISABLE", "1");
    c.env("MOZ_CRASHREPORTER_NO_REPORT", "1");
    // (a new process group, so the browser outlives this launcher)
    c.creation_flags(0x0000_0200);
    let _ = c.spawn();
}
