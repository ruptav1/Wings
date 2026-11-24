//! Cloudflare WARP as the way out (from TyranWeb; Settings → Quyền riêng tư → Cloudflare WARP): with
//! WARP's own app installed and in its proxy mode (a SOCKS5 proxy on this computer), the browser's
//! pages go through it (the Gecko side sets the engine's proxy); other programs are left as they are.
//! WARP is driven with its own command line (warp-cli): its mode is changed only when the user
//! presses for it, and it is connected when the setting is on.
use serde_json::{json, Value};
use std::{os::windows::process::CommandExt, path::PathBuf, process::Command, time::Duration};

fn cli() -> PathBuf {
    PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into())).join("Cloudflare").join("Cloudflare WARP").join("warp-cli.exe")
}

fn run(args: &[&str]) -> (bool, String) {
    match Command::new(cli()).args(args).creation_flags(0x0800_0000).output() {
        Ok(o) => (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))),
        Err(e) => (false, e.to_string()),
    }
}

fn find<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    // (lines read "(user set)	Mode: WarpProxy on port 40000")
    text.lines().find_map(|l| l.find(key).map(|i| l[i + key.len()..].trim()))
}

pub fn state() -> Value {
    if !cli().exists() {
        return json!({ "installed": false });
    }
    let (_, st) = run(&["status"]);
    let (_, set) = run(&["settings"]);
    let mode = find(&set, "Mode:").unwrap_or("").to_string();
    let port: u64 = mode.to_lowercase().split("port").nth(1).map(|r| r.trim().chars().take_while(|c| c.is_ascii_digit()).collect::<String>()).and_then(|s| s.parse().ok()).unwrap_or(0);
    let proxy = mode.to_lowercase().contains("proxy") && port > 0;
    json!({ "installed": true, "connected": st.to_lowercase().contains("status update: connected"), "proxy": proxy, "port": port, "mode": mode })
}

fn connect() -> Value {
    run(&["connect"]);
    let mut s = state();
    for _ in 0..20 {
        if s["connected"].as_bool() == Some(true) || s["installed"].as_bool() != Some(true) {
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
        s = state();
    }
    s
}

/// As the setting says: connected when it is on and WARP is in its proxy mode.
pub fn sync(on: bool) -> Value {
    let s = state();
    if on && s["installed"] == true && s["proxy"] == true && s["connected"] != true {
        return connect();
    }
    s
}

/// What the user pressed for: WARP into its proxy mode, or a new connection (often another IP).
pub fn action(what: &str) -> Result<Value, String> {
    if !cli().exists() {
        return Err("Chưa cài WARP".into());
    }
    if what == "proxy" {
        let (ok, out) = run(&["mode", "proxy"]);
        if !ok {
            return Err(out.trim().lines().last().unwrap_or("warp-cli").to_string());
        }
    }
    if what == "renew" {
        run(&["disconnect"]);
        std::thread::sleep(Duration::from_millis(1200));
    }
    Ok(connect())
}
