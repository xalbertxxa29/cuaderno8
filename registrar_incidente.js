// registrar_incidente.js (v51) — Incidencia con reintento offline (cola) + sesión persistente
document.addEventListener('DOMContentLoaded', () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();

  // Sesión persistente (no se cierra sola)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});

  const UX = {
    show: (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide: () => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert(`${t}\n\n${m||''}`), cb && cb())
  };

  const form = document.getElementById('incidente-form');
  const tipoIncidenteSelect = document.getElementById('tipo-incidente');
  const detalleIncidenteSelect = document.getElementById('detalle-incidente');
  const comentarioEl = document.getElementById('comentario');
  const fotoInput = document.getElementById('foto-input');
  const fotoPreview = document.getElementById('foto-preview');
  const canvas = document.getElementById('firma-canvas');
  const clearBtn = document.getElementById('clear-firma');

  // “+” modales
  const iframeModal = document.getElementById('iframe-modal');
  const iframeTitle = document.getElementById('iframe-title');
  const iframe = document.getElementById('add-item-iframe');
  const closeIframeBtn = document.getElementById('close-iframe-modal-btn');
  const addTipoBtn = document.getElementById('add-tipo-btn');
  const addDetalleBtn = document.getElementById('add-detalle-btn');

  const sigPad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)' });

  function resizeCanvas() {
    const r = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * r;
    canvas.height = canvas.offsetHeight * r;
    canvas.getContext('2d').scale(r, r);
    sigPad.clear();
  }
  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 80);
  clearBtn?.addEventListener('click', () => sigPad.clear());

  // Imagen
  let pendingPhoto = null;
  fotoInput?.addEventListener('change', async () => {
    const f = fotoInput.files && fotoInput.files[0];
    if (!f) { pendingPhoto = null; fotoPreview.hidden = true; fotoPreview.src = ''; return; }
    try {
      UX.show('Procesando imagen…');
      const opt = { maxSizeMB: 0.5, maxWidthOrHeight: 1280, useWebWorker: true, fileType: 'image/jpeg' };
      pendingPhoto = await imageCompression(f, opt);
      fotoPreview.src = URL.createObjectURL(pendingPhoto);
      fotoPreview.hidden = false;
    } catch (e) {
      console.error(e);
      UX.alert('Aviso', 'No se pudo procesar la imagen.');
      pendingPhoto = null; fotoPreview.hidden = true; fotoPreview.src = '';
    } finally { UX.hide(); }
  });

  function dataURLtoBlob(u) {
    const a = u.split(','), m = a[0].match(/:(.*?);/)[1];
    const b = atob(a[1]); let n = b.length; const x = new Uint8Array(n);
    while (n--) x[n] = b.charCodeAt(n);
    return new Blob([x], { type: m });
  }
  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
    });
  }
  async function uploadTo(p, blob) {
    const ref = storage.ref().child(p);
    await ref.put(blob);
    return await ref.getDownloadURL();
  }

  let currentUserProfile = null;

  auth.onAuthStateChanged(async (user) => {
    if (!user) { setTimeout(() => { if (!auth.currentUser) window.location.href = 'index.html'; }, 150); return; }
    try {
      UX.show('Cargando datos de usuario...');
      const userId = user.email.split('@')[0];
      const prof = await db.collection('USUARIOS').doc(userId).get();
      if (!prof.exists) throw new Error('No se encontró tu perfil.');
      currentUserProfile = prof.data();
      await cargarTiposIncidente();
      setTimeout(resizeCanvas, 120);
    } catch (e) {
      console.error(e); UX.alert('Error', 'No se pudo cargar tu perfil.');
      window.location.href = 'menu.html';
    } finally { UX.hide(); }
  });

  async function cargarTiposIncidente() {
    if (!currentUserProfile) return;
    const tipoSeleccionado = tipoIncidenteSelect.value;
    tipoIncidenteSelect.innerHTML = '<option value="" disabled selected>Cargando...</option>';
    try {
      const { CLIENTE, UNIDAD } = currentUserProfile;
      const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
      const snapshot = await db.collection(path).get();
      if (snapshot.empty) { tipoIncidenteSelect.innerHTML = '<option value="" disabled>No hay tipos definidos</option>'; return; }
      tipoIncidenteSelect.innerHTML = '<option value="" disabled selected>Seleccione un tipo</option>';
      snapshot.forEach(doc => {
        const option = document.createElement('option');
        option.value = doc.id; option.textContent = doc.id;
        if (doc.id === tipoSeleccionado) option.selected = true;
        tipoIncidenteSelect.appendChild(option);
      });
      tipoIncidenteSelect.disabled = false;
      if (tipoSeleccionado) tipoIncidenteSelect.dispatchEvent(new Event('change'));
    } catch (e) {
      console.error("Error cargando tipos:", e);
      tipoIncidenteSelect.innerHTML = '<option value="">Error al cargar</option>';
    }
  }

  async function cargarDetallesIncidente(tipoId) {
    if (!tipoId || !currentUserProfile) return;
    detalleIncidenteSelect.innerHTML = '<option value="">Cargando...</option>';
    detalleIncidenteSelect.disabled = true;
    try {
      const { CLIENTE, UNIDAD } = currentUserProfile;
      const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
      const doc = await db.collection(path).doc(tipoId).get();
      if (!doc.exists) { detalleIncidenteSelect.innerHTML = '<option value="">No hay detalles</option>'; return; }
      const data = doc.data();
      const detalles = (Array.isArray(data.DETALLES) ? data.DETALLES : Object.values(data)).sort();
      detalleIncidenteSelect.innerHTML = '<option value="" disabled selected>Seleccione un detalle</option>';
      detalles.forEach(detalle => {
        const option = document.createElement('option');
        option.value = detalle; option.textContent = detalle;
        detalleIncidenteSelect.appendChild(option);
      });
      detalleIncidenteSelect.disabled = false;
    } catch (error) {
      console.error("Error cargando detalles:", error);
      detalleIncidenteSelect.innerHTML = '<option value="">Error</option>';
    }
  }
  tipoIncidenteSelect.addEventListener('change', (e) => cargarDetallesIncidente(e.target.value));

  // Iframe “+”
  const openIframeModal = (url, title) => {
    if (!iframe || !iframeTitle || !iframeModal) return;
    iframe.src = url; iframeTitle.textContent = title; iframeModal.style.display = 'flex';
  };
  closeIframeBtn?.addEventListener('click', () => { if (iframeModal) iframeModal.style.display = 'none'; });
  addTipoBtn?.addEventListener('click', () => {
    const { CLIENTE, UNIDAD } = currentUserProfile || {};
    if (!CLIENTE || !UNIDAD) return;
    openIframeModal(`add_tipo_incidente.html?cliente=${encodeURIComponent(CLIENTE)}&unidad=${encodeURIComponent(UNIDAD)}`, 'Añadir Nuevo Tipo de Incidente');
  });
  addDetalleBtn?.addEventListener('click', () => {
    const tipo = tipoIncidenteSelect.value;
    if (!tipo) { UX.alert("Aviso", "Primero debe seleccionar un Tipo de Incidente."); return; }
    const { CLIENTE, UNIDAD } = currentUserProfile || {};
    if (!CLIENTE || !UNIDAD) return;
    openIframeModal(`add_detalle_incidente.html?cliente=${encodeURIComponent(CLIENTE)}&unidad=${encodeURIComponent(UNIDAD)}&tipo=${encodeURIComponent(tipo)}`, 'Añadir Nuevo Detalle');
  });
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data?.type === 'tipoAgregado') {
      cargarTiposIncidente();
    } else if (data?.type === 'detalleAgregado') {
      tipoIncidenteSelect.value = data.tipo;
      cargarDetallesIncidente(data.tipo);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipoIncidente = (tipoIncidenteSelect.value || '').trim();
    const detalleIncidente = (detalleIncidenteSelect.value || '').trim();
    const comentario = (comentarioEl.value || '').trim();
    if (!tipoIncidente || !detalleIncidente || !comentario || comentario.length < 5) {
      UX.alert('Aviso', 'Complete todos los campos requeridos (comentario mínimo 5 caracteres).'); return;
    }

    UX.show('Guardando incidente…');
    try {
      const { CLIENTE, UNIDAD, NOMBRES, APELLIDOS, PUESTO } = currentUserProfile;
      const stamp = Date.now();

      let fotoURL = null, fotoEmbedded = null;
      if (pendingPhoto) {
        try {
          if (!navigator.onLine) throw new Error('offline');
          fotoURL = await uploadTo(`incidencias/${CLIENTE}/${UNIDAD}/${stamp}_foto.jpg`, pendingPhoto);
        } catch {
          fotoEmbedded = await blobToDataURL(pendingPhoto);
        }
      }

      let firmaURL = null, firmaEmbedded = null;
      if (!sigPad.isEmpty()) {
        const firmaBlob = dataURLtoBlob(sigPad.toDataURL('image/png'));
        try {
          if (!navigator.onLine) throw new Error('offline');
          firmaURL = await uploadTo(`incidencias/${CLIENTE}/${UNIDAD}/${stamp}_firma.png`, firmaBlob);
        } catch {
          firmaEmbedded = await blobToDataURL(firmaBlob);
        }
      }

      const ref = await db.collection('INCIDENCIAS_REGISTRADAS').add({
        cliente: CLIENTE,
        unidad: UNIDAD,
        puesto: PUESTO || null,
        registradoPor: `${NOMBRES || ''} ${APELLIDOS || ''}`.trim(),
        tipoIncidente,
        detalleIncidente,
        comentario,
        estado: 'Pendiente',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        ...(fotoURL ? { fotoURL } : {}),
        ...(firmaURL ? { firmaURL } : {}),
        ...(fotoEmbedded ? { fotoEmbedded } : {}),
        ...(firmaEmbedded ? { firmaEmbedded } : {}),
      });

      // Encolar si quedaron embebidos para re-sync
      if ((fotoEmbedded || firmaEmbedded) && window.OfflineQueue) {
        await OfflineQueue.add({
          type: 'incidencia-upload',
          docPath: `INCIDENCIAS_REGISTRADAS/${ref.id}`,
          cliente: CLIENTE,
          unidad: UNIDAD,
          fotoEmbedded: fotoEmbedded || null,
          firmaEmbedded: firmaEmbedded || null,
          createdAt: Date.now()
        });
      }

      UX.hide();
      UX.alert('Éxito', 'Incidente guardado correctamente.', () => window.location.href = 'menu.html');
    } catch (err) {
      console.error(err);
      UX.hide();
      UX.alert('Error', err.message || 'No fue posible guardar el incidente.');
    }
  });
});
