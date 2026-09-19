/**
 * store.js
 * -----------------------------------------------------------------------
 * Capa de persistencia del sistema. Usa un archivo JSON en disco
 * (data/db.json) como base de datos local. Es intencionalmente simple
 * (sin dependencias nativas que compilar) para que la instalación en
 * cualquier computador del hostal sea trivial: "npm install && npm start".
 *
 * Los datos NUNCA se borran entre años: cada registro guarda su propia
 * fecha completa (YYYY-MM-DD), así que el histórico de 2026, 2027, etc.
 * queda disponible indefinidamente en el mismo archivo. El Gerente puede
 * filtrar por cualquier rango de fechas (incluyendo años anteriores)
 * desde el dashboard.
 *
 * Si el negocio crece y se requiere acceso concurrente desde varias
 * computadoras en red o en la nube, esta capa puede reemplazarse por
 * SQLite/Postgres sin tocar el resto del backend: solo hay que mantener
 * la misma interfaz (getDB, saveDB, nextId, etc.).
 * -----------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

// ---------------------------------------------------------------------
// Estructura por defecto (se crea la primera vez que se ejecuta la app)
// ---------------------------------------------------------------------
function defaultDB() {
  return {
    nextRecordId: 1,
    nextShiftCloseId: 1,
    records: [], // Registro operativo diario (ventas — cada una puede tener varias habitaciones/servicios)
    shiftCloses: [], // Cierres de turno declarados por los empleados (para auditoría del Gerente)
    employees: [
      { name: "David", pinHash: bcrypt.hashSync("1234", 8), active: true },
    ],
    rooms: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    services: [
      "NOCHE",
      "4 HORAS",
      "MOMENTO",
      "MOMENTO + AGUA",
      "MOMENTO + POWERADE",
    ],
    // requiresComprobante: si es true, el formulario del empleado exige/
    // muestra el campo de N° de comprobante cuando se usa este método
    // (pensado para transferencias bancarias).
    paymentMethods: [
      { name: "EFECTIVO", requiresComprobante: false },
      { name: "TRANSFERENCIA PICHINCHA", requiresComprobante: true },
      { name: "TRANSFERENCIA PRODUBANCO", requiresComprobante: true },
      { name: "TARJETA DE CRÉDITO", requiresComprobante: false },
    ],
    managerPasswordHash: bcrypt.hashSync("admin123", 8), // CAMBIAR al primer uso
  };
}

function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB(), null, 2), "utf-8");
  }
}

// Actualiza en memoria estructuras guardadas con una versión anterior del
// sistema (por ejemplo, métodos de pago guardados como texto plano, o
// ventas de una sola habitación/servicio) para que sigan funcionando sin
// que el negocio pierda su histórico al actualizar la aplicación.
function migrateDB(db) {
  let changed = false;

  if (!Array.isArray(db.shiftCloses)) {
    db.shiftCloses = [];
    changed = true;
  }
  if (db.nextShiftCloseId === undefined) {
    db.nextShiftCloseId = 1;
    changed = true;
  }

  if (db.paymentMethods.length && typeof db.paymentMethods[0] === "string") {
    db.paymentMethods = db.paymentMethods.map((name) => ({
      name,
      requiresComprobante: name.toUpperCase().includes("TRANSFERENCIA"),
    }));
    changed = true;
  }

  db.records.forEach((r) => {
    if (!r.items) {
      r.items = [{ habitacion: r.habitacion, descripcion: r.descripcion, tarifa: r.tarifa }];
      delete r.habitacion;
      delete r.descripcion;
      changed = true;
    }
    if (!r.pagos && r.metodoPago) {
      r.pagos = [{ metodo: r.metodoPago, monto: r.tarifa }];
      delete r.metodoPago;
      changed = true;
    }
    if (r.factura === undefined) {
      r.factura = r.comprobante || "";
      r.comprobante = "";
      changed = true;
    }
    if (r.hora === undefined) {
      r.hora = "";
      changed = true;
    }
  });

  return changed;
}

function getDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  const db = JSON.parse(raw);
  if (migrateDB(db)) saveDB(db);
  return db;
}

// Escritura atómica: escribe a un archivo temporal y luego renombra,
// para minimizar el riesgo de corrupción si el proceso se interrumpe
// justo durante el guardado.
function saveDB(db) {
  const tmpPath = DB_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmpPath, DB_PATH);
}

function nextRecordId(db) {
  const id = db.nextRecordId || 1;
  db.nextRecordId = id + 1;
  return id;
}

function nextShiftCloseId(db) {
  const id = db.nextShiftCloseId || 1;
  db.nextShiftCloseId = id + 1;
  return id;
}

module.exports = { getDB, saveDB, nextRecordId, nextShiftCloseId, DB_PATH };
