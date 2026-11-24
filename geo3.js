/**
 * geo.js — Geolocalización y geofencing con la fórmula de Haversine.
 * Funciona en el navegador (window.Geo) y en Node (module.exports) para poder testearlo.
 */
(function (global) {
  'use strict';

  var RADIO_TIERRA_M = 6371008.8; // radio medio terrestre (IUGG), en metros
  var RAD = Math.PI / 180;

  /**
   * Distancia ortodrómica en metros entre dos puntos (lat/lng en grados decimales).
   * Haversine:  a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
   *             d = 2R · asin(√a)
   */
  function haversineMetros(lat1, lng1, lat2, lng2) {
    [lat1, lng1, lat2, lng2].forEach(function (v) {
      if (typeof v !== 'number' || !isFinite(v)) throw new TypeError('Coordenada no válida: ' + v);
    });
    var dLat = (lat2 - lat1) * RAD;
    var dLng = (lng2 - lng1) * RAD;
    var a = Math.pow(Math.sin(dLat / 2), 2) +
            Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /**
   * Valida si una posición está dentro del radio de la sede.
   * @param {{lat:number,lng:number,precision?:number}} pos  posición del dispositivo
   * @param {{lat:number,lng:number,radio:number}} sede       oficina (radio en metros, p. ej. 100)
   * @param {number} [precisionMax=100]                        precisión GPS máxima aceptable en metros
   * @returns {{dentro:boolean, distancia:number, motivo:string|null}}
   */
  function validarGeocerca(pos, sede, precisionMax) {
    precisionMax = precisionMax || 100;
    var distancia = Math.round(haversineMetros(pos.lat, pos.lng, sede.lat, sede.lng));
    if (typeof pos.precision === 'number' && pos.precision > precisionMax) {
      return { dentro: false, distancia: distancia, motivo: 'PRECISION' };
    }
    if (distancia > sede.radio) return { dentro: false, distancia: distancia, motivo: 'FUERA_RANGO' };
    return { dentro: true, distancia: distancia, motivo: null };
  }

  /**
   * Obtiene la mejor posición posible en un tiempo máximo.
   * Escucha varias lecturas y se queda con la más precisa; resuelve antes si alcanza la precisión objetivo.
   */
  function obtenerPosicion(opciones) {
    opciones = opciones || {};
    var tiempoMax = opciones.tiempoMax || 10000;
    var objetivo = opciones.precisionObjetivo || 25;
    return new Promise(function (resolve, reject) {
      if (!('geolocation' in navigator)) return reject(new Error('Este navegador no permite obtener la ubicación.'));
      var mejor = null, terminado = false;
      function fin(err) {
        if (terminado) return;
        terminado = true;
        navigator.geolocation.clearWatch(id);
        clearTimeout(t);
        if (mejor) resolve(mejor); else reject(err || new Error('No se pudo obtener la ubicación. Revisa que el GPS esté activado.'));
      }
      var id = navigator.geolocation.watchPosition(function (p) {
        var lectura = { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, ts: p.timestamp };
        if (!mejor || lectura.precision < mejor.precision) mejor = lectura;
        if (lectura.precision <= objetivo) fin();
      }, function (e) {
        var msg = e.code === 1
          ? 'Permiso de ubicación denegado. Actívalo en los ajustes del navegador para esta app.'
          : 'No se pudo obtener la ubicación (' + e.message + ').';
        fin(new Error(msg));
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: tiempoMax });
      var t = setTimeout(function () { fin(); }, tiempoMax);
    });
  }

  var api = { haversineMetros: haversineMetros, validarGeocerca: validarGeocerca, obtenerPosicion: obtenerPosicion };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Geo = api;
})(typeof window !== 'undefined' ? window : this);
