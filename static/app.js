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
const fsBtn = document.getElementById("fullscreenBtn");
const exitBtn = document.getElementById("exitFullscreenBtn");

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
        if (state.currentView !== "cameras") {
            showCameraView();
        }
        return;
    }

    state.selectedCameraId = cameraId;

    renderCameras();

    if (state.currentView !== "cameras") {
        showCameraView();
    } else {
        updateCameraDisplay();
    }

    cameraList.classList.remove("collapsed");
    camerasTab.setAttribute("aria-expanded", "true");
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

    const needsNewStream =
        !stream ||
        forceStreamUpdate ||
        String(streamCameraId) !== String(camera.id);

    if (needsNewStream) {
        removeCameraStream();

        stream = document.createElement("img");
        stream.className = "camera-stream";
        stream.id = "cameraStream";
        stream.dataset.cameraId = String(camera.id);
        stream.alt = `${camera.name || `Camera ${camera.id}`} live feed`;
        stream.src =
            `${API_BASE}/cameras/${encodeURIComponent(camera.id)}/stream`;

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
    cameraPlaceholderMessage.textContent = "The backend has not reported any cameras.";

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

fsBtn.addEventListener("click", async () => {
    try {
        await cameraFrame.requestFullscreen();
    } catch (error) {
        console.error("Could not enter fullscreen:", error);
    }

});

exitBtn.addEventListener("click", async () => {
    try {
        await document.exitFullscreen();
    } catch (error) {
        console.error("Could not exit fullscreen:", error);
    }

});

document.addEventListener("fullscreenchange", () => {

    const isFullscreen =
        document.fullscreenElement === cameraFrame;

    if (isFullscreen) {

        fsBtn.style.display = "none";
        exitBtn.style.display = "flex";

        exitBtn.setAttribute(
            "aria-label",
            "Exit fullscreen"
        );

        exitBtn.setAttribute(
            "title",
            "Exit fullscreen"
        );

    } else {

        fsBtn.style.display = "flex";
        exitBtn.style.display = "none";

        fsBtn.setAttribute(
            "aria-label",
            "Enter fullscreen"
        );

        fsBtn.setAttribute(
            "title",
            "Fullscreen"
        );

    }

});

function checkDetectionAlerts() {
    state.cameras.forEach(camera => {
        const cameraId = String(camera.id);

        if (camera.detected) {
            if (!state.alertedCameras.has(cameraId)) {
                state.alertedCameras.add(cameraId);

                if (
                    state.currentView === "cameras" &&
                    String(state.selectedCameraId) === cameraId
                ) {
                    return;
                }

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
    message.textContent =
        `A red object has been detected on ${cameraName}.`;

    const actions = document.createElement("div");
    actions.className = "detection-alert-actions";

    const ignoreButton = document.createElement("button");
    ignoreButton.type = "button";
    ignoreButton.className = "detection-alert-button ignore";
    ignoreButton.textContent = "Ignore";

    const switchButton = document.createElement("button");
    switchButton.type = "button";
    switchButton.className = "detection-alert-button switch";
    switchButton.textContent = `Switch to ${cameraName}`;

    switchButton.style.background =
        "linear-gradient(to right, var(--switch-button-color, #16a34a) 0%, var(--switch-button-color, #16a34a) 100%)";

    let completed = false;
    const countdownDuration = 5000;
    const startTime = performance.now();

    const switchToCamera = () => {
        if (completed) {
            return;
        }

        completed = true;

        if (countdownAnimation) {
            cancelAnimationFrame(countdownAnimation);
        }

        state.selectedCameraId = camera.id;

        renderCameras();

        if (state.currentView !== "cameras") {
            showCameraView();
        } else {
            updateCameraDisplay(true);
        }

        cameraList.classList.remove("collapsed");
        camerasTab.setAttribute("aria-expanded", "true");

        closeDetectionAlert();
    };

    switchButton.addEventListener("click", switchToCamera);

    ignoreButton.addEventListener("click", () => {
        completed = true;

        if (countdownAnimation) {
            cancelAnimationFrame(countdownAnimation);
        }

        closeDetectionAlert();
    });

    actions.append(ignoreButton, switchButton);
    modal.append(icon, title, message, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    trapModalFocus(
        overlay,
        [ignoreButton, switchButton],
        switchButton
    );

    let countdownAnimation;

    const updateCountdown = currentTime => {
        if (completed || !document.body.contains(overlay)) {
            return;
        }

        const elapsed = currentTime - startTime;
        const progress = Math.min(
            elapsed / countdownDuration,
            1
        );

        const grayProgress = progress * 100;

        switchButton.style.background =
            `linear-gradient(
                to right,
                #9ca3af 0%,
                #9ca3af ${grayProgress}%,
                var(--switch-button-color, #16a34a) ${grayProgress}%,
                var(--switch-button-color, #16a34a) 100%
            )`;

        if (progress >= 1) {
            switchToCamera();
            return;
        }

        countdownAnimation = requestAnimationFrame(updateCountdown);
    };

    countdownAnimation = requestAnimationFrame(updateCountdown);
}

function closeDetectionAlert() {
    const overlay = document.getElementById("detectionAlertOverlay");

    if (overlay) {
        overlay.remove();
    }
}

function showCameraView() {
    state.currentView = "cameras";

    camerasTab.classList.add("active");
    contactsTab.classList.remove("active");

    cameraView.classList.remove("hidden");
    contactsView.classList.add("hidden");

    pageEyebrow.textContent = "LIVE MONITORING";
    pageTitle.textContent = "Camera Monitoring";

    updateCameraDisplay();
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

function openContactModal(contact) {
    closeContactModal();

    if (!contact) {
        return;
    }

    state.editingContactId = contact.id;

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
    title.textContent = "Edit Contact";

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
            contact.name || "",
            "Enter contact name"
        ),
        createFormGroup(
            "Phone Number",
            "contactPhone",
            "tel",
            contact.phone_number || "",
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
    submitButton.textContent = "Save Changes";

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

    const name = nameInput?.value.trim() || "";
    const phoneNumber = phoneInput?.value.trim() || "";

    if (!name || !phoneNumber) {
        showMessageAlert(
            "Missing Information",
            "Please enter both the contact name and phone number."
        );
        return;
    }

    const contactId = state.editingContactId;

    if (contactId === null || contactId === undefined) {
        showMessageAlert(
            "Invalid Action",
            "New contacts can only be registered through the Security Alert app."
        );
        return;
    }

    const submitButton = event.target
        .closest(".contact-modal")
        ?.querySelector(".modal-button.submit");

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Saving...";
    }

    const payload = {
        name,
        phone_number: phoneNumber
    };

    try {
        const url =
            `${API_BASE}/contacts/${encodeURIComponent(contactId)}`;

        const response = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(
                result?.error ||
                `Contact API returned ${response.status}`
            );
        }

        closeContactModal();

        await loadContacts();

        showMessageAlert(
            "Contact Updated",
            "The contact information has been updated successfully."
        );
    } catch (error) {
        console.error("Failed to update contact:", error);

        showMessageAlert(
            "Update Failed",
            error.message || "Failed to update the contact."
        );

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Save Changes";
        }
    }
}

async function deleteContact(contactId) {
    const contact = state.contacts.find(
        item => String(item.id) === String(contactId)
    );

    if (!contact) {
        return;
    }

    const confirmed = await showDeleteConfirmation(
        contact.name || "this contact"
    );

    if (!confirmed) {
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

        showMessageAlert(
            "Delete Failed",
            error.message || "Failed to delete contact."
        );
    }
}

function showDeleteConfirmation(contactName) {
    return new Promise(resolve => {
        closeContactModal();
        closeMessageAlert();
        closeDeleteConfirmation();

        const overlay = document.createElement("div");
        overlay.className = "delete-confirmation-overlay";
        overlay.id = "deleteConfirmationOverlay";

        const modal = document.createElement("div");
        modal.className = "delete-confirmation-modal";
        modal.setAttribute("role", "alertdialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute(
            "aria-labelledby",
            "deleteConfirmationTitle"
        );

        const icon = document.createElement("div");
        icon.className = "delete-confirmation-icon";
        icon.textContent = "×";

        const title = document.createElement("h3");
        title.id = "deleteConfirmationTitle";
        title.textContent = "Delete Contact";

        const message = document.createElement("p");
        message.textContent =
            `Are you sure you want to delete ${contactName}?`;

        const actions = document.createElement("div");
        actions.className = "delete-confirmation-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "confirmation-button cancel";
        cancelButton.textContent = "Cancel";

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "confirmation-button delete";
        deleteButton.textContent = "Delete";

        const finish = result => {
            closeDeleteConfirmation();
            resolve(result);
        };

        cancelButton.addEventListener(
            "click",
            () => finish(false)
        );

        deleteButton.addEventListener(
            "click",
            () => finish(true)
        );

        actions.append(cancelButton, deleteButton);
        modal.append(icon, title, message, actions);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        trapModalFocus(
            overlay,
            [cancelButton, deleteButton],
            cancelButton
        );
    });
}

function closeDeleteConfirmation() {
    document
        .getElementById("deleteConfirmationOverlay")
        ?.remove();
}

function showMessageAlert(titleText, messageText) {
    closeMessageAlert();

    const overlay = document.createElement("div");
    overlay.className = "message-alert-overlay";
    overlay.id = "messageAlertOverlay";

    const modal = document.createElement("div");
    modal.className = "message-alert-modal";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "messageAlertTitle");

    const title = document.createElement("h3");
    title.id = "messageAlertTitle";
    title.textContent = titleText;

    const message = document.createElement("p");
    message.textContent = messageText;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-alert-button";
    button.textContent = "OK";
    button.addEventListener("click", closeMessageAlert);

    modal.append(title, message, button);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    trapModalFocus(
        overlay,
        [button],
        button
    );
}

function closeMessageAlert() {
    document.getElementById("messageAlertOverlay")?.remove();
}

function trapModalFocus(overlay, focusableElements, initialElement) {
    const handleKeydown = event => {
        if (!document.body.contains(overlay)) {
            document.removeEventListener("keydown", handleKeydown);
            return;
        }

        if (event.key !== "Tab") {
            return;
        }

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
            return;
        }

        if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    overlay._focusTrapHandler = handleKeydown;
    document.addEventListener("keydown", handleKeydown);
    initialElement.focus();
}

function closeContactModal() {
    const overlay = document.getElementById("contactModalOverlay");

    if (overlay) {
        overlay.remove();
    }

    state.editingContactId = null;
    document.removeEventListener("keydown", handleModalEscape);
}

function handleModalEscape(event) {
    if (event.key === "Escape") {
        closeContactModal();
    }
}

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

        setSystemStatus(
            true,
            operational ? "Operational" : "Connected"
        );
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
