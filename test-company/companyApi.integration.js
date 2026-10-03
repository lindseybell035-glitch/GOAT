// Explicit development-only integration test. Not included in the pure unit-test glob.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const mongoose = require("mongoose");
require("dotenv").config();
const express = require("express");
const csrf = require("../modules/csrf");
const models = require("../db/models");
const Rooms = require("../db/companyRooms");
const { randomUUID } = require("node:crypto");
test("authenticated API persistence, concurrency, ready check, privacy, and reconnect", async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Run only in development.");
  const dbName = `${process.env.MONGO_DB || "ultimafia"}_company_integration`;
  await mongoose.connect(`mongodb://${process.env.MONGO_URL}/${dbName}?authSource=admin`, { user: process.env.MONGO_USER, pass: process.env.MONGO_PW });
  const suffix = randomUUID();
  const users = Array.from({ length: 6 }, (_, i) => ({ id: `company-test-${suffix}-${i}`, name: `Test ${i}` }));
  await models.User.insertMany(users);
  const app = express(); app.use(express.json());
  // Test harness supplies sessions in this private, localhost-only HTTP server.
  app.use((req, res, next) => { req.session = { user: req.get("x-test-user") ? { id: req.get("x-test-user"), csrf: "test-csrf" } : undefined }; next(); });
  app.use(csrf); app.use("/api/company", require("../routes/company"));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/company`;
  const request = async (path, user = null, body, token = "test-csrf") => {
    const response = await fetch(url + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user.id, "x-csrf": token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data; try { data = await response.json(); } catch (_) { data = null; }
    return { status: response.status, data };
  };
  let id;
  try {
    assert.equal((await request("/rooms", null, {})).status, 401);
    assert.equal((await request("/rooms", users[0], {}, "bad-token")).status, 403);
    const created = await request("/rooms", users[0], { capacity: 10, botCount: 0, firstPhase: "day", readyCheck: true, public: false });
    assert.equal(created.status, 201); id = created.data.id;
    const joined = await Promise.all(users.slice(1).map((user) => request(`/rooms/${id}/actions`, user, { kind: "join" })));
    joined.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r)));
    assert.equal((await request(`/rooms/${id}`, users[0])).data.players.length, 6);
    assert(!(await request("/rooms")).data.some((r) => r.id === id));
    assert.equal((await request(`/rooms/${id}`)).data.company, undefined);
    assert.equal((await request(`/rooms/${id}/actions`, users[1], { kind: "start" })).status, 400);
    assert.equal((await request(`/rooms/${id}/actions`, users[0], { kind: "start" })).data.phase, "ready");
    const readied = await Promise.all(users.map((u) => request(`/rooms/${id}/actions`, u, { kind: "ready" })));
    readied.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r)));
    let current = (await request(`/rooms/${id}`, users[0])).data;
    assert.equal(current.phase, "day"); assert.equal(current.players.length, 6);
    assert.equal(current.players[0].weight, 2);
    assert.equal(current.players[1].report, undefined);
    const voted = await Promise.all(users.map((u) => request(`/rooms/${id}/actions`, u, { kind: "vote", choice: "A", phase: "day", day: 1 })));
    voted.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r)));
    current = (await request(`/rooms/${id}`, users[0])).data;
    assert.equal(current.phase, "night"); assert.equal(current.selected, "A");
    const managers = current.players.filter((p) => !["CEO", "Worker"].includes(p.role));
    const night = await Promise.all(managers.map((p) => request(`/rooms/${id}/actions`, users.find((u) => u.id === p.id), { kind: "action", choice: p.role === "Accounting Manager" ? "cash" : "execute", phase: "night", day: 1 })));
    night.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r)));
    current = (await request(`/rooms/${id}`, users[0])).data;
    assert.equal(current.phase, "results"); assert.equal(current.company.cash, 1000);
    assert.equal(current.history.length, 1);
    const reconnect = await request(`/rooms/${id}/heartbeat`, users[0], {});
    assert.equal(reconnect.status, 200); assert.equal(reconnect.data.company.cash, 1000);
    assert.equal((await Rooms.findOne({ id }).lean()).state.company.cash, 1000);
    assert.equal((await request(`/rooms/${id}/actions`, users[0], { kind: "vote", choice: "B", phase: "day", day: 1 })).status, 409);
    assert.equal((await request(`/rooms/${id}/actions`, users[0], { kind: "next", phase: "results", day: 1 })).data.day, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Clean only fixtures in this dedicated integration database.
    if (id) await Rooms.deleteOne({ id });
    await models.User.deleteMany({ id: { $in: users.map((u) => u.id) } });
    await mongoose.disconnect();
  }
});
