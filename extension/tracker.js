// IrisAdapt Pro - Tracker v3
// Dùng face-api.js TinyFaceDetector + face_landmark_68_tiny để đo khoảng cách 2 mắt

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

// Cài đặt mặc định
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
// NGƯỠNG: Dựa trên tỷ lệ khoảng cách 2 mắt / chiều rộng frame
// Tỷ lệ mắt (eyeRatio) = pixel_distance_2_mắt / video.videoWidth
//
//  ~20cm -> eyeRatio ~ 0.24-0.28
//  ~30cm -> eyeRatio ~ 0.16-0.20  <- ngưỡng mờ
//  ~40cm -> eyeRatio ~ 0.12-0.14  <- ngưỡng cảnh báo
//  ~50cm -> eyeRatio ~ 0.09-0.11
//  ~60cm -> eyeRatio ~ 0.08-0.10
// =====================================================
function getThresholds() {
  const s = settings.sensitivity / 100;
  return {
    warnCutoff: 0.10 + (s * 0.04),  // 50% -> ~0.12  (~40cm)
    blurCutoff: 0.14 + (s * 0.06)   // 50% -> ~0.17  (~30cm)
  };
}

// =====================================================
// KHỞI TẠO
// =====================================================
async function init() {
  // Load settings
  chrome.storage.local.get(['settings'], (r) => {
    if (r.settings) settings = { ...settings, ...r.settings };
  });

  // Load face-api models từ thư mục /models/ trong extension
  const modelPath = chrome.runtime.getURL('models');
  statusEl.textContent = 'Đang tải mô hình AI...';

  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelPath)
    ]);
    document.getElementById('dbgMode').textContent = 'face-api.js TinyFaceDetector + Landmark68';
    statusEl.textContent = '✅ Mô hình AI đã sẵn sàng';
  } catch (e) {
    showError('Không tải được mô hình AI: ' + e.message);
    return;
  }

  // Bật webcam
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user', frameRate: { ideal: 15 } }
    });
    video.srcObject = stream;
    await video.play();

    eyeCanvas.width  = video.videoWidth  || 320;
    eyeCanvas.height = video.videoHeight || 240;

    isRunning = true;
    statusEl.textContent = '✅ Camera đang hoạt động';
    startDetection();
  } catch (err) {
    showError('Không thể truy cập camera: ' + err.message);
  }
}

// =====================================================
// VÒNG LẶP NHẬN DIỆN
// =====================================================
function startDetection() {
  const detectorOptions = new faceapi.TinyFaceDetectorOptions({
    inputSize: 160,       // Nhỏ = nhanh
    scoreThreshold: 0.35  // Tin cậy tối thiểu
  });

  detectionLoop = setInterval(async () => {
    if (!isRunning || video.readyState < 2) return;

    try {
      // Nhận diện mặt + landmark 68 điểm
      const result = await faceapi
        .detectSingleFace(video, detectorOptions)
        .withFaceLandmarks(true); // true = dùng tiny model

      eyeCtx.clearRect(0, 0, eyeCanvas.width, eyeCanvas.height);

      let eyeRatio = 0;
      let faceFound = false;

      if (result) {
        faceFound = true;
        const landmarks = result.landmarks;

        // Lấy tất cả điểm landmark của mắt trái và mắt phải
        const leftEyePts  = landmarks.getLeftEye();   // ~6 điểm
        const rightEyePts = landmarks.getRightEye();  // ~6 điểm

        // Tính tâm của mỗi mắt
        const leftCenter  = centroid(leftEyePts);
        const rightCenter = centroid(rightEyePts);

        // Tính khoảng cách pixel giữa 2 tâm mắt
        const dx = rightCenter.x - leftCenter.x;
        const dy = rightCenter.y - leftCenter.y;
        const pixelDist = Math.sqrt(dx * dx + dy * dy);

        // Chuẩn hoá theo chiều rộng video
        eyeRatio = pixelDist / video.videoWidth;

        // Vẽ điểm mắt lên canvas (visualize)
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

      // --- Buffer khi mất mặt ---
      if (faceFound) {
        lostFrames = 0;
        lastBlur = blurLevel;
      } else {
        lostFrames++;
        if (lostFrames < 6) {
          blurLevel = lastBlur;
          faceFound = true;
        } else {
          blurLevel = 0;
          lastBlur = 0;
          eyeRatio = 0;
        }
      }

      // --- Cập nhật UI ---
      updateUI(faceFound, eyeRatio, blurLevel, zone);

      // --- Gửi tín hiệu ---
      chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: blurLevel });

      // --- Thông báo ---
      const now = Date.now();
      const cooldown = (settings.notificationCooldown || 30) * 1000;
      if ((zone === 'blur' || zone === 'warn') && now - lastNotifyTime > cooldown) {
        lastNotifyTime = now;
        chrome.runtime.sendMessage({ type: 'NOTIFY_TOO_CLOSE', zone });
      }

    } catch (e) {
      // Bỏ qua lỗi frame
    }
  }, 150); // ~6-7 fps
}

// =====================================================
// HELPER: Tính tâm của tập điểm
// =====================================================
function centroid(pts) {
  const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}

// =====================================================
// HELPER: Vẽ điểm landmark mắt lên canvas overlay
// =====================================================
function drawEyePoints(leftPts, rightPts, leftCenter, rightCenter) {
  const scaleX = eyeCanvas.width  / video.videoWidth;
  const scaleY = eyeCanvas.height / video.videoHeight;

  const drawDot = (pt, color) => {
    eyeCtx.beginPath();
    eyeCtx.arc(pt.x * scaleX, pt.y * scaleY, 2.5, 0, 2 * Math.PI);
    eyeCtx.fillStyle = color;
    eyeCtx.fill();
  };

  // Vẽ các điểm mắt
  [...leftPts, ...rightPts].forEach(pt => drawDot(pt, 'rgba(32,201,151,0.9)'));

  // Vẽ tâm mắt
  drawDot(leftCenter, '#F85149');
  drawDot(rightCenter, '#F85149');

  // Vẽ đường nối 2 tâm mắt
  eyeCtx.beginPath();
  eyeCtx.moveTo(leftCenter.x * scaleX, leftCenter.y * scaleY);
  eyeCtx.lineTo(rightCenter.x * scaleX, rightCenter.y * scaleY);
  eyeCtx.strokeStyle = 'rgba(255,200,0,0.8)';
  eyeCtx.lineWidth = 1.5;
  eyeCtx.stroke();
}

// =====================================================
// HELPER: Cập nhật UI
// =====================================================
function updateUI(faceFound, eyeRatio, blurLevel, zone) {
  const { warnCutoff, blurCutoff } = getThresholds();

  faceStatus.textContent = faceFound ? 'Khuôn mặt: Đã phát hiện' : 'Không phát hiện khuôn mặt';
  
  if (zone === 'blur') {
    dotEl.className = 'dot warning';
    blurDisplay.textContent = `⚠️ QUÁ GẦN - Màn hình mờ`;
    blurDisplay.className = 'blur-display danger';
  } else if (zone === 'warn') {
    dotEl.className = 'dot caution';
    blurDisplay.textContent = `⚡ Hơi gần - Hãy lùi ra`;
    blurDisplay.className = 'blur-display caution';
  } else {
    dotEl.className = faceFound ? 'dot' : 'dot';
    blurDisplay.textContent = `✅ Khoảng cách an toàn`;
    blurDisplay.className = 'blur-display';
  }

  // Debug
  document.getElementById('dbgEyeRatio').textContent =
    eyeRatio > 0 ? eyeRatio.toFixed(4) : '---';
  document.getElementById('dbgWarn').textContent  = warnCutoff.toFixed(4);
  document.getElementById('dbgBlur').textContent  = blurCutoff.toFixed(4);
  document.getElementById('dbgState').textContent =
    zone === 'blur' ? '🔴 QUÁ GẦN (<30cm)' :
    zone === 'warn' ? '🟡 HƠI GẦN (30-40cm)' :
    faceFound       ? '🟢 AN TOÀN (>40cm)' : '⚪ Không có mặt';
}

// =====================================================
// HELPER: Hiển thị lỗi
// =====================================================
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
  statusEl.textContent = '❌ Lỗi';
}

// =====================================================
// LẮNG NGHE SETTINGS
// =====================================================
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) settings = { ...settings, ...changes.settings.newValue };
});

// =====================================================
// CLEANUP KHI ĐÓNG CỬA SỔ
// =====================================================
window.addEventListener('beforeunload', () => {
  isRunning = false;
  if (detectionLoop) clearInterval(detectionLoop);
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: 0 });
});

// Bắt đầu
init();
