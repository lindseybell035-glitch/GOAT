// Server-owned, JSON-serializable rules. No browser input controls money or outcomes.
const { randomUUID } = require("node:crypto");
const ROLES = ["CEO", "Finance Manager", "Accounting Manager", "Operations Manager"];
const MONEY = (n) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
function requireRule(ok, message) { if (!ok) throw new Error(message); }
function announce(room, text, now) {
  room.messages.push({ id: randomUUID(), name: "Company", text, time: now });
  room.messages = room.messages.slice(-200);
}
function duration(room, phase) {
  return (phase === "day" || phase === "runoff" ? room.settings.daySeconds : room.settings.nightSeconds) * 1000;
}
function enter(room, phase, now) {
  room.phase = phase;
  room.deadline = now + duration(room, phase);
  room.votes = {};
  room.actions = {};
}
function createRoom(host, input = {}, now = Date.now()) {
  const capacity = Number(input.capacity ?? 10);
  const botCount = Number(input.botCount ?? 0);
  const daySeconds = Number(input.daySeconds ?? 120);
  const nightSeconds = Number(input.nightSeconds ?? 45);
  requireRule([5, 10, 15].includes(capacity), "Choose a capacity of 5, 10, or 15.");
  requireRule(Number.isInteger(botCount) && botCount >= 0 && botCount <= 5, "Choose zero to five bots.");
  requireRule([60, 120, 180, 300].includes(daySeconds), "Invalid meeting duration.");
  requireRule([30, 45, 60, 90].includes(nightSeconds), "Invalid night duration.");
  requireRule(["day", "night"].includes(input.firstPhase ?? "night"), "Invalid starting phase.");
  const room = {
    id: randomUUID(), setup: "grand-opening-v1", setupVersion: 1,
    name: "Grand Opening", hostId: host.id,
    settings: { capacity, botCount, daySeconds, nightSeconds,
      readyCheck: input.readyCheck !== false, autoStart: input.autoStart !== false,
      public: input.public !== false, firstPhase: input.firstPhase ?? "night" },
    phase: "waiting", deadline: null, createdAt: now, updatedAt: now,
    players: [{ id: host.id, name: host.name, bot: false, ready: false, lastSeen: now }],
    day: 1, stability: 3,
    company: { cash: 8000, debt: 0, capacity: 0, equipment: 0, receivable: 0, unpaid: 0 },
    opening: { funding: "owners", equipment: "basic", report: "cash" },
    votes: {}, actions: {}, messages: [], history: [], selected: null, result: null,
  };
  announce(room, "Grand Opening: all players are Town. Finish three days with stability remaining, bills paid, debt repaid, capacity of 80, and $1,000 cash. Bots do not use human seats.", now);
  return room;
}
function humans(room) { return room.players.filter((p) => !p.bot); }
function member(room, id) {
  const player = room.players.find((p) => p.id === id);
  requireRule(player, "Join this room first.");
  return player;
}
function requestStart(room, now) {
  requireRule(humans(room).length + room.settings.botCount >= 4,
    "Four participants are required to cover the managers. Add bots when hosting or invite more players.");
  if (room.settings.readyCheck) {
    room.phase = "ready";
    room.deadline = now + 60000;
    room.players.forEach((p) => { p.ready = false; });
    announce(room, "Ready check: every player must confirm within 60 seconds. Unconfirmed checks return to the waiting room.", now);
  } else begin(room, now);
}
function begin(room, now) {
  requireRule(humans(room).length + room.settings.botCount >= 4, "Four participants are required.");
  room.players = humans(room);
  for (let i = 0; i < room.settings.botCount; i++) {
    room.players.push({ id: `bot-${room.id}-${i}`, name: `Teammate ${i + 1}`, bot: true, ready: true });
  }
  room.players.forEach((p, i) => { p.role = ROLES[i] || "Worker"; });
  announce(room, "Roles assigned. Human players vote; bots share information and fill missing manager actions. In solo play, you decide the Company Action.", now);
  if (room.settings.firstPhase === "night") {
    enter(room, "opening", now);
    announce(room, "Night 0: Finance selects funding, Operations selects the available equipment, and Accounting selects a private report. These starting choices do not spend company cash.", now);
    runBots(room, now);
  } else startDay(room, now);
}
function objective(room) {
  return room.day === 1 ? "Serve 60 orders, pay $3,000 payroll, and keep $1,000 cash."
    : room.day === 2 ? "Pay the $2,000 supplier bill and keep $1,000 cash."
    : "Repay all debt due today, serve 80 orders, pay any overdue supplier bill, and keep $1,000 cash.";
}
function title(room) {
  return ["Open the café", "Sales arrived. Cash didn’t.", "A useful final purchase"][room.day - 1];
}
function nightOptions(room, player) {
  if (room.phase === "opening") {
    if (player.role === "Finance Manager") return [{ id: "owners", label: "Owner funding only" }, { id: "loan", label: "Owner funding + $2,000 loan due on Day 3 (no fee or interest)" }];
    if (player.role === "Operations Manager") return [{ id: "basic", label: "Basic equipment available: $4,000, 60 orders" }, { id: "premium", label: "Premium equipment available: $6,000, 80 orders" }];
    if (player.role === "Accounting Manager") return [{ id: "cash", label: "Review the cash forecast" }, { id: "assets", label: "Review the asset report" }];
  }
  if (room.phase === "night") {
    if (player.role === "Accounting Manager") return [{ id: "cash", label: "Reconcile cash and financing" }, { id: "assets", label: "Review assets and receivables" }];
    if (["Finance Manager", "Operations Manager"].includes(player.role)) return [{ id: "execute", label: player.role === "Finance Manager" ? "Authorize only the approved funding and payments" : "Carry out the approved Company Action" }];
  }
  return [];
}
function runBots(room, now) {
  if (!["opening", "night"].includes(room.phase)) return;
  for (const p of room.players.filter((p) => p.bot)) {
    const options = nightOptions(room, p);
    if (options.length) room.actions[p.id] = options[0].id;
  }
}
function preview(room, id) {
  const c = { ...room.company };
  const log = [];
  let goal = false;
  if (room.day === 1) {
    const price = id === "A" ? (room.opening.equipment === "basic" ? 4000 : 6000) : id === "B" ? 1000 : 0;
    requireRule(c.cash >= price + 3000, "Not enough cash for this action and mandatory payroll.");
    c.cash -= price + 3000;
    if (id === "A") { c.capacity = room.opening.equipment === "basic" ? 60 : 80; c.equipment += price; }
    log.push(`Paid $3,000 payroll. ${id === "A" ? `Bought equipment for ${MONEY(price)}.` : id === "B" ? "Spent $1,000 on advertising; no equipment bought." : "No equipment bought."}`);
    goal = c.capacity >= 60 && c.cash >= 1000;
  } else if (room.day === 2) {
    if (id === "A") { c.cash += 3800; c.receivable = 0; log.push("Collected $3,800 and settled the $4,000 invoice with a $200 discount."); }
    if (id === "B") {
      const shortfall = Math.max(0, 3000 - c.cash);
      const loan = shortfall ? shortfall + 100 : 0;
      requireRule(loan <= 6000, "Required borrowing exceeds the $6,000 credit limit.");
      c.cash += loan - (loan ? 100 : 0); c.debt += loan;
      log.push(loan ? `Borrowed ${MONEY(loan)} and paid a $100 fee. Principal is due on Day 3; no additional interest.` : "Existing cash is enough; no loan or fee needed.");
    }
    if (c.cash >= 2000) { c.cash -= 2000; log.push("Paid the supplier $2,000."); }
    else { c.unpaid += 2000; log.push("Supplier bill unpaid: $2,000 remains due. Stability falls; recovery is possible next day."); }
    goal = c.unpaid === 0 && c.cash >= 1000;
  } else {
    const price = id === "A" ? 1500 : id === "B" ? 2500 : 0;
    requireRule(c.cash >= c.debt + c.unpaid + price, "Not enough cash to repay obligations and fund this purchase.");
    c.cash -= c.debt + c.unpaid + price;
    log.push(`Repaid ${MONEY(c.debt)} debt and ${MONEY(c.unpaid)} overdue bills.`);
    c.debt = 0; c.unpaid = 0;
    if (id === "A") { c.capacity += 20; c.equipment += price; log.push("Bought a $1,500 prep station: capacity +20."); }
    if (id === "B") { c.equipment += price; log.push("Bought a $2,500 designer display: no additional capacity."); }
    goal = c.capacity >= 80 && c.cash >= 1000;
  }
  return { company: c, log, goal };
}
function companyActions(room) {
  const labels = room.day === 1 ? [`Buy ${room.opening.equipment} equipment`, "Spend $1,000 on advertising", "Postpone equipment"]
    : room.day === 2 ? ["Collect $3,800 now with a $200 discount", "Borrow only the cash shortfall ($100 fee)", "Wait for customer payment"]
    : ["Buy $1,500 prep station (+20 capacity)", "Buy $2,500 designer display (+0 capacity)", "Buy nothing; repay obligations"];
  return ["A", "B", "C"].map((id, i) => {
    try { const p = preview(room, id); return { id, label: labels[i], available: true, projectedCash: p.company.cash }; }
    catch (e) { return { id, label: labels[i], available: false, reason: e.message }; }
  });
}
function privateReport(room, role) {
  if (role === "Finance Manager") return room.day === 1 ? "Payroll of $3,000 is due tonight. No new borrowing is available today." : room.day === 2 ? "Bridge borrowing is limited to $6,000. A $100 fee is paid only if a new loan is drawn. Principal is due on Day 3." : "All principal and any overdue supplier bill must be paid tonight. No further borrowing.";
  if (role === "Operations Manager") return room.day === 1 ? "Basic equipment supports 60 orders; premium supports 80. Advertising alone cannot open the café." : room.day === 2 ? "A $2,000 supplier bill is due tonight. Missing it risks deliveries." : "The prep station adds 20-order capacity. The designer display adds none.";
  if (role === "Accounting Manager") return room.day === 1 ? "Equipment purchases exchange cash for an asset. Advertising and payroll are expenses. Owner funding and loans are not sales." : room.day === 2 ? "The $4,000 catering sale is already recorded as revenue and a receivable. It has not yet provided cash." : "Collection of an earlier invoice is not new sales revenue. Repaying debt reduces cash and liabilities.";
  if (role === "Worker") return room.day === 1 ? "Customers need enough equipment to serve 60 orders. An attractive advertisement is not a substitute." : room.day === 2 ? "The customer accepted the catering order and can pay early for a discount." : "The final demand target is 80 orders. Useful capacity matters more than appearance.";
  return "Hear each department’s findings before voting. Your job is to coordinate a Company Action that meets the objectives.";
}
function startDay(room, now) {
  enter(room, "day", now); room.runoff = null; room.selected = null;
  announce(room, `Day ${room.day}: ${title(room)}. Objectives: ${objective(room)}`, now);
  for (const p of room.players.filter((p) => p.bot)) announce(room, `${p.name} (${p.role}): ${privateReport(room, p.role)}`, now);
}
function weight(room, player) { return player.bot ? 0 : humans(room).length % 2 === 0 && player.role === "CEO" ? 2 : 1; }
function tally(room) {
  const counts = { A: 0, B: 0, C: 0 };
  for (const p of humans(room)) if (room.votes[p.id]) counts[room.votes[p.id]] += weight(room, p);
  return counts;
}
function voteResult(room, now) {
  const counts = tally(room);
  const majority = Math.floor(humans(room).reduce((n, p) => n + weight(room, p), 0) / 2) + 1;
  const valid = companyActions(room).filter((a) => a.available && (!room.runoff || room.runoff.includes(a.id)));
  const winner = valid.find((a) => counts[a.id] >= majority);
  if (winner) {
    room.selected = winner.id; enter(room, "night", now); runBots(room, now);
    announce(room, `Company Action ${winner.id} approved (${counts[winner.id]} vote points). Managers execute this action tonight.`, now);
    return;
  }
  if (room.phase === "day" && Object.values(counts).some((n) => n > 0) && valid.length > 1) {
    // One declared tie-break order A, B, C resolves entry into the runoff, not its winner.
    const leaders = valid.map((a) => a.id).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).slice(0, 2);
    enter(room, "runoff", now); room.runoff = leaders;
    announce(room, `No majority. Runoff: ${leaders.join(" and ")}. Tied entry is ordered A, B, C. A failed runoff uses no new action; its consequences are shown in the panel.`, now);
  } else {
    room.selected = "C"; enter(room, "night", now); runBots(room, now);
    announce(room, "No majority: the declared fallback C applies. Mandatory payments still apply. Managers prepare the result.", now);
  }
}
function finishNight(room, now) {
  if (room.phase === "opening") {
    for (const p of room.players) {
      const v = room.actions[p.id];
      if (p.role === "Finance Manager") room.opening.funding = v || "owners";
      if (p.role === "Operations Manager") room.opening.equipment = v || "basic";
      if (p.role === "Accounting Manager") room.opening.report = v || "cash";
    }
    room.company.cash = (room.opening.equipment === "premium" ? 10000 : 8000) + (room.opening.funding === "loan" ? 2000 : 0);
    room.company.debt = room.opening.funding === "loan" ? 2000 : 0;
    announce(room, `Opening settled: ${MONEY(room.company.cash)} cash, ${MONEY(room.company.debt)} debt. Owners contributed ${room.opening.equipment === "premium" ? "$10,000" : "$8,000"}. Equipment remains unpurchased.`, now);
    startDay(room, now); return;
  }
  let result;
  try { result = preview(room, room.selected); }
  catch (_) {
    // A failed mandatory debt payment should end in a declared loss, not an exception/crash.
    result = { company: { ...room.company }, goal: false, log: ["The company could not fund its mandatory obligations. No new purchase was made."] };
  }
  room.company = result.company;
  if (!result.goal) room.stability = Math.max(0, room.stability - 1);
  room.result = { day: room.day, action: room.selected, ...result, stability: room.stability };
  room.history.push(room.result);
  announce(room, `${result.log.join(" ")} ${result.goal ? "Objective met; stability unchanged." : "Objective missed; stability −1."}`, now);
  enter(room, "results", now); room.deadline = now + 20000;
}
function nextDay(room, now) {
  if (room.stability === 0 || room.day === 3) {
    const c = room.company;
    room.phase = "ended"; room.deadline = null;
    room.won = room.stability > 0 && c.cash >= 1000 && c.debt === 0 && c.unpaid === 0 && c.capacity >= 80;
    announce(room, room.won ? "Town wins! The café met its final obligations and service goals." : "Town loses. Review the decision history to see which objectives were missed.", now);
    return;
  }
  room.day++;
  if (room.day === 2) room.company.receivable = 4000;
  if (room.day === 3 && room.company.receivable) {
    room.company.cash += room.company.receivable; room.company.receivable = 0;
    announce(room, "The customer paid the outstanding $4,000 invoice. Cash rises; no new sales revenue is recorded.", now);
  }
  startDay(room, now);
}
function tick(room, now = Date.now()) {
  if (room.phase === "ready") {
    if (humans(room).every((p) => p.ready)) begin(room, now);
    else if (now >= room.deadline) { room.phase = "waiting"; room.deadline = null; announce(room, "Ready check expired. Host can try again; no player was removed.", now); }
  } else if (["opening", "night"].includes(room.phase)) {
    const actors = room.players.filter((p) => nightOptions(room, p).length);
    if (actors.every((p) => room.actions[p.id]) || now >= room.deadline) finishNight(room, now);
  } else if (["day", "runoff"].includes(room.phase)) {
    if (humans(room).every((p) => room.votes[p.id]) || now >= room.deadline) voteResult(room, now);
  } else if (room.phase === "results" && now >= room.deadline) nextDay(room, now);
  return room;
}
function apply(room, user, kind, data = {}, now = Date.now()) {
  tick(room, now);
  if (kind === "join") {
    if (room.players.some((p) => p.id === user.id)) return room;
    requireRule(room.phase === "waiting", "This room is no longer accepting players.");
    requireRule(humans(room).length < room.settings.capacity, "This room is full.");
    room.players.push({ id: user.id, name: user.name, bot: false, ready: false, lastSeen: now });
    announce(room, `${user.name} joined.`, now);
    if (room.settings.autoStart && humans(room).length === room.settings.capacity) requestStart(room, now);
    return room;
  }
  const p = member(room, user.id); p.lastSeen = now;
  if (kind === "leave") {
    requireRule(["waiting", "ready", "ended"].includes(room.phase), "A started seat is kept for reconnecting. You can return using the same link.");
    room.players = room.players.filter((x) => x.id !== user.id);
    if (room.phase === "ready") { room.phase = "waiting"; room.deadline = null; room.players.forEach((x) => { x.ready = false; }); }
    if (room.hostId === user.id) room.hostId = humans(room)[0]?.id || null;
    if (!humans(room).length) { room.phase = "closed"; room.deadline = null; }
  } else if (kind === "start") {
    requireRule(user.id === room.hostId && room.phase === "waiting", "Only the host can start a waiting room."); requestStart(room, now);
  } else if (kind === "ready") {
    requireRule(room.phase === "ready", "No ready check is active."); p.ready = true;
  } else if (kind === "cancelReady") {
    requireRule(user.id === room.hostId && room.phase === "ready", "Only the host can cancel this check.");
    room.phase = "waiting"; room.deadline = null; room.players.forEach((x) => { x.ready = false; });
  } else if (kind === "vote") {
    requireRule(["day", "runoff"].includes(room.phase), "Voting is closed.");
    requireRule(companyActions(room).some((a) => a.id === data.choice && a.available), "This Company Action is unavailable.");
    requireRule(!room.runoff || room.runoff.includes(data.choice), "Choose an action in the runoff.");
    room.votes[user.id] = data.choice;
  } else if (kind === "action") {
    requireRule(nightOptions(room, p).some((a) => a.id === data.choice), "Your role cannot perform that action now.");
    room.actions[user.id] = data.choice;
  } else if (kind === "next") {
    requireRule(user.id === room.hostId && room.phase === "results", "Only the host can advance the results."); nextDay(room, now);
  } else if (kind === "chat") {
    requireRule(!["opening", "night", "closed"].includes(room.phase), "Meeting chat is closed at night.");
    requireRule(typeof data.text === "string" && data.text.trim().length > 0 && data.text.length <= 500, "Use a message of 1–500 characters.");
    requireRule(!p.lastChat || now - p.lastChat >= 750, "Please wait before sending another message.");
    p.lastChat = now; room.messages.push({ id: randomUUID(), name: p.name, text: data.text.trim(), time: now }); room.messages = room.messages.slice(-200);
  } else throw new Error("Unknown room action.");
  tick(room, now);
  return room;
}
function view(room, userId, now = Date.now()) {
  const me = room.players.find((p) => p.id === userId);
  const lobby = ["waiting", "ready"].includes(room.phase);
  const summary = { id: room.id, name: room.name, phase: room.phase, settings: room.settings, humanCount: humans(room).length, hostId: room.hostId, createdAt: room.createdAt };
  if (!me) return { ...summary, member: false };
  const counts = tally(room);
  return { ...summary, member: true, serverNow: now, deadline: room.deadline, day: room.day, stability: room.stability,
    company: room.company, objective: objective(room), title: title(room), won: room.won,
    players: room.players.map((p) => ({ id: p.id, name: p.name, role: p.role, bot: p.bot, ready: p.ready,
      vote: room.votes[p.id] || null, weight: lobby ? null : weight(room, p), submitted: !!room.actions[p.id],
      connected: p.bot || (now - p.lastSeen < 15000) })),
    me: { id: me.id, role: me.role, ready: me.ready, vote: room.votes[me.id] || null,
      action: room.actions[me.id] || null, report: lobby ? null : privateReport(room, me.role),
      nightOptions: nightOptions(room, me) },
    actions: ["day", "runoff"].includes(room.phase) ? companyActions(room).filter((a) => !room.runoff || room.runoff.includes(a.id)) : [],
    tally: counts, majority: Math.floor(humans(room).reduce((n, p) => n + weight(room, p), 0) / 2) + 1,
    selected: room.selected, result: room.result, history: room.history, messages: room.messages,
    fallback: "If no action passes after one runoff, C applies: no new purchase or borrowing; mandatory payments still apply. Missing an objective costs stability.",
    // Raw night submissions and other players' reports are intentionally not returned.
  };
}
module.exports = { createRoom, apply, tick, view, preview, companyActions, weight, tally, nightOptions };
