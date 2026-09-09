// ============================================
// UTILIDADES COMPARTIDAS
// Se carga ANTES que auth.js, recepcion.js y admin.js
// ============================================

// --------------------------------------------
// FECHAS EN HORA LOCAL (no UTC)
// --------------------------------------------
// OJO: new Date().toISOString() devuelve la fecha en UTC.
// En Colombia (UTC-5) eso significa que todo lo registrado
// después de las 7:00 p.m. quedaba guardado con la fecha del
// día siguiente. Estas funciones usan siempre la hora local.

function fechaLocalStr(fecha = new Date()) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getHoyStr() {
    return fechaLocalStr();
}

// Fecha local desplazada N días (negativo = hacia atrás)
function fechaLocalDesplazada(dias) {
    const f = new Date();
    f.setDate(f.getDate() + dias);
    return f;
}


// --------------------------------------------
// ESCAPADO DE HTML (previene XSS)
// --------------------------------------------
// Los nombres, motivos y cédulas los escribe una persona.
// Si se insertan crudos con innerHTML, un nombre como
// <img src=x onerror="..."> ejecuta código en la sesión del
// administrador. Todo dato de la base pasa por esc().

function esc(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


// --------------------------------------------
// HORA DEL SERVIDOR
// --------------------------------------------
// Nunca se usa el reloj del computador: un equipo de portería con
// la hora mal configurada guardaría entradas y salidas erróneas.
// serverTimestamp() hace que la hora la ponga Firebase.

function ahoraServidor() {
    return firebase.firestore.FieldValue.serverTimestamp();
}

// Mientras el servidor confirma la escritura (o si se registró sin
// internet), el campo llega vacío. 'estimate' devuelve la hora
// aproximada en vez de null, para que la tabla no muestre un guión.
function datosDoc(doc) {
    return doc.data({ serverTimestamps: 'estimate' });
}


// --------------------------------------------
// TIMESTAMPS SEGUROS
// --------------------------------------------
// Un documento sin 'entrada' (escritura parcial, dato metido a
// mano en la consola, escritura offline pendiente) hacía que
// .toDate() lanzara excepción y dejara la tabla entera vacía.

function aFecha(timestamp) {
    if (!timestamp) return null;
    if (typeof timestamp.toDate === 'function') {
        try { return timestamp.toDate(); } catch (e) { return null; }
    }
    if (timestamp instanceof Date) return timestamp;
    return null;
}

function horaStr(timestamp, sinDato = '-') {
    const f = aFecha(timestamp);
    if (!f) return sinDato;
    return f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fechaStr(timestamp, sinDato = '-') {
    const f = aFecha(timestamp);
    if (!f) return sinDato;
    return f.toLocaleDateString('es-CO');
}

// Tiempo transcurrido legible: "2h 15m"
function tiempoTranscurrido(timestamp) {
    const f = aFecha(timestamp);
    if (!f) return '-';
    const minutos = Math.max(0, Math.floor((Date.now() - f.getTime()) / 60000));
    const horas = Math.floor(minutos / 60);
    return horas > 0 ? `${horas}h ${minutos % 60}m` : `${minutos}m`;
}


// --------------------------------------------
// NORMALIZACIÓN DE DATOS
// --------------------------------------------

function normalizarCedula(valor) {
    return String(valor ?? '').replace(/[^0-9]/g, '').trim();
}

function normalizarNombre(valor) {
    return String(valor ?? '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 120);
}

function cedulaValida(cedula) {
    return /^[0-9]{6,15}$/.test(cedula);
}

const TIPOS_VALIDOS = ['empleado', 'estudiante', 'visitante'];

function tipoValido(tipo) {
    return TIPOS_VALIDOS.includes(String(tipo ?? '').trim().toLowerCase());
}


// --------------------------------------------
// MENSAJES
// --------------------------------------------

function aviso(titulo, texto, icono = 'warning') {
    return Swal.fire({
        icon: icono, title: titulo, text: texto,
        timer: 2200, showConfirmButton: false
    });
}

function errorFirestore(error, contextoLegible) {
    console.error(contextoLegible, error);
    let texto = error && error.message ? error.message : 'Error desconocido';
    if (error && error.code === 'permission-denied') {
        texto = 'No tiene permisos para esta acción. Verifique su rol o las reglas de Firestore.';
    } else if (error && error.code === 'failed-precondition') {
        texto = 'Falta un índice en Firestore. Revise la consola del navegador: Firebase incluye un enlace para crearlo.';
    } else if (error && error.code === 'unavailable') {
        texto = 'Sin conexión con Firestore. Revise el internet.';
    }
    Swal.fire({ icon: 'error', title: contextoLegible, text: texto });
}
