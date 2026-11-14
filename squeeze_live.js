/* squeeze_live.js: live entry-signal check for rule squeeze-atr1.5-v1 (display only).
   Evaluates the SAME rule as paper/strategies/squeeze_v1.py in the browser, from (a) the engine's per-coin state (live_squeeze.json, version 2:
   squeeze threshold q, daily ATR, slippage tier for six explicitly dated decision hours, the 29 closed bars the engine saw, two control closes) and
   (b) the last 40 hourly OKX candles of each coin.
   The library never writes anything and sends no request other than GET https://www.okx.com/api/v5/market/candles. Its dq* functions are PURE (they build, merge and format the data-quality
   ledger of closed-candle changes in memory); keeping that ledger is the page's business (localStorage key panel_dq_v1), and it is separate from the shadow ledger, the strategy and the engine state.
   Every signal is built from CLOSED bars only (confirm=1); the unfinished bar only supplies the "current price".
   tests/live_tests.py + test/equiv.js compare it with the Python rule on every (hour, coin) cell of the reference data. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SqueezeLive = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var H = 3600000, NB = 40, VERSION = 2, API = "https://www.okx.com/api/v5/market/candles";
  /* Tolerances are relative and deliberately tiny, and come from measurements (tests/results), not from a round number:
       - computation: JS against Python on identical inputs, 3.86 M (hour, coin) cells and 11 407 candidates against the engine's own record: largest relative
         ATR% difference 0 (bit-identical); float noise itself is about 2e-16 (a few ulps);
       - input: OKX's live candles against the repo's reference data, 103 032 OHLC values (25 758 bars, 106 coins, 2026-10-19..10-29): largest relative difference 0;
       - the smallest REAL difference that matters is one price tick: among the 106 coins the smallest tick/price is 1.3e-6 (BTC), so any genuine data revision
         moves ATR% by at least about 1e-6.
     1e-12 sits four orders above the noise and six below the smallest real difference. OHLC input differences and ATR computation differences are measured
     separately; a wider tolerance would only hide revisions. A closed candle that OKX has CHANGED since the engine read it is reported as DATA_REVISION
     (revisionOf below) and the coin is left out; it is never explained away as a computation difference. */
  var TOL_ATR = 1e-12;        /* ATR% (browser) against the engine's record */
  var TOL_PX = 1e-12;         /* control closes (state.chk) and closed bars (state.coins[].bars) against OKX */
  var COV_NUM = 9, COV_DEN = 10, MIN_COVERAGE = COV_NUM / COV_DEN;     /* COVERAGE = evaluated / universe must be >= 90 %, compared in integers (evaluated * 10 >= 9 * universe); below it the whole check is invalid */
  var DQ_MAX = 5000;          /* rows the data-quality ledger keeps; beyond that new rows are counted in `overflow`, never silently dropped */
  var REQ_TIMEOUT = 8000, DEADLINE = 75000;   /* ms: one request, and the whole download */
  var NEED_BACK = 28;         /* the oldest decision hour shown (xnow-3h) needs its box from bar xnow-28h; an answer that does not reach back that far is a partial answer */
  var num = function (v) { return v === null || v === undefined ? NaN : +v; };

  /* the engine writes UTC as "YYYY-MM-DD HH:MM" (or ISO); returns ms or NaN */
  function parseUtc(s) {
    s = String(s === null || s === undefined ? "" : s).trim().replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ":00Z";
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) s += "Z";
    else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(s)) return NaN;
    var t = Date.parse(s);
    return isFinite(t) ? t : NaN;
  }

  /* ---- hourly grid from OKX rows (newest first: [ts,o,h,l,c,vol,volCcy,volCcyQuote,confirm]); only confirmed bars count.
     Nothing is repaired silently: a malformed answer (short row, duplicate or out-of-order timestamp, off-grid time, bad confirm flag, non-positive or
     inconsistent open/high/low/close, an answer that stops short of the window = partial_response) sets g.fatal and the coin is left out and counted; g.info lists harmless findings (missing hours, unusable newest price).
     Missing hours are normal (OKX has no row for an hour without trades) and are treated like the engine treats them (NaN, min_periods). ---- */
  function gridFromRows(rows, first, n) {
    var g = { first: first, n: n, O: new Float64Array(n).fill(NaN), H: new Float64Array(n).fill(NaN), L: new Float64Array(n).fill(NaN), C: new Float64Array(n).fill(NaN), px: NaN, newest: NaN, oldest: NaN, fatal: "", info: [] };
    var k, r, ts, prev = Infinity, bad = function (why) { if (!g.fatal) g.fatal = why; };
    if (!Array.isArray(rows)) { bad("not_a_list"); return g; }
    if (!rows.length) { bad("empty"); return g; }
    var oldest = Infinity;
    for (k = 0; k < rows.length; k++) {
      r = rows[k];
      if (!Array.isArray(r) || r.length < 9) { bad("short_row"); continue; }
      ts = +r[0];
      if (!isFinite(ts)) { bad("bad_time"); continue; }
      if (ts % H !== 0) { bad("off_grid_time"); continue; }
      if (ts === prev) bad("duplicate_time"); else if (ts > prev) bad("out_of_order");
      if (ts < prev) prev = ts;
      if (!(ts <= g.newest)) g.newest = ts;
      if (ts < oldest) oldest = ts;
    }
    if (isFinite(oldest)) g.oldest = oldest;
    /* OKX returns the 40 newest candles that exist (hours without trades have no row), so a complete answer always reaches back past the start of the
       window. If it does not, the answer was cut short: the missing bars are NOT holes and must not be read as such. */
    if (isFinite(oldest) && oldest > first + (n - 1 - NEED_BACK) * H) bad("partial_response");
    for (k = 0; k < rows.length; k++) {
      r = rows[k];
      if (!Array.isArray(r) || r.length < 9) continue;
      ts = +r[0];
      if (!isFinite(ts) || ts % H !== 0) continue;
      var c = +r[4], conf = String(r[8]);
      if (conf !== "0" && conf !== "1") { bad("bad_confirm"); continue; }
      if (ts === g.newest) { if (isFinite(c) && c > 0) g.px = c; else g.info.push("bad_newest_price"); }
      if (conf !== "1") { if (ts !== g.newest) bad("unconfirmed_not_newest"); continue; }
      var o = +r[1], h = +r[2], l = +r[3];
      if (!(isFinite(o) && isFinite(h) && isFinite(l) && isFinite(c) && o > 0 && h > 0 && l > 0 && c > 0)) { bad("bad_price"); continue; }
      var eps = 1e-12 * h;
      if (h < l - eps || c > h + eps || c < l - eps || o > h + eps || o < l - eps) { bad("inconsistent_ohlc"); continue; }
      var i = (ts - first) / H;
      if (i < 0 || i >= n) continue;
      g.O[i] = o; g.H[i] = h; g.L[i] = l; g.C[i] = c;
    }
    var holes = 0, i0 = -1, last = isFinite(g.newest) ? Math.min(n - 1, (g.newest - first) / H) : -1;
    for (var i1 = 0; i1 <= last; i1++) if (g.C[i1] === g.C[i1]) { i0 = i1; break; }      // holes are counted after the first bar we have (a young listing is "short history", not holes)
    for (var i2 = Math.max(i0, 0); i0 >= 0 && i2 <= last; i2++) if (g.C[i2] !== g.C[i2] && g.newest !== first + i2 * H) holes++;
    if (holes) g.info.push("holes:" + holes);
    g.holes = holes;
    return g;
  }

  /* pandas rolling(len, min_periods=m).max()/min() ending at index e (NaN ignored) */
  function roll(a, e, len, minp, isMax) {
    var s = e - len + 1;
    if (s < 0) return NaN;
    var cnt = 0, best = NaN;
    for (var i = s; i <= e; i++) {
      var v = a[i];
      if (v !== v) continue;
      cnt++;
      if (best !== best || (isMax ? v > best : v < best)) best = v;
    }
    return cnt >= minp ? best : NaN;
  }

  /* the rule for ONE coin and ONE decision hour. g: grid, X: decision hour (ms). Returns {dir, entry, atrp, ...} or null; reasons for diagnostics. */
  function evalCoin(P, X, c, i, g) {
    var out = { cand: null, why: "" };
    var q = num(c.q[i]), atr = num(c.atr[i]);
    if (!(q === q) || !(atr === atr)) { out.why = "no_state"; return out; }
    var e = (X - g.first) / H - 2;                       // index of bar X-2
    if (e - P.box_hours + 1 < 0 || e + 1 >= g.n) { out.why = "short_history"; return out; }
    var hh = roll(g.H, e, P.box_hours, P.box_min_hours, true), ll = roll(g.L, e, P.box_hours, P.box_min_hours, false);
    var c2 = g.C[e], P1 = g.C[e + 1];
    var rng = (hh - ll) / c2;
    var hr = new Date(X).getUTCHours();
    var win = hr >= P.entry_hours_utc[0] && hr <= P.entry_hours_utc[1];
    var ok = P1 === P1 && atr === atr && atr > 0;       // engine: ~isnan(P1) & ~isnan(atr) & atr > 0
    if (!(P1 === P1)) { out.why = "no_p1"; return out; }
    var sq = rng <= q;                                   // NaN compares false, like numpy
    var lg = sq && P1 > hh && ok && win, sh = sq && P1 < ll && ok && win;
    if (!lg && !sh) { out.why = sq ? "no_break" : (rng === rng ? "no_squeeze" : "no_box"); return out; }
    var d = lg ? 1 : -1, atrp = atr / P1, sd = P.atr_mult * atrp;
    /* every number behind a candidate comes from a bar with confirm=1 (the grid only holds confirmed bars), so the signal is fixed once bar X-1 has closed:
       bar_ts = the closed bar whose close is the entry price. closed_bar is always true: there is no signal built on an unfinished bar. */
    out.cand = { dir: d, entry: P1, atrp: atrp, slip: num(c.slip[i]), sd: sd, stop: d === 1 ? P1 * (1 - sd) : P1 * (1 + sd), j: c.j, closed_bar: true, bar_ts: X - H };
    return out;
  }

  /* the engine's two control closes against OKX's: "ok", "differs" (both have the bar, prices differ: MISMATCH) or "missing" (the engine has a close, OKX has no
     confirmed bar there: UNAVAILABLE, e.g. a halted coin). */
  function aligned(c, g) {
    var res = "ok";
    for (var k = 0; k < c.chk.length; k++) {
      var ts = c.chk[k][0], v = c.chk[k][1];
      if (v === null) continue;
      var i = (ts - g.first) / H;
      if (i < 0 || i >= g.n) continue;
      var x = g.C[i];
      if (!(x === x)) { res = "missing"; continue; }
      if (Math.abs(x - v) > TOL_PX * Math.abs(v)) return "differs";
    }
    return res;
  }

  /* ---- closed-candle change control (DATA_REVISION) ----
     The engine carries the closed bars it read (state.bars_first_ts + k h -> [open, high, low, close], or null = no bar that hour). A closed candle must not change.
     This compares them, bar for bar, timestamp and OHLC, with the closed bars OKX returns now. Anything that differs is a revision of the data, kept apart from
     the computation: changed = a price differs beyond TOL_PX, added = OKX now has a bar the engine did not have, removed = the engine had a bar that OKX no longer
     returns (only judged for hours the OKX answer reaches back to). null = the coin has no usable bars in the state (the control could not run). */
  function revisionOf(state, c, g) {
    var bars = c.bars;
    if (!Array.isArray(bars) || !bars.length) return null;
    var out = { compared: 0, n: 0, changed: [], added: [], removed: [], events: [] }, FLD = ["open", "high", "low", "close"];
    for (var k = 0; k < bars.length; k++) {
      var eb = bars[k];
      if (eb !== null && !(Array.isArray(eb) && eb.length === 4 && eb.every(function (v) { return typeof v === "number" && isFinite(v) && v > 0; }))) return null;
    }
    for (k = 0; k < bars.length; k++) {
      var ts = state.bars_first_ts + k * H, i = (ts - g.first) / H;
      if (i < 0 || i >= g.n) continue;                                  // outside the 40-bar window we downloaded
      eb = bars[k];
      var have = g.C[i] === g.C[i];
      if (eb === null) { if (have) { out.added.push(ts); out.n++; out.events.push({ ts: ts, field: "bar", kind: "added", old: null, "new": g.C[i] }); } continue; }
      if (!have) { if (ts >= g.oldest) { out.removed.push(ts); out.n++; out.events.push({ ts: ts, field: "bar", kind: "removed", old: eb[3], "new": null }); } continue; }
      out.compared++;
      var br = [g.O[i], g.H[i], g.L[i], g.C[i]];
      for (var f = 0; f < 4; f++) if (!(Math.abs(br[f] - eb[f]) <= TOL_PX * Math.abs(eb[f]))) { out.changed.push({ ts: ts, field: FLD[f], engine: eb[f], okx: br[f] }); out.n++; out.events.push({ ts: ts, field: FLD[f], kind: "changed", old: eb[f], "new": br[f] }); }
    }
    return out;
  }

  /* all coins for one decision hour. grids: {sym: grid}. revs: {sym: revisionOf(...) or null} (omitted = the closed-candle control is not run).
     The hour is found by its timestamp in state.hours_ts, never by position. Per-coin status, checked in this order:
       UNAVAILABLE (no state value, no/malformed OKX answer, no bars in the state, control bar missing in OKX) ->
       MISMATCH (a control close differs) -> UNAVAILABLE (history too short, closing bar of the previous hour missing) ->
       DATA_REVISION (a closed bar differs from the engine's record) -> MATCH (evaluated). */
  function evaluateHour(state, grids, X, revs) {
    var P = state.params, i = Array.isArray(state.hours_ts) ? state.hours_ts.indexOf(X) : -1;
    var res = { X: X, supported: i >= 0, cands: [], skipped: {}, coin_status: {}, counts: { evaluated: 0, universe: 0, no_state: 0, no_grid: 0, bad_data: 0, no_bars: 0, unaligned: 0, no_control_bar: 0, short_history: 0, no_p1: 0, revised: 0 } };
    if (!res.supported) return res;
    var hr = new Date(X).getUTCHours();
    res.in_window = hr >= P.entry_hours_utc[0] && hr <= P.entry_hours_utc[1];
    var syms = Object.keys(state.coins);
    for (var k = 0; k < syms.length; k++) {
      var s = syms[k], c = state.coins[s], g = grids[s];
      if (c.atr[i] === null || c.q[i] === null) { res.counts.no_state++; res.skipped[s] = "no_state"; continue; }
      res.counts.universe++;
      if (!g) { res.counts.no_grid++; res.skipped[s] = "no_grid"; res.coin_status[s] = "UNAVAILABLE"; continue; }
      if (g.fatal) { res.counts.bad_data++; res.skipped[s] = "bad_data:" + g.fatal; res.coin_status[s] = "UNAVAILABLE"; continue; }
      var rv = revs ? revs[s] : undefined;
      if (revs && !rv) { res.counts.no_bars++; res.skipped[s] = "no_bars"; res.coin_status[s] = "UNAVAILABLE"; continue; }
      var al = aligned(c, g);
      if (al === "differs") { res.counts.unaligned++; res.skipped[s] = "unaligned"; res.coin_status[s] = "MISMATCH"; continue; }
      if (al === "missing") { res.counts.no_control_bar++; res.skipped[s] = "no_control_bar"; res.coin_status[s] = "UNAVAILABLE"; continue; }
      var o = evalCoin(P, X, c, i, g);
      if (o.why === "short_history") { res.counts.short_history++; res.skipped[s] = "short_history"; res.coin_status[s] = "UNAVAILABLE"; continue; }
      if (o.why === "no_p1") { res.counts.no_p1++; res.skipped[s] = "no_p1"; res.coin_status[s] = "UNAVAILABLE"; continue; }
      if (rv && rv.n) { res.counts.revised++; res.skipped[s] = "data_revision"; res.coin_status[s] = "DATA_REVISION"; continue; }
      res.counts.evaluated++; res.coin_status[s] = "MATCH";
      if (o.cand) { o.cand.sym = s; res.cands.push(o.cand); }
    }
    res.cands.sort(function (a, b) { return a.atrp - b.atrp || a.j - b.j; });
    return res;
  }

  /* compare with the candidates the engine recorded for an hour it already processed.
     skipped: {sym: reason} = coins the browser could NOT evaluate (no candles, prices differ from the engine's, closed bar changed, ...). Engine candidates of those
     coins cannot be checked; they are listed as `unchecked` (with the reason in `unchecked_why`) and make the status "partial", never "mismatch" (a failed request
     or a revised candle is not a disagreement of the computation). */
  function compareEngine(state, X, cands, skipped) {
    var eng = state.engine_cands && state.engine_cands[String(X)];
    if (!eng) return { status: "none" };
    skipped = skipped || {};
    var mine = {}, theirs = {}, unchecked = [], why = {}, k;
    cands.forEach(function (c) { mine[c.sym + "|" + c.dir] = c; });
    eng.forEach(function (e) { if (Object.prototype.hasOwnProperty.call(skipped, e[0])) { unchecked.push(e[0] + "|" + e[1]); why[e[0] + "|" + e[1]] = skipped[e[0]]; } else theirs[e[0] + "|" + e[1]] = e; });
    var onlyMine = [], onlyEng = [], diffAtr = [];
    for (k in mine) if (!theirs[k]) onlyMine.push(k); else if (Math.abs(mine[k].atrp - theirs[k][2]) > TOL_ATR * Math.abs(theirs[k][2])) diffAtr.push(k);
    for (k in theirs) if (!mine[k]) onlyEng.push(k);
    var ok = !onlyMine.length && !onlyEng.length && !diffAtr.length;
    return { status: !ok ? "mismatch" : unchecked.length ? "partial" : "match", n_engine: eng.length, n_browser: cands.length, only_browser: onlyMine, only_engine: onlyEng, atr_diff: diffAtr, unchecked: unchecked, unchecked_why: why };
  }

  /* ---- the two shares and the only rule on them ----
     cnt = the per-hour counts of evaluateHour. Every coin that has a state value for the hour (the UNIVERSE) is in exactly ONE class:
         evaluated (MATCH) + no_grid + bad_data + no_bars + unaligned + no_control_bar + short_history + no_p1 + revised = universe        (partition_ok)
     COVERAGE = evaluated / universe                          the check is valid only if COVERAGE >= 90 %   (integers: evaluated * 10 >= 9 * universe)
     MISMATCH = unaligned / comparable,  REVISION = revised / comparable,  comparable = universe - no_grid - bad_data - no_bars - no_control_bar
                (the coins whose data could be compared with OKX at all; a coin without data is UNAVAILABLE, never a mismatch)
     There is NO separate limit on MISMATCH or REVISION, because the coverage rule already implies it. Since evaluated <= comparable <= universe:
         unaligned + revised <= comparable - evaluated <= comparable - 0.9 * universe <= comparable - 0.9 * comparable = 0.1 * comparable
     so while COVERAGE >= 90 %, MISMATCH + REVISION can never exceed 10 %, and a second 10 % rule could never fire. (unit.js checks the inequality on every split of 60 and 106 coins.)
     What the old rules gave and this keeps: the CAUSE. `cause` = the class that cost the most coins ("control_data" = control closes differ, "data_revision" = OKX changed closed
     candles, "data_missing" = no/bad OKX data or no stored bars or no control bar, "short_history" = history too short or no previous close); the first of equal classes wins, in that order.
     Both shares are reported at all times, so a revision or a mismatch is visible even when the check stays valid. */
  function judgeCounts(cnt) {
    var U = cnt.universe, E = cnt.evaluated, missing = cnt.no_grid + cnt.bad_data + cnt.no_bars + cnt.no_control_bar, comparable = U - missing;
    var classes = [["control_data", cnt.unaligned], ["data_revision", cnt.revised], ["data_missing", missing], ["short_history", cnt.short_history + cnt.no_p1]], cause = "", best = 0;
    classes.forEach(function (c) { if (c[1] > best) { best = c[1]; cause = c[0]; } });
    var state = U > 0 && E === U ? "complete" : (U > 0 && E * COV_DEN >= COV_NUM * U ? "partial" : "insufficient");
    return {
      coverage: { evaluated: E, universe: U, ratio: U ? E / U : 0, state: state },
      control: { match: E, mismatch: cnt.unaligned, revision: cnt.revised, unavailable: missing + cnt.short_history + cnt.no_p1, universe: U, comparable: comparable,
                 mismatch_share: comparable ? cnt.unaligned / comparable : 0, revision_share: comparable ? cnt.revised / comparable : 0 },
      not_evaluated: U - E, cause: U === E ? "" : cause,
      causes: { control_data: cnt.unaligned, data_revision: cnt.revised, data_missing: missing, short_history: cnt.short_history + cnt.no_p1 },
      partition_ok: E + cnt.no_grid + cnt.bad_data + cnt.no_bars + cnt.unaligned + cnt.no_control_bar + cnt.short_history + cnt.no_p1 + cnt.revised === U
    };
  }

  /* ---- the data-quality ledger (DATA_REVISION), pure functions; storage is the page's business ----
     A ledger row is ONE distinct change of ONE closed candle: symbol + candle time + field + old value (the engine's) + new value (OKX's). Seeing the same change again in
     the next ten checks changes nothing but `seen`, `last_seen_utc` and `last_check` of that row; a new value of the same field is a new row. The same check id is
     never counted twice. Nothing here touches the shadow ledger, the strategy or the engine state. kind: changed (a price differs) | added (OKX has a bar the engine did
     not) | removed (the engine had a bar OKX no longer returns); for added/removed the field is "bar" and the value is the close. */
  function dqNew() { return { v: 1, kind: "data_quality_ledger", rows: [], overflow: 0 }; }
  function dqKey(e) { return [e.sym, e.ts, e.field, e.old === null || e.old === undefined ? "" : String(e.old), e["new"] === null || e["new"] === undefined ? "" : String(e["new"])].join("|"); }
  function dqValid(l) {
    if (!l || l.kind !== "data_quality_ledger" || l.v !== 1 || !Array.isArray(l.rows) || !Number.isInteger(l.overflow) || l.overflow < 0) return false;
    return l.rows.every(function (r) { return r && typeof r.sym === "string" && Number.isInteger(r.ts) && typeof r.field === "string" && typeof r.kind === "string" && Number.isInteger(r.seen) && r.seen >= 1 &&
      typeof r.first_seen_utc === "string" && typeof r.last_seen_utc === "string" && typeof r.first_check === "string" && typeof r.last_check === "string"; });
  }
  /* obs = {check_id, observed_utc}; events as analyse() returns them (sym, ts, field, kind, old, new). Returns {added, again, overflowed}. */
  function dqMerge(l, events, obs) {
    var idx = {}, res = { added: 0, again: 0, overflowed: 0 }, k;
    for (k = 0; k < l.rows.length; k++) idx[dqKey({ sym: l.rows[k].sym, ts: l.rows[k].ts, field: l.rows[k].field, old: l.rows[k].old, "new": l.rows[k]["new"] })] = l.rows[k];
    events.forEach(function (e) {
      var key = dqKey(e), row = idx[key];
      if (row) {
        if (row.last_check !== obs.check_id) { row.seen++; row.last_seen_utc = obs.observed_utc; row.last_check = obs.check_id; res.again++; }
      } else if (l.rows.length >= DQ_MAX) { l.overflow++; res.overflowed++; }
      else {
        row = { sym: e.sym, ts: e.ts, candle_utc: new Date(e.ts).toISOString().slice(0, 16) + "Z", field: e.field, kind: e.kind, old: e.old === undefined ? null : e.old, "new": e["new"] === undefined ? null : e["new"],
                first_seen_utc: obs.observed_utc, last_seen_utc: obs.observed_utc, first_check: obs.check_id, last_check: obs.check_id, seen: 1 };
        l.rows.push(row); idx[key] = row; res.added++;
      }
    });
    return res;
  }
  function dqCsv(l) {
    var q = function (v) { v = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var head = ["symbol", "candle_utc", "field", "kind", "old_value_engine", "new_value_okx", "first_observed_utc", "last_observed_utc", "times_observed", "first_check_id", "last_check_id"];
    return [head.join(",")].concat(l.rows.map(function (r) { return [r.sym, r.candle_utc, r.field, r.kind, r.old, r["new"], r.first_seen_utc, r.last_seen_utc, r.seen, r.first_check, r.last_check].map(q).join(","); })).join("\r\n") + "\r\n";
  }

  /* ---- network: 1 request per coin, evenly spaced (OKX allows 40 per 2 s; we send 8 per second) ---- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /* one request with its own timeout (REQ_TIMEOUT); the caller's signal (lock / leave the page / a newer check) also aborts it */
  async function fetchOne(inst, f, signal, timeoutMs) {
    var url = API + "?instId=" + encodeURIComponent(inst) + "&bar=1H&limit=" + NB;
    for (var attempt = 0; attempt < 2; attempt++) {
      var ctl = new AbortController(), timedOut = false, onAbort = function () { ctl.abort(); };
      if (signal) { if (signal.aborted) throw new Error("aborted"); signal.addEventListener("abort", onAbort); }
      var timer = setTimeout(function () { timedOut = true; ctl.abort(); }, timeoutMs || REQ_TIMEOUT);
      try {
        var r = await f(url, { cache: "no-store", signal: ctl.signal });
        if (r.status === 429) { await sleep(1200); continue; }
        if (!r.ok) throw new Error("http " + r.status);
        var j = await r.json();
        if (j.code === "50011") { await sleep(1200); continue; }
        if (j.code !== "0") throw new Error("okx " + j.code);
        if (!Array.isArray(j.data)) throw new Error("bad payload");
        if (!j.data.length) throw new Error("empty");
        return j.data;
      } catch (e) {
        if (signal && signal.aborted) throw e;
        if (timedOut) e = new Error("timeout");
        if (attempt === 1) throw e;
        await sleep(400);
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    }
    throw new Error("rate limited");
  }
  /* Requests start one at a time, evenly spaced: `per` requests per `gap` ms (default 8 per second = one every 125 ms), never in bursts. The exchange allows 40 per
     2 s per IP, so the steady rate is a fifth of the limit and even a worst case of three coins' worth of jitter stays far below it. A request that is still
     running does not delay the next one; the whole download has a deadline after which no new request is started. Everything a download touches lives in this call
     (no shared state), so two downloads that overlap in time cannot mix. */
  async function fetchAll(state, opts) {
    var f = opts.fetch || (typeof fetch === "function" ? function (u, o) { return fetch(u, o); } : null);   // the page's global fetch
    if (!f) throw new Error("no fetch");
    var per = opts.perSecond || 8, gap = opts.batchGapMs !== undefined ? opts.batchGapMs : 1000, step = gap > 0 ? gap / per : 0, now = opts.now ? opts.now() : Date.now();
    var tmo = opts.timeoutMs || REQ_TIMEOUT, started = Date.now(), deadline = started + (opts.deadlineMs || DEADLINE);
    var syms = Object.keys(state.coins).filter(function (s) { var c = state.coins[s]; return c.atr.some(function (a, i) { return a !== null && c.q[i] !== null; }); });
    var rows = {}, errors = {}, done = 0;
    await Promise.all(syms.map(async function (s, k) {
      var wait = started + k * step - Date.now();
      if (wait > 0) await sleep(wait);
      if (Date.now() > deadline) errors[s] = "deadline";
      else if (opts.signal && opts.signal.aborted) errors[s] = "aborted";
      else { try { rows[s] = await fetchOne(state.coins[s].inst, f, opts.signal, tmo); } catch (e) { errors[s] = String(e && e.message || e); } }
      done++;
      if (opts.onProgress) opts.onProgress(done, syms.length);
    }));
    return { rows: rows, errors: errors, requested: syms.length, now: now, started: started, ended: Date.now() };
  }

  /* newest well-formed bar time of one answer (malformed rows are ignored here; gridFromRows reports them) */
  function newestOf(rows) {
    var m = NaN;
    if (!Array.isArray(rows)) return m;
    for (var k = 0; k < rows.length; k++) { var r = rows[k]; if (!Array.isArray(r) || r.length < 9) continue; var t = +r[0]; if (isFinite(t) && t % H === 0 && !(t <= m)) m = t; }
    return m;
  }

  /* ---- the engine state itself: is it a state this code can read? Returns "" or the name of the first problem.
     The decision hours are explicit timestamps (hours_ts, consecutive hours) and every per-hour array has exactly that many entries, so a value is only ever
     read for the hour it was written for. The run time must come after the last bar it used was closed (a run cannot know a bar that had not ended). ---- */
  function stateProblem(st) {
    var hrs = st.hours_ts, b = st.bars_through_ts, k, syms;
    if (!Array.isArray(hrs) || !hrs.length) return "hours_ts";
    for (k = 0; k < hrs.length; k++) if (!Number.isInteger(hrs[k]) || hrs[k] % H !== 0 || (k && hrs[k] - hrs[k - 1] !== H)) return "hours_ts";
    if (!Number.isInteger(b) || b % H !== 0 || hrs.indexOf(b) < 0) return "bars_through_ts";
    if (!st.params || !st.coins || typeof st.coins !== "object") return "coins";
    syms = Object.keys(st.coins);
    if (!syms.length) return "coins";
    for (k = 0; k < syms.length; k++) {
      var c = st.coins[syms[k]];
      if (!c || !Array.isArray(c.q) || !Array.isArray(c.atr) || !Array.isArray(c.slip) || !Array.isArray(c.chk) || c.q.length !== hrs.length || c.atr.length !== hrs.length || c.slip.length !== hrs.length) return "coin_arrays";
    }
    if (!Number.isInteger(st.bars_first_ts) || st.bars_first_ts % H !== 0) return "bars_first_ts";
    var run = parseUtc(st.engine_run_utc);
    if (!isFinite(run)) return "engine_run_utc";
    if (run < b + H) return "run_before_bar_closed";
    return "";
  }

  /* ---- the whole check ----
     "now" is taken from OKX, not from the device clock: the newest bar time that at least max(2, 5%) of the coins have reached, so one coin with a bogus
     timestamp cannot move it and a download that straddles the top of the hour does not mix two hours (coins still on the older hour just lack the new
     bar and are counted as not evaluated). Every candle the rule uses is a CLOSED bar (confirm=1); the unfinished bar only gives the current price.
     The live hour must be one of the state's own decision hours (looked up by time); the state is on average one to two bars behind it (lag_hours).
     Result flags for the live hour: valid (false = do not rely on the list), reasons, coverage {evaluated, universe, ratio, state, excluded}, complete (every coin evaluated).
     Coverage states: "complete" (every coin evaluated), "partial" (at least MIN_COVERAGE: valid, but not the whole market, the excluded coins are named),
     "insufficient" (below MIN_COVERAGE: the whole check is invalid). */
  function analyse(state, fetched, opts) {
    opts = opts || {};
    var rows = fetched.rows, syms = Object.keys(rows);
    var out = { ok: false, run_id: opts.runId === undefined ? null : opts.runId, requested: fetched.requested, fetched: syms.length, errors: Object.keys(fetched.errors).length, error_list: fetched.errors };
    var newests = syms.map(function (s) { return newestOf(rows[s]); }).filter(function (t) { return t === t; }).sort(function (a, b) { return a - b; });
    if (!newests.length) { out.reason = "no_candles"; return out; }
    var need = Math.min(newests.length, Math.max(2, Math.ceil(0.05 * newests.length)));
    var xnow = newests[newests.length - need], first = xnow - (NB - 1) * H, grids = {}, px = {}, revs = {};
    syms.forEach(function (s) {
      var g = gridFromRows(rows[s], first, NB);
      if (g.newest > xnow + H) { g.fatal = g.fatal || "future_time"; }
      grids[s] = g;
      if (g.px === g.px && g.newest === xnow) px[s] = g.px;
      if (!g.fatal && state.coins[s]) revs[s] = revisionOf(state, state.coins[s], g);
    });
    var b = state.bars_through_ts, hrs = state.hours_ts, last = hrs[hrs.length - 1];
    var skew = fetched.now - xnow;                       // bar start <= device now < bar start + 1 h (+ tolerance)
    out.xnow = xnow; out.clock_skew = skew < -120000 || skew > H + 120000;
    out.bars_through_ts = b; out.engine_run_ms = parseUtc(state.engine_run_utc);
    out.state_live = hrs.indexOf(xnow) >= 0;             // the live hour is one of the six hours the engine dated
    out.lag_hours = (xnow - b) / H;                      // how many bars the engine's last bar is behind the live hour (1 = the engine has the previous bar)
    out.px = px; out.hours = [];
    out.fetch_started = fetched.started; out.fetch_ended = fetched.ended;
    out.straddled = isFinite(fetched.started) && isFinite(fetched.ended) && Math.floor(fetched.started / H) !== Math.floor(fetched.ended / H);   // the download crossed the top of an hour
    var split = { at: 0, ahead: 0, behind: 0 };
    syms.forEach(function (s) { var t = grids[s].newest; if (t === xnow) split.at++; else if (t > xnow) split.ahead++; else split.behind++; });
    out.hour_split = split;                              // coins whose newest bar is the live hour / already the next hour / older
    var back = opts.hours === undefined ? 3 : opts.hours;
    for (var X = xnow - back * H; X <= xnow; X += H) {
      var r = evaluateHour(state, grids, X, revs);
      if (!r.supported) continue;
      r.live = X === xnow;
      r.engine = X <= b ? compareEngine(state, X, r.cands, r.skipped) : { status: "pending" };
      out.hours.push(r);
    }
    var live = null;
    out.hours.forEach(function (h) { if (h.live) live = h; });
    var fatal = {}, holes = [];
    syms.forEach(function (s) { if (grids[s].fatal) fatal[s] = grids[s].fatal; else if (grids[s].holes) holes.push(s); });
    var revised = {}, nRev = 0;
    Object.keys(revs).forEach(function (s) {
      var v = revs[s];
      if (v && v.n) { nRev++; revised[s] = { n: v.n, compared: v.compared, changed: v.changed.slice(0, 6), added: v.added.slice(0, 6), removed: v.removed.slice(0, 6) }; }
    });
    out.data_issues = { fatal: fatal, holes: holes };
    out.revisions = { n_coins: nRev, coins: revised };          // the record of closed candles that OKX changed since the engine read them (6 per list, for display)
    var evs = [];                                               // ALL changes, with old and new value, for the data-quality ledger
    Object.keys(revs).sort().forEach(function (s) { var v = revs[s]; if (v && v.n) v.events.forEach(function (e) { evs.push({ sym: s, ts: e.ts, field: e.field, kind: e.kind, old: e.old, "new": e["new"] }); }); });
    out.revision_events = evs;
    var obsMs = isFinite(fetched.ended) ? fetched.ended : (isFinite(fetched.started) ? fetched.started : NaN);
    out.check_id = "chk-" + (isFinite(fetched.started) ? new Date(fetched.started).toISOString().slice(0, 19) + "Z" : "unknown") + "#" + (opts.runId === undefined ? 0 : opts.runId);
    out.observed_utc = isFinite(obsMs) ? new Date(obsMs).toISOString() : null;
    var cnt = live ? live.counts : null;
    out.coverage = null; out.control = null; out.cause = ""; out.causes = null;
    if (live) {
      var jc = judgeCounts(cnt);
      var excluded = Object.keys(live.skipped).filter(function (s) { return live.skipped[s] !== "no_state"; }).sort();
      jc.coverage.excluded = excluded;
      out.coverage = jc.coverage; out.control = jc.control; out.cause = jc.cause; out.causes = jc.causes;
    }
    out.complete = !!(live && cnt.universe && cnt.evaluated === cnt.universe);
    var why = [];
    if (!out.state_live) why.push(xnow > last ? "state_stale" : "hour_not_in_state");
    else if (!live) why.push("no_live_hour");
    else {
      if (out.coverage.state === "insufficient") why.push("coverage");     // the ONLY limit on coin counts (COVERAGE >= 90 %); it implies MISMATCH + REVISION <= 10 % of the comparable coins, see judgeCounts. out.cause says what cost the coins.
    }
    if (out.hours.some(function (h) { return h.engine && h.engine.status === "mismatch"; })) why.push("engine_mismatch");
    out.invalid_reasons = why; out.valid = why.length === 0;
    out.ok = true;
    return out;
  }
  async function run(state, opts) {
    opts = opts || {};
    var id = opts.runId === undefined ? null : opts.runId;
    if (!state || state.kind !== "squeeze_live_state" || state.version !== VERSION) return { ok: false, run_id: id, reason: "bad_state" };
    if (state.engine_status === "failed") return { ok: false, run_id: id, reason: "engine_failed", engine: { run_utc: state.engine_run_utc || null, error: String(state.error || "").slice(0, 300) } };   // no old state is ever used after a failed run
    if (state.engine_status !== "ok") return { ok: false, run_id: id, reason: "bad_state", detail: "engine_status" };
    var why = stateProblem(state);
    if (why) return { ok: false, run_id: id, reason: "bad_state", detail: why };
    var fetched = await fetchAll(state, opts);
    return analyse(state, fetched, opts);
  }

  return { gridFromRows: gridFromRows, roll: roll, evalCoin: evalCoin, evaluateHour: evaluateHour, compareEngine: compareEngine, revisionOf: revisionOf, stateProblem: stateProblem, parseUtc: parseUtc,
           judgeCounts: judgeCounts, dqNew: dqNew, dqKey: dqKey, dqValid: dqValid, dqMerge: dqMerge, dqCsv: dqCsv,
           fetchAll: fetchAll, analyse: analyse, run: run, H: H, NB: NB, VERSION: VERSION,
           MIN_COVERAGE: MIN_COVERAGE, COV_NUM: COV_NUM, COV_DEN: COV_DEN, DQ_MAX: DQ_MAX, TOL_ATR: TOL_ATR, TOL_PX: TOL_PX, REQ_TIMEOUT: REQ_TIMEOUT, DEADLINE: DEADLINE };
});
