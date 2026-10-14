import test from "node:test";
import assert from "node:assert/strict";
import { appendOperatorAccess, enterWorkspaceToken, isActingToken, leaveWorkspaceToken } from "../lib/admin/acting-core";

const operator = { uid: "u-op", email: "info@negociovivo.com", workspaceId: "ws-nv", role: "ADMIN", iat: 1, exp: 2, jti: "x" };

test("entrar apunta la sesión al cliente como ADMIN y recuerda el origen", () => {
  const t = enterWorkspaceToken(operator, "ws-march");
  assert.equal(t.workspaceId, "ws-march");
  assert.equal(t.role, "ADMIN");
  assert.equal(t.uid, "u-op");
  assert.equal(t.email, "info@negociovivo.com");
  assert.equal(t.homeWorkspaceId, "ws-nv");
  assert.equal(t.homeRole, "ADMIN");
  assert.equal(isActingToken(t), true);
});

test("saltar de un cliente a otro conserva el workspace de origen real", () => {
  const first = enterWorkspaceToken({ ...operator, role: "MEMBER" }, "ws-march");
  const second = enterWorkspaceToken(first, "ws-aruksa");
  assert.equal(second.workspaceId, "ws-aruksa");
  assert.equal(second.homeWorkspaceId, "ws-nv");
  assert.equal(second.homeRole, "MEMBER");
});

test("volver restaura workspace y rol propios y quita las marcas del modo operador", () => {
  const acting = enterWorkspaceToken({ ...operator, role: "MEMBER" }, "ws-march");
  const back = leaveWorkspaceToken(acting);
  assert.equal(back.workspaceId, "ws-nv");
  assert.equal(back.role, "MEMBER");
  assert.equal(isActingToken(back), false);
  assert.equal("homeWorkspaceId" in back, false);
  assert.equal("operatorActing" in back, false);
});

test("entrar en el propio workspace equivale a volver", () => {
  const acting = enterWorkspaceToken(operator, "ws-march");
  const own = enterWorkspaceToken(acting, "ws-nv");
  assert.equal(own.workspaceId, "ws-nv");
  assert.equal(isActingToken(own), false);
  assert.equal(isActingToken(enterWorkspaceToken(operator, "ws-nv")), false);
});

test("volver sin estar dentro de un cliente no cambia el workspace", () => {
  const back = leaveWorkspaceToken(operator);
  assert.equal(back.workspaceId, "ws-nv");
  assert.equal(back.role, "ADMIN");
});

test("un token sin workspace no entra en ningún cliente", () => {
  const t = enterWorkspaceToken({ uid: "u" }, "ws-march");
  assert.equal(isActingToken(t), false);
  assert.equal(t.workspaceId, undefined);
});

test("el registro de accesos guarda los 20 últimos, el más reciente primero", () => {
  const settings: Record<string, any> = { operatorAccess: "basura" };
  for (let i = 0; i < 25; i++) appendOperatorAccess(settings, `op${i}@negociovivo.com`, new Date(Date.UTC(2026, 9, 14, 8, i)));
  assert.equal(settings.operatorAccess.length, 20);
  assert.equal(settings.operatorAccess[0].email, "op24@negociovivo.com");
  assert.equal(settings.operatorAccess[0].action, "entrar");
  assert.equal(settings.operatorAccess[19].email, "op5@negociovivo.com");
});
