let deferredPrompt = null;
let installButton = null;

export function initPWA() {
  // Check if already installed
  if (window.matchMedia('(display-mode: standalone)').matches) {
    console.log('✅ App is running in standalone mode');
    return;
  }

  // Listen for beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });

  // Listen for app installed
  window.addEventListener('appinstalled', () => {
    console.log('✅ App installed');
    hideInstallBanner();
    deferredPrompt = null;
  });
}

function showInstallBanner() {
  // Create install banner
  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--primary, #0d2b45);
    color: white;
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 9999;
    box-shadow: 0 -4px 20px rgba(0,0,0,0.3);
    animation: slideUp 0.3s ease;
  `;
  banner.innerHTML = `
    <div>
      <strong>🚌 Install Tunis Bus Live</strong>
      <p style="margin:0;font-size:0.8rem;opacity:0.8;">Get real‑time bus tracking on your home screen</p>
    </div>
    <div style="display:flex;gap:10px;">
      <button id="installBtn" style="
        background: #f5a623;
        color: #0d2b45;
        border: none;
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: bold;
        cursor: pointer;
      ">Install</button>
      <button id="dismissBtn" style="
        background: transparent;
        color: white;
        border: 1px solid rgba(255,255,255,0.3);
        padding: 10px 16px;
        border-radius: 8px;
        cursor: pointer;
      ">×</button>
    </div>
  `;
  document.body.appendChild(banner);

  // Add styles for animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);

  document.getElementById('installBtn').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') {
        console.log('✅ User accepted install');
        hideInstallBanner();
      }
      deferredPrompt = null;
    }
  });

  document.getElementById('dismissBtn').addEventListener('click', hideInstallBanner);
}

function hideInstallBanner() {
  const banner = document.getElementById('installBanner');
  if (banner) banner.remove();
}

export function isOnline() {
  return navigator.onLine;
}

export function onOnline(callback) {
  window.addEventListener('online', callback);
}

export function onOffline(callback) {
  window.addEventListener('offline', callback);
}
