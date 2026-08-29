// ==========================================
// CEREBRO UNIFICADO DEL SISTEMA - IAPCI 2026
// (Sincronización Firestore en Tiempo Real + Respaldo Local + Sesión Única)
// ==========================================



// ==========================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
let usuarioActual = null;
let tasaBCV = 36.50;

// Credenciales predeterminadas del sistema
let usuariosApp = {
  soporte: { clave: "soporte123", rol: "Soporte Técnico" },
  admin: { clave: "admin123", rol: "Administrador" },
  asistente: { clave: "asistente123", rol: "Asistente" }
};

// Colecciones de datos principales
let inventarioProductos = [];
let historialMovimientos = [];
let papeleraReciclaje = [];

// ==========================================
// INICIALIZACIÓN Y EVENTOS INICIALES
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  cargarEstadoInicial();
  establecerFechaActual();
  configurarAtajosTeclado();
  crearContenedorNotificaciones();
});

function establecerFechaActual() {
  const fFecha = document.getElementById("f-fecha");
  if (fFecha) {
    const hoy = new Date();
    const dia = String(hoy.getDate()).padStart(2, '0');
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const anio = hoy.getFullYear();
    fFecha.value = `${dia}/${mes}/${anio}`;
  }
}

function configurarAtajosTeclado() {
  // Atajo Ctrl + K para abrir la configuración de usuarios
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggleModalUsuarios();
    }
  });
}

function cargarEstadoInicial() {
  try {
    const usuariosGuardados = localStorage.getItem("iapci_usuarios");
    if (usuariosGuardados) usuariosApp = JSON.parse(usuariosGuardados);

    const tasaGuardada = localStorage.getItem("iapci_tasa");
    if (tasaGuardada) {
      tasaBCV = parseFloat(tasaGuardada);
      const inputTasa = document.getElementById("f-tasa-cambio");
      if (inputTasa) inputTasa.value = tasaBCV.toFixed(2);
      actualizarEtiquetaTasa();
    }

    const prodGuardados = localStorage.getItem("iapci_productos");
    if (prodGuardados) inventarioProductos = JSON.parse(prodGuardados);

    const histGuardados = localStorage.getItem("iapci_historial");
    if (histGuardados) historialMovimientos = JSON.parse(histGuardados);

    const papGuardada = localStorage.getItem("iapci_papelera");
    if (papGuardada) papeleraReciclaje = JSON.parse(papGuardada);

    // Intentar sincronización con Firestore si la referencia global está lista
    if (window.db) {
      sincronizarConFirestore();
    }
  } catch (error) {
    console.error("Error al cargar estado inicial:", error);
  }
}

function guardarEstadoLocal() {
  localStorage.setItem("iapci_usuarios", JSON.stringify(usuariosApp));
  localStorage.setItem("iapci_tasa", tasaBCV.toString());
  localStorage.setItem("iapci_productos", JSON.stringify(inventarioProductos));
  localStorage.setItem("iapci_historial", JSON.stringify(historialMovimientos));
  localStorage.setItem("iapci_papelera", JSON.stringify(papeleraReciclaje));
}

async function sincronizarConFirestore() {
  if (!window.db) return;
  try {
    // Sincronizar tasa BCV
    const docTasa = await window.db.collection("iapci_tasa").doc("bcv").get();
    if (docTasa.exists && docTasa.data().tasa) {
      tasaBCV = parseFloat(docTasa.data().tasa);
      const inputTasa = document.getElementById("f-tasa-cambio");
      if (inputTasa) inputTasa.value = tasaBCV.toFixed(2);
      actualizarEtiquetaTasa();
    }

    // Sincronizar catálogo de productos
    const snapshotProds = await window.db.collection("iapci_productos").get();
    if (!snapshotProds.empty) {
      inventarioProductos = snapshotProds.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // Sincronizar historial de movimientos
    const snapshotHist = await window.db.collection("iapci_historial").orderBy("fechaOrd", "desc").get();
    if (!snapshotHist.empty) {
      historialMovimientos = snapshotHist.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // Sincronizar elementos en papelera
    const snapshotPap = await window.db.collection("iapci_papelera").get();
    if (!snapshotPap.empty) {
      papeleraReciclaje = snapshotPap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    guardarEstadoLocal();
    actualizarVistasSistema();
  } catch (e) {
    console.warn("Sincronización Firestore en segundo plano no disponible:", e);
  }
}

// ==========================================
// SISTEMA DE NOTIFICACIONES Y DIÁLOGOS (REEMPLAZO DE ALERT / CONFIRM)
// ==========================================
function crearContenedorNotificaciones() {
  if (document.getElementById("iapci-toast-container")) return;
  const container = document.createElement("div");
  container.id = "iapci-toast-container";
  container.style.cssText = "position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 10px;";
  document.body.appendChild(container);
}

function mostrarNotificacion(mensaje, tipo = 'info') {
  crearContenedorNotificaciones();
  const container = document.getElementById("iapci-toast-container");
  
  const toast = document.createElement("div");
  let bgColor = "#2980b9";
  if (tipo === 'success') bgColor = "#27ae60";
  if (tipo === 'error') bgColor = "#c0392b";
  if (tipo === 'warning') bgColor = "#f39c12";

  toast.style.cssText = `background: ${bgColor}; color: white; padding: 12px 20px; border-radius: 6px; font-size: 13px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.15); opacity: 0; transform: translateY(-10px); transition: all 0.3s ease; max-width: 350px;`;
  toast.textContent = mensaje;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  }, 10);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function solicitarConfirmacion(mensaje, accionConfirmada) {
  // Modal flotante de confirmación seguro sin alert/confirm
  const overlay = document.createElement("div");
  overlay.style.cssText = "position: fixed; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index: 999999;";
  
  const box = document.createElement("div");
  box.style.cssText = "background: white; padding: 24px; border-radius: 8px; max-width: 400px; width: 90%; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.3); font-family: sans-serif;";
  
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

  box.querySelector("#btn-conf-si").onclick = () => {
    document.body.removeChild(overlay);
    accionConfirmada();
  };

  box.querySelector("#btn-conf-no").onclick = () => {
    document.body.removeChild(overlay);
  };
}

// ==========================================
// CONTROL DE SESIÓN Y AUTENTICACIÓN
// ==========================================
function iniciarSesion() {
  const userInput = document.getElementById("input-usuario").value.trim().toLowerCase();
  const passInput = document.getElementById("input-clave").value;
  const msgError = document.getElementById("mensaje-error");

  msgError.textContent = "";

  if (!userInput || !passInput) {
    msgError.textContent = "Por favor, complete todos los campos.";
    return;
  }

  const cuenta = usuariosApp[userInput];
  if (cuenta && cuenta.clave === passInput) {
    usuarioActual = { usuario: userInput, rol: cuenta.rol };
    
    document.getElementById("pantalla-login").classList.add("oculto");
    document.getElementById("pantalla-sistema").classList.remove("oculto");
    document.getElementById("rol-usuario-lbl").textContent = `👤 ${cuenta.rol} (${userInput})`;

    limpiarFormulario();
    actualizarVistasSistema();
    mostrarNotificacion(`Bienvenido al Sistema, ${userInput.toUpperCase()}`, 'success');
  } else {
    msgError.textContent = "Usuario o contraseña incorrectos.";
  }
}

function cerrarSesion() {
  usuarioActual = null;
  document.getElementById("input-usuario").value = "";
  document.getElementById("input-clave").value = "";
  document.getElementById("mensaje-error").textContent = "";

  document.getElementById("pantalla-sistema").classList.add("oculto");
  document.getElementById("pantalla-login").classList.remove("oculto");
  mostrarNotificacion("Sesión cerrada correctamente.", 'info');
}

// ==========================================
// NAVEGACIÓN POR PESTAÑAS Y CONTROL DE TASA
// ==========================================
function cambiarPestana(pestanaNombre) {
  const pestanas = ["registro", "stock", "historial", "reporte"];
  
  pestanas.forEach(p => {
    const btn = document.getElementById(`tab-${p}`);
    const vista = document.getElementById(`vista-${p}`);
    if (btn) btn.classList.remove("activa");
    if (vista) vista.classList.add("oculto");
  });

  const btnActivo = document.getElementById(`tab-${pestanaNombre}`);
  const vistaActiva = document.getElementById(`vista-${pestanaNombre}`);
  
  if (btnActivo) btnActivo.classList.add("activa");
  if (vistaActiva) vistaActiva.classList.remove("oculto");

  actualizarVistasSistema();
}

function actualizarEtiquetaTasa() {
  const lbl = document.getElementById("lbl-tasa-actual");
  if (lbl) lbl.textContent = `Bs. ${tasaBCV.toFixed(2)} / $`;
}

function actualizarTasa() {
  const val = parseFloat(document.getElementById("f-tasa-cambio").value);
  if (!isNaN(val) && val > 0) {
    tasaBCV = val;
    actualizarEtiquetaTasa();
    guardarEstadoLocal();
    actualizarVistasSistema();

    if (window.db) {
      window.db.collection("iapci_tasa").doc("bcv").set({ tasa: tasaBCV, fecha: new Date().toISOString() });
    }
    mostrarNotificacion(`Tasa actualizada: Bs. ${tasaBCV.toFixed(2)} / $`, 'success');
  } else {
    mostrarNotificacion("Ingrese un valor de tasa válido mayor a 0.", 'warning');
    const inputTasa = document.getElementById("f-tasa-cambio");
    if (inputTasa) inputTasa.value = tasaBCV.toFixed(2);
  }
}

// ==========================================
// OPERACIONES DE INVENTARIO (REGISTRO / ENTRADA / SALIDA)
// ==========================================
function obtenerDatosFormulario() {
  return {
    fecha: document.getElementById("f-fecha").value,
    codigo: document.getElementById("f-codigo").value.trim().toUpperCase(),
    producto: document.getElementById("f-producto").value.trim(),
    categoria: document.getElementById("f-categoria").value.trim(),
    pasillo: parseInt(document.getElementById("f-pasillo").value) || 0,
    stockMin: parseInt(document.getElementById("f-stock-min").value) || 0,
    und: document.getElementById("f-und").value.trim(),
    precio: parseFloat(document.getElementById("f-precio").value) || 0,
    cantidad: parseInt(document.getElementById("f-cantidad").value) || 0,
    observacion: document.getElementById("f-observacion").value.trim()
  };
}

function nuevoProducto() {
  const datos = obtenerDatosFormulario();

  if (!datos.codigo || !datos.producto) {
    mostrarNotificacion("El Código y la Descripción del Producto son obligatorios.", 'warning');
    return;
  }

  const index = inventarioProductos.findIndex(p => p.codigo === datos.codigo);
  if (index !== -1) {
    mostrarNotificacion(`El código ${datos.codigo} ya existe. Utilice la opción 'Buscar Código' o ingrese uno diferente.`, 'warning');
    return;
  }

  const nuevoProd = {
    id: "PROD_" + Date.now(),
    codigo: datos.codigo,
    producto: datos.producto,
    categoria: datos.categoria || "General",
    pasillo: datos.pasillo,
    und: datos.und || "UND",
    precio: datos.precio,
    stockInic: datos.cantidad,
    entradas: 0,
    salidas: 0,
    stockMin: datos.stockMin,
    observacion: datos.observacion
  };

  inventarioProductos.push(nuevoProd);

  // Registrar movimiento inicial si cantidad > 0
  if (datos.cantidad > 0) {
    registrarMovimientoHistorial(datos, datos.cantidad, 0, "Registro Inicial de Producto");
  }

  guardarEstadoLocal();
  if (window.db) {
    window.db.collection("iapci_productos").doc(nuevoProd.id).set(nuevoProd);
  }

  mostrarNotificacion(`✅ Producto "${datos.producto}" registrado exitosamente.`, 'success');
  limpiarFormulario();
  actualizarVistasSistema();
}

function buscarCodigo() {
  const codigo = document.getElementById("f-codigo").value.trim().toUpperCase();
  if (!codigo) {
    mostrarNotificacion("Ingrese un Código de Producto para buscar.", 'warning');
    return;
  }

  const prod = inventarioProductos.find(p => p.codigo === codigo);
  if (prod) {
    document.getElementById("f-producto").value = prod.producto;
    document.getElementById("f-categoria").value = prod.categoria;
    document.getElementById("f-pasillo").value = prod.pasillo;
    document.getElementById("f-stock-min").value = prod.stockMin;
    document.getElementById("f-und").value = prod.und;
    document.getElementById("f-precio").value = prod.precio;
    document.getElementById("f-observacion").value = prod.observacion || "";
    document.getElementById("f-cantidad").value = "";
    mostrarNotificacion(`🔍 Producto encontrado: ${prod.producto}`, 'info');
  } else {
    mostrarNotificacion(`⚠️ No se encontró ningún producto con el código: ${codigo}`, 'warning');
  }
}

function registrarEntrada() {
  const datos = obtenerDatosFormulario();
  if (!datos.codigo || datos.cantidad <= 0) {
    mostrarNotificacion("Ingrese un Código válido y una Cantidad mayor a 0 para registrar Entrada.", 'warning');
    return;
  }

  let prod = inventarioProductos.find(p => p.codigo === datos.codigo);

  if (!prod) {
    mostrarNotificacion(`El código ${datos.codigo} no existe en el catálogo maestro. Créelo primero con 'Nuevo Producto'.`, 'warning');
    return;
  }

  prod.entradas += datos.cantidad;
  if (datos.precio > 0) prod.precio = datos.precio;
  if (datos.stockMin > 0) prod.stockMin = datos.stockMin;

  registrarMovimientoHistorial(datos, datos.cantidad, 0, datos.observacion || "Entrada de Mercancía");

  guardarEstadoLocal();
  if (window.db) {
    window.db.collection("iapci_productos").doc(prod.id).set(prod);
  }

  mostrarNotificacion(`📥 Entrada registrada exitosamente (+${datos.cantidad} ${prod.und}).`, 'success');
  limpiarFormulario();
  actualizarVistasSistema();
}

function registrarSalida() {
  const datos = obtenerDatosFormulario();
  if (!datos.codigo || datos.cantidad <= 0) {
    mostrarNotificacion("Ingrese un Código válido y una Cantidad mayor a 0 para registrar Salida.", 'warning');
    return;
  }

  let prod = inventarioProductos.find(p => p.codigo === datos.codigo);
  if (!prod) {
    mostrarNotificacion(`El producto con código ${datos.codigo} no existe.`, 'error');
    return;
  }

  const stockActual = prod.stockInic + prod.entradas - prod.salidas;
  if (datos.cantidad > stockActual) {
    mostrarNotificacion(`🚫 Stock insuficiente. Disponible actual: ${stockActual} unidades.`, 'error');
    return;
  }

  prod.salidas += datos.cantidad;

  registrarMovimientoHistorial(datos, 0, datos.cantidad, datos.observacion || "Salida / Despacho");

  guardarEstadoLocal();
  if (window.db) {
    window.db.collection("iapci_productos").doc(prod.id).set(prod);
  }

  mostrarNotificacion(`📤 Salida registrada exitosamente (-${datos.cantidad} ${prod.und}).`, 'success');
  limpiarFormulario();
  actualizarVistasSistema();
}

function registrarMovimientoHistorial(datos, entrada, salida, tipoObs) {
  const precioUSD = datos.precio > 0 && tasaBCV > 0 ? datos.precio / tasaBCV : 0;
  const cant = entrada > 0 ? entrada : salida;
  const precioTotal = datos.precio * cant;

  const mov = {
    id: "MOV_" + Date.now(),
    fecha: datos.fecha,
    fechaOrd: new Date().toISOString(),
    codigo: datos.codigo,
    producto: datos.producto || datos.codigo,
    categoria: datos.categoria || "General",
    pasillo: datos.pasillo,
    und: datos.und || "UND",
    precio: datos.precio,
    precioUSD: precioUSD,
    entrada: entrada,
    salida: salida,
    precioTotal: precioTotal,
    observacion: tipoObs
  };

  historialMovimientos.unshift(mov);
  if (window.db) {
    window.db.collection("iapci_historial").doc(mov.id).set(mov);
  }
}

function eliminarRegistro() {
  if (historialMovimientos.length === 0) {
    mostrarNotificacion("No hay registros recientes para eliminar.", 'info');
    return;
  }

  const ultimoMov = historialMovimientos[0];
  const mensajeConfirmacion = `¿Desea eliminar el último movimiento registrado?\nCódigo: ${ultimoMov.codigo} (${ultimoMov.producto}) - Entrada: ${ultimoMov.entrada}, Salida: ${ultimoMov.salida}`;

  solicitarConfirmacion(mensajeConfirmacion, () => {
    // Revertir en inventario maestro
    const prod = inventarioProductos.find(p => p.codigo === ultimoMov.codigo);
    if (prod) {
      if (ultimoMov.entrada > 0) prod.entradas = Math.max(0, prod.entradas - ultimoMov.entrada);
      if (ultimoMov.salida > 0) prod.salidas = Math.max(0, prod.salidas - ultimoMov.salida);
      if (window.db) window.db.collection("iapci_productos").doc(prod.id).set(prod);
    }

    // Mover a la papelera
    const eliminado = historialMovimientos.shift();
    papeleraReciclaje.unshift({
      id: "PAP_" + Date.now(),
      tipo: "movimiento",
      fechaEliminacion: new Date().toLocaleString(),
      datos: eliminado
    });

    guardarEstadoLocal();
    if (window.db) {
      window.db.collection("iapci_historial").doc(eliminado.id).delete();
      window.db.collection("iapci_papelera").doc(papeleraReciclaje[0].id).set(papeleraReciclaje[0]);
    }

    mostrarNotificacion("🗑 Registro movido a la Papelera de Reciclaje.", 'info');
    actualizarVistasSistema();
  });
}

function limpiarFormulario() {
  document.getElementById("f-codigo").value = "";
  document.getElementById("f-producto").value = "";
  document.getElementById("f-categoria").value = "";
  document.getElementById("f-pasillo").value = "";
  document.getElementById("f-stock-min").value = "5";
  document.getElementById("f-und").value = "";
  document.getElementById("f-precio").value = "";
  document.getElementById("f-cantidad").value = "";
  document.getElementById("f-observacion").value = "";
  establecerFechaActual();
}

// ==========================================
// RENDERIZADO DE TABLAS Y REPORTES
// ==========================================
function actualizarVistasSistema() {
  renderizarTablaStock();
  renderizarTablaHistorial();
  renderizarReporteGeneral();
  renderizarPapelera();
}

function renderizarTablaStock() {
  const tbody = document.getElementById("cuerpo-tabla-stock");
  if (!tbody) return;

  tbody.innerHTML = "";

  let totInic = 0, totEnt = 0, totSal = 0, totAct = 0;

  inventarioProductos.forEach(prod => {
    const stockActual = prod.stockInic + prod.entradas - prod.salidas;
    const valorDisponible = stockActual * prod.precio;

    totInic += prod.stockInic;
    totEnt += prod.entradas;
    totSal += prod.salidas;
    totAct += stockActual;

    let badgeEstado = "";
    if (stockActual === 0) {
      badgeEstado = `<span class="badge-agotado">🚫 AGOTADO</span>`;
    } else if (stockActual <= prod.stockMin) {
      badgeEstado = `<span class="badge-bajo">⚠️ BAJO NIVEL</span>`;
    } else {
      badgeEstado = `<span class="badge-buen">✅ BUEN NIVEL</span>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${prod.codigo}</strong></td>
      <td>${prod.producto}</td>
      <td>${prod.categoria}</td>
      <td>${prod.pasillo}</td>
      <td>${prod.und}</td>
      <td>Bs.S ${prod.precio.toFixed(2)}</td>
      <td>${prod.stockInic}</td>
      <td>${prod.entradas}</td>
      <td>${prod.salidas}</td>
      <td><strong>${stockActual}</strong></td>
      <td>Bs.S ${valorDisponible.toFixed(2)}</td>
      <td>${prod.stockMin}</td>
      <td>${badgeEstado}</td>
      <td>${prod.observacion || '-'}</td>
      <td>
        <button onclick="eliminarProductoMaestro('${prod.id}')" style="background: #e74c3c; color: white; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 11px;" title="Mover a papelera">🗑</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const lblInic = document.getElementById("tot-stock-inic");
  const lblEnt = document.getElementById("tot-stock-entradas");
  const lblSal = document.getElementById("tot-stock-salidas");
  const lblAct = document.getElementById("tot-stock-actual");

  if (lblInic) lblInic.textContent = totInic;
  if (lblEnt) lblEnt.textContent = totEnt;
  if (lblSal) lblSal.textContent = totSal;
  if (lblAct) lblAct.textContent = totAct;
}

function renderizarTablaHistorial() {
  const tbody = document.getElementById("cuerpo-tabla-historial");
  if (!tbody) return;

  tbody.innerHTML = "";

  let sumPrecio = 0, sumEnt = 0, sumSal = 0, sumMontoTotal = 0;

  historialMovimientos.forEach(mov => {
    sumPrecio += mov.precio;
    sumEnt += mov.entrada;
    sumSal += mov.salida;
    sumMontoTotal += mov.precioTotal;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${mov.fecha}</td>
      <td><strong>${mov.codigo}</strong></td>
      <td>${mov.producto}</td>
      <td>${mov.categoria}</td>
      <td>${mov.pasillo}</td>
      <td>${mov.und}</td>
      <td>Bs.S ${mov.precio.toFixed(2)}</td>
      <td>$ ${mov.precioUSD ? mov.precioUSD.toFixed(2) : '0.00'}</td>
      <td style="color: green; font-weight: bold;">${mov.entrada > 0 ? mov.entrada : ''}</td>
      <td style="color: red; font-weight: bold;">${mov.salida > 0 ? mov.salida : ''}</td>
      <td><strong>Bs.S ${mov.precioTotal.toFixed(2)}</strong></td>
      <td>${mov.observacion || ''}</td>
    `;
    tbody.appendChild(tr);
  });

  const lblPrecio = document.getElementById("tot-precio");
  const lblEnt = document.getElementById("tot-entradas");
  const lblSal = document.getElementById("tot-salidas");
  const lblMontoTotal = document.getElementById("tot-monto-total");

  if (lblPrecio) lblPrecio.textContent = `Bs.S ${sumPrecio.toFixed(2)}`;
  if (lblEnt) lblEnt.textContent = sumEnt;
  if (lblSal) lblSal.textContent = sumSal;
  if (lblMontoTotal) lblMontoTotal.textContent = `Bs.S ${sumMontoTotal.toFixed(2)}`;
}

function renderizarReporteGeneral() {
  const totalProds = inventarioProductos.length;
  let valorTotalBs = 0;
  let stockDisponible = 0;
  let totalSalidas = 0;

  let countBuenNivel = 0;
  let countBajoNivel = 0;
  let countAgotados = 0;

  const categoriasMap = {};

  inventarioProductos.forEach(p => {
    const stockActual = p.stockInic + p.entradas - p.salidas;
    const valorBs = stockActual * p.precio;

    valorTotalBs += valorBs;
    stockDisponible += stockActual;
    totalSalidas += p.salidas;

    if (stockActual === 0) {
      countAgotados++;
    } else if (stockActual <= p.stockMin) {
      countBajoNivel++;
    } else {
      countBuenNivel++;
    }

    // Resumen agrupado por categoría
    const cat = p.categoria || "General";
    if (!categoriasMap[cat]) {
      categoriasMap[cat] = { prods: 0, stock: 0, valor: 0 };
    }
    categoriasMap[cat].prods += 1;
    categoriasMap[cat].stock += stockActual;
    categoriasMap[cat].valor += valorBs;
  });

  // Actualizar Tarjetas de Estadísticas
  const cardProds = document.getElementById("card-total-productos");
  const cardValor = document.getElementById("card-valor-total");
  const cardStock = document.getElementById("card-stock-disponible");
  const cardSalidas = document.getElementById("card-total-salidas");

  if (cardProds) cardProds.textContent = totalProds;
  if (cardValor) cardValor.textContent = `Bs.S ${valorTotalBs.toFixed(2)}`;
  if (cardStock) cardStock.textContent = stockDisponible;
  if (cardSalidas) cardSalidas.textContent = totalSalidas;

  const cardBuen = document.getElementById("card-buen-nivel");
  const cardBajo = document.getElementById("card-bajo-nivel");
  const cardAgot = document.getElementById("card-agotados");

  if (cardBuen) cardBuen.textContent = countBuenNivel;
  if (cardBajo) cardBajo.textContent = countBajoNivel;
  if (cardAgot) cardAgot.textContent = countAgotados;

  // Leyendas explicativas
  const leyBuen = document.getElementById("leyenda-buen-nivel");
  const leyBajo = document.getElementById("leyenda-bajo-nivel");
  const leyAgot = document.getElementById("leyenda-agotados");

  if (leyBuen) leyBuen.textContent = `${countBuenNivel} productos`;
  if (leyBajo) leyBajo.textContent = `${countBajoNivel} productos`;
  if (leyAgot) leyAgot.textContent = `${countAgotados} productos`;

  // Tabla resumen por categoría
  const tbodyCat = document.getElementById("tabla-resumen-categoria");
  if (tbodyCat) {
    tbodyCat.innerHTML = "";
    let catTotProds = 0, catTotStock = 0, catTotValor = 0;

    Object.keys(categoriasMap).forEach(cat => {
      const data = categoriasMap[cat];
      catTotProds += data.prods;
      catTotStock += data.stock;
      catTotValor += data.valor;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${cat}</strong></td>
        <td>${data.prods}</td>
        <td>${data.stock}</td>
        <td>Bs.S ${data.valor.toFixed(2)}</td>
        <td><span class="badge-buen">Activo</span></td>
      `;
      tbodyCat.appendChild(tr);
    });

    const catProds = document.getElementById("cat-total-productos");
    const catStock = document.getElementById("cat-total-stock");
    const catValor = document.getElementById("cat-total-valor");

    if (catProds) catProds.textContent = catTotProds;
    if (catStock) catStock.textContent = catTotStock;
    if (catValor) catValor.textContent = `Bs.S ${catTotValor.toFixed(2)}`;
  }
}

// ==========================================
// MODAL DE CONFIGURACIÓN DE USUARIOS
// ==========================================
function toggleModalUsuarios() {
  const modal = document.getElementById("modal-usuarios");
  if (!modal) return;

  if (modal.classList.contains("oculto")) {
    // Cargar credenciales vigentes en los campos
    const cfgSopUser = document.getElementById("cfg-user-soporte");
    const cfgSopPass = document.getElementById("cfg-pass-soporte");
    const cfgAdmUser = document.getElementById("cfg-user-admin");
    const cfgAdmPass = document.getElementById("cfg-pass-admin");
    const cfgAsisUser = document.getElementById("cfg-user-asistente");
    const cfgAsisPass = document.getElementById("cfg-pass-asistente");

    if (cfgSopUser) cfgSopUser.value = "soporte";
    if (cfgSopPass) cfgSopPass.value = usuariosApp.soporte ? usuariosApp.soporte.clave : "";

    if (cfgAdmUser) cfgAdmUser.value = "admin";
    if (cfgAdmPass) cfgAdmPass.value = usuariosApp.admin ? usuariosApp.admin.clave : "";

    if (cfgAsisUser) cfgAsisUser.value = "asistente";
    if (cfgAsisPass) cfgAsisPass.value = usuariosApp.asistente ? usuariosApp.asistente.clave : "";

    modal.classList.remove("oculto");
    modal.style.display = "flex";
  } else {
    modal.classList.add("oculto");
    modal.style.display = "none";
  }
}

function guardarNuevosUsuarios() {
  const passSoporte = document.getElementById("cfg-pass-soporte").value;
  const passAdmin = document.getElementById("cfg-pass-admin").value;
  const passAsistente = document.getElementById("cfg-pass-asistente").value;

  if (passSoporte) usuariosApp.soporte.clave = passSoporte;
  if (passAdmin) usuariosApp.admin.clave = passAdmin;
  if (passAsistente) usuariosApp.asistente.clave = passAsistente;

  guardarEstadoLocal();
  mostrarNotificacion("⚙️ Credenciales de usuario actualizadas correctamente.", 'success');
  toggleModalUsuarios();
}

// ==========================================
// PAPELERA DE RECICLAJE Y RESTAURACIÓN
// ==========================================
function toggleModalPapelera() {
  const modal = document.getElementById("modal-papelera");
  if (!modal) return;

  if (modal.classList.contains("oculto")) {
    renderizarPapelera();
    modal.classList.remove("oculto");
    modal.style.display = "flex";
  } else {
    modal.classList.add("oculto");
    modal.style.display = "none";
  }
}

function renderizarPapelera() {
  const contenedor = document.getElementById("cuerpo-tabla-papelera");
  if (!contenedor) return;

  if (papeleraReciclaje.length === 0) {
    contenedor.innerHTML = `<p style="text-align: center; color: #7f8c8d; padding: 20px;">La papelera de reciclaje está vacía.</p>`;
    return;
  }

  let html = `
    <table class="tabla-inventario">
      <thead>
        <tr>
          <th><input type="checkbox" id="chk-sel-todos" onchange="seleccionarTodosPapelera(this)"></th>
          <th>Fecha Eliminación</th>
          <th>Tipo</th>
          <th>Código / Elemento</th>
          <th>Detalles</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
  `;

  papeleraReciclaje.forEach(item => {
    const d = item.datos;
    const detalle = item.tipo === 'movimiento' 
      ? `Movimiento (${d.fecha}) - Ent: ${d.entrada}, Sal: ${d.salida}, Total: Bs.S ${d.precioTotal.toFixed(2)}`
      : `Producto Catálogo: ${d.producto} (${d.categoria})`;

    html += `
      <tr>
        <td><input type="checkbox" class="chk-papelera" value="${item.id}"></td>
        <td>${item.fechaEliminacion}</td>
        <td><strong>${item.tipo.toUpperCase()}</strong></td>
        <td>${d.codigo || d.id}</td>
        <td>${detalle}</td>
        <td>
          <button onclick="restaurarElemento('${item.id}')" style="background:#27ae60; color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:11px;">♻️ Restaurar</button>
          <button onclick="eliminarDefinitivo('${item.id}')" style="background:#c0392b; color:white; border:none; padding:4px 8px; border-radius:3px; cursor:pointer; font-size:11px;">❌ Eliminar</button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  contenedor.innerHTML = html;
}

function seleccionarTodosPapelera(chkPadre) {
  const checkboxes = document.querySelectorAll(".chk-papelera");
  checkboxes.forEach(chk => chk.checked = chkPadre.checked);
}

function restaurarElemento(id) {
  const idx = papeleraReciclaje.findIndex(item => item.id === id);
  if (idx === -1) return;

  const item = papeleraReciclaje[idx];
  if (item.tipo === "movimiento") {
    historialMovimientos.unshift(item.datos);
    // Reaplicar al producto en el catálogo maestro
    const prod = inventarioProductos.find(p => p.codigo === item.datos.codigo);
    if (prod) {
      if (item.datos.entrada > 0) prod.entradas += item.datos.entrada;
      if (item.datos.salida > 0) prod.salidas += item.datos.salida;
      if (window.db) window.db.collection("iapci_productos").doc(prod.id).set(prod);
    }
    if (window.db) window.db.collection("iapci_historial").doc(item.datos.id).set(item.datos);
  } else if (item.tipo === "producto") {
    inventarioProductos.push(item.datos);
    if (window.db) window.db.collection("iapci_productos").doc(item.datos.id).set(item.datos);
  }

  papeleraReciclaje.splice(idx, 1);
  if (window.db) window.db.collection("iapci_papelera").doc(id).delete();

  guardarEstadoLocal();
  mostrarNotificacion("♻️ Elemento restaurado exitosamente.", 'success');
  renderizarPapelera();
  actualizarVistasSistema();
}

function eliminarDefinitivo(id) {
  solicitarConfirmacion("¿Está seguro de eliminar este elemento definitivamente?\nEsta acción no se puede deshacer.", () => {
    const idx = papeleraReciclaje.findIndex(item => item.id === id);
    if (idx !== -1) {
      papeleraReciclaje.splice(idx, 1);
      if (window.db) window.db.collection("iapci_papelera").doc(id).delete();
      guardarEstadoLocal();
      mostrarNotificacion("Elemento eliminado permanentemente.", 'info');
      renderizarPapelera();
    }
  });
}

function eliminarSeleccionadosPapelera() {
  const seleccionados = Array.from(document.querySelectorAll(".chk-papelera:checked")).map(c => c.value);
  if (seleccionados.length === 0) {
    mostrarNotificacion("Seleccione al menos un elemento de la papelera.", 'warning');
    return;
  }

  solicitarConfirmacion(`¿Desea eliminar definitivamente los ${seleccionados.length} elementos seleccionados?`, () => {
    seleccionados.forEach(id => {
      const idx = papeleraReciclaje.findIndex(item => item.id === id);
      if (idx !== -1) papeleraReciclaje.splice(idx, 1);
      if (window.db) window.db.collection("iapci_papelera").doc(id).delete();
    });

    guardarEstadoLocal();
    mostrarNotificacion(`${seleccionados.length} elementos eliminados de la papelera.`, 'info');
    renderizarPapelera();
  });
}

function vaciarPapelera() {
  const ejecutarVaciado = () => {
    const listaPapelera = (typeof papeleraMovimientos !== "undefined") ? papeleraMovimientos : papeleraReciclaje;
    
    if (!listaPapelera || listaPapelera.length === 0) {
      mostrarNotificacion("La papelera ya está vacía.", 'info');
      return;
    }

    solicitarConfirmacion("⚠️ ¿Está seguro de que desea vaciar permanentemente toda la papelera?", async () => {
      try {
        const firestoreDb = (typeof db !== "undefined") ? db : (window.db || null);
        if (firestoreDb) {
          const snapshot = await firestoreDb.collection("iapci_papelera").get();
          const batch = firestoreDb.batch();
          snapshot.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      } catch (error) {
        console.error("Error al vaciar papelera en Firestore:", error);
      }

      // Limpiar arreglos locales
      if (typeof papeleraMovimientos !== "undefined") papeleraMovimientos = [];
      if (typeof papeleraReciclaje !== "undefined") papeleraReciclaje = [];

      // Persistir y refrescar interfaz
      if (typeof guardarEstadoSistema === "function") guardarEstadoSistema();
      if (typeof guardarEstadoLocal === "function") guardarEstadoLocal();

      if (typeof renderTablaPapelera === "function") renderTablaPapelera();
      if (typeof renderizarPapelera === "function") renderizarPapelera();

      mostrarNotificacion("✅ Papelera vaciada con éxito.", 'success');
    });
  };

  // Validar permisos de administrador si la función existe
  if (typeof verificarPermisoAdmin === "function") {
    verificarPermisoAdmin(ejecutarVaciado);
  } else {
    ejecutarVaciado();
  }
}

// Alias de compatibilidad
const vaciarPapeleraSegura = vaciarPapelera;

function eliminarProductoMaestro(id) {
  solicitarConfirmacion("¿Está seguro de mover este producto del catálogo a la Papelera de Reciclaje?", () => {
    const idx = inventarioProductos.findIndex(p => p.id === id);
    if (idx !== -1) {
      const eliminado = inventarioProductos.splice(idx, 1)[0];
      papeleraReciclaje.unshift({
        id: "PAP_" + Date.now(),
        tipo: "producto",
        fechaEliminacion: new Date().toLocaleString(),
        datos: eliminado
      });

      if (window.db) {
        window.db.collection("iapci_productos").doc(id).delete();
        window.db.collection("iapci_papelera").doc(papeleraReciclaje[0].id).set(papeleraReciclaje[0]);
      }

      guardarEstadoLocal();
      actualizarVistasSistema();
      mostrarNotificacion(`🗑 Producto "${eliminado.producto}" movido a la papelera.`, 'info');
    }
  });
}
