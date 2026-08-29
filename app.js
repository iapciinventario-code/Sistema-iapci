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
      mostrarToast("⚠️ Su sesión ha sido cerrada porque este usuario/rol acaba de iniciar sesión en otra computadora o ventana.", "warning");
    }
  } else if (mensaje.tipo === "ACTUALIZAR_ESTADO_SISTEMA") {
    if (usuarioActual) {
      renderTablaStock();
      renderTablaHistorial();
      renderReporteGeneral();
    }
  }
};

// --- UTILIDADES DE NOTIFICACIÓN Y DIÁLOGOS MOSTRADOS EN PANTALLA ---
function mostrarToast(mensaje, tipo = 'info') {
  let container = document.getElementById("iapci-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "iapci-toast-container";
    container.style.cssText = "position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 10px;";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  let bgColor = "#2980b9";
  if (tipo === 'success') bgColor = "#27ae60";
  if (tipo === 'error') bgColor = "#c0392b";
  if (tipo === 'warning') bgColor = "#f39c12";

  toast.style.cssText = `background: ${bgColor}; color: white; padding: 12px 20px; border-radius: 6px; font-size: 13px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transform: translateY(-10px); transition: all 0.3s ease; max-width: 380px;`;
  toast.textContent = mensaje;
  container.appendChild(toast);

  setTimeout(() => { toast.style.opacity = "1"; toast.style.transform = "translateY(0)"; }, 10);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function solicitarConfirmacion(mensaje, accionConfirmada) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index: 999999;";
  const box = document.createElement("div");
  box.style.cssText = "background: white; padding: 24px; border-radius: 8px; max-width: 420px; width: 90%; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.3); font-family: sans-serif;";
  box.innerHTML = `
    <h3 style="margin-top:0; color:#2c3e50; font-size: 16px;">⚠️ Confirmación Requerida</h3>
    <p style="font-size: 13px; color:#555; white-space: pre-line; line-height: 1.4;">${mensaje}</p>
    <div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
      <button id="btn-conf-si" style="background:#27ae60; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer;">Sí, Continuar</button>
      <button id="btn-conf-no" style="background:#95a5a6; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer;">Cancelar</button>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  box.querySelector("#btn-conf-si").onclick = () => { document.body.removeChild(overlay); accionConfirmada(); };
  box.querySelector("#btn-conf-no").onclick = () => { document.body.removeChild(overlay); };
}

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

// --- STREAMING_CHUNK:Verificando sesión previa al cargar ---
window.addEventListener("DOMContentLoaded", () => {
  const usuarioGuardado = localStorage.getItem("iapci_usuario_activo_nombre");
  if (usuarioGuardado && usuarios[usuarioGuardado]) {
    usuarioActual = usuarios[usuarioGuardado];
    document.getElementById("pantalla-login")?.classList.add("oculto");
    document.getElementById("pantalla-sistema")?.classList.remove("oculto");
    document.getElementById("rol-usuario-lbl").textContent = `Usuario: ${usuarioGuardado.toUpperCase()} (${usuarioActual.rol})`;
    document.getElementById("f-fecha").value = new Date().toLocaleDateString();
    
    const inputTasaElem = document.getElementById("f-tasa-cambio");
    if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;

    const lblTasa = document.getElementById("lbl-tasa-actual");
    if (lblTasa) lblTasa.textContent = `Bs. ${tasaCambioBCV.toFixed(2)} / $`;

    aplicarPermisos();
    actualizarTodo();
  }
});

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
    mostrarToast("Los nombres de usuario no pueden estar vacíos.", "warning");
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
  mostrarToast("✅ Credenciales de usuarios actualizadas exitosamente.", "success");
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
    localStorage.setItem("iapci_usuario_activo_nombre", userInput);

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
    let adminKey = Object.keys(usuarios).find(u => usuarios[u].rol === "Administrador");
    let passAdminReal = adminKey ? usuarios[adminKey].clave : "admin123";

    const overlay = document.createElement("div");
    overlay.style.cssText = "position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index: 999999;";
    
    const box = document.createElement("div");
    box.style.cssText = "background: white; padding: 24px; border-radius: 8px; max-width: 360px; width: 90%; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.3); font-family: sans-serif;";
    
    box.innerHTML = `
      <h3 style="margin-top:0; color:#2c3e50; font-size: 15px;">🔒 Acción Restringida</h3>
      <p style="font-size: 12px; color:#666;">Introduzca la clave del Administrador para continuar:</p>
      <input type="password" id="input-clave-admin-val" style="width: 100%; padding: 8px; box-sizing: border-box; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 4px;" placeholder="Clave admin">
      <div style="display:flex; gap:10px; justify-content:center;">
        <button id="btn-val-admin" style="background:#27ae60; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer;">Aceptar</button>
        <button id="btn-canc-admin" style="background:#95a5a6; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer;">Cancelar</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const inputPass = box.querySelector("#input-clave-admin-val");
    inputPass.focus();

    box.querySelector("#btn-val-admin").onclick = () => {
      const val = inputPass.value;
      document.body.removeChild(overlay);
      if (val === passAdminReal) {
        accionCallback();
      } else {
        mostrarToast("❌ Clave de administrador incorrecta", "error");
        const inputTasaElem = document.getElementById("f-tasa-cambio");
        if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;
      }
    };

    box.querySelector("#btn-canc-admin").onclick = () => {
      document.body.removeChild(overlay);
      const inputTasaElem = document.getElementById("f-tasa-cambio");
      if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;
    };
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
      mostrarToast("❌ Por favor introduzca una tasa de cambio válida.", "warning");
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
    mostrarToast(`✅ Tasa del día actualizada exitosamente a Bs. ${tasaCambioBCV.toFixed(2)} / $`, "success");
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
    localStorage.removeItem("iapci_usuario_activo_nombre");
  }
  usuarioActual = null;
  document.getElementById("pantalla-sistema")?.classList.add("oculto");
  document.getElementById("pantalla-login")?.classList.remove("oculto");
  document.getElementById("input-usuario").value = "";
  document.getElementById("input-clave").value = "";
}

// Eliminado el evento beforeunload que limpiaba el usuario activo para permitir persistencia al recargar la página.

// --- 6. OPERACIONES DE INVENTARIO Y STOCK ---

function renderTablaStock(codigoResaltar = null) {
  const tbody = document.getElementById("cuerpo-tabla-stock");
  if (!tbody) return;
  tbody.innerHTML = "";

  let totalInic = 0, totalEntradas = 0, totalSalidas = 0, totalStockActual = 0, valorTotalDisponibleBs = 0;

  inventario.forEach((prod, index) => {
    const stockActual = prod.stockInic + prod.entradas - prod.salidas;
    const valorDisponibleBs = stockActual * prod.precioBs;
    
    const estado = stockActual > (prod.stockMin !== undefined ? prod.stockMin : 12) ? "Buen Nivel" : (stockActual > 0 ? "Bajo Nivel" : "Agotado");
    const claseBadge = stockActual > (prod.stockMin !== undefined ? prod.stockMin : 12) ? "badge-buen" : (stockActual > 0 ? "badge-bajo" : "badge-agotado");

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
      <td>${prod.stockMin !== undefined ? prod.stockMin : 12}</td>
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
    mostrarToast("❌ Acceso denegado. El rol de Asistente no tiene permisos para editar el estatus y stock.", "error");
    return;
  }

  let prod = { ...inventario[index] };
  let stockActualCalculado = prod.stockInic + prod.entradas - prod.salidas;

  const overlay = document.createElement("div");
  overlay.style.cssText = "position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index: 999999;";
  
  const box = document.createElement("div");
  box.style.cssText = "background: white; padding: 20px 24px; border-radius: 8px; max-width: 520px; width: 92%; max-height: 90vh; overflow-y: auto; font-family: sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.25);";
  
  const nombreUsuarioActivo = localStorage.getItem("iapci_usuario_activo_nombre")?.toUpperCase() || usuarioActual.rol;

  box.innerHTML = `
    <div style="border-bottom:2px solid #34495e; padding-bottom:10px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h3 style="margin:0; color:#2c3e50; font-size: 16px;">✏️ Edición Completa de Producto</h3>
        <span style="font-size:11px; background:#e8f4f8; color:#2980b9; padding:2px 6px; border-radius:4px; font-weight:bold; display:inline-block; margin-top:4px;">
          👤 Editor: ${nombreUsuarioActivo} (${usuarioActual.rol})
        </span>
      </div>
      <span style="font-size:12px; font-weight:bold; color:#7f8c8d;">Código: ${prod.codigo}</span>
    </div>

    <div style="background:#f8f9fa; padding:12px; border-radius:6px; border-left:4px solid #3498db; margin-bottom:15px;">
      <h4 style="margin:0 0 10px 0; font-size:12px; color:#2c3e50; text-transform:uppercase;">📌 1. Información General del Producto</h4>
      
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
        <div>
          <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Código del Producto:</label>
          <input type="text" id="ed-cod" value="${prod.codigo}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px;">
        </div>
        <div>
          <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Categoría:</label>
          <input type="text" id="ed-cat" value="${prod.categoria || ''}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px;">
        </div>
      </div>

      <div style="margin-bottom:10px;">
        <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Descripción / Nombre del Producto:</label>
        <input type="text" id="ed-desc" value="${prod.descripcion || ''}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px;">
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div>
          <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Pasillo:</label>
          <input type="number" id="ed-pas" value="${prod.pasillo !== undefined ? prod.pasillo : 0}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px;">
        </div>
        <div>
          <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Unidad (UND):</label>
          <input type="text" id="ed-und" value="${prod.und || 'UND'}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px;">
        </div>
      </div>
    </div>

    <div style="background:#fef9e7; padding:12px; border-radius:6px; border-left:4px solid #f39c12; margin-bottom:15px;">
      <h4 style="margin:0 0 10px 0; font-size:12px; color:#7d6608; text-transform:uppercase;">📊 2. Control de Inventario, Precios y Stock</h4>
      
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
        <div>
          <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Precio en Bs.S:</label>
          <input type="number" id="ed-precio" value="${prod.precioBs}" step="0.01" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px;">
        </div>
        <div>
          <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Stock Mínimo (Alerta):</label>
          <input type="number" id="ed-stkmin" value="${prod.stockMin !== undefined ? prod.stockMin : 12}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px;">
        </div>
      </div>

      <div style="margin-bottom:10px;">
        <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Stock Actual Total (Calculado: Inic + Ent - Sal):</label>
        <input type="number" id="ed-stk" value="${stockActualCalculado}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px; background:#fff3cd; font-weight:bold;">
        <span style="font-size:10px; color:#666; display:block; margin-top:2px;">(Modificar este valor ajustará automáticamente el stock inicial base).</span>
      </div>

      <div>
        <label style="font-size:11px; font-weight:bold; color:#555; display:block; margin-bottom:3px;">Observaciones / Notas:</label>
        <input type="text" id="ed-obs" value="${prod.obs || ''}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid #ccc; border-radius:4px; font-size:12px;">
      </div>
    </div>

    <div style="display:flex; gap:10px; justify-content:space-between; align-items:center; border-top:1px solid #eee; padding-top:12px;">
      <button id="btn-eliminar-prod-ed" style="background:#c0392b; color:white; border:none; padding:8px 14px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">🗑️ Borrar y Enviar a Papelera</button>
      <div style="display:flex; gap:10px;">
        <button id="btn-save-ed" style="background:#27ae60; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">💾 Guardar Cambios</button>
        <button id="btn-canc-ed" style="background:#95a5a6; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">Cancelar</button>
      </div>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  box.querySelector("#btn-eliminar-prod-ed").onclick = () => {
    solicitarConfirmacion(`¿Está seguro de eliminar por completo el producto "${prod.codigo} - ${prod.descripcion}" y enviarlo a la papelera?`, async () => {
      document.body.removeChild(overlay);
      
      const productoEliminado = inventario.splice(index, 1)[0];
      if (typeof db !== "undefined" && db && productoEliminado.idDoc) {
        await db.collection("iapci_stock").doc(productoEliminado.idDoc).delete();
      }

      const movLimpioParaPapelera = {
        fecha: new Date().toLocaleDateString(),
        codigo: prod.codigo,
        producto: prod.descripcion,
        categoria: prod.categoria,
        pasillo: prod.pasillo,
        und: prod.und,
        precio: prod.precioBs,
        entrada: 0,
        salida: prod.stockInic + prod.entradas - prod.salidas,
        observacion: `ELIMINADO DESDE MODAL DE STOCK`,
        timestamp: Date.now(),
        productoEliminadoSnapshot: productoEliminado
      };

      papeleraMovimientos.unshift(movLimpioParaPapelera);

      if (typeof db !== "undefined" && db) {
        const docRefPapelera = await db.collection("iapci_papelera").add(movLimpioParaPapelera);
        movLimpioParaPapelera.idDoc = docRefPapelera.id;
      }

      actualizarTodo();
      mostrarToast(`🗑️ El producto "${prod.codigo}" ha sido eliminado y enviado a la papelera.`, "info");
    });
  };

  box.querySelector("#btn-save-ed").onclick = async () => {
    const nuevoCodigo = box.querySelector("#ed-cod").value.trim().toUpperCase() || prod.codigo;
    const nuevaDesc = box.querySelector("#ed-desc").value.trim().toUpperCase() || prod.descripcion;
    const nuevaCat = box.querySelector("#ed-cat").value.trim() || prod.categoria;
    const nuevoPas = parseInt(box.querySelector("#ed-pas").value) || 0;
    const nuevaUnd = box.querySelector("#ed-und").value.trim() || prod.und;
    const nuevoPrecio = parseFloat(box.querySelector("#ed-precio").value) || prod.precioBs;
    const nuevoStockMin = parseInt(box.querySelector("#ed-stkmin").value) || (prod.stockMin !== undefined ? prod.stockMin : 12);
    const nuevaObs = box.querySelector("#ed-obs").value.trim() || prod.obs;

    const stockDeseado = parseInt(box.querySelector("#ed-stk").value);

    let cambios = [];
    if (nuevoCodigo !== prod.codigo) cambios.push("Código");
    if (nuevaDesc !== prod.descripcion) cambios.push("Descripción");
    if (nuevaCat !== prod.categoria) cambios.push("Categoría");
    if (nuevoPas !== prod.pasillo) cambios.push("Pasillo");
    if (nuevaUnd !== prod.und) cambios.push("Unidad");
    if (nuevoPrecio !== prod.precioBs) cambios.push("Precio Bs");
    if (nuevoStockMin !== prod.stockMin) cambios.push("Stock Mínimo");
    if (nuevaObs !== prod.obs) cambios.push("Observaciones");

    if (!isNaN(stockDeseado) && stockDeseado !== stockActualCalculado) {
      prod.stockInic = stockDeseado - prod.entradas + prod.salidas;
      if (prod.stockInic < 0) prod.stockInic = 0;
      cambios.push(`Stock (${stockActualCalculado} ➔ ${stockDeseado})`);
    }

    prod.codigo = nuevoCodigo;
    prod.descripcion = nuevaDesc;
    prod.categoria = nuevaCat;
    prod.pasillo = nuevoPas;
    prod.und = nuevaUnd;
    prod.precioBs = nuevoPrecio;
    prod.stockMin = nuevoStockMin;
    prod.obs = nuevaObs;

    inventario[index] = prod;

    if (typeof db !== "undefined" && db && prod.idDoc) {
      const docRef = db.collection("iapci_stock").doc(prod.idDoc);
      const prodCopia = { ...prod };
      delete prodCopia.idDoc;
      await docRef.set(prodCopia);
    }

    document.body.removeChild(overlay);
    actualizarTodo(prod.codigo);

    const detalleCambios = cambios.length > 0 ? ` (${cambios.join(", ")})` : "";
    mostrarToast(`✅ Producto "${prod.codigo}" modificado por ${usuarioActual.rol}${detalleCambios}.`, "success");
  };

  box.querySelector("#btn-canc-ed").onclick = () => {
    document.body.removeChild(overlay);
  };
}

function limpiarFormulario() {
  document.getElementById("f-codigo").value = "";
  document.getElementById("f-producto").value = "";
  document.getElementById("f-categoria").value = "";
  document.getElementById("f-pasillo").value = "";
  document.getElementById("f-und").value = "";
  document.getElementById("f-precio").value = "";
  document.getElementById("f-cantidad").value = "";
  document.getElementById("f-stock-min").value = "12";
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
    const stockMinInput = parseInt(document.getElementById("f-stock-min")?.value) || 12;
    const obs = document.getElementById("f-observacion").value.trim() || `Nuevo producto ${new Date().toLocaleDateString()}`;

    if (!codigo || !descripcion) {
      mostrarToast("Por favor introduce el Código y la Descripción antes de crear el nuevo producto.", "warning");
      return;
    }

    const existe = inventario.some(p => p.codigo.toUpperCase() === codigo);
    if (existe) {
      mostrarToast("❌ El código de producto ya existe en el inventario. Utilice 'Registrar Entrada' para reabastecer.", "warning");
      return;
    }

    const nuevoProdObj = {
      codigo, descripcion, categoria, pasillo, und, precioBs, stockInic: cantInic, entradas: 0, salidas: 0, stockMin: stockMinInput, obs
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

    mostrarToast(`✅ Producto "${descripcion}" guardado exitosamente.`, "success");
    limpiarFormulario();
    cambiarPestana('registro');
  });
}

function buscarCodigo() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  if (!codigo) {
    mostrarToast("Escribe un Código de producto en el campo para buscar.", "warning");
    return;
  }

  const prod = inventario.find(p => p.codigo.toUpperCase() === codigo);
  if (prod) {
    document.getElementById("f-codigo").value = prod.codigo;
    document.getElementById("f-producto").value = prod.descripcion;
    document.getElementById("f-categoria").value = prod.categoria;
    document.getElementById("f-pasillo").value = prod.pasillo;
    document.getElementById("f-und").value = prod.und;
    if (document.getElementById("f-stock-min")) {
      document.getElementById("f-stock-min").value = prod.stockMin !== undefined ? prod.stockMin : 12;
    }
    
    document.getElementById("f-precio").value = "";
    document.getElementById("f-cantidad").value = "";
    document.getElementById("f-observacion").value = "";
    
    cambiarPestana('stock');
    renderTablaStock(prod.codigo);
  } else {
    mostrarToast("El código ingresado no existe en el registro.", "warning");
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

    mostrarToast(`📥 Entrada de ${cant} ${prod.und} registrada.`, "success");
    limpiarFormulario();
    cambiarPestana('registro');
  } else {
    mostrarToast("Código no hallado o cantidad inválida.", "warning");
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
      mostrarToast(`⚠️ Advertencia: La cantidad a retirar (${cant}) supera el stock disponible (${stockActualCalculado}).`, "warning");
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
    
    mostrarToast(`📤 Salida de ${cant} ${prod.und} registrada.`, "success");
    limpiarFormulario();
    cambiarPestana('registro');
  } else {
    mostrarToast("Código no hallado o cantidad inválida.", "warning");
  }
}

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
    try {
      if (!historialMovimientos || historialMovimientos.length === 0) {
        mostrarToast("No hay registros en el historial para eliminar.", "info");
        return;
      }

      if (papeleraMovimientos.length >= CAPACIDAD_MAXIMA_PAPELERA) {
        mostrarToast("⚠️ Advertencia: La papelera ha alcanzado su capacidad máxima de 80 registros. Vacíe la papelera para continuar.", "warning");
        return;
      }

      solicitarConfirmacion("¿Desea eliminar el último movimiento registrado, remover completamente el producto del inventario de estatus y stock, y enviarlo a la papelera?", async () => {
        try {
          const movEliminado = historialMovimientos.shift();
          if (!movEliminado) return;

          const idDocHistorial = movEliminado.idDoc;
          const codigoMov = (movEliminado.codigo || "").toUpperCase();
          const indexProd = inventario.findIndex(p => (p.codigo || "").toUpperCase() === codigoMov);

          let productoEliminadoInventario = null;
          if (indexProd !== -1) {
            productoEliminadoInventario = inventario.splice(indexProd, 1)[0];
            if (typeof db !== "undefined" && db && productoEliminadoInventario.idDoc) {
              await db.collection("iapci_stock").doc(productoEliminadoInventario.idDoc).delete();
            }
          }

          const movLimpioParaPapelera = { 
            ...movEliminado, 
            productoEliminadoSnapshot: productoEliminadoInventario || null 
          };
          delete movLimpioParaPapelera.idDoc;
          movLimpioParaPapelera.timestamp = Date.now();

          papeleraMovimientos.unshift(movLimpioParaPapelera);

          if (typeof db !== "undefined" && db) {
            try {
              if (idDocHistorial) {
                await db.collection("iapci_historial").doc(idDocHistorial).delete();
              }
              const docRefPapelera = await db.collection("iapci_papelera").add(movLimpioParaPapelera);
              movLimpioParaPapelera.idDoc = docRefPapelera.id;
            } catch (eFire) {
              console.error("Error al sincronizar papelera/historial en Firestore:", eFire);
            }
          }

          actualizarTodo();
          mostrarToast("🗑 El registro ha sido eliminado del estatus y stock y enviado a la papelera correctamente.", "info");
        } catch (err) {
          console.error("Error al eliminar registro:", err);
          mostrarToast("❌ Ocurrió un error al procesar la eliminación.", "error");
        }
      });
    } catch (e) {
      console.error("Error en permisos de eliminación:", e);
    }
  });
}

function renderReporteGeneral() {
  let totalProd = inventario.length;
  let valorTotalBs = 0, stockDisponible = 0, totalSalidas = 0;
  let buenNivel = 0, bajoNivel = 0, agotados = 0;

  let categoriasMap = {};

  inventario.forEach(prod => {
    const stockAct = prod.stockInic + prod.entradas - prod.salidas;
    const valBs = stockAct * prod.precioBs;
    const catNombre = prod.categoria ? prod.categoria.trim() : "General";
    const minStockVal = prod.stockMin !== undefined ? prod.stockMin : 12;

    valorTotalBs += valBs;
    stockDisponible += stockAct;
    totalSalidas += prod.salidas;

    if (stockAct > minStockVal) {
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
    } else if (stockAct <= minStockVal) {
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
      
      const productoSnapshot = movRestaurar.productoEliminadoSnapshot;
      delete movRestaurar.idDoc;
      delete movRestaurar.productoEliminadoSnapshot;

      const codigoRestaurar = (movRestaurar.codigo || "").toUpperCase();

      historialMovimientos.unshift({ ...movRestaurar, timestamp: Date.now() });

      let prod = inventario.find(p => (p.codigo || "").toUpperCase() === codigoRestaurar);
      
      if (!prod) {
        const nuevoProd = productoSnapshot ? { ...productoSnapshot } : {
          codigo: movRestaurar.codigo,
          descripcion: movRestaurar.producto,
          categoria: movRestaurar.categoria || "General",
          pasillo: movRestaurar.pasillo || 0,
          und: movRestaurar.und || "UND",
          precioBs: movRestaurar.precio || 0,
          stockInic: movRestaurar.entrada > 0 ? movRestaurar.entrada : 0,
          entradas: 0,
          salidas: movRestaurar.salida > 0 ? movRestaurar.salida : 0,
          stockMin: 12,
          obs: movRestaurar.observacion || "RESTAURADO DESDE PAPELERA"
        };
        
        delete nuevoProd.idDoc;
        inventario.push(nuevoProd);

        if (typeof db !== "undefined" && db) {
          const docRefStock = await db.collection("iapci_stock").add(nuevoProd);
          nuevoProd.idDoc = docRefStock.id;
        }
      } else {
        if (movRestaurar.entrada > 0) {
          prod.entradas += movRestaurar.entrada;
        }
        if (movRestaurar.salida > 0) {
          prod.salidas += movRestaurar.salida;
        }
        if (movRestaurar.precio > 0) prod.precioBs = movRestaurar.precio;

        if (typeof db !== "undefined" && db && prod.idDoc) {
          await db.collection("iapci_stock").doc(prod.idDoc).update({
            stockInic: prod.stockInic,
            entradas: prod.entradas,
            salidas: prod.salidas,
            precioBs: prod.precioBs
          });
        }
      }

      if (typeof db !== "undefined" && db) {
        if (idDocPapelera) {
          await db.collection("iapci_papelera").doc(idDocPapelera).delete();
        }
        await db.collection("iapci_historial").add({ ...movRestaurar, timestamp: Date.now() });
      }

      actualizarTodo(codigoRestaurar);
      mostrarToast("✅ Registro restaurado de la papelera exitosamente y devuelto al inventario de estatus y stock.", "success");
      renderTablaPapelera();
    }
  });
}

function eliminarSeleccionadosPapelera() {
  verificarPermisoAdmin(async () => {
    const seleccionados = Array.from(document.querySelectorAll('.chk-item-papelera:checked'))
      .map(chk => parseInt(chk.value))
      .sort((a, b) => b - a);

    if (seleccionados.length === 0) {
      mostrarToast("⚠️ Seleccione al menos un elemento de la papelera.", "warning");
      return;
    }

    solicitarConfirmacion(`¿Está seguro de eliminar definitivamente los ${seleccionados.length} elementos seleccionados?`, async () => {
      for (const index of seleccionados) {
        if (index >= 0 && index < papeleraMovimientos.length) {
          const item = papeleraMovimientos[index];
          if (typeof db !== "undefined" && db && item.idDoc) {
            await db.collection("iapci_papelera").doc(item.idDoc).delete();
          }
          papeleraMovimientos.splice(index, 1);
        }
      }
      guardarEstadoSistema();
      mostrarToast(`✅ ${seleccionados.length} elementos eliminados permanentemente.`, "info");
      renderTablaPapelera();
    });
  });
}

function vaciarPapelera() {
  verificarPermisoAdmin(async () => {
    if (papeleraMovimientos.length === 0) {
      mostrarToast("La papelera ya está vacía.", "info");
      return;
    }

    solicitarConfirmacion("⚠️ ¿Está seguro de que desea vaciar permanentemente toda la papelera? Esta acción no se puede deshacer.", async () => {
      try {
        if (typeof db !== "undefined" && db) {
          const snapshot = await db.collection("iapci_papelera").get();
          const batch = db.batch();
          snapshot.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      } catch (error) {
        console.error("Error al vaciar papelera en Firestore:", error);
      }

      papeleraMovimientos = [];
      guardarEstadoSistema();
      renderTablaPapelera();
      mostrarToast("✅ Papelera vaciada con éxito.", "success");
    });
  });
}
