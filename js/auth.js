// ============================================
// AUTENTICACIÓN Y CONTROL DE ROLES
// ============================================

const loginForm = document.getElementById('loginForm');

if (loginForm) {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            await redirigirPorRol(user);
        }
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const loginBtn = document.getElementById('loginBtn');
        const btnText = loginBtn.querySelector('.btn-text');
        const btnLoader = loginBtn.querySelector('.btn-loader');
        const errorDiv = document.getElementById('loginError');
        const errorText = document.getElementById('errorText');

        btnText.style.display = 'none';
        btnLoader.style.display = 'inline';
        loginBtn.disabled = true;
        errorDiv.style.display = 'none';

        try {
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            await redirigirPorRol(userCredential.user);
        } catch (error) {
            let mensaje = 'Error al iniciar sesión';
            switch (error.code) {
                case 'auth/user-not-found':
                    mensaje = 'No existe una cuenta con este correo'; break;
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    mensaje = 'Contraseña incorrecta'; break;
                case 'auth/too-many-requests':
                    mensaje = 'Demasiados intentos. Espere unos minutos'; break;
                case 'auth/invalid-email':
                    mensaje = 'Formato de correo inválido'; break;
            }
            errorText.textContent = mensaje;
            errorDiv.style.display = 'flex';
        } finally {
            btnText.style.display = 'inline';
            btnLoader.style.display = 'none';
            loginBtn.disabled = false;
        }
    });
}

function togglePassword() {
    const input = document.getElementById('password');
    const icon = document.getElementById('eyeIcon');
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

async function redirigirPorRol(user) {
    try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists) {
            const role = doc.data().role;
            const currentPage = window.location.pathname.split('/').pop();

            if (role === 'admin') {
                if (currentPage !== 'admin.html') window.location.href = 'admin.html';
            } else if (role === 'recepcionista') {
                if (currentPage !== 'recepcion.html') window.location.href = 'recepcion.html';
            } else {
                await Swal.fire({ icon: 'error', title: 'Rol no reconocido', text: 'Contacte al administrador.' });
                auth.signOut();
            }
        } else {
            await Swal.fire({ icon: 'error', title: 'Usuario no configurado', text: 'Contacte al administrador.' });
            auth.signOut();
        }
    } catch (error) {
        console.error('Error verificando rol:', error);
    }
}

function cerrarSesion() {
    Swal.fire({
        title: '¿Cerrar sesión?',
        text: 'Será redirigido al login',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#4F46E5',
        cancelButtonColor: '#6B7280',
        confirmButtonText: 'Sí, salir',
        cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            auth.signOut().then(() => {
                window.location.href = 'index.html';
            });
        }
    });
}

// ============================================
// MODO OSCURO
// ============================================
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const icon = document.getElementById('darkModeIcon');
    if (icon) {
        if (document.body.classList.contains('dark-mode')) {
            icon.classList.replace('fa-moon', 'fa-sun');
            localStorage.setItem('darkMode', 'true');
        } else {
            icon.classList.replace('fa-sun', 'fa-moon');
            localStorage.setItem('darkMode', 'false');
        }
    }
}

// Cargar preferencia
if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
    const icon = document.getElementById('darkModeIcon');
    if (icon) icon.classList.replace('fa-moon', 'fa-sun');
}