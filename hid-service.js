'use strict';

const HID = require('node-hid');

const RECEIVER_VID = 0x3151;
const RECEIVER_PID = 0x5052;
const DEVICE_ID = 4112;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function hex(value, width = 2) {
  return Number(value ?? 0).toString(16).toUpperCase().padStart(width, '0');
}

function findReceiver() {
  const matches = HID.devices().filter((device) => (
    device.vendorId === RECEIVER_VID && device.productId === RECEIVER_PID
  ));
  return matches.find((device) => device.usagePage === 0xffff && device.usage === 2) || null;
}

function encodeFeature(command, checksumByte = null) {
  const data = Buffer.alloc(64);
  Buffer.from(command).copy(data);
  if (checksumByte === 7 || checksumByte === 8) {
    let sum = 0;
    for (let index = 0; index < checksumByte; index += 1) sum = (sum + data[index]) & 0xff;
    data[checksumByte] = 0xff - sum;
  }
  return [0, ...data];
}

function normalize(response) {
  const bytes = Array.from(response || []);
  return bytes.length === 65 && bytes[0] === 0 ? bytes.slice(1) : bytes;
}

function send(device, command, checksumByte = null) {
  device.sendFeatureReport(encodeFeature(command, checksumByte));
}

function receive(device) {
  return normalize(device.getFeatureReport(0, 65));
}

async function queryStatus(device) {
  send(device, [0xf7]);
  await delay(25);
  const data = receive(device);
  return {
    battery: data[1] ?? null,
    online: data[3] === 0,
    canRead: data[0] === 1,
    canSend: data[5] === 1,
    rfBoot: data[8] === 1,
    raw: data.slice(0, 12).map((value) => hex(value)).join(' ')
  };
}

async function readIdentity(device) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const status = await queryStatus(device);
    if (status.canSend) {
      send(device, [0xf6, 0x0a]);
      await delay(20);
      send(device, [0x8f], 7);
      break;
    }
    await delay(100);
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(100);
    const status = await queryStatus(device);
    if (!status.canRead) continue;
    send(device, [0xfc]);
    await delay(25);
    const response = receive(device);
    if (response[0] !== 0x8f || response.length < 5) return null;
    return (response[1] | (response[2] << 8) | (response[3] << 16) | (response[4] << 24)) >>> 0;
  }
  return null;
}

async function waitToSend(device) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await delay(100);
    if ((await queryStatus(device)).canSend) {
      send(device, [0xf6, 0x0a]);
      await delay(10);
      return true;
    }
  }
  return false;
}

async function waitToRead(device) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await delay(100);
    if ((await queryStatus(device)).canRead) {
      send(device, [0xfc]);
      await delay(10);
      return receive(device);
    }
  }
  return null;
}

async function keyboardRead(device, command, checksumByte = 7) {
  if (!await waitToSend(device)) return null;
  send(device, command, checksumByte);
  return waitToRead(device);
}

async function keyboardWrite(device, command, checksumByte = 8) {
  if (!await waitToSend(device)) return false;
  send(device, command, checksumByte);
  await delay(100);
  return true;
}

const MAIN_EFFECTS = [
  'LightOff', 'LightAlwaysOn', 'LightBreath', 'LightNeon', 'LightWave',
  'LightRipple', 'LightRaindrop', 'LightSnake', 'LightPressAction',
  'LightConverage', 'LightSineWave', 'LightKaleidoscope', 'LightLineWave',
  'LightUserPicture', 'LightLaser', 'LightCircleWave', 'LightDazzing',
  'LightRainDown', 'LightMeteor', 'LightPressActionOff', 'LightMusicFollow3',
  'LightScreenColor', 'LightMusicFollow2', 'LightTrain', 'LightFireWorks',
  'LightUserColor'
];

const SIDE_EFFECTS = {
  0: 'LightOff', 1: 'LightAlwaysOn', 2: 'LightBreath', 3: 'LightNeon',
  4: 'LightWave', 5: 'LightSnake', 6: 'LightMusicFollow2',
  14: 'LightRaindrop', 15: 'LightFlowers'
};

const COMMON_COLORS = [0xff0000, 0xff8000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff];
const DEFAULT_MATRIX = Buffer.from('AAApAAAANQAAACsAAAA5AAAA4QAAAOAAAAAAAAAAHgAAABQAAAAEAAAAAAAAAOMAAAA6AAAAHwAAABoAAAAWAAAAHQAAAOIAAAA7AAAAIAAAAAgAAAAHAAAAGwAAAAAAAAA8AAAAIQAAABUAAAAJAAAABgAAAAAAAAA9AAAAIgAAABcAAAAKAAAAGQAAAAAAAAA+AAAAIwAAABwAAAALAAAABQAAACwAAAA/AAAAJAAAABgAAAANAAAAEQAAAAAAAABAAAAAJQAAAAwAAAAOAAAAEAAAAAAAAABBAAAAJgAAABIAAAAPAAAANgAAAAAAAABCAAAAJwAAABMAAAAzAAAANwAAAOYAAABDAAAALQAAAC8AAAA0AAAAOAAKAQAAAABEAAAALgAAADAAAAAAAAAAAAAAAGUAAABFAAAAKgAAADEAAAAoAAAA5QAAAOQAAABGAAAASQAAAEwAAABcAAAAAAAAAFAAAABHAAAASgAAAE0AAABdAAAAUgAAAFEAAABIAAAASwAAAE4AAABeAAAAAAAAAE8AAwCSAQAAUwAAAFUAAABfAAAAWQAAAGIAAwDqAAAAVAAAAFYAAABgAAAAWgAAAGMAAwDpAAMA4gAAAFcAAABhAAAAWwAAAFgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64');

function decodeLight(data, side = false) {
  if (!data || data.length < 8) return null;
  const type = side ? SIDE_EFFECTS[data[1]] : MAIN_EFFECTS[data[1]];
  if (!type) return null;
  const flags = data[4];
  const colorCode = flags & 0x0f;
  let rgb = (data[5] << 16) | (data[6] << 8) | data[7];
  if (colorCode !== 7 && colorCode !== 8 && COMMON_COLORS[colorCode] != null) rgb = COMMON_COLORS[colorCode];
  if (rgb === 0xfafffa) rgb = 0xffffff;
  return {
    type,
    option: flags >> 4,
    bright: data[3],
    speed: side ? data[2] : 4 - data[2],
    rgb,
    rgbHex: `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`,
    dazzle: (type === 'LightMusicFollow2' || type === 'LightMusicFollow3') ? colorCode === 0 : colorCode === 8
  };
}

function encodeLight(setting, side = false) {
  const data = Buffer.alloc(64);
  data[0] = side ? 0x08 : 0x07;
  const effectId = side
    ? Number(Object.keys(SIDE_EFFECTS).find((key) => SIDE_EFFECTS[key] === setting.type))
    : MAIN_EFFECTS.indexOf(setting.type);
  if (!Number.isInteger(effectId) || effectId < 0) throw new Error('不支持的灯效类型');
  data[1] = effectId;
  data[2] = side ? setting.speed : 4 - setting.speed;
  data[3] = setting.bright;
  let flags = (setting.option & 0x0f) << 4 | (setting.dazzle ? 8 : 7);
  if (setting.type === 'LightUserPicture') flags = (setting.option & 0x0f) << 4;
  if (setting.type === 'LightMusicFollow2' || setting.type === 'LightMusicFollow3') {
    flags = (setting.option & 0x0f) << 4 | (setting.dazzle ? 0 : 4);
  }
  if (setting.type === 'LightScreenColor') flags = 0;
  if (side && setting.type === 'LightNeon') flags = 8;
  data[4] = flags;
  let rgb = setting.rgb === 0xffffff ? 0xfafffa : setting.rgb;
  data[5] = (rgb >> 16) & 0xff;
  data[6] = (rgb >> 8) & 0xff;
  data[7] = rgb & 0xff;
  return data;
}

async function readLightingFromDevice(device) {
  const mainRaw = await keyboardRead(device, [0x87], 7);
  const sideRaw = await keyboardRead(device, [0x88], 7);
  return {
    main: mainRaw?.[0] === 0x87 ? decodeLight(mainRaw, false) : null,
    side: sideRaw?.[0] === 0x88 ? decodeLight(sideRaw, true) : null
  };
}

async function inspectLighting() {
  const receiver = findReceiver();
  if (!receiver) throw new Error('未检测到 2.4G 接收器');
  const device = new HID.HID(receiver.path);
  try {
    const status = await queryStatus(device);
    if (!status.online || status.rfBoot) throw new Error('键盘未在线，请先唤醒键盘');
    const lighting = await readLightingFromDevice(device);
    if (!lighting.main || !lighting.side) throw new Error('灯效参数读取失败');
    return lighting;
  } finally {
    device.close();
  }
}

async function writeLighting(channel, setting) {
  if (channel !== 'main' && channel !== 'side') throw new Error('未知灯光通道');
  const receiver = findReceiver();
  if (!receiver) throw new Error('未检测到 2.4G 接收器');
  const device = new HID.HID(receiver.path);
  try {
    const status = await queryStatus(device);
    if (!status.online || status.rfBoot) throw new Error('键盘未在线，请先唤醒键盘');
    if (!await keyboardWrite(device, encodeLight(setting, channel === 'side'), 8)) throw new Error('灯效写入失败');
    const response = await keyboardRead(device, [channel === 'side' ? 0x88 : 0x87], 7);
    const verified = response?.[0] === (channel === 'side' ? 0x88 : 0x87)
      ? decodeLight(response, channel === 'side')
      : null;
    if (!verified) throw new Error('写入后校验读取失败');
    return verified;
  } finally {
    device.close();
  }
}

async function readKeyLayerFromDevice(device, layer) {
  if (!Number.isInteger(layer) || layer < 0 || layer > 2) throw new Error('键位层编号无效');
  const matrix = [];
  for (let chunk = 0; chunk < 8; chunk += 1) {
    const command = Buffer.alloc(64);
    command[0] = 0x8a;
    command[1] = layer;
    command[2] = 0xff;
    command[3] = chunk;
    command[4] = 0;
    let response = null;
    for (let attempt = 0; attempt < 3 && (!response || response.length < 64); attempt += 1) {
      if (attempt > 0) await delay(250);
      response = await keyboardRead(device, command, 7);
    }
    if (!response || response.length < 64) throw new Error(`第 ${layer + 1} 层键位分片 ${chunk + 1} 读取失败`);
    matrix.push(...response.slice(0, 64));
    await delay(40);
  }
  return matrix;
}

async function inspectKeymap() {
  const receiver = findReceiver();
  if (!receiver) throw new Error('未检测到 2.4G 接收器');
  const device = new HID.HID(receiver.path);
  try {
    const status = await queryStatus(device);
    if (!status.online || status.rfBoot) throw new Error('键盘未在线，请先唤醒键盘');
    const layers = [];
    for (let layer = 0; layer < 3; layer += 1) layers.push(await readKeyLayerFromDevice(device, layer));
    return {
      layers,
      defaultMatrix: Array.from(DEFAULT_MATRIX),
      keyCount: DEFAULT_MATRIX.length / 4
    };
  } finally {
    device.close();
  }
}

function validateMatrixValue(matrixValue) {
  if (!Array.isArray(matrixValue) || matrixValue.length !== 4 || matrixValue.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('键值矩阵格式无效');
  }
}

async function writeKeyMatrixValue(layer, physicalIndex, matrixValue) {
  if (!Number.isInteger(layer) || layer < 0 || layer > 2) throw new Error('键位层编号无效');
  if (!Number.isInteger(physicalIndex) || physicalIndex < 0 || physicalIndex >= DEFAULT_MATRIX.length / 4) throw new Error('物理键索引无效');
  if (!DEFAULT_MATRIX.slice(physicalIndex * 4, physicalIndex * 4 + 4).some(Boolean)) throw new Error('不能修改空键位槽');
  validateMatrixValue(matrixValue);
  const receiver = findReceiver();
  if (!receiver) throw new Error('未检测到 2.4G 接收器');
  const device = new HID.HID(receiver.path);
  try {
    const status = await queryStatus(device);
    if (!status.online || status.rfBoot) throw new Error('键盘未在线，请先唤醒键盘');
    const command = Buffer.alloc(64);
    command[0] = 0x0a;
    command[1] = layer;
    command[2] = physicalIndex;
    command[5] = 1;
    command[6] = 0;
    Buffer.from(matrixValue).copy(command, 8);
    if (!await keyboardWrite(device, command, 7)) throw new Error('键位写入失败');
    const verifiedLayer = await readKeyLayerFromDevice(device, layer);
    const verified = verifiedLayer.slice(physicalIndex * 4, physicalIndex * 4 + 4);
    if (!Buffer.from(verified).equals(Buffer.from(matrixValue))) throw new Error('键位写入后的回读校验不一致');
    return { layer, physicalIndex, matrixValue: verified, layerData: verifiedLayer };
  } finally {
    device.close();
  }
}

async function remapStandardKey(layer, physicalIndex, targetHid) {
  const standard = (targetHid >= 4 && targetHid <= 101) || (targetHid >= 224 && targetHid <= 231);
  if (!Number.isInteger(targetHid) || !standard) throw new Error('当前版本只允许映射标准键盘按键');
  return writeKeyMatrixValue(layer, physicalIndex, [0, 0, targetHid, 0]);
}

async function inspectKeyboard() {
  const receiver = findReceiver();
  if (!receiver) {
    return {
      receiverPresent: false,
      online: false,
      model: '昔涟·往昔的涟漪',
      message: '未检测到 2.4G 接收器（3151:5052）'
    };
  }

  const device = new HID.HID(receiver.path);
  try {
    const status = await queryStatus(device);
    let identity = null;
    if (status.online && !status.rfBoot) identity = await readIdentity(device);

    return {
      receiverPresent: true,
      online: status.online,
      battery: status.battery,
      canRead: status.canRead,
      canSend: status.canSend,
      rfBoot: status.rfBoot,
      identity,
      identityHex: identity == null ? null : `0x${hex(identity, 8)}`,
      recognized: identity === DEVICE_ID,
      model: '昔涟·往昔的涟漪',
      hardwareProfile: identity === DEVICE_ID ? 'Fuling Air 108 metallic' : null,
      protocol: identity === DEVICE_ID ? 'ry6602_fl_k2509_3m_1k_1k' : null,
      connection: '2.4G',
      vid: `0x${hex(RECEIVER_VID, 4)}`,
      pid: `0x${hex(RECEIVER_PID, 4)}`,
      message: status.online ? '键盘已连接' : '接收器存在，键盘处于休眠或未连接'
    };
  } finally {
    device.close();
  }
}

module.exports = {
  inspectKeyboard,
  inspectLighting,
  writeLighting,
  inspectKeymap,
  remapStandardKey,
  writeKeyMatrixValue,
  MAIN_EFFECTS,
  SIDE_EFFECTS
};

