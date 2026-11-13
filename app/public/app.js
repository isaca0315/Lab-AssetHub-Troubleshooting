'use strict';

const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file');
const dropzone = document.getElementById('dropzone');
const fileName = document.getElementById('file-name');
const submit = document.getElementById('submit');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');
const feedback = document.getElementById('feedback');
const filesBody = document.getElementById('files');
const empty = document.getElementById('empty');
const refresh = document.getElementById('refresh');
const serviceDot = document.getElementById('service-dot');
const serviceLabel = document.getElementById('service-label');

const MAX_SIZE = 512 * 1024 * 1024;

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
}

function setFeedback(message, kind) {
  feedback.textContent = message;
  feedback.className = `feedback ${kind}`;
  feedback.hidden = false;
}

function clearFeedback() {
  feedback.hidden = true;
  feedback.textContent = '';
}

function setBusy(busy) {
  submit.disabled = busy || fileInput.files.length === 0;
  submit.textContent = busy ? 'Subiendo…' : 'Subir';
}

async function checkService() {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      serviceDot.className = 'dot ok';
      serviceLabel.textContent = 'Operativo';
      serviceLabel.title = `Almacenamiento: ${data.s3_endpoint || 'sin configurar'}`;
    } else {
      serviceDot.className = 'dot bad';
      serviceLabel.textContent = 'Base de datos no disponible';
    }
  } catch {
    serviceDot.className = 'dot bad';
    serviceLabel.textContent = 'Sin conexión';
  }
}

function renderFiles(rows) {
  filesBody.textContent = '';
  empty.className = 'empty';
  if (!rows.length) {
    empty.textContent = 'Todavía no hay archivos.';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  for (const row of rows) {
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = row.original_name;
    const key = document.createElement('span');
    key.className = 'file-key';
    key.textContent = row.s3_key;
    nameCell.append(name, key);

    const sizeCell = document.createElement('td');
    sizeCell.textContent = formatBytes(Number(row.size_bytes));

    const dateCell = document.createElement('td');
    dateCell.className = 'muted';
    dateCell.textContent = formatDate(row.uploaded_at);

    tr.append(nameCell, sizeCell, dateCell);
    filesBody.append(tr);
  }
}

async function loadFiles() {
  try {
    const res = await fetch('/files', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderFiles(Array.isArray(data) ? data : []);
  } catch (err) {
    filesBody.textContent = '';
    empty.className = 'empty bad';
    empty.textContent = `No se pudo cargar la lista: ${err.message}`;
    empty.hidden = false;
  }
}

function updateFileLabel() {
  const file = fileInput.files[0];
  if (!file) {
    fileName.textContent = 'Tamaño máximo 512 MB';
  } else {
    fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
  }
  setBusy(false);
}

fileInput.addEventListener('change', updateFileLabel);

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
  if (event.dataTransfer.files.length) {
    fileInput.files = event.dataTransfer.files;
    updateFileLabel();
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > MAX_SIZE) {
    setFeedback('El archivo supera el límite de 512 MB.', 'bad');
    return;
  }

  clearFeedback();
  setBusy(true);
  progress.hidden = false;
  progressBar.style.width = '0%';

  const body = new FormData();
  body.append('file', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload');

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      progressBar.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
    }
  });

  xhr.addEventListener('load', () => {
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch { /* respuesta no JSON */ }

    progress.hidden = true;
    setBusy(false);

    if (xhr.status >= 200 && xhr.status < 300) {
      setFeedback(`Archivo subido: ${data.original_name || file.name}`, 'ok');
      form.reset();
      updateFileLabel();
      loadFiles();
      return;
    }

    const stage = data.stage ? ` (etapa: ${data.stage})` : '';
    setFeedback(`No se pudo subir el archivo${stage}: ${data.error || `HTTP ${xhr.status}`}`, 'bad');
  });

  xhr.addEventListener('error', () => {
    progress.hidden = true;
    setBusy(false);
    setFeedback('No se pudo contactar al servidor.', 'bad');
  });

  xhr.send(body);
});

refresh.addEventListener('click', () => {
  loadFiles();
  checkService();
});

checkService();
loadFiles();
