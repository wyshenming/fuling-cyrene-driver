'use strict';

const HID = require('node-hid');

const RECEIVER_VID = 0x3151;
const RECEIVER_PID = 0x5052;
const KEYBOARD_USB_VID = 0x38a9;
const KEYBOARD_USB_PID = 0x0017;
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

function findUsbKeyboard() {
  return HID.devices().find((device) => (
    device.vendorId === KEYBOARD_USB_VID
    && device.productId === KEYBOARD_USB_PID
    && device.usagePage === 0xffff
    && device.usage === 2
    && device.interface === 2
  )) || null;
}

function isUsbPowerPresent() {
  return HID.devices().some((device) => (
    device.vendorId === KEYBOARD_USB_VID && device.productId === KEYBOARD_USB_PID
  ));
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

async function readUsbIdentity(device) {
  send(device, [0x8f], 7);
  await delay(25);
  const response = receive(device);
  if (response[0] !== 0x8f || response.length < 5) return null;
  return (response[1] | (response[2] << 8) | (response[3] << 16) | (response[4] << 24)) >>> 0;
}

async function openKeyboardTransport() {
  const usb = findUsbKeyboard();
  if (usb) {
    const device = new HID.HID(usb.path);
    try {
      const identity = await readUsbIdentity(device);
      if (identity === DEVICE_ID) {
        return {
          kind: 'usb',
          device,
          descriptor: usb,
          identity,
          status: { online: true, battery: 100, canRead: true, canSend: true, rfBoot: false }
        };
      }
    } catch {
      // The receiver remains a valid fallback when the USB interface is busy.
    }
    device.close();
  }

  const receiver = findReceiver();
  if (!receiver) throw new Error('未检测到有线键盘或 2.4G 接收器');
  const device = new HID.HID(receiver.path);
  try {
    const status = await queryStatus(device);
    let identity = null;
    if (status.online && !status.rfBoot) identity = await readIdentity(device);
    return { kind: '2.4g', device, descriptor: receiver, identity, status };
  } catch (error) {
    device.close();
    throw error;
  }
}

function assertKeyboardReady(transport) {
  if (!transport.status.online || transport.status.rfBoot) throw new Error('键盘未在线，请先唤醒键盘');
  if (transport.identity !== DEVICE_ID) throw new Error('键盘身份识别失败');
}

async function withKeyboardTransport(callback) {
  const transport = await openKeyboardTransport();
  try {
    assertKeyboardReady(transport);
    return await callback(transport);
  } finally {
    transport.device.close();
  }
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

async function keyboardRead(transport, command, checksumByte = 7) {
  if (transport.kind === 'usb') {
    send(transport.device, command, checksumByte);
    await delay(25);
    return receive(transport.device);
  }
  if (!await waitToSend(transport.device)) return null;
  send(transport.device, command, checksumByte);
  return waitToRead(transport.device);
}

async function keyboardWrite(transport, command, checksumByte = 8) {
  if (transport.kind === 'usb') {
    send(transport.device, command, checksumByte);
    await delay(100);
    return true;
  }
  if (!await waitToSend(transport.device)) return false;
  send(transport.device, command, checksumByte);
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
  return withKeyboardTransport(async (transport) => {
    const lighting = await readLightingFromDevice(transport);
    if (!lighting.main || !lighting.side) throw new Error('灯效参数读取失败');
    return lighting;
  });
}

async function writeLighting(channel, setting) {
  if (channel !== 'main' && channel !== 'side') throw new Error('未知灯光通道');
  return withKeyboardTransport(async (transport) => {
    if (!await keyboardWrite(transport, encodeLight(setting, channel === 'side'), 8)) throw new Error('灯效写入失败');
    const response = await keyboardRead(transport, [channel === 'side' ? 0x88 : 0x87], 7);
    const verified = response?.[0] === (channel === 'side' ? 0x88 : 0x87)
      ? decodeLight(response, channel === 'side')
      : null;
    if (!verified) throw new Error('写入后校验读取失败');
    return verified;
  });
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

async function readFnLayerFromDevice(device, systemCode) {
  if (![0, 1].includes(systemCode)) throw new Error('Fn 系统编号无效');
  const matrix = [];
  for (let chunk = 0; chunk < 8; chunk += 1) {
    const command = Buffer.alloc(64);
    command[0] = 0x90;
    command[1] = systemCode;
    command[2] = 0;
    command[3] = 0xff;
    command[4] = chunk;
    let response = null;
    for (let attempt = 0; attempt < 3 && (!response || response.length < 64); attempt += 1) {
      if (attempt > 0) await delay(250);
      response = await keyboardRead(device, command, 7);
    }
    if (!response || response.length < 64) throw new Error(`Fn 键位分片 ${chunk + 1} 读取失败`);
    matrix.push(...response.slice(0, 64));
    await delay(40);
  }
  return matrix;
}

async function readMacroSlotFromDevice(device, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 50) throw new Error('宏槽编号无效');
  const data = [];
  for (let chunk = 0; chunk < 4; chunk += 1) {
    let response = null;
    for (let attempt = 0; attempt < 3 && (!response || response.length < 64); attempt += 1) {
      if (attempt > 0) await delay(250);
      response = await keyboardRead(device, [0x8b, slot, chunk], 7);
    }
    if (!response || response.length < 64) throw new Error(`宏槽 ${slot} 分片 ${chunk + 1} 读取失败`);
    data.push(...response.slice(0, 64));
    await delay(40);
  }
  return data;
}

function findMacroReferences(matrices) {
  const references = [];
  for (const [scope, matrix] of Object.entries(matrices)) {
    for (let offset = 0; offset < matrix.length; offset += 4) {
      if (matrix[offset] === 9 && matrix[offset + 2] < 50) {
        references.push({ scope, physicalIndex: offset / 4, macroType: matrix[offset + 1], slot: matrix[offset + 2] });
      }
    }
  }
  return references;
}

async function inspectMacroState() {
  return withKeyboardTransport(async (transport) => {
    const layers = [];
    for (let layer = 0; layer < 3; layer += 1) layers.push(await readKeyLayerFromDevice(transport, layer));
    const fnWin = await readFnLayerFromDevice(transport, 0);
    const fnMac = await readFnLayerFromDevice(transport, 1);
    const matrices = { layer0: layers[0], layer1: layers[1], layer2: layers[2], fnWin, fnMac };
    const references = findMacroReferences(matrices);
    const used = new Set(references.map((reference) => reference.slot));
    const freeSlot = Array.from({ length: 50 }, (_, index) => index).find((slot) => !used.has(slot));
    if (freeSlot == null) throw new Error('没有可用的宏槽');
    const freeSlotData = await readMacroSlotFromDevice(transport, freeSlot);
    return {
      layers,
      fnWin,
      fnMac,
      defaultMatrix: Array.from(DEFAULT_MATRIX),
      references,
      freeSlot,
      freeSlotData
    };
  });
}

function encodeMacroText(text, keyDelay = 35, repeatCount = 1) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('宏文本不能为空');
  if (!Number.isInteger(keyDelay) || keyDelay < 10 || keyDelay > 1000) throw new Error('按键间隔必须为 10–1000 毫秒');
  if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 65535) throw new Error('循环次数无效');
  const direct = {};
  for (let index = 0; index < 26; index += 1) direct[String.fromCharCode(97 + index)] = { hid: 4 + index, shift: false };
  for (let index = 1; index <= 9; index += 1) direct[String(index)] = { hid: 29 + index, shift: false };
  direct['0'] = { hid: 39, shift: false };
  Object.assign(direct, {
    ' ': { hid: 44, shift: false }, '\n': { hid: 40, shift: false }, '-': { hid: 45, shift: false },
    '=': { hid: 46, shift: false }, '[': { hid: 47, shift: false }, ']': { hid: 48, shift: false },
    '\\': { hid: 49, shift: false }, ';': { hid: 51, shift: false }, "'": { hid: 52, shift: false },
    '`': { hid: 53, shift: false }, ',': { hid: 54, shift: false }, '.': { hid: 55, shift: false }, '/': { hid: 56, shift: false }
  });
  const shifted = { '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '~': '`', '<': ',', '>': '.', '?': '/' };
  const events = [];
  for (const char of text) {
    let entry = direct[char];
    if (!entry && char >= 'A' && char <= 'Z') entry = { ...direct[char.toLowerCase()], shift: true };
    if (!entry && shifted[char]) entry = { ...direct[shifted[char]], shift: true };
    if (!entry) throw new Error(`暂不支持字符：${char}`);
    if (entry.shift) events.push({ hid: 225, down: true, delay: 10 });
    events.push({ hid: entry.hid, down: true, delay: 25 });
    events.push({ hid: entry.hid, down: false, delay: entry.shift ? 10 : keyDelay });
    if (entry.shift) events.push({ hid: 225, down: false, delay: keyDelay });
  }
  const output = Buffer.alloc(256);
  output[0] = repeatCount & 0xff;
  output[1] = (repeatCount >> 8) & 0xff;
  let offset = 2;
  for (const event of events) {
    const bytes = event.delay <= 127
      ? [event.hid, event.delay | (event.down ? 0x80 : 0)]
      : [event.hid, event.down ? 0x80 : 0, event.delay & 0xff, event.delay >> 8];
    if (offset + bytes.length + 4 > output.length) throw new Error('宏内容过长，请缩短文本或减少大写/符号');
    Buffer.from(bytes).copy(output, offset);
    offset += bytes.length;
  }
  return { data: Array.from(output), eventCount: events.length, bytesUsed: offset };
}

async function writeMacroSlotRaw(slot, rawData) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 50) throw new Error('宏槽编号无效');
  if (!Array.isArray(rawData) || rawData.length !== 256 || rawData.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('宏数据格式无效');
  }
  return withKeyboardTransport(async (transport) => {
    const lastNonZero = rawData.reduce((last, value, index) => value !== 0 ? index : last, 0);
    const chunkCount = Math.max(1, Math.ceil((lastNonZero + 1) / 56));
    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      const command = Buffer.alloc(64);
      command[0] = 0x0b;
      command[1] = slot;
      command[2] = chunk;
      command[3] = 56;
      command[4] = chunk === chunkCount - 1 ? 1 : 0;
      Buffer.from(rawData.slice(chunk * 56, chunk * 56 + 56)).copy(command, 8);
      if (!await keyboardWrite(transport, command, 7)) throw new Error(`宏槽 ${slot} 分片 ${chunk + 1} 写入失败`);
    }
    const verified = await readMacroSlotFromDevice(transport, slot);
    const comparedLength = chunkCount * 56;
    if (!Buffer.from(verified.slice(0, comparedLength)).equals(Buffer.from(rawData.slice(0, comparedLength)))) {
      throw new Error('宏写入后的回读校验不一致');
    }
    return { slot, data: verified, chunkCount };
  });
}

async function writeTextMacro(slot, text, keyDelay, repeatCount) {
  const encoded = encodeMacroText(text, keyDelay, repeatCount);
  const result = await writeMacroSlotRaw(slot, encoded.data);
  return { ...result, eventCount: encoded.eventCount, bytesUsed: encoded.bytesUsed };
}

function decodeSleepTime(response) {
  if (!response || response.length < 16 || response[0] !== 0x91) throw new Error('休眠时间返回数据无效');
  const uint16 = (offset) => response[offset] | (response[offset + 1] << 8);
  return {
    timeBt: uint16(8),
    time24: uint16(10),
    deepTimeBt: uint16(12),
    deepTime24: uint16(14)
  };
}

async function readSleepTimeFromDevice(device) {
  const response = await keyboardRead(device, [0x91], 7);
  return decodeSleepTime(response);
}

async function inspectSleepTime() {
  return withKeyboardTransport((transport) => readSleepTimeFromDevice(transport));
}

function validateSleepTime(settings) {
  const ranges = {
    timeBt: [60, 3600, '蓝牙浅休眠'],
    time24: [60, 3600, '2.4G 浅休眠'],
    deepTimeBt: [600, 3600, '蓝牙深度休眠'],
    deepTime24: [0, 3600, '2.4G 深度休眠']
  };
  for (const [key, [minimum, maximum, label]] of Object.entries(ranges)) {
    const value = settings?.[key];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${label}时间无效`);
    }
  }
}

async function writeSleepTime(settings) {
  validateSleepTime(settings);
  return withKeyboardTransport(async (transport) => {
    const command = Buffer.alloc(64);
    command[0] = 0x11;
    const putUint16 = (offset, value) => {
      command[offset] = value & 0xff;
      command[offset + 1] = value >> 8;
    };
    putUint16(8, settings.timeBt);
    putUint16(10, settings.time24);
    putUint16(12, settings.deepTimeBt);
    putUint16(14, settings.deepTime24);
    if (!await keyboardWrite(transport, command, 7)) throw new Error('休眠时间写入失败');
    await delay(150);
    const verified = await readSleepTimeFromDevice(transport);
    if (['timeBt', 'time24', 'deepTimeBt', 'deepTime24'].some((key) => verified[key] !== settings[key])) {
      throw new Error('休眠时间写入后的回读校验不一致');
    }
    return verified;
  });
}

async function inspectKeymap() {
  return withKeyboardTransport(async (transport) => {
    const layers = [];
    for (let layer = 0; layer < 3; layer += 1) layers.push(await readKeyLayerFromDevice(transport, layer));
    return {
      layers,
      defaultMatrix: Array.from(DEFAULT_MATRIX),
      keyCount: DEFAULT_MATRIX.length / 4
    };
  });
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
  return withKeyboardTransport(async (transport) => {
    const command = Buffer.alloc(64);
    command[0] = 0x0a;
    command[1] = layer;
    command[2] = physicalIndex;
    command[5] = 1;
    command[6] = 0;
    Buffer.from(matrixValue).copy(command, 8);
    if (!await keyboardWrite(transport, command, 7)) throw new Error('键位写入失败');
    const verifiedLayer = await readKeyLayerFromDevice(transport, layer);
    const verified = verifiedLayer.slice(physicalIndex * 4, physicalIndex * 4 + 4);
    if (!Buffer.from(verified).equals(Buffer.from(matrixValue))) throw new Error('键位写入后的回读校验不一致');
    return { layer, physicalIndex, matrixValue: verified, layerData: verifiedLayer };
  });
}

async function remapStandardKey(layer, physicalIndex, targetHid) {
  const standard = (targetHid >= 4 && targetHid <= 101) || (targetHid >= 224 && targetHid <= 231);
  if (!Number.isInteger(targetHid) || !standard) throw new Error('当前版本只允许映射标准键盘按键');
  return writeKeyMatrixValue(layer, physicalIndex, [0, 0, targetHid, 0]);
}

async function inspectKeyboard() {
  const receiver = findReceiver();
  const usb = findUsbKeyboard();
  const usbPowerPresent = isUsbPowerPresent();
  if (!usb && !receiver) {
    return {
      receiverPresent: false,
      online: false,
      usbPowerPresent,
      chargingState: usbPowerPresent ? 'USB 供电中' : '未检测到 USB',
      model: '昔涟·往昔的涟漪',
      message: '未检测到有线键盘或 2.4G 接收器'
    };
  }

  let transport;
  try {
    transport = await openKeyboardTransport();
    const { status, identity } = transport;
    const wired = transport.kind === 'usb';

    return {
      receiverPresent: Boolean(receiver),
      online: status.online,
      battery: status.battery,
      usbPowerPresent,
      chargingState: usbPowerPresent ? 'USB 供电中' : '未检测到 USB',
      canRead: status.canRead,
      canSend: status.canSend,
      rfBoot: status.rfBoot,
      identity,
      identityHex: identity == null ? null : `0x${hex(identity, 8)}`,
      recognized: identity === DEVICE_ID,
      model: '昔涟·往昔的涟漪',
      hardwareProfile: identity === DEVICE_ID ? 'Fuling Air 108 metallic' : null,
      protocol: identity === DEVICE_ID ? 'ry6602_fl_k2509_3m_1k_1k' : null,
      connection: wired ? 'USB' : '2.4G',
      vid: `0x${hex(wired ? KEYBOARD_USB_VID : RECEIVER_VID, 4)}`,
      pid: `0x${hex(wired ? KEYBOARD_USB_PID : RECEIVER_PID, 4)}`,
      message: status.online ? '键盘已连接' : '接收器存在，键盘处于休眠或未连接'
    };
  } finally {
    transport?.device.close();
  }
}

module.exports = {
  inspectKeyboard,
  inspectLighting,
  writeLighting,
  inspectKeymap,
  remapStandardKey,
  writeKeyMatrixValue,
  inspectMacroState,
  writeTextMacro,
  writeMacroSlotRaw,
  inspectSleepTime,
  writeSleepTime,
  encodeMacroText,
  MAIN_EFFECTS,
  SIDE_EFFECTS
};

