const express = require('express');
const path = require('path');
const si = require('systeminformation');

const app = express();
const PORT = process.env.PORT || 8642;

app.use(express.static(path.join(__dirname, 'public')));

// Cache the previous network/cpu samples so we can compute deltas cheaply.
let prevNetStats = null;

app.get('/api/stats', async (req, res) => {
  try {
    const [cpuLoad, cpuTemp, mem, fsSize, time, netStats, osInfo, cpuInfo] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature(),
      si.mem(),
      si.fsSize(),
      si.time(),
      si.networkStats(),
      si.osInfo(),
      si.cpu()
    ]);

    const disks = fsSize
      .filter((d) => d.size > 0)
      .map((d) => ({
        mount: d.mount,
        used: d.used,
        size: d.size,
        usePercent: Math.round(d.use * 10) / 10
      }));

    const net = (netStats[0] || {});

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
        tempMax: cpuTemp.max
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
      network: {
        iface: net.iface,
        rxSec: net.rx_sec || 0,
        txSec: net.tx_sec || 0
      }
    });
  } catch (err) {
    console.error('Blad odczytu statystyk:', err);
    res.status(500).json({ error: 'Nie udalo sie odczytac statystyk systemu', details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Server View dziala na http://localhost:${PORT}`);
});
