const HUB_ORIGIN = 'https://hub.negociovivo.app';
function isHub(value) {
  try { const url = new URL(value); return url.origin === HUB_ORIGIN && !url.username && !url.password; }
  catch { return false; }
}
function deviceKey(device) {
  return device && typeof device.serialNumber === 'string' && device.serialNumber
    && Number.isInteger(device.vendorId) && Number.isInteger(device.productId)
    ? `${device.vendorId}:${device.productId}:${device.serialNumber}` : null;
}
function allowedDevice(details, grants) {
  const key = deviceKey(details.device);
  return details.deviceType === 'usb' && isHub(details.origin) && key !== null && grants.includes(key);
}
module.exports = { HUB_ORIGIN, isHub, deviceKey, allowedDevice };
