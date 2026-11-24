//! Two more of Brave's Shields, for the address a page is opened at:
//! - tracking parameters (fbclid, gclid, utm_…, YouTube's si…) taken off the address when the page is
//!   opened from another site or from the address bar (a site's own links keep what it put in them);
//! - debounce: a link through a tracker that only sends the browser on (an affiliate or mail click
//!   counter) goes straight to where it leads.
//! Both rule lists are Brave's own (brave/adblock-lists, MPL-2.0), fetched every few days into
//! profile/adblock.
use regex::Regex;
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    sync::RwLock,
    time::{Duration, SystemTime},
};
use tauri::Url;

const QUERY: (&str, &str) = ("brave-query-filter.json", "https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/query-filter.json");
const DEBOUNCE: (&str, &str) = ("brave-debounce.json", "https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/debounce.json");
const REFRESH: Duration = Duration::from_secs(4 * 24 * 3600);

// ---------- extension-style match patterns ("*://*.example.com/r?*") ----------
enum Host {
    Any,
    Exact(String),
    Under(String), // the domain and its subdomains
}
struct Pattern {
    scheme: Option<String>, // None: http and https
    host: Host,
    rest: Regex, // path and query
}

fn pattern(p: &str) -> Option<Pattern> {
    let (scheme, rest) = p.split_once("://")?;
    let slash = rest.find('/')?;
    let (host, path) = rest.split_at(slash);
    let host = if host == "*" {
        Host::Any
    } else if let Some(d) = host.strip_prefix("*.") {
        Host::Under(d.to_lowercase())
    } else if host.contains('*') {
        return None;
    } else {
        Host::Exact(host.to_lowercase())
    };
    let re = format!("^{}$", path.split('*').map(regex::escape).collect::<Vec<_>>().join(".*"));
    Some(Pattern { scheme: if scheme == "*" { None } else { Some(scheme.to_string()) }, host, rest: Regex::new(&re).ok()? })
}

impl Pattern {
    fn test(&self, u: &Url) -> bool {
        let sch = u.scheme();
        if !matches!(&self.scheme, Some(s) if s == sch) && !(self.scheme.is_none() && (sch == "http" || sch == "https")) {
            return false;
        }
        let h = u.host_str().unwrap_or("").to_lowercase();
        let ok = match &self.host {
            Host::Any => true,
            Host::Exact(x) => &h == x,
            Host::Under(d) => &h == d || h.ends_with(&format!(".{d}")),
        };
        ok && self.rest.is_match(&format!("{}{}", u.path(), u.query().map(|q| format!("?{q}")).unwrap_or_default()))
    }
}

fn patterns(v: &Value) -> Vec<Pattern> {
    v.as_array().map(|a| a.iter().filter_map(|p| p.as_str().and_then(pattern)).collect()).unwrap_or_default()
}
fn any(list: &[Pattern], u: &Url) -> bool {
    list.iter().any(|p| p.test(u))
}

// ---------- the rules ----------
struct QueryRule {
    include: Vec<Pattern>,
    exclude: Vec<Pattern>,
    params: Vec<String>,
}
struct DebounceRule {
    include: Vec<Pattern>,
    exclude: Vec<Pattern>,
    action: String,
    param: String,
    re: Option<Regex>,
    scheme: String,
    template: String,
}

#[derive(Default)]
struct Rules {
    query: Vec<QueryRule>,
    debounce: Vec<DebounceRule>,
}
static RULES: RwLock<Option<Rules>> = RwLock::new(None);

fn compile(query: &Value, debounce: &Value) -> Rules {
    let query = query
        .as_array()
        .map(|a| {
            a.iter()
                .map(|r| QueryRule { include: patterns(&r["include"]), exclude: patterns(&r["exclude"]), params: r["params"].as_array().map(|p| p.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default() })
                .collect()
        })
        .unwrap_or_default();
    let debounce = debounce
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    let action = r["action"].as_str()?.to_string();
                    let param = r["param"].as_str()?.to_string();
                    if !["redirect", "base64,redirect", "regex-path", "regex-path-template"].contains(&action.as_str()) {
                        return None;
                    }
                    let re = if action.starts_with("regex-path") { Some(Regex::new(&param).ok()?) } else { None };
                    Some(DebounceRule {
                        include: patterns(&r["include"]),
                        exclude: patterns(&r["exclude"]),
                        action,
                        param,
                        re,
                        scheme: r["prepend_scheme"].as_str().unwrap_or("").to_string(),
                        template: r["redirect_url_template"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Rules { query, debounce }
}

fn read(dir: &PathBuf, file: &str) -> Value {
    fs::read_to_string(dir.join(file)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
}

/// The lists kept last time, fetched again in the background once a few days old.
pub fn start(dir: PathBuf) {
    std::thread::spawn(move || {
        let _ = fs::create_dir_all(&dir);
        *RULES.write().unwrap() = Some(compile(&read(&dir, QUERY.0), &read(&dir, DEBOUNCE.0)));
        let old = [QUERY, DEBOUNCE].iter().any(|(f, _)| {
            fs::metadata(dir.join(f)).and_then(|m| m.modified()).map(|t| SystemTime::now().duration_since(t).unwrap_or_default() > REFRESH).unwrap_or(true)
        });
        if !old {
            return;
        }
        for (file, url) in [QUERY, DEBOUNCE] {
            let Ok(resp) = ureq::get(url).timeout(Duration::from_secs(30)).call() else { continue };
            let Ok(text) = resp.into_string() else { continue };
            if serde_json::from_str::<Value>(&text).map(|v| v.is_array()).unwrap_or(false) {
                let _ = fs::write(dir.join(file), text);
            }
        }
        *RULES.write().unwrap() = Some(compile(&read(&dir, QUERY.0), &read(&dir, DEBOUNCE.0)));
    });
}

/// The site an address belongs to (its registrable domain: news.example.co.uk → example.co.uk).
pub fn site(url: &str) -> String {
    let Ok(u) = Url::parse(url) else { return String::new() };
    let h = u.host_str().unwrap_or("").to_lowercase();
    addr::parse_domain_name(&h).ok().and_then(|n| n.root().map(String::from)).unwrap_or(h)
}

// (Brave's own exceptions: these parameters stay on the pages that need them)
fn conditional(name: &str, url: &str) -> Option<bool> {
    let keep = match name {
        "ck_subscriber_id" => url.contains("/unsubscribe"),
        "h_sid" | "h_slt" => url.contains("/email/"),
        "mkt_tok" => url.contains("nsubscribe") || url.contains("emailWebview"),
        _ => return None,
    };
    Some(!keep)
}

/// `url` without its tracking parameters (None when it has none).
pub fn strip(url: &str) -> Option<String> {
    let mut u = Url::parse(url).ok()?;
    let query = u.query()?.to_string();
    if !matches!(u.scheme(), "http" | "https") || query.is_empty() || u.host_str() == Some("urldefense.com") {
        return None;
    }
    let guard = RULES.read().ok()?;
    let rules = guard.as_ref()?;
    let blocked: std::collections::HashSet<&str> = rules.query.iter().filter(|r| any(&r.include, &u) && !any(&r.exclude, &u)).flat_map(|r| r.params.iter().map(|s| s.as_str())).collect();
    let mut stripped = false;
    let kept: Vec<&str> = query
        .split('&')
        .filter(|tok| {
            let Some((name, value)) = tok.split_once('=') else { return true };
            if name.is_empty() || value.is_empty() {
                return true;
            }
            let drop = conditional(name, url).unwrap_or_else(|| blocked.contains(name));
            stripped |= drop;
            !drop
        })
        .collect();
    if !stripped {
        return None;
    }
    let rest = kept.join("&");
    u.set_query(if rest.is_empty() { None } else { Some(&rest) });
    Some(u.to_string())
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Where a tracker's bounce page sends the browser on (None: not one, or nowhere safe).
pub fn debounce(url: &str) -> Option<String> {
    use base64::Engine as _;
    let u = Url::parse(url).ok()?;
    let guard = RULES.read().ok()?;
    let rules = guard.as_ref()?;
    for r in &rules.debounce {
        if !any(&r.include, &u) || any(&r.exclude, &u) {
            continue;
        }
        let target = match r.action.as_str() {
            "redirect" => u.query_pairs().find(|(k, _)| k == r.param.as_str()).map(|(_, v)| v.to_string()),
            "base64,redirect" => u.query_pairs().find(|(k, _)| k == r.param.as_str()).and_then(|(_, v)| {
                let v = v.replace('-', "+").replace('_', "/");
                base64::engine::general_purpose::STANDARD.decode(v.trim_end_matches('=')).or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(v.trim_end_matches('='))).ok().and_then(|b| String::from_utf8(b).ok())
            }),
            "regex-path" => r.re.as_ref().and_then(|re| re.captures(u.path())).and_then(|c| c.get(1)).map(|m| {
                let t = decode(m.as_str());
                if r.scheme.is_empty() { t } else { format!("{}://{}", r.scheme, t) }
            }),
            "regex-path-template" => r.re.as_ref().and_then(|re| re.captures(u.path())).map(|c| {
                let mut t = r.template.clone();
                for i in (1..c.len()).rev() {
                    t = t.replace(&format!("${i}"), c.get(i).map(|m| m.as_str()).unwrap_or(""));
                }
                t
            }),
            _ => None,
        };
        // (only a real web address of another site)
        if let Some(t) = target.filter(|t| t.starts_with("http://") || t.starts_with("https://")) {
            if Url::parse(&t).is_ok() && site(&t) != site(url) {
                return Some(t);
            }
        }
    }
    None
}
