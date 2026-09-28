const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isHub, deviceKey, allowedDevice } = require('./access-policy.cjs');
const device = { vendorId: 1, productId: 2, serialNumber: 'test-phone' };
test('solo admite el origen HTTPS exacto del Hub', () => {
  assert.equal(isHub('https://hub.negociovivo.app/moviles'), true);
  for (const url of ['http://hub.negociovivo.app', 'https://hub.negociovivo.app.evil.test', 'file:///x', 'https://evil@hub.negociovivo.app', 'https://hub.negociovivo.app:444']) assert.equal(isHub(url), false);
});
test('un permiso corresponde al origen y dispositivo elegidos', () => {
  const grants = [deviceKey(device)];
  assert.equal(allowedDevice({ deviceType: 'usb', origin: 'https://hub.negociovivo.app', device }, grants), true);
  assert.equal(allowedDevice({ deviceType: 'usb', origin: 'https://other.test', device }, grants), false);
  assert.equal(allowedDevice({ deviceType: 'hid', origin: 'https://hub.negociovivo.app', device }, grants), false);
  assert.equal(allowedDevice({ deviceType: 'usb', origin: 'https://hub.negociovivo.app', device: { ...device, serialNumber: 'other' } }, grants), false);
  assert.equal(deviceKey({ ...device, serialNumber: '' }), null);
});
