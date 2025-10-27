// ---------- 工具 ----------
function normalizeToTVSymbol(input) {
  if (!input) return "";
  var raw = input.trim().toUpperCase();
  if (raw.indexOf("TWSE:") === 0 || raw.indexOf("TPEX:") === 0) return raw;
  if (/^\d+\.TWO$/.test(raw)) return "TPEX:" + raw.replace(".TWO","");
  if (/^\d+\.TW$/.test(raw))  return "TWSE:" + raw.replace(".TW","");
  if (/^\d+$/.test(raw))      return "TWSE:" + raw;
  return raw;
}
function tvToTwseChannel(symbol) {
  var p = symbol.split(":"); var ex = p[0], code = p[1];
  if (!ex || !code || !/^\d+$/.test(code)) return null;
  if (ex === "TWSE") return "tse_" + code + ".tw";
  if (ex === "TPEX") return "otc_" + code + ".tw";
  return null;
}
function saveJSON(name, data) {
  var blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

// ---------- 狀態 ----------
var LS = { THEME: "tw_theme_v2", LISTS: "tw_lists_v2", ACTIVE: "tw_active_v2", ALERTS: "tw_alerts_v2" };
var presetLists = {
  "自訂": ["TWSE:2330","TWSE:2317","TWSE:0050","TWSE:2603","TWSE:2882"],
  "高股息": ["TWSE:0056","TWSE:00878","TWSE:00919","TWSE:00900"],
  "AI/半導體": ["TWSE:2330","TWSE:2382","TPEX:6533","TWSE:6669","TWSE:2377"],
  "航運": ["TWSE:2603","TWSE:2609","TWSE:2615"],
  "金融": ["TWSE:2881","TWSE:2882","TWSE:2884","TWSE:2886"]
};

var state = {
  theme: "light",
  lists: {},           // { listName: [symbols] }
  active: "自訂",      // active list name
  alerts: {},          // { "TWSE:2330": {upper, lower, lastNotified} }
  charts: {},          // { symbol: ChartInstance }
  dataSeries: {},      // { symbol: [ {t, p} ... ] } (最多保存 N 筆)
  polling: null
};

// ---------- DOM ----------
var tabsEl = document.getElementById("tabs");
var grid = document.getElementById("grid");
var inputSymbol = document.getElementById("inputSymbol");
var addBtn = document.getElementById("addBtn");
var exportBtn = document.getElementById("exportBtn");
var importInput = document.getElementById("importInput");
var clearBtn = document.getElementById("clearBtn");
var themeBtn = document.getElementById("themeBtn");
var notifBtn = document.getElementById("notifBtn");

// ---------- 初始化 ----------
(function init() {
  try { state.theme = JSON.parse(localStorage.getItem(LS.THEME)) || "light"; } catch(e){}
  try { state.lists = JSON.parse(localStorage.getItem(LS.LISTS)) || presetLists; } catch(e){ state.lists = presetLists; }
  try { state.active = JSON.parse(localStorage.getItem(LS.ACTIVE)) || "自訂"; } catch(e){}
  try { state.alerts = JSON.parse(localStorage.getItem(LS.ALERTS)) || {}; } catch(e){}

  document.documentElement.classList.toggle("dark", state.theme === "dark");
  renderTabs(); renderAll();
  startPolling();

  if ("serviceWorker" in navigator) { navigator.serviceWorker.register("./sw.js").catch(function(){}); }
})();

function persist() {
  localStorage.setItem(LS.THEME, JSON.stringify(state.theme));
  localStorage.setItem(LS.LISTS, JSON.stringify(state.lists));
  localStorage.setItem(LS.ACTIVE, JSON.stringify(state.active));
  localStorage.setItem(LS.ALERTS, JSON.stringify(state.alerts));
}

// ---------- 事件 ----------
themeBtn.addEventListener("click", function(){
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.classList.toggle("dark", state.theme === "dark");
  persist();
  // 更新圖表顏色
  Object.values(state.charts).forEach(function(ch){ try { ch.options.scales.x.grid.color = getGridColor(); ch.options.scales.y.grid.color = getGridColor(); ch.update('none'); } catch(e){} });
});
notifBtn.addEventListener("click", function(){
  if (!("Notification" in window)) return alert("此瀏覽器不支援通知");
  Notification.requestPermission().then(function(perm){
    if (perm !== "granted") alert("未授權通知，將無法顯示推播");
  });
});
addBtn.addEventListener("click", function(){
  var sym = normalizeToTVSymbol(inputSymbol.value);
  if (!sym) return;

  var list = state.lists[state.active] || [];
  if (list.indexOf(sym) === -1) { list.push(sym); state.lists[state.active] = list; persist(); renderAll(); }
  inputSymbol.value = "";
});
inputSymbol.addEventListener("keydown", function(e){ if (e.key === "Enter") addBtn.click(); });
exportBtn.addEventListener("click", function(){
  saveJSON("watchlist_" + state.active + ".json", state.lists[state.active] || []);
});
importInput.addEventListener("change", function(e){
  var f = e.target.files && e.target.files[0]; if (!f) return;
  var reader = new FileReader();
  reader.onload = function(){
    try {
      var arr = JSON.parse(reader.result);
      if (Array.isArray(arr)) {
        var next = arr.map(normalizeToTVSymbol).filter(Boolean);
        state.lists[state.active] = Array.from(new Set(next));
        persist(); renderAll();
      }
    } catch(e){ alert("JSON 格式不正確"); }
  };
  reader.readAsText(f, "utf-8");
});
clearBtn.addEventListener("click", function(){
  state.lists[state.active] = [];
  persist(); renderAll();
});

// ---------- Tabs ----------
function renderTabs() {
  tabsEl.innerHTML = "";
  Object.keys(state.lists).forEach(function(name){
    var btn = document.createElement("button");
    btn.className = "tab-btn text-sm px-3 py-1.5 rounded-full border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800";
    btn.textContent = name;
    btn.setAttribute("aria-selected", name === state.active ? "true" : "false");
    btn.addEventListener("click", function(){
      state.active = name; persist(); renderTabs(); renderAll();
    });
    tabsEl.appendChild(btn);
  });
  // 新增一個 + 來創建清單
  var add = document.createElement("button");
  add.className = "text-sm px-3 py-1.5 rounded-full border border-dashed border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800";
  add.textContent = "+ 新清單";
  add.title = "建立新的自訂清單";
  add.addEventListener("click", function(){
    var n = prompt("清單名稱？"); if (!n) return;
    if (!state.lists[n]) state.lists[n] = [];
    state.active = n; persist(); renderTabs(); renderAll();
  });
  tabsEl.appendChild(add);
}

// ---------- 渲染卡片 ----------
function renderAll() {
  grid.innerHTML = "";
  var list = state.lists[state.active] || [];
  if (list.length === 0) {
    var empty = document.createElement("div");
    empty.className = "mt-10 flex flex-col items-center gap-3 text-center opacity-80 col-span-full";
    empty.innerHTML = "<div class='text-6xl'>📈</div><div class='text-lg'>此清單尚未加入標的</div><div class='text-sm'>從上方輸入框加入，如：2330、2317、0050…</div>";
    grid.appendChild(empty);
    return;
  }
  list.forEach(function(sym){ grid.appendChild(makeCard(sym)); });
}

function getGridColor(){ return document.documentElement.classList.contains("dark") ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.06)"; }

function makeCard(symbol) {
  var wrapper = document.createElement("div");
  wrapper.className = "group relative card rounded-2xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm";

  var symId = symbol.replace(":","-");
  var alerts = state.alerts[symbol] || { upper: "", lower: "", lastNotified: null };
  var header = document.createElement("div");
  header.className = "flex items-center justify-between mb-2";
  header.innerHTML = "<div class='font-semibold'>" + symbol + "</div>" +
    "<div class='opacity-70 text-xs'>自繪圖 / TWSE 即時</div>";
  wrapper.appendChild(header);

  // Chart canvas
  var cv = document.createElement("canvas");
  cv.id = "cv-" + symId;
  cv.height = 180;
  wrapper.appendChild(cv);

  // Price area
  var priceWrap = document.createElement("div");
  priceWrap.className = "mt-3 grid grid-cols-2 gap-2 text-sm";
  priceWrap.innerHTML = [
    "<div class='rounded-xl border border-gray-200 dark:border-gray-700 p-3'>",
      "<div class='flex items-center justify-between'><div class='opacity-70'>現價</div><div id='last-", symId, "' class='font-mono text-lg'>-</div></div>",
      "<div class='flex items-center justify-between mt-1'><div class='opacity-70'>漲跌</div><div id='chg-", symId, "' class='font-mono'>-</div></div>",
    "</div>",
    "<div class='rounded-xl border border-gray-200 dark:border-gray-700 p-3'>",
      "<div class='opacity-70 mb-1'>到價提醒</div>",
      "<div class='flex items-center gap-2 mb-1'><span class='text-xs opacity-70'>高於</span><input data-upper class='flex-1 px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent' placeholder='如 700' value='", (alerts.upper ?? ""), "'></div>",
      "<div class='flex items-center gap-2'><span class='text-xs opacity-70'>低於</span><input data-lower class='flex-1 px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent' placeholder='如 550' value='", (alerts.lower ?? ""), "'></div>",
    "</div>"
  ].join("");
  wrapper.appendChild(priceWrap);

  // Footer links & remove
  var footer = document.createElement("div");
  footer.className = "mt-2 text-xs flex items-center justify-between opacity-80";
  footer.innerHTML = "<div class='flex gap-3'><a target='_blank' class='underline hover:opacity-100' href='https://tw.tradingview.com/symbols/" +
    symbol.replace(":","-") + "/'>TradingView</a><a target='_blank' class='underline hover:opacity-100' href='https://tw.stock.yahoo.com/quote/" +
    symbol.replace('TWSE:','').replace('TPEX:','') + ".TW'>Yahoo</a></div>" +
    "<button data-remove class='px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'>移除</button>";
  wrapper.appendChild(footer);

  // Remove
  footer.querySelector("[data-remove]").addEventListener("click", function(){
    state.lists[state.active] = (state.lists[state.active] || []).filter(function(s){ return s !== symbol; });
    persist(); renderAll();
  });

  // Alerts persist
  var upperInput = wrapper.querySelector("[data-upper]");
  var lowerInput = wrapper.querySelector("[data-lower]");
  function persistAlerts(){
    state.alerts[symbol] = {
      upper: upperInput.value ? Number(upperInput.value) : "",
      lower: lowerInput.value ? Number(lowerInput.value) : "",
      lastNotified: (state.alerts[symbol] && state.alerts[symbol].lastNotified) || null
    };
    persist();
  }
  upperInput.addEventListener("change", persistAlerts);
  lowerInput.addEventListener("change", persistAlerts);

  // Init chart
  var ctx = cv.getContext('2d');
  var ch = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: symbol,
        data: [],
        borderWidth: 2,
        fill: true,
        tension: 0.25
      }]
    },
    options: {
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: getGridColor() }, ticks: { display: false } },
        y: { grid: { color: getGridColor() }, ticks: { display: true, maxTicksLimit: 4 } }
      },
      elements: { point: { radius: 0 } }
    }
  });
  state.charts[symbol] = ch;
  if (!state.dataSeries[symbol]) state.dataSeries[symbol] = [];

  return wrapper;
}

// ---------- 輪詢（拉價＆更新圖表） ----------
function pollQuotes() {
  // 收集所有清單的 symbol，一起打 API 降低請求數
  var allSymbols = Object.values(state.lists).flat();
  if (allSymbols.length === 0) return;
  var channels = allSymbols.map(tvToTwseChannel).filter(Boolean);
  if (channels.length === 0) return;
  var url = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=" + encodeURIComponent(channels.join("|"));

  fetch(url, { cache: "no-store" }).then(function(r){ return r.json(); }).then(function(data){
    if (!data || !data.msgArray) return;
    var now = Date.now();
    data.msgArray.forEach(function(item){
      var code = item.c;
      var ex = (item.ex === "tse" || item.ex === "TSE") ? "TWSE" : "TPEX";
      var symbol = ex + ":" + code;
      var price = Number(item.z || item.a || item.b || 0);
      var y = Number(item.y || 0);
      var chg = (price && y) ? (price - y) : 0;
      var chgPct = (price && y) ? (chg / y * 100) : 0;

      // 存數列
      var arr = state.dataSeries[symbol] || [];
      if (price) { arr.push({ t: now, p: price }); if (arr.length > 120) arr.shift(); }
      state.dataSeries[symbol] = arr;

      // 若當前頁面有這張卡，更新數字＆圖表
      var symId = symbol.replace(":","-");
      var lastEl = document.getElementById("last-" + symId);
      var chgEl  = document.getElementById("chg-" + symId);
      if (lastEl) {
        var old = Number(lastEl.textContent);
        lastEl.textContent = price ? (price >= 100 ? price.toFixed(1) : price.toFixed(2)) : "-";
        if (!isNaN(old) && price) {
          var pulse = (price >= old) ? "pulse-green" : "pulse-red";
          lastEl.parentElement.parentElement.classList.add(pulse);
          setTimeout(function(){ lastEl.parentElement.parentElement.classList.remove(pulse); }, 400);
        }
      }
      if (chgEl) {
        var sign = chg >= 0 ? "+" : "";
        var color = chg >= 0 ? "text-green-600" : "text-red-600";
        chgEl.innerHTML = "<span class='" + color + "'>" + sign + chg.toFixed(2) + " (" + sign + chgPct.toFixed(2) + "%)</span>";
      }

      // 圖表更新（如果這張卡存在）
      var ch = state.charts[symbol];
      if (ch) {
        ch.data.labels = arr.map(function(p){ return new Date(p.t).toLocaleTimeString(); });
        ch.data.datasets[0].data = arr.map(function(p){ return p.p; });
        ch.update('none');
      }

      // 檢查提醒
      checkAlerts(symbol, price);
    });
  }).catch(function(e){ /* ignore */ });
}
function startPolling(){ if (state.polling) clearInterval(state.polling); pollQuotes(); state.polling = setInterval(pollQuotes, 6000); }

// ---------- 通知 ----------
function canNotify(){ return "Notification" in window && Notification.permission === "granted"; }
function sendNotify(title, body) {
  if (canNotify()) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "notify", title: title, body: body });
    } else {
      new Notification(title, { body: body });
    }
  }
}
function checkAlerts(symbol, price) {
  var a = state.alerts[symbol];
  if (!a || !price) return;
  var upper = (a.upper === "") ? null : Number(a.upper);
  var lower = (a.lower === "") ? null : Number(a.lower);
  var last = a.lastNotified || null;

  if (upper != null && price >= upper) {
    if (!last || last.dir !== "up" || Math.abs(price - last.price) > 0.01) {
      sendNotify("到價↑ " + symbol, "現價 " + price + " 已高於 " + upper);
      a.lastNotified = { dir: "up", price: price };
      persist();
    }
  } else if (lower != null && price <= lower) {
    if (!last || last.dir !== "down" || Math.abs(price - last.price) > 0.01) {
      sendNotify("到價↓ " + symbol, "現價 " + price + " 已低於 " + lower);
      a.lastNotified = { dir: "down", price: price };
      persist();
    }
  }
}
