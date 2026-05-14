const elements = {
  receiptInput: document.querySelector("#receiptInput"),
  dropzone: document.querySelector("#dropzone"),
  dropzoneTitle: document.querySelector("#dropzoneTitle"),
  receiptPreview: document.querySelector("#receiptPreview"),
  previewFrame: document.querySelector("#previewFrame"),
  fileMeta: document.querySelector("#fileMeta"),
  extractButton: document.querySelector("#extractButton"),
  clearButton: document.querySelector("#clearButton"),
  clearSubmissionsButton: document.querySelector("#clearSubmissionsButton"),
  statusText: document.querySelector("#statusText"),
  modelPill: document.querySelector("#modelPill"),
  receiptForm: document.querySelector("#receiptForm"),
  saveState: document.querySelector("#saveState"),
  merchantName: document.querySelector("#merchantName"),
  date: document.querySelector("#date"),
  totalAmount: document.querySelector("#totalAmount"),
  currency: document.querySelector("#currency"),
  notes: document.querySelector("#notes"),
  merchantConfidence: document.querySelector("#merchantConfidence"),
  dateConfidence: document.querySelector("#dateConfidence"),
  totalConfidence: document.querySelector("#totalConfidence"),
  currencyConfidence: document.querySelector("#currencyConfidence"),
  submissionsBody: document.querySelector("#submissionsBody")
};

const STORAGE_KEY = "receipt-form-autofill-submissions";
const state = {
  imageDataUrl: "",
  file: null,
  submissions: loadSubmissions()
};

renderSubmissions();

elements.receiptInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    handleFile(file);
  }
});

elements.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("is-dragover");
});

elements.dropzone.addEventListener("dragleave", () => {
  elements.dropzone.classList.remove("is-dragover");
});

elements.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("is-dragover");
  const [file] = event.dataTransfer.files;
  if (file) {
    handleFile(file);
  }
});

elements.extractButton.addEventListener("click", extractFields);
elements.clearButton.addEventListener("click", clearReceipt);
elements.clearSubmissionsButton.addEventListener("click", clearSubmissions);

elements.receiptForm.addEventListener("input", () => {
  elements.saveState.textContent = "Unsaved";
});

elements.receiptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submission = {
    id: crypto.randomUUID(),
    merchantName: elements.merchantName.value.trim(),
    date: elements.date.value,
    totalAmount: elements.totalAmount.value.trim(),
    currency: elements.currency.value.trim().toUpperCase(),
    notes: elements.notes.value.trim(),
    submittedAt: new Date().toISOString()
  };

  state.submissions.unshift(submission);
  persistSubmissions();
  renderSubmissions();
  elements.saveState.textContent = "Saved";
  setStatus("Reviewed data saved in this browser.");
});

async function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("Select a PNG, JPG, or WEBP image.");
    return;
  }

  try {
    setStatus("Preparing image...");
    const imageDataUrl = await resizeImage(file);
    state.imageDataUrl = imageDataUrl;
    state.file = file;

    elements.receiptPreview.src = imageDataUrl;
    elements.previewFrame.classList.remove("is-empty");
    elements.fileMeta.textContent = `${file.name} - ${formatBytes(file.size)}`;
    elements.dropzoneTitle.textContent = file.name;
    elements.extractButton.disabled = false;
    elements.saveState.textContent = "Unsaved";
    setStatus("Ready to extract.");
  } catch (error) {
    setStatus(error.message || "Could not load the image.");
  }
}

async function extractFields() {
  if (!state.imageDataUrl) {
    setStatus("Select a receipt image first.");
    return;
  }

  elements.extractButton.disabled = true;
  setStatus("Extracting receipt fields...");

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: state.imageDataUrl })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Extraction failed.");
    }

    fillForm(payload.fields);
    elements.modelPill.textContent = payload.apiMode
      ? `Model: ${payload.model} (${payload.apiMode})`
      : `Model: ${payload.model}`;
    elements.saveState.textContent = "Unsaved";
    setStatus("Extraction complete. Review before submitting.");
  } catch (error) {
    setStatus(error.message || "Extraction failed.");
  } finally {
    elements.extractButton.disabled = false;
  }
}

function fillForm(fields) {
  elements.merchantName.value = fields.merchantName || "";
  elements.date.value = normalizeDate(fields.date);
  elements.totalAmount.value = fields.totalAmount || "";
  elements.currency.value = (fields.currency || "").toUpperCase();
  elements.notes.value = fields.notes || "";

  const confidence = fields.confidence || {};
  elements.merchantConfidence.textContent = formatConfidence(confidence.merchantName);
  elements.dateConfidence.textContent = formatConfidence(confidence.date);
  elements.totalConfidence.textContent = formatConfidence(confidence.totalAmount);
  elements.currencyConfidence.textContent = formatConfidence(confidence.currency);
}

function clearReceipt() {
  state.imageDataUrl = "";
  state.file = null;
  elements.receiptInput.value = "";
  elements.receiptPreview.removeAttribute("src");
  elements.previewFrame.classList.add("is-empty");
  elements.fileMeta.textContent = "No receipt selected";
  elements.dropzoneTitle.textContent = "Choose a receipt image";
  elements.extractButton.disabled = true;
  elements.receiptForm.reset();
  resetConfidence();
  elements.modelPill.textContent = "AI vision extraction";
  elements.saveState.textContent = "Unsaved";
  setStatus("Ready");
}

function clearSubmissions() {
  state.submissions = [];
  persistSubmissions();
  renderSubmissions();
  setStatus("Submission list cleared.");
}

function resetConfidence() {
  elements.merchantConfidence.textContent = "--";
  elements.dateConfidence.textContent = "--";
  elements.totalConfidence.textContent = "--";
  elements.currencyConfidence.textContent = "--";
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image file."));
      img.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        canvas.width = width;
        canvas.height = height;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function normalizeDate(value) {
  if (!value) {
    return "";
  }

  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

function formatConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "--";
  }

  return `${Math.round(Math.max(0, Math.min(1, numeric)) * 100)}%`;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadSubmissions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persistSubmissions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.submissions));
}

function renderSubmissions() {
  if (!state.submissions.length) {
    elements.submissionsBody.innerHTML = '<tr><td colspan="5">No submissions yet</td></tr>';
    return;
  }

  elements.submissionsBody.innerHTML = state.submissions
    .map((submission) => {
      const total = submission.totalAmount ? escapeHtml(submission.totalAmount) : "--";
      const currency = submission.currency ? escapeHtml(submission.currency) : "--";
      const submittedAt = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(submission.submittedAt));

      return `<tr>
        <td>${escapeHtml(submission.merchantName || "--")}</td>
        <td>${escapeHtml(submission.date || "--")}</td>
        <td>${total}</td>
        <td>${currency}</td>
        <td>${escapeHtml(submittedAt)}</td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return replacements[char];
  });
}
