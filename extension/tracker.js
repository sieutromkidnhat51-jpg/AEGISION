// IrisAdapt Pro - Tracker Window v2
// Face detection dùng thuật toán nhận diện da mặt cải tiến (YCrCb) hoạt động ở mọi ánh sáng

const video = document.getElementById('video');
const faceStatus = document.getElementById('faceStatus');
const blurDisplay = document.getElementById('blurDisplay');
const dotIndicator = document.getElementById('dotIndicator');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');

let isRunning = false;
let faceDetector = null;
let detectionInterval = null;

// Settings mặc định
let settings = {
  maxBlur: 15,
  sensitivity: 50,
  notificationsEnabled: true,
  notificationCooldown: 30
};

let lastTooCloseNotify = 0;
let lostFaceFrames = 0;
let lastBlurLevel = 0;

// --- 2 ngưỡng khoảng cách ---
// warnCutoff (~40cm): cảnh báo "ngồi hơi gần" nhưng chưa mờ
// blurCutoff (~30cm): màn hình mờ ngay lập tức
function getThresholds() {
  const s = settings.sensitivity / 100;
  return {
    warnCutoff: 0.11 + (s * 0.06),   // 50% -> ~0.14 (~40cm)
    blurCutoff: 0.15 + (s * 0.08)    // 50% -> ~0.19 (~30cm)
  };
}

// ========== KHỞI TẠO ==========

async function init() {
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) settings = { ...settings, ...result.settings };
    updateDebugThresholds();
  });

  // Thử FaceDetector API (Chrome 74+ với flag)
  if ('FaceDetector' in window) {
    try {
      faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      document.getElementById('dbgMode').textContent = 'FaceDetector API';
    } catch (e) {
      faceDetector = null;
      document.getElementById('dbgMode').textContent = 'Skin Detection (YCrCb)';
    }
  } else {
    document.getElementById('dbgMode').textContent = 'Skin Detection (YCrCb)';
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user', frameRate: { ideal: 10 } }
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

// ========== CANVAS CHO FALLBACK ==========

const canvas = document.createElement('canvas');
canvas.width = 160; // Giảm xuống để tăng tốc độ
canvas.height = 120;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// ========== FACE DETECTION LOOP ==========

function startDetection() {
  if (!isRunning) return;

  detectionInterval = setInterval(async () => {
    if (!isRunning || video.readyState < 2) return;

    try {
      let eyeRatio = 0;
      let faceFound = false;

      if (faceDetector) {
        // --- Dùng FaceDetector API ---
        const faces = await faceDetector.detect(video);
        if (faces.length > 0) {
          faceFound = true;
          const face = faces[0];

          // Thử lấy landmarks mắt
          if (face.landmarks) {
            const eyes = face.landmarks.filter(l => l.type === 'eye');
            if (eyes.length >= 2) {
              const dx = eyes[0].locations[0].x - eyes[1].locations[0].x;
              const dy = eyes[0].locations[0].y - eyes[1].locations[0].y;
              eyeRatio = Math.sqrt(dx * dx + dy * dy) / video.videoWidth;
            }
          }
          // Fallback: 45% face width
          if (eyeRatio === 0) {
            eyeRatio = (face.boundingBox.width * 0.45) / video.videoWidth;
          }
        }
      } else {
        // --- Dùng YCrCb Skin Detection ---
        eyeRatio = detectFaceYCrCb();
        faceFound = eyeRatio > 0;
      }

      // --- Tính blur dựa trên 2 ngưỡng ---
      let blurLevel = 0;
      let zone = 'safe'; // 'safe' | 'warn' | 'blur'
      const { warnCutoff, blurCutoff } = getThresholds();

      if (faceFound && eyeRatio > 0) {
        if (eyeRatio >= blurCutoff) {
          blurLevel = settings.maxBlur; // < 30cm -> mờ tối đa
          zone = 'blur';
        } else if (eyeRatio >= warnCutoff) {
          blurLevel = 0; // 30-40cm -> chỉ cảnh báo, chưa mờ
          zone = 'warn';
        } else {
          blurLevel = 0; // > 40cm -> an toàn
          zone = 'safe';
        }
      }

      // --- Giữ blur 5 frame nếu mất mặt tạm thời ---
      if (faceFound) {
        lostFaceFrames = 0;
        lastBlurLevel = blurLevel;
      } else {
        lostFaceFrames++;
        if (lostFaceFrames < 5) {
          blurLevel = lastBlurLevel;
          faceFound = true;
        } else {
          blurLevel = 0;
          lastBlurLevel = 0;
          eyeRatio = 0;
        }
      }

      // --- Cập nhật UI ---
      faceStatus.textContent = faceFound ? 'Khuôn mặt: Đã phát hiện' : 'Không phát hiện khuôn mặt';
      dotIndicator.className = (faceFound && blurLevel > 0) ? 'dot warning' : 'dot';
      blurDisplay.textContent = `Blur: ${blurLevel.toFixed(0)}px`;
      blurDisplay.className = blurLevel > 0 ? 'blur-display danger' : 'blur-display';

      // --- Cập nhật debug ---
      const th = getThresholds();
      document.getElementById('dbgEyeRatio').textContent = eyeRatio > 0 ? eyeRatio.toFixed(3) : '---';
      document.getElementById('dbgSafe').textContent = `warn>${th.warnCutoff.toFixed(3)} | blur>${th.blurCutoff.toFixed(3)}`;
      document.getElementById('dbgDanger').textContent =
        zone === 'blur' ? '🔴 QUÁ GẦN (<30cm) - MỜ' :
        zone === 'warn' ? '🟡 HƠI GẦN (30-40cm)' :
        '🟢 AN TOÀN (>40cm)';

      // --- Gửi blur đến tất cả tab ---
      chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: blurLevel });

      // --- Thông báo theo từng vùng ---
      const now = Date.now();
      const cooldown = (settings.notificationCooldown || 30) * 1000;
      if (zone === 'blur' && now - lastTooCloseNotify > cooldown) {
        lastTooCloseNotify = now;
        chrome.runtime.sendMessage({ type: 'NOTIFY_TOO_CLOSE', zone: 'blur' });
      } else if (zone === 'warn' && now - lastTooCloseNotify > cooldown) {
        lastTooCloseNotify = now;
        chrome.runtime.sendMessage({ type: 'NOTIFY_TOO_CLOSE', zone: 'warn' });
      }

    } catch (err) {
      // Bỏ qua lỗi detection frame
    }
  }, 200); // 5 fps
}

// ========== YCrCb SKIN DETECTION ==========
// Thuật toán phân loại màu da trong không gian YCrCb
// Hoạt động tốt hơn RGB ở nhiều điều kiện ánh sáng khác nhau

function detectFaceYCrCb() {
  // Scale nhỏ để tăng tốc
  ctx.drawImage(video, 0, 0, 160, 120);
  const imageData = ctx.getImageData(0, 0, 160, 120);
  const data = imageData.data;

  let skinPixels = 0;
  let minX = 160, maxX = 0;

  for (let y = 0; y < 120; y += 2) {
    for (let x = 0; x < 160; x += 2) {
      const i = (y * 160 + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];

      if (isSkinYCrCb(r, g, b)) {
        skinPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }

  const totalSampled = (160 * 120) / 4;
  const skinRatio = skinPixels / totalSampled;

  // Phải có đủ pixel da để coi là có khuôn mặt
  if (skinRatio < 0.03) return 0;

  // Tính chiều rộng vùng mặt
  const faceWidth = maxX - minX;
  const faceWidthRatio = faceWidth / 160;

  // Trả về eye ratio giả lập (45% of face width)
  return faceWidthRatio * 0.45;
}

// Nhận diện màu da dùng YCrCb - hoạt động tốt ở nhiều ánh sáng
// Tham khảo: Peer & Kovac (2003) - phổ biến trong computer vision
function isSkinYCrCb(r, g, b) {
  // Chuyển RGB -> YCrCb
  const Y  =  0.299 * r + 0.587 * g + 0.114 * b;
  const Cr = (r - Y) * 0.713 + 128;
  const Cb = (b - Y) * 0.564 + 128;

  // Ngưỡng da người trong không gian YCrCb (đã được kiểm chứng khoa học)
  return (
    Y  > 80  &&
    Cr > 133 && Cr < 173 &&
    Cb > 77  && Cb < 127
  );
}

// ========== HELPER ==========

function updateDebugThresholds() {
  const th = getThresholds();
  document.getElementById('dbgSafe').textContent = `warn>${th.warnCutoff.toFixed(3)} | blur>${th.blurCutoff.toFixed(3)}`;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

// ========== LẮNG NGHE SETTINGS ==========

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    settings = { ...settings, ...changes.settings.newValue };
    updateDebugThresholds();
  }
});

// ========== CLEANUP ==========

window.addEventListener('beforeunload', () => {
  isRunning = false;
  if (detectionInterval) clearInterval(detectionInterval);
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: 0 });
});

// Bắt đầu
init();
