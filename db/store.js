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
    records: [], // Registro operativo diario (ventas / servicios)
    employees: [
      { name: "David", pinHash: bcrypt.hashSync("1234", 8), active: true },
    ],
    rooms: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    services: [
      "NOCHE",
      "4 HORAS",
      "MOMENTO",
      "MOMENTO + AGUA",
      "MOMENTO + POWERADE",
    ],
    paymentMethods: [
      "EFECTIVO",
      "TRANSFERENCIA PICHINCHA",
      "TRANSFERENCIA PRODUBANCO",
      "TARJETA DE CRÉDITO",
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

function getDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
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

module.exports = { getDB, saveDB, nextRecordId, DB_PATH };
