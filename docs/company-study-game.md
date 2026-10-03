# Cooperative company rooms

Grand Opening v1 runs alongside the existing game modes. `/study` hosts rooms; `/study/:id` is a persistent invitation. Public waiting rooms are also shown in the main lobby. The initial release has one curated setup, not a community setup editor or sabotage mode.

## Host settings

- Human capacity: 5, 10, 15. It is a ceiling, not a required start count.
- Zero to five scripted teammates. Bots fill missing manager roles and do not occupy human capacity or vote.
- At least four total participants cover CEO, Finance, Accounting, and Operations. Remaining participants are Workers. The host is CEO.
- Ready check optional, 60-second deadline, returns to waiting if someone does not confirm.
- Automatic start when human capacity fills optional; honors the ready-check setting.
- Day or night first; configurable meeting and night deadlines.

Human players all vote. For an even human count the CEO has weight two, otherwise one. Majority is greater than half of eligible human vote weight. Voting locks when all human players submit or the deadline ends. No majority triggers one runoff. Ties for entry into that runoff use declared A/B/C order; a failed runoff uses action C, with its consequences stated on screen. This is an initial deterministic rule that can be revised after testing.

Starting at night lets managers select initial financing, available equipment, and a report. All starting combinations have a tested successful route. Later nights carry out the approved Company Action; they do not permit managers to spend outside it. Worker and CEO roles have no night action. Missing manager actions default to the first displayed option. Absentees retain seats for reconnection; they are not kicked out or replaced during a session.

## Rules and storage

`modules/companyGame.js` owns the serializable state machine and financial calculations. The client submits IDs of supported actions, never financial totals. Study rooms retain a setup version, settings, role assignments, deadline, company state, votes, and a bounded message and result history in the `CompanyRoom` MongoDB collection.

`routes/company.js` uses existing sessions and CSRF protection. Writes use a version comparison so concurrent requests cannot silently overwrite one another or apply a financial action twice. A MongoDB lease coordinates the two-second deadline sweep. The browser polls every two seconds and sends heartbeat updates about every eight seconds. GET requests do not mutate state. Raw night submissions and other players' private reports are not returned by the API.

The first financial example is deliberately small: no depreciation is charged during the short session. Loan principal is due on Day 3; only the stated $100 bridge-loan fee applies. Public objectives and action previews are authoritative. Stability never falls just because a player disconnects: deadlines resolve according to the declared defaults.

## Verification

Run `npm run test:company` for the dependency-free rule tests. Run `node --test test-company/companyApi.integration.js` only in a development environment with MongoDB configured. Integration tests use a separate database suffixed `_company_integration` and isolated users; they never use production collections. Build the frontend with `cd react_main && npm run build`.

Manual checks: host solo with five bots, confirm readiness, complete all three days, reload mid-session, then use multiple signed-in accounts for joining, private reports, concurrent votes, host transfer before start, ready expiration, and disconnect/rejoin. A private room should not appear in the public list.

## Future work

Community role/modifier editing, larger scenario decks, alternate role selection, sabotage, stronger abuse controls, and realtime push transport remain separate work. This release uses the existing login and adds working cooperative room semantics before extending the legacy exact-size engine.
