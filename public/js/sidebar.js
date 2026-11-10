// Shared sidebar quick-stats, included on every page.
(function () {
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

  async function tick() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('bad response');
      const s = await res.json();

      const dot = document.querySelector('#connStatus .status-dot');
      if (dot) dot.classList.add('online');

      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };

      set('qsUptime', fmtUptime(s.uptime));
      set('qsCpu', `${s.cpu.loadPercent}%`);
      set('qsTemp', s.cpu.tempMain && s.cpu.tempMain > 0 ? `${s.cpu.tempMain.toFixed(1)}°C` : 'n/a');
      set('qsRam', `${s.mem.usePercent}%`);
    } catch (err) {
      const dot = document.querySelector('#connStatus .status-dot');
      if (dot) dot.classList.remove('online');
    }
  }

  tick();
  setInterval(tick, 3000);
})();
