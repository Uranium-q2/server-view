const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const hostExec = require('./host-exec');

// In-memory registry of running/finished actions, so SSE clients can attach
// to an already-started job (e.g. after a page reload).
const actions = new Map();

function getContainerStatus(container) {
  return new Promise((resolve) => {
    if (!container.location) return resolve({ state: 'unknown', services: [] });

    const { file, args } = hostExec.buildCommand('docker compose ps --format json', container.location);
    const child = spawn(file, args, { timeout: 10000 });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.on('error', () => resolve({ state: 'unknown', services: [] }));
    child.on('close', () => {
      if (!stdout || !stdout.trim()) return resolve({ state: 'unknown', services: [] });

      const services = [];
      const trimmed = stdout.trim();
      try {
        const parsed = JSON.parse(trimmed);
        services.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      } catch {
        // `docker compose ps --format json` on some versions prints one JSON object per line.
        trimmed.split('\n').forEach((line) => {
          try {
            services.push(JSON.parse(line));
          } catch {
            /* ignore malformed line */
          }
        });
      }

      if (services.length === 0) return resolve({ state: 'stopped', services: [] });

      const states = services.map((s) => (s.State || s.Status || '').toLowerCase());
      const runningCount = states.filter((s) => s.includes('running') || s.includes('up')).length;
      let state = 'stopped';
      if (runningCount === states.length) state = 'running';
      else if (runningCount > 0) state = 'partial';

      resolve({ state, services });
    });
  });
}

// Read-only: shows recent container logs. There is deliberately no way to
// run an arbitrary or user-supplied command here (no start/stop/restart) -
// this is the only action exposed to the UI, and the command is fixed.
function startLogsAction(container) {
  const command = 'docker compose logs --no-color --tail=300';

  const actionId = randomUUID();
  const record = {
    id: actionId,
    containerId: container.id,
    action: 'logs',
    command,
    buffer: [],
    done: false,
    exitCode: null,
    listeners: new Set()
  };
  actions.set(actionId, record);

  const { file, args } = hostExec.buildCommand(command, container.location || process.cwd());
  const child = spawn(file, args, hostExec.useNsenter ? {} : { cwd: container.location || process.cwd() });

  const emit = (line) => {
    record.buffer.push(line);
    if (record.buffer.length > 2000) record.buffer.shift();
    record.listeners.forEach((fn) => fn(line));
  };

  child.stdout.on('data', (chunk) => emit(chunk.toString()));
  child.stderr.on('data', (chunk) => emit(chunk.toString()));
  child.on('error', (err) => emit(`\n[server-view] failed to start command: ${err.message}\n`));
  child.on('close', (code) => {
    record.done = true;
    record.exitCode = code;
    record.listeners.forEach((fn) => fn(null, code));
  });

  return actionId;
}

function subscribe(actionId, onData) {
  const record = actions.get(actionId);
  if (!record) return null;
  record.listeners.add(onData);
  return record;
}

function unsubscribe(actionId, onData) {
  const record = actions.get(actionId);
  if (record) record.listeners.delete(onData);
}

module.exports = { getContainerStatus, startLogsAction, subscribe, unsubscribe };
