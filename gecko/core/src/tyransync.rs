//! TyranWeb on this machine (its own data in the same files and formats): from version 1.8.0 its data
//! is offered once, at a start ("Đồng bộ data từ TyranWeb?" yes / no), and from Settings → Giới thiệu
//! at any time after.
//!
//! Syncing COPIES TyranWeb's data files into this browser's own data folder at the next start (the
//! browser restarts at once; store.rs, run_import): settings, history, bookmarks, downloads, session,
//! window history…, what was there before put aside in before-import-<time>/. Only the wallpapers are
//! shared: this browser's wallpaper library becomes TyranWeb's own wallpaper folder, used in place
//! (wallpaper-folder.json; walls.rs reads and writes it in TyranWeb's layout), so a picture or video
//! added or removed in one browser is there in the other. TyranWeb's data files are only read.
//!
//! What was answered is kept in <profile>/tyran-sync.json, outside the data folder, which a sync
//! replaces: the question is asked once, whatever comes of it.
use crate::store::{self, now_ms, read_json, write_json};
use serde_json::{json, Value};
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

/// The first version whose data is offered by itself.
const ASK_FROM: [u64; 3] = [1, 8, 0];
const NO_WINDOW: u32 = 0x0800_0000;

// Where TyranWeb is and which version: its uninstall entry, its shortcuts (Desktop, Start menu), a
// running copy, the usual install folders; the version read from the program file itself.
const FIND: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$found = @()
foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') {
  Get-ItemProperty $k | Where-Object { $_.DisplayName -like 'TyranWeb*' } | ForEach-Object {
    $exe = $null
    if ($_.InstallLocation) { $exe = Join-Path $_.InstallLocation 'TyranWeb.exe' }
    if ((-not $exe -or -not (Test-Path $exe)) -and $_.DisplayIcon) { $exe = ($_.DisplayIcon -split ',')[0].Trim('"') }
    $found += [pscustomobject]@{ exe = $exe; version = $_.DisplayVersion; from = 'installed' }
  }
}
$sh = New-Object -ComObject WScript.Shell
foreach ($d in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms')) {
  if (-not $d) { continue }
  Get-ChildItem -LiteralPath $d -Filter '*.lnk' -Recurse -Depth 2 | Where-Object { $_.BaseName -like '*TyranWeb*' } | ForEach-Object {
    $t = $sh.CreateShortcut($_.FullName).TargetPath
    if ($t -and (Test-Path -LiteralPath $t)) { $found += [pscustomobject]@{ exe = $t; version = $null; from = 'shortcut' } }
  }
}
Get-Process -Name TyranWeb | ForEach-Object { if ($_.Path) { $found += [pscustomobject]@{ exe = $_.Path; version = $null; from = 'running' } } }
foreach ($p in "$env:LOCALAPPDATA\Programs\TyranWeb\TyranWeb.exe", "$env:ProgramFiles\TyranWeb\TyranWeb.exe", "${env:ProgramFiles(x86)}\TyranWeb\TyranWeb.exe") {
  if (Test-Path -LiteralPath $p) { $found += [pscustomobject]@{ exe = $p; version = $null; from = 'folder' } }
}
$out = foreach ($f in $found) {
  $v = $f.version
  if ($f.exe -and (Test-Path -LiteralPath $f.exe)) {
    $vi = (Get-Item -LiteralPath $f.exe).VersionInfo
    if ($vi.ProductVersion) { $v = $vi.ProductVersion } elseif ($vi.FileVersion) { $v = $vi.FileVersion }
  }
  if ($v) { [pscustomobject]@{ exe = "$($f.exe)"; version = "$v"; from = $f.from } }
}
ConvertTo-Json -Compress -InputObject @($out)
"#;

fn parse(v: &str) -> [u64; 3] {
    let mut out = [0; 3];
    for (i, p) in v.trim().trim_start_matches(['v', 'V']).split(['.', '-', '+', ' ']).take(3).enumerate() {
        out[i] = p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
    }
    out
}

/// TyranWeb's newest copy on this machine ({exe, version, from}), looked for once a run.
fn installed() -> Value {
    static FOUND: Mutex<Option<Value>> = Mutex::new(None);
    let mut f = FOUND.lock().unwrap();
    if let Some(v) = f.as_ref() {
        return v.clone();
    }
    // (for trying the question out: a version said by the environment)
    let v = if let Ok(test) = std::env::var("UNK_TEST_TYRAN_VERSION") {
        json!({ "exe": "", "version": test, "from": "test" })
    } else {
        find().unwrap_or(Value::Null)
    };
    *f = Some(v.clone());
    v
}

fn find() -> Option<Value> {
    use base64::Engine;
    let utf16: Vec<u8> = FIND.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let enc = base64::engine::general_purpose::STANDARD.encode(utf16);
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &enc])
        .creation_flags(NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let list: Vec<Value> = match serde_json::from_str::<Value>(text.trim().trim_start_matches('\u{feff}')).ok()? {
        Value::Array(a) => a,
        o @ Value::Object(_) => vec![o],
        _ => vec![],
    };
    list.into_iter().filter(|x| x["version"].as_str().is_some_and(|v| parse(v) != [0, 0, 0])).max_by_key(|x| parse(x["version"].as_str().unwrap_or("")))
}

fn flag_file(profile: &Path) -> PathBuf {
    profile.join("tyran-sync.json")
}

fn same(a: &Path, b: &Path) -> bool {
    let n = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase();
    n(a) == n(b)
}

/// What the interface needs: the version found, its data, what was answered, whether to ask now
/// (`claim`: the start's question, given to one window only), and how much a sync would copy.
pub fn status(profile: &Path, data: &Path, claim: bool) -> Value {
    static ASKED_THIS_RUN: AtomicBool = AtomicBool::new(false);
    let found = installed();
    let version = found["version"].as_str().unwrap_or("").to_string();
    let tyran = store::tyran_folder();
    let flag = read_json(&flag_file(profile)).unwrap_or(Value::Null);
    let using = tyran.as_ref().is_some_and(|t| same(t, data));
    let cfg = read_json(&store::folder_file(profile)).unwrap_or(Value::Null);
    let pending = cfg["import"].is_string();
    let new_enough = !version.is_empty() && parse(&version) >= ASK_FROM;
    let mut ask = new_enough && tyran.is_some() && !flag["asked"].as_bool().unwrap_or(false) && !using && !pending;
    if ask && claim {
        ask = !ASKED_THIS_RUN.swap(true, Ordering::SeqCst);
    }
    let walls = tyran.as_deref().and_then(store::tyran_walls_of);
    json!({
        "version": version,
        "exe": found["exe"],
        "data": tyran.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "walls": walls.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "asked": flag["asked"].as_bool().unwrap_or(false),
        "answer": flag["answer"],
        "synced": flag["synced"],
        "using": using,
        "pending": pending,
        "newEnough": new_enough,
        "askFrom": "1.8.0",
        "ask": ask,
    })
}

/// The answer to the start's question (not asked again). A yes is followed by `start`.
pub fn answer(profile: &Path, yes: bool) -> Value {
    let found = installed();
    let mut flag = read_json(&flag_file(profile)).filter(Value::is_object).unwrap_or_else(|| json!({}));
    flag["asked"] = json!(true);
    flag["answer"] = json!(if yes { "yes" } else { "no" });
    flag["at"] = json!(now_ms());
    flag["version"] = found["version"].clone();
    write_json(&flag_file(profile), &flag);
    json!({ "sync": yes })
}

/// The sync: TyranWeb's data files copied in at the next start (the interface restarts the browser
/// at once), its wallpaper folder shared from then on.
pub fn start(profile: &Path, data: &Path) -> Result<Value, String> {
    let tyran = store::tyran_folder().ok_or("Không thấy data của TyranWeb trên máy")?;
    if same(&tyran, data) {
        return Err("Wings đang dùng thẳng thư mục data của TyranWeb".into());
    }
    let file = store::folder_file(profile);
    let mut cfg = read_json(&file).filter(Value::is_object).unwrap_or_else(|| json!({}));
    cfg["import"] = json!(tyran.to_string_lossy());
    write_json(&file, &cfg);
    let mut flag = read_json(&flag_file(profile)).filter(Value::is_object).unwrap_or_else(|| json!({}));
    flag["asked"] = json!(true);
    flag["answer"] = json!("yes");
    flag["synced"] = json!(now_ms());
    flag["version"] = installed()["version"].clone();
    write_json(&flag_file(profile), &flag);
    Ok(json!({ "from": tyran.to_string_lossy(), "walls": store::tyran_walls_of(&tyran).map(|w| w.to_string_lossy().to_string()).unwrap_or_default() }))
}
