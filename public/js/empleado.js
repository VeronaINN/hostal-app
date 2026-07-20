/**
 * empleado.js
 * Lógica de la vista de Empleado. Esta vista SOLO puede leer/crear
 * ventas de su propio turno (el backend lo garantiza en /api/records/mine).
 * Una venta puede incluir varias habitaciones/servicios (ej. un huésped
 * que reserva más de un cuarto) bajo una sola factura, y puede pagarse
 * con más de un método de pago a la vez.
 */

let rooms = [];
let services = [];
let paymentMethodsFull = []; // [{ name, requiresComprobante }]
let itemRowCounter = 0;
let paymentRowCounter = 0;

async function boot() {
  const sessionRes = await fetch('/api/session');
  const session = await sessionRes.json();
  if (session.role !== 'employee') {
    window.location.href = '/index.html';
    return;
  }
  document.getElementById('empNameLabel').textContent = session.employeeName;

  const now = new Date();
  document.getElementById('fFecha').value = now.toISOString().slice(0, 10);
  document.getElementById('fHora').value = now.toTimeString().slice(0, 5);

  await loadConfig();
  await loadMine();
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
  setTimeout(() => { document.getElementById('msgBox').innerHTML = ''; }, 3500);
}

// ---------------------------------------------------------------
// Ítems de la venta (habitación + servicio + tarifa por línea)
// ---------------------------------------------------------------
function addItemRow() {
  itemRowCounter++;
  const rowId = 'item_' + itemRowCounter;
  const wrap = document.createElement('div');
  wrap.className = 'form-row';
  wrap.id = rowId;
  wrap.style.marginBottom = '10px';
  wrap.innerHTML = `
    <div class="field" style="max-width:160px;">
      <label>Habitación</label>
      <select class="itemHabitacion">
        ${rooms.map(r => `<option value="${r}">Habitación ${r}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="max-width:200px;">
      <label>Descripción / Servicio</label>
      <select class="itemDescripcion" onchange="toggleItemCustomDesc(this)">
        ${services.map(s => `<option value="${s}">${s}</option>`).join('')}
        <option value="__OTRO__">OTRO / OBSERVACIÓN...</option>
      </select>
    </div>
    <div class="field itemCustomWrap" style="display:none;max-width:200px;">
      <label>Especificar</label>
      <input type="text" class="itemDescripcionCustom" placeholder="Ej. Reserva especial..." />
    </div>
    <div class="field" style="max-width:130px;">
      <label>Tarifa (USD)</label>
      <input type="number" class="itemTarifa" min="0" step="0.01" placeholder="0.00" oninput="onItemsChanged()" />
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
// Pago mixto: una fila por cada método de pago usado en la venta
// ---------------------------------------------------------------
function addPaymentRow(metodo, monto) {
  paymentRowCounter++;
  const rowId = 'pago_' + paymentRowCounter;
  const wrap = document.createElement('div');
  wrap.className = 'form-row';
  wrap.id = rowId;
  wrap.style.marginBottom = '10px';
  wrap.innerHTML = `
    <div class="field" style="max-width:260px;">
      <label>Método</label>
      <select class="pagoMetodo" onchange="onPaymentsChanged()">
        ${paymentMethodsFull.map(m => `<option value="${m.name}" ${m.name === metodo ? 'selected' : ''}>${m.name}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="max-width:140px;">
      <label>Monto (USD)</label>
      <input type="number" class="pagoMonto" min="0" step="0.01" value="${monto !== undefined ? monto : ''}" oninput="onPaymentsChanged()" />
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

function onPaymentsChanged() {
  updateComprobanteVisibility();
  renderPaymentSummary();
}

// El campo de N° de comprobante solo se muestra si alguno de los
// métodos de pago seleccionados es de tipo transferencia (definido
// por el Gerente en Configuración → Métodos de pago).
function updateComprobanteVisibility() {
  const selectedNames = Array.from(document.querySelectorAll('.pagoMetodo')).map(s => s.value);
  const needsComprobante = selectedNames.some(name => {
    const pm = paymentMethodsFull.find(m => m.name === name);
    return pm && pm.requiresComprobante;
  });
  document.getElementById('comprobanteWrap').style.display = needsComprobante ? 'block' : 'none';
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
// Guardar / listar
// ---------------------------------------------------------------
async function submitRecord() {
  const fecha = document.getElementById('fFecha').value;
  const hora = document.getElementById('fHora').value;
  const factura = document.getElementById('fFactura').value;
  const comprobante = document.getElementById('fComprobante').value;
  const items = collectItems();
  const pagos = collectPagos();

  if (items.length === 0) {
    return showMsg('<div class="error-msg">Agrega al menos una habitación o servicio con su tarifa.</div>');
  }
  if (pagos.length === 0) {
    return showMsg('<div class="error-msg">Indica al menos un método de pago con su monto.</div>');
  }

  const res = await fetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, hora, items, factura, comprobante, pagos })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);

  showMsg('<div class="ok-msg">Venta guardada correctamente.</div>');

  document.getElementById('fFactura').value = '';
  document.getElementById('fComprobante').value = '';
  document.getElementById('fHora').value = new Date().toTimeString().slice(0, 5);
  document.getElementById('itemRows').innerHTML = '';
  itemRowCounter = 0;
  addItemRow();
  document.getElementById('paymentRows').innerHTML = '';
  paymentRowCounter = 0;
  addPaymentRow();

  await loadMine();
}

async function loadMine() {
  const res = await fetch('/api/records/mine');
  const rows = await res.json();
  const body = document.getElementById('myTableBody');
  const empty = document.getElementById('myEmpty');

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
    return `<tr>
      <td>${r.id}</td>
      <td>${r.hora || '—'}</td>
      <td>${itemsHtml}</td>
      <td class="money">$${r.tarifa.toFixed(2)}</td>
      <td>${pagosHtml}</td>
      <td>${r.factura || '—'}</td>
      <td>${r.comprobante || '—'}</td>
      <td><button class="icon-btn danger" onclick="deleteMine(${r.id})">Eliminar</button></td>
    </tr>`;
  }).join('');
  document.getElementById('myTotal').textContent = '$' + total.toFixed(2);
}

async function deleteMine(id) {
  if (!confirm('¿Eliminar esta venta de tu turno actual?')) return;
  await fetch('/api/records/mine/' + id, { method: 'DELETE' });
  await loadMine();
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/index.html';
}

boot();
