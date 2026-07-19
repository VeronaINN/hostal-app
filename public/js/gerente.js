/**
 * gerente.js
 * Lógica del panel de Gerencia. Todas las cifras (totales, caja,
 * auditoría) provienen del backend (/api/dashboard) que las calcula
 * sobre el histórico completo — el empleado nunca tiene acceso a
 * este endpoint.
 */

let cajaPeriod = 'hoy';
let dashboardData = null;

async function boot() {
  const sessionRes = await fetch('/api/session');
  const session = await sessionRes.json();
  if (session.role !== 'manager') {
    window.location.href = '/index.html';
    return;
  }
  await loadConfigLists();
  await loadDashboard();
  connectLive();
}

// ---------------------------------------------------------------
// TIEMPO REAL — el servidor avisa (Server-Sent Events) cada vez que
// un empleado crea, edita o elimina un registro, en cualquier
// dispositivo. Aquí simplemente refrescamos lo que esté visible.
// ---------------------------------------------------------------
function connectLive() {
  const es = new EventSource('/api/events');
  const indicator = document.getElementById('liveIndicator');

  es.onopen = () => { indicator.style.display = 'inline-block'; };
  es.onerror = () => { indicator.style.display = 'none'; }; // EventSource reintenta solo

  es.onmessage = () => {
    loadDashboard();
    const histVisible = document.getElementById('viewHist').style.display !== 'none';
    if (histVisible) loadHistory();
  };
}

function switchTab(tab) {
  document.getElementById('tabDash').classList.toggle('active', tab === 'dash');
  document.getElementById('tabHist').classList.toggle('active', tab === 'hist');
  document.getElementById('tabConfig').classList.toggle('active', tab === 'config');
  document.getElementById('viewDash').style.display = tab === 'dash' ? 'block' : 'none';
  document.getElementById('viewHist').style.display = tab === 'hist' ? 'block' : 'none';
  document.getElementById('viewConfig').style.display = tab === 'config' ? 'block' : 'none';
  if (tab === 'hist') loadHistory();
  if (tab === 'config') loadConfigPanel();
}

function showMsg(html) {
  document.getElementById('msgBox').innerHTML = html;
  setTimeout(() => { document.getElementById('msgBox').innerHTML = ''; }, 3500);
}

function money(n) { return '$' + Number(n || 0).toFixed(2); }

// ---------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------
async function loadDashboard() {
  const res = await fetch('/api/dashboard');
  if (!res.ok) return;
  dashboardData = await res.json();

  document.getElementById('mFecha').textContent = dashboardData.fecha;
  document.getElementById('mMesLabel').textContent = dashboardData.fecha.slice(0, 7);
  document.getElementById('mHoy').textContent = money(dashboardData.totales.hoy);
  document.getElementById('mSemana').textContent = money(dashboardData.totales.semana);
  document.getElementById('mMes').textContent = money(dashboardData.totales.mes);

  document.getElementById('oNochesHoy').textContent = dashboardData.ocupacion.hoy.noches;
  document.getElementById('oHorasHoy').textContent = dashboardData.ocupacion.hoy.horas;
  document.getElementById('oOtrosHoy').textContent = dashboardData.ocupacion.hoy.otros;
  document.getElementById('oNochesMes').textContent = dashboardData.ocupacion.mes.noches;
  document.getElementById('oHorasMes').textContent = dashboardData.ocupacion.mes.horas;
  document.getElementById('oOtrosMes').textContent = dashboardData.ocupacion.mes.otros;

  renderCaja();
  renderAudit();
}

function setCajaPeriod(p) {
  cajaPeriod = p;
  document.querySelectorAll('#cajaPeriodTabs button').forEach((b, i) => {
    b.classList.toggle('active', ['hoy', 'semana', 'mes'][i] === p);
  });
  renderCaja();
}

function renderCaja() {
  if (!dashboardData) return;
  const c = dashboardData.caja[cajaPeriod];
  document.getElementById('cEfectivo').textContent = money(c.efectivo);
  document.getElementById('cBancos').textContent = money(c.bancos);
  document.getElementById('cDetalleBody').innerHTML = Object.entries(c.detalle).map(([metodo, monto]) => `
    <tr><td><span class="tag ${metodo === 'EFECTIVO' ? 'cash' : 'bank'}">${metodo}</span></td><td class="money">${money(monto)}</td></tr>
  `).join('');
}

function renderAudit() {
  const rows = dashboardData.auditoria;
  const body = document.getElementById('auditBody');
  const empty = document.getElementById('auditEmpty');
  if (!rows.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  body.innerHTML = rows.map(a => `
    <tr>
      <td>${a.empleado}</td>
      <td>${a.registros}</td>
      <td class="money">${money(a.efectivo)}</td>
      <td class="money">${money(a.bancos)}</td>
      <td class="money">${money(a.total)}</td>
    </tr>
  `).join('');
}

// ---------------------------------------------------------------
// HISTÓRICO / REPORTES
// ---------------------------------------------------------------
async function loadConfigLists() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  document.getElementById('hEmployee').innerHTML =
    '<option value="">Todos</option>' + cfg.employees.map(e => `<option value="${e}">${e}</option>`).join('');
  document.getElementById('hMetodo').innerHTML =
    '<option value="">Todos</option>' + cfg.paymentMethods.map(m => `<option value="${m}">${m}</option>`).join('');
}

function buildFilterQuery() {
  const params = new URLSearchParams();
  const from = document.getElementById('hFrom').value;
  const to = document.getElementById('hTo').value;
  const employee = document.getElementById('hEmployee').value;
  const metodo = document.getElementById('hMetodo').value;
  const habitacion = document.getElementById('hHabitacion').value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (employee) params.set('employee', employee);
  if (metodo) params.set('metodo', metodo);
  if (habitacion) params.set('habitacion', habitacion);
  return params.toString();
}

async function loadHistory() {
  const qs = buildFilterQuery();
  const res = await fetch('/api/records?' + qs);
  const rows = await res.json();
  const body = document.getElementById('hBody');
  const empty = document.getElementById('hEmpty');
  document.getElementById('hCount').textContent = `(${rows.length} registro${rows.length === 1 ? '' : 's'})`;

  if (!rows.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('hTotal').textContent = '$0.00';
    return;
  }
  empty.style.display = 'none';

  let total = 0;
  body.innerHTML = rows.map(r => {
    total += r.tarifa;
    return `<tr>
      <td>${r.id}</td>
      <td>${r.fecha}</td>
      <td>${r.habitacion}</td>
      <td>${r.descripcion}</td>
      <td class="money">${money(r.tarifa)}</td>
      <td>${(r.pagos || []).map(p => `<span class="tag ${p.metodo === 'EFECTIVO' ? 'cash' : 'bank'}">${p.metodo}: ${money(p.monto)}</span>`).join(' ')}</td>
      <td>${r.comprobante || '—'}</td>
      <td>${r.empleado}</td>
      <td>
        <button class="icon-btn danger" onclick="deleteRecord(${r.id})">Eliminar</button>
      </td>
    </tr>`;
  }).join('');
  document.getElementById('hTotal').textContent = money(total);
}

async function deleteRecord(id) {
  if (!confirm('¿Eliminar este registro del histórico? Esta acción no se puede deshacer.')) return;
  await fetch('/api/records/' + id, { method: 'DELETE' });
  await loadHistory();
  await loadDashboard();
}

function exportExcel() {
  const qs = buildFilterQuery();
  window.location.href = '/api/export?' + qs;
}

// ---------------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------------
async function loadConfigPanel() {
  const [empRes, listsRes] = await Promise.all([
    fetch('/api/admin/employees'),
    fetch('/api/admin/lists'),
  ]);
  const employees = await empRes.json();
  const lists = await listsRes.json();

  document.getElementById('empBody').innerHTML = employees.map(e => `
    <tr>
      <td>${e.name}</td>
      <td>${e.active ? '<span class="tag cash">Activo</span>' : '<span class="tag">Inactivo</span>'}</td>
      <td><button class="icon-btn" onclick="toggleEmployee('${e.name}', ${!e.active})">${e.active ? 'Desactivar' : 'Activar'}</button></td>
    </tr>
  `).join('');

  document.getElementById('roomsList').textContent = lists.rooms.join(', ');
  document.getElementById('servicesList').textContent = lists.services.join(', ');
}

async function addEmployee() {
  const name = document.getElementById('newEmpName').value.trim();
  const pin = document.getElementById('newEmpPin').value.trim();
  if (!name || !pin) return showMsg('<div class="error-msg">Nombre y PIN son obligatorios.</div>');
  const res = await fetch('/api/admin/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pin })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);
  document.getElementById('newEmpName').value = '';
  document.getElementById('newEmpPin').value = '';
  showMsg('<div class="ok-msg">Empleado añadido.</div>');
  await loadConfigPanel();
  await loadConfigLists();
}

async function toggleEmployee(name, active) {
  await fetch('/api/admin/employees/' + encodeURIComponent(name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active })
  });
  await loadConfigPanel();
  await loadConfigLists();
}

async function addRoom() {
  const room = document.getElementById('newRoom').value.trim();
  if (!room) return;
  await fetch('/api/admin/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room })
  });
  document.getElementById('newRoom').value = '';
  await loadConfigPanel();
}

async function addService() {
  const service = document.getElementById('newService').value.trim();
  if (!service) return;
  await fetch('/api/admin/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service })
  });
  document.getElementById('newService').value = '';
  await loadConfigPanel();
}

async function changeManagerPassword() {
  const newPassword = document.getElementById('newMgrPass').value;
  const res = await fetch('/api/admin/manager-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);
  document.getElementById('newMgrPass').value = '';
  showMsg('<div class="ok-msg">Contraseña actualizada.</div>');
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/index.html';
}

boot();
