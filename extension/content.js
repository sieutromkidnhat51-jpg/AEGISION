// IrisAdapt Pro - Content Script
// Áp dụng hiệu ứng blur lên tất cả trang web

let currentBlur = 0;

function applyBlur(level) {
  currentBlur = level;
  if (level <= 0) {
    document.documentElement.style.removeProperty('filter');
    document.documentElement.style.removeProperty('transition');
  } else {
    document.documentElement.style.filter = `blur(${level}px)`;
    document.documentElement.style.transition = 'filter 0.3s ease';
  }
}

// Lắng nghe lệnh blur từ background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_BLUR') {
    applyBlur(message.level);
  }
});

// Khi trang load, kiểm tra trạng thái tracking và áp dụng blur hiện tại
chrome.storage.local.get(['currentBlur', 'isTracking'], (result) => {
  if (result.isTracking && result.currentBlur > 0) {
    // Đợi DOM sẵn sàng
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => applyBlur(result.currentBlur));
    } else {
      applyBlur(result.currentBlur);
    }
  }
});
