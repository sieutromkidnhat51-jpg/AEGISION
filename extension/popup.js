// IrisAdapt Pro - Popup Script
// Quản lý giao diện popup và tương tác với background

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const toggleBtn = document.getElementById('toggleBtn');
  const toggleIcon = document.getElementById('toggleIcon');
  const toggleText = document.getElementById('toggleText');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const blurLevelText = document.getElementById('blurLevel');
  const errorMsg = document.getElementById('errorMsg');

  // Settings Elements
  const maxBlurSlider = document.getElementById('maxBlur');
  const maxBlurValue = document.getElementById('maxBlurValue');
  const sensitivitySlider = document.getElementById('sensitivity');
  const sensitivityValue = document.getElementById('sensitivityValue');
  const notificationsToggle = document.getElementById('notifications');
  const cooldownSlider = document.getElementById('cooldown');
  const cooldownValue = document.getElementById('cooldownValue');

  let isTracking = false;

  // ========== LOAD TRẠNG THÁI HIỆN TẠI ==========
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    isTracking = response.isTracking;
    updateUI(isTracking);

    // Load settings
    const s = response.settings;
    if (s) {
      maxBlurSlider.value = s.maxBlur || 15;
      maxBlurValue.textContent = `${maxBlurSlider.value}px`;

      sensitivitySlider.value = s.sensitivity || 50;
      sensitivityValue.textContent = `${sensitivitySlider.value}%`;

      notificationsToggle.checked = s.notificationsEnabled !== false;

      cooldownSlider.value = s.notificationCooldown || 30;
      cooldownValue.textContent = `${cooldownSlider.value}s`;
    }

    if (response.currentBlur > 0) {
      blurLevelText.textContent = `Blur: ${response.currentBlur}px`;
    }
  });

  // ========== BẬT / TẮT TRACKING ==========
  toggleBtn.addEventListener('click', () => {
    if (isTracking) {
      chrome.runtime.sendMessage({ type: 'STOP_TRACKING' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.success) {
          isTracking = false;
          updateUI(false);
          hideError();
        }
      });
    } else {
      const settings = getSettings();
      chrome.runtime.sendMessage({ type: 'START_TRACKING', settings }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.success) {
          isTracking = true;
          updateUI(true);
          hideError();
        } else {
          showError(response?.error || 'Không thể khởi tạo camera');
        }
      });
    }
  });

  // ========== SETTINGS LISTENERS ==========
  maxBlurSlider.addEventListener('input', () => {
    maxBlurValue.textContent = `${maxBlurSlider.value}px`;
    saveSettings();
  });

  sensitivitySlider.addEventListener('input', () => {
    sensitivityValue.textContent = `${sensitivitySlider.value}%`;
    saveSettings();
  });

  notificationsToggle.addEventListener('change', saveSettings);

  cooldownSlider.addEventListener('input', () => {
    cooldownValue.textContent = `${cooldownSlider.value}s`;
    saveSettings();
  });

  // ========== CẬP NHẬT BLUR LEVEL LIÊN TỤC ==========
  setInterval(() => {
    chrome.storage.local.get(['currentBlur', 'isTracking'], (result) => {
      if (chrome.runtime.lastError) return;
      if (result.isTracking) {
        blurLevelText.textContent = `Blur: ${result.currentBlur || 0}px`;
      }
    });
  }, 1000);

  // ========== HELPER FUNCTIONS ==========
  function updateUI(active) {
    if (active) {
      toggleBtn.classList.add('active');
      toggleIcon.textContent = '⏹';
      toggleText.textContent = 'Dừng theo dõi';
      statusIndicator.classList.add('active');
      statusText.textContent = 'Đang hoạt động';
    } else {
      toggleBtn.classList.remove('active');
      toggleIcon.textContent = '▶';
      toggleText.textContent = 'Bắt đầu theo dõi';
      statusIndicator.classList.remove('active');
      statusText.textContent = 'Đang tắt';
      blurLevelText.textContent = 'Blur: 0px';
    }
  }

  function getSettings() {
    return {
      maxBlur: parseInt(maxBlurSlider.value),
      sensitivity: parseInt(sensitivitySlider.value),
      notificationsEnabled: notificationsToggle.checked,
      notificationCooldown: parseInt(cooldownSlider.value)
    };
  }

  function saveSettings() {
    chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: getSettings()
    });
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('show');
    setTimeout(() => hideError(), 5000);
  }

  function hideError() {
    errorMsg.classList.remove('show');
  }
});
