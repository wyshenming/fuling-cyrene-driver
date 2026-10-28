'use strict';

const elements = {
  configTabs: Array.from(document.querySelectorAll('[data-config-target]')),
  configPanels: Array.from(document.querySelectorAll('.config-panel')),
  button: document.getElementById('refresh-button'),
  dot: document.getElementById('status-dot'),
  orb: document.getElementById('device-orb'),
  title: document.getElementById('status-title'),
  message: document.getElementById('status-message'),
  battery: document.getElementById('battery'),
  batteryMetric: document.getElementById('battery-metric'),
  batteryFill: document.getElementById('battery-fill'),
  chargingState: document.getElementById('charging-state'),
  chargingDetail: document.getElementById('charging-detail'),
  connection: document.getElementById('connection'),
  connectionDetail: document.getElementById('connection-detail'),
  identity: document.getElementById('identity'),
  recognized: document.getElementById('recognized'),
  transportLabel: document.getElementById('transport-label'),
  transportId: document.getElementById('transport-id'),
  transportState: document.getElementById('transport-state'),
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
  currentBinding: document.getElementById('current-binding'),
  readMacro: document.getElementById('read-macro'),
  restoreMacro: document.getElementById('restore-macro'),
  macroEditor: document.getElementById('macro-editor'),
  macroLayer: document.getElementById('macro-layer'),
  macroSource: document.getElementById('macro-source'),
  macroType: document.getElementById('macro-type'),
  macroRepeat: document.getElementById('macro-repeat'),
  macroDelay: document.getElementById('macro-delay'),
  macroText: document.getElementById('macro-text'),
  macroSlot: document.getElementById('macro-slot'),
  macroReferenceCount: document.getElementById('macro-reference-count'),
  applyMacro: document.getElementById('apply-macro'),
  macroStatus: document.getElementById('macro-status'),
  readSleep: document.getElementById('read-sleep'),
  restoreSleep: document.getElementById('restore-sleep'),
  sleepEditor: document.getElementById('sleep-editor'),
  sleep24: document.getElementById('sleep-24'),
  sleepBt: document.getElementById('sleep-bt'),
  sleepDeepBt: document.getElementById('sleep-deep-bt'),
  sleepDeep24: document.getElementById('sleep-deep-24'),
  applySleep: document.getElementById('apply-sleep'),
  sleepStatus: document.getElementById('sleep-status')
};

let keymapData = null;
let macroData = null;
let sleepData = null;

function activateConfigPanel(panelId) {
  elements.configPanels.forEach((panel) => {
    panel.hidden = panel.id !== panelId;
  });
  elements.configTabs.forEach((tab) => {
    const active = tab.dataset.configTarget === panelId;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
}

function setSleepStatus(message, kind = '') {
  elements.sleepStatus.textContent = message;
  elements.sleepStatus.className = `operation-status ${kind}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

function selectDuration(select, seconds) {
  const value = String(seconds);
  if (![...select.options].some((option) => option.value === value)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${formatDuration(seconds)}（当前值）`;
    select.append(option);
  }
  select.value = value;
}

function renderSleepTime(data) {
  sleepData = data;
  selectDuration(elements.sleep24, data.time24);
  selectDuration(elements.sleepBt, data.timeBt);
  selectDuration(elements.sleepDeepBt, data.deepTimeBt);
  elements.sleepDeep24.textContent = formatDuration(data.deepTime24);
  elements.sleepEditor.disabled = false;
  elements.restoreSleep.disabled = false;
}

async function readSleepTime() {
  elements.readSleep.disabled = true;
  setSleepStatus('正在读取并备份休眠时间…');
  try {
    const data = await window.keyboardDriver.getSleepTime();
    renderSleepTime(data);
    setSleepStatus(`读取成功：2.4G ${formatDuration(data.time24)}，蓝牙 ${formatDuration(data.timeBt)}，蓝牙深度休眠 ${formatDuration(data.deepTimeBt)}。已建立备份。`, 'ok');
  } catch (error) {
    setSleepStatus(error?.message || String(error), 'error');
  } finally {
    elements.readSleep.disabled = false;
  }
}

async function applySleepTime() {
  if (!sleepData) return;
  elements.applySleep.disabled = true;
  setSleepStatus('正在写入休眠时间并回读校验…');
  try {
    const data = await window.keyboardDriver.applySleepTime({
      time24: Number(elements.sleep24.value),
      timeBt: Number(elements.sleepBt.value),
      deepTimeBt: Number(elements.sleepDeepBt.value),
      deepTime24: sleepData.deepTime24
    });
    renderSleepTime(data);
    setSleepStatus('休眠时间已写入并通过回读校验。', 'ok');
  } catch (error) {
    setSleepStatus(error?.message || String(error), 'error');
  } finally {
    elements.applySleep.disabled = false;
  }
}

async function restoreSleepTime() {
  elements.restoreSleep.disabled = true;
  setSleepStatus('正在恢复本次启动时的休眠时间…');
  try {
    const data = await window.keyboardDriver.restoreSleepTime();
    renderSleepTime(data);
    setSleepStatus('已恢复启动时的休眠时间，并通过回读校验。', 'ok');
  } catch (error) {
    setSleepStatus(error?.message || String(error), 'error');
  } finally {
    elements.restoreSleep.disabled = false;
  }
}

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

function setMacroStatus(message, kind = '') {
  elements.macroStatus.textContent = message;
  elements.macroStatus.className = `operation-status ${kind}`;
}

function renderMacroState(data) {
  macroData = data;
  elements.macroSource.replaceChildren();
  for (let offset = 0; offset < data.defaultMatrix.length; offset += 4) {
    const value = data.defaultMatrix.slice(offset, offset + 4);
    if (!(value[0] === 0 && value[1] === 0 && value[2] !== 0 && value[3] === 0)) continue;
    const option = document.createElement('option');
    option.value = offset / 4;
    option.textContent = `${matrixName(value)} · 槽位 ${offset / 4 + 1}`;
    elements.macroSource.append(option);
  }
  elements.macroSlot.textContent = String(data.freeSlot);
  elements.macroReferenceCount.textContent = String(data.references.length);
  elements.macroEditor.disabled = false;
  elements.restoreMacro.disabled = false;
}

async function readMacroState() {
  elements.readMacro.disabled = true;
  setMacroStatus('正在扫描普通三层、Win/macOS Fn 层和可用宏槽，请保持键盘唤醒…');
  try {
    const state = await window.keyboardDriver.getMacroState();
    renderMacroState(state);
    const residue = state.freeSlotData.filter((value) => value !== 0).length;
    setMacroStatus(`扫描完成：已有 ${state.references.length} 个宏引用，可用槽 ${state.freeSlot}；槽内 ${residue} 个非零字节已原样备份。`, 'ok');
  } catch (error) {
    setMacroStatus(error?.message || String(error), 'error');
  } finally {
    elements.readMacro.disabled = false;
  }
}

async function applyMacro() {
  if (!macroData) return;
  const text = elements.macroText.value;
  if (!text) {
    setMacroStatus('请先输入宏文本。', 'error');
    return;
  }
  elements.applyMacro.disabled = true;
  setMacroStatus('正在写入宏内容、绑定物理键并分别回读校验…');
  try {
    const result = await window.keyboardDriver.applyMacro({
      layer: Number(elements.macroLayer.value),
      physicalIndex: Number(elements.macroSource.value),
      text,
      keyDelay: Number(elements.macroDelay.value),
      repeatCount: Number(elements.macroRepeat.value),
      macroType: elements.macroType.value
    });
    elements.restoreMacro.disabled = false;
    setMacroStatus(`宏已写入槽 ${result.macro.slot}：${result.macro.eventCount} 个动作、${result.macro.bytesUsed} 字节；键位绑定回读通过。`, 'ok');
  } catch (error) {
    setMacroStatus(error?.message || String(error), 'error');
  } finally {
    elements.applyMacro.disabled = false;
  }
}

async function restoreMacro() {
  elements.restoreMacro.disabled = true;
  setMacroStatus('正在解除本次宏绑定并恢复宏槽原始数据…');
  try {
    const result = await window.keyboardDriver.restoreMacro();
    setMacroStatus(result.restored ? '本次宏绑定和宏槽内容均已恢复，回读校验通过。' : '本次运行没有需要恢复的宏。', 'ok');
  } catch (error) {
    setMacroStatus(error?.message || String(error), 'error');
  } finally {
    elements.restoreMacro.disabled = false;
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
  const battery = Number.isFinite(data.battery) ? Math.max(0, Math.min(100, data.battery)) : null;
  const batteryLevel = battery == null ? null : (battery >= 60 ? 'high' : (battery > 20 ? 'medium' : 'low'));
  elements.dot.classList.toggle('online', online);
  elements.orb.classList.toggle('online', online);
  elements.title.textContent = online ? '昔涟键盘已连接' : '键盘未在线';
  elements.message.textContent = data.message || '未能读取设备状态';
  elements.battery.textContent = battery == null ? '--%' : `${battery}%`;
  elements.batteryFill.style.width = battery == null ? '0%' : `${battery}%`;
  elements.batteryMetric.classList.remove('battery-high', 'battery-medium', 'battery-low');
  if (batteryLevel) elements.batteryMetric.classList.add(`battery-${batteryLevel}`);
  elements.chargingState.textContent = data.chargingState || '未知';
  elements.chargingDetail.textContent = data.usbPowerPresent ? '已检测到键盘有线接口' : '未检测到有线充电连接';
  elements.chargingState.closest('.metric').classList.toggle('powered', Boolean(data.usbPowerPresent));
  elements.connection.textContent = data.connection || '--';
  elements.connectionDetail.textContent = data.connection === 'USB'
    ? '当前使用 USB 有线直连'
    : (data.connection === '2.4G' ? '当前使用 2.4G 接收器' : '等待选择传输链路');
  elements.identity.textContent = data.identityHex || '--------';
  elements.recognized.textContent = data.recognized ? '已匹配内部设备 ID 4112' : (online ? '型号尚未匹配' : '等待键盘唤醒');
  const wired = data.connection === 'USB';
  elements.transportLabel.textContent = wired ? '有线设备' : '接收器';
  elements.transportId.textContent = data.vid && data.pid
    ? `${data.vid.replace(/^0x/, '')}:${data.pid.replace(/^0x/, '')}`
    : '----:----';
  elements.transportState.textContent = wired
    ? 'USB 控制接口已连接'
    : (data.receiverPresent ? '接收器已连接' : '未检测到接收器');
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

elements.configTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateConfigPanel(tab.dataset.configTarget));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + elements.configTabs.length) % elements.configTabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % elements.configTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = elements.configTabs.length - 1;
    const nextTab = elements.configTabs[nextIndex];
    activateConfigPanel(nextTab.dataset.configTarget);
    nextTab.focus();
  });
});

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
elements.readMacro.addEventListener('click', readMacroState);
elements.applyMacro.addEventListener('click', applyMacro);
elements.restoreMacro.addEventListener('click', restoreMacro);
elements.readSleep.addEventListener('click', readSleepTime);
elements.applySleep.addEventListener('click', applySleepTime);
elements.restoreSleep.addEventListener('click', restoreSleepTime);
elements.macroType.addEventListener('change', () => {
  const hold = elements.macroType.value === 'hold';
  elements.macroRepeat.disabled = hold;
  if (hold) elements.macroRepeat.value = '1';
});
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

