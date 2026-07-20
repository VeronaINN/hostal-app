/**
 * server.js
 * -----------------------------------------------------------------------
 * Backend del sistema de gestión del hostal.
 *
 * La separación de roles (Empleado / Gerente) NO es solo visual: cada
 * ruta de la API que corresponde a información sensible (totales,
 * histórico, configuración) está protegida en el servidor con
 * middlewares (requireEmployee / requireManager) que verifican la
 * sesión. Un empleado no puede ver los totales del mes aunque manipule
 * el navegador, porque el servidor jamás le entrega esos datos.
 * -----------------------------------------------------------------------
 */

const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const { getDB, saveDB, nextRecordId } = require("./db/store");

const app = express();
const PORT = process.env.PORT || 3000;

// Necesario cuando la app corre detrás del proxy HTTPS de un proveedor
// de hosting (Railway, Render, etc.) para que las cookies de sesión
// funcionen correctamente en producción.
app.set("trust proxy", 1);

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "hostal-secret-key-cambiar-en-produccion",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 12, // 12 horas
      secure: process.env.NODE_ENV === "production", // requiere HTTPS en producción
      sameSite: "lax",
    },
  })
);
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------
// TIEMPO REAL (Server-Sent Events)
// Cada vez que se crea, edita o elimina un registro, se avisa a todas
// las pantallas de Gerente conectadas para que se actualicen solas,
// sin necesidad de refrescar el navegador.
// ---------------------------------------------------------------------
let sseClients = [];

function broadcastUpdate(type, payload) {
  const message = `data: ${JSON.stringify({ type, payload, ts: Date.now() })}\n\n`;
  sseClients.forEach((res) => res.write(message));
}

app.get("/api/events", requireManagerSSE, (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  sseClients.push(res);
  req.on("close", () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

// La sesión de express-session no siempre está lista a tiempo para el
// middleware normal en conexiones EventSource largas, por eso se valida
// igual pero como función nombrada reutilizable definida más abajo junto
// a los otros middlewares.
function requireManagerSSE(req, res, next) {
  if (req.session && req.session.role === "manager") return next();
  return res.status(401).end();
}

// -------------------------------------------------------------------
// Utilidades
// -------------------------------------------------------------------
function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=domingo
  const diff = day === 0 ? 6 : day - 1; // semana inicia lunes
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(dateStr) {
  return dateStr.slice(0, 7) + "-01";
}

function isNocheServicio(desc) {
  return (desc || "").toUpperCase().includes("NOCHE");
}

// Valida los ítems de una venta (una venta puede incluir varias
// habitaciones/servicios, por ejemplo cuando un huésped reserva más de
// un cuarto bajo una sola factura). Retorna un mensaje de error, o null.
function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "Debes agregar al menos una habitación o servicio a la venta";
  }
  for (const it of items) {
    if (!it || !it.habitacion || !it.descripcion) {
      return "Cada línea de la venta debe tener habitación y descripción";
    }
    const tarifa = Number(it.tarifa);
    if (Number.isNaN(tarifa) || tarifa <= 0) {
      return "Cada línea de la venta debe tener una tarifa mayor a 0";
    }
  }
  return null;
}

// Valida un arreglo de pagos mixtos: [{ metodo, monto }, ...]
// La suma de los montos debe coincidir con la tarifa (tolerancia de 1 centavo
// por redondeos). Retorna un mensaje de error, o null si todo está bien.
function validatePagos(pagos, tarifaNum, validMethods) {
  if (!Array.isArray(pagos) || pagos.length === 0) {
    return "Debes indicar al menos un método de pago";
  }
  let sum = 0;
  for (const p of pagos) {
    if (!p || !p.metodo || (validMethods && !validMethods.includes(p.metodo))) {
      return "Método de pago inválido";
    }
    const monto = Number(p.monto);
    if (Number.isNaN(monto) || monto <= 0) {
      return "Cada método de pago debe tener un monto mayor a 0";
    }
    sum += monto;
  }
  if (Math.abs(sum - tarifaNum) > 0.01) {
    return `La suma de los pagos ($${sum.toFixed(2)}) no coincide con la tarifa ($${tarifaNum.toFixed(2)})`;
  }
  return null;
}

// -------------------------------------------------------------------
// Middlewares de autorización
// -------------------------------------------------------------------
function requireEmployee(req, res, next) {
  if (req.session && req.session.role === "employee") return next();
  return res.status(401).json({ error: "No autorizado (empleado)" });
}

function requireManager(req, res, next) {
  if (req.session && req.session.role === "manager") return next();
  return res.status(401).json({ error: "No autorizado (gerente)" });
}

// -------------------------------------------------------------------
// AUTENTICACIÓN
// -------------------------------------------------------------------
app.get("/api/session", (req, res) => {
  res.json({
    role: req.session.role || null,
    employeeName: req.session.employeeName || null,
  });
});

app.post("/api/login/employee", (req, res) => {
  const { name, pin } = req.body;
  const db = getDB();
  const emp = db.employees.find((e) => e.name === name && e.active);
  if (!emp) return res.status(400).json({ error: "Empleado no encontrado" });
  if (!bcrypt.compareSync(String(pin || ""), emp.pinHash)) {
    return res.status(401).json({ error: "PIN incorrecto" });
  }
  req.session.role = "employee";
  req.session.employeeName = emp.name;
  res.json({ ok: true, employeeName: emp.name });
});

app.post("/api/login/manager", (req, res) => {
  const { password } = req.body;
  const db = getDB();
  if (!bcrypt.compareSync(String(password || ""), db.managerPasswordHash)) {
    return res.status(401).json({ error: "Contraseña incorrecta" });
  }
  req.session.role = "manager";
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Endpoint público mínimo: solo nombres de empleados activos, para el
// <select> del login. No expone PINs, registros ni datos financieros.
app.get("/api/config-public-employees", (req, res) => {
  const db = getDB();
  res.json(db.employees.filter((e) => e.active).map((e) => e.name));
});

// -------------------------------------------------------------------
// CONFIGURACIÓN COMPARTIDA (listas para los formularios)
// Disponible para cualquier sesión autenticada (empleado o gerente)
// -------------------------------------------------------------------
app.get("/api/config", (req, res) => {
  if (!req.session.role) return res.status(401).json({ error: "No autorizado" });
  const db = getDB();
  res.json({
    rooms: db.rooms,
    services: db.services,
    paymentMethods: db.paymentMethods,
    employees: db.employees.filter((e) => e.active).map((e) => e.name),
  });
});

// -------------------------------------------------------------------
// VISTA EMPLEADO
// Solo ve y crea registros de SU propio turno (su nombre + fecha de hoy)
// -------------------------------------------------------------------
app.get("/api/records/mine", requireEmployee, (req, res) => {
  const db = getDB();
  const today = todayStr();
  const mine = db.records
    .filter((r) => r.empleado === req.session.employeeName && r.fecha === today)
    .sort((a, b) => b.id - a.id);
  res.json(mine);
});

app.post("/api/records", requireEmployee, (req, res) => {
  const { items, factura, comprobante, pagos, fecha, hora } = req.body;

  const itemsErr = validateItems(items);
  if (itemsErr) return res.status(400).json({ error: itemsErr });

  const tarifaNum = items.reduce((acc, it) => acc + Number(it.tarifa), 0);

  const db = getDB();
  const pagosErr = validatePagos(pagos, tarifaNum, db.paymentMethods.map((m) => m.name));
  if (pagosErr) return res.status(400).json({ error: pagosErr });

  const record = {
    id: nextRecordId(db),
    fecha: fecha || todayStr(), // automática, editable si el empleado la envía
    hora: hora || new Date().toTimeString().slice(0, 5),
    // Una venta puede incluir varias habitaciones/servicios (ej. un
    // huésped que reserva más de un cuarto bajo la misma factura).
    items: items.map((it) => ({
      habitacion: String(it.habitacion),
      descripcion: String(it.descripcion).toUpperCase(),
      tarifa: Number(it.tarifa),
    })),
    tarifa: tarifaNum, // total de la venta (suma de los ítems)
    factura: factura ? String(factura) : "",
    comprobante: comprobante ? String(comprobante) : "",
    // Pago mixto: el cliente pudo pagar con más de un método a la vez.
    pagos: pagos.map((p) => ({ metodo: p.metodo, monto: Number(p.monto) })),
    empleado: req.session.employeeName,
    createdAt: new Date().toISOString(),
  };
  db.records.push(record);
  saveDB(db);
  broadcastUpdate("record-created", record);
  res.status(201).json(record);
});

// Un empleado puede corregir/eliminar SOLO sus propios registros de hoy
// (por ejemplo, si se equivocó al tipear). No puede tocar días anteriores.
app.put("/api/records/mine/:id", requireEmployee, (req, res) => {
  const db = getDB();
  const idx = db.records.findIndex(
    (r) =>
      r.id === Number(req.params.id) &&
      r.empleado === req.session.employeeName &&
      r.fecha === todayStr()
  );
  if (idx === -1) return res.status(404).json({ error: "Registro no encontrado" });

  const { items, factura, comprobante, pagos, hora } = req.body;
  const r = db.records[idx];

  const newItems = items !== undefined ? items : r.items;
  const itemsErr = validateItems(newItems);
  if (itemsErr) return res.status(400).json({ error: itemsErr });
  const newTarifa = newItems.reduce((acc, it) => acc + Number(it.tarifa), 0);

  const newPagos = pagos !== undefined ? pagos : r.pagos;
  const pagosErr = validatePagos(newPagos, newTarifa, db.paymentMethods.map((m) => m.name));
  if (pagosErr) return res.status(400).json({ error: pagosErr });

  r.items = newItems.map((it) => ({
    habitacion: String(it.habitacion),
    descripcion: String(it.descripcion).toUpperCase(),
    tarifa: Number(it.tarifa),
  }));
  r.tarifa = newTarifa;
  r.pagos = newPagos.map((p) => ({ metodo: p.metodo, monto: Number(p.monto) }));
  if (factura !== undefined) r.factura = String(factura);
  if (comprobante !== undefined) r.comprobante = String(comprobante);
  if (hora !== undefined) r.hora = hora;
  saveDB(db);
  broadcastUpdate("record-updated", r);
  res.json(r);
});

app.delete("/api/records/mine/:id", requireEmployee, (req, res) => {
  const db = getDB();
  const idx = db.records.findIndex(
    (r) =>
      r.id === Number(req.params.id) &&
      r.empleado === req.session.employeeName &&
      r.fecha === todayStr()
  );
  if (idx === -1) return res.status(404).json({ error: "Registro no encontrado" });
  const [removed] = db.records.splice(idx, 1);
  saveDB(db);
  broadcastUpdate("record-deleted", { id: removed.id });
  res.json({ ok: true });
});

// -------------------------------------------------------------------
// VISTA GERENTE — Registros con filtros libres (histórico completo)
// -------------------------------------------------------------------
app.get("/api/records", requireManager, (req, res) => {
  const db = getDB();
  const { from, to, employee, metodo, habitacion } = req.query;
  let list = db.records;
  if (from) list = list.filter((r) => r.fecha >= from);
  if (to) list = list.filter((r) => r.fecha <= to);
  if (employee) list = list.filter((r) => r.empleado === employee);
  if (metodo) list = list.filter((r) => (r.pagos || []).some((p) => p.metodo === metodo));
  if (habitacion) list = list.filter((r) => (r.items || []).some((it) => it.habitacion === String(habitacion)));
  list = list.slice().sort((a, b) => b.id - a.id);
  res.json(list);
});

app.put("/api/records/:id", requireManager, (req, res) => {
  const db = getDB();
  const idx = db.records.findIndex((r) => r.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Registro no encontrado" });
  const r = db.records[idx];

  const newItems = req.body.items !== undefined ? req.body.items : r.items;
  const itemsErr = validateItems(newItems);
  if (itemsErr) return res.status(400).json({ error: itemsErr });
  const newTarifa = newItems.reduce((acc, it) => acc + Number(it.tarifa), 0);

  const newPagos = req.body.pagos !== undefined ? req.body.pagos : r.pagos;
  const pagosErr = validatePagos(newPagos, newTarifa, db.paymentMethods.map((m) => m.name));
  if (pagosErr) return res.status(400).json({ error: pagosErr });

  const fields = ["fecha", "hora", "factura", "comprobante", "empleado"];
  for (const f of fields) {
    if (req.body[f] !== undefined) r[f] = req.body[f];
  }
  r.items = newItems.map((it) => ({
    habitacion: String(it.habitacion),
    descripcion: String(it.descripcion).toUpperCase(),
    tarifa: Number(it.tarifa),
  }));
  r.tarifa = newTarifa;
  r.pagos = newPagos.map((p) => ({ metodo: p.metodo, monto: Number(p.monto) }));

  saveDB(db);
  broadcastUpdate("record-updated", r);
  res.json(r);
});

app.delete("/api/records/:id", requireManager, (req, res) => {
  const db = getDB();
  const idx = db.records.findIndex((r) => r.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Registro no encontrado" });
  const [removed] = db.records.splice(idx, 1);
  saveDB(db);
  broadcastUpdate("record-deleted", { id: removed.id });
  res.json({ ok: true });
});

// -------------------------------------------------------------------
// DASHBOARD FINANCIERO (solo Gerente)
// -------------------------------------------------------------------
app.get("/api/dashboard", requireManager, (req, res) => {
  const db = getDB();
  const today = todayStr();
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);

  const sum = (list) => list.reduce((acc, r) => acc + r.tarifa, 0);

  const recordsToday = db.records.filter((r) => r.fecha === today);
  const recordsWeek = db.records.filter((r) => r.fecha >= weekStart && r.fecha <= today);
  const recordsMonth = db.records.filter((r) => r.fecha >= monthStart && r.fecha <= today);

  function cashBreakdown(list) {
    const byMethod = {};
    for (const m of db.paymentMethods) byMethod[m] = 0;
    for (const r of list) {
      for (const p of r.pagos || []) {
        byMethod[p.metodo] = (byMethod[p.metodo] || 0) + p.monto;
      }
    }
    const efectivo = byMethod["EFECTIVO"] || 0;
    const bancos = Object.entries(byMethod)
      .filter(([k]) => k !== "EFECTIVO")
      .reduce((acc, [, v]) => acc + v, 0);
    return { efectivo, bancos, detalle: byMethod };
  }

  function serviceStats(list) {
    let noches = 0;
    let horas = 0; // MOMENTO / 4 HORAS / variantes
    let otros = 0;
    for (const r of list) {
      for (const it of r.items || []) {
        const desc = (it.descripcion || "").toUpperCase();
        if (isNocheServicio(desc)) noches++;
        else if (desc.includes("MOMENTO") || desc.includes("HORA")) horas++;
        else otros++;
      }
    }
    return { noches, horas, otros };
  }

  // Auditoría por empleado (del día actual, para conciliar cierres de caja)
  const auditByEmployee = {};
  for (const r of recordsToday) {
    if (!auditByEmployee[r.empleado]) {
      auditByEmployee[r.empleado] = { empleado: r.empleado, registros: 0, total: 0, efectivo: 0, bancos: 0 };
    }
    const a = auditByEmployee[r.empleado];
    a.registros += 1;
    a.total += r.tarifa;
    for (const p of r.pagos || []) {
      if (p.metodo === "EFECTIVO") a.efectivo += p.monto;
      else a.bancos += p.monto;
    }
  }

  res.json({
    fecha: today,
    totales: {
      hoy: sum(recordsToday),
      semana: sum(recordsWeek),
      mes: sum(recordsMonth),
    },
    caja: {
      hoy: cashBreakdown(recordsToday),
      semana: cashBreakdown(recordsWeek),
      mes: cashBreakdown(recordsMonth),
    },
    ocupacion: {
      hoy: serviceStats(recordsToday),
      mes: serviceStats(recordsMonth),
    },
    auditoria: Object.values(auditByEmployee).sort((a, b) => b.total - a.total),
  });
});

// -------------------------------------------------------------------
// EXPORTAR A EXCEL (solo Gerente) — respeta los mismos filtros que /api/records
// -------------------------------------------------------------------
app.get("/api/export", requireManager, (req, res) => {
  const db = getDB();
  const { from, to, employee, metodo, habitacion } = req.query;
  let list = db.records;
  if (from) list = list.filter((r) => r.fecha >= from);
  if (to) list = list.filter((r) => r.fecha <= to);
  if (employee) list = list.filter((r) => r.empleado === employee);
  if (metodo) list = list.filter((r) => (r.pagos || []).some((p) => p.metodo === metodo));
  if (habitacion) list = list.filter((r) => (r.items || []).some((it) => it.habitacion === String(habitacion)));
  list = list.slice().sort((a, b) => a.id - b.id);

  const rows = [];
  for (const r of list) {
    const formaPago = (r.pagos || []).map((p) => `${p.metodo}: $${p.monto.toFixed(2)}`).join(" + ");
    (r.items || []).forEach((it, i) => {
      rows.push({
        "N° Venta": r.id,
        Fecha: r.fecha,
        Hora: r.hora,
        "N° Habitación": it.habitacion,
        "Descripción / Servicio": it.descripcion,
        "Tarifa Ítem (USD)": it.tarifa,
        "Tarifa Total Venta (USD)": i === 0 ? r.tarifa : "",
        "N° Factura": i === 0 ? r.factura : "",
        "N° Comprobante": i === 0 ? r.comprobante : "",
        "Forma de Pago": i === 0 ? formaPago : "",
        "Cierre de Turno": r.empleado,
      });
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 9 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 22 },
    { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 30 }, { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Reporte");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", `attachment; filename="reporte_hostal_${todayStr()}.xlsx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buffer);
});

// -------------------------------------------------------------------
// ADMINISTRACIÓN (solo Gerente): empleados, habitaciones, servicios, clave
// -------------------------------------------------------------------
app.get("/api/admin/employees", requireManager, (req, res) => {
  const db = getDB();
  res.json(db.employees.map((e) => ({ name: e.name, active: e.active })));
});

app.post("/api/admin/employees", requireManager, (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: "Nombre y PIN requeridos" });
  const db = getDB();
  if (db.employees.some((e) => e.name === name)) {
    return res.status(400).json({ error: "Ya existe un empleado con ese nombre" });
  }
  db.employees.push({ name, pinHash: bcrypt.hashSync(String(pin), 8), active: true });
  saveDB(db);
  res.status(201).json({ ok: true });
});

app.put("/api/admin/employees/:name", requireManager, (req, res) => {
  const db = getDB();
  const emp = db.employees.find((e) => e.name === req.params.name);
  if (!emp) return res.status(404).json({ error: "No encontrado" });
  if (req.body.active !== undefined) emp.active = !!req.body.active;
  if (req.body.pin) emp.pinHash = bcrypt.hashSync(String(req.body.pin), 8);
  saveDB(db);
  res.json({ ok: true });
});

app.get("/api/admin/lists", requireManager, (req, res) => {
  const db = getDB();
  res.json({ rooms: db.rooms, services: db.services, paymentMethods: db.paymentMethods });
});

// ---- Habitaciones ----
app.post("/api/admin/rooms", requireManager, (req, res) => {
  const db = getDB();
  const room = String(req.body.room || "").trim();
  if (!room) return res.status(400).json({ error: "Falta habitación" });
  if (db.rooms.includes(room)) return res.status(400).json({ error: "Esa habitación ya existe" });
  db.rooms.push(room);
  saveDB(db);
  res.json({ ok: true, rooms: db.rooms });
});

app.put("/api/admin/rooms/:room", requireManager, (req, res) => {
  const db = getDB();
  const idx = db.rooms.indexOf(req.params.room);
  if (idx === -1) return res.status(404).json({ error: "Habitación no encontrada" });
  const newRoom = String(req.body.newRoom || "").trim();
  if (!newRoom) return res.status(400).json({ error: "Nombre inválido" });
  db.rooms[idx] = newRoom;
  saveDB(db);
  res.json({ ok: true, rooms: db.rooms });
});

app.delete("/api/admin/rooms/:room", requireManager, (req, res) => {
  const db = getDB();
  db.rooms = db.rooms.filter((r) => r !== req.params.room);
  saveDB(db);
  res.json({ ok: true, rooms: db.rooms });
});

// ---- Servicios ----
app.post("/api/admin/services", requireManager, (req, res) => {
  const db = getDB();
  const service = (req.body.service || "").toUpperCase().trim();
  if (!service) return res.status(400).json({ error: "Falta servicio" });
  if (db.services.includes(service)) return res.status(400).json({ error: "Ese servicio ya existe" });
  db.services.push(service);
  saveDB(db);
  res.json({ ok: true, services: db.services });
});

app.put("/api/admin/services/:service", requireManager, (req, res) => {
  const db = getDB();
  const idx = db.services.indexOf(req.params.service);
  if (idx === -1) return res.status(404).json({ error: "Servicio no encontrado" });
  const newService = (req.body.newService || "").toUpperCase().trim();
  if (!newService) return res.status(400).json({ error: "Nombre inválido" });
  db.services[idx] = newService;
  saveDB(db);
  res.json({ ok: true, services: db.services });
});

app.delete("/api/admin/services/:service", requireManager, (req, res) => {
  const db = getDB();
  db.services = db.services.filter((s) => s !== req.params.service);
  saveDB(db);
  res.json({ ok: true, services: db.services });
});

// ---- Métodos de pago ----
app.post("/api/admin/payment-methods", requireManager, (req, res) => {
  const db = getDB();
  const name = (req.body.name || "").toUpperCase().trim();
  if (!name) return res.status(400).json({ error: "Falta el nombre del método de pago" });
  if (db.paymentMethods.some((m) => m.name === name)) {
    return res.status(400).json({ error: "Ese método de pago ya existe" });
  }
  db.paymentMethods.push({ name, requiresComprobante: !!req.body.requiresComprobante });
  saveDB(db);
  res.json({ ok: true, paymentMethods: db.paymentMethods });
});

app.put("/api/admin/payment-methods/:name", requireManager, (req, res) => {
  const db = getDB();
  const pm = db.paymentMethods.find((m) => m.name === req.params.name);
  if (!pm) return res.status(404).json({ error: "Método de pago no encontrado" });
  if (req.body.newName) pm.name = String(req.body.newName).toUpperCase().trim();
  if (req.body.requiresComprobante !== undefined) pm.requiresComprobante = !!req.body.requiresComprobante;
  saveDB(db);
  res.json({ ok: true, paymentMethods: db.paymentMethods });
});

app.delete("/api/admin/payment-methods/:name", requireManager, (req, res) => {
  const db = getDB();
  db.paymentMethods = db.paymentMethods.filter((m) => m.name !== req.params.name);
  saveDB(db);
  res.json({ ok: true, paymentMethods: db.paymentMethods });
});

app.post("/api/admin/manager-password", requireManager, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 4 caracteres" });
  }
  const db = getDB();
  db.managerPasswordHash = bcrypt.hashSync(newPassword, 8);
  saveDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\nSistema de gestión del hostal corriendo en:  http://localhost:${PORT}`);
  console.log(`Contraseña de Gerente por defecto: admin123 (cámbiala en el panel de Configuración)\n`);
});
