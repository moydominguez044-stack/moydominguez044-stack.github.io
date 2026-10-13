/* Rutas Nicaragua — app instalable
 * Pegá aquí la URL de tu implementación de Apps Script (termina en /exec).
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbx-7y2AJ_uKLD7UIp_dgMJtB51kntCy3LPVubtjgzGXJrWxeyIrDyRo3YeZwKNRZu-pkg/exec';

const LITROS_POR_GALON = 3.785, LETRAS = 'ABCDEFGHIJ', MAX = 10, MAX_HIST = 20;
const $ = id => document.getElementById(id);
const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const leerLS = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };

let vehiculos = [], preciosRef = null, ultimo = null; // ultimo = viaje mostrado

/* ---------- Comunicación con Apps Script ---------- */
async function api(accion, params = {}) {
  if (!API_URL.startsWith('https://')) throw new Error('Falta configurar la URL de Apps Script en app.js.');
  const url = new URL(API_URL);
  url.searchParams.set('accion', accion);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  let res;
  try { res = await fetch(url, { redirect: 'follow' }); }
  catch (e) { throw new Error(navigator.onLine ? 'No se pudo conectar con el servidor.' : 'Sin conexión a internet.'); }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error del servidor.');
  return json.data;
}

/* ---------- Inicio ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  conectarEventos();
  setParadas([{ texto: 'Managua, Managua' }, { texto: 'Chinandega, Chinandega' }]);
  pintarHistorial();
  estadoRed();

  const guardados = leerLS('rn_datos', null);
  if (guardados) aplicarDatos(guardados);
  try {
    const datos = await api('datos');
    guardarLS('rn_datos', datos);
    aplicarDatos(datos);
  } catch (e) {
    if (!guardados) $('error').textContent = e.message;
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});

function aplicarDatos(d) {
  const lista = [];
  Object.keys(d.municipios).forEach(dep => d.municipios[dep].forEach(m => lista.push(m + ', ' + dep)));
  lista.sort((a, b) => a.localeCompare(b, 'es'));
  $('lugares').innerHTML = lista.map(l => `<option value="${l}">`).join('');

  vehiculos = d.vehiculos;
  preciosRef = d.precios;
  const pref = leerLS('rn_vehiculo', null);
  $('vehiculo').innerHTML = vehiculos.map(v => `<option value="${v.id}">${v.nombre}</option>`).join('');
  if (pref) {
    $('vehiculo').value = pref.id; $('unidad').value = pref.unidad;
    $('rendimiento').value = pref.rendimiento; $('combustible').value = pref.combustible;
  } else {
    $('vehiculo').value = 'sedan_m'; aplicarVehiculo();
  }
  ponerPrecios(leerLS('rn_precios', null) || preciosRef);
  calcularCosto();
}

function conectarEventos() {
  $('agregar').onclick = () => { const p = getParadas(true); if (p.length >= MAX) return; p.splice(p.length - 1, 0, { texto: '' }); setParadas(p); };
  $('invertir').onclick = () => setParadas(getParadas(true).reverse());
  $('calcular').onclick = calcularRuta;
  $('vehiculo').onchange = () => { aplicarVehiculo(); guardarVehiculo(); calcularCosto(); };
  $('unidad').onchange = cambiarUnidad;
  ['rendimiento', 'combustible'].forEach(id => $(id).addEventListener('input', () => { guardarVehiculo(); calcularCosto(); }));
  $('pasajeros').addEventListener('input', calcularCosto);
  ['pSuper', 'pRegular', 'pDiesel'].forEach(id => $(id).addEventListener('input', () => {
    guardarLS('rn_precios', leerPrecios()); $('estado').textContent = 'Usando tus propios precios.'; calcularCosto();
  }));
  $('restablecer').onclick = () => { localStorage.removeItem('rn_precios'); if (preciosRef) ponerPrecios(preciosRef); calcularCosto(); };
  $('compartir').onclick = compartir;
  $('borrarHist').onclick = () => { if (confirm('¿Borrar todos los viajes guardados?')) { guardarLS('rn_hist', []); pintarHistorial(); } };
  $('pkCerrar').onclick = () => cerrarMapa();
  $('pkForm').onsubmit = buscarEnMapa;
  $('pkUsar').onclick = usarLugar;
  window.addEventListener('popstate', () => cerrarMapa(true));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMapa(); });
  window.addEventListener('online', estadoRed);
  window.addEventListener('offline', estadoRed);

  let aviso = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); aviso = e; $('instalar').hidden = false; });
  $('instalar').onclick = async () => { if (!aviso) return; aviso.prompt(); await aviso.userChoice; aviso = null; $('instalar').hidden = true; };
  window.addEventListener('appinstalled', () => $('instalar').hidden = true);
}

function estadoRed() { $('sinred').hidden = navigator.onLine; }

/* ---------- Paradas ---------- */
// Cada parada: { texto: "San Pedro del Norte, Chinandega" } o { texto: "Barrio X, Chinandega", coords: "12.6,-87.1" }
const ICONO_MAPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const ICONO_GPS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

function setParadas(lista) {
  const total = lista.length;
  $('paradas').innerHTML = lista.map((p, i) => {
    const nombre = i === 0 ? 'Origen' : i === total - 1 ? 'Destino' : 'Parada ' + i;
    const gps = i === 0 ? `<button class="icono gpsbtn" data-gps aria-label="Usar mi ubicación como origen" title="Mi ubicación">${ICONO_GPS}</button>` : '';
    const mapa = `<button class="icono gpsbtn" data-mapa="${i}" aria-label="Escoger ${nombre} en el mapa" title="Escoger en el mapa">${ICONO_MAPA}</button>`;
    const quitar = (i > 0 && i < total - 1) ? `<button class="icono" data-quitar="${i}" aria-label="Quitar ${nombre}">×</button>` : '';
    const v = esc(p.texto || '');
    return `<div class="parada"><span class="letra" aria-hidden="true">${LETRAS[i]}</span>
      <input list="lugares" value="${v}" ${p.coords ? `data-coords="${p.coords}" class="fijo" readonly title="Tocá para cambiarlo"` : ''}
        placeholder="${nombre}: municipio, barrio o lugar" aria-label="${nombre}">${gps}${mapa}${quitar}</div>`;
  }).join('');

  $('paradas').querySelectorAll('[data-quitar]').forEach(b => b.onclick = () => {
    const p = getParadas(true); p.splice(+b.dataset.quitar, 1); setParadas(p);
  });
  $('paradas').querySelectorAll('[data-mapa]').forEach(b => b.onclick = () => abrirMapa(+b.dataset.mapa));
  $('paradas').querySelectorAll('input.fijo').forEach(inp => inp.onclick = () => {
    inp.removeAttribute('data-coords'); inp.removeAttribute('readonly'); inp.classList.remove('fijo'); inp.value = ''; inp.focus();
  });
  const gpsBtn = $('paradas').querySelector('[data-gps]');
  if (gpsBtn) gpsBtn.onclick = usarUbicacion;
  $('agregar').hidden = total >= MAX;
}

function getParadas(incluirVacias) {
  const lista = [...$('paradas').querySelectorAll('input')].map(i =>
    i.dataset.coords ? { texto: i.value || 'Punto en el mapa', coords: i.dataset.coords } : { texto: i.value.trim() });
  return incluirVacias ? lista : lista.filter(p => p.texto);
}

function usarUbicacion() {
  $('error').textContent = '';
  if (!navigator.geolocation) { $('error').textContent = 'Este teléfono no permite usar la ubicación.'; return; }
  const inp = $('paradas').querySelector('input');
  inp.value = 'Buscando tu ubicación…';
  navigator.geolocation.getCurrentPosition(pos => {
    const c = pos.coords.latitude.toFixed(5) + ',' + pos.coords.longitude.toFixed(5);
    const p = getParadas(true); p[0] = { texto: 'Mi ubicación', coords: c }; setParadas(p);
  }, err => {
    inp.value = '';
    $('error').textContent = err.code === 1
      ? 'Diste "no permitir" a la ubicación. Activala en los permisos de la app o escribí el lugar.'
      : 'No se pudo obtener tu ubicación. Revisá que el GPS esté encendido.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

/* ---------- Mapa para escoger un lugar (Leaflet + OpenStreetMap) ---------- */
const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
const pk = { i: 0, mapa: null, marca: null, sel: null, turno: 0 };

function cargarLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((ok, falla) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LEAFLET + 'leaflet.js';
    js.onload = ok;
    js.onerror = () => falla(new Error('No se pudo cargar el mapa. Revisá tu conexión.'));
    document.head.appendChild(js);
  });
}

async function abrirMapa(i) {
  pk.i = i; pk.sel = null;
  $('pkTitulo').textContent = 'Escogé ' + (i === 0 ? 'el origen' : i === getParadas(true).length - 1 ? 'el destino' : 'la parada ' + i);
  $('pkRes').innerHTML = ''; $('pkQ').value = '';
  $('pkSel').textContent = 'Buscá un lugar o tocá el mapa para marcar el punto.';
  $('pkUsar').disabled = true;
  $('picker').hidden = false;
  document.body.style.overflow = 'hidden';
  history.pushState({ mapa: true }, '');
  try { await cargarLeaflet(); }
  catch (e) { $('pkSel').textContent = e.message; return; }

  if (!pk.mapa) {
    pk.mapa = L.map('pkMapa', { zoomControl: true }).setView([12.9, -85.3], 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(pk.mapa);
    pk.mapa.on('click', e => marcar(e.latlng.lat, e.latlng.lng, null, null));
  }
  if (pk.marca) { pk.marca.remove(); pk.marca = null; }
  setTimeout(() => {
    pk.mapa.invalidateSize();
    const actual = getParadas(true)[i];
    if (actual && actual.coords) {
      const [lat, lng] = actual.coords.split(',').map(Number);
      marcar(lat, lng, actual.texto, null);
      pk.mapa.setView([lat, lng], 16);
    } else {
      // Centrar en otra parada ya escogida, si hay
      const otra = getParadas(true).find(p => p.coords);
      if (otra) pk.mapa.setView(otra.coords.split(',').map(Number), 13);
      if (actual && actual.texto) $('pkQ').value = actual.texto;
    }
  }, 60);
  if (!window.matchMedia('(pointer: coarse)').matches) $('pkQ').focus();
}

function cerrarMapa(desdeHistorial) {
  if ($('picker').hidden) return;
  $('picker').hidden = true;
  document.body.style.overflow = '';
  if (!desdeHistorial && history.state && history.state.mapa) history.back();
}

function marcar(lat, lng, nombre, direccion) {
  const turno = ++pk.turno;
  const icono = L.divIcon({ className: '', html: `<div class="pin-letra"><span>${LETRAS[pk.i]}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 34] });
  if (pk.marca) pk.marca.setLatLng([lat, lng]).setIcon(icono);
  else pk.marca = L.marker([lat, lng], { icon: icono }).addTo(pk.mapa);
  pk.sel = { lat, lng, nombre: nombre || 'Punto en el mapa' };
  $('pkUsar').disabled = false;
  if (nombre) { mostrarSel(nombre, direccion); return; }
  mostrarSel('Buscando el nombre del lugar…', '');
  api('direccion', { lat: lat.toFixed(6), lng: lng.toFixed(6) })
    .then(d => { if (turno !== pk.turno) return; pk.sel.nombre = d.nombre; mostrarSel(d.nombre, d.direccion); })
    .catch(() => { if (turno !== pk.turno) return; mostrarSel('Punto en el mapa', lat.toFixed(5) + ', ' + lng.toFixed(5)); });
}

function mostrarSel(nombre, direccion) {
  $('pkSel').innerHTML = esc(nombre) + (direccion ? `<small>${esc(direccion)}</small>` : '');
}

async function buscarEnMapa(e) {
  e.preventDefault();
  const q = $('pkQ').value.trim();
  if (q.length < 3) { $('pkRes').innerHTML = '<li class="vacio">Escribí al menos 3 letras.</li>'; return; }
  $('pkRes').innerHTML = '<li class="vacio">Buscando…</li>';
  try {
    const lista = await api('buscar', { q });
    if (!lista.length) { $('pkRes').innerHTML = '<li class="vacio">No encontré ese lugar. Probá agregando el municipio, o tocá el mapa.</li>'; return; }
    $('pkRes').innerHTML = lista.map((r, k) => `<li><button data-r="${k}"><b>${esc(r.nombre)}</b><small>${esc(r.direccion)}</small></button></li>`).join('');
    $('pkRes').querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
      const r = lista[+b.dataset.r];
      $('pkRes').innerHTML = '';
      if (pk.mapa) { marcar(r.lat, r.lng, r.nombre, r.direccion); pk.mapa.setView([r.lat, r.lng], 16); }
      $('pkQ').blur();
    });
    if (lista.length === 1) $('pkRes').querySelector('button').click();
  } catch (err) {
    $('pkRes').innerHTML = `<li class="vacio">${esc(err.message)}</li>`;
  }
}

function usarLugar() {
  if (!pk.sel) return;
  const p = getParadas(true);
  p[pk.i] = { texto: pk.sel.nombre, coords: pk.sel.lat.toFixed(6) + ',' + pk.sel.lng.toFixed(6) };
  setParadas(p);
  cerrarMapa();
}

/* ---------- Ruta ---------- */
async function calcularRuta() {
  $('error').textContent = '';
  let paradas = getParadas(false);
  if (paradas.length < 2) { $('error').textContent = 'Escribí al menos el origen y el destino.'; return; }

  const tramosIda = paradas.length - 1, tipo = $('tipoViaje').value;
  if (tipo === 'directo') paradas = paradas.concat(paradas[0]);
  if (tipo === 'mismas') paradas = paradas.concat(paradas.slice(0, -1).reverse());
  if (paradas.length > MAX) {
    $('error').textContent = tipo === 'mismas'
      ? 'Con regreso por las mismas paradas caben hasta 5 lugares. Quitá alguno o escogé regreso directo.'
      : 'Son demasiados lugares; el máximo es ' + MAX + '.';
    return;
  }

  $('calcular').disabled = true; $('calcular').textContent = 'Calculando ruta…';
  try {
    const r = await api('ruta', { paradas: JSON.stringify(paradas.map(p => p.coords || p.texto)) });
    const viaje = { fecha: Date.now(), paradas, tipo, tramosIda: tipo === 'ida' ? 0 : tramosIda, r };
    mostrarViaje(viaje);
    guardarEnHistorial(viaje);
  } catch (e) {
    $('error').textContent = e.message;
  } finally {
    $('calcular').disabled = false; $('calcular').textContent = 'Calcular ruta';
  }
}

function mostrarViaje(v) {
  ultimo = v;
  const r = v.r;
  $('km').textContent = Math.round(r.kmTotal) + ' km';
  $('tiempo').textContent = fmtTiempo(r.minTotal);

  let via = r.resumen ? 'Vía ' + r.resumen + '. ' : '';
  if (v.tramosIda) {
    const ida = r.tramos.slice(0, v.tramosIda), vuelta = r.tramos.slice(v.tramosIda);
    via += `Ida: ${Math.round(suma(ida, 'km'))} km, ${fmtTiempo(suma(ida, 'min'))}. Vuelta: ${Math.round(suma(vuelta, 'km'))} km, ${fmtTiempo(suma(vuelta, 'min'))}.`;
  }
  $('via').textContent = via;

  $('tramos').innerHTML = r.tramos.map((t, i) => `<li>
    <span>${LETRAS[i]} → ${LETRAS[i + 1]}: ${esc(corto(v.paradas[i].texto))} a ${esc(corto(v.paradas[i + 1].texto))}</span>
    <span class="t-km">${t.km.toFixed(1)} km</span><span class="t-min">${fmtTiempo(t.min)}</span></li>`).join('');

  $('aviso').hidden = !r.advertencia; $('aviso').textContent = r.advertencia || '';
  if (r.mapa) { $('mapa').src = r.mapa; $('mapa').hidden = false; } else $('mapa').hidden = true;

  enlacesNavegar(v.paradas);
  $('resultado').hidden = false;
  calcularCosto();
}

/* ---------- Iniciar el viaje en Google Maps o Waze ---------- */
const lugarURL = p => p.coords || (/nicaragua/i.test(p.texto) ? p.texto : p.texto + ', Nicaragua');

function enlacesNavegar(paradas) {
  // Google Maps: sale desde donde está el teléfono y pasa por todas las paradas en orden
  const g = new URL('https://www.google.com/maps/dir/');
  g.searchParams.set('api', '1');
  g.searchParams.set('destination', lugarURL(paradas[paradas.length - 1]));
  const intermedias = paradas.slice(1, -1).map(lugarURL);
  if (intermedias.length) g.searchParams.set('waypoints', intermedias.join('|'));
  g.searchParams.set('travelmode', 'driving');
  g.searchParams.set('dir_action', 'navigate');
  $('abrirMaps').href = g.toString();

  // Waze solo acepta un destino: lleva a la siguiente parada
  const sig = paradas[1];
  const w = new URL('https://waze.com/ul');
  if (sig.coords) w.searchParams.set('ll', sig.coords); else w.searchParams.set('q', lugarURL(sig));
  w.searchParams.set('navigate', 'yes');
  $('abrirWaze').href = w.toString();
  const varias = paradas.length > 2;
  $('notaWaze').hidden = !varias;
  if (varias) $('notaWaze').textContent = 'Waze no acepta varias paradas: te lleva primero a ' + corto(sig.texto) + '. Google Maps lleva el recorrido completo.';
}

/* ---------- Combustible ---------- */
function aplicarVehiculo() {
  const v = vehiculos.find(x => x.id === $('vehiculo').value);
  if (!v) return;
  $('rendimiento').value = $('unidad').value === 'kmG' ? +(v.kmL * LITROS_POR_GALON).toFixed(1) : v.kmL;
  $('combustible').value = v.combustible;
}
let unidadAnterior = 'kmL';
function cambiarUnidad() {
  const r = parseFloat($('rendimiento').value) || 0, u = $('unidad').value;
  if (u !== unidadAnterior) $('rendimiento').value = u === 'kmG' ? +(r * LITROS_POR_GALON).toFixed(1) : +(r / LITROS_POR_GALON).toFixed(1);
  unidadAnterior = u; guardarVehiculo(); calcularCosto();
}
function guardarVehiculo() {
  guardarLS('rn_vehiculo', { id: $('vehiculo').value, unidad: $('unidad').value, rendimiento: $('rendimiento').value, combustible: $('combustible').value });
}
function ponerPrecios(p) {
  $('pSuper').value = p.super; $('pRegular').value = p.regular; $('pDiesel').value = p.diesel;
  const propios = leerLS('rn_precios', null);
  $('estado').textContent = propios ? 'Usando tus propios precios.'
    : p.actualizado ? 'Precios de referencia del ' + new Date(p.actualizado).toLocaleDateString('es-NI') + '.'
    : 'Precios de referencia. Cambialos por los de tu gasolinera.';
}
function leerPrecios() { return { super: +$('pSuper').value || 0, regular: +$('pRegular').value || 0, diesel: +$('pDiesel').value || 0 }; }

function costoActual() {
  if (!ultimo) return null;
  const km = ultimo.r.kmTotal;
  const rend = parseFloat($('rendimiento').value) || 0;
  const kmPorLitro = $('unidad').value === 'kmG' ? rend / LITROS_POR_GALON : rend;
  const precio = leerPrecios()[$('combustible').value] || 0;
  const litros = kmPorLitro > 0 ? km / kmPorLitro : 0;
  const personas = Math.max(1, parseInt($('pasajeros').value) || 1);
  return { km, litros, precio, costo: litros * precio, personas, porPersona: litros * precio / personas };
}
function calcularCosto() {
  const c = costoActual();
  if (!c) return;
  $('costo').textContent = cs(c.costo);
  $('rKm').textContent = c.km.toFixed(1) + ' km';
  $('rLitros').textContent = `${c.litros.toFixed(1)} L (${(c.litros / LITROS_POR_GALON).toFixed(2)} gal)`;
  $('rPrecio').textContent = cs(c.precio) + ' por litro';
  $('rPersona').textContent = cs(c.porPersona);
}

/* ---------- Compartir ---------- */
function textoViaje() {
  const c = costoActual();
  const ruta = ultimo.paradas.map(p => corto(p.texto)).join(' → ');
  let t = `Viaje: ${ruta}\nDistancia: ${Math.round(c.km)} km, ${fmtTiempo(ultimo.r.minTotal)}\nCombustible: ${c.litros.toFixed(1)} L, ${cs(c.costo)}`;
  if (c.personas > 1) t += `\nPor persona (${c.personas}): ${cs(c.porPersona)}`;
  return t + '\n(Calculado con Rutas Nicaragua)';
}
async function compartir() {
  if (!ultimo) return;
  const texto = textoViaje();
  if (navigator.share) { try { await navigator.share({ text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
}

/* ---------- Historial (se guarda en el teléfono) ---------- */
function guardarEnHistorial(v) {
  const sinMapa = { ...v, r: { ...v.r, mapa: null } }; // el mapa no se guarda para ahorrar espacio
  const clave = JSON.stringify([v.paradas, v.tipo]);
  const hist = leerLS('rn_hist', []).filter(h => JSON.stringify([h.paradas, h.tipo]) !== clave);
  hist.unshift(sinMapa);
  guardarLS('rn_hist', hist.slice(0, MAX_HIST));
  pintarHistorial();
}
function pintarHistorial() {
  const hist = leerLS('rn_hist', []);
  $('borrarHist').hidden = !hist.length;
  if (!hist.length) { $('historial').innerHTML = '<li class="vacio">Aquí aparecen las rutas que calculés, también sin internet.</li>'; return; }
  $('historial').innerHTML = hist.map((h, i) => `<li><button data-h="${i}">
      <span class="h-ruta">${esc(h.paradas.map(p => corto(p.texto)).join(' → '))}</span>
      <span class="h-det">${fmtTiempo(h.r.minTotal)}, ${h.tipo === 'ida' ? 'solo ida' : 'ida y vuelta'}. ${new Date(h.fecha).toLocaleDateString('es-NI')}</span>
      <span class="h-cs">${Math.round(h.r.kmTotal)} km</span></button></li>`).join('');
  $('historial').querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
    const h = leerLS('rn_hist', [])[+b.dataset.h];
    const ida = h.tramosIda ? h.paradas.slice(0, h.tramosIda + 1) : h.paradas;
    setParadas(ida); $('tipoViaje').value = h.tipo;
    mostrarViaje(h);
    window.scrollTo({ top: $('resultado').offsetTop - 70, behavior: 'smooth' });
  });
}

/* ---------- Utilidades ---------- */
const suma = (l, c) => l.reduce((s, t) => s + t[c], 0);
const corto = s => String(s).split(',')[0];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtTiempo(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; }
const cs = n => 'C$ ' + n.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
