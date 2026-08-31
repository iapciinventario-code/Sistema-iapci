// ==========================================
// CEREBRO UNIFICADO DEL SISTEMA - IAPCI 2026
// (Sincronización Firestore Exclusiva + Sin Almacenamiento Local)
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  writeBatch 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";

const canalSincronizacion = new BroadcastChannel("iapci_sincronizacion_sistema");
const idSesionUnicaTab = Math.random().toString(36);
let intervaloHeartbeat = null;

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
let estadosAnterioresInventario = {};

const CAPACIDAD_MAXIMA_PAPELERA = 100;
let db = null;
let app = null;

canalSincronizacion.onmessage = function (event) {
  const mensaje = event.data;
  if (!mensaje) return;

  if (mensaje.tipo === "FORZAR_CIERRE_SESION") {
    if (usuarioActual && usuarioActual.rol === mensaje.rol) {
      clearInterval(intervaloHeartbeat);
      sessionStorage.removeItem(`iapci_sesion_activa_${usuarioActual.rol}`);
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

function imprimirReporte() {
  cambiarPestana('reporte');
  setTimeout(() => {
    window.print();
  }, 200);
}

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

async function cargarDatosDesdeFirebase() {
  try {
    if (!app) {
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
      app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      try {
        getAnalytics(app);
      } catch (eAnalytics) {
        console.warn("Analytics no soportado:", eAnalytics);
      }
      window.db = db;
      console.log("✅ Conectado a Firebase Firestore (Exclusivo en la Nube).");
    }

    // 1. Cargar usuarios
    const usuariosSnap = await getDocs(collection(db, "iapci_usuarios"));
    if (!usuariosSnap.empty) {
      const uRemotos = {};
      usuariosSnap.forEach(docSnap => {
        uRemotos[docSnap.id] = docSnap.data();
      });
      usuarios = uRemotos;
    } else {
      const batch = writeBatch(db);
      for (const uKey in usuarios) {
        batch.set(doc(db, "iapci_usuarios", uKey), usuarios[uKey]);
      }
      await batch.commit();
    }

    // 2. Cargar Tasa BCV
    const tasaDocRef = doc(db, "iapci_tasa", "bcv");
    const tasaDocSnap = await getDoc(tasaDocRef);
    if (tasaDocSnap.exists()) {
      const dataTasa = tasaDocSnap.data();
      tasaCambioBCV = dataTasa.tasa || 36.50;
    } else {
      await setDoc(tasaDocRef, { tasa: tasaCambioBCV, fecha: new Date().toLocaleDateString() });
    }

    // 3. Cargar Inventario / Stock
    const stockSnap = await getDocs(collection(db, "iapci_stock"));
    inventario = [];
    stockSnap.forEach(docSnap => {
      inventario.push({ idDoc: docSnap.id, ...docSnap.data() });
    });

    // 4. Cargar Historial
    const histQuery = query(collection(db, "iapci_historial"), orderBy("timestamp", "desc"));
    const historialSnap = await getDocs(histQuery);
    historialMovimientos = [];
    historialSnap.forEach(docSnap => {
      historialMovimientos.push({ idDoc: docSnap.id, ...docSnap.data() });
    });

    // 5. Cargar Papelera
    const papeleraSnap = await getDocs(collection(db, "iapci_papelera"));
    papeleraMovimientos = [];
    papeleraSnap.forEach(docSnap => {
      papeleraMovimientos.push({ idDoc: docSnap.id, ...docSnap.data() });
    });

    inicializarMapaEstados();
    
    const usuarioGuardado = sessionStorage.getItem("iapci_usuario_activo_nombre");
    if (usuarioGuardado && usuarios[usuarioGuardado]) {
      usuarioActual = usuarios[usuarioGuardado];
      document.getElementById("pantalla-login")?.classList.add("oculto");
      document.getElementById("pantalla-sistema")?.classList.remove("oculto");
      const rolLbl = document.getElementById("rol-usuario-lbl");
      if (rolLbl) rolLbl.textContent = `Usuario: ${usuarioGuardado.toUpperCase()} (${usuarioActual.rol})`;
      const fFecha = document.getElementById("f-fecha");
      if (fFecha) fFecha.value = new Date().toLocaleDateString();
      
      const inputTasaElem = document.getElementById("f-tasa-cambio");
      if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;

      const lblTasa = document.getElementById("lbl-tasa-actual");
      if (lblTasa) lblTasa.textContent = `Bs. ${tasaCambioBCV.toFixed(2)} / $`;

      aplicarPermisos();
      actualizarTodo();
    }
  } catch (e) {
    console.error("Error al cargar datos remotos de Firestore:", e);
    mostrarToast("❌ Error al sincronizar con Firebase.", "error");
  }
}

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

window.addEventListener("DOMContentLoaded", () => {
  cargarDatosDesdeFirebase();
});

function toggleModalUsuarios() {
  const modal = document.getElementById("modal-usuarios");
  if (modal) {
    modal.classList.toggle("oculto");
    if (!modal.classList.contains("oculto")) {
      const soporteKey = Object.keys(usuarios).find(u => usuarios[u].rol === "Soporte Técnico") || "soporte";
      const adminKey = Object.keys(usuarios).find(u => usuarios[u].rol === "Administrador") || "admin";
      const asistenteKey = Object.keys(usuarios).find(u => usuarios[u].rol === "Asistente") || "asistente";

      const cfgSoporte = document.getElementById("cfg-user-soporte");
      const cfgAdmin = document.getElementById("cfg-user-admin");
      const cfgAsistente = document.getElementById("cfg-user-asistente");

      if (cfgSoporte) cfgSoporte.value = soporteKey;
      if (cfgAdmin) cfgAdmin.value = adminKey;
      if (cfgAsistente) cfgAsistente.value = asistenteKey;
      
      const passSoporte = document.getElementById("cfg-pass-soporte");
      const passAdmin = document.getElementById("cfg-pass-admin");
      const passAsistente = document.getElementById("cfg-pass-asistente");

      if (passSoporte) passSoporte.value = "";
      if (passAdmin) passAdmin.value = "";
      if (passAsistente) passAsistente.value = "";
    }
  }
}

async function guardarNuevosUsuarios() {
  const sUserElem = document.getElementById("cfg-user-soporte");
  const sPassElem = document.getElementById("cfg-pass-soporte");
  const aUserElem = document.getElementById("cfg-user-admin");
  const aPassElem = document.getElementById("cfg-pass-admin");
  const asUserElem = document.getElementById("cfg-user-asistente");
  const asPassElem = document.getElementById("cfg-pass-asistente");

  const sUser = sUserElem ? sUserElem.value.trim().toLowerCase() : "";
  const sPass = sPassElem ? sPassElem.value : "";

  const aUser = aUserElem ? aUserElem.value.trim().toLowerCase() : "";
  const aPass = aPassElem ? aPassElem.value : "";

  const asUser = asUserElem ? asUserElem.value.trim().toLowerCase() : "";
  const asPass = asPassElem ? asPassElem.value : "";

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

  if (db) {
    try {
      const batch = writeBatch(db);
      for (const uKey in usuarios) {
        batch.delete(doc(db, "iapci_usuarios", uKey));
      }
      for (const uKey in nuevosUsuarios) {
        batch.set(doc(db, "iapci_usuarios", uKey), nuevosUsuarios[uKey]);
      }
      await batch.commit();
    } catch (e) {
      console.error("Error al actualizar usuarios en Firestore:", e);
      mostrarToast("❌ Error al guardar usuarios en la base de datos.", "error");
      return;
    }
  }

  usuarios = nuevosUsuarios;
  mostrarToast("✅ Credenciales de usuarios actualizadas en Firestore exitosamente.", "success");
  toggleModalUsuarios();
}

window.addEventListener("keydown", function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    toggleModalUsuarios();
  }
});

function iniciarSesion() {
  const inputUsuario = document.getElementById("input-usuario");
  const inputClave = document.getElementById("input-clave");
  const msgError = document.getElementById("mensaje-error");

  const userInput = inputUsuario ? inputUsuario.value.trim().toLowerCase() : "";
  const passInput = inputClave ? inputClave.value : "";

  if (usuarios[userInput] && usuarios[userInput].clave === passInput) {
    const rolIntentado = usuarios[userInput].rol;
    const claveSesionKey = `iapci_sesion_activa_${rolIntentado}`;
    
    const sesionExistenteStr = sessionStorage.getItem(claveSesionKey);
    if (sesionExistenteStr) {
      try {
        const sesionData = JSON.parse(sesionExistenteStr);
        if (Date.now() - sesionData.timestamp < 8000) {
          if (msgError) msgError.textContent = `❌ Acceso denegado: El rol "${rolIntentado}" ya se encuentra activo en otra ventana/computadora.`;
          return;
        }
      } catch (e) {
        console.error(e);
      }
    }

    usuarioActual = usuarios[userInput];
    sessionStorage.setItem(claveSesionKey, JSON.stringify({ tabId: idSesionUnicaTab, timestamp: Date.now() }));
    sessionStorage.setItem("iapci_usuario_activo_nombre", userInput);

    try {
      canalSincronizacion.postMessage({ tipo: "FORZAR_CIERRE_SESION", rol: rolIntentado });
    } catch (e) {
      console.error(e);
    }

    if (intervaloHeartbeat) clearInterval(intervaloHeartbeat);
    intervaloHeartbeat = setInterval(() => {
      if (usuarioActual) {
        sessionStorage.setItem(claveSesionKey, JSON.stringify({ tabId: idSesionUnicaTab, timestamp: Date.now() }));
      }
    }, 4000);

    document.getElementById("pantalla-login")?.classList.add("oculto");
    document.getElementById("pantalla-sistema")?.classList.remove("oculto");
    const rolLbl = document.getElementById("rol-usuario-lbl");
    if (rolLbl) rolLbl.textContent = `Usuario: ${userInput.toUpperCase()} (${usuarioActual.rol})`;
    const fFecha = document.getElementById("f-fecha");
    if (fFecha) fFecha.value = new Date().toLocaleDateString();
    
    const inputTasaElem = document.getElementById("f-tasa-cambio");
    if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;

    const lblTasa = document.getElementById("lbl-tasa-actual");
    if (lblTasa) lblTasa.textContent = `Bs. ${tasaCambioBCV.toFixed(2)} / $`;

    aplicarPermisos();
    actualizarTodo();
    if (msgError) msgError.textContent = "";
  } else {
    if (msgError) msgError.textContent = "Usuario o clave incorrectos";
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

async function actualizarTasa() {
  verificarPermisoAdmin(async () => {
    const inputTasaElem = document.getElementById("f-tasa-cambio");
    const inputTasa = inputTasaElem ? parseFloat(inputTasaElem.value) : NaN;
    
    if (isNaN(inputTasa) || inputTasa <= 0) {
      mostrarToast("❌ Por favor introduzca una tasa de cambio válida.", "warning");
      if (inputTasaElem) inputTasaElem.value = tasaCambioBCV;
      return;
    }

    tasaCambioBCV = inputTasa;
    const hoyStr = new Date().toLocaleDateString();

    if (db) {
      await setDoc(doc(db, "iapci_tasa", "bcv"), {
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
    sessionStorage.removeItem(`iapci_sesion_activa_${usuarioActual.rol}`);
    sessionStorage.removeItem("iapci_usuario_activo_nombre");
  }
  usuarioActual = null;
  document.getElementById("pantalla-sistema")?.classList.add("oculto");
  document.getElementById("pantalla-login")?.classList.remove("oculto");
  const inputUsuario = document.getElementById("input-usuario");
  const inputClave = document.getElementById("input-clave");
  if (inputUsuario) inputUsuario.value = "";
  if (inputClave) inputClave.value = "";
}

function actualizarTodo(codigoResaltar = null, indiceHistorialResaltar = null) {
  detectarYNotificarCambiosDeEstatus();

  renderTablaStock(codigoResaltar);
  renderTablaHistorial(indiceHistorialResaltar);
  renderReporteGeneral();

  try {
    canalSincronizacion.postMessage({ tipo: "ACTUALIZAR_ESTADO_SISTEMA" });
  } catch (e) {
    console.error("Error al sincronizar con el canal:", e);
  }
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

      if (estadoActual === "Buen Nivel") {
        tipoNotif = "success";
        icono = "✅";
      } else if (estadoActual === "Bajo Nivel") {
        tipoNotif = "warning";
        icono = "⚠️";
      } else if (estadoActual === "Agotado") {
        tipoNotif = "error";
        icono = "🚨";
      }

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
    
    const stockMinVal = prod.stockMin !== undefined ? prod.stockMin : 12;
    const estado = stockActual > stockMinVal ? "Buen Nivel" : (stockActual > 0 ? "Bajo Nivel" : "Agotado");
    const claseBadge = stockActual > stockMinVal ? "badge-buen" : (stockActual > 0 ? "badge-bajo" : "badge-agotado");

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
      <td>${stockMinVal}</td>
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
  
  const nombreUsuarioActivo = sessionStorage.getItem("iapci_usuario_activo_nombre")?.toUpperCase() || usuarioActual.rol;

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

    <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center; border-top:1px solid #eee; padding-top:12px;">
      <div style="display:flex; gap:10px;">
        <button id="btn-save-ed" style="background:#27ae60; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">💾 Guardar Cambios</button>
        <button id="btn-canc-ed" style="background:#95a5a6; color:white; border:none; padding:8px 16px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:12px;">Cancelar</button>
      </div>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

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

    if (db && prod.idDoc) {
      const docRef = doc(db, "iapci_stock", prod.idDoc);
      const prodCopia = { ...prod };
      delete prodCopia.idDoc;
      await setDoc(docRef, prodCopia);
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

// Función añadida: Validación de campos obligatorios en la interfaz de registro[cite: 8]
function validarYProcesarRegistro() {
  // 1. Definir la hoja y los rangos o IDs de los campos de la interfaz
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("interfaz de registro");
  
  // Ejemplo de campos obligatorios (ajusta las celdas según tu diseño)
  var celdasAValidar = ["B3", "B5", "B7", "B9"]; // Reemplaza con tus celdas reales
  var camposVacios = [];
  
  // 2. Limpiar formatos anteriores (quitar resaltado)
  celdasAValidar.forEach(function(celdaID) {
    hoja.getRange(celdaID).setBackground("#ffffff"); // Fondo blanco por defecto
  });
  
  // 3. Comprobar cuáles campos están vacíos
  celdasAValidar.forEach(function(celdaID) {
    var valor = hoja.getRange(celdaID).getValue();
    if (valor === "" || valor === null) {
      camposVacios.push(celdaID);
      // Resaltar el campo vacío con un color rojo claro
      hoja.getRange(celdaID).setBackground("#f4cccc");
    }
  });
  
  // 4. Si hay campos vacíos, detener y avisar; de lo contrario, continuar
  if (camposVacios.length > 0) {
    SpreadsheetApp.getUi().alert(
      "Atención", 
      "Debe ser llenada toda la información del producto antes de proceder. Los campos faltantes han sido resaltados.", 
      SpreadsheetApp.getUi().Button.OK
    );
    return false; // Detiene la ejecución de la función principal
  }
  
  // 5. Continuar con la lógica del botón si todo está lleno
  // (Inserta aquí el código que ejecutan tus botones normalmente)
  SpreadsheetApp.getUi().alert("¡Registro exitoso!");
  return true;
}

// Botón: Nuevo Producto - Crea y registra un nuevo producto en el inventario y en el historial de movimientos
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

    if (db) {
      const docRefStock = await addDoc(collection(db, "iapci_stock"), nuevoProdObj);
      nuevoProdObj.idDoc = docRefStock.id;
      const docRefHist = await addDoc(collection(db, "iapci_historial"), nuevoHistObj);
      nuevoHistObj.idDoc = docRefHist.id;
    }

    inventario.push(nuevoProdObj);
    historialMovimientos.unshift(nuevoHistObj);
    actualizarTodo(null, 0);

    mostrarToast(`✅ Producto "${descripcion}" guardado exitosamente.`, "success");
    limpiarFormulario();
    cambiarPestana('registro');
  });
}

// Botón: Buscar Código - Busca un producto existente por su código y muestra sus datos en la sección de stock
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

// Botón: Registro de Entrada - Registra el ingreso de unidades de un producto existente y actualiza el stock y el historial
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

    const nuevoMovimiento = {
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
    };

    if (db && prod.idDoc) {
      await updateDoc(doc(db, "iapci_stock", prod.idDoc), {
        precioBs: nuevoPrecioBs,
        entradas: nuevasEntradas
      });

      const docRefHist = await addDoc(collection(db, "iapci_historial"), nuevoMovimiento);
      nuevoMovimiento.idDoc = docRefHist.id;
    }
    
    prod.entradas = nuevasEntradas;
    prod.precioBs = nuevoPrecioBs;
    historialMovimientos.unshift(nuevoMovimiento);
    actualizarTodo(null, 0);

    mostrarToast(`📥 Entrada de ${cant} ${prod.und} registrada.`, "success");
    limpiarFormulario();
    cambiarPestana('registro');
  } else {
    mostrarToast("Código no hallado o cantidad inválida.", "warning");
  }
}

// Botón: Registro de Salida - Valida rigurosamente que la salida no supere el stock disponible (frenando la operación y resaltando el campo)
async function registrarSalida() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  const cantInputElem = document.getElementById("f-cantidad");
  const cant = parseInt(cantInputElem?.value) || 0;
  const precio = parseFloat(document.getElementById("f-precio").value) || 0;
  const obs = document.getElementById("f-observacion").value.trim() || "VENTA";
  const prod = inventario.find(p => p.codigo.toUpperCase() === codigo);

  if (!prod) {
    mostrarToast("⚠️ Código de producto no hallado en el inventario.", "warning");
    return;
  }

  if (cant <= 0) {
    mostrarToast("⚠️ Por favor introduzca una cantidad válida mayor a 0.", "warning");
    if (cantInputElem) {
      cantInputElem.focus();
      cantInputElem.style.borderColor = "#c0392b";
      cantInputElem.style.backgroundColor = "#fadbd8";
      setTimeout(() => {
        cantInputElem.style.borderColor = "";
        cantInputElem.style.backgroundColor = "";
      }, 4000);
    }
    return;
  }

  const stockActualCalculado = prod.stockInic + prod.entradas - prod.salidas;

  if (cant > stockActualCalculado) {
    mostrarToast(`❌ Operación imposible: La salida de (${cant}) supera el stock disponible del producto (${stockActualCalculado} ${prod.und}).`, "error");
    
    if (cantInputElem) {
      cantInputElem.focus();
      cantInputElem.style.borderColor = "#c0392b";
      cantInputElem.style.backgroundColor = "#fadbd8";
      cantInputElem.style.boxShadow = "0 0 8px rgba(192, 57, 43, 0.6)";
      
      const limpiarResaltado = () => {
        cantInputElem.style.borderColor = "";
        cantInputElem.style.backgroundColor = "";
        cantInputElem.style.boxShadow = "";
        cantInputElem.removeEventListener("input", limpiarResaltado);
      };
      cantInputElem.addEventListener("input", limpiarResaltado);
      setTimeout(limpiarResaltado, 6000);
    }
    return;
  }

  const nuevasSalidas = prod.salidas + cant;
  const nuevoPrecioBs = precio > 0 ? precio : prod.precioBs;

  const nuevoMovimiento = {
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
  };

  if (db && prod.idDoc) {
    await updateDoc(doc(db, "iapci_stock", prod.idDoc), {
      salidas: nuevasSalidas,
      precioBs: nuevoPrecioBs
    });

    const docRefHist = await addDoc(collection(db, "iapci_historial"), nuevoMovimiento);
    nuevoMovimiento.idDoc = docRefHist.id;
  }
  
  prod.salidas = nuevasSalidas;
  prod.precioBs = nuevoPrecioBs;
  historialMovimientos.unshift(nuevoMovimiento);
  actualizarTodo(null, 0);
  
  mostrarToast(`📤 Salida de ${cant} ${prod.und} registrada exitosamente.`, "success");
  limpiarFormulario();
  cambiarPestana('registro');
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
        mostrarToast("⚠️ Advertencia: La papelera ha alcanzado su capacidad máxima de 100 registros. Vacíe la papelera para continuar.", "warning");
        return;
      }

      solicitarConfirmacion("¿Desea eliminar el último movimiento registrado de la pestaña de entradas/salidas, ajustar su cantidad correspondiente en el estatus y stock, y enviar el registro a la papelera?", async () => {
        try {
          const movEliminado = historialMovimientos.shift();
          if (!movEliminado) return;

          const idDocHistorial = movEliminado.idDoc;
          const codigoMov = (movEliminado.codigo || "").toUpperCase();
          const prod = inventario.find(p => (p.codigo || "").toUpperCase() === codigoMov);

          if (prod) {
            const cantEntrada = movEliminado.entrada || 0;
            const cantSalida = movEliminado.salida || 0;

            if (cantEntrada > 0) {
              prod.entradas = Math.max(0, prod.entradas - cantEntrada);
            }
            if (cantSalida > 0) {
              prod.salidas = Math.max(0, prod.salidas - cantSalida);
            }

            if (typeof db !== "undefined" && db && prod.idDoc) {
              await updateDoc(doc(db, "iapci_stock", prod.idDoc), {
                entradas: prod.entradas,
                salidas: prod.salidas
              });
            }
          }

          const movLimpioParaPapelera = { 
            ...movEliminado, 
            timestamp: Date.now() 
          };
          delete movLimpioParaPapelera.idDoc;

          papeleraMovimientos.unshift(movLimpioParaPapelera);

          if (typeof db !== "undefined" && db) {
            try {
              if (idDocHistorial) {
                await deleteDoc(doc(db, "iapci_historial", idDocHistorial));
              }
              const docRefPapelera = await addDoc(collection(db, "iapci_papelera"), movLimpioParaPapelera);
              movLimpioParaPapelera.idDoc = docRefPapelera.id;
            } catch (eFire) {
              console.error("Error al sincronizar papelera/historial en Firestore:", eFire);
            }
          }

          actualizarTodo(prod ? prod.codigo : null);
          mostrarToast("🗑 El último registro de entrada/salida ha sido eliminado de la pestaña de registro, su stock fue ajustado correctamente y se envió a la papelera.", "success");
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

// Botón: Limpiar Registro - Restablece/limpia todos los campos del formulario de entrada/registro actual
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

    if (stockAct > minStockVal) {
      buenNivel++;
    } else if (stockAct > 0) {
      bajoNivel++;
    } else {
      agotados++;
    }

    if (!categoriasMap[catNombre]) {
      categoriasMap[catNombre] = { productos: 0, stockTotal: 0, valorStockBs: 0, tieneAgotado: false, tieneBajoNivel: false };
    }
    categoriasMap[catNombre].productos++;
    categoriasMap[catNombre].stockTotal += stockAct;
    categoriasMap[catNombre].valorStockBs += valBs;

    if (stockAct <= 0) {
      categoriasMap[catNombre].tieneAgotado = true;
    } else if (stockAct <= minStockVal) {
      categoriasMap[catNombre].tieneBajoNivel = true;
    }
  });

  const actualizarTextoPorIds = (ids, valor) => {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = valor;
    });
  };

  actualizarTextoPorIds(["card-total-salidas", "rep-total-salidas", "rep-tot-salidas"], totalSalidas.toLocaleString('es-VE'));
  actualizarTextoPorIds(["card-total-productos", "rep-total-productos", "total-productos-lbl", "rep-tot-prod", "rep-total-prod"], totalProd);
  actualizarTextoPorIds(["card-stock-disponible", "rep-stock-disponible", "rep-stk-disp", "rep-stock-disp"], stockDisponible.toLocaleString('es-VE'));
  actualizarTextoPorIds(["card-buen-nivel", "rep-buen-nivel", "rep-buen"], buenNivel);
  actualizarTextoPorIds(["card-bajo-nivel", "rep-bajo-nivel", "rep-bajo"], bajoNivel);
  actualizarTextoPorIds(["card-agotados", "rep-agotados", "rep-agot"], agotados);
  actualizarTextoPorIds(["leyenda-buen-nivel"], `${buenNivel} productos`);
  actualizarTextoPorIds(["leyenda-bajo-nivel"], `${bajoNivel} productos`);
  actualizarTextoPorIds(["leyenda-agotados"], `${agotados} productos`);

  const idsValorBs = ["card-valor-total", "rep-valor-total-bs", "rep-val-bs", "rep-valor-bs"];
  idsValorBs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = `Bs.S ${valorTotalBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
  });

  let contenedorReporteVista = document.getElementById("vista-reporte");
  if (contenedorReporteVista) {
    let btnImprimirExistente = document.getElementById("btn-imprimir-reporte-general");
    if (!btnImprimirExistente) {
      const headerVista = contenedorReporteVista.querySelector("h2, h3, .header-reporte, header, div");
      const wrapperBtn = document.createElement("div");
      wrapperBtn.style.cssText = "margin: 15px 0; text-align: right;";
      wrapperBtn.innerHTML = `
        <button id="btn-imprimir-reporte-general" onclick="imprimirReporte()" style="background: #27ae60; color: white; border: none; padding: 10px 18px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
          🖨️ Imprimir Reporte en PDF
        </button>
      `;
      if (headerVista && headerVista.parentNode) {
        headerVista.parentNode.insertBefore(wrapperBtn, headerVista.nextSibling);
      } else {
        contenedorReporteVista.insertBefore(wrapperBtn, contenedorReporteVista.firstChild);
      }
    }
  }

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
        <td>Bs.S ${datos.valorStockBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
        <td>${estadoGralTexto}</td>
      `;
      tbodyCat.appendChild(tr);
    }

  
    tbodyCat.appendChild(trTotal);

    if (document.getElementById("cat-total-productos")) document.getElementById("cat-total-productos").textContent = sumaCatProd;
    if (document.getElementById("cat-total-stock")) document.getElementById("cat-total-stock").textContent = sumaCatStock.toLocaleString('es-VE');
    if (document.getElementById("cat-total-valor")) document.getElementById("cat-total-valor").textContent = `Bs.S ${sumaCatValor.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
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
      <div style="display: flex; gap: 8px;">
        <button onclick="eliminarSeleccionadosPapelera()" style="background: #c0392b; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px;">🗑️ Eliminar Seleccionados</button>
        <button onclick="vaciarPapelera()" style="background: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px;">⚠️ Vaciar Papelera</button>
      </div>
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

async function restaurarRegistroPapelera(index) {
  verificarPermisoAdmin(async () => {
    if (index >= 0 && index < papeleraMovimientos.length) {
      const movRestaurar = papeleraMovimientos[index];
      const idDocPapelera = movRestaurar.idDoc;
      
      papeleraMovimientos.splice(index, 1);
      
      delete movRestaurar.idDoc;

      const codigoRestaurar = (movRestaurar.codigo || "").toUpperCase();

      historialMovimientos.unshift({ ...movRestaurar, timestamp: Date.now() });

      let prod = inventario.find(p => (p.codigo || "").toUpperCase() === codigoRestaurar);
      
      if (prod) {
        if (movRestaurar.entrada > 0) {
          prod.entradas += movRestaurar.entrada;
        }
        if (movRestaurar.salida > 0) {
          prod.salidas += movRestaurar.salida;
        }
        if (movRestaurar.precio > 0) prod.precioBs = movRestaurar.precio;

        if (db && prod.idDoc) {
          await updateDoc(doc(db, "iapci_stock", prod.idDoc), {
            entradas: prod.entradas,
            salidas: prod.salidas,
            precioBs: prod.precioBs
          });
        }
      } else {
        const nuevoProd = {
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
        
        inventario.push(nuevoProd);

        if (db) {
          const docRefStock = await addDoc(collection(db, "iapci_stock"), nuevoProd);
          nuevoProd.idDoc = docRefStock.id;
        }
      }

      if (db) {
        if (idDocPapelera) {
          await deleteDoc(doc(db, "iapci_papelera", idDocPapelera));
        }
        await addDoc(collection(db, "iapci_historial"), { ...movRestaurar, timestamp: Date.now() });
      }

      actualizarTodo(codigoRestaurar);
      mostrarToast("✅ Registro restaurado de la papelera exitosamente y reajustado en Firestore.", "success");
      renderTablaPapelera();
    }
  });
}

async function eliminarSeleccionadosPapelera() {
  verificarPermisoAdmin(async () => {
    const seleccionados = Array.from(document.querySelectorAll('.chk-item-papelera:checked'))
      .map(chk => parseInt(chk.value))
      .sort((a, b) => b - a);

    if (seleccionados.length === 0) {
      mostrarToast("⚠️ Seleccione al menos un elemento de la papelera.", "warning");
      return;
    }

    solicitarConfirmacion(`¿Está seguro de eliminar definitivamente los ${seleccionados.length} elementos seleccionados de Firestore?`, async () => {
      for (const index of seleccionados) {
        if (index >= 0 && index < papeleraMovimientos.length) {
          const item = papeleraMovimientos[index];
          if (db && item.idDoc) {
            await deleteDoc(doc(db, "iapci_papelera", item.idDoc));
          }
          papeleraMovimientos.splice(index, 1);
        }
      }
      mostrarToast(`✅ ${seleccionados.length} elementos eliminados permanentemente de la nube.`, "info");
      renderTablaPapelera();
    });
  });
}

async function vaciarPapelera() {
  verificarPermisoAdmin(async () => {
    if (papeleraMovimientos.length === 0) {
      mostrarToast("La papelera ya está vacía.", "info");
      return;
    }

    solicitarConfirmacion("⚠️ ¿Está seguro de que desea vaciar permanentemente toda la papelera en Firestore? Esta acción no se puede deshacer.", async () => {
      try {
        if (db) {
          const snapshot = await getDocs(collection(db, "iapci_papelera"));
          const batch = writeBatch(db);
          snapshot.forEach(docSnap => batch.delete(docSnap.ref));
          await batch.commit();
        }
      } catch (error) {
        console.error("Error al vaciar papelera en Firestore:", error);
      }

      papeleraMovimientos = [];
      renderTablaPapelera();
      mostrarToast("✅ Papelera vaciada con éxito en la base de datos.", "success");
    });
  });
}

// Exponer funciones globales para que funcionen con los atributos `onclick` del HTML en módulos ES
window.iniciarSesion = iniciarSesion;
window.cerrarSesion = cerrarSesion;
window.cambiarPestana = cambiarPestana;
window.actualizarTasa = actualizarTasa;
window.toggleModalUsuarios = toggleModalUsuarios;
window.guardarNuevosUsuarios = guardarNuevosUsuarios;
window.modificarStockFila = modificarStockFila;
window.nuevoProducto = nuevoProducto;
window.buscarCodigo = buscarCodigo;
window.registrarEntrada = registrarEntrada;
window.registrarSalida = registrarSalida;
window.eliminarRegistro = eliminarRegistro;
window.toggleModalPapelera = toggleModalPapelera;
window.renderTablaPapelera = renderTablaPapelera;
window.seleccionarTodosPapelera = seleccionarTodosPapelera;
window.restaurarRegistroPapelera = restaurarRegistroPapelera;
window.eliminarSeleccionadosPapelera = eliminarSeleccionadosPapelera;
window.vaciarPapelera = vaciarPapelera;
window.imprimirReporte = imprimirReporte;
window.validarYProcesarRegistro = validarYProcesarRegistro;
