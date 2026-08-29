// ==========================================
// CEREBRO UNIFICADO DEL SISTEMA - IAPCI 2026
// (Sincronización Firestore en Tiempo Real + Respaldo Local + Sesión Única)
// ==========================================

// --- 1. COMUNICACIÓN Y CONTROL DE SESIÓN ÚNICA ENTRE PESTAÑAS ---
const canalSincronizacion = new BroadcastChannel("iapci_sincronizacion_sistema");
const idSesionUnicaTab = Math.random().toString(36);
let intervaloHeartbeat = null;

canalSincronizacion.onmessage = function (event) {
  const mensaje = event.data;
  if (!mensaje) return;

  if (mensaje.tipo === "FORZAR_CIERRE_SESION") {
    if (usuarioActual && usuarioActual.rol === mensaje.rol) {
      clearInterval(intervaloHeartbeat);
      localStorage.removeItem(`iapci_sesion_activa_${usuarioActual.rol}`);
      usuarioActual = null;
      document.getElementById("pantalla-sistema")?.classList.add("oculto");
      document.getElementById("pantalla-login")?.classList.remove("oculto");
      alert("⚠️ Su sesión ha sido cerrada porque este usuario/rol acaba de iniciar sesión en otra computadora o ventana.");
    }
  } else if (mensaje.tipo === "ACTUALIZAR_ESTADO_SISTEMA") {
    if (usuarioActual) {
      renderTablaStock();
      renderTablaHistorial();
      renderReporteGeneral();
    }
  }
};

// --- 2. ESTADO GLOBAL E INICIALIZACIÓN DE DATOS LOCALES ---
function obtenerUsuariosIniciales() {
  const guardados = localStorage.getItem("iapci_usuarios");
  if (guardados) {
    try { return JSON.parse(guardados); } catch (e) { console.error("Error al cargar usuarios guardados", e); }
  }
  return {
    "soporte": { clave: "1234", rol: "Soporte Técnico" },
    "admin": { clave: "admin123", rol: "Administrador" },
    "asistente": { clave: "asi123", rol: "Asistente" }
  };
}

function obtenerTasaInicial() {
  const hoyStr = new Date().toLocaleDateString();
  const tasaGuardada = localStorage.getItem("tasa_valor");
  const fechaGuardada = localStorage.getItem("tasa_fecha");

  if (tasaGuardada && fechaGuardada === hoyStr) {
    return parseFloat(tasaGuardada);
  }
  return 36.50;
}

function obtenerInventarioInicial() {
  const guardado = localStorage.getItem("iapci_inventario");
  if (guardado) {
    try { return JSON.parse(guardado); } catch (e) { console.error("Error al cargar inventario local", e); }
  }
  return [];
}

function obtenerHistorialInicial() {
  const guardado = localStorage.getItem("iapci_historial");
  if (guardado) {
    try { return JSON.parse(guardado); } catch (e) { console.error("Error al cargar historial local", e); }
  }
  return [];
}

function obtenerPapeleraInicial() {
  const guardado = localStorage.getItem("iapci_papelera");
  if (guardado) {
    try { return JSON.parse(guardado); } catch (e) { console.error("Error al cargar papelera local", e); }
  }
  return [];
}

let usuarios = obtenerUsuariosIniciales();
let usuarioActual = null;
let tasaCambioBCV = obtenerTasaInicial();

let inventario = obtenerInventarioInicial();
let historialMovimientos = obtenerHistorialInicial();
let papeleraMovimientos = obtenerPapeleraInicial();
const CAPACIDAD_MAXIMA_PAPELERA = 80;

// --- 3. PERSISTENCIA Y ESCUCHADORES EN TIEMPO REAL (FIREBASE & LOCALSTORAGE) ---

function guardarEstadoSistema() {
  localStorage.setItem("iapci_inventario", JSON.stringify(inventario));
  localStorage.setItem("iapci_historial", JSON.stringify(historialMovimientos));
  localStorage.setItem("iapci_papelera", JSON.stringify(papeleraMovimientos));
  localStorage.setItem("tasa_valor", tasaCambioBCV);
  localStorage.setItem("tasa_fecha", new Date().toLocaleDateString());

  canalSincronizacion.postMessage({ tipo: "ACTUALIZAR_ESTADO_SISTEMA" });
}

function inicializarEscuchadoresFirebase() {
  if (typeof db === "undefined" || !db) {
    console.warn("Firebase no está disponible. Operando en modo LocalStorage.");
    return;
  }

  // Escuchar Inventario (iapci_stock)
  db.collection("iapci_stock").onSnapshot((snapshot) => {
    inventario = [];
    snapshot.forEach((doc) => {
      inventario.push({ idDoc: doc.id, ...doc.data() });
    });
    localStorage.setItem("iapci_inventario", JSON.stringify(inventario));
    if (usuarioActual) {
      renderTablaStock();
      renderReporteGeneral();
    }
  }, (error) => console.error("Error escuchando inventario Firestore:", error));

  // Escuchar Historial (iapci_historial)
  db.collection("iapci_historial").orderBy("timestamp", "desc").onSnapshot((snapshot) => {
    historialMovimientos = [];
    snapshot.forEach((doc) => {
      historialMovimientos.push({ idDoc: doc.id, ...doc.data() });
    });
    localStorage.setItem("iapci_historial", JSON.stringify(historialMovimientos));
    if (usuarioActual) {
      renderTablaHistorial();
    }
  }, (error) => console.error("Error escuchando historial Firestore:", error));

  // Escuchar Papelera (iapci_papelera)
  db.collection("iapci_papelera").orderBy("timestamp", "desc").onSnapshot((snapshot) => {
    papeleraMovimientos = [];
    snapshot.forEach((doc) => {
      papeleraMovimientos.push({ idDoc: doc.id, ...doc.data() });
    });
    localStorage.setItem("iapci_papelera", JSON.stringify(papeleraMovimientos));
    const modalPapelera = document.getElementById("modal-papelera");
    if (modalPapelera && !modalPapelera.classList.contains("oculto")) {
      renderTablaPapelera();
    }
  }, (error) => console.error("Error escuchando papelera Firestore:", error));

  // Escuchar Tasa de Cambio (iapci_tasa)
  db.collection("iapci_tasa").doc("bcv").onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      if (data.tasa) {
        tasaCambioBCV = parseFloat(data.tasa);
        localStorage.setItem("tasa_valor", tasaCambioBCV);
        localStorage.setItem("tasa_fecha", new Date().toLocaleDateString());
        
        const lblTasa = document.getElementById("lbl-tasa-actual");
        if (lblTasa) lblTasa.textContent = `Bs. ${tasaCambioBCV.toFixed(2)} / $`;
        const inputTasaElem = document.getElementById("f-tasa-cambio");
        if (inputTasaElem && document.activeElement !== inputTasaElem) {
          inputTasaElem.value = tasaCambioBCV;
        }
        if (usuarioActual) {
          renderTablaStock();
          renderTablaHistorial();
        }
      }
    }
  }, (error) => console.error("Error escuchando tasa Firestore:", error));

  // Escuchar Usuarios (iapci_usuarios)
  db.collection("iapci_usuarios").onSnapshot((snapshot) => {
    if (!snapshot.empty) {
      let usuariosCargados = {};
      snapshot.forEach((doc) => {
        usuariosCargados[doc.id] = doc.data();
      });
      usuarios = usuariosCargados;
      localStorage.setItem("iapci_usuarios", JSON.stringify(usuarios));
    }
  }, (error) => console.error("Error escuchando usuarios Firestore:", error));
}

inicializarEscuchadoresFirebase();

function actualizarTodo(codigoResaltarStock = null, indiceResaltarHistorial = null) {
  guardarEstadoSistema();
  renderTablaStock(codigoResaltarStock);
  renderTablaHistorial(indiceResaltarHistorial);
  renderReporteGeneral();
}

// --- 4. GESTIÓN DE USUARIOS CON CTRL + K ---

function toggleModalUsuarios() {
  const modal = document.getElementById("modal-usuarios");
  if (modal) {
    modal.classList.toggle("oculto");
    if (!modal.classList.contains("oculto")) {
      const soporteKey = Object.keys(usuarios).find(u => usuarios[u].rol === "Soporte Técnico") || "soporte";
      const adminKey = Object.keys(usuarios).find(u => usuarios[u].rol === "Administrador") || "admin";
      const asistenteKey = Object.keys(usuarios).find(u => usuarios[u].rol === "Asistente") || "asistente";

      document.getElementById("cfg-user-soporte").value = soporteKey;
      document.getElementById("cfg-user-admin").value = adminKey;
      document.getElementById("cfg-user-asistente").value = asistenteKey;
      
      document.getElementById("cfg-pass-soporte").value = "";
      document.getElementById("cfg-pass-admin").value = "";
      document.getElementById("cfg-pass-asistente").value = "";
    }
  }
}

async function guardarNuevosUsuarios() {
  const sUser = document.getElementById("cfg-user-soporte").value.trim().toLowerCase();
  const sPass = document.getElementById("cfg-pass-soporte").value;

  const aUser = document.getElementById("cfg-user-admin").value.trim().toLowerCase();
  const aPass = document.getElementById("cfg-pass-admin").value;

  const asUser = document.getElementById("cfg-user-asistente").value.trim().toLowerCase();
  const asPass = document.getElementById("cfg-pass-asistente").value;

  if (!sUser || !aUser || !asUser) {
    alert("Los nombres de usuario no pueden estar vacíos.");
    return;
  }

  const oldSoporte = Object.keys(usuarios).find(u => usuarios[u].rol === "Soporte Técnico");
  const oldAdmin = Object.keys(usuarios).find(u => usuarios[u].rol === "Administrador");
  const oldAsistente = Object.keys(usuarios).find(u => usuarios[u].rol === "Asistente");

  const nuevosUsuarios = {};
  nuevosUsuarios[sUser] = { clave: sPass || usuarios[oldSoporte]?.clave || "1234", rol: "Soporte Técnico" };
  nuevosUsuarios[aUser] = { clave: aPass || usuarios[oldAdmin]?.clave || "admin123", rol: "Administrador" };
  nuevosUsuarios[asUser] = { clave: asPass || usuarios[oldAsistente]?.clave || "asi123", rol: "Asistente" };

  if (typeof db !== "undefined" && db) {
    try {
      const batch = db.batch();
      for (const uKey in usuarios) {
        batch.delete(db.collection("iapci_usuarios").doc(uKey));
      }
      for (const uKey in nuevosUsuarios) {
        batch.set(db.collection("iapci_usuarios").doc(uKey), nuevosUsuarios[uKey]);
      }
      await batch.commit();
    } catch (e) {
      console.error("Error al actualizar usuarios en Firestore:", e);
    }
  }

  usuarios = nuevosUsuarios;
  localStorage.setItem("iapci_usuarios", JSON.stringify(usuarios));
  alert("✅ Credenciales de usuarios actualizadas exitosamente.");
  toggleModalUsuarios();
}

window.addEventListener("keydown", function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    toggleModalUsuarios();
  }
});

// --- 5. AUTENTICACIÓN Y NAVEGACIÓN ---

function iniciarSesion() {
  const userInput = document.getElementById("input-usuario").value.trim().toLowerCase();
  const passInput = document.getElementById("input-clave").value;
  const msgError = document.getElementById("mensaje-error");

  if (usuarios[userInput] && usuarios[userInput].clave === passInput) {
    const rolIntentado = usuarios[userInput].rol;
    const claveSesionKey = `iapci_sesion_activa_${rolIntentado}`;
    
    const sesionExistenteStr = localStorage.getItem(claveSesionKey);
    if (sesionExistenteStr) {
      try {
        const sesionData = JSON.parse(sesionExistenteStr);
        if (Date.now() - sesionData.timestamp < 8000) {
          msgError.textContent = `❌ Acceso denegado: El rol "${rolIntentado}" ya se encuentra activo en otra ventana/computadora.`;
          return;
        }
      } catch (e) {
        console.error(e);
      }
    }

    usuarioActual = usuarios[userInput];
    localStorage.setItem(claveSesionKey, JSON.stringify({ tabId: idSesionUnicaTab, timestamp: Date.now() }));

    canalSincronizacion.postMessage({ tipo: "FORZAR_CIERRE_SESION", rol: rolIntentado });

    if (intervaloHeartbeat) clearInterval(intervaloHeartbeat);
    intervaloHeartbeat = setInterval(() => {
      if (usuarioActual) {
        localStorage.setItem(claveSesionKey, JSON.stringify({ tabId: idSesionUnicaTab, timestamp: Date.now() }));
      }
    }, 4000);

    document.getElementById("pantalla-login").classList.add("oculto");
    document.getElementById("pantalla-sistema").classList.remove("oculto");
    document.getElementById("rol-usuario-lbl").textContent = `Usuario: ${userInput.toUpperCase()} (${usuarioActual.rol})`;
    document.getElementById("f-fecha").value = new Date().toLocaleDateString();
    
    const inputTasaElem = document.getElementById("f-tasa-cambio");
    if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;

    const lblTasa = document.getElementById("lbl-tasa-actual");
    if (lblTasa) lblTasa.textContent = `Bs. ${tasaCambioBCV.toFixed(2)} / $`;

    aplicarPermisos();
    actualizarTodo();
    msgError.textContent = "";
  } else {
    msgError.textContent = "Usuario o clave incorrectos";
  }
}

function verificarPermisoAdmin(accionCallback) {
  if (usuarioActual && usuarioActual.rol === "Asistente") {
    let claveAdmin = prompt("⚠️ Acción restringida. Introduzca la clave del Administrador para continuar:");
    
    if (claveAdmin === null) {
      const inputTasaElem = document.getElementById("f-tasa-cambio");
      if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;
      return; 
    }

    let adminKey = Object.keys(usuarios).find(u => usuarios[u].rol === "Administrador");
    let passAdminReal = adminKey ? usuarios[adminKey].clave : "admin123";

    if (claveAdmin === passAdminReal) {
      accionCallback();
    } else {
      alert("❌ Clave incorrecta");
      const inputTasaElem = document.getElementById("f-tasa-cambio");
      if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;
    }
  } else {
    accionCallback();
  }
}

function cambiarPestana(pestana) {
  const vRegistro = document.getElementById("vista-registro");
  const vStock = document.getElementById("vista-stock");
  const vHistorial = document.getElementById("vista-historial");
  const vReporte = document.getElementById("vista-reporte");

  const tRegistro = document.getElementById("tab-registro");
  const tStock = document.getElementById("tab-stock");
  const tHistorial = document.getElementById("tab-historial");
  const tReporte = document.getElementById("tab-reporte");

  [vRegistro, vStock, vHistorial, vReporte].forEach(v => v?.classList.add("oculto"));
  [tRegistro, tStock, tHistorial, tReporte].forEach(t => t?.classList.remove("activa"));

  if (pestana === 'registro') {
    vRegistro?.classList.remove("oculto");
    tRegistro?.classList.add("activa");
  } else if (pestana === 'stock') {
    renderTablaStock();
    vStock?.classList.remove("oculto");
    tStock?.classList.add("activa");
  } else if (pestana === 'historial') {
    renderTablaHistorial();
    vHistorial?.classList.remove("oculto");
    tHistorial?.classList.add("activa");
  } else if (pestana === 'reporte') {
    renderReporteGeneral();
    vReporte?.classList.remove("oculto");
    tReporte?.classList.add("activa");
  }
}

function actualizarTasa() {
  verificarPermisoAdmin(async () => {
    const inputTasa = parseFloat(document.getElementById("f-tasa-cambio").value);
    
    if (isNaN(inputTasa) || inputTasa <= 0) {
      alert("❌ Por favor introduzca una tasa de cambio válida.");
      document.getElementById("f-tasa-cambio").value = tasaCambioBCV;
      return;
    }

    tasaCambioBCV = inputTasa;
    const hoyStr = new Date().toLocaleDateString();

    if (typeof db !== "undefined" && db) {
      await db.collection("iapci_tasa").doc("bcv").set({
        tasa: tasaCambioBCV,
        fecha: hoyStr
      });
    }

    const lblTasa = document.getElementById("lbl-tasa-actual");
    if (lblTasa) lblTasa.textContent = `Bs. ${tasaCambioBCV.toFixed(2)} / $`;

    actualizarTodo();
    alert(`✅ Tasa del día actualizada exitosamente a Bs. ${tasaCambioBCV.toFixed(2)} / $`);
  });
}

function aplicarPermisos() {
  const btnNuevo = document.getElementById("btn-nuevo");
  const btnEliminar = document.getElementById("btn-eliminar");
  if (btnNuevo) btnNuevo.disabled = false;
  if (btnEliminar) btnEliminar.disabled = false;
}

function cerrarSesion() {
  if (usuarioActual) {
    clearInterval(intervaloHeartbeat);
    localStorage.removeItem(`iapci_sesion_activa_${usuarioActual.rol}`);
  }
  usuarioActual = null;
  document.getElementById("pantalla-sistema")?.classList.add("oculto");
  document.getElementById("pantalla-login")?.classList.remove("oculto");
  document.getElementById("input-usuario").value = "";
  document.getElementById("input-clave").value = "";
}

window.addEventListener("beforeunload", function() {
  if (usuarioActual) {
    localStorage.removeItem(`iapci_sesion_activa_${usuarioActual.rol}`);
  }
});

// --- 6. OPERACIONES DE INVENTARIO Y STOCK ---

function renderTablaStock(codigoResaltar = null) {
  const tbody = document.getElementById("cuerpo-tabla-stock");
  if (!tbody) return;
  tbody.innerHTML = "";

  let totalInic = 0, totalEntradas = 0, totalSalidas = 0, totalStockActual = 0, valorTotalDisponibleBs = 0;

  inventario.forEach((prod, index) => {
    const stockActual = prod.stockInic + prod.entradas - prod.salidas;
    const valorDisponibleBs = stockActual * prod.precioBs;
    
    const estado = stockActual > prod.stockMin ? "Buen Nivel" : (stockActual > 0 ? "Bajo Nivel" : "Agotado");
    const claseBadge = stockActual > prod.stockMin ? "badge-buen" : (stockActual > 0 ? "badge-bajo" : "badge-agotado");

    totalInic += prod.stockInic;
    totalEntradas += prod.entradas;
    totalSalidas += prod.salidas;
    totalStockActual += stockActual;
    valorTotalDisponibleBs += valorDisponibleBs;

    const tr = document.createElement("tr");
    tr.id = `fila-prod-${prod.codigo}`;

    if (codigoResaltar && prod.codigo.toUpperCase() === codigoResaltar.toUpperCase()) {
      tr.style.backgroundColor = "#0056b3";
      tr.style.color = "#ffffff";
      tr.style.fontWeight = "bold";
    }

    tr.innerHTML = `
      <td>${prod.codigo}</td>
      <td>${prod.descripcion}</td>
      <td>${prod.categoria}</td>
      <td>${prod.pasillo}</td>
      <td>${prod.und}</td>
      <td>Bs.S ${prod.precioBs.toFixed(2)}</td>
      <td>${prod.stockInic}</td>
      <td>${prod.entradas}</td>
      <td>${prod.salidas}</td>
      <td><strong>${stockActual}</strong></td>
      <td>Bs.S ${valorDisponibleBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
      <td>${prod.stockMin}</td>
      <td><span class="${claseBadge}">${estado}</span></td>
      <td>${prod.obs || '-'}</td>
      <td><button onclick="modificarStockFila(${index})" style="background:#007bff; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Editar</button></td>
    `;
    tbody.appendChild(tr);
  });

  if (document.getElementById("tot-stock-inic")) document.getElementById("tot-stock-inic").textContent = totalInic;
  if (document.getElementById("tot-stock-entradas")) document.getElementById("tot-stock-entradas").textContent = totalEntradas;
  if (document.getElementById("tot-stock-salidas")) document.getElementById("tot-stock-salidas").textContent = totalSalidas;
  if (document.getElementById("tot-stock-actual")) document.getElementById("tot-stock-actual").textContent = totalStockActual;

  if (codigoResaltar) {
    const filaEncontrada = document.getElementById(`fila-prod-${codigoResaltar}`);
    if (filaEncontrada) {
      filaEncontrada.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

async function modificarStockFila(index) {
  if (!usuarioActual || (usuarioActual.rol !== "Administrador" && usuarioActual.rol !== "Soporte Técnico")) {
    alert("❌ Acceso denegado. El rol de Asistente no tiene permisos para editar el estatus y stock.");
    return;
  }

  let prod = { ...inventario[index] };
  let stockActualCalculado = prod.stockInic + prod.entradas - prod.salidas;

  let nuevoCodigo = prompt(`Modificar Código del producto:`, prod.codigo);
  if (nuevoCodigo !== null) prod.codigo = nuevoCodigo.trim().toUpperCase() || prod.codigo;

  let nuevaDesc = prompt(`Modificar Descripción del producto:`, prod.descripcion);
  if (nuevaDesc !== null) prod.descripcion = nuevaDesc.trim().toUpperCase() || prod.descripcion;

  let nuevaCat = prompt(`Modificar Categoría (Ej: Exento / Gravable):`, prod.categoria);
  if (nuevaCat !== null) prod.categoria = nuevaCat.trim() || prod.categoria;

  let nuevoPasillo = prompt(`Modificar Pasillo:`, prod.pasillo);
  if (nuevoPasillo !== null) prod.pasillo = parseInt(nuevoPasillo) || prod.pasillo;

  let nuevaUnd = prompt(`Modificar Unidad de Medida (UND):`, prod.und);
  if (nuevaUnd !== null) prod.und = nuevaUnd.trim() || prod.und;

  let nuevoStockActual = prompt(`Modificar Stock Actual:`, stockActualCalculado);
  if (nuevoStockActual !== null) {
    let stockDeseado = parseInt(nuevoStockActual);
    if (!isNaN(stockDeseado)) {
      prod.stockInic = stockDeseado - prod.entradas + prod.salidas;
      if (prod.stockInic < 0) prod.stockInic = 0;
    }
  }
  
  inventario[index] = prod;

  if (typeof db !== "undefined" && db && prod.idDoc) {
    const docRef = db.collection("iapci_stock").doc(prod.idDoc);
    const prodCopia = { ...prod };
    delete prodCopia.idDoc;
    await docRef.set(prodCopia);
  }
  actualizarTodo();
}

function limpiarFormulario() {
  document.getElementById("f-codigo").value = "";
  document.getElementById("f-producto").value = "";
  document.getElementById("f-categoria").value = "";
  document.getElementById("f-pasillo").value = "";
  document.getElementById("f-und").value = "";
  document.getElementById("f-precio").value = "";
  document.getElementById("f-cantidad").value = "";
  document.getElementById("f-observacion").value = "";
}

function nuevoProducto() {
  verificarPermisoAdmin(async () => {
    const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
    const descripcion = document.getElementById("f-producto").value.trim().toUpperCase();
    const categoria = document.getElementById("f-categoria").value.trim() || "General";
    const pasillo = parseInt(document.getElementById("f-pasillo").value) || 0;
    const und = document.getElementById("f-und").value.trim() || "UND";
    const precioBs = parseFloat(document.getElementById("f-precio").value) || 0;
    const cantInic = parseInt(document.getElementById("f-cantidad").value) || 0;
    const obs = document.getElementById("f-observacion").value.trim() || `Nuevo producto ${new Date().toLocaleDateString()}`;

    if (!codigo || !descripcion) {
      alert("Por favor introduce el Código y la Descripción antes de crear el nuevo producto.");
      return;
    }

    const existe = inventario.some(p => p.codigo.toUpperCase() === codigo);
    if (existe) {
      alert("❌ El código de producto ya existe en el inventario. Utilice 'Registrar Entrada' para reabastecer.");
      return;
    }

    const nuevoProdObj = {
      codigo, descripcion, categoria, pasillo, und, precioBs, stockInic: cantInic, entradas: 0, salidas: 0, stockMin: 12, obs
    };

    const nuevoHistObj = {
      fecha: new Date().toLocaleDateString(), codigo, producto: descripcion, categoria, pasillo, und, precio: precioBs, entrada: cantInic, salida: 0, observacion: obs, timestamp: Date.now()
    };

    if (typeof db !== "undefined" && db) {
      await db.collection("iapci_stock").add(nuevoProdObj);
      await db.collection("iapci_historial").add(nuevoHistObj);
    } else {
      inventario.push(nuevoProdObj);
      historialMovimientos.unshift(nuevoHistObj);
      actualizarTodo(null, 0);
    }

    limpiarFormulario();
    cambiarPestana('registro');
  });
}

function buscarCodigo() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  if (!codigo) {
    alert("Escribe un Código de producto en el campo para buscar.");
    return;
  }

  const prod = inventario.find(p => p.codigo.toUpperCase() === codigo);
  if (prod) {
    document.getElementById("f-codigo").value = prod.codigo;
    document.getElementById("f-producto").value = prod.descripcion;
    document.getElementById("f-categoria").value = prod.categoria;
    document.getElementById("f-pasillo").value = prod.pasillo;
    document.getElementById("f-und").value = prod.und;
    
    document.getElementById("f-precio").value = "";
    document.getElementById("f-cantidad").value = "";
    document.getElementById("f-observacion").value = "";
    
    cambiarPestana('stock');
    renderTablaStock(prod.codigo);
  } else {
    alert("El código ingresado no existe en el registro.");
  }
}

async function registrarEntrada() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  const cant = parseInt(document.getElementById("f-cantidad").value) || 0;
  const precioNuevo = parseFloat(document.getElementById("f-precio").value) || 0;
  const obs = document.getElementById("f-observacion").value.trim() || "REPOSICIÓN";
  const prod = inventario.find(p => p.codigo.toUpperCase() === codigo);

  if (prod && cant > 0) {
    let nuevoPrecioBs = prod.precioBs;
    if (precioNuevo > 0) {
      nuevoPrecioBs = (prod.precioBs + precioNuevo) / 2;
    }
    const nuevasEntradas = prod.entradas + cant;

    if (typeof db !== "undefined" && db && prod.idDoc) {
      await db.collection("iapci_stock").doc(prod.idDoc).update({
        precioBs: nuevoPrecioBs,
        entradas: nuevasEntradas
      });

      await db.collection("iapci_historial").add({
        fecha: new Date().toLocaleDateString(), 
        codigo: prod.codigo, 
        producto: prod.descripcion, 
        categoria: prod.categoria, 
        pasillo: prod.pasillo, 
        und: prod.und, 
        precio: precioNuevo > 0 ? precioNuevo : prod.precioBs, 
        entrada: cant, 
        salida: 0, 
        observacion: obs,
        timestamp: Date.now()
      });
    } else {
      prod.entradas = nuevasEntradas;
      prod.precioBs = nuevoPrecioBs;
      historialMovimientos.unshift({
        fecha: new Date().toLocaleDateString(), codigo: prod.codigo, producto: prod.descripcion, categoria: prod.categoria, pasillo: prod.pasillo, und: prod.und, precio: precioNuevo > 0 ? precioNuevo : prod.precioBs, entrada: cant, salida: 0, observacion: obs, timestamp: Date.now()
      });
      actualizarTodo(null, 0);
    }

    limpiarFormulario();
    cambiarPestana('registro');
  } else {
    alert("Código no hallado o cantidad inválida.");
  }
}

async function registrarSalida() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  const cant = parseInt(document.getElementById("f-cantidad").value) || 0;
  const precio = parseFloat(document.getElementById("f-precio").value) || 0;
  const obs = document.getElementById("f-observacion").value.trim() || "VENTA";
  const prod = inventario.find(p => p.codigo.toUpperCase() === codigo);

  if (prod && cant > 0) {
    const stockActualCalculado = prod.stockInic + prod.entradas - prod.salidas;
    if (cant > stockActualCalculado) {
      alert(`⚠️ Advertencia: La cantidad a retirar (${cant}) supera el stock disponible (${stockActualCalculado}).`);
    }

    const nuevasSalidas = prod.salidas + cant;
    const nuevoPrecioBs = precio > 0 ? precio : prod.precioBs;

    if (typeof db !== "undefined" && db && prod.idDoc) {
      await db.collection("iapci_stock").doc(prod.idDoc).update({
        salidas: nuevasSalidas,
        precioBs: nuevoPrecioBs
      });

      await db.collection("iapci_historial").add({
        fecha: new Date().toLocaleDateString(), 
        codigo: prod.codigo, 
        producto: prod.descripcion, 
        categoria: prod.categoria, 
        pasillo: prod.pasillo, 
        und: prod.und, 
        precio: nuevoPrecioBs, 
        entrada: 0, 
        salida: cant, 
        observacion: obs,
        timestamp: Date.now()
      });
    } else {
      prod.salidas = nuevasSalidas;
      prod.precioBs = nuevoPrecioBs;
      historialMovimientos.unshift({
        fecha: new Date().toLocaleDateString(), codigo: prod.codigo, producto: prod.descripcion, categoria: prod.categoria, pasillo: prod.pasillo, und: prod.und, precio: nuevoPrecioBs, entrada: 0, salida: cant, observacion: obs, timestamp: Date.now()
      });
      actualizarTodo(null, 0);
    }
    
    limpiarFormulario();
    cambiarPestana('registro');
  } else {
    alert("Código no hallado o cantidad inválida.");
  }
}

// --- 7. HISTORIAL Y ELIMINACIÓN DE REGISTROS ---

function renderTablaHistorial(indiceResaltar = null) {
  const tbody = document.getElementById("cuerpo-tabla-historial");
  if (!tbody) return;
  tbody.innerHTML = "";

  let sumaEntradas = 0, sumaSalidas = 0, sumaMontoTotal = 0;

  historialMovimientos.forEach((mov, index) => {
    const cantMov = mov.entrada > 0 ? mov.entrada : mov.salida;
    const precioTotal = cantMov * mov.precio;
    const precioUsd = mov.precio / tasaCambioBCV;
    
    sumaEntradas += mov.entrada;
    sumaSalidas += mov.salida;
    sumaMontoTotal += precioTotal;

    const tr = document.createElement("tr");
    tr.id = `fila-historial-${index}`;

    if (indiceResaltar !== null && index === indiceResaltar) {
      tr.style.backgroundColor = "#28a745";
      tr.style.color = "#ffffff";
      tr.style.fontWeight = "bold";
    }

    tr.innerHTML = `
      <td>${mov.fecha}</td>
      <td>${mov.codigo}</td>
      <td>${mov.producto}</td>
      <td>${mov.categoria}</td>
      <td>${mov.pasillo}</td>
      <td>${mov.und}</td>
      <td>Bs.S ${mov.precio.toFixed(2)}</td>
      <td>$ ${precioUsd.toFixed(2)}</td>
      <td>${mov.entrada > 0 ? mov.entrada : ''}</td>
      <td>${mov.salida > 0 ? mov.salida : ''}</td>
      <td>Bs.S ${precioTotal.toFixed(2)}</td>
      <td>${mov.observacion}</td>
    `;
    tbody.appendChild(tr);
  });

  if (document.getElementById("tot-entradas")) document.getElementById("tot-entradas").textContent = sumaEntradas;
  if (document.getElementById("tot-salidas")) document.getElementById("tot-salidas").textContent = sumaSalidas;
  if (document.getElementById("tot-monto-total")) document.getElementById("tot-monto-total").textContent = `Bs.S ${sumaMontoTotal.toFixed(2)}`;

  if (indiceResaltar !== null) {
    const filaEncontrada = document.getElementById(`fila-historial-${indiceResaltar}`);
    if (filaEncontrada) {
      filaEncontrada.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function eliminarRegistro() {
  verificarPermisoAdmin(async () => {
    if (historialMovimientos.length > 0) {
      if (papeleraMovimientos.length >= CAPACIDAD_MAXIMA_PAPELERA) {
        alert("⚠️ Advertencia: La papelera ha alcanzado su capacidad máxima de 80 registros.");
        return;
      }

      const movEliminado = typeof db !== "undefined" && db ? { ...historialMovimientos[0] } : historialMovimientos.shift();
      const idDocHistorial = movEliminado.idDoc;
      delete movEliminado.idDoc;

      const indexProd = inventario.findIndex(p => p.codigo.toUpperCase() === movEliminado.codigo.toUpperCase());
      
      if (indexProd !== -1) {
        let prod = { ...inventario[indexProd] };

        if (movEliminado.entrada > 0) {
          if (prod.stockInic >= movEliminado.entrada && prod.entradas === 0) {
            prod.stockInic -= movEliminado.entrada;
          } else {
            prod.entradas -= movEliminado.entrada;
            if (prod.entradas < 0) {
              prod.stockInic += prod.entradas;
              prod.entradas = 0;
              if (prod.stockInic < 0) prod.stockInic = 0;
            }
          }
        }
        
        if (movEliminado.salida > 0) {
          prod.salidas -= movEliminado.salida;
          if (prod.salidas < 0) prod.salidas = 0;
        }

        let stockCalculadoFinal = prod.stockInic + prod.entradas - prod.salidas;
        let aunTieneMovimientosEnHistorial = historialMovimientos.slice(1).some(m => m.codigo.toUpperCase() === prod.codigo.toUpperCase());

        if (typeof db !== "undefined" && db && prod.idDoc) {
          if (stockCalculadoFinal <= 0 && prod.stockInic === 0 && prod.entradas === 0 && !aunTieneMovimientosEnHistorial) {
            await db.collection("iapci_stock").doc(prod.idDoc).delete();
          } else {
            await db.collection("iapci_stock").doc(prod.idDoc).update({
              stockInic: prod.stockInic,
              entradas: prod.entradas,
              salidas: prod.salidas
            });
          }
        } else {
          if (stockCalculadoFinal <= 0 && prod.stockInic === 0 && prod.entradas === 0 && !aunTieneMovimientosEnHistorial) {
            inventario.splice(indexProd, 1);
          } else {
            inventario[indexProd] = prod;
          }
        }
      }

      if (typeof db !== "undefined" && db) {
        if (idDocHistorial) await db.collection("iapci_historial").doc(idDocHistorial).delete();
        await db.collection("iapci_papelera").add({ ...movEliminado, timestamp: Date.now() });
      } else {
        papeleraMovimientos.unshift(movEliminado);
        actualizarTodo();
      }

      alert("✅ El último registro ha sido eliminado del historial, descontado del stock correctamente, y enviado a la papelera.");
    } else {
      alert("No hay registros en el historial para eliminar.");
    }
  });
}

// --- 8. REPORTE GENERAL ---

function renderReporteGeneral() {
  let totalProd = inventario.length;
  let valorTotalBs = 0, stockDisponible = 0, totalSalidas = 0;
  let buenNivel = 0, bajoNivel = 0, agotados = 0;

  let categoriasMap = {};

  inventario.forEach(prod => {
    const stockAct = prod.stockInic + prod.entradas - prod.salidas;
    const valBs = stockAct * prod.precioBs;
    const catNombre = prod.categoria ? prod.categoria.trim() : "General";

    valorTotalBs += valBs;
    stockDisponible += stockAct;
    totalSalidas += prod.salidas;

    if (stockAct > prod.stockMin) {
      buenNivel++;
    } else if (stockAct > 0) {
      bajoNivel++;
    } else {
      agotados++;
    }

    if (!categoriasMap[catNombre]) {
      categoriasMap[catNombre] = { 
        productos: 0, stockTotal: 0, valorStockBs: 0, tieneBajoNivel: false, tieneAgotado: false 
      };
    }
    categoriasMap[catNombre].productos += 1;
    categoriasMap[catNombre].stockTotal += stockAct;
    categoriasMap[catNombre].valorStockBs += valBs;

    if (stockAct === 0) {
      categoriasMap[catNombre].tieneAgotado = true;
    } else if (stockAct <= prod.stockMin) {
      categoriasMap[catNombre].tieneBajoNivel = true;
    }
  });

  if (document.getElementById("card-total-productos")) document.getElementById("card-total-productos").textContent = totalProd;
  if (document.getElementById("card-valor-total")) document.getElementById("card-valor-total").textContent = `Bs.S ${valorTotalBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  if (document.getElementById("card-stock-disponible")) document.getElementById("card-stock-disponible").textContent = stockDisponible.toLocaleString('es-VE');
  if (document.getElementById("card-total-salidas")) document.getElementById("card-total-salidas").textContent = totalSalidas.toLocaleString('es-VE');

  if (document.getElementById("card-buen-nivel")) document.getElementById("card-buen-nivel").textContent = buenNivel;
  if (document.getElementById("card-bajo-nivel")) document.getElementById("card-bajo-nivel").textContent = bajoNivel;
  if (document.getElementById("card-agotados")) document.getElementById("card-agotados").textContent = agotados;

  if (document.getElementById("leyenda-buen-nivel")) document.getElementById("leyenda-buen-nivel").textContent = `${buenNivel} productos`;
  if (document.getElementById("leyenda-bajo-nivel")) document.getElementById("leyenda-bajo-nivel").textContent = `${bajoNivel} productos`;
  if (document.getElementById("leyenda-agotados")) document.getElementById("leyenda-agotados").textContent = `${agotados} productos`;

  const tbodyCat = document.getElementById("tabla-resumen-categoria");
  if (tbodyCat) {
    tbodyCat.innerHTML = "";
    let sumaCatProd = 0, sumaCatStock = 0, sumaCatValor = 0;

    for (const [catNombre, datos] of Object.entries(categoriasMap)) {
      sumaCatProd += datos.productos;
      sumaCatStock += datos.stockTotal;
      sumaCatValor += datos.valorStockBs;

      let estadoGralTexto = "✔ Buen Nivel";
      if (datos.tieneAgotado) {
        estadoGralTexto = "🚫 Agotado";
      } else if (datos.tieneBajoNivel) {
        estadoGralTexto = "⚠️ Bajo Nivel";
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${catNombre}</td>
        <td>${datos.productos}</td>
        <td>${datos.stockTotal.toLocaleString('es-VE')}</td>
        <td>${datos.valorStockBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td>${estadoGralTexto}</td>
      `;
      tbodyCat.appendChild(tr);
    }

    if (document.getElementById("cat-total-productos")) document.getElementById("cat-total-productos").textContent = sumaCatProd;
    if (document.getElementById("cat-total-stock")) document.getElementById("cat-total-stock").textContent = sumaCatStock.toLocaleString('es-VE');
    if (document.getElementById("cat-total-valor")) document.getElementById("cat-total-valor").textContent = sumaCatValor.toLocaleString('es-VE', { minimumFractionDigits: 2 });
    
    let estadoGlobalGeneral = "✔ Buen Nivel";
    if (agotados > 0) estadoGlobalGeneral = "🚫 Agotado";
    else if (bajoNivel > 0) estadoGlobalGeneral = "⚠️ Bajo Nivel";
    if (document.getElementById("cat-estado-general")) document.getElementById("cat-estado-general").textContent = estadoGlobalGeneral;
  }
}

// --- 9. PAPELERA DE RECICLAJE Y CONTROLES MODALES ---

function toggleModalPapelera() {
  const modal = document.getElementById("modal-papelera");
  if (modal) {
    modal.classList.toggle("oculto");
    if (!modal.classList.contains("oculto")) {
      renderTablaPapelera();
    }
  }
}

function renderTablaPapelera() {
  const contenedor = document.getElementById("contenedor-tabla-papelera") || document.getElementById("cuerpo-tabla-papelera");
  if (!contenedor) return;

  if (contenedor.tagName.toLowerCase() === "tbody") {
    contenedor.innerHTML = "";
    papeleraMovimientos.forEach((mov) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${mov.fecha}</td>
        <td>${mov.codigo}</td>
        <td>${mov.producto}</td>
        <td>${mov.categoria || '-'}</td>
        <td>${mov.pasillo || '-'}</td>
        <td>${mov.und || '-'}</td>
        <td>Bs.S ${mov.precio.toFixed(2)}</td>
        <td>${mov.entrada > 0 ? mov.entrada : ''}</td>
        <td>${mov.salida > 0 ? mov.salida : ''}</td>
        <td>${mov.observacion || '-'}</td>
      `;
      contenedor.appendChild(tr);
    });
    return;
  }

  let html = `
    <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd; padding-bottom: 8px;">
      <span style="font-size: 13px; color: #333; font-weight: bold;">Total en papelera: ${papeleraMovimientos.length} de ${CAPACIDAD_MAXIMA_PAPELERA} registros máximos</span>
    </div>
    <div style="max-height: 350px; overflow-y: auto; background: #ffffff; border-radius: 6px; border: 1px solid #ccc; padding: 5px;">
      <table style="width: 100%; border-collapse: collapse; background: #ffffff; color: #333; font-size: 12px;">
        <thead>
          <tr style="background: #343a40; color: #ffffff; text-align: left; position: sticky; top: 0; z-index: 2;">
            <th style="padding: 6px; text-align: center;"><input type="checkbox" id="chk-todos-papelera" onclick="seleccionarTodosPapelera(this)"></th>
            <th style="padding: 6px;">Fecha</th>
            <th style="padding: 6px;">Código</th>
            <th style="padding: 6px;">Producto</th>
            <th style="padding: 6px;">Categoría</th>
            <th style="padding: 6px;">Pasillo</th>
            <th style="padding: 6px;">UND.</th>
            <th style="padding: 6px;">Precio Bs.S</th>
            <th style="padding: 6px;">Precio USD ($)</th>
            <th style="padding: 6px;">Entrada</th>
            <th style="padding: 6px;">Salida</th>
            <th style="padding: 6px;">Precio Total Bs.S</th>
            <th style="padding: 6px;">Observaciones</th>
            <th style="padding: 6px; text-align: center;">Acción</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (papeleraMovimientos.length === 0) {
    html += `<tr><td colspan="14" style="text-align:center; padding: 25px; color: #666; background: #fff;">La papelera está vacía.</td></tr>`;
  } else {
    papeleraMovimientos.forEach((mov, index) => {
      const cantMov = mov.entrada > 0 ? mov.entrada : mov.salida;
      const precioTotal = cantMov * mov.precio;
      const precioUsd = mov.precio / tasaCambioBCV;

      html += `
        <tr style="border-bottom: 1px solid #dee2e6; background: #ffffff;">
          <td style="padding: 6px; text-align: center;"><input type="checkbox" class="chk-item-papelera" value="${index}"></td>
          <td style="padding: 6px;">${mov.fecha}</td>
          <td style="padding: 6px; font-weight: bold;">${mov.codigo}</td>
          <td style="padding: 6px;">${mov.producto}</td>
          <td style="padding: 6px;">${mov.categoria || '-'}</td>
          <td style="padding: 6px;">${mov.pasillo || '-'}</td>
          <td style="padding: 6px;">${mov.und || '-'}</td>
          <td style="padding: 6px;">Bs.S ${mov.precio.toFixed(2)}</td>
          <td style="padding: 6px;">$ ${precioUsd.toFixed(2)}</td>
          <td style="padding: 6px;">${mov.entrada > 0 ? mov.entrada : ''}</td>
          <td style="padding: 6px;">${mov.salida > 0 ? mov.salida : ''}</td>
          <td style="padding: 6px;">Bs.S ${precioTotal.toFixed(2)}</td>
          <td style="padding: 6px;">${mov.observacion || '-'}</td>
          <td style="padding: 6px; text-align: center;">
            <button onclick="restaurarRegistroPapelera(${index})" style="background:#28a745; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;">Restaurar</button>
          </td>
        </tr>
      `;
    });
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  contenedor.innerHTML = html;
}

function seleccionarTodosPapelera(source) {
  const checkboxes = document.querySelectorAll('.chk-item-papelera');
  checkboxes.forEach(chk => chk.checked = source.checked);
}

function restaurarRegistroPapelera(index) {
  verificarPermisoAdmin(async () => {
    if (index >= 0 && index < papeleraMovimientos.length) {
      const movRestaurar = papeleraMovimientos[index];
      const idDocPapelera = movRestaurar.idDoc;
      
      papeleraMovimientos.splice(index, 1);
      delete movRestaurar.idDoc;

      if (typeof db !== "undefined" && db) {
        if (idDocPapelera) await db.collection("iapci_papelera").doc(idDocPapelera).delete();
        await db.collection("iapci_historial").add({ ...movRestaurar, timestamp: Date.now() });

        const prodSnap = await db.collection("iapci_stock").where("codigo", "==", movRestaurar.codigo.toUpperCase()).get();
        if (!prodSnap.empty) {
          const docProd = prodSnap.docs[0];
          const dataProd = docProd.data();
          let incEntrada = movRestaurar.entrada > 0 ? dataProd.stockInic + movRestaurar.entrada : dataProd.stockInic;
          let incSalida = movRestaurar.salida > 0 ? dataProd.salidas + movRestaurar.salida : dataProd.salidas;
          await db.collection("iapci_stock").doc(docProd.id).update({
            stockInic: incEntrada,
            salidas: incSalida
          });
        } else if (movRestaurar.entrada > 0) {
          await db.collection("iapci_stock").add({
            codigo: movRestaurar.codigo,
            descripcion: movRestaurar.producto,
            categoria: movRestaurar.categoria || "General",
            pasillo: movRestaurar.pasillo || 0,
            und: movRestaurar.und || "UND",
            precioBs: movRestaurar.precio,
            stockInic: movRestaurar.entrada,
            entradas: 0,
            salidas: 0,
            stockMin: 12,
            obs: movRestaurar.observacion
          });
        }
      } else {
        historialMovimientos.unshift(movRestaurar);
        let prod = inventario.find(p => p.codigo.toUpperCase() === movRestaurar.codigo.toUpperCase());
        if (!prod && movRestaurar.entrada > 0) {
          inventario.push({
            codigo: movRestaurar.codigo,
            descripcion: movRestaurar.producto,
            categoria: movRestaurar.categoria || "General",
            pasillo: movRestaurar.pasillo || 0,
            und: movRestaurar.und || "UND",
            precioBs: movRestaurar.precio,
            stockInic: movRestaurar.entrada,
            entradas: 0,
            salidas: 0,
            stockMin: 12,
            obs: movRestaurar.observacion
          });
        } else if (prod) {
          if (movRestaurar.entrada > 0) prod.stockInic += movRestaurar.entrada;
          if (movRestaurar.salida > 0) prod.salidas += movRestaurar.salida;
        }
        actualizarTodo();
      }

      renderTablaPapelera();
      alert("✅ Registro restaurado correctamente y sincronizado en stock.");
    }
  });
}

function vaciarPapelera() {
  verificarPermisoAdmin(async () => {
    if (papeleraMovimientos.length === 0) {
      alert("La papelera ya está vacía.");
      return;
    }
    if (confirm("⚠️ ¿Está seguro de que desea vaciar permanentemente toda la papelera?")) {
      if (typeof db !== "undefined" && db) {
        const snapshot = await db.collection("iapci_papelera").get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      } else {
        papeleraMovimientos = [];
        guardarEstadoSistema();
      }
      renderTablaPapelera();
      alert("✅ Papelera vaciada con éxito.");
    }
  });
}

function eliminarSeleccionadosPapelera() {
  verificarPermisoAdmin(async () => {
    const checkboxes = document.querySelectorAll('.chk-item-papelera:checked');
    
    if (checkboxes.length === 0) {
      alert("⚠️ Por favor selecciona al menos un registro de la papelera usando las casillas para poder eliminarlo.");
      return;
    }

    if (confirm(`¿Estás segura de eliminar permanentemente ${checkboxes.length} registro(s) seleccionado(s)?`)) {
      const indicesAEliminar = Array.from(checkboxes).map(chk => parseInt(chk.value)).sort((a, b) => b - a);

      for (const index of indicesAEliminar) {
        if (index >= 0 && index < papeleraMovimientos.length) {
          const item = papeleraMovimientos[index];
          if (typeof db !== "undefined" && db && item.idDoc) {
            await db.collection("iapci_papelera").doc(item.idDoc).delete();
          } else {
            papeleraMovimientos.splice(index, 1);
          }
        }
      }

      if (typeof db === "undefined" || !db) guardarEstadoSistema();
      renderTablaPapelera();
      alert("✅ Los registros seleccionados han sido eliminados definitivamente.");
    }
  });
}
