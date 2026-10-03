const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../modules/companyGame");
const host = { id: "host", name: "Host" };
function room(input = {}) { return rules.createRoom(host, { firstPhase: "day", readyCheck: false, botCount: 3, ...input }, 1000); }
function solo(input) { const r = room(input); rules.apply(r, host, "start", {}, 1001); return r; }
function resolve(r, choice, now) {
  rules.apply(r, host, "vote", { choice }, now);
  assert.equal(r.phase, "night");
  rules.tick(r, now + 1);
  assert.equal(r.phase, "results");
}
test("solo complete session: borrowing, collection, repayment, Town win", () => {
  const r = solo(); resolve(r, "A", 1100); assert.equal(r.company.cash, 1000);
  rules.apply(r, host, "next", {}, 1200); resolve(r, "B", 1300);
  assert.equal(r.company.cash, 1000); assert.equal(r.company.debt, 2100);
  rules.apply(r, host, "next", {}, 1400); assert.equal(r.company.cash, 5000);
  resolve(r, "A", 1500); assert.equal(r.company.cash, 1400);
  rules.apply(r, host, "next", {}, 1600);
  assert.equal(r.phase, "ended"); assert.equal(r.won, true); assert.equal(r.company.debt, 0);
});
test("harmful feasible actions lose stability and finish with Town loss", () => {
  const r = solo(); resolve(r, "B", 1100); assert.equal(r.stability, 2);
  rules.apply(r, host, "next", {}, 1200); resolve(r, "A", 1300);
  rules.apply(r, host, "next", {}, 1400); resolve(r, "C", 1500);
  rules.apply(r, host, "next", {}, 1600); assert.equal(r.won, false);
});
test("six humans: CEO has double weight, roles visible, majority approved", () => {
  const r = room({ botCount: 0 });
  const users = [host, ...Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, name: `User ${i}` }))];
  users.slice(1).forEach((u) => rules.apply(r, u, "join", {}, 1001));
  rules.apply(r, host, "start", {}, 1002);
  assert.equal(rules.weight(r, r.players[0]), 2);
  assert.equal(rules.weight(r, r.players[5]), 1);
  users.forEach((u, i) => rules.apply(r, u, "vote", { choice: i < 3 ? "A" : "C" }, 1100));
  assert.equal(r.selected, "A"); assert.equal(r.phase, "night");
});
test("odd player count has equal weights; bots abstain", () => {
  const r = room(); rules.apply(r, { id: "u1", name: "One" }, "join", {}, 1001);
  rules.apply(r, { id: "u2", name: "Two" }, "join", {}, 1001); rules.apply(r, host, "start", {}, 1002);
  assert.equal(rules.weight(r, r.players[0]), 1); assert.equal(rules.weight(r, r.players[3]), 0);
});
test("ready check requires everyone, expires safely, cannot join mid-check", () => {
  const r = room({ readyCheck: true }); const u = { id: "u", name: "Guest" };
  rules.apply(r, u, "join", {}, 1001); rules.apply(r, host, "start", {}, 1002);
  rules.apply(r, host, "ready", {}, 1003); assert.equal(r.phase, "ready");
  assert.throws(() => rules.apply(r, { id: "late", name: "Late" }, "join", {}, 1004));
  rules.tick(r, 61003); assert.equal(r.phase, "waiting");
  rules.apply(r, host, "start", {}, 62000); rules.apply(r, host, "ready", {}, 62001);
  rules.apply(r, u, "ready", {}, 62002); assert.equal(r.phase, "day");
});
test("full room automatically begins check; capacity is not minimum start size", () => {
  const r = room({ capacity: 5, botCount: 0, readyCheck: true });
  for (let i = 0; i < 4; i++) rules.apply(r, { id: `u${i}`, name: `U${i}` }, "join", {}, 1001);
  assert.equal(r.phase, "ready");
  const smaller = room({ capacity: 15 }); rules.apply(smaller, host, "start", {}, 1001); assert.equal(smaller.phase, "day");
});
test("unavailable actions and unauthorized role powers rejected", () => {
  const r = solo(); r.opening.equipment = "premium";
  assert.throws(() => rules.apply(r, host, "vote", { choice: "A" }, 1100), /unavailable/);
  r.opening.equipment = "basic"; resolve(r, "A", 1200);
  assert.throws(() => rules.apply(r, host, "action", { choice: "execute" }, 1300));
  assert.throws(() => rules.apply(r, { id: "stranger", name: "Other" }, "next", {}, 1300));
});
test("night-first defaults resolve without human CEO power; valid openings playable", () => {
  for (const equipment of ["basic", "premium"]) for (const funding of ["owners", "loan"]) {
    const r = room({ firstPhase: "night" }); rules.apply(r, host, "start", {}, 1001);
    const finance = r.players.find((p) => p.role === "Finance Manager");
    const ops = r.players.find((p) => p.role === "Operations Manager");
    r.actions[finance.id] = funding; r.actions[ops.id] = equipment;
    rules.tick(r, 1002); assert.equal(r.phase, "day");
    resolve(r, "A", 1100); rules.apply(r, host, "next", {}, 1200); resolve(r, "A", 1300);
    rules.apply(r, host, "next", {}, 1400); resolve(r, "A", 1500); rules.apply(r, host, "next", {}, 1600);
    assert.equal(r.won, true, `${equipment}/${funding}`);
  }
});
test("private views omit other reports, raw actions, and outsider game data", () => {
  const r = solo(); const v = rules.view(r, host.id, 1100);
  assert(v.me.report); assert.equal(v.players[1].report, undefined);
  assert.equal(v.opening, undefined); assert.equal(v.actions.host, undefined);
  const outsider = rules.view(r, "other"); assert.equal(outsider.member, false); assert.equal(outsider.company, undefined);
});
test("2-2-2 ballots produce a declared runoff, then majority winner", () => {
  const r = room({ botCount: 0 }); const us = [host, ...Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, name: `U${i}` }))];
  us.slice(1).forEach((u) => rules.apply(r, u, "join", {}, 1001)); rules.apply(r, host, "start", {}, 1002);
  us.forEach((u, i) => rules.apply(r, u, "vote", { choice: ["B", "A", "A", "C", "C", "B"][i] }, 1100));
  // Weighted result B=3,A=2,C=2; declared entry tie resolves A before C.
  assert.equal(r.phase, "runoff"); assert.deepEqual(r.runoff, ["B", "A"]);
  us.forEach((u) => rules.apply(r, u, "vote", { choice: "A" }, 1200)); assert.equal(r.selected, "A");
});
test("no votes timeout uses stated fallback, no duplicate transactions", () => {
  const r = solo(); rules.tick(r, r.deadline + 1); assert.equal(r.selected, "C");
  rules.tick(r, r.deadline + 1); assert.equal(r.company.cash, 5000);
  rules.tick(r, r.deadline - 1); assert.equal(r.company.cash, 5000); assert.equal(r.history.length, 1);
});
test("host transfer and ready roster changes reset confirmations", () => {
  const r = room({ readyCheck: true }); const u = { id: "u", name: "One" };
  rules.apply(r, u, "join", {}, 1001); rules.apply(r, host, "start", {}, 1002);
  rules.apply(r, host, "ready", {}, 1003); rules.apply(r, host, "leave", {}, 1004);
  assert.equal(r.hostId, u.id); assert.equal(r.phase, "waiting"); assert.equal(r.players[0].ready, false);
});
test("JSON reload retains exactly the same ongoing game", () => {
  const r = solo(); resolve(r, "A", 1100);
  const reloaded = JSON.parse(JSON.stringify(r)); rules.apply(reloaded, host, "next", {}, 1200);
  resolve(reloaded, "B", 1300); assert.equal(reloaded.company.debt, 2100); assert.equal(reloaded.history.length, 2);
});
