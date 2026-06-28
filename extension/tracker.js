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

// Tính ngưỡng từ sensitivity cho KHOẢNG CÁCH 2 MẮT
// Khoảng cách 50-60cm -> Mắt cách nhau khoảng 9%-11% khung hình (0.09 - 0.11)
// Ngồi sát 25cm -> Mắt cách nhau khoảng 18%-22% khung hình (0.18 - 0.22)
function getThresholds() {
  const s = settings.sensitivity / 100; 
  return {
    safeRatio: 0.15 - (s * 0.08),    // Mặc định 50% -> 0.11 (50-60cm an toàn)
    dangerRatio: 0.25 - (s * 0.08)   // Mặc định 50% -> 0.21 (ngồi sát thì mờ max)
  };
}

// ========== KHỞI TẠO ==========

async function init() {
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      settings = { ...settings, ...result.settings };
    }
  });

  if ('FaceDetector' in window) {
    try {
      faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      statusEl.textContent = 'FaceDetector API sẵn sàng';
    } catch (e) {
      showError('Không thể khởi tạo FaceDetector: ' + e.message);
      faceDetector = null;
    }
  } else {
    statusEl.textContent = 'FaceDetector không khả dụng';
    faceDetector = null;
  }

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
      let eyeDistanceRatio = 0;

      if (faceDetector) {
        const faces = await faceDetector.detect(video);
        if (faces.length > 0) {
          faceFound = true;
          const face = faces[0];
          
          // Ưu tiên dùng toạ độ 2 mốc mắt (landmarks) nếu có
          if (face.landmarks && face.landmarks.length > 0) {
             const eyes = face.landmarks.filter(l => l.type === 'eye');
             if (eyes.length >= 2) {
                const dx = eyes[0].locations[0].x - eyes[1].locations[0].x;
                const dy = eyes[0].locations[0].y - eyes[1].locations[0].y;
                const eyeDist = Math.sqrt(dx*dx + dy*dy);
                eyeDistanceRatio = eyeDist / video.videoWidth; 
             }
          }
          
          // Nếu API không cung cấp landmarks trên Windows, dùng tỷ lệ giải phẫu học
          // Khoảng cách 2 mắt = 45% chiều rộng khuôn mặt
          if (eyeDistanceRatio === 0) {
             const faceWidth = face.boundingBox.width;
             eyeDistanceRatio = (faceWidth * 0.45) / video.videoWidth;
          }
          
          blurLevel = calculateBlur(eyeDistanceRatio);
        }
      } else {
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
          eyeDistanceRatio = 0;
        }
      }

      // Cập nhật giao diện (UI)
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
        
      // Cập nhật bảng Debug
      const th = getThresholds();
      document.getElementById('dbgMode').textContent = faceDetector ? 'FaceDetector API' : 'Fallback Skin Color';
      document.getElementById('dbgEyeRatio').textContent = eyeDistanceRatio > 0 ? eyeDistanceRatio.toFixed(3) : '---';
      document.getElementById('dbgSafe').textContent = th.safeRatio.toFixed(3);
      document.getElementById('dbgDanger').textContent = th.dangerRatio.toFixed(3);

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

  return calculateBlur(faceWidthRatio * 0.45); // Giải lập eye distance ratio
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
