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

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '(unset)';
    input.appendChild(blank);

    const trueOption = document.createElement('option');
    trueOption.value = 'true';
    trueOption.textContent = 'true';
    input.appendChild(trueOption);

    const falseOption = document.createElement('option');
    falseOption.value = 'false';
    falseOption.textContent = 'false';
    input.appendChild(falseOption);

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
  const data = new FormData(form);
  const params = {};

  for (const [key, value] of data.entries()) {
    const text = String(value || '').trim();
    if (text) {
      params[key] = text;
    }
  }

  return params;
}

function formatResponsePayload(payload) {
  return JSON.stringify(payload, null, 2);
}

async function executeRequest(endpointId, form, outputEl, submitBtn) {
  const params = collectParams(form);

  submitBtn.disabled = true;
  outputEl.textContent = 'Executing request...';
  setTesterMessage('', false);

  try {
    const res = await fetch('/api/admin/kayak/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpointId, params })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      outputEl.textContent = formatResponsePayload(data);
      setTesterMessage(data.error || 'Failed to execute request.', true);
      return;
    }

    outputEl.textContent = formatResponsePayload(data);
    setTesterMessage('Request executed.', false);
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

  const endpointMeta = document.createElement('p');
  endpointMeta.className = 'hint';
  endpointMeta.textContent = endpoint.method + ' ' + endpoint.path;
  section.appendChild(endpointMeta);

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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
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

  const res = await fetch('/api/admin/kayak/endpoints');
  const data = await res.json();
  if (!res.ok) {
    setTesterMessage(data.error || 'Failed to load endpoint definitions.', true);
    container.textContent = 'Could not load endpoint metadata.';
    return;
  }

  if (!data.hasApiKeyConfigured) {
    setTesterMessage('KAYAK_API_KEY is not configured on the server. Add it to environment variables first.', true);
  }

  (data.endpoints || []).forEach((endpoint) => {
    container.appendChild(renderEndpointCard(endpoint));
  });
}

(async () => {
  try {
    const isAuthed = await checkAdminSession();
    if (!isAuthed) {
      return;
    }
    await loadEndpoints();
  } catch {
    setTesterMessage('Failed to initialize API tester.', true);
  }
})();

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});
