// ============================================
// CONFIGURACIÓN DE FIREBASE
// ============================================
// Proyecto: registro-ingreso-72ef6
// (Consola de Firebase > Configuración del proyecto > Sus apps > Web)
//
// La apiKey de una app web NO es un secreto: Firebase la expone
// siempre en el navegador. Lo que realmente protege los datos son
// las reglas de firestore.rules y las restricciones de dominio en
// Google Cloud Console (API key > Restricciones de sitios web).

const firebaseConfig = {
    apiKey: "AIzaSyBcvHorCQggDO8qcgb7iowiCqE2-yX3JQ0",
    authDomain: "registro-ingreso-72ef6.firebaseapp.com",
    projectId: "registro-ingreso-72ef6",
    storageBucket: "registro-ingreso-72ef6.firebasestorage.app",
    messagingSenderId: "326704490544",
    appId: "1:326704490544:web:f553b155b125d5d93125f5",
    measurementId: "G-4R5W55R98W"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

// Referencias globales
const auth = firebase.auth();
const db = firebase.firestore();

// Caché local. 'merge' no es una opción válida de settings() y se
// ignoraba en silencio; solo se configura el tamaño de la caché.
db.settings({
    cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
});

// Persistencia offline: la portería sigue registrando aunque se
// caiga el internet y sincroniza al volver la conexión.
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn('Persistencia: hay varias pestañas abiertas');
    } else if (err.code === 'unimplemented') {
        console.warn('Persistencia no soportada en este navegador');
    }
});
