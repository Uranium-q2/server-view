const fs = require('fs');

// When Server View itself runs inside a Docker container, commands must be
// executed on the HOST (real shell, real "docker compose" against the host's
// project directories) rather than inside the container's own isolated
// filesystem/process namespace. We detect that case and re-enter the host's
// namespaces via `nsenter` (the same technique tools like Portainer use),
// which requires the container to run with `privileged: true` + `pid: host`
// (see docker-compose.yml). Outside Docker (plain `npm start` on the host),
// this is a no-op and commands run directly.

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

// Returns { file, args } for an interactive shell (terminal page).
function buildShell(shellBinary) {
  if (process.platform === 'win32') {
    return { file: shellBinary, args: [] };
  }
  if (useNsenter) {
    // cwd set by the caller refers to the container's filesystem and is
    // meaningless once nsenter switches mount namespaces, so pick a sane
    // starting directory on the host instead.
    const script = `cd /root 2>/dev/null || cd /; exec ${shellBinary}`;
    return { file: 'nsenter', args: ['-t', '1', '-m', '-u', '-n', '-i', '--', 'sh', '-c', script] };
  }
  return { file: shellBinary, args: [] };
}

module.exports = { isInContainer, useNsenter, buildCommand, buildShell };
