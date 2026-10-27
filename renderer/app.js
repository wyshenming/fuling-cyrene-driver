'use strict';

const elements = {
  button: document.getElementById('refresh-button'),
  dot: document.getElementById('status-dot'),
  orb: document.getElementById('device-orb'),
  title: document.getElementById('status-title'),
  message: document.getElementById('status-message'),
  battery: document.getElementById('battery'),
  batteryFill: document.getElementById('battery-fill'),
  connection: document.getElementById('connection'),
  identity: document.getElementById('identity'),
  recognized: document.getElementById('recognized'),
  receiverState: document.getElementById('receiver-state'),
  hardware: document.getElementById('hardware-profile'),
  protocol: document.getElementById('protocol'),
  readLighting: document.getElementById('read-lighting'),
  restoreLighting: document.getElementById('restore-lighting'),
  lightingStatus: document.getElementById('lighting-status'),
  mainPanel: document.getElementById('main-light-panel'),
  sidePanel: document.getElementById('side-light-panel'),
  applyMain: document.getElementById('apply-main'),
  applySide: document.getElementById('apply-side'),
  readKeymap: document.getElementById('read-keymap'),
  restoreKeymap: document.getElementById('restore-keymap'),
  keymapEditor: document.getElementById('keymap-editor'),
  keymapLayer: document.getElementById('keymap-layer'),
  keymapSource: document.getElementById('keymap-source'),
  keymapTarget: document.getElementById('keymap-target'),
  applyKeymap: document.getElementById('apply-keymap'),
  keymapStatus: document.getElementById('keymap-status'),
  currentBinding: document.getElementById('current-binding')
};

let keymapData = null;

const hidNames = {
  40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space',
  45: '-', 46: '=', 47: '[', 48: ']', 49: '\\', 51: ';', 52: "'", 53: '`',
  54: ',', 55: '.', 56: '/', 57: 'Caps Lock', 70: 'Print Screen',
  71: 'Scroll Lock', 72: 'Pause', 73: 'Insert', 74: 'Home', 75: 'Page Up',
  76: 'Delete', 77: 'End', 78: 'Page Down', 79: '→', 80: '←', 81: '↓', 82: '↑',
  83: 'Num Lock', 84: 'Num /', 85: 'Num *', 86: 'Num -', 87: 'Num +',
  88: 'Num Enter', 89: 'Num 1', 90: 'Num 2', 91: 'Num 3', 92: 'Num 4',
  93: 'Num 5', 94: 'Num 6', 95: 'Num 7', 96: 'Num 8', 97: 'Num 9',
  98: 'Num 0', 99: 'Num .', 100: 'Intl \\', 101: 'Menu',
  224: '左 Ctrl', 225: '左 Shift', 226: '左 Alt', 227: '左 Win',
  228: '右 Ctrl', 229: '右 Shift', 230: '右 Alt', 231: '右 Win'
};
for (let hid = 4; hid <= 29; hid += 1) hidNames[hid] = String.fromCharCode(65 + hid - 4);
for (let hid = 30; hid <= 38; hid += 1) hidNames[hid] = String(hid - 29);
hidNames[39] = '0';
for (let hid = 58; hid <= 69; hid += 1) hidNames[hid] = `F${hid - 57}`;

const consumerNames = { 0x00e2: '静音', 0x00e9: '音量 +', 0x00ea: '音量 -', 0x0192: '计算器' };

function matrixName(value) {
  const [a, b, c, d] = value;
  if (a === 0 && b === 0 && d === 0 && hidNames[c]) return hidNames[c];
  if (a === 0 && b === 3) return consumerNames[c | (d << 8)] || `媒体键 0x${(c | (d << 8)).toString(16).toUpperCase()}`;
  if (a === 0 && b === 10) return 'Fn / 自定义功能键';
  if (value.every((item) => item === 0)) return '禁用';
  return `特殊键 [${value.join(', ')}]`;
}

function setKeymapStatus(message, kind = '') {
  elements.keymapStatus.textContent = message;
  elements.keymapStatus.className = `operation-status ${kind}`;
}

function fillTargetKeys() {
  const ids = [
    ...Array.from({ length: 26 }, (_, index) => index + 4),
    ...Array.from({ length: 10 }, (_, index) => index + 30),
    ...Array.from({ length: 62 }, (_, index) => index + 40),
    ...Array.from({ length: 8 }, (_, index) => index + 224)
  ];
  ids.filter((hid) => hidNames[hid]).forEach((hid) => {
    const option = document.createElement('option');
    option.value = hid;
    option.textContent = hidNames[hid];
    elements.keymapTarget.append(option);
  });
}

fillTargetKeys();

function renderCurrentBinding() {
  if (!keymapData) return;
  const layer = Number(elements.keymapLayer.value);
  const physicalIndex = Number(elements.keymapSource.value);
  const value = keymapData.layers[layer].slice(physicalIndex * 4, physicalIndex * 4 + 4);
  elements.currentBinding.textContent = `${matrixName(value)}  ·  矩阵 [${value.join(', ')}]`;
  if (value[0] === 0 && value[1] === 0 && value[3] === 0 && hidNames[value[2]]) {
    elements.keymapTarget.value = String(value[2]);
  }
}

function renderKeymap(data) {
  keymapData = data;
  elements.keymapSource.replaceChildren();
  for (let index = 0; index < data.defaultMatrix.length; index += 4) {
    const value = data.defaultMatrix.slice(index, index + 4);
    if (!value.some(Boolean)) continue;
    const option = document.createElement('option');
    option.value = index / 4;
    option.textContent = `${matrixName(value)} · 槽位 ${index / 4 + 1}`;
    elements.keymapSource.append(option);
  }
  elements.keymapEditor.disabled = false;
  elements.restoreKeymap.disabled = false;
  renderCurrentBinding();
}

async function readKeymap() {
  elements.readKeymap.disabled = true;
  setKeymapStatus('正在读取并备份三层键位，请保持键盘唤醒…');
  try {
    renderKeymap(await window.keyboardDriver.getKeymap());
    setKeymapStatus('三层 108 键读取完成，启动时键位备份已保存。', 'ok');
  } catch (error) {
    setKeymapStatus(error?.message || String(error), 'error');
  } finally {
    elements.readKeymap.disabled = false;
  }
}

async function applyKeymap() {
  elements.applyKeymap.disabled = true;
  const layer = Number(elements.keymapLayer.value);
  const physicalIndex = Number(elements.keymapSource.value);
  const targetHid = Number(elements.keymapTarget.value);
  setKeymapStatus('正在写入单键映射并回读整层校验…');
  try {
    const result = await window.keyboardDriver.applyKeymap(layer, physicalIndex, targetHid);
    keymapData.layers[layer] = result.layerData;
    renderCurrentBinding();
    elements.restoreKeymap.disabled = false;
    setKeymapStatus(`第 ${layer + 1} 层：已将该物理键映射为 ${hidNames[targetHid]}，回读校验通过。`, 'ok');
  } catch (error) {
    setKeymapStatus(error?.message || String(error), 'error');
  } finally {
    elements.applyKeymap.disabled = false;
  }
}

async function restoreKeymap() {
  elements.restoreKeymap.disabled = true;
  setKeymapStatus('正在按启动备份逐键恢复本次修改…');
  try {
    renderKeymap(await window.keyboardDriver.restoreKeymap());
    setKeymapStatus('本次启动中修改过的键位已全部恢复并通过回读校验。', 'ok');
  } catch (error) {
    setKeymapStatus(error?.message || String(error), 'error');
  } finally {
    elements.restoreKeymap.disabled = false;
  }
}

const effectLabels = {
  LightOff: '关闭', LightAlwaysOn: '常亮', LightBreath: '呼吸', LightNeon: '霓虹',
  LightWave: '波浪', LightRipple: '涟漪', LightRaindrop: '雨滴', LightSnake: '贪吃蛇',
  LightPressAction: '按键触发', LightConverage: '聚合', LightSineWave: '正弦波',
  LightKaleidoscope: '万花筒', LightLineWave: '线性波', LightLaser: '激光',
  LightCircleWave: '环形波', LightDazzing: '炫彩', LightRainDown: '落雨',
  LightMeteor: '流星', LightPressActionOff: '按下熄灭', LightMusicFollow3: '音乐律动 3',
  LightMusicFollow2: '音乐律动 2', LightTrain: '列车', LightFireWorks: '烟花',
  LightFlowers: '繁花'
};

const mainEffects = [
  'LightOff', 'LightAlwaysOn', 'LightBreath', 'LightNeon', 'LightWave', 'LightRipple',
  'LightRaindrop', 'LightSnake', 'LightPressAction', 'LightConverage', 'LightSineWave',
  'LightKaleidoscope', 'LightLineWave', 'LightLaser', 'LightCircleWave', 'LightDazzing',
  'LightRainDown', 'LightMeteor', 'LightPressActionOff', 'LightMusicFollow3',
  'LightMusicFollow2', 'LightTrain', 'LightFireWorks'
];
const sideEffects = ['LightOff', 'LightAlwaysOn', 'LightBreath', 'LightNeon', 'LightWave', 'LightSnake', 'LightMusicFollow2', 'LightRaindrop', 'LightFlowers'];

function fillSelect(id, effects) {
  const select = document.getElementById(id);
  effects.forEach((effect) => {
    const option = document.createElement('option');
    option.value = effect;
    option.textContent = effectLabels[effect] || effect;
    select.append(option);
  });
}

fillSelect('main-effect', mainEffects);
fillSelect('side-effect', sideEffects);

function setLightingStatus(message, kind = '') {
  elements.lightingStatus.textContent = message;
  elements.lightingStatus.className = `operation-status ${kind}`;
}

function renderChannel(channel, value) {
  document.getElementById(`${channel}-effect`).value = value.type;
  document.getElementById(`${channel}-color`).value = value.rgbHex;
  document.getElementById(`${channel}-bright`).value = value.bright;
  document.getElementById(`${channel}-bright-value`).value = value.bright;
  document.getElementById(`${channel}-speed`).value = value.speed;
  document.getElementById(`${channel}-speed-value`).value = value.speed;
  document.getElementById(`${channel}-dazzle`).checked = value.dazzle;
}

function collectChannel(channel) {
  const color = document.getElementById(`${channel}-color`).value;
  return {
    type: document.getElementById(`${channel}-effect`).value,
    option: 0,
    bright: Number(document.getElementById(`${channel}-bright`).value),
    speed: Number(document.getElementById(`${channel}-speed`).value),
    rgb: Number.parseInt(color.slice(1), 16),
    dazzle: document.getElementById(`${channel}-dazzle`).checked
  };
}

async function readLighting() {
  elements.readLighting.disabled = true;
  setLightingStatus('正在读取并备份当前灯效…');
  try {
    const lighting = await window.keyboardDriver.getLighting();
    renderChannel('main', lighting.main);
    renderChannel('side', lighting.side);
    elements.mainPanel.disabled = false;
    elements.sidePanel.disabled = false;
    elements.restoreLighting.disabled = false;
    setLightingStatus(`读取成功：主灯「${effectLabels[lighting.main.type] || lighting.main.type}」，侧灯「${effectLabels[lighting.side.type] || lighting.side.type}」。已建立恢复备份。`, 'ok');
  } catch (error) {
    setLightingStatus(error?.message || String(error), 'error');
  } finally {
    elements.readLighting.disabled = false;
  }
}

async function applyChannel(channel) {
  const button = channel === 'main' ? elements.applyMain : elements.applySide;
  button.disabled = true;
  setLightingStatus(`正在写入${channel === 'main' ? '主灯' : '侧灯'}并回读校验…`);
  try {
    const verified = await window.keyboardDriver.applyLighting(channel, collectChannel(channel));
    renderChannel(channel, verified);
    elements.restoreLighting.disabled = false;
    setLightingStatus(`${channel === 'main' ? '主灯' : '侧灯'}已应用并通过回读校验。`, 'ok');
  } catch (error) {
    setLightingStatus(error?.message || String(error), 'error');
  } finally {
    button.disabled = false;
  }
}

async function restoreLighting() {
  elements.restoreLighting.disabled = true;
  setLightingStatus('正在恢复本次启动时备份的主灯与侧灯…');
  try {
    const lighting = await window.keyboardDriver.restoreLighting();
    renderChannel('main', lighting.main);
    renderChannel('side', lighting.side);
    setLightingStatus('已恢复启动时灯效，并完成回读校验。', 'ok');
  } catch (error) {
    setLightingStatus(error?.message || String(error), 'error');
  } finally {
    elements.restoreLighting.disabled = false;
  }
}

function render(data) {
  const online = Boolean(data.online);
  elements.dot.classList.toggle('online', online);
  elements.orb.classList.toggle('online', online);
  elements.title.textContent = online ? '昔涟键盘已连接' : '键盘未在线';
  elements.message.textContent = data.message || '未能读取设备状态';
  elements.battery.textContent = Number.isFinite(data.battery) ? `${data.battery}%` : '--%';
  elements.batteryFill.style.width = Number.isFinite(data.battery) ? `${Math.max(0, Math.min(100, data.battery))}%` : '0%';
  elements.connection.textContent = data.connection || '--';
  elements.identity.textContent = data.identityHex || '--------';
  elements.recognized.textContent = data.recognized ? '已匹配内部设备 ID 4112' : (online ? '型号尚未匹配' : '等待键盘唤醒');
  elements.receiverState.textContent = data.receiverPresent ? '接收器已连接' : '未检测到接收器';
  elements.hardware.textContent = data.hardwareProfile || '等待识别';
  elements.protocol.textContent = data.protocol || '等待识别';
}

async function refresh() {
  elements.button.disabled = true;
  elements.button.textContent = '检测中…';
  try {
    render(await window.keyboardDriver.inspect());
  } catch (error) {
    render({ message: error?.message || String(error) });
  } finally {
    elements.button.disabled = false;
    elements.button.textContent = '重新检测';
  }
}

elements.button.addEventListener('click', refresh);
elements.readLighting.addEventListener('click', readLighting);
elements.restoreLighting.addEventListener('click', restoreLighting);
elements.applyMain.addEventListener('click', () => applyChannel('main'));
elements.applySide.addEventListener('click', () => applyChannel('side'));
elements.readKeymap.addEventListener('click', readKeymap);
elements.applyKeymap.addEventListener('click', applyKeymap);
elements.restoreKeymap.addEventListener('click', restoreKeymap);
elements.keymapLayer.addEventListener('change', renderCurrentBinding);
elements.keymapSource.addEventListener('change', renderCurrentBinding);
for (const channel of ['main', 'side']) {
  for (const property of ['bright', 'speed']) {
    const input = document.getElementById(`${channel}-${property}`);
    input.addEventListener('input', () => {
      document.getElementById(`${channel}-${property}-value`).value = input.value;
    });
  }
}
refresh();
setInterval(refresh, 15000);

