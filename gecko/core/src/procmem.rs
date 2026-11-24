//! Memory and CPU of a process, as Windows' Task Manager counts them (private working set / private
//! bytes, CPU time between two looks).
use std::{
    collections::HashMap,
    sync::Mutex,
    time::Instant,
};
use windows::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::{
        ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX},
        Threading::{GetProcessTimes, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE},
    },
};

static LAST: Mutex<Option<HashMap<u32, (Instant, u64)>>> = Mutex::new(None);

pub struct Usage {
    pub private_bytes: u64,
    pub working_set: u64,
    pub cpu: f64, // percent of the whole machine since the last look
}

fn ft(t: FILETIME) -> u64 {
    ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
}

pub fn usage(pid: u32) -> Option<Usage> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut mem = PROCESS_MEMORY_COUNTERS_EX::default();
        let ok_mem = GetProcessMemoryInfo(h, &mut mem as *mut _ as *mut PROCESS_MEMORY_COUNTERS, std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32).is_ok();
        let (mut c, mut e, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        let ok_t = GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u).is_ok();
        let _ = CloseHandle(h);
        if !ok_mem {
            return None;
        }
        let busy = if ok_t { ft(k) + ft(u) } else { 0 };
        let now = Instant::now();
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
        let mut last = LAST.lock().unwrap();
        let map = last.get_or_insert_with(HashMap::new);
        let cpu = match map.insert(pid, (now, busy)) {
            Some((t0, b0)) if busy >= b0 => {
                let wall = now.duration_since(t0).as_secs_f64();
                if wall > 0.05 {
                    ((busy - b0) as f64 / 1e7) / wall / cores * 100.0
                } else {
                    0.0
                }
            }
            _ => 0.0,
        };
        Some(Usage { private_bytes: mem.PrivateUsage as u64, working_set: mem.WorkingSetSize as u64, cpu })
    }
}

pub fn kill(pid: u32) -> bool {
    unsafe {
        match OpenProcess(PROCESS_TERMINATE, false, pid) {
            Ok(h) => {
                let ok = TerminateProcess(h, 1).is_ok();
                let _ = CloseHandle(h);
                ok
            }
            Err(_) => false,
        }
    }
}
