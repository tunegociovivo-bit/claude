import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateHost } from "../lib/radar/net-guard";

test("bloquea formas literales de la red interna", () => {
  for (const h of [
    "localhost", "api.localhost", "svc.internal", "db.local",
    "127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "127.1", "10.1", "127.0.1", // abreviadas que el navegador expande a loopback/privadas
    "2130706433", // entero de 127.0.0.1
    "0x7f.0.0.1", // hex
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1",
    "::ffff:10.0.0.1", "::ffff:169.254.169.254", // IPv4 mapeada decimal
    "::ffff:7f00:1", "::ffff:0a00:0001", // IPv4 mapeada hex (127.0.0.1 / 10.0.0.1)
    "metadata", // nombre suelto
  ]) {
    assert.equal(isPrivateHost(h), true, `debería bloquear ${h}`);
  }
});

test("permite hosts públicos normales", () => {
  for (const h of [
    "www.auto1.com", "carmarket.ayvens.com", "remktg.arval.com", "login.bca.com",
    "8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946",
  ]) {
    assert.equal(isPrivateHost(h), false, `debería permitir ${h}`);
  }
});
