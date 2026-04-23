'use strict';

function setTesterMessage(text, isError) {
  const el = document.getElementById('testerMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function createFieldInput(endpointId, field) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const label = document.createElement('label');
  label.setAttribute('for', endpointId + '-' + field.key);
  label.textContent = field.key + (field.required ? ' *' : '');
  wrapper.appendChild(label);

  let input;
  if (field.type === 'boolean') {
    input = document.createElement('select');
    input.id = endpointId + '-' + field.key;
    input.name = field.key;

    [['', '(unset)'], ['true', 'true'], ['false', 'false']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      input.appendChild(opt);
    });

    if (field.defaultValue === 'true' || field.defaultValue === 'false') {
      input.value = field.defaultValue;
    }
  } else {
    input = document.createElement('input');
    input.id = endpointId + '-' + field.key;
    input.name = field.key;
    input.type = field.type === 'number' ? 'number' : (field.type === 'date' ? 'date' : 'text');
    input.placeholder = field.defaultValue || '';
    if (field.defaultValue && field.type !== 'date') {
      input.value = field.defaultValue;
    }
  }

  wrapper.appendChild(input);

  if (field.description) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = field.description;
    wrapper.appendChild(hint);
  }

  return wrapper;
}

function collectParams(form) {
  const params = {};
  new FormData(form).forEach((value, key) => {
    const text = String(value || '').trim();
    if (text) params[key] = text;
  });
  return params;
}

async function executeRequest(endpointId, form, outputEl, submitBtn) {
  const params = collectParams(form);
  submitBtn.disabled = true;
  outputEl.textContent = 'Executing request...';
  setTesterMessage('', false);

  try {
    const res = await fetch('/api/admin/stay/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpointId, params })
    });

    const data = await res.json().catch(() => ({}));
    outputEl.textContent = JSON.stringify(data, null, 2);

    if (!res.ok) {
      setTesterMessage(data.error || 'Failed to execute request.', true);
    } else {
      setTesterMessage('Request executed — HTTP ' + data.response.status + '.', !data.response.ok);
    }
  } catch {
    outputEl.textContent = '{\n  "error": "Network error executing request."\n}';
    setTesterMessage('Network error executing request.', true);
  } finally {
    submitBtn.disabled = false;
  }
}

function renderEndpointCard(endpoint) {
  const section = document.createElement('section');
  section.className = 'listing-form-section api-endpoint-card';

  const title = document.createElement('h3');
  title.textContent = endpoint.title;
  section.appendChild(title);

  if (endpoint.description) {
    const desc = document.createElement('p');
    desc.className = 'hint';
    desc.textContent = endpoint.description;
    section.appendChild(desc);
  }

  const meta = document.createElement('p');
  meta.className = 'hint';
  meta.style.fontFamily = 'monospace';
  meta.textContent = endpoint.method + ' ' + endpoint.path;
  section.appendChild(meta);

  const form = document.createElement('form');
  form.className = 'api-request-form';
  form.noValidate = true;

  endpoint.queryFields.forEach((field) => {
    form.appendChild(createFieldInput(endpoint.id, field));
  });

  const actions = document.createElement('div');
  actions.className = 'feed-actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn primary calendar-btn';
  submitBtn.textContent = 'Execute Request';
  actions.appendChild(submitBtn);
  form.appendChild(actions);
  section.appendChild(form);

  const responseLabel = document.createElement('h4');
  responseLabel.textContent = 'Response';
  section.appendChild(responseLabel);

  const output = document.createElement('pre');
  output.className = 'api-response-box';
  output.textContent = '{\n  "message": "Run a request to view the response."\n}';
  section.appendChild(output);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await executeRequest(endpoint.id, form, output, submitBtn);
  });

  return section;
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) {
    window.location.href = '/Admin/index.html';
    return false;
  }
  return true;
}

async function loadEndpoints() {
  const container = document.getElementById('apiTesterContainer');
  container.innerHTML = '';

  const res = await fetch('/api/admin/stay/endpoints');
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    setTesterMessage(data.error || 'Failed to load endpoint definitions.', true);
    container.textContent = 'Could not load endpoint metadata.';
    return;
  }

  if (!data.hasApiKeyConfigured) {
    setTesterMessage('STAY_API_KEY is not configured on the server. Add it to your environment variables.', true);
  }

  (data.endpoints || []).forEach((endpoint) => {
    container.appendChild(renderEndpointCard(endpoint));
  });
}

(async () => {
  try {
    if (!(await checkAdminSession())) return;
    await loadEndpoints();
  } catch {
    setTesterMessage('Failed to initialize Stay API tester.', true);
  }
})();

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});
