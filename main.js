'use strict';

const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const {
  inspectKeyboard,
  inspectLighting,
  writeLighting,
  inspectKeymap,
  remapStandardKey,
  writeKeyMatrixValue,
  inspectMacroState,
  writeTextMacro,
  writeMacroSlotRaw
} = require('./hid-service');

let mainWindow = null;
let originalLighting = null;
let originalKeymap = null;
const changedKeys = new Set();
let originalMacroState = null;
let macroBinding = null;
let hidQueue = Promise.resolve();

function withHidLock(operation) {
  const result = hidQueue.then(operation, operation);
  hidQueue = result.catch(() => {});
  return result;
}

async function backupLighting(lighting) {
  const directory = path.join(app.getPath('userData'), 'lighting-backups');
  await fs.mkdir(directory, { recursive: true });
  const capturedAt = new Date().toISOString();
  const backup = { deviceId: 4112, protocol: 'ry6602_fl_k2509_3m_1k_1k', capturedAt, ...lighting };
  const safeStamp = capturedAt.replaceAll(':', '-');
  await fs.writeFile(path.join(directory, `lighting-${safeStamp}.json`), JSON.stringify(backup, null, 2), 'utf8');
  await fs.writeFile(path.join(directory, 'latest.json'), JSON.stringify(backup, null, 2), 'utf8');
  return backup;
}

async function readAndRememberLighting() {
  const lighting = await inspectLighting();
  if (!originalLighting) originalLighting = await backupLighting(lighting);
  return lighting;
}

async function backupKeymap(keymap) {
  const directory = path.join(app.getPath('userData'), 'keymap-backups');
  await fs.mkdir(directory, { recursive: true });
  const capturedAt = new Date().toISOString();
  const backup = { deviceId: 4112, protocol: 'ry6602_fl_k2509_3m_1k_1k', capturedAt, ...keymap };
  const safeStamp = capturedAt.replaceAll(':', '-');
  await fs.writeFile(path.join(directory, `keymap-${safeStamp}.json`), JSON.stringify(backup, null, 2), 'utf8');
  await fs.writeFile(path.join(directory, 'latest.json'), JSON.stringify(backup, null, 2), 'utf8');
  return backup;
}

async function readAndRememberKeymap() {
  const keymap = await inspectKeymap();
  if (!originalKeymap) originalKeymap = await backupKeymap(keymap);
  return keymap;
}

async function backupMacroState(state) {
  const directory = path.join(app.getPath('userData'), 'macro-backups');
  await fs.mkdir(directory, { recursive: true });
  const capturedAt = new Date().toISOString();
  const backup = { deviceId: 4112, protocol: 'ry6602_fl_k2509_3m_1k_1k', capturedAt, ...state };
  const safeStamp = capturedAt.replaceAll(':', '-');
  await fs.writeFile(path.join(directory, `macro-${safeStamp}.json`), JSON.stringify(backup, null, 2), 'utf8');
  await fs.writeFile(path.join(directory, 'latest.json'), JSON.stringify(backup, null, 2), 'utf8');
  return backup;
}

async function readAndRememberMacroState() {
  const state = await inspectMacroState();
  if (!originalMacroState) originalMacroState = await backupMacroState(state);
  return state;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 640,
    title: '昔涟键盘控制台',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#090818',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.setMenu(Menu.buildFromTemplate([]));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('keyboard:inspect', async () => withHidLock(inspectKeyboard));
ipcMain.handle('lighting:get', async () => withHidLock(readAndRememberLighting));
ipcMain.handle('lighting:apply', async (_event, channel, setting) => withHidLock(async () => {
  if (!originalLighting) await readAndRememberLighting();
  return writeLighting(channel, setting);
}));
ipcMain.handle('lighting:restore', async () => withHidLock(async () => {
  if (!originalLighting) throw new Error('本次运行尚未建立灯效备份');
  const main = await writeLighting('main', originalLighting.main);
  const side = await writeLighting('side', originalLighting.side);
  return { main, side };
}));
ipcMain.handle('keymap:get', async () => withHidLock(readAndRememberKeymap));
ipcMain.handle('keymap:apply', async (_event, layer, physicalIndex, targetHid) => withHidLock(async () => {
  if (!originalKeymap) await readAndRememberKeymap();
  const result = await remapStandardKey(layer, physicalIndex, targetHid);
  changedKeys.add(`${layer}:${physicalIndex}`);
  return result;
}));
ipcMain.handle('keymap:restore', async () => withHidLock(async () => {
  if (!originalKeymap) throw new Error('本次运行尚未建立键位备份');
  for (const key of Array.from(changedKeys)) {
    const [layer, physicalIndex] = key.split(':').map(Number);
    const original = originalKeymap.layers[layer].slice(physicalIndex * 4, physicalIndex * 4 + 4);
    await writeKeyMatrixValue(layer, physicalIndex, original);
    changedKeys.delete(key);
  }
  return {
    layers: originalKeymap.layers,
    defaultMatrix: originalKeymap.defaultMatrix,
    keyCount: originalKeymap.keyCount
  };
}));
ipcMain.handle('macro:get', async () => withHidLock(readAndRememberMacroState));
ipcMain.handle('macro:apply', async (_event, options) => withHidLock(async () => {
  if (!originalMacroState) await readAndRememberMacroState();
  const { layer, physicalIndex, text, keyDelay, repeatCount, macroType } = options || {};
  if (!Number.isInteger(layer) || layer < 0 || layer > 2) throw new Error('宏配置层无效');
  if (!Number.isInteger(physicalIndex) || physicalIndex < 0 || physicalIndex >= 128) throw new Error('宏绑定键无效');
  if (!['repeat', 'hold'].includes(macroType)) throw new Error('宏播放模式无效');
  if (!Number.isInteger(keyDelay) || keyDelay < 10 || keyDelay > 1000) throw new Error('宏按键间隔无效');
  if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 20) throw new Error('宏循环次数必须为 1–20');
  const physicalKey = originalMacroState.defaultMatrix.slice(physicalIndex * 4, physicalIndex * 4 + 4);
  if (!(physicalKey[0] === 0 && physicalKey[1] === 0 && physicalKey[2] !== 0 && physicalKey[3] === 0)) {
    throw new Error('当前版本只允许把宏绑定到标准物理键');
  }
  if (macroBinding && (macroBinding.layer !== layer || macroBinding.physicalIndex !== physicalIndex)) {
    throw new Error('本次运行已绑定另一按键，请先点击“恢复本次宏”');
  }
  const liveKeymap = await inspectKeymap();
  const originalKey = liveKeymap.layers[layer].slice(physicalIndex * 4, physicalIndex * 4 + 4);
  if (!(originalKey[0] === 0 && originalKey[1] === 0 && originalKey[2] !== 0 && originalKey[3] === 0)) {
    throw new Error('目标键当前不是有效的标准按键，已拒绝写入，以免恢复成禁用键');
  }
  const slot = originalMacroState.freeSlot;
  const typeCode = macroType === 'hold' ? 2 : 0;
  const count = macroType === 'hold' ? 1 : repeatCount;
  const macro = await writeTextMacro(slot, text, keyDelay, count);
  try {
    const binding = await writeKeyMatrixValue(layer, physicalIndex, [9, typeCode, slot, 0]);
    macroBinding = { layer, physicalIndex, slot, originalKey };
    return { macro, binding, macroType };
  } catch (error) {
    await writeMacroSlotRaw(slot, originalMacroState.freeSlotData);
    throw error;
  }
}));
ipcMain.handle('macro:restore', async () => withHidLock(async () => {
  if (!originalMacroState) throw new Error('本次运行尚未建立宏备份');
  if (!macroBinding) return { restored: false };
  const { layer, physicalIndex, slot, originalKey } = macroBinding;
  const macro = await writeMacroSlotRaw(slot, originalMacroState.freeSlotData);
  const binding = await writeKeyMatrixValue(layer, physicalIndex, originalKey);
  const verifiedKeymap = await inspectKeymap();
  const verifiedKey = verifiedKeymap.layers[layer].slice(physicalIndex * 4, physicalIndex * 4 + 4);
  if (!Buffer.from(verifiedKey).equals(Buffer.from(originalKey))) {
    throw new Error('宏恢复后的独立键位回读不一致');
  }
  macroBinding = null;
  return { restored: true, binding, macro, verifiedKey };
}));

app.whenReady().then(createWindow);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

