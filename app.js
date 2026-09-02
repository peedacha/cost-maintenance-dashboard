(function () {
  'use strict';

  var STORAGE_KEY = 'fuelDashboard.entries.v1';
  var THEME_KEY = 'fuelDashboard.theme';

  /** @type {Array<{id:string,date:string,vehicle:string,station:string,liters:number,pricePerLiter:number,totalCost:number,odometer:number|null,notes:string}>} */
  var entries = loadEntries();
  var state = { range: 'all', vehicle: 'all' };
  var editingId = null;
  var spendChart = null;
  var priceChart = null;
  var vehicleChart = null;

  // ---------- storage ----------

  function loadEntries() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveEntries() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- theme ----------

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
      updateThemeBtn(saved);
    } else {
      updateThemeBtn(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
  }

  function updateThemeBtn(mode) {
    document.getElementById('themeToggleBtn').textContent = mode === 'dark' ? '☀️' : '🌙';
  }

  document.getElementById('themeToggleBtn').addEventListener('click', function () {
    var current = document.documentElement.getAttribute('data-theme');
    var isDark = current ? current === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    updateThemeBtn(next);
    renderCharts();
  });

  // ---------- helpers ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function fmtBaht(n) {
    return '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtBahtPrecise(n) {
    return '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtNum(n, digits) {
    return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }

  function fmtDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function monthKey(iso) {
    return iso.slice(0, 7); // YYYY-MM
  }

  function monthLabel(key) {
    var parts = key.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return d.toLocaleDateString('th-TH', { year: '2-digit', month: 'short' });
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  var SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];

  function seriesColor(i) {
    return cssVar(SERIES_VARS[i % SERIES_VARS.length]);
  }

  // ---------- filtering ----------

  function vehicles() {
    var set = {};
    entries.forEach(function (e) { set[e.vehicle] = true; });
    return Object.keys(set).sort();
  }

  function filteredEntries() {
    var list = entries.slice();
    if (state.vehicle !== 'all') {
      list = list.filter(function (e) { return e.vehicle === state.vehicle; });
    }
    if (state.range !== 'all') {
      var now = new Date();
      var from;
      if (state.range === '30') {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      } else if (state.range === '90') {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
      } else if (state.range === 'month') {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      if (from) {
        var fromStr = from.toISOString().slice(0, 10);
        list = list.filter(function (e) { return e.date >= fromStr; });
      }
    }
    list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return list;
  }

  // ---------- rendering: filters ----------

  function renderVehicleOptions() {
    var select = document.getElementById('vehicleFilter');
    var current = state.vehicle;
    var list = vehicles();
    select.innerHTML = '<option value="all">ทุกคัน</option>' +
      list.map(function (v) { return '<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
    select.value = list.indexOf(current) >= 0 ? current : 'all';
    state.vehicle = select.value;

    var datalist = document.getElementById('vehicleList');
    datalist.innerHTML = list.map(function (v) { return '<option value="' + escapeHtml(v) + '">'; }).join('');
  }

  document.getElementById('vehicleFilter').addEventListener('change', function (e) {
    state.vehicle = e.target.value;
    renderAll();
  });

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) { c.classList.remove('is-active'); });
      chip.classList.add('is-active');
      state.range = chip.getAttribute('data-range');
      renderAll();
    });
  });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- rendering: stats ----------

  function renderStats() {
    var list = filteredEntries();
    var totalCost = list.reduce(function (s, e) { return s + e.totalCost; }, 0);
    var totalLiters = list.reduce(function (s, e) { return s + e.liters; }, 0);
    var avgPrice = totalLiters > 0 ? totalCost / totalLiters : 0;

    document.getElementById('statTotalCost').textContent = fmtBaht(totalCost);
    document.getElementById('statTotalLiters').textContent = fmtNum(totalLiters, 1) + ' ลิตร';
    document.getElementById('statFillCount').textContent = list.length + ' ครั้งเติม';
    document.getElementById('statAvgPrice').textContent = fmtBahtPrecise(avgPrice);

    // efficiency: km per liter, per vehicle, using consecutive odometer readings
    var eff = averageEfficiency(list);
    document.getElementById('statAvgEfficiency').textContent = eff != null ? fmtNum(eff, 1) + ' กม./ล.' : '—';

    // month-over-month delta on total cost (all-time data, not affected by range filter)
    renderMonthDelta();
  }

  function averageEfficiency(list) {
    var byVehicle = {};
    list.forEach(function (e) {
      if (e.odometer == null) return;
      (byVehicle[e.vehicle] = byVehicle[e.vehicle] || []).push(e);
    });
    var totalKm = 0, totalL = 0;
    Object.keys(byVehicle).forEach(function (v) {
      var recs = byVehicle[v].slice().sort(function (a, b) { return a.odometer - b.odometer; });
      for (var i = 1; i < recs.length; i++) {
        var km = recs[i].odometer - recs[i - 1].odometer;
        var l = recs[i].liters;
        if (km > 0 && l > 0) { totalKm += km; totalL += l; }
      }
    });
    return totalL > 0 ? totalKm / totalL : null;
  }

  function renderMonthDelta() {
    var now = new Date();
    var thisKey = monthKey(now.toISOString().slice(0, 10));
    var prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var prevKey = monthKey(prevDate.toISOString().slice(0, 10));
    var base = state.vehicle === 'all' ? entries : entries.filter(function (e) { return e.vehicle === state.vehicle; });
    var thisTotal = base.filter(function (e) { return monthKey(e.date) === thisKey; }).reduce(function (s, e) { return s + e.totalCost; }, 0);
    var prevTotal = base.filter(function (e) { return monthKey(e.date) === prevKey; }).reduce(function (s, e) { return s + e.totalCost; }, 0);
    var el = document.getElementById('statTotalCostDelta');
    if (prevTotal <= 0) {
      el.textContent = 'เดือนนี้: ' + fmtBaht(thisTotal);
      el.className = 'stat-sub';
      return;
    }
    var pct = ((thisTotal - prevTotal) / prevTotal) * 100;
    var arrow = pct >= 0 ? '▲' : '▼';
    el.textContent = arrow + ' ' + fmtNum(Math.abs(pct), 0) + '% จากเดือนก่อน';
    el.className = 'stat-sub ' + (pct > 0 ? 'is-bad' : (pct < 0 ? 'is-good' : ''));
  }

  // ---------- rendering: charts ----------

  function chartFont() {
    return { family: getComputedStyle(document.body).fontFamily, size: 12 };
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') {
      Array.prototype.forEach.call(document.querySelectorAll('.chart-empty'), function (el) {
        el.textContent = 'ไม่สามารถโหลดไลบรารีกราฟได้ (ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต)';
        el.hidden = false;
      });
      Array.prototype.forEach.call(document.querySelectorAll('canvas'), function (c) { c.hidden = true; });
      return;
    }
    var list = filteredEntries().slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    renderSpendChart(list);
    renderPriceChart(list);
    renderVehicleChart(list);
  }

  function monthlySeries(list, valueFn, aggregate) {
    var map = {};
    list.forEach(function (e) {
      var k = monthKey(e.date);
      if (!map[k]) map[k] = [];
      map[k].push(e);
    });
    var keys = Object.keys(map).sort();
    return {
      labels: keys.map(monthLabel),
      values: keys.map(function (k) { return aggregate(map[k], valueFn); })
    };
  }

  function sum(arr, fn) { return arr.reduce(function (s, e) { return s + fn(e); }, 0); }

  function renderSpendChart(list) {
    var empty = document.getElementById('spendChartEmpty');
    var canvas = document.getElementById('spendChart');
    if (!list.length) {
      empty.hidden = false; canvas.hidden = true;
      if (spendChart) { spendChart.destroy(); spendChart = null; }
      return;
    }
    empty.hidden = true; canvas.hidden = false;
    var data = monthlySeries(list, function (e) { return e.totalCost; }, sum);
    var color = seriesColor(0);
    var cfg = {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{
          data: data.values,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 5,
          tension: 0.25,
          fill: false
        }]
      },
      options: baseChartOptions(function (v) { return fmtBaht(v); })
    };
    if (spendChart) { spendChart.data = cfg.data; spendChart.options = cfg.options; spendChart.update(); }
    else { spendChart = new Chart(canvas.getContext('2d'), cfg); }
  }

  function renderPriceChart(list) {
    var empty = document.getElementById('priceChartEmpty');
    var canvas = document.getElementById('priceChart');
    if (!list.length) {
      empty.hidden = false; canvas.hidden = true;
      if (priceChart) { priceChart.destroy(); priceChart = null; }
      return;
    }
    empty.hidden = true; canvas.hidden = false;
    var data = monthlySeries(list, function (e) { return e.pricePerLiter; }, function (arr, fn) {
      var totalCost = sum(arr, function (e) { return e.totalCost; });
      var totalL = sum(arr, function (e) { return e.liters; });
      return totalL > 0 ? totalCost / totalL : 0;
    });
    var color = seriesColor(1);
    var cfg = {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{
          data: data.values,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 5,
          tension: 0.25,
          fill: false
        }]
      },
      options: baseChartOptions(function (v) { return fmtBahtPrecise(v); })
    };
    if (priceChart) { priceChart.data = cfg.data; priceChart.options = cfg.options; priceChart.update(); }
    else { priceChart = new Chart(canvas.getContext('2d'), cfg); }
  }

  function renderVehicleChart(list) {
    var card = document.getElementById('vehicleChartCard');
    var vlist = vehicles();
    if (state.vehicle !== 'all' || vlist.length < 2) {
      card.hidden = true;
      if (vehicleChart) { vehicleChart.destroy(); vehicleChart = null; }
      return;
    }
    card.hidden = false;
    var byVehicle = {};
    list.forEach(function (e) { byVehicle[e.vehicle] = (byVehicle[e.vehicle] || 0) + e.totalCost; });
    var names = Object.keys(byVehicle).sort(function (a, b) { return byVehicle[b] - byVehicle[a]; });
    var colors = names.map(function (_, i) { return seriesColor(i); });
    var canvas = document.getElementById('vehicleChart');
    var cfg = {
      type: 'bar',
      data: {
        labels: names,
        datasets: [{
          data: names.map(function (n) { return byVehicle[n]; }),
          backgroundColor: colors,
          borderRadius: 4,
          maxBarThickness: 46
        }]
      },
      options: baseChartOptions(function (v) { return fmtBaht(v); })
    };
    cfg.options.plugins.legend.display = false;
    if (vehicleChart) { vehicleChart.data = cfg.data; vehicleChart.options = cfg.options; vehicleChart.update(); }
    else { vehicleChart = new Chart(canvas.getContext('2d'), cfg); }
  }

  function baseChartOptions(tooltipFmt) {
    var muted = cssVar('--text-muted');
    var grid = cssVar('--gridline');
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: function (ctx) { return tooltipFmt(ctx.parsed.y); } }
        }
      },
      scales: {
        x: { ticks: { color: muted, font: chartFont() }, grid: { display: false } },
        y: {
          ticks: { color: muted, font: chartFont(), callback: function (v) { return tooltipFmt(v); } },
          grid: { color: grid },
          beginAtZero: true
        }
      }
    };
  }

  // ---------- rendering: table ----------

  function renderTable() {
    var list = filteredEntries();
    var tbody = document.getElementById('entryTableBody');
    var empty = document.getElementById('tableEmpty');
    document.getElementById('tableCount').textContent = list.length + ' รายการ';

    if (!list.length) {
      tbody.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    tbody.innerHTML = list.map(function (e) {
      return '<tr data-id="' + e.id + '">' +
        '<td>' + fmtDate(e.date) + '</td>' +
        '<td>' + escapeHtml(e.vehicle) + '</td>' +
        '<td>' + escapeHtml(e.station || '—') + '</td>' +
        '<td class="num">' + fmtNum(e.liters, 2) + '</td>' +
        '<td class="num">' + fmtNum(e.pricePerLiter, 2) + '</td>' +
        '<td class="num">' + fmtNum(e.totalCost, 2) + '</td>' +
        '<td class="num">' + (e.odometer != null ? fmtNum(e.odometer, 0) : '—') + '</td>' +
        '<td><button class="row-edit-btn" type="button">แก้ไข</button></td>' +
        '</tr>';
    }).join('');

    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (row) {
      row.addEventListener('click', function () { openEditModal(row.getAttribute('data-id')); });
    });
  }

  // ---------- modal / form ----------

  var backdrop = document.getElementById('modalBackdrop');
  var form = document.getElementById('entryForm');

  function openAddModal() {
    editingId = null;
    document.getElementById('modalTitle').textContent = 'เพิ่มรายการเติมน้ำมัน';
    document.getElementById('deleteEntryBtn').hidden = true;
    form.reset();
    document.getElementById('entryId').value = '';
    document.getElementById('entryDate').value = new Date().toISOString().slice(0, 10);
    updateTotalPreview();
    backdrop.hidden = false;
    document.getElementById('entryVehicle').focus();
  }

  function openEditModal(id) {
    var e = entries.find(function (x) { return x.id === id; });
    if (!e) return;
    editingId = id;
    document.getElementById('modalTitle').textContent = 'แก้ไขรายการเติมน้ำมัน';
    document.getElementById('deleteEntryBtn').hidden = false;
    document.getElementById('entryId').value = e.id;
    document.getElementById('entryDate').value = e.date;
    document.getElementById('entryVehicle').value = e.vehicle;
    document.getElementById('entryStation').value = e.station || '';
    document.getElementById('entryLiters').value = e.liters;
    document.getElementById('entryPrice').value = e.pricePerLiter;
    document.getElementById('entryOdometer').value = e.odometer != null ? e.odometer : '';
    document.getElementById('entryNotes').value = e.notes || '';
    updateTotalPreview();
    backdrop.hidden = false;
  }

  function closeModal() {
    backdrop.hidden = true;
    editingId = null;
  }

  document.getElementById('addEntryBtn').addEventListener('click', openAddModal);
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('cancelEntryBtn').addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !backdrop.hidden) closeModal(); });

  function updateTotalPreview() {
    var liters = parseFloat(document.getElementById('entryLiters').value) || 0;
    var price = parseFloat(document.getElementById('entryPrice').value) || 0;
    document.getElementById('entryTotalPreview').textContent = fmtBahtPrecise(liters * price);
  }
  document.getElementById('entryLiters').addEventListener('input', updateTotalPreview);
  document.getElementById('entryPrice').addEventListener('input', updateTotalPreview);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var liters = parseFloat(document.getElementById('entryLiters').value);
    var price = parseFloat(document.getElementById('entryPrice').value);
    var odometerRaw = document.getElementById('entryOdometer').value;
    var entry = {
      id: editingId || uid(),
      date: document.getElementById('entryDate').value,
      vehicle: document.getElementById('entryVehicle').value.trim(),
      station: document.getElementById('entryStation').value.trim(),
      liters: liters,
      pricePerLiter: price,
      totalCost: Math.round(liters * price * 100) / 100,
      odometer: odometerRaw === '' ? null : parseFloat(odometerRaw),
      notes: document.getElementById('entryNotes').value.trim()
    };
    if (editingId) {
      var idx = entries.findIndex(function (x) { return x.id === editingId; });
      if (idx >= 0) entries[idx] = entry;
    } else {
      entries.push(entry);
    }
    saveEntries();
    closeModal();
    renderAll();
  });

  document.getElementById('deleteEntryBtn').addEventListener('click', function () {
    if (!editingId) return;
    if (!confirm('ลบรายการนี้ใช่หรือไม่?')) return;
    entries = entries.filter(function (x) { return x.id !== editingId; });
    saveEntries();
    closeModal();
    renderAll();
  });

  // ---------- CSV export ----------

  document.getElementById('exportCsvBtn').addEventListener('click', function () {
    var list = filteredEntries();
    var header = ['วันที่', 'รถ', 'ปั๊ม', 'ลิตร', 'บาทต่อลิตร', 'รวมบาท', 'เลขไมล์', 'หมายเหตุ'];
    var rows = list.map(function (e) {
      return [e.date, e.vehicle, e.station || '', e.liters, e.pricePerLiter, e.totalCost, e.odometer != null ? e.odometer : '', e.notes || '']
        .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    });
    var csv = '﻿' + header.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'fuel-expenses-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ---------- main render ----------

  function renderAll() {
    renderVehicleOptions();
    renderStats();
    renderCharts();
    renderTable();
  }

  initTheme();
  renderAll();
})();
