// Windows app: opens the built ShopTrack client in its own window.
// The page is served from a private app:// address (not file://), so normal links and saved offline data work as in a browser.
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const DIST = path.join(__dirname, 'dist');

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 820, minWidth: 420, minHeight: 600, autoHideMenuBar: true, title: 'ShopTrack', webPreferences: { contextIsolation: true, sandbox: true } });
  win.loadURL('app://shop/index.html');
  // links to other websites (maps, WhatsApp...) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    let file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    // single page app: unknown paths (like /orders/5) open index.html
    const fs = require('fs');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
