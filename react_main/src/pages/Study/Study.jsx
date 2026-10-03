import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Box, Button, Checkbox, Chip, Divider, FormControlLabel, LinearProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { UserContext } from "../../Contexts";

const money = (n) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
const errorText = (e) => e.response?.data?.error || "Could not connect. Please retry.";

export function StudyLobbyCard({ compact = false }) {
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function poll() {
      try { const { data } = await axios.get("/api/company/rooms"); if (active) { setRooms(data); setError(""); } }
      catch (e) { if (active) setError(errorText(e)); }
    }
    poll(); const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <Paper variant="outlined" sx={{ p: 2 }}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
      <Typography variant="h6">Study rooms</Typography>
      <Button component={Link} to="/study" variant="contained">Host a study room</Button>
    </Stack>
    {error && <Alert severity="warning">{error}</Alert>}
    {!rooms.length && !error && <Typography sx={{ mt: 1 }}>No open study rooms. Host Grand Opening to begin.</Typography>}
    {rooms.slice(0, compact ? 5 : 40).map((room) => <Stack key={room.id} direction="row" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ py: 1 }}>
      <Box><Typography>{room.name} · {room.humanCount}/{room.settings.capacity} human seats</Typography><Typography variant="body2">{room.phase === "ready" ? "Ready check in progress" : "Open"} · {room.settings.botCount} bots · {room.settings.firstPhase} first</Typography></Box>
      <Button component={Link} to={`/study/${room.id}`}>{room.phase === "ready" ? "View room" : "Join"}</Button>
    </Stack>)}
  </Paper>;
}

export default function Study() {
  const { roomId } = useParams();
  return roomId ? <StudyRoom key={roomId} roomId={roomId} /> : <StudyHost />;
}

function StudyHost() {
  const user = useContext(UserContext);
  const navigate = useNavigate();
  const [settings, setSettings] = useState({ capacity: 10, botCount: 0, firstPhase: "night", readyCheck: true, autoStart: true, public: true, daySeconds: 120, nightSeconds: 45 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setSettings((old) => ({ ...old, [key]: value }));
  async function host() {
    setBusy(true); setError("");
    try { const { data } = await axios.post("/api/company/rooms", settings); navigate(`/study/${data.id}`); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  useEffect(() => { document.title = "Host a study room · Academic GOAT"; }, []);
  return <Stack spacing={2}>
    <Typography variant="h4">Grand Opening</Typography>
    <Typography>Cooperate to open a campus café. Four managers and additional workers share information, vote on Company Actions, and try to finish three days with the company intact.</Typography>
    <Alert severity="info">All roles are Town. Four total participants cover the managers. Bots fill selected seats without using your human capacity. For solo testing, select five bots.</Alert>
    {!user.loggedIn && <Alert severity="warning">Use Login or Register in the header before hosting.</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
        <TextField select label="Human capacity" value={settings.capacity} onChange={(e) => set("capacity", Number(e.target.value))}>{[5, 10, 15].map((n) => <MenuItem key={n} value={n}>{n} seats</MenuItem>)}</TextField>
        <TextField select label="Scripted bot teammates" value={settings.botCount} onChange={(e) => set("botCount", Number(e.target.value))}>{[0, 1, 2, 3, 4, 5].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}</TextField>
        <TextField select label="Starting phase" value={settings.firstPhase} onChange={(e) => set("firstPhase", e.target.value)}><MenuItem value="night">Night first</MenuItem><MenuItem value="day">Day first</MenuItem></TextField>
        <TextField select label="Meeting time" value={settings.daySeconds} onChange={(e) => set("daySeconds", Number(e.target.value))}>{[60, 120, 180, 300].map((n) => <MenuItem key={n} value={n}>{n} seconds</MenuItem>)}</TextField>
        <TextField select label="Night time" value={settings.nightSeconds} onChange={(e) => set("nightSeconds", Number(e.target.value))}>{[30, 45, 60, 90].map((n) => <MenuItem key={n} value={n}>{n} seconds</MenuItem>)}</TextField>
      </Box>
      <FormControlLabel control={<Checkbox checked={settings.public} onChange={(e) => set("public", e.target.checked)} />} label="Show in the main lobby (off = invitation link only)" />
      <FormControlLabel control={<Checkbox checked={settings.readyCheck} onChange={(e) => set("readyCheck", e.target.checked)} />} label="Require everyone to confirm ready" />
      <FormControlLabel control={<Checkbox checked={settings.autoStart} onChange={(e) => set("autoStart", e.target.checked)} />} label="Begin the ready check or start automatically when human seats fill" />
      <Button variant="contained" disabled={!user.loggedIn || busy} onClick={host}>{busy ? "Creating room…" : "Host Grand Opening"}</Button>
    </Stack></Paper>
    <StudyLobbyCard />
  </Stack>;
}

function StudyRoom({ roomId }) {
  const user = useContext(UserContext);
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const offset = useRef(0);
  const heartbeatAt = useRef(0);
  const roomRef = useRef(null);
  const pollBusy = useRef(false);
  const accept = useCallback((data) => {
    if (!mounted.current) return;
    if (data.serverNow) offset.current = data.serverNow - Date.now();
    roomRef.current = data; setRoom(data);
  }, []);
  const poll = useCallback(async () => {
    if (pollBusy.current) return;
    pollBusy.current = true;
    try {
      if (roomRef.current?.member && Date.now() - heartbeatAt.current > 7000 && user.loggedIn) {
        heartbeatAt.current = Date.now();
        const { data } = await axios.post(`/api/company/rooms/${roomId}/heartbeat`); accept(data);
      } else { const { data } = await axios.get(`/api/company/rooms/${roomId}`); accept(data); }
    } catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { pollBusy.current = false; }
  }, [roomId, user.loggedIn, accept]);
  useEffect(() => {
    mounted.current = true; document.title = "Grand Opening · Academic GOAT";
    poll(); const refresh = setInterval(poll, 2000); const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(refresh); clearInterval(clock); };
  }, [poll]);
  async function act(kind, extra = {}) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const { data } = await axios.post(`/api/company/rooms/${roomId}/actions`, { kind, phase: room.phase, day: room.day, ...extra }); accept(data);
      if (kind === "chat") setText("");
      if (kind === "leave") navigate("/study");
    } catch (e) { setError(errorText(e)); await poll(); }
    finally { if (mounted.current) setBusy(false); }
  }
  if (!room) return <Stack spacing={2}><Typography>Loading study room…</Typography>{error && <Alert severity="error">{error}</Alert>}<Button onClick={poll}>Retry</Button></Stack>;
  const host = room.hostId === user.id;
  const waiting = ["waiting", "ready"].includes(room.phase);
  const night = ["night", "opening"].includes(room.phase);
  const seconds = room.deadline ? Math.max(0, Math.ceil((room.deadline - now - offset.current) / 1000)) : null;
  const phase = { waiting: "Waiting room", ready: "Ready check", opening: "Night 0", day: `Day ${room.day}`, runoff: `Day ${room.day} · runoff`, night: `Night ${room.day}`, results: `Day ${room.day} · results`, ended: "Session complete", closed: "Room closed" }[room.phase];
  return <Stack spacing={2}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
      <Typography variant="h5">Grand Opening</Typography>
      <Stack direction="row" gap={1}><Button component={Link} to="/play">Main lobby</Button><Button onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/study/${roomId}`); setCopied(true); } catch (_) { setError("Select and copy the invitation link below."); } }}>{copied ? "Link copied" : "Copy invite link"}</Button></Stack>
    </Stack>
    {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
    <TextField size="small" label="Invitation link" value={`${window.location.origin}/study/${roomId}`} InputProps={{ readOnly: true }} />
    {!room.member ? <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
      <Typography>{room.humanCount}/{room.settings.capacity} human players · {room.settings.botCount} bots</Typography>
      {!user.loggedIn && <Alert severity="info">Sign in using the header, then join. The invitation stays on this page.</Alert>}
      <Button variant="contained" disabled={!user.loggedIn || busy || room.phase !== "waiting"} onClick={() => act("join")}>{room.phase === "waiting" ? "Join study room" : "Room has started or is checking readiness"}</Button>
    </Stack></Paper> : <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0,1fr) 310px" }, gap: 2, alignItems: "start" }}>
      <Stack spacing={2}>
        {waiting && <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
          <Typography variant="h6">{room.humanCount}/{room.settings.capacity} human seats · {room.settings.botCount} bots</Typography>
          <Typography>Start below capacity when at least four humans and bots cover the managers. Roles are assigned at start: CEO, Finance Manager, Accounting Manager, Operations Manager, then Workers.</Typography>
          {host && room.phase === "waiting" && <Button variant="contained" disabled={busy || room.humanCount + room.settings.botCount < 4} onClick={() => act("start")}>Start with current players</Button>}
          {room.phase === "ready" && <Button variant="contained" disabled={busy || room.me.ready} onClick={() => act("ready")}>{room.me.ready ? "You are ready" : "I’m ready"}</Button>}
          {host && room.phase === "ready" && <Button disabled={busy} onClick={() => act("cancelReady")}>Cancel ready check</Button>}
          <Button disabled={busy} onClick={() => act("leave")}>Leave room</Button>
        </Stack></Paper>}
        {!waiting && <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
          <Typography variant="h6">{room.phase === "ended" ? (room.won ? "Town wins!" : "Town loses") : room.title}</Typography>
          <Stack direction="row" gap={1} flexWrap="wrap"><Chip label={`Cash ${money(room.company.cash)}`} /><Chip label={`Debt ${money(room.company.debt)}`} /><Chip label={`Capacity ${room.company.capacity}`} /></Stack>
          <Typography>Receivables: {money(room.company.receivable)} · unpaid bills: {money(room.company.unpaid)}</Typography>
          {room.me.report && <Alert severity="info"><strong>Your role: {room.me.role}</strong><br />{room.me.report}</Alert>}
          {room.phase === "opening" && <Typography>Managers choose starting funding, equipment availability, and a report. Owner funding is $8,000 for basic or $10,000 for premium; an optional $2,000 loan is due on Day 3.</Typography>}
          {room.phase === "ended" && <Typography>Winning requires stability above zero, $1,000 cash, 80-order capacity, and no remaining debt or unpaid bills. No depreciation is charged during this short session.</Typography>}
        </Stack></Paper>}
        {room.result && ["results", "ended"].includes(room.phase) && <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
          <Typography variant="h6">Company Action Results</Typography>
          {room.result.log.map((line, i) => <Typography key={i}>{line}</Typography>)}
          <Typography>{room.result.goal ? "Objective met. Stability unchanged." : "Objective missed. Stability fell by one."}</Typography>
          {room.phase === "results" && host && <Button disabled={busy} onClick={() => act("next")}>{room.day === 3 || room.stability === 0 ? "Show Town result" : "Next morning"}</Button>}
        </Stack></Paper>}
        <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
          <Typography variant="h6">Meeting</Typography>
          {room.messages.slice(-25).map((m) => <Box key={m.id} sx={{ borderBottom: 1, borderColor: "divider", pb: 1, overflowWrap: "anywhere" }}><Typography variant="body2" color="text.secondary">{m.name}</Typography><Typography>{m.text}</Typography></Box>)}
          {!night && room.phase !== "closed" ? <Box component="form" onSubmit={(e) => { e.preventDefault(); act("chat", { text }); }} sx={{ display: "flex", gap: 1 }}>
            <TextField fullWidth size="small" label="Share your findings" value={text} onChange={(e) => setText(e.target.value)} inputProps={{ maxLength: 500 }} />
            <Button type="submit" disabled={busy || !text.trim()}>Send</Button>
          </Box> : <Typography variant="body2">Meeting chat is closed during night. Share your report next morning.</Typography>}
        </Stack></Paper>
        {room.history.length > 0 && <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6">Decision history</Typography>{room.history.map((h) => <Typography key={h.day}>Day {h.day}: Company Action {h.action} · {h.goal ? "objective met" : "objective missed"} · cash {money(h.company.cash)}</Typography>)}</Paper>}
      </Stack>
      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
          <Typography variant="h6">{phase}{seconds !== null ? ` · ${seconds}s` : ""}</Typography>
          {!waiting && <><Typography>Company Stability: {room.stability}/3</Typography><LinearProgress variant="determinate" value={room.stability / 3 * 100} /><Typography fontWeight="bold">Objectives</Typography><Typography>{room.objective}</Typography></>}
        </Stack></Paper>
        <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6">Players</Typography>{room.players.map((p) => <Stack key={p.id} direction="row" justifyContent="space-between" gap={1} sx={{ py: 1 }}>
          <Box><Typography>{p.name}{p.id === user.id ? " (you)" : ""}</Typography><Typography variant="body2">{p.role || "Role assigned at start"}{p.bot ? " · bot" : p.weight === 2 ? " · vote ×2" : ""}</Typography><Typography variant="caption">{p.bot ? "Scripted teammate · no vote" : waiting ? (p.ready ? "Ready" : "Not ready") : p.connected ? "Connected" : "Reconnecting"}</Typography></Box>
          <Typography>{p.vote || (night && p.submitted ? "✓" : "")}</Typography>
        </Stack>)}</Paper>
        <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1}>
          <Typography variant="h6">{night ? "Night actions" : "Company Actions"}</Typography>
          {room.actions.length > 0 && <><Typography variant="body2">{room.majority} vote points approve. Vote when ready; everyone voting or the timer ending locks the round.</Typography>{room.actions.map((a) => <Button key={a.id} variant={room.me.vote === a.id ? "contained" : "outlined"} disabled={busy || !a.available} onClick={() => act("vote", { choice: a.id })} sx={{ textAlign: "left", justifyContent: "flex-start" }}>
            <Box>{a.id} · {a.label}<Typography component="span" display="block" variant="body2">{room.tally[a.id]} points · {a.available ? `projected cash ${money(a.projectedCash)}` : a.reason}</Typography>{room.players.filter((p) => p.vote === a.id).map((p) => p.name).join(", ")}</Box>
          </Button>)}<Typography variant="caption">{room.fallback} Runoff entry ties use A, B, C order.</Typography></>}
          {night && <>{room.me.nightOptions.map((a) => <Button key={a.id} variant={room.me.action === a.id ? "contained" : "outlined"} disabled={busy || !!room.me.action} onClick={() => act("action", { choice: a.id })}>{a.label}</Button>)}<Typography variant="body2">{room.me.action ? "Action submitted. Waiting for other managers." : room.me.nightOptions.length ? "Choose your action. Missing submissions use the displayed first option at the deadline." : "Your role has no night action. Wait for managers to finish."}</Typography></>}
          {!night && !room.actions.length && <Typography variant="body2">{waiting ? "Company Actions appear when the session starts." : "Voting is closed."}</Typography>}
          {room.selected && night && <Typography>Approved Company Action: {room.selected}</Typography>}
          {room.phase === "ended" && <Button component={Link} to="/study">Host another session</Button>}
        </Stack></Paper>
      </Stack>
    </Box>}
  </Stack>;
}
