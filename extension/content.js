// IrisAdapt Pro - Content Script
// Áp dụng hiệu ứng blur lên tất cả trang web bằng overlay (an toàn hơn cho layout web)

let currentBlur = 0;
let overlay = null;

function createOverlay() {
  if (document.getElementById('irisadapt-blur-overlay')) return true;
  if (!document.body) return false; // Chưa có body thì chờ
  
  overlay = document.createElement('div');
  overlay.id = 'irisadapt-blur-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.pointerEvents = 'none'; // Để click xuyên qua
  overlay.style.zIndex = '2147483647'; // Cao nhất có thể
  overlay.style.transition = 'backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease';
  overlay.style.backdropFilter = 'blur(0px)';
  overlay.style.webkitBackdropFilter = 'blur(0px)';
  
  document.body.appendChild(overlay);
  return true;
}

function applyBlur(level) {
  currentBlur = level;
  
  if (!overlay) {
    const created = createOverlay();
    if (!created) {
      // Nếu body chưa sẵn sàng, đợi khi DOM load xong sẽ áp dụng
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => applyBlur(level), { once: true });
      }
      return;
    }
  }
  
  if (level <= 0) {
    overlay.style.backdropFilter = 'blur(0px)';
    overlay.style.webkitBackdropFilter = 'blur(0px)';
  } else {
    overlay.style.backdropFilter = `blur(${level}px)`;
    overlay.style.webkitBackdropFilter = `blur(${level}px)`;
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
