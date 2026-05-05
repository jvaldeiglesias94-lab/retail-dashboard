/* charts.js — companion to charts.html. Loads /data.json once, renders 5 Chart.js views. */
(function () {
  'use strict';

  const RANK_COLORS = {
    1: '#dc3545', 2: '#0d6efd', 3: '#198754',
    4: '#fd7e14', 5: '#6f42c1', 6: '#6c757d',
  };

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Number(n).toLocaleString(); }

  function showLoaded() {
    $('loading').classList.add('hidden');
    ['kpi-section','cluster-cards-section','charts-section','state-section'].forEach(id => {
      const el = $(id); if (el) el.classList.remove('hidden');
    });
  }

  fetch('data.json', { headers: { Accept: 'application/json' } })
    .then(r => r.json())
    .then(payload => render(payload))
    .catch(err => { $('loading').textContent = 'Failed to load data: ' + err.message; });

  function render(payload) {
    const meta = payload.meta;
    const stores = payload.stores;

    // --- KPIs ---
    const total = stores.length;
    const brands = new Set(stores.map(s => s.ra)).size;
    const states = new Set(stores.map(s => s.st)).size;
    const clusters = (meta.ml_clusters || []).length;
    $('total-count').textContent = fmt(total);
    $('kpi-stores').textContent = fmt(total);
    $('kpi-brands').textContent = fmt(brands);
    $('kpi-states').textContent = fmt(states);
    $('kpi-clusters').textContent = clusters || '--';
    if (meta.schema_version) {
      const sb = $('schema-badge');
      sb.textContent = 'schema ' + meta.schema_version;
      sb.classList.remove('hidden');
    }

    // --- Cluster cards ---
    const cardsEl = $('cluster-cards');
    if (Array.isArray(meta.ml_clusters) && meta.ml_clusters.length) {
      meta.ml_clusters.sort((a,b) => a.rank - b.rank).forEach(c => {
        const color = RANK_COLORS[c.rank] || '#6c757d';
        const topBrands = Object.entries(c.top_brands || {}).slice(0,5).map(([k,v]) => k + ' (' + fmt(v) + ')').join('<br>');
        const topStates = Object.entries(c.top_states || {}).slice(0,5).map(([k,v]) => k + ' (' + fmt(v) + ')').join(', ');
        const card = document.createElement('div');
        card.className = 'rounded-lg bg-white border-2 p-4';
        card.style.borderColor = color;
        card.innerHTML = `
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold uppercase" style="color:${color}">Rank ${c.rank}</div>
            <div class="text-xs text-slate-500">score ${c.rollout_score >= 0 ? '+' : ''}${c.rollout_score.toFixed(2)}</div>
          </div>
          <div class="mt-1 text-base font-bold text-slate-900">${c.label || ('cluster ' + c.cluster_id)}</div>
          <div class="mt-1 text-sm text-slate-700">${fmt(c.size)} stores · port: ${c.nearest_port} (~${Math.round(c.mean_port_dist_km)} km)</div>
          <div class="mt-2 text-xs text-slate-600"><strong>Top states:</strong> ${topStates}</div>
          <div class="mt-2 text-xs text-slate-600"><strong>Top brands:</strong><br>${topBrands}</div>
        `;
        cardsEl.appendChild(card);
      });
    }

    // --- Stores per cluster bar ---
    const clusterCounts = {};
    stores.forEach(s => { if (s.mr != null) clusterCounts[s.mr] = (clusterCounts[s.mr]||0) + 1; });
    const clusterRanks = Object.keys(clusterCounts).map(Number).sort();
    const clusterLabels = clusterRanks.map(r => {
      const c = (meta.ml_clusters || []).find(m => m.rank === r);
      return 'Rank ' + r + ' — ' + (c ? c.label.split(' — ')[0] : '');
    });
    new Chart($('chart-cluster'), {
      type: 'bar',
      data: {
        labels: clusterLabels,
        datasets: [{
          data: clusterRanks.map(r => clusterCounts[r]),
          backgroundColor: clusterRanks.map(r => RANK_COLORS[r] || '#6c757d'),
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        responsive: true, maintainAspectRatio: false,
        scales: { x: { ticks: { autoSkip: false, maxRotation: 25 } } },
      },
    });

    // --- Stores per zone ---
    const ZONE_DISPLAY = {};
    (meta.zones || []).forEach(z => { (z.states || []).forEach(s => { ZONE_DISPLAY[s] = z.display || z.slug; }); });
    const zoneCounts = {};
    stores.forEach(s => {
      const z = ZONE_DISPLAY[s.st] || 'Other';
      zoneCounts[z] = (zoneCounts[z]||0) + 1;
    });
    const zoneEntries = Object.entries(zoneCounts).sort((a,b) => b[1]-a[1]);
    new Chart($('chart-zone'), {
      type: 'bar',
      data: {
        labels: zoneEntries.map(e => e[0]),
        datasets: [{ data: zoneEntries.map(e => e[1]), backgroundColor: '#0d6efd' }],
      },
      options: { plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false },
    });

    // --- Top 20 brands ---
    const brandCounts = {};
    stores.forEach(s => brandCounts[s.ra] = (brandCounts[s.ra]||0) + 1);
    const top20 = Object.entries(brandCounts).sort((a,b) => b[1]-a[1]).slice(0, 20);
    new Chart($('chart-brands'), {
      type: 'bar',
      data: {
        labels: top20.map(e => e[0]),
        datasets: [{ data: top20.map(e => e[1]), backgroundColor: '#198754' }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        responsive: true, maintainAspectRatio: false,
      },
    });

    // --- Stacked: class_of_trade by cluster ---
    const classes = Array.from(new Set(stores.map(s => s.cl))).sort();
    const stacks = {};
    classes.forEach(c => stacks[c] = clusterRanks.map(() => 0));
    stores.forEach(s => {
      const idx = clusterRanks.indexOf(s.mr);
      if (idx >= 0 && stacks[s.cl]) stacks[s.cl][idx] += 1;
    });
    const COT_PALETTE = ['#dc3545','#0d6efd','#198754','#fd7e14','#6f42c1','#20c997','#fd7e14','#e83e8c','#6c757d','#0dcaf0','#ffc107','#a3a3a3','#1f2937','#84cc16','#06b6d4','#f43f5e','#8b5cf6'];
    new Chart($('chart-stacked'), {
      type: 'bar',
      data: {
        labels: clusterLabels,
        datasets: classes.map((c, i) => ({
          label: c, data: stacks[c],
          backgroundColor: COT_PALETTE[i % COT_PALETTE.length],
        })),
      },
      options: {
        plugins: { legend: { position: 'right' } },
        responsive: true, maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true } },
      },
    });

    // --- State table ---
    const stateAgg = {};
    stores.forEach(s => {
      if (!stateAgg[s.st]) stateAgg[s.st] = { count: 0, brands: {} };
      stateAgg[s.st].count += 1;
      stateAgg[s.st].brands[s.ra] = (stateAgg[s.st].brands[s.ra] || 0) + 1;
    });
    let stateRows = Object.entries(stateAgg).map(([st, v]) => {
      const top = Object.entries(v.brands).sort((a,b) => b[1]-a[1])[0];
      return { state: st, count: v.count, top_brand: top ? top[0] : '', top_brand_n: top ? top[1] : 0 };
    });
    let sortKey = 'count', sortDir = -1;
    function renderTable() {
      stateRows.sort((a,b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
      });
      const tbody = $('state-tbody');
      tbody.innerHTML = stateRows.map(r => `
        <tr class="border-t border-slate-100">
          <td class="px-3 py-1.5 font-mono">${r.state}</td>
          <td class="px-3 py-1.5 text-right font-mono">${fmt(r.count)}</td>
          <td class="px-3 py-1.5">${r.top_brand}</td>
          <td class="px-3 py-1.5 text-right text-slate-500">${fmt(r.top_brand_n)}</td>
        </tr>
      `).join('');
    }
    renderTable();
    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (k === sortKey) sortDir = -sortDir;
        else { sortKey = k; sortDir = (k === 'state' ? 1 : -1); }
        renderTable();
      });
    });

    showLoaded();
  }
})();
