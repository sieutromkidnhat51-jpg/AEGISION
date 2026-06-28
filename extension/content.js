// IrisAdapt Pro - Content Script v2
// Áp dụng blur bằng cách filter trực tiếp lên <html> element (cách mạnh nhất)

(function() {
  'use strict';

  let currentBlur = 0;
  let styleEl = null;

  function ensureStyleEl() {
    if (styleEl && document.head && document.head.contains(styleEl)) return;
    styleEl = document.createElement('style');
    styleEl.id = 'irisadapt-style';
    // Thử chèn vào head, nếu không có thì chèn vào documentElement
    if (document.head) {
      document.head.appendChild(styleEl);
    } else if (document.documentElement) {
      document.documentElement.appendChild(styleEl);
    }
  }

  function applyBlur(level) {
    currentBlur = Math.max(0, level);
    ensureStyleEl();

    if (!styleEl) return;

    if (currentBlur <= 0) {
      styleEl.textContent = '';
    } else {
      // Áp dụng filter trực tiếp lên html element - cách mạnh nhất, hoạt động trên mọi trang
      styleEl.textContent = `
        html {
          filter: blur(${currentBlur}px) !important;
          transition: filter 0.4s ease !important;
        }
      `;
    }
  }

  // Lắng nghe lệnh từ background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SET_BLUR') {
      applyBlur(message.level);
    }
  });

  // Khi trang vừa load, đồng bộ trạng thái từ storage
  function syncFromStorage() {
    chrome.storage.local.get(['currentBlur', 'isTracking'], (result) => {
      if (result.isTracking && result.currentBlur > 0) {
        applyBlur(result.currentBlur);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncFromStorage);
  } else {
    syncFromStorage();
  }
})();
