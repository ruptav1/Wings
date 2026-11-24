//! Secrets kept on disk encrypted with Windows' own keys for this user (DPAPI): the VirusTotal key.
use windows::Win32::{
    Foundation::{LocalFree, HLOCAL},
    Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB},
};

fn blob(b: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: b.len() as u32, pbData: b.as_ptr() as *mut u8 }
}

unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
    let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
    v
}

pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
    let input = blob(data);
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptProtectData(&input, None, None, None, None, 0, &mut out).ok().map(|_| take(out)) }
}

pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
    let input = blob(data);
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptUnprotectData(&input, None, None, None, None, 0, &mut out).ok().map(|_| take(out)) }
}
