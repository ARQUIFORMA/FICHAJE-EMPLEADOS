/**
 * FICHAJE PWA — Backend en Google Apps Script (v2)
 * ------------------------------------------------------------------
 * Base de datos: la hoja de cálculo a la que está vinculado este script.
 * Despliegue: Implementar > Nueva implementación > Aplicación web
 *   - Ejecutar como: Yo   - Quién tiene acceso: Cualquier usuario
 *
 * Novedades v2:
 *   - Panel de administrador solo para SUPERADMINS, protegido con PIN (sesión de 30 min).
 *   - Alta/edición de empleados, PIN, sedes y ajustes desde la app.
 *   - Fichajes manuales (correcciones) con motivo y trazabilidad.
 *   - Informe Excel mensual por empleado (descarga y archivo en Google Drive).
 *   - Archivo automático el día 1 de cada mes.
 *   - Hoja Jornadas calculada por el script (sin fórmulas: funciona en cualquier idioma).
 */

// ============================================================
// 0. AJUSTE PRINCIPAL: quién puede entrar al panel de administrador
// ============================================================
var SUPERADMINS = ['javier@arquiforma.com'];

// ============================================================
// 1. CONSTANTES Y ESQUEMA
// ============================================================
var HOJAS = {
  CONFIG: 'Config', SEDES: 'Sedes', USUARIOS: 'Usuarios', FICHAJES: 'Fichajes',
  CORRECCIONES: 'Correcciones', JORNADAS: 'Jornadas', PINS: 'PINs_Entregar'
};

var COLS = {
  Config: ['Clave', 'Valor', 'Descripción'],
  Sedes: ['ID_Sede', 'Nombre', 'Latitud', 'Longitud', 'Radio_m', 'Activa'],
  Usuarios: ['Email', 'Nombre', 'NIF', 'Rol', 'Perfil', 'ID_Sede', 'Activo',
             'PIN_Hash', 'Token_Hash', 'Token_Caduca', 'Alta', 'Ultimo_Acceso'],
  Fichajes: ['ID', 'Fecha_Hora', 'Fecha', 'Hora', 'Email', 'Nombre', 'Perfil', 'Tipo',
             'Modalidad', 'Latitud', 'Longitud', 'Precision_m', 'Distancia_Sede_m',
             'Direccion', 'Enlace_Maps', 'Dispositivo', 'Origen', 'Hash_Anterior', 'Hash'],
  Correcciones: ['ID', 'Fecha_Hora', 'ID_Fichaje', 'Email_Empleado', 'Campo',
                 'Valor_Anterior', 'Valor_Nuevo', 'Motivo', 'Autor', 'Conforme_Empleado'],
  Jornadas: ['Clave', 'Fecha', 'Email', 'Nombre', 'Modalidad', 'Primera entrada', 'Última salida',
             'Pausas (min)', 'Horas efectivas', 'Minutos efectivos', 'Nº fichajes', 'Incidencia', 'Actualizado']
};

var CONFIG_DEFECTO = [
  ['EMPRESA', 'Mi Empresa S.L.', 'Razón social que aparece en informes y exportaciones'],
  ['CIF', 'B00000000', 'CIF de la empresa'],
  ['PRECISION_MAX_M', 100, 'Precisión GPS máxima aceptada (m) para el perfil Oficina'],
  ['SESION_DIAS', 180, 'Días que dura la sesión en el móvil'],
  ['HORAS_MAX_JORNADA_ABIERTA', 16, 'Horas tras las que una entrada sin salida se da por olvidada'],
  ['VERSION', '2.0', 'Versión del esquema']
];
var CONFIG_EDITABLE = ['EMPRESA', 'CIF', 'PRECISION_MAX_M', 'SESION_DIAS', 'HORAS_MAX_JORNADA_ABIERTA'];

var PERFILES = ['Oficina', 'Obra', 'Teletrabajo'];
var TIPOS = ['ENTRADA', 'INICIO_PAUSA', 'FIN_PAUSA', 'SALIDA'];
var MODALIDAD = { Oficina: 'Presencial', Obra: 'Desplazado', Teletrabajo: 'A distancia' };
var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

var TRANSICIONES = { FUERA: ['ENTRADA'], DENTRO: ['INICIO_PAUSA', 'SALIDA'], PAUSA: ['FIN_PAUSA'] };
var ESTADO_TRAS = { ENTRADA: 'DENTRO', INICIO_PAUSA: 'PAUSA', FIN_PAUSA: 'DENTRO', SALIDA: 'FUERA' };

var ADMIN_MINUTOS = 30;

function mensajeFueraRango_(radio) {
  return 'Te encuentras fuera del rango de la oficina (' + radio + ' m). No puedes fichar en modalidad presencial';
}

// ============================================================
// 2. ROUTER HTTP
// ============================================================
function doGet() {
  return json_({ ok: true, servicio: 'Fichaje API', version: '2.0', hora: new Date().toISOString() });
}

function doPost(e) {
  var b;
  try { b = JSON.parse(e && e.postData && e.postData.contents || '{}'); }
  catch (err) { return json_({ ok: false, error: 'Petición no válida.' }); }

  var rutas = {
    login: login_, logout: logout_, estado: estado_, fichar: fichar_, historial: historial_, miInforme: miInforme_,
    adminUnlock: adminUnlock_, adminResumen: adminResumen_, adminUsuarios: adminUsuarios_,
    adminGuardarUsuario: adminGuardarUsuario_, adminResetPin: adminResetPin_, adminCorreccion: adminCorreccion_,
    adminAjustes: adminAjustes_, adminGuardarAjustes: adminGuardarAjustes_, adminInforme: adminInforme_,
    adminArchivarMes: adminArchivarMes_, adminArchivoAuto: adminArchivoAuto_, adminExport: adminExport_,
    adminIntegridad: adminIntegridad_
  };
  try {
    if (!rutas[b.action]) return json_({ ok: false, error: 'Acción desconocida.' });
    return json_(rutas[b.action](b));
  } catch (err) {
    if (!(err && err.publico)) console.error(err && err.stack || err);
    return json_({ ok: false, error: err && err.publico ? err.message : 'Error interno. Inténtalo de nuevo.', codigo: err && err.codigo || null });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorPublico_(msg, codigo) {
  var e = new Error(msg);
  e.publico = true;
  e.codigo = codigo || null;
  return e;
}

// ============================================================
// 3. AUTENTICACIÓN
// ============================================================
function login_(b) {
  var email = normEmail_(b.email);
  var pin = String(b.pin || '').trim();
  if (!email || !pin) throw errorPublico_('Introduce tu email y tu PIN.');
  frenoIntentos_('login_' + email);

  var u = buscarUsuario_('Email', email);
  if (!u || !esVerdadero_(u.datos.Activo) || !u.datos.PIN_Hash || hashPin_(email, pin) !== u.datos.PIN_Hash) {
    sumarFallo_('login_' + email);
    throw errorPublico_('Email o PIN incorrectos.');
  }
  limpiarFallos_('login_' + email);

  var token = Utilities.getUuid() + Utilities.getUuid();
  var dias = numero_(config_('SESION_DIAS', 180), 180);
  escribirCeldas_(HOJAS.USUARIOS, u.fila, {
    Token_Hash: sha256_(token), Token_Caduca: new Date(Date.now() + dias * 86400000), Ultimo_Acceso: new Date()
  });
  return { ok: true, token: token, usuario: perfilPublico_(u.datos) };
}

function logout_(b) {
  var u = usuarioPorToken_(b.token);
  escribirCeldas_(HOJAS.USUARIOS, u.fila, { Token_Hash: '', Token_Caduca: '' });
  return { ok: true };
}

function usuarioPorToken_(token) {
  if (!token) throw errorPublico_('Sesión no iniciada.', 'SESION');
  var u = buscarUsuario_('Token_Hash', sha256_(String(token)));
  if (!u || !esVerdadero_(u.datos.Activo)) throw errorPublico_('Sesión caducada. Vuelve a entrar.', 'SESION');
  var cad = u.datos.Token_Caduca;
  if (cad && new Date(cad).getTime() < Date.now()) throw errorPublico_('Sesión caducada. Vuelve a entrar.', 'SESION');
  return u;
}

function esSuperadmin_(email) {
  return SUPERADMINS.map(normEmail_).indexOf(normEmail_(email)) >= 0;
}

/** Desbloquea el panel de administrador volviendo a pedir el PIN. Devuelve un token de admin válido 30 min. */
function adminUnlock_(b) {
  var u = usuarioPorToken_(b.token);
  var email = normEmail_(u.datos.Email);
  if (!esSuperadmin_(email)) throw errorPublico_('No tienes acceso al panel de administrador.');
  frenoIntentos_('admin_' + email);
  if (hashPin_(email, String(b.pin || '').trim()) !== u.datos.PIN_Hash) {
    sumarFallo_('admin_' + email);
    throw errorPublico_('PIN incorrecto.');
  }
  limpiarFallos_('admin_' + email);
  var adminToken = Utilities.getUuid();
  CacheService.getScriptCache().put('adm_' + sha256_(adminToken), email, ADMIN_MINUTOS * 60);
  return { ok: true, adminToken: adminToken, minutos: ADMIN_MINUTOS };
}

/** Exige sesión de usuario + superadmin + panel desbloqueado con PIN. Renueva los 30 min en cada uso. */
function exigirAdmin_(b) {
  var u = usuarioPorToken_(b.token);
  var email = normEmail_(u.datos.Email);
  if (!esSuperadmin_(email)) throw errorPublico_('No tienes acceso al panel de administrador.');
  var cache = CacheService.getScriptCache();
  var clave = 'adm_' + sha256_(String(b.adminToken || ''));
  if (!b.adminToken || cache.get(clave) !== email) throw errorPublico_('Introduce tu PIN para abrir el panel.', 'ADMIN_BLOQUEADO');
  cache.put(clave, email, ADMIN_MINUTOS * 60);
  return u;
}

function frenoIntentos_(clave) {
  if (Number(CacheService.getScriptCache().get('fallos_' + clave) || 0) >= 5) {
    throw errorPublico_('Demasiados intentos. Espera 15 minutos.');
  }
}
function sumarFallo_(clave) {
  var c = CacheService.getScriptCache();
  c.put('fallos_' + clave, String(Number(c.get('fallos_' + clave) || 0) + 1), 900);
}
function limpiarFallos_(clave) { CacheService.getScriptCache().remove('fallos_' + clave); }

function perfilPublico_(d) {
  return { email: d.Email, nombre: d.Nombre, perfil: d.Perfil, idSede: d.ID_Sede, esAdmin: esSuperadmin_(d.Email) };
}

// ============================================================
// 4. ESTADO E HISTORIAL
// ============================================================
function estado_(b) {
  var u = usuarioPorToken_(b.token);
  var sede = sedeDe_(u.datos);
  var ultimo = ultimoFichaje_(u.datos.Email);
  var est = estadoActual_(ultimo);
  return {
    ok: true,
    usuario: perfilPublico_(u.datos),
    empresa: config_('EMPRESA', ''),
    sede: sede ? { nombre: sede.Nombre, lat: numero_(sede.Latitud), lng: numero_(sede.Longitud), radio: numero_(sede.Radio_m, 100) } : null,
    estado: est,
    permitidos: TRANSICIONES[est],
    ultimo: ultimo ? fichajePublico_(ultimo) : null,
    precisionMax: numero_(config_('PRECISION_MAX_M', 100), 100),
    horaServidor: new Date().toISOString()
  };
}

function historial_(b) {
  var u = usuarioPorToken_(b.token);
  var limite = Math.min(Number(b.limite) || 30, 100);
  var email = normEmail_(u.datos.Email);
  var lista = leerTabla_(HOJAS.FICHAJES).filter(function (f) { return normEmail_(f.Email) === email; });
  lista.sort(function (a, c) { return new Date(c.Fecha_Hora) - new Date(a.Fecha_Hora); });
  return { ok: true, fichajes: lista.slice(0, limite).map(fichajePublico_) };
}

function fichajePublico_(f) {
  return {
    id: f.ID, fechaHora: new Date(f.Fecha_Hora).toISOString(), tipo: f.Tipo, modalidad: f.Modalidad,
    lat: f.Latitud === '' ? null : Number(f.Latitud), lng: f.Longitud === '' ? null : Number(f.Longitud),
    distancia: f.Distancia_Sede_m === '' ? null : Number(f.Distancia_Sede_m),
    direccion: f.Direccion || '', maps: f.Enlace_Maps || '', origen: f.Origen
  };
}

// ============================================================
// 5. FICHAR
// ============================================================
function fichar_(b) {
  var u = usuarioPorToken_(b.token);
  var d = u.datos;
  var tipo = String(b.tipo || '').toUpperCase();
  if (TIPOS.indexOf(tipo) < 0) throw errorPublico_('Tipo de fichaje no válido.');
  if (PERFILES.indexOf(d.Perfil) < 0) throw errorPublico_('Tu perfil no está configurado. Contacta con administración.');

  var lat = numeroONulo_(b.lat), lng = numeroONulo_(b.lng), prec = numeroONulo_(b.precision);
  var distancia = '', direccion = '';
  var sede = sedeDe_(d);
  var precisionMax = numero_(config_('PRECISION_MAX_M', 100), 100);

  if (d.Perfil === 'Oficina') {
    if (!sede) throw errorPublico_('No tienes sede asignada. Contacta con administración.');
    if (lat === null || lng === null) throw errorPublico_('Activa la ubicación del móvil para fichar en la oficina.');
    if (prec !== null && prec > precisionMax) {
      throw errorPublico_('La señal GPS es poco precisa (±' + Math.round(prec) + ' m). Acércate a una ventana o espera unos segundos.');
    }
    var radio = numero_(sede.Radio_m, 100);
    distancia = Math.round(haversineMetros(lat, lng, numero_(sede.Latitud), numero_(sede.Longitud)));
    if (distancia > radio) throw errorPublico_(mensajeFueraRango_(radio));
  } else if (d.Perfil === 'Obra') {
    if (lat === null || lng === null) throw errorPublico_('Activa la ubicación del móvil: en obra el fichaje debe registrar tu posición.');
    if (sede) distancia = Math.round(haversineMetros(lat, lng, numero_(sede.Latitud), numero_(sede.Longitud)));
    direccion = geocodificarInversa_(lat, lng);
  } else {
    lat = null; lng = null; prec = null; // Teletrabajo: sin ubicación (minimización RGPD)
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw errorPublico_('Servidor ocupado. Vuelve a intentarlo en unos segundos.');
  var fila;
  try {
    var ultimo = ultimoFichaje_(d.Email);
    var est = estadoActual_(ultimo);
    if (TRANSICIONES[est].indexOf(tipo) < 0) {
      throw errorPublico_('No puedes registrar «' + etiquetaTipo_(tipo) + '» ahora. Estado actual: ' + etiquetaEstado_(est) + '.');
    }
    if (ultimo && Date.now() - new Date(ultimo.Fecha_Hora).getTime() < 60000) {
      throw errorPublico_('Acabas de fichar hace menos de un minuto.');
    }
    var ahora = new Date(Math.floor(Date.now() / 1000) * 1000);
    fila = nuevaFilaFichaje_(d, tipo, ahora, {
      Latitud: lat, Longitud: lng, Precision_m: prec === null ? '' : Math.round(prec), Distancia_Sede_m: distancia,
      Direccion: direccion, Dispositivo: String(b.dispositivo || '').slice(0, 200), Origen: 'APP'
    });
    anexarConHash_(fila);
  } finally {
    lock.releaseLock();
  }
  try { actualizarJornada_(d.Email, fila.Fecha, true); } catch (err) { console.warn('Jornadas: ' + err); }
  return { ok: true, fichaje: fichajePublico_(fila), estado: ESTADO_TRAS[tipo], permitidos: TRANSICIONES[ESTADO_TRAS[tipo]] };
}

function nuevaFilaFichaje_(usuario, tipo, cuando, extra) {
  var tz = Session.getScriptTimeZone();
  var lat = extra.Latitud === null || extra.Latitud === undefined ? '' : extra.Latitud;
  var lng = extra.Longitud === null || extra.Longitud === undefined ? '' : extra.Longitud;
  return {
    ID: Utilities.getUuid(), Fecha_Hora: cuando,
    Fecha: Utilities.formatDate(cuando, tz, 'yyyy-MM-dd'), Hora: Utilities.formatDate(cuando, tz, 'HH:mm:ss'),
    Email: usuario.Email, Nombre: usuario.Nombre, Perfil: usuario.Perfil, Tipo: tipo, Modalidad: MODALIDAD[usuario.Perfil] || '',
    Latitud: lat, Longitud: lng, Precision_m: extra.Precision_m || '', Distancia_Sede_m: extra.Distancia_Sede_m || '',
    Direccion: extra.Direccion || '',
    Enlace_Maps: lat !== '' && lng !== '' ? 'https://www.google.com/maps?q=' + Number(lat).toFixed(6) + ',' + Number(lng).toFixed(6) : '',
    Dispositivo: extra.Dispositivo || '', Origen: extra.Origen || 'APP'
  };
}

function estadoActual_(ultimo) {
  if (!ultimo) return 'FUERA';
  var est = ESTADO_TRAS[ultimo.Tipo] || 'FUERA';
  var horas = (Date.now() - new Date(ultimo.Fecha_Hora).getTime()) / 3600000;
  if (est !== 'FUERA' && horas > numero_(config_('HORAS_MAX_JORNADA_ABIERTA', 16), 16)) return 'FUERA';
  return est;
}

/** Último fichaje del usuario por fecha/hora real (no por orden de fila: las correcciones se añaden al final). */
function ultimoFichaje_(email) {
  var hoja = hoja_(HOJAS.FICHAJES);
  var n = hoja.getLastRow();
  if (n < 2) return null;
  var desde = Math.max(2, n - 2999);
  var valores = hoja.getRange(desde, 1, n - desde + 1, COLS.Fichajes.length).getValues();
  var objetivo = normEmail_(email), mejor = null, mejorT = -Infinity;
  for (var i = 0; i < valores.length; i++) {
    if (normEmail_(valores[i][4]) !== objetivo) continue;
    var t = new Date(valores[i][1]).getTime();
    if (t >= mejorT) { mejorT = t; mejor = valores[i]; }
  }
  return mejor ? filaAObjeto_(COLS.Fichajes, mejor) : null;
}

function anexarConHash_(fila) {
  var hoja = hoja_(HOJAS.FICHAJES);
  var n = hoja.getLastRow();
  var anterior = n >= 2 ? String(hoja.getRange(n, COLS.Fichajes.indexOf('Hash') + 1).getValue()) : 'GENESIS';
  fila.Hash_Anterior = anterior;
  fila.Hash = sha256_(anterior + '|' + cadenaCanonica_(fila));
  hoja.appendRow(COLS.Fichajes.map(function (c) { return fila[c] === undefined ? '' : fila[c]; }));
}

function cadenaCanonica_(f) {
  var t = f.Fecha_Hora instanceof Date ? f.Fecha_Hora.toISOString() : new Date(f.Fecha_Hora).toISOString();
  return [f.ID, t, normEmail_(f.Email), f.Tipo, f.Modalidad, f.Latitud, f.Longitud, f.Origen].join('|');
}

function geocodificarInversa_(lat, lng) {
  try {
    var r = Maps.newGeocoder().setLanguage('es').reverseGeocode(lat, lng);
    return r && r.results && r.results.length ? r.results[0].formatted_address : '';
  } catch (err) {
    console.warn('Geocodificación fallida: ' + err);
    return '';
  }
}

// ============================================================
// 6. HAVERSINE (misma fórmula que frontend/geo.js)
// ============================================================
function haversineMetros(lat1, lon1, lat2, lon2) {
  var R = 6371008.8, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  var a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.pow(Math.sin(dLon / 2), 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ============================================================
// 7. JORNADAS (resumen diario, calculado por el script)
// ============================================================
function calcularJornada_(lista) {
  var tz = Session.getScriptTimeZone();
  lista = lista.slice().sort(function (a, c) { return new Date(a.Fecha_Hora) - new Date(c.Fecha_Hora); });
  var trabajoMs = 0, pausaMs = 0, inicio = null, inicioPausa = null, entrada = '', salida = '', incidencia = '';
  var corregido = false, tramos = [];
  lista.forEach(function (f) {
    var t = new Date(f.Fecha_Hora).getTime();
    if (f.Origen === 'CORRECCION') corregido = true;
    if (f.Tipo === 'ENTRADA') { inicio = t; if (!entrada) entrada = Utilities.formatDate(new Date(t), tz, 'HH:mm'); }
    if (f.Tipo === 'INICIO_PAUSA') inicioPausa = t;
    if (f.Tipo === 'FIN_PAUSA' && inicioPausa !== null) { pausaMs += t - inicioPausa; inicioPausa = null; }
    if (f.Tipo === 'SALIDA' && inicio !== null) {
      trabajoMs += t - inicio;
      tramos.push(Utilities.formatDate(new Date(inicio), tz, 'HH:mm') + '-' + Utilities.formatDate(new Date(t), tz, 'HH:mm'));
      inicio = null;
      salida = Utilities.formatDate(new Date(t), tz, 'HH:mm');
    }
  });
  if (inicio !== null) incidencia = 'Falta fichar salida';
  if (inicioPausa !== null) incidencia = 'Pausa sin cerrar';
  var min = Math.round(Math.max(0, trabajoMs - pausaMs) / 60000);
  return {
    entrada: entrada, salida: salida, pausaMin: Math.round(pausaMs / 60000), minutos: min,
    horasTexto: lista.length ? hm_(min) : '', incidencia: incidencia, corregido: corregido,
    tramos: tramos.join(' / '), num: lista.length, modalidad: lista.length ? lista[lista.length - 1].Modalidad : ''
  };
}

function hm_(min) { return Math.floor(min / 60) + 'h ' + ('0' + (min % 60)).slice(-2) + 'm'; }

/** Recalcula y escribe (o actualiza) la fila de Jornadas de un empleado y un día. */
function actualizarJornada_(email, fecha, soloRecientes) {
  var tz = Session.getScriptTimeZone();
  var objetivo = normEmail_(email);
  var hf = hoja_(HOJAS.FICHAJES), n = hf.getLastRow();
  if (n < 2) return;
  var desde = soloRecientes ? Math.max(2, n - 2999) : 2;
  var filas = hf.getRange(desde, 1, n - desde + 1, COLS.Fichajes.length).getValues()
    .map(function (r) { return filaAObjeto_(COLS.Fichajes, r); })
    .filter(function (f) { return normEmail_(f.Email) === objetivo && fechaTexto_(f.Fecha, tz) === fecha; });
  if (!filas.length) return;
  var j = calcularJornada_(filas);
  var fila = filaJornada_(fecha, filas[0], j);

  var hj = asegurarJornadas_();
  var nj = hj.getLastRow();
  var clave = fila[0];
  if (nj >= 2) {
    var claves = hj.getRange(2, 1, nj - 1, 1).getValues();
    for (var i = claves.length - 1; i >= 0; i--) {
      if (claves[i][0] === clave) { hj.getRange(i + 2, 1, 1, fila.length).setValues([fila]); return; }
    }
  }
  hj.appendRow(fila);
}

function filaJornada_(fecha, f0, j) {
  return [fecha + '|' + normEmail_(f0.Email), fecha, f0.Email, f0.Nombre, j.modalidad, j.entrada, j.salida,
          j.pausaMin, j.horasTexto, j.minutos, j.num, j.incidencia + (j.corregido ? (j.incidencia ? ' · ' : '') + 'Incluye corrección' : ''),
          new Date()];
}

/** Reconstruye la hoja Jornadas completa a partir de Fichajes. */
function recalcularJornadas() {
  var tz = Session.getScriptTimeZone();
  var grupos = {};
  leerTabla_(HOJAS.FICHAJES).forEach(function (f) {
    var k = fechaTexto_(f.Fecha, tz) + '|' + normEmail_(f.Email);
    (grupos[k] = grupos[k] || []).push(f);
  });
  var filas = Object.keys(grupos).sort().reverse().map(function (k) {
    var lista = grupos[k];
    return filaJornada_(k.split('|')[0], lista[0], calcularJornada_(lista));
  });
  var hj = asegurarJornadas_();
  if (hj.getLastRow() > 1) hj.getRange(2, 1, hj.getLastRow() - 1, COLS.Jornadas.length).clearContent();
  if (filas.length) hj.getRange(2, 1, filas.length, COLS.Jornadas.length).setValues(filas);
  return filas.length;
}

function asegurarJornadas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(HOJAS.JORNADAS);
  var cab = h ? h.getRange(1, 1, 1, COLS.Jornadas.length).getValues()[0] : [];
  if (!h || cab[0] !== 'Clave') {
    if (!h) h = ss.insertSheet(HOJAS.JORNADAS);
    h.clear();
    h.getRange(1, 1, 1, COLS.Jornadas.length).setValues([COLS.Jornadas]).setFontWeight('bold').setBackground('#eef2f7');
    h.setFrozenRows(1);
    h.getRange('B:B').setNumberFormat('@');
    h.getRange('M:M').setNumberFormat('yyyy-mm-dd hh:mm');
    h.hideColumns(1);
  }
  return h;
}

// ============================================================
// 8. ADMIN: RESUMEN DEL DÍA
// ============================================================
function adminResumen_(b) {
  exigirAdmin_(b);
  var tz = Session.getScriptTimeZone();
  var fecha = esFecha_(b.fecha) ? b.fecha : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var usuarios = leerTabla_(HOJAS.USUARIOS).filter(function (x) { return x.Email && esVerdadero_(x.Activo); });
  var porEmail = {};
  leerTabla_(HOJAS.FICHAJES).forEach(function (f) {
    if (fechaTexto_(f.Fecha, tz) !== fecha) return;
    var k = normEmail_(f.Email);
    (porEmail[k] = porEmail[k] || []).push(f);
  });
  var filas = usuarios.map(function (us) {
    var lista = (porEmail[normEmail_(us.Email)] || []).sort(function (a, c) { return new Date(a.Fecha_Hora) - new Date(c.Fecha_Hora); });
    var j = calcularJornada_(lista);
    return {
      nombre: us.Nombre, email: us.Email, perfil: us.Perfil,
      estado: lista.length ? etiquetaEstado_(ESTADO_TRAS[lista[lista.length - 1].Tipo]) : 'Sin fichar',
      entrada: j.entrada, salida: j.salida, pausaMin: j.pausaMin, horas: j.horasTexto, incidencia: j.incidencia,
      fichajes: lista.map(fichajePublico_)
    };
  }).sort(function (a, c) { return String(a.nombre).localeCompare(String(c.nombre), 'es'); });
  return {
    ok: true, fecha: fecha,
    totales: {
      plantilla: filas.length,
      ficharon: filas.filter(function (f) { return f.fichajes.length; }).length,
      trabajandoAhora: filas.filter(function (f) { return f.estado === 'Trabajando'; }).length,
      incidencias: filas.filter(function (f) { return f.incidencia; }).length
    },
    filas: filas
  };
}

// ============================================================
// 9. ADMIN: EMPLEADOS Y PIN
// ============================================================
function adminUsuarios_(b) {
  exigirAdmin_(b);
  var usuarios = leerTabla_(HOJAS.USUARIOS).filter(function (u) { return u.Email; }).map(function (u) {
    return {
      email: u.Email, nombre: u.Nombre, nif: u.NIF, perfil: u.Perfil, idSede: u.ID_Sede,
      activo: esVerdadero_(u.Activo), tienePin: !!u.PIN_Hash, esAdmin: esSuperadmin_(u.Email),
      ultimoAcceso: u.Ultimo_Acceso ? new Date(u.Ultimo_Acceso).toISOString() : null
    };
  }).sort(function (a, c) { return String(a.nombre).localeCompare(String(c.nombre), 'es'); });
  var sedes = leerTabla_(HOJAS.SEDES).filter(function (s) { return s.ID_Sede; }).map(function (s) {
    return { id: String(s.ID_Sede), nombre: s.Nombre };
  });
  return { ok: true, usuarios: usuarios, sedes: sedes, perfiles: PERFILES };
}

function adminGuardarUsuario_(b) {
  var admin = exigirAdmin_(b);
  var d = b.usuario || {};
  var email = normEmail_(d.email);
  var nombre = String(d.nombre || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw errorPublico_('Email no válido.');
  if (!nombre) throw errorPublico_('Falta el nombre.');
  if (PERFILES.indexOf(d.perfil) < 0) throw errorPublico_('Perfil no válido.');
  var idSede = String(d.idSede || '').trim();
  if (d.perfil === 'Oficina' && !idSede) throw errorPublico_('El perfil Oficina necesita una sede.');
  if (idSede && !leerTabla_(HOJAS.SEDES).some(function (s) { return String(s.ID_Sede) === idSede; })) throw errorPublico_('La sede no existe.');
  var activo = d.activo !== false;
  if (!activo && normEmail_(admin.datos.Email) === email) throw errorPublico_('No puedes desactivar tu propia cuenta.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var existente = buscarUsuario_('Email', email);
    var datos = { Nombre: nombre, NIF: String(d.nif || '').trim().toUpperCase(), Rol: esSuperadmin_(email) ? 'Admin' : 'Empleado',
                  Perfil: d.perfil, ID_Sede: idSede, Activo: activo };
    if (d.nuevo) {
      if (existente) throw errorPublico_('Ya existe un empleado con ese email.');
      var pin = pinAleatorio_();
      var fila = COLS.Usuarios.map(function (c) {
        if (c === 'Email') return email;
        if (c === 'PIN_Hash') return hashPin_(email, pin);
        if (c === 'Alta') return new Date();
        return datos[c] !== undefined ? datos[c] : '';
      });
      escribirFilaNueva_(hoja_(HOJAS.USUARIOS), fila, COLS.Usuarios.indexOf('Activo') + 1);
      return { ok: true, pin: pin, mensaje: 'Empleado creado.' };
    }
    if (!existente) throw errorPublico_('No existe ese empleado.');
    if (!activo) { datos.Token_Hash = ''; datos.Token_Caduca = ''; } // al dar de baja, cierra su sesión
    escribirCeldas_(HOJAS.USUARIOS, existente.fila, datos);
    return { ok: true, mensaje: 'Cambios guardados.' };
  } finally {
    lock.releaseLock();
  }
}

function adminResetPin_(b) {
  exigirAdmin_(b);
  var email = normEmail_(b.email);
  var u = buscarUsuario_('Email', email);
  if (!u) throw errorPublico_('No existe ese empleado.');
  var pin = pinAleatorio_();
  var cambios = { PIN_Hash: hashPin_(email, pin) };
  if (!esSuperadmin_(email)) { cambios.Token_Hash = ''; cambios.Token_Caduca = ''; } // cierra la sesión del empleado
  escribirCeldas_(HOJAS.USUARIOS, u.fila, cambios);
  return { ok: true, pin: pin, nombre: u.datos.Nombre };
}

// ============================================================
// 10. ADMIN: FICHAJE MANUAL (CORRECCIÓN)
// ============================================================
function adminCorreccion_(b) {
  var admin = exigirAdmin_(b);
  var u = buscarUsuario_('Email', normEmail_(b.email));
  if (!u) throw errorPublico_('Empleado no encontrado.');
  var tipo = String(b.tipo || '').toUpperCase();
  if (TIPOS.indexOf(tipo) < 0) throw errorPublico_('Tipo no válido.');
  var motivo = String(b.motivo || '').trim();
  if (motivo.length < 5) throw errorPublico_('Escribe el motivo de la corrección.');
  if (!esFecha_(b.fecha) || !/^\d{2}:\d{2}$/.test(b.hora || '')) throw errorPublico_('Fecha u hora no válidas.');
  var p = b.fecha.split('-'), h = b.hora.split(':');
  var cuando = fechaEnZona_(Number(p[0]), Number(p[1]), Number(p[2]), Number(h[0]), Number(h[1]));
  if (cuando.getTime() > Date.now()) throw errorPublico_('No se pueden registrar fichajes en el futuro.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var fila;
  try {
    fila = nuevaFilaFichaje_(u.datos, tipo, cuando, { Dispositivo: 'Fichaje manual (administración)', Origen: 'CORRECCION' });
    anexarConHash_(fila);
    hoja_(HOJAS.CORRECCIONES).appendRow([Utilities.getUuid(), new Date(), fila.ID, u.datos.Email, 'Alta de fichaje',
      '', etiquetaTipo_(tipo) + ' ' + b.fecha + ' ' + b.hora, motivo, admin.datos.Email, '']);
  } finally {
    lock.releaseLock();
  }
  actualizarJornada_(u.datos.Email, fila.Fecha, false);
  return { ok: true, mensaje: etiquetaTipo_(tipo) + ' de ' + u.datos.Nombre + ' registrada el ' + b.fecha + ' a las ' + b.hora + '.' };
}

/** Construye una fecha con la hora local de la zona del script (Europe/Madrid), independiente del servidor. */
function fechaEnZona_(y, m, d, hh, mm) {
  var tz = Session.getScriptTimeZone();
  var guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  for (var i = 0; i < 2; i++) {
    var visto = Utilities.formatDate(guess, tz, 'yyyy-MM-dd HH:mm').split(/[- :]/).map(Number);
    var diff = Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(visto[0], visto[1] - 1, visto[2], visto[3], visto[4]);
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

// ============================================================
// 11. ADMIN: AJUSTES (empresa, sedes, GPS)
// ============================================================
function adminAjustes_(b) {
  exigirAdmin_(b);
  var cfg = {};
  CONFIG_EDITABLE.forEach(function (k) {
    var def = CONFIG_DEFECTO.filter(function (r) { return r[0] === k; })[0];
    cfg[k] = config_(k, def ? def[1] : '', true);
  });
  var sedes = leerTabla_(HOJAS.SEDES).filter(function (s) { return s.ID_Sede; }).map(function (s) {
    return { id: String(s.ID_Sede), nombre: s.Nombre, lat: numero_(s.Latitud), lng: numero_(s.Longitud), radio: numero_(s.Radio_m, 100), activa: esVerdadero_(s.Activa) };
  });
  var props = PropertiesService.getScriptProperties();
  var carpeta = props.getProperty('CARPETA_ARCHIVO_ID');
  return {
    ok: true, config: cfg, sedes: sedes,
    archivoAuto: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'archivarMesAnteriorAuto'; }),
    carpetaUrl: carpeta ? 'https://drive.google.com/drive/folders/' + carpeta : null
  };
}

function adminGuardarAjustes_(b) {
  exigirAdmin_(b);
  var c = b.config || {};
  var errores = [];
  var prec = numero_(c.PRECISION_MAX_M), ses = numero_(c.SESION_DIAS), hmax = numero_(c.HORAS_MAX_JORNADA_ABIERTA);
  if (!(prec >= 10 && prec <= 500)) errores.push('La precisión GPS debe estar entre 10 y 500 m.');
  if (!(ses >= 1 && ses <= 365)) errores.push('La sesión debe durar entre 1 y 365 días.');
  if (!(hmax >= 8 && hmax <= 24)) errores.push('Las horas de jornada abierta deben estar entre 8 y 24.');
  var sedes = (b.sedes || []).map(function (s) {
    var o = { id: String(s.id || '').trim().toUpperCase(), nombre: String(s.nombre || '').trim(),
              lat: numero_(s.lat), lng: numero_(s.lng), radio: numero_(s.radio), activa: s.activa !== false };
    if (!o.id || !/^[A-Z0-9_-]{2,20}$/.test(o.id)) errores.push('ID de sede no válido: ' + (s.id || '(vacío)'));
    if (!o.nombre) errores.push('Falta el nombre de la sede ' + o.id);
    if (!(o.lat >= -90 && o.lat <= 90) || !(o.lng >= -180 && o.lng <= 180)) errores.push('Coordenadas no válidas en ' + o.id);
    if (!(o.radio >= 20 && o.radio <= 5000)) errores.push('El radio de ' + o.id + ' debe estar entre 20 y 5000 m.');
    return o;
  });
  if (errores.length) throw errorPublico_(errores.join(' '));

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var hc = hoja_(HOJAS.CONFIG);
    var datosCfg = leerTabla_(HOJAS.CONFIG);
    var valores = { EMPRESA: String(c.EMPRESA || '').trim(), CIF: String(c.CIF || '').trim().toUpperCase(),
                    PRECISION_MAX_M: prec, SESION_DIAS: ses, HORAS_MAX_JORNADA_ABIERTA: hmax };
    Object.keys(valores).forEach(function (k) {
      var idx = -1;
      for (var i = 0; i < datosCfg.length; i++) if (datosCfg[i].Clave === k) idx = i;
      if (idx >= 0) hc.getRange(idx + 2, 2).setValue(valores[k]);
      else hc.appendRow([k, valores[k], '']);
      CacheService.getScriptCache().remove('cfg_' + k);
    });

    var hs = hoja_(HOJAS.SEDES);
    var existentes = leerTabla_(HOJAS.SEDES);
    sedes.forEach(function (s) {
      var fila = [s.id, s.nombre, s.lat, s.lng, Math.round(s.radio), s.activa];
      var idx = -1;
      for (var i = 0; i < existentes.length; i++) if (String(existentes[i].ID_Sede).toUpperCase() === s.id) idx = i;
      if (idx >= 0) { hs.getRange(idx + 2, 1, 1, 6).setValues([fila]); }
      else escribirFilaNueva_(hs, fila, 6);
    });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, mensaje: 'Ajustes guardados.' };
}

function adminIntegridad_(b) {
  exigirAdmin_(b);
  return comprobarCadena_();
}

function comprobarCadena_() {
  var datos = leerTabla_(HOJAS.FICHAJES);
  var anterior = 'GENESIS';
  for (var i = 0; i < datos.length; i++) {
    var f = datos[i];
    if (f.Hash_Anterior !== anterior || f.Hash !== sha256_(anterior + '|' + cadenaCanonica_(f))) {
      return { ok: true, integro: false, fila: i + 2, total: datos.length,
               mensaje: 'Cadena rota en la fila ' + (i + 2) + ' de Fichajes: ese registro o el anterior se modificaron a mano.' };
    }
    anterior = f.Hash;
  }
  return { ok: true, integro: true, total: datos.length, mensaje: 'Integridad correcta: ' + datos.length + ' fichajes verificados.' };
}

// ============================================================
// 12. INFORME EXCEL MENSUAL POR EMPLEADO
// ============================================================
/** El propio empleado descarga su registro mensual (derecho de acceso). */
function miInforme_(b) {
  var u = usuarioPorToken_(b.token);
  if (!esMes_(b.mes)) throw errorPublico_('Mes no válido.');
  return informeComoDescarga_(u.datos, b.mes, 'inspeccion');
}

function adminInforme_(b) {
  exigirAdmin_(b);
  if (!esMes_(b.mes)) throw errorPublico_('Mes no válido.');
  var u = buscarUsuario_('Email', normEmail_(b.email));
  if (!u) throw errorPublico_('Empleado no encontrado.');
  return informeComoDescarga_(u.datos, b.mes, b.formato === 'completo' ? 'completo' : 'inspeccion');
}

/** formato: 'inspeccion' (sencillo, para la Inspección de Trabajo) o 'completo' (con motivos, GPS y detalle). */
function informeComoDescarga_(usuario, mes, formato) {
  var ctx = contextoInforme_(mes);
  var tmp = SpreadsheetApp.create('tmp_informe_fichaje');
  try {
    if (formato === 'completo') rellenarInforme_(tmp, usuario, mes, ctx);
    else rellenarInspeccion_(tmp, usuario, mes, ctx);
    var blob = exportarXlsx_(tmp.getId());
    return { ok: true, nombreArchivo: nombreInforme_(usuario, mes, formato), base64: Utilities.base64Encode(blob.getBytes()) };
  } finally {
    DriveApp.getFileById(tmp.getId()).setTrashed(true);
  }
}

/** Guarda en Google Drive un Excel por empleado (y un resumen) del mes indicado. */
function adminArchivarMes_(b) {
  exigirAdmin_(b);
  if (!esMes_(b.mes)) throw errorPublico_('Mes no válido.');
  return archivarMes_(b.mes);
}

function archivarMes_(mes) {
  var ctx = contextoInforme_(mes);
  var carpeta = carpetaMes_(mes);
  var tz = Session.getScriptTimeZone();
  // Empleados activos + cualquiera que fichara ese mes (aunque hoy esté de baja)
  var conFichajes = {};
  ctx.fichajes.forEach(function (f) { conFichajes[normEmail_(f.Email)] = true; });
  var usuarios = leerTabla_(HOJAS.USUARIOS).filter(function (u) {
    return u.Email && (esVerdadero_(u.Activo) || conFichajes[normEmail_(u.Email)]);
  });
  var tmp = SpreadsheetApp.create('tmp_informe_fichaje');
  var resumen = [];
  try {
    var carpetaCompleto = subcarpeta_(carpeta, 'Completo (uso interno)');
    usuarios.forEach(function (u) {
      rellenarInspeccion_(tmp, u, mes, ctx);
      guardarEnCarpeta_(carpeta, exportarXlsx_(tmp.getId()).setName(nombreInforme_(u, mes, 'inspeccion')));
      var r = rellenarInforme_(tmp, u, mes, ctx);
      resumen.push([u.Nombre, u.NIF || '', u.Email, u.Perfil, r.dias, r.minutos / 1440, r.incidencias]);
      guardarEnCarpeta_(carpetaCompleto, exportarXlsx_(tmp.getId()).setName(nombreInforme_(u, mes, 'completo')));
    });
    rellenarResumenMes_(tmp, mes, resumen, ctx);
    guardarEnCarpeta_(carpetaCompleto, exportarXlsx_(tmp.getId()).setName(mes + ' - 00 RESUMEN.xlsx'));
  } finally {
    DriveApp.getFileById(tmp.getId()).setTrashed(true);
  }
  PropertiesService.getScriptProperties().setProperty('ULTIMO_ARCHIVO', mes + ' · ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'));
  return { ok: true, carpetaUrl: carpeta.getUrl(), archivos: usuarios.length * 2 + 1,
           mensaje: 'Archivados los registros de ' + usuarios.length + ' empleados de ' + nombreMes_(mes) + ' en Google Drive.' };
}

function contextoInforme_(mes) {
  var tz = Session.getScriptTimeZone();
  var correcciones = {};
  leerTabla_(HOJAS.CORRECCIONES).forEach(function (c) { if (c.ID_Fichaje) correcciones[c.ID_Fichaje] = c.Motivo; });
  return {
    tz: tz, empresa: config_('EMPRESA', ''), cif: config_('CIF', ''), correcciones: correcciones,
    fichajes: leerTabla_(HOJAS.FICHAJES).filter(function (f) { return fechaTexto_(f.Fecha, tz).indexOf(mes) === 0; })
  };
}

/** Escribe en la hoja temporal el informe de un empleado. Devuelve los totales. */
function rellenarInforme_(ss, usuario, mes, ctx) {
  var email = normEmail_(usuario.Email);
  var propios = ctx.fichajes.filter(function (f) { return normEmail_(f.Email) === email; })
    .sort(function (a, c) { return new Date(a.Fecha_Hora) - new Date(c.Fecha_Hora); });
  var porDia = {};
  propios.forEach(function (f) { var d = fechaTexto_(f.Fecha, ctx.tz); (porDia[d] = porDia[d] || []).push(f); });

  var sh = hojaLimpia_(ss, 'Registro mensual', 0);
  var y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
  var diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();

  sh.getRange('A1').setValue('REGISTRO DIARIO DE JORNADA').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2:I5').setValues([
    ['Empresa:', ctx.empresa, '', '', 'CIF:', ctx.cif, '', '', ''],
    ['Trabajador/a:', usuario.Nombre, '', '', 'NIF:', usuario.NIF || '', '', '', ''],
    ['Email:', usuario.Email, '', '', 'Modalidad habitual:', MODALIDAD[usuario.Perfil] || usuario.Perfil, '', '', ''],
    ['Periodo:', nombreMes_(mes), '', '', 'Base legal:', 'Art. 34.9 Estatuto de los Trabajadores', '', '', '']
  ]);
  sh.getRange('A2:A5').setFontWeight('bold');
  sh.getRange('E2:E5').setFontWeight('bold');

  var cab = ['Fecha', 'Día', 'Entrada', 'Salida', 'Tramos trabajados', 'Pausas', 'Horas efectivas', 'Modalidad', 'Observaciones'];
  sh.getRange(7, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#0f3d5e').setFontColor('#ffffff');

  var filas = [], fondos = [], totalMin = 0, diasTrab = 0, incidencias = 0;
  for (var d = 1; d <= diasMes; d++) {
    var fecha = mes + '-' + ('0' + d).slice(-2);
    var dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    var lista = porDia[fecha] || [];
    var j = calcularJornada_(lista);
    if (lista.length) { diasTrab++; totalMin += j.minutos; }
    if (j.incidencia) incidencias++;
    var obs = [j.incidencia, j.corregido ? 'Incluye fichaje manual' : ''].filter(String).join('. ');
    filas.push([d + '/' + m + '/' + y, DIAS[dow], j.entrada, j.salida, j.tramos,
                lista.length ? j.pausaMin / 1440 : '', lista.length ? j.minutos / 1440 : '', j.modalidad, obs]);
    var finde = dow === 0 || dow === 6;
    fondos.push(cab.map(function () { return finde ? '#f1f3f5' : '#ffffff'; }));
  }
  var r0 = 8;
  var rango = sh.getRange(r0, 1, filas.length, cab.length);
  rango.setValues(filas).setBackgrounds(fondos).setBorder(true, true, true, true, true, true, '#d0d7de', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(r0, 6, filas.length, 2).setNumberFormat('[h]:mm');
  sh.getRange(r0, 1, filas.length, 1).setHorizontalAlignment('left');

  var rt = r0 + filas.length;
  sh.getRange(rt, 1, 1, cab.length).setFontWeight('bold').setBackground('#e8eef3');
  sh.getRange(rt, 1).setValue('TOTAL MES');
  sh.getRange(rt, 2).setValue(diasTrab + ' días');
  sh.getRange(rt, 6).setFormula('=SUM(F' + r0 + ':F' + (rt - 1) + ')').setNumberFormat('[h]:mm');
  sh.getRange(rt, 7).setFormula('=SUM(G' + r0 + ':G' + (rt - 1) + ')').setNumberFormat('[h]:mm');

  sh.getRange(rt + 2, 1).setValue('Registro generado el ' + Utilities.formatDate(new Date(), ctx.tz, 'dd/MM/yyyy HH:mm') +
    ' desde el sistema digital de fichaje. Los registros son inalterables; las correcciones constan con su motivo en la hoja "Detalle".')
    .setFontSize(9).setFontColor('#5b6b78');
  sh.getRange(rt + 4, 1).setValue('Firma de la empresa:').setFontWeight('bold');
  sh.getRange(rt + 4, 6).setValue('Firma del trabajador/a:').setFontWeight('bold');
  sh.getRange(rt + 7, 1, 1, 4).setBorder(true, null, null, null, null, null);
  sh.getRange(rt + 7, 6, 1, 4).setBorder(true, null, null, null, null, null);

  [100, 48, 64, 64, 170, 64, 100, 100, 230].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(7);
  sh.getRange(1, 1, rt + 8, cab.length).setFontFamily('Arial');

  // --- Hoja Detalle ---
  var det = hojaLimpia_(ss, 'Detalle', 1);
  var cabD = ['Fecha', 'Hora', 'Tipo', 'Modalidad', 'Latitud', 'Longitud', 'Dirección estimada', 'Mapa', 'Origen', 'Motivo corrección', 'ID registro'];
  det.getRange(1, 1, 1, cabD.length).setValues([cabD]).setFontWeight('bold').setBackground('#0f3d5e').setFontColor('#ffffff');
  if (propios.length) {
    var filasD = propios.map(function (f) {
      return [fechaTexto_(f.Fecha, ctx.tz), horaTexto_(f.Hora, ctx.tz), etiquetaTipo_(f.Tipo), f.Modalidad, f.Latitud, f.Longitud,
              f.Direccion, f.Enlace_Maps, f.Origen === 'CORRECCION' ? 'Manual (administración)' : 'App',
              ctx.correcciones[f.ID] || '', f.ID];
    });
    det.getRange(2, 1, filasD.length, cabD.length).setValues(filasD);
  } else {
    det.getRange(2, 1).setValue('Sin fichajes en ' + nombreMes_(mes) + '.');
  }
  [90, 70, 100, 100, 90, 90, 260, 280, 160, 220, 260].forEach(function (w, i) { det.setColumnWidth(i + 1, w); });
  det.getRange(1, 1, Math.max(2, propios.length + 1), cabD.length).setFontFamily('Arial');
  det.setFrozenRows(1);

  borrarHojasSobrantes_(ss, ['Registro mensual', 'Detalle']);
  SpreadsheetApp.flush();
  return { dias: diasTrab, minutos: totalMin, incidencias: incidencias };
}


/**
 * Clasifica los fichajes de un día: entrada, salida y descansos.
 * Un descanso es una pausa (Inicio/Fin pausa) o el hueco entre una Salida y la siguiente Entrada.
 * Los que empiezan antes de las 12:00 se consideran almuerzo; el resto, comida.
 */
function descansosDelDia_(lista, tz) {
  lista = lista.slice().sort(function (a, c) { return new Date(a.Fecha_Hora) - new Date(c.Fecha_Hora); });
  var hhmm = function (t) { return Utilities.formatDate(new Date(t), tz, 'HH:mm'); };
  var minutosDia = function (t) { var x = hhmm(t).split(':'); return Number(x[0]) * 60 + Number(x[1]); };
  var entrada = '', salida = '', descansos = [], inicioPausa = null, ultimaSalida = null, manual = false;
  lista.forEach(function (f) {
    var t = new Date(f.Fecha_Hora).getTime();
    if (f.Origen === 'CORRECCION') manual = true;
    if (f.Tipo === 'ENTRADA') {
      if (!entrada) entrada = hhmm(t);
      if (ultimaSalida !== null) { descansos.push([ultimaSalida, t]); ultimaSalida = null; }
    }
    if (f.Tipo === 'INICIO_PAUSA') inicioPausa = t;
    if (f.Tipo === 'FIN_PAUSA' && inicioPausa !== null) { descansos.push([inicioPausa, t]); inicioPausa = null; }
    if (f.Tipo === 'SALIDA') { salida = hhmm(t); ultimaSalida = t; }
  });
  if (inicioPausa !== null) descansos.push([inicioPausa, null]);
  var almuerzo = null, comida = null, extra = 0;
  descansos.forEach(function (d) {
    if (minutosDia(d[0]) < 720) { if (!almuerzo) almuerzo = d; else extra++; }
    else { if (!comida) comida = d; else extra++; }
  });
  var fmt = function (d, i) { return d && d[i] !== null ? hhmm(d[i]) : ''; };
  return { entrada: entrada, salida: salida, manual: manual, extra: extra,
           almIni: fmt(almuerzo, 0), almFin: fmt(almuerzo, 1), comIni: fmt(comida, 0), comFin: fmt(comida, 1) };
}

/** Registro sencillo para la Inspección de Trabajo: un día por fila con entrada, descansos y salida. */
function rellenarInspeccion_(ss, usuario, mes, ctx) {
  var email = normEmail_(usuario.Email);
  var porDia = {};
  ctx.fichajes.forEach(function (f) {
    if (normEmail_(f.Email) !== email) return;
    var d = fechaTexto_(f.Fecha, ctx.tz);
    (porDia[d] = porDia[d] || []).push(f);
  });
  var sh = hojaLimpia_(ss, 'Registro de jornada', 0);
  var y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
  var diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();

  sh.getRange('A1').setValue('REGISTRO DIARIO DE JORNADA').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2:J5').setValues([
    ['Empresa:', '', ctx.empresa, '', '', '', 'CIF:', ctx.cif, '', ''],
    ['Trabajador/a:', '', usuario.Nombre, '', '', '', 'NIF:', usuario.NIF || '', '', ''],
    ['Modalidad:', '', MODALIDAD[usuario.Perfil] || usuario.Perfil, '', '', '', 'Mes:', nombreMes_(mes), '', ''],
    ['Base legal:', '', 'Art. 34.9 del Estatuto de los Trabajadores', '', '', '', '', '', '', '']
  ]);
  sh.getRange('A2:A5').setFontWeight('bold');
  sh.getRange('G2:G4').setFontWeight('bold');

  sh.getRange(7, 4, 1, 4).setValues([['Almuerzo', '', 'Comida', '']]);
  sh.getRange(7, 4, 1, 2).merge();
  sh.getRange(7, 6, 1, 2).merge();
  var cab = ['Fecha', 'Día', 'Entrada', 'Inicio', 'Fin', 'Inicio', 'Fin', 'Salida', 'Horas', ''];
  sh.getRange(8, 1, 1, 9).setValues([cab.slice(0, 9)]);
  sh.getRange(7, 1, 2, 9).setFontWeight('bold').setBackground('#0f3d5e').setFontColor('#ffffff').setHorizontalAlignment('center');

  var filas = [], fondos = [], totalMin = 0, hayManual = false;
  for (var d = 1; d <= diasMes; d++) {
    var fecha = mes + '-' + ('0' + d).slice(-2);
    var dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    var lista = porDia[fecha] || [];
    var x = descansosDelDia_(lista, ctx.tz);
    var j = calcularJornada_(lista);
    if (lista.length) totalMin += j.minutos;
    if (x.manual) hayManual = true;
    filas.push([('0' + d).slice(-2) + '/' + ('0' + m).slice(-2) + '/' + y + (x.manual ? ' *' : ''), DIAS[dow],
                x.entrada, x.almIni, x.almFin, x.comIni, x.comFin, x.salida, lista.length ? j.minutos / 1440 : '']);
    var finde = dow === 0 || dow === 6;
    fondos.push([0, 1, 2, 3, 4, 5, 6, 7, 8].map(function () { return finde ? '#f1f3f5' : '#ffffff'; }));
  }
  var r0 = 9;
  sh.getRange(r0, 1, filas.length, 9).setValues(filas).setBackgrounds(fondos).setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true, '#b8c2cc', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(r0, 9, filas.length, 1).setNumberFormat('[h]:mm');
  var rt = r0 + filas.length;
  sh.getRange(rt, 1, 1, 9).setFontWeight('bold').setBackground('#e8eef3');
  sh.getRange(rt, 1).setValue('TOTAL MES');
  sh.getRange(rt, 9).setFormula('=SUM(I' + r0 + ':I' + (rt - 1) + ')').setNumberFormat('[h]:mm').setHorizontalAlignment('center');

  var notas = ['Cada hora corresponde a un fichaje realizado personalmente por el trabajador/a en la aplicación de control horario, con su usuario y PIN.'];
  if (hayManual) notas.push('* Día con algún fichaje añadido por la empresa a petición del trabajador/a; el motivo consta en el registro completo.');
  notas.push('Documento generado el ' + Utilities.formatDate(new Date(), ctx.tz, 'dd/MM/yyyy HH:mm') + '.');
  notas.forEach(function (n, i) { sh.getRange(rt + 2 + i, 1).setValue(n).setFontSize(9).setFontColor('#5b6b78'); });
  var rf = rt + 3 + notas.length;
  sh.getRange(rf, 1).setValue('Firma de la empresa:').setFontWeight('bold');
  sh.getRange(rf, 6).setValue('Firma del trabajador/a:').setFontWeight('bold');
  sh.getRange(rf + 3, 1, 1, 4).setBorder(true, null, null, null, null, null);
  sh.getRange(rf + 3, 6, 1, 4).setBorder(true, null, null, null, null, null);

  [82, 38, 62, 56, 56, 56, 56, 62, 96].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1, rf + 4, 10).setFontFamily('Arial');
  sh.setFrozenRows(8);
  borrarHojasSobrantes_(ss, ['Registro de jornada']);
  SpreadsheetApp.flush();
  return { minutos: totalMin };
}

function rellenarResumenMes_(ss, mes, filas, ctx) {
  var sh = hojaLimpia_(ss, 'Resumen', 0);
  sh.getRange('A1').setValue('RESUMEN DE JORNADA · ' + nombreMes_(mes).toUpperCase()).setFontSize(14).setFontWeight('bold');
  sh.getRange('A2').setValue(ctx.empresa + (ctx.cif ? ' · CIF ' + ctx.cif : ''));
  var cab = ['Trabajador/a', 'NIF', 'Email', 'Perfil', 'Días con fichaje', 'Horas efectivas', 'Días con incidencia'];
  sh.getRange(4, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#0f3d5e').setFontColor('#ffffff');
  filas.sort(function (a, c) { return String(a[0]).localeCompare(String(c[0]), 'es'); });
  if (filas.length) {
    sh.getRange(5, 1, filas.length, cab.length).setValues(filas);
    sh.getRange(5, 6, filas.length, 1).setNumberFormat('[h]:mm');
    var rt = 5 + filas.length;
    sh.getRange(rt, 1).setValue('TOTAL');
    sh.getRange(rt, 6).setFormula('=SUM(F5:F' + (rt - 1) + ')').setNumberFormat('[h]:mm');
    sh.getRange(rt, 1, 1, cab.length).setFontWeight('bold').setBackground('#e8eef3');
  }
  [200, 100, 230, 100, 120, 120, 140].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1, filas.length + 6, cab.length).setFontFamily('Arial');
  borrarHojasSobrantes_(ss, ['Resumen']);
  SpreadsheetApp.flush();
}

function hojaLimpia_(ss, nombre, posicion) {
  var sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre, posicion);
  } else {
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.clear();
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
    sh.setFrozenRows(0);
  }
  return sh;
}

function borrarHojasSobrantes_(ss, mantener) {
  ss.getSheets().forEach(function (s) { if (mantener.indexOf(s.getName()) < 0) ss.deleteSheet(s); });
}

function exportarXlsx_(ssId) {
  var url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx';
  var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Exportación a Excel fallida: HTTP ' + r.getResponseCode());
  return r.getBlob();
}

function nombreInforme_(usuario, mes, formato) {
  var limpio = String(usuario.Nombre || usuario.Email).replace(/[\\\/:*?"<>|]/g, '').trim();
  return mes + ' - ' + limpio + (formato === 'completo' ? ' (completo)' : '') + '.xlsx';
}

function nombreMes_(mes) { return MESES[Number(mes.slice(5, 7)) - 1] + ' de ' + mes.slice(0, 4); }

/** Carpeta Drive: "Registro de jornada (archivo)/AAAA/MM - mes". Crea lo que falte. */
function carpetaMes_(mes) {
  var props = PropertiesService.getScriptProperties();
  var raiz = null, id = props.getProperty('CARPETA_ARCHIVO_ID');
  if (id) { try { raiz = DriveApp.getFolderById(id); if (raiz.isTrashed()) raiz = null; } catch (e) { raiz = null; } }
  if (!raiz) {
    raiz = DriveApp.createFolder('Registro de jornada (archivo)');
    props.setProperty('CARPETA_ARCHIVO_ID', raiz.getId());
  }
  var anio = subcarpeta_(raiz, mes.slice(0, 4));
  return subcarpeta_(anio, mes.slice(5, 7) + ' - ' + MESES[Number(mes.slice(5, 7)) - 1]);
}

function subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/** Guarda el archivo; si ya existía uno con el mismo nombre, lo envía a la papelera (queda la versión nueva). */
function guardarEnCarpeta_(carpeta, blob) {
  var it = carpeta.getFilesByName(blob.getName());
  while (it.hasNext()) it.next().setTrashed(true);
  return carpeta.createFile(blob);
}

// --- Archivo automático mensual ---
function adminArchivoAuto_(b) {
  exigirAdmin_(b);
  var activar = !!b.activar;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'archivarMesAnteriorAuto') ScriptApp.deleteTrigger(t);
  });
  if (activar) ScriptApp.newTrigger('archivarMesAnteriorAuto').timeBased().onMonthDay(1).atHour(4).create();
  return { ok: true, archivoAuto: activar,
           mensaje: activar ? 'Cada día 1 a las 4:00 se archivará el mes anterior en Google Drive.' : 'Archivo automático desactivado.' };
}

/** Lo ejecuta el activador del día 1: archiva el mes anterior. */
function archivarMesAnteriorAuto() {
  var tz = Session.getScriptTimeZone();
  var hoy = new Date();
  var y = Number(Utilities.formatDate(hoy, tz, 'yyyy')), m = Number(Utilities.formatDate(hoy, tz, 'MM')) - 1;
  if (m === 0) { m = 12; y--; }
  archivarMes_(y + '-' + ('0' + m).slice(-2));
}

// ============================================================
// 13. ADMIN: CSV DETALLADO (auditoría)
// ============================================================
function adminExport_(b) {
  exigirAdmin_(b);
  var tz = Session.getScriptTimeZone();
  if (!esFecha_(b.desde) || !esFecha_(b.hasta) || b.desde > b.hasta) throw errorPublico_('Rango de fechas no válido.');
  var empresa = config_('EMPRESA', ''), cif = config_('CIF', '');
  var usuarios = {};
  leerTabla_(HOJAS.USUARIOS).forEach(function (x) { usuarios[normEmail_(x.Email)] = x; });
  var filas = [['Empresa', 'CIF', 'Trabajador', 'NIF', 'Email', 'Fecha', 'Hora', 'Tipo', 'Modalidad', 'Latitud', 'Longitud',
                'Precisión (m)', 'Distancia sede (m)', 'Dirección', 'Google Maps', 'Origen', 'ID', 'Hash']];
  leerTabla_(HOJAS.FICHAJES).forEach(function (f) {
    var d = fechaTexto_(f.Fecha, tz);
    if (d < b.desde || d > b.hasta) return;
    var us = usuarios[normEmail_(f.Email)] || {};
    filas.push([empresa, cif, f.Nombre, us.NIF || '', f.Email, d, horaTexto_(f.Hora, tz), etiquetaTipo_(f.Tipo), f.Modalidad,
                f.Latitud, f.Longitud, f.Precision_m, f.Distancia_Sede_m, f.Direccion, f.Enlace_Maps, f.Origen, f.ID, f.Hash]);
  });
  var csv = filas.map(function (r) { return r.map(celdaCsv_).join(';'); }).join('\r\n');
  return { ok: true, nombreArchivo: 'fichajes_' + b.desde + '_' + b.hasta + '.csv', csv: csv };
}

function celdaCsv_(v) {
  var s = v instanceof Date ? v.toISOString() : String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ============================================================
// 14. MENÚ DE LA HOJA
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fichaje')
    .addItem('1. Crear / reparar estructura de hojas', 'configurarHojas')
    .addItem('2. Generar PIN para usuarios sin PIN', 'generarPINs')
    .addItem('Restablecer PIN del usuario seleccionado', 'restablecerPINSeleccionado')
    .addSeparator()
    .addItem('Recalcular hoja Jornadas', 'menuRecalcularJornadas')
    .addItem('Archivar mes anterior en Drive (Excel)', 'menuArchivarMesAnterior')
    .addItem('Verificar integridad de la cadena', 'verificarIntegridad')
    .addItem('Cerrar sesión de todos los dispositivos', 'cerrarTodasLasSesiones')
    .addToUi();
}

function configurarHojas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('Europe/Madrid');

  var cfg = asegurarHoja_(HOJAS.CONFIG, COLS.Config);
  var claves = leerTabla_(HOJAS.CONFIG).map(function (r) { return r.Clave; });
  CONFIG_DEFECTO.forEach(function (r) { if (claves.indexOf(r[0]) < 0) cfg.appendRow(r); });

  var sedes = asegurarHoja_(HOJAS.SEDES, COLS.Sedes);
  if (sedes.getLastRow() < 2) sedes.getRange(2, 1, 1, 6).setValues([['OFI1', 'Oficina central', 40.416775, -3.703790, 100, true]]);
  normalizarCasillas_(sedes, 6);

  var us = asegurarHoja_(HOJAS.USUARIOS, COLS.Usuarios);
  us.getRange('D2:D').clearDataValidations();
  us.getRange('E2:E').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PERFILES, true).build());
  us.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sedes.getRange('A2:A'), true).setAllowInvalid(true).build());
  normalizarCasillas_(us, 7);
  us.hideColumns(8, 3);

  var fi = asegurarHoja_(HOJAS.FICHAJES, COLS.Fichajes);
  fi.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  fi.getRange('C:D').setNumberFormat('@');

  asegurarHoja_(HOJAS.CORRECCIONES, COLS.Correcciones);

  var hj = ss.getSheetByName(HOJAS.JORNADAS);
  if (hj) ss.deleteSheet(hj); // elimina la versión antigua con fórmulas
  asegurarJornadas_();
  recalcularJornadas();

  [HOJAS.FICHAJES, HOJAS.CORRECCIONES, HOJAS.JORNADAS].forEach(function (n) {
    var h = ss.getSheetByName(n);
    var prot = h.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] || h.protect();
    prot.setDescription('Solo escribe el script');
    prot.removeEditors(prot.getEditors());
    if (prot.canDomainEdit()) prot.setDomainEdit(false);
  });

  SpreadsheetApp.getUi().alert('Estructura lista. Puedes gestionar empleados, sedes y ajustes desde el panel de administrador de la app.');
}

/**
 * Convierte TRUE/VERDADERO/Sí escritos como texto en casillas reales, SOLO en filas con datos.
 * (Las casillas vacías cuentan como contenido y harían que las altas nuevas se escribieran al final de la hoja.)
 */
function normalizarCasillas_(hoja, col) {
  var ultima = ultimaFilaCon_(hoja, 1);
  var max = hoja.getMaxRows();
  if (max > ultima) {
    var sobrante = hoja.getRange(ultima + 1, col, max - ultima, 1);
    sobrante.clearDataValidations();
    sobrante.clearContent();
  }
  if (ultima >= 2) {
    var r = hoja.getRange(2, col, ultima - 1, 1);
    var vals = r.getValues().map(function (v) { return [esVerdadero_(v[0])]; });
    r.insertCheckboxes();
    r.setValues(vals);
  }
}

/** Última fila (>=1) con algo escrito en la columna indicada. */
function ultimaFilaCon_(hoja, col) {
  var max = hoja.getMaxRows();
  if (max < 2) return 1;
  var vals = hoja.getRange(2, col, max - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim() !== '') return i + 2;
  return 1;
}

/** Escribe una fila en el primer hueco tras la última fila con datos (columna A) y pone casilla en colCasilla. */
function escribirFilaNueva_(hoja, valores, colCasilla) {
  var fila = ultimaFilaCon_(hoja, 1) + 1;
  if (fila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 10);
  hoja.getRange(fila, 1, 1, valores.length).setValues([valores]);
  if (colCasilla) {
    var c = hoja.getRange(fila, colCasilla);
    var v = esVerdadero_(valores[colCasilla - 1]);
    c.insertCheckboxes();
    c.setValue(v);
  }
  return fila;
}

function menuRecalcularJornadas() {
  var n = recalcularJornadas();
  SpreadsheetApp.getUi().alert('Jornadas recalculadas: ' + n + ' días-empleado.');
}

function menuArchivarMesAnterior() {
  var tz = Session.getScriptTimeZone();
  var hoy = new Date();
  var y = Number(Utilities.formatDate(hoy, tz, 'yyyy')), m = Number(Utilities.formatDate(hoy, tz, 'MM')) - 1;
  if (m === 0) { m = 12; y--; }
  var r = archivarMes_(y + '-' + ('0' + m).slice(-2));
  SpreadsheetApp.getUi().alert(r.mensaje + '\n' + r.carpetaUrl);
}

function generarPINs() {
  var datos = leerTabla_(HOJAS.USUARIOS);
  var salida = [];
  datos.forEach(function (d, i) {
    if (!d.Email || !esVerdadero_(d.Activo) || d.PIN_Hash) return;
    var pin = pinAleatorio_();
    escribirCeldas_(HOJAS.USUARIOS, i + 2, { PIN_Hash: hashPin_(normEmail_(d.Email), pin), Alta: d.Alta || new Date() });
    salida.push([d.Nombre, d.Email, pin]);
  });
  volcarPins_(salida);
}

function restablecerPINSeleccionado() {
  var h = SpreadsheetApp.getActiveSheet();
  if (h.getName() !== HOJAS.USUARIOS) return SpreadsheetApp.getUi().alert('Selecciona una fila en la hoja Usuarios.');
  var fila = h.getActiveRange().getRow();
  if (fila < 2) return;
  var d = filaAObjeto_(COLS.Usuarios, h.getRange(fila, 1, 1, COLS.Usuarios.length).getValues()[0]);
  var pin = pinAleatorio_();
  escribirCeldas_(HOJAS.USUARIOS, fila, { PIN_Hash: hashPin_(normEmail_(d.Email), pin), Token_Hash: '', Token_Caduca: '' });
  volcarPins_([[d.Nombre, d.Email, pin]]);
}

function volcarPins_(filas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(HOJAS.PINS) || ss.insertSheet(HOJAS.PINS);
  if (h.getLastRow() === 0) h.appendRow(['Nombre', 'Email', 'PIN (entregar en privado y BORRAR esta hoja después)']);
  filas.forEach(function (r) { h.appendRow(r); });
  SpreadsheetApp.getUi().alert(filas.length + ' PIN generados en la hoja "' + HOJAS.PINS + '". Entrégalos y borra la hoja.');
}

function pinAleatorio_() {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  var n = 0;
  for (var i = 0; i < 4; i++) n = n * 256 + (bytes[i] & 0xff);
  return ('000000' + (n % 1000000)).slice(-6);
}

function verificarIntegridad() {
  SpreadsheetApp.getUi().alert(comprobarCadena_().mensaje);
}

function cerrarTodasLasSesiones() {
  var h = hoja_(HOJAS.USUARIOS);
  var n = h.getLastRow();
  if (n < 2) return;
  h.getRange(2, COLS.Usuarios.indexOf('Token_Hash') + 1, n - 1, 2).clearContent();
  SpreadsheetApp.getUi().alert('Sesiones cerradas. Todos deberán volver a entrar con su PIN.');
}

// ============================================================
// 15. UTILIDADES
// ============================================================
function hoja_(nombre) {
  var h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!h) throw new Error('Falta la hoja ' + nombre + '. Ejecuta Fichaje > Crear estructura.');
  return h;
}

function asegurarHoja_(nombre, cabeceras) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  h.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]).setFontWeight('bold').setBackground('#eef2f7');
  h.setFrozenRows(1);
  return h;
}

function leerTabla_(nombre) {
  var h = hoja_(nombre);
  var n = h.getLastRow();
  if (n < 2) return [];
  var cab = COLS[nombre];
  return h.getRange(2, 1, n - 1, cab.length).getValues().map(function (r) { return filaAObjeto_(cab, r); });
}

function filaAObjeto_(cab, fila) {
  var o = {};
  cab.forEach(function (c, i) { o[c] = fila[i]; });
  return o;
}

function buscarUsuario_(campo, valor) {
  var h = hoja_(HOJAS.USUARIOS);
  var n = h.getLastRow();
  if (n < 2 || !valor) return null;
  var valores = h.getRange(2, 1, n - 1, COLS.Usuarios.length).getValues();
  var col = COLS.Usuarios.indexOf(campo);
  for (var i = 0; i < valores.length; i++) {
    var v = campo === 'Email' ? normEmail_(valores[i][col]) : String(valores[i][col]);
    if (v === valor) return { fila: i + 2, datos: filaAObjeto_(COLS.Usuarios, valores[i]) };
  }
  return null;
}

function escribirCeldas_(nombreHoja, fila, cambios) {
  var h = hoja_(nombreHoja);
  Object.keys(cambios).forEach(function (c) { h.getRange(fila, COLS[nombreHoja].indexOf(c) + 1).setValue(cambios[c]); });
}

function sedeDe_(usuario) {
  if (!usuario.ID_Sede) return null;
  var lista = leerTabla_(HOJAS.SEDES);
  for (var i = 0; i < lista.length; i++) {
    if (String(lista[i].ID_Sede) === String(usuario.ID_Sede) && esVerdadero_(lista[i].Activa)) return lista[i];
  }
  return null;
}

function config_(clave, porDefecto, sinCache) {
  var cache = CacheService.getScriptCache();
  if (!sinCache) { var c = cache.get('cfg_' + clave); if (c !== null) return c; }
  var datos = leerTabla_(HOJAS.CONFIG);
  for (var i = 0; i < datos.length; i++) {
    if (datos[i].Clave === clave) { cache.put('cfg_' + clave, String(datos[i].Valor), 300); return datos[i].Valor; }
  }
  return porDefecto;
}

function sha256_(texto) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}

function hashPin_(email, pin) {
  var props = PropertiesService.getScriptProperties();
  var sal = props.getProperty('PIN_SALT');
  if (!sal) { sal = Utilities.getUuid(); props.setProperty('PIN_SALT', sal); }
  return sha256_(sal + '|' + email + '|' + pin);
}

function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function esVerdadero_(v) {
  if (v === true || v === 1) return true;
  var s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'VERDADERO' || s === 'SÍ' || s === 'SI' || s === '1';
}
/** Número tolerante con coma decimal ("38,578559"). */
function numero_(v, defecto) {
  if (typeof v === 'number' && isFinite(v)) return v;
  var n = Number(String(v === null || v === undefined ? '' : v).trim().replace(',', '.'));
  return String(v).trim() !== '' && isFinite(n) ? n : (defecto === undefined ? NaN : defecto);
}
function numeroONulo_(v) { var n = numero_(v); return isNaN(n) ? null : n; }
function esFecha_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function esMes_(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || '')); }
function fechaTexto_(v, tz) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v); }
function horaTexto_(v, tz) { return v instanceof Date ? Utilities.formatDate(v, tz, 'HH:mm:ss') : String(v); }
function etiquetaTipo_(t) { return { ENTRADA: 'Entrada', INICIO_PAUSA: 'Inicio pausa', FIN_PAUSA: 'Fin pausa', SALIDA: 'Salida' }[t] || t; }
function etiquetaEstado_(e) { return { FUERA: 'Fuera de jornada', DENTRO: 'Trabajando', PAUSA: 'En pausa' }[e] || e; }
