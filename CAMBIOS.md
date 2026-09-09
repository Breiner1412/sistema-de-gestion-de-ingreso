# Cambios de la revisión — septiembre 2026

Respaldo de la versión anterior: carpeta `_respaldo_antes_revision/`
(puede borrarla cuando confirme que todo funciona; ya está en `.gitignore`).

---

## ⚠️ Pasos obligatorios antes de usar el sistema

1. **Poner los datos reales del proyecto**
   - `js/firebase-config.js` → reemplazar `TU_API_KEY_AQUI` y los demás valores.
   - `.firebaserc` → reemplazar `TU_PROYECTO` por el ID real.

2. **Publicar reglas e índices**

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

   Los índices tardan unos minutos en construirse. Mientras tanto, el panel
   de administración puede mostrar "Error al cargar registros".

3. **Normalizar las personas existentes**
   Entrar al panel de administración: si hay datos del formato anterior
   aparece un aviso amarillo sobre la tabla *Personas Registradas* con el
   botón **Normalizar ahora**. Ejecútelo una sola vez.

4. **Revisar los registros abiertos de días anteriores**
   En *Personas en Sitio* ahora hay un botón para cerrar manualmente
   cualquier entrada que nadie marcó como salida.

---

## Fallas corregidas

| # | Problema | Solución |
|---|---|---|
| 1 | No existía `firestore.rules` (el `deploy` fallaba) y la regla sugerida permitía que un recepcionista se asignara `role:'admin'` desde la consola del navegador | Archivo `firestore.rules` con permisos por rol validados en el servidor |
| 2 | Faltaban 3 índices compuestos: fallaban los filtros del admin, la tabla de hoy y el historial. El archivo tenía índices sobre un campo `rol` inexistente | `firestore.indexes.json` reescrito con los 4 índices que el código usa |
| 3 | `toISOString()` guardaba la fecha en UTC: todo lo registrado después de las 7:00 p.m. quedaba con la fecha del día siguiente | `fechaLocalStr()` en `js/utils.js`, usada en todo el proyecto |
| 4 | Nombres y motivos se insertaban con `innerHTML` sin escapar (XSS); un apóstrofe rompía los botones `onclick` | Función `esc()` en todas las salidas + botones con `data-*` y delegación de eventos |
| 5 | Dos escaneos simultáneos podían crear dos entradas abiertas para la misma cédula | Transacción atómica sobre `personas/{cedula}` |
| 6 | `personas` permitía duplicados (la cédula era un campo, no el ID) | La cédula ahora es el ID del documento; búsqueda en una sola lectura |
| 7 | Quien no marcaba salida quedaba "en sitio" para siempre | Cierre automático al siguiente escaneo + botón manual en el panel |
| 8 | Crear un usuario expulsaba al administrador de su sesión | Se crea con una instancia secundaria de Firebase |
| 9 | Un documento sin `entrada` dejaba la tabla entera en blanco | `horaStr()` / `fechaStr()` toleran datos faltantes |
| 10 | La gráfica semanal hacía 8 consultas en fila descargando documentos completos | Consultas en paralelo + `count()` cuando el SDK lo soporta |
| 11 | Un filtro de "mes" traía miles de documentos sin tope | Límite de 3000 con aviso al usuario |
| 12 | CSV: un nombre que empezara por `=` se ejecutaba como fórmula en Excel | `csvCampo()` neutraliza y entrecomilla cada campo |
| 13 | `html_note` y `merge: true` no existen en SweetAlert2 / Firestore | Eliminados |

---

## Archivos nuevos

- `firestore.rules` — permisos por rol (la seguridad real del sistema).
- `js/utils.js` — fecha local, escapado HTML, formateo seguro de fechas y validaciones.
- `CAMBIOS.md` — este archivo.

## Segunda ronda de cambios

| # | Problema | Solución |
|---|---|---|
| 14 | Los sonidos venían de `assets.mixkit.co`: sin internet la portería quedaba muda | Carpeta `sonidos/` con tres archivos `.wav` propios generados para el proyecto |
| 15 | Las horas se tomaban del reloj del computador: un equipo desconfigurado guardaba horas erróneas | `serverTimestamp()` en entradas, salidas y altas; las reglas exigen que la hora de entrada sea la del servidor |

Detalle del cambio de hora:

- `ahoraServidor()` y `datosDoc()` en `js/utils.js`.
- La regla `request.resource.data.entrada == request.time` impide guardar una
  hora inventada aunque alguien modifique el JavaScript.
- La regla `salida >= entrada` impide salidas anteriores a la entrada.
- Al leer se usa `doc.data({ serverTimestamps: 'estimate' })`: si se registró
  sin internet, la tabla muestra la hora aproximada en vez de un guión.

## Tercera ronda: cierre del proyecto

| # | Cambio |
|---|---|
| 16 | `js/firebase-config.js` y `.firebaserc` apuntando al proyecto real `registro-ingreso-72ef6` |
| 17 | Repaso final de `firestore.rules`: coherencia del motivo con el tipo de persona, longitud del correo, salida nunca anterior a la entrada, y regla explícita de cierre para cualquier colección no contemplada |
| 18 | `README.md` reescrito como pieza de portafolio: problema, diagrama de flujo, decisiones técnicas justificadas, modelo de datos, seguridad, despliegue y roadmap |
| 19 | `LICENSE` (MIT) |
| 20 | Eliminados `node_modules/`, `package.json` y `package-lock.json`: eran del SDK modular de npm, que este proyecto no usa (carga Firebase por CDN) |

## Pendientes recomendados

- Restringir la API key por dominio en Google Cloud Console
  (APIs y servicios → Credenciales → Restricciones de sitios web).
- Paginación con cursores en el panel si el histórico crece a decenas de miles.
- Migrar del SDK compat 9.23 al SDK modular (deuda técnica, no urgencia).


---

# Guía de despliegue

## Una sola vez: instalar y entrar

```bash
npm install -g firebase-tools
firebase login
```

`firebase login` abre el navegador; entre con la cuenta de Google dueña del proyecto.

## Cada vez que quiera publicar

Todos los comandos se ejecutan **dentro de la carpeta del proyecto**.

```bash
# 1. Ver que esté apuntando al proyecto correcto
firebase projects:list
firebase use <ID-DEL-PROYECTO>

# 2. Publicar reglas e índices (seguridad y consultas)
firebase deploy --only firestore:rules,firestore:indexes

# 3. Publicar la página
firebase deploy --only hosting

# O todo junto
firebase deploy
```

## Probar antes de publicar

```bash
firebase serve --only hosting
```

Abre `http://localhost:5000`. Se conecta a la base de datos **real**, así que lo
que registre ahí queda guardado de verdad.

## Comandos útiles

| Para qué | Comando |
|---|---|
| Ver el historial de publicaciones | `firebase hosting:releases:list` |
| Volver a una versión anterior | Consola de Firebase → Hosting → menú de la versión → *Revertir* |
| Ver el estado de los índices | Consola de Firebase → Firestore → pestaña *Índices* |
| Cambiar de proyecto | `firebase use <otro-id>` |
| Cerrar sesión | `firebase logout` |

## Si algo falla

| Mensaje | Causa | Qué hacer |
|---|---|---|
| `Error: Failed to get Firebase project` | El ID en `.firebaserc` no existe o no tiene acceso | `firebase use --add` y elegir el proyecto |
| `HTTP Error: 403` al desplegar reglas | La cuenta no es propietaria del proyecto | Pedir permiso de *Editor* o entrar con la cuenta correcta |
| `The query requires an index` en el panel | Los índices aún se están construyendo | Esperar unos minutos; ver el estado en la consola |
| `Missing or insufficient permissions` | Falta el documento en `users` o el rol no coincide | Revisar `users/{uid}` en Firestore |
| La página muestra el login siempre | `js/firebase-config.js` todavía tiene los valores de ejemplo | Poner los datos reales del proyecto |
