/**
 * gerente.js
 * Lógica del panel de Gerencia. Todas las cifras (totales, caja,
 * auditoría) provienen del backend (/api/dashboard) que las calcula
 * sobre el histórico completo — el empleado nunca tiene acceso a
 * este endpoint.
 */

let cajaPeriod = 'hoy';
let dashboardData = null;
let historyRecords = [];
let rooms = [];
let services = [];
let paymentMethodsFull = []; // [{ name, requiresComprobante }]
let editItemRowCounter = 0;
let editPaymentRowCounter = 0;

async function boot() {
  const sessionRes = await fetch('/api/session');
  const session = await sessionRes.json();
  if (session.role !== 'manager') {
    window.location.href = '/index.html';
    return;
  }
  await loadConfigLists();
  await loadFullConfig();
  await loadDashboard();
  connectLive();
}

// Configuración completa (no solo nombres) — necesaria para armar los
// selects de habitación/servicio/método de pago del editor de ventas.
async function loadFullConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  rooms = cfg.rooms;
  services = cfg.services;
  paymentMethodsFull = cfg.paymentMethods;
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
    const cierresVisible = document.getElementById('viewCierres').style.display !== 'none';
    if (cierresVisible) loadShiftCloses();
  };
}

function switchTab(tab) {
  document.getElementById('tabDash').classList.toggle('active', tab === 'dash');
  document.getElementById('tabHist').classList.toggle('active', tab === 'hist');
  document.getElementById('tabCierres').classList.toggle('active', tab === 'cierres');
  document.getElementById('tabConfig').classList.toggle('active', tab === 'config');
  document.getElementById('viewDash').style.display = tab === 'dash' ? 'block' : 'none';
  document.getElementById('viewHist').style.display = tab === 'hist' ? 'block' : 'none';
  document.getElementById('viewCierres').style.display = tab === 'cierres' ? 'block' : 'none';
  document.getElementById('viewConfig').style.display = tab === 'config' ? 'block' : 'none';
  if (tab !== 'hist') cancelEdit();
  if (tab === 'hist') loadHistory();
  if (tab === 'cierres') loadShiftCloses();
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
  const cat = dashboardData.categorizado[cajaPeriod];

  document.getElementById('catEfectivo').textContent = money(cat.efectivo);
  document.getElementById('catTransferencia').textContent = money(cat.transferencia);
  document.getElementById('catTarjeta').textContent = money(cat.tarjeta);

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
    '<option value="">Todos</option>' + cfg.paymentMethods.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  document.getElementById('czEmployee').innerHTML =
    '<option value="">Todos</option>' + cfg.employees.map(e => `<option value="${e}">${e}</option>`).join('');
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
  historyRecords = rows;
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
    const itemsHtml = (r.items || []).map(it =>
      `<div>Hab. ${it.habitacion} — ${it.descripcion} <span class="small-text">(${money(it.tarifa)})</span></div>`
    ).join('');
    const pagosHtml = (r.pagos || []).map(p =>
      `<span class="tag ${p.metodo === 'EFECTIVO' ? 'cash' : 'bank'}">${p.metodo}: ${money(p.monto)}</span>`
    ).join(' ');
    return `<tr>
      <td>${r.id}</td>
      <td>${r.fecha}</td>
      <td>${r.hora || '—'}</td>
      <td>${itemsHtml}</td>
      <td class="money">${money(r.tarifa)}</td>
      <td>${pagosHtml}</td>
      <td>${r.factura || '—'}</td>
      <td>${r.comprobante || '—'}</td>
      <td>${r.empleado}</td>
      <td>
        <button class="icon-btn" onclick="openEdit(${r.id})">Editar</button>
        <button class="icon-btn danger" onclick="deleteRecord(${r.id})">Eliminar</button>
      </td>
    </tr>`;
  }).join('');
  document.getElementById('hTotal').textContent = money(total);
}

async function deleteRecord(id) {
  if (!confirm('¿Eliminar este registro del histórico? Esta acción no se puede deshacer.')) return;
  await fetch('/api/records/' + id, { method: 'DELETE' });
  if (String(document.getElementById('editIdLabel').textContent) === String(id)) cancelEdit();
  await loadHistory();
  await loadDashboard();
}

function exportExcel() {
  const qs = buildFilterQuery();
  window.location.href = '/api/export?' + qs;
}

// ---------------------------------------------------------------
// EDITAR VENTA (cualquier venta, de cualquier día — solo Gerente)
// Reutiliza el mismo patrón de filas dinámicas del formulario del
// empleado: varios ítems (habitación+servicio+tarifa) y varios pagos,
// con el N° de comprobante dentro de la fila de pago que lo requiere.
// ---------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function addEditItemRow(habitacion, descripcion, tarifa) {
  editItemRowCounter++;
  const rowId = 'eitem_' + editItemRowCounter;
  const isCustom = descripcion !== undefined && !services.includes(descripcion);
  const wrap = document.createElement('div');
  wrap.className = 'form-row';
  wrap.id = rowId;
  wrap.style.marginBottom = '10px';
  wrap.innerHTML = `
    <div class="field" style="max-width:160px;">
      <label>Habitación</label>
      <select class="eItemHabitacion">
        ${rooms.map(r => `<option value="${r}" ${r === habitacion ? 'selected' : ''}>Habitación ${r}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="max-width:200px;">
      <label>Descripción / Servicio</label>
      <select class="eItemDescripcion" onchange="toggleEditItemCustomDesc(this)">
        ${services.map(s => `<option value="${s}" ${s === descripcion ? 'selected' : ''}>${s}</option>`).join('')}
        <option value="__OTRO__" ${isCustom ? 'selected' : ''}>OTRO / OBSERVACIÓN...</option>
      </select>
    </div>
    <div class="field eItemCustomWrap" style="display:${isCustom ? 'block' : 'none'};max-width:200px;">
      <label>Especificar</label>
      <input type="text" class="eItemDescripcionCustom" value="${isCustom ? escapeHtml(descripcion) : ''}" />
    </div>
    <div class="field" style="max-width:130px;">
      <label>Tarifa (USD)</label>
      <input type="number" class="eItemTarifa" min="0" step="0.01" value="${tarifa !== undefined ? tarifa : ''}" oninput="onEditItemsChanged()" />
    </div>
    <button class="icon-btn danger" type="button" onclick="removeEditItemRow('${rowId}')">Quitar</button>
  `;
  document.getElementById('eItemRows').appendChild(wrap);
  onEditItemsChanged();
}

function removeEditItemRow(rowId) {
  const rows = document.querySelectorAll('#eItemRows > div');
  if (rows.length <= 1) return;
  document.getElementById(rowId).remove();
  onEditItemsChanged();
}

function toggleEditItemCustomDesc(selectEl) {
  const wrap = selectEl.closest('.form-row').querySelector('.eItemCustomWrap');
  wrap.style.display = selectEl.value === '__OTRO__' ? 'block' : 'none';
}

function collectEditItems() {
  const rows = document.querySelectorAll('#eItemRows > div');
  const items = [];
  rows.forEach(row => {
    const habitacion = row.querySelector('.eItemHabitacion').value;
    let descripcion = row.querySelector('.eItemDescripcion').value;
    if (descripcion === '__OTRO__') descripcion = row.querySelector('.eItemDescripcionCustom').value.trim();
    const tarifa = Number(row.querySelector('.eItemTarifa').value);
    if (habitacion && descripcion && tarifa > 0) items.push({ habitacion, descripcion, tarifa });
  });
  return items;
}

function editItemsTotal() {
  return collectEditItems().reduce((acc, it) => acc + it.tarifa, 0);
}

function onEditItemsChanged() {
  document.getElementById('eItemsTotalLabel').textContent = money(editItemsTotal());
  renderEditPaymentSummary();
}

function addEditPaymentRow(metodo, monto, comprobante) {
  editPaymentRowCounter++;
  const rowId = 'epago_' + editPaymentRowCounter;
  const wrap = document.createElement('div');
  wrap.className = 'form-row';
  wrap.id = rowId;
  wrap.style.marginBottom = '10px';
  wrap.innerHTML = `
    <div class="field" style="max-width:230px;">
      <label>Método</label>
      <select class="ePagoMetodo" onchange="onEditPaymentsChanged()">
        ${paymentMethodsFull.map(m => `<option value="${m.name}" ${m.name === metodo ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="max-width:130px;">
      <label>Monto (USD)</label>
      <input type="number" class="ePagoMonto" min="0" step="0.01" value="${monto !== undefined ? monto : ''}" oninput="onEditPaymentsChanged()" />
    </div>
    <div class="field ePagoComprobanteWrap" style="display:none;max-width:190px;">
      <label>N° Comprobante</label>
      <input type="text" class="ePagoComprobante" value="${comprobante ? escapeHtml(comprobante) : ''}" />
    </div>
    <button class="icon-btn danger" type="button" onclick="removeEditPaymentRow('${rowId}')">Quitar</button>
  `;
  document.getElementById('ePaymentRows').appendChild(wrap);
  onEditPaymentsChanged();
}

function removeEditPaymentRow(rowId) {
  const rows = document.querySelectorAll('#ePaymentRows > div');
  if (rows.length <= 1) return;
  document.getElementById(rowId).remove();
  onEditPaymentsChanged();
}

function collectEditPagos() {
  const rows = document.querySelectorAll('#ePaymentRows > div');
  const pagos = [];
  rows.forEach(row => {
    const metodo = row.querySelector('.ePagoMetodo').value;
    const monto = Number(row.querySelector('.ePagoMonto').value);
    if (metodo && monto > 0) pagos.push({ metodo, monto });
  });
  return pagos;
}

function collectEditComprobante() {
  const inputs = Array.from(document.querySelectorAll('.ePagoComprobante'));
  const withValue = inputs.find(inp => inp.value.trim());
  return withValue ? withValue.value.trim() : '';
}

function onEditPaymentsChanged() {
  document.querySelectorAll('#ePaymentRows > div').forEach(row => {
    const metodo = row.querySelector('.ePagoMetodo').value;
    const pm = paymentMethodsFull.find(m => m.name === metodo);
    const wrap = row.querySelector('.ePagoComprobanteWrap');
    if (wrap) wrap.style.display = (pm && pm.requiresComprobante) ? 'block' : 'none';
  });
  renderEditPaymentSummary();
}

function renderEditPaymentSummary() {
  const pagos = collectEditPagos();
  const sum = pagos.reduce((acc, p) => acc + p.monto, 0);
  const tarifa = editItemsTotal();
  const box = document.getElementById('ePaymentSummary');
  if (!tarifa) {
    box.innerHTML = `Pagado hasta ahora: <b>${money(sum)}</b>`;
    return;
  }
  const diff = tarifa - sum;
  if (Math.abs(diff) < 0.01) {
    box.innerHTML = `<span style="color:var(--success);font-weight:600;">✓ Pagos completos: ${money(sum)} — coincide con la tarifa total de ${money(tarifa)}</span>`;
  } else if (diff > 0) {
    box.innerHTML = `<span style="color:var(--danger);font-weight:600;">Pagado: ${money(sum)} — faltan ${money(diff)} para cubrir la tarifa total de ${money(tarifa)}</span>`;
  } else {
    box.innerHTML = `<span style="color:var(--danger);font-weight:600;">Pagado: ${money(sum)} — excede la tarifa total de ${money(tarifa)} por ${money(Math.abs(diff))}</span>`;
  }
}

async function openEdit(id) {
  await loadFullConfig(); // datos frescos de habitaciones/servicios/métodos
  const r = historyRecords.find(x => x.id === id);
  if (!r) return;

  document.getElementById('editIdLabel').textContent = r.id;
  document.getElementById('eFecha').value = r.fecha;
  document.getElementById('eHora').value = r.hora || '';
  document.getElementById('eEmpleado').value = r.empleado || '';
  document.getElementById('eFactura').value = r.factura || '';

  document.getElementById('eItemRows').innerHTML = '';
  editItemRowCounter = 0;
  if (r.items && r.items.length) {
    r.items.forEach(it => addEditItemRow(it.habitacion, it.descripcion, it.tarifa));
  } else {
    addEditItemRow();
  }

  document.getElementById('ePaymentRows').innerHTML = '';
  editPaymentRowCounter = 0;
  if (r.pagos && r.pagos.length) {
    let comprobanteAssigned = false;
    r.pagos.forEach(p => {
      const pm = paymentMethodsFull.find(m => m.name === p.metodo);
      const useComprobante = (!comprobanteAssigned && pm && pm.requiresComprobante) ? r.comprobante : '';
      if (useComprobante) comprobanteAssigned = true;
      addEditPaymentRow(p.metodo, p.monto, useComprobante);
    });
  } else {
    addEditPaymentRow();
  }

  document.getElementById('editCard').style.display = 'block';
  document.getElementById('editCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  document.getElementById('editCard').style.display = 'none';
}

async function saveEdit() {
  const id = document.getElementById('editIdLabel').textContent;
  const fecha = document.getElementById('eFecha').value;
  const hora = document.getElementById('eHora').value;
  const empleado = document.getElementById('eEmpleado').value.trim();
  const factura = document.getElementById('eFactura').value;
  const items = collectEditItems();
  const pagos = collectEditPagos();
  const comprobante = collectEditComprobante();

  if (items.length === 0) return showMsg('<div class="error-msg">Agrega al menos una habitación o servicio con su tarifa.</div>');
  if (pagos.length === 0) return showMsg('<div class="error-msg">Indica al menos un método de pago con su monto.</div>');
  if (!empleado) return showMsg('<div class="error-msg">El campo Empleado (turno) no puede quedar vacío.</div>');

  const res = await fetch('/api/records/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, hora, empleado, factura, comprobante, items, pagos })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);

  showMsg('<div class="ok-msg">Venta actualizada correctamente.</div>');
  cancelEdit();
  await loadHistory();
  await loadDashboard();
}

// ---------------------------------------------------------------
// CIERRES DE TURNO — auditoría de lo que cada empleado declaró al
// cerrar su turno (efectivo contado vs. lo que calculó el sistema).
// ---------------------------------------------------------------
function buildShiftFilterQuery() {
  const params = new URLSearchParams();
  const from = document.getElementById('czFrom').value;
  const to = document.getElementById('czTo').value;
  const employee = document.getElementById('czEmployee').value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (employee) params.set('employee', employee);
  return params.toString();
}

async function loadShiftCloses() {
  const qs = buildShiftFilterQuery();
  const res = await fetch('/api/shift-closes?' + qs);
  const rows = await res.json();
  const body = document.getElementById('czBody');
  const empty = document.getElementById('czEmpty');
  document.getElementById('czCount').textContent = `(${rows.length} cierre${rows.length === 1 ? '' : 's'})`;

  if (!rows.length) {
    body.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  body.innerHTML = rows.map(c => {
    const diffHtml = Math.abs(c.diferencia) < 0.01
      ? '<span class="tag cash">Cuadra</span>'
      : c.diferencia > 0
        ? `<span class="tag cash">+${money(c.diferencia)}</span>`
        : `<span class="tag" style="background:var(--danger-bg);color:var(--danger);">${money(c.diferencia)}</span>`;
    return `<tr>
      <td>${c.id}</td>
      <td>${c.fecha}</td>
      <td>${c.hora}</td>
      <td>${c.empleado}</td>
      <td class="money">${money(c.efectivoSistema)}</td>
      <td class="money">${money(c.transferenciaSistema)}</td>
      <td class="money">${money(c.tarjetaSistema)}</td>
      <td class="money">${money(c.totalSistema)}</td>
      <td class="money">${money(c.efectivoDeclarado)}</td>
      <td>${diffHtml}</td>
      <td>${c.notas ? c.notas : '—'}</td>
      <td><button class="icon-btn danger" onclick="deleteShiftClose(${c.id})">Eliminar</button></td>
    </tr>`;
  }).join('');
}

async function deleteShiftClose(id) {
  if (!confirm('¿Eliminar este cierre de turno del historial? Esta acción no se puede deshacer.')) return;
  await fetch('/api/shift-closes/' + id, { method: 'DELETE' });
  await loadShiftCloses();
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

  document.getElementById('roomsBody').innerHTML = lists.rooms.map(r => `
    <tr>
      <td>${r}</td>
      <td>
        <button class="icon-btn" onclick="editRoom('${escAttr(r)}')">Editar</button>
        <button class="icon-btn danger" onclick="deleteRoom('${escAttr(r)}')">Eliminar</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('servicesBody').innerHTML = lists.services.map(s => `
    <tr>
      <td>${s}</td>
      <td>
        <button class="icon-btn" onclick="editService('${escAttr(s)}')">Editar</button>
        <button class="icon-btn danger" onclick="deleteService('${escAttr(s)}')">Eliminar</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('paymentMethodsBody').innerHTML = lists.paymentMethods.map(m => `
    <tr>
      <td>${m.name}</td>
      <td>
        <button class="icon-btn" onclick="togglePaymentComprobante('${escAttr(m.name)}', ${!m.requiresComprobante})">
          ${m.requiresComprobante ? '<span class="tag bank">Sí</span>' : '<span class="tag">No</span>'}
        </button>
      </td>
      <td>
        <button class="icon-btn" onclick="editPaymentMethod('${escAttr(m.name)}')">Renombrar</button>
        <button class="icon-btn danger" onclick="deletePaymentMethod('${escAttr(m.name)}')">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

// Escapa comillas simples para poder incrustar el valor en un atributo onclick="...('valor')"
function escAttr(s) {
  return String(s).replace(/'/g, "\\'");
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

// ---- Habitaciones ----
async function addRoom() {
  const room = document.getElementById('newRoom').value.trim();
  if (!room) return;
  const res = await fetch('/api/admin/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);
  document.getElementById('newRoom').value = '';
  await loadConfigPanel();
}

async function editRoom(room) {
  const newRoom = prompt('Nuevo número/nombre de habitación:', room);
  if (!newRoom || newRoom.trim() === '') return;
  const res = await fetch('/api/admin/rooms/' + encodeURIComponent(room), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newRoom: newRoom.trim() })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);
  await loadConfigPanel();
}

async function deleteRoom(room) {
  if (!confirm(`¿Eliminar la habitación "${room}" de la lista? Las ventas ya registradas no se modifican.`)) return;
  await fetch('/api/admin/rooms/' + encodeURIComponent(room), { method: 'DELETE' });
  await loadConfigPanel();
}

// ---- Servicios ----
async function addService() {
  const service = document.getElementById('newService').value.trim();
  if (!service) return;
  const res = await fetch('/api/admin/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);
  document.getElementById('newService').value = '';
  await loadConfigPanel();
}

async function editService(service) {
  const newService = prompt('Nuevo nombre del servicio:', service);
  if (!newService || newService.trim() === '') return;
  const res = await fetch('/api/admin/services/' + encodeURIComponent(service), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newService: newService.trim() })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);
  await loadConfigPanel();
}

async function deleteService(service) {
  if (!confirm(`¿Eliminar el servicio "${service}" de la lista? Las ventas ya registradas no se modifican.`)) return;
  await fetch('/api/admin/services/' + encodeURIComponent(service), { method: 'DELETE' });
  await loadConfigPanel();
}

// ---- Métodos de pago ----
async function addPaymentMethod() {
  const name = document.getElementById('newPaymentMethod').value.trim();
  if (!name) return;
  const requiresComprobante = name.toUpperCase().includes('TRANSFERENCIA');
  const res = await fetch('/api/admin/payment-methods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, requiresComprobante })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);
  document.getElementById('newPaymentMethod').value = '';
  await loadConfigPanel();
  await loadConfigLists();
}

async function editPaymentMethod(name) {
  const newName = prompt('Nuevo nombre del método de pago:', name);
  if (!newName || newName.trim() === '') return;
  const res = await fetch('/api/admin/payment-methods/' + encodeURIComponent(name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName: newName.trim() })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);
  await loadConfigPanel();
  await loadConfigLists();
}

async function togglePaymentComprobante(name, requiresComprobante) {
  await fetch('/api/admin/payment-methods/' + encodeURIComponent(name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requiresComprobante })
  });
  await loadConfigPanel();
}

async function deletePaymentMethod(name) {
  if (!confirm(`¿Eliminar el método de pago "${name}"? Las ventas ya registradas no se modifican.`)) return;
  await fetch('/api/admin/payment-methods/' + encodeURIComponent(name), { method: 'DELETE' });
  await loadConfigPanel();
  await loadConfigLists();
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
