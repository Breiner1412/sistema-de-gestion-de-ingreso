// ============================================
// PANEL ADMINISTRATIVO
// ============================================

let currentUser = null;
let allRegistros = [];
let datosParaImportar = [];
let todasPersonas = [];
let chartSemanal = null;
let chartTipos = null;
let unsubEnSitio = null;

const POR_PAGINA = 20;
const LIMITE_CONSULTA = 3000;   // tope de seguridad: evita traer meses enteros
let paginaActual = 1;

// ============================================
// PROTECCIÓN DE RUTA
// ============================================
auth.onAuthStateChanged(async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }

    try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (!doc.exists || doc.data().role !== 'admin') {
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

    // En paralelo: cada bloque del panel es independiente
    await Promise.all([
        aplicarFiltros(),
        cargarPersonas(),
        cargarUsuarios(),
        cargarEnSitio(),
        cargarGraficas()
    ]);

    suscribirEnSitio();
});

// ============================================
// CONTADOR EN SITIO EN TIEMPO REAL
// ============================================
function suscribirEnSitio() {
    if (unsubEnSitio) unsubEnSitio();
    unsubEnSitio = db.collection('registros')
        .where('fecha', '==', getHoyStr())
        .where('salida', '==', null)
        .onSnapshot((snapshot) => {
            const el = document.getElementById('enSitioCount');
            if (el) el.textContent = snapshot.size;
        }, (error) => { console.warn('Listener en sitio:', error); });
}

window.addEventListener('beforeunload', () => { if (unsubEnSitio) unsubEnSitio(); });

// ============================================
// PERSONAS EN SITIO (TABLA)
// ============================================
async function cargarEnSitio() {
    const tbody = document.getElementById('enSitioBody');

    try {
        const snapshot = await db.collection('registros')
            .where('fecha', '==', getHoyStr())
            .where('salida', '==', null)
            .get();

        document.getElementById('enSitioCountTable').textContent = snapshot.size;

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-check-circle"></i> Nadie en sitio</td></tr>';
            return;
        }

        const filas = snapshot.docs.map(doc => {
            const d = datosDoc(doc);
            const tipo = tipoValido(d.tipo) ? d.tipo : 'N/A';
            return `<tr>
                <td>${esc(horaStr(d.entrada))}</td>
                <td>${esc(d.cedula)}</td>
                <td>${esc(d.nombre)}</td>
                <td><span class="badge badge-${esc(tipo)}">${esc(tipo)}</span></td>
                <td>${esc(tiempoTranscurrido(d.entrada))}</td>
                <td>
                  <button class="btn btn-sm btn-warning" data-accion="forzar-salida"
                          data-id="${esc(doc.id)}" data-cedula="${esc(d.cedula)}"
                          data-nombre="${esc(d.nombre)}" title="Registrar salida manualmente">
                    <i class="fas fa-sign-out-alt"></i>
                  </button>
                </td>
            </tr>`;
        });

        tbody.innerHTML = filas.join('');
    } catch (error) {
        console.error('Error en sitio:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error al cargar</td></tr>';
    }
}

// Cerrar manualmente una entrada que nadie marcó como salida
async function forzarSalida(registroId, cedula, nombre) {
    const result = await Swal.fire({
        title: '¿Registrar salida?',
        html: `<p>Se marcará la salida de <strong>${esc(nombre)}</strong> con la hora actual.</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, registrar salida',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#F59E0B'
    });
    if (!result.isConfirmed) return;

    try {
        const ahora = ahoraServidor();
        const registroRef = db.collection('registros').doc(registroId);
        const personaRef = db.collection('personas').doc(String(cedula));

        await db.runTransaction(async (t) => {
            const registroSnap = await t.get(registroRef);
            const personaSnap = await t.get(personaRef);
            if (!registroSnap.exists) throw new Error('El registro ya no existe');
            if (registroSnap.data().salida !== null) throw new Error('Esta entrada ya tiene salida');

            t.update(registroRef, { salida: ahora, cierreAutomatico: true });
            if (personaSnap.exists && personaSnap.data().registroActivo === registroId) {
                t.update(personaRef, { registroActivo: null, fechaActiva: null });
            }
        });

        await cargarEnSitio();
        await aplicarFiltros();
        Swal.fire({ icon: 'success', title: 'Salida registrada', timer: 1500, showConfirmButton: false });
    } catch (error) {
        errorFirestore(error, 'No se pudo registrar la salida');
    }
}

// Reporte CSV de quienes están en sitio
function reporteEnSitio() {
    const filas = document.querySelectorAll('#enSitioBody tr');
    if (filas.length === 0 || filas[0].querySelector('.empty-state')) {
        Swal.fire({ icon: 'info', title: 'Sin personas', text: 'No hay nadie en sitio actualmente' });
        return;
    }

    let csv = 'Hora Entrada;Cédula;Nombre;Tipo;Tiempo\n';
    filas.forEach(fila => {
        const celdas = fila.querySelectorAll('td');
        if (celdas.length >= 5) {
            csv += Array.from(celdas).slice(0, 5).map(c => csvCampo(c.textContent)).join(';') + '\n';
        }
    });

    descargarCSV(csv, `personas_en_sitio_${getHoyStr()}.csv`);
    Swal.fire({ icon: 'success', title: 'Reporte generado', timer: 1800, showConfirmButton: false });
}

// ============================================
// CSV
// ============================================
// Un campo que empieza por = + - @ es interpretado como fórmula
// por Excel: se antepone una comilla simple para neutralizarlo.
function csvCampo(valor) {
    let texto = String(valor ?? '').trim().replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t]/.test(texto)) texto = "'" + texto;
    return '"' + texto.replace(/"/g, '""') + '"';
}

function descargarCSV(contenido, nombreArchivo) {
    const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================
// GRÁFICAS
// ============================================
// Antes eran 8 consultas en fila descargando documentos completos
// solo para contarlos. Ahora van en paralelo y usan la consulta de
// agregación count() cuando el SDK la soporta (mucho más barata).
async function contarRegistros(consulta) {
    try {
        if (typeof consulta.count === 'function') {
            const snap = await consulta.count().get();
            return snap.data().count;
        }
    } catch (e) { /* SDK sin agregaciones: se usa el conteo clásico */ }
    const snap = await consulta.get();
    return snap.size;
}

async function cargarGraficas() {
    const labels = [];
    const promesas = [];

    for (let i = 6; i >= 0; i--) {
        const fecha = fechaLocalDesplazada(-i);
        labels.push(fecha.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' }));
        promesas.push(
            contarRegistros(db.collection('registros').where('fecha', '==', fechaLocalStr(fecha)))
                .catch(() => 0)
        );
    }

    const promesaHoy = db.collection('registros').where('fecha', '==', getHoyStr()).get()
        .catch(() => null);

    const [datosBarras, snapHoy] = await Promise.all([Promise.all(promesas), promesaHoy]);

    // --- Barras: últimos 7 días ---
    const ctxBar = document.getElementById('chartSemanal');
    if (chartSemanal) chartSemanal.destroy();
    chartSemanal = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Entradas', data: datosBarras,
                backgroundColor: 'rgba(79, 70, 229, 0.7)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1, borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } }
        }
    });

    // --- Torta: distribución por tipo (hoy) ---
    let emp = 0, est = 0, vis = 0;
    if (snapHoy) {
        snapHoy.forEach(doc => {
            const t = doc.data().tipo;
            if (t === 'empleado') emp++;
            else if (t === 'estudiante') est++;
            else if (t === 'visitante') vis++;
        });
    }

    const ctxPie = document.getElementById('chartTipos');
    if (chartTipos) chartTipos.destroy();
    chartTipos = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: ['Empleados', 'Estudiantes', 'Visitantes'],
            datasets: [{ data: [emp, est, vis], backgroundColor: ['#3B82F6', '#10B981', '#F59E0B'], borderWidth: 2 }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}

// ============================================
// FILTROS
// ============================================
document.getElementById('filtroPeriodo').addEventListener('change', function () {
    const custom = this.value === 'personalizado';
    document.getElementById('fechaPersonalizadaGroup').style.display = custom ? 'block' : 'none';
    document.getElementById('fechaPersonalizadaGroup2').style.display = custom ? 'block' : 'none';
});

function getInicioSemana() {
    const hoy = new Date();
    const dia = hoy.getDay();                        // 0 = domingo
    const desplazamiento = dia === 0 ? -6 : 1 - dia; // la semana empieza el lunes
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() + desplazamiento);
    return fechaLocalStr(lunes);
}

function getInicioMes() {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
}

function limpiarFiltros() {
    document.getElementById('filtroPeriodo').value = 'hoy';
    document.getElementById('filtroTipo').value = 'todos';
    document.getElementById('buscarCedula').value = '';
    document.getElementById('fechaDesde').value = '';
    document.getElementById('fechaHasta').value = '';
    document.getElementById('fechaPersonalizadaGroup').style.display = 'none';
    document.getElementById('fechaPersonalizadaGroup2').style.display = 'none';
    aplicarFiltros();
}

async function aplicarFiltros() {
    const periodo = document.getElementById('filtroPeriodo').value;
    const tipo = document.getElementById('filtroTipo').value;
    const buscarCedula = normalizarCedula(document.getElementById('buscarCedula').value);

    let fechaDesde, fechaHasta;
    switch (periodo) {
        case 'hoy': fechaDesde = fechaHasta = getHoyStr(); break;
        case 'semana': fechaDesde = getInicioSemana(); fechaHasta = getHoyStr(); break;
        case 'mes': fechaDesde = getInicioMes(); fechaHasta = getHoyStr(); break;
        case 'personalizado':
            fechaDesde = document.getElementById('fechaDesde').value;
            fechaHasta = document.getElementById('fechaHasta').value;
            if (!fechaDesde || !fechaHasta) { aviso('Fechas requeridas', 'Seleccione ambas fechas'); return; }
            if (fechaDesde > fechaHasta) { aviso('Rango inválido', 'La fecha inicial es posterior a la final'); return; }
            break;
    }

    try {
        const snapshot = await db.collection('registros')
            .where('fecha', '>=', fechaDesde)
            .where('fecha', '<=', fechaHasta)
            .orderBy('fecha', 'desc')
            .orderBy('entrada', 'desc')
            .limit(LIMITE_CONSULTA)
            .get();

        allRegistros = snapshot.docs
            .map(doc => ({ id: doc.id, ...datosDoc(doc) }))
            .filter(r => tipo === 'todos' || r.tipo === tipo)
            .filter(r => !buscarCedula || String(r.cedula || '').includes(buscarCedula));

        if (snapshot.size === LIMITE_CONSULTA) {
            aviso('Rango muy amplio', `Se muestran los primeros ${LIMITE_CONSULTA} registros. Acote las fechas.`, 'info');
        }

        actualizarEstadisticas();
        paginaActual = 1;
        renderizarTabla();
        renderizarPaginacion();
    } catch (error) {
        errorFirestore(error, 'Error al cargar registros');
    }
}

function actualizarEstadisticas() {
    document.getElementById('statTotal').textContent = allRegistros.length;
    document.getElementById('statEmpleados').textContent = allRegistros.filter(r => r.tipo === 'empleado').length;
    document.getElementById('statEstudiantes').textContent = allRegistros.filter(r => r.tipo === 'estudiante').length;
    document.getElementById('statVisitantes').textContent = allRegistros.filter(r => r.tipo === 'visitante').length;
    document.getElementById('recordCount').textContent = `(${allRegistros.length} registros)`;
}

// ============================================
// TABLA DE REGISTROS
// ============================================
function renderizarTabla() {
    const tbody = document.getElementById('registrosBody');
    const inicio = (paginaActual - 1) * POR_PAGINA;
    const pagina = allRegistros.slice(inicio, inicio + POR_PAGINA);

    if (pagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><i class="fas fa-search"></i> No se encontraron registros</td></tr>';
        return;
    }

    tbody.innerHTML = pagina.map(r => {
        const tipo = tipoValido(r.tipo) ? r.tipo : 'N/A';
        const salida = r.salida
            ? esc(horaStr(r.salida)) + (r.cierreAutomatico ? ' <i class="fas fa-robot" title="Cierre automático"></i>' : '')
            : '<span class="badge badge-activo">En sitio</span>';

        return `<tr>
            <td>${esc(fechaStr(r.entrada))}</td>
            <td>${esc(horaStr(r.entrada))}</td>
            <td>${salida}</td>
            <td>${esc(r.cedula)}</td>
            <td>${esc(r.nombre)}</td>
            <td><span class="badge badge-${esc(tipo)}">${esc(tipo)}</span></td>
            <td>${esc(r.motivo || '-')}</td>
            <td>${esc(r.registradoPor)}</td>
            <td><button class="btn btn-sm btn-primary" data-accion="historial"
                    data-cedula="${esc(r.cedula)}" data-nombre="${esc(r.nombre)}" data-tipo="${esc(tipo)}">
                    <i class="fas fa-history"></i></button></td>
        </tr>`;
    }).join('');
}

// ============================================
// PAGINACIÓN
// ============================================
function renderizarPaginacion() {
    const totalPaginas = Math.ceil(allRegistros.length / POR_PAGINA);
    const container = document.getElementById('pagination');
    if (totalPaginas <= 1) { container.innerHTML = ''; return; }

    let html = '';
    if (paginaActual > 1) html += `<button class="page-btn" data-accion="pagina" data-pagina="${paginaActual - 1}"><i class="fas fa-chevron-left"></i></button>`;
    for (let i = 1; i <= totalPaginas; i++) {
        if (i === paginaActual) html += `<button class="page-btn active">${i}</button>`;
        else if (i === 1 || i === totalPaginas || (i >= paginaActual - 2 && i <= paginaActual + 2))
            html += `<button class="page-btn" data-accion="pagina" data-pagina="${i}">${i}</button>`;
        else if (i === paginaActual - 3 || i === paginaActual + 3)
            html += `<span class="page-btn" style="cursor:default;border:none;">...</span>`;
    }
    if (paginaActual < totalPaginas) html += `<button class="page-btn" data-accion="pagina" data-pagina="${paginaActual + 1}"><i class="fas fa-chevron-right"></i></button>`;
    container.innerHTML = html;
}

function irAPagina(p) {
    paginaActual = p;
    renderizarTabla();
    renderizarPaginacion();
    document.getElementById('registrosTable').scrollIntoView({ behavior: 'smooth' });
}

// ============================================
// DELEGACIÓN DE EVENTOS
// ============================================
// Antes los botones se generaban con onclick="fn('${nombre}')".
// Un nombre con apóstrofe (O'BRIEN) rompía el botón y, peor,
// permitía inyectar código. Ahora los datos viajan en atributos
// data-* y nunca se ejecutan como JavaScript.
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;

    switch (btn.dataset.accion) {
        case 'historial':
            verHistorial(btn.dataset.cedula, btn.dataset.nombre, btn.dataset.tipo); break;
        case 'pagina':
            irAPagina(Number(btn.dataset.pagina)); break;
        case 'editar-persona':
            editarPersona(btn.dataset.id); break;
        case 'eliminar-persona':
            eliminarPersona(btn.dataset.id, btn.dataset.nombre); break;
        case 'forzar-salida':
            forzarSalida(btn.dataset.id, btn.dataset.cedula, btn.dataset.nombre); break;
    }
});

// ============================================
// HISTORIAL
// ============================================
async function verHistorial(cedula, nombre, tipo) {
    const modal = document.getElementById('historialModal');
    const tbody = document.getElementById('historialBody');
    modal.style.display = 'flex';
    document.getElementById('historialPersonaInfo').innerHTML =
        `<span class="badge badge-${esc(tipo)}">${esc(tipo)}</span> <strong>${esc(nombre)}</strong> — Cédula: ${esc(cedula)}`;
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>';

    try {
        const snapshot = await db.collection('registros')
            .where('cedula', '==', String(cedula))
            .orderBy('entrada', 'desc')
            .limit(50)
            .get();

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Sin historial</td></tr>';
            return;
        }

        tbody.innerHTML = snapshot.docs.map(doc => {
            const d = datosDoc(doc);
            return `<tr>
                <td>${esc(fechaStr(d.entrada))}</td>
                <td>${esc(horaStr(d.entrada))}</td>
                <td>${d.salida ? esc(horaStr(d.salida)) : '<span class="badge badge-activo">En sitio</span>'}</td>
                <td>${esc(d.motivo || '-')}</td>
            </tr>`;
        }).join('');
    } catch (error) {
        console.error('Historial:', error);
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Error al cargar</td></tr>';
    }
}

function cerrarHistorial() { document.getElementById('historialModal').style.display = 'none'; }
document.getElementById('historialModal').addEventListener('click', function (e) { if (e.target === this) cerrarHistorial(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarHistorial(); });

// ============================================
// EXPORTAR REGISTROS
// ============================================
function exportarCSV() {
    if (allRegistros.length === 0) { Swal.fire({ icon: 'info', title: 'Sin datos', text: 'No hay registros para exportar' }); return; }

    const encabezados = ['Fecha', 'Entrada', 'Salida', 'Cédula', 'Nombre', 'Tipo', 'Motivo', 'Registrado Por'];
    let csv = encabezados.map(csvCampo).join(';') + '\n';

    allRegistros.forEach(r => {
        csv += [
            fechaStr(r.entrada), horaStr(r.entrada),
            r.salida ? horaStr(r.salida) : 'En sitio',
            r.cedula, r.nombre, r.tipo, r.motivo || '', r.registradoPor
        ].map(csvCampo).join(';') + '\n';
    });

    descargarCSV(csv, `registros_${getHoyStr()}.csv`);
    Swal.fire({ icon: 'success', title: 'Exportado', text: `${allRegistros.length} registros`, timer: 1800, showConfirmButton: false });
}

// ============================================
// IMPORTAR DESDE EXCEL
// ============================================
function descargarPlantilla() {
    const ws = XLSX.utils.aoa_to_sheet([
        ['cedula', 'nombre', 'tipo'],
        ['1093558199', 'JUAN PEREZ', 'estudiante'],
        ['1054323234', 'MARIA GOMEZ', 'empleado'],
        ['987654321', 'CARLOS RODRIGUEZ', 'visitante']
    ]);
    ws['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Personas');
    XLSX.writeFile(wb, 'plantilla_personas.xlsx');
    Swal.fire({ icon: 'success', title: 'Plantilla descargada', timer: 1800, showConfirmButton: false });
}

async function previsualizarArchivo(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    const previewDiv = document.getElementById('importPreview');
    const previewBody = document.getElementById('previewBody');
    previewDiv.style.display = 'block';
    document.getElementById('importProgress').style.display = 'none';
    previewBody.innerHTML = '<tr><td colspan="4" class="empty-state"><i class="fas fa-spinner fa-spin"></i> Leyendo...</td></tr>';

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(sheet, { raw: false });

        if (filas.length === 0) {
            previewBody.innerHTML = '<tr><td colspan="4" class="empty-state">Archivo vacío</td></tr>';
            return;
        }

        // Las cédulas conocidas salen de la lista ya cargada en
        // memoria: no hace falta releer toda la colección.
        const existentes = new Set(todasPersonas.map(p => String(p.cedula).trim()));
        const vistasEnArchivo = new Set();

        datosParaImportar = [];
        let nuevos = 0, duplicados = 0, errores = 0;
        let html = '';

        filas.forEach(fila => {
            const cedula = normalizarCedula(fila.cedula ?? fila.Cedula ?? fila.CEDULA ?? fila['cédula'] ?? '');
            const nombre = normalizarNombre(fila.nombre ?? fila.Nombre ?? fila.NOMBRE ?? '');
            const tipo = String(fila.tipo ?? fila.Tipo ?? fila.TIPO ?? '').trim().toLowerCase();

            let estado, clase, icono;

            if (!cedulaValida(cedula)) { estado = 'Cédula inválida'; clase = 'row-error'; icono = 'fa-times-circle'; errores++; }
            else if (!nombre) { estado = 'Sin nombre'; clase = 'row-error'; icono = 'fa-times-circle'; errores++; }
            else if (!tipoValido(tipo)) { estado = 'Tipo inválido'; clase = 'row-error'; icono = 'fa-times-circle'; errores++; }
            else if (existentes.has(cedula) || vistasEnArchivo.has(cedula)) { estado = 'Ya existe'; clase = 'row-duplicate'; icono = 'fa-exclamation-triangle'; duplicados++; }
            else {
                estado = 'Nuevo'; clase = 'row-new'; icono = 'fa-check-circle'; nuevos++;
                datosParaImportar.push({ cedula, nombre, tipo });
                vistasEnArchivo.add(cedula);
            }

            html += `<tr>
                <td><span class="${clase}"><i class="fas ${icono}"></i> ${esc(estado)}</span></td>
                <td>${esc(cedula)}</td><td>${esc(nombre)}</td>
                <td>${tipo ? `<span class="badge badge-${esc(tipo)}">${esc(tipo)}</span>` : '-'}</td>
            </tr>`;
        });

        previewBody.innerHTML = html;
        document.getElementById('previewCount').textContent = `(${filas.length} filas)`;
        document.getElementById('importStats').innerHTML = `
            <span class="import-stat import-stat-total"><i class="fas fa-list"></i> Total: ${filas.length}</span>
            <span class="import-stat import-stat-new"><i class="fas fa-check-circle"></i> Nuevos: ${nuevos}</span>
            <span class="import-stat import-stat-duplicate"><i class="fas fa-exclamation-triangle"></i> Duplicados: ${duplicados}</span>
            <span class="import-stat import-stat-error"><i class="fas fa-times-circle"></i> Errores: ${errores}</span>`;

        const btn = document.getElementById('btnImportar');
        btn.disabled = nuevos === 0;
        btn.innerHTML = nuevos === 0
            ? '<i class="fas fa-ban"></i> Nada que importar'
            : `<i class="fas fa-upload"></i> Importar ${nuevos} personas`;

    } catch (error) {
        previewBody.innerHTML = `<tr><td colspan="4" class="empty-state">Error: ${esc(error.message)}</td></tr>`;
    }
}

async function ejecutarImportacion() {
    if (datosParaImportar.length === 0) return;

    const result = await Swal.fire({
        title: `¿Importar ${datosParaImportar.length} personas?`,
        icon: 'question', showCancelButton: true,
        confirmButtonText: 'Sí, importar', cancelButtonText: 'Cancelar', confirmButtonColor: '#4F46E5'
    });
    if (!result.isConfirmed) return;

    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const btnImportar = document.getElementById('btnImportar');

    document.getElementById('importProgress').style.display = 'block';
    btnImportar.disabled = true;
    btnImportar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando...';

    const total = datosParaImportar.length;
    let importados = 0, fallidos = 0;

    for (let i = 0; i < total; i += 200) {
        const lote = datosParaImportar.slice(i, i + 200);
        const batch = db.batch();
        lote.forEach(p => {
            // La cédula es el ID: si ya existe se actualiza en vez
            // de crear un duplicado.
            batch.set(db.collection('personas').doc(p.cedula), {
                cedula: String(p.cedula), nombre: String(p.nombre), tipo: String(p.tipo),
                creadoEn: ahoraServidor()
            }, { merge: true });
        });

        try { await batch.commit(); importados += lote.length; }
        catch (e) { console.error('Lote fallido:', e); fallidos += lote.length; }

        const pct = Math.round(((i + lote.length) / total) * 100);
        progressBar.style.width = pct + '%';
        progressText.textContent = `Importando... ${importados} de ${total} (${pct}%)`;
    }

    progressBar.style.width = '100%';
    progressText.textContent = `✅ ${importados} importados, ${fallidos} fallidos`;
    btnImportar.innerHTML = '<i class="fas fa-check"></i> Completado';
    datosParaImportar = [];

    Swal.fire({
        icon: fallidos ? 'warning' : 'success',
        title: fallidos ? 'Importación con errores' : '¡Importación completa!',
        text: `${importados} personas importadas, ${fallidos} fallidas`
    });
    await cargarPersonas();
}

function cancelarImportacion() {
    document.getElementById('importPreview').style.display = 'none';
    document.getElementById('importProgress').style.display = 'none';
    datosParaImportar = [];
}

// ============================================
// PERSONAS REGISTRADAS
// ============================================
async function cargarPersonas() {
    const tbody = document.getElementById('personasBody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>';

    try {
        const snapshot = await db.collection('personas').orderBy('nombre', 'asc').get();
        todasPersonas = snapshot.docs.map(doc => ({ id: doc.id, ...datosDoc(doc) }));
        document.getElementById('personasCount').textContent = `(${todasPersonas.length})`;
        renderizarPersonas(todasPersonas);
        avisarPersonasLegado();
    } catch (error) {
        console.error('Personas:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Error al cargar</td></tr>';
    }
}

// Documentos creados por la versión anterior: su ID era aleatorio,
// por eso podían existir dos personas con la misma cédula.
function avisarPersonasLegado() {
    const banner = document.getElementById('avisoLegado');
    if (!banner) return;

    const legado = todasPersonas.filter(p => p.id !== String(p.cedula));
    if (legado.length === 0) { banner.style.display = 'none'; return; }

    banner.style.display = 'block';
    banner.innerHTML = `
        <i class="fas fa-exclamation-triangle"></i>
        Hay <strong>${legado.length}</strong> personas guardadas con el formato antiguo
        (pueden estar duplicadas).
        <button class="btn btn-sm btn-warning" id="btnNormalizar">
            <i class="fas fa-magic"></i> Normalizar ahora
        </button>`;
    document.getElementById('btnNormalizar').addEventListener('click', normalizarPersonas);
}

// Mueve cada persona a personas/{cedula} y elimina el documento viejo
async function normalizarPersonas() {
    const legado = todasPersonas.filter(p => p.id !== String(p.cedula));
    if (legado.length === 0) return;

    const result = await Swal.fire({
        title: `¿Normalizar ${legado.length} personas?`,
        html: `<p>Cada persona pasará a identificarse por su cédula y se unificarán los duplicados.</p>
               <p class="text-sm text-muted">Los registros de entrada/salida no se tocan.</p>`,
        icon: 'question', showCancelButton: true,
        confirmButtonText: 'Sí, normalizar', cancelButtonText: 'Cancelar', confirmButtonColor: '#4F46E5'
    });
    if (!result.isConfirmed) return;

    Swal.fire({ title: 'Normalizando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    let movidos = 0, omitidos = 0;
    try {
        for (let i = 0; i < legado.length; i += 100) {
            const lote = legado.slice(i, i + 100);
            const batch = db.batch();
            lote.forEach(p => {
                const cedula = normalizarCedula(p.cedula);
                if (!cedulaValida(cedula) || !tipoValido(p.tipo) || !p.nombre) { omitidos++; return; }
                batch.set(db.collection('personas').doc(cedula), {
                    cedula,
                    nombre: normalizarNombre(p.nombre),
                    tipo: String(p.tipo).toLowerCase(),
                    creadoEn: p.creadoEn || ahoraServidor()
                }, { merge: true });
                batch.delete(db.collection('personas').doc(p.id));
                movidos++;
            });
            await batch.commit();
        }
        Swal.fire({ icon: 'success', title: 'Listo', text: `${movidos} normalizadas, ${omitidos} omitidas por datos inválidos` });
        await cargarPersonas();
    } catch (error) {
        errorFirestore(error, 'Error al normalizar');
    }
}

function renderizarPersonas(lista) {
    const tbody = document.getElementById('personasBody');
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><i class="fas fa-users"></i> No hay personas</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(p => {
        const tipo = tipoValido(p.tipo) ? p.tipo : 'N/A';
        return `<tr>
            <td>${esc(p.cedula)}</td>
            <td>${esc(p.nombre)}</td>
            <td><span class="badge badge-${esc(tipo)}">${esc(tipo)}</span></td>
            <td>${esc(fechaStr(p.creadoEn))}</td>
            <td>
                <button class="btn btn-sm btn-primary" data-accion="editar-persona" data-id="${esc(p.id)}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-danger" data-accion="eliminar-persona" data-id="${esc(p.id)}" data-nombre="${esc(p.nombre)}"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
}

function filtrarPersonas() {
    const buscar = document.getElementById('buscarPersona').value.trim().toLowerCase();
    if (!buscar) { renderizarPersonas(todasPersonas); return; }
    renderizarPersonas(todasPersonas.filter(p =>
        String(p.nombre || '').toLowerCase().includes(buscar) ||
        String(p.cedula || '').includes(buscar)
    ));
}

async function editarPersona(id) {
    const persona = todasPersonas.find(p => p.id === id);
    if (!persona) return;

    const { value: datos } = await Swal.fire({
        title: 'Editar Persona',
        html: `
            <input id="swal-cedula" class="swal2-input" value="${esc(persona.cedula)}" placeholder="Cédula" inputmode="numeric">
            <input id="swal-nombre" class="swal2-input" value="${esc(persona.nombre)}" placeholder="Nombre">
            <select id="swal-tipo" class="swal2-select">
                <option value="empleado" ${persona.tipo === 'empleado' ? 'selected' : ''}>Empleado</option>
                <option value="estudiante" ${persona.tipo === 'estudiante' ? 'selected' : ''}>Estudiante</option>
                <option value="visitante" ${persona.tipo === 'visitante' ? 'selected' : ''}>Visitante</option>
            </select>`,
        focusConfirm: false, showCancelButton: true,
        confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar', confirmButtonColor: '#4F46E5',
        preConfirm: () => ({
            cedula: normalizarCedula(document.getElementById('swal-cedula').value),
            nombre: normalizarNombre(document.getElementById('swal-nombre').value),
            tipo: document.getElementById('swal-tipo').value
        })
    });

    if (!datos) return;
    if (!cedulaValida(datos.cedula)) { Swal.fire({ icon: 'error', title: 'Cédula inválida', text: 'Debe tener entre 6 y 15 dígitos' }); return; }
    if (!datos.nombre) { Swal.fire({ icon: 'error', title: 'Falta el nombre' }); return; }

    // Cambiar la cédula implica cambiar el ID del documento
    const cambiaDocumento = datos.cedula !== persona.id;
    if (cambiaDocumento && todasPersonas.some(p => p.id !== id && String(p.cedula) === datos.cedula)) {
        Swal.fire({ icon: 'error', title: 'Cédula duplicada', text: 'Ya existe otra persona con esa cédula' });
        return;
    }

    try {
        const batch = db.batch();
        batch.set(db.collection('personas').doc(datos.cedula), {
            cedula: datos.cedula, nombre: datos.nombre, tipo: datos.tipo,
            creadoEn: persona.creadoEn || ahoraServidor()
        }, { merge: true });
        if (cambiaDocumento) batch.delete(db.collection('personas').doc(persona.id));
        await batch.commit();

        Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1400, showConfirmButton: false });
        await cargarPersonas();
    } catch (error) {
        errorFirestore(error, 'No se pudo actualizar');
    }
}

async function eliminarPersona(id, nombre) {
    const result = await Swal.fire({
        title: '¿Eliminar persona?',
        html: `<p>Se eliminará a <strong>${esc(nombre)}</strong> del catálogo.</p>
               <p class="text-sm text-muted">Los registros de entrada/salida se conservan.</p>`,
        icon: 'warning', showCancelButton: true,
        confirmButtonColor: '#EF4444', confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;

    try {
        await db.collection('personas').doc(id).delete();
        Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1400, showConfirmButton: false });
        await cargarPersonas();
    } catch (error) {
        errorFirestore(error, 'No se pudo eliminar');
    }
}

function exportarPersonasCSV() {
    if (todasPersonas.length === 0) { Swal.fire({ icon: 'info', title: 'Sin datos' }); return; }

    let csv = ['cedula', 'nombre', 'tipo'].map(csvCampo).join(';') + '\n';
    todasPersonas.forEach(p => { csv += [p.cedula, p.nombre, p.tipo].map(csvCampo).join(';') + '\n'; });

    descargarCSV(csv, `personas_${getHoyStr()}.csv`);
    Swal.fire({ icon: 'success', title: 'Exportado', text: `${todasPersonas.length} personas`, timer: 1800, showConfirmButton: false });
}

// ============================================
// USUARIOS DEL SISTEMA
// ============================================
async function cargarUsuarios() {
    const tbody = document.getElementById('usuariosBody');
    try {
        const snapshot = await db.collection('users').get();
        if (snapshot.empty) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">Sin usuarios</td></tr>'; return; }

        tbody.innerHTML = snapshot.docs.map(doc => {
            const d = doc.data();
            return `<tr><td>${esc(d.email)}</td><td><span class="badge badge-${esc(d.role)}">${esc(d.role)}</span></td></tr>`;
        }).join('');
    } catch (error) {
        console.error('Usuarios:', error);
        tbody.innerHTML = '<tr><td colspan="2" class="empty-state">Error al cargar</td></tr>';
    }
}

// El usuario se crea en una instancia SECUNDARIA de Firebase.
// Con la instancia principal, createUserWithEmailAndPassword deja
// la sesión iniciada como el usuario nuevo y expulsaba al admin.
async function crearUsuario() {
    const { value: datos } = await Swal.fire({
        title: 'Crear Usuario del Sistema',
        html: `
            <input id="swal-email" class="swal2-input" placeholder="correo@colegio.com" type="email">
            <input id="swal-pass" class="swal2-input" placeholder="Contraseña (mín. 8 caracteres)" type="password">
            <select id="swal-role" class="swal2-select">
                <option value="recepcionista">Recepcionista</option>
                <option value="admin">Administrador</option>
            </select>
            <p style="font-size:12px;color:#888;margin-top:10px;">Su sesión de administrador no se cerrará.</p>`,
        focusConfirm: false, showCancelButton: true,
        confirmButtonText: 'Crear', cancelButtonText: 'Cancelar', confirmButtonColor: '#4F46E5',
        preConfirm: () => ({
            email: document.getElementById('swal-email').value.trim(),
            password: document.getElementById('swal-pass').value,
            role: document.getElementById('swal-role').value
        })
    });

    if (!datos) return;
    if (!/^\S+@\S+\.\S+$/.test(datos.email)) {
        Swal.fire({ icon: 'error', title: 'Correo inválido' }); return;
    }
    if (!datos.password || datos.password.length < 8) {
        Swal.fire({ icon: 'error', title: 'Contraseña muy corta', text: 'Mínimo 8 caracteres' }); return;
    }

    Swal.fire({ title: 'Creando usuario...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    let appSecundaria = null;
    try {
        appSecundaria = firebase.initializeApp(firebaseConfig, 'creacionUsuarios-' + Date.now());
        const credencial = await appSecundaria.auth()
            .createUserWithEmailAndPassword(datos.email, datos.password);
        const nuevoUid = credencial.user.uid;

        // El documento de rol lo escribe el ADMIN (sesión principal),
        // que es quien tiene permiso según las reglas de Firestore.
        await db.collection('users').doc(nuevoUid).set({
            email: datos.email,
            role: datos.role
        });

        await appSecundaria.auth().signOut();

        Swal.fire({
            icon: 'success', title: 'Usuario creado',
            html: `<p><strong>${esc(datos.email)}</strong> como <strong>${esc(datos.role)}</strong></p>`,
            confirmButtonColor: '#4F46E5'
        });
        await cargarUsuarios();

    } catch (error) {
        let msg = error.message;
        if (error.code === 'auth/email-already-in-use') msg = 'Ese correo ya está registrado';
        if (error.code === 'auth/weak-password') msg = 'La contraseña es muy débil';
        if (error.code === 'permission-denied') msg = 'La cuenta se creó pero no se pudo asignar el rol. Asígnelo desde la consola de Firebase.';
        Swal.fire({ icon: 'error', title: 'Error', text: msg });
    } finally {
        if (appSecundaria) { try { await appSecundaria.delete(); } catch (e) { } }
    }
}
