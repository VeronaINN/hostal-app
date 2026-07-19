/**
 * empleado.js
 * Lógica de la vista de Empleado. Esta vista SOLO puede leer/crear
 * registros de su propio turno (el backend lo garantiza en /api/records/mine).
 * No hay ninguna llamada aquí a endpoints de dashboard, histórico o
 * configuración financiera: esas rutas ni siquiera están enlazadas desde
 * esta pantalla.
 */

async function boot() {
  const sessionRes = await fetch('/api/session');
  const session = await sessionRes.json();
  if (session.role !== 'employee') {
    window.location.href = '/index.html';
    return;
  }
  document.getElementById('empNameLabel').textContent = session.employeeName;
  document.getElementById('fFecha').value = new Date().toISOString().slice(0, 10);

  await loadConfig();
  await loadMine();
}

let paymentMethods = [];
let paymentRowCounter = 0;

async function loadConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();

  document.getElementById('fHabitacion').innerHTML =
    cfg.rooms.map(r => `<option value="${r}">Habitación ${r}</option>`).join('');

  const descSelect = document.getElementById('fDescripcion');
  descSelect.innerHTML =
    cfg.services.map(s => `<option value="${s}">${s}</option>`).join('') +
    `<option value="__OTRO__">OTRO / OBSERVACIÓN...</option>`;

  paymentMethods = cfg.paymentMethods;
  document.getElementById('paymentRows').innerHTML = '';
  paymentRowCounter = 0;
  addPaymentRow();
}

function toggleCustomDesc() {
  const isOther = document.getElementById('fDescripcion').value === '__OTRO__';
  document.getElementById('customDescWrap').style.display = isOther ? 'block' : 'none';
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
      <select class="pagoMetodo" onchange="renderPaymentSummary()">
        ${paymentMethods.map(m => `<option value="${m}" ${m === metodo ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </div>
    <div class="field" style="max-width:140px;">
      <label>Monto (USD)</label>
      <input type="number" class="pagoMonto" min="0" step="0.01" value="${monto !== undefined ? monto : ''}" oninput="renderPaymentSummary()" />
    </div>
    <button class="icon-btn danger" type="button" onclick="removePaymentRow('${rowId}')">Quitar</button>
  `;
  document.getElementById('paymentRows').appendChild(wrap);
  renderPaymentSummary();
}

function removePaymentRow(rowId) {
  const rows = document.querySelectorAll('#paymentRows > div');
  if (rows.length <= 1) return; // siempre debe quedar al menos una forma de pago
  document.getElementById(rowId).remove();
  renderPaymentSummary();
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

function renderPaymentSummary() {
  const pagos = collectPagos();
  const sum = pagos.reduce((acc, p) => acc + p.monto, 0);
  const tarifa = Number(document.getElementById('fTarifa').value || 0);
  const box = document.getElementById('paymentSummary');

  if (!tarifa) {
    box.innerHTML = `Pagado hasta ahora: <b>$${sum.toFixed(2)}</b>`;
    return;
  }
  const diff = tarifa - sum;
  if (Math.abs(diff) < 0.01) {
    box.innerHTML = `<span style="color:var(--success);font-weight:600;">✓ Pagos completos: $${sum.toFixed(2)} — coincide con la tarifa de $${tarifa.toFixed(2)}</span>`;
  } else if (diff > 0) {
    box.innerHTML = `<span style="color:var(--danger);font-weight:600;">Pagado: $${sum.toFixed(2)} — faltan $${diff.toFixed(2)} para cubrir la tarifa de $${tarifa.toFixed(2)}</span>`;
  } else {
    box.innerHTML = `<span style="color:var(--danger);font-weight:600;">Pagado: $${sum.toFixed(2)} — excede la tarifa de $${tarifa.toFixed(2)} por $${Math.abs(diff).toFixed(2)}</span>`;
  }
}

function showMsg(html) {
  document.getElementById('msgBox').innerHTML = html;
  setTimeout(() => { document.getElementById('msgBox').innerHTML = ''; }, 3500);
}

async function submitRecord() {
  const habitacion = document.getElementById('fHabitacion').value;
  let descripcion = document.getElementById('fDescripcion').value;
  if (descripcion === '__OTRO__') {
    descripcion = document.getElementById('fDescripcionCustom').value.trim();
  }
  const tarifa = document.getElementById('fTarifa').value;
  const comprobante = document.getElementById('fComprobante').value;
  const fecha = document.getElementById('fFecha').value;
  const pagos = collectPagos();

  if (!descripcion || !tarifa) {
    return showMsg('<div class="error-msg">Completa al menos la descripción y la tarifa.</div>');
  }
  if (pagos.length === 0) {
    return showMsg('<div class="error-msg">Indica al menos un método de pago con su monto.</div>');
  }

  const res = await fetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ habitacion, descripcion, tarifa, pagos, comprobante, fecha })
  });
  const data = await res.json();
  if (!res.ok) return showMsg(`<div class="error-msg">${data.error}</div>`);

  showMsg('<div class="ok-msg">Registro guardado correctamente.</div>');
  document.getElementById('fTarifa').value = '';
  document.getElementById('fComprobante').value = '';
  document.getElementById('fDescripcionCustom').value = '';
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
    return `<tr>
      <td>${r.id}</td>
      <td>${r.habitacion}</td>
      <td>${r.descripcion}</td>
      <td class="money">$${r.tarifa.toFixed(2)}</td>
      <td>${(r.pagos || []).map(p => `<span class="tag ${p.metodo === 'EFECTIVO' ? 'cash' : 'bank'}">${p.metodo}: $${p.monto.toFixed(2)}</span>`).join(' ')}</td>
      <td>${r.comprobante || '—'}</td>
      <td><button class="icon-btn danger" onclick="deleteMine(${r.id})">Eliminar</button></td>
    </tr>`;
  }).join('');
  document.getElementById('myTotal').textContent = '$' + total.toFixed(2);
}

async function deleteMine(id) {
  if (!confirm('¿Eliminar este registro de tu turno actual?')) return;
  await fetch('/api/records/mine/' + id, { method: 'DELETE' });
  await loadMine();
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/index.html';
}

boot();
