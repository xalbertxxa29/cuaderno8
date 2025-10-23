// auth.js v56 — Login + Registro + Catálogos (Cliente/Unidad/Puesto) con compatibilidad de esquemas
(() => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});

  const UX = {
    show : (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide : ()   => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert(`${t||''}\n\n${m||''}`), cb && cb()),
  };
  const $ = (id) => document.getElementById(id);

  /* ===================== TABS ===================== */
  const tabLogin    = $('tab-login');
  const tabRegister = $('tab-register');
  const loginTab    = $('login-tab');
  const registerTab = $('register-tab');

  function showTab(which){
    if (!loginTab || !registerTab || !tabLogin || !tabRegister) return;
    const showLogin = (which === 'login');
    tabLogin.classList.toggle('active', showLogin);
    tabRegister.classList.toggle('active', !showLogin);
    loginTab.style.display    = showLogin ? 'block' : 'none';
    registerTab.style.display = showLogin ? 'none'  : 'block';
  }

  tabLogin?.addEventListener('click',   () => showTab('login'));
  tabRegister?.addEventListener('click',() => showTab('register'));

  /* ============ SELECTS de Registro ============ */
  const selCliente = $('reg-cliente');
  const selUnidad  = $('reg-unidad');
  const selPuesto  = $('reg-puesto');

  // ========= Carga CLIENTES =========
  async function loadClientes() {
    if (!selCliente || !selUnidad || !selPuesto) return;
    selCliente.innerHTML = '<option value="" disabled selected>Cargando…</option>';
    selUnidad.innerHTML  = '<option value="" disabled selected>Selecciona un cliente…</option>';
    selUnidad.disabled   = true;
    selPuesto.innerHTML  = '<option value="" disabled selected>Selecciona una unidad…</option>';
    selPuesto.disabled   = true;

    try {
      const snap = await db.collection('CLIENTE_UNIDAD')
        .orderBy(firebase.firestore.FieldPath.documentId())
        .get();

      if (snap.empty) {
        selCliente.innerHTML = '<option value="" disabled>No hay clientes</option>';
        return;
      }

      selCliente.innerHTML = '<option value="" disabled selected>Selecciona…</option>';
      snap.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = doc.id;
        selCliente.appendChild(opt);
      });
      console.log('[auth] Clientes cargados:', selCliente.options.length - 1);
    } catch (e) {
      console.error('[auth] loadClientes', e);
      selCliente.innerHTML = '<option value="" disabled>Error al cargar</option>';
      UX.alert('Error', 'No se pudieron cargar los clientes.');
    }
  }

  // ========= Carga UNIDADES (multi-esquema) =========
  async function loadUnidades(cliente) {
    if (!selUnidad || !selPuesto) return;
    selUnidad.innerHTML = '<option value="" disabled selected>Cargando…</option>';
    selUnidad.disabled  = true;
    selPuesto.innerHTML = '<option value="" disabled selected>Selecciona una unidad…</option>';
    selPuesto.disabled  = true;

    try {
      const base = db.collection('CLIENTE_UNIDAD').doc(cliente);

      // (A) Subcolección UNIDADES
      const subSnap = await base.collection('UNIDADES').get();
      let unidades = [];
      if (!subSnap.empty) {
        subSnap.forEach(d => unidades.push(d.id));
        console.log('[auth] UNIDADES desde subcolección:', unidades);
      } else {
        // (B) Campo "unidades" en el doc del cliente (objeto o array)
        const cliDoc = await base.get();
        const data = cliDoc.data() || {};
        if (Array.isArray(data.unidades)) {
          unidades = data.unidades.slice();
          console.log('[auth] UNIDADES desde array en doc cliente:', unidades);
        } else if (data.unidades && typeof data.unidades === 'object') {
          unidades = Object.keys(data.unidades);
          console.log('[auth] UNIDADES desde objeto en doc cliente:', unidades);
        } else {
          console.log('[auth] No se encontraron UNIDADES en ningún esquema.');
        }
      }

      if (!unidades.length) {
        selUnidad.innerHTML = '<option value="" disabled>No hay unidades</option>';
        return;
      }

      unidades.sort();
      selUnidad.innerHTML = '<option value="" disabled selected>Selecciona…</option>';
      for (const u of unidades) {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        selUnidad.appendChild(opt);
      }
      selUnidad.disabled = false;
    } catch (e) {
      console.error('[auth] loadUnidades', e);
      selUnidad.innerHTML = '<option value="" disabled>Error</option>';
      UX.alert('Error', 'No se pudieron cargar las unidades.');
    }
  }

  // ========= Carga PUESTOS (multi-esquema) =========
  async function loadPuestos(cliente, unidad) {
    if (!selPuesto) return;
    selPuesto.innerHTML = '<option value="" disabled selected>Cargando…</option>';
    selPuesto.disabled  = true;

    try {
      const baseCliente = db.collection('CLIENTE_UNIDAD').doc(cliente);
      const baseUnidad  = baseCliente.collection('UNIDADES').doc(unidad);

      let puestos = [];

      // (1) Subcolección PUESTOS
      const sub = await baseUnidad.collection('PUESTOS').get();
      if (!sub.empty) {
        sub.forEach(d => puestos.push(d.id));
        console.log('[auth] PUESTOS desde subcolección:', puestos);
      }

      // (2) Campo array "puestos" en doc de la unidad
      const uDoc = await baseUnidad.get();
      const uData = uDoc.data() || {};
      if (Array.isArray(uData.puestos)) {
        uData.puestos.forEach(p => { if (!puestos.includes(p)) puestos.push(p); });
        console.log('[auth] PUESTOS desde campo array en unidad:', uData.puestos);
      }

      // (3) Campo anidado en doc del cliente: unidades[unidad] (array)
      const cDoc = await baseCliente.get();
      const cData = cDoc.data() || {};
      if (cData.unidades && typeof cData.unidades === 'object' && Array.isArray(cData.unidades[unidad])) {
        cData.unidades[unidad].forEach(p => { if (!puestos.includes(p)) puestos.push(p); });
        console.log('[auth] PUESTOS desde doc cliente.unidades["'+unidad+'"]:', cData.unidades[unidad]);
      }

      if (!puestos.length) {
        selPuesto.innerHTML = '<option value="" disabled>No hay puestos</option>';
        return;
      }

      puestos.sort();
      selPuesto.innerHTML = '<option value="" disabled selected>Selecciona…</option>';
      for (const p of puestos) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        selPuesto.appendChild(opt);
      }
      selPuesto.disabled = false;
    } catch (e) {
      console.error('[auth] loadPuestos', e);
      selPuesto.innerHTML = '<option value="" disabled>Error</option>';
      UX.alert('Error', 'No se pudieron cargar los puestos.');
    }
  }

  selCliente?.addEventListener('change', (e) => loadUnidades(e.target.value));
  selUnidad?.addEventListener('change', (e) => loadPuestos(selCliente.value, e.target.value));

  /* ============ Modales “+” ============ */
  const open  = (el) => el && (el.style.display = 'flex');
  const close = (el) => el && (el.style.display = 'none');

  // Cliente
  const modalAddCliente = $('modal-add-cliente');
  $('add-cliente-btn')?.addEventListener('click', () => {
    $('nuevo-cliente').value = '';
    open(modalAddCliente);
  });
  $('cancel-add-cliente')?.addEventListener('click', () => close(modalAddCliente));
  $('save-add-cliente')?.addEventListener('click', async () => {
    const cli = String($('nuevo-cliente').value || '').trim().toUpperCase();
    if (!cli) return UX.alert('Aviso','Escribe el nombre del cliente.');
    try {
      UX.show('Guardando cliente…');
      await db.collection('CLIENTE_UNIDAD').doc(cli)
        .set({ creadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      close(modalAddCliente);
      await loadClientes();
      selCliente.value = cli;
      selCliente.dispatchEvent(new Event('change'));
    } catch (e) {
      console.error(e); UX.alert('Error','No se pudo crear el cliente.');
    } finally { UX.hide(); }
  });

  // Unidad
  const modalAddUnidad = $('modal-add-unidad');
  $('add-unidad-btn')?.addEventListener('click', () => {
    const cli = selCliente.value;
    if (!cli) return UX.alert('Aviso','Selecciona primero un cliente.');
    $('nueva-unidad').value = '';
    $('ctx-unidad').textContent = `Cliente: ${cli}`;
    open(modalAddUnidad);
  });
  $('cancel-add-unidad')?.addEventListener('click', () => close(modalAddUnidad));
  $('save-add-unidad')?.addEventListener('click', async () => {
    const cli = selCliente.value;
    const uni = String($('nueva-unidad').value || '').trim().toUpperCase();
    if (!cli) return UX.alert('Aviso','Selecciona un cliente.');
    if (!uni) return UX.alert('Aviso','Escribe la unidad.');
    try {
      UX.show('Guardando unidad…');
      // Doc de la unidad + compat
      const base = db.collection('CLIENTE_UNIDAD').doc(cli);
      await base.collection('UNIDADES').doc(uni)
        .set({ puestos: [], actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await base.set({
        unidades: firebase.firestore.FieldValue.arrayUnion(uni)
      }, { merge: true });

      close(modalAddUnidad);
      await loadUnidades(cli);
      selUnidad.value = uni;
      selUnidad.dispatchEvent(new Event('change'));
    } catch (e) {
      console.error(e); UX.alert('Error','No se pudo crear la unidad.');
    } finally { UX.hide(); }
  });

  // Puesto
  const modalAddPuesto = $('modal-add-puesto');
  $('add-puesto-btn')?.addEventListener('click', () => {
    const cli = selCliente.value, uni = selUnidad.value;
    if (!cli) return UX.alert('Aviso','Selecciona un cliente.');
    if (!uni) return UX.alert('Aviso','Selecciona una unidad.');
    $('nuevo-puesto').value = '';
    $('ctx-puesto').textContent = `Cliente: ${cli} • Unidad: ${uni}`;
    open(modalAddPuesto);
  });
  $('cancel-add-puesto')?.addEventListener('click', () => close(modalAddPuesto));
  $('save-add-puesto')?.addEventListener('click', async () => {
    const cli = selCliente.value, uni = selUnidad.value;
    const pto = String($('nuevo-puesto').value || '').trim().toUpperCase();
    if (!pto) return UX.alert('Aviso','Escribe el puesto.');
    try {
      UX.show('Guardando puesto…');
      const base = db.collection('CLIENTE_UNIDAD').doc(cli).collection('UNIDADES').doc(uni);
      // Subcolección
      await base.collection('PUESTOS').doc(pto)
        .set({ creadoEn: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      // Campo array en la unidad
      await base.set({ puestos: firebase.firestore.FieldValue.arrayUnion(pto) }, { merge: true });
      // Campo anidado en doc cliente (objeto unidades[unidad] = array)
      await db.collection('CLIENTE_UNIDAD').doc(cli).set({
        unidades: { [uni]: firebase.firestore.FieldValue.arrayUnion(pto) }
      }, { merge: true });

      close(modalAddPuesto);
      await loadPuestos(cli, uni);
      selPuesto.value = pto;
    } catch (e) {
      console.error(e); UX.alert('Error','No se pudo crear el puesto.');
    } finally { UX.hide(); }
  });

  /* ============ Login ============ */
  $('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = String(($('login-email')?.value||'')).trim();
    const pass = String(($('login-pass')?.value||''));
    if (!user || !pass) return UX.alert('Aviso','Completa usuario y contraseña.');
    const email = user.includes('@') ? user : `${user}@lidercontrol.local`;
    try {
      UX.show('Ingresando…');
      await auth.signInWithEmailAndPassword(email, pass);
      UX.hide(); location.href = 'menu.html';
    } catch (err) {
      console.error(err); UX.hide();
      const msg =
        err?.code === 'auth/user-not-found'  ? 'Usuario no encontrado.' :
        err?.code === 'auth/wrong-password'  ? 'Contraseña incorrecta.' :
        err?.code === 'auth/invalid-email'   ? 'Usuario inválido.' :
        'No fue posible iniciar sesión.';
      UX.alert('Login', msg);
    }
  });

  /* ============ Registro ============ */
  $('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id   = String(($('reg-id')?.value||'')).trim();
    const nom  = String(($('reg-nombres')?.value||'')).trim();
    const ape  = String(($('reg-apellidos')?.value||'')).trim();
    const cli  = String(selCliente?.value||'').trim();
    const uni  = String(selUnidad?.value||'').trim();
    const pue  = String(selPuesto?.value||'').trim();
    const tipo = String(($('reg-tipo')?.value||'AGENTE')).trim().toUpperCase();
    const p1   = String(($('reg-pass1')?.value||'')); 
    const p2   = String(($('reg-pass2')?.value||''));

    if (!id || !nom || !ape || !cli || !uni || !pue || !p1 || !p2) return UX.alert('Aviso','Completa todos los campos.');
    if (p1 !== p2)  return UX.alert('Aviso','Las contraseñas no coinciden.');
    if (p1.length < 6) return UX.alert('Aviso','La contraseña debe tener al menos 6 caracteres.');

    try {
      UX.show('Creando cuenta…');
      const email = id.includes('@') ? id : `${id}@lidercontrol.local`;

      await auth.createUserWithEmailAndPassword(email, p1);
      await db.collection('USUARIOS').doc(id.includes('@') ? id.split('@')[0] : id).set({
        ID: id.includes('@') ? id.split('@')[0] : id,
        NOMBRES: nom.toUpperCase(),
        APELLIDOS: ape.toUpperCase(),
        CLIENTE: cli.toUpperCase(),
        UNIDAD: uni.toUpperCase(),
        PUESTO: pue.toUpperCase(),
        TIPO: tipo || 'AGENTE',
        ESTADO: 'ACTIVO',
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      UX.hide();
      UX.alert('Éxito','Cuenta creada correctamente.', () => location.href='menu.html');
    } catch (err) {
      console.error(err); UX.hide();
      const msg =
        err?.code === 'auth/email-already-in-use' ? 'Ese ID ya existe.' :
        err?.code === 'auth/weak-password'       ? 'Contraseña muy débil.' :
        err?.message || 'No se pudo completar el registro.';
      UX.alert('Registro', msg);
    }
  });

  /* ============ Inicio ============ */
  loadClientes().catch(console.error);

  // Por defecto, mostrar "Iniciar Sesión".
  // Solo ir a "Registrarse" si la URL trae #register
  if (location.hash === '#register') {
    showTab('register');
  } else {
    showTab('login');
  }
})();
