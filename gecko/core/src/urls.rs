//! The browser's own pages are written unk://<name>/#hash in the address bar; on Gecko they are the
//! app's chrome:// files (the Gecko side maps them), so nothing here is "internal" by address.
pub fn host_of(url: &str) -> String {
    let rest = url.split("://").nth(1).unwrap_or("");
    let host = rest.split(|c| c == '/' || c == '?' || c == '#').next().unwrap_or("");
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    host.trim_start_matches("www.").to_lowercase()
}

#[allow(dead_code)]
pub fn is_internal_real(url: &str) -> bool {
    url.starts_with("chrome://") || url.starts_with("unk:")
}
