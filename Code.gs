// ═══════════════════════════════════════════════
//  PádelCaja — Google Apps Script Backend
//  Factory Padel Córdoba
// ═══════════════════════════════════════════════

// 1) Creá una Google Sheet nueva, pegá su ID acá abajo (lo sacás de la URL).
const SHEET_ID = '13ZfyyDCYuaHWXqSekfls0ZtE6XC_F005ejHVPBY927s';

function getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function respond(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// La deployment está en modo "Cualquier usuario" (Anyone) porque en modo
// "Solo yo" Google bloquea las llamadas fetch() aunque estés logueado.
// Para compensar, toda acción que toque datos exige este PIN, guardado
// como Script Property (Configuración del proyecto > Propiedades del script).
function checkPin(pin) {
  const required = PropertiesService.getScriptProperties().getProperty('APP_PIN');
  if (!required) return true; // si todavía no configuraste un PIN, no se exige
  return String(pin || '').trim() === String(required).trim();
}

function doGet(e) {
  const action = e.parameter.action;
  let result;
  try {
    if (action === 'ping')          result = { ok: true };
    else if (action === 'checkPin') result = { ok: checkPin(e.parameter.pin) };
    else if (!checkPin(e.parameter.pin)) result = { error: 'PIN incorrecto' };
    else if (action === 'getAll')   result = getAll();
    else result = { error: 'Acción no reconocida' };
  } catch (err) {
    result = { error: err.message };
  }
  return respond(result);
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { body = {}; }
  const action = body.action;

  if (!checkPin(body.pin)) {
    return respond({ error: 'PIN incorrecto' });
  }

  // No toca la planilla ni necesita el lock: se resuelve aparte.
  if (action === 'parseComprobante') {
    let result;
    try { result = parseComprobante(body.base64, body.mimeType); }
    catch (err) { result = { error: err.message }; }
    return respond(result);
  }

  let result;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    if      (action === 'saveMovimiento')       result = saveMovimiento(body.data);
    else if (action === 'deleteMovimiento')     result = deleteMovimiento(body.id);
    else if (action === 'saveCategoria')        result = saveCategoria(body.data);
    else if (action === 'deleteCategoria')      result = deleteCategoria(body.id);
    else if (action === 'saveCierre')           result = saveCierre(body.data);
    else if (action === 'bulkSaveMovimientos')  result = bulkSaveMovimientos(body.data);
    else if (action === 'bulkDeleteByFecha')    result = bulkDeleteByFecha(body.fechaPrefix);
    else if (action === 'repairDates')          result = repairDates();
    else if (action === 'migrateAddCuenta')     result = migrateAddCuenta();
    else if (action === 'bulkSaveFudoVentas')   result = bulkSaveFudoVentas(body.data);
    else if (action === 'bulkDeleteFudoByRange') result = bulkDeleteFudoByRange(body.desde, body.hasta);
    else if (action === 'bulkSaveCategorias')    result = bulkSaveCategorias(body.data);
    else if (action === 'bulkUpdateMovCategoria') result = bulkUpdateMovCategoria(body.data);
    else if (action === 'bulkFixFecha')          result = bulkFixFecha(body.cuenta, body.fechaVieja, body.fechaNueva);
    else if (action === 'migrateAddVistaCategorias') result = migrateAddVistaCategorias();
    else result = { error: 'Acción no reconocida' };
  } catch (err) {
    result = { error: err.message };
  } finally {
    lock.releaseLock();
  }
  return respond(result);
}

// ── LECTURA DE COMPROBANTES (OCR con Gemini) ──
// Requiere una Script Property llamada GEMINI_API_KEY
// (Configuración del proyecto > Propiedades del script en el editor de Apps Script).
function parseComprobante(base64, mimeType) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return { error: 'Falta configurar GEMINI_API_KEY en las Propiedades del script (ver README).' };
  }
  if (!base64) return { error: 'No llegó ninguna imagen' };

  const prompt = 'Analizá esta foto de un comprobante de pago (transferencia, factura, ticket) ' +
    'de un negocio en Argentina. Devolvé SOLO un JSON, sin texto adicional, con estos campos:\n' +
    '{"monto": numero (sin puntos de miles, punto decimal si corresponde, sin simbolo de moneda), ' +
    '"fecha": "YYYY-MM-DD" (si no hay fecha visible, null), ' +
    '"proveedor": "nombre del comercio o destinatario del pago", ' +
    '"concepto": "breve descripcion del gasto"}. ' +
    'Si no podés leer un dato con confianza, poné null en ese campo.';

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } }
      ]
    }],
    generationConfig: { responseMimeType: 'application/json' }
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText());
  if (code !== 200) {
    return { error: (body.error && body.error.message) || ('Error de Gemini (HTTP ' + code + ')') };
  }
  try {
    const text = body.candidates[0].content.parts[0].text;
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return { error: 'No se pudo interpretar la respuesta de Gemini' };
  }
}

// ── GET ALL ───────────────────────────────────
function getAll() {
  ensureSeed();
  return {
    movimientos: sheetToObjects('movimientos'),
    categorias:  sheetToObjects('categorias'),
    cierres:     sheetToObjects('cierres'),
    fudoVentas:  sheetToObjects('fudo_ventas'),
  };
}

// Si la hoja de categorías está vacía, la llena con categorías típicas
// de un complejo de pádel. El usuario puede editarlas/borrarlas después.
function ensureSeed() {
  const sheet = getOrCreateSheet('categorias', ['id', 'nombre', 'tipo', 'color', 'orden']);
  const rows = sheet.getDataRange().getValues();
  if (rows.length > 1) return; // ya tiene datos

  const defaults = [
    // ingresos
    ['Alquiler de Cancha', 'ingreso', '#2563EB'],
    ['Clases',             'ingreso', '#0D9488'],
    ['Torneos / Eventos',  'ingreso', '#7C3AED'],
    ['Kiosco / Bar',       'ingreso', '#D97706'],
    ['Alquiler de Paletas','ingreso', '#0891B2'],
    ['Otros Ingresos',     'ingreso', '#65A30D'],
    // egresos
    ['Sueldos',                        'egreso', '#DC2626'],
    ['Mantenimiento de Canchas',       'egreso', '#EA580C'],
    ['Servicios (Luz/Agua/Gas/Internet)', 'egreso', '#B45309'],
    ['Insumos Kiosco',                 'egreso', '#BE185D'],
    ['Marketing',                      'egreso', '#9333EA'],
    ['Impuestos',                      'egreso', '#991B1B'],
    ['Alquiler / Expensas',            'egreso', '#4B5563'],
    ['Otros Egresos',                  'egreso', '#57534E'],
  ];

  defaults.forEach((d, i) => {
    sheet.appendRow([Utilities.getUuid(), d[0], d[1], d[2], i + 1]);
  });
}

// ── MOVIMIENTOS ───────────────────────────────
const MOV_HEADERS = ['id','fecha','tipo','categoria','cancha','medioPago','monto','nota','cuenta','ts'];

function saveMovimiento(data) {
  const sheet = getOrCreateSheet('movimientos', MOV_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][headers.indexOf('id')] === data.id) {
      updateRow(sheet, i + 1, headers, data);
      return { ok: true, action: 'updated' };
    }
  }
  if (!data.id) data.id = Utilities.getUuid();
  if (!data.ts) data.ts = new Date().toISOString();
  if (!data.cuenta) data.cuenta = 'AJ';
  appendRow(sheet, headers, data);
  return { ok: true, action: 'created', id: data.id };
}

function deleteMovimiento(id) {
  deleteRowByField('movimientos', 'id', id);
  return { ok: true };
}

// Inserta muchos movimientos en una sola escritura (mucho más rápido
// y confiable que llamar saveMovimiento cientos de veces).
function bulkSaveMovimientos(dataArray) {
  if (!dataArray || !dataArray.length) return { ok: true, count: 0 };
  const sheet = getOrCreateSheet('movimientos', MOV_HEADERS);
  const fechaIdx = MOV_HEADERS.indexOf('fecha');
  const startRow = sheet.getLastRow() + 1;
  const newRows = dataArray.map(data => {
    if (!data.id) data.id = Utilities.getUuid();
    if (!data.ts) data.ts = new Date().toISOString();
    if (!data.cuenta) data.cuenta = 'AJ';
    return MOV_HEADERS.map(h => data[h] !== undefined ? data[h] : '');
  });
  // Forzar texto plano en la columna fecha ANTES de escribir, si no
  // Google Sheets la auto-convierte a un objeto Date.
  sheet.getRange(startRow, fechaIdx + 1, newRows.length, 1).setNumberFormat('@');
  sheet.getRange(startRow, 1, newRows.length, MOV_HEADERS.length).setValues(newRows);
  return { ok: true, count: newRows.length };
}

// Borra todos los movimientos cuya fecha empiece con el prefijo dado
// (ej. '2026-05' borra todo mayo). Reescribe la hoja filtrada en una sola
// operación en vez de borrar fila por fila (eso es mucho más lento porque
// cada deleteRow corre todo lo de abajo hacia arriba).
function bulkDeleteByFecha(fechaPrefix) {
  const sheet = getSheet('movimientos');
  if (!sheet || !fechaPrefix) return { ok: true, deleted: 0 };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const fechaIdx = headers.indexOf('fecha');
  const keep = [headers];
  let deleted = 0;
  for (let i = 1; i < data.length; i++) {
    if (fechaToText(data[i][fechaIdx]).indexOf(fechaPrefix) === 0) deleted++;
    else keep.push(data[i]);
  }
  sheet.clearContents();
  if (keep.length) {
    sheet.getRange(1, 1, keep.length, headers.length).setValues(keep);
    if (keep.length > 1) {
      sheet.getRange(2, fechaIdx + 1, keep.length - 1, 1).setNumberFormat('@');
    }
  }
  return { ok: true, deleted };
}

// Convierte fechas que Sheets haya auto-convertido a objeto Date de
// vuelta a texto plano 'YYYY-MM-DD', tanto en movimientos como en cierres,
// y deja la columna formateada como texto para que no vuelva a pasar.
function repairDates() {
  const fixed = {
    movimientos: repairDateColumn('movimientos', MOV_HEADERS.indexOf('fecha')),
    cierres: repairDateColumn('cierres', CIERRE_HEADERS.indexOf('fecha')),
  };
  return { ok: true, fixed };
}

function repairDateColumn(sheetName, colIdx) {
  const sheet = getSheet(sheetName);
  if (!sheet || colIdx < 0) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const range = sheet.getRange(2, colIdx + 1, lastRow - 1, 1);
  const values = range.getValues();
  let fixed = 0;
  const newValues = values.map(r => {
    const v = r[0];
    if (Object.prototype.toString.call(v) === '[object Date]') {
      fixed++;
      return [fechaToText(v)];
    }
    return [v];
  });
  range.setNumberFormat('@');
  range.setValues(newValues);
  return fixed;
}

// Migración única: le agrega la columna 'cuenta' a movimientos que no la
// tengan todavía. A las filas cuya nota diga "(cta hermano)" les pone
// cuenta='Tomas' y limpia esa marca de la nota; al resto les pone 'AJ'.
function migrateAddCuenta() {
  const sheet = getSheet('movimientos');
  if (!sheet) return { ok: true, migrated: 0 };
  const data = sheet.getDataRange().getValues();
  if (data.length < 1) return { ok: true, migrated: 0 };
  const headers = data[0];
  if (headers.indexOf('cuenta') !== -1) return { ok: true, migrated: 0, already: true };

  const notaIdx = headers.indexOf('nota');
  const insertAt = notaIdx + 1;
  const newHeaders = headers.slice();
  newHeaders.splice(insertAt, 0, 'cuenta');

  const newRows = data.slice(1).map(row => {
    const notaVal = String(row[notaIdx] || '');
    const isHermano = notaVal.indexOf('(cta hermano)') !== -1;
    const cuenta = isHermano ? 'Tomas' : 'AJ';
    const cleanNota = notaVal.replace(/\s*\(cta hermano\)/g, '').trim();
    const newRow = row.slice();
    newRow[notaIdx] = cleanNota;
    newRow.splice(insertAt, 0, cuenta);
    return newRow;
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  if (newRows.length) {
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
    const fechaIdx = newHeaders.indexOf('fecha');
    sheet.getRange(2, fechaIdx + 1, newRows.length, 1).setNumberFormat('@');
  }
  return { ok: true, migrated: newRows.length };
}

function fechaToText(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'GMT-3', 'yyyy-MM-dd');
  }
  return String(v);
}

// ── VENTAS FUDO (solo referencia, no afecta movimientos) ──
const FUDO_HEADERS = ['fecha','categoria','subcategoria','producto','cantidad','monto'];

// Inserta muchas filas de ventas de Fudo en una sola escritura.
function bulkSaveFudoVentas(dataArray) {
  if (!dataArray || !dataArray.length) return { ok: true, count: 0 };
  const sheet = getOrCreateSheet('fudo_ventas', FUDO_HEADERS);
  const fechaIdx = FUDO_HEADERS.indexOf('fecha');
  const startRow = sheet.getLastRow() + 1;
  const newRows = dataArray.map(data => FUDO_HEADERS.map(h => data[h] !== undefined ? data[h] : ''));
  sheet.getRange(startRow, fechaIdx + 1, newRows.length, 1).setNumberFormat('@');
  sheet.getRange(startRow, 1, newRows.length, FUDO_HEADERS.length).setValues(newRows);
  return { ok: true, count: newRows.length };
}

// Borra las ventas de Fudo entre dos fechas (YYYY-MM-DD, inclusive), para
// poder re-importar un período sin duplicar si se vuelve a cargar el mismo reporte.
function bulkDeleteFudoByRange(desde, hasta) {
  const sheet = getSheet('fudo_ventas');
  if (!sheet || !desde || !hasta) return { ok: true, deleted: 0 };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const fechaIdx = headers.indexOf('fecha');
  const keep = [headers];
  let deleted = 0;
  for (let i = 1; i < data.length; i++) {
    const f = fechaToText(data[i][fechaIdx]);
    if (f >= desde && f <= hasta) deleted++;
    else keep.push(data[i]);
  }
  sheet.clearContents();
  if (keep.length) {
    sheet.getRange(1, 1, keep.length, headers.length).setValues(keep);
    if (keep.length > 1) {
      sheet.getRange(2, fechaIdx + 1, keep.length - 1, 1).setNumberFormat('@');
    }
  }
  return { ok: true, deleted };
}

// ── CATEGORIAS ────────────────────────────────
const CAT_HEADERS = ['id','nombre','tipo','color','orden','vista'];

function saveCategoria(data) {
  const sheet = getOrCreateSheet('categorias', CAT_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][headers.indexOf('id')] === data.id) {
      updateRow(sheet, i + 1, headers, data);
      return { ok: true, action: 'updated' };
    }
  }
  if (!data.id) data.id = Utilities.getUuid();
  appendRow(sheet, headers, data);
  return { ok: true, action: 'created', id: data.id };
}

function deleteCategoria(id) {
  deleteRowByField('categorias', 'id', id);
  return { ok: true };
}

// Crea muchas categorias de una sola vez (por ej. al subdividir una
// categoria vieja en varias mas especificas).
function bulkSaveCategorias(dataArray) {
  if (!dataArray || !dataArray.length) return { ok: true, count: 0 };
  const sheet = getOrCreateSheet('categorias', CAT_HEADERS);
  const rows = dataArray.map(d => {
    if (!d.id) d.id = Utilities.getUuid();
    return CAT_HEADERS.map(h => d[h] !== undefined ? d[h] : '');
  });
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, CAT_HEADERS.length).setValues(rows);
  return { ok: true, count: rows.length, ids: dataArray.map(d => d.id) };
}

// Recategoriza muchos movimientos existentes de una sola vez, por id
// (por ej. al subdividir una categoria vieja en varias mas especificas).
// updates: [{id, categoria, nota (opcional, para corregir la nota tambien)}]
function bulkUpdateMovCategoria(updates) {
  if (!updates || !updates.length) return { ok: true, updated: 0 };
  const sheet = getSheet('movimientos');
  if (!sheet) return { ok: true, updated: 0 };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('id');
  const catIdx = headers.indexOf('categoria');
  const notaIdx = headers.indexOf('nota');
  const fechaIdx = headers.indexOf('fecha');
  const byId = {};
  updates.forEach(u => { byId[u.id] = u; });
  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const u = byId[data[i][idIdx]];
    if (u) {
      data[i][catIdx] = u.categoria;
      if (u.nota !== undefined) data[i][notaIdx] = u.nota;
      updated++;
    }
  }
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  sheet.getRange(2, fechaIdx + 1, data.length - 1, 1).setNumberFormat('@');
  return { ok: true, updated };
}

// Cambia la fecha de todos los movimientos de una cuenta que tengan una
// fecha vieja dada, a una fecha nueva (ej. corregir un error de carga sin
// tener que traer/reenviar todo el dataset). Todo se hace en el servidor.
function bulkFixFecha(cuenta, fechaVieja, fechaNueva) {
  const sheet = getSheet('movimientos');
  if (!sheet || !fechaVieja || !fechaNueva) return { ok: true, updated: 0 };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const fechaIdx = headers.indexOf('fecha');
  const cuentaIdx = headers.indexOf('cuenta');
  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const f = fechaToText(data[i][fechaIdx]);
    if (f === fechaVieja && (!cuenta || data[i][cuentaIdx] === cuenta)) {
      data[i][fechaIdx] = fechaNueva;
      updated++;
    }
  }
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  sheet.getRange(2, fechaIdx + 1, data.length - 1, 1).setNumberFormat('@');
  return { ok: true, updated };
}

// Migración única: le agrega la columna 'vista' a categorías que no la
// tengan todavía. Las categorías cuyo nombre termina en "(Familia)" se
// marcan vista='familia'; el resto vista='factory'.
function migrateAddVistaCategorias() {
  const sheet = getSheet('categorias');
  if (!sheet) return { ok: true, migrated: 0 };
  const data = sheet.getDataRange().getValues();
  if (data.length < 1) return { ok: true, migrated: 0 };
  const headers = data[0];
  if (headers.indexOf('vista') !== -1) return { ok: true, migrated: 0, already: true };

  const nombreIdx = headers.indexOf('nombre');
  const newHeaders = headers.slice();
  newHeaders.push('vista');

  const newRows = data.slice(1).map(row => {
    const nombre = String(row[nombreIdx] || '');
    const vista = nombre.indexOf('(Familia)') !== -1 ? 'familia' : 'factory';
    const newRow = row.slice();
    newRow.push(vista);
    return newRow;
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  if (newRows.length) {
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
  }
  return { ok: true, migrated: newRows.length };
}

// ── CIERRES DE CAJA ───────────────────────────
// Una fila por fecha (upsert por fecha)
const CIERRE_HEADERS = ['fecha','efectivoEsperado','efectivoContado','diferencia','nota','ts'];

function saveCierre(data) {
  const sheet = getOrCreateSheet('cierres', CIERRE_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  data.ts = new Date().toISOString();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][headers.indexOf('fecha')] === data.fecha) {
      updateRow(sheet, i + 1, headers, data);
      return { ok: true, action: 'updated' };
    }
  }
  appendRow(sheet, headers, data);
  return { ok: true, action: 'created' };
}

// ── HELPERS ───────────────────────────────────
function sheetToObjects(sheetName) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function appendRow(sheet, headers, data) {
  const existing = sheet.getDataRange().getValues();
  if (existing.length === 0 || (existing.length === 1 && existing[0][0] === '')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  const row = headers.map(h => data[h] !== undefined ? data[h] : '');
  const fechaIdx = headers.indexOf('fecha');
  const targetRow = sheet.getLastRow() + 1;
  if (fechaIdx !== -1) {
    sheet.getRange(targetRow, fechaIdx + 1, 1, 1).setNumberFormat('@');
  }
  sheet.appendRow(row);
}

function updateRow(sheet, rowIndex, headers, data) {
  const row = headers.map(h => data[h] !== undefined ? data[h] : '');
  const fechaIdx = headers.indexOf('fecha');
  if (fechaIdx !== -1) {
    sheet.getRange(rowIndex, fechaIdx + 1, 1, 1).setNumberFormat('@');
  }
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
}

function deleteRowByField(sheetName, field, value) {
  const sheet = getSheet(sheetName);
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const colIdx = headers.indexOf(field);
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][colIdx]) === String(value)) {
      sheet.deleteRow(i + 1);
    }
  }
}
