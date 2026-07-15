/*
 * Formulario público de InmoPRO Ayacucho.
 * Envía solicitudes a un Web App de Google Apps Script y conserva únicamente
 * los envíos pendientes cuando el dispositivo está sin conexión.
 */

(() => {
  "use strict";

  const CONFIG = window.INMOCONECTA_CONFIG || {};
  const APPS_SCRIPT_URL = String(CONFIG.appsScriptUrl || "").trim();
  const PENDING_KEY = "inmoConectaPending_v1";
  const form = document.querySelector("#leadForm");
  const submitButton = document.querySelector("#submitButton");
  const connectionStatus = document.querySelector("#connectionStatus");
  const successDialog = document.querySelector("#successDialog");
  const successTitle = document.querySelector("#successTitle");
  const successMessage = successDialog.querySelector("p");
  const registrationCode = document.querySelector("#registrationCode");
  const closeSuccessButton = document.querySelector("#closeSuccessButton");
  const toast = document.querySelector("#toast");
  const toastIcon = document.querySelector("#toastIcon");
  const toastMessage = document.querySelector("#toastMessage");

  let toastTimer;

  const field = (name) => form.elements.namedItem(name);
  const value = (name) => String(field(name)?.value || "").trim();
  const checked = (name) => Boolean(field(name)?.checked);

  function peruPhone(valueToNormalize) {
    const digits = String(valueToNormalize || "").replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("51") ? digits.slice(2) : digits;
  }

  function endpointConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(APPS_SCRIPT_URL);
  }

  function updateConnectionStatus(message = "") {
    const online = navigator.onLine;
    connectionStatus.classList.toggle("is-offline", !online);
    connectionStatus.innerHTML = online
      ? `<span aria-hidden="true"></span>${message || "Conexión disponible"}`
      : '<span aria-hidden="true"></span>Sin conexión: guardaremos el envío en este dispositivo';
  }

  function showToast(message, type = "success") {
    window.clearTimeout(toastTimer);
    toastIcon.textContent = type === "error" ? "!" : type === "info" ? "i" : "✓";
    toastMessage.textContent = message;
    toast.dataset.type = type;
    toast.classList.add("show");
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 4200);
  }

  function setFieldError(name, message = "") {
    const control = field(name);
    if (!control) return;
    const label = control.closest("label");
    const error = label?.querySelector(".error");
    control.setAttribute("aria-invalid", message ? "true" : "false");
    if (error) error.textContent = message;
  }

  function clearErrors() {
    form.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
      control.setAttribute("aria-invalid", "false");
    });
    form.querySelectorAll(".error").forEach((error) => { error.textContent = ""; });
    document.querySelector("#consentError").textContent = "";
  }

  function validateForm() {
    clearErrors();
    let firstInvalid = null;

    const requireField = (name, message) => {
      if (!value(name)) {
        setFieldError(name, message);
        firstInvalid ||= field(name);
      }
    };

    requireField("nombres", "Escribe tus nombres.");
    requireField("apellidos", "Escribe tus apellidos.");
    requireField("numeroDocumento", "Escribe tu DNI.");
    requireField("celular", "Escribe un número de celular.");

    if (value("numeroDocumento") && !/^\d{8}$/.test(value("numeroDocumento"))) {
      setFieldError("numeroDocumento", "El DNI debe tener exactamente 8 dígitos.");
      firstInvalid ||= field("numeroDocumento");
    }

    const phoneDigits = peruPhone(value("celular"));
    if (value("celular") && phoneDigits.length < 9) {
      setFieldError("celular", "Ingresa al menos 9 dígitos.");
      firstInvalid ||= field("celular");
    }

    const email = value("correo");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError("correo", "Revisa el correo electrónico.");
      firstInvalid ||= field("correo");
    }

    if (!checked("consentimiento")) {
      document.querySelector("#consentError").textContent = "Debes autorizar el tratamiento de datos para enviar la solicitud.";
      field("consentimiento").setAttribute("aria-invalid", "true");
      firstInvalid ||= field("consentimiento");
    }

    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  function createRegistrationId() {
    const token = window.crypto?.randomUUID
      ? window.crypto.randomUUID().split("-")[0].toUpperCase()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    return `REG-${token}`;
  }

  function formPayload() {
    return {
      id: createRegistrationId(),
      fechaCliente: new Date().toISOString(),
      nombres: value("nombres"),
      apellidos: value("apellidos"),
      numeroDocumento: value("numeroDocumento").replace(/\D/g, ""),
      celular: peruPhone(value("celular")),
      correo: value("correo"),
      consentimiento: checked("consentimiento") ? "Sí" : "No"
    };
  }

  function getPending() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function savePending(items) {
    localStorage.setItem(PENDING_KEY, JSON.stringify(items));
  }

  function queuePayload(payload) {
    const items = getPending();
    if (!items.some((item) => item.id === payload.id)) items.push(payload);
    savePending(items);
  }

  async function sendPayload(payload) {
    if (!endpointConfigured()) throw new Error("CONFIG_NOT_READY");
    if (!navigator.onLine) throw new Error("OFFLINE");

    // no-cors evita exponer permisos de lectura. El receptor público solo acepta escritura.
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  }

  async function retryPending() {
    if (!navigator.onLine || !endpointConfigured()) return;
    const pending = getPending();
    if (!pending.length) return;

    const remaining = [];
    for (const payload of pending) {
      try {
        await sendPayload(payload);
      } catch {
        remaining.push(payload);
      }
    }
    savePending(remaining);
    if (pending.length !== remaining.length) {
      showToast(`${pending.length - remaining.length} solicitud(es) pendiente(s) sincronizada(s).`);
    }
  }

  function showSuccess(payload, queued = false) {
    successTitle.textContent = queued ? "Registro guardado en este dispositivo" : "¡Gracias por registrarse!";
    successMessage.textContent = queued
      ? "No hay conexión. La solicitud se enviará automáticamente cuando este navegador vuelva a tener internet."
      : "Su información fue enviada. El equipo de InmoPRO Ayacucho se comunicará con usted próximamente.";
    registrationCode.textContent = `Código de registro: ${payload.id}`;
    if (typeof successDialog.showModal === "function") successDialog.showModal();
    else successDialog.setAttribute("open", "");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validateForm()) return;

    if (!endpointConfigured()) {
      showToast("Falta configurar la URL de Google Apps Script en config.js.", "error");
      return;
    }

    const payload = formPayload();
    submitButton.disabled = true;
    submitButton.textContent = "Enviando…";

    try {
      await sendPayload(payload);
      form.reset();
      showSuccess(payload, false);
    } catch (error) {
      if (error.message === "CONFIG_NOT_READY") {
        showToast("La conexión con Google Sheets aún no está configurada.", "error");
      } else {
        queuePayload(payload);
        form.reset();
        showSuccess(payload, true);
      }
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Registrar mis datos →";
      updateConnectionStatus();
    }
  }

  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", (event) => {
    if (event.target.name) setFieldError(event.target.name);
    if (event.target.name === "consentimiento") document.querySelector("#consentError").textContent = "";
  });
  closeSuccessButton.addEventListener("click", () => successDialog.close());
  window.addEventListener("online", () => {
    updateConnectionStatus("Conexión recuperada; sincronizando…");
    retryPending().finally(() => updateConnectionStatus());
  });
  window.addEventListener("offline", () => updateConnectionStatus());

  updateConnectionStatus();
  retryPending();
})();
