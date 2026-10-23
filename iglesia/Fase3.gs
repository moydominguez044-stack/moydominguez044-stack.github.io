/**
 * Fase 3 — Chat (Firebase Realtime Database), personas en línea y listas de alabanzas (YouTube).
 * Debe ir después de Código.gs, Fase2.gs e Integraciones.gs en el proyecto.
 */

ESQUEMA.Permisos = ['userId', 'permiso', 'fecha'];
ESQUEMA.Listas = ['id', 'titulo', 'descripcion', 'creadoPor', 'fecha', 'activo'];
ESQUEMA.Canciones = ['id', 'listaId', 'orden', 'videoId', 'titulo', 'autor', 'agregadoPor', 'fecha'];

// ───────────────────────── Permiso "Encargado de alabanzas" ─────────────────────────

function tienePermiso_(userId, permiso) {
  return !!tabla_('Permisos').uno(function (p) { return p.userId === userId && p.permiso === permiso; });
}

function puedeAlabanzas_(yo) {
  return yo.rol === 'admin' || yo.rol === 'lider' || tienePermiso_(yo.id, 'alabanza');
}

var _publicoFase1 = publico_;
publico_ = function (u) {
  var r = _publicoFase1(u);
  if (r) { r.alabanza = tienePermiso_(u.id, 'alabanza'); r.gestionaAlabanzas = u.rol === 'admin' || u.rol === 'lider' || r.alabanza; }
  return r;
};

var _usuariosFase1 = accUsuarios_;
ACCIONES.usuarios = function (yo, d) {
  var lista = _usuariosFase1(yo, d);
  var conPermiso = {};
  tabla_('Permisos').donde(function (p) { return p.permiso === 'alabanza'; }).forEach(function (p) { conPermiso[p.userId] = true; });
  lista.forEach(function (u) { u.alabanza = !!conPermiso[u.id]; });
  return lista;
};

ACCIONES.permisoAlabanza = function (yo, d) {
  exigirRol_(yo, ['admin']);
  return conBloqueo_(function () {
    var u = tabla_('Usuarios').uno(function (r) { return r.id === d.id; });
    if (!u) throw new Error('Usuario no encontrado.');
    var t = tabla_('Permisos');
    t.borrarDonde(function (p) { return p.userId === u.id && p.permiso === 'alabanza'; });
    if (d.valor) t.agregar({ userId: u.id, permiso: 'alabanza', fecha: hoy_() });
    return true;
  });
};

// ───────────────────────── Listas de alabanzas (YouTube) ─────────────────────────

/** Extrae el ID de 11 caracteres de un enlace de YouTube (normal, corto, Shorts, Music o embed). */
function idDeYouTube_(texto) {
  var s = String(texto || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  var m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

function datosDeVideo_(videoId) {
  var r = UrlFetchApp.fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  var j = JSON.parse(r.getContentText());
  return { titulo: String(j.title || '').slice(0, 200), autor: String(j.author_name || '').slice(0, 120) };
}

ACCIONES.listasAlabanza = function (yo) {
  var listas = tabla_('Listas').donde(function (l) { return l.activo === 'si'; });
  var canciones = tabla_('Canciones').filas();
  var nombres = {}; tabla_('Usuarios').filas().forEach(function (u) { nombres[u.id] = u.nombre; });
  return {
    puedeEditar: puedeAlabanzas_(yo),
    listas: listas.map(function (l) {
      return {
        id: l.id, titulo: l.titulo, descripcion: l.descripcion, autor: nombres[l.creadoPor] || '', fecha: l.fecha,
        canciones: canciones.filter(function (c) { return c.listaId === l.id; })
          .sort(function (a, b) { return Number(a.orden) - Number(b.orden); })
          .map(function (c) { return { id: c.id, videoId: c.videoId, titulo: c.titulo, autor: c.autor }; })
      };
    }).sort(function (a, b) { return a.titulo.localeCompare(b.titulo); })
  };
};

ACCIONES.guardarListaAlabanza = function (yo, d) {
  if (!puedeAlabanzas_(yo)) throw new Error('No tiene permiso para editar las listas de alabanzas.');
  return conBloqueo_(function () {
    var t = tabla_('Listas');
    if (d.id) {
      var l = t.uno(function (r) { return r.id === d.id; });
      if (!l) throw new Error('Lista no encontrada.');
      if (d.eliminar) { l.activo = 'no'; t.guardar(l); return true; }
      l.titulo = limpiarTexto_(d.titulo, 100, 'Escriba el nombre de la lista.');
      l.descripcion = String(d.descripcion || '').slice(0, 500);
      t.guardar(l);
      return l.id;
    }
    return t.agregar({ id: siguienteId_('LA', 3), titulo: limpiarTexto_(d.titulo, 100, 'Escriba el nombre de la lista.'), descripcion: String(d.descripcion || '').slice(0, 500), creadoPor: yo.id, fecha: hoy_(), activo: 'si' }).id;
  });
};

/** Agrega canciones a una lista a partir de enlaces de YouTube (uno por línea). */
ACCIONES.agregarCanciones = function (yo, d) {
  if (!puedeAlabanzas_(yo)) throw new Error('No tiene permiso para editar las listas de alabanzas.');
  var lista = tabla_('Listas').uno(function (r) { return r.id === d.listaId && r.activo === 'si'; });
  if (!lista) throw new Error('Lista no encontrada.');
  var lineas = String(d.enlaces || '').split(/[\s,]+/).filter(String).slice(0, 50);
  if (!lineas.length) throw new Error('Pegue al menos un enlace de YouTube.');
  var nuevas = [], fallidas = [];
  lineas.forEach(function (linea) {
    var id = idDeYouTube_(linea);
    if (!id) { fallidas.push({ enlace: linea, motivo: 'No es un enlace de YouTube' }); return; }
    var info = datosDeVideo_(id);
    if (!info) { fallidas.push({ enlace: linea, motivo: 'El video no existe o no permite reproducirse fuera de YouTube' }); return; }
    nuevas.push({ videoId: id, titulo: info.titulo, autor: info.autor });
  });
  conBloqueo_(function () {
    var t = tabla_('Canciones');
    var orden = t.donde(function (c) { return c.listaId === lista.id; }).reduce(function (m, c) { return Math.max(m, Number(c.orden) || 0); }, 0);
    nuevas.forEach(function (c) {
      orden++;
      t.agregar({ id: siguienteId_('CA', 4), listaId: lista.id, orden: orden, videoId: c.videoId, titulo: c.titulo, autor: c.autor, agregadoPor: yo.id, fecha: hoy_() });
    });
  });
  return { agregadas: nuevas.length, fallidas: fallidas };
};

ACCIONES.editarCancion = function (yo, d) {
  if (!puedeAlabanzas_(yo)) throw new Error('No tiene permiso para editar las listas de alabanzas.');
  return conBloqueo_(function () {
    var t = tabla_('Canciones');
    var c = t.uno(function (r) { return r.id === d.id; });
    if (!c) throw new Error('Canción no encontrada.');
    if (d.quitar) { t.borrarDonde(function (r) { return r.id === c.id; }); return true; }
    if (d.mover) {
      var hermanas = t.donde(function (r) { return r.listaId === c.listaId; }).sort(function (a, b) { return Number(a.orden) - Number(b.orden); });
      var i = hermanas.map(function (r) { return r.id; }).indexOf(c.id);
      var j = i + (d.mover < 0 ? -1 : 1);
      if (j < 0 || j >= hermanas.length) return true;
      var otra = hermanas[j], tmp = c.orden;
      c.orden = otra.orden; otra.orden = tmp;
      if (c.orden === otra.orden) { c.orden = j + 1; otra.orden = i + 1; }
      t.guardar(c); t.guardar(otra);
    }
    return true;
  });
};

// ───────────────────────── Firebase: configuración y credenciales ─────────────────────────

function fbConfig_() {
  var s = PropertiesService.getScriptProperties().getProperty('FB_CONFIG');
  return s ? JSON.parse(s) : null;
}

function fbCuenta_() {
  var s = PropertiesService.getScriptProperties().getProperty('FB_SA');
  return s ? JSON.parse(s) : null;
}

function b64url_(bytesOTexto) {
  var bytes = typeof bytesOTexto === 'string' ? Utilities.newBlob(bytesOTexto).getBytes() : bytesOTexto;
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function jwt_(payload, clavePrivada) {
  var entrada = b64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url_(JSON.stringify(payload));
  return entrada + '.' + b64url_(Utilities.computeRsaSha256Signature(entrada, clavePrivada));
}

/** Pase de Firebase para un usuario de la app (válido 1 hora). */
function tokenFirebase_(cuenta, uid, claims) {
  var ahora = Math.floor(Date.now() / 1000);
  return jwt_({
    iss: cuenta.client_email, sub: cuenta.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: ahora, exp: ahora + 3600, uid: uid, claims: claims
  }, cuenta.private_key);
}

/** Token de administrador de la base de datos (para instalar reglas y limpiar pruebas). */
function tokenAdminFirebase_(cuenta) {
  var cache = CacheService.getScriptCache();
  var guardado = cache.get('FB_ADMIN');
  if (guardado) return guardado;
  var ahora = Math.floor(Date.now() / 1000);
  var asercion = jwt_({
    iss: cuenta.client_email, aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  }, cuenta.private_key);
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: asercion }
  });
  if (r.getResponseCode() !== 200) throw new Error('Google rechazó la cuenta de servicio de Firebase. Genere una clave nueva y péguela otra vez.');
  var token = JSON.parse(r.getContentText()).access_token;
  cache.put('FB_ADMIN', token, 3000);
  return token;
}

function reglasFirebase_() {
  var participante = "($cid.beginsWith(auth.uid + '__') || $cid.endsWith('__' + auth.uid))";
  return {
    rules: {
      '.read': false, '.write': false,
      presencia: {
        '.read': 'auth != null',
        '$uid': {
          '.write': 'auth != null && auth.uid === $uid',
          '.validate': "newData.hasChildren(['nombre', 'online', 't']) && newData.child('nombre').isString() && newData.child('nombre').val().length <= 80 && newData.child('online').isBoolean() && newData.child('t').isNumber()"
        }
      },
      silenciados: {
        '.read': 'auth != null',
        '$uid': { '.write': 'auth != null && auth.token.mod === true', '.validate': 'newData.isBoolean()' }
      },
      general: {
        '.read': 'auth != null',
        '.indexOn': ['t'],
        '$msg': {
          '.write': "auth != null && ((!data.exists() && newData.child('uid').val() === auth.uid && root.child('silenciados').child(auth.uid).val() !== true) || (data.exists() && !newData.exists() && (auth.token.mod === true || data.child('uid').val() === auth.uid)))",
          '.validate': "newData.hasChildren(['uid', 'nombre', 'texto', 't']) && newData.child('nombre').val() === auth.token.nombre && newData.child('texto').isString() && newData.child('texto').val().length > 0 && newData.child('texto').val().length <= 1000 && newData.child('t').val() === now"
        }
      },
      privados: {
        '$cid': {
          '.read': 'auth != null && ' + participante,
          meta: {
            '.write': 'auth != null && !data.exists() && auth.token.mod === true && ' + participante,
            '.validate': "newData.hasChildren(['creador', 't']) && newData.child('creador').val() === auth.uid"
          },
          msgs: {
            '.indexOn': ['t'],
            '$msg': {
              '.write': "auth != null && !data.exists() && " + participante + " && root.child('privados').child($cid).child('meta').exists()",
              '.validate': "newData.hasChildren(['uid', 'nombre', 'texto', 't']) && newData.child('uid').val() === auth.uid && newData.child('nombre').val() === auth.token.nombre && newData.child('texto').isString() && newData.child('texto').val().length > 0 && newData.child('texto').val().length <= 1000 && newData.child('t').val() === now"
            }
          }
        }
      },
      bandeja: {
        '$uid': {
          '.read': 'auth != null && auth.uid === $uid',
          '$cid': {
            '.write': "auth != null && " + participante + " && ($cid.beginsWith($uid + '__') || $cid.endsWith('__' + $uid)) && root.child('privados').child($cid).child('meta').exists()",
            '.validate': "newData.hasChildren(['con', 'nombre', 't'])"
          }
        }
      }
    }
  };
}

function instalarReglas_(config, cuenta) {
  var r = UrlFetchApp.fetch(config.databaseURL + '/.settings/rules.json', {
    method: 'put', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + tokenAdminFirebase_(cuenta) },
    payload: JSON.stringify(reglasFirebase_())
  });
  if (r.getResponseCode() !== 200) throw new Error('No se pudieron instalar las reglas de seguridad (' + r.getResponseCode() + '). Revise que la Realtime Database esté creada.');
}

/** Lee el bloque "firebaseConfig" que muestra la consola de Firebase, en formato JS o JSON. */
function leerConfigFirebase_(texto) {
  var c = {};
  ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'].forEach(function (k) {
    var m = String(texto || '').match(new RegExp('["\']?' + k + '["\']?\\s*:\\s*["\']([^"\']+)["\']'));
    if (m) c[k] = m[1].trim();
  });
  return c;
}

ACCIONES.guardarFirebase = function (yo, d) {
  exigirRol_(yo, ['admin']);
  var props = PropertiesService.getScriptProperties();
  if (d.quitar) { props.deleteProperty('FB_CONFIG'); props.deleteProperty('FB_SA'); CacheService.getScriptCache().remove('FB_ADMIN'); return { ok: true }; }
  var config = leerConfigFirebase_(d.config);
  if (d.databaseURL) config.databaseURL = String(d.databaseURL).trim();
  if (!config.apiKey || !config.projectId) throw new Error('No encontré apiKey y projectId en la configuración. Copie el bloque firebaseConfig completo.');
  if (!config.databaseURL) throw new Error('Falta la dirección de la Realtime Database (termina en firebaseio.com o firebasedatabase.app).');
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(config.databaseURL)) throw new Error('La dirección de la base de datos no parece válida.');
  config.databaseURL = config.databaseURL.replace(/\/$/, '');
  var cuenta;
  try { cuenta = JSON.parse(String(d.cuenta || '')); } catch (e) { throw new Error('La clave de la cuenta de servicio debe ser el archivo JSON completo que descargó de Firebase.'); }
  if (!cuenta.client_email || !cuenta.private_key) throw new Error('El JSON no tiene client_email y private_key. Descargue la clave desde Configuración del proyecto → Cuentas de servicio.');
  CacheService.getScriptCache().remove('FB_ADMIN');
  instalarReglas_(config, cuenta);
  props.setProperty('FB_CONFIG', JSON.stringify(config));
  props.setProperty('FB_SA', JSON.stringify({ client_email: cuenta.client_email, private_key: cuenta.private_key }));
  return { ok: true, proyecto: config.projectId };
};

ACCIONES.chatToken = function (yo) {
  var config = fbConfig_(), cuenta = fbCuenta_();
  if (!config || !cuenta) return { configurado: false };
  var mod = yo.rol === 'admin' || yo.rol === 'lider';
  return {
    configurado: true, config: config, uid: yo.id, nombre: yo.nombre, mod: mod,
    token: tokenFirebase_(cuenta, yo.id, { nombre: yo.nombre, rol: yo.rol, mod: mod })
  };
};

/** Lista de personas para iniciar un mensaje privado (solo administradores y líderes). */
ACCIONES.directorio = function (yo) {
  exigirRol_(yo, ['admin', 'lider']);
  var grupos = {}; tabla_('Grupos').filas().forEach(function (g) { grupos[g.id] = g.nombre; });
  return tabla_('Usuarios').donde(function (u) { return u.activo === 'si' && u.id !== yo.id; })
    .map(function (u) { return { id: u.id, nombre: u.nombre, rol: u.rol, grupo: grupos[u.grupoId] || '' }; })
    .sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
};

// ───────────────────────── Prueba de las reglas de seguridad ─────────────────────────

/** Prueba con usuarios ficticios que las reglas permiten lo correcto y bloquean lo indebido. */
ACCIONES.probarChat = function (yo) {
  exigirRol_(yo, ['admin']);
  var config = fbConfig_(), cuenta = fbCuenta_();
  if (!config || !cuenta) throw new Error('Primero guarde la configuración de Firebase.');
  var sufijo = String(Date.now()).slice(-6);
  var M = 'PRUEBA-M' + sufijo, L = 'PRUEBA-L' + sufijo, O = 'PRUEBA-O' + sufijo;
  function idToken(uid, mod) {
    var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + encodeURIComponent(config.apiKey), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ token: tokenFirebase_(cuenta, uid, { nombre: 'Prueba ' + uid, rol: mod ? 'lider' : 'miembro', mod: mod }), returnSecureToken: true })
    });
    if (r.getResponseCode() !== 200) throw new Error('Firebase no aceptó el pase de prueba: revise que el inicio de sesión esté habilitado en Authentication y que la configuración sea del mismo proyecto.');
    return JSON.parse(r.getContentText()).idToken;
  }
  var tm = idToken(M, false), tl = idToken(L, true), to = idToken(O, false);
  function op(metodo, ruta, token, cuerpo) {
    var r = UrlFetchApp.fetch(config.databaseURL + '/' + ruta + '.json?auth=' + token, {
      method: metodo, contentType: 'application/json', muteHttpExceptions: true,
      payload: cuerpo === undefined ? null : JSON.stringify(cuerpo)
    });
    return r.getResponseCode() === 200;
  }
  function msg(uid, texto) { return { uid: uid, nombre: 'Prueba ' + uid, texto: texto, t: { '.sv': 'timestamp' } }; }
  var cid = [L, M].sort().join('__');
  var casos = [];
  function caso(desc, esperado, real) { casos.push({ prueba: desc, esperado: esperado, obtenido: real, ok: esperado === real }); }
  caso('Un miembro escribe en la sala general', true, op('put', 'general/' + M + 'a', tm, msg(M, 'Hola')));
  caso('Un miembro escribe haciéndose pasar por otro', false, op('put', 'general/' + M + 'b', tm, msg(O, 'Suplantación')));
  caso('Un miembro intenta abrir un mensaje privado', false, op('put', 'privados/' + [M, O].sort().join('__') + '/meta', tm, { creador: M, t: 1 }));
  caso('Un líder abre un mensaje privado con un miembro', true, op('put', 'privados/' + cid + '/meta', tl, { creador: L, t: 1 }));
  caso('El miembro responde el mensaje privado', true, op('put', 'privados/' + cid + '/msgs/r1', tm, msg(M, 'Gracias')));
  caso('Otra persona intenta leer ese privado', false, op('get', 'privados/' + cid, to));
  caso('Un miembro intenta silenciar a alguien', false, op('put', 'silenciados/' + O, tm, true));
  caso('Un miembro borra el mensaje de otro', false, op('delete', 'general/' + M + 'a', to));
  caso('Un líder silencia a un miembro', true, op('put', 'silenciados/' + M, tl, true));
  caso('El miembro silenciado escribe en la sala general', false, op('put', 'general/' + M + 'c', tm, msg(M, 'Silenciado')));
  caso('Un líder borra un mensaje de la sala general', true, op('delete', 'general/' + M + 'a', tl));
  caso('Alguien sin sesión lee la sala general', false, op('get', 'general', 'x'));
  // Limpieza con permisos de administrador
  var admin = tokenAdminFirebase_(cuenta);
  ['general/' + M + 'a', 'general/' + M + 'b', 'general/' + M + 'c', 'privados/' + cid, 'silenciados/' + M, 'silenciados/' + O, 'presencia/' + M].forEach(function (ruta) {
    UrlFetchApp.fetch(config.databaseURL + '/' + ruta + '.json', { method: 'delete', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + admin } });
  });
  return { casos: casos, aprobadas: casos.filter(function (c) { return c.ok; }).length, total: casos.length };
};

var _ajustesV3 = ACCIONES.ajustes;
ACCIONES.ajustes = function (yo, d) {
  var r = _ajustesV3(yo, d);
  var config = fbConfig_();
  r.firebase = config ? config.projectId : '';
  return r;
};
