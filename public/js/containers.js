const listEl = document.getElementById('containersList');
const overlay = document.getElementById('consoleOverlay');
const consoleOutput = document.getElementById('consoleOutput');
const consoleTitle = document.getElementById('consoleTitle');
const consoleClose = document.getElementById('consoleClose');

let currentEventSource = null;

function closeConsole() {
  overlay.classList.remove('visible');
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
}
consoleClose.addEventListener('click', closeConsole);

function statusBadge(state) {
  const map = {
    running: { label: 'Running', cls: 'badge-green' },
    partial: { label: 'Partial', cls: 'badge-orange' },
    stopped: { label: 'Stopped', cls: 'badge-red' },
    unknown: { label: 'Unknown', cls: 'badge-muted' }
  };
  const s = map[state] || map.unknown;
  return `<span class="badge ${s.cls}">${s.label}</span>`;
}

function renderContainers(containers) {
  if (containers.length === 0) {
    listEl.innerHTML = '<p class="muted">No containers configured yet. Add one from the Settings page.</p>';
    return;
  }

  listEl.innerHTML = '';
  containers.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'card container-card';

    card.innerHTML = `
      <div class="card-header">
        <h2>${c.name}</h2>
        ${statusBadge(c.status ? c.status.state : 'unknown')}
      </div>
      <p class="muted small location">${c.location || '(no location set)'}</p>
      <div class="container-actions">
        <button class="btn btn-restart" data-id="${c.id}">View logs</button>
      </div>
    `;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => viewLogs(btn.dataset.id, btn));
  });
}

async function loadContainers() {
  try {
    const res = await fetch('/api/containers');
    const containers = await res.json();
    renderContainers(containers);
  } catch (err) {
    listEl.innerHTML = '<p class="muted">Failed to load containers.</p>';
  }
}

async function viewLogs(id, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(`/api/containers/${id}/logs`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not fetch logs');
      btn.disabled = false;
      return;
    }
    openConsole(`Logs — ${btn.closest('.card').querySelector('h2').textContent}`, data.actionId, () => {
      btn.disabled = false;
    });
  } catch (err) {
    alert('Could not fetch logs.');
    btn.disabled = false;
  }
}

function openConsole(title, actionId, onDone) {
  consoleTitle.textContent = title;
  consoleOutput.textContent = '';
  overlay.classList.add('visible');

  if (currentEventSource) currentEventSource.close();
  const es = new EventSource(`/api/actions/${actionId}/stream`);
  currentEventSource = es;

  es.addEventListener('log', (ev) => {
    consoleOutput.textContent += JSON.parse(ev.data);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  });
  es.addEventListener('exit', () => {
    es.close();
    if (onDone) onDone();
  });
  es.addEventListener('error', () => {
    es.close();
    if (onDone) onDone();
  });
}

loadContainers();
setInterval(loadContainers, 5000);
