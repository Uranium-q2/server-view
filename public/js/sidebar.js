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
      if (res.status === 401) {
        location.href = `/login.html?returnTo=${encodeURIComponent(location.pathname)}`;
        return;
      }
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

  async function loadUser() {
    try {
      const res = await fetch('/auth/me');
      if (!res.ok) return;
      const user = await res.json();
      const el = document.getElementById('userEmail');
      if (el) el.textContent = user.email;
    } catch {
      /* ignore */
    }
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      location.href = '/login.html';
    });
  }

  loadUser();
  tick();
  setInterval(tick, 3000);
})();
