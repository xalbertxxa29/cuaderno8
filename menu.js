// menu.js (v53a) — Relevo funcional, cambio de sesión sin redirigir al login, iframes “+” habilitados
document.addEventListener("DOMContentLoaded", () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  const emailFromId = id => `${id}@liderman.com.pe`;
  const sanitizeId = raw => raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');

  let secondaryApp = null;
  const getSecondaryAuth = () => {
    if (!secondaryApp)
      secondaryApp = firebase.apps.find(a => a.name === "secondary") || firebase.initializeApp(firebaseConfig, "secondary");
    return secondaryApp.auth();
  };

  let usuarioSalienteData = null;
  let relevoSignaturePad = null;
  let clientesDataCU = {};
  let switchingSession = false; // 👈 evita redirección al login durante el switch

  // === Auth principal ===
  auth.onAuthStateChanged(async user => {
    // Si estamos cambiando sesión, ignorar el user=null intermedio
    if (!user) {
      if (switchingSession) return;
      window.location.href = "index.html";
      return;
    }
    try {
      const userId = user.email.split("@")[0];
      const doc = await db.collection("USUARIOS").doc(userId).get();
      const nameEl = $("#user-details");
      const unitEl = $("#user-client-unit");
      if (doc.exists) {
        usuarioSalienteData = { ...doc.data(), id: userId };
        nameEl.textContent = `${usuarioSalienteData.NOMBRES} ${usuarioSalienteData.APELLIDOS}`;
        unitEl.textContent = `${usuarioSalienteData.CLIENTE} - ${usuarioSalienteData.UNIDAD} - ${usuarioSalienteData.PUESTO || ''}`;
      } else {
        nameEl.textContent = user.email;
      }
    } catch (err) { console.error("Error al obtener usuario:", err); }
  });

  // === Selectores ===
  const logoutBtn = $("#logout-btn"),
    ingresarBtn = $("#ingresar-info-btn"),
    ingresarModal = $("#ingresar-info-modal-overlay"),
    ingresarCancel = $("#ingresar-info-cancel-btn"),
    verBtn = $("#ver-info-btn"),
    verModal = $("#ver-info-modal-overlay"),
    verCancel = $("#ver-info-cancel-btn"),
    relevoBtn = $("#relevo-btn"),
    relevoModal = $("#relevo-modal-overlay"),
    relevoForm = $("#relevo-form"),
    relevoCanvas = $("#relevo-firma-canvas"),
    relevoClear = $("#relevo-clear-firma"),
    relevoCancel = $("#relevo-cancel-btn"),
    relevoCrearUser = $("#relevo-crear-usuario-btn"),
    crearUserModal = $("#crear-usuario-modal"),
    crearUserForm = $("#crear-usuario-form"),
    crearUserCancel = $("#cu-cancel"),
    iframeModal = $("#iframe-modal"),
    iframe = $("#add-item-iframe"),
    iframeTitle = $("#iframe-title"),
    iframeClose = $("#close-iframe-modal-btn");

  const cuClienteInput = $("#cu-cliente-input"),
    cuClienteList = $("#cu-cliente-list"),
    cuUnidadInput = $("#cu-unidad-input"),
    cuUnidadList = $("#cu-unidad-list"),
    cuPuestoInput = $("#cu-puesto-input"),
    cuPuestoList = $("#cu-puesto-list"),
    cuAddCliente = $("#cu-add-cliente-btn"),
    cuAddUnidad = $("#cu-add-unidad-btn"),
    cuAddPuesto = $("#cu-add-puesto-btn");

  // === Utils ===
  const openModal  = m => (m.style.display = "flex");
  const closeModal = m => (m.style.display = "none");
  function $(s) { return document.querySelector(s); }

  // === Logout ===
  logoutBtn.addEventListener("click", e => {
    e.preventDefault();
    auth.signOut().then(() => (window.location.href = "index.html"));
  });

  // === Ingresar / Ver ===
  ingresarBtn.addEventListener("click", e => { e.preventDefault(); openModal(ingresarModal); });
  ingresarCancel.addEventListener("click", () => closeModal(ingresarModal));
  ingresarModal.addEventListener("click", e => { if (e.target === ingresarModal) closeModal(ingresarModal); });

  verBtn.addEventListener("click", e => { e.preventDefault(); openModal(verModal); });
  verCancel.addEventListener("click", () => closeModal(verModal));
  verModal.addEventListener("click", e => { if (e.target === verModal) closeModal(verModal); });

  // === Firma Relevo ===
  const resizeRelevoCanvas = () => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = relevoCanvas.getBoundingClientRect();
    relevoCanvas.width = rect.width * ratio;
    relevoCanvas.height = rect.height * ratio;
    const ctx = relevoCanvas.getContext("2d");
    ctx.scale(ratio, ratio);
    if (relevoSignaturePad) relevoSignaturePad.clear();
  };

  relevoBtn.addEventListener("click", e => {
    e.preventDefault();
    openModal(relevoModal);
    if (!relevoSignaturePad)
      relevoSignaturePad = new SignaturePad(relevoCanvas, { backgroundColor: "white" });
    resizeRelevoCanvas();
  });
  window.addEventListener("resize", resizeRelevoCanvas);
  relevoClear.addEventListener("click", () => relevoSignaturePad?.clear());
  relevoCancel.addEventListener("click", () => { relevoForm.reset(); relevoSignaturePad?.clear(); closeModal(relevoModal); });

  // === Guardar Relevo ===
  relevoForm.addEventListener("submit", async e => {
    e.preventDefault();
    const id   = sanitizeId($("#relevo-id").value);
    const pass = $("#relevo-password").value;
    const comentario = $("#relevo-comentario").value;

    if (!id || !pass || !comentario || relevoSignaturePad.isEmpty()) {
      UI.alert("Campos incompletos", "Completa todos los campos y firma."); return;
    }

    UI.showOverlay("Procesando relevo…");
    try {
      const doc = await db.collection("USUARIOS").doc(id).get();
      if (!doc.exists) throw new Error("El ID del usuario entrante no existe.");
      const u = doc.data();
      if (u.CLIENTE !== usuarioSalienteData.CLIENTE || u.UNIDAD !== usuarioSalienteData.UNIDAD)
        throw new Error("El usuario entrante no pertenece al mismo cliente/unidad.");
      if (u.ESTADO !== "ACTIVO") throw new Error("El usuario entrante no está activo.");

      await db.collection("CUADERNO").add({
        tipoRegistro: "RELEVO",
        cliente: usuarioSalienteData.CLIENTE,
        unidad:  usuarioSalienteData.UNIDAD,
        comentario,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        usuarioSaliente: { id: usuarioSalienteData.id },
        usuarioEntrante: { id }
      });

      // Validar credenciales del entrante con auth secundaria (no rompe la sesión actual)
      const sec = getSecondaryAuth();
      await sec.signInWithEmailAndPassword(emailFromId(id), pass);
      await sec.signOut();

      // 🔁 Cambiar sesión principal SIN hacer signOut manual para evitar user=null
      switchingSession = true;
      await auth.signInWithEmailAndPassword(emailFromId(id), pass);

      // Esperar a que onAuthStateChanged tenga al nuevo usuario
      await new Promise((resolve) => {
        const unsub = auth.onAuthStateChanged(u2 => {
          if (u2 && u2.email === emailFromId(id)) { unsub(); resolve(); }
        });
      });
      switchingSession = false;

      UI.hideOverlay();
      UI.alert("Éxito", "Relevo completado correctamente.", () => location.reload());
    } catch (err) {
      console.error(err);
      switchingSession = false;
      UI.hideOverlay();
      const msg = err.code?.includes("auth/") ? "Credenciales incorrectas." : err.message;
      UI.alert("Error en Relevo", msg);
    }
  });

  // === Cargar catálogos ===
  async function cargarDatosCU(cliPre, uniPre) {
    UI.showOverlay("Cargando catálogos...");
    try {
      const snap = await db.collection("CLIENTE_UNIDAD").get();
      clientesDataCU = {};
      snap.forEach(doc => (clientesDataCU[doc.id] = doc.data().unidades || {}));

      const clientes = Object.keys(clientesDataCU).sort();
      UI.createSearchableDropdown(cuClienteInput, cuClienteList, clientes, cli => {
        cuUnidadInput.disabled = false;
        const unidades = Object.keys(clientesDataCU[cli] || {}).sort();
        UI.createSearchableDropdown(cuUnidadInput, cuUnidadList, unidades, uni => {
          cuPuestoInput.disabled = false;
          const puestos = (clientesDataCU[cli]?.[uni] || []).sort();
          UI.createSearchableDropdown(cuPuestoInput, cuPuestoList, puestos);
        });
      });

      if (cliPre) {
        cuClienteInput.value = cliPre;
        cuUnidadInput.disabled = false;
        const unidades = Object.keys(clientesDataCU[cliPre] || {}).sort();
        UI.createSearchableDropdown(cuUnidadInput, cuUnidadList, unidades);
        if (uniPre) cuUnidadInput.value = uniPre;
      }
    } catch (e) {
      console.error(e);
      UI.alert("Error", "No se pudieron cargar los catálogos.");
    } finally {
      UI.hideOverlay();
    }
  }

  // === Iframe de altas rápidas (+) ===
  const openIframeModal = (url, title) => {
    iframe.src = url;
    iframeTitle.textContent = title;
    iframeModal.style.display = "flex";
  };
  const closeIframeModal = () => {
    iframeModal.style.display = "none";
    iframe.src = "about:blank";
  };
  iframeClose.addEventListener("click", closeIframeModal);
  iframeModal.addEventListener("click", e => { if (e.target === iframeModal) closeIframeModal(); });

  // Botones "+"
  $("#cu-add-cliente-btn").addEventListener("click", () => openIframeModal("add_cliente_unidad.html", "Añadir Cliente, Unidad y Puesto"));
  $("#cu-add-unidad-btn").addEventListener("click", () => {
    const cliente = cuClienteInput.value.trim();
    if (!cliente) return UI.alert("Aviso", "Seleccione un cliente primero.");
    openIframeModal(`add_unidad.html?cliente=${encodeURIComponent(cliente)}`, "Añadir Unidad");
  });
  $("#cu-add-puesto-btn").addEventListener("click", () => {
    const cliente = cuClienteInput.value.trim();
    const unidad  = cuUnidadInput.value.trim();
    if (!cliente || !unidad) return UI.alert("Aviso", "Seleccione cliente y unidad primero.");
    openIframeModal(`add_puesto.html?cliente=${encodeURIComponent(cliente)}&unidad=${encodeURIComponent(unidad)}`, "Añadir Puesto");
  });

  // Recibir mensajes desde iframes y refrescar listas
  window.addEventListener("message", event => {
    const data = event.data;
    if (!data) return;
    if (data === "clienteAgregado") cargarDatosCU();
    if (data.type === "unidadAgregada") cargarDatosCU(data.cliente);
    if (data.type === "puestoAgregado") cargarDatosCU(data.cliente, data.unidad);
  });

  // === Crear usuario rápido (desde Relevo) ===
  relevoCrearUser.addEventListener("click", () => { openModal(crearUserModal); cargarDatosCU(); });
  crearUserCancel.addEventListener("click", () => { crearUserForm.reset(); cuUnidadInput.disabled = true; cuPuestoInput.disabled = true; closeModal(crearUserModal); });

  crearUserForm.addEventListener("submit", async e => {
    e.preventDefault();
    const id   = sanitizeId($("#cu-id").value),
          nom  = $("#cu-nombres").value.trim(),
          ape  = $("#cu-apellidos").value.trim(),
          cli  = cuClienteInput.value.trim(),
          uni  = cuUnidadInput.value.trim(),
          pue  = cuPuestoInput.value.trim(),
          pass1 = $("#cu-pass").value,
          pass2 = $("#cu-pass2").value;

    if (!id || !nom || !ape || !cli || !uni || !pue || !pass1 || !pass2) return UI.alert("Aviso","Complete todos los campos.");
    if (pass1 !== pass2) return UI.alert("Aviso","Las contraseñas no coinciden.");
    if (pass1.length < 6) return UI.alert("Aviso","La contraseña debe tener al menos 6 caracteres.");

    UI.showOverlay("Creando usuario…");
    try {
      const sec = getSecondaryAuth();
      await sec.createUserWithEmailAndPassword(emailFromId(id), pass1);
      await db.collection("USUARIOS").doc(id).set({
        NOMBRES: nom.toUpperCase(),
        APELLIDOS: ape.toUpperCase(),
        CLIENTE: cli.toUpperCase(),
        UNIDAD: uni.toUpperCase(),
        PUESTO: pue.toUpperCase(),
        TIPO: "AGENTE",
        ESTADO: "ACTIVO",
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });
      await sec.signOut();

      $("#relevo-id").value = id;
      UI.hideOverlay();
      UI.alert("Usuario creado", "Ahora ingresa su contraseña para continuar el relevo.", () => closeModal(crearUserModal));
    } catch (err) {
      console.error(err);
      UI.hideOverlay();
      const msg = err.code === "auth/email-already-in-use" ? "Ese ID ya está registrado."
                : err.code === "auth/weak-password" ? "Contraseña débil (mínimo 6 caracteres)."
                : err.message;
      UI.alert("Error", msg);
    }
  });
});
