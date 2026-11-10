require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const cookieParser = require('cookie-parser');
const si = require('systeminformation');

const auth = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 8642;

app.use(express.json());
app.use(cookieParser());

// ---------- Auth (Discord OAuth2) ----------

app.get('/auth/config', (req, res) => {
  res.json({ configured: auth.isConfigured() });
});

app.get('/auth/discord', (req, res) => {
  if (!auth.isConfigured()) {
    return res.status(500).send('Server is missing Discord OAuth settings in .env (see .env.example).');
  }
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
  res.redirect(auth.buildAuthorizeUrl(returnTo));
});

app.get('/auth/discord/callback', async (req, res) => {
  const returnTo = typeof req.query.state === 'string' ? req.query.state : '/';

  if (req.query.error) {
    return res.redirect(`/login.html?error=${encodeURIComponent('Discord sign-in was cancelled or denied.')}`);
  }

  try {
    const user = await auth.exchangeCodeForUser(req.query.code);
    if (!auth.isAllowedUser(user.id)) {
      return res.redirect(`/login.html?error=${encodeURIComponent(`Access denied for ${user.username} (id ${user.id}).`)}`);
    }
    const cookieValue = auth.createSessionCookie(user);
    res.cookie(auth.COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.redirect(returnTo);
  } catch (err) {
    console.error('Discord auth failed:', err);
    res.redirect(`/login.html?error=${encodeURIComponent('Discord sign-in failed. Please try again.')}`);
  }
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie(auth.COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/auth/me', (req, res) => {
  const session = auth.getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: session.id, username: session.username, avatar: session.avatar });
});

// Everything below this line requires a valid session.
app.use(auth.requireAuth);

// Canonical URL is "/" (served transparently via express.static's default
// index.html); redirect the old explicit path to it instead of serving it.
app.get('/index.html', (req, res) => res.redirect('/'));

app.use(express.static(path.join(__dirname, 'public')));

// ---------- System stats ----------

app.get('/api/stats', async (req, res) => {
  try {
    const [cpuLoad, cpuTemp, cpuSpeed, mem, fsSize, time, netStats, osInfo, cpuInfo, graphics, processes] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature(),
      si.cpuCurrentSpeed(),
      si.mem(),
      si.fsSize(),
      si.time(),
      si.networkStats(),
      si.osInfo(),
      si.cpu(),
      si.graphics().catch(() => null),
      si.processes().catch(() => null)
    ]);

    const candidateDisks = fsSize.filter((d) => d.size > 0);
    // Only the single disk the OS itself is installed on - not every
    // overlay/bind-mount fstab entry (Docker overlayfs, /proc, /sys bind
    // mounts, etc. all report size > 0 and would otherwise flood the list).
    const mainDisk =
      candidateDisks.find((d) => d.mount === '/' || /^[A-Z]:\\?$/i.test(d.mount)) ||
      candidateDisks.slice().sort((a, b) => b.size - a.size)[0];

    const disks = mainDisk
      ? [{
          mount: mainDisk.mount,
          used: mainDisk.used,
          size: mainDisk.size,
          usePercent: Math.round(mainDisk.use * 10) / 10
        }]
      : [];

    // Prefer a controller that actually reports live metrics (the real GPU)
    // over virtual/meta display adapters, which also have a vendor/model
    // but never report temperature or load.
    const gpuController = graphics && graphics.controllers
      ? graphics.controllers.find((c) => typeof c.temperatureGpu === 'number') ||
        graphics.controllers.find((c) => typeof c.memoryTotal === 'number') ||
        graphics.controllers.find((c) => c.vendor && !/meta/i.test(c.vendor)) ||
        null
      : null;

    const gpu = gpuController
      ? {
          vendor: gpuController.vendor || 'Unknown',
          model: gpuController.model || 'GPU',
          tempC: typeof gpuController.temperatureGpu === 'number' ? gpuController.temperatureGpu : null,
          loadPercent: typeof gpuController.utilizationGpu === 'number' ? gpuController.utilizationGpu : null,
          memUsedMB: typeof gpuController.memoryUsed === 'number' ? gpuController.memoryUsed : null,
          memTotalMB: typeof gpuController.memoryTotal === 'number' ? gpuController.memoryTotal : null,
          fanPercent: typeof gpuController.fanSpeed === 'number' ? gpuController.fanSpeed : null
        }
      : null;

    const procList = processes && processes.list
      ? processes.list
          .filter((p) => p.pid !== 0)
          .sort((a, b) => b.cpu - a.cpu)
          .slice(0, 20)
          .map((p) => ({
            pid: p.pid,
            name: p.name,
            cpu: Math.round(p.cpu * 10) / 10,
            mem: Math.round(p.mem * 10) / 10
          }))
      : [];

    const procSummary = processes
      ? { all: processes.all, running: processes.running, blocked: processes.blocked, sleeping: processes.sleeping }
      : { all: 0, running: 0, blocked: 0, sleeping: 0 };

    const net = netStats[0] || {};

    res.json({
      hostname: osInfo.hostname,
      platform: `${osInfo.distro} ${osInfo.release}`,
      uptime: time.uptime,
      cpu: {
        manufacturer: cpuInfo.manufacturer,
        brand: cpuInfo.brand,
        cores: cpuInfo.physicalCores,
        threads: cpuInfo.cores,
        loadPercent: Math.round(cpuLoad.currentLoad * 10) / 10,
        perCore: cpuLoad.cpus.map((c) => Math.round(c.load * 10) / 10),
        tempMain: cpuTemp.main,
        tempCores: cpuTemp.cores,
        tempMax: cpuTemp.max,
        speedGHz: cpuSpeed.avg,
        baseSpeedGHz: cpuInfo.speed ? parseFloat(cpuInfo.speed) : null
      },
      mem: {
        total: mem.total,
        used: mem.active,
        free: mem.available,
        usePercent: Math.round((mem.active / mem.total) * 1000) / 10,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        swapPercent: mem.swaptotal > 0 ? Math.round((mem.swapused / mem.swaptotal) * 1000) / 10 : 0
      },
      disks,
      gpu,
      processes: { ...procSummary, list: procList },
      network: {
        iface: net.iface,
        rxSec: net.rx_sec || 0,
        txSec: net.tx_sec || 0
      }
    });
  } catch (err) {
    console.error('Failed to read system stats:', err);
    res.status(500).json({ error: 'Failed to read system stats', details: String(err) });
  }
});

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Web Task Manager running at http://localhost:${PORT}`);
});
