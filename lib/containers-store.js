const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'containers.json');

const DEFAULT_COMMANDS = {
  start: 'docker compose up -d --build',
  stop: 'docker compose down',
  restart: 'docker compose restart'
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ containers: [] }, null, 2));
}

function readAll() {
  ensureStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.containers) ? parsed.containers : [];
  } catch {
    return [];
  }
}

function writeAll(containers) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify({ containers }, null, 2));
}

function list() {
  return readAll();
}

function get(id) {
  return readAll().find((c) => c.id === id);
}

function create(data) {
  const containers = readAll();
  const entry = {
    id: randomUUID(),
    name: data.name || 'Unnamed container',
    location: data.location || '',
    commands: {
      start: (data.commands && data.commands.start) || DEFAULT_COMMANDS.start,
      stop: (data.commands && data.commands.stop) || DEFAULT_COMMANDS.stop,
      restart: (data.commands && data.commands.restart) || DEFAULT_COMMANDS.restart
    },
    enabled: {
      start: data.enabled ? data.enabled.start !== false : true,
      stop: data.enabled ? data.enabled.stop !== false : true,
      restart: data.enabled ? data.enabled.restart !== false : true
    }
  };
  containers.push(entry);
  writeAll(containers);
  return entry;
}

function update(id, data) {
  const containers = readAll();
  const idx = containers.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const existing = containers[idx];
  const updated = {
    ...existing,
    name: data.name !== undefined ? data.name : existing.name,
    location: data.location !== undefined ? data.location : existing.location,
    commands: {
      start: (data.commands && data.commands.start) || existing.commands.start,
      stop: (data.commands && data.commands.stop) || existing.commands.stop,
      restart: (data.commands && data.commands.restart) || existing.commands.restart
    },
    enabled: {
      start: data.enabled ? data.enabled.start !== false : existing.enabled.start,
      stop: data.enabled ? data.enabled.stop !== false : existing.enabled.stop,
      restart: data.enabled ? data.enabled.restart !== false : existing.enabled.restart
    }
  };
  containers[idx] = updated;
  writeAll(containers);
  return updated;
}

function remove(id) {
  const containers = readAll();
  const next = containers.filter((c) => c.id !== id);
  writeAll(next);
  return next.length !== containers.length;
}

module.exports = { list, get, create, update, remove, DEFAULT_COMMANDS };
