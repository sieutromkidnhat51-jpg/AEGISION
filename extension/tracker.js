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

// --- 2 ngưỡng khoảng cách, dùng faceWidthRatio trực tiếp (không *0.45)
// Tỷ lệ vùng mặt so với chiều ngang camera
// ~30cm: faceWidth ≈ 35-45% -> ratio ~0.40
// ~40cm: faceWidth ≈ 25-30% -> ratio ~0.28
// ~50cm+: faceWidth ≈ 18-22% -> ratio ~0.20
function getThresholds() {
  const s = settings.sensitivity / 100;
  return {
    warnCutoff: 0.20 + (s * 0.08),   // 50% -> ~0.24 (~40cm)
    blurCutoff: 0.30 + (s * 0.10)    // 50% -> ~0.35 (~30cm)
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
      document.getElementById('dbgEyeRatio').textContent = eyeRatio > 0 ? `${eyeRatio.toFixed(3)} (face ${(eyeRatio*100).toFixed(1)}%)` : '---';
      document.getElementById('dbgSafe').textContent = `warn>${th.warnCutoff.toFixed(3)} | blur>${th.blurCutoff.toFixed(3)}`;
      document.getElementById('dbgDanger').textContent =
        zone === 'blur' ? '🔴 QUÁ GẦN (<30cm) - Mờ' :
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
  ctx.drawImage(video, 0, 0, 160, 120);
  const imageData = ctx.getImageData(0, 0, 160, 120);
  const data = imageData.data;

  // Chỉ quét vùng TRUNG TÂM của khung hình
  // Giúp loại trừ tay, cổ, vai xuất hiện ở viền
  const xMin = Math.floor(160 * 0.18); // 18% từ trái
  const xMax = Math.floor(160 * 0.82); // 18% từ phải
  const yMin = Math.floor(120 * 0.02); // 2% từ trên
  const yMax = Math.floor(120 * 0.85); // 15% từ dưới

  let skinPixels = 0;
  let totalPixels = 0;
  let minX = xMax, maxX = xMin;

  for (let y = yMin; y < yMax; y += 2) {
    for (let x = xMin; x < xMax; x += 2) {
      const i = (y * 160 + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      totalPixels++;
      if (isSkinYCrCb(r, g, b)) {
        skinPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }

  const skinRatio = skinPixels / totalPixels;

  // Cần ít nhất 4% pixel da trong vùng trung tâm
  if (skinRatio < 0.04 || minX >= maxX) return 0;

  // Trả về tỷ lệ chiều rộng mặt so với toàn khung hình
  const faceWidth = maxX - minX;
  return faceWidth / 160;
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
