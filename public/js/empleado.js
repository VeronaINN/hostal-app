/**
 * empleado.js
 * Lógica de la vista de Empleado. Esta vista SOLO puede leer/crear/editar
 * ventas de su propio turno (el backend lo garantiza en /api/records/mine).
 * Una venta puede incluir varias habitaciones/servicios (ej. un huésped
 * que reserva más de un cuarto) bajo una sola factura, y puede pagarse
 * con más de un método de pago a la vez. El N° de comprobante aparece
 * junto al método de pago que lo requiere (normalmente, transferencias).
 */

let rooms = [];
let services = [];
let paymentMethodsFull = []; // [{ name, requiresComprobante }]
let itemRowCounter = 0;
let paymentRowCounter = 0;
let myRecords = [];
let editingRecordId = null;

async function boot() {
  const sessionRes = await fetch('/api/session');
  const session = await sessionRes.json();
  if (session.role !== 'employee') {
    window.location.href = '/index.html';
    return;
  }
  document.getElementById('empNameLabel').textContent = session.employeeName;

  const now = new Date();
  const todayLocal = localDateStr(now);
  document.getElementById('fFecha').value = todayLocal;
  document.getElementById('fHora').value = now.toTimeString().slice(0, 5);

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 6);
  document.getElementById('myDateFilter').min = localDateStr(weekAgo);
  document.getElementById('myDateFilter').max = todayLocal;
  document.getElementById('myDateFilter').value = todayLocal;

  await loadConfig();
  await loadMine();
  await loadShiftSummary();
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  rooms = cfg.rooms;
  services = cfg.services;
  paymentMethodsFull = cfg.paymentMethods;

  document.getElementById('itemRows').innerHTML = '';
  itemRowCounter = 0;
  addItemRow();

  document.getElementById('paymentRows').innerHTML = '';
  paymentRowCounter = 0;
  addPaymentRow();
}

function showMsg(html) {
  document.getElementById('msgBox').innerHTML = html;
  setTimeout(() => { document.getElementById('msgBox').innerHTML = ''; }, 4000);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// IMPORTANTE: nunca usar toISOString() para obtener "la fecha de hoy" en
// el navegador — toISOString() siempre convierte a UTC, y en Ecuador
// (UTC-05:00) eso puede adelantar la fecha varias horas antes de
// medianoche. Estas funciones usan los campos LOCALES del navegador.
function localDateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------
// Ítems de la venta (habitación + servicio + tarifa por línea)
// ---------------------------------------------------------------
function addItemRow(habitacion, descripcion, tarifa) {
  itemRowCounter++;
  const rowId = 'item_' + itemRowCounter;
  const isCustom = descripcion !== undefined && !services.includes(descripcion);
  const wrap = document.createElement('div');
  wrap.className = 'form-row';
  wrap.id = rowId;
  wrap.style.marginBottom = '10px';
  wrap.innerHTML = `
    <div class="field" style="max-width:160px;">
      <label>Habitación</label>
      <select class="itemHabitacion">
        ${rooms.map(r => `<option value="${r}" ${r === habitacion ? 'selected' : ''}>Habitación ${r}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="max-width:200px;">
      <label>Descripción / Servicio</label>
      <select class="itemDescripcion" onchange="toggleItemCustomDesc(this)">
        ${services.map(s => `<option value="${s}" ${s === descripcion ? 'selected' : ''}>${s}</option>`).join('')}
        <option value="__OTRO__" ${isCustom ? 'selected' : ''}>OTRO / OBSERVACIÓN...</option>
      </select>
    </div>
    <div class="field itemCustomWrap" style="display:${isCustom ? 'block' : 'none'};max-width:200px;">
      <label>Especificar</label>
      <input type="text" class="itemDescripcionCustom" placeholder="Ej. Reserva especial..." value="${isCustom ? escapeHtml(descripcion) : ''}" />
    </div>
    <div class="field" style="max-width:130px;">
      <label>Tarifa (USD)</label>
      <input type="number" class="itemTarifa" min="0" step="0.01" placeholder="0.00" value="${tarifa !== undefined ? tarifa : ''}" oninput="onItemsChanged()" />
    </div>
    <button class="icon-btn danger" type="button" onclick="removeItemRow('${rowId}')">Quitar</button>
  `;
  document.getElementById('itemRows').appendChild(wrap);
  onItemsChanged();
}

function removeItemRow(rowId) {
  const rows = document.querySelectorAll('#itemRows > div');
  if (rows.length <= 1) return; // siempre debe quedar al menos una línea
  document.getElementById(rowId).remove();
  onItemsChanged();
}

function toggleItemCustomDesc(selectEl) {
  const wrap = selectEl.closest('.form-row').querySelector('.itemCustomWrap');
  wrap.style.display = selectEl.value === '__OTRO__' ? 'block' : 'none';
}

function collectItems() {
  const rows = document.querySelectorAll('#itemRows > div');
  const items = [];
  rows.forEach(row => {
    const habitacion = row.querySelector('.itemHabitacion').value;
    let descripcion = row.querySelector('.itemDescripcion').value;
    if (descripcion === '__OTRO__') {
      descripcion = row.querySelector('.itemDescripcionCustom').value.trim();
    }
    const tarifa = Number(row.querySelector('.itemTarifa').value);
    if (habitacion && descripcion && tarifa > 0) {
      items.push({ habitacion, descripcion, tarifa });
    }
  });
  return items;
}

function itemsTotal() {
  return collectItems().reduce((acc, it) => acc + it.tarifa, 0);
}

function onItemsChanged() {
  document.getElementById('itemsTotalLabel').textContent = '$' + itemsTotal().toFixed(2);
  renderPaymentSummary();
}

// ---------------------------------------------------------------
// Pago mixto: una fila por cada método de pago usado en la venta.
// El campo de N° de comprobante vive DENTRO de cada fila y solo se
// muestra cuando el método seleccionado en esa fila lo requiere
// (ej. transferencias), quedando visualmente junto a ese método.
// ---------------------------------------------------------------
function addPaymentRow(metodo, monto, comprobante) {
  paymentRowCounter++;
  const rowId = 'pago_' + paymentRowCounter;
  const wrap = document.createElement('div');
  wrap.className = 'form-row';
  wrap.id = rowId;
  wrap.style.marginBottom = '10px';
  wrap.innerHTML = `
    <div class="field" style="max-width:230px;">
      <label>Método</label>
      <select class="pagoMetodo" onchange="onPaymentsChanged()">
        ${paymentMethodsFull.map(m => `<option value="${m.name}" ${m.name === metodo ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="max-width:130px;">
      <label>Monto (USD)</label>
      <input type="number" class="pagoMonto" min="0" step="0.01" value="${monto !== undefined ? monto : ''}" oninput="onPaymentsChanged()" />
    </div>
    <div class="field pagoComprobanteWrap" style="display:none;max-width:190px;">
      <label>N° Comprobante</label>
      <input type="text" class="pagoComprobante" placeholder="N° de comprobante" value="${comprobante ? escapeHtml(comprobante) : ''}" />
    </div>
    <button class="icon-btn danger" type="button" onclick="removePaymentRow('${rowId}')">Quitar</button>
  `;
  document.getElementById('paymentRows').appendChild(wrap);
  onPaymentsChanged();
}

function removePaymentRow(rowId) {
  const rows = document.querySelectorAll('#paymentRows > div');
  if (rows.length <= 1) return; // siempre debe quedar al menos una forma de pago
  document.getElementById(rowId).remove();
  onPaymentsChanged();
}

function collectPagos() {
  const rows = document.querySelectorAll('#paymentRows > div');
  const pagos = [];
  rows.forEach(row => {
    const metodo = row.querySelector('.pagoMetodo').value;
    const monto = Number(row.querySelector('.pagoMonto').value);
    if (metodo && monto > 0) pagos.push({ metodo, monto });
  });
  return pagos;
}

// El N° de comprobante sigue siendo un solo dato por venta: se toma el
// primer valor no vacío entre las filas de pago (normalmente solo la
// fila de transferencia tendrá uno escrito).
function collectComprobante() {
  const inputs = Array.from(document.querySelectorAll('.pagoComprobante'));
  const withValue = inputs.find(inp => inp.value.trim());
  return withValue ? withValue.value.trim() : '';
}

function onPaymentsChanged() {
  updateComprobanteVisibility();
  renderPaymentSummary();
}

// Muestra/oculta el campo de comprobante en cada fila de pago según si
// el método elegido EN ESA FILA está marcado por el Gerente como
// "requiere comprobante" (Configuración → Métodos de pago).
function updateComprobanteVisibility() {
  document.querySelectorAll('#paymentRows > div').forEach(row => {
    const metodo = row.querySelector('.pagoMetodo').value;
    const pm = paymentMethodsFull.find(m => m.name === metodo);
    const wrap = row.querySelector('.pagoComprobanteWrap');
    if (wrap) wrap.style.display = (pm && pm.requiresComprobante) ? 'block' : 'none';
  });
}

function renderPaymentSummary() {
  const pagos = collectPagos();
  const sum = pagos.reduce((acc, p) => acc + p.monto, 0);
  const tarifa = itemsTotal();
  const box = document.getElementById('paymentSummary');

  if (!tarifa) {
    box.innerHTML = `Pagado hasta ahora: <b>$${sum.toFixed(2)}</b>`;
    return;
  }
  const diff = tarifa - sum;
  if (Math.abs(diff) < 0.01) {
    box.innerHTML = `<span style="color:var(--success);font-weight:600;">✓ Pagos completos: $${sum.toFixed(2)} — coincide con la tarifa total de $${tarifa.toFixed(2)}</span>`;
  } else if (diff > 0) {
    box.innerHTML = `<span style="color:var(--danger);font-weight:600;">Pagado: $${sum.toFixed(2)} — faltan $${diff.toFixed(2)} para cubrir la tarifa total de $${tarifa.toFixed(2)}</span>`;
  } else {
    box.innerHTML = `<span style="color:var(--danger);font-weight:600;">Pagado: $${sum.toFixed(2)} — excede la tarifa total de $${tarifa.toFixed(2)} por $${Math.abs(diff).toFixed(2)}</span>`;
  }
}

// ---------------------------------------------------------------
// Guardar (crear o editar) / listar
// ---------------------------------------------------------------
function resetFormBlank() {
  document.getElementById('fFactura').value = '';
  document.getElementById('fHora').value = new Date().toTimeString().slice(0, 5);
  document.getElementById('itemRows').innerHTML = '';
  itemRowCounter = 0;
  addItemRow();
  document.getElementById('paymentRows').innerHTML = '';
  paymentRowCounter = 0;
  addPaymentRow();
}

async function submitRecord() {
  const fecha = document.getElementById('fFecha').value;
  const hora = document.getElementById('fHora').value;
  const factura = document.getElementById('fFactura').value;
  const items = collectItems();
  const pagos = collectPagos();
  const comprobante = collectComprobante();

  if (items.length === 0) {
    return showMsg('<div class="error-msg">Agrega al menos una habitación o servicio con su tarifa.</div>');
  }
  if (pagos.length === 0) {
    return showMsg('<div class="error-msg">Indica al menos un método de pago con su monto.</div>');
  }

  const isEdit = !!editingRecordId;
  const url = isEdit ? '/api/records/mine/' + editingRecordId : '/api/records';
  const method = isEdit ? 'PUT' : 'POST';
  const body = isEdit
    ? { items, factura, comprobante, pagos, hora }
    : { fecha, hora, items, factura, comprobante, pagos };

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);

  showMsg(isEdit
    ? '<div class="ok-msg">Venta actualizada correctamente.</div>'
    : '<div class="ok-msg">Venta guardada correctamente.</div>');

  editingRecordId = null;
  document.getElementById('saveBtnLabel').textContent = 'Guardar venta';
  document.getElementById('cancelEditBtn').style.display = 'none';
  resetFormBlank();

  await loadMine();
  await loadShiftSummary();
}

function editMine(id) {
  const r = myRecords.find(x => x.id === id);
  if (!r) return;
  editingRecordId = id;

  document.getElementById('fHora').value = r.hora || '';
  document.getElementById('fFactura').value = r.factura || '';

  document.getElementById('itemRows').innerHTML = '';
  itemRowCounter = 0;
  if (r.items && r.items.length) {
    r.items.forEach(it => addItemRow(it.habitacion, it.descripcion, it.tarifa));
  } else {
    addItemRow();
  }

  document.getElementById('paymentRows').innerHTML = '';
  paymentRowCounter = 0;
  if (r.pagos && r.pagos.length) {
    let comprobanteAssigned = false;
    r.pagos.forEach(p => {
      const pm = paymentMethodsFull.find(m => m.name === p.metodo);
      const useComprobante = (!comprobanteAssigned && pm && pm.requiresComprobante) ? r.comprobante : '';
      if (useComprobante) comprobanteAssigned = true;
      addPaymentRow(p.metodo, p.monto, useComprobante);
    });
  } else {
    addPaymentRow();
  }

  document.getElementById('saveBtnLabel').textContent = 'Guardar cambios';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  showMsg(`<div class="ok-msg">Editando la venta N° ${id}. Modifica lo necesario y presiona "Guardar cambios" (la fecha no se puede cambiar).</div>`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEditMine() {
  editingRecordId = null;
  document.getElementById('saveBtnLabel').textContent = 'Guardar venta';
  document.getElementById('cancelEditBtn').style.display = 'none';
  resetFormBlank();
}

let viewingDate = null; // fecha actualmente mostrada en la tabla "Mis ventas"

async function loadMine(fecha) {
  const url = fecha ? '/api/records/mine?fecha=' + encodeURIComponent(fecha) : '/api/records/mine';
  const res = await fetch(url);
  const data = await res.json();
  myRecords = data.records;
  viewingDate = data.fecha;

  document.getElementById('myDateFilter').value = data.fecha;
  const isToday = data.fecha === data.today;
  document.getElementById('myDateLabel').textContent = isToday ? '(hoy)' : `(${data.fecha})`;
  document.getElementById('readOnlyNotice').style.display = isToday ? 'none' : 'block';

  const body = document.getElementById('myTableBody');
  const empty = document.getElementById('myEmpty');
  const rows = myRecords;

  if (rows.length === 0) {
    body.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('myTotal').textContent = '$0.00';
    return;
  }
  empty.style.display = 'none';

  let total = 0;
  body.innerHTML = rows.map(r => {
    total += r.tarifa;
    const itemsHtml = (r.items || []).map(it =>
      `<div>Hab. ${it.habitacion} — ${it.descripcion} <span class="small-text">($${it.tarifa.toFixed(2)})</span></div>`
    ).join('');
    const pagosHtml = (r.pagos || []).map(p =>
      `<span class="tag ${p.metodo === 'EFECTIVO' ? 'cash' : 'bank'}">${p.metodo}: $${p.monto.toFixed(2)}</span>`
    ).join(' ');
    const actions = isToday
      ? `<button class="icon-btn" onclick="editMine(${r.id})">Editar</button>
         <button class="icon-btn danger" onclick="deleteMine(${r.id})">Eliminar</button>`
      : '<span class="small-text">—</span>';
    return `<tr>
      <td>${r.id}</td>
      <td>${r.hora || '—'}</td>
      <td>${itemsHtml}</td>
      <td class="money">$${r.tarifa.toFixed(2)}</td>
      <td>${pagosHtml}</td>
      <td>${r.factura || '—'}</td>
      <td>${r.comprobante || '—'}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
  document.getElementById('myTotal').textContent = '$' + total.toFixed(2);
}

function goToToday() {
  loadMine(); // sin parámetro = el backend usa el día de hoy
}

// ---------------------------------------------------------------
// MI PIN
// ---------------------------------------------------------------
function togglePinPanel() {
  const panel = document.getElementById('pinPanel');
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (opening) {
    document.getElementById('newPinInput').value = '';
    document.getElementById('confirmPinInput').value = '';
  }
}

async function changeMyPin() {
  const newPin = document.getElementById('newPinInput').value.trim();
  const confirmPin = document.getElementById('confirmPinInput').value.trim();

  if (newPin.length < 4) {
    return showMsg('<div class="error-msg">El PIN debe tener al menos 4 dígitos.</div>');
  }
  if (newPin !== confirmPin) {
    return showMsg('<div class="error-msg">Los dos PIN no coinciden.</div>');
  }

  const res = await fetch('/api/employee/my-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPin })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);

  showMsg('<div class="ok-msg">PIN actualizado. Úsalo la próxima vez que inicies sesión.</div>');
  togglePinPanel();
}

async function deleteMine(id) {
  if (!confirm('¿Eliminar esta venta de tu turno actual?')) return;
  await fetch('/api/records/mine/' + id, { method: 'DELETE' });
  if (editingRecordId === id) cancelEditMine();
  await loadMine();
  await loadShiftSummary();
}

// ---------------------------------------------------------------
// CIERRE DE TURNO
// ---------------------------------------------------------------
async function loadShiftSummary() {
  const res = await fetch('/api/shift-summary/mine');
  const data = await res.json();

  document.getElementById('shiftEfectivo').textContent = '$' + data.breakdown.efectivo.toFixed(2);
  document.getElementById('shiftTransferencia').textContent = '$' + data.breakdown.transferencia.toFixed(2);
  document.getElementById('shiftTarjeta').textContent = '$' + data.breakdown.tarjeta.toFixed(2);
  document.getElementById('shiftTotal').textContent = '$' + data.breakdown.total.toFixed(2);

  const openForm = document.getElementById('shiftOpenForm');
  const closedInfo = document.getElementById('shiftClosedInfo');

  if (data.cierre) {
    openForm.style.display = 'none';
    const c = data.cierre;
    const diffLabel = Math.abs(c.diferencia) < 0.01
      ? '<span style="color:var(--success);font-weight:600;">✓ Cuadra exacto</span>'
      : c.diferencia > 0
        ? `<span style="color:var(--success);font-weight:600;">Sobran $${c.diferencia.toFixed(2)}</span>`
        : `<span style="color:var(--danger);font-weight:600;">Faltan $${Math.abs(c.diferencia).toFixed(2)}</span>`;
    closedInfo.style.display = 'block';
    closedInfo.innerHTML = `
      <div class="ok-msg" style="margin-bottom:12px;">Turno cerrado hoy a las ${c.hora}.</div>
      <div class="grid-2">
        <div class="metric">
          <div class="label">Efectivo contado</div>
          <div class="value small">$${c.efectivoDeclarado.toFixed(2)}</div>
          <div class="sub">Sistema calculó: $${c.efectivoSistema.toFixed(2)}</div>
        </div>
        <div class="metric">
          <div class="label">Diferencia</div>
          <div class="value small">${diffLabel}</div>
        </div>
      </div>
      ${c.notas ? `<div class="small-text" style="margin-top:10px;">Notas: ${escapeHtml(c.notas)}</div>` : ''}
      <button class="btn-secondary" style="margin-top:14px;" onclick="reopenShift(${c.id})">Reabrir cierre (corregir)</button>
    `;
  } else {
    closedInfo.style.display = 'none';
    closedInfo.innerHTML = '';
    openForm.style.display = 'block';
  }
}

async function closeShift() {
  const efectivoDeclarado = document.getElementById('shiftEfectivoDeclarado').value;
  const notas = document.getElementById('shiftNotas').value;

  if (efectivoDeclarado === '') {
    return showMsg('<div class="error-msg">Indica cuánto efectivo contaste en caja.</div>');
  }

  const res = await fetch('/api/shift-close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ efectivoDeclarado, notas })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);

  showMsg('<div class="ok-msg">Turno cerrado correctamente.</div>');
  document.getElementById('shiftEfectivoDeclarado').value = '';
  document.getElementById('shiftNotas').value = '';
  await loadShiftSummary();
}

async function reopenShift(id) {
  if (!confirm('¿Reabrir el cierre de turno para corregirlo?')) return;
  await fetch('/api/shift-close/mine/' + id, { method: 'DELETE' });
  await loadShiftSummary();
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/index.html';
}

boot();
