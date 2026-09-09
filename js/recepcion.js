// ============================================
// RECEPCIÓN - LÓGICA DE ENTRADA / SALIDA
// ============================================

let currentUser = null;
let procesando = false;
let unsubEnSitio = null;
let fechaSuscrita = null;

// ============================================
// PROTECCIÓN DE RUTA
// ============================================
auth.onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }

    try {
        const doc = await db.collection('users').doc(user.uid).get();
        const rol = doc.exists ? doc.data().role : null;
        if (rol !== 'recepcionista' && rol !== 'admin') {
            await auth.signOut();
            window.location.href = 'index.html';
            return;
        }
    } catch (e) {
        console.error('No se pudo verificar el rol:', e);
        await auth.signOut();
        window.location.href = 'index.html';
        return;
    }

    currentUser = user;
    document.getElementById('userEmail').textContent = user.email;
    cargarRegistrosHoy();
    suscribirEnSitio();
});

// ============================================
// RELOJ (y cambio de día en kioscos que quedan encendidos)
// ============================================
function actualizarReloj() {
    const el = document.getElementById('currentTime');
    if (el) el.textContent = new Date().toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });

    // Si el equipo quedó abierto y pasó la medianoche, hay que
    // volver a suscribirse con la nueva fecha o los contadores
    // se quedan mostrando los de ayer.
    if (currentUser && fechaSuscrita && fechaSuscrita !== getHoyStr()) {
        suscribirEnSitio();
        cargarRegistrosHoy();
    }
}
setInterval(actualizarReloj, 1000);
actualizarReloj();

// ============================================
// SONIDOS
// ============================================
function playSound(tipo) {
    try {
        const audio = document.getElementById(`sound${tipo}`);
        if (audio) { audio.currentTime = 0; audio.play().catch(() => { }); }
    } catch (e) { /* el sonido nunca debe romper el registro */ }
}

// ============================================
// CONTADOR "EN SITIO" EN TIEMPO REAL
// ============================================
function suscribirEnSitio() {
    if (unsubEnSitio) { unsubEnSitio(); unsubEnSitio = null; }
    fechaSuscrita = getHoyStr();

    unsubEnSitio = db.collection('registros')
        .where('fecha', '==', fechaSuscrita)
        .where('salida', '==', null)
        .onSnapshot((snapshot) => {
            const el = document.getElementById('enSitioCount');
            if (el) el.textContent = snapshot.size;
        }, (error) => {
            console.warn('Listener en sitio:', error);
        });
}

window.addEventListener('beforeunload', () => { if (unsubEnSitio) unsubEnSitio(); });

// ============================================
// ESCÁNER
// ============================================
const scannerInput = document.getElementById('cedulaScanner');

scannerInput.addEventListener('input', function () {
    this.value = normalizarCedula(this.value);
});

scannerInput.addEventListener('keydown', async function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    if (procesando) return;

    const cedula = normalizarCedula(this.value);
    if (!cedulaValida(cedula)) {
        playSound('Error');
        aviso('Cédula inválida', 'Debe tener entre 6 y 15 dígitos');
        limpiarScanner();
        return;
    }

    procesando = true;
    this.disabled = true;
    try {
        await procesarEscaneo(cedula);
    } finally {
        procesando = false;
        this.disabled = false;
        limpiarScanner();
    }
});

function limpiarScanner() {
    scannerInput.value = '';
    scannerInput.focus();
}

// ============================================
// BÚSQUEDA DE PERSONA
// ============================================
// La cédula es el ID del documento en 'personas'. Eso evita
// duplicados y convierte la búsqueda en una sola lectura directa.
// Los documentos viejos (con ID aleatorio) se migran al vuelo.
async function buscarPersona(cedula) {
    // 1. Lectura directa por ID
    const directo = await db.collection('personas').doc(cedula).get();
    if (directo.exists) {
        const d = directo.data();
        if (d.nombre && tipoValido(d.tipo)) {
            return { cedula, nombre: d.nombre, tipo: d.tipo };
        }
    }

    // 2. Documento antiguo con ID aleatorio -> migrar
    try {
        const legado = await db.collection('personas')
            .where('cedula', '==', cedula).limit(1).get();
        if (!legado.empty) {
            const d = legado.docs[0].data();
            if (d.nombre && tipoValido(d.tipo)) {
                const persona = { cedula, nombre: d.nombre, tipo: d.tipo };
                await guardarPersona(persona);
                return persona;
            }
        }
    } catch (e) { console.warn('Búsqueda legado en personas:', e); }

    // 3. Reconstruir desde un registro anterior
    try {
        const registros = await db.collection('registros')
            .where('cedula', '==', cedula).limit(5).get();
        for (const doc of registros.docs) {
            const d = doc.data();
            if (d.nombre && tipoValido(d.tipo)) {
                const persona = { cedula, nombre: d.nombre, tipo: d.tipo };
                await guardarPersona(persona);
                return persona;
            }
        }
    } catch (e) { console.warn('Respaldo en registros:', e); }

    return null;
}

async function guardarPersona({ cedula, nombre, tipo }) {
    await db.collection('personas').doc(cedula).set({
        cedula: String(cedula),
        nombre: normalizarNombre(nombre),
        tipo: String(tipo),
        creadoEn: ahoraServidor()
    }, { merge: true });
}

// ============================================
// PROCESAR ESCANEO
// ============================================
async function procesarEscaneo(cedula) {
    mostrarEstado('loading', '<i class="fas fa-spinner fa-spin"></i>', '<p>Buscando...</p>');

    let persona;
    try {
        persona = await buscarPersona(cedula);
    } catch (error) {
        playSound('Error');
        mostrarEstado('error', '<i class="fas fa-exclamation-triangle"></i>',
            `<p class="scan-title">Error al buscar</p><p class="scan-subtitle">${esc(error.message)}</p>`);
        return;
    }

    // Persona nueva -> formulario de alta
    if (!persona) {
        playSound('Error');
        mostrarFormularioNuevo(cedula);
        mostrarEstado('new', '<i class="fas fa-user-plus"></i>',
            `<p class="scan-title">Persona no registrada</p>
             <p class="scan-subtitle">Cédula: ${esc(cedula)} — Complete el formulario abajo</p>`);
        return;
    }

    // Si es visitante y probablemente va a ENTRAR, pedimos el motivo
    // antes de abrir la transacción (no se puede mostrar interfaz
    // dentro de una transacción de Firestore).
    let motivoPrevio = '';
    if (persona.tipo === 'visitante') {
        const personaDoc = await db.collection('personas').doc(cedula).get();
        const activo = personaDoc.exists ? personaDoc.data().registroActivo : null;
        const fechaActiva = personaDoc.exists ? personaDoc.data().fechaActiva : null;
        const vaAEntrar = !activo || fechaActiva !== getHoyStr();

        if (vaAEntrar) {
            const { value: motivo, isDismissed } = await Swal.fire({
                title: 'Motivo de visita',
                html: `<p><strong>${esc(persona.nombre)}</strong></p>`,
                input: 'textarea',
                inputPlaceholder: 'Describa el motivo de la visita...',
                showCancelButton: true,
                confirmButtonText: 'Registrar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#4F46E5'
            });
            if (isDismissed) { ocultarEstado(); return; }
            motivoPrevio = String(motivo || 'No especificado').slice(0, 500);
        }
    }

    try {
        const resultado = await registrarMovimiento(persona, motivoPrevio);
        mostrarResultadoMovimiento(resultado, persona);
        cargarRegistrosHoy();
    } catch (error) {
        playSound('Error');
        mostrarEstado('error', '<i class="fas fa-exclamation-triangle"></i>',
            `<p class="scan-title">Error al procesar</p><p class="scan-subtitle">${esc(error.message)}</p>`);
        console.error('Error procesando escaneo:', error);
    }
}

// ============================================
// TRANSACCIÓN ATÓMICA ENTRADA / SALIDA
// ============================================
// Antes se leía y luego se escribía en dos pasos: dos personas
// escaneando al tiempo (o un doble Enter del lector) podían crear
// dos entradas abiertas para la misma cédula. La transacción sobre
// personas/{cedula} hace que el cambio de estado sea atómico.
async function registrarMovimiento(persona, motivoPrevio) {
    const hoy = getHoyStr();
    const ahora = ahoraServidor();          // la hora la pone Firebase
    const personaRef = db.collection('personas').doc(persona.cedula);

    return db.runTransaction(async (t) => {
        const personaSnap = await t.get(personaRef);
        const datos = personaSnap.exists ? personaSnap.data() : {};

        const idActivo = datos.registroActivo || null;
        const fechaActiva = datos.fechaActiva || null;

        // --- Todas las lecturas van antes de cualquier escritura ---
        let registroActivoSnap = null;
        let registroActivoRef = null;
        if (idActivo) {
            registroActivoRef = db.collection('registros').doc(idActivo);
            registroActivoSnap = await t.get(registroActivoRef);
        }

        const hayEntradaAbierta = registroActivoSnap
            && registroActivoSnap.exists
            && registroActivoSnap.data().salida === null;

        // CASO 1: entrada abierta de HOY -> registrar salida
        if (hayEntradaAbierta && fechaActiva === hoy) {
            t.update(registroActivoRef, { salida: ahora });
            t.update(personaRef, { registroActivo: null, fechaActiva: null });
            return { accion: 'salida', hora: new Date() };
        }

        // CASO 2: entrada abierta de un día anterior (nadie marcó
        // la salida). Se cierra automáticamente con la hora de
        // entrada y se marca para que el admin la identifique.
        if (hayEntradaAbierta && fechaActiva !== hoy) {
            t.update(registroActivoRef, {
                salida: datosDoc(registroActivoSnap).entrada || ahora,
                cierreAutomatico: true
            });
        }

        // CASO 3 (y continuación del 2): registrar ENTRADA nueva
        const nuevoRef = db.collection('registros').doc();
        t.set(nuevoRef, {
            cedula: String(persona.cedula),
            nombre: normalizarNombre(persona.nombre),
            tipo: String(persona.tipo),
            motivo: persona.tipo === 'visitante' ? String(motivoPrevio || 'No especificado') : '',
            entrada: ahora,
            salida: null,
            registradoPor: String(currentUser.email),
            fecha: hoy
        });
        t.set(personaRef, {
            cedula: String(persona.cedula),
            nombre: normalizarNombre(persona.nombre),
            tipo: String(persona.tipo),
            registroActivo: nuevoRef.id,
            fechaActiva: hoy,
            actualizadoEn: ahora
        }, { merge: true });

        return { accion: 'entrada', hora: new Date() };
    });
}

// ============================================
// PRESENTACIÓN DEL RESULTADO
// ============================================
function mostrarResultadoMovimiento(resultado, persona) {
    const esSalida = resultado.accion === 'salida';
    const hora = resultado.hora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });

    playSound(esSalida ? 'Salida' : 'Entrada');

    mostrarEstado(
        esSalida ? 'exit' : 'entry',
        esSalida ? '<i class="fas fa-door-open"></i>' : '<i class="fas fa-door-closed"></i>',
        `<p class="scan-title">${esSalida ? '👋 Salida Registrada' : '✅ Entrada Registrada'}</p>
         <p class="scan-subtitle">${esc(persona.nombre)} (${esc(persona.tipo)})</p>
         <p class="scan-time">${esc(hora)}</p>`
    );

    Swal.fire({
        icon: esSalida ? 'warning' : 'success',
        title: esSalida ? '👋 SALIDA' : '✅ ENTRADA',
        html: `<h2>${esc(persona.nombre)}</h2><p>${esc(persona.tipo)} — ${esc(persona.cedula)}</p>`,
        timer: 2500,
        showConfirmButton: false,
        customClass: { popup: esSalida ? 'swal-big swal-salida' : 'swal-big swal-entrada' },
        didClose: () => limpiarScanner()   // el lector necesita el foco de vuelta
    });
}

function mostrarEstado(clase, iconoHtml, infoHtml) {
    const div = document.getElementById('scanResult');
    div.style.display = 'flex';
    div.className = `scan-result scan-${clase}`;
    document.getElementById('scanResultIcon').innerHTML = iconoHtml;
    document.getElementById('scanResultInfo').innerHTML = infoHtml;
}

function ocultarEstado() {
    document.getElementById('scanResult').style.display = 'none';
}

// ============================================
// FORMULARIO DE PERSONA NUEVA
// ============================================
function mostrarFormularioNuevo(cedula) {
    const card = document.getElementById('nuevoRegistroCard');
    card.style.display = 'block';
    document.getElementById('cedula').value = cedula;
    document.getElementById('nombre').value = '';
    document.getElementById('nombre').focus();
    card.scrollIntoView({ behavior: 'smooth' });
}

function cancelarRegistro() {
    document.getElementById('nuevoRegistroCard').style.display = 'none';
    document.getElementById('registroForm').reset();
    document.getElementById('motivoGroup').style.display = 'none';
    ocultarEstado();
    limpiarScanner();
}

document.querySelectorAll('input[name="tipo"]').forEach(radio => {
    radio.addEventListener('change', function () {
        const esVisitante = this.value === 'visitante';
        document.getElementById('motivoGroup').style.display = esVisitante ? 'block' : 'none';
        document.getElementById('motivo').required = esVisitante;
        if (!esVisitante) document.getElementById('motivo').value = '';
    });
});

document.getElementById('registroForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const cedula = normalizarCedula(document.getElementById('cedula').value);
    const nombre = normalizarNombre(document.getElementById('nombre').value);
    const tipoEl = document.querySelector('input[name="tipo"]:checked');
    const motivo = document.getElementById('motivo').value.trim().slice(0, 500);

    if (!cedulaValida(cedula)) { aviso('Cédula inválida', 'Debe tener entre 6 y 15 dígitos'); return; }
    if (!nombre) { aviso('Nombre requerido', 'Escriba el nombre completo'); return; }
    if (!tipoEl) { aviso('Seleccione tipo', 'Debe seleccionar el tipo de persona'); return; }

    const tipo = tipoEl.value;
    if (tipo === 'visitante' && !motivo) { aviso('Motivo requerido', 'Ingrese el motivo de la visita'); return; }

    const btn = document.getElementById('btnRegistrar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

    try {
        const persona = { cedula, nombre, tipo };
        await guardarPersona(persona);
        const resultado = await registrarMovimiento(persona, motivo);

        document.getElementById('nuevoRegistroCard').style.display = 'none';
        document.getElementById('registroForm').reset();
        document.getElementById('motivoGroup').style.display = 'none';

        playSound('Entrada');
        mostrarEstado('entry', '<i class="fas fa-door-closed"></i>',
            `<p class="scan-title">✅ Persona Registrada + Entrada</p>
             <p class="scan-subtitle">${esc(nombre)} (${esc(tipo)})</p>`);

        Swal.fire({
            icon: 'success',
            title: '✅ REGISTRADO + ENTRADA',
            html: `<h2>${esc(nombre)}</h2><p>${esc(tipo)} — ${esc(cedula)}</p>`,
            timer: 2500,
            showConfirmButton: false,
            customClass: { popup: 'swal-big swal-entrada' },
            didClose: () => limpiarScanner()
        });

        cargarRegistrosHoy();
    } catch (error) {
        errorFirestore(error, 'Error al registrar');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle"></i> Registrar y Marcar Entrada';
    }
});

// ============================================
// TABLA DE REGISTROS DE HOY
// ============================================
async function cargarRegistrosHoy() {
    const hoy = getHoyStr();
    const tbody = document.getElementById('recentTable');

    try {
        const snapshot = await db.collection('registros')
            .where('fecha', '==', hoy)
            .orderBy('entrada', 'desc')
            .get();

        document.getElementById('todayCount').textContent = `(${snapshot.size})`;

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-inbox"></i> Sin registros hoy</td></tr>';
            return;
        }

        const filas = snapshot.docs.map(doc => {
            const d = datosDoc(doc);
            const tipo = tipoValido(d.tipo) ? d.tipo : 'N/A';
            const estado = d.salida
                ? '<span class="badge badge-salida"><i class="fas fa-sign-out-alt"></i> Salió</span>'
                : '<span class="badge badge-activo"><i class="fas fa-building"></i> En sitio</span>';

            return `<tr>
                <td>${esc(horaStr(d.entrada))}</td>
                <td>${esc(horaStr(d.salida))}</td>
                <td>${esc(d.cedula)}</td>
                <td>${esc(d.nombre)}</td>
                <td><span class="badge badge-${esc(tipo)}">${esc(tipo)}</span></td>
                <td>${estado}</td>
            </tr>`;
        });

        tbody.innerHTML = filas.join('');
    } catch (error) {
        console.error('Error cargando registros:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error al cargar registros</td></tr>';
    }
}
