const pdfPath = "fumetto.pdf";
let pdfDoc = null;
let currentPage = 1;
let currentScale = 1;
let fitToWidth = true;
let isRendering = false;
let pendingPage = null;
let currentMode = "scroll";

const scrollFrame = document.getElementById("pdf-scroll");
const viewButtons = document.querySelectorAll("[data-view]");
const readers = document.querySelectorAll(".reader");

const canvas = document.getElementById("pdf-canvas");
const canvasWrap = document.querySelector(".pager__canvas-wrap");
const loadingOverlay = document.getElementById("pager-loading");

const prevButton = document.getElementById("prev-page");
const nextButton = document.getElementById("next-page");
const zoomOutButton = document.getElementById("zoom-out");
const zoomInButton = document.getElementById("zoom-in");
const zoomFitButton = document.getElementById("zoom-fit");

const pageInput = document.getElementById("page-input");
const totalPagesLabel = document.getElementById("total-pages");
const zoomLevelLabel = document.getElementById("zoom-level");

function setLoading(isLoading) {
  loadingOverlay.classList.toggle("is-visible", isLoading);
}

function updateControls() {
  if (!pdfDoc) {
    totalPagesLabel.textContent = "—";
    pageInput.disabled = true;
    prevButton.disabled = true;
    nextButton.disabled = true;
    zoomOutButton.disabled = true;
    zoomInButton.disabled = true;
    zoomFitButton.disabled = true;
    return;
  }

  totalPagesLabel.textContent = pdfDoc.numPages;
  pageInput.value = currentPage;
  pageInput.max = pdfDoc.numPages;
  pageInput.disabled = false;
  prevButton.disabled = currentPage <= 1;
  nextButton.disabled = currentPage >= pdfDoc.numPages;
  zoomOutButton.disabled = false;
  zoomInButton.disabled = false;
  zoomFitButton.disabled = false;
  zoomLevelLabel.textContent = `${Math.round(currentScale * 100)}%`;
}

function getAvailableWidth() {
  const width = canvasWrap.clientWidth;
  if (width > 0) {
    return width - 32;
  }
  return Math.min(window.innerWidth - 48, 960);
}

function renderPage(pageNumber) {
  if (!pdfDoc) {
    return;
  }

  isRendering = true;
  loadingOverlay.textContent = "Caricamento pagina…";
  setLoading(true);

  pdfDoc.getPage(pageNumber).then((page) => {
    const baseViewport = page.getViewport({ scale: 1 });
    let scale = currentScale;

    if (fitToWidth) {
      const availableWidth = getAvailableWidth();
      scale = availableWidth / baseViewport.width;
      currentScale = scale;
    }

    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const context = canvas.getContext("2d");

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

    return page.render({ canvasContext: context, viewport }).promise;
  }).then(() => {
    isRendering = false;
    setLoading(false);
    updateControls();

    if (pendingPage !== null) {
      const nextPage = pendingPage;
      pendingPage = null;
      renderPage(nextPage);
    }
  }).catch(() => {
    setLoading(true);
    loadingOverlay.textContent = "Impossibile caricare la pagina.";
  });
}

function queueRenderPage(pageNumber) {
  if (isRendering) {
    pendingPage = pageNumber;
  } else {
    renderPage(pageNumber);
  }
}

function changePage(offset) {
  if (!pdfDoc) {
    return;
  }
  const nextPage = Math.min(Math.max(currentPage + offset, 1), pdfDoc.numPages);
  if (nextPage === currentPage) {
    return;
  }
  currentPage = nextPage;
  queueRenderPage(currentPage);
}

function applyZoom(delta) {
  fitToWidth = false;
  currentScale = Math.min(Math.max(currentScale + delta, 0.6), 3);
  queueRenderPage(currentPage);
}

function fitPageToWidth() {
  fitToWidth = true;
  queueRenderPage(currentPage);
}

function setMode(mode) {
  currentMode = mode;
  readers.forEach((reader) => {
    const match = reader.dataset.mode === mode;
    reader.classList.toggle("is-hidden", !match);
  });

  viewButtons.forEach((button) => {
    const isActive = button.dataset.view === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  if (mode === "pager") {
    requestAnimationFrame(() => queueRenderPage(currentPage));
  }
}

function initPdf() {
  if (!window.pdfjsLib) {
    loadingOverlay.textContent = "Viewer PDF non disponibile.";
    setLoading(true);
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  pdfjsLib.getDocument(pdfPath).promise.then((doc) => {
    pdfDoc = doc;
    updateControls();
    queueRenderPage(currentPage);
  }).catch(() => {
    loadingOverlay.textContent = "Errore nel caricamento del PDF.";
    setLoading(true);
  });
}

function init() {
  scrollFrame.src = `${pdfPath}#view=FitH`;
  updateControls();
  const initialMode = document.querySelector("[data-view].is-active")?.dataset.view || "scroll";
  setMode(initialMode);
  initPdf();

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.view));
  });
  prevButton.addEventListener("click", () => changePage(-1));
  nextButton.addEventListener("click", () => changePage(1));
  zoomOutButton.addEventListener("click", () => applyZoom(-0.1));
  zoomInButton.addEventListener("click", () => applyZoom(0.1));
  zoomFitButton.addEventListener("click", fitPageToWidth);

  pageInput.addEventListener("change", (event) => {
    if (!pdfDoc) {
      return;
    }
    const value = Number(event.target.value);
    if (Number.isNaN(value)) {
      event.target.value = currentPage;
      return;
    }
    currentPage = Math.min(Math.max(value, 1), pdfDoc.numPages);
    queueRenderPage(currentPage);
  });

  window.addEventListener("resize", () => {
    if (fitToWidth && currentMode === "pager") {
      queueRenderPage(currentPage);
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
