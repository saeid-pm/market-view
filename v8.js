/* v8.js: «استراتژی‌ها» و «ورود واقعی» (پنل ۸). فقط نمایش و محاسبه در مرورگر.
   این فایل هیچ درخواست نوشتنی ندارد، به موتور و دفترهای سایه دست نمی‌زند و فقط از راه window.PanelBridge می‌خواند:
     lab.enc.json   تاریخچهٔ آزمون استراتژی‌ها (ثابت، ساختهٔ paper/lab/history.json)
     paper.enc.json دفترهای سایه + کاندیداهای اخیر هر استراتژی (lab)
     seed.enc.json  کندل‌های ساعتی اخیر (برای شبیه‌ساز)
   دفتر دستی و تنظیمات ابزار ورود فقط در حافظهٔ همین مرورگر می‌ماند (localStorage) و با هیچ دفتر سایه‌ای جمع نمی‌شود. */
(function () {
  "use strict";
  var BR = window.PanelBridge;
  if (!BR) return;
  var H = 3600000, $ = function (id) { return document.getElementById(id); };
  var fa = BR.FA, esc = BR.esc, fin = function (x) { return typeof x === "number" && isFinite(x); };
  var LAB = null, LABstate = "none", ST = null, STerr = "", simOut = null, charts = {}, chN = 0;
  var S = { sel: "squeeze-atr1.5-v1", key: {}, comb: {}, sim: { sid: "squeeze-atr1.5-v1", mult: "", dl: "", mo: "", md: "", dir: 0, scope: "book", act: "" } };
  var lsGet = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  var css = document.createElement("style");
  css.textContent = ":root{--s1:#2a66c4;--s2:#b85c00;--s3:#0b8a83;--s4:#7b4fc9;--s5:#b8336f;--s6:#5f7300}" +
    "@media (prefers-color-scheme: dark){:root:not([data-theme=light]){--s1:#7fb0f0;--s2:#f0a45a;--s3:#4fd1c8;--s4:#b79cf2;--s5:#f08db8;--s6:#c3d65a}}" +
    ":root[data-theme=dark]{--s1:#7fb0f0;--s2:#f0a45a;--s3:#4fd1c8;--s4:#b79cf2;--s5:#f08db8;--s6:#c3d65a}" +
    ".v8ban{background:var(--warn-soft);border-radius:8px;padding:8px 12px;font-size:13px}" +
    ".v8chart{position:relative;min-height:60px}.v8chart svg{display:block;inline-size:100%}.v8tip{position:absolute;top:4px;background:var(--surface);border:1px solid var(--line2);border-radius:8px;padding:6px 9px;font-size:12px;pointer-events:none;line-height:1.6;z-index:2;white-space:nowrap}" +
    ".v8leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--ink2);margin-top:6px}.v8leg i{display:inline-block;inline-size:14px;block-size:3px;border-radius:2px;vertical-align:middle;margin-inline-end:5px}" +
    ".v8form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end}.v8form label{display:grid;gap:3px;font-size:12px;color:var(--ink2)}" +
    ".v8form input,.v8form select,.v8in{font:inherit;padding:7px 9px;border-radius:8px;border:1px solid var(--line2);background:var(--surface);color:var(--ink);inline-size:100%;min-inline-size:0}" +
    ".v8list tbody tr{cursor:pointer}.v8big{font-size:17px;font-weight:800}.v8row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}" +
    ".v8out{background:var(--surface2);border-radius:8px;padding:10px 12px}.v8out .kv>:nth-child(even){font-weight:700}";
  document.head.appendChild(css);

  /* ---------- قالب‌بندی ---------- */
  var nf = function (v, d) { return fin(v) ? '<span class="n">' + fa(v.toFixed(d === undefined ? 2 : d)) + "</span>" : "–"; };
  var rr = function (v, d) { return fin(v) ? '<span class="n ' + (v > 0 ? "pos" : v < 0 ? "neg" : "") + '">' + fa((v > 0 ? "+" : "") + v.toFixed(d === undefined ? 1 : d)) + "R</span>" : "–"; };
  var px = function (v) { if (!fin(v)) return "–"; var a = Math.abs(v), d = a >= 1000 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8; return '<span class="n">' + fa(Number(v.toFixed(d)).toString()) + "</span>"; };
  var VP = { "پشتیبانی": "pos", "نامشخص": "warn", "رد": "neg", "مرجع": "" };
  var pill = function (t, c) { return '<span class="pill ' + (c || "") + '">' + esc(t) + "</span>"; };
  var GRP = { squeeze: "فشردگی", manual: "اجرای دستی", classic: "الگوی کلاسیک", derived: "دادهٔ مشتقه" };
  var WHYFA = { stop: "استاپ", time: "مهلت", cap: "سقف ۷۲۰س", nodata: "بدون داده", winner_cap: "سقف برنده", open: "باز" };
  var tehran = function (ms) { return fa(new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Tehran", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })); };
  var dkey = function (k) { var p = k.split("|"); return "استاپ " + fa(p[0]) + " برابر ATR · " + (p[1] === "0" ? "بدون مهلت" : "مهلت " + fa(p[1]) + " ساعت"); };
  var strat = function (id) { return LAB ? LAB.strategies.filter(function (s) { return s.id === id; })[0] : null; };
  var keyOf = function (id) { return S.key[id] || (LAB ? LAB.default_key : "1.5|72"); };
  var bookOf = function (id) { var P = BR.paper(); var bs = (P && P.books) || []; for (var i = 0; i < bs.length; i++) if (bs[i].strategy_id === id && bs[i].kind !== "account") return { b: bs[i], i: i }; return null; };

  /* ---------- نمودار خطی (پله‌ای) با نشانگر ---------- */
  function chartBox(series, o) {
    var id = "v8c" + (++chN);
    charts[id] = { series: series, o: o || {} };
    var leg = series.length > 1 ? '<div class="v8leg">' + series.map(function (s) { return "<span><i style=\"background:" + s.color + "\"></i>" + esc(s.name) + "</span>"; }).join("") + "</div>" : "";
    return '<div class="v8chart" data-ch="' + id + '"></div>' + leg;
  }
  function nice(lo, hi, n) {
    var span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / n))), e = span / n / step;
    step *= e >= 5 ? 5 : e >= 2 ? 2 : 1;
    var out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
    return out;
  }
  function drawCharts(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".v8chart"), function (el) {
      var c = charts[el.dataset.ch];
      if (!c) return;
      var W = Math.max(280, el.clientWidth || 640), Hh = c.o.h || 230, L = 46, R = 8, T = 10, B = 22;
      var xs = [], ys = [0];
      c.series.forEach(function (s) { if (s.x.length) { xs.push(s.x[0], s.x[s.x.length - 1]); s.y.forEach(function (v) { ys.push(v); }); } });
      if (!xs.length) { el.innerHTML = '<p class="empty">داده‌ای برای نمودار نیست.</p>'; return; }
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      if (x1 === x0) x1 = x0 + 1;
      var pad = (y1 - y0 || 1) * 0.06; y0 -= pad; y1 += pad;
      var X = function (v) { return L + (v - x0) / (x1 - x0) * (W - L - R); }, Y = function (v) { return T + (y1 - v) / (y1 - y0) * (Hh - T - B); };
      var g = "";
      nice(y0, y1, 4).forEach(function (v) {
        g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--line' + (v === 0 ? "2" : "") + ')" stroke-width="1"/>' +
          '<text x="' + (L - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--muted)" direction="ltr">' + fa(String(Math.round(v * 10) / 10)) + "</text>";
      });
      var ms = c.o.ms || function (v) { return v; };
      var d0 = new Date(ms(x0)), d1 = new Date(ms(x1)), spanD = (ms(x1) - ms(x0)) / 86400000, ticks = [];
      if (spanD > 400) { for (var yv = d0.getUTCFullYear() + 1; yv <= d1.getUTCFullYear(); yv++) ticks.push([Date.UTC(yv, 0, 1), String(yv)]); }
      else { var stepD = spanD > 60 ? 14 : spanD > 20 ? 7 : spanD > 6 ? 2 : 1; for (var tt = Math.ceil(ms(x0) / 86400000) * 86400000; tt <= ms(x1); tt += stepD * 86400000) { var dd = new Date(tt); ticks.push([tt, (dd.getUTCMonth() + 1) + "/" + dd.getUTCDate()]); } }
      var inv = c.o.inv || function (v) { return v; };
      ticks.forEach(function (t) { var xx = X(inv(t[0])); if (xx < L || xx > W - R) return; g += '<line x1="' + xx.toFixed(1) + '" x2="' + xx.toFixed(1) + '" y1="' + (Hh - B) + '" y2="' + (Hh - B + 4) + '" stroke="var(--line2)"/><text x="' + xx.toFixed(1) + '" y="' + (Hh - 6) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + fa(t[1]) + "</text>"; });
      c.series.forEach(function (s) {
        if (!s.x.length) return;
        var d = "M" + X(s.x[0]).toFixed(1) + " " + Y(0).toFixed(1);
        for (var i = 0; i < s.x.length; i++) d += "H" + X(s.x[i]).toFixed(1) + "V" + Y(s.y[i]).toFixed(1);
        d += "H" + X(x1).toFixed(1);
        g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.w || 2) + '" stroke-linejoin="round"' + (s.dash ? ' stroke-dasharray="5 4"' : "") + "/>";
      });
      el.innerHTML = '<svg viewBox="0 0 ' + W + " " + Hh + '" height="' + Hh + '" role="img" aria-label="' + esc(c.o.label || "نمودار جمع R") + '">' + g +
        '<line class="v8x" x1="0" x2="0" y1="' + T + '" y2="' + (Hh - B) + '" stroke="var(--ink2)" stroke-width="1" visibility="hidden"/></svg><div class="v8tip" hidden></div>';
      el.onpointermove = function (ev) {
        var r = el.getBoundingClientRect(), mx = (ev.clientX - r.left) / r.width * W;
        if (mx < L || mx > W - R) { el.onpointerleave(); return; }
        var xv = x0 + (mx - L) / (W - L - R) * (x1 - x0), tip = el.querySelector(".v8tip"), ln = el.querySelector(".v8x");
        var rows = c.series.map(function (s) {
          var lo = 0, hi = s.x.length;
          while (lo < hi) { var m = (lo + hi) >> 1; if (s.x[m] <= xv) lo = m + 1; else hi = m; }
          return "<div><i style=\"display:inline-block;inline-size:10px;block-size:3px;background:" + s.color + ";vertical-align:middle;margin-inline-end:5px\"></i>" + (c.series.length > 1 ? esc(s.name) + ": " : "") + rr(lo ? s.y[lo - 1] : 0) + "</div>";
        }).join("");
        var dt = new Date(ms(xv));
        tip.innerHTML = '<div class="n" style="color:var(--muted)">' + fa(dt.getUTCFullYear() + "-" + ("0" + (dt.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + dt.getUTCDate()).slice(-2)) + "</div>" + rows;
        tip.hidden = false;
        var px_ = (mx / W) * r.width;
        tip.style.left = Math.min(Math.max(4, px_ + 10), Math.max(4, r.width - tip.offsetWidth - 4)) + "px";
        ln.setAttribute("x1", mx); ln.setAttribute("x2", mx); ln.setAttribute("visibility", "visible");
      };
      el.onpointerleave = function () { var t = el.querySelector(".v8tip"), l = el.querySelector(".v8x"); if (t) t.hidden = true; if (l) l.setAttribute("visibility", "hidden"); };
    });
  }
  var cum = function (x, r) { var y = [], s = 0; for (var i = 0; i < r.length; i++) { s += r[i] / 1000; y.push(s); } return { x: x, y: y }; };
  var labMs = function (v) { return (LAB.base_hour + v) * H; }, labInv = function (ms) { return ms / H - LAB.base_hour; };

  /* ---------- صفحهٔ استراتژی‌ها ---------- */
  async function loadLab() {
    LABstate = "loading"; renderLab();
    try { LAB = await BR.fetchEnc("lab.enc.json"); LABstate = LAB && LAB.kind === "lab_history" ? "ok" : "missing"; }
    catch (e) { LAB = null; LABstate = "error"; }
    renderLab();
  }
  function liveCell(id) {
    var bk = bookOf(id);
    if (!bk) return '<span class="note">دفتر زنده ندارد</span>';
    var c = bk.b.closed || {}, n = bk.b.trades_total || 0;
    return fa(n) + " بسته · " + fa((bk.b.open || []).length) + " باز" + (n && c.ex_funding && fin(c.ex_funding.mean) ? " · میانگین " + rr(c.ex_funding.mean, 2) : "");
  }
  function renderLab() {
    var el = $("tabLab");
    if (!el || el.hidden) return;
    if (LABstate === "none") { loadLab(); return; }
    if (LABstate !== "ok") {
      el.innerHTML = '<section class="card"><h2>استراتژی‌ها</h2><p class="empty">' + (LABstate === "loading" ? "در حال خواندن تاریخچهٔ آزمون‌ها…" : LABstate === "missing" ? "فایل آزمایشگاه (lab.enc.json) هنوز منتشر نشده است. بعد از اولین اجرای Collect Hourly با نسخهٔ ۸ ساخته می‌شود." : "خواندن فایل آزمایشگاه ناموفق بود. صفحه را تازه کن.") + "</p></section>";
      return;
    }
    charts = {}; chN = 0;
    var h = '<section class="card"><h2>استراتژی‌ها: هر کدام جدا، با همان خروج و همان سقف‌ها</h2>' +
      '<p class="v8ban">این صفحه فقط نتیجهٔ آزمون روی گذشته و دفترهای سایه را نشان می‌دهد و اجازه یا پیشنهاد ورود نیست. ' + fa(LAB.strategies.length - 2) + " قاعدهٔ تازه با هم آزمون شده‌اند؛ مثبت‌بودن یکی از آن‌ها می‌تواند تصادفی باشد. " +
      esc(LAB.data_fa || "") + "</p>" +
      '<div class="tbl" style="margin-top:10px"><table class="v8list"><thead><tr><th>استراتژی</th><th>گروه</th><th>نتیجهٔ آزمون</th><th class="num">معامله</th><th class="num">جمع R</th><th class="num">میانگین R</th><th>بازهٔ ۹۰٪ میانگین</th><th class="num">توسعه</th><th class="num">holdout</th><th>دفتر سایهٔ زنده</th></tr></thead><tbody>' +
      LAB.strategies.map(function (s) {
        var d = s.default;
        return '<tr data-sid="' + esc(s.id) + '"' + (s.id === S.sel ? ' class="sel"' : "") + "><th>" + esc(s.name) + "</th><td>" + esc(GRP[s.group] || s.group) + "</td><td>" + pill(s.verdict, VP[s.verdict]) + "</td><td class=\"num\">" + nf(d.n, 0) +
          '</td><td class="num">' + rr(d.total) + '</td><td class="num">' + rr(d.mean, 3) + "</td><td>" + (d.ci90 ? nf(d.ci90[0], 3) + " تا " + nf(d.ci90[1], 3) : "–") +
          '</td><td class="num">' + rr(d.dev.total) + '</td><td class="num">' + rr(d.holdout.total) + "</td><td>" + liveCell(s.id) + "</td></tr>";
      }).join("") +
      (LAB.other || []).map(function (o) { return "<tr style=\"cursor:default\"><th>" + esc(o.name) + "</th><td>فشردگی</td><td>" + pill(o.verdict, VP[o.verdict]) + '</td><td class="num">' + nf(o.n, 0) + '</td><td class="num">' + rr(o.total) + '</td><td class="num">' + rr(o.mean, 3) + '</td><td colspan="4" class="note">' + esc(o.note) + "</td></tr>"; }).join("") +
      "</tbody></table></div>" +
      '<p class="note" style="margin-top:8px">«پشتیبانی»: توسعه و holdout هر دو مثبت و کران پایین بازهٔ اطمینان بالای صفر. «نامشخص»: از صفر قابل تفکیک نیست. «رد»: جمع منفی یا هر دو دوره منفی؛ برای قاعدهٔ ردشده دفتر زنده باز نمی‌شود. روی هر سطر بزن تا جزئیاتش پایین بیاید.</p></section>';
    h += detailHtml() + combineHtml() + simHtml();
    el.innerHTML = h;
    drawCharts(el);
  }
  function statTable(g) {
    var yrs = Object.keys(g.years || {});
    return '<div class="grid2"><div class="kv"><span>تعداد معامله</span><span>' + nf(g.n, 0) + "</span><span>جمع R</span><span>" + rr(g.total) + "</span><span>میانگین هر معامله</span><span>" + rr(g.mean, 3) +
      "</span><span>بازهٔ اطمینان ۹۰٪ میانگین</span><span>" + (g.ci90 ? nf(g.ci90[0], 3) + " تا " + nf(g.ci90[1], 3) : "–") + "</span><span>درصد برد</span><span>" + nf(g.win, 1) + "٪</span><span>نسبت سود به زیان</span><span>" + nf(g.pf, 2) +
      "</span><span>بیشترین افت</span><span>" + rr(g.maxdd) + "</span><span>میانهٔ مدت معامله</span><span>" + nf(g.hours_median, 0) + " ساعت</span><span>جمع ۵ معاملهٔ برتر</span><span>" + rr(g.top5_total) +
      '</span></div><div><div class="kv"><span>توسعه</span><span>' + nf(g.dev.n, 0) + " معامله · " + rr(g.dev.total) + "</span><span>holdout</span><span>" + nf(g.holdout.n, 0) + " معامله · " + rr(g.holdout.total) +
      "</span><span>لانگ</span><span>" + nf(g.long.n, 0) + " · " + rr(g.long.total) + "</span><span>شورت</span><span>" + nf(g.short.n, 0) + " · " + rr(g.short.total) + "</span><span>خروج‌ها</span><span>" +
      Object.keys(g.exit_mix || {}).map(function (k) { return (WHYFA[k] || k) + " " + fa(g.exit_mix[k]); }).join(" · ") + "</span></div>" +
      '<div class="tbl" style="margin-top:8px"><table><thead><tr><th>سال</th>' + yrs.map(function (y) { return '<th class="num">' + fa(y) + "</th>"; }).join("") + "</tr></thead><tbody><tr><th>جمع R</th>" +
      yrs.map(function (y) { return '<td class="num">' + rr(g.years[y].total) + "</td>"; }).join("") + "</tr><tr><th>معامله</th>" + yrs.map(function (y) { return '<td class="num">' + nf(g.years[y].n, 0) + "</td>"; }).join("") + "</tr></tbody></table></div></div></div>";
  }
  function detailHtml() {
    var s = strat(S.sel) || LAB.strategies[0], k = keyOf(s.id), g = s.grid[k], isDef = k === LAB.default_key, sm = k.split("|")[0], dl = k.split("|")[1];
    var c = cum(g.x, g.r), bk = bookOf(s.id), sl = s.default.signal_level;
    var opt = function (arr, cur, f) { return arr.map(function (v) { return '<option value="' + v + '"' + (String(v) === String(cur) ? " selected" : "") + ">" + f(v) + "</option>"; }).join(""); };
    return '<section class="card" id="v8detail"><div class="hwin"><h2 style="margin:0">' + esc(s.name) + " " + pill(s.verdict, VP[s.verdict]) + (s.live ? "" : " " + pill("فقط تاریخچه", "")) + "</h2>" +
      (bk ? '<button type="button" class="ghost" data-go="' + bk.i + '">دفتر سایهٔ زنده ←</button>' : "") + "</div>" +
      '<p class="sub" style="margin-bottom:10px">' + esc(s.desc) + ' <span class="n" style="color:var(--muted)">' + esc(s.id) + "</span></p>" +
      '<div class="v8form" style="max-inline-size:520px;margin-bottom:10px"><label>ضریب استاپ (×ATR روزانه)<select data-set="sm">' + opt(LAB.stops, sm, function (v) { return fa(v); }) + "</select></label>" +
      '<label>مهلت سربه‌سر<select data-set="dl">' + opt(LAB.deadlines, dl, function (v) { return v ? fa(v) + " ساعت" : "بدون مهلت"; }) + "</select></label></div>" +
      (isDef ? '<p class="note" style="margin-bottom:8px">تنظیم قفل‌شدهٔ قاعده. برچسب نتیجه فقط از همین تنظیم می‌آید.</p>' : '<p class="v8ban" style="margin-bottom:8px"><b>اکتشافی:</b> این تنظیم بعد از دیدن داده مقایسه شده و برای هیچ تصمیمی معتبر نیست. اگر بین ۱۶ تنظیم بهترین را انتخاب کنی، عدد آن خوش‌بینانه است.</p>') +
      chartBox([{ name: s.name, color: "var(--s1)", x: c.x, y: c.y }], { ms: labMs, inv: labInv, label: "جمع R " + s.name }) +
      '<div style="margin-top:12px">' + statTable(g) + "</div>" +
      (sl && isDef ? '<p class="note" style="margin-top:10px">هر سیگنال به‌تنهایی (بدون سقف روزانه و سقف پوزیشن): ' + nf(sl.n, 0) + " سیگنال · میانگین " + rr(sl.mean, 3) + (sl.ci90 ? " · بازهٔ ۹۰٪ از " + nf(sl.ci90[0], 3) + " تا " + nf(sl.ci90[1], 3) : "") + ". فاصلهٔ این عدد با دفتر سقف‌دار نشان می‌دهد نتیجه چقدر به انتخاب بین سیگنال‌های هم‌زمان وابسته است.</p>" : "") +
      gridHtml(s) + "</section>";
  }
  function gridHtml(s) {
    var h = '<details class="fold sub" style="margin-top:12px"><summary>جدول همهٔ تنظیم‌ها (اکتشافی): جمع R و تعداد معامله</summary><div class="tbl"><table><thead><tr><th>استاپ \\ مهلت</th>' +
      LAB.deadlines.map(function (d) { return '<th class="num">' + (d ? fa(d) + "س" : "بدون") + "</th>"; }).join("") + "</tr></thead><tbody>";
    LAB.stops.forEach(function (sm) {
      h += "<tr><th>" + fa(sm) + "×</th>" + LAB.deadlines.map(function (d) { var g = s.grid[sm + "|" + d]; return '<td class="num"' + ((sm + "|" + d) === LAB.default_key ? ' style="outline:2px solid var(--line2);outline-offset:-2px"' : "") + ">" + rr(g.total) + ' <span class="note">(' + fa(g.n) + ")</span></td>"; }).join("") + "</tr>";
    });
    return h + '</tbody></table></div><p class="note">خانهٔ قاب‌دار تنظیم قفل‌شده است. پراکندگی این جدول را ببین: وقتی عدد با تغییر کوچک تنظیم زیرورو می‌شود، مزیت شکننده است.</p></details>';
  }
  function combineHtml() {
    var cols = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];
    var sel = LAB.strategies.filter(function (s) { return S.comb[s.id]; });
    var h = '<section class="card" id="v8comb"><h2>ترکیب نمایشی</h2><p class="sub" style="margin-bottom:8px">چند استراتژی را انتخاب کن تا جمع نتیجه‌هایشان کنار هم دیده شود. هر کدام با تنظیمی حساب می‌شود که در بخش جزئیات برایش گذاشته‌ای.</p><div class="v8row">' +
      LAB.strategies.map(function (s) { return '<label class="chk"><input type="checkbox" data-comb="' + esc(s.id) + '"' + (S.comb[s.id] ? " checked" : "") + "> " + esc(s.name) + (keyOf(s.id) !== LAB.default_key ? ' <span class="note">(' + dkey(keyOf(s.id)) + ")</span>" : "") + "</label>"; }).join("") + "</div>";
    if (sel.length < 2) return h + '<p class="empty" style="margin-top:10px">دست‌کم دو استراتژی انتخاب کن.</p></section>';
    var ev = [], series = [], mon = {};
    sel.slice(0, 6).forEach(function (s, i) {
      var g = s.grid[keyOf(s.id)], c = cum(g.x, g.r);
      series.push({ name: s.name, color: cols[i], x: c.x, y: c.y, w: 1.5 });
      mon[s.id] = {};
      for (var k = 0; k < g.x.length; k++) { ev.push([g.x[k], g.r[k]]); var d = new Date(labMs(g.x[k])), m = d.getUTCFullYear() * 12 + d.getUTCMonth(); mon[s.id][m] = (mon[s.id][m] || 0) + g.r[k] / 1000; }
    });
    ev.sort(function (a, b) { return a[0] - b[0]; });
    var cx = [], cy = [], sum = 0, peak = 0, dd = 0;
    ev.forEach(function (e) { sum += e[1] / 1000; cx.push(e[0]); cy.push(sum); if (sum > peak) peak = sum; if (sum - peak < dd) dd = sum - peak; });
    series.unshift({ name: "جمع انتخاب‌شده‌ها", color: "var(--ink)", x: cx, y: cy, w: 2.6 });
    var ids = sel.slice(0, 6).map(function (s) { return s.id; });
    var corr = function (a, b) {
      var ks = {}, k; for (k in mon[a]) ks[k] = 1; for (k in mon[b]) ks[k] = 1;
      var xa = [], xb = []; for (k in ks) { xa.push(mon[a][k] || 0); xb.push(mon[b][k] || 0); }
      var n = xa.length; if (n < 6) return NaN;
      var ma = xa.reduce(function (p, q) { return p + q; }, 0) / n, mb = xb.reduce(function (p, q) { return p + q; }, 0) / n, sa = 0, sb = 0, sab = 0;
      for (var i = 0; i < n; i++) { sa += (xa[i] - ma) * (xa[i] - ma); sb += (xb[i] - mb) * (xb[i] - mb); sab += (xa[i] - ma) * (xb[i] - mb); }
      return sa > 0 && sb > 0 ? sab / Math.sqrt(sa * sb) : NaN;
    };
    h += '<div style="margin-top:10px">' + chartBox(series, { ms: labMs, inv: labInv, label: "جمع R ترکیب" }) + "</div>" +
      '<div class="tiles" style="margin-top:10px"><div class="tile"><span class="k">جمع R</span><span class="v">' + rr(sum) + '</span></div><div class="tile"><span class="k">تعداد معامله</span><span class="v">' + nf(ev.length, 0) +
      '</span></div><div class="tile"><span class="k">میانگین هر معامله</span><span class="v">' + rr(ev.length ? sum / ev.length : NaN, 3) + '</span></div><div class="tile"><span class="k">بیشترین افت جمع</span><span class="v">' + rr(dd) + "</span></div></div>" +
      '<div class="tbl" style="margin-top:10px"><table><thead><tr><th>همبستگی R ماهانه</th>' + ids.map(function (a) { return "<th>" + esc(strat(a).name) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      ids.map(function (a) { return "<tr><th>" + esc(strat(a).name) + "</th>" + ids.map(function (b) { var v = a === b ? 1 : corr(a, b); return '<td class="num">' + nf(v, 2) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>" +
      '<p class="v8ban" style="margin-top:10px"><b>فقط نمایش:</b> این جمعِ دفترهای جدا است. هر دفتر سقف ۳ پوزیشن و ریسک ۱٪ خودش را دارد، پس جمع چند دفتر یعنی ریسک هم‌زمان چند برابر. سقف مشترک، هم‌پوشانی روی یک ارز و محدودیت سرمایه در این عدد نیست. همبستگی نزدیک ۱ یعنی دو استراتژی عملاً یک شرط‌اند.</p></section>';
    return h;
  }

  /* ---------- شبیه‌ساز زنده (۴۶ روز اخیر، در مرورگر) ---------- */
  function simulate(st, bk, cfg) {
    var N = st.n, t0 = st.t0, groups = {}, order = [];
    bk.rows.forEach(function (r) {
      if (cfg.dir && r[2] !== cfg.dir) return;
      var t = Math.round((r[0] - t0) / H);
      if (t < 1 || t > N) return;
      if (cfg.from && r[0] < cfg.from) return;
      if (!groups[t]) { groups[t] = []; order.push(t); }
      groups[t].push(r);
    });
    order.sort(function (a, b) { return a - b; });
    var open = [], closed = [], dayN = {}, hasAct = cfg.act && cfg.act.length, skipped = 0;
    var R = function (p, pxv) { return (p.d * (pxv / p.entry - 1) - 2 * cfg.fee - 2 * p.slip) / p.sd; };
    var step = function (p, h) {
      var a = st.S[p.sym], hh = a.h[h], ll = a.l[h], cc = a.c[h], o = h > 0 ? a.c[h - 1] : NaN, k = h - p.t;
      var stop = hasAct ? p.mstop : (p.d === 1 ? p.best * (1 - p.sd) : p.best * (1 + p.sd));
      var hit = p.d === 1 ? (ll === ll && ll <= stop) : (hh === hh && hh >= stop);
      if (hit) return { why: "stop", px: o !== o ? stop : (p.d === 1 ? Math.min(stop, o) : Math.max(stop, o)), hours: k + 1 };
      if (p.d === 1 && hh === hh) p.best = Math.max(p.best, hh);
      if (p.d === -1 && ll === ll) p.best = Math.min(p.best, ll);
      if (cc === cc) { p.lk = k; p.lc = cc; }
      var upd = true;
      if (hasAct) {
        upd = cfg.act.indexOf((new Date(t0 + h * H).getUTCHours() + 1) % 24) >= 0;
        if (upd) { var nw = p.d === 1 ? p.best * (1 - p.sd) : p.best * (1 + p.sd); p.mstop = p.d === 1 ? Math.max(stop, nw) : Math.min(stop, nw); }
      }
      if (upd && !p.dd && cfg.dl && k >= cfg.dl - 1 && cc === cc) { p.dd = true; if (p.d * (cc / p.entry - 1) <= 2 * cfg.fee + 2 * p.slip) return { why: "time", px: cc, hours: k + 1 }; }
      if (k >= cfg.cap - 1) return p.lc === null ? { why: "nodata", px: p.entry, hours: k + 1 } : { why: "cap", px: p.lc, hours: p.lk + 1 };
      return null;
    };
    var oi = 0, h = order.length ? order[0] - 1 : N;
    for (; h < N; h++) {
      var still = [];
      for (var i = 0; i < open.length; i++) {
        var p = open[i], ex = step(p, h);
        if (ex) closed.push({ sym: p.sym, d: p.d, ts: p.ts, entry: p.entry, sd: p.sd, px: ex.px, why: ex.why, hours: ex.hours, R: R(p, ex.px), xts: p.ts + ex.hours * H });
        else still.push(p);
      }
      open = still;
      var t = h + 1;
      while (oi < order.length && order[oi] < t) oi++;
      if (oi < order.length && order[oi] === t) {
        var g = groups[t], dk = Math.floor((t0 + t * H) / 86400000);
        for (var q = 0; q < g.length; q++) {
          var r = g[q];
          if (!st.S[r[1]]) { skipped++; continue; }
          if ((cfg.md && (dayN[dk] || 0) >= cfg.md) || (cfg.mo && open.length >= cfg.mo)) break;
          if (open.some(function (z) { return z.sym === r[1]; })) continue;
          var sd = cfg.mult * r[4];
          open.push({ sym: r[1], d: r[2], ts: r[0], t: t, entry: r[3], sd: sd, slip: r[5], best: r[3], mstop: r[2] === 1 ? r[3] * (1 - sd) : r[3] * (1 + sd), dd: false, lk: -1, lc: null });
          dayN[dk] = (dayN[dk] || 0) + 1;
        }
      }
    }
    var opn = open.map(function (p) {
      var stop = hasAct ? p.mstop : (p.d === 1 ? p.best * (1 - p.sd) : p.best * (1 + p.sd));
      return { sym: p.sym, d: p.d, ts: p.ts, entry: p.entry, sd: p.sd, last: p.lc, stop: stop, R_now: p.lc === null ? null : R(p, p.lc), R_stop: R(p, stop) };
    });
    closed.sort(function (a, b) { return a.xts - b.xts; });
    return { closed: closed, open: opn, skipped: skipped, asof: t0 + (N - 1) * H, from: t0 };
  }
  async function ensureSeed() {
    if (ST) return ST;
    try {
      var seed = await BR.seed();
      ST = window.Live.prepare(seed);
      STerr = "";
    } catch (e) { ST = null; STerr = String(e && e.message || e); }
    return ST;
  }
  function simCfg(bk) {
    var s = S.sim, num = function (v, d) { var x = parseFloat(v); return isFinite(x) ? x : d; };
    var act = s.act === "" ? (bk.act_hours || null) : s.act === "none" ? null : s.act.split(",").map(Number);
    return { mult: num(s.mult, bk.atr_mult), dl: s.dl === "0" ? 0 : num(s.dl, bk.deadline_h), cap: bk.tech_cap_h, mo: s.mo === "0" ? 0 : num(s.mo, bk.max_open), md: s.md === "0" ? 0 : num(s.md, bk.max_new_per_day),
      fee: bk.fee, dir: s.dir, act: act, from: s.scope === "book" ? bk.start_ms : 0 };
  }
  function isDefaultCfg(c, bk) { return c.mult === bk.atr_mult && c.dl === bk.deadline_h && c.mo === bk.max_open && c.md === bk.max_new_per_day && !c.dir && String(c.act || "") === String(bk.act_hours || "") && c.from === bk.start_ms; }
  function simHtml() {
    var P = BR.paper(), lab = P && P.lab, books = (lab && lab.books) || null;
    var h = '<section class="card" id="v8sim"><h2>شبیه‌ساز تنظیم دستی (حدود ۴۶ روز اخیر)</h2>';
    if (!books) return h + '<p class="empty">کاندیداهای اخیر هنوز از موتور نیامده است (بعد از اولین اجرای Paper Trading با موتور ۸ می‌آید).</p></section>';
    var ids = Object.keys(books).filter(function (k) { return books[k].universe_size > 2; });
    if (ids.indexOf(S.sim.sid) < 0) S.sim.sid = ids[0];
    var bk = books[S.sim.sid], s = S.sim, nm = function (id) { var x = strat(id); return x ? x.name : id; };
    h += '<p class="sub" style="margin-bottom:10px">سیگنال‌های واقعی موتور در این بازه را با تنظیم دلخواه دوباره اجرا می‌کند. همه‌چیز در مرورگر حساب می‌شود و هیچ دفتری عوض نمی‌شود. خانهٔ خالی یعنی مقدار خود قاعده.</p>' +
      '<div class="v8form"><label>استراتژی<select data-sim="sid">' + ids.map(function (k) { return '<option value="' + esc(k) + '"' + (k === s.sid ? " selected" : "") + ">" + esc(nm(k)) + "</option>"; }).join("") + "</select></label>" +
      '<label>ضریب استاپ (قاعده: ' + fa(bk.atr_mult) + ')<input data-sim="mult" inputmode="decimal" value="' + esc(s.mult) + '" placeholder="' + bk.atr_mult + '"></label>' +
      '<label>مهلت، ساعت (۰ = بدون)<input data-sim="dl" inputmode="numeric" value="' + esc(s.dl) + '" placeholder="' + bk.deadline_h + '"></label>' +
      '<label>سقف پوزیشن باز (۰ = بدون)<input data-sim="mo" inputmode="numeric" value="' + esc(s.mo) + '" placeholder="' + bk.max_open + '"></label>' +
      '<label>سقف ورود روزانه (۰ = بدون)<input data-sim="md" inputmode="numeric" value="' + esc(s.md) + '" placeholder="' + bk.max_new_per_day + '"></label>' +
      '<label>جهت<select data-sim="dir"><option value="0"' + (!s.dir ? " selected" : "") + '>هر دو</option><option value="1"' + (s.dir === 1 ? " selected" : "") + '>فقط لانگ</option><option value="-1"' + (s.dir === -1 ? " selected" : "") + ">فقط شورت</option></select></label>" +
      '<label>جابه‌جایی استاپ<select data-sim="act"><option value=""' + (s.act === "" ? " selected" : "") + '>مثل قاعده</option><option value="none"' + (s.act === "none" ? " selected" : "") + '>هر ساعت</option><option value="8,23"' + (s.act === "8,23" ? " selected" : "") + ">فقط ۱۱:۳۰ و ۰۲:۳۰ تهران</option></select></label>" +
      '<label>بازه<select data-sim="scope"><option value="book"' + (s.scope === "book" ? " selected" : "") + '>از شروع دفتر</option><option value="all"' + (s.scope === "all" ? " selected" : "") + ">کل پنجره (قبل از شروع دفتر هم)</option></select></label>" +
      '<button type="button" class="btn" id="v8simrun">اجرا</button></div><div id="v8simout" style="margin-top:12px">' + simOutHtml() + "</div></section>";
    return h;
  }
  function simOutHtml() {
    if (!simOut) return '<p class="note">«اجرا» را بزن. اولین بار کندل‌های اخیر خوانده می‌شود.</p>';
    if (simOut.error) return '<p class="empty">' + esc(simOut.error) + "</p>";
    var o = simOut, cl = o.res.closed, op = o.res.open, tot = 0, win = 0, x = [], y = [];
    cl.forEach(function (c) { tot += c.R; if (c.R > 0) win++; x.push(c.xts); y.push(tot); });
    var nowR = op.reduce(function (a, p) { return a + (p.R_now || 0); }, 0);
    var h = '<div class="tiles"><div class="tile"><span class="k">بسته‌شده</span><span class="v">' + nf(cl.length, 0) + '</span><span class="s">برد ' + (cl.length ? fa((win / cl.length * 100).toFixed(0)) + "٪" : "–") + '</span></div><div class="tile"><span class="k">جمع R بسته‌ها</span><span class="v">' + rr(tot, 2) +
      '</span><span class="s">میانگین ' + (cl.length ? rr(tot / cl.length, 3) : "–") + '</span></div><div class="tile"><span class="k">باز</span><span class="v">' + nf(op.length, 0) + '</span><span class="s">اگر الان بسته شوند ' + rr(nowR, 2) +
      '</span></div><div class="tile"><span class="k">با بازها (الان)</span><span class="v">' + rr(tot + nowR, 2) + "</span></div></div>" +
      '<p class="note" style="margin:8px 0">' + esc(o.label) + " · داده از " + tehran(Math.max(o.res.from, o.cfg.from || 0)) + " تا " + tehran(o.res.asof + H) + " تهران · R قبل از فاندینگ · قیمت بازشدن هر کندل برابر بستهٔ کندل قبل گرفته شده (تقریب)." +
      (o.res.skipped ? " " + fa(o.res.skipped) + " سیگنال ارزِ بدون کندل کنار رفت." : "") + "</p>" + (o.check || "");
    if (cl.length > 1) h += chartBox([{ name: "جمع R", color: "var(--s1)", x: x, y: y }], { h: 170 });
    var rows = cl.slice().reverse().slice(0, 60).map(function (c) { return "<tr><td>" + esc(c.sym) + "</td><td>" + (c.d === 1 ? '<span class="dirL">لانگ</span>' : '<span class="dirS">شورت</span>') + "</td><td>" + tehran(c.ts) + '</td><td class="num">' + px(c.entry) + '</td><td class="num">' + px(c.px) + "</td><td>" + (WHYFA[c.why] || c.why) + '</td><td class="num">' + nf(c.hours, 0) + '</td><td class="num">' + rr(c.R, 2) + "</td></tr>"; });
    var orow = op.map(function (p) { return "<tr><td>" + esc(p.sym) + "</td><td>" + (p.d === 1 ? '<span class="dirL">لانگ</span>' : '<span class="dirS">شورت</span>') + "</td><td>" + tehran(p.ts) + '</td><td class="num">' + px(p.entry) + '</td><td class="num">' + px(p.last) + "</td><td>باز · استاپ " + px(p.stop) + '</td><td class="num">–</td><td class="num">' + rr(p.R_now, 2) + "</td></tr>"; });
    h += '<div class="tbl" style="margin-top:10px"><table><thead><tr><th>ارز</th><th>جهت</th><th>ورود (تهران)</th><th class="num">قیمت ورود</th><th class="num">خروج / آخرین</th><th>دلیل</th><th class="num">ساعت</th><th class="num">R</th></tr></thead><tbody>' + orow.join("") + rows.join("") + "</tbody></table></div>";
    return h;
  }
  async function runSim() {
    var out = $("v8simout");
    if (out) out.innerHTML = '<p class="note">در حال خواندن کندل‌ها و اجرا…</p>';
    var P = BR.paper(), bk = P && P.lab && P.lab.books && P.lab.books[S.sim.sid];
    var st = await ensureSeed();
    if (!bk || !st) { simOut = { error: !bk ? "کاندیدای این استراتژی در دست نیست." : "کندل‌های اخیر (seed.enc.json) خوانده نشد: " + STerr }; }
    else {
      var cfg = simCfg(bk), res = simulate(st, bk, cfg), check = "", real = bookOf(S.sim.sid);
      if (isDefaultCfg(cfg, bk) && real) {
        if (bk.start_ms < st.t0) check = '<p class="note">خودآزمایی ممکن نیست: دفتر قبل از شروع پنجرهٔ کندل‌ها باز شده است.</p>';
        else {
          var mine = {}, eng = {}, both = 0, k;
          res.closed.concat(res.open).forEach(function (c) { mine[c.sym + "-" + c.ts + "-" + (c.d === 1 ? "L" : "S")] = 1; });
          (real.b.trades || []).forEach(function (t) { eng[t.trade_id] = 1; }); (real.b.open || []).forEach(function (t) { eng[t.id] = 1; });
          for (k in eng) if (mine[k]) both++;
          var ne = Object.keys(eng).length, nm = Object.keys(mine).length, ok = both === ne && both === nm;
          check = '<p class="' + (ok ? "note" : "v8ban") + '" style="margin-bottom:8px">خودآزمایی با دفتر موتور (تنظیم قاعده): ' + fa(both) + " ورود مشترک از " + fa(ne) + " ورود دفتر و " + fa(nm) + " ورود شبیه‌ساز." +
            (ok ? " یکی است." : " یکی نیست؛ دلیل معمول: سیگنال‌های بعد از آخرین کندل بذر، یا اختلاف کندل بذر با دادهٔ موتور. به عدد شبیه‌ساز فقط به‌عنوان تقریب نگاه کن.") + "</p>";
        }
      }
      var nmx = strat(S.sim.sid);
      simOut = { res: res, cfg: cfg, check: check, label: (nmx ? nmx.name : S.sim.sid) + " · استاپ " + fa(cfg.mult) + " برابر ATR · " + (cfg.dl ? "مهلت " + fa(cfg.dl) + " ساعت" : "بدون مهلت") + " · سقف باز " + (cfg.mo ? fa(cfg.mo) : "بدون") + " · سقف روزانه " + (cfg.md ? fa(cfg.md) : "بدون") + (cfg.act ? " · استاپ فقط ساعت اقدام" : "") };
    }
    charts = charts || {};
    out = $("v8simout");
    if (out) { out.innerHTML = simOutHtml(); drawCharts(out); }
  }

  /* ---------- ورود واقعی ---------- */
  var RT = lsGet("panel_real_v1", { cap: "", risk: "1", lev: "3", fee: "0.02", mmr: "0.5", minn: "5", dir: "1", entry: "", stop: "", sdp: "", sym: "", sllim: "0.3" });
  var LEDGER_KEY = "panel_manual_v1";
  var ledger = function () { var l = lsGet(LEDGER_KEY, null); return l && Array.isArray(l.rows) ? l : { v: 1, rows: [] }; };
  function calc() {
    var n = function (v) { var x = parseFloat(String(v).replace(/,/g, "")); return isFinite(x) ? x : NaN; };
    var cap = n(RT.cap), risk = n(RT.risk) / 100, lev = n(RT.lev), fee = n(RT.fee) / 100, mmr = n(RT.mmr) / 100, entry = n(RT.entry), d = RT.dir === "-1" ? -1 : 1, stop = n(RT.stop), sdp = n(RT.sdp) / 100;
    if (!(entry > 0)) return { err: "قیمت ورود را وارد کن." };
    var sd = stop > 0 ? d * (entry - stop) / entry : sdp;
    if (!(sd > 0)) return { err: stop > 0 ? "قیمت استاپ باید برای لانگ پایین‌تر و برای شورت بالاتر از ورود باشد." : "قیمت استاپ یا فاصلهٔ استاپ (٪) را وارد کن." };
    if (!(stop > 0)) stop = entry * (1 - d * sd);
    if (!(cap > 0) || !(risk > 0) || !(lev >= 1)) return { err: "سرمایه، درصد ریسک و اهرم را وارد کن." };
    var lossPer = sd + 2 * fee, want = cap * risk / lossPer, maxN = cap * lev, notional = Math.min(want, maxN), margin = notional / lev;
    var liq = d === 1 ? entry * (1 - 1 / lev) / (1 - mmr) : entry * (1 + 1 / lev) / (1 + mmr), liqDist = Math.abs(liq / entry - 1);
    var sl = n(RT.sllim) / 100;
    return { d: d, entry: entry, stop: stop, sd: sd, notional: notional, margin: margin, qty: notional / entry, capped: want > maxN + 1e-9, want: want, loss: notional * lossPer, lossPct: notional * lossPer / cap * 100,
      liq: liq, liqBad: liqDist <= sd * 1.5, liqDist: liqDist, slLimit: stop * (1 - d * sl), small: notional < n(RT.minn), fee: notional * fee * 2, tp1: entry * (1 + d * sd), tp2: entry * (1 + d * 2 * sd), levSafe: 1 / (1.5 * sd + mmr) };
  }
  function calcHtml() {
    var c = calc();
    if (c.err) return '<p class="empty">' + esc(c.err) + "</p>";
    var w = "";
    if (c.small) w += '<p class="v8ban">ارزش معامله از حداقل سفارشی که وارد کرده‌ای کمتر است؛ صرافی این سفارش را نمی‌پذیرد. با این سرمایه و این فاصلهٔ استاپ، ریسک ' + fa(RT.risk) + "٪ عملی نیست.</p>";
    if (c.capped) w += '<p class="v8ban">سقف اهرم جلوی اندازهٔ کامل را گرفت: برای ریسک ' + fa(RT.risk) + "٪ ارزش " + nf(c.want, 2) + " لازم بود، ولی با اهرم " + fa(RT.lev) + " بیشتر از " + nf(c.notional, 2) + " نمی‌شود. ریسک واقعی کمتر از خواسته است.</p>";
    if (c.liqBad) w += '<p class="v8ban"><b>خطر لیکوئید قبل از استاپ:</b> فاصلهٔ لیکوئید (' + nf(c.liqDist * 100, 1) + "٪) کمتر از ۱٫۵ برابر فاصلهٔ استاپ است. اهرم را تا حدود " + nf(Math.max(1, Math.floor(c.levSafe * 10) / 10), 1) + " پایین بیاور.</p>";
    return w + '<div class="v8out"><div class="kv">' +
      "<span>Cost (مارجین) در فرم سفارش</span><span>" + nf(c.margin, 2) + " USDT</span>" +
      "<span>Amount (ارزش کل معامله)</span><span>" + nf(c.notional, 2) + " USDT</span>" +
      "<span>مقدار ارز</span><span>" + px(c.qty) + "</span>" +
      "<span>اهرم · حالت</span><span>" + fa(RT.lev) + "x · Isolated</span>" +
      "<span>SL trigger price (Last)</span><span>" + px(c.stop) + "</span>" +
      "<span>SL Order Price (اگر لیمیت)</span><span>" + px(c.slLimit) + ' <span class="note">یا Market</span></span>' +
      "<span>فاصلهٔ استاپ</span><span>" + nf(c.sd * 100, 2) + "٪</span>" +
      "<span>زیان اگر استاپ بخورد (با کارمزد)</span><span>" + nf(c.loss, 2) + " USDT · " + nf(c.lossPct, 2) + "٪ سرمایه</span>" +
      "<span>کارمزد رفت‌وبرگشت (تخمین)</span><span>" + nf(c.fee, 3) + " USDT</span>" +
      "<span>قیمت لیکوئید (تخمین)</span><span>" + px(c.liq) + "</span>" +
      "<span>قیمت در ۱R و ۲R سود</span><span>" + px(c.tp1) + " · " + px(c.tp2) + "</span></div></div>" +
      '<p class="note" style="margin-top:8px">حد ضرر لیمیت اگر قیمت با جهش از آن رد شود پر نمی‌شود؛ حد ضرر Market این خطر را ندارد ولی با لغزش پر می‌شود. قیمت لیکوئید تخمینی است؛ عدد خود صرافی را ملاک بگیر. این فقط ماشین‌حساب است، نه پیشنهاد ورود.</p>';
  }
  function nextActions() {
    var now = Date.now(), out = [];
    for (var i = 0; i < 3 && out.length < 2; i++) {
      [8, 23].forEach(function (hh) { var d = new Date(now); d.setUTCDate(d.getUTCDate() + i); d.setUTCHours(hh, 0, 0, 0); if (d.getTime() > now) out.push(d.getTime()); });
    }
    return out.sort(function (a, b) { return a - b; }).slice(0, 2);
  }
  function refRows() {
    var P = BR.paper(), rows = [];
    ((P && P.books) || []).forEach(function (b) {
      if (b.kind === "account") return;
      (b.open || []).forEach(function (p) { rows.push({ src: b.strategy_id, sym: p.sym, d: p.dir, entry: p.entry_px, stop: p.stop_now, sd: p.stop_pct, last: p.last_close, ts: p.entry_ts }); });
    });
    return rows;
  }
  function renderReal() {
    var el = $("tabReal");
    if (!el || el.hidden) return;
    var f = function (k, label, ph, mode) { return "<label>" + label + '<input data-rt="' + k + '" inputmode="' + (mode || "decimal") + '" value="' + esc(RT[k] || "") + '" placeholder="' + (ph || "") + '"></label>'; };
    var rows = refRows(), act = nextActions(), L = ledger(), man = bookOf("squeeze-manual-v1");
    var h = '<section class="card"><h2>اندازهٔ پوزیشن و سفارش (MEXC فیوچرز)</h2><p class="v8ban" style="margin-bottom:10px">هیچ استراتژی‌ای برای پول واقعی تأیید نشده است. این ابزار فقط عددهای سفارش را از ورودی‌های خودت حساب می‌کند.</p><div class="v8form">' +
      f("cap", "سرمایهٔ حساب (USDT)", "مثلاً 55") + f("risk", "ریسک هر معامله (٪ سرمایه)", "1") + f("lev", "اهرم", "3") +
      '<label>جهت<select data-rt="dir"><option value="1"' + (RT.dir !== "-1" ? " selected" : "") + '>لانگ</option><option value="-1"' + (RT.dir === "-1" ? " selected" : "") + ">شورت</option></select></label>" +
      f("entry", "قیمت ورود") + f("stop", "قیمت استاپ") + f("sdp", "یا فاصلهٔ استاپ (٪)", "اگر قیمت استاپ خالی است") +
      f("fee", "کارمزد هر طرف (٪)", "0.02") + f("mmr", "مارجین نگهداری (٪)", "0.5") + f("minn", "حداقل ارزش سفارش (USDT)", "5") + f("sllim", "فاصلهٔ قیمت لیمیت استاپ از تریگر (٪)", "0.3") +
      '</div><div id="v8calc" style="margin-top:12px">' + calcHtml() + "</div></section>";
    h += '<section class="card"><h2>پوزیشن‌های باز دفترهای سایه (برای پرکردن فرم)</h2>' + (rows.length ? '<div class="tbl"><table><thead><tr><th>دفتر</th><th>ارز</th><th>جهت</th><th class="num">ورود دفتر</th><th class="num">استاپ فعلی</th><th class="num">آخرین قیمت دفتر</th><th></th></tr></thead><tbody>' +
      rows.map(function (r, i) { return "<tr><td>" + esc(r.src) + "</td><td>" + esc(r.sym) + "</td><td>" + (r.d === 1 ? '<span class="dirL">لانگ</span>' : '<span class="dirS">شورت</span>') + '</td><td class="num">' + px(r.entry) + '</td><td class="num">' + px(r.stop) + '</td><td class="num">' + px(r.last) + '</td><td><button type="button" class="ghost" data-fill="' + i + '">با قیمت الان پر کن</button></td></tr>'; }).join("") +
      '</tbody></table></div><p class="note" style="margin-top:8px">«با قیمت الان پر کن» آخرین قیمت دفتر را به‌عنوان ورود و استاپ فعلی دفتر را به‌عنوان استاپ می‌گذارد. ورود دیرتر از سیگنال یعنی قیمت و فاصلهٔ استاپ دیگر همان دفتر نیست؛ نتیجهٔ دفتر سایه برای آن ورود صدق نمی‌کند.</p>' : '<p class="empty">الان پوزیشن بازی در دفترها نیست، یا دفترها هنوز خوانده نشده‌اند.</p>') + "</section>";
    h += '<section class="card"><h2>روش دستی دو بار در روز</h2><div class="kv"><span>اقدام بعدی</span><span>' + tehran(act[0]) + " تهران (" + fa(((act[0] - Date.now()) / H).toFixed(1)) + " ساعت دیگر)</span><span>بعد از آن</span><span>" + tehran(act[1]) + " تهران</span></div>" +
      '<p class="sub" style="margin:8px 0">در هر اقدام، به همین ترتیب: ۱) ورودهای تازهٔ دفتر «فشردگی دستی» را ببین؛ ۲) استاپ هر پوزیشن باز را به «استاپ فعلی» دفتر ببر (هرگز عقب نبر)؛ ۳) پوزیشنی که دفتر با «مهلت» بسته، ببند. بین دو اقدام کاری نکن. اقدامی که از دست رفت جبران نمی‌شود.</p>' +
      (man ? '<button type="button" class="ghost" data-go="' + man.i + '">دفتر «فشردگی دستی» ←</button>' : '<p class="note">دفتر «فشردگی دستی» هنوز ساخته نشده است.</p>') +
      '<div class="v8form" style="margin-top:12px;max-inline-size:640px"><label>بهترین قیمت از زمان ورود<input id="v8tb" inputmode="decimal"></label><label>فاصلهٔ استاپ (٪)<input id="v8ts" inputmode="decimal"></label><label>جهت<select id="v8td"><option value="1">لانگ</option><option value="-1">شورت</option></select></label><div class="v8out" id="v8to">استاپ تازه: –</div></div></section>';
    var st = ledgerStats(L.rows);
    h += '<section class="card"><div class="hwin"><h2 style="margin:0">دفتر معاملات واقعی من</h2><div class="v8row"><button type="button" class="ghost" id="v8lexp">خروجی JSON</button><button type="button" class="ghost" id="v8lcsv">خروجی CSV</button><label class="ghost" style="cursor:pointer">ورود JSON<input type="file" id="v8limp" accept="application/json,.json" hidden></label></div></div>' +
      '<p class="note" style="margin-bottom:10px">این دفتر فقط در همین مرورگر ذخیره می‌شود و با پاک‌شدن دادهٔ مرورگر از بین می‌رود؛ هر چند وقت خروجی بگیر. با هیچ دفتر سایه‌ای جمع نمی‌شود.</p>' +
      '<div class="v8form"><label>ارز<input id="v8ls" placeholder="KAVA"></label><label>جهت<select id="v8ld"><option value="1">لانگ</option><option value="-1">شورت</option></select></label><label>قیمت ورود<input id="v8le" inputmode="decimal"></label><label>قیمت خروج<input id="v8lx" inputmode="decimal"></label><label>استاپ اولیه<input id="v8lst" inputmode="decimal"></label>' +
      '<label>Amount (ارزش کل، USDT)<input id="v8ln" inputmode="decimal"></label><label>کارمزد کل (USDT)<input id="v8lf" inputmode="decimal" placeholder="0"></label><label>فاندینگ (USDT، دریافتی مثبت)<input id="v8lfu" inputmode="decimal" placeholder="0"></label>' +
      '<label>تاریخ ورود<input id="v8lt" type="date"></label><label>منبع سیگنال<input id="v8lsrc" placeholder="مثلاً فشردگی دستی"></label><label>یادداشت<input id="v8lno"></label><button type="button" class="btn" id="v8ladd">ثبت معامله</button></div><p class="err" id="v8lerr" style="margin-top:6px"></p>' +
      '<div class="tiles" style="margin:10px 0"><div class="tile"><span class="k">تعداد</span><span class="v">' + nf(st.n, 0) + '</span><span class="s">برد ' + (st.n ? fa((st.win / st.n * 100).toFixed(0)) + "٪" : "–") + '</span></div><div class="tile"><span class="k">سود خالص</span><span class="v">' + usdt(st.pnl) + '</span></div><div class="tile"><span class="k">جمع R</span><span class="v">' + rr(st.nR ? st.R : NaN, 2) + '</span><span class="s">' + fa(st.nR) + " معامله با استاپ اولیه</span></div><div class=\"tile\"><span class=\"k\">میانگین R</span><span class=\"v\">" + rr(st.nR ? st.R / st.nR : NaN, 2) + "</span></div></div>" +
      (L.rows.length ? '<div class="tbl"><table><thead><tr><th>تاریخ</th><th>ارز</th><th>جهت</th><th class="num">ورود</th><th class="num">خروج</th><th class="num">Amount</th><th class="num">سود خالص</th><th class="num">R</th><th>منبع</th><th>یادداشت</th><th></th></tr></thead><tbody>' +
        L.rows.slice().reverse().map(function (r) { var m = tradeMath(r); return "<tr><td>" + fa(esc(r.date || "")) + "</td><td>" + esc(r.sym) + "</td><td>" + (r.d === 1 ? '<span class="dirL">لانگ</span>' : '<span class="dirS">شورت</span>') + '</td><td class="num">' + px(r.entry) + '</td><td class="num">' + px(r.exit) + '</td><td class="num">' + nf(r.notional, 2) + '</td><td class="num">' + usdt(m.pnl) + '</td><td class="num">' + rr(m.R, 2) + "</td><td>" + esc(r.src || "") + "</td><td>" + esc(r.note || "") + '</td><td><button type="button" class="ghost" data-del="' + esc(r.id) + '">حذف</button></td></tr>'; }).join("") + "</tbody></table></div>" : '<p class="empty">هنوز معامله‌ای ثبت نشده است.</p>') + "</section>";
    el.innerHTML = h;
  }
  var usdt = function (v) { return fin(v) ? '<span class="n ' + (v > 0 ? "pos" : v < 0 ? "neg" : "") + '">' + fa((v > 0 ? "+" : "") + v.toFixed(2)) + "</span>" : "–"; };
  function tradeMath(r) {
    var gross = r.notional * r.d * (r.exit / r.entry - 1), pnl = gross - (r.fee || 0) + (r.funding || 0);
    var sd = r.stop > 0 ? r.d * (r.entry - r.stop) / r.entry : NaN;
    return { pnl: pnl, R: sd > 0 ? pnl / (r.notional * sd) : NaN };
  }
  function ledgerStats(rows) { var o = { n: rows.length, win: 0, pnl: 0, R: 0, nR: 0 }; rows.forEach(function (r) { var m = tradeMath(r); o.pnl += m.pnl; if (m.pnl > 0) o.win++; if (fin(m.R)) { o.R += m.R; o.nR++; } }); return o; }
  function download(name, text, type) { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  /* ---------- رویدادها ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target, lab = $("tabLab"), real = $("tabReal");
    if (lab && lab.contains(t)) {
      var go = t.closest("[data-go]"); if (go) { BR.goPaper(+go.dataset.go); return; }
      var tr = t.closest("tr[data-sid]"); if (tr) { S.sel = tr.dataset.sid; renderLab(); var d = $("v8detail"); if (d && d.scrollIntoView) d.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      if (t.id === "v8simrun") { runSim(); return; }
    }
    if (real && real.contains(t)) {
      var g2 = t.closest("[data-go]"); if (g2) { BR.goPaper(+g2.dataset.go); return; }
      var fl = t.closest("[data-fill]");
      if (fl) { var r = refRows()[+fl.dataset.fill]; if (r) { RT.dir = String(r.d); RT.entry = String(r.last || r.entry); RT.stop = String(r.stop); RT.sdp = ""; RT.sym = r.sym; lsSet("panel_real_v1", RT); renderReal(); } return; }
      var del = t.closest("[data-del]");
      if (del) { var L = ledger(); L.rows = L.rows.filter(function (x) { return x.id !== del.dataset.del; }); lsSet(LEDGER_KEY, L); renderReal(); return; }
      if (t.id === "v8ladd") {
        var v = function (id) { return ($(id).value || "").trim(); }, n = function (id) { var x = parseFloat(v(id).replace(/,/g, "")); return isFinite(x) ? x : NaN; };
        var row = { id: "m" + Date.now().toString(36), sym: v("v8ls").toUpperCase(), d: +v("v8ld"), entry: n("v8le"), exit: n("v8lx"), stop: n("v8lst"), notional: n("v8ln"), fee: n("v8lf") || 0, funding: n("v8lfu") || 0, date: v("v8lt"), src: v("v8lsrc"), note: v("v8lno") };
        if (!row.sym || !(row.entry > 0) || !(row.exit > 0) || !(row.notional > 0)) { $("v8lerr").textContent = "ارز، قیمت ورود، قیمت خروج و Amount لازم است."; return; }
        if (!(row.stop > 0)) row.stop = null;
        var L2 = ledger(); L2.rows.push(row);
        if (!lsSet(LEDGER_KEY, L2)) { $("v8lerr").textContent = "ذخیره در مرورگر ممکن نشد (حالت خصوصی یا حافظهٔ پر)."; return; }
        renderReal(); return;
      }
      if (t.id === "v8lexp") { download("manual_ledger.json", JSON.stringify(ledger(), null, 1), "application/json"); return; }
      if (t.id === "v8lcsv") {
        var q = function (x) { x = x === null || x === undefined ? "" : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
        var rows = ledger().rows.map(function (r) { var m = tradeMath(r); return [r.date, r.sym, r.d === 1 ? "long" : "short", r.entry, r.exit, r.stop, r.notional, r.fee, r.funding, m.pnl.toFixed(4), fin(m.R) ? m.R.toFixed(4) : "", r.src, r.note].map(q).join(","); });
        download("manual_ledger.csv", "﻿date,symbol,side,entry,exit,initial_stop,notional_usdt,fee_usdt,funding_usdt,net_pnl_usdt,R,source,note\r\n" + rows.join("\r\n") + "\r\n", "text/csv"); return;
      }
    }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.set) { var id = S.sel, k = keyOf(id).split("|"); if (t.dataset.set === "sm") k[0] = t.value; else k[1] = t.value; S.key[id] = k.join("|"); renderLab(); return; }
    if (t.dataset && t.dataset.comb) { S.comb[t.dataset.comb] = t.checked; renderLab(); return; }
    if (t.dataset && t.dataset.sim) { var kk = t.dataset.sim; S.sim[kk] = kk === "dir" ? +t.value : t.value; if (kk === "sid") { simOut = null; renderLab(); } return; }
    if (t.id === "v8limp" && t.files && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () { try { var j = JSON.parse(fr.result); if (!j || !Array.isArray(j.rows)) throw 0; var L = ledger(), have = {}; L.rows.forEach(function (r) { have[r.id] = 1; }); j.rows.forEach(function (r) { if (r && r.id && !have[r.id] && r.entry > 0 && r.exit > 0 && r.notional > 0) L.rows.push(r); }); lsSet(LEDGER_KEY, L); renderReal(); } catch (x) { var er = $("v8lerr"); if (er) er.textContent = "این فایل خروجی دفتر دستی نیست."; } };
      fr.readAsText(t.files[0]);
    }
  });
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.rt) { RT[t.dataset.rt] = t.value; lsSet("panel_real_v1", RT); var c = $("v8calc"); if (c) c.innerHTML = calcHtml(); return; }
    if (t.id === "v8tb" || t.id === "v8ts" || t.id === "v8td") {
      var b = parseFloat($("v8tb").value), s = parseFloat($("v8ts").value) / 100, d = +$("v8td").value;
      $("v8to").innerHTML = "استاپ تازه: " + (b > 0 && s > 0 ? px(b * (1 - d * s)) + ' <span class="note">فقط اگر از استاپ فعلی بهتر است جابه‌جا کن</span>' : "–");
    }
  });
  var rz;
  window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { var l = $("tabLab"); if (l && !l.hidden) drawCharts(l); }, 200); });

  window.V8 = {
    show: function (t) { if (t === "l") renderLab(); else renderReal(); },
    paperChanged: function () { var l = $("tabLab"), r = $("tabReal"); if (l && !l.hidden && LABstate === "ok") renderLab(); if (r && !r.hidden) renderReal(); },
    reset: function () { LAB = null; LABstate = "none"; ST = null; simOut = null; var l = $("tabLab"), r = $("tabReal"); if (l) l.innerHTML = ""; if (r) r.innerHTML = ""; },
    _simulate: simulate, _calc: function (o) { var keep = RT; RT = o; var c = calc(); RT = keep; return c; }
  };
  var l0 = $("tabLab"), r0 = $("tabReal");
  if (l0 && !l0.hidden && BR.ready()) renderLab();
  if (r0 && !r0.hidden && BR.ready()) renderReal();
})();
