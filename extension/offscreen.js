// IrisAdapt Pro - Offscreen Document
// Xử lý webcam và phát hiện khuôn mặt để đo khoảng cách

let isDetecting = false;
let videoStream = null;
let videoElement = null;
let faceDetector = null;
let detectionTimer = null;

// Cài đặt
let settings = {
  maxBlur: 15,
  sensitivity: 50,
  notificationsEnabled: true,
  notificationCooldown: 30
};

// Tracking thông báo
let lastTooCloseNotify = 0;

// Tính ngưỡng từ sensitivity
function getThresholds() {
  const s = settings.sensitivity / 100;
  return {
    // sensitivity cao = nhạy hơn (ngưỡng thấp hơn)
    safeRatio: 0.10 + (1 - s) * 0.10,    // 0.10 (nhạy nhất) đến 0.20 (ít nhạy)
    dangerRatio: 0.25 + (1 - s) * 0.15   // 0.25 (nhạy nhất) đến 0.40 (ít nhạy)
  };
}

async function startDetection() {
  if (isDetecting) return;

  try {
    // Kiểm tra FaceDetector API
    if (!('FaceDetector' in window)) {
      chrome.runtime.sendMessage({
        type: 'DETECTION_ERROR',
        error: 'FaceDetector API không khả dụng. Vui lòng cập nhật Chrome.'
      });
      return;
    }

    faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });

    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' }
    });

    videoElement = document.getElementById('video');
    videoElement.srcObject = videoStream;
    await videoElement.play();

    isDetecting = true;
    scheduleDetection();

  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'DETECTION_ERROR',
      error: err.message
    });
  }
}

function scheduleDetection() {
  if (!isDetecting) return;
  detectionTimer = setTimeout(async () => {
    await detectFace();
    scheduleDetection();
  }, 250); // ~4 fps - đủ cho phát hiện khoảng cách
}

async function detectFace() {
  if (!isDetecting || !videoElement || !faceDetector) return;

  try {
    const faces = await faceDetector.detect(videoElement);

    if (faces.length > 0) {
      const face = faces[0];
      const faceWidthRatio = face.boundingBox.width / videoElement.videoWidth;

      const { safeRatio, dangerRatio } = getThresholds();

      let blurLevel = 0;
      if (faceWidthRatio <= safeRatio) {
        blurLevel = 0;
      } else if (faceWidthRatio >= dangerRatio) {
        blurLevel = settings.maxBlur;
      } else {
        // Tuyến tính từ 0 đến maxBlur
        const ratio = (faceWidthRatio - safeRatio) / (dangerRatio - safeRatio);
        blurLevel = ratio * settings.maxBlur;
      }

      chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: blurLevel });

      // Gửi thông báo khi quá gần
      const now = Date.now();
      const cooldown = (settings.notificationCooldown || 30) * 1000;
      if (blurLevel >= settings.maxBlur * 0.6 && now - lastTooCloseNotify > cooldown) {
        lastTooCloseNotify = now;
        chrome.runtime.sendMessage({ type: 'NOTIFY_TOO_CLOSE' });
      }

    } else {
      // Không phát hiện khuôn mặt -> bỏ blur
      chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: 0 });
    }

  } catch (err) {
    // Lỗi detection, bỏ qua frame này
  }
}

function stopDetection() {
  isDetecting = false;
  if (detectionTimer) {
    clearTimeout(detectionTimer);
    detectionTimer = null;
  }
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
  chrome.runtime.sendMessage({ type: 'BLUR_UPDATE', level: 0 });
}

// Lắng nghe tin nhắn từ background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BEGIN_DETECTION') {
    if (message.settings) {
      settings = { ...settings, ...message.settings };
    }
    startDetection();
  } else if (message.type === 'STOP_DETECTION') {
    stopDetection();
  } else if (message.type === 'UPDATE_SETTINGS') {
    if (message.settings) {
      settings = { ...settings, ...message.settings };
    }
  }
});
