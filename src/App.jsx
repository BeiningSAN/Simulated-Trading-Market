// App.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Users, Cast, Smartphone, Play, RefreshCw } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";

import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  child,
  set,
  get,
  update,
  onValue,
} from "firebase/database";

// =========== Fill in your Firebase Realtime Database config ===========
const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  databaseURL: "",
};
// You can find these in your Firebase console.
// If you leave them empty, the app will still work in pure local mode
// (no phone sync, only host on this computer).

let firebaseApp = null;
let db = null;

if (
  FIREBASE_CONFIG.apiKey &&
  FIREBASE_CONFIG.databaseURL &&
  FIREBASE_CONFIG.projectId
) {
  firebaseApp = initializeApp(FIREBASE_CONFIG);
  db = getDatabase(firebaseApp);
}

// ====== Helpers ======
const INITIAL_PRICE = 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = () => Math.random().toString(36).slice(2, 9);
const roomId = () =>
  Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(0, 6).toUpperCase();

// Simple news pool (you can edit the texts)
const NEWS_POOL = [
  { text: "Central bank cuts rates, markets turn optimistic.", impact: 0.05 },
  { text: "Rumors of a major default trigger panic selling.", impact: -0.07 },
  {
    text: "Earnings strongly beat expectations, analysts upgrade targets.",
    impact: 0.08,
  },
  {
    text: "Geopolitical tensions escalate, risk-off mood in markets.",
    impact: -0.06,
  },
  { text: "No major news: markets relatively calm.", impact: 0.0 },
];

function computeDelta(pb, ps) {
  // pb = proportion of Buy, ps = proportion of Sell
  const TH = 0.4; // above 40% = strong signal
  const UP = 0.06; // +6%
  const DOWN = -0.06; // -6%
  if (pb > TH && pb > ps) return UP;
  if (ps > TH && ps > pb) return DOWN;
  return 0; // neutral
}

function App() {
  // Core game state
  const [price, setPrice] = useState(INITIAL_PRICE);
  const [round, setRound] = useState(1);
  const [history, setHistory] = useState([{ round: 0, price: INITIAL_PRICE }]);
  const [news, setNews] = useState("");
  const [newsImpact, setNewsImpact] = useState(0); // extra move from news
  const [locked, setLocked] = useState(false); // lock choices during settlement

  // 10s countdown for each news
  const [countdown, setCountdown] = useState(0); // 0 = no countdown
  const [isCounting, setIsCounting] = useState(false);

  // Players table (only displayed on Host side; Client uses myPlayer)
  // players come from Firebase: rooms/<room>/players
  const [players, setPlayers] = useState([]); // [{id, name, capital, choice}]
  const [weighted, setWeighted] = useState(false); // reserved for future use

  // Realtime: role & room
  const [role, setRole] = useState("host"); // "host" | "client"
  const [room, setRoom] = useState("");
  const [roomUrl, setRoomUrl] = useState("");
  const [clientName, setClientName] = useState("");
  const [playerId, setPlayerId] = useState(null);
  const [myPlayer, setMyPlayer] = useState(null); // Client's own player record

  // ===== Derived: current round Buy / Hold / Sell proportions =====
  const totals = useMemo(() => {
    if (!players || players.length === 0) {
      return {
        buy: 0,
        hold: 0,
        sell: 0,
        pb: 0,
        ps: 0,
      };
    }
    const buy = players.filter((p) => p.choice === "B").length;
    const hold = players.filter((p) => p.choice === "H").length;
    const sell = players.filter((p) => p.choice === "S").length;
    const n = players.length || 1;
    const pb = buy / n;
    const ps = sell / n;
    return { buy, hold, sell, pb, ps };
  }, [players]);

  // ========== Host: create room & subscribe players ==========
  const hostCreateRoom = () => {
    const id = roomId();
    setRoom(id);
    if (typeof window !== "undefined") {
      const origin = window.location.origin;
      const path = window.location.pathname;
      setRoomUrl(`${origin}${path}?join=${id}`);
    }
    // optional: write a small meta node
    if (db) {
      set(ref(db, `rooms/${id}/meta`), {
        createdAt: Date.now(),
      });
    }
  };

  // Host subscribes to players list (any client join/update goes here)
  useEffect(() => {
    if (!db) return;
    if (role !== "host" || !room) return;
    const playersRef = ref(db, `rooms/${room}/players`);
    const unsub = onValue(playersRef, (snap) => {
      const val = snap.val() || {};
      const arr = Object.values(val);
      setPlayers(arr);
    });
    return () => unsub();
  }, [role, room]);

  // ========== Client: join room & subscribe to own player ==========
  const clientJoinRoom = async (id) => {
    if (!db) return;
    const roomIdUpper = (id || "").toUpperCase();
    if (!roomIdUpper) return;
    setRoom(roomIdUpper);

    const playersRef = ref(db, `rooms/${roomIdUpper}/players`);

    // Try reuse local playerId (so refresh doesn't create a new account)
    let pid = localStorage.getItem(`mpg_${roomIdUpper}_playerId`);
    if (pid) {
      const snap = await get(child(playersRef, pid));
      if (!snap.exists()) {
        pid = null;
      }
    }

    // If no existing player, create a new one
    if (!pid) {
      pid = uid();
      const safeName =
        (clientName || "").trim() || `Player-${pid.slice(0, 4)}`;
      await set(child(playersRef, pid), {
        id: pid,
        name: safeName,
        capital: 100,
        choice: null,
      });
      localStorage.setItem(`mpg_${roomIdUpper}_playerId`, pid);
    }

    setPlayerId(pid);

    // Subscribe to own player node
    const unsub = onValue(child(playersRef, pid), (snap) => {
      const p = snap.val();
      if (p) setMyPlayer(p);
    });

    // On room change, effect will be re-run and old subscription cleaned up
    return () => unsub();
  };

  // If URL has ?join=XXXX, auto-join as client
  useEffect(() => {
    if (!db) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const j = params.get("join");
    if (j) {
      setRole("client");
      clientJoinRoom(j);
    }
  }, []);

  // ========= Client: send choice (Buy / Hold / Sell) ==========
  const clientSendChoice = async (choice) => {
    if (!db || !room || !playerId) return;
    if (locked) return; // round is locked while host is settling
    const playerRef = child(ref(db, `rooms/${room}/players`), playerId);
    await update(playerRef, {
      choice,
      lastVoteAt: Date.now(),
    });
  };

  // ========= Host: settle all players in Firebase for this round ==========
  const hostApplyRoundRemote = async (delta) => {
    if (!db || !room) return;
    const playersRef = ref(db, `rooms/${room}/players`);
    const snap = await get(playersRef);
    const val = snap.val() || {};
    const updates = {};
    Object.entries(val).forEach(([key, p]) => {
      if (!p.choice) {
        updates[key] = { ...p };
        return;
      }
      let effect = 0;
      if (p.choice === "B")
        effect = delta > 0 ? Math.abs(delta) : -Math.abs(delta);
      if (p.choice === "H") effect = 0;
      if (p.choice === "S")
        effect = delta < 0 ? Math.abs(delta) : -Math.abs(delta);
      const factor = 1 + effect; // this is where you can customize payoff
      const newCap = +(p.capital * factor).toFixed(2);
      updates[key] = {
        ...p,
        capital: newCap,
        choice: null, // reset choice for next round
      };
    });
    await update(playersRef, updates);
  };

  // ========= Host: reveal & apply one round ==========
  const handleRevealAndApply = async () => {
    if (role !== "host") return;
    setLocked(true);
    // 如果还在倒计时，强制结束倒计时
    setIsCounting(false);
    setCountdown(0);

    const { pb, ps } = totals;
    const strategyDelta = computeDelta(pb, ps);
    const extra = newsImpact || 0;
    const totalDelta = clamp(strategyDelta + extra, -0.2, 0.2); // cap total move at ±20%

    // Update price & history
    const newPrice = +(price * (1 + totalDelta)).toFixed(2);
    setPrice(newPrice);
    setHistory((h) => [...h, { round, price: newPrice }]);

    // Settle players
    if (db && room) {
      await hostApplyRoundRemote(totalDelta);
    } else {
      // Local-only fallback (no Firebase): only local players list
      setPlayers((prev) =>
        prev.map((p) => {
          if (!p.choice) return p;
          let effect = 0;
          if (p.choice === "B")
            effect = totalDelta > 0 ? Math.abs(totalDelta) : -Math.abs(totalDelta);
          if (p.choice === "H") effect = 0;
          if (p.choice === "S")
            effect = totalDelta < 0 ? Math.abs(totalDelta) : -Math.abs(totalDelta);
          const factor = 1 + effect;
          const newCap = +(p.capital * factor).toFixed(2);
          return { ...p, capital: newCap, choice: null };
        })
      );
    }

    // Prepare next round
    setRound((r) => r + 1);
    setLocked(false);
    setNews("");
    setNewsImpact(0);
  };

  // ========= Random news + start countdown ==========
  const handleRandomNews = () => {
    const pick = NEWS_POOL[Math.floor(Math.random() * NEWS_POOL.length)];
    setNews(pick.text);
    setNewsImpact(pick.impact);

    // 启动 10 秒倒计时
    setCountdown(10);
    setIsCounting(true);
  };

  // ========= 10s countdown side-effects ==========
  // 每秒减 1
  useEffect(() => {
    if (!isCounting || countdown <= 0) return;

    const timer = setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [isCounting, countdown]);

  // 结束时自动停止计数，并自动结算一轮
  useEffect(() => {
    if (!isCounting) return;
    if (countdown === 0) {
      // 自动 Reveal & apply
      handleRevealAndApply();
      setIsCounting(false);
    }
  }, [countdown, isCounting]); // 依赖两个值

  // ========= Hard reset (host) ==========
  const handleHardReset = async () => {
    setPrice(INITIAL_PRICE);
    setRound(1);
    setHistory([{ round: 0, price: INITIAL_PRICE }]);
    setNews("");
    setNewsImpact(0);
    setIsCounting(false);
    setCountdown(0);
    if (db && room) {
      await set(ref(db, `rooms/${room}/players`), {});
    }
    setPlayers([]);
  };

  // Host local players (for offline testing without phones)
  const addLocalPlayer = () => {
    setPlayers((prev) => [
      ...prev,
      {
        id: uid(),
        name: `P${prev.length + 1}`,
        capital: 100,
        choice: null,
      },
    ]);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4">
      <div className="max-w-6xl mx-auto grid gap-4">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Market Panic Game</h1>
            <p className="text-sm text-slate-600">
              Simultaneous-move game: students choose Buy / Hold / Sell privately
              on their phones, teacher reveals and settles the round.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRole("host")}
              className={`px-3 py-1 rounded-full border flex items-center gap-1 ${
                role === "host" ? "bg-slate-900 text-white" : "bg-white"
              }`}
            >
              <Cast size={16} /> Host
            </button>
            <button
              onClick={() => setRole("client")}
              className={`px-3 py-1 rounded-full border flex items-center gap-1 ${
                role === "client" ? "bg-slate-900 text-white" : "bg-white"
              }`}
            >
              <Smartphone size={16} /> Client
            </button>
          </div>
        </header>

        {/* Top: chart + controls */}
        <section className="grid md:grid-cols-3 gap-4">
          {/* Price chart */}
          <div className="bg-white rounded-2xl shadow p-4 md:col-span-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2">
                <Users size={18} />
                Price &amp; rounds
              </div>
              <div className="text-sm text-slate-600">
                Round{" "}
                <span className="font-semibold text-slate-900">{round}</span> ·
                Price{" "}
                <span className="font-semibold text-emerald-600">
                  € {price.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="h-56 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={history}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="round" />
                  <YAxis domain={[0, "auto"]} />
                  <Tooltip
                    formatter={(v) => [`€ ${v}`, "Price"]}
                    labelFormatter={(l) => `Round ${l}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#0f172a"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* News + round controls */}
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <h3 className="font-semibold mb-1">News &amp; controls</h3>
            <textarea
              className="w-full rounded-xl border px-3 py-2 text-sm"
              rows={3}
              value={news}
              onChange={(e) => setNews(e.target.value)}
              placeholder="Write a news headline / scenario. Students decide Buy / Hold / Sell based on this."
            />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-600">News impact:</span>
              <input
                type="number"
                step="0.01"
                min="-0.2"
                max="0.2"
                className="w-20 border rounded-lg px-2 py-1 text-sm"
                value={newsImpact}
                onChange={(e) =>
                  setNewsImpact(
                    clamp(parseFloat(e.target.value) || 0, -0.2, 0.2)
                  )
                }
              />
              <span className="text-slate-500 text-xs">
                {newsImpact >= 0 ? "+" : ""}
                {(newsImpact * 100).toFixed(1)}%
              </span>
            </div>
            <button
              onClick={handleRandomNews}
              className="px-3 py-2 rounded-xl border text-sm bg-slate-50 flex items-center gap-1"
            >
              <RefreshCw size={14} /> Random news
            </button>

            {/* 倒计时显示 */}
            {isCounting && (
              <div className="mt-1 text-sm text-center text-red-600 font-semibold">
                Auto reveal in {countdown}s…
              </div>
            )}

            {role === "host" && (
              <>
                <button
                  onClick={handleRevealAndApply}
                  disabled={isCounting}
                  className="w-full mt-2 px-3 py-2 rounded-xl bg-slate-900 text-white flex items-center justify-center gap-2"
                >
                  <Play size={16} />
                  {isCounting ? `Wait ${countdown}s...` : "Reveal & apply"}
                </button>
                <button
                  onClick={handleHardReset}
                  className="w-full mt-1 px-3 py-2 rounded-xl border text-sm"
                >
                  Reset game
                </button>
                <div className="mt-2 text-xs text-slate-600">
                  This round — Buy: {totals.buy} · Hold: {totals.hold} · Sell:{" "}
                  {totals.sell}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Bottom: Host players table + Realtime client/room panel */}
        <section className="grid md:grid-cols-2 gap-4">
          {/* Host view: players & capitals */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold flex items-center gap-2">
                <Users size={18} />
                Players (host view)
              </div>
              {role === "host" && !db && (
                <button
                  onClick={addLocalPlayer}
                  className="px-2 py-1 text-xs rounded-full border bg-slate-50"
                >
                  + Add local player
                </button>
              )}
            </div>
            {role !== "host" ? (
              <p className="text-sm text-slate-500">
                Only the <strong>Host</strong> can see the full list of players
                and their capital.
              </p>
            ) : players.length === 0 ? (
              <p className="text-sm text-slate-500">
                No players yet. Ask students to join as{" "}
                <strong>Client</strong> on their phones, or add a few local test
                players here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-2">Name</th>
                      <th className="text-right py-1 px-2">Capital</th>
                      <th className="text-center py-1 px-2">
                        Choice (this round)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {players
                      .slice()
                      .sort((a, b) => b.capital - a.capital)
                      .map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-1 pr-2">{p.name}</td>
                          <td className="py-1 px-2 text-right">
                            € {p.capital.toFixed(2)}
                          </td>
                          <td className="py-1 px-2 text-center">
                            {p.choice === "B"
                              ? "Buy"
                              : p.choice === "H"
                              ? "Hold"
                              : p.choice === "S"
                              ? "Sell"
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Realtime / Client panel */}
          <div className="bg-white rounded-2xl shadow p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2">
                <Cast size={18} />
                Realtime room
              </div>
            </div>

            {role === "host" ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="px-3 py-2 rounded-xl border text-sm w-32"
                    placeholder="ROOM"
                    value={room}
                    onChange={(e) => setRoom(e.target.value.toUpperCase())}
                  />
                  <button
                    onClick={hostCreateRoom}
                    className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm"
                  >
                    Create room
                  </button>
                </div>
                {room && (
                  <div className="mt-2 grid grid-cols-[auto,1fr] gap-3 items-center">
                    {roomUrl && (
                      <div className="border rounded-xl p-2 bg-white">
                        <QRCodeCanvas value={roomUrl} size={96} />
                      </div>
                    )}
                    <div className="text-sm space-y-1">
                      <div>
                        Room code:{" "}
                          <span className="font-semibold font-mono">
                          {room}
                        </span>
                      </div>
                      <div className="break-all">
                        Students can open:{" "}
                        <span className="underline">{roomUrl}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        On their phone: open this link (or scan QR), choose{" "}
                        <strong>Client</strong>, enter a name, then join.
                      </div>
                      {!db && (
                        <div className="text-xs text-red-500">
                          ⚠ Firebase is not configured: realtime sync is
                          disabled. You can still play locally on this computer.
                          To enable multi-device play, fill FIREBASE_CONFIG with
                          your Realtime Database config.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="px-3 py-2 rounded-xl border text-sm w-28"
                    placeholder="ROOM"
                    value={room}
                    onChange={(e) => setRoom(e.target.value.toUpperCase())}
                  />
                  <input
                    className="px-3 py-2 rounded-xl border text-sm flex-1"
                    placeholder="Your name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                  <button
                    onClick={() => clientJoinRoom(room)}
                    className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm"
                  >
                    Join
                  </button>
                </div>
                {myPlayer ? (
                  <div className="mt-3 space-y-2">
                    <div className="text-sm">
                      Hi{" "}
                      <span className="font-semibold">{myPlayer.name}</span>, your
                      capital:{" "}
                      <span className="font-semibold">
                        € {myPlayer.capital.toFixed(2)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <button
                        onClick={() => clientSendChoice("B")}
                        className="px-3 py-2 rounded-xl border text-sm bg-green-50"
                        disabled={locked}
                      >
                        Buy
                      </button>
                      <button
                        onClick={() => clientSendChoice("H")}
                        className="px-3 py-2 rounded-xl border text-sm bg-slate-50"
                        disabled={locked}
                      >
                        Hold
                      </button>
                      <button
                        onClick={() => clientSendChoice("S")}
                        className="px-3 py-2 rounded-xl border text-sm bg-red-50"
                        disabled={locked}
                      >
                        Sell
                      </button>
                    </div>
                    <div className="text-xs text-slate-500">
                      After the teacher clicks{" "}
                      <strong>Reveal &amp; apply</strong>, your capital will be
                      updated based on this round&apos;s result.
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    After you join a room, your capital and buttons will appear
                    here.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
