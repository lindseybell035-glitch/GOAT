const express = require("express");
const CompanyRoom = require("../db/companyRooms");
const models = require("../db/models");
const rules = require("../modules/companyGame");
const logger = require("../modules/logging")("company");
const router = express.Router();
const { randomUUID } = require("node:crypto");
const MAX_RETRIES = 8;

function userId(req) { return req.session.user?.id; }
async function identity(req) {
  if (!userId(req)) throw new Error("Please sign in to join a study room.");
  const user = await models.User.findOne({ id: userId(req) }).select("id name").lean();
  if (!user) throw new Error("Please sign in again.");
  return { id: user.id, name: user.name };
}
async function update(id, operation) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const doc = await CompanyRoom.findOne({ id }).lean();
    if (!doc) { const e = new Error("Study room not found."); e.status = 404; throw e; }
    const state = structuredClone(doc.state);
    operation(state);
    state.updatedAt = Date.now();
    const saved = await CompanyRoom.findOneAndUpdate({ id, version: doc.version }, {
      $set: { state, phase: state.phase, updatedAt: new Date() }, $inc: { version: 1 },
    }, { new: true }).lean();
    if (saved) return saved.state;
  }
  const e = new Error("The room changed. Please retry your action."); e.status = 409; throw e;
}
function handler(fn) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { await fn(req, res); }
    catch (e) {
      const databaseError = e.name?.includes("Mongo") || e.name === "MongooseError";
      if (databaseError) logger.error(e);
      res.status(databaseError ? 500 : e.status || (userId(req) ? 400 : 401)).json({ error: databaseError ? "Could not access the study room. Please retry." : e.message });
    }
  };
}
router.get("/rooms", handler(async (req, res) => {
  const docs = await CompanyRoom.find({ public: true, phase: { $in: ["waiting", "ready"] }, updatedAt: { $gt: new Date(Date.now() - 24 * 3600000) } })
    .sort({ updatedAt: -1 }).limit(40).lean();
  res.json(docs.map((d) => rules.view(d.state, null)));
}));
router.post("/rooms", handler(async (req, res) => {
  const user = await identity(req);
  const active = await CompanyRoom.countDocuments({ "state.hostId": user.id, phase: { $nin: ["ended", "closed"] } });
  if (active >= 3) throw new Error("You already host three active study rooms. Finish or leave a room first.");
  const state = rules.createRoom(user, req.body);
  await CompanyRoom.create({ id: state.id, public: state.settings.public, phase: state.phase, version: 0, state, updatedAt: new Date() });
  res.status(201).json(rules.view(state, user.id));
}));
router.get("/rooms/:id", handler(async (req, res) => {
  // GET reads never advance time or write state. A lightweight server sweep owns deadlines.
  const doc = await CompanyRoom.findOne({ id: req.params.id }).lean();
  if (!doc) { res.status(404).json({ error: "Study room not found." }); return; }
  res.json(rules.view(doc.state, userId(req)));
}));
router.post("/rooms/:id/actions", handler(async (req, res) => {
  const user = await identity(req);
  // Client supplies the expected phase/day; stale votes cannot be applied to a later round.
  const { kind, choice, text, phase, day } = req.body;
  const state = await update(req.params.id, (s) => {
    rules.tick(s);
    if (["vote", "action", "next"].includes(kind) && (phase !== s.phase || day !== s.day)) {
      const e = new Error("The phase changed. Review the current round and try again."); e.status = 409; throw e;
    }
    rules.apply(s, user, kind, { choice, text });
  });
  res.json(rules.view(state, user.id));
}));
router.post("/rooms/:id/heartbeat", handler(async (req, res) => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Sign in to reconnect." }); return; }
  const state = await update(req.params.id, (s) => {
    const p = s.players.find((p) => p.id === id && !p.bot);
    if (!p) throw new Error("Join this room first.");
    p.lastSeen = Date.now(); rules.tick(s);
  });
  res.json(rules.view(state, id));
}));

// A lease prevents multiple web workers from resolving the same deadlines concurrently.
// Room CAS protects transactions even if a sweep races with a player submission.
const leaseSchema = new (require("mongoose").Schema)({ _id: String, owner: String, expires: Number });
const Lease = require("mongoose").models.CompanyLease || require("mongoose").model("CompanyLease", leaseSchema);
const owner = randomUUID();
let sweeping = false;
const timer = setInterval(async () => {
  if (sweeping || require("mongoose").connection.readyState !== 1) return;
  sweeping = true;
  try {
    await Lease.updateOne({ _id: "company-tick" }, { $setOnInsert: { owner: "", expires: 0 } }, { upsert: true });
    const lease = await Lease.findOneAndUpdate({ _id: "company-tick", $or: [{ owner }, { expires: { $lte: Date.now() } }] }, { $set: { owner, expires: Date.now() + 5000 } }, { new: true });
    if (!lease) return;
    const docs = await CompanyRoom.find({ phase: { $in: ["ready", "opening", "day", "runoff", "night", "results"] } }).select("id").lean();
    for (const doc of docs) await update(doc.id, (s) => { rules.tick(s); });
  } catch (e) { logger.error(e); }
  finally { sweeping = false; }
}, 2000);
timer.unref();
module.exports = router;
