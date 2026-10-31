/* live.js — نسخه‌ی جاوااسکریپت موتور احتمال (هم‌ارز features.py + engine.py)
   ورودی: «بذر» (کندل‌های ساعتی آخرین اجرای سرور + ضرایب مدل) و کندل‌های تازه‌ی OKX
   خروجی: همان فیلدهای coins[] و market که engine.py در payload می‌نویسد */
(function (root) {
  "use strict";
  const H_MS = 3600000;
  const LN2 = Math.LN2;
  const COST_TIERS = [[8.0, 0.0010, "خیلی پرحجم"], [7.48, 0.0015, "پرحجم"], [7.0, 0.0025, "متوسط"], [6.48, 0.0040, "کم‌حجم"], [-1, 0.0060, "خیلی کم‌حجم"]];

  const isn = (x) => x !== x;
  const fin = (x) => typeof x === "number" && isFinite(x);

  function toF64(arr, n) {
    const out = new Float64Array(n).fill(NaN);
    for (let i = 0; i < arr.length && i < n; i++) { const v = arr[i]; out[i] = v === null || v === undefined ? NaN : v; }
    return out;
  }

  /* ---------- حالت: ماتریس ساعتی هم‌تراز ---------- */
  function prepare(seed) {
    const n = seed.n, st = { t0: seed.t0, n, syms: Object.keys(seed.series), S: {}, cap: {}, params: seed.params };
    for (const s of st.syms) {
      const q = seed.series[s], off = q.off || 0;
      const full = {};
      for (const k of ["c", "h", "l", "vq"]) {
        const a = new Float64Array(n).fill(NaN);
        const src = q[k];
        for (let i = 0; i < src.length && off + i < n; i++) { const v = src[i]; a[off + i] = v === null ? NaN : v; }
        full[k] = a;
      }
      st.S[s] = full;
      st.cap[s] = s === "BTC" ? (seed.btc_hours || n) : (seed.hours || n - off);
    }
    return st;
  }

  function lastIdx(a) { for (let i = a.length - 1; i >= 0; i--) if (!isn(a[i])) return i; return -1; }

  /* همان قاعده‌ی engine.py: ساعت آخری که حداقل ۸۰٪ ارزها دارند؛ اگر بیت‌کوین عقب‌تر بود، تا آن */
  function trimLast(st) {
    const lasts = {};
    for (const s of st.syms) { const i = lastIdx(st.S[s].c); if (i >= 0) lasts[s] = i; }
    const vals = Object.values(lasts);
    if (!vals.length) return st;
    const need = Math.max(1, Math.floor(0.8 * vals.length));
    const uniq = [...new Set(vals)].sort((a, b) => a - b);
    let last = vals.reduce((a, b) => Math.max(a, b), -1);
    let okLast = null;
    for (const t of uniq) if (vals.filter((v) => v >= t).length >= need) okLast = t;
    if (okLast !== null) last = okLast;
    if (lasts.BTC !== undefined && lasts.BTC < last) last = lasts.BTC;
    if (last < st.n - 1) {
      const n2 = last + 1;
      for (const s of st.syms) for (const k of ["c", "h", "l", "vq"]) st.S[s][k] = st.S[s][k].slice(0, n2);
      st.n = n2;
    }
    return st;
  }

  /* افزودن کندل‌های تازه: bars = {sym: [[ts,h,l,c,vq], ...]} (فقط کندل‌های بسته‌شده) و حفظ طول پنجره‌ی هر ارز */
  function addBars(st, bars) {
    let maxTs = st.t0 + (st.n - 1) * H_MS;
    for (const s in bars) for (const b of bars[s]) if (b[0] > maxTs) maxTs = b[0];
    const n2 = Math.round((maxTs - st.t0) / H_MS) + 1;
    const out = { t0: st.t0, n: n2, syms: st.syms.slice(), S: {}, cap: st.cap, params: st.params };
    for (const s of st.syms) {
      const o = {};
      for (const k of ["c", "h", "l", "vq"]) {
        const a = new Float64Array(n2).fill(NaN);
        a.set(st.S[s][k]);
        o[k] = a;
      }
      for (const b of bars[s] || []) {
        const i = Math.round((b[0] - st.t0) / H_MS);
        if (i < 0 || i >= n2) continue;
        o.h[i] = b[1]; o.l[i] = b[2]; o.c[i] = b[3]; o.vq[i] = b[4];
      }
      out.S[s] = o;
    }
    trimLast(out);
    /* پنجره را هم‌طول بذر نگه می‌داریم (۴۰۰۰ ساعت برای بیت‌کوین، ۸۰۰ برای بقیه) */
    const N0 = Math.max(...Object.values(st.cap));
    const cut = Math.max(0, out.n - N0);
    if (cut > 0) {
      for (const s of out.syms) for (const k of ["c", "h", "l", "vq"]) out.S[s][k] = out.S[s][k].slice(cut);
      out.t0 += cut * H_MS;
      out.n -= cut;
    }
    for (const s of out.syms) {
      const keepFrom = out.n - st.cap[s];
      if (keepFrom > 0) for (const k of ["c", "h", "l", "vq"]) out.S[s][k].fill(NaN, 0, keepFrom);
    }
    return out;
  }

  /* ---------- ابزارهای سری ---------- */
  function ewm(x, alpha, minp) {
    const n = x.length, out = new Float64Array(n).fill(NaN);
    if (!n) return out;
    const oldf = 1 - alpha, newwt = alpha;
    let w = x[0], nobs = isn(w) ? 0 : 1, oldwt = 1;
    out[0] = nobs >= minp ? w : NaN;
    for (let i = 1; i < n; i++) {
      const cur = x[i], obs = !isn(cur);
      if (obs) nobs++;
      if (!isn(w)) {
        oldwt *= oldf;
        if (obs) {
          if (w !== cur) w = (oldwt * w + newwt * cur) / (oldwt + newwt);
          oldwt = 1;
        }
      } else if (obs) w = cur;
      out[i] = nobs >= minp ? w : NaN;
    }
    return out;
  }
  const emaSpan = (x, span) => ewm(x, 2 / (span + 1), span);

  function rsiSeries(c, n) {
    const T = c.length, up = new Float64Array(T).fill(NaN), dn = new Float64Array(T).fill(NaN);
    for (let i = 1; i < T; i++) {
      const d = c[i] - c[i - 1];
      if (isn(d)) continue;
      up[i] = d > 0 ? d : 0;
      dn[i] = d < 0 ? -d : 0;
    }
    const U = ewm(up, 1 / n, n), D = ewm(dn, 1 / n, n), out = new Float64Array(T).fill(NaN);
    for (let i = 0; i < T; i++) {
      if (isn(U[i])) continue;
      out[i] = D[i] > 0 ? 100 - 100 / (1 + U[i] / D[i]) : 100;
    }
    return out;
  }

  function winMean(x, t, w, minp) {
    let s = 0, k = 0;
    for (let i = Math.max(0, t - w + 1); i <= t; i++) { const v = x[i]; if (!isn(v)) { s += v; k++; } }
    return k >= minp ? s / k : NaN;
  }
  function winMin(x, t, w, minp) {
    let m = Infinity, k = 0;
    for (let i = Math.max(0, t - w + 1); i <= t; i++) { const v = x[i]; if (!isn(v)) { k++; if (v < m) m = v; } }
    return k >= minp ? m : NaN;
  }
  function winMax(x, t, w, minp) {
    let m = -Infinity, k = 0;
    for (let i = Math.max(0, t - w + 1); i <= t; i++) { const v = x[i]; if (!isn(v)) { k++; if (v > m) m = v; } }
    return k >= minp ? m : NaN;
  }
  function median(a) {
    const v = a.filter((x) => !isn(x)).sort((p, q) => p - q), m = v.length;
    if (!m) return NaN;
    return m % 2 ? v[(m - 1) / 2] : (v[m / 2 - 1] + v[m / 2]) / 2;
  }
  const clipLo = (x, lo) => (isn(x) ? NaN : Math.max(x, lo));

  /* ---------- عامل‌ها (features.py) ---------- */
  function prep(st) {
    const P = {};
    for (const s of st.syms) {
      const a = st.S[s], T = a.c.length;
      const lc = new Float64Array(T), rv = new Float64Array(T), vqp = new Float64Array(T);
      for (let i = 0; i < T; i++) {
        lc[i] = Math.log(a.c[i]);
        const r = Math.log(a.h[i] / a.l[i]);
        rv[i] = r * r / (4 * LN2);
        const v = a.vq[i];
        vqp[i] = v > 0 ? v : NaN;
      }
      P[s] = { lc, rv, vqp, e50: emaSpan(a.c, 50), e200: emaSpan(a.c, 200), r14: rsiSeries(a.c, 14), r56: rsiSeries(a.c, 56) };
    }
    return P;
  }

  function sigAt(p, t) {
    const v24 = Math.sqrt(winMean(p.rv, t, 24, 20)), v168 = Math.sqrt(winMean(p.rv, t, 168, 120));
    return { v24, v168, sig: clipLo(Math.sqrt(0.5 * v24 * v24 + 0.5 * v168 * v168), 1e-4) };
  }
  function retAt(p, t, k) { return t - k >= 0 ? p.lc[t] - p.lc[t - k] : NaN; }

  function coinFeatures(st, P, s, t) {
    const a = st.S[s], p = P[s], F = {};
    const { v24, v168, sig } = sigAt(p, t);
    const v720 = Math.sqrt(winMean(p.rv, t, 720, 360));
    F.sig = sig;
    F.lv24 = Math.log(clipLo(v24, 1e-5));
    F.lv168 = Math.log(clipLo(v168, 1e-5));
    F.lv720 = Math.log(clipLo(v720, 1e-5));
    for (const k of [4, 24, 72, 168]) F["z" + k] = retAt(p, t, k) / (sig * Math.sqrt(k));
    F.rsi14 = p.r14[t];
    F.rsi56 = p.r56[t];
    F.d50 = (p.lc[t] - Math.log(p.e50[t])) / (sig * Math.sqrt(50));
    F.d200 = (p.lc[t] - Math.log(p.e200[t])) / (sig * Math.sqrt(200));
    const vh720 = winMean(p.vqp, t, 720, 240), vh168 = winMean(p.vqp, t, 168, 96);
    F.vr24 = Math.log(clipLo(winMean(p.vqp, t, 24, 20) / vh720, 1e-3));
    F.vr4 = Math.log(clipLo(winMean(p.vqp, t, 4, 4) / vh168, 1e-3));
    F.liq = Math.log10(clipLo(vh720 * 24, 1.0));
    const lo = winMin(a.l, t, 168, 120), hi = winMax(a.h, t, 168, 120);
    F.rp168 = hi > lo ? (a.c[t] - lo) / (hi - lo) : NaN;
    return F;
  }

  function marketAt(st, P, t) {
    const r24 = [], sg = [], lv = [];
    let above = 0, aboveN = 0, pos = 0;
    for (const s of st.syms) {
      const p = P[s];
      r24.push(retAt(p, t, 24));
      const si = sigAt(p, t);
      sg.push(si.sig);
      lv.push(Math.log(clipLo(si.v24, 1e-5)));
      const e = p.e200[t];
      if (!isn(e)) { aboveN++; if (st.S[s].c[t] > e) above++; }
    }
    let sum = 0, cnt = 0;
    for (const v of r24) if (!isn(v)) { sum += v; cnt++; if (v > 0) pos++; }
    const m24 = cnt ? sum / cnt : NaN;
    const M = {
      m24,
      m_ret24: m24 / (median(sg) * Math.sqrt(24)),
      m_breadth24: cnt ? pos / cnt : NaN,
      m_breadth200: aboveN ? above / aboveN : NaN,
      m_vol: median(lv),
    };
    if (P.BTC) {
      const sb = sigAt(P.BTC, t).sig;
      M.btc_z24 = retAt(P.BTC, t, 24) / (sb * Math.sqrt(24));
      M.btc_z168 = retAt(P.BTC, t, 168) / (sb * Math.sqrt(168));
      if (!P.BTC.e1200) P.BTC.e1200 = emaSpan(st.S.BTC.c, 1200);
      M.btc_trend = (P.BTC.lc[t] - Math.log(P.BTC.e1200[t])) / (sb * Math.sqrt(1200));
    } else { M.btc_z24 = M.btc_z168 = M.btc_trend = NaN; }
    return M;
  }

  /* ---------- مدل (engine.py) ---------- */
  const sigm = (x) => 1 / (1 + Math.exp(-x));
  const logit = (p) => { p = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return Math.log(p / (1 - p)); };

  function applyModels(Pm, X) {
    const out = {};
    for (const key of Object.keys(Pm.targets)) {
      const m = Pm.targets[key], col = new Float64Array(X.length);
      for (let i = 0; i < X.length; i++) {
        let z = m.b;
        for (let j = 0; j < m.w.length; j++) {
          let v = (X[i][j] - m.mu[j]) / m.sd[j];
          if (isn(v)) v = 0;
          z += v * m.w[j];
        }
        col[i] = sigm(m.cal[0] + m.cal[1] * logit(sigm(z)));
      }
      out[key] = col;
    }
    return out;
  }

  function tidy(out, Hs, Ls, n) {
    const G = {};
    for (const side of ["up", "dn", "an", "uf"]) {
      G[side] = [];
      for (let i = 0; i < n; i++) G[side].push(Hs.map((H, a) => Ls.map((L, b) => out[`${side}_${H}_${L}`][i])));
    }
    for (const side of ["up", "dn", "an"]) {
      for (let i = 0; i < n; i++) {
        const g = G[side][i];
        for (let rep = 0; rep < 2; rep++) {
          for (let a = 0; a < Hs.length; a++) for (let b = 1; b < Ls.length; b++) g[a][b] = Math.min(g[a][b], g[a][b - 1]);
          for (let b = 0; b < Ls.length; b++) for (let a = 1; a < Hs.length; a++) g[a][b] = Math.max(g[a][b], g[a - 1][b]);
        }
      }
    }
    for (let i = 0; i < n; i++) for (let a = 0; a < Hs.length; a++) for (let b = 0; b < Ls.length; b++) {
      const lo = Math.max(G.up[i][a][b], G.dn[i][a][b]), hi = Math.min(1.0, G.up[i][a][b] + G.dn[i][a][b]);
      G.an[i][a][b] = Math.min(Math.max(G.an[i][a][b], lo), hi);
    }
    return G;
  }

  function costTier(liq) {
    if (liq === null || !fin(liq)) return COST_TIERS[COST_TIERS.length - 1];
    for (const t of COST_TIERS) if (liq >= t[0]) return t;
    return COST_TIERS[COST_TIERS.length - 1];
  }
  function bucket(edges, v) {
    if (v === null || !fin(v)) return null;
    for (let k = 0; k < edges.length - 1; k++) {
      if ((edges[k] <= v && v < edges[k + 1]) || (k === edges.length - 2 && v === edges[edges.length - 1])) return k;
    }
    return v < edges[0] ? 0 : edges.length - 2;
  }
  function pctRank(qs, v) {
    if (v === null || !fin(v)) return null;
    let lo = 0, hi = qs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (qs[mid] < v) lo = mid + 1; else hi = mid; }
    return Math.min(Math.max(lo, 0), 100);
  }
  function rnd(x, n) {
    if (x === null || x === undefined || !fin(x)) return null;
    const f = Math.pow(10, n === undefined ? 4 : n);
    return Math.round(x * f) / f;
  }
  const round4 = (a) => a.map((r) => r.map((x) => rnd(x, 4)));

  /* ---------- خروجی: coins[] و market ---------- */
  function compute(st) {
    const Pm = st.params, feats = Pm.features, fac = Pm.factors, Hs = Pm.grid.H, Ls = Pm.grid.L;
    const P = prep(st), last = st.n - 1;
    const marketCache = {};
    const mk = (t) => marketCache[t] || (marketCache[t] = marketAt(st, P, t));
    const X = [], meta = [];
    for (const s of st.syms) {
      const c = st.S[s].c, lc = lastIdx(c);
      if (lc < 0) continue;
      const F = coinFeatures(st, P, s, lc), M = mk(lc), row = {};
      Object.assign(F, M, { rel24: (retAt(P[s], lc, 24) - M.m24) / (F.sig * Math.sqrt(24)) });
      for (const k of feats) {
        if (k === "lsig") row[k] = Math.log(F.sig);
        else if (k === "lsig2") row[k] = Math.log(F.sig) ** 2;
        else row[k] = F[k] === undefined ? NaN : F[k];
      }
      X.push(feats.map((k) => row[k]));
      let nh = 0; for (let i = 0; i < c.length; i++) if (!isn(c[i])) nh++;
      meta.push({ sym: s, lc, stale: lc !== last, n_hist: nh, row });
    }
    const G = tidy(applyModels(Pm, X), Hs, Ls, meta.length);
    const coins = meta.map((m, i) => {
      const c = st.S[m.sym].c, price = c[m.lc];
      const chg = (h) => { const j = m.lc - h; return j >= 0 && fin(c[j]) ? (price / c[j] - 1) * 100 : null; };
      const liq = m.row.liq, tier = costTier(liq);
      const sig = fin(m.row.lsig) ? Math.exp(m.row.lsig) : null;
      const fb = [], fv = [];
      for (const f of fac.factors) { const v = m.row[f.key]; fv.push(rnd(v, 3)); fb.push(bucket(f.edges, v)); }
      return {
        sym: m.sym, ts: st.t0 + m.lc * H_MS, price, chg1: rnd(chg(1), 3), chg4: rnd(chg(4), 3), chg24: rnd(chg(24), 3), chg168: rnd(chg(168), 3),
        vol24: rnd(sig ? sig * Math.sqrt(24) * 100 : null, 3), liq: rnd(liq, 3), cost: tier[1], tier: tier[2], stale: m.stale, n_hist: m.n_hist,
        up: round4(G.up[i]), dn: round4(G.dn[i]), an: round4(G.an[i]), q: round4(G.uf[i]), fb, fv,
      };
    });
    const Mb = mk(last), market = {};
    for (const k of ["btc_trend", "m_breadth24", "m_breadth200", "m_vol", "m_ret24", "btc_z24"]) market[k] = rnd(Mb[k], 4);
    market.vol_pct = pctRank(Pm.market_q.m_vol, market.m_vol);
    market.fb = {};
    for (const f of fac.factors) if (f.key === "btc_trend" || f.key === "m_breadth24") market.fb[f.key] = bucket(f.edges, market[f.key]);
    return { asof_ms: st.t0 + last * H_MS, market, coins };
  }

  /* ---------- شبکه (فقط مرورگر): قیمت زنده و کندل‌های تازه از OKX ---------- */
  const BASE = "https://www.okx.com/api/v5/";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function okx(path, tries = 4) {
    let err;
    for (let a = 0; a < tries; a++) {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(BASE + path, { signal: ctl.signal, cache: "no-store" });
        clearTimeout(to);
        const j = await r.json().catch(() => null);
        if (r.ok && j && j.code === "0") return j.data;
        err = new Error(j && j.msg ? j.msg : "http " + r.status);
        if (r.status !== 429 && !(j && j.code === "50011")) { if (a >= 1) break; }
      } catch (e) { clearTimeout(to); err = e; }
      await sleep(500 * Math.pow(2, a));
    }
    throw err;
  }

  async function pool(items, limit, fn) {
    const res = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; res[i] = await fn(items[i], i); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return res;
  }

  async function update(seed, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const st0 = prepare(seed);
    const info = { seed_asof_ms: seed.asof_ms, errors: 0, fetched: 0, live: false };
    let tick;
    try { tick = await okx("market/tickers?instType=SWAP", 3); } catch (e) { info.error = "OKX: " + (e && e.message ? e.message : e); return { info, st: st0, res: compute(st0), px: {}, o24: {} }; }
    const px = {}, o24 = {};
    let srvTs = 0;
    for (const x of tick) {
      const id = x.instId || "";
      if (id.endsWith("-USDT-SWAP")) { px[id.slice(0, -10)] = Number(x.last); o24[id.slice(0, -10)] = Number(x.open24h); }
      if (Number(x.ts) > srvTs) srvTs = Number(x.ts);
    }
    info.live = true;
    info.server_ms = srvTs;
    const expected = Math.floor(srvTs / H_MS) * H_MS - H_MS;
    const behind = Math.round((expected - seed.asof_ms) / H_MS);
    let st = st0;
    if (behind > 0 && behind <= 280) {
      const need = Math.min(300, behind + 2), bars = {};
      await pool(st0.syms, opts.workers || 8, async (s) => {
        try {
          const rows = await okx(`market/candles?instId=${s}-USDT-SWAP&bar=1H&limit=${need}`);
          bars[s] = rows.filter((r) => String(r[8]) === "1" && Number(r[0]) > seed.asof_ms)
            .map((r) => [Number(r[0]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[7])]);
          info.fetched++;
        } catch (e) { info.errors++; }
      });
      st = addBars(st0, bars);
    } else if (behind > 280) { info.error = "بذر خیلی قدیمی است"; }
    const res = compute(st);
    info.asof_ms = res.asof_ms;
    info.ms = Date.now() - t0;
    return { info, st, res, px, o24 };
  }


  /* ---------- سوابق: بازسازی پیش‌بینی ساعت‌های گذشته و مقایسه با واقعیت ---------- */
  function historyInit(st) { return { P: prep(st) }; }

  function snapshot(st, ctx, t) {
    const Pm = st.params, feats = Pm.features, Hs = Pm.grid.H, Ls = Pm.grid.L, P = ctx.P;
    const M = marketAt(st, P, t), X = [], syms = [];
    for (const s of st.syms) {
      if (isn(st.S[s].c[t])) continue;
      const F = coinFeatures(st, P, s, t);
      F.rel24 = (retAt(P[s], t, 24) - M.m24) / (F.sig * Math.sqrt(24));
      X.push(feats.map((k) => k === "lsig" ? Math.log(F.sig) : k === "lsig2" ? Math.log(F.sig) ** 2 : (M[k] !== undefined ? M[k] : (F[k] === undefined ? NaN : F[k]))));
      syms.push(s);
    }
    const G = tidy(applyModels(Pm, X), Hs, Ls, syms.length);
    const coins = {};
    syms.forEach((s, i) => { coins[s] = { c: st.S[s].c[t], up: G.up[i], dn: G.dn[i], an: G.an[i], q: G.uf[i] }; });
    return { t, ts: st.t0 + t * H_MS, coins };
  }

  function history(st, back) {
    const ctx = historyInit(st), last = st.n - 1, out = [];
    for (let t = Math.max(0, last - (back || 72)); t <= last; t++) out.push(snapshot(st, ctx, t));
    return out;
  }

  function outcome(st, s, t, H, Lp) {
    const a = st.S[s], last = st.n - 1;
    if (!a) return null;
    const c0 = a.c[t];
    if (!(c0 > 0)) return null;
    const up = c0 * (1 + Lp / 100), dn = c0 * (1 - Lp / 100);
    let fu = 0, fd = 0, hi = -Infinity, lo = Infinity;
    for (let k = 1; k <= H && t + k <= last; k++) {
      const h = a.h[t + k], l = a.l[t + k];
      if (isn(h) || isn(l)) continue;
      if (h > hi) hi = h;
      if (l < lo) lo = l;
      if (!fu && h >= up) fu = k;
      if (!fd && l <= dn) fd = k;
    }
    const done = t + H <= last;
    let first;
    if (fu && fd) first = fu < fd ? "up" : fd < fu ? "dn" : "tie";
    else if (fu) first = "up";
    else if (fd) first = "dn";
    else first = done ? "none" : "pending";
    let j = Math.min(last, t + H);
    while (j > t && isn(a.c[j])) j--;
    return {
      first, done, elapsed: Math.min(H, last - t), upHit: !!fu, dnHit: !!fd,
      ret: j > t ? (a.c[j] / c0 - 1) * 100 : null,
      mx: hi > -Infinity ? (hi / c0 - 1) * 100 : null, mn: lo < Infinity ? (lo / c0 - 1) * 100 : null,
    };
  }

  const API = { prepare, addBars, trimLast, compute, update, history, historyInit, snapshot, outcome, ewm, rsiSeries, _emaSpan: emaSpan };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Live = API;
})(typeof self !== "undefined" ? self : this);
