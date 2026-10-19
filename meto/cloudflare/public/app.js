const presets = {
  "55x25": { name: "55 x 25 mm", width: 55, height: 25 },
  "70x30": { name: "70 x 30 mm", width: 70, height: 30 },
  "100x100": { name: "100 x 100 mm", width: 100, height: 100 },
};

const state = {
  presetKey: "55x25",
  scale: 14,
  marginMm: 0,
  mainAlignH: "left",
  mainAlignV: "top",
  defaultPrinter: localStorage.getItem("meto.webview2.defaultPrinter") || "",
  lastAcceptedMainText: "",
  isRevertingMainText: false,
};

const $ = (id) => document.getElementById(id);
const MAIN_LINE_HEIGHT = 0.82;
const clipboardState = {
  text: "",
};
const editHistory = {
  undo: [],
  redo: [],
  restoring: false,
  started: false,
  timer: null,
  limit: 40,
};

fabric.Object.prototype.transparentCorners = false;
fabric.Object.prototype.cornerColor = "#145f3b";
fabric.Object.prototype.cornerStrokeColor = "#ffffff";
fabric.Object.prototype.borderColor = "#145f3b";
fabric.Object.prototype.cornerStyle = "rect";
fabric.Object.prototype.cornerSize = 11;

const canvas = new fabric.Canvas("labelCanvas", {
  backgroundColor: "#ffffff",
  preserveObjectStacking: true,
  selectionColor: "rgba(20,95,59,.10)",
  selectionBorderColor: "#145f3b",
  selectionLineWidth: 1,
});

let mainTextObject = null;
const measureCanvas = document.createElement("canvas");
const measureContext = measureCanvas.getContext("2d");

function px(mm) { return mm * state.scale; }
function mm(pixels) { return pixels / state.scale; }
function dotsToPx(dots) { return (dots / (203 / 25.4)) * state.scale; }
function pxToDots(pixels) { return Math.max(1, Math.round((pixels / state.scale) * (203 / 25.4))); }

function currentPreset() {
  return presets[state.presetKey];
}

function setStatus(text) {
  $("statusText").textContent = text || "";
  if ($("qzStatus")) $("qzStatus").textContent = text || "";
}

function post(payload) {
  if (window.metoBridge) window.metoBridge.handle(payload);
}

function editorSnapshot() {
  return JSON.stringify({
    presetKey: state.presetKey,
    marginMm: state.marginMm,
    mainAlignH: state.mainAlignH,
    mainAlignV: state.mainAlignV,
    fontDots: Number($("fontNumber").value || 28),
    canvas: canvas.toDatalessJSON(["id"]),
  });
}

function commitHistorySnapshot() {
  if (!editHistory.started || editHistory.restoring) return;
  if (editHistory.timer) {
    window.clearTimeout(editHistory.timer);
    editHistory.timer = null;
  }
  const snapshot = editorSnapshot();
  if (editHistory.undo[editHistory.undo.length - 1] === snapshot) return;
  editHistory.undo.push(snapshot);
  if (editHistory.undo.length > editHistory.limit) editHistory.undo.shift();
  editHistory.redo.length = 0;
}

function queueHistorySnapshot(delay = 140) {
  if (!editHistory.started || editHistory.restoring) return;
  if (editHistory.timer) window.clearTimeout(editHistory.timer);
  editHistory.timer = window.setTimeout(commitHistorySnapshot, delay);
}

function updateAlignmentButtons() {
  document.querySelectorAll("#hAlign button").forEach((button) => {
    button.classList.toggle("active", button.dataset.align === state.mainAlignH);
  });
  document.querySelectorAll("#vAlign button").forEach((button) => {
    button.classList.toggle("active", button.dataset.align === state.mainAlignV);
  });
}

function restoreEditorSnapshot(snapshot, statusText) {
  const saved = JSON.parse(snapshot);
  editHistory.restoring = true;
  state.presetKey = saved.presetKey || "55x25";
  state.marginMm = Number(saved.marginMm || 0);
  state.mainAlignH = saved.mainAlignH || "left";
  state.mainAlignV = saved.mainAlignV || "top";
  $("presetSelect").value = state.presetKey;
  $("marginMm").value = state.marginMm;
  $("fontNumber").value = saved.fontDots || 28;
  $("fontRange").value = Math.min(saved.fontDots || 28, Number($("fontRange").max));
  updateAlignmentButtons();

  mainTextObject = null;
  resizeCanvasForPreset();
  canvas.loadFromJSON(saved.canvas, () => {
    mainTextObject = canvas.getObjects().find((object) => object.id === "main-text") || null;
    if (mainTextObject) {
      mainTextObject.set({
        editable: true,
        selectable: true,
        evented: true,
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true,
        objectCaching: false,
      });
      mainTextObject.setControlsVisibility({ mtr: false });
      bindMainTextEvents(mainTextObject);
      mainTextObject.sendToBack();
      state.lastAcceptedMainText = String(mainTextObject.text || "");
    }
    syncHiddenMainText();
    updateMainBoxGeometry();
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    updatePropertiesPanel();
    editHistory.restoring = false;
    setStatus(statusText);
  });
}

function undoEditorChange(event) {
  const key = String(event.key || "").toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier || key !== "z" || event.shiftKey) return false;
  event.preventDefault();
  commitHistorySnapshot();
  if (editHistory.undo.length < 2) {
    setStatus("Nessuna modifica da annullare");
    return true;
  }
  const current = editHistory.undo.pop();
  editHistory.redo.push(current);
  restoreEditorSnapshot(editHistory.undo[editHistory.undo.length - 1], "Modifica annullata");
  return true;
}

function redoEditorChange(event) {
  const key = String(event.key || "").toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  const requested = modifier && (key === "y" || (key === "z" && event.shiftKey));
  if (!requested) return false;
  event.preventDefault();
  if (!editHistory.redo.length || editHistory.restoring) {
    setStatus("Nessuna modifica da ripristinare");
    return true;
  }
  const snapshot = editHistory.redo.pop();
  editHistory.undo.push(snapshot);
  restoreEditorSnapshot(snapshot, "Modifica ripristinata");
  return true;
}

function handleUndoRedoShortcut(event) {
  if (undoEditorChange(event)) return;
  redoEditorChange(event);
}

function resizeCanvasForPreset() {
  const preset = currentPreset();
  const wrap = document.querySelector(".canvas-wrap");
  const maxW = Math.max(420, wrap.clientWidth - 60);
  const maxH = Math.max(260, wrap.clientHeight - 60);
  state.scale = Math.min(maxW / preset.width, maxH / preset.height);
  state.scale = Math.max(5, Math.min(18, state.scale));

  canvas.setWidth(px(preset.width));
  canvas.setHeight(px(preset.height));
  if (mainTextObject) {
    mainTextObject.set({ fontSize: dotsToPx(Number($("fontNumber").value || 28)) });
  }
  $("canvasMeta").textContent = `${preset.name} | 203 dpi | QZ Tray`;
  updateMainBoxGeometry();
  canvas.requestRenderAll();
}

function bindMainTextEvents(object) {
  object.off("changed");
  object.off("editing:entered");
  object.off("editing:exited");
  object.on("changed", acceptMainCanvasTextIfFits);
  object.on("editing:entered", () => {
    canvas.setActiveObject(object);
    setStatus("Scrivi direttamente nell'etichetta");
  });
  object.on("editing:exited", () => {
    syncHiddenMainText();
    updateMainBoxGeometry();
    queueHistorySnapshot();
  });
}

function createMainText() {
  mainTextObject = new fabric.Textbox("", {
    left: 0,
    top: 0,
    width: px(currentPreset().width),
    fontFamily: "Arial",
    fontWeight: "bold",
    fontSize: dotsToPx(28),
    lineHeight: MAIN_LINE_HEIGHT,
    fill: "#000000",
    editable: true,
    selectable: true,
    evented: true,
    hasControls: false,
    lockMovementX: true,
    lockMovementY: true,
    hoverCursor: "text",
    moveCursor: "text",
    cursorColor: "#145f3b",
    selectionColor: "rgba(20,95,59,.18)",
    objectCaching: false,
    id: "main-text",
  });
  mainTextObject.setControlsVisibility({ mtr: false });
  bindMainTextEvents(mainTextObject);
  canvas.add(mainTextObject);
  mainTextObject.sendToBack();
  syncHiddenMainText();
}

function updateMainBoxGeometry() {
  if (!mainTextObject) return;
  positionMainText();
  updateMainVertical();
  mainTextObject.setCoords();
}

function mainTextBox() {
  const preset = currentPreset();
  const margin = px(state.marginMm);
  return {
    left: margin,
    top: margin,
    width: Math.max(4, px(preset.width) - margin * 2),
    height: Math.max(4, px(preset.height) - margin * 2),
  };
}

function positionMainText() {
  if (!mainTextObject) return;
  const box = mainTextBox();
  if (mainTextObject.type === "textbox") {
    mainTextObject.set({
      left: box.left,
      width: box.width,
      scaleX: 1,
      textAlign: state.mainAlignH,
    });
    mainTextObject.initDimensions && mainTextObject.initDimensions();
    return;
  }
  mainTextObject.initDimensions && mainTextObject.initDimensions();
  const textWidth = mainTextObject.width || 0;
  let left = box.left;
  if (state.mainAlignH === "center") left = box.left + Math.max(0, (box.width - textWidth) / 2);
  if (state.mainAlignH === "right") left = box.left + Math.max(0, box.width - textWidth);
  mainTextObject.set({ left });
}

function updateMainVertical() {
  if (!mainTextObject) return;
  const box = mainTextBox();
  mainTextObject.initDimensions && mainTextObject.initDimensions();
  const textHeight = mainTextObject.height || 0;
  let top = box.top;
  if (state.mainAlignV === "middle") top = box.top + Math.max(0, (box.height - textHeight) / 2);
  if (state.mainAlignV === "bottom") top = box.top + Math.max(0, box.height - textHeight);
  mainTextObject.set({ top });
  positionMainText();
  syncHiddenMainText();
}

function setMainFontDots(dots) {
  const requested = Math.max(8, Math.min(999, Number(dots) || 8));
  const text = getMainTextValue();
  const value = text.trim() ? Math.min(requested, maxDotsForText(text)) : requested;
  $("fontRange").value = Math.min(value, Number($("fontRange").max));
  $("fontNumber").value = value;
  mainTextObject.set({ fontSize: dotsToPx(value) });
  updateMainVertical();
  canvas.requestRenderAll();
  queueHistorySnapshot();
  if (value < requested) setStatus(`Limite fisico etichetta raggiunto: ${value}`);
}

function collectNumbers(value, output = []) {
  if (Number.isFinite(value)) {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNumbers(item, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectNumbers(item, output));
  }
  return output;
}

function measureLineWidth(text, fontPx) {
  measureContext.font = `bold ${fontPx}px Arial`;
  return measureContext.measureText(text).width;
}

function measureTextBlockFallback(text, fontPx, maxWidth) {
  measureContext.font = `bold ${fontPx}px Arial`;
  const metrics = measureContext.measureText("Mg");
  const glyphHeight = (metrics.actualBoundingBoxAscent || fontPx * 0.78) +
    (metrics.actualBoundingBoxDescent || fontPx * 0.22);
  const lineHeight = Math.max(glyphHeight, fontPx * 0.98);
  const paragraphs = String(text).replace(/\r\n/g, "\n").split("\n");
  let widest = 0;
  let rows = 0;

  paragraphs.forEach((paragraph) => {
    if (paragraph.length === 0) {
      rows += 1;
      return;
    }

    const parts = paragraph.split(/(\s+)/).filter((part) => part.length > 0);
    if (parts.length === 1) {
      widest = Math.max(widest, measureLineWidth(paragraph, fontPx));
      rows += 1;
      return;
    }

    let line = "";
    parts.forEach((part) => {
      const candidate = line + part;
      const candidateWidth = measureLineWidth(candidate, fontPx);
      if (candidateWidth <= maxWidth || line.length === 0) {
        line = candidate;
        widest = Math.max(widest, candidateWidth);
      } else {
        rows += 1;
        line = part.trimStart();
        widest = Math.max(widest, measureLineWidth(line, fontPx));
      }
    });
    if (line.length > 0) rows += 1;
  });

  return {
    width: widest,
    height: rows * lineHeight,
  };
}

function measureMainTextAtDots(text, dots, maxWidth) {
  const fontPx = dotsToPx(dots);
  const options = {
    fontFamily: "Arial",
    fontWeight: "bold",
    fontSize: fontPx,
    lineHeight: MAIN_LINE_HEIGHT,
    objectCaching: false,
  };
  if (Number.isFinite(maxWidth)) options.width = maxWidth;
  const measuredText = Number.isFinite(maxWidth)
    ? new fabric.Textbox(String(text), options)
    : new fabric.Text(String(text), options);
  measuredText.initDimensions && measuredText.initDimensions();
  return {
    width: measuredText.width || 0,
    height: measuredText.height || 0,
  };
}

function mainTextFitsDots(text, dots, width, height) {
  const measured = measureMainTextAtDots(text, dots, width);
  return measured.width <= width + 1 && measured.height <= height + 1;
}

function usableMainTextSize() {
  const preset = currentPreset();
  return {
    width: Math.max(4, px(preset.width - state.marginMm * 2)),
    height: Math.max(4, px(preset.height - state.marginMm * 2)),
  };
}

function maxDotsForText(text) {
  const usable = usableMainTextSize();
  let low = 8;
  let high = 999;
  let best = 8;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (mainTextFitsDots(text, mid, usable.width, usable.height)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function balancedTextLayout(words, lineCount) {
  const count = words.length;
  if (lineCount <= 1 || count <= 1) return words.join(" ");
  const costs = Array.from({ length: lineCount + 1 }, () => Array(count + 1).fill(Infinity));
  const previous = Array.from({ length: lineCount + 1 }, () => Array(count + 1).fill(-1));
  costs[0][0] = 0;

  for (let lines = 1; lines <= lineCount; lines += 1) {
    for (let end = lines; end <= count; end += 1) {
      for (let start = lines - 1; start < end; start += 1) {
        if (!Number.isFinite(costs[lines - 1][start])) continue;
        const lineWidth = measureLineWidth(words.slice(start, end).join(" "), 100);
        const cost = Math.max(costs[lines - 1][start], lineWidth);
        if (cost < costs[lines][end]) {
          costs[lines][end] = cost;
          previous[lines][end] = start;
        }
      }
    }
  }

  const lines = [];
  let end = count;
  for (let line = lineCount; line > 0; line -= 1) {
    const start = previous[line][end];
    if (start < 0) return words.join(" ");
    lines.unshift(words.slice(start, end).join(" "));
    end = start;
  }
  return lines.join("\n");
}

function bestMaxTextLayout(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const candidates = new Set([String(text).trim(), words.join(" ")]);
  const maxLines = Math.min(words.length, 8);
  for (let lines = 2; lines <= maxLines; lines += 1) {
    candidates.add(balancedTextLayout(words, lines));
  }

  const usable = usableMainTextSize();
  let best = null;
  candidates.forEach((candidate) => {
    const dots = maxDotsForText(candidate);
    const measured = measureMainTextAtDots(candidate, dots, usable.width);
    const widthFill = Math.min(1, measured.width / usable.width);
    const heightFill = Math.min(1, measured.height / usable.height);
    const balance = Math.min(widthFill, heightFill);
    const coverage = widthFill * heightFill;
    const score = (dots * 10000) + (balance * 100) + coverage;
    if (!best || score > best.score) {
      best = { text: candidate, dots, score, lines: candidate.split("\n").length };
    }
  });
  return best;
}

function mainTextFitsCurrent(text) {
  if (!String(text).trim()) return true;
  const usable = usableMainTextSize();
  return mainTextFitsDots(text, Number($("fontNumber").value || 28), usable.width, usable.height);
}

function getMainTextValue() {
  return mainTextObject ? String(mainTextObject.text || "") : String($("mainText")?.value || "");
}

function syncHiddenMainText() {
  const storage = $("mainText");
  if (storage && mainTextObject) storage.value = getMainTextValue();
}

function applyMainText(text) {
  mainTextObject.set({ text });
  positionMainText();
  updateMainVertical();
  canvas.requestRenderAll();
  syncHiddenMainText();
}

function acceptMainCanvasTextIfFits() {
  if (state.isRevertingMainText || !mainTextObject) return;
  const next = getMainTextValue();
  if (!mainTextFitsCurrent(next)) {
    state.isRevertingMainText = true;
    mainTextObject.set({ text: state.lastAcceptedMainText });
    mainTextObject.initDimensions && mainTextObject.initDimensions();
    state.isRevertingMainText = false;
    syncHiddenMainText();
    updateMainVertical();
    canvas.requestRenderAll();
    setStatus("Testo non inserito: supera i limiti fisici dell'etichetta");
    return;
  }

  state.lastAcceptedMainText = next;
  syncHiddenMainText();
  updateMainVertical();
  canvas.requestRenderAll();
  queueHistorySnapshot();
}

function maxMainText() {
  const text = getMainTextValue();
  if (!text.trim()) {
    setStatus("Clicca l'etichetta e scrivi prima il testo principale");
    return;
  }

  const best = bestMaxTextLayout(text);
  state.isRevertingMainText = true;
  mainTextObject.set({
    text: best.text,
    fontSize: dotsToPx(best.dots),
  });
  mainTextObject.initDimensions && mainTextObject.initDimensions();
  state.isRevertingMainText = false;
  state.lastAcceptedMainText = best.text;
  $("fontRange").value = Math.min(best.dots, Number($("fontRange").max));
  $("fontNumber").value = best.dots;
  syncHiddenMainText();
  updateMainBoxGeometry();
  canvas.requestRenderAll();
  queueHistorySnapshot(0);
  const visualLines = Array.isArray(mainTextObject._textLines) && mainTextObject._textLines.length
    ? mainTextObject._textLines.length
    : best.lines;
  const lineLabel = visualLines === 1 ? "1 riga" : `${visualLines} righe`;
  setStatus(`Testo massimizzato: ${best.dots}, ${lineLabel}`);
}

function isPointInMainTextBox(pointer) {
  const box = mainTextBox();
  return pointer.x >= box.left && pointer.x <= box.left + box.width &&
    pointer.y >= box.top && pointer.y <= box.top + box.height;
}

function editMainTextFromCanvas(pointer) {
  if (!mainTextObject || !isPointInMainTextBox(pointer)) return false;
  canvas.setActiveObject(mainTextObject);
  mainTextObject.enterEditing();
  if (mainTextObject.hiddenTextarea) mainTextObject.hiddenTextarea.focus();
  canvas.requestRenderAll();
  return true;
}

function addTextBox() {
  const preset = currentPreset();
  const object = new fabric.Textbox("Testo", {
    left: px(3),
    top: px(3),
    width: px(Math.min(25, preset.width - 6)),
    fontFamily: "Arial",
    fontWeight: "bold",
    fontSize: dotsToPx(28),
    fill: "#000",
    textAlign: "left",
    id: `text-${Date.now()}`,
  });
  object.setControlsVisibility({ mtr: false });
  canvas.add(object);
  canvas.setActiveObject(object);
  canvas.requestRenderAll();
  setStatus("Riquadro testo aggiunto");
}

function addLine() {
  const preset = currentPreset();
  const line = new fabric.Line([px(4), px(4), px(Math.min(40, preset.width - 4)), px(4)], {
    stroke: "#000",
    strokeWidth: px(0.4),
    strokeUniform: true,
    id: `line-${Date.now()}`,
  });
  line.setControlsVisibility({ mtr: false });
  canvas.add(line);
  canvas.setActiveObject(line);
  setStatus("Linea aggiunta");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("File non letto"));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Immagine non valida"));
    image.src = dataUrl;
  });
}

function optimizeImageForRibbon(image, options) {
  const scratch = $("photoScratch");
  const context = scratch.getContext("2d", { willReadFrequently: true });
  const maxSide = 900;
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  scratch.width = width;
  scratch.height = height;

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const gray = new Float32Array(width * height);
  let min = 255;
  let max = 0;

  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3] / 255;
    const value = ((data[offset] * 0.299) + (data[offset + 1] * 0.587) + (data[offset + 2] * 0.114)) * alpha + (255 * (1 - alpha));
    gray[index] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const range = Math.max(1, max - min);
  const threshold = Number(options.threshold || 138);
  for (let index = 0; index < gray.length; index += 1) {
    if (range > 18) gray[index] = ((gray[index] - min) * 255) / range;
    if (options.invert) gray[index] = 255 - gray[index];
  }

  if (options.dither) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const oldValue = gray[index];
        const newValue = oldValue < threshold ? 0 : 255;
        const error = oldValue - newValue;
        gray[index] = newValue;
        if (x + 1 < width) gray[index + 1] += error * 7 / 16;
        if (y + 1 < height) {
          if (x > 0) gray[index + width - 1] += error * 3 / 16;
          gray[index + width] += error * 5 / 16;
          if (x + 1 < width) gray[index + width + 1] += error * 1 / 16;
        }
      }
    }
  }

  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const value = gray[index] < threshold ? 0 : 255;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return scratch.toDataURL("image/png");
}

async function addOptimizedPhotoFromFile(file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) {
    setStatus("Seleziona un file immagine");
    return;
  }

  try {
    setStatus("Ottimizzo immagine per stampa ribbon...");
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadHtmlImage(dataUrl);
    const optimized = optimizeImageForRibbon(image, {
      threshold: $("photoThreshold").value,
      dither: $("photoDither").checked,
      invert: $("photoInvert").checked,
    });
    const preset = currentPreset();
    fabric.Image.fromURL(optimized, (fabricImage) => {
      const targetWidth = px(Math.min(28, Math.max(8, preset.width - 6)));
      const ratio = fabricImage.height ? fabricImage.width / fabricImage.height : 1;
      const targetHeight = Math.min(px(Math.max(6, preset.height - 6)), targetWidth / Math.max(0.1, ratio));
      fabricImage.set({
        left: px(3),
        top: px(3),
        scaleX: targetWidth / fabricImage.width,
        scaleY: targetHeight / fabricImage.height,
        id: `photo-${Date.now()}`,
        objectCaching: false,
      });
      fabricImage.setControlsVisibility({ mtr: false });
      canvas.add(fabricImage);
      canvas.setActiveObject(fabricImage);
      canvas.requestRenderAll();
      updatePropertiesPanel();
      setStatus("Foto ottimizzata aggiunta");
    });
  } catch (error) {
    setStatus(`Foto non inserita: ${error.message}`);
  }
}

function addCode() {
  const value = $("codeValue").value.trim();
  const type = $("codeType").value;
  if (!value) {
    setStatus("Inserisci un valore per il codice");
    return;
  }

  if (type === "QR Code") {
    const holder = $("qrScratch");
    holder.innerHTML = "";
    const qrCode = new QRCode(holder, { text: value, width: 360, height: 360, correctLevel: QRCode.CorrectLevel.M });
    const qrCanvas = holder.querySelector("canvas");
    const qrImage = holder.querySelector("img");
    const data = qrCanvas ? qrCanvas.toDataURL("image/png") : qrImage && qrImage.src;
    if (!data) {
      setStatus("QR Code non generato: riprova con un valore valido");
      return;
    }
    fabric.Image.fromURL(data, (image) => {
      image.set({
        left: px(3),
        top: px(3),
        scaleX: px(18) / image.width,
        scaleY: px(18) / image.height,
        id: `qr-${Date.now()}`,
      });
      image.setControlsVisibility({ mtr: false });
      canvas.add(image);
      canvas.setActiveObject(image);
      canvas.requestRenderAll();
    });
    setStatus("QR Code aggiunto");
    return;
  }

  const scratch = $("barcodeScratch");
  const format = type === "EAN-13" ? "EAN13" : type === "Code 39" ? "CODE39" : "CODE128";
  try {
    JsBarcode(scratch, value, { format, displayValue: false, margin: 4, height: 100, width: 2 });
    fabric.Image.fromURL(scratch.toDataURL("image/png"), (image) => {
      image.set({
        left: px(3),
        top: px(3),
        scaleX: px(40) / image.width,
        scaleY: px(10) / image.height,
        id: `barcode-${Date.now()}`,
      });
      image.setControlsVisibility({ mtr: false });
      canvas.add(image);
      canvas.setActiveObject(image);
      canvas.requestRenderAll();
    });
    setStatus(`${type} aggiunto`);
  } catch (error) {
    setStatus(`Barcode non valido: ${error.message}`);
  }
}

function deleteSelected() {
  const objects = canvas.getActiveObjects();
  if (!objects.length) {
    setStatus("Seleziona un oggetto da eliminare");
    return;
  }
  let removed = 0;
  objects.forEach((object) => {
    if (object !== mainTextObject) {
      canvas.remove(object);
      removed += 1;
    }
  });
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  updatePropertiesPanel();
  hideObjectContextMenu();
  setStatus(removed ? (removed === 1 ? "Oggetto rimosso" : `${removed} oggetti rimossi`) : "Il testo principale non puo essere eliminato");
}

function hideObjectContextMenu() {
  const menu = $("objectContextMenu");
  if (menu) menu.hidden = true;
}

function showObjectContextMenu(x, y) {
  const menu = $("objectContextMenu");
  if (!menu) return;
  menu.hidden = false;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function isTypingInNativeField(event) {
  const tagName = (event.target && event.target.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || event.target?.isContentEditable;
}

function isEditableFabricText(object) {
  return object && typeof object.text === "string" && typeof object.enterEditing === "function";
}

function selectedFabricText(object) {
  if (!isEditableFabricText(object)) return "";
  const start = Number.isFinite(object.selectionStart) ? object.selectionStart : 0;
  const end = Number.isFinite(object.selectionEnd) ? object.selectionEnd : start;
  if (end > start) return object.text.slice(start, end);
  return object.text || "";
}

function setFabricTextAtSelection(object, insertText) {
  if (!isEditableFabricText(object) || !insertText) return false;
  const current = String(object.text || "");
  const start = Number.isFinite(object.selectionStart) ? object.selectionStart : current.length;
  const end = Number.isFinite(object.selectionEnd) ? object.selectionEnd : start;
  const next = current.slice(0, start) + insertText + current.slice(end);

  if (object === mainTextObject && !mainTextFitsCurrent(next)) {
    setStatus("Testo non incollato: supera i limiti fisici dell'etichetta");
    return false;
  }

  if (!object.isEditing) {
    canvas.setActiveObject(object);
    object.enterEditing();
  }
  object.set({ text: next });
  object.selectionStart = object.selectionEnd = start + insertText.length;
  object.initDimensions && object.initDimensions();
  object.setCoords();
  if (object === mainTextObject) {
    state.lastAcceptedMainText = next;
    updateMainVertical();
    syncHiddenMainText();
  }
  canvas.requestRenderAll();
  return true;
}

function removeFabricTextSelection(object) {
  if (!isEditableFabricText(object)) return false;
  const current = String(object.text || "");
  const start = Number.isFinite(object.selectionStart) ? object.selectionStart : 0;
  const end = Number.isFinite(object.selectionEnd) ? object.selectionEnd : start;
  if (end <= start) return false;

  const next = current.slice(0, start) + current.slice(end);
  object.set({ text: next });
  object.selectionStart = object.selectionEnd = start;
  object.initDimensions && object.initDimensions();
  object.setCoords();
  if (object === mainTextObject) {
    state.lastAcceptedMainText = next;
    updateMainVertical();
    syncHiddenMainText();
  }
  canvas.requestRenderAll();
  return true;
}

function activeEditableTextObject() {
  const object = canvas.getActiveObject();
  return isEditableFabricText(object) ? object : null;
}

function handleClipboardCopy(event, cut = false) {
  if (isTypingInNativeField(event)) return;
  const object = activeEditableTextObject();
  if (!object) return;
  const text = selectedFabricText(object);
  if (!text) return;

  event.preventDefault();
  clipboardState.text = text;
  if (event.clipboardData) event.clipboardData.setData("text/plain", text);
  if (cut) removeFabricTextSelection(object);
  setStatus(cut ? "Testo tagliato" : "Testo copiato");
}

function handleClipboardPaste(event) {
  if (isTypingInNativeField(event)) return;
  const object = activeEditableTextObject() || mainTextObject;
  if (!object) return;

  const pasted = event.clipboardData
    ? event.clipboardData.getData("text/plain")
    : clipboardState.text;
  if (!pasted) return;

  event.preventDefault();
  if (setFabricTextAtSelection(object, pasted)) {
    setStatus("Testo incollato");
  }
}

function handleDeleteShortcut(event) {
  if (event.key !== "Delete" || isTypingInNativeField(event)) return;
  if (mainTextObject && mainTextObject.isEditing) return;
  if (!canvas.getActiveObjects().some((object) => object !== mainTextObject)) return;
  event.preventDefault();
  deleteSelected();
}

function updatePropertiesPanel() {
  const object = canvas.getActiveObject();
  const disabled = !object || object === mainTextObject;
  ["propX", "propY", "propW", "propH", "propFont", "propStroke"].forEach((id) => $(id).disabled = disabled);
  if (disabled) return;

  $("propX").value = mm(object.left || 0).toFixed(1);
  $("propY").value = mm(object.top || 0).toFixed(1);
  $("propW").value = mm(object.getScaledWidth()).toFixed(1);
  $("propH").value = mm(object.getScaledHeight()).toFixed(1);
  $("propFont").value = object.fontSize ? pxToDots(object.fontSize) : "";
  $("propStroke").value = object.strokeWidth ? mm(object.strokeWidth).toFixed(1) : "";
}

function isTextboxObject(object) {
  return object && object.type === "textbox";
}

function normalizeTextboxTransform(object) {
  if (!isTextboxObject(object)) return;
  const scaleX = Number.isFinite(object.scaleX) ? object.scaleX : 1;
  const scaleY = Number.isFinite(object.scaleY) ? object.scaleY : 1;
  const updates = {};

  if (Math.abs(scaleX - 1) > 0.001) {
    updates.width = Math.max(px(2), (object.width || px(10)) * scaleX);
    updates.scaleX = 1;
  }

  if (Math.abs(scaleY - 1) > 0.001) {
    updates.fontSize = Math.max(dotsToPx(6), (object.fontSize || dotsToPx(28)) * scaleY);
    updates.scaleY = 1;
  }

  if (Object.keys(updates).length) {
    object.set(updates);
    object.initDimensions && object.initDimensions();
    object.setCoords();
  }
}

function updateSelectedFromPanel(event) {
  const object = canvas.getActiveObject();
  if (!object || object === mainTextObject) return;
  const changedId = event && event.target ? event.target.id : "";

  object.set({
    left: px(Number($("propX").value || 0)),
    top: px(Number($("propY").value || 0)),
  });

  const targetW = px(Number($("propW").value || mm(object.getScaledWidth())));
  const targetH = px(Number($("propH").value || mm(object.getScaledHeight())));
  if (isTextboxObject(object)) {
    normalizeTextboxTransform(object);
    if (changedId === "propW" || !changedId) {
      object.set({ width: Math.max(px(2), targetW), scaleX: 1 });
    }
    if (changedId === "propFont" || !changedId) {
      object.set({
        fontSize: dotsToPx(Number($("propFont").value || pxToDots(object.fontSize || dotsToPx(28)))),
        scaleX: 1,
        scaleY: 1,
      });
    }
    if (changedId === "propH") {
      setStatus("Per i riquadri testo l'altezza segue testo e font: niente schiacciamento.");
    }
    object.initDimensions && object.initDimensions();
  } else if (object.type === "line") {
    object.set({ strokeWidth: px(Number($("propStroke").value || 0.4)) });
    object.scaleX = targetW / Math.max(1, object.width);
  } else {
    object.scaleX = targetW / Math.max(1, object.width);
    object.scaleY = targetH / Math.max(1, object.height);
  }
  object.setCoords();
  canvas.requestRenderAll();
  updatePropertiesPanel();
  queueHistorySnapshot();
}

function changePreset() {
  state.presetKey = $("presetSelect").value;
  resizeCanvasForPreset();
  setMainFontDots($("fontNumber").value);
  fitCanvas();
  queueHistorySnapshot();
}

function fitCanvas() {
  resizeCanvasForPreset();
  setStatus("Vista canvas centrata");
}

function updatePrinters(printers) {
  const select = $("printerSelect");
  const previous = state.defaultPrinter || select.value;
  select.innerHTML = "";
  (printers || []).forEach((printer) => {
    const option = document.createElement("option");
    option.value = printer.ip;
    option.textContent = printer.name === printer.ip ? printer.name : `${printer.name} - ${printer.ip}`;
    select.appendChild(option);
  });
  if (previous) select.value = previous;
  $("defaultPrinter").checked = select.value && select.value === state.defaultPrinter;
}

function printCanvas() {
  const preset = currentPreset();
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  const multiplier = (203 / 25.4) / state.scale;
  const image = canvas.toDataURL({ format: "png", multiplier, enableRetinaScaling: false });
  post({
    type: "print",
    printerIp: $("printerSelect").value,
    image,
    widthMm: preset.width,
    heightMm: preset.height,
  });
}

function bindUi() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".tab-page").forEach((page) => page.classList.remove("active"));
      button.classList.add("active");
      $(`tab-${button.dataset.tab}`).classList.add("active");
    });
  });

  $("presetSelect").addEventListener("change", changePreset);
  $("fontRange").addEventListener("input", (event) => setMainFontDots(event.target.value));
  $("fontNumber").addEventListener("input", (event) => setMainFontDots(event.target.value));
  $("maxTextBtn").addEventListener("click", maxMainText);
  $("marginMinus").addEventListener("click", () => { $("marginMm").value = Math.max(0, Number($("marginMm").value) - 0.5); $("marginMm").dispatchEvent(new Event("input")); });
  $("marginPlus").addEventListener("click", () => { $("marginMm").value = Number($("marginMm").value) + 0.5; $("marginMm").dispatchEvent(new Event("input")); });
  $("marginMm").addEventListener("input", () => {
    state.marginMm = Number($("marginMm").value || 0);
    setMainFontDots($("fontNumber").value);
    updateMainBoxGeometry();
    canvas.requestRenderAll();
    queueHistorySnapshot();
  });
  $("addTextBox").addEventListener("click", addTextBox);
  $("addLine").addEventListener("click", addLine);
  $("deleteObject").addEventListener("click", deleteSelected);
  $("pickPhoto").addEventListener("click", () => $("photoFile").click());
  $("photoFile").addEventListener("change", (event) => {
    addOptimizedPhotoFromFile(event.target.files && event.target.files[0]);
    event.target.value = "";
  });
  $("addCode").addEventListener("click", addCode);
  $("deleteCodeObject").addEventListener("click", deleteSelected);
  $("contextDeleteObject").addEventListener("click", deleteSelected);
  $("printBtn").addEventListener("click", printCanvas);
  $("fitBtn").addEventListener("click", fitCanvas);
  $("discoverBtn").addEventListener("click", () => post({ type: "discover" }));
  $("defaultPrinter").addEventListener("change", () => {
    state.defaultPrinter = $("defaultPrinter").checked ? $("printerSelect").value : "";
    localStorage.setItem("meto.webview2.defaultPrinter", state.defaultPrinter);
  });
  $("printerSelect").addEventListener("change", () => $("defaultPrinter").checked = $("printerSelect").value === state.defaultPrinter);

  document.querySelectorAll("#hAlign button").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("#hAlign button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mainAlignH = button.dataset.align;
    positionMainText();
    syncHiddenMainText();
    canvas.requestRenderAll();
    queueHistorySnapshot();
  }));
  document.querySelectorAll("#vAlign button").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("#vAlign button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mainAlignV = button.dataset.align;
    updateMainVertical();
    canvas.requestRenderAll();
    queueHistorySnapshot();
  }));

  ["propX", "propY", "propW", "propH", "propFont", "propStroke"].forEach((id) => $(id).addEventListener("change", updateSelectedFromPanel));

  canvas.on("selection:created", updatePropertiesPanel);
  canvas.on("selection:updated", updatePropertiesPanel);
  canvas.on("selection:cleared", updatePropertiesPanel);
  canvas.on("object:modified", (event) => {
    normalizeTextboxTransform(event.target);
    updatePropertiesPanel();
    queueHistorySnapshot();
  });
  canvas.on("object:added", () => queueHistorySnapshot());
  canvas.on("object:removed", () => queueHistorySnapshot());
  canvas.on("text:changed", () => queueHistorySnapshot());
  canvas.on("object:moving", updatePropertiesPanel);
  canvas.on("object:scaling", updatePropertiesPanel);
  canvas.on("mouse:down", (event) => {
    hideObjectContextMenu();
    if (event.target && event.target !== mainTextObject) return;
    const pointer = canvas.getPointer(event.e);
    if (event.target === mainTextObject || isPointInMainTextBox(pointer)) {
      window.setTimeout(() => editMainTextFromCanvas(pointer), 0);
    }
  });
  canvas.upperCanvasEl.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const target = canvas.findTarget(event, false);
    if (target && target !== mainTextObject) {
      canvas.setActiveObject(target);
      target.setCoords();
      canvas.requestRenderAll();
      updatePropertiesPanel();
      showObjectContextMenu(event.clientX, event.clientY);
    } else {
      hideObjectContextMenu();
    }
  });
  document.addEventListener("keydown", handleUndoRedoShortcut);
  document.addEventListener("keydown", handleDeleteShortcut);
  document.addEventListener("copy", (event) => handleClipboardCopy(event, false));
  document.addEventListener("cut", (event) => handleClipboardCopy(event, true));
  document.addEventListener("paste", handleClipboardPaste);
  document.addEventListener("click", (event) => {
    if (!$("objectContextMenu")?.contains(event.target)) hideObjectContextMenu();
  });
  window.addEventListener("resize", () => window.requestAnimationFrame(resizeCanvasForPreset));
}


bindUi();
createMainText();
resizeCanvasForPreset();
updatePrinters([]);
setStatus("Collega QZ Tray per stampare");
editHistory.started = true;
commitHistorySnapshot();
setTimeout(() => document.body.classList.add("app-ready"), 450);
post({ type: "ready" });
