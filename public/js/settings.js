const form = document.getElementById('containerForm');
const settingsList = document.getElementById('settingsList');
const submitBtn = document.getElementById('submitBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const formTitle = document.getElementById('formTitle');

function resetForm() {
  form.reset();
  document.getElementById('containerId').value = '';
  document.getElementById('enStart').checked = true;
  document.getElementById('enStop').checked = true;
  document.getElementById('enRestart').checked = true;
  submitBtn.textContent = 'Add container';
  formTitle.textContent = 'Add container';
  cancelEditBtn.style.display = 'none';
}

function fillForm(c) {
  document.getElementById('containerId').value = c.id;
  document.getElementById('fieldName').value = c.name;
  document.getElementById('fieldLocation').value = c.location;
  document.getElementById('cmdStart').value = c.commands.start;
  document.getElementById('cmdStop').value = c.commands.stop;
  document.getElementById('cmdRestart').value = c.commands.restart;
  document.getElementById('enStart').checked = c.enabled.start !== false;
  document.getElementById('enStop').checked = c.enabled.stop !== false;
  document.getElementById('enRestart').checked = c.enabled.restart !== false;
  submitBtn.textContent = 'Save changes';
  formTitle.textContent = `Edit: ${c.name}`;
  cancelEditBtn.style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

cancelEditBtn.addEventListener('click', resetForm);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('containerId').value;

  const payload = {
    name: document.getElementById('fieldName').value.trim(),
    location: document.getElementById('fieldLocation').value.trim(),
    commands: {
      start: document.getElementById('cmdStart').value.trim() || undefined,
      stop: document.getElementById('cmdStop').value.trim() || undefined,
      restart: document.getElementById('cmdRestart').value.trim() || undefined
    },
    enabled: {
      start: document.getElementById('enStart').checked,
      stop: document.getElementById('enStop').checked,
      restart: document.getElementById('enRestart').checked
    }
  };

  const url = id ? `/api/containers/${id}` : '/api/containers';
  const method = id ? 'PUT' : 'POST';

  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  resetForm();
  loadList();
});

async function loadList() {
  const res = await fetch('/api/containers');
  const containers = await res.json();

  if (containers.length === 0) {
    settingsList.innerHTML = '<p class="muted">No containers configured yet.</p>';
    return;
  }

  settingsList.innerHTML = '';
  containers.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `
      <div>
        <strong>${c.name}</strong>
        <p class="muted small">${c.location}</p>
      </div>
      <div class="settings-row-actions">
        <button class="btn btn-restart" data-edit="${c.id}">Edit</button>
        <button class="btn btn-stop" data-delete="${c.id}">Delete</button>
      </div>
    `;
    settingsList.appendChild(row);
  });

  settingsList.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = containers.find((x) => x.id === btn.dataset.edit);
      if (c) fillForm(c);
    });
  });

  settingsList.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this container configuration?')) return;
      await fetch(`/api/containers/${btn.dataset.delete}`, { method: 'DELETE' });
      loadList();
    });
  });
}

loadList();
