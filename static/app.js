const API_BASE = "/api";

const state = {
    currentView: "cameras",
    cameras: [],
    selectedCameraId: null,
    contacts: [],
    editingContactId: null,
    camerasRefreshTimer: null,
    serverStatusTimer: null,
    clockTimer: null,
    alertedCameras: new Set()
};

const camerasTab = document.getElementById("camerasTab");
const contactsTab = document.getElementById("contactsTab");
const cameraList = document.getElementById("cameraList");
const cameraView = document.getElementById("cameraView");
const contactsView = document.getElementById("contactsView");
const cameraFrame = document.querySelector(".camera-frame");
const cameraLiveOverlay = document.getElementById("cameraLiveOverlay");
const cameraOverlayName = document.getElementById("cameraOverlayName");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const cameraPlaceholderTitle = document.getElementById("cameraPlaceholderTitle");
const cameraPlaceholderMessage = document.getElementById("cameraPlaceholderMessage");
const cameraInfoName = document.getElementById("cameraInfoName");
const cameraInfoStatus = document.getElementById("cameraInfoStatus");
const cameraInfoDetection = document.getElementById("cameraInfoDetection");
const pageEyebrow = document.getElementById("pageEyebrow");
const pageTitle = document.getElementById("pageTitle");
const systemStatusDot = document.getElementById("systemStatusDot");
const systemStatusValue = document.getElementById("systemStatusValue");
const connectionDot = document.getElementById("connectionDot");
const connectionStatusText = document.getElementById("connectionStatusText");
const currentTime = document.getElementById("currentTime");
const contactsTableBody = document.getElementById("contactsTableBody");
const contactsEmpty = document.getElementById("contactsEmpty");
const addContactButton = document.getElementById("addContactButton");

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
    setupEventListeners();
    updateClock();
    state.clockTimer = setInterval(updateClock, 1000);

    await checkServerStatus();
    await loadCameras();
    await loadContacts();

    state.camerasRefreshTimer = setInterval(loadCameras, 8000);
    state.serverStatusTimer = setInterval(checkServerStatus, 8000);
}

function setupEventListeners() {
    camerasTab.addEventListener("click", handleCamerasTabClick);
    contactsTab.addEventListener("click", handleContactsTabClick);
    addContactButton.addEventListener("click", () => openContactModal());
}

function handleCamerasTabClick() {
    if (state.currentView === "cameras") {
        toggleCameraList();
        return;
    }

    showCameraView();
    cameraList.classList.remove("collapsed");
    camerasTab.setAttribute("aria-expanded", "true");
}

function toggleCameraList() {
    const collapsed = cameraList.classList.toggle("collapsed");
    camerasTab.setAttribute("aria-expanded", String(!collapsed));
}

async function loadCameras() {
    try {
        const response = await fetch(`${API_BASE}/cameras`, {
            headers: { "Accept": "application/json" },
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`Camera API returned ${response.status}`);
        }

        const cameras = await response.json();

        if (!Array.isArray(cameras)) {
            throw new Error("Invalid camera data received from backend.");
        }

        state.cameras = cameras;

        checkDetectionAlerts();

        if (
            state.selectedCameraId === null ||
            !state.cameras.some(camera =>
                String(camera.id) === String(state.selectedCameraId)
            )
        ) {
            state.selectedCameraId = state.cameras.length
                ? state.cameras[0].id
                : null;
        }

        renderCameras();

        if (state.currentView === "cameras") {
            updateCameraDisplay();
        }
    } catch (error) {
        console.error("Failed to load cameras:", error);

        if (!state.cameras.length) {
            cameraList.innerHTML = "";
            showNoCameraData();
        }
    }
}

function renderCameras() {
    cameraList.innerHTML = "";

    if (!state.cameras.length) {
        const empty = document.createElement("div");
        empty.className = "camera-item";
        empty.innerHTML = `
            <span class="camera-status"></span>
            <span class="camera-name">No cameras available</span>
        `;
        cameraList.appendChild(empty);
        return;
    }

    state.cameras.forEach(camera => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "camera-item";
        button.classList.add(camera.connected ? "online" : "offline");

        if (String(camera.id) === String(state.selectedCameraId)) {
            button.classList.add("active");
        }

        const status = document.createElement("span");
        status.className = "camera-status";

        const name = document.createElement("span");
        name.className = "camera-name";
        name.textContent = camera.name || `Camera ${camera.id}`;

        button.append(status, name);
        button.addEventListener("click", () => selectCamera(camera.id));
        cameraList.appendChild(button);
    });
}

function selectCamera(cameraId) {
    if (String(state.selectedCameraId) === String(cameraId)) {
        return;
    }

    state.selectedCameraId = cameraId;
    renderCameras();
    updateCameraDisplay(true);
}

function getSelectedCamera() {
    return state.cameras.find(
        camera => String(camera.id) === String(state.selectedCameraId)
    ) || null;
}

function updateCameraDisplay(forceStreamUpdate = false) {
    const camera = getSelectedCamera();

    if (!camera) {
        showNoCameraSelected();
        return;
    }

    const name = camera.name || `Camera ${camera.id}`;

    cameraOverlayName.textContent = name;
    cameraInfoName.textContent = name;

    if (camera.connected) {
        showCameraConnected(camera, forceStreamUpdate);
    } else {
        showCameraDisconnected(camera);
    }
}

function showCameraConnected(camera, forceStreamUpdate = false) {
    let stream = document.getElementById("cameraStream");

    const streamCameraId = stream?.dataset.cameraId;

    if (!stream || forceStreamUpdate || String(streamCameraId) !== String(camera.id)) {
        removeCameraStream();

        stream = document.createElement("img");
        stream.className = "camera-stream";
        stream.id = "cameraStream";
        stream.dataset.cameraId = String(camera.id);
        stream.alt = `${camera.name || `Camera ${camera.id}`} live feed`;
        stream.src = `${API_BASE}/cameras/${encodeURIComponent(camera.id)}/stream`;

        stream.addEventListener("error", () => {
            if (String(state.selectedCameraId) !== String(camera.id)) {
                return;
            }

            stream.remove();

            cameraLiveOverlay.classList.add("hidden");
            cameraPlaceholder.classList.remove("hidden");

            cameraPlaceholderTitle.textContent = "Camera stream unavailable";
            cameraPlaceholderMessage.textContent =
                "The camera is connected, but no video signal is currently available.";

            cameraInfoStatus.textContent = "Stream unavailable";
            cameraInfoStatus.className = "info-value status-offline";
        });

        cameraFrame.appendChild(stream);
    }

    cameraPlaceholder.classList.add("hidden");
    cameraLiveOverlay.classList.remove("hidden");

    cameraInfoStatus.textContent = "Connected";
    cameraInfoStatus.className = "info-value status-online";

    cameraInfoDetection.textContent = camera.detected
        ? "Red object detected"
        : "Active";

    cameraInfoDetection.className = camera.detected
        ? "info-value status-offline"
        : "info-value status-online";
}

function showCameraDisconnected(camera) {
    removeCameraStream();

    cameraLiveOverlay.classList.add("hidden");
    cameraPlaceholder.classList.remove("hidden");

    cameraPlaceholderTitle.textContent = "Camera not connected";
    cameraPlaceholderMessage.textContent =
        "No video signal is currently available from this camera.";

    cameraInfoName.textContent = camera.name || `Camera ${camera.id}`;

    cameraInfoStatus.textContent = "Not connected";
    cameraInfoStatus.className = "info-value status-offline";

    cameraInfoDetection.textContent = "Unavailable";
    cameraInfoDetection.className = "info-value status-offline";
}

function showNoCameraSelected() {
    removeCameraStream();

    cameraLiveOverlay.classList.add("hidden");
    cameraOverlayName.textContent = "";

    cameraPlaceholder.classList.remove("hidden");

    cameraPlaceholderTitle.textContent = "No camera selected";
    cameraPlaceholderMessage.textContent =
        "No camera is currently available for display.";

    cameraInfoName.textContent = "—";
    cameraInfoStatus.textContent = "Unavailable";
    cameraInfoStatus.className = "info-value status-offline";

    cameraInfoDetection.textContent = "Unavailable";
    cameraInfoDetection.className = "info-value status-offline";
}

function showNoCameraData() {
    removeCameraStream();

    cameraLiveOverlay.classList.add("hidden");
    cameraOverlayName.textContent = "";

    cameraPlaceholder.classList.remove("hidden");

    cameraPlaceholderTitle.textContent = "No cameras available";
    cameraPlaceholderMessage.textContent =
        "The backend has not reported any cameras.";

    cameraInfoName.textContent = "—";
    cameraInfoStatus.textContent = "Unavailable";
    cameraInfoStatus.className = "info-value status-offline";

    cameraInfoDetection.textContent = "Unavailable";
    cameraInfoDetection.className = "info-value status-offline";
}

function removeCameraStream() {
    const stream = document.getElementById("cameraStream");

    if (stream) {
        stream.src = "";
        stream.remove();
    }
}

// Detection alerts

function checkDetectionAlerts() {
    state.cameras.forEach(camera => {
        const cameraId = String(camera.id);

        if (camera.detected) {
            if (!state.alertedCameras.has(cameraId)) {
                state.alertedCameras.add(cameraId);
                showDetectionAlert(camera);
            }
        } else {
            state.alertedCameras.delete(cameraId);
        }
    });
}

function showDetectionAlert(camera) {
    closeDetectionAlert();

    const cameraName = camera.name || `Camera ${camera.id}`;

    const overlay = document.createElement("div");
    overlay.className = "detection-alert-overlay";
    overlay.id = "detectionAlertOverlay";

    const modal = document.createElement("div");
    modal.className = "detection-alert-modal";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "detectionAlertTitle");

    const icon = document.createElement("div");
    icon.className = "detection-alert-icon";
    icon.textContent = "⚠";

    const title = document.createElement("h3");
    title.id = "detectionAlertTitle";
    title.textContent = "Red Object Detected";

    const message = document.createElement("p");
    message.textContent = `A red object has been detected on ${cameraName}.`;

    const actions = document.createElement("div");
    actions.className = "detection-alert-actions";

    const ignoreButton = document.createElement("button");
    ignoreButton.type = "button";
    ignoreButton.className = "detection-alert-button ignore";
    ignoreButton.textContent = "Ignore";
    ignoreButton.addEventListener("click", closeDetectionAlert);

    const switchButton = document.createElement("button");
    switchButton.type = "button";
    switchButton.className = "detection-alert-button switch";
    switchButton.textContent = `Switch to ${cameraName}`;

    switchButton.addEventListener("click", () => {
        state.selectedCameraId = camera.id;
        renderCameras();
        updateCameraDisplay(true);

        if (state.currentView !== "cameras") {
            showCameraView();
        }

        closeDetectionAlert();
    });

    actions.append(ignoreButton, switchButton);
    modal.append(icon, title, message, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    ignoreButton.focus();
}

function closeDetectionAlert() {
    document.getElementById("detectionAlertOverlay")?.remove();
}

// Camera view

function showCameraView() {
    state.currentView = "cameras";

    camerasTab.classList.add("active");
    contactsTab.classList.remove("active");

    cameraView.classList.remove("hidden");
    contactsView.classList.add("hidden");

    pageEyebrow.textContent = "LIVE MONITORING";
    pageTitle.textContent = "Camera Monitoring";

    updateCameraDisplay(true);
}

async function showContactsView() {
    state.currentView = "contacts";

    camerasTab.classList.remove("active");
    contactsTab.classList.add("active");

    cameraView.classList.add("hidden");
    contactsView.classList.remove("hidden");

    pageEyebrow.textContent = "SECURITY CONTACTS";
    pageTitle.textContent = "Registered Contacts";

    await loadContacts();
}

function handleContactsTabClick() {
    showContactsView();
}

// Contacts

async function loadContacts() {
    try {
        const response = await fetch(`${API_BASE}/contacts`, {
            headers: { "Accept": "application/json" },
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`Contact API returned ${response.status}`);
        }

        const contacts = await response.json();

        if (!Array.isArray(contacts)) {
            throw new Error("Invalid contact data received from backend.");
        }

        state.contacts = contacts;
        renderContacts();
    } catch (error) {
        console.error("Failed to load contacts:", error);
        state.contacts = [];
        renderContacts();
    }
}

function renderContacts() {
    contactsTableBody.innerHTML = "";

    if (!state.contacts.length) {
        contactsEmpty.classList.remove("hidden");
        return;
    }

    contactsEmpty.classList.add("hidden");

    state.contacts.forEach(contact => {
        const row = document.createElement("tr");

        const nameCell = document.createElement("td");
        const nameContainer = document.createElement("div");
        nameContainer.className = "contact-name";

        const avatar = document.createElement("div");
        avatar.className = "contact-avatar";
        avatar.textContent = getContactInitials(contact.name);

        const nameText = document.createElement("span");
        nameText.textContent = contact.name || "Unnamed Contact";

        nameContainer.append(avatar, nameText);
        nameCell.appendChild(nameContainer);

        const phoneCell = document.createElement("td");
        phoneCell.textContent = contact.phone_number || "—";

        const actionsCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "contact-actions";

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "action-button edit";
        editButton.title = "Edit contact";
        editButton.setAttribute(
            "aria-label",
            `Edit ${contact.name || "contact"}`
        );
        editButton.textContent = "✎";
        editButton.addEventListener(
            "click",
            () => openContactModal(contact)
        );

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "action-button delete";
        deleteButton.title = "Delete contact";
        deleteButton.setAttribute(
            "aria-label",
            `Delete ${contact.name || "contact"}`
        );
        deleteButton.textContent = "×";
        deleteButton.addEventListener(
            "click",
            () => deleteContact(contact.id)
        );

        actions.append(editButton, deleteButton);
        actionsCell.appendChild(actions);
        row.append(nameCell, phoneCell, actionsCell);
        contactsTableBody.appendChild(row);
    });
}

function getContactInitials(name) {
    if (!name) {
        return "?";
    }

    const words = name.trim().split(/\s+/).filter(Boolean);

    if (words.length === 1) {
        return words[0].substring(0, 2).toUpperCase();
    }

    return (
        words[0][0] +
        words[words.length - 1][0]
    ).toUpperCase();
}

function openContactModal(contact = null) {
    closeContactModal();
    state.editingContactId = contact?.id ?? null;

    const overlay = document.createElement("div");
    overlay.className = "contact-modal-overlay";
    overlay.id = "contactModalOverlay";

    const modal = document.createElement("div");
    modal.className = "contact-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "contact-modal-header";

    const title = document.createElement("h3");
    title.textContent = contact ? "Edit Contact" : "Add Contact";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "modal-close-button";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.addEventListener("click", closeContactModal);

    header.append(title, closeButton);

    const body = document.createElement("div");
    body.className = "contact-modal-body";

    const form = document.createElement("form");
    form.id = "contactForm";

    form.append(
        createFormGroup(
            "Name",
            "contactName",
            "text",
            contact?.name || "",
            "Enter contact name"
        ),
        createFormGroup(
            "Phone Number",
            "contactPhone",
            "tel",
            contact?.phone_number || "",
            "Enter phone number"
        )
    );

    body.appendChild(form);

    const footer = document.createElement("div");
    footer.className = "contact-modal-footer";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "modal-button cancel";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", closeContactModal);

    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.setAttribute("form", "contactForm");
    submitButton.className = "modal-button submit";
    submitButton.textContent = contact ? "Save Changes" : "Add Contact";

    footer.append(cancelButton, submitButton);
    form.addEventListener("submit", handleContactSubmit);

    modal.append(header, body, footer);
    overlay.appendChild(modal);

    overlay.addEventListener("click", event => {
        if (event.target === overlay) {
            closeContactModal();
        }
    });

    document.body.appendChild(overlay);

    document.getElementById("contactName")?.focus();
    document.addEventListener("keydown", handleModalEscape);
}

function createFormGroup(labelText, inputId, inputType, value, placeholder) {
    const group = document.createElement("div");
    group.className = "form-group";

    const label = document.createElement("label");
    label.className = "form-label";
    label.htmlFor = inputId;
    label.textContent = labelText;

    const input = document.createElement("input");
    input.className = "form-input";
    input.id = inputId;
    input.name = inputId;
    input.type = inputType;
    input.value = value;
    input.placeholder = placeholder;
    input.required = true;

    group.append(label, input);
    return group;
}

async function handleContactSubmit(event) {
    event.preventDefault();

    const nameInput = document.getElementById("contactName");
    const phoneInput = document.getElementById("contactPhone");

    if (!nameInput || !phoneInput) {
        return;
    }

    const name = nameInput.value.trim();
    const phoneNumber = phoneInput.value.trim();

    if (!name) {
        alert("Please enter a contact name.");
        nameInput.focus();
        return;
    }

    if (!phoneNumber) {
        alert("Please enter a phone number.");
        phoneInput.focus();
        return;
    }

    const submitButton = event.target
        .closest(".contact-modal")
        ?.querySelector(".modal-button.submit");

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent =
            state.editingContactId !== null
                ? "Saving..."
                : "Adding...";
    }

    const payload = {
        name,
        phone_number: phoneNumber,
        notification_token: null
    };

    try {
        const url = state.editingContactId !== null
            ? `${API_BASE}/contacts/${encodeURIComponent(state.editingContactId)}`
            : `${API_BASE}/contacts`;

        const method = state.editingContactId !== null
            ? "PUT"
            : "POST";

        const response = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            let message = `Request failed with status ${response.status}.`;

            try {
                const data = await response.json();
                if (data.error) {
                    message = data.error;
                }
            } catch (_) {}

            throw new Error(message);
        }

        closeContactModal();
        await loadContacts();
    } catch (error) {
        console.error("Failed to save contact:", error);
        alert(error.message || "Failed to save contact.");

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent =
                state.editingContactId !== null
                    ? "Save Changes"
                    : "Add Contact";
        }
    }
}

async function deleteContact(contactId) {
    const contact = state.contacts.find(
        item => String(item.id) === String(contactId)
    );

    const contactName = contact?.name || "this contact";

    if (!window.confirm(`Are you sure you want to delete ${contactName}?`)) {
        return;
    }

    try {
        const response = await fetch(
            `${API_BASE}/contacts/${encodeURIComponent(contactId)}`,
            {
                method: "DELETE",
                headers: { "Accept": "application/json" }
            }
        );

        if (!response.ok) {
            let message = `Delete failed with status ${response.status}.`;

            try {
                const data = await response.json();
                if (data.error) {
                    message = data.error;
                }
            } catch (_) {}

            throw new Error(message);
        }

        await loadContacts();
    } catch (error) {
        console.error("Failed to delete contact:", error);
        alert(error.message || "Failed to delete contact.");
    }
}

function closeContactModal() {
    document.getElementById("contactModalOverlay")?.remove();
    state.editingContactId = null;
    document.removeEventListener("keydown", handleModalEscape);
}

function handleModalEscape(event) {
    if (event.key === "Escape") {
        closeContactModal();
    }
}

// Server status

async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`, {
            headers: { "Accept": "application/json" },
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();

        setConnectionStatus(true);

        const operational =
            data.server === "running" ||
            data.status === "running" ||
            data.status === "online";

        setSystemStatus(true, operational ? "Operational" : "Connected");
    } catch (error) {
        console.error("Backend status check failed:", error);
        setConnectionStatus(false);
        setSystemStatus(false, "Offline");
    }
}

function setConnectionStatus(connected) {
    connectionDot.classList.toggle("offline", !connected);
    connectionStatusText.textContent = connected
        ? "Backend connected"
        : "Backend disconnected";
}

function setSystemStatus(online, text) {
    systemStatusValue.textContent = text;
    systemStatusDot.classList.toggle("offline", !online);
}

function updateClock() {
    const now = new Date();

    const time = [
        now.getHours(),
        now.getMinutes(),
        now.getSeconds()
    ].map(value => String(value).padStart(2, "0")).join(":");

    currentTime.textContent = time;
}

window.addEventListener("beforeunload", () => {
    clearInterval(state.camerasRefreshTimer);
    clearInterval(state.serverStatusTimer);
    clearInterval(state.clockTimer);
});
