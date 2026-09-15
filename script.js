// ===== Grab all the elements we'll need to update =====
const dropzone       = document.getElementById('dropzone');
const fileInput      = document.getElementById('fileInput');
const browseBtn      = document.getElementById('browseBtn');
const dzEmpty        = document.getElementById('dzEmpty');
const dzPreview      = document.getElementById('dzPreview');
const previewImg     = document.getElementById('previewImg');
const scanLine       = document.getElementById('scanLine');
const analyzeBtn     = document.getElementById('analyzeBtn');
const clearBtn       = document.getElementById('clearBtn');
const statusText     = document.getElementById('statusText');
const resultPanel    = document.getElementById('resultPanel');
const resultBadge    = document.getElementById('resultBadge');
const ringFill       = document.getElementById('ringFill');
const confidenceValue= document.getElementById('confidenceValue');
const resultNote     = document.getElementById('resultNote');

let currentFile = null;
let currentObjectUrl = null;
let isAnalyzing = false; // true while a "request" is in flight, so the image can't be swapped mid-analysis
let dragCounter = 0;     // tracks nested drag events so the highlight doesn't flicker over child elements

const RING_CIRCUMFERENCE = 326.73; // must match the value used in style.css (2 * pi * r, r = 52)
const MAX_FILE_SIZE_MB = 15;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

// =====================================================================
// MOCK BACKEND CALL
// This is the ONLY function you need to replace once your teammate's
// model is ready. It must keep returning an object shaped exactly like:
//   { result: "Normal" | "OSCC", confidence: 0.0 to 1.0 }
// =====================================================================
async function analyzeImage(file) {
  // ---- REAL VERSION (uncomment and use this once the backend exists) ----
  // const formData = new FormData();
  // formData.append("image", file);
  // const response = await fetch("http://localhost:5000/predict", {
  //   method: "POST",
  //   body: formData
  // });
  // if (!response.ok) throw new Error("Server error");
  // return await response.json();

  // ---- MOCK VERSION (delete this block when you switch to the real one) ----
  return new Promise((resolve) => {
    const delay = 1200 + Math.random() * 800; // random delay between 1.2s and 2s
    setTimeout(() => {
      const isOSCC = Math.random() < 0.5;
      resolve({
        result: isOSCC ? "OSCC" : "Normal",
        confidence: parseFloat((0.75 + Math.random() * 0.24).toFixed(2))
      });
    }, delay);
  });
}

// ===== Handling a chosen/dropped file =====
function handleFile(file) {
  if (!file) return;

  // Match the validation to what the UI actually promises ("JPG or PNG"),
  // rather than silently accepting any image/* type the browser recognizes.
  if (!ACCEPTED_TYPES.includes(file.type)) {
    statusText.textContent = 'Please choose a JPG or PNG image file.';
    return;
  }

  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > MAX_FILE_SIZE_MB) {
    statusText.textContent = `That file is too large (${sizeMB.toFixed(1)} MB). Please choose an image under ${MAX_FILE_SIZE_MB} MB.`;
    return;
  }

  currentFile = file;

  // Free the previous preview image from memory, if there was one
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(file);

  previewImg.src = currentObjectUrl;
  dzEmpty.hidden = true;
  dzPreview.hidden = false;

  analyzeBtn.disabled = false;
  clearBtn.hidden = false;
  statusText.textContent = '';
  resultPanel.hidden = true;
}

function resetUpload() {
  currentFile = null;
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;

  fileInput.value = '';
  dzEmpty.hidden = false;
  dzPreview.hidden = true;
  analyzeBtn.disabled = true;
  clearBtn.hidden = true;
  statusText.textContent = '';
  resultPanel.hidden = true;
}

// Clicking anywhere on the dropzone opens the file picker — but not while
// an analysis is running, so the image on screen can never be swapped out
// from under a result that hasn't come back yet.
dropzone.addEventListener('click', () => {
  if (isAnalyzing) return;
  fileInput.click();
});

// The "Browse files" button also opens it — stopPropagation keeps the
// dropzone's own click handler above from firing a second time
browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isAnalyzing) return;
  fileInput.click();
});

fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

// ---- Drag & drop support ----
// dragenter/dragleave fire for every child element too (the corner marks,
// the preview image, etc.), not just the dropzone itself. A plain add/remove
// on those events makes the highlight flicker as the cursor crosses child
// elements. Counting enters vs. leaves fixes that: the highlight only turns
// off once the cursor has actually left the whole dropzone.
dropzone.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (isAnalyzing) return;
  dragCounter++;
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault(); // still required, or the browser blocks the drop
});
dropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) dropzone.classList.remove('drag-over');
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropzone.classList.remove('drag-over');
  if (isAnalyzing) return;
  const file = e.dataTransfer.files[0];
  handleFile(file);
});

clearBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  resetUpload();
});

// ===== Running the analysis =====
analyzeBtn.addEventListener('click', async () => {
  if (!currentFile || isAnalyzing) return;

  // Keep a reference to exactly which file this analysis is for. Even
  // though the dropzone is locked during analysis (so this shouldn't
  // change), holding our own reference — rather than re-reading the
  // shared `currentFile` variable later — guarantees the result we show
  // can never end up describing a different image than the one analyzed.
  const fileBeingAnalyzed = currentFile;

  isAnalyzing = true;
  dropzone.classList.add('locked');
  analyzeBtn.disabled = true;
  clearBtn.hidden = true;
  resultPanel.hidden = true;
  statusText.textContent = 'Analyzing image…';
  scanLine.hidden = false;
  scanLine.classList.add('scanning');

  try {
    const data = await analyzeImage(fileBeingAnalyzed);
    showResult(data);
    statusText.textContent = 'Analysis complete.';
  } catch (err) {
    statusText.textContent = 'Something went wrong. Please try again.';
  } finally {
    isAnalyzing = false;
    dropzone.classList.remove('locked');
    scanLine.classList.remove('scanning');
    scanLine.hidden = true;
    clearBtn.hidden = false;
    analyzeBtn.disabled = false;
  }
});

// ===== Displaying the result =====
function showResult(data) {
  const isOSCC = data.result === 'OSCC';
  const pct = Math.round(data.confidence * 100);

  resultBadge.textContent = data.result;
  resultBadge.className = 'badge ' + (isOSCC ? 'oscc' : 'normal');

  ringFill.classList.remove('normal', 'oscc');
  ringFill.classList.add(isOSCC ? 'oscc' : 'normal');

  // Animate the ring filling up to the confidence level
  const offset = RING_CIRCUMFERENCE * (1 - data.confidence);
  ringFill.style.transition = 'none';
  ringFill.style.strokeDashoffset = RING_CIRCUMFERENCE;
  void ringFill.getBoundingClientRect(); // forces the browser to apply the reset above before animating
  ringFill.style.transition = 'stroke-dashoffset 1s ease, stroke 0.3s ease';
  ringFill.style.strokeDashoffset = offset;

  confidenceValue.textContent = pct + '%';

  resultNote.textContent = isOSCC
    ? 'Signs consistent with OSCC were detected in this image.'
    : 'No signs of OSCC were detected in this image.';

  resultPanel.hidden = false;
}
