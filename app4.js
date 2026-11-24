/* app.js — PWA de fichaje (v3) */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var S = { token: null, adminToken: null, usuario: null, sede: null, estado: 'FUERA', permitidos: ['ENTRADA'],
            precisionMax: 100, pos: null, geo: null, timerGps: null, offset: 0, empleados: [], sedesLista: [], ajustes: null,
            calMes: null, calDatos: null };
  var $ = function (id) { return document.getElementById(id); };
  var ETQ = { ENTRADA: 'Entrada', INICIO_PAUSA: 'Inicio pausa', FIN_PAUSA: 'Fin pausa', SALIDA: 'Salida' };
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

  function api(payload) {
    if (!navigator.onLine) return Promise.reject(new Error('Sin conexión a Internet.'));
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
      });
  }

  function descargar(nombre, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function descargarXlsx(r) {
    var bin = atob(r.base64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    descargar(r.nombreArchivo, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }

  function abrirModal(html) { $('modal-hoja').innerHTML = html; $('modal').classList.remove('hidden'); }
  function cerrarModal() { $('modal').classList.add('hidden'); $('modal-hoja').innerHTML = ''; }
  $('modal').addEventListener('click', function (e) { if (e.target.id === 'modal') cerrarModal(); });

  // ---------- Navegación ----------
  function mostrar(vista) {
    ['v-login', 'v-fichar', 'v-historial', 'v-admin', 'v-ajustes'].forEach(function (v) { $(v).classList.toggle('hidden', v !== vista); });
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('activo', b.dataset.v === vista); });
    if (vista === 'v-historial') cargarHistorial();
    if (vista === 'v-admin') { if (S.adminToken) abrirPanel('p-hoy'); else setTimeout(function () { $('adm-pin').focus(); }, 50); }
  }
  document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { mostrar(b.dataset.v); }); });

  // ---------- Sesión ----------
  function guardarToken(t) { try { localStorage.setItem('fichaje_token', t); } catch (e) { /* */ } }
  function leerToken() { try { return localStorage.getItem('fichaje_token'); } catch (e) { return null; } }
  function cerrarSesionLocal() {
    try { localStorage.removeItem('fichaje_token'); } catch (e) { /* */ }
    S.token = null; S.adminToken = null; pararGps();
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
  function iniciar() {
    return api({ action: 'estado' }).then(function (r) {
      S.usuario = r.usuario; S.sede = r.sede; S.precisionMax = r.precisionMax;
      S.offset = new Date(r.horaServidor).getTime() - Date.now();
      aplicarEstado(r.estado, r.permitidos, r.ultimo);
      $('h-titulo').textContent = r.usuario.nombre;
      $('h-sub').textContent = r.empresa || CFG.EMPRESA || '';
      var p = $('h-perfil'); p.textContent = r.usuario.perfil; p.className = 'perfil ' + r.usuario.perfil;
      $('nav').classList.remove('hidden');
      $('nav-admin').classList.toggle('hidden', !r.usuario.esAdmin);
      $('aj-nombre').textContent = r.usuario.nombre; $('aj-email').textContent = r.usuario.email;
      $('aj-perfil').textContent = r.usuario.perfil; $('aj-sede').textContent = r.sede ? r.sede.nombre + ' (radio ' + r.sede.radio + ' m)' : '—';
      $('aviso-jornada').innerHTML = r.jornadaAbierta
        ? '<div class="aviso warn">Tu jornada del ' + esc(fechaCorta(r.jornadaAbierta.fecha)) + ' quedó sin ' +
          (r.jornadaAbierta.tipo === 'INICIO_PAUSA' ? 'terminar la pausa' : 'fichar la salida') + '. Avisa a administración para que lo corrija.</div>'
        : '';
      cargarLogo(r.logoVer);
      prepararGeo();
      mostrar('v-fichar');
    });
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
    if (estado === 'DENTRO') { bp.textContent = 'Iniciar pausa / comida'; bp.dataset.tipo = 'INICIO_PAUSA'; bp.classList.remove('hidden'); }
    else if (estado === 'PAUSA') { bp.textContent = 'Terminar pausa y volver al trabajo'; bp.dataset.tipo = 'FIN_PAUSA'; bp.classList.remove('hidden'); }
    else bp.classList.add('hidden');
    actualizarBoton();
    $('c-ultimo').innerHTML = ultimo
      ? '<div class="m">Último fichaje</div><div style="font-size:16px;margin-top:4px"><b>' + esc(ETQ[ultimo.tipo]) + '</b> · ' +
        esc(fechaLarga(ultimo.fechaHora)) + ' a las ' + esc(hora(ultimo.fechaHora)) + '</div>'
      : '<div class="m">Aún no tienes fichajes.</div>';
  }

  function actualizarBoton() {
    var b = $('b-principal'), sub = $('b-principal-sub'), aviso = $('aviso-geo');
    var habilitado = S.permitidos.indexOf(b.dataset.tipo) >= 0;
    aviso.innerHTML = ''; if (sub) sub.textContent = '';
    if (S.estado === 'PAUSA') { habilitado = false; if (sub) sub.textContent = 'Termina la pausa antes'; }
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
      toast('✔ ' + ETQ[r.fichaje.tipo] + ' registrada a las ' + hora(r.fichaje.fechaHora));
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
  opcionesMeses($('h-mes'), 24);
  function cargarHistorial() {
    var ul = $('l-historial'); ul.innerHTML = '<li class="m">Cargando…</li>';
    api({ action: 'historial', limite: 40 }).then(function (r) {
      if (!r.fichajes.length) { ul.innerHTML = '<li class="m">Sin fichajes todavía.</li>'; return; }
      ul.innerHTML = r.fichajes.map(function (f) {
        var extra = f.maps ? ' · <a href="' + esc(f.maps) + '" target="_blank" rel="noopener">ver mapa</a>' : '';
        var origen = f.origen === 'CORRECCION' ? ' <span class="chip">manual</span>' : '';
        return '<li><div><div class="t">' + esc(ETQ[f.tipo]) + origen + '</div><div class="m">' + esc(fechaLarga(f.fechaHora)) +
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
      abrirPanel('p-hoy');
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });
  $('adm-cerrar').addEventListener('click', function () { bloquearAdmin(); toast('Panel cerrado.'); });

  function abrirPanel(id) {
    $('adm-bloqueo').classList.add('hidden'); $('adm-contenido').classList.remove('hidden');
    document.querySelectorAll('#adm-seg button[data-p]').forEach(function (b) { b.classList.toggle('activo', b.dataset.p === id); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('hidden', p.id !== id); });
    if (id === 'p-hoy') cargarResumen();
    if (id === 'p-calendario') { cargarEmpleados(); cargarCalendario(); }
    if (id === 'p-personal' || id === 'p-corregir' || id === 'p-informes') cargarEmpleados();
    if (id === 'p-informes' || id === 'p-ajustes') cargarAjustes();
  }
  document.querySelectorAll('#adm-seg button[data-p]').forEach(function (b) { b.addEventListener('click', function () { abrirPanel(b.dataset.p); }); });

  // ----- Hoy -----
  $('a-fecha').value = hoyISO();
  $('a-ver').addEventListener('click', cargarResumen);
  function cargarResumen() {
    cargando(true);
    api({ action: 'adminResumen', fecha: $('a-fecha').value }).then(function (r) {
      var t = r.totales;
      $('a-festivo').innerHTML = r.festivo ? '<div class="aviso info">Día festivo: ' + esc(r.festivo) + '</div>' : '';
      $('a-kpis').innerHTML = [['Plantilla', t.plantilla], ['Ficharon', t.ficharon], ['Trabajando', t.trabajandoAhora], ['Incidencias', t.incidencias]]
        .map(function (k) { return '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join('');
      $('a-filas').innerHTML = r.filas.map(function (f) {
        var mapas = f.fichajes.filter(function (x) { return x.maps; }).map(function (x) {
          return '<a href="' + esc(x.maps) + '" target="_blank" rel="noopener">' + esc(ETQ[x.tipo]) + ' ' + esc(hora(x.fechaHora)) + '</a>' +
                 (x.direccion ? ' (' + esc(x.direccion) + ')' : '');
        }).join('<br>');
        var manual = f.fichajes.some(function (x) { return x.origen === 'CORRECCION'; }) ? ' · <span class="chip">manual</span>' : '';
        var estadoTxt = f.ausencia && !f.fichajes.length ? f.ausencia : f.estado + (f.ausencia ? ' · ' + f.ausencia : '');
        return '<div class="fila-admin"><div class="cab"><b>' + esc(f.nombre) + '</b><span class="perfil ' + esc(f.perfil) + '">' + esc(f.perfil) + '</span></div>' +
          '<div class="det">' + esc(estadoTxt) + (f.entrada ? ' · ' + esc(f.entrada) + '–' + esc(f.salida || '…') : '') +
          (f.horas ? ' · ' + esc(f.horas) : '') + (f.pausaMin ? ' · pausa ' + f.pausaMin + ' min' : '') + manual +
          (f.incidencia ? ' · <span class="inc">' + esc(f.incidencia) + '</span>' : '') + '</div>' +
          (mapas ? '<div class="det">' + mapas + '</div>' : '') + '</div>';
      }).join('') || '<div class="m">No hay empleados activos.</div>';
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  }

  // ----- Personal -----
  function cargarEmpleados() {
    return api({ action: 'adminUsuarios' }).then(function (r) {
      S.empleados = r.usuarios; S.sedesLista = r.sedes;
      pintarEmpleados();
      var opts = r.usuarios.filter(function (u) { return u.activo; }).map(function (u) {
        return '<option value="' + esc(u.email) + '">' + esc(u.nombre) + '</option>';
      }).join('');
      var cSel = $('c-empleado').value, iSel = $('i-empleado').value;
      $('c-empleado').innerHTML = opts;
      $('i-empleado').innerHTML = r.usuarios.map(function (u) {
        return '<option value="' + esc(u.email) + '">' + esc(u.nombre) + (u.activo ? '' : ' (baja)') + '</option>';
      }).join('');
      if (cSel) $('c-empleado').value = cSel;
      if (iSel) $('i-empleado').value = iSel;
    }).catch(function (e) { toast(e.message); });
  }
  function pintarEmpleados() {
    var q = $('u-buscar').value.trim().toLowerCase();
    var lista = S.empleados.filter(function (u) { return !q || (u.nombre + ' ' + u.email).toLowerCase().indexOf(q) >= 0; });
    var activos = S.empleados.filter(function (u) { return u.activo; }).length;
    $('u-cuenta').textContent = activos + ' activos · ' + (S.empleados.length - activos) + ' de baja';
    $('u-lista').innerHTML = lista.map(function (u, i) {
      return '<li class="click" data-email="' + esc(u.email) + '"><div><div class="t">' + esc(u.nombre) + (u.esAdmin ? ' <span class="chip">admin</span>' : '') +
        (u.tienePin ? '' : ' <span class="chip">sin PIN</span>') + (u.sinGeocerca && u.perfil === 'Oficina' ? ' <span class="chip">ficha fuera</span>' : '') +
        '</div><div class="m">' + esc(u.puesto ? u.puesto + ' · ' : '') + esc(u.email) + '</div></div>' +
        '<span class="perfil ' + (u.activo ? esc(u.perfil) : 'baja') + '">' + (u.activo ? esc(u.perfil) : 'Baja') + '</span></li>';
    }).join('') || '<li class="m">Sin resultados.</li>';
    $('u-lista').querySelectorAll('li[data-email]').forEach(function (li) {
      li.addEventListener('click', function () { editarEmpleado(li.dataset.email); });
    });
  }
  $('u-buscar').addEventListener('input', pintarEmpleados);
  $('u-nuevo').addEventListener('click', function () { editarEmpleado(null); });

  function editarEmpleado(email) {
    var u = email ? S.empleados.filter(function (x) { return x.email === email; })[0] : { email: '', nombre: '', nif: '', perfil: 'Oficina', idSede: (S.sedesLista[0] || {}).id || '', activo: true };
    var nuevo = !email;
    var sedesOpts = '<option value="">— Sin sede —</option>' + S.sedesLista.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (String(u.idSede) === s.id ? ' selected' : '') + '>' + esc(s.nombre) + ' (' + esc(s.id) + ')</option>';
    }).join('');
    abrirModal(
      '<h2>' + (nuevo ? 'Nuevo empleado' : esc(u.nombre)) + '</h2>' +
      '<label for="m-email">Email de empresa</label><input id="m-email" type="email" value="' + esc(u.email) + '"' + (nuevo ? '' : ' disabled') + '>' +
      (nuevo ? '' : '<div class="m" style="margin-top:4px">El email no se puede cambiar porque identifica su histórico. Si cambia, da de baja y crea uno nuevo.</div>') +
      '<label for="m-nombre">Nombre completo</label><input id="m-nombre" value="' + esc(u.nombre) + '">' +
      '<label for="m-puesto">Puesto / profesión (aparece en los Excel)</label><input id="m-puesto" value="' + esc(u.puesto || '') + '" placeholder="Ej.: Arquitecto técnico">' +
      '<label for="m-nif">NIF (opcional, aparece en los Excel)</label><input id="m-nif" value="' + esc(u.nif || '') + '">' +
      '<div class="fila2"><div><label for="m-perfil">Perfil</label><select id="m-perfil">' +
      ['Oficina', 'Obra', 'Teletrabajo'].map(function (p) { return '<option' + (u.perfil === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
      '</select></div><div><label for="m-sede">Sede</label><select id="m-sede">' + sedesOpts + '</select></div></div>' +
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
                    puesto: $('m-puesto').value.trim(), sinGeocerca: $('m-fuera').checked };
      cargando(true);
      api({ action: 'adminGuardarUsuario', usuario: datos }).then(function (r) {
        if (r.pin) mostrarPin(datos.nombre, datos.email, r.pin); else { cerrarModal(); toast(r.mensaje); }
        cargarEmpleados();
      }).catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
    if (!nuevo) {
      $('m-pin').addEventListener('click', function () {
        if (!confirm('¿Generar un PIN nuevo para ' + u.nombre + '? El actual dejará de funcionar y se cerrará su sesión.')) return;
        cargando(true);
        api({ action: 'adminResetPin', email: u.email }).then(function (r) { mostrarPin(r.nombre, u.email, r.pin); cargarEmpleados(); })
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

  // ----- Fichaje manual -----
  $('c-fecha').value = hoyISO();
  $('c-guardar').addEventListener('click', function () {
    var datos = { action: 'adminCorreccion', email: $('c-empleado').value, fecha: $('c-fecha').value, hora: $('c-hora').value,
                  tipo: $('c-tipo').value, motivo: $('c-motivo').value.trim() };
    if (!datos.email || !datos.fecha || !datos.hora) return toast('Completa empleado, fecha y hora.');
    if (datos.motivo.length < 5) return toast('Escribe el motivo de la corrección.');
    var nombre = $('c-empleado').selectedOptions[0].textContent;
    if (!confirm('¿Registrar ' + ETQ[datos.tipo] + ' de ' + nombre + ' el ' + datos.fecha + ' a las ' + datos.hora + '?\nNo se podrá borrar.')) return;
    cargando(true);
    api(datos).then(function (r) { toast(r.mensaje, 6000); $('c-motivo').value = ''; $('c-hora').value = ''; })
      .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
  });

  // ----- Informes -----
  opcionesMeses($('i-mes'), 36);
  $('e-desde').value = hoyISO().slice(0, 8) + '01'; $('e-hasta').value = hoyISO();
  $('i-descargar').addEventListener('click', function () {
    if (!$('i-empleado').value) return toast('Elige un empleado.');
    cargando(true, 'Generando Excel…');
    api({ action: 'adminInforme', email: $('i-empleado').value, mes: $('i-mes').value, formato: $('i-formato').value }).then(descargarXlsx)
      .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });
  $('i-archivar').addEventListener('click', function () {
    var mes = $('i-mes').value;
    if (!confirm('¿Archivar en Google Drive los informes de ' + $('i-mes').selectedOptions[0].textContent + '?\nSi ya existían, se sustituyen por los nuevos.')) return;
    cargando(true, 'Generando los Excel de cada empleado… puede tardar 2–3 minutos.');
    api({ action: 'adminArchivarMes', mes: mes }).then(function (r) {
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
    api({ action: 'adminExport', desde: $('e-desde').value, hasta: $('e-hasta').value }).then(function (r) {
      descargar(r.nombreArchivo, new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' }));
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });

  // ----- Ajustes -----
  function cargarAjustes() {
    return api({ action: 'adminAjustes' }).then(function (r) {
      S.ajustes = r;
      $('s-empresa').value = r.config.EMPRESA || ''; $('s-cif').value = r.config.CIF || '';
      $('s-prec').value = r.config.PRECISION_MAX_M; $('s-sesion').value = r.config.SESION_DIAS; $('s-hmax').value = r.config.HORAS_MAX_JORNADA_ABIERTA;
      $('i-auto').checked = !!r.archivoAuto;
      $('s-geocerca').checked = r.config.GEOCERCA_ACTIVA !== false;
      $('s-recordatorios').checked = !!r.config.RECORDATORIOS;
      $('s-h-entrada').value = r.config.HORA_AVISO_ENTRADA || '08:30';
      $('s-h-salida').value = r.config.HORA_AVISO_SALIDA || '18:00';
      $('s-h-viernes').value = r.config.HORA_AVISO_SALIDA_VIERNES || '14:30';
      cargarLogo(r.logoVer); pintarLogoAjustes();
      if (r.carpetaUrl) $('i-carpeta').innerHTML = '<a href="' + esc(r.carpetaUrl) + '" target="_blank" rel="noopener">Abrir la carpeta de archivo en Google Drive</a>';
      pintarSedes(r.sedes);
    }).catch(function (e) { toast(e.message); });
  }
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
    var grandes = sedes.filter(function (s) { return s.radio > 300; });
    if (grandes.length && !confirm('El radio de ' + grandes.map(function (s) { return s.nombre || s.id; }).join(', ') +
        ' es de ' + grandes[0].radio + ' m. Con un radio tan grande se podría fichar «en la oficina» desde bastante lejos. ¿Guardar igualmente?')) return;
    cargando(true);
    api({ action: 'adminGuardarAjustes', config: { EMPRESA: $('s-empresa').value, CIF: $('s-cif').value, PRECISION_MAX_M: num($('s-prec').value),
          SESION_DIAS: num($('s-sesion').value), HORAS_MAX_JORNADA_ABIERTA: num($('s-hmax').value),
          GEOCERCA_ACTIVA: $('s-geocerca').checked, RECORDATORIOS: $('s-recordatorios').checked,
          HORA_AVISO_ENTRADA: $('s-h-entrada').value, HORA_AVISO_SALIDA: $('s-h-salida').value,
          HORA_AVISO_SALIDA_VIERNES: $('s-h-viernes').value },
          sedes: sedes, appUrl: location.href.split('#')[0].split('?')[0] })
      .then(function (r) { toast(r.mensaje); cargarAjustes(); })
      .catch(function (e) { toast(e.message, 7000); }).finally(function () { cargando(false); });
  });
  $('s-integridad').addEventListener('click', function () {
    cargando(true);
    api({ action: 'adminIntegridad' }).then(function (r) {
      $('s-integridad-res').innerHTML = '<div class="aviso ' + (r.integro ? 'ok' : 'bad') + '">' + esc(r.mensaje) + '</div>';
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  });

  // ----- Logo (ajustes) -----
  function pintarLogoAjustes() {
    var src = $('h-logo').getAttribute('src');
    $('s-logo-prev').innerHTML = src ? '<img src="' + src + '" alt="Logo">' : 'Sin logo';
  }
  $('s-logo-subir').addEventListener('click', function () { $('s-logo-file').click(); });
  $('s-logo-file').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
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
        api({ action: 'adminSubirLogo', mime: png ? 'image/png' : 'image/jpeg', base64: dataUrl.split(',')[1] }).then(function (r) {
          try { localStorage.setItem('fichaje_logo', JSON.stringify({ v: r.logoVer, src: dataUrl })); } catch (e) { /* */ }
          pintarLogo(dataUrl); pintarLogoAjustes(); toast(r.mensaje);
        }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
      };
      img.onerror = function () { toast('No se pudo leer la imagen.'); };
      img.src = lector.result;
    };
    lector.readAsDataURL(f);
  });
  $('s-logo-borrar').addEventListener('click', function () {
    if (!$('h-logo').getAttribute('src')) return toast('No hay logo.');
    if (!confirm('¿Quitar el logo de la app y de los Excel?')) return;
    cargando(true);
    api({ action: 'adminBorrarLogo' }).then(function (r) { cargarLogo(null); pintarLogoAjustes(); toast(r.mensaje); })
      .catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
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
    return api({ action: 'adminCalendario', mes: S.calMes }).then(function (r) { S.calDatos = r.entradas; pintarCalendario(r.entradas); })
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
        var txt = e.tipo === 'FESTIVO' ? (e.nota || 'Festivo') : e.nombre.split(' ')[0];
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

  function formularioAusencia(fecha) {
    var hoy = fecha || hoyISO();
    var activos = S.empleados.filter(function (u) { return u.activo; });
    abrirModal('<h2>Marcar días</h2>' +
      '<label>¿Qué es?</label><div class="tipos" id="f-tipos">' +
      Object.keys(TIPOS_CAL).map(function (k, i) {
        return '<button data-t="' + k + '"' + (i === 0 && !fecha ? '' : '') + '>' + TIPOS_CAL[k] + (k === 'FESTIVO' ? '<div class="m" style="font-weight:400">toda la empresa</div>' : '') + '</button>';
      }).join('') + '</div>' +
      '<div class="fila2"><div><label for="f-desde">Desde</label><input id="f-desde" type="date" value="' + hoy + '"></div>' +
      '<div><label for="f-hasta">Hasta (incluido)</label><input id="f-hasta" type="date" value="' + hoy + '"></div></div>' +
      '<div id="f-personas"><label>¿Quién?</label><div class="checks">' +
      '<label><input type="checkbox" id="f-todos"> <b>Seleccionar a todos</b></label>' +
      activos.map(function (u) { return '<label><input type="checkbox" class="f-emp" value="' + esc(u.email) + '"> ' + esc(u.nombre) + '</label>'; }).join('') +
      '</div></div>' +
      '<label for="f-nota">Nota (opcional)</label><input id="f-nota" placeholder="Ej.: Fiestas patronales, operación de rodilla…">' +
      '<p class="m" style="margin-top:8px">Los sábados y domingos se saltan automáticamente (salvo en festivos).</p>' +
      '<div class="acciones"><button class="btn sec" id="f-cancelar">Cancelar</button><button class="btn" id="f-guardar">Guardar</button></div>');
    var tipo = null;
    $('f-tipos').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        tipo = b.dataset.t;
        $('f-tipos').querySelectorAll('button').forEach(function (x) { x.classList.toggle('sel', x === b); });
        $('f-personas').classList.toggle('hidden', tipo === 'FESTIVO');
      });
    });
    $('f-desde').addEventListener('change', function () { if ($('f-hasta').value < this.value) $('f-hasta').value = this.value; });
    $('f-todos').addEventListener('change', function () {
      var on = this.checked; $('modal-hoja').querySelectorAll('.f-emp').forEach(function (c) { c.checked = on; });
    });
    $('f-cancelar').addEventListener('click', cerrarModal);
    $('f-guardar').addEventListener('click', function () {
      if (!tipo) return toast('Elige qué es: festivo, vacaciones, baja…');
      var emails = Array.prototype.map.call($('modal-hoja').querySelectorAll('.f-emp:checked'), function (c) { return c.value; });
      if (tipo !== 'FESTIVO' && !emails.length) return toast('Marca al menos a una persona.');
      cargando(true);
      api({ action: 'adminGuardarCalendario', tipo: tipo, desde: $('f-desde').value, hasta: $('f-hasta').value, emails: emails, nota: $('f-nota').value })
        .then(function (r) { cerrarModal(); toast(r.mensaje); S.calMes = $('f-desde').value.slice(0, 7); return cargarCalendario(); })
        .catch(function (e) { toast(e.message, 6000); }).finally(function () { cargando(false); });
    });
  }

  // ---------- Arranque ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  S.token = leerToken();
  if (S.token) {
    cargando(true);
    iniciar().catch(function (e) { toast(e.message); if (!S.usuario) cerrarSesionLocal(); }).finally(function () { cargando(false); });
  } else cerrarSesionLocal();
})();
