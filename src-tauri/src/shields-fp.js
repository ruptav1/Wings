// Fingerprinting protection, the way Brave does it ("farbling"): what a site could read to tell this
// browser from others (a canvas drawing, the WebGL renderer, an audio rendering, the number of CPU
// cores) comes back very slightly changed. The change is the same for every page of one site during
// one run of the browser (so sites keep working), and different for another site or the next run (so
// sites cannot follow you with it). __SEED__ is the run's random number, put in by shields.rs.
(() => {
  const SEED = __SEED__ | 0;
  // the site the page belongs to (an embedded frame: the page that embeds it)
  let host = location.hostname;
  try {
    host = window.top.location.hostname || host;
  } catch {
    const a = location.ancestorOrigins;
    if (a && a.length) host = new URL(a[a.length - 1]).hostname;
  }
  const site = host.split('.').slice(-2).join('.');
  let h = (2166136261 ^ SEED) >>> 0;
  for (let i = 0; i < site.length; i++) h = Math.imul(h ^ site.charCodeAt(i), 16777619) >>> 0;
  const rand = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // a function replaced by a Proxy of itself: it still reads as native code
  const wrap = (obj, name, apply) => {
    const d = obj && Object.getOwnPropertyDescriptor(obj, name);
    if (!d || typeof d.value !== 'function') return;
    Object.defineProperty(obj, name, { ...d, value: new Proxy(d.value, { apply }) });
  };
  const getter = (obj, name, make) => {
    const d = obj && Object.getOwnPropertyDescriptor(obj, name);
    if (!d || typeof d.get !== 'function') return;
    const real = d.get;
    Object.defineProperty(obj, name, { ...d, get: new Proxy(real, { apply: (fn, self, args) => make(Reflect.apply(fn, self, args)) }) });
  };

  // ---- canvas: a few pixels' lowest bit flipped
  const farble = (data) => {
    const r = rand(h ^ data.length);
    for (let i = 0; i < data.length; i += 4) {
      if (r() < 0.05) {
        const c = i + ((r() * 3) | 0);
        data[c] ^= 1;
      }
    }
  };
  const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  const realGet = C2D && C2D.getImageData;
  wrap(C2D, 'getImageData', (fn, ctx, args) => {
    const d = Reflect.apply(fn, ctx, args);
    try {
      farble(d.data);
    } catch {}
    return d;
  });
  // toDataURL / toBlob read a farbled copy (the page's own canvas is left as it is)
  const viaCopy = (fn, canvas, args) => {
    try {
      const w = canvas.width;
      const hh = canvas.height;
      if (realGet && w && hh && w * hh <= 4e6) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = hh;
        const g = c.getContext('2d');
        g.drawImage(canvas, 0, 0);
        const d = realGet.call(g, 0, 0, w, hh);
        farble(d.data);
        g.putImageData(d, 0, 0);
        return Reflect.apply(fn, c, args);
      }
    } catch {}
    return Reflect.apply(fn, canvas, args);
  };
  if (window.HTMLCanvasElement) {
    wrap(HTMLCanvasElement.prototype, 'toDataURL', viaCopy);
    wrap(HTMLCanvasElement.prototype, 'toBlob', viaCopy);
  }

  // ---- WebGL: the graphics card named by its maker only; read pixels farbled
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!P) continue;
    wrap(P.prototype, 'getParameter', (fn, gl, args) => {
      const v = Reflect.apply(fn, gl, args);
      if (args[0] === 0x9246 && typeof v === 'string') return v.replace(/^ANGLE \(([^,]+),.*\)$/, 'ANGLE ($1)');
      return v;
    });
    wrap(P.prototype, 'readPixels', (fn, gl, args) => {
      const r = Reflect.apply(fn, gl, args);
      try {
        const px = args[6];
        if (px && px.length && px.BYTES_PER_ELEMENT === 1) farble(px);
      } catch {}
      return r;
    });
  }

  // ---- audio: a tiny noise, far below hearing
  const done = new WeakSet();
  if (window.AudioBuffer) {
    wrap(AudioBuffer.prototype, 'getChannelData', (fn, buf, args) => {
      const d = Reflect.apply(fn, buf, args);
      if (!done.has(d)) {
        done.add(d);
        const r = rand(h ^ 0x5eed);
        for (let i = 0; i < d.length; i += 97) d[i] += (r() - 0.5) * 1e-7;
      }
      return d;
    });
  }
  if (window.AnalyserNode) {
    wrap(AnalyserNode.prototype, 'getFloatFrequencyData', (fn, node, args) => {
      const r0 = Reflect.apply(fn, node, args);
      try {
        const a = args[0];
        const r = rand(h ^ 0xa11);
        for (let i = 0; i < a.length; i++) a[i] += (r() - 0.5) * 1e-4;
      } catch {}
      return r0;
    });
  }

  // ---- the number of CPU cores: somewhere between 2 and the real one
  if (window.Navigator) {
    getter(Navigator.prototype, 'hardwareConcurrency', (real) => {
      if (!real || real <= 2) return real;
      return 2 + Math.floor(rand(h ^ 0xc0e)() * (real - 1));
    });
  }
})();
