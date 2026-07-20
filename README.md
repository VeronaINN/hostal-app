# Sistema de Gestión — Hostal

Aplicación web full-stack para registro diario de ventas/servicios,
control de turnos y consolidado financiero de un hostal, con dos
vistas completamente separadas: **Empleado** (carga rápida, sin
acceso a totales) y **Gerente** (dashboard, auditoría, histórico,
exportación a Excel y configuración).

La separación de roles está aplicada en el **backend**, no solo en la
interfaz: un empleado no puede obtener los totales del mes ni el
histórico aunque manipule el navegador, porque esas rutas de la API
verifican la sesión y rechazan la petición si el rol no es `manager`.

---

## 1. Arquitectura

```
hostal-app/
├── server.js              # Backend Express: rutas, autenticación, export a Excel
├── db/store.js            # Capa de persistencia (JSON local, atómico)
├── data/db.json           # Se crea automáticamente al primer arranque (tu base de datos)
├── public/
│   ├── index.html         # Login (selector Empleado / Gerente)
│   ├── empleado.html      # Vista operativa del empleado
│   ├── gerente.html       # Vista de gerencia
│   ├── css/styles.css     # Estilos (paleta navy / gris / blanco)
│   └── js/
│       ├── empleado.js
│       └── gerente.js
└── package.json
```

**Ventas con varias habitaciones/servicios:** cada registro es una
"venta" que puede incluir varios `items` (uno por cada
habitación/servicio, con su propia tarifa), pero comparte una sola
`factura`, un solo `comprobante`, una fecha y una hora exacta. Esto
cubre el caso de un huésped que reserva más de una habitación bajo
una misma factura.

**Comprobante condicional:** el campo de N° de comprobante solo se
pide/muestra en el formulario del empleado cuando el método de pago
elegido está marcado por el Gerente como "requiere comprobante"
(pensado para transferencias bancarias). El N° de Factura, en
cambio, siempre está disponible porque aplica a cualquier venta.

**Pago mixto:** cada registro guarda `tarifa` (el precio total de la
venta, suma de todos los ítems) y un arreglo `pagos: [{ metodo,
monto }, ...]`. El backend exige que la suma de los montos coincida
con la tarifa total antes de guardar.

**Tiempo real:** el servidor mantiene abiertas conexiones
Server-Sent Events (`/api/events`, solo para el rol Gerente) y avisa
a todas las pantallas conectadas cada vez que se crea, edita o
elimina un registro — sin necesidad de recargar el navegador ni
instalar nada adicional.

**Base de datos:** se usa un archivo JSON local (`data/db.json`) en
lugar de un motor pesado, para que la instalación en cualquier
computador del hostal sea inmediata (sin compilar dependencias
nativas). Cada registro guarda su fecha completa, así que el
histórico de 2026, 2027, etc. se acumula indefinidamente en el mismo
archivo — no se borra nada al cambiar de año. **Respaldo:** copiar
periódicamente `data/db.json` a un USB, Google Drive o Dropbox es tu
respaldo. Si el negocio crece y necesitas acceso simultáneo desde
varias computadoras en red o en la nube con más robustez, esta capa
puede migrarse a SQLite o PostgreSQL sin rehacer el resto del sistema
(toda la lógica pasa por `db/store.js`).

---

## 2. Instalación local (paso a paso)

### Requisitos previos
1. Instalar **Node.js** (versión 18 o superior): https://nodejs.org
   (descarga la versión "LTS" y sigue el instalador — funciona igual
   en Windows y macOS).
2. Verificar la instalación abriendo una terminal (CMD/PowerShell en
   Windows, Terminal en Mac) y ejecutando:
   ```
   node -v
   npm -v
   ```
   Deben mostrar un número de versión.

### Pasos
1. Copia la carpeta `hostal-app` a tu computador (por ejemplo en
   `Documentos/hostal-app`).
2. Abre una terminal dentro de esa carpeta.
   - Windows: clic derecho dentro de la carpeta → "Abrir en Terminal".
   - Mac: `cd ~/Documents/hostal-app`
3. Instala las dependencias (solo la primera vez):
   ```
   npm install
   ```
4. Inicia la aplicación:
   ```
   npm start
   ```
5. Verás en la terminal:
   ```
   Sistema de gestión del hostal corriendo en:  http://localhost:3000
   Contraseña de Gerente por defecto: admin123
   ```
6. Abre tu navegador en **http://localhost:3000**

Para usar la app **desde varias computadoras en la misma red** (por
ejemplo, recepción y oficina del gerente), instala y ejecuta el
servidor en una sola máquina (la que quede siempre encendida) y desde
las demás abre `http://IP-DE-ESA-MAQUINA:3000` (obtén la IP con
`ipconfig` en Windows o `ifconfig`/`ipconfig getifaddr en0` en Mac).

Para **detener** el servidor: `Ctrl + C` en la terminal.
Para volver a iniciarlo después: repetir solo el paso 4 (`npm start`).

### Credenciales iniciales
- **Empleado de ejemplo:** `David` — PIN `1234`
- **Gerente:** contraseña `admin123`

**Importante:** cambia la contraseña de gerente desde
`Panel de Gerencia → Configuración → Cambiar contraseña` en cuanto
instales el sistema, y crea ahí mismo a tus empleados reales con sus
propios PIN.

---

## 3. Actualizar una instalación que ya tenías corriendo

Si ya habías instalado la versión anterior en tu computador y/o ya la
tenías publicada en Railway, sigue estos pasos para que los cambios
(ítems múltiples por venta, factura/comprobante, hora, CRUD completo
de configuración) queden funcionando:

### En tu computador (local)
1. **Respalda tu archivo de datos por seguridad:** copia
   `data/db.json` a otro lugar (por ejemplo, a tu escritorio). No es
   obligatorio —el sistema migra tus datos automáticamente al nuevo
   formato la primera vez que arranca— pero es una buena costumbre
   antes de cualquier actualización.
2. Descomprime el nuevo `.zip` que te compartí y **reemplaza** todos
   los archivos de tu carpeta `hostal-app` (server.js, la carpeta
   `db/`, la carpeta `public/` completa y el `README.md`) por los
   nuevos. **No borres tu carpeta `data/`** — ahí vive tu información
   real.
3. No hace falta volver a correr `npm install` (no se agregaron
   dependencias nuevas). Simplemente:
   ```
   npm start
   ```
4. Abre `http://localhost:3000` y confirma que en "Configuración"
   del Gerente ya aparecen las tablas de habitaciones, servicios y
   métodos de pago con botones **Editar/Eliminar**, y que el
   formulario del Empleado ahora permite agregar varias
   habitaciones/servicios por venta.

### En Railway (la versión publicada en internet)
1. Ve a tu repositorio en **GitHub** (el que creaste cuando la
   publicaste la primera vez).
2. **Sube los archivos nuevos reemplazando los anteriores:** puedes
   arrastrar de nuevo todos los archivos del `.zip` descomprimido a
   la página del repositorio (GitHub te preguntará si quieres
   reemplazar los que tengan el mismo nombre — di que sí) y confirmar
   con "Commit changes".
   - **No subas la carpeta `data/`** ni el archivo `data/db.json` —
     esa carpeta vive únicamente en el volumen persistente de
     Railway, no en GitHub.
3. Railway detecta el cambio en GitHub y **vuelve a desplegar la app
   automáticamente** en uno o dos minutos (lo verás en la pestaña
   "Deployments" de tu proyecto en Railway, con el estado pasando a
   "Success"). Si tu proyecto no tiene el despliegue automático
   activado, entra a Railway y presiona el botón **"Deploy"** o
   **"Redeploy"** manualmente.
4. **No necesitas tocar nada más:** el Volumen (`/app/data`) y las
   Variables (`SESSION_SECRET`, `NODE_ENV`) que ya configuraste
   siguen igual, y tus ventas ya registradas se migran solas al
   nuevo formato la primera vez que el servidor arranca con el
   código actualizado.
5. Abre tu URL pública (`https://tu-hostal.up.railway.app`) y
   verifica los mismos puntos del paso 4 de "En tu computador"
   arriba de esta sección.

## 4. Uso diario

### Vista Empleado
- Selecciona tu nombre, ingresa tu PIN.
- Cada venta registra **fecha y hora exacta** (ambas editables si
  hace falta corregirlas).
- **Varias habitaciones/servicios en una sola venta:** si un huésped
  pide más de una habitación (o varios servicios), agrega una fila
  por cada uno con el botón "+ Agregar habitación / servicio". La
  tarifa total de la venta se calcula sola sumando cada fila.
- **N° de Factura:** un solo campo por venta (aplica a toda la
  venta, sin importar cuántas habitaciones incluya).
- **N° de Comprobante:** este campo solo aparece cuando el método de
  pago elegido es de tipo transferencia (lo define el Gerente en
  Configuración). Si el cliente paga en efectivo o con tarjeta, el
  campo permanece oculto.
- **Pago mixto:** en la sección "Forma de pago" agregas una fila por
  cada método que usó el cliente (por ejemplo, $10 en efectivo + $5
  con tarjeta). El sistema muestra en vivo si la suma de los pagos ya
  coincide con la tarifa total, y no deja guardar el registro si no
  cuadra. Si el cliente pagó todo con un solo método, simplemente se
  usa la primera fila y no hace falta agregar más.
- Solo ves las ventas que tú mismo cargaste **en el día actual**. No
  hay acceso a totales del mes, histórico de otros días ni
  configuración del sistema.
- Puedes corregir o eliminar una venta tuya mientras siga siendo el
  mismo día (por ejemplo, si te equivocaste al tipear).

### Vista Gerente
- **Tiempo real:** apenas un empleado guarda, edita o elimina un
  registro (desde cualquier dispositivo), el dashboard y el
  histórico del Gerente se actualizan solos, sin recargar la página.
  Cuando la conexión en vivo está activa, arriba a la derecha aparece
  la etiqueta **"● En vivo"**.
- **Dashboard:** recaudación de hoy/semana/mes, corte de caja
  (cuánto debe haber en efectivo físico vs. cuánto entró a
  Pichincha/Produbanco/tarjeta — sumando correctamente los pagos
  mixtos), ocupación por tipo de servicio (noches vs. horas/momento)
  y auditoría de cierres de turno por empleado para conciliar la caja
  del día.
- **Histórico / Reportes:** filtra por rango de fechas, empleado,
  método de pago o habitación, edita o elimina cualquier registro, y
  exporta el resultado filtrado a un archivo `.xlsx` con el botón
  "Exportar a Excel".
- **Configuración:** administra empleados (crear, activar/desactivar,
  cambiar PIN), y ahora también **añade, edita o elimina**
  habitaciones, tipos de servicio y métodos de pago (incluyendo si
  cada método requiere N° de comprobante). Los cambios aquí solo
  afectan las opciones que verán los empleados de ahí en adelante —
  las ventas ya registradas no se modifican.

---

## 5. Publicarla en internet — acceso desde cualquier dispositivo y lugar

Para que empleados y gerente entren desde el celular, una tablet o
cualquier computador (no solo dentro del hostal), el servidor debe
quedar corriendo en internet, no en tu computador local. La ruta más
simple con este proyecto (sin cambiar el motor de base de datos) es
**Railway**, porque permite un "disco persistente" fácil de conectar
a la carpeta `data/` para que los registros no se borren nunca.

### Paso a paso con Railway

1. **Sube el proyecto a GitHub** (necesitas una cuenta gratuita en
   github.com):
   - Crea un repositorio nuevo, por ejemplo `hostal-app`.
   - Sube ahí el contenido de la carpeta `hostal-app` (puedes
     arrastrar los archivos desde la web de GitHub si no usas Git por
     línea de comandos).
2. Entra a **https://railway.app** y crea una cuenta (puedes iniciar
   sesión con tu cuenta de GitHub).
3. Clic en **"New Project" → "Deploy from GitHub repo"** y elige el
   repositorio `hostal-app`. Railway detecta automáticamente que es
   una app de Node.js y usa `npm start` para arrancarla.
4. **Agregar el disco persistente** (para que `data/db.json` no se
   pierda al reiniciar):
   - Dentro del proyecto en Railway, ve a la pestaña **"Volumes"** del
     servicio.
   - Crea un volumen y monta la ruta `/app/data`.
5. En **"Variables"**, agrega:
   - `SESSION_SECRET` con un valor largo y secreto inventado por ti
     (por ejemplo una frase aleatoria).
   - `NODE_ENV` con el valor `production`.
6. Railway te asigna automáticamente una URL pública tipo
   `https://tu-hostal.up.railway.app` (en "Settings" → "Networking" →
   "Generate Domain" si no aparece sola).
7. Comparte esa URL con tus empleados y con el gerente: desde ese
   momento, cualquiera con esa dirección y sus credenciales puede
   entrar desde su celular, tablet o computador, estén donde estén,
   con conexión a internet.

### Alternativas
- **Render.com** funciona de forma muy similar (también soporta
  discos persistentes en sus planes pagos).
- Si el volumen de registros crece mucho con el tiempo, la mejora
  natural es migrar `db/store.js` de un archivo JSON a una base de
  datos administrada (Postgres de Railway/Render, o similar) — la
  estructura del proyecto ya está separada para que ese cambio no
  toque el resto del sistema.

### Importante antes de publicarla
- Cambia la contraseña de gerente (`admin123` por defecto) y el PIN
  del empleado de ejemplo (`David` / `1234`) apenas la app esté en
  línea — cualquiera con la URL puede intentar entrar.
- Con `NODE_ENV=production`, las cookies de sesión solo funcionan
  sobre HTTPS (Railway y Render ya sirven la app con HTTPS
  automáticamente, así que no necesitas hacer nada adicional).

---

## 6. Notas de seguridad

- Las contraseñas y PIN se guardan **hasheados** (bcrypt), nunca en
  texto plano.
- Las rutas de la API que exponen totales, histórico completo o
  configuración están protegidas en el servidor (`requireManager`),
  no solo ocultas en la interfaz.
- Para uso en internet, se recomienda además servir la aplicación
  bajo HTTPS (los proveedores mencionados en la sección 4 lo incluyen
  automáticamente) y cambiar el `secret` de sesión mencionado arriba.
