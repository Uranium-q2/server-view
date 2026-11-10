const os = require('os');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const hostExec = require('./host-exec');

const RESIZE_PREFIX = '\u0000RESIZE:';

let pty = null;
try {
  pty = require('node-pty');
} catch {
  pty = null; // Falls back to a plain child_process shell (no real TTY, but functional).
}

function attachTerminal(server) {
  const wss = new WebSocketServer({ server, path: '/ws/terminal' });

  wss.on('connection', (ws) => {
    const shellBinary = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
    const { file, args } = hostExec.buildShell(shellBinary);
    const cwd = hostExec.useNsenter ? undefined : os.homedir();

    if (pty) {
      const term = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd,
        env: process.env
      });

      term.onData((data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      });
      term.onExit(({ exitCode }) => {
        if (ws.readyState === ws.OPEN) ws.send(`\r\n[process exited with code ${exitCode}]\r\n`);
      });

      ws.on('message', (msg) => {
        const text = msg.toString();
        if (text.startsWith(RESIZE_PREFIX)) {
          try {
            const { cols, rows } = JSON.parse(text.slice(RESIZE_PREFIX.length));
            if (cols && rows) term.resize(cols, rows);
          } catch {
            /* ignore malformed resize payload */
          }
          return;
        }
        term.write(text);
      });

      ws.on('close', () => term.kill());
    } else {
      // Fallback: plain piped shell, no pseudo-tty (interactive full-screen apps won't render well).
      ws.send('[server-view] node-pty not installed - using basic shell mode.\r\n');
      const child = spawn(file, args, { cwd, env: process.env, shell: !hostExec.useNsenter });

      child.stdout.on('data', (d) => ws.readyState === ws.OPEN && ws.send(d.toString()));
      child.stderr.on('data', (d) => ws.readyState === ws.OPEN && ws.send(d.toString()));
      child.on('exit', (code) => {
        if (ws.readyState === ws.OPEN) ws.send(`\r\n[process exited with code ${code}]\r\n`);
      });

      ws.on('message', (msg) => {
        const text = msg.toString();
        if (text.startsWith(RESIZE_PREFIX)) return; // no-op without a real pty
        child.stdin.write(text);
      });

      ws.on('close', () => child.kill());
    }
  });
}

module.exports = { attachTerminal };
