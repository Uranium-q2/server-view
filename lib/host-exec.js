const fs = require('fs');

// When Server View itself runs inside a Docker container, the fixed,
// read-only "docker compose ps" / "docker compose logs" commands (see
// lib/docker-actions.js) must run on the HOST, against the host's project
// directories, rather than inside this container's own isolated filesystem.
// We detect that case and re-enter the host's namespaces via `nsenter` (the
// same technique tools like Portainer use), which requires the container to
// run with `privileged: true` + `pid: host` (see docker-compose.yml).
// Outside Docker (plain `npm start` on the host), this is a no-op and
// commands run directly.

function isInContainer() {
  return fs.existsSync('/.dockerenv');
}

function hasNsenter() {
  try {
    fs.accessSync('/usr/bin/nsenter', fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const useNsenter = process.platform !== 'win32' && isInContainer() && hasNsenter();

// Returns { file, args } ready to pass to child_process.spawn.
function buildCommand(shellCommand, cwd) {
  if (process.platform === 'win32') {
    return { file: 'cmd.exe', args: ['/c', shellCommand] };
  }

  const script = cwd ? `cd '${cwd.replace(/'/g, "'\\''")}' && ${shellCommand}` : shellCommand;

  if (useNsenter) {
    return { file: 'nsenter', args: ['-t', '1', '-m', '-u', '-n', '-i', '--', 'sh', '-c', script] };
  }
  return { file: '/bin/sh', args: ['-c', script] };
}

module.exports = { isInContainer, useNsenter, buildCommand };
