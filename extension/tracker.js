// IrisAdapt Pro - Tracker Window
// Chạy webcam + face detection trong cửa sổ riêng

const video = document.getElementById('video');
const faceStatus = document.getElementById('faceStatus');
const blurDisplay = document.getElementById('blurDisplay');
const dotIndicator = document.getElementById('dotIndicator');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

let isRunning = false;
let faceDetector = null;
let detectionInterval = null;

// Settings
let settings = {
  maxBlur: 15,
  sensitivity: 50,
  notificationsEnabled: true,
  notificationCooldown: 30
};

let lastTooCloseNotify = 0;
let lostFaceFrames = 0;
let lastBlurLevel = 0;

// Tính ngưỡng từ sensitivity (Chuẩn hoá cho khoảng cách 50-60cm)
function getThresholds() {
  const s = settings.sensitivity / 100; // 0.0 đến 1.0
  
  // Tỷ lệ khuôn mặt so với camera. 
  // Ở khoảng cách 50-60cm, mặt người thường chiếm khoảng 20%-25% khung hình (0.20 - 0.25).
  // Khi dí sát vào 20-30cm, mặt sẽ chiếm khoảng 40%-50% (0.40 - 0.50).
  
  // sensitivity = 50% -> safe: 0.25 (~50cm), danger: 0.45 (~25cm)
  // sensitivity = 100% (siêu nhạy) -> safe: 0.15 (~70cm), danger: 0.35 (~40cm)
  return {
    safeRatio: 0.35 - (s * 0.20),
    dangerRatio: 0.55 - (s * 0.20)
  };
}

// ========== KHỞI TẠO ==========

async function init() {
  // Load settings
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      settings = { ...settings, ...result.settings };
    }
  });

  // Kiểm tra FaceDetector
  if ('FaceDetector' in window) {
    try {
      faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      statusEl.textContent = 'FaceDetector API sẵn sàng';
    } catch (e) {
      showError('Không thể khởi tạo FaceDetector: ' + e.message);
      // Fallback: dùng canvas-based detection
      faceDetector = null;
    }
  } else {
    statusEl.textContent = 'FaceDetector không khả dụng - dùng fallback';
    faceDetector = null;
  }

  // Mở webcam
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' }
    });
    video.srcObject = stream;
    await video.play();
    
    statusEl.textContent = '✅ Camera đang hoạt động';
    isRunning = true;
    startDetection();
  } catch (err) {
    showError('Không thể truy cập camera: ' + err.message);
    statusEl.textContent = '❌ Lỗi camera';
  }
}

// ========== FACE DETECTION ==========

function startDetection() {
  if (!isRunning) return;

  detectionInterval = setInterval(async () => {
    if (!isRunning) return;

    try {
      let blurLevel = 0;
      let faceFound = false;

      if (faceDetector) {
        // Dùng FaceDetector API
        const faces = await faceDetector.detect(video);
        if (faces.length > 0) {
          faceFound = true;
          const face = faces[0];
          const faceWidthRatio = face.boundingBox.width / video.videoWidth;
          blurLevel = calculateBlur(faceWidthRatio);
        }
      } else {
        // Fallback: dùng canvas để phân tích kích thước khuôn mặt
        blurLevel = await fallbackDetection();
        faceFound = blurLevel >= 0;
        if (blurLevel < 0) blurLevel = 0;
      }

      // Xử lý mất khuôn mặt tạm thời (giữ trạng thái blur vài khung hình)
      if (faceFound) {
        lostFaceFrames = 0;
        lastBlurLevel = blurLevel;
      } else {
        lostFaceFrames++;
        if (lostFaceFrames < 5) { // Giữ blur trong ~1.5 giây
          faceFound = true;
          blurLevel = lastBlurLevel;
        } else {
          blurLevel = 0;
          lastBlurLevel = 0;
        }
      }

      // Cập nhật UI
      if (faceFound) {
        faceStatus.textContent = `Khuôn mặt: Đã phát hiện`;
        dotIndicator.className = blurLevel > 0 ? 'dot warning' : 'dot';
      } else {
        faceStatus.textContent = 'Không phát hiện khuôn mặt';
        dotIndicator.className = 'dot';
      }

      blurDisplay.textContent = `Blur: ${blurLevel.toFixed(1)}px`;
      blurDisplay.className = blurLevel > settings.maxBlur * 0.5
        ? 'blur-display danger' : 'blur-display';

      // Gửi blur level đến background
      chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: blurLevel });

      // Thông báo khi quá gần
      const now = Date.now();
      const cooldown = (settings.notificationCooldown || 30) * 1000;
      if (blurLevel >= settings.maxBlur * 0.6 && now - lastTooCloseNotify > cooldown) {
        lastTooCloseNotify = now;
        chrome.runtime.sendMessage({ type: 'NOTIFY_TOO_CLOSE' });
      }

    } catch (err) {
      // Bỏ qua lỗi detection
    }
  }, 300); // ~3.3 fps
}

function calculateBlur(faceWidthRatio) {
  const { safeRatio, dangerRatio } = getThresholds();

  if (faceWidthRatio <= safeRatio) return 0;
  if (faceWidthRatio >= dangerRatio) return settings.maxBlur;

  const ratio = (faceWidthRatio - safeRatio) / (dangerRatio - safeRatio);
  return ratio * settings.maxBlur;
}

// ========== FALLBACK DETECTION (không cần FaceDetector) ==========

const fallbackCanvas = document.createElement('canvas');
fallbackCanvas.width = 320;
fallbackCanvas.height = 240;
const fallbackCtx = fallbackCanvas.getContext('2d', { willReadFrequently: true });

async function fallbackDetection() {
  fallbackCtx.drawImage(video, 0, 0, 320, 240);
  const imageData = fallbackCtx.getImageData(0, 0, 320, 240);
  const data = imageData.data;

  // Phát hiện vùng da (skin detection) đơn giản
  let skinPixels = 0;
  let minX = 320, maxX = 0, minY = 240, maxY = 0;

  for (let y = 0; y < 240; y += 2) {
    for (let x = 0; x < 320; x += 2) {
      const i = (y * 320 + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      // Kiểm tra pixel có phải màu da không
      if (isSkinColor(r, g, b)) {
        skinPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Tính tỉ lệ vùng da
  const totalPixels = (320 * 240) / 4; // do bước nhảy 2
  const skinRatio = skinPixels / totalPixels;

  if (skinRatio < 0.02) return -1; // Không phát hiện khuôn mặt

  // Tính kích thước vùng da
  const faceWidth = maxX - minX;
  const faceWidthRatio = faceWidth / 320;

  return calculateBlur(faceWidthRatio);
}

function isSkinColor(r, g, b) {
  // Phát hiện màu da cơ bản (RGB)
  return r > 95 && g > 40 && b > 20 &&
         r > g && r > b &&
         (r - g) > 15 &&
         Math.abs(r - g) > 15 &&
         r - b > 15;
}

// ========== LẮNG NGHE SETTINGS ==========

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    settings = { ...settings, ...changes.settings.newValue };
  }
});

// ========== HELPER ==========

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

// ========== CLEANUP KHI ĐÓNG CỬA SỔ ==========

window.addEventListener('beforeunload', () => {
  isRunning = false;
  if (detectionInterval) clearInterval(detectionInterval);
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
  }
  chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: 0 });
});

// Khởi chạy
init();
