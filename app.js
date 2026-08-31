// ==========================================
// CEREBRO UNIFICADO DEL SISTEMA - IAPCI 2026
// (Adaptado a Base de Datos Remota: Firebase Firestore)
// ==========================================

// --- 0. CONFIGURACIÓN E INICIALIZACIÓN DE FIREBASE ---
// ⚠️ ASEGÚRATE DE REEMPLAZAR ESTOS DATOS CON LOS DE TU PROYECTO DE FIREBASE
const firebaseConfig = {
 apiKey: "AIzaSyDYOOtrqzSTS8vmWpBL7-YHldXVU6tudk0",
  authDomain: "sistema-iapci.firebaseapp.com",
  databaseURL: "https://sistema-iapci-default-rtdb.firebaseio.com",
  projectId: "sistema-iapci",
  storageBucket: "sistema-iapci.firebasestorage.app",
  messagingSenderId: "84463581447",
  appId: "1:84463581447:web:0a1146829d38ba06fe2da2",
  measurementId: "G-L4638HK45V"
};

// Inicializar Firebase (Verificando si ya fue cargado previamente)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// --- 1. FUNCIÓN DE IMPRESIÓN DE REPORTE GENERAL ---
function imprimirReporte() {
  cambiarPestana('reporte');
  setTimeout(() => {
    window.print();
  }, 200);
}

// --- 2. COMUNICACIÓN Y CONTROL DE SESIÓN ÚNICA ENTRE PESTAÑAS ---
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
  }
};

// --- UTILIDADES DE NOTIFICACIÓN Y DIÁLOGOS ---
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
  }, 5000);
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

// --- 3. ESTADO GLOBAL Y SINCRONIZACIÓN EN TIEMPO REAL CON FIRESTORE ---
let usuarios = {
  "soporte": { clave: "1234", rol: "Soporte Técnico" },
  "admin": { clave: "admin123", rol: "Administrador" },
  "asistente": { clave: "asi123", rol: "Asistente" }
};
let usuarioActual = null;
let tasaCambioBCV = 36.50;

let inventario = [];
let historialMovimientos = [];
let papeleraMovimientos = [];
const CAPACIDAD_MAXIMA_PAPELERA = 100;

let estadosAnterioresInventario = {};

function inicializarMapaEstados() {
  estadosAnterioresInventario = {};
  inventario.forEach(prod => {
    const stockActual = prod.stockInic + prod.entradas - prod.salidas;
    const stockMinVal = prod.stockMin !== undefined ? prod.stockMin : 12;
    let estado = "Buen Nivel";
    if (stockActual <= 0) estado = "Agotado";
    else if (stockActual <= stockMinVal) estado = "Bajo Nivel";
    estadosAnterioresInventario[prod.codigo.toUpperCase()] = estado;
  });
}

// 🔄 OYENTES EN TIEMPO REAL DE FIRESTORE (Remoto)
function iniciarListenersRemotos() {
  // Sincronizar Inventario / Stock
  db.collection("iapci_stock").onSnapshot((snapshot) => {
    inventario = [];
    snapshot.forEach(doc => {
      inventario.push({ idDoc: doc.id, ...doc.data() });
    });
    detectarYNotificarCambiosDeEstatus();
    actualizarTodo();
  }, (error) => {
    console.error("Error al escuchar inventario remoto:", error);
  });

  // Sincronizar Historial
  db.collection("iapci_historial").orderBy("timestamp", "desc").onSnapshot((snapshot) => {
    historialMovimientos = [];
    snapshot.forEach(doc => {
      historialMovimientos.push({ idDoc: doc.id, ...doc.data() });
    });
    renderTablaHistorial();
  }, (error) => {
    console.error("Error al escuchar historial remoto:", error);
  });

  // Sincronizar Tasa BCV
  db.collection("iapci_tasa").doc("bcv").onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      tasaCambioBCV = data.tasa || 36.50;
      const inputTasaElem = document.getElementById("f-tasa-cambio");
      if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;
      const lblTasa = document.getElementById("lbl-tasa-actual");
      if (lblTasa) lblTasa.textContent = `Bs. ${tasaCambioBCV.toFixed(2)} / $`;
      actualizarTodo();
    }
  });

  // Sincronizar Usuarios
  db.collection("iapci_usuarios").onSnapshot((snapshot) => {
    if (!snapshot.empty) {
      let tempUsuarios = {};
      snapshot.forEach(doc => {
        tempUsuarios[doc.id] = doc.data();
      });
      usuarios = tempUsuarios;
    }
  });

  // Sincronizar Papelera
  db.collection("iapci_papelera").onSnapshot((snapshot) => {
    papeleraMovimientos = [];
    snapshot.forEach(doc => {
      papeleraMovimientos.push({ idDoc: doc.id, ...doc.data() });
    });
    if (!document.getElementById("modal-papelera")?.classList.contains("oculto")) {
      renderTablaPapelera();
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  iniciarListenersRemotos();

  const usuarioGuardado = localStorage.getItem("iapci_usuario_activo_nombre");
  setTimeout(() => {
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

      inicializarMapaEstados();
      aplicarPermisos();
      actualizarTodo();
    }
  }, 1000); // Pequeña pausa para asegurar carga inicial de Firebase
});

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

  try {
    const batch = db.batch();
    const snapshot = await db.collection("iapci_usuarios").get();
    snapshot.forEach(doc => batch.delete(doc.ref));

    for (const uKey in nuevosUsuarios) {
      batch.set(db.collection("iapci_usuarios").doc(uKey), nuevosUsuarios[uKey]);
    }
    await batch.commit();
    mostrarToast("✅ Credenciales de usuarios actualizadas en Firestore.", "success");
    toggleModalUsuarios();
  } catch (e) {
    console.error("Error al actualizar usuarios en Firestore:", e);
    mostrarToast("❌ Error al actualizar usuarios en la base de datos.", "error");
  }
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

    try {
      await db.collection("iapci_tasa").doc("bcv").set({
        tasa: tasaCambioBCV,
        fecha: hoyStr
      });
      mostrarToast(`✅ Tasa actualizada en Firestore a Bs. ${tasaCambioBCV.toFixed(2)} / $`, "success");
    } catch (e) {
      console.error("Error al guardar tasa en Firestore:", e);
    }
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

// --- 6. OPERACIONES DE INVENTARIO Y STOCK ---
function actualizarTodo(codigoResaltar = null, indiceHistorialResaltar = null) {
  detectarYNotificarCambiosDeEstatus();
  renderTablaStock(codigoResaltar);
  renderTablaHistorial(indiceHistorialResaltar);
  renderReporteGeneral();
}

function detectarYNotificarCambiosDeEstatus() {
  inventario.forEach(prod => {
    const codigoKey = prod.codigo.toUpperCase();
    const stockActual = prod.stockInic + prod.entradas - prod.salidas;
    const stockMinVal = prod.stockMin !== undefined ? prod.stockMin : 12;
    
    let estadoActual = "Buen Nivel";
    if (stockActual <= 0) {
      estadoActual = "Agotado";
    } else if (stockActual <= stockMinVal) {
      estadoActual = "Bajo Nivel";
    }

    const estadoAnterior = estadosAnterioresInventario[codigoKey];

    if (estadoAnterior && estadoAnterior !== estadoActual) {
      const descProd = prod.descripcion || prod.codigo;
      let tipoNotif = "info";
      let icono = "ℹ️";

      if (estadoActual === "Buen Nivel") { tipoNotif = "success"; icono = "✅"; }
      else if (estadoActual === "Bajo Nivel") { tipoNotif = "warning"; icono = "⚠️"; }
      else if (estadoActual === "Agotado") { tipoNotif = "error"; icono = "🚨"; }

      mostrarToast(`${icono} Cambio de estatus [${prod.codigo} - ${descProd}]: De "${estadoAnterior}" ➔ Nuevo Estado: "${estadoActual}"`, tipoNotif);
    }
    estadosAnterioresInventario[codigoKey] = estadoActual;
  });
}

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
      <td><button onclick="modificarStockFila('${prod.idDoc}')" style="background:#007bff; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Editar</button></td>
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

async function modificarStockFila(idDoc) {
  if (!usuarioActual || (usuarioActual.rol !== "Administrador" && usuarioActual.rol !== "Soporte Técnico")) {
    mostrarToast("❌ Acceso denegado. El rol de Asistente no tiene permisos para editar el estatus y stock.", "error");
    return;
  }

  let prod = inventario.find(p => p.idDoc === idDoc);
  if (!prod) return;

  let stockActualCalculado = prod.stockInic + prod.entradas - prod.salidas;

  const overlay = document.createElement("div");
  overlay.style.cssText = "position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index: 999999;";
  
  const box = document.createElement("div");
  box.style.cssText = "background: white; padding: 20px 24px; border-radius: 8px; max-width: 520px; width: 92%; max-height: 90vh; overflow-y: auto; font-family: sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.25);";
  
  box.innerHTML = `
    <div style="border-bottom:2px solid #34495e; padding-bottom:10px; margin-bottom:15px;">
      <h3 style="margin:0; color:#2c3e50; font-size: 16px;">✏️ Edición de Producto (Remoto)</h3>
    </div>
    <div style="margin-bottom:10px;">
      <label style="font-size:11px; font-weight:bold;">Descripción:</label>
      <input type="text" id="ed-desc" value="${prod.descripcion || ''}" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;">
    </div>
    <div style="margin-bottom:10px;">
      <label style="font-size:11px; font-weight:bold;">Precio en Bs.S:</label>
      <input type="number" id="ed-precio" value="${prod.precioBs}" step="0.01" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;">
    </div>
    <div style="margin-bottom:10px;">
      <label style="font-size:11px; font-weight:bold;">Stock Actual:</label>
      <input type="number" id="ed-stk" value="${stockActualCalculado}" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;">
    </div>
    <div style="display:flex; gap:10px; justify-content:flex-end;">
      <button id="btn-save-ed" style="background:#27ae60; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer;">💾 Guardar</button>
      <button id="btn-canc-ed" style="background:#95a5a6; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer;">Cancelar</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  box.querySelector("#btn-save-ed").onclick = async () => {
    prod.descripcion = box.querySelector("#ed-desc").value.trim().toUpperCase() || prod.descripcion;
    prod.precioBs = parseFloat(box.querySelector("#ed-precio").value) || prod.precioBs;
    const stockDeseado = parseInt(box.querySelector("#ed-stk").value);

    if (!isNaN(stockDeseado) && stockDeseado !== stockActualCalculado) {
      prod.stockInic = stockDeseado - prod.entradas + prod.salidas;
      if (prod.stockInic < 0) prod.stockInic = 0;
    }

    try {
      const prodCopia = { ...prod };
      delete prodCopia.idDoc;
      await db.collection("iapci_stock").doc(idDoc).set(prodCopia);
      document.body.removeChild(overlay);
      mostrarToast(`✅ Producto "${prod.codigo}" actualizado de forma remota.`, "success");
    } catch (e) {
      console.error("Error al actualizar en Firestore:", e);
      mostrarToast("❌ Error al guardar cambios en la base de datos.", "error");
    }
  };

  box.querySelector("#btn-canc-ed").onclick = () => document.body.removeChild(overlay);
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
    const obs = document.getElementById("f-observacion").value.trim() || `Nuevo producto`;

    if (!codigo || !descripcion) {
      mostrarToast("Introduce Código y Descripción.", "warning");
      return;
    }

    const existe = inventario.some(p => p.codigo.toUpperCase() === codigo);
    if (existe) {
      mostrarToast("❌ El código ya existe en el inventario.", "warning");
      return;
    }

    const nuevoProdObj = { codigo, descripcion, categoria, pasillo, und, precioBs, stockInic: cantInic, entradas: 0, salidas: 0, stockMin: stockMinInput, obs };
    const nuevoHistObj = { fecha: new Date().toLocaleDateString(), codigo, producto: descripcion, categoria, pasillo, und, precio: precioBs, entrada: cantInic, salida: 0, observacion: obs, timestamp: Date.now() };

    try {
      await db.collection("iapci_stock").add(nuevoProdObj);
      await db.collection("iapci_historial").add(nuevoHistObj);

      mostrarToast(`✅ Producto guardado en Firestore.`, "success");
      limpiarFormulario();
      cambiarPestana('registro');
    } catch (e) {
      console.error("Error al registrar en Firestore:", e);
    }
  });
}

function buscarCodigo() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  const prod = inventario.find(p => p.codigo.toUpperCase() === codigo);
  if (prod) {
    document.getElementById("f-codigo").value = prod.codigo;
    document.getElementById("f-producto").value = prod.descripcion;
    document.getElementById("f-categoria").value = prod.categoria;
    document.getElementById("f-pasillo").value = prod.pasillo;
    document.getElementById("f-und").value = prod.und;
    cambiarPestana('stock');
    renderTablaStock(prod.codigo);
  } else {
    mostrarToast("El código no existe.", "warning");
  }
}

async function registrarEntrada() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  const cant = parseInt(document.getElementById("f-cantidad").value) || 0;
  const precioNuevo = parseFloat(document.getElementById("f-precio").value) || 0;
  const obs = document.getElementById("f-observacion").value.trim() || "REPOSICIÓN";
  const prod = inventario.find(p => p.codigo.toUpperCase() === codigo);

  if (prod && cant > 0) {
    let nuevoPrecioBs = precioNuevo > 0 ? (prod.precioBs + precioNuevo) / 2 : prod.precioBs;
    const nuevasEntradas = prod.entradas + cant;

    const nuevoMovimiento = {
      fecha: new Date().toLocaleDateString(), codigo: prod.codigo, producto: prod.descripcion, 
      categoria: prod.categoria, pasillo: prod.pasillo, und: prod.und, 
      precio: precioNuevo > 0 ? precioNuevo : prod.precioBs, entrada: cant, salida: 0, 
      observacion: obs, timestamp: Date.now()
    };

    try {
      await db.collection("iapci_stock").doc(prod.idDoc).update({ precioBs: nuevoPrecioBs, entradas: nuevasEntradas });
      await db.collection("iapci_historial").add(nuevoMovimiento);
      mostrarToast(`📥 Entrada de ${cant} registrada de forma remota.`, "success");
      limpiarFormulario();
      cambiarPestana('registro');
    } catch (e) {
      console.error(e);
    }
  } else {
    mostrarToast("Datos inválidos.", "warning");
  }
}

async function registrarSalida() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  const cant = parseInt(document.getElementById("f-cantidad")?.value) || 0;
  const precio = parseFloat(document.getElementById("f-precio").value) || 0;
  const obs = document.getElementById("f-observacion").value.trim() || "VENTA";
  const prod = inventario.find(p => p.codigo.toUpperCase() === codigo);

  if (!prod) {
    mostrarToast("⚠️ Código no hallado.", "warning");
    return;
  }

  const stockActualCalculado = prod.stockInic + prod.entradas - prod.salidas;
  if (cant > stockActualCalculado || cant <= 0) {
    mostrarToast(`❌ Operación imposible: La salida supera el stock disponible (${stockActualCalculado}).`, "error");
    return;
  }

  const nuevasSalidas = prod.salidas + cant;
  const nuevoPrecioBs = precio > 0 ? precio : prod.precioBs;

  const nuevoMovimiento = {
    fecha: new Date().toLocaleDateString(), codigo: prod.codigo, producto: prod.descripcion, 
    categoria: prod.categoria, pasillo: prod.pasillo, und: prod.und, 
    precio: nuevoPrecioBs, entrada: 0, salida: cant, observacion: obs, timestamp: Date.now()
  };

  try {
    await db.collection("iapci_stock").doc(prod.idDoc).update({ salidas: nuevasSalidas, precioBs: nuevoPrecioBs });
    await db.collection("iapci_historial").add(nuevoMovimiento);
    mostrarToast(`📤 Salida registrada en Firestore.`, "success");
    limpiarFormulario();
    cambiarPestana('registro');
  } catch (e) {
    console.error(e);
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
}

function eliminarRegistro() {
  verificarPermisoAdmin(async () => {
    if (historialMovimientos.length === 0) {
      mostrarToast("No hay registros.", "info");
      return;
    }

    solicitarConfirmacion("¿Desea eliminar el último movimiento y enviarlo a la papelera remota?", async () => {
      try {
        const movEliminado = historialMovimientos[0]; // Último registrado
        const prod = inventario.find(p => p.codigo.toUpperCase() === movEliminado.codigo.toUpperCase());

        if (prod) {
          if (movEliminado.entrada > 0) prod.entradas = Math.max(0, prod.entradas - movEliminado.entrada);
          if (movEliminado.salida > 0) prod.salidas = Math.max(0, prod.salidas - movEliminado.salida);
          await db.collection("iapci_stock").doc(prod.idDoc).update({ entradas: prod.entradas, salidas: prod.salidas });
        }

        const copiaPapelera = { ...movEliminado, timestamp: Date.now() };
        delete copiaPapelera.idDoc;

        await db.collection("iapci_papelera").add(copiaPapelera);
        await db.collection("iapci_historial").doc(movEliminado.idDoc).delete();

        mostrarToast("🗑️ Registro enviado a la papelera en Firestore.", "success");
      } catch (e) {
        console.error(e);
      }
    });
  });
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

    if (stockAct > minStockVal) buenNivel++;
    else if (stockAct > 0) bajoNivel++;
    else agotados++;

    if (!categoriasMap[catNombre]) {
      categoriasMap[catNombre] = { productos: 0, stockTotal: 0, valorStockBs: 0, tieneAgotado: false, tieneBajoNivel: false };
    }
    categoriasMap[catNombre].productos++;
    categoriasMap[catNombre].stockTotal += stockAct;
    categoriasMap[catNombre].valorStockBs += valBs;
  });

  const actualizarTextoPorIds = (ids, valor) => {
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = valor; });
  };

  actualizarTextoPorIds(["card-total-salidas", "rep-total-salidas"], totalSalidas.toLocaleString('es-VE'));
  actualizarTextoPorIds(["card-total-productos", "rep-total-productos"], totalProd);
  actualizarTextoPorIds(["card-stock-disponible", "rep-stock-disponible"], stockDisponible.toLocaleString('es-VE'));
  actualizarTextoPorIds(["card-buen-nivel", "rep-buen-nivel"], buenNivel);
  actualizarTextoPorIds(["card-bajo-nivel", "rep-bajo-nivel"], bajoNivel);
  actualizarTextoPorIds(["card-agotados", "rep-agotados"], agotados);
}

function toggleModalPapelera() {
  const modal = document.getElementById("modal-papelera");
  if (modal) {
    modal.classList.toggle("oculto");
    if (!modal.classList.contains("oculto")) renderTablaPapelera();
  }
}

function renderTablaPapelera() {
  const contenedor = document.getElementById("contenedor-tabla-papelera") || document.getElementById("cuerpo-tabla-papelera");
  if (!contenedor) return;

  let html = `
    <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 13px; font-weight: bold;">Total en papelera remota: ${papeleraMovimientos.length}</span>
      <button onclick="vaciarPapelera()" style="background: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">⚠️ Vaciar Papelera</button>
    </div>
    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
      <thead>
        <tr style="background: #343a40; color: white;">
          <th style="padding: 6px;">Fecha</th><th style="padding: 6px;">Código</th><th style="padding: 6px;">Producto</th><th style="padding: 6px;">Acción</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (papeleraMovimientos.length === 0) {
    html += `<tr><td colspan="4" style="text-align:center; padding: 20px;">Papelera vacía.</td></tr>`;
  } else {
    papeleraMovimientos.forEach((mov, index) => {
      html += `
        <tr style="border-bottom: 1px solid #dee2e6;">
          <td>${mov.fecha}</td><td><b>${mov.codigo}</b></td><td>${mov.producto}</td>
          <td><button onclick="restaurarRegistroPapelera('${mov.idDoc}')" style="background:#28a745; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Restaurar</button></td>
        </tr>
      `;
    });
  }
  html += `</tbody></table>`;
  contenedor.innerHTML = html;
}

async function restaurarRegistroPapelera(idDoc) {
  verificarPermisoAdmin(async () => {
    const movRestaurar = papeleraMovimientos.find(m => m.idDoc === idDoc);
    if (!movRestaurar) return;

    try {
      const copia = { ...movRestaurar };
      delete copia.idDoc;
      await db.collection("iapci_historial").add(copia);
      await db.collection("iapci_papelera").doc(idDoc).delete();
      mostrarToast("✅ Registro restaurado con éxito.", "success");
    } catch (e) {
      console.error(e);
    }
  });
}

async function vaciarPapelera() {
  verificarPermisoAdmin(async () => {
    solicitarConfirmacion("¿Desea vaciar toda la papelera en Firestore?", async () => {
      try {
        const snapshot = await db.collection("iapci_papelera").get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        mostrarToast("✅ Papelera vaciada.", "success");
      } catch (e) {
        console.error(e);
      }
    });
  });
}
