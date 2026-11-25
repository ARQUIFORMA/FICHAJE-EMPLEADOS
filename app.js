/* app.js — PWA de fichaje (v9: almuerzo/comida, ZIP en el navegador, vacaciones del año anterior) */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var S = { token: null, adminToken: null, usuario: null, sede: null, estado: 'FUERA', permitidos: ['ENTRADA'],
            precisionMax: 100, pos: null, geo: null, timerGps: null, offset: 0, empleados: [], sedesLista: [], ajustes: null,
            calMes: null, calDatos: null, empresas: [], filtro: '', logosEmp: {}, logoDestino: null };
  var $ = function (id) { return document.getElementById(id); };
  var ETQ = { ENTRADA: 'Entrada', INICIO_PAUSA: 'Inicio pausa', FIN_PAUSA: 'Fin pausa', SALIDA: 'Salida',
              INICIO_ALMUERZO: 'Inicio almuerzo', FIN_ALMUERZO: 'Fin almuerzo', INICIO_COMIDA: 'Inicio comida', FIN_COMIDA: 'Fin comida' };
  var TIPOS_ELEGIBLES = ['ENTRADA', 'INICIO_ALMUERZO', 'FIN_ALMUERZO', 'INICIO_COMIDA', 'FIN_COMIDA', 'SALIDA'];
  var HORA_COMIDA = 13; // antes de las 13:00 es almuerzo (cuenta como trabajo); desde las 13:00, comida
  /** Etiqueta de un fichaje: la del servidor si la trae; si no, por la hora (almuerzo antes de las 13:00). */
  function etq(f) {
    if (f.etiqueta) return f.etiqueta;
    if (f.tipo === 'INICIO_PAUSA' || f.tipo === 'FIN_PAUSA') {
      var h = f.fechaHora ? new Date(f.fechaHora).getHours() : Number(String(f.hora || '0').split(':')[0]);
      return (f.tipo === 'INICIO_PAUSA' ? 'Inicio ' : 'Fin ') + (h < HORA_COMIDA ? 'almuerzo' : 'comida');
    }
    return ETQ[f.tipo] || f.tipo;
  }
  /** Para elegir en los formularios: «Inicio pausa» de un fichaje ya guardado → almuerzo o comida. */
  function tipoConNombre(f) {
    var e = etq(f).toUpperCase().replace(' ', '_');
    return TIPOS_ELEGIBLES.indexOf(e) >= 0 ? e : f.tipo;
  }
  function validarTipoHora(tipo, hora) {
    var h = Number(String(hora || '0').split(':')[0]);
    if (tipo === 'INICIO_ALMUERZO' && h >= HORA_COMIDA) return 'El almuerzo empieza antes de las 13:00. A partir de esa hora es la comida.';
    if (tipo === 'INICIO_COMIDA' && h < HORA_COMIDA) return 'La comida empieza a partir de las 13:00. Antes es el almuerzo.';
    return '';
  }
  var EST = { FUERA: 'Fuera de jornada', DENTRO: 'Trabajando', PAUSA: 'En pausa' };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // ---------- Utilidades ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.add('hidden'); }, ms || 4500);
  }
  function cargando(on, txt) { $('cargando').classList.toggle('hidden', !on); $('cargando-txt').textContent = txt || ''; }
  function hoyISO() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function hora(iso) { return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function fechaLarga(iso) { return new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function num(v) { return Number(String(v).trim().replace(',', '.')); }
  function radioSede() { return S.sede ? S.sede.radio : 100; }
  function nombreEmpresa(id) { var e = S.empresas.filter(function (x) { return x.id === id; })[0]; return e ? e.nombre : ''; }
  function multiempresa() { return S.empresas.length > 1; }
  function deFiltro(u) { return !S.filtro || u.idEmpresa === S.filtro; }
  function actualizarEmpresas(lista) {
    if (!lista) return;
    S.empresas = lista;
    var sel = $('adm-empresa'), previo = S.filtro;
    sel.innerHTML = '<option value="">Todas las empresas</option>' + lista.map(function (e) {
      return '<option value="' + esc(e.id) + '">' + esc(e.nombre) + (e.activa ? '' : ' (inactiva)') + '</option>';
    }).join('');
    sel.value = lista.some(function (e) { return e.id === previo; }) ? previo : '';
    S.filtro = sel.value;
    $('adm-filtro').classList.toggle('hidden', !multiempresa());
  }
  function exigeOficina() { return S.usuario && S.usuario.perfil === 'Oficina' && S.usuario.exigeOficina !== false; }
  var TIPOS_CAL = { FESTIVO: 'Festivo', VACACIONES: 'Vacaciones', BAJA: 'Baja médica', ASUNTOS_PROPIOS: 'Asuntos propios', PERMISO: 'Permiso' };
  function fechaCorta(f) { var p = f.split('-'); return Number(p[2]) + '/' + Number(p[1]) + '/' + p[0]; }
  function msgFueraRango() { return 'Te encuentras fuera del rango de la oficina (' + radioSede() + ' m). No puedes fichar en modalidad presencial'; }

  function opcionesMeses(sel, n) {
    var d = new Date(), html = '';
    for (var i = 0; i < n; i++) {
      var y = d.getFullYear(), m = d.getMonth() + 1;
      var v = y + '-' + ('0' + m).slice(-2);
      html += '<option value="' + v + '">' + MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1) + ' ' + y + '</option>';
      d.setDate(1); d.setMonth(d.getMonth() - 1);
    }
    sel.innerHTML = html;
  }

  var enVuelo = 0;
  function barra(d) { enVuelo = Math.max(0, enVuelo + d); $('barra').classList.toggle('hidden', !enVuelo); }
  function api(payload) {
    if (!navigator.onLine) return Promise.reject(new Error('Sin conexión a Internet.'));
    barra(1);
    if (S.token && !payload.token) payload.token = S.token;
    if (payload.action.indexOf('admin') === 0 && payload.action !== 'adminUnlock') payload.adminToken = S.adminToken;
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('Servidor no disponible (' + r.status + ').'); return r.json(); })
      .then(function (j) {
        if (!j.ok) {
          if (j.codigo === 'SESION') cerrarSesionLocal();
          if (j.codigo === 'ADMIN_BLOQUEADO') bloquearAdmin();
          throw new Error(j.error || 'Error desconocido');
        }
        return j;
      })
      .finally(function () { barra(-1); });
  }

  function descargar(nombre, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function descargarBase64(r, tipo) {
    var bin = atob(r.base64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    descargar(r.nombreArchivo, new Blob([bytes], { type: tipo }));
  }
  function descargarXlsx(r) { descargarBase64(r, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }

  function abrirModal(html) { $('modal-hoja').innerHTML = html; $('modal').classList.remove('hidden'); }
  function cerrarModal() { S.modalFijo = false; $('modal').classList.add('hidden'); $('modal-hoja').innerHTML = ''; }
  $('modal').addEventListener('click', function (e) { if (e.target.id === 'modal' && !S.modalFijo) cerrarModal(); });

  // ---------- Navegación ----------
  function mostrar(vista) {
    ['v-login', 'v-fichar', 'v-historial', 'v-vacaciones', 'v-admin', 'v-ajustes', 'v-coches'].forEach(function (v) { $(v).classList.toggle('hidden', v !== vista); });
    var enCoches = vista === 'v-coches';
    document.body.classList.toggle('en-coches', enCoches);
    $('h-volver').classList.toggle('hidden', !enCoches);
    $('h-perfil').classList.toggle('hidden', enCoches || !S.usuario);
    if (enCoches) abrirCoches(); else if ($('coches-frame')) $('coches-frame').classList.add('hidden');
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('activo', b.dataset.v === vista); });
    if (vista === 'v-historial') cargarHistorial();
    if (vista === 'v-vacaciones') abrirSolTab(S.solTab || 'sol-vac');
    if (vista === 'v-ajustes') cargarMisNominas();
    if (vista === 'v-admin') { if (S.adminToken) abrirPanel('p-hoy'); else setTimeout(function () { $('adm-pin').focus(); }, 50); }
  }
  document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { mostrar(b.dataset.v); }); });

  // ---------- Coches: la app de reservas va dentro de esta, con la misma sesión ----------
  var COCHES_URL = CFG.COCHES_URL || 'https://arquiforma.github.io/RESERVAR-COCHES/';
  function abrirCoches(seccion) {
    var f = $('coches-frame');
    if (!f) {
      f = document.createElement('iframe');
      f.id = 'coches-frame'; f.title = 'Coches';
      f.setAttribute('allow', 'camera; geolocation');
      f.src = COCHES_URL + '?embebida=1#' + (seccion || 'llaves');
      document.body.appendChild(f);
    } else if (seccion) {
      try { f.contentWindow.location.hash = seccion; } catch (e) { f.src = COCHES_URL + '?embebida=1#' + seccion; }
    }
    colocarCoches(f);
    f.classList.remove('hidden');
  }
  $('h-volver').addEventListener('click', function () { mostrar('v-fichar'); });
  function colocarCoches(f) {
    var top = document.querySelector('header').offsetHeight;
    f.style.top = top + 'px';
    f.style.height = (window.innerHeight - top) + 'px';
  }
  window.addEventListener('resize', function () { var f = $('coches-frame'); if (f) colocarCoches(f); });
  /** Deja a la app de coches (mismo dominio) la sesión y la dirección del servidor de Fichaje. */
  function compartirSesion() {
    try {
      localStorage.setItem('fichaje_api', CFG.API_URL);
      localStorage.setItem('fichaje_url', location.href.split('#')[0].split('?')[0]);
    } catch (e) { /* */ }
  }

  // ---------- Sesión ----------
  function guardarToken(t) { try { localStorage.setItem('fichaje_token', t); } catch (e) { /* */ } }
  function leerToken() { try { return localStorage.getItem('fichaje_token'); } catch (e) { return null; } }
  function cerrarSesionLocal() {
    try { localStorage.removeItem('fichaje_token'); localStorage.removeItem('fichaje_estado'); } catch (e) { /* */ }
    S.provisional = false;
    S.token = null; S.adminToken = null; pararGps();
    var cf = $('coches-frame'); if (cf) cf.remove();
    $('nav').classList.add('hidden'); $('h-perfil').classList.add('hidden');
    $('h-titulo').textContent = 'Fichaje'; $('h-sub').textContent = CFG.EMPRESA || 'Registro de jornada';
    mostrar('v-login');
  }
  $('f-login').addEventListener('submit', function (ev) {
    ev.preventDefault(); cargando(true);
    api({ action: 'login', email: $('i-email').value.trim(), pin: $('i-pin').value.trim() })
      .then(function (r) { S.token = r.token; guardarToken(r.token); $('i-pin').value = ''; return iniciar(); })
      .catch(function (e) { toast(e.message); })
      .finally(function () { cargando(false); });
  });
  $('b-salir').addEventListener('click', function () { api({ action: 'logout' }).catch(function () {}).finally(cerrarSesionLocal); });

  // ---------- Pantalla principal ----------
  function guardarEstadoLocal(r) { try { localStorage.setItem('fichaje_estado', JSON.stringify(r)); } catch (e) { /* */ } }
  function leerEstadoLocal() { try { return JSON.parse(localStorage.getItem('fichaje_estado') || 'null'); } catch (e) { return null; } }
  /** Pinta al instante con lo último conocido; el botón de fichar espera al estado real del servidor. */
  function iniciarDesdeCache() {
    var r = leerEstadoLocal();
    if (!r || !r.usuario) return false;
    S.provisional = true;
    pintarInicio(r, true);
    return true;
  }
  function iniciar() {
    return api({ action: 'estado' }).then(function (r) {
      guardarEstadoLocal(r);
      var yaPintado = S.provisional;
      S.provisional = false;
      pintarInicio(r, false, yaPintado);
    });
  }
  function pintarInicio(r, provisional, yaPintado) {
    { // eslint-disable-line no-lone-blocks
      S.usuario = r.usuario; S.sede = r.sede; S.precisionMax = r.precisionMax;
      compartirSesion();
      if (!provisional) S.offset = new Date(r.horaServidor).getTime() - Date.now();
      aplicarEstado(r.estado, r.permitidos, r.ultimo);
      $('h-titulo').textContent = r.usuario.nombre;
      $('h-sub').textContent = r.empresa || CFG.EMPRESA || '';
      var p = $('h-perfil'); p.textContent = r.usuario.perfil; p.className = 'perfil ' + r.usuario.perfil;
      $('nav').classList.remove('hidden');
      $('nav-admin').classList.toggle('hidden', !r.usuario.esAdmin);
      $('nav-coches').classList.toggle('hidden', !r.cochesUnico);
      S.nominasActivas = !!r.nominasActivas;
      $('yo-nominas').classList.toggle('hidden', !S.nominasActivas);
      $('aj-nombre').textContent = r.usuario.nombre; $('aj-email').textContent = r.usuario.email;
      $('aj-perfil').textContent = r.usuario.perfil; $('aj-sede').textContent = r.sede ? r.sede.nombre + ' (radio ' + r.sede.radio + ' m)' : '—';
      $('aviso-jornada').innerHTML = r.jornadaAbierta
        ? '<div class="aviso warn">Tu jornada del ' + esc(fechaCorta(r.jornadaAbierta.fecha)) + ' quedó sin ' +
          (r.jornadaAbierta.tipo === 'INICIO_PAUSA' ? 'terminar la pausa' : 'fichar la salida') + '.' +
          '<div style="margin-top:8px"><button class="btn sec peq" id="b-pedir-corr">Pedir la corrección</button></div></div>'
        : '';
      if ($('b-pedir-corr')) $('b-pedir-corr').addEventListener('click', function () {
        var ja = r.jornadaAbierta;
        mostrar('v-vacaciones'); abrirSolTab('sol-cor');
        $('co-fecha').value = ja.fecha; itemsCorreccion([{ tipo: ja.tipo === 'INICIO_PAUSA' ? 'FIN_COMIDA' : 'SALIDA', hora: '' }]);
        if (ja.tipo !== 'INICIO_PAUSA') { var d = new Date(ja.fecha + 'T12:00:00').getDay(); $('co-items').querySelector('.co-hora').value = d === 5 ? '14:00' : '17:30'; }
      });
      cargarLogo(r.logoVer);
      if (!provisional && !yaPintado) prepararGeo();
      else if (provisional) { S.geo = null; actualizarBoton(); }
      else actualizarBoton();
      if (yaPintado) return; // ya estaba en pantalla: solo se refrescan los datos
      var h = location.hash.slice(1);
      if (r.cochesUnico && (h === 'coches' || h === 'llaves' || h === 'reservar')) { mostrar('v-coches'); abrirCoches(h === 'coches' ? 'llaves' : h); }
      else mostrar('v-fichar');
    }
  }

  // ---------- Logo ----------
  function pintarLogo(src) {
    var img = $('h-logo');
    if (src) { img.src = src; img.classList.remove('hidden'); } else { img.removeAttribute('src'); img.classList.add('hidden'); }
  }
  function cargarLogo(ver) {
    if (!ver) { pintarLogo(null); try { localStorage.removeItem('fichaje_logo'); } catch (e) { /* */ } return; }
    var guardado = null;
    try { guardado = JSON.parse(localStorage.getItem('fichaje_logo') || 'null'); } catch (e) { /* */ }
    if (guardado && guardado.v === ver) return pintarLogo(guardado.src);
    api({ action: 'logo' }).then(function (r) {
      if (!r.logo) return pintarLogo(null);
      var src = 'data:' + r.logo.mime + ';base64,' + r.logo.base64;
      try { localStorage.setItem('fichaje_logo', JSON.stringify({ v: ver, src: src })); } catch (e) { /* */ }
      pintarLogo(src);
    }).catch(function () {});
  }

  function aplicarEstado(estado, permitidos, ultimo) {
    S.estado = estado; S.permitidos = permitidos;
    var txt = '<b>' + EST[estado] + '</b>';
    if (ultimo && estado !== 'FUERA') txt += ' · desde las ' + hora(ultimo.fechaHora);
    $('estado').innerHTML = txt;
    var b = $('b-principal'), esEntrada = permitidos.indexOf('ENTRADA') >= 0;
    b.className = 'fichar ' + (esEntrada ? 'entrada' : 'salida');
    b.innerHTML = 'Fichar<br>' + (esEntrada ? 'Entrada' : 'Salida') + '<small id="b-principal-sub"></small>';
    b.dataset.tipo = esEntrada ? 'ENTRADA' : 'SALIDA';
    var bp = $('b-pausa');
    var esAlmuerzo = new Date(Date.now() + S.offset).getHours() < 13;
    if (estado === 'DENTRO') { bp.textContent = esAlmuerzo ? 'Iniciar almuerzo' : 'Iniciar comida'; bp.dataset.tipo = 'INICIO_PAUSA'; bp.classList.remove('hidden'); }
    else if (estado === 'PAUSA') { bp.textContent = 'Terminar ' + (ultimo && new Date(ultimo.fechaHora).getHours() < 13 ? 'almuerzo' : 'comida') + ' y volver al trabajo'; bp.dataset.tipo = 'FIN_PAUSA'; bp.classList.remove('hidden'); }
    else bp.classList.add('hidden');
    actualizarBoton();
    $('c-ultimo').innerHTML = ultimo
      ? '<div class="m">Último fichaje</div><div style="font-size:16px;margin-top:4px"><b>' + esc(etq(ultimo)) + '</b> · ' +
        esc(fechaLarga(ultimo.fechaHora)) + ' a las ' + esc(hora(ultimo.fechaHora)) + '</div>'
      : '<div class="m">Aún no tienes fichajes.</div>';
  }

  function actualizarBoton() {
    var b = $('b-principal'), sub = $('b-principal-sub'), aviso = $('aviso-geo');
    var habilitado = S.permitidos.indexOf(b.dataset.tipo) >= 0;
    aviso.innerHTML = ''; if (sub) sub.textContent = '';
    if (S.estado === 'PAUSA') { habilitado = false; if (sub) sub.textContent = 'Termina la pausa antes'; }
    if (S.provisional) { b.disabled = true; if (sub) sub.textContent = 'Conectando…'; return; }
    if (exigeOficina() && habilitado) {
      if (!S.sede) { habilitado = false; aviso.innerHTML = '<div class="aviso bad">No tienes oficina asignada. Contacta con administración.</div>'; }
      else if (!S.geo) { habilitado = false; if (sub) sub.textContent = 'Buscando tu ubicación…'; }
      else if (S.geo.motivo === 'FUERA_RANGO') { habilitado = false; aviso.innerHTML = '<div class="aviso bad">' + esc(msgFueraRango()) + '</div>'; }
      else if (S.geo.motivo === 'PRECISION') { habilitado = false; aviso.innerHTML = '<div class="aviso warn">Señal GPS poco precisa (±' + Math.round(S.pos.precision) + ' m). Activa el wifi, acércate a una ventana o espera unos segundos.</div>'; }
      else if (S.geo.dentro) aviso.innerHTML = '<div class="aviso ok">Estás en ' + esc(S.sede.nombre) + ' (a ' + S.geo.distancia + ' m).</div>';
      if (S.geo) $('gps-info').textContent = 'Distancia a la oficina: ' + S.geo.distancia + ' m · precisión ±' + Math.round(S.pos.precision) + ' m · radio permitido ' + S.sede.radio + ' m';
    }
    b.disabled = !habilitado;
  }

  // ---------- GPS ----------
  function prepararGeo() {
    pararGps(); S.geo = null; S.pos = null; $('gps-info').textContent = '';
    var perfil = S.usuario.perfil;
    if (perfil === 'Oficina' && exigeOficina()) { refrescarPosicion(); S.timerGps = setInterval(refrescarPosicion, CFG.INTERVALO_GPS_MS || 15000); }
    else if (perfil === 'Oficina') $('gps-info').textContent = 'Puedes fichar desde cualquier sitio.';
    else if (perfil === 'Obra') $('gps-info').textContent = 'Al fichar se registrará la hora y tu ubicación en ese momento.';
    else $('gps-info').textContent = 'Teletrabajo: se registra solo la hora, sin ubicación.';
    actualizarBoton();
  }
  function pararGps() { if (S.timerGps) { clearInterval(S.timerGps); S.timerGps = null; } }
  function refrescarPosicion() {
    if (document.hidden) return;
    Geo.obtenerPosicion({ tiempoMax: 8000, precisionObjetivo: 20 })
      .then(function (pos) { S.pos = pos; S.geo = S.sede ? Geo.validarGeocerca(pos, S.sede, S.precisionMax) : null; actualizarBoton(); })
      .catch(function (e) { S.geo = null; S.pos = null; actualizarBoton(); $('aviso-geo').innerHTML = '<div class="aviso warn">' + esc(e.message) + '</div>'; });
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && S.token && S.usuario) {
      api({ action: 'estado' }).then(function (r) { S.sede = r.sede; aplicarEstado(r.estado, r.permitidos, r.ultimo); }).catch(function () {});
      if (exigeOficina()) refrescarPosicion();
    }
  });

  // ---------- Fichar ----------
  function fichar(tipo) {
    var perfil = S.usuario.perfil;
    cargando(true, perfil === 'Teletrabajo' ? '' : 'Obteniendo ubicación…');
    var obtener = perfil === 'Teletrabajo' ? Promise.resolve(null)
      : (perfil === 'Oficina' && !exigeOficina())
        ? Geo.obtenerPosicion({ tiempoMax: 6000, precisionObjetivo: 50 }).catch(function () { return null; })
        : Geo.obtenerPosicion({ tiempoMax: perfil === 'Obra' ? 12000 : 8000, precisionObjetivo: 20 });
    obtener.then(function (pos) {
      if (exigeOficina()) {
        var v = Geo.validarGeocerca(pos, S.sede, S.precisionMax);
        S.pos = pos; S.geo = v; actualizarBoton();
        if (!v.dentro) throw new Error(v.motivo === 'FUERA_RANGO' ? msgFueraRango() : 'Señal GPS poco precisa. Inténtalo de nuevo en unos segundos.');
      }
      cargando(true, 'Registrando…');
      return api({ action: 'fichar', tipo: tipo, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null,
                   precision: pos ? pos.precision : null, dispositivo: navigator.userAgent });
    }).then(function (r) {
      if (navigator.vibrate) navigator.vibrate(80);
      aplicarEstado(r.estado, r.permitidos, r.fichaje);
      var c = leerEstadoLocal(); if (c) { c.estado = r.estado; c.permitidos = r.permitidos; c.ultimo = r.fichaje; c.jornadaAbierta = null; guardarEstadoLocal(c); }
      toast('✔ ' + etq(r.fichaje) + ' registrada a las ' + hora(r.fichaje.fechaHora));
    }).catch(function (e) { toast(e.message, 6000); })
      .finally(function () { cargando(false); });
  }
  $('b-principal').addEventListener('click', function () { fichar(this.dataset.tipo); });
  $('b-pausa').addEventListener('click', function () { fichar(this.dataset.tipo); });

  function tic() {
    var d = new Date(Date.now() + S.offset);
    $('reloj').textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('fecha').textContent = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  setInterval(tic, 1000); tic();

  // ---------- Historial e informe propio ----------
  opcionesMeses($('h-mes'), 12); // el empleado solo puede descargar los últimos 12 meses
  function cargarHistorial() {
    var ul = $('l-historial'); ul.innerHTML = '<li class="m">Cargando…</li>';
    api({ action: 'historial', limite: 40 }).then(function (r) {
      if (!r.fichajes.length) { ul.innerHTML = '<li class="m">Sin fichajes todavía.</li>'; return; }
      ul.innerHTML = r.fichajes.map(function (f) {
        var extra = f.maps ? ' · <a href="' + esc(f.maps) + '" target="_blank" rel="noopener">ver mapa</a>' : '';
        var origen = f.origen === 'CORRECCION' ? ' <span class="chip">manual</span>' : '';
        return '<li><div><div class="t">' + esc(etq(f)) + origen + '</div><div class="m">' + esc(fechaLarga(f.fechaHora)) +
               ' · ' + esc(f.modalidad) + extra + '</div></div><div class="t">' + esc(hora(f.fechaHora)) + '</div></li>';
      }).join('');
    }).catch(function (e) { ul.innerHTML = '<li class="m">' + esc(e.message) + '</li>'; });
  }
  $('h-descargar').addEventListener('click', function () {
    cargando(true, 'Generando Excel…');
    api({ action: 'miInforme', mes: $('h-mes').value }).then(descargarXlsx)
      .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });

  // =================================================================
  // PANEL DE ADMINISTRADOR
  // =================================================================
  function bloquearAdmin() {
    S.adminToken = null;
    $('adm-contenido').classList.add('hidden'); $('adm-bloqueo').classList.remove('hidden');
  }
  $('f-admin').addEventListener('submit', function (ev) {
    ev.preventDefault(); cargando(true);
    api({ action: 'adminUnlock', pin: $('adm-pin').value.trim() }).then(function (r) {
      S.adminToken = r.adminToken; $('adm-pin').value = '';
      $('adm-bloqueo').classList.add('hidden'); $('adm-contenido').classList.remove('hidden');
      S.empleadosT = 0;
      abrirPanel('p-hoy'); cargarEmpleados(); actualizarBadge(); cargarAjustes();
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });
  $('adm-cerrar').addEventListener('click', function () { bloquearAdmin(); toast('Panel cerrado.'); });

  $('adm-empresa').addEventListener('change', function () {
    S.filtro = this.value;
    var activo = document.querySelector('#adm-seg button.activo');
    abrirPanel(activo ? activo.dataset.p : 'p-hoy');
  });

  function abrirPanel(id) {
    $('adm-bloqueo').classList.add('hidden'); $('adm-contenido').classList.remove('hidden');
    document.querySelectorAll('#adm-seg button[data-p]').forEach(function (b) { b.classList.toggle('activo', b.dataset.p === id); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('hidden', p.id !== id); });
    if (id === 'p-hoy') cargarResumen();
    if (id === 'p-calendario') cargarEmpleados().then(cargarCalendario);
    if (id === 'p-personal' || id === 'p-corregir' || id === 'p-informes' || id === 'p-nominas') cargarEmpleados();
    if (id === 'p-vacaciones') cargarSolicitudes();
    if (id === 'p-nominas') cargarNominas();
    if (id === 'p-ajustes' || (id === 'p-informes' && !S.ajustes)) cargarAjustes();
    if (id === 'p-extra') cargarHorasExtraAdmin();
    if (id === 'p-corregir') cargarCorreccionesAdmin();
    if (id === 'p-ajustes') cargarCoches();
  }
  document.querySelectorAll('#adm-seg button[data-p]').forEach(function (b) { b.addEventListener('click', function () { abrirPanel(b.dataset.p); }); });

  // ----- Hoy -----
  $('a-fecha').value = hoyISO();
  $('a-ver').addEventListener('click', cargarResumen);
  function cargarResumen() {
    if (!$('a-filas').innerHTML) $('a-filas').innerHTML = '<div class="m">Cargando…</div>';
    api({ action: 'adminResumen', fecha: $('a-fecha').value, empresa: S.filtro }).then(function (r) {
      var t = r.totales;
      $('a-festivo').innerHTML = r.festivo ? '<div class="aviso info">Día festivo: ' + esc(r.festivo) + '</div>' : '';
      $('a-kpis').innerHTML = [['Plantilla', t.plantilla], ['Ficharon', t.ficharon], ['Trabajando', t.trabajandoAhora], ['Incidencias', t.incidencias]]
        .map(function (k) { return '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join('');
      $('a-filas').innerHTML = r.filas.map(function (f) {
        var mapas = f.fichajes.filter(function (x) { return x.maps; }).map(function (x) {
          return '<a href="' + esc(x.maps) + '" target="_blank" rel="noopener">' + esc(etq(x)) + ' ' + esc(hora(x.fechaHora)) + '</a>' +
                 (x.direccion ? ' (' + esc(x.direccion) + ')' : '');
        }).join('<br>');
        var manual = f.fichajes.some(function (x) { return x.origen === 'CORRECCION'; }) ? ' · <span class="chip">manual</span>' : '';
        var estadoTxt = f.ausencia && !f.fichajes.length ? f.ausencia : f.estado + (f.ausencia ? ' · ' + f.ausencia : '');
        return '<div class="fila-admin"><div class="cab"><b>' + esc(f.nombre) + '</b><span class="perfil ' + esc(f.perfil) + '">' + esc(f.perfil) + '</span></div>' +
          (multiempresa() && !S.filtro ? '<div class="m">' + esc(f.empresa) + '</div>' : '') +
          '<div class="det">' + esc(estadoTxt) + (f.entrada ? ' · ' + esc(f.entrada) + '–' + esc(f.salida || '…') : '') +
          (f.horas ? ' · ' + esc(f.horas) : '') + (f.pausaMin ? ' · pausa ' + f.pausaMin + ' min' : '') +
          (f.extra && f.extra !== '0h 00m' ? ' · <b style="color:var(--bad)">+' + esc(f.extra) + ' extra</b>' : '') + manual +
          (f.incidencia ? ' · <span class="inc">' + esc(f.incidencia) + '</span>' : '') + '</div>' +
          (mapas ? '<div class="det">' + mapas + '</div>' : '') + '</div>';
      }).join('') || '<div class="m">No hay empleados activos.</div>';
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  }

  // ----- Personal -----
  function cargarEmpleados(forzar) {
    if (!forzar && S.empleadosT && Date.now() - S.empleadosT < 120000) return Promise.resolve();
    if (!forzar && S.empleadosP) return S.empleadosP;
    S.empleadosP = api({ action: 'adminUsuarios' }).then(function (r) {
      S.empleadosT = Date.now(); S.empleadosP = null;
      S.empleados = r.usuarios; S.sedesLista = r.sedes;
      actualizarEmpresas(r.empresas);
      pintarEmpleados();
      var opts = r.usuarios.filter(function (u) { return u.activo && deFiltro(u); }).map(function (u) {
        return '<option value="' + esc(u.email) + '">' + esc(u.nombre) + '</option>';
      }).join('');
      var cSel = $('c-empleado').value, iSel = $('i-empleado').value;
      $('c-empleado').innerHTML = opts + r.usuarios.filter(function (u) { return !u.activo && deFiltro(u); }).map(function (u) {
        return '<option value="' + esc(u.email) + '">' + esc(u.nombre) + ' (baja)</option>';
      }).join('');
      $('i-empleado').innerHTML = r.usuarios.filter(deFiltro).map(function (u) {
        return '<option value="' + esc(u.email) + '">' + esc(u.nombre) + (u.activo ? '' : ' (baja)') + '</option>';
      }).join('');
      if (cSel) $('c-empleado').value = cSel;
      if (iSel) $('i-empleado').value = iSel;
    }).catch(function (e) { S.empleadosP = null; toast(e.message); });
    return S.empleadosP;
  }
  function pintarEmpleados() {
    var q = $('u-buscar').value.trim().toLowerCase();
    var base = S.empleados.filter(deFiltro);
    var lista = base.filter(function (u) { return !q || (u.nombre + ' ' + u.email).toLowerCase().indexOf(q) >= 0; });
    var activos = base.filter(function (u) { return u.activo; }).length;
    $('u-cuenta').textContent = activos + ' activos · ' + (base.length - activos) + ' de baja' + (S.filtro ? ' · ' + nombreEmpresa(S.filtro) : '');
    $('u-lista').innerHTML = lista.map(function (u, i) {
      return '<li class="click" data-email="' + esc(u.email) + '"><div><div class="t">' + esc(u.nombre) + (u.esAdmin ? ' <span class="chip">admin</span>' : '') +
        (u.tienePin ? '' : ' <span class="chip">sin PIN</span>') + (u.sinGeocerca && u.perfil === 'Oficina' ? ' <span class="chip">ficha fuera</span>' : '') +
        '</div><div class="m">' + (multiempresa() && !S.filtro ? esc(nombreEmpresa(u.idEmpresa)) + ' · ' : '') + esc(u.puesto ? u.puesto + ' · ' : '') + esc(u.email) + '</div></div>' +
        '<span class="perfil ' + (u.activo ? esc(u.perfil) : 'baja') + '">' + (u.activo ? esc(u.perfil) : 'Baja') + '</span></li>';
    }).join('') || '<li class="m">Sin resultados.</li>';
    $('u-lista').querySelectorAll('li[data-email]').forEach(function (li) {
      li.addEventListener('click', function () { editarEmpleado(li.dataset.email); });
    });
  }
  $('u-buscar').addEventListener('input', pintarEmpleados);
  $('u-nuevo').addEventListener('click', function () { editarEmpleado(null); });
  $('u-pin-todos').addEventListener('click', function () {
    var quien = S.filtro ? 'los empleados de ' + nombreEmpresa(S.filtro) : 'todos los empleados activos';
    if (!confirm('¿Generar un PIN nuevo de 6 cifras para ' + quien + '?\n\nSus PIN actuales (también los de Coches) dejarán de funcionar y tendrán que volver a entrar. Tu PIN no cambia.')) return;
    if (!confirm('Confirma: la lista de PIN solo se mostrará una vez. Descárgala antes de cerrarla.')) return;
    cargando(true, 'Generando PIN…');
    api({ action: 'adminNuevoPinTodos', empresa: S.filtro }).then(function (r) { mostrarListaPins(r); cargarEmpleados(true); })
      .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
  });

  function mostrarListaPins(r) {
    var url = location.href.split('#')[0].split('?')[0];
    var filas = [['Nombre', 'Email', 'Empresa', 'PIN']].concat(r.lista.map(function (x) { return [x.nombre, x.email, x.empresa, x.pin]; }));
    var csv = filas.map(function (f) { return f.map(function (c) { c = String(c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(';'); }).join('\r\n');
    abrirModal('<h2>PIN nuevos</h2><p class="ayuda">' + esc(r.mensaje) + ' Descarga la lista ahora: por seguridad no se vuelve a mostrar.</p>' +
      '<ul class="lista">' + r.lista.map(function (x, i) {
        return '<li><div><div class="t">' + esc(x.nombre) + '</div><div class="m">' + esc(x.email) + '</div></div>' +
               '<div style="display:flex;gap:8px;align-items:center"><b style="font-size:18px;letter-spacing:2px">' + esc(x.pin) + '</b>' +
               (navigator.share ? '<button class="btn sec peq" data-i="' + i + '">Enviar</button>' : '') + '</div></li>';
      }).join('') + '</ul>' +
      '<div class="acciones"><button class="btn sec" id="lp-csv">Descargar lista (Excel)</button><button class="btn" id="lp-ok">Hecho</button></div>');
    S.modalFijo = true;
    $('lp-csv').addEventListener('click', function () {
      descargar('PIN_nuevos_' + hoyISO() + '.csv', new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    });
    $('lp-ok').addEventListener('click', function () { if (confirm('¿Has guardado la lista? No se volverá a mostrar.')) cerrarModal(); });
    $('modal-hoja').querySelectorAll('button[data-i]').forEach(function (b) {
      b.addEventListener('click', function () {
        var x = r.lista[Number(b.dataset.i)];
        navigator.share({ text: 'Hola ' + x.nombre + ', tu nuevo PIN para Fichaje y Coches es ' + x.pin +
          '.\nApp: ' + url + '\nUsuario: ' + x.email + '\nNo lo compartas.' }).catch(function () {});
      });
    });
  }

  function editarEmpleado(email) {
    var u = email ? S.empleados.filter(function (x) { return x.email === email; })[0]
      : { email: '', nombre: '', nif: '', perfil: 'Oficina', idSede: (S.sedesLista[0] || {}).id || '', activo: true,
          idEmpresa: S.filtro || ((S.empresas.filter(function (e) { return e.activa; })[0] || {}).id || '') };
    var empOpts = S.empresas.filter(function (e) { return e.activa || e.id === u.idEmpresa; }).map(function (e) {
      return '<option value="' + esc(e.id) + '"' + (e.id === u.idEmpresa ? ' selected' : '') + '>' + esc(e.nombre) + '</option>';
    }).join('');
    var nuevo = !email;
    var sedesOpts = '<option value="">— Sin sede —</option>' + S.sedesLista.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (String(u.idSede) === s.id ? ' selected' : '') + '>' + esc(s.nombre) + ' (' + esc(s.id) + ')</option>';
    }).join('');
    abrirModal(
      '<h2>' + (nuevo ? 'Nuevo empleado' : esc(u.nombre)) + '</h2>' +
      '<label for="m-email">Email de empresa</label><input id="m-email" type="email" value="' + esc(u.email) + '"' + (nuevo ? '' : ' disabled') + '>' +
      (nuevo ? '' : '<div class="m" style="margin-top:4px">El email no se puede cambiar porque identifica su histórico. Si cambia, da de baja y crea uno nuevo.</div>') +
      '<label for="m-nombre">Nombre completo</label><input id="m-nombre" value="' + esc(u.nombre) + '">' +
      (multiempresa() ? '<label for="m-empresa">Empresa</label><select id="m-empresa">' + empOpts + '</select>' : '<select id="m-empresa" class="hidden">' + empOpts + '</select>') +
      '<label for="m-puesto">Puesto / profesión (aparece en los Excel)</label><input id="m-puesto" value="' + esc(u.puesto || '') + '" placeholder="Ej.: Arquitecto técnico">' +
      '<label for="m-nif">NIF (opcional, aparece en los Excel)</label><input id="m-nif" value="' + esc(u.nif || '') + '">' +
      '<div class="fila2"><div><label for="m-perfil">Perfil</label><select id="m-perfil">' +
      ['Oficina', 'Obra', 'Teletrabajo'].map(function (p) { return '<option' + (u.perfil === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
      '</select></div><div><label for="m-sede">Sede</label><select id="m-sede">' + sedesOpts + '</select></div></div>' +
      '<div class="fila2"><div><label for="m-jornada">Horas por semana (contrato)</label><input id="m-jornada" type="number" inputmode="decimal" min="1" max="40" step="0.5" value="' + esc(u.jornadaSemanal || 40) + '"></div>' +
      '<div><label for="m-vac">Días de vacaciones/año</label><input id="m-vac" type="number" inputmode="numeric" min="0" max="60" value="' + esc(u.diasVacaciones == null ? '' : u.diasVacaciones) + '" placeholder="' + esc((S.ajustes && S.ajustes.config.VACACIONES_DIAS) || 22) + ' (general)"></div></div>' +
      '<div class="m" style="margin-top:4px">Con menos de 40 h, las horas previstas (y por tanto las extra) se calculan en proporción.</div>' +
      '<div class="interruptor" style="margin-top:16px" id="m-fuera-fila"><div><h3>Puede fichar fuera de la oficina</h3><div class="m">Solo afecta al perfil Oficina.</div></div>' +
      '<input type="checkbox" id="m-fuera"' + (u.sinGeocerca ? ' checked' : '') + '></div>' +
      '<div class="interruptor" style="margin-top:16px"><div><h3>Activo</h3><div class="m">Desactivar = baja. Su histórico se conserva.</div></div>' +
      '<input type="checkbox" id="m-activo"' + (u.activo ? ' checked' : '') + (u.esAdmin ? ' disabled' : '') + '></div>' +
      '<div class="acciones"><button class="btn sec" id="m-cancelar">Cancelar</button><button class="btn" id="m-guardar">' + (nuevo ? 'Crear y generar PIN' : 'Guardar') + '</button></div>' +
      (nuevo ? '' : '<button class="btn sec" id="m-pin" style="margin-top:10px">Generar PIN nuevo</button>' +
                    '<button class="btn sec" id="m-informe" style="margin-top:10px">Excel de este mes (Inspección)</button>')
    );
    var verFuera = function () { $('m-fuera-fila').classList.toggle('hidden', $('m-perfil').value !== 'Oficina'); };
    $('m-perfil').addEventListener('change', verFuera); verFuera();
    $('m-cancelar').addEventListener('click', cerrarModal);
    $('m-guardar').addEventListener('click', function () {
      var datos = { nuevo: nuevo, email: $('m-email').value.trim(), nombre: $('m-nombre').value.trim(), nif: $('m-nif').value.trim(),
                    perfil: $('m-perfil').value, idSede: $('m-sede').value, activo: $('m-activo').checked,
                    puesto: $('m-puesto').value.trim(), sinGeocerca: $('m-fuera').checked, idEmpresa: $('m-empresa').value,
                    jornadaSemanal: $('m-jornada').value, diasVacaciones: $('m-vac').value };
      cargando(true);
      api({ action: 'adminGuardarUsuario', usuario: datos }).then(function (r) {
        if (r.pin) mostrarPin(datos.nombre, datos.email, r.pin); else { cerrarModal(); toast(r.mensaje); }
        cargarEmpleados(true);
      }).catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
    if (!nuevo) {
      $('m-pin').addEventListener('click', function () {
        if (!confirm('¿Generar un PIN nuevo para ' + u.nombre + '? El actual dejará de funcionar y se cerrará su sesión.')) return;
        cargando(true);
        api({ action: 'adminResetPin', email: u.email }).then(function (r) { mostrarPin(r.nombre, u.email, r.pin); cargarEmpleados(true); })
          .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
      });
      $('m-informe').addEventListener('click', function () {
        cargando(true, 'Generando Excel…');
        api({ action: 'adminInforme', email: u.email, mes: hoyISO().slice(0, 7) }).then(descargarXlsx)
          .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
      });
    }
  }

  function mostrarPin(nombre, email, pin) {
    var url = location.href.split('#')[0].split('?')[0];
    var texto = 'Hola ' + nombre + ', ya puedes fichar desde el móvil.\nApp: ' + url + '\nUsuario: ' + email + '\nPIN: ' + pin +
                '\nInstálala en la pantalla de inicio (iPhone: Safari > Compartir > Añadir a pantalla de inicio · Android: Chrome > ⋮ > Instalar aplicación). No compartas tu PIN.';
    abrirModal('<h2>PIN de ' + esc(nombre) + '</h2><p class="ayuda">Apúntalo o envíaselo ahora: por seguridad no se vuelve a mostrar.</p>' +
      '<div class="pin-grande">' + esc(pin) + '</div>' +
      '<div class="acciones"><button class="btn sec" id="p-copiar">Copiar mensaje</button><button class="btn" id="p-ok">Hecho</button></div>' +
      (navigator.share ? '<button class="btn sec" id="p-compartir" style="margin-top:10px">Enviar por WhatsApp / email…</button>' : ''));
    $('p-ok').addEventListener('click', cerrarModal);
    $('p-copiar').addEventListener('click', function () {
      (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject()).then(function () { toast('Mensaje copiado.'); })
        .catch(function () { prompt('Copia el mensaje:', texto); });
    });
    if (navigator.share) $('p-compartir').addEventListener('click', function () { navigator.share({ text: texto }).catch(function () {}); });
  }

  // ----- Fichajes: ver y corregir -----
  function rangoMes(desplazamiento) {
    var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + desplazamiento);
    var ini = new Date(d.getFullYear(), d.getMonth(), 1), fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    var iso = function (x) { x = new Date(x); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
    var hoy = hoyISO(), f = iso(fin);
    return [iso(ini), f > hoy ? hoy : f];
  }
  function fijarRango(r) {
    var x = r === 'mes' ? rangoMes(0) : r === 'pasado' ? rangoMes(-1) : [new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10), hoyISO()];
    $('c-desde').value = x[0]; $('c-hasta').value = x[1];
  }
  fijarRango('mes');
  $('c-atajos').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { fijarRango(b.dataset.r); verFichajes(); }); });
  $('c-ver').addEventListener('click', verFichajes);
  $('c-findes').addEventListener('change', function () { if (S.fichajesDias) pintarFichajes(); });
  $('c-empleado').addEventListener('change', function () { $('c-dias').innerHTML = ''; $('c-resumen').innerHTML = ''; });
  var DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  function verFichajes() {
    var email = $('c-empleado').value;
    if (!email) return toast('Elige un empleado.');
    if (!$('c-desde').value || !$('c-hasta').value) return toast('Elige el periodo.');
    cargando(true);
    return api({ action: 'adminFichajes', email: email, desde: $('c-desde').value, hasta: $('c-hasta').value }).then(function (r) {
      S.fichajesDias = r.dias; S.fichajesNombre = r.nombre; pintarFichajes();
    }).catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
  }
  function pintarFichajes() {
    var dias = S.fichajesDias || [], findes = $('c-findes').checked;
    var inc = dias.filter(function (d) { return d.incidencia; }).length;
    var conF = dias.filter(function (d) { return d.fichajes.some(function (f) { return !f.anulado; }); }).length;
    $('c-resumen').innerHTML = '<div class="aviso ' + (inc ? 'warn' : 'info') + '"><b>' + esc(S.fichajesNombre) + '</b> · ' + conF + ' días con fichajes' +
      (inc ? ' · <b>' + inc + ' con incidencias</b> (marcadas en rojo)' : ' · sin incidencias') + '</div>';
    $('c-dias').innerHTML = dias.filter(function (d) {
      return findes || d.fichajes.length || (d.dow !== 0 && d.dow !== 6);
    }).map(function (d) {
      var vacio = !d.fichajes.length;
      return '<div class="dia-f card' + (vacio ? ' vacio' : '') + '" style="margin:0 0 10px">' +
        '<div class="cab"><b>' + DOW[d.dow] + ' ' + esc(fechaCorta(d.fecha)) + '</b><span class="m">' +
        (d.ausencia ? '<span class="chip">' + esc(d.ausencia) + '</span> ' : '') + esc(d.horas || (vacio && !d.ausencia ? 'sin fichajes' : '')) + '</span></div>' +
        (d.incidencia ? '<div class="inc" style="font-size:13px;margin-top:2px">' + esc(d.incidencia) + '</div>' : '') +
        d.fichajes.map(function (f) {
          return '<div class="fj' + (f.anulado ? ' anulado' : '') + '"' + (f.motivo ? ' title="' + esc(f.motivo) + '"' : '') + '><div><b>' + esc(f.hora) + '</b> ' + esc(etq(f)) +
            (f.origen === 'CORRECCION' && !f.anulado ? ' <span class="chip">manual</span>' : '') +
            (f.anulado ? ' <span class="chip">anulado</span>' : '') +
            (f.motivo ? '<div class="m" style="text-decoration:none">' + esc(f.motivo) + '</div>' : '') + '</div>' +
            (f.anulado ? '' : '<div class="bts"><button data-ed="' + esc(f.id) + '">Editar</button><button class="x" data-an="' + esc(f.id) + '">Anular</button></div>') + '</div>';
        }).join('') +
        '<div class="mini"><button data-add="' + esc(d.fecha) + '">+ Añadir fichaje</button>' +
        (vacio && !d.ausencia ? '<button data-jornada="' + esc(d.fecha) + '">+ Jornada completa</button>' : '') + '</div></div>';
    }).join('') || '<div class="card m">No hay días en ese periodo.</div>';
    var buscar = function (id) {
      for (var i = 0; i < dias.length; i++) for (var k = 0; k < dias[i].fichajes.length; k++) if (dias[i].fichajes[k].id === id) return { d: dias[i], f: dias[i].fichajes[k] };
    };
    $('c-dias').querySelectorAll('[data-ed]').forEach(function (b) { b.addEventListener('click', function () { var x = buscar(b.dataset.ed); modalFichaje(x.d.fecha, x.f); }); });
    $('c-dias').querySelectorAll('[data-an]').forEach(function (b) { b.addEventListener('click', function () { var x = buscar(b.dataset.an); modalAnular(x.d.fecha, x.f); }); });
    $('c-dias').querySelectorAll('[data-add]').forEach(function (b) { b.addEventListener('click', function () { modalFichaje(b.dataset.add, null); }); });
    $('c-dias').querySelectorAll('[data-jornada]').forEach(function (b) { b.addEventListener('click', function () { modalJornada(b.dataset.jornada); }); });
  }
  function opcionesTipo(sel) {
    return TIPOS_ELEGIBLES.map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + ETQ[k] + '</option>'; }).join('');
  }
  /** Editar (f) o añadir (f = null) un fichaje de un día. */
  function modalFichaje(fecha, f) {
    abrirModal('<h2>' + (f ? 'Editar fichaje' : 'Añadir fichaje') + '</h2><p class="ayuda">' + esc(S.fichajesNombre) + ' · ' + esc(fechaCorta(fecha)) +
      (f ? '<br>Original: ' + esc(etq(f)) + ' a las ' + esc(f.hora) + '. Quedará guardado como anulado y sustituido.' : '') + '</p>' +
      '<div class="fila2"><div><label for="mf-hora">Hora</label><input id="mf-hora" type="time" value="' + esc(f ? f.hora : '') + '"></div>' +
      '<div><label for="mf-tipo">Tipo</label><select id="mf-tipo">' + opcionesTipo(f ? tipoConNombre(f) : 'SALIDA') + '</select></div></div>' +
      '<label for="mf-motivo">Motivo (obligatorio)</label><textarea id="mf-motivo" placeholder="Ej.: olvidó fichar la salida; confirmado por el empleado."></textarea>' +
      '<div class="acciones"><button class="btn sec" id="mf-no">Cancelar</button><button class="btn" id="mf-ok">Guardar</button></div>');
    $('mf-no').addEventListener('click', cerrarModal);
    $('mf-ok').addEventListener('click', function () {
      var hora = $('mf-hora').value, motivo = $('mf-motivo').value.trim();
      if (!hora) return toast('Pon la hora.');
      var malTipo = validarTipoHora($('mf-tipo').value, hora); if (malTipo) return toast(malTipo, 6000);
      if (motivo.length < 5) return toast('Escribe el motivo.');
      cargando(true);
      var p = f ? api({ action: 'adminModificarFichaje', id: f.id, hora: hora, tipo: $('mf-tipo').value, motivo: motivo })
                : api({ action: 'adminCorreccion', email: $('c-empleado').value, fecha: fecha, hora: hora, tipo: $('mf-tipo').value, motivo: motivo });
      p.then(function (r) { cerrarModal(); toast(r.mensaje, 5000); return verFichajes(); })
        .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
  }
  function modalAnular(fecha, f) {
    abrirModal('<h2>Anular fichaje</h2><p class="ayuda">' + esc(S.fichajesNombre) + ' · ' + esc(fechaCorta(fecha)) + ' · <b>' + esc(etq(f)) + ' ' + esc(f.hora) +
      '</b><br>Deja de contar en las horas y en los Excel, pero queda guardado (anulado) con tu nombre y el motivo.</p>' +
      '<label for="ma-motivo">Motivo (obligatorio)</label><textarea id="ma-motivo" placeholder="Ej.: fichaje duplicado por error."></textarea>' +
      '<div class="acciones"><button class="btn sec" id="ma-no">Cancelar</button><button class="btn peligro" id="ma-ok">Anular</button></div>');
    $('ma-no').addEventListener('click', cerrarModal);
    $('ma-ok').addEventListener('click', function () {
      var motivo = $('ma-motivo').value.trim();
      if (motivo.length < 5) return toast('Escribe el motivo.');
      cargando(true);
      api({ action: 'adminAnularFichaje', id: f.id, motivo: motivo }).then(function (r) { cerrarModal(); toast(r.mensaje); return verFichajes(); })
        .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
  }
  /** Rellena un día olvidado entero con el horario habitual (editable antes de guardar). */
  function modalJornada(fecha) {
    var dow = new Date(fecha + 'T12:00:00').getDay();
    var mm = fecha.slice(5, 10), cf = (S.ajustes && S.ajustes.config) || {}, verano = mm >= (cf.VERANO_DESDE || '07-01') && mm <= (cf.VERANO_HASTA || '08-31');
    var filas = verano ? [['ENTRADA', '08:00'], ['SALIDA', '15:00']] : dow === 5 ? [['ENTRADA', '08:00'], ['SALIDA', '14:00']]
      : [['ENTRADA', '08:00'], ['INICIO_COMIDA', '14:00'], ['FIN_COMIDA', '15:00'], ['SALIDA', '17:30']];
    abrirModal('<h2>Jornada completa</h2><p class="ayuda">' + esc(S.fichajesNombre) + ' · ' + esc(fechaCorta(fecha)) + '. Revisa las horas antes de guardar.</p>' +
      filas.map(function (x, i) {
        return '<div class="fila2"><div><select class="mj-tipo">' + opcionesTipo(x[0]) + '</select></div><div><input class="mj-hora" type="time" value="' + x[1] + '"></div></div>' + '<div style="height:8px"></div>';
      }).join('') +
      '<label for="mj-motivo">Motivo (obligatorio)</label><textarea id="mj-motivo" placeholder="Ej.: no fichó en todo el día; confirmado por el empleado."></textarea>' +
      '<div class="acciones"><button class="btn sec" id="mj-no">Cancelar</button><button class="btn" id="mj-ok">Guardar</button></div>');
    $('mj-no').addEventListener('click', cerrarModal);
    $('mj-ok').addEventListener('click', function () {
      var motivo = $('mj-motivo').value.trim();
      if (motivo.length < 5) return toast('Escribe el motivo.');
      var tipos = $('modal-hoja').querySelectorAll('.mj-tipo'), horas = $('modal-hoja').querySelectorAll('.mj-hora');
      var lista = [];
      for (var i = 0; i < tipos.length; i++) if (horas[i].value) lista.push({ tipo: tipos[i].value, hora: horas[i].value });
      lista.sort(function (a, b) { return a.hora < b.hora ? -1 : 1; });
      for (var k = 0; k < lista.length; k++) { var mt = validarTipoHora(lista[k].tipo, lista[k].hora); if (mt) return toast(mt, 6000); }
      cargando(true, 'Guardando…');
      var email = $('c-empleado').value;
      lista.reduce(function (p, x) {
        return p.then(function () { return api({ action: 'adminCorreccion', email: email, fecha: fecha, hora: x.hora, tipo: x.tipo, motivo: motivo }); });
      }, Promise.resolve()).then(function () { cerrarModal(); toast('Jornada registrada.'); return verFichajes(); })
        .catch(function (e) { toast(e.message, 6000); verFichajes(); }).finally(function () { cargando(false); });
    });
  }

  // ----- Informes -----
  opcionesMeses($('i-mes'), 36);
  $('e-desde').value = hoyISO().slice(0, 8) + '01'; $('e-hasta').value = hoyISO();
  $('i-descargar').addEventListener('click', function () {
    if (!$('i-empleado').value) return toast('Elige un empleado.');
    cargando(true, 'Generando Excel…');
    api({ action: 'adminInforme', email: $('i-empleado').value, mes: $('i-mes').value, formato: $('i-formato').value }).then(descargarXlsx)
      .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });
  // Selector de mes y año para la descarga de todos
  (function () {
    var d = new Date(), y = d.getFullYear();
    $('z-mes').innerHTML = MESES.map(function (m, i) { return '<option value="' + ('0' + (i + 1)).slice(-2) + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</option>'; }).join('');
    var anios = ''; for (var a = y; a >= y - 4; a--) anios += '<option>' + a + '</option>';
    $('z-anio').innerHTML = anios;
    d.setDate(1); d.setMonth(d.getMonth() - 1); // por defecto, el mes pasado
    $('z-mes').value = ('0' + (d.getMonth() + 1)).slice(-2); $('z-anio').value = String(d.getFullYear());
  })();

  // ZIP mínimo (sin compresión: los .xlsx ya van comprimidos) armado en el propio dispositivo
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function crearZip(archivos) {
    var enc = new TextEncoder(), partes = [], central = [], off = 0;
    var ah = new Date(), hDos = (ah.getHours() << 11) | (ah.getMinutes() << 5) | (ah.getSeconds() >> 1),
        fDos = ((ah.getFullYear() - 1980) << 9) | ((ah.getMonth() + 1) << 5) | ah.getDate();
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; }, u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    archivos.forEach(function (a) {
      var nom = enc.encode(a.nombre), crc = crc32(a.datos), tam = a.datos.length;
      var cab = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(hDos), u16(fDos), u32(crc), u32(tam), u32(tam), u16(nom.length), u16(0));
      partes.push(new Uint8Array(cab), nom, a.datos);
      central.push(new Uint8Array([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(hDos), u16(fDos), u32(crc), u32(tam), u32(tam),
        u16(nom.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), nom);
      off += cab.length + nom.length + tam;
    });
    var tamC = central.reduce(function (t, x) { return t + x.length; }, 0);
    var fin = new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(archivos.length), u16(archivos.length), u32(tamC), u32(off), u16(0)));
    return new Blob(partes.concat(central, [fin]), { type: 'application/zip' });
  }
  function b64aBytes(b64) { var bin = atob(b64), r = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) r[i] = bin.charCodeAt(i); return r; }

  $('z-descargar').addEventListener('click', function () {
    var mes = $('z-anio').value + '-' + $('z-mes').value, formato = $('z-formato').value;
    if (mes > hoyISO().slice(0, 7)) return toast('Ese mes todavía no ha llegado.');
    cargarEmpleados().then(function () {
      var gente = S.empleados.filter(function (u) { return u.activo && deFiltro(u); })
        .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
      if (!gente.length) return toast('No hay empleados activos.');
      var multi = !S.filtro && multiempresa();
      var limpio = function (t) { return String(t).replace(/[\\\/:*?"<>|]/g, '').trim() || 'Empresa'; };
      var tareas = [];
      gente.forEach(function (u) {
        if (formato !== 'completo') tareas.push({ u: u, f: 'inspeccion' });
        if (formato !== 'inspeccion') tareas.push({ u: u, f: 'completo' });
      });
      var archivos = [], fallos = [], resumen = {}, hechas = 0, i = 0, parar = false;
      $('z-descargar').disabled = true;
      cargando(true);
      var txt = function () { $('cargando-txt').textContent = 'Generando Excel ' + hechas + ' de ' + tareas.length + '… (no cierres la app)'; };
      txt();
      function siguiente() {
        if (parar || i >= tareas.length) return Promise.resolve();
        var t = tareas[i++];
        var carpeta = (multi ? limpio(nombreEmpresa(t.u.idEmpresa)) + '/' : '') + (formato === 'ambos' ? (t.f === 'completo' ? 'Completo/' : 'Inspección/') : '');
        return api({ action: 'adminInforme', email: t.u.email, mes: mes, formato: t.f }).then(function (r) {
          archivos.push({ nombre: carpeta + r.nombreArchivo, datos: b64aBytes(r.base64) });
          if (r.totales) (resumen[t.u.idEmpresa || ''] = resumen[t.u.idEmpresa || ''] || []).push({ nombre: t.u.nombre, nif: t.u.nif, email: t.u.email, puesto: t.u.puesto,
            dias: r.totales.dias, minutos: r.totales.minutos, extra: r.totales.extra, incidencias: r.totales.incidencias });
        }).catch(function (e) {
          if (/Introduce tu PIN/.test(e.message)) parar = true;
          fallos.push(t.u.nombre + ': ' + e.message);
        }).then(function () { hechas++; txt(); return siguiente(); });
      }
      // 2 a la vez: más rápido sin que Google frene las exportaciones
      Promise.all([siguiente(), siguiente()]).then(function () {
        if (parar) throw new Error('El panel se ha cerrado por tiempo. Vuelve a abrirlo e inténtalo de nuevo.');
        $('cargando-txt').textContent = 'Generando el resumen…';
        return Promise.all(Object.keys(resumen).map(function (idEmp) {
          var carpeta = (multi ? limpio(nombreEmpresa(idEmp)) + '/' : '') + (formato === 'ambos' ? 'Completo/' : '');
          return api({ action: 'adminResumenMes', mes: mes, empresa: idEmp, filas: resumen[idEmp] })
            .then(function (r) { archivos.push({ nombre: carpeta + r.nombreArchivo, datos: b64aBytes(r.base64) }); })
            .catch(function (e) { fallos.push('Resumen: ' + e.message); });
        }));
      }).then(function () {
        if (!archivos.length) throw new Error('No se pudo generar ningún Excel. ' + (fallos[0] || ''));
        archivos.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
        descargar('Registro_jornada_' + mes + (formato === 'ambos' ? '' : '_' + formato) + '.zip', crearZip(archivos));
        if (fallos.length) {
          abrirModal('<h2>ZIP descargado con avisos</h2><p class="ayuda">' + archivos.length + ' archivos descargados. No se pudieron generar:</p><div class="aviso warn">' +
            fallos.map(esc).join('<br>') + '</div><p class="m">Puedes descargarlos uno a uno arriba.</p><button class="btn" id="zf-ok">Entendido</button>');
          $('zf-ok').addEventListener('click', cerrarModal);
        } else toast('✔ ZIP con ' + archivos.length + ' archivos descargado.', 6000);
      }).catch(function (e) { toast(e.message, 9000); })
        .finally(function () { cargando(false); $('z-descargar').disabled = false; });
    });
  });
  $('i-archivar').addEventListener('click', function () {
    var mes = $('i-mes').value;
    var quien = S.filtro ? nombreEmpresa(S.filtro) : (multiempresa() ? 'todas las empresas' : '');
    if (!confirm('¿Archivar en Google Drive los informes de ' + $('i-mes').selectedOptions[0].textContent + (quien ? ' (' + quien + ')' : '') + '?\nSi ya existían, se sustituyen por los nuevos.')) return;
    cargando(true, 'Generando los Excel de cada empleado… puede tardar 2–3 minutos.');
    api({ action: 'adminArchivarMes', mes: mes, empresa: S.filtro }).then(function (r) {
      toast(r.mensaje, 7000);
      $('i-carpeta').innerHTML = '<a href="' + esc(r.carpetaUrl) + '" target="_blank" rel="noopener">Abrir la carpeta en Google Drive</a>';
    }).catch(function (e) { toast(e.message, 7000); }).finally(function () { cargando(false); });
  });
  $('i-auto').addEventListener('change', function () {
    var activar = this.checked, chk = this;
    cargando(true);
    api({ action: 'adminArchivoAuto', activar: activar }).then(function (r) { toast(r.mensaje, 6000); })
      .catch(function (e) { chk.checked = !activar; toast(e.message); }).finally(function () { cargando(false); });
  });
  $('e-descargar').addEventListener('click', function () {
    cargando(true);
    api({ action: 'adminExport', desde: $('e-desde').value, hasta: $('e-hasta').value, empresa: S.filtro }).then(function (r) {
      descargar(r.nombreArchivo, new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' }));
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });

  // ----- Ajustes -----
  function cargarAjustes() {
    return api({ action: 'adminAjustes' }).then(function (r) {
      S.ajustes = r;
      actualizarEmpresas(r.empresas); pintarEmpresas(r.empresas);
      $('s-prec').value = r.config.PRECISION_MAX_M; $('s-sesion').value = r.config.SESION_DIAS; $('s-hmax').value = r.config.HORAS_MAX_JORNADA_ABIERTA;
      $('i-auto').checked = !!r.archivoAuto;
      $('s-geocerca').checked = r.config.GEOCERCA_ACTIVA !== false;
      $('s-recordatorios').checked = !!r.config.RECORDATORIOS;
      $('s-vac').value = r.config.VACACIONES_DIAS == null ? 22 : r.config.VACACIONES_DIAS;
      $('s-nominas').checked = !!r.config.NOMINAS_ACTIVAS;
      $('s-emails').value = r.config.EMAIL_AVISOS || '';
      $('s-email-info').innerHTML = 'Ahora llegan a: <b>' + esc((r.config.emailsAvisoEfectivos || []).join(', ')) + '</b>' +
        (r.config.ultimoErrorEmail ? '<div class="inc" style="margin-top:4px">Último error al enviar: ' + esc(r.config.ultimoErrorEmail) + '</div>' : '');
      $('s-h-entrada').value = r.config.HORA_AVISO_ENTRADA || '08:30';
      $('s-h-salida').value = r.config.HORA_AVISO_SALIDA || '18:00';
      $('s-h-viernes').value = r.config.HORA_AVISO_SALIDA_VIERNES || '14:30';
      var anio = hoyISO().slice(0, 4);
      $('s-j-lj').value = r.config.JORNADA_LJ || '08:30'; $('s-j-v').value = r.config.JORNADA_V || '06:00';
      $('s-j-verano').value = r.config.JORNADA_VERANO || '07:00';
      $('s-v-desde').value = anio + '-' + (r.config.VERANO_DESDE || '07-01'); $('s-v-hasta').value = anio + '-' + (r.config.VERANO_HASTA || '08-31');

      if (r.carpetaUrl) $('i-carpeta').innerHTML = '<a href="' + esc(r.carpetaUrl) + '" target="_blank" rel="noopener">Abrir la carpeta de archivo en Google Drive</a>';
      pintarSedes(r.sedes);
    }).catch(function (e) { toast(e.message); });
  }
  $('s-probar').addEventListener('click', function () {
    cargando(true, 'Enviando email de prueba…');
    api({ action: 'adminProbarEmail' }).then(function (r) { toast(r.mensaje, 8000); })
      .catch(function (e) { toast(e.message, 12000); }).finally(function () { cargando(false); cargarAjustes(); });
  });
  function pintarSedes(sedes) {
    $('s-sedes').innerHTML = sedes.map(function (s, i) {
      var mapa = isFinite(s.lat) && isFinite(s.lng) ? 'https://www.google.com/maps?q=' + s.lat + ',' + s.lng : '';
      return '<div class="sede" data-i="' + i + '">' +
        '<div class="fila2"><div><label>ID</label><input class="sd-id" value="' + esc(s.id) + '"' + (s.existente === false ? '' : ' disabled') + '></div>' +
        '<div><label>Nombre</label><input class="sd-nombre" value="' + esc(s.nombre) + '"></div></div>' +
        '<div class="fila2"><div><label>Latitud</label><input class="sd-lat" inputmode="decimal" value="' + esc(s.lat) + '"></div>' +
        '<div><label>Longitud</label><input class="sd-lng" inputmode="decimal" value="' + esc(s.lng) + '"></div></div>' +
        '<div class="fila2"><div><label>Radio (m)</label><input class="sd-radio" type="number" inputmode="numeric" min="20" max="5000" value="' + esc(s.radio) + '"></div>' +
        '<div><label>&nbsp;</label><div class="interruptor" style="height:48px"><span>Activa</span><input type="checkbox" class="sd-activa"' + (s.activa ? ' checked' : '') + '></div></div></div>' +
        '<div class="acciones"><button class="btn sec peq sd-aqui">Usar mi ubicación actual</button>' +
        (mapa ? '<a class="btn sec peq" style="text-align:center;text-decoration:none" href="' + esc(mapa) + '" target="_blank" rel="noopener">Ver en el mapa</a>' : '') + '</div></div>';
    }).join('');
    S.ajustes.sedes = sedes;
    $('s-sedes').querySelectorAll('.sede').forEach(function (div) {
      div.querySelector('.sd-aqui').addEventListener('click', function () {
        cargando(true, 'Obteniendo ubicación precisa…');
        Geo.obtenerPosicion({ tiempoMax: 15000, precisionObjetivo: 10 }).then(function (p) {
          div.querySelector('.sd-lat').value = p.lat.toFixed(6); div.querySelector('.sd-lng').value = p.lng.toFixed(6);
          toast('Ubicación tomada (precisión ±' + Math.round(p.precision) + ' m). Pulsa «Guardar ajustes».', 6000);
        }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
      });
    });
  }
  function leerSedes() {
    return Array.prototype.map.call($('s-sedes').querySelectorAll('.sede'), function (div) {
      return { id: div.querySelector('.sd-id').value.trim(), nombre: div.querySelector('.sd-nombre').value.trim(),
               lat: num(div.querySelector('.sd-lat').value), lng: num(div.querySelector('.sd-lng').value),
               radio: num(div.querySelector('.sd-radio').value), activa: div.querySelector('.sd-activa').checked };
    });
  }
  $('s-nueva').addEventListener('click', function () {
    var sedes = leerSedes().map(function (s) { s.existente = true; return s; });
    sedes.push({ id: 'OFI' + (sedes.length + 1), nombre: '', lat: '', lng: '', radio: 100, activa: true, existente: false });
    pintarSedes(sedes);
  });
  $('s-guardar').addEventListener('click', function () {
    var sedes = leerSedes();
    if (leerEmpresas().some(function (e) { return !e.nombre; })) return toast('Pon el nombre de todas las empresas.');
    var grandes = sedes.filter(function (s) { return s.radio > 300; });
    if (grandes.length && !confirm('El radio de ' + grandes.map(function (s) { return s.nombre || s.id; }).join(', ') +
        ' es de ' + grandes[0].radio + ' m. Con un radio tan grande se podría fichar «en la oficina» desde bastante lejos. ¿Guardar igualmente?')) return;
    cargando(true);
    var emps = leerEmpresas();
    if (emps.some(function (e) { return !e.nombre; })) return toast('Pon el nombre de todas las empresas.');
    api({ action: 'adminGuardarAjustes', empresas: emps, config: { PRECISION_MAX_M: num($('s-prec').value),
          SESION_DIAS: num($('s-sesion').value), HORAS_MAX_JORNADA_ABIERTA: num($('s-hmax').value),
          GEOCERCA_ACTIVA: $('s-geocerca').checked, RECORDATORIOS: $('s-recordatorios').checked,
          VACACIONES_DIAS: num($('s-vac').value), NOMINAS_ACTIVAS: $('s-nominas').checked, EMAIL_AVISOS: $('s-emails').value.trim(),
          HORA_AVISO_ENTRADA: $('s-h-entrada').value, HORA_AVISO_SALIDA: $('s-h-salida').value,
          HORA_AVISO_SALIDA_VIERNES: $('s-h-viernes').value,
          JORNADA_LJ: $('s-j-lj').value, JORNADA_V: $('s-j-v').value, JORNADA_VERANO: $('s-j-verano').value,
          VERANO_DESDE: $('s-v-desde').value.slice(5), VERANO_HASTA: $('s-v-hasta').value.slice(5) },
          sedes: sedes, appUrl: location.href.split('#')[0].split('?')[0] })
      .then(function (r) { toast(r.mensaje); S.nominasActivas = $('s-nominas').checked; $('yo-nominas').classList.toggle('hidden', !S.nominasActivas); cargarAjustes(); })
      .catch(function (e) { toast(e.message, 7000); }).finally(function () { cargando(false); });
  });
  $('s-integridad').addEventListener('click', function () {
    cargando(true);
    api({ action: 'adminIntegridad' }).then(function (r) {
      $('s-integridad-res').innerHTML = '<div class="aviso ' + (r.integro ? 'ok' : 'bad') + '">' + esc(r.mensaje) + '</div>';
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });

  // ----- Conexión con Coches -----
  function pintarCoches(r) {
    $('k-api').value = r.api || '';
    $('k-unico').checked = !!r.unico;
    $('nav-coches').classList.toggle('hidden', !r.unico);
    $('k-estado').innerHTML = '<div class="aviso ' + (r.conectado ? 'ok' : 'warn') + '">' + esc(r.mensaje) + '</div>' +
      (r.faltan && r.faltan.length ? '<p class="m">No están en Coches: ' + esc(r.faltan.join(', ')) + '</p>' : '');
  }
  function cargarCoches() {
    $('k-estado').innerHTML = '<p class="m">Comprobando conexión…</p>';
    return api({ action: 'adminCoches' }).then(pintarCoches).catch(function (e) { $('k-estado').innerHTML = '<div class="aviso warn">' + esc(e.message) + '</div>'; });
  }
  $('k-guardar').addEventListener('click', function () {
    cargando(true, 'Comprobando con la app de coches…');
    api({ action: 'adminGuardarCoches', api: $('k-api').value.trim(), pin: $('k-pin').value.trim() })
      .then(function (r) { $('k-pin').value = ''; pintarCoches(r); toast(r.conectado ? 'Conexión con Coches guardada.' : r.mensaje); })
      .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
  });
  $('k-unico').addEventListener('change', function () {
    var activar = this.checked, chk = this;
    var aviso = activar
      ? '¿Activar el PIN único?\n\nEn Coches, cada trabajador entrará eligiendo su nombre y con su PIN de 6 cifras de Fichaje. Asegúrate de que los nombres coinciden en las dos apps.'
      : '¿Desactivar el PIN único?\n\nCoches volverá a pedir su propio PIN de 4 cifras. Si los cambiaste con «Nuevo PIN para todos», los trabajadores no los conocen: consúltalos o cámbialos en el Admin de Coches y repártelos.';
    if (!confirm(aviso)) { chk.checked = !activar; return; }
    cargando(true);
    api({ action: 'adminGuardarCoches', unico: activar }).then(function (r) {
      pintarCoches(r); toast(activar ? 'PIN único para Coches activado.' : 'PIN único desactivado: Coches vuelve a su PIN de siempre.', 6000);
    }).catch(function (e) { chk.checked = !activar; toast(e.message, 6000); }).finally(function () { cargando(false); });
  });
  $('k-sync').addEventListener('click', function () {
    if (!confirm('¿Añadir a la lista de Coches a los empleados activos que aún no están? No se quita a nadie.')) return;
    cargando(true);
    api({ action: 'adminSincronizarCoches' }).then(function (r) { toast(r.mensaje, 6000); return cargarCoches(); })
      .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
  });

  // ----- Empresas y logos (ajustes) -----
  function pintarEmpresas(lista) {
    $('s-empresas').innerHTML = lista.map(function (e) {
      var nueva = e.existente === false;
      return '<div class="empresa" data-id="' + esc(e.id) + '" data-nueva="' + (nueva ? '1' : '') + '">' +
        '<label>Nombre / razón social</label><input class="em-nombre" value="' + esc(e.nombre || '') + '">' +
        '<div class="fila2"><div><label>CIF</label><input class="em-cif" value="' + esc(e.cif || '') + '"></div>' +
        '<div><label>&nbsp;</label><div class="interruptor" style="height:48px"><span>Activa</span><input type="checkbox" class="em-activa"' + (e.activa !== false ? ' checked' : '') + '></div></div></div>' +
        '<label>Logo</label><div class="logo-prev em-logo">' + (nueva ? 'Guarda la empresa para poder subir su logo' : (e.logoId ? 'Cargando…' : 'Sin logo')) + '</div>' +
        (nueva ? '' : '<div class="acciones" style="margin-top:0"><button class="btn sec peq em-subir">Subir logo</button><button class="btn peligro peq em-quitar">Quitar logo</button></div>') +
        '</div>';
    }).join('');
    $('s-empresas').querySelectorAll('.empresa').forEach(function (div) {
      var e = lista.filter(function (x) { return x.id === div.dataset.id; })[0];
      if (!div.dataset.nueva && e.logoId) verLogoEmpresa(e.id, e.logoId, div.querySelector('.em-logo'));
      var sub = div.querySelector('.em-subir'), qui = div.querySelector('.em-quitar');
      if (sub) sub.addEventListener('click', function () { S.logoDestino = e.id; $('s-logo-file').click(); });
      if (qui) qui.addEventListener('click', function () {
        if (!confirm('¿Quitar el logo de ' + e.nombre + '?')) return;
        cargando(true);
        api({ action: 'adminBorrarLogo', idEmpresa: e.id }).then(function (r) {
          toast(r.mensaje); if (e.id === S.usuario.idEmpresa) cargarLogo(null); return cargarAjustes();
        }).catch(function (err) { toast(err.message); }).finally(function () { cargando(false); });
      });
    });
  }
  function verLogoEmpresa(id, logoId, cont) {
    var pintar = function (src) { cont.innerHTML = src ? '<img src="' + src + '" alt="Logo">' : 'Sin logo'; };
    if (S.logosEmp[logoId]) return pintar(S.logosEmp[logoId]);
    api({ action: 'logo', idEmpresa: id }).then(function (r) {
      var src = r.logo ? 'data:' + r.logo.mime + ';base64,' + r.logo.base64 : null;
      if (src) S.logosEmp[logoId] = src;
      pintar(src);
    }).catch(function () { pintar(null); });
  }
  function leerEmpresas() {
    return Array.prototype.map.call($('s-empresas').querySelectorAll('.empresa'), function (div) {
      return { id: div.dataset.id, nombre: div.querySelector('.em-nombre').value.trim(), cif: div.querySelector('.em-cif').value.trim(),
               activa: div.querySelector('.em-activa').checked };
    });
  }
  $('s-emp-nueva').addEventListener('click', function () {
    var actuales = leerEmpresas().map(function (e) {
      var orig = S.empresas.filter(function (x) { return x.id === e.id; })[0] || {};
      e.logoId = orig.logoId; e.existente = !!orig.id; return e;
    });
    var n = actuales.length + 1, ids = actuales.map(function (e) { return e.id; });
    while (ids.indexOf('EMP' + n) >= 0) n++;
    actuales.push({ id: 'EMP' + n, nombre: '', cif: '', activa: true, existente: false });
    pintarEmpresas(actuales);
    var campos = $('s-empresas').querySelectorAll('.em-nombre'); campos[campos.length - 1].focus();
  });
  $('s-logo-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    var destino = S.logoDestino;
    if (!f || !destino) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) return toast('El logo debe ser PNG o JPG.');
    var lector = new FileReader();
    lector.onload = function () {
      var img = new Image();
      img.onload = function () {
        // Reduce a 600 x 200 como máximo para que pese poco
        var k = Math.min(1, 600 / img.width, 200 / img.height);
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var png = f.type === 'image/png';
        var dataUrl = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9);
        cargando(true, 'Subiendo logo…');
        api({ action: 'adminSubirLogo', idEmpresa: destino, mime: png ? 'image/png' : 'image/jpeg', base64: dataUrl.split(',')[1] }).then(function (r) {
          S.logosEmp[r.logoVer] = dataUrl;
          if (destino === S.usuario.idEmpresa) {
            try { localStorage.setItem('fichaje_logo', JSON.stringify({ v: r.logoVer, src: dataUrl })); } catch (e) { /* */ }
            pintarLogo(dataUrl);
          }
          toast(r.mensaje); return cargarAjustes();
        }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
      };
      img.onerror = function () { toast('No se pudo leer la imagen.'); };
      img.src = lector.result;
    };
    lector.readAsDataURL(f);
  });

  // ----- Calendario -----
  function mesActual() { return hoyISO().slice(0, 7); }
  function moverMes(mes, n) {
    var y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + ('0' + (m + 1)).slice(-2);
  }
  $('cal-ant').addEventListener('click', function () { S.calMes = moverMes(S.calMes, -1); cargarCalendario(); });
  $('cal-sig').addEventListener('click', function () { S.calMes = moverMes(S.calMes, 1); cargarCalendario(); });
  $('cal-nuevo').addEventListener('click', function () { formularioAusencia(null); });

  function cargarCalendario() {
    if (!S.calMes) S.calMes = mesActual();
    var y = Number(S.calMes.slice(0, 4)), m = Number(S.calMes.slice(5, 7));
    $('cal-titulo').textContent = MESES[m - 1] + ' ' + y;
    pintarCalendario([]);
    return api({ action: 'adminCalendario', mes: S.calMes }).then(function (r) {
      var emailsFiltro = {};
      S.empleados.filter(deFiltro).forEach(function (u) { emailsFiltro[u.email.toLowerCase()] = true; });
      S.calDatos = r.entradas.filter(function (e) {
        return !S.filtro || e.email === 'TODOS' || e.email === 'EMP:' + S.filtro || emailsFiltro[e.email];
      });
      pintarCalendario(S.calDatos);
    })
      .catch(function (e) { toast(e.message); });
  }
  function pintarCalendario(entradas) {
    var y = Number(S.calMes.slice(0, 4)), m = Number(S.calMes.slice(5, 7));
    var dias = new Date(y, m, 0).getDate();
    var primero = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lunes = 0
    var porDia = {};
    entradas.forEach(function (e) { (porDia[e.fecha] = porDia[e.fecha] || []).push(e); });
    var html = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(function (d) { return '<div class="dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < primero; i++) html += '<div class="dia vacio"></div>';
    var hoy = hoyISO();
    for (var d = 1; d <= dias; d++) {
      var f = S.calMes + '-' + ('0' + d).slice(-2);
      var dow = (primero + d - 1) % 7;
      var lista = porDia[f] || [];
      var festivo = lista.some(function (e) { return e.tipo === 'FESTIVO'; });
      var cls = 'dia' + (dow >= 5 ? ' finde' : '') + (festivo ? ' festivo' : '') + (f === hoy ? ' hoy' : '');
      var ets = lista.slice(0, 2).map(function (e) {
        var txt = e.tipo === 'FESTIVO' ? (e.nota || 'Festivo') + (e.email.indexOf('EMP:') === 0 && !S.filtro ? ' · ' + e.nombre : '') : e.nombre.split(' ')[0];
        return '<span class="et t-' + esc(e.tipo) + '">' + esc(txt) + '</span>';
      }).join('') + (lista.length > 2 ? '<span class="m" style="font-size:10px">+' + (lista.length - 2) + ' más</span>' : '');
      html += '<button class="' + cls + '" data-f="' + f + '"><span class="num">' + d + '</span>' + ets + '</button>';
    }
    $('cal-grid').innerHTML = html;
    $('cal-grid').querySelectorAll('button[data-f]').forEach(function (b) {
      b.addEventListener('click', function () { verDia(b.dataset.f); });
    });
  }

  function verDia(fecha) {
    var lista = (S.calDatos || []).filter(function (e) { return e.fecha === fecha; });
    var d = new Date(fecha + 'T12:00:00');
    var titulo = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    abrirModal('<h2 style="text-transform:capitalize">' + esc(titulo) + '</h2>' +
      (lista.length ? '<ul class="lista">' + lista.map(function (e) {
        return '<li><div><span class="et t-' + esc(e.tipo) + '" style="font-size:12px;padding:3px 8px;border-radius:999px;color:#fff">' + esc(e.etiqueta) + '</span> ' +
               '<b>' + esc(e.nombre) + '</b>' + (e.nota ? '<div class="m">' + esc(e.nota) + '</div>' : '') + '</div>' +
               '<button class="btn peligro peq" data-id="' + esc(e.id) + '">Quitar</button></li>';
      }).join('') + '</ul>' : '<p class="ayuda">Nada marcado este día.</p>') +
      '<div class="acciones"><button class="btn sec" id="d-cerrar">Cerrar</button><button class="btn" id="d-anadir">+ Marcar este día</button></div>');
    $('d-cerrar').addEventListener('click', cerrarModal);
    $('d-anadir').addEventListener('click', function () { formularioAusencia(fecha); });
    $('modal-hoja').querySelectorAll('button[data-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        cargando(true);
        api({ action: 'adminBorrarCalendario', ids: [b.dataset.id] }).then(function (r) {
          toast(r.mensaje); return cargarCalendario();
        }).then(function () { verDia(fecha); }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
      });
    });
  }

  function formularioAusencia(fecha, preset) {
    var hoy = fecha || hoyISO();
    var activos = S.empleados.filter(function (u) { return u.activo && deFiltro(u); });
    abrirModal('<h2>Marcar días</h2>' +
      '<label>¿Qué es?</label><div class="tipos" id="f-tipos">' +
      Object.keys(TIPOS_CAL).map(function (k, i) {
        return '<button data-t="' + k + '"' + (i === 0 && !fecha ? '' : '') + '>' + TIPOS_CAL[k] + (k === 'FESTIVO' ? '<div class="m" style="font-weight:400">' + (multiempresa() ? 'por empresa' : 'toda la empresa') + '</div>' : '') + '</button>';
      }).join('') + '</div>' +
      '<div class="fila2"><div><label for="f-desde">Desde</label><input id="f-desde" type="date" value="' + hoy + '"></div>' +
      '<div><label for="f-hasta">Hasta (incluido)</label><input id="f-hasta" type="date" value="' + hoy + '"></div></div>' +
      (multiempresa() ? '<div id="f-empresa-fila" class="hidden"><label for="f-empresa">¿Para qué empresa?</label><select id="f-empresa">' +
        '<option value="">Todas las empresas</option>' + S.empresas.filter(function (e) { return e.activa; }).map(function (e) {
          return '<option value="' + esc(e.id) + '"' + (e.id === S.filtro ? ' selected' : '') + '>' + esc(e.nombre) + '</option>';
        }).join('') + '</select></div>' : '') +
      '<div id="f-personas"><label>¿Quién?</label><div class="checks">' +
      '<label><input type="checkbox" id="f-todos"> <b>Seleccionar a todos</b></label>' +
      activos.map(function (u) { return '<label><input type="checkbox" class="f-emp" value="' + esc(u.email) + '"> ' + esc(u.nombre) + '</label>'; }).join('') +
      '</div></div>' +
      '<label for="f-nota">Nota (opcional)</label><input id="f-nota" placeholder="Ej.: Fiestas patronales (no pongas datos médicos)">' +
      '<p class="m" style="margin-top:8px">Los sábados y domingos se saltan automáticamente (salvo en festivos).</p>' +
      '<div class="acciones"><button class="btn sec" id="f-cancelar">Cancelar</button><button class="btn" id="f-guardar">Guardar</button></div>');
    var tipo = null;
    $('f-tipos').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        tipo = b.dataset.t;
        $('f-tipos').querySelectorAll('button').forEach(function (x) { x.classList.toggle('sel', x === b); });
        $('f-personas').classList.toggle('hidden', tipo === 'FESTIVO');
        if ($('f-empresa-fila')) $('f-empresa-fila').classList.toggle('hidden', tipo !== 'FESTIVO');
      });
    });
    $('f-desde').addEventListener('change', function () { if ($('f-hasta').value < this.value) $('f-hasta').value = this.value; });
    if (preset) {
      var bt = $('f-tipos').querySelector('[data-t="' + preset.tipo + '"]'); if (bt) bt.click();
      if (preset.desde) { $('f-desde').value = preset.desde; $('f-hasta').value = preset.hasta; }
      if (preset.todos) { $('f-todos').checked = true; $('modal-hoja').querySelectorAll('.f-emp').forEach(function (c) { c.checked = true; }); }
      if (preset.nota) $('f-nota').value = preset.nota;
    }
    $('f-todos').addEventListener('change', function () {
      var on = this.checked; $('modal-hoja').querySelectorAll('.f-emp').forEach(function (c) { c.checked = on; });
    });
    $('f-cancelar').addEventListener('click', cerrarModal);
    $('f-guardar').addEventListener('click', function () {
      if (!tipo) return toast('Elige qué es: festivo, vacaciones, baja…');
      if (preset && $('f-hasta').value < $('f-desde').value) return toast('Revisa las fechas.');
      var emails = Array.prototype.map.call($('modal-hoja').querySelectorAll('.f-emp:checked'), function (c) { return c.value; });
      if (tipo !== 'FESTIVO' && !emails.length) return toast('Marca al menos a una persona.');
      cargando(true);
      api({ action: 'adminGuardarCalendario', tipo: tipo, desde: $('f-desde').value, hasta: $('f-hasta').value, emails: emails, nota: $('f-nota').value,
            empresa: $('f-empresa') ? $('f-empresa').value : '' })
        .then(function (r) {
          cerrarModal(); toast(r.mensaje); S.calMes = $('f-desde').value.slice(0, 7);
          return preset ? cargarSolicitudes() : cargarCalendario();
        })
        .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
  }

  // =================================================================
  // VACACIONES (empleado)
  // =================================================================
  function txtPeriodo(a, b) { return a === b ? fechaCorta(a) : fechaCorta(a) + ' – ' + fechaCorta(b); }
  function cargarVacaciones() {
    api({ action: 'misVacaciones' }).then(function (r) {
      var s = r.saldo;
      $('vac-disp').textContent = s.disponibles;
      $('vac-disp').style.color = s.disponibles < 0 ? 'var(--bad)' : '';
      $('vac-disp-txt').textContent = (s.disponibles === 1 ? 'día disponible' : 'días disponibles') + ' en ' + s.anio;
      $('vac-kpis').innerHTML = [['Al año', s.asignados], ['Ya disfrutados', s.disfrutados], ['Aprobados y pendientes de disfrutar', s.programados + (s.pendientes ? ' + ' + s.pendientes + '*' : '')]]
        .map(function (k) { return '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join('');
      var extra = (s.ajustes || []).map(function (a) { return (a.dias > 0 ? '+' : '') + a.dias + ' ' + esc(a.motivo); });
      $('vac-periodos').innerHTML = (extra.length ? '<b>Tus ' + s.asignados + ' días incluyen:</b> ' + s.base + ' del año' + extra.map(function (t) { return ' · ' + t; }).join('') + '<br>' : '') + (s.periodos.length ? '<b>Tus vacaciones de ' + s.anio + ':</b> ' + s.periodos.map(function (p) {
        return txtPeriodo(p.desde, p.hasta) + ' (' + p.dias + ')'; }).join(' · ') : 'Aún no tienes vacaciones aprobadas este año.') +
        (s.pendientes ? '<br>* ' + s.pendientes + ' días en solicitudes pendientes de aprobar.' : '');
      $('vac-lista').innerHTML = r.solicitudes.map(function (x) {
        return '<li><div><div class="t">' + esc(txtPeriodo(x.desde, x.hasta)) + ' · ' + x.dias + ' días</div>' +
          (x.comentario ? '<div class="m">«' + esc(x.comentario) + '»</div>' : '') +
          (x.respuesta ? '<div class="m"><b>Respuesta:</b> ' + esc(x.respuesta) + '</div>' : '') + '</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><span class="chip est-' + esc(x.estado) + '">' + esc(x.estadoTxt) + '</span>' +
          (x.estado === 'PENDIENTE' ? '<button class="btn sec peq" data-cancel="' + esc(x.id) + '">Cancelar</button>' : '') + '</div></li>';
      }).join('') || '<li class="m">No has pedido vacaciones todavía.</li>';
      $('vac-lista').querySelectorAll('[data-cancel]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('¿Cancelar esta solicitud?')) return;
          cargando(true);
          api({ action: 'cancelarSolicitud', id: b.dataset.cancel }).then(function (r) { toast(r.mensaje); cargarVacaciones(); })
            .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
        });
      });
    }).catch(function (e) { toast(e.message); });
  }
  $('vac-desde').addEventListener('change', function () { if (!$('vac-hasta').value || $('vac-hasta').value < this.value) $('vac-hasta').value = this.value; });
  $('vac-enviar').addEventListener('click', function () {
    var d = $('vac-desde').value, h = $('vac-hasta').value;
    if (!d || !h) return toast('Elige las fechas.');
    if (h < d) return toast('La fecha final es anterior a la inicial.');
    cargando(true, 'Enviando…');
    api({ action: 'solicitarVacaciones', desde: d, hasta: h, comentario: $('vac-com').value.trim() }).then(function (r) {
      toast(r.mensaje, 6000); $('vac-desde').value = ''; $('vac-hasta').value = ''; $('vac-com').value = ''; cargarVacaciones();
    }).catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
  });

  // ----- Pestañas Vacaciones / Horas extra (empleado) -----
  $('sol-tabs').querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      S.solTab = b.dataset.t;
      $('sol-tabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('activo', x === b); });
      abrirSolTab(S.solTab);
    });
  });
  function abrirSolTab(t) {
    S.solTab = t;
    $('sol-tabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('activo', x.dataset.t === t); });
    ['sol-vac', 'sol-he', 'sol-cor'].forEach(function (id) { $(id).classList.toggle('hidden', id !== t); });
    if (t === 'sol-he') cargarHorasExtra(); else if (t === 'sol-cor') cargarCorrecciones(); else cargarVacaciones();
  }
  function hmTxt(min) { min = Math.round(min || 0); return Math.floor(min / 60) + 'h' + (min % 60 ? ' ' + ('0' + (min % 60)).slice(-2) + 'm' : ''); }
  function medidor(usado, limite) {
    var pc = Math.min(100, Math.round(usado / limite * 100));
    return '<div class="medidor"><i class="' + (pc >= 100 ? 'lleno' : pc >= 75 ? 'alto' : '') + '" style="width:' + pc + '%"></i></div>';
  }
  $('he-fecha').value = hoyISO();
  function cargarHorasExtra() {
    api({ action: 'misHorasExtra' }).then(function (r) {
      var x = r.resumen, mm = Number(r.mes.slice(5, 7));
      $('he-mes').textContent = MESES[mm - 1] + ' ' + r.mes.slice(0, 4);
      $('he-kpis').innerHTML = [['Hechas (según fichajes)', hmTxt(x.realizadas)], ['Autorizadas', hmTxt(x.autorizadas)], ['Pendientes', hmTxt(x.pendientes)]]
        .map(function (k) { return '<div class="kpi"><b style="font-size:19px">' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join('');
      $('he-lista').innerHTML = r.solicitudes.map(function (h) {
        return '<li><div><div class="t">' + esc(fechaCorta(h.fecha)) + ' · ' + esc(h.desde) + '–' + esc(h.hasta) + ' (' + hmTxt(h.minutos) + ')</div>' +
          '<div class="m">' + esc(h.motivo) + ' · ' + esc(h.compensacionTxt) + '</div>' +
          (h.respuesta ? '<div class="m"><b>Respuesta:</b> ' + esc(h.respuesta) + '</div>' : '') + '</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><span class="chip est-' + esc(h.estado) + '">' + esc(h.estadoTxt) + '</span>' +
          (h.estado === 'PENDIENTE' ? '<button class="btn sec peq" data-hc="' + esc(h.id) + '">Cancelar</button>' : '') + '</div></li>';
      }).join('') || '<li class="m">No tienes solicitudes recientes.</li>';
      $('he-lista').querySelectorAll('[data-hc]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('¿Cancelar esta solicitud?')) return;
          cargando(true);
          api({ action: 'cancelarHorasExtra', id: b.dataset.hc }).then(function (r) { toast(r.mensaje); cargarHorasExtra(); })
            .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
        });
      });
    }).catch(function (e) { toast(e.message); });
  }
  $('he-enviar').addEventListener('click', function () {
    var d = { action: 'solicitarHorasExtra', fecha: $('he-fecha').value, desde: $('he-desde').value, hasta: $('he-hasta').value,
              compensacion: $('he-comp').value, motivo: $('he-motivo').value.trim() };
    if (!d.fecha || !d.desde || !d.hasta) return toast('Completa el día y las horas.');
    if (d.hasta <= d.desde) return toast('La hora de fin debe ser posterior a la de inicio.');
    if (d.motivo.length < 5) return toast('Explica para qué son.');
    cargando(true, 'Enviando…');
    api(d).then(function (r) { toast(r.mensaje, 6000); $('he-motivo').value = ''; cargarHorasExtra(); })
      .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
  });

  // ----- Corregir fichaje (empleado) -----
  function itemsCorreccion(lista) {
    $('co-items').innerHTML = lista.map(function (x) {
      return '<div class="item-c"><select class="co-tipo">' + opcionesTipo(x.tipo) + '</select><input class="co-hora" type="time" value="' + esc(x.hora || '') + '">' +
        '<button class="co-quitar" aria-label="Quitar">×</button></div>';
    }).join('');
    $('co-items').querySelectorAll('.co-quitar').forEach(function (b, i) {
      b.addEventListener('click', function () { var l = leerItems(); if (l.length > 1) { l.splice(i, 1); itemsCorreccion(l); } });
    });
  }
  function leerItems() {
    var t = $('co-items').querySelectorAll('.co-tipo'), h = $('co-items').querySelectorAll('.co-hora'), l = [];
    for (var i = 0; i < t.length; i++) l.push({ tipo: t[i].value, hora: h[i].value });
    return l;
  }
  itemsCorreccion([{ tipo: 'SALIDA', hora: '' }]);
  $('co-fecha').value = hoyISO();
  $('co-mas').addEventListener('click', function () {
    var l = leerItems(); if (l.length >= 6) return;
    var sig = { ENTRADA: 'SALIDA', SALIDA: 'ENTRADA', INICIO_ALMUERZO: 'FIN_ALMUERZO', FIN_ALMUERZO: 'SALIDA', INICIO_COMIDA: 'FIN_COMIDA', FIN_COMIDA: 'SALIDA' }[l[l.length - 1].tipo] || 'SALIDA';
    l.push({ tipo: sig, hora: '' }); itemsCorreccion(l);
  });
  function cargarCorrecciones() {
    api({ action: 'misCorrecciones' }).then(function (r) {
      $('co-lista').innerHTML = r.solicitudes.map(function (x) {
        return '<li><div><div class="t">' + esc(fechaCorta(x.fecha)) + '</div><div class="m">' + x.items.map(function (i) { return esc((ETQ[i.tipo] || i.tipo) + ' ' + i.hora); }).join(', ') +
          '</div>' + (x.respuesta ? '<div class="m"><b>Respuesta:</b> ' + esc(x.respuesta) + '</div>' : '') + '</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><span class="chip est-' + esc(x.estado) + '">' + esc(x.estadoTxt) + '</span>' +
          (x.estado === 'PENDIENTE' ? '<button class="btn sec peq" data-cc="' + esc(x.id) + '">Cancelar</button>' : '') + '</div></li>';
      }).join('') || '<li class="m">No has pedido correcciones.</li>';
      $('co-lista').querySelectorAll('[data-cc]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('¿Cancelar esta corrección?')) return;
          cargando(true);
          api({ action: 'cancelarCorreccion', id: b.dataset.cc }).then(function (r) { toast(r.mensaje); cargarCorrecciones(); })
            .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
        });
      });
    }).catch(function (e) { toast(e.message); });
  }
  $('co-enviar').addEventListener('click', function () {
    var items = leerItems().filter(function (x) { return x.hora; });
    if (!$('co-fecha').value) return toast('Elige el día.');
    if (!items.length) return toast('Pon la hora de lo que falta.');
    for (var k = 0; k < items.length; k++) { var mt = validarTipoHora(items[k].tipo, items[k].hora); if (mt) return toast(mt, 6000); }
    if ($('co-motivo').value.trim().length < 5) return toast('Explica brevemente qué pasó.');
    cargando(true, 'Enviando…');
    api({ action: 'solicitarCorreccion', fecha: $('co-fecha').value, items: items, motivo: $('co-motivo').value.trim() }).then(function (r) {
      toast(r.mensaje, 6000); $('co-motivo').value = ''; itemsCorreccion([{ tipo: 'SALIDA', hora: '' }]); cargarCorrecciones();
    }).catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
  });

  // ----- Correcciones pedidas (admin) -----
  function cargarCorreccionesAdmin() {
    return api({ action: 'adminCorreccionesPend', empresa: S.filtro }).then(function (r) {
      var n = r.pendientes.length, bd = $('adm-badge-co');
      bd.textContent = n; bd.classList.toggle('hidden', !n);
      $('co-pend-card').classList.toggle('hidden', !n);
      $('co-pend').innerHTML = r.pendientes.map(function (x) {
        return '<div class="fila-admin"><div class="cab"><b>' + esc(x.nombre) + '</b><span class="m">' + esc(fechaCorta(x.fecha)) + '</span></div>' +
          '<div class="det">Añadir: <b>' + x.items.map(function (i) { return esc((ETQ[i.tipo] || i.tipo) + ' ' + i.hora); }).join(', ') + '</b><br>«' + esc(x.motivo) + '»</div>' +
          '<div class="acciones" style="margin-top:10px"><button class="btn sec peq" data-cv="' + esc(x.id) + '">Ver el día</button>' +
          '<button class="btn peligro peq" data-cr="' + esc(x.id) + '">Rechazar</button><button class="btn peq" data-ca="' + esc(x.id) + '">Aceptar</button></div></div>';
      }).join('');
      var buscar = function (id) { return r.pendientes.filter(function (x) { return x.id === id; })[0]; };
      $('co-pend').querySelectorAll('[data-ca]').forEach(function (b) { b.addEventListener('click', function () { resolverCorreccion(buscar(b.dataset.ca), true); }); });
      $('co-pend').querySelectorAll('[data-cr]').forEach(function (b) { b.addEventListener('click', function () { resolverCorreccion(buscar(b.dataset.cr), false); }); });
      $('co-pend').querySelectorAll('[data-cv]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = buscar(b.dataset.cv);
          cargarEmpleados().then(function () {
            $('c-empleado').value = x.email; $('c-desde').value = x.fecha; $('c-hasta').value = x.fecha; verFichajes();
            setTimeout(function () { $('c-resumen').scrollIntoView({ behavior: 'smooth' }); }, 400);
          });
        });
      });
    }).catch(function () {});
  }
  function resolverCorreccion(x, aprobar) {
    var txt = x.items.map(function (i) { return (ETQ[i.tipo] || i.tipo) + ' ' + i.hora; }).join(', ');
    abrirModal('<h2>' + (aprobar ? 'Aceptar' : 'Rechazar') + ' corrección</h2><p class="ayuda"><b>' + esc(x.nombre) + '</b> · ' + esc(fechaCorta(x.fecha)) + '<br>' + esc(txt) +
      (aprobar ? '<br>Se añadirá como fichaje manual con el motivo del empleado y tu nombre.' : '') + '</p>' +
      '<label for="rc-txt">' + (aprobar ? 'Mensaje (opcional)' : 'Explica por qué no (obligatorio)') + '</label><textarea id="rc-txt"></textarea>' +
      '<div class="acciones"><button class="btn sec" id="rc-no">Volver</button><button class="btn' + (aprobar ? '' : ' peligro') + '" id="rc-ok">' + (aprobar ? 'Aceptar' : 'Rechazar') + '</button></div>');
    $('rc-no').addEventListener('click', cerrarModal);
    $('rc-ok').addEventListener('click', function () {
      var t = $('rc-txt').value.trim();
      if (!aprobar && t.length < 5) return toast('Escribe el motivo.');
      cargando(true);
      api({ action: 'adminResolverCorreccion', id: x.id, aprobar: aprobar, respuesta: t }).then(function (r) {
        cerrarModal(); toast(r.mensaje, 6000); cargarCorreccionesAdmin();
        if (S.fichajesDias && $('c-empleado').value === x.email) verFichajes();
      }).catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
  }

  // ----- Horas extra (admin) -----
  function cargarHorasExtraAdmin() {
    if (!$('he-pendientes').innerHTML) $('he-pendientes').innerHTML = '<p class="m">Cargando…</p>';
    return api({ action: 'adminHorasExtra', empresa: S.filtro }).then(function (r) {
      var bd = $('adm-badge-he'); bd.textContent = r.pendientes.length; bd.classList.toggle('hidden', !r.pendientes.length);
      $('he-a-anio').textContent = r.anio;
      $('he-pendientes').innerHTML = r.pendientes.map(function (h) {
        var tras = h.llevaAutorizadas + (h.compensacion === 'DESCANSO' ? 0 : h.minutos);
        return '<div class="fila-admin"><div class="cab"><b>' + esc(h.nombre) + '</b><span class="m">' + hmTxt(h.minutos) + '</span></div>' +
          '<div class="det">' + esc(fechaCorta(h.fecha)) + ' · ' + esc(h.desde) + '–' + esc(h.hasta) + ' · prefiere: ' + esc(h.compensacionTxt) +
          '<br>«' + esc(h.motivo) + '»<br>Lleva ' + hmTxt(h.llevaAutorizadas) + ' de 80 h este año' +
          (tras > 80 * 60 ? ' · <span class="inc">con esta superaría el límite</span>' : '') + '</div>' +
          '<div class="acciones" style="margin-top:10px"><button class="btn peligro peq" data-hd="' + esc(h.id) + '">Denegar</button>' +
          '<button class="btn peq" data-ha="' + esc(h.id) + '">Autorizar</button></div></div>';
      }).join('') || '<p class="m">No hay solicitudes pendientes.</p>';
      var buscar = function (id) { return r.pendientes.filter(function (x) { return x.id === id; })[0]; };
      $('he-pendientes').querySelectorAll('[data-ha]').forEach(function (b) { b.addEventListener('click', function () { resolverHE(buscar(b.dataset.ha), true); }); });
      $('he-pendientes').querySelectorAll('[data-hd]').forEach(function (b) { b.addEventListener('click', function () { resolverHE(buscar(b.dataset.hd), false); }); });
      $('he-totales').innerHTML = r.totales.map(function (t) {
        return '<div class="fila-admin"><div class="cab"><b>' + esc(t.nombre) + '</b><span class="m">hechas ' + hmTxt(t.realizadas) + ' · autorizadas ' + hmTxt(t.autorizadas) + '</span></div>' +
          '<div class="det">Cuentan para el límite: ' + hmTxt(t.computanLimite) + ' de 80 h' + (t.descanso ? ' · ' + hmTxt(t.descanso) + ' con descanso' : '') +
          (t.realizadas > t.autorizadas ? ' · <span class="inc">' + hmTxt(t.realizadas - t.autorizadas) + ' hechas sin autorizar</span>' : '') +
          medidor(t.computanLimite, t.limite) + '</div></div>';
      }).join('') || '<p class="m">Nadie tiene horas extra este año.</p>';
      $('he-resueltas').innerHTML = r.resueltas.map(function (h) {
        return '<li><div><div class="t">' + esc(h.nombre) + '</div><div class="m">' + esc(fechaCorta(h.fecha)) + ' · ' + esc(h.desde) + '–' + esc(h.hasta) +
          ' · ' + esc(h.compensacionTxt) + (h.respuesta ? ' · ' + esc(h.respuesta) : '') + '</div></div><span class="chip est-' + esc(h.estado) + '">' + esc(h.estadoTxt) + '</span></li>';
      }).join('') || '<li class="m">Ninguna todavía.</li>';
    }).catch(function (e) { toast(e.message); });
  }
  function resolverHE(h, aprobar) {
    abrirModal('<h2>' + (aprobar ? 'Autorizar' : 'Denegar') + ' horas extra</h2><p class="ayuda"><b>' + esc(h.nombre) + '</b> · ' + esc(fechaCorta(h.fecha)) + ' · ' +
      esc(h.desde) + '–' + esc(h.hasta) + ' (' + hmTxt(h.minutos) + ')</p>' +
      (aprobar ? '<label for="rh-comp">Compensación</label><select id="rh-comp"><option value="PAGO"' + (h.compensacion === 'PAGO' ? ' selected' : '') + '>Se pagan</option>' +
        '<option value="DESCANSO"' + (h.compensacion === 'DESCANSO' ? ' selected' : '') + '>Descanso equivalente (en los 4 meses siguientes)</option></select>' : '') +
      '<label for="rh-txt">' + (aprobar ? 'Mensaje (opcional)' : 'Explica por qué no (obligatorio)') + '</label><textarea id="rh-txt"></textarea>' +
      '<p class="m">Se le enviará un email.</p>' +
      '<div class="acciones"><button class="btn sec" id="rh-no">Volver</button><button class="btn' + (aprobar ? '' : ' peligro') + '" id="rh-ok">' + (aprobar ? 'Autorizar' : 'Denegar') + '</button></div>');
    $('rh-no').addEventListener('click', cerrarModal);
    $('rh-ok').addEventListener('click', function () {
      var txt = $('rh-txt').value.trim();
      if (!aprobar && txt.length < 5) return toast('Escribe el motivo.');
      cargando(true);
      api({ action: 'adminResolverHorasExtra', id: h.id, aprobar: aprobar, respuesta: txt, compensacion: aprobar ? $('rh-comp').value : '' })
        .then(function (r) { cerrarModal(); toast(r.mensaje, 6000); return cargarHorasExtraAdmin(); })
        .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
  }

  // ----- Vacaciones (admin) -----
  function actualizarBadge(n) {
    var pintar = function (k) { var b = $('adm-badge'); b.textContent = k; b.classList.toggle('hidden', !k); };
    if (n !== undefined) return pintar(n);
    api({ action: 'adminSolicitudes', empresa: S.filtro }).then(function (r) { pintar(r.pendientes.length); }).catch(function () {});
    cargarCorreccionesAdmin();
    api({ action: 'adminHorasExtra', empresa: S.filtro }).then(function (r) { var b = $('adm-badge-he'); b.textContent = r.pendientes.length; b.classList.toggle('hidden', !r.pendientes.length); }).catch(function () {});
  }
  function cargarSolicitudes() {
    if (!$('v-pendientes').innerHTML) $('v-pendientes').innerHTML = '<p class="m">Cargando…</p>';
    return api({ action: 'adminSolicitudes', empresa: S.filtro }).then(function (r) {
      actualizarBadge(r.pendientes.length);
      $('v-pendientes').innerHTML = r.pendientes.map(function (x) {
        var queda = x.disponibles == null ? '' : ' · le quedan ' + x.disponibles + (x.disponibles === 1 ? ' día' : ' días') + ' sin contar esta';
        return '<div class="fila-admin"><div class="cab"><b>' + esc(x.nombre) + '</b><span class="m">' + x.dias + ' días</span></div>' +
          '<div class="det">' + esc(txtPeriodo(x.desde, x.hasta)) + esc(queda) + (x.comentario ? '<br>«' + esc(x.comentario) + '»' : '') + '</div>' +
          '<div class="acciones" style="margin-top:10px"><button class="btn peligro peq" data-den="' + esc(x.id) + '">Denegar</button>' +
          '<button class="btn peq" data-apr="' + esc(x.id) + '">Aprobar</button></div></div>';
      }).join('') || '<p class="m">No hay solicitudes pendientes.</p>';
      var buscar = function (id) { return r.pendientes.filter(function (x) { return x.id === id; })[0]; };
      $('v-pendientes').querySelectorAll('[data-apr]').forEach(function (b) { b.addEventListener('click', function () { resolverSolicitud(buscar(b.dataset.apr), true); }); });
      $('v-pendientes').querySelectorAll('[data-den]').forEach(function (b) { b.addEventListener('click', function () { resolverSolicitud(buscar(b.dataset.den), false); }); });
      S.saldosVac = r.saldos;
      $('v-anio').textContent = r.anio;
      var conSobras = r.saldos.filter(function (x) { return x.sobrantesAnterior > 0 && !x.yaPasados; }).length;
      $('v-sobras-aviso').innerHTML = conSobras
        ? '<div class="aviso info">' + conSobras + (conSobras === 1 ? ' persona no disfrutó' : ' personas no disfrutaron') + ' todos sus días de ' + (r.anio - 1) +
          '. Por defecto caducan; si quieres respetárselos, pulsa «Pasar a ' + r.anio + '».</div>' : '';
      $('v-saldos').innerHTML = r.saldos.map(function (x, i) {
        var otros = x.ajustes.filter(function (a) { return a.tipo !== 'ARRASTRE'; });
        return '<div class="fila-admin"><div class="cab"><b>' + esc(x.nombre) + '</b><span>Quedan <b style="font-size:18px' + (x.disponibles < 0 ? ';color:var(--bad)' : '') + '">' + x.disponibles + '</b></span></div>' +
          '<div class="det">' + x.asignados + ' al año' + (x.asignados !== x.base ? ' (' + x.base + (x.arrastrados ? ' + ' + x.arrastrados + ' de ' + (r.anio - 1) : '') +
          otros.map(function (a) { return ' ' + (a.dias > 0 ? '+ ' : '− ') + Math.abs(a.dias) + ' ' + esc(a.motivo); }).join('') + ')' : '') +
          ' · usados ' + x.usados + (x.pendientes ? ' · pendientes ' + x.pendientes : '') +
          (x.sobrantesAnterior > 0 ? '<br>Sin disfrutar de ' + (r.anio - 1) + ': <b>' + x.sobrantesAnterior + '</b>' + (x.yaPasados ? ' · ya pasados' : '') : '') + '</div>' +
          '<div class="mini">' + (x.sobrantesAnterior > 0 && !x.yaPasados ? '<button data-pasar="' + i + '">Pasar ' + x.sobrantesAnterior + ' a ' + r.anio + '</button>' : '') +
          '<button data-ajus="' + i + '">± Ajustar días</button></div></div>';
      }).join('') || '<p class="m">No hay empleados.</p>';
      $('v-saldos').querySelectorAll('[data-pasar]').forEach(function (b) {
        b.addEventListener('click', function () {
          var x = r.saldos[Number(b.dataset.pasar)];
          if (!confirm('¿Pasar a ' + x.nombre + ' los ' + x.sobrantesAnterior + ' días que no disfrutó en ' + (r.anio - 1) + '? Se suman a sus días de ' + r.anio + '.')) return;
          cargando(true);
          api({ action: 'adminAjusteVacaciones', email: x.email, anio: r.anio, dias: x.sobrantesAnterior, tipo: 'ARRASTRE' })
            .then(function (k) { toast(k.mensaje); return cargarSolicitudes(); }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
        });
      });
      $('v-saldos').querySelectorAll('[data-ajus]').forEach(function (b) { b.addEventListener('click', function () { ajustarVac(r.saldos[Number(b.dataset.ajus)], r.anio); }); });
      $('v-resueltas').innerHTML = r.resueltas.map(function (x) {
        return '<li><div><div class="t">' + esc(x.nombre) + '</div><div class="m">' + esc(txtPeriodo(x.desde, x.hasta)) + ' · ' + x.dias + ' días' +
          (x.respuesta ? ' · ' + esc(x.respuesta) : '') + '</div></div><span class="chip est-' + esc(x.estado) + '">' + esc(x.estadoTxt) + '</span></li>';
      }).join('') || '<li class="m">Ninguna todavía.</li>';
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  }
  function ajustarVac(x, anio) {
    var lista = x.ajustes.map(function (a) {
      return '<li><span>' + (a.dias > 0 ? '+' : '') + a.dias + ' · ' + esc(a.motivo) + '</span><button class="btn peligro peq" data-borra="' + esc(a.id) + '">Quitar</button></li>';
    }).join('');
    abrirModal('<h2>Días de ' + esc(x.nombre) + ' en ' + anio + '</h2><p class="ayuda">Base: ' + x.base + ' días. Suma días (antigüedad, convenio, días de otro año) o réstalos.</p>' +
      (lista ? '<ul class="lista">' + lista + '</ul>' : '') +
      '<div class="fila2"><div><label for="aj-dias">Días (− para restar)</label><input id="aj-dias" type="number" inputmode="numeric" step="1" placeholder="2"></div>' +
      '<div><label for="aj-mot">Motivo</label><input id="aj-mot" placeholder="Ej.: antigüedad"></div></div>' +
      '<div class="acciones"><button class="btn sec" id="aj-no">Cerrar</button><button class="btn" id="aj-ok">Añadir</button></div>');
    $('aj-no').addEventListener('click', cerrarModal);
    $('aj-ok').addEventListener('click', function () {
      var d = Number($('aj-dias').value);
      if (!d) return toast('Pon el número de días.');
      cargando(true);
      api({ action: 'adminAjusteVacaciones', email: x.email, anio: anio, dias: d, motivo: $('aj-mot').value.trim() })
        .then(function (k) { cerrarModal(); toast(k.mensaje); return cargarSolicitudes(); }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
    });
    $('modal-hoja').querySelectorAll('[data-borra]').forEach(function (b) {
      b.addEventListener('click', function () {
        cargando(true);
        api({ action: 'adminBorrarAjusteVac', id: b.dataset.borra }).then(function (k) { cerrarModal(); toast(k.mensaje); return cargarSolicitudes(); })
          .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
      });
    });
  }
  function resolverSolicitud(x, aprobar) {
    abrirModal('<h2>' + (aprobar ? 'Aprobar' : 'Denegar') + ' vacaciones</h2><p class="ayuda"><b>' + esc(x.nombre) + '</b> · ' + esc(txtPeriodo(x.desde, x.hasta)) + ' · ' + x.dias + ' días</p>' +
      '<label for="rs-txt">' + (aprobar ? 'Mensaje para el empleado (opcional)' : 'Explica por qué no es posible (obligatorio)') + '</label>' +
      '<textarea id="rs-txt" placeholder="' + (aprobar ? 'Ej.: ¡Disfrútalas!' : 'Ej.: esa semana entregamos el proyecto; ¿te va bien la siguiente?') + '"></textarea>' +
      '<p class="m">Se le enviará un email.' + (aprobar ? ' Los días se marcan solos en el calendario.' : '') + '</p>' +
      '<div class="acciones"><button class="btn sec" id="rs-no">Volver</button><button class="btn' + (aprobar ? '' : ' peligro') + '" id="rs-ok">' + (aprobar ? 'Aprobar' : 'Denegar') + '</button></div>');
    $('rs-no').addEventListener('click', cerrarModal);
    $('rs-ok').addEventListener('click', function () {
      var txt = $('rs-txt').value.trim();
      if (!aprobar && txt.length < 5) return toast('Escribe el motivo.');
      cargando(true);
      api({ action: 'adminResolverSolicitud', id: x.id, aprobar: aprobar, respuesta: txt }).then(function (r) { cerrarModal(); toast(r.mensaje, 6000); return cargarSolicitudes(); })
        .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
  }
  $('v-cierre').addEventListener('click', function () {
    var y = Number(hoyISO().slice(0, 4)), agosto = hoyISO() <= y + '-08-31';
    cargarEmpleados().then(function () {
      formularioAusencia(null, agosto ? { tipo: 'VACACIONES', desde: y + '-08-15', hasta: y + '-08-31', todos: true, nota: 'Cierre de empresa (agosto)' }
                                      : { tipo: 'VACACIONES', desde: y + '-12-22', hasta: (y + 1) + '-01-07', todos: true, nota: 'Cierre de empresa (Navidad)' });
    });
  });

  // =================================================================
  // NÓMINAS
  // =================================================================
  opcionesMeses($('n-mes'), 24);
  (function () { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); $('n-mes').value = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); })();
  $('n-mes').addEventListener('change', function () { cargarNominas(); });
  function cargarNominas() {
    return api({ action: 'adminNominas', mes: $('n-mes').value, empresa: S.filtro }).then(function (r) {
      $('n-estado').innerHTML = r.activas
        ? '<div class="aviso ok">Los empleados <b>ven</b> sus nóminas en «Yo». Se desactiva en Ajustes.</div>'
        : '<div class="aviso warn">Los empleados <b>no ven</b> las nóminas: puedes subirlas y activarlas cuando quieras en Ajustes › Vacaciones y nóminas.</div>';
      S.nominasMes = r.nominas;
      $('n-lista').innerHTML = r.nominas.map(function (n) {
        return '<li><div><div class="t">' + esc(n.nombre) + '</div><div class="m">' + esc(n.archivo) + '</div></div>' +
          '<div style="display:flex;gap:6px"><button class="btn sec peq" data-ver="' + esc(n.id) + '">Ver</button><button class="btn peligro peq" data-bor="' + esc(n.id) + '">Borrar</button></div></li>';
      }).join('') || '<li class="m">No hay nóminas de este mes.</li>';
      $('n-lista').querySelectorAll('[data-ver]').forEach(function (b) { b.addEventListener('click', function () { bajarNomina(b.dataset.ver); }); });
      $('n-lista').querySelectorAll('[data-bor]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('¿Borrar esta nómina?')) return;
          cargando(true);
          api({ action: 'adminBorrarNomina', id: b.dataset.bor }).then(function (r) { toast(r.mensaje); cargarNominas(); })
            .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
        });
      });
    }).catch(function (e) { toast(e.message); });
  }
  function bajarNomina(id) {
    cargando(true, 'Descargando…');
    api({ action: 'descargarNomina', id: id, adminToken: S.adminToken }).then(function (r) { descargarBase64(r, 'application/pdf'); })
      .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  }
  function normTxt(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function adivinarEmpleado(nombreArchivo) {
    var f = ' ' + normTxt(nombreArchivo) + ' ', compacto = f.replace(/ /g, '');
    var cands = S.empleados.filter(function (u) { return deFiltro(u); });
    var porNif = cands.filter(function (u) { return u.nif && compacto.indexOf(normTxt(u.nif).replace(/ /g, '')) >= 0; });
    if (porNif.length === 1) return porNif[0].email;
    var mejor = null, max = 0;
    cands.forEach(function (u) {
      var partes = normTxt(u.nombre).split(' ').filter(function (p) { return p.length > 2; });
      var n = partes.filter(function (p) { return f.indexOf(' ' + p + ' ') >= 0; }).length;
      if (n > max) { max = n; mejor = u.email; } else if (n === max) mejor = null;
    });
    return max >= 2 || (max === 1 && mejor) ? mejor : '';
  }
  $('n-elegir').addEventListener('click', function () { $('n-file').value = ''; $('n-file').click(); });
  $('n-file').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    if (!files.length) return;
    S.colaNominas = files;
    var opts = function (sel) {
      return '<option value="">— Elige empleado —</option>' + S.empleados.filter(deFiltro).map(function (u) {
        return '<option value="' + esc(u.email) + '"' + (u.email === sel ? ' selected' : '') + '>' + esc(u.nombre) + (u.activo ? '' : ' (baja)') + '</option>';
      }).join('');
    };
    $('n-cola').innerHTML = '<ul class="lista" style="margin-top:10px">' + files.map(function (f, i) {
      return '<li style="display:block"><div class="m" style="word-break:break-all">📄 ' + esc(f.name) + '</div><select class="n-quien" data-i="' + i + '" style="margin-top:6px">' + opts(adivinarEmpleado(f.name)) + '</select></li>';
    }).join('') + '</ul><button class="btn" id="n-subir" style="margin-top:12px">Subir ' + files.length + (files.length === 1 ? ' nómina' : ' nóminas') + ' de ' + esc($('n-mes').selectedOptions[0].textContent) + '</button>';
    $('n-subir').addEventListener('click', subirNominas);
  });
  function leerBase64(file) {
    return new Promise(function (ok, ko) {
      var fr = new FileReader();
      fr.onload = function () { ok(String(fr.result).split(',')[1]); };
      fr.onerror = function () { ko(new Error('No se pudo leer ' + file.name)); };
      fr.readAsDataURL(file);
    });
  }
  function subirNominas() {
    var sels = $('n-cola').querySelectorAll('.n-quien'), tareas = [];
    for (var i = 0; i < sels.length; i++) {
      if (!sels[i].value) return toast('Elige el empleado de cada PDF.');
      tareas.push({ file: S.colaNominas[Number(sels[i].dataset.i)], email: sels[i].value });
    }
    var emails = tareas.map(function (t) { return t.email; });
    if (emails.some(function (e, i) { return emails.indexOf(e) !== i; })) return toast('Hay dos PDF asignados a la misma persona.');
    var mes = $('n-mes').value, hechas = 0, errores = [];
    cargando(true, 'Subiendo nóminas…');
    tareas.reduce(function (p, t) {
      return p.then(function () {
        $('cargando-txt').textContent = 'Subiendo ' + (hechas + 1) + ' de ' + tareas.length + '…';
        return leerBase64(t.file).then(function (b64) { return api({ action: 'adminSubirNomina', email: t.email, mes: mes, base64: b64 }); })
          .then(function () { hechas++; }).catch(function (e) { hechas++; errores.push(t.file.name + ': ' + e.message); });
      });
    }, Promise.resolve()).then(function () {
      $('n-cola').innerHTML = errores.length ? '<div class="aviso bad" style="margin-top:10px">' + errores.map(esc).join('<br>') + '</div>' : '';
      toast((tareas.length - errores.length) + ' nóminas subidas.' + (errores.length ? ' ' + errores.length + ' con error.' : ''), 6000);
      cargarNominas();
    }).finally(function () { cargando(false); });
  }

  // ----- Mis nóminas (empleado) -----
  function cargarMisNominas() {
    if (!S.nominasActivas) return;
    var ul = $('yo-nominas-lista'); ul.innerHTML = '<li class="m">Cargando…</li>';
    api({ action: 'misNominas' }).then(function (r) {
      ul.innerHTML = r.nominas.map(function (n) {
        var m = Number(n.mes.slice(5, 7));
        return '<li><span class="t">' + MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1) + ' ' + n.mes.slice(0, 4) + '</span>' +
          '<button class="btn sec peq" data-n="' + esc(n.id) + '">Descargar PDF</button></li>';
      }).join('') || '<li class="m">Todavía no hay nóminas.</li>';
      ul.querySelectorAll('[data-n]').forEach(function (b) {
        b.addEventListener('click', function () {
          cargando(true, 'Descargando…');
          api({ action: 'descargarNomina', id: b.dataset.n }).then(function (r) { descargarBase64(r, 'application/pdf'); })
            .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
        });
      });
    }).catch(function (e) { ul.innerHTML = '<li class="m">' + esc(e.message) + '</li>'; });
  }

  // ---------- Aviso «Instala la app en tu móvil» ----------
  // No sale si ya se abre desde el icono, si este móvil ya la tiene instalada o si pulsó «Ahora no» hace menos de 30 días.
  (function avisoInstalar() {
    var caja = $('aviso-instalar');
    var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
    var lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* modo privado */ } };
    var instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (instalada) { lsSet('fichaje_instalada', '1'); return; }          // abierta desde el icono
    if (lsGet('fichaje_instalada') === '1') return;                      // ya se instaló en este móvil
    if (Date.now() - Number(lsGet('fichaje_instalar_no') || 0) < 30 * 864e5) return;

    var ua = navigator.userAgent;
    var ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|GSA|FBAN|FBAV|Instagram|WhatsApp/.test(ua);
    var android = /android/i.test(ua);
    if (!ios && !android) return;                                         // en el ordenador no hace falta
    var evento = null;
    var botonNo = '<button class="btn sec peq" id="inst-no">Ahora no</button>';

    function mostrar(html) {
      caja.innerHTML = '<div class="card instalar"><img src="icon-192.png" alt=""><div style="flex:1">' +
        '<b>📲 Instala la app en tu móvil</b><p class="m" style="margin:2px 0 0">Tendrás un icono «Fichaje» en la pantalla de inicio y entrarás directo a fichar.</p>' +
        html + '</div></div>';
      var no = $('inst-no');
      if (no) no.addEventListener('click', function () { lsSet('fichaje_instalar_no', String(Date.now())); caja.innerHTML = ''; });
      var si = $('inst-si');
      if (si) si.addEventListener('click', function () {
        if (!evento) return;
        evento.prompt();
        evento.userChoice.then(function (r) { evento = null; if (r.outcome === 'accepted') caja.innerHTML = ''; });
      });
    }
    function quitarYConfirmar() { lsSet('fichaje_instalada', '1'); caja.innerHTML = ''; toast('✅ App instalada: búscala como «Fichaje» en tu pantalla de inicio.'); }
    window.addEventListener('appinstalled', quitarYConfirmar);

    function seguir() {
      if (ios) {
        mostrar(safari
          ? '<ol><li>Toca el botón <b>Compartir</b> ⬆️ (en iPhones nuevos está dentro de <b>···</b>).</li><li>Elige <b>«Añadir a pantalla de inicio»</b>.</li><li>Pulsa <b>Añadir</b>.</li></ol><div class="bt">' + botonNo + '</div>'
          : '<p class="m" style="margin:6px 0 0">Para instalarla, ábrela en <b>Safari</b> (toca ··· o el icono de la brújula › «Abrir en Safari»).</p><div class="bt">' + botonNo + '</div>');
        return;
      }
      window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault(); evento = e;
        mostrar('<div class="bt"><button class="btn peq" id="inst-si">Instalar app</button>' + botonNo + '</div>');
      });
      // Navegadores que no lanzan ese evento (Samsung Internet, Firefox…): pasos a mano
      setTimeout(function () {
        if (!evento && !caja.innerHTML) {
          mostrar('<ol><li>Abre el menú <b>⋮</b> (o ☰) del navegador.</li><li>Elige <b>«Instalar aplicación»</b> o <b>«Añadir a pantalla de inicio»</b>.</li></ol><div class="bt">' + botonNo + '</div>');
        }
      }, 4000);
    }

    // Android con Chrome: comprueba si la app ya está instalada aunque se abra desde el navegador
    if (navigator.getInstalledRelatedApps) {
      navigator.getInstalledRelatedApps().then(function (apps) {
        if (apps && apps.length) { lsSet('fichaje_instalada', '1'); return; }
        seguir();
      }).catch(seguir);
    } else seguir();
  })();

  // ---------- Arranque ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  S.token = leerToken();
  if (S.token) {
    var rapido = iniciarDesdeCache();
    if (!rapido) cargando(true);
    iniciar().then(function () { if (rapido) prepararGeo(); })
      .catch(function (e) { toast(e.message); if (!S.usuario || /sesi/i.test(e.message)) cerrarSesionLocal(); })
      .finally(function () { cargando(false); });
  } else cerrarSesionLocal();
  // Si llega una versión nueva de la app justo al abrirla, se recarga sola una vez
  var abierta = Date.now();
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (Date.now() - abierta < 15000 && !S.recargada) { S.recargada = true; location.reload(); }
  });
})();
