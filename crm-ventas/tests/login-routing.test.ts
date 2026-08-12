import test from "node:test";
import assert from "node:assert/strict";
import { loginDestination } from "../lib/login-routing";

test("el acceso normal abre el CRM aunque el usuario también sea operador", () => {
  assert.equal(loginDestination("crm", true), "/pipeline");
});

test("la administración general solo se abre cuando se solicita y hay permiso", () => {
  assert.equal(loginDestination("admin", true), "/admin");
  assert.equal(loginDestination("admin", false), "/pipeline");
});
