// IrisAdapt Pro - Tracker v4 (with full debug)

// Bắt bất kỳ lỗi JS nào và hiển thị lên màn hình
window.onerror = (msg, src, line) => {
  const errorEl = document.getElementById('error');
  if (errorEl) {
    errorEl.textContent = `JS Error: ${msg} (line ${line})`;
    errorEl.style.display = 'block';
  }
};

const video      = document.getElementById('video');
const faceStatus = document.getElementById('faceStatus');
const blurDisplay= document.getElementById('blurDisplay');
const dotEl      = document.getElementById('dotIndicator');
const statusEl   = document.getElementById('status');
const errorEl    = document.getElementById('error');
const eyeCanvas  = document.getElementById('eyeCanvas');
const eyeCtx     = eyeCanvas.getContext('2d');

let isRunning = false;
let detectionLoop = null;

let settings = {
  maxBlur: 15,
  sensitivity: 50,
  notificationsEnabled: true,
  notificationCooldown: 30
};

let lastNotifyTime = 0;
let lostFrames = 0;
let lastBlur = 0;

// =====================================================
// NGƯỠNG: eyeRatio = pixel_distance_2_mắt / videoWidth
//  ~20cm -> ~0.24-0.28
//  ~30cm -> ~0.16-0.20  <- ngưỡng mờ
//  ~40cm -> ~0.12-0.14  <- ngưỡng cảnh báo
//  ~50cm -> ~0.09-0.11
// =====================================================
function getThresholds() {
  const s = settings.sensitivity / 100;
  return {
    warnCutoff: 0.10 + (s * 0.04),  // 50% -> ~0.12 (~40cm)
    blurCutoff: 0.14 + (s * 0.06)   // 50% -> ~0.17 (~30cm)
  };
}

// =====================================================
// KHỞI TẠO
// =====================================================
async function init() {
  // Kiểm tra face-api có load không
  if (typeof faceapi === 'undefined') {
    showError('face-api.js chưa được tải! Hãy reload extension.');
    return;
  }

  chrome.storage.local.get(['settings'], (r) => {
    if (r.settings) settings = { ...settings, ...r.settings };
    updateDebugThresholds();
  });

  // BƯỚC 1: Camera trước
  statusEl.textContent = 'Đang mở camera...';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user', frameRate: { ideal: 15 } }
    });
    video.srcObject = stream;
    await video.play();
    eyeCanvas.width  = video.videoWidth  || 320;
    eyeCanvas.height = video.videoHeight || 240;
    statusEl.textContent = '✅ Camera OK. Đang tải mô hình AI (~2 giây)...';
    document.getElementById('dbgState').textContent = '⏳ Đang tải model...';
  } catch (err) {
    showError('Không thể mở camera: ' + err.message);
    return;
  }

  // BƯỚC 2: Load models từ dữ liệu nhúng sẵn (không cần fetch)
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';

  try {
    await loadModelsFromEmbedded();
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    document.getElementById('dbgMode').textContent = 'TinyFaceDetector + Landmark68Tiny ✅';
    statusEl.textContent = '✅ Sẵn sàng! Đang nhận diện mắt...';
    document.getElementById('dbgState').textContent = '⚪ Chưa phát hiện mặt';
    isRunning = true;
    startDetection();
  } catch (e) {
    if (loadingOverlay) {
      loadingOverlay.textContent = '❌ Lỗi model: ' + e.message;
      loadingOverlay.style.background = 'rgba(200,0,0,0.85)';
    }
    showError('Lỗi model: ' + e.message);
  }
}

// Chuyển base64 thành File object để truyền vào face-api
function base64ToFile(b64, filename) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: 'application/octet-stream' });
}

async function loadModelsFromEmbedded() {
  if (typeof EMBEDDED_MODELS === 'undefined') {
    throw new Error('models-embedded.js chưa được tải');
  }

  // Tiny Face Detector
  const tfdManifest = new File(
    [JSON.stringify(EMBEDDED_MODELS.tfd.manifest)],
    'tiny_face_detector_model-weights_manifest.json',
    { type: 'application/json' }
  );
  const tfdShard = base64ToFile(EMBEDDED_MODELS.tfd.shard, 'tiny_face_detector_model-shard1');
  await faceapi.nets.tinyFaceDetector.loadFromFiles([tfdManifest, tfdShard]);

  // Face Landmark 68 Tiny
  const lm68Manifest = new File(
    [JSON.stringify(EMBEDDED_MODELS.lm68.manifest)],
    'face_landmark_68_tiny_model-weights_manifest.json',
    { type: 'application/json' }
  );
  const lm68Shard = base64ToFile(EMBEDDED_MODELS.lm68.shard, 'face_landmark_68_tiny_model-shard1');
  await faceapi.nets.faceLandmark68TinyNet.loadFromFiles([lm68Manifest, lm68Shard]);
}

// =====================================================
// VÒNG LẶP NHẬN DIỆN
// =====================================================
function startDetection() {
  const opts = new faceapi.TinyFaceDetectorOptions({
    inputSize: 224,       // Tăng lên 224 để nhận diện tốt hơn
    scoreThreshold: 0.3
  });

  detectionLoop = setInterval(async () => {
    if (!isRunning || video.readyState < 2) return;

    try {
      const result = await faceapi
        .detectSingleFace(video, opts)
        .withFaceLandmarks(true);

      eyeCtx.clearRect(0, 0, eyeCanvas.width, eyeCanvas.height);

      let eyeRatio = 0;
      let faceFound = false;

      if (result) {
        faceFound = true;
        const landmarks = result.landmarks;
        const leftEyePts  = landmarks.getLeftEye();
        const rightEyePts = landmarks.getRightEye();
        const leftCenter  = centroid(leftEyePts);
        const rightCenter = centroid(rightEyePts);

        const dx = rightCenter.x - leftCenter.x;
        const dy = rightCenter.y - leftCenter.y;
        const pixelDist = Math.sqrt(dx * dx + dy * dy);
        eyeRatio = pixelDist / video.videoWidth;

        // Vẽ landmark
        drawEyePoints(leftEyePts, rightEyePts, leftCenter, rightCenter);
      }

      // --- Xác định vùng ---
      const { warnCutoff, blurCutoff } = getThresholds();
      let blurLevel = 0;
      let zone = 'safe';

      if (faceFound && eyeRatio > 0) {
        if (eyeRatio >= blurCutoff) {
          blurLevel = settings.maxBlur;
          zone = 'blur';
        } else if (eyeRatio >= warnCutoff) {
          blurLevel = 0;
          zone = 'warn';
        }
      }

      // Buffer mất mặt tạm thời
      if (faceFound) {
        lostFrames = 0;
        lastBlur = blurLevel;
      } else {
        lostFrames++;
        if (lostFrames < 8) {
          blurLevel = lastBlur;
          faceFound = true;
        } else {
          blurLevel = 0;
          lastBlur = 0;
          eyeRatio = 0;
        }
      }

      // Cập nhật UI
      updateUI(faceFound, eyeRatio, blurLevel, zone);

      // Gửi tín hiệu blur
      chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: blurLevel });

      // Thông báo
      const now = Date.now();
      const cooldown = (settings.notificationCooldown || 30) * 1000;
      if ((zone === 'blur' || zone === 'warn') && now - lastNotifyTime > cooldown) {
        lastNotifyTime = now;
        chrome.runtime.sendMessage({ type: 'NOTIFY_TOO_CLOSE', zone });
      }

    } catch (e) {
      // frame lỗi, bỏ qua
    }
  }, 150);
}

// Tính tâm tập điểm
function centroid(pts) {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

// Vẽ điểm mắt lên canvas
function drawEyePoints(lPts, rPts, lC, rC) {
  const sx = eyeCanvas.width  / (video.videoWidth  || 320);
  const sy = eyeCanvas.height / (video.videoHeight || 240);

  const dot = (pt, color) => {
    eyeCtx.beginPath();
    eyeCtx.arc(pt.x * sx, pt.y * sy, 3, 0, 2 * Math.PI);
    eyeCtx.fillStyle = color;
    eyeCtx.fill();
  };

  [...lPts, ...rPts].forEach(p => dot(p, 'rgba(32,201,151,0.85)'));
  dot(lC, '#FF6B6B');
  dot(rC, '#FF6B6B');

  eyeCtx.beginPath();
  eyeCtx.moveTo(lC.x * sx, lC.y * sy);
  eyeCtx.lineTo(rC.x * sx, rC.y * sy);
  eyeCtx.strokeStyle = 'rgba(255,200,0,0.9)';
  eyeCtx.lineWidth = 2;
  eyeCtx.stroke();
}

// Cập nhật UI chính
function updateUI(faceFound, eyeRatio, blurLevel, zone) {
  const { warnCutoff, blurCutoff } = getThresholds();

  faceStatus.textContent = faceFound ? 'Khuôn mặt: Đã phát hiện' : 'Không phát hiện khuôn mặt';

  if (zone === 'blur') {
    dotEl.className = 'dot warning';
    blurDisplay.textContent = '⚠️ QUÁ GẦN - Màn hình mờ';
    blurDisplay.className = 'blur-display danger';
  } else if (zone === 'warn') {
    dotEl.className = 'dot caution';
    blurDisplay.textContent = '⚡ Hơi gần - Hãy lùi ra';
    blurDisplay.className = 'blur-display caution';
  } else {
    dotEl.className = faceFound ? 'dot' : 'dot';
    blurDisplay.textContent = faceFound ? '✅ Khoảng cách an toàn' : '-- Không có mặt --';
    blurDisplay.className = 'blur-display';
  }

  document.getElementById('dbgEyeRatio').textContent =
    eyeRatio > 0 ? `${eyeRatio.toFixed(4)}` : '---';
  document.getElementById('dbgWarn').textContent  = warnCutoff.toFixed(4);
  document.getElementById('dbgBlur').textContent  = blurCutoff.toFixed(4);
  document.getElementById('dbgState').textContent =
    zone === 'blur' ? '🔴 QUÁ GẦN (<30cm) - Mờ' :
    zone === 'warn' ? '🟡 HƠI GẦN (30-40cm)' :
    faceFound       ? '🟢 AN TOÀN (>40cm)' : '⚪ Không có mặt';
}

function updateDebugThresholds() {
  const { warnCutoff, blurCutoff } = getThresholds();
  document.getElementById('dbgWarn').textContent = warnCutoff.toFixed(4);
  document.getElementById('dbgBlur').textContent = blurCutoff.toFixed(4);
}

function showError(msg) {
  errorEl.textContent = '❌ ' + msg;
  errorEl.style.display = 'block';
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    settings = { ...settings, ...changes.settings.newValue };
    updateDebugThresholds();
  }
});

window.addEventListener('beforeunload', () => {
  isRunning = false;
  if (detectionLoop) clearInterval(detectionLoop);
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: 0 });
});

// Nút test blur (cho phép test blur mà không cần phát hiện mặt)
window.testBlur = function(level) {
  chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level });
  document.getElementById('dbgState').textContent = `🧪 Test blur: ${level}px`;
};

init();
