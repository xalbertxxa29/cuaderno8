// registrar_incidente.js (v57) — Modales nativos + foto offline + Nivel de Riego (sin firma)
document.addEventListener('DOMContentLoaded', () => {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth    = firebase.auth();
  const db      = firebase.firestore();
  const storage = firebase.storage();

  // Sesión persistente
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});

  const UX = {
    show : (m) => (window.UI && UI.showOverlay) ? UI.showOverlay(m) : void 0,
    hide : ()   => (window.UI && UI.hideOverlay) ? UI.hideOverlay() : void 0,
    alert: (t, m, cb) => (window.UI && UI.alert) ? UI.alert(t, m, cb) : (alert(`${t}\n\n${m||''}`), cb && cb())
  };

  // ===== DOM =====
  const form                   = document.getElementById('incidente-form');
  const tipoIncidenteSelect    = document.getElementById('tipo-incidente');
  const detalleIncidenteSelect = document.getElementById('detalle-incidente');
  const nivelRiesgoSelect      = document.getElementById('nivel-riesgo');
  const comentarioEl           = document.getElementById('comentario');
  const fotoInput              = document.getElementById('foto-input');
  const fotoPreview            = document.getElementById('foto-preview');

  // Botones "plus"
  const addTipoBtn    = document.getElementById('add-tipo-btn');
  const addDetalleBtn = document.getElementById('add-detalle-btn');

  // ===== Modales nativos (definidos en el HTML) =====
  const modalAddTipo        = document.getElementById('modal-add-tipo');
  const modalAddDetalle     = document.getElementById('modal-add-detalle');
  const nuevoTipoInput      = document.getElementById('nuevo-tipo');
  const nuevoDetalleInput   = document.getElementById('nuevo-detalle');
  const detalleCtx          = document.getElementById('detalle-ctx');
  const btnSaveAddTipo      = document.getElementById('save-add-tipo');
  const btnCancelAddTipo    = document.getElementById('cancel-add-tipo');
  const btnSaveAddDetalle   = document.getElementById('save-add-detalle');
  const btnCancelAddDetalle = document.getElementById('cancel-add-detalle');

  const openModal  = (el) => el && (el.style.display = 'flex');
  const closeModal = (el) => el && (el.style.display = 'none');

  // ===== Imagen (compresión) =====
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

  // ===== Utilidades de blob/base64 + subida segura =====
  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }
  async function uploadTo(path, blob) {
    const ref = storage.ref().child(path);
    await ref.put(blob);
    return await ref.getDownloadURL();
  }
  async function safeUploadOrEmbed(path, blob) {
    try {
      if (!navigator.onLine) throw new Error('offline');
      return { url: await uploadTo(path, blob), embedded: null };
    } catch {
      // Fallback a base64 si falla la subida (modo offline o error de red)
      return { url: null, embedded: await blobToDataURL(blob) };
    }
  }
  const MAX_EMBED_LEN = 600 * 1024; // ~600KB para no exceder límites de Firestore

  // ===== Perfil de usuario =====
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
    } catch (e) {
      console.error(e); UX.alert('Error', 'No se pudo cargar tu perfil.');
      window.location.href = 'menu.html';
    } finally { UX.hide(); }
  });

  // ===== Tipos / Detalles =====
  async function cargarTiposIncidente() {
    if (!currentUserProfile) return;
    const tipoSeleccionado = tipoIncidenteSelect.value;
    tipoIncidenteSelect.innerHTML = '<option value="" disabled selected>Cargando...</option>';
    try {
      const { CLIENTE, UNIDAD } = currentUserProfile;
      const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
      const snapshot = await db.collection(path).get();
      if (snapshot.empty) {
        tipoIncidenteSelect.innerHTML = '<option value="" disabled>No hay tipos definidos</option>';
        detalleIncidenteSelect.innerHTML = '<option value="" disabled>Seleccione un tipo primero</option>';
        detalleIncidenteSelect.disabled = true;
        return;
      }
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
      console.error('Error cargando tipos:', e);
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
      if (!doc.exists) {
        detalleIncidenteSelect.innerHTML = '<option value="" disabled>No hay detalles</option>';
        return;
      }
      const data = doc.data();
      const detalles = Array.isArray(data.DETALLES) ? data.DETALLES.slice().sort() : [];
      detalleIncidenteSelect.innerHTML = detalles.length
        ? '<option value="" disabled selected>Seleccione un detalle</option>'
        : '<option value="" disabled>No hay detalles</option>';
      detalles.forEach(detalle => {
        const option = document.createElement('option');
        option.value = detalle; option.textContent = detalle;
        detalleIncidenteSelect.appendChild(option);
      });
      detalleIncidenteSelect.disabled = detalles.length === 0;
    } catch (error) {
      console.error('Error cargando detalles:', error);
      detalleIncidenteSelect.innerHTML = '<option value="">Error</option>';
    }
  }
  tipoIncidenteSelect.addEventListener('change', (e) => cargarDetallesIncidente(e.target.value));

  // ===== “+” con MODALES NATIVOS =====
  addTipoBtn?.addEventListener('click', () => {
    if (!currentUserProfile) return UX.alert('Error','Perfil no cargado.');
    nuevoTipoInput.value = '';
    openModal(modalAddTipo);
  });
  btnCancelAddTipo?.addEventListener('click', () => closeModal(modalAddTipo));
  btnSaveAddTipo?.addEventListener('click', async () => {
    const val = (nuevoTipoInput.value || '').trim().toUpperCase();
    if (!val) return UX.alert('Aviso','Escribe un nombre de tipo.');
    try {
      const { CLIENTE, UNIDAD } = currentUserProfile || {};
      if (!CLIENTE || !UNIDAD) return UX.alert('Error','Perfil no cargado.');
      UX.show('Guardando tipo…');
      const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
      await db.collection(path).doc(val).set(
        { DETALLES: [], actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      closeModal(modalAddTipo);
      await cargarTiposIncidente();
      tipoIncidenteSelect.value = val;
      tipoIncidenteSelect.dispatchEvent(new Event('change'));
    } catch(e){
      console.error(e);
      UX.alert('Error','No fue posible crear el tipo.');
    } finally { UX.hide(); }
  });

  addDetalleBtn?.addEventListener('click', () => {
    const tipo = (tipoIncidenteSelect.value || '').trim();
    if (!tipo) return UX.alert('Aviso','Primero selecciona un Tipo de Incidente.');
    nuevoDetalleInput.value = '';
    if (detalleCtx) detalleCtx.textContent = `Tipo seleccionado: ${tipo}`;
    openModal(modalAddDetalle);
  });
  btnCancelAddDetalle?.addEventListener('click', () => closeModal(modalAddDetalle));
  btnSaveAddDetalle?.addEventListener('click', async () => {
    const det  = (nuevoDetalleInput.value || '').trim().toUpperCase();
    const tipo = (tipoIncidenteSelect.value || '').trim();
    if (!det)  return UX.alert('Aviso','Escribe el detalle.');
    if (!tipo) return UX.alert('Aviso','Selecciona un tipo.');
    try {
      const { CLIENTE, UNIDAD } = currentUserProfile || {};
      if (!CLIENTE || !UNIDAD) return UX.alert('Error','Perfil no cargado.');
      UX.show('Guardando detalle…');
      const path = `/TIPO_INCIDENCIAS/${CLIENTE}/UNIDADES/${UNIDAD}/TIPO`;
      await db.collection(path).doc(tipo).set(
        {
          DETALLES: firebase.firestore.FieldValue.arrayUnion(det),
          actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      closeModal(modalAddDetalle);
      await cargarDetallesIncidente(tipo);
      detalleIncidenteSelect.value = det;
    } catch(e){
      console.error(e);
      UX.alert('Error','No fue posible crear el detalle.');
    } finally { UX.hide(); }
  });

  // ===== Guardar Incidencia =====
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipoIncidente    = (tipoIncidenteSelect.value || '').trim();
    const detalleIncidente = (detalleIncidenteSelect.value || '').trim();
    const nivelRiesgo      = (nivelRiesgoSelect?.value || '').trim();
    const comentario       = (comentarioEl.value || '').trim();

    if (!tipoIncidente || !detalleIncidente || !nivelRiesgo || !comentario || comentario.length < 5) {
      UX.alert('Aviso', 'Complete todos los campos requeridos (comentario mínimo 5 caracteres).');
      return;
    }

    UX.show('Guardando incidente…');
    try {
      const { CLIENTE, UNIDAD, NOMBRES, APELLIDOS, PUESTO } = currentUserProfile;
      const stamp = Date.now();

      // Foto
      let fotoURL = null, fotoEmbedded = null;
      if (pendingPhoto) {
        const r = await safeUploadOrEmbed(`incidencias/${CLIENTE}/${UNIDAD}/${stamp}_foto.jpg`, pendingPhoto);
        fotoURL = r.url; fotoEmbedded = r.embedded;
      }
      // Limita base64 para no exceder Firestore
      if (fotoEmbedded && fotoEmbedded.length > MAX_EMBED_LEN) fotoEmbedded = null;

      const ref = await db.collection('INCIDENCIAS_REGISTRADAS').add({
        cliente: CLIENTE,
        unidad : UNIDAD,
        puesto : PUESTO || null,
        registradoPor: `${NOMBRES || ''} ${APELLIDOS || ''}`.trim(),
        tipoIncidente,
        detalleIncidente,
        Nivelderiesgo: nivelRiesgo,           // <<< NUEVO campo
        comentario,
        estado: 'Pendiente',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        ...(fotoURL ? { fotoURL } : {}),
        ...(fotoEmbedded ? { fotoEmbedded } : {}),
      });

      // Encola para re-subir si quedó embebida
      if (fotoEmbedded && window.OfflineQueue) {
        await OfflineQueue.add({
          type: 'incidencia-upload',
          docPath: `INCIDENCIAS_REGISTRADAS/${ref.id}`,
          cliente: CLIENTE,
          unidad : UNIDAD,
          fotoEmbedded,
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
