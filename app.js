/* app.js — Lógica de la PWA de fichaje */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var MSG_FUERA_RANGO = 'Te encuentras fuera del rango de la oficina (100 m). No puedes fichar en modalidad presencial';
  var S = { token: null, usuario: null, sede: null, estado: 'FUERA', permitidos: ['ENTRADA'], precisionMax: 100, pos: null, geo: null, timerGps: null, offset: 0 };
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Utilidades ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.add('hidden'); }, ms || 4000);
  }
  function cargando(on) { $('cargando').classList.toggle('hidden', !on); }
  function hoyISO() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function hora(iso) { return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function fechaLarga(iso) { return new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); }
  var ETQ = { ENTRADA: 'Entrada', INICIO_PAUSA: 'Inicio pausa', FIN_PAUSA: 'Fin pausa', SALIDA: 'Salida' };
  var EST = { FUERA: 'Fuera de jornada', DENTRO: 'Trabajando', PAUSA: 'En pausa' };

  function api(payload) {
    if (!navigator.onLine) return Promise.reject(new Error('Sin conexión a Internet. El fichaje necesita conexión para registrar la hora oficial.'));
    if (S.token && !payload.token) payload.token = S.token;
    // text/plain evita la petición CORS "preflight", que Apps Script no admite
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('Servidor no disponible (' + r.status + ').'); return r.json(); })
      .then(function (j) {
        if (!j.ok) {
          if (/Sesión (caducada|no iniciada)/.test(j.error)) cerrarSesionLocal();
          throw new Error(j.error || 'Error desconocido');
        }
        return j;
      });
  }

  // ---------- Navegación ----------
  function mostrar(vista) {
    ['v-login', 'v-fichar', 'v-historial', 'v-admin', 'v-ajustes'].forEach(function (v) { $(v).classList.toggle('hidden', v !== vista); });
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('activo', b.dataset.v === vista); });
    if (vista === 'v-historial') cargarHistorial();
    if (vista === 'v-admin' && !$('a-filas').innerHTML) cargarResumen();
  }
  document.querySelectorAll('nav button').forEach(function (b) { b.addEventListener('click', function () { mostrar(b.dataset.v); }); });

  // ---------- Sesión ----------
  function guardarToken(t) { try { localStorage.setItem('fichaje_token', t); } catch (e) { /* modo privado */ } }
  function leerToken() { try { return localStorage.getItem('fichaje_token'); } catch (e) { return null; } }
  function cerrarSesionLocal() {
    try { localStorage.removeItem('fichaje_token'); } catch (e) { /* */ }
    S.token = null; pararGps();
    $('nav').classList.add('hidden'); $('h-perfil').classList.add('hidden');
    $('h-titulo').textContent = 'Fichaje'; $('h-sub').textContent = CFG.EMPRESA || 'Registro de jornada';
    mostrar('v-login');
  }

  $('f-login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    cargando(true);
    api({ action: 'login', email: $('i-email').value.trim(), pin: $('i-pin').value.trim() })
      .then(function (r) { S.token = r.token; guardarToken(r.token); $('i-pin').value = ''; return iniciar(); })
      .catch(function (e) { toast(e.message); })
      .finally(function () { cargando(false); });
  });

  $('b-salir').addEventListener('click', function () {
    api({ action: 'logout' }).catch(function () { /* da igual */ }).finally(cerrarSesionLocal);
  });

  // ---------- Pantalla principal ----------
  function iniciar() {
    return api({ action: 'estado' }).then(function (r) {
      S.usuario = r.usuario; S.sede = r.sede; S.precisionMax = r.precisionMax;
      S.offset = new Date(r.horaServidor).getTime() - Date.now();
      aplicarEstado(r.estado, r.permitidos, r.ultimo);

      $('h-titulo').textContent = r.usuario.nombre;
      $('h-sub').textContent = CFG.EMPRESA || '';
      var p = $('h-perfil'); p.textContent = r.usuario.perfil; p.className = 'perfil ' + r.usuario.perfil;
      $('nav').classList.remove('hidden');
      $('nav-admin').classList.toggle('hidden', String(r.usuario.rol).toLowerCase() !== 'admin');
      $('aj-nombre').textContent = r.usuario.nombre; $('aj-email').textContent = r.usuario.email;
      $('aj-perfil').textContent = r.usuario.perfil; $('aj-sede').textContent = r.sede ? r.sede.nombre : '—';

      prepararGeo();
      mostrar('v-fichar');
    });
  }

  function aplicarEstado(estado, permitidos, ultimo) {
    S.estado = estado; S.permitidos = permitidos;
    var txt = '<b>' + EST[estado] + '</b>';
    if (ultimo && estado !== 'FUERA') txt += ' · desde las ' + hora(ultimo.fechaHora);
    $('estado').innerHTML = txt;

    var b = $('b-principal');
    var esEntrada = permitidos.indexOf('ENTRADA') >= 0;
    b.className = 'fichar ' + (esEntrada ? 'entrada' : 'salida');
    b.innerHTML = 'Fichar<br>' + (esEntrada ? 'Entrada' : 'Salida') + '<small id="b-principal-sub"></small>';
    b.dataset.tipo = esEntrada ? 'ENTRADA' : 'SALIDA';

    var bp = $('b-pausa');
    if (estado === 'DENTRO') { bp.textContent = 'Iniciar pausa / comida'; bp.dataset.tipo = 'INICIO_PAUSA'; bp.classList.remove('hidden'); }
    else if (estado === 'PAUSA') { bp.textContent = 'Terminar pausa y volver al trabajo'; bp.dataset.tipo = 'FIN_PAUSA'; bp.classList.remove('hidden'); }
    else bp.classList.add('hidden');
    // En pausa no se puede salir directamente: hay que terminar la pausa primero
    actualizarBoton();

    var c = $('c-ultimo');
    c.innerHTML = ultimo
      ? '<div class="m" style="color:var(--muted);font-size:13px">Último fichaje</div><div style="font-size:16px;margin-top:4px"><b>' +
        esc(ETQ[ultimo.tipo]) + '</b> · ' + esc(fechaLarga(ultimo.fechaHora)) + ' a las ' + esc(hora(ultimo.fechaHora)) + '</div>'
      : '<div style="color:var(--muted)">Aún no tienes fichajes.</div>';
  }

  function actualizarBoton() {
    var b = $('b-principal'), sub = $('b-principal-sub'), aviso = $('aviso-geo');
    var tipo = b.dataset.tipo;
    var habilitado = S.permitidos.indexOf(tipo) >= 0;
    aviso.innerHTML = '';
    if (sub) sub.textContent = '';
    if (S.estado === 'PAUSA') { habilitado = false; if (sub) sub.textContent = 'Termina la pausa antes'; }

    if (S.usuario && S.usuario.perfil === 'Oficina' && habilitado) {
      if (!S.sede) { habilitado = false; aviso.innerHTML = '<div class="aviso bad">No tienes oficina asignada. Contacta con RRHH.</div>'; }
      else if (!S.geo) { habilitado = false; if (sub) sub.textContent = 'Buscando tu ubicación…'; }
      else if (S.geo.motivo === 'FUERA_RANGO') { habilitado = false; aviso.innerHTML = '<div class="aviso bad">' + esc(MSG_FUERA_RANGO) + '</div>'; }
      else if (S.geo.motivo === 'PRECISION') { habilitado = false; aviso.innerHTML = '<div class="aviso warn">Señal GPS poco precisa (±' + Math.round(S.pos.precision) + ' m). Acércate a una ventana o espera unos segundos.</div>'; }
      else if (S.geo.dentro) aviso.innerHTML = '<div class="aviso ok">Estás en ' + esc(S.sede.nombre) + ' (a ' + S.geo.distancia + ' m).</div>';
      if (S.geo) $('gps-info').textContent = 'Distancia a la oficina: ' + S.geo.distancia + ' m · precisión ±' + Math.round(S.pos.precision) + ' m · radio permitido ' + S.sede.radio + ' m';
    }
    b.disabled = !habilitado;
  }

  // ---------- GPS por perfil ----------
  function prepararGeo() {
    pararGeoInfo();
    var perfil = S.usuario.perfil;
    if (perfil === 'Oficina') {
      refrescarPosicion();
      S.timerGps = setInterval(refrescarPosicion, CFG.INTERVALO_GPS_MS || 15000);
    } else if (perfil === 'Obra') {
      $('gps-info').textContent = 'Al fichar se registrará la hora y tu ubicación en ese momento.';
    } else {
      $('gps-info').textContent = 'Teletrabajo: se registra solo la hora, sin ubicación.';
    }
    actualizarBoton();
  }
  function pararGeoInfo() { $('gps-info').textContent = ''; pararGps(); S.geo = null; S.pos = null; }
  function pararGps() { if (S.timerGps) { clearInterval(S.timerGps); S.timerGps = null; } }

  function refrescarPosicion() {
    if (document.hidden) return;
    Geo.obtenerPosicion({ tiempoMax: 8000, precisionObjetivo: 20 })
      .then(function (pos) {
        S.pos = pos;
        S.geo = S.sede ? Geo.validarGeocerca(pos, S.sede, S.precisionMax) : null;
        actualizarBoton();
      })
      .catch(function (e) {
        S.geo = null; S.pos = null; actualizarBoton();
        $('aviso-geo').innerHTML = '<div class="aviso warn">' + esc(e.message) + '</div>';
      });
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && S.token) {
      // Al volver a la app, refresca estado (por si fichó desde otro dispositivo) y posición
      api({ action: 'estado' }).then(function (r) { aplicarEstado(r.estado, r.permitidos, r.ultimo); }).catch(function () {});
      if (S.usuario && S.usuario.perfil === 'Oficina') refrescarPosicion();
    }
  });

  // ---------- Fichar ----------
  function fichar(tipo) {
    var perfil = S.usuario.perfil;
    cargando(true);
    var obtener = perfil === 'Teletrabajo'
      ? Promise.resolve(null)
      : Geo.obtenerPosicion({ tiempoMax: perfil === 'Obra' ? 12000 : 8000, precisionObjetivo: 20 });

    obtener.then(function (pos) {
      if (perfil === 'Oficina') {
        var v = Geo.validarGeocerca(pos, S.sede, S.precisionMax);
        S.pos = pos; S.geo = v; actualizarBoton();
        if (!v.dentro) throw new Error(v.motivo === 'FUERA_RANGO' ? MSG_FUERA_RANGO : 'Señal GPS poco precisa. Inténtalo de nuevo en unos segundos.');
      }
      return api({
        action: 'fichar', tipo: tipo,
        lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, precision: pos ? pos.precision : null,
        dispositivo: navigator.userAgent
      });
    }).then(function (r) {
      if (navigator.vibrate) navigator.vibrate(80);
      aplicarEstado(r.estado, r.permitidos, r.fichaje);
      toast('✔ ' + ETQ[r.fichaje.tipo] + ' registrada a las ' + hora(r.fichaje.fechaHora));
    }).catch(function (e) {
      toast(e.message, 6000);
    }).finally(function () { cargando(false); });
  }
  $('b-principal').addEventListener('click', function () { fichar(this.dataset.tipo); });
  $('b-pausa').addEventListener('click', function () { fichar(this.dataset.tipo); });

  // ---------- Reloj (hora del servidor) ----------
  function tic() {
    var d = new Date(Date.now() + S.offset);
    $('reloj').textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('fecha').textContent = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  setInterval(tic, 1000); tic();

  // ---------- Historial ----------
  function cargarHistorial() {
    var ul = $('l-historial'); ul.innerHTML = '<li class="m">Cargando…</li>';
    api({ action: 'historial', limite: 40 }).then(function (r) {
      if (!r.fichajes.length) { ul.innerHTML = '<li class="m">Sin fichajes todavía.</li>'; return; }
      ul.innerHTML = r.fichajes.map(function (f) {
        var extra = f.maps ? ' · <a href="' + esc(f.maps) + '" target="_blank" rel="noopener">ver mapa</a>' : '';
        var origen = f.origen === 'CORRECCION' ? ' <span class="chip">corregido</span>' : '';
        return '<li><div><div class="t">' + esc(ETQ[f.tipo]) + origen + '</div><div class="m">' + esc(fechaLarga(f.fechaHora)) +
               ' · ' + esc(f.modalidad) + extra + '</div></div><div class="t">' + esc(hora(f.fechaHora)) + '</div></li>';
      }).join('');
    }).catch(function (e) { ul.innerHTML = '<li class="m">' + esc(e.message) + '</li>'; });
  }

  // ---------- Admin ----------
  $('a-fecha').value = hoyISO(); $('e-desde').value = hoyISO().slice(0, 8) + '01'; $('e-hasta').value = hoyISO();
  $('a-ver').addEventListener('click', cargarResumen);

  function cargarResumen() {
    cargando(true);
    api({ action: 'adminResumen', fecha: $('a-fecha').value }).then(function (r) {
      var t = r.totales;
      $('a-kpis').innerHTML = [['Plantilla', t.plantilla], ['Ficharon', t.ficharon], ['Trabajando', t.trabajandoAhora], ['Incidencias', t.incidencias]]
        .map(function (k) { return '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join('');
      $('a-filas').innerHTML = r.filas.map(function (f) {
        var mapas = f.fichajes.filter(function (x) { return x.maps; }).map(function (x) {
          return '<a href="' + esc(x.maps) + '" target="_blank" rel="noopener">' + esc(ETQ[x.tipo]) + ' ' + esc(hora(x.fechaHora)) + '</a>' +
                 (x.direccion ? ' <span class="m">(' + esc(x.direccion) + ')</span>' : '');
        }).join('<br>');
        return '<div class="fila-admin"><div class="cab"><b>' + esc(f.nombre) + '</b><span class="perfil ' + esc(f.perfil) + '">' + esc(f.perfil) + '</span></div>' +
          '<div class="det">' + esc(f.estado) + (f.entrada ? ' · ' + esc(f.entrada) + '–' + esc(f.salida || '…') : '') +
          (f.horas ? ' · ' + esc(f.horas) : '') + (f.pausaMin ? ' · pausa ' + f.pausaMin + ' min' : '') +
          (f.incidencia ? ' · <span class="inc">' + esc(f.incidencia) + '</span>' : '') + '</div>' +
          (mapas ? '<div class="det">' + mapas + '</div>' : '') + '</div>';
      }).join('') || '<div class="m">No hay usuarios activos.</div>';
    }).catch(function (e) { toast(e.message); }).finally(function () { cargando(false); });
  }

  $('e-descargar').addEventListener('click', function () {
    cargando(true);
    api({ action: 'adminExport', desde: $('e-desde').value, hasta: $('e-hasta').value, formato: $('e-formato').value })
      .then(function (r) {
        // BOM UTF-8 + separador ";" para que Excel en español abra tildes y columnas correctamente
        var blob = new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = r.nombreArchivo;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      })
      .catch(function (e) { toast(e.message); })
      .finally(function () { cargando(false); });
  });

  // ---------- Arranque ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  S.token = leerToken();
  if (S.token) {
    cargando(true);
    iniciar().catch(function (e) { toast(e.message); if (!S.usuario) cerrarSesionLocal(); }).finally(function () { cargando(false); });
  } else {
    cerrarSesionLocal();
  }
})();
