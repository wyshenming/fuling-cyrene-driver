'use strict';

const HID = require('node-hid');

const TARGET_VENDOR_ID = 0x3151;
const TARGET_PRODUCT_ID = 0x5052;
const VENDOR_USAGE_PAGE = 0xffff;
const VENDOR_USAGE = 0x02;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function hex(value, width = 2) {
  return Number(value ?? 0).toString(16).toUpperCase().padStart(width, '0');
}

function summarizeDevice(device) {
  return {
    vendorId: `0x${hex(device.vendorId, 4)}`,
    productId: `0x${hex(device.productId, 4)}`,
    product: device.product || '',
    manufacturer: device.manufacturer || '',
    usagePage: `0x${hex(device.usagePage, 4)}`,
    usage: `0x${hex(device.usage, 4)}`,
    interface: device.interface,
    path: device.path
  };
}

function matchingDevices() {
  return HID.devices().filter((device) => (
    device.vendorId === TARGET_VENDOR_ID && device.productId === TARGET_PRODUCT_ID
  ));
}

function findVendorInterface(devices) {
  return devices.find((device) => (
    device.usagePage === VENDOR_USAGE_PAGE && device.usage === VENDOR_USAGE
  )) || devices.find((device) => device.interface === 2);
}

function encodeFeature(command, checksum = 'none') {
  const data = Buffer.alloc(64);
  Buffer.from(command).copy(data);

  if (checksum === 'bit7') {
    let sum = 0;
    for (let index = 0; index < 7; index += 1) {
      sum = (sum + data[index]) & 0xff;
    }
    data[7] = 0xff - sum;
  }

  // node-hid expects the report ID as the first byte.
  return [0, ...data];
}

function normalizeFeatureResponse(response) {
  const bytes = Array.from(response || []);
  if (bytes.length === 65 && bytes[0] === 0) {
    return bytes.slice(1);
  }
  return bytes;
}

function sendFeature(device, command, checksum = 'none') {
  return device.sendFeatureReport(encodeFeature(command, checksum));
}

function readFeature(device) {
  return normalizeFeatureResponse(device.getFeatureReport(0, 65));
}

async function queryStatus(device) {
  sendFeature(device, [0xf7]);
  await delay(25);
  const data = readFeature(device);
  return {
    raw: data.slice(0, 16).map((value) => hex(value)).join(' '),
    canRead: data[0] === 1,
    keyboardBattery: data[1],
    mouseBattery: data[2],
    keyboardOnline: data[3] === 0,
    mouseOnline: data[4] === 0,
    canSend: data[5] === 1,
    deviceMask: data[6],
    rfBoot: data[8] === 1
  };
}

async function selectKeyboardChannel(device) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const status = await queryStatus(device);
    if (status.canSend) {
      sendFeature(device, [0xf6, 0x0a]);
      await delay(20);
      return status;
    }
    await delay(100);
  }
  throw new Error('接收器当前不允许向键盘通道发送数据。请唤醒键盘后重试。');
}

async function waitForKeyboardReply(device) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await delay(100);
    const status = await queryStatus(device);
    if (status.canRead) {
      sendFeature(device, [0xfc]);
      await delay(25);
      return readFeature(device);
    }
  }
  throw new Error('等待键盘回复超时。');
}

async function readKeyboardIdentity(device) {
  const initialStatus = await selectKeyboardChannel(device);
  sendFeature(device, [0x8f], 'bit7');
  const response = await waitForKeyboardReply(device);

  if (response[0] !== 0x8f || response.length < 5) {
    throw new Error(`设备返回了未知身份响应：${response.slice(0, 16).map((value) => hex(value)).join(' ')}`);
  }

  const identity = (
    response[1] |
    (response[2] << 8) |
    (response[3] << 16) |
    (response[4] << 24)
  ) >>> 0;

  return {
    initialStatus,
    identity,
    identityHex: `0x${hex(identity, 8)}`,
    response: response.slice(0, 16).map((value) => hex(value)).join(' ')
  };
}

async function main() {
  const devices = matchingDevices();
  console.log(JSON.stringify({ devices: devices.map(summarizeDevice) }, null, 2));

  if (!process.argv.includes('--probe')) {
    return;
  }

  const target = findVendorInterface(devices);
  if (!target) {
    throw new Error('没有找到 VID 3151 / PID 5052 的供应商 HID 接口。');
  }

  const device = new HID.HID(target.path);
  try {
    let status = await queryStatus(device);
    console.log(JSON.stringify({ status }, null, 2));

    if (!status.keyboardOnline && process.argv.includes('--wait')) {
      console.log('等待键盘唤醒，最长 60 秒……');
      for (let second = 1; second <= 60 && !status.keyboardOnline; second += 1) {
        await delay(1000);
        status = await queryStatus(device);
      }
    }

    if (!status.keyboardOnline) {
      throw new Error('接收器已连接，但键盘当前离线。请按一个键唤醒后重试。');
    }

    const identity = await readKeyboardIdentity(device);
    console.log(JSON.stringify({ identity }, null, 2));
  } finally {
    device.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

