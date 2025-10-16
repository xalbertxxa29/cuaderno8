// auth.js (v51) — Login + Registro + Catálogos cliente/unidad/puesto
// Requiere: firebase-config.js, initFirebase.js (con enablePersistence), ui.js (opcional)

(function(){
  // ---------- Firebase ----------
  if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
  const auth = firebase.auth();
  const db   = firebase.firestore();

  // Justo después de: const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.warn);

// Opcional (robusto en WebView): reintenta si el WebView tarda en tener storage listo
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !auth.currentUser) {
    // No fuerces logout aquí; Firebase recupera la sesión automáticamente
  }
});

// Importante: No hagas signOut en ningún onAuthStateChanged, only en el botón “Cerrar sesión”.


  // ---------- Helpers UI seguros ----------
  const UX = {
    show: (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert((t? t+'\n\n':'') + (m||'')), cb && cb()),
  };

  // ---------- Helpers de datos ----------
  const sanitizeId = (raw) => String(raw||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const emailFromId = (id) => `${id}@liderman.com.pe`;
  const toUpper = (s) => String(s||'').trim().toUpperCase();

  let secondaryApp = null;
  const getSecondaryAuth = () => {
    if (!secondaryApp) {
      secondaryApp = firebase.apps.find(a => a.name === 'secondary') || firebase.initializeApp(firebaseConfig, 'secondary');
    }
    return secondaryApp.auth();
  };

  // ---------- DOM ----------
  const loginForm   = document.getElementById('login-form');
  const loginId     = document.getElementById('login-id');
  const loginPass   = document.getElementById('login-password');
  const loginBtn    = document.getElementById('login-btn');

  const regForm     = document.getElementById('register-form');
  const regId       = document.getElementById('register-id');
  const regNom      = document.getElementById('register-nombres');
  const regApe      = document.getElementById('register-apellidos');
  const regCliInput = document.getElementById('register-cliente-input');
  const regCliList  = document.getElementById('register-cliente-list');
  const regUniInput = document.getElementById('register-unidad-input');
  const regUniList  = document.getElementById('register-unidad-list');
  const regPueInput = document.getElementById('register-puesto-input');
  const regPueList  = document.getElementById('register-puesto-list');
  const regTipo     = document.getElementById('register-tipo');
  const regPass     = document.getElementById('register-password');
  const regPass2    = document.getElementById('register-password-confirm');
  const regBtn      = document.getElementById('register-btn');

  // ---------- Dropdowns buscables (fallback simple) ----------
  // Si UI.createSearchableDropdown existe, lo usamos. Si no, implementamos uno básico.
  function createSearchableDropdown(inputEl, listEl, items, onSelect) {
    if (window.UI && typeof UI.createSearchableDropdown === 'function') {
      UI.createSearchableDropdown(inputEl, listEl, items, onSelect);
      return;
    }
    // Fallback simple
    let data = Array.isArray(items) ? items.slice() : [];
    inputEl.setAttribute('autocomplete', 'off');
    inputEl.addEventListener('input', () => renderList(inputEl.value));
    inputEl.addEventListener('focus', () => renderList(inputEl.value));
    document.addEventListener('click', (e) => { if (!listEl.contains(e.target) && e.target !== inputEl) listEl.style.display = 'none'; });

    function renderList(q) {
      const query = String(q||'').toLowerCase();
      const filtered = data.filter(x => String(x).toLowerCase().includes(query)).slice(0, 50);
      if (!filtered.length) { listEl.innerHTML = ''; listEl.style.display = 'none'; return; }
      listEl.innerHTML = filtered.map(x => `<div class="dropdown-item" data-v="${escapeHtml(x)}">${escapeHtml(x)}</div>`).join('');
      listEl.style.display = 'block';
      listEl.querySelectorAll('.dropdown-item').forEach(it => {
        it.addEventListener('click', () => {
          const val = it.getAttribute('data-v');
          inputEl.value = val;
          listEl.style.display = 'none';
          onSelect && onSelect(val);
        });
      });
    }

    createSearchableDropdown.update = (newItems) => { data = Array.isArray(newItems) ? newItems.slice() : []; renderList(inputEl.value); };
    return createSearchableDropdown;
  }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

  // ---------- Carga de CLIENTE_UNIDAD ----------
  let CU = {}; // { CLIENTE: { UNIDAD: [PUESTOS...] } }
  let cliDropdown, uniDropdown, pueDropdown;

  async function loadClienteUnidad() {
    UX.show('Cargando catálogos…');
    try {
      CU = {};
      const snap = await db.collection('CLIENTE_UNIDAD').get();
      snap.forEach(doc => {
        const cliente = doc.id;
        const data = doc.data() || {};
        const unidades = data.unidades || {};
        CU[cliente] = unidades;
      });

      const clientes = Object.keys(CU).sort();
      // Cliente dropdown
      cliDropdown = createSearchableDropdown(regCliInput, regCliList, clientes, (cli) => {
        regUniInput.disabled = false; regUniInput.value = ''; regPueInput.value = ''; regPueInput.disabled = true;
        const unidades = CU[cli] ? Object.keys(CU[cli]).sort() : [];
        if (uniDropdown && uniDropdown.update) { uniDropdown.update(unidades); }
        else { uniDropdown = createSearchableDropdown(regUniInput, regUniList, unidades, (uni) => onUnidadSelect(cli, uni)); }
        // limpiar puestos
        if (pueDropdown && pueDropdown.update) pueDropdown.update([]);
      });

      // Si ya tenía algo escrito (por hash o autofill), intenta habilitar cadena
      if (regCliInput.value && CU[regCliInput.value]) {
        regUniInput.disabled = false;
        const unidades = Object.keys(CU[regCliInput.value]).sort();
        uniDropdown = createSearchableDropdown(regUniInput, regUniList, unidades, (uni) => onUnidadSelect(regCliInput.value, uni));
      }
    } catch (e) {
      console.error(e);
      UX.alert('Error', 'No se pudieron cargar los catálogos de cliente/unidad.');
    } finally {
      UX.hide();
    }
  }

  function onUnidadSelect(cli, uni) {
    regPueInput.disabled = false;
    const puestos = (CU[cli] && CU[cli][uni]) ? CU[cli][uni].slice().sort() : [];
    if (pueDropdown && pueDropdown.update) { pueDropdown.update(puestos); }
    else { pueDropdown = createSearchableDropdown(regPueInput, regPueList, puestos); }
  }

  // ---------- Login ----------
  async function handleLogin(e) {
    e.preventDefault();
    const id = sanitizeId(loginId.value);
    const pass = String(loginPass.value||'');
    if (!id || !pass) { UX.alert('Aviso', 'Completa tu usuario y contraseña.'); return; }

    loginBtn.disabled = true;
    UX.show('Ingresando…');
    try {
      await auth.signInWithEmailAndPassword(emailFromId(id), pass);
      location.href = 'menu.html';
    } catch (err) {
      console.error(err);
      const msg = (err?.code === 'auth/user-not-found') ? 'Usuario no encontrado.'
                : (err?.code === 'auth/wrong-password') ? 'Contraseña incorrecta.'
                : (err?.code === 'auth/invalid-email') ? 'Usuario inválido.'
                : 'No fue posible iniciar sesión.';
      UX.alert('No se pudo iniciar sesión', msg);
    } finally {
      UX.hide();
      loginBtn.disabled = false;
    }
  }

  // ---------- Registro ----------
  async function handleRegister(e) {
    e.preventDefault();

    const id   = sanitizeId(regId.value);
    const nom  = String(regNom.value||'').trim();
    const ape  = String(regApe.value||'').trim();
    const cli  = String(regCliInput.value||'').trim();
    const uni  = String(regUniInput.value||'').trim();
    const pue  = String(regPueInput.value||'').trim();
    const tipo = String(regTipo.value||'AGENTE').trim().toUpperCase();
    const p1   = String(regPass.value||'');
    const p2   = String(regPass2.value||'');

    if (!id || !nom || !ape || !cli || !uni || !pue || !p1 || !p2) {
      UX.alert('Aviso', 'Completa todos los campos del registro.'); return;
    }
    if (p1 !== p2) { UX.alert('Aviso','Las contraseñas no coinciden.'); return; }
    if (p1.length < 6) { UX.alert('Aviso','La contraseña debe tener al menos 6 caracteres.'); return; }

    regBtn.disabled = true;
    UX.show('Creando cuenta…');

    try {
      // Validaciones básicas contra catálogos
      if (!CU[cli]) throw new Error('El cliente seleccionado no existe.');
      if (!CU[cli][uni]) throw new Error('La unidad seleccionada no existe para este cliente.');
      if (!CU[cli][uni].includes(pue)) throw new Error('El puesto seleccionado no existe en esa unidad.');

      // Crear usuario en app secundaria (no cierra sesión actual si hubiera)
      const secAuth = getSecondaryAuth();
      await secAuth.createUserWithEmailAndPassword(emailFromId(id), p1);

      // Crear/merge perfil
      await db.collection('USUARIOS').doc(id).set({
        NOMBRES: toUpper(nom),
        APELLIDOS: toUpper(ape),
        CLIENTE: toUpper(cli),
        UNIDAD: toUpper(uni),
        PUESTO: toUpper(pue),
        TIPO: tipo || 'AGENTE',
        ESTADO: 'ACTIVO', // para que pueda iniciar sesión de inmediato
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Cerrar sesión secundaria
      await secAuth.signOut();

      // Iniciar sesión y redirigir
      await auth.signInWithEmailAndPassword(emailFromId(id), p1);
      UX.hide();
      UX.alert('¡Bienvenido!', 'Tu cuenta fue creada con éxito.', () => location.href='menu.html');
    } catch (err) {
      console.error(err);
      UX.hide();
      const msg =
        (err?.code === 'auth/email-already-in-use') ? 'Ese ID ya existe. Intenta con otro.'
      : (err?.code === 'auth/weak-password') ? 'La contraseña es muy débil (mínimo 6).'
      : err.message || 'No se pudo completar el registro.';
      UX.alert('Registro', msg);
    } finally {
      regBtn.disabled = false;
    }
  }

  // ---------- Mensajes desde iframes (alta rápida) ----------
  window.addEventListener('message', (event) => {
    // Opcionalmente, filtra por origin si alojas en https con dominio fijo.
    const data = event.data;
    if (data === 'clienteAgregado' || data?.type === 'unidadAgregada' || data?.type === 'puestoAgregado') {
      // Re-cargar catálogos para que aparezca lo nuevo
      loadClienteUnidad();
      // Si vino con cliente/unidad preseleccionados, respétalos
      if (data?.cliente) {
        regCliInput.value = data.cliente;
        regUniInput.disabled = false;
        const unidades = CU[data.cliente] ? Object.keys(CU[data.cliente]).sort() : [];
        uniDropdown && uniDropdown.update ? uniDropdown.update(unidades)
          : (uniDropdown = createSearchableDropdown(regUniInput, regUniList, unidades, (uni) => onUnidadSelect(data.cliente, uni)));
      }
      if (data?.unidad && data?.cliente) {
        regUniInput.value = data.unidad;
        onUnidadSelect(data.cliente, data.unidad);
      }
    }
  });

  // ---------- Bindings ----------
  loginForm?.addEventListener('submit', handleLogin);
  regForm?.addEventListener('submit', handleRegister);

  // Carga inicial de catálogos
  loadClienteUnidad();

  // Si viene #register en la URL, espera un tick para que tabs.js cambie la vista
  if (location.hash === '#register') {
    setTimeout(() => regCliInput?.focus(), 150);
  }
})();
