const form = document.getElementById('containerForm');
const settingsList = document.getElementById('settingsList');
const submitBtn = document.getElementById('submitBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const formTitle = document.getElementById('formTitle');

function resetForm() {
  form.reset();
  document.getElementById('containerId').value = '';
  submitBtn.textContent = 'Add container';
  formTitle.textContent = 'Add container';
  cancelEditBtn.style.display = 'none';
}

function fillForm(c) {
  document.getElementById('containerId').value = c.id;
  document.getElementById('fieldName').value = c.name;
  document.getElementById('fieldLocation').value = c.location;
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
    location: document.getElementById('fieldLocation').value.trim()
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
