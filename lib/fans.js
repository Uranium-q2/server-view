const fs = require('fs');
const path = require('path');

const HWMON_ROOT = '/sys/class/hwmon';

function readTrimmed(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

// Reads fan tachometer speeds (RPM) directly from the kernel's hwmon sysfs
// interface - the same data `lm-sensors` itself reads. Works whether Server
// View runs natively or in Docker, as long as /sys is reachable (see
// docker-compose.yml's /sys:/sys:ro mount) - no shell/nsenter needed since
// this is a plain file read, not a privileged operation.
//
// Not every motherboard/kernel combination exposes fan RPM this way: it
// depends on a Super I/O driver (nct6775, it87, ...) or a vendor WMI driver
// (gigabyte_wmi, ...) being loaded and supporting tachometer readout for
// that specific board. If none is available, this simply returns [].
function readFans() {
  const fans = [];
  let chips;
  try {
    chips = fs.readdirSync(HWMON_ROOT);
  } catch {
    return fans;
  }

  for (const chip of chips) {
    const chipDir = path.join(HWMON_ROOT, chip);
    const chipName = readTrimmed(path.join(chipDir, 'name')) || chip;

    let entries;
    try {
      entries = fs.readdirSync(chipDir);
    } catch {
      continue;
    }

    const fanIndexes = entries
      .map((f) => {
        const m = f.match(/^fan(\d+)_input$/);
        return m ? parseInt(m[1], 10) : null;
      })
      .filter((n) => n !== null)
      .sort((a, b) => a - b);

    for (const index of fanIndexes) {
      const raw = readTrimmed(path.join(chipDir, `fan${index}_input`));
      const rpm = raw !== null ? parseInt(raw, 10) : NaN;
      if (Number.isNaN(rpm)) continue;

      // Some drivers (notably gigabyte_wmi, which reads the board's WMI
      // sensor table) expose a human-readable name here, e.g. "CPU Fan".
      // Otherwise fall back to a generic "<chip> fan<N>" label.
      const label = readTrimmed(path.join(chipDir, `fan${index}_label`)) || `${chipName} fan${index}`;

      fans.push({ chip: chipName, index, label, rpm });
    }
  }

  return fans;
}

module.exports = { readFans };
