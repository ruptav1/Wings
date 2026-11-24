// Waits on unkcore's events (unk_next) off the main thread and hands them to it in small batches.
/* global ctypes */
let lib = null;
let next = null;
let free = null;

function loop() {
  for (;;) {
    const batch = [];
    let p = next(1000);
    while (!p.isNull()) {
      batch.push(p.readString());
      free(p);
      if (batch.length >= 64) break;
      p = next(0);
    }
    if (batch.length) postMessage(batch);
  }
}

onmessage = (e) => {
  if (e.data.dll && !lib) {
    lib = ctypes.open(e.data.dll);
    next = lib.declare("unk_next", ctypes.default_abi, ctypes.char.ptr, ctypes.uint32_t);
    free = lib.declare("unk_free", ctypes.default_abi, ctypes.void_t, ctypes.char.ptr);
    loop();
  }
};
