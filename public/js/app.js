const POLL_MS = 2000;
const BUFFER_LEN = 150; // ~5 min of history at 2s/sample, for CPU/Mem/Network/Disk
const UPTIME_SAMPLE_MS = 60000; // sample uptime into long-term history once a minute
const UPTIME_MAX_POINTS = 10000; // ~1 week at 1-minute resolution
const UPTIME_Y_MAX_HOURS = 100000; // "gigantic" fixed ceiling so only real long-haul uptime climbs it
const UPTIME_STORAGE_KEY = 'sv_uptime_history';

// Network has no natural 0-100% ceiling, so the thumbnail's y-max ratchets
// up to the highest combined rx+tx seen this session (like Task Manager
// scaling its network thumbnail to link speed, not to current traffic) -
// rescaling it to the current 5-minute window's own max every tick would
// make small background traffic look like it's maxing out the graph.
let netThumbMax = 1024;

function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtRate(bytesPerSec) {
  return `${fmtBytes(bytesPerSec)}/s`;
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function sanitizeKey(s) {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}

// ---------- Rolling in-memory history (resets on page reload, like Task Manager) ----------

const history = {
  cpu: Array(BUFFER_LEN).fill(null),
  mem: Array(BUFFER_LEN).fill(null),
  netRx: Array(BUFFER_LEN).fill(null),
  netTx: Array(BUFFER_LEN).fill(null),
  perCore: [], // array of arrays, one per logical core
  disks: {} // mount -> array
};

function pushRolling(arr, value) {
  arr.push(value);
  if (arr.length > BUFFER_LEN) arr.shift();
}

// ---------- Long-term uptime history (persisted across reloads) ----------

function loadUptimeHistory() {
  try {
    return JSON.parse(localStorage.getItem(UPTIME_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveUptimeHistory(points) {
  try {
    localStorage.setItem(UPTIME_STORAGE_KEY, JSON.stringify(points));
  } catch {
    /* storage full/unavailable - ignore, it's a non-critical convenience */
  }
}

let uptimeHistory = loadUptimeHistory();
let lastUptimeSampleAt = 0;

function recordUptimeSample(uptimeSeconds) {
  const now = Date.now();
  if (now - lastUptimeSampleAt < UPTIME_SAMPLE_MS) return;
  lastUptimeSampleAt = now;
  uptimeHistory.push({ t: now, h: uptimeSeconds / 3600 });
  if (uptimeHistory.length > UPTIME_MAX_POINTS) uptimeHistory.shift();
  saveUptimeHistory(uptimeHistory);
}

// ---------- Chart helpers ----------

// yMax fixes the scale (e.g. 100 for a percentage) so a small real value
// doesn't get visually blown up to fill the whole thumbnail just because
// it's the largest number in an otherwise-mostly-null buffer. Omit it only
// for metrics with no natural fixed ceiling (e.g. raw network bytes/sec).
function makeThumbnail(canvas, color, yMax) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: Array(BUFFER_LEN).fill(''),
      datasets: [{
        data: Array(BUFFER_LEN).fill(null),
        borderColor: color,
        backgroundColor: color + '33',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: { x: { display: false }, y: { display: false, min: 0, max: yMax } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } }
    }
  });
}

function makeDetailChart(canvas, datasets, { yMin = 0, yMax = 100, xLabels = null } = {}) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: xLabels || Array(datasets[0].data.length).fill(''),
      datasets: datasets.map((d) => ({
        label: d.label,
        data: d.data,
        borderColor: d.color,
        backgroundColor: d.color + '22',
        fill: d.fill !== false,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { display: false },
        y: { display: true, min: yMin, max: yMax, grid: { color: '#2a3140' }, ticks: { color: '#8792a3' } }
      },
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: '#8792a3' } },
        tooltip: { enabled: true },
        zoom: {
          pan: { enabled: true, mode: 'x' },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x'
          },
          limits: { x: { min: 'original', max: 'original' } }
        }
      }
    }
  });
}

// ---------- Resource list + detail selection ----------

let knownDiskMounts = [];
const thumbnails = {}; // key -> Chart instance
let mainChart = null;
let perCoreCharts = [];
let selectedKey = 'cpu';
let cpuPerCoreView = false;
let lastStats = null;

function buildList() {
  Object.values(thumbnails).forEach((c) => c.destroy());
  Object.keys(thumbnails).forEach((k) => delete thumbnails[k]);

  const listEl = document.getElementById('tmList');
  listEl.innerHTML = '';

  const rows = [
    { key: 'cpu', label: 'CPU', color: '#3b82f6', yMax: 100 },
    { key: 'memory', label: 'Memory', color: '#e2a93b', yMax: 100 },
    { key: 'network', label: 'Network', color: '#3bc17a', yMax: netThumbMax },
    { key: 'uptime', label: 'Uptime', color: '#8b5cf6', yMax: UPTIME_Y_MAX_HOURS },
    ...knownDiskMounts.map((mount) => ({ key: `disk:${mount}`, label: `Disk (${mount})`, color: '#e2503b', yMax: 100 }))
  ];

  rows.forEach((row) => {
    const el = document.createElement('div');
    el.className = 'tm-row' + (row.key === selectedKey ? ' active' : '');
    el.dataset.key = row.key;
    el.innerHTML = `
      <div class="tm-thumb-wrap"><canvas id="thumb-${sanitizeKey(row.key)}"></canvas></div>
      <div class="tm-row-label">
        <strong>${row.label}</strong>
        <span class="muted small" id="rowsub-${sanitizeKey(row.key)}">—</span>
      </div>
    `;
    el.addEventListener('click', () => selectKey(row.key));
    listEl.appendChild(el);

    const canvas = el.querySelector('canvas');
    thumbnails[row.key] = makeThumbnail(canvas, row.color, row.yMax);
  });
}

function selectKey(key) {
  selectedKey = key;
  cpuPerCoreView = false;
  document.querySelectorAll('.tm-row').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === key);
  });
  detailStructureSig = null; // force a structure rebuild for the newly selected resource
  renderDetail();
}

function destroyMainCharts() {
  if (mainChart) { mainChart.destroy(); mainChart = null; }
  perCoreCharts.forEach((c) => c.destroy());
  perCoreCharts = [];
}

function statRow(label, value) {
  return `<div class="stat-item"><span class="muted small">${label}</span><strong>${value}</strong></div>`;
}

// ---------- Manual Y-axis scale toolbar ----------

let yMaxManual = false;
let currentDefaultYMax = 100;

function roundForInput(n) {
  return Math.round(n * 100) / 100;
}

function scaleToolbarHtml() {
  return `
    <div class="chart-toolbar">
      <label class="muted small" for="yMaxInput">Y-axis max</label>
      <input type="number" id="yMaxInput" step="any" />
      <input type="range" id="yMaxSlider" />
      <button class="btn" id="applyScaleBtn">Apply</button>
      <button class="btn" id="resetScaleBtn">Reset</button>
    </div>
  `;
}

function attachScaleToolbar(defaultMax) {
  currentDefaultYMax = defaultMax;
  const input = document.getElementById('yMaxInput');
  const slider = document.getElementById('yMaxSlider');
  const applyBtn = document.getElementById('applyScaleBtn');
  const resetBtn = document.getElementById('resetScaleBtn');
  if (!input || !slider || !mainChart) return;

  input.value = roundForInput(defaultMax);
  slider.min = roundForInput(defaultMax / 100) || 0.01;
  slider.max = roundForInput(defaultMax * 2);
  slider.step = roundForInput(defaultMax / 200) || 0.01;
  slider.value = defaultMax;

  const setYMax = (val) => {
    if (!Number.isFinite(val) || val <= 0) return;
    yMaxManual = true;
    mainChart.options.scales.y.max = val;
    mainChart.update('none');
  };

  const applyFromInput = () => setYMax(parseFloat(input.value));

  applyBtn.addEventListener('click', applyFromInput);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFromInput(); });

  // Dragging the slider rescales live and keeps the number field in sync.
  slider.addEventListener('input', () => {
    const val = parseFloat(slider.value);
    input.value = roundForInput(val);
    setYMax(val);
  });

  resetBtn.addEventListener('click', () => {
    yMaxManual = false;
    input.value = roundForInput(currentDefaultYMax);
    slider.value = currentDefaultYMax;
    mainChart.options.scales.y.max = currentDefaultYMax;
    mainChart.update('none');
  });
}

// Only rebuilds the DOM + creates fresh Chart.js instances when the
// selected resource (or CPU's overview/per-core toggle) actually changes.
// Recreating the chart on every poll would also wipe out any zoom/pan the
// user had just done, since chartjs-plugin-zoom's state lives on the chart
// instance - so this must NOT run on every tick, only on a real selection
// change (see updateDetailData() for the per-tick data refresh).
let detailStructureSig = null;

function buildDetailStructure() {
  const title = document.getElementById('detailTitle');
  const actions = document.getElementById('detailActions');
  const body = document.getElementById('detailBody');

  destroyMainCharts();
  actions.innerHTML = '';

  if (selectedKey === 'cpu') {
    title.textContent = 'CPU';
    actions.innerHTML = `
      <button class="btn btn-toggle ${!cpuPerCoreView ? 'active' : ''}" id="btnOverview">Overview</button>
      <button class="btn btn-toggle ${cpuPerCoreView ? 'active' : ''}" id="btnPerCore">Per core</button>
    `;
    document.getElementById('btnOverview').addEventListener('click', () => { cpuPerCoreView = false; detailStructureSig = null; renderDetail(); });
    document.getElementById('btnPerCore').addEventListener('click', () => { cpuPerCoreView = true; detailStructureSig = null; renderDetail(); });

    if (cpuPerCoreView) {
      body.innerHTML = `<div class="core-grid" id="coreGrid"></div>`;
      const grid = document.getElementById('coreGrid');
      history.perCore.forEach((coreHistory, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'core-cell';
        wrap.innerHTML = `<span class="core-label">CPU ${i}</span><div class="core-chart-wrap"><canvas></canvas></div>`;
        grid.appendChild(wrap);
        const chart = makeThumbnail(wrap.querySelector('canvas'), '#3b82f6', 100);
        chart.data.datasets[0].data = coreHistory.slice();
        chart.update('none');
        perCoreCharts.push(chart);
      });
    } else {
      yMaxManual = false;
      body.innerHTML = `${scaleToolbarHtml()}<div class="main-chart-wrap"><canvas id="mainChart"></canvas></div><div class="stat-grid" id="statGrid"></div>`;
      mainChart = makeDetailChart(document.getElementById('mainChart'), [
        { label: 'CPU %', data: history.cpu.slice(), color: '#3b82f6' }
      ], { yMin: 0, yMax: 100 });
      attachScaleToolbar(100);
    }
  } else if (selectedKey === 'memory') {
    title.textContent = 'Memory';
    yMaxManual = false;
    body.innerHTML = `${scaleToolbarHtml()}<div class="main-chart-wrap"><canvas id="mainChart"></canvas></div><div class="stat-grid" id="statGrid"></div>`;
    mainChart = makeDetailChart(document.getElementById('mainChart'), [
      { label: 'Memory %', data: history.mem.slice(), color: '#e2a93b' }
    ], { yMin: 0, yMax: 100 });
    attachScaleToolbar(100);
  } else if (selectedKey === 'network') {
    title.textContent = 'Network';
    yMaxManual = false;
    body.innerHTML = `${scaleToolbarHtml()}<div class="main-chart-wrap"><canvas id="mainChart"></canvas></div><div class="stat-grid" id="statGrid"></div>`;
    const maxRate = Math.max(1024, ...history.netRx.filter(Boolean), ...history.netTx.filter(Boolean)) * 1.2;
    mainChart = makeDetailChart(document.getElementById('mainChart'), [
      { label: 'Download B/s', data: history.netRx.slice(), color: '#3bc17a' },
      { label: 'Upload B/s', data: history.netTx.slice(), color: '#3b82f6' }
    ], { yMin: 0, yMax: maxRate });
    attachScaleToolbar(maxRate);
  } else if (selectedKey === 'uptime') {
    title.textContent = 'Uptime';
    yMaxManual = false;
    body.innerHTML = `${scaleToolbarHtml()}<div class="main-chart-wrap"><canvas id="mainChart"></canvas></div><div class="stat-grid" id="statGrid"></div>`;
    const points = uptimeHistory.map((p) => p.h);
    mainChart = makeDetailChart(document.getElementById('mainChart'), [
      { label: 'Uptime (hours)', data: points, color: '#8b5cf6' }
    ], { yMin: 0, yMax: UPTIME_Y_MAX_HOURS });
    attachScaleToolbar(UPTIME_Y_MAX_HOURS);
  } else if (selectedKey.startsWith('disk:')) {
    const mount = selectedKey.slice(5);
    title.textContent = `Disk (${mount})`;
    yMaxManual = false;
    body.innerHTML = `${scaleToolbarHtml()}<div class="main-chart-wrap"><canvas id="mainChart"></canvas></div><div class="stat-grid" id="statGrid"></div>`;
    mainChart = makeDetailChart(document.getElementById('mainChart'), [
      { label: 'Usage %', data: (history.disks[mount] || []).slice(), color: '#e2503b' }
    ], { yMin: 0, yMax: 100 });
    attachScaleToolbar(100);
  }

  if (mainChart) {
    const canvas = document.getElementById('mainChart');
    canvas.ondblclick = () => mainChart.resetZoom();
  }
}

// Pushes fresh data/stats into the already-built chart instances, every
// tick, without touching the chart objects themselves (preserves zoom/pan).
function updateDetailData() {
  if (!lastStats) return;
  const s = lastStats;
  const statGrid = document.getElementById('statGrid');

  if (selectedKey === 'cpu') {
    if (cpuPerCoreView) {
      perCoreCharts.forEach((chart, i) => {
        chart.data.datasets[0].data = (history.perCore[i] || []).slice();
        chart.update('none');
      });
    } else if (mainChart) {
      mainChart.data.datasets[0].data = history.cpu.slice();
      mainChart.update('none');
      if (statGrid) {
        statGrid.innerHTML = [
          statRow('Utilization', `${s.cpu.loadPercent}%`),
          statRow('Speed', s.cpu.speedGHz ? `${s.cpu.speedGHz.toFixed(2)} GHz` : 'n/a'),
          statRow('Base speed', s.cpu.baseSpeedGHz ? `${s.cpu.baseSpeedGHz.toFixed(2)} GHz` : 'n/a'),
          statRow('Cores', s.cpu.cores),
          statRow('Logical processors', s.cpu.threads),
          statRow('Temperature', s.cpu.tempMain && s.cpu.tempMain > 0 ? `${s.cpu.tempMain.toFixed(1)}°C` : 'n/a')
        ].join('');
      }
    }
  } else if (selectedKey === 'memory' && mainChart) {
    mainChart.data.datasets[0].data = history.mem.slice();
    mainChart.update('none');
    if (statGrid) {
      statGrid.innerHTML = [
        statRow('In use', `${fmtBytes(s.mem.used)} (${s.mem.usePercent}%)`),
        statRow('Available', fmtBytes(s.mem.free)),
        statRow('Total', fmtBytes(s.mem.total)),
        statRow('Swap', s.mem.swapTotal > 0 ? `${fmtBytes(s.mem.swapUsed)} / ${fmtBytes(s.mem.swapTotal)}` : 'no swap')
      ].join('');
    }
  } else if (selectedKey === 'network' && mainChart) {
    mainChart.data.datasets[0].data = history.netRx.slice();
    mainChart.data.datasets[1].data = history.netTx.slice();
    const maxRate = Math.max(1024, ...history.netRx.filter(Boolean), ...history.netTx.filter(Boolean)) * 1.2;
    currentDefaultYMax = maxRate;
    if (!yMaxManual) mainChart.options.scales.y.max = maxRate;
    mainChart.update('none');
    if (statGrid) {
      statGrid.innerHTML = [
        statRow('Interface', s.network.iface || 'n/a'),
        statRow('Download', fmtRate(s.network.rxSec)),
        statRow('Upload', fmtRate(s.network.txSec))
      ].join('');
    }
  } else if (selectedKey === 'uptime' && mainChart) {
    mainChart.data.datasets[0].data = uptimeHistory.map((p) => p.h);
    mainChart.update('none');
    if (statGrid) {
      const startedAt = new Date(Date.now() - s.uptime * 1000);
      statGrid.innerHTML = [
        statRow('Current uptime', fmtUptime(s.uptime)),
        statRow('Running since', startedAt.toLocaleString()),
        statRow('Chart ceiling', `${UPTIME_Y_MAX_HOURS.toLocaleString()} h`)
      ].join('');
    }
  } else if (selectedKey.startsWith('disk:') && mainChart) {
    const mount = selectedKey.slice(5);
    const disk = s.disks.find((d) => d.mount === mount);
    mainChart.data.datasets[0].data = (history.disks[mount] || []).slice();
    mainChart.update('none');
    if (statGrid) {
      statGrid.innerHTML = [
        statRow('Used', disk ? `${fmtBytes(disk.used)} / ${fmtBytes(disk.size)}` : 'n/a'),
        statRow('Usage', disk ? `${disk.usePercent}%` : 'n/a')
      ].join('');
    }
  }
}

function renderDetail() {
  if (!lastStats) return;
  const sig = `${selectedKey}:${cpuPerCoreView}`;
  if (sig !== detailStructureSig) {
    buildDetailStructure();
    detailStructureSig = sig;
  }
  updateDetailData();
}

// ---------- Poll loop ----------

async function tick() {
  try {
    const res = await fetch('/api/stats');
    if (res.status === 401) {
      location.href = `/login.html?returnTo=${encodeURIComponent(location.pathname)}`;
      return;
    }
    if (!res.ok) throw new Error('bad response');
    const s = await res.json();
    lastStats = s;

    document.querySelector('#connStatus .status-dot').classList.add('online');
    document.getElementById('hostname').textContent = s.hostname || 'server';
    document.getElementById('platform').textContent = s.platform || '';
    document.getElementById('uptime').textContent = fmtUptime(s.uptime);

    const mounts = s.disks.map((d) => d.mount);
    const mountsChanged = mounts.length !== knownDiskMounts.length || mounts.some((m, i) => m !== knownDiskMounts[i]);
    if (mountsChanged) {
      knownDiskMounts = mounts;
      mounts.forEach((m) => { if (!history.disks[m]) history.disks[m] = Array(BUFFER_LEN).fill(null); });
      buildList();
    }

    if (history.perCore.length !== s.cpu.perCore.length) {
      history.perCore = s.cpu.perCore.map(() => Array(BUFFER_LEN).fill(null));
    }

    pushRolling(history.cpu, s.cpu.loadPercent);
    pushRolling(history.mem, s.mem.usePercent);
    pushRolling(history.netRx, s.network.rxSec);
    pushRolling(history.netTx, s.network.txSec);
    s.cpu.perCore.forEach((v, i) => pushRolling(history.perCore[i], v));
    mounts.forEach((m, i) => pushRolling(history.disks[m], s.disks[i].usePercent));
    recordUptimeSample(s.uptime);

    // Update thumbnails
    thumbnails.cpu.data.datasets[0].data = history.cpu.slice();
    thumbnails.cpu.update('none');
    thumbnails.memory.data.datasets[0].data = history.mem.slice();
    thumbnails.memory.update('none');
    const netCombined = history.netRx.map((v, i) => (v || 0) + (history.netTx[i] || 0));
    netThumbMax = Math.max(netThumbMax, (s.network.rxSec + s.network.txSec) * 1.15);
    thumbnails.network.data.datasets[0].data = netCombined;
    thumbnails.network.options.scales.y.max = netThumbMax;
    thumbnails.network.update('none');
    thumbnails.uptime.data.datasets[0].data = uptimeHistory.slice(-BUFFER_LEN).map((p) => p.h);
    thumbnails.uptime.update('none');
    mounts.forEach((m) => {
      const key = `disk:${m}`;
      if (thumbnails[key]) {
        thumbnails[key].data.datasets[0].data = history.disks[m].slice();
        thumbnails[key].update('none');
      }
    });

    const setSub = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setSub('rowsub-cpu', `${s.cpu.loadPercent}% ${s.cpu.speedGHz ? s.cpu.speedGHz.toFixed(2) + ' GHz' : ''}`);
    setSub('rowsub-memory', `${fmtBytes(s.mem.used)}/${fmtBytes(s.mem.total)} (${s.mem.usePercent}%)`);
    setSub('rowsub-network', `↓ ${fmtRate(s.network.rxSec)} ↑ ${fmtRate(s.network.txSec)}`);
    setSub('rowsub-uptime', fmtUptime(s.uptime));
    s.disks.forEach((d) => setSub(`rowsub-${sanitizeKey(`disk:${d.mount}`)}`, `${d.usePercent}%`));

    renderDetail();
  } catch (err) {
    document.querySelector('.status-dot').classList.remove('online');
    console.error(err);
  }
}

async function loadUser() {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return;
    const user = await res.json();
    document.getElementById('userName').textContent = user.username;
  } catch {
    /* ignore */
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

buildList();
loadUser();
tick();
setInterval(tick, POLL_MS);
