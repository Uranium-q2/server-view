const POLL_MS = 2000;
const HISTORY_LEN = 30;

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

function makeSparkline(ctx, color) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(HISTORY_LEN).fill(''),
      datasets: [{
        data: Array(HISTORY_LEN).fill(null),
        borderColor: color,
        backgroundColor: color + '33',
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: { display: false },
        y: { display: false, min: 0 }
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } }
    }
  });
}

function pushPoint(chart, value) {
  const data = chart.data.datasets[0].data;
  data.push(value);
  data.shift();
  chart.update('none');
}

const cpuChart = makeSparkline(document.getElementById('cpuChart'), '#2a7de1');
cpuChart.options.scales.y.max = 100;
const tempChart = makeSparkline(document.getElementById('tempChart'), '#e2503b');

async function tick() {
  try {
    const res = await fetch('/api/stats');
    if (res.status === 401) {
      location.href = `/login.html?returnTo=${encodeURIComponent(location.pathname)}`;
      return;
    }
    if (!res.ok) throw new Error('bad response');
    const s = await res.json();

    document.querySelector('#connStatus .status-dot').classList.add('online');

    document.getElementById('hostname').textContent = s.hostname || 'server-view';
    document.getElementById('platform').textContent = s.platform || '';
    document.getElementById('uptime').textContent = fmtUptime(s.uptime);

    document.getElementById('cpuLoadValue').textContent = `${s.cpu.loadPercent}%`;
    document.getElementById('cpuBrand').textContent = s.cpu.brand || '';
    document.getElementById('cpuCores').textContent = `${s.cpu.cores} cores / ${s.cpu.threads} threads`;
    pushPoint(cpuChart, s.cpu.loadPercent);

    const temp = s.cpu.tempMain;
    document.getElementById('tempValue').textContent = temp && temp > 0 ? `${temp.toFixed(1)}°C` : 'n/a';
    document.getElementById('tempMax').textContent = s.cpu.tempMax && s.cpu.tempMax > 0 ? s.cpu.tempMax.toFixed(1) : '—';
    if (!tempChart.options.scales.y.max) tempChart.options.scales.y.max = 100;
    pushPoint(tempChart, temp && temp > 0 ? temp : null);

    document.getElementById('memValue').textContent = `${s.mem.usePercent}%`;
    document.getElementById('memBar').style.width = `${s.mem.usePercent}%`;
    document.getElementById('memDetail').textContent = `${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`;

    document.getElementById('swapValue').textContent = `${s.mem.swapPercent}%`;
    document.getElementById('swapBar').style.width = `${s.mem.swapPercent}%`;
    document.getElementById('swapDetail').textContent = s.mem.swapTotal > 0
      ? `${fmtBytes(s.mem.swapUsed)} / ${fmtBytes(s.mem.swapTotal)}`
      : 'no swap';

    document.getElementById('netRx').textContent = fmtRate(s.network.rxSec);
    document.getElementById('netTx').textContent = fmtRate(s.network.txSec);

    const disksList = document.getElementById('disksList');
    disksList.innerHTML = '';
    s.disks.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'disk-row';
      row.innerHTML = `
        <div class="disk-row-top">
          <span>${d.mount}</span>
          <span class="muted">${fmtBytes(d.used)} / ${fmtBytes(d.size)} (${d.usePercent}%)</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${d.usePercent}%"></div></div>
      `;
      disksList.appendChild(row);
    });

    const fansList = document.getElementById('fansList');
    fansList.innerHTML = '';
    if (s.fans.length === 0) {
      fansList.innerHTML = '<p class="muted small">No fan sensors detected on this board/kernel.</p>';
    } else {
      s.fans.forEach((f) => {
        const row = document.createElement('div');
        row.className = 'net-row';
        row.innerHTML = `<span class="muted small">${f.label}</span><strong>${f.rpm} RPM</strong>`;
        fansList.appendChild(row);
      });
    }
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

loadUser();
tick();
setInterval(tick, POLL_MS);
