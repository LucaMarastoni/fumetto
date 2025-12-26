const pdfPath = "fumetto.pdf";
let pdfDoc = null;
let currentPage = 1;
let currentScale = 1;
let fitToWidth = true;
let isRendering = false;
let pendingPage = null;
let currentMode = "scroll";
let scrollInitialized = false;
let scrollObserver = null;
let scrollQueue = [];
let scrollQueueSet = new Set();
let isScrollRendering = false;
let hasScrollFirstPaint = false;
let scrollRenderedSet = new Set();
let scrollRenderedCount = 0;

const scrollPages = document.getElementById("scroll-pages");
const scrollLoading = document.getElementById("scroll-loading");
const scrollProgressText = document.getElementById("scroll-progress-text");
const scrollProgressFill = document.getElementById("scroll-progress-fill");
const scrollProgress = document.getElementById("scroll-progress");
const scrollToTopButton = document.getElementById("scroll-to-top");
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

function setLoading(isLoading, message) {
  loadingOverlay.classList.toggle("is-visible", isLoading);
  if (message) {
    const label = loadingOverlay.querySelector("span");
    if (label) {
      label.textContent = message;
    }
  }
}

function setScrollLoading(isLoading, message = "Caricamento PDF…") {
  if (!scrollLoading || !scrollPages) {
    return;
  }
  scrollLoading.classList.toggle("is-visible", isLoading);
  const label = scrollLoading.querySelector("span");
  if (label) {
    label.textContent = message;
  }
  scrollPages.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function updateScrollProgress() {
  if (!scrollProgressText || !scrollProgressFill) {
    return;
  }
  const total = pdfDoc ? pdfDoc.numPages : 0;
  scrollProgressText.textContent = `${scrollRenderedCount}/${total}`;
  const percent = total > 0 ? Math.min((scrollRenderedCount / total) * 100, 100) : 0;
  scrollProgressFill.style.width = `${percent}%`;
  if (scrollProgress) {
    scrollProgress.classList.toggle("is-complete", total > 0 && scrollRenderedCount >= total);
  }
}

function updateToTopVisibility() {
  if (!scrollToTopButton) {
    return;
  }
  const shouldShow = currentMode === "scroll" && window.scrollY > 600;
  scrollToTopButton.classList.toggle("is-visible", shouldShow);
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

function getScrollAvailableWidth() {
  if (!scrollPages) {
    return Math.min(window.innerWidth - 48, 960);
  }
  const width = scrollPages.clientWidth;
  if (width > 0) {
    return width - 32;
  }
  return Math.min(window.innerWidth - 48, 960);
}

function renderScrollPage(pageNumber) {
  if (!pdfDoc || !scrollPages) {
    return Promise.resolve();
  }

  const wrapper = scrollPages.querySelector(`[data-page="${pageNumber}"]`);
  if (!wrapper || wrapper.dataset.rendered === "true") {
    return Promise.resolve();
  }

  wrapper.classList.add("is-loading");

  return pdfDoc.getPage(pageNumber).then((page) => {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = getScrollAvailableWidth() / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = wrapper.querySelector("canvas");
    if (!canvas) {
      return Promise.resolve();
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return Promise.resolve();
    }
    const outputScale = 1;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

    return page.render({ canvasContext: context, viewport }).promise;
  }).then(() => {
    wrapper.dataset.rendered = "true";
    wrapper.classList.remove("is-loading");

    if (!scrollRenderedSet.has(pageNumber)) {
      scrollRenderedSet.add(pageNumber);
      scrollRenderedCount += 1;
      updateScrollProgress();
    }

    if (!hasScrollFirstPaint) {
      hasScrollFirstPaint = true;
      setScrollLoading(false);
    }
  }).catch(() => {
    wrapper.classList.remove("is-loading");
    if (!hasScrollFirstPaint) {
      setScrollLoading(true, "Errore nel caricamento.");
    }
  });
}

function processScrollQueue() {
  if (isScrollRendering || scrollQueue.length === 0) {
    return;
  }

  const pageNumber = scrollQueue.shift();
  scrollQueueSet.delete(pageNumber);
  isScrollRendering = true;

  renderScrollPage(pageNumber).finally(() => {
    isScrollRendering = false;
    processScrollQueue();
  });
}

function enqueueScrollRender(pageNumber) {
  if (scrollQueueSet.has(pageNumber)) {
    return;
  }
  const wrapper = scrollPages?.querySelector(`[data-page="${pageNumber}"]`);
  if (!wrapper || wrapper.dataset.rendered === "true") {
    return;
  }
  scrollQueue.push(pageNumber);
  scrollQueueSet.add(pageNumber);
  processScrollQueue();
}

function setupScrollObserver() {
  if (!scrollPages) {
    return;
  }

  if (scrollObserver) {
    scrollObserver.disconnect();
  }

  scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      const pageNumber = Number(entry.target.dataset.page);
      if (Number.isNaN(pageNumber)) {
        return;
      }
      enqueueScrollRender(pageNumber);
    });
  }, { rootMargin: "600px 0px" });

  scrollPages.querySelectorAll(".scroll-page").forEach((page) => {
    scrollObserver.observe(page);
  });
}

function initScrollPages() {
  if (!pdfDoc || !scrollPages) {
    return;
  }

  scrollPages.innerHTML = "";
  scrollQueue = [];
  scrollQueueSet.clear();
  isScrollRendering = false;
  hasScrollFirstPaint = false;
  scrollRenderedSet = new Set();
  scrollRenderedCount = 0;
  updateScrollProgress();

  const fragment = document.createDocumentFragment();

  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
    const wrapper = document.createElement("div");
    wrapper.className = "scroll-page is-loading";
    wrapper.dataset.page = String(i);

    const canvas = document.createElement("canvas");
    canvas.className = "scroll-canvas";

    const label = document.createElement("span");
    label.className = "scroll-page__label";
    label.textContent = `Pagina ${i}`;

    wrapper.appendChild(canvas);
    wrapper.appendChild(label);
    fragment.appendChild(wrapper);
  }

  scrollPages.appendChild(fragment);
  setScrollLoading(true, "Caricamento pagine…");
  setupScrollObserver();
  enqueueScrollRender(1);
  scrollInitialized = true;
}

function ensureScrollInitialized() {
  if (scrollInitialized || !pdfDoc) {
    return;
  }
  initScrollPages();
}

function refreshVisibleScrollPages() {
  if (!scrollPages || !scrollInitialized) {
    return;
  }

  const range = window.innerHeight * 1.4;

  scrollPages.querySelectorAll(".scroll-page").forEach((page) => {
    const rect = page.getBoundingClientRect();
    if (rect.top < range && rect.bottom > -range) {
      delete page.dataset.rendered;
      page.classList.add("is-loading");
      const canvas = page.querySelector("canvas");
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas.style.width = "";
        canvas.style.height = "";
      }
      enqueueScrollRender(Number(page.dataset.page));
    }
  });
}

function renderPage(pageNumber) {
  if (!pdfDoc) {
    return;
  }

  isRendering = true;
  setLoading(true, "Caricamento pagina…");

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
    if (!context) {
      throw new Error("Canvas non disponibile");
    }

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
    setLoading(true, "Impossibile caricare la pagina.");
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

  if (mode === "scroll") {
    if (pdfDoc) {
      ensureScrollInitialized();
    } else {
      setScrollLoading(true, "Caricamento PDF…");
    }
  }

  updateToTopVisibility();
}

function initPdf() {
  if (!window.pdfjsLib) {
    setLoading(true, "Viewer PDF non disponibile.");
    setScrollLoading(true, "Viewer PDF non disponibile.");
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  setLoading(true, "Caricamento PDF…");
  setScrollLoading(true, "Caricamento PDF…");

  pdfjsLib.getDocument(pdfPath).promise.then((doc) => {
    pdfDoc = doc;
    updateControls();
    updateScrollProgress();

    if (currentMode === "scroll") {
      ensureScrollInitialized();
    }

    if (currentMode === "pager") {
      queueRenderPage(currentPage);
    }
  }).catch(() => {
    setLoading(true, "Errore nel caricamento del PDF.");
    setScrollLoading(true, "Errore nel caricamento del PDF.");
  });
}

function init() {
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

  if (scrollToTopButton) {
    scrollToTopButton.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (!scrollTicking) {
      scrollTicking = true;
      window.requestAnimationFrame(() => {
        updateToTopVisibility();
        scrollTicking = false;
      });
    }
  }, { passive: true });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (fitToWidth && currentMode === "pager") {
      queueRenderPage(currentPage);
    }
    if (currentMode === "scroll") {
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(refreshVisibleScrollPages, 150);
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
