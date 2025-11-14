import { useEffect, useState } from "react";
import { socket } from "./socket";

const pageStyle = {
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  minHeight: "100vh",
  background: "#f5f7fb",
  margin: 0,
  padding: "24px",
};

const cardStyle = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.08)",
};

const tabButton = (active) => ({
  padding: "8px 16px",
  borderRadius: "999px",
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  marginRight: "8px",
  background: active ? "#111827" : "transparent",
  color: active ? "white" : "#4b5563",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: active ? "#111827" : "#e5e7eb",
});

const primaryButton = {
  padding: "10px 18px",
  borderRadius: "999px",
  border: "none",
  background: "#111827",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
};

const ghostButton = {
  padding: "8px 14px",
  borderRadius: "999px",
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
};

const choiceButton = (selected) => ({
  padding: "10px 18px",
  borderRadius: "999px",
  border: selected ? "2px solid #111827" : "1px solid #d1d5db",
  background: selected ? "#e5e7eb" : "white",
  cursor: "pointer",
  fontWeight: 600,
  marginRight: "8px",
  minWidth: "80px",
});

/**
 * 简单价格走势图（带 Y 轴刻度），用于玩家界面
 * data: [{ round, price }]
 */
function PriceChart({ data }) {
  if (!data || data.length === 0) return null;

  const width = 360;
  const height = 170;
  const paddingLeft = 48; // 给 Y 轴刻度留空间
  const paddingRight = 10;
  const paddingTop = 10;
  const paddingBottom = 26;

  const prices = data.map((d) => d.price);
  let minP = Math.min(...prices);
  let maxP = Math.max(...prices);

  // 给上下留一点 margin，看起来不挤
  if (minP === maxP) {
    minP -= 1;
    maxP += 1;
  } else {
    const extra = (maxP - minP) * 0.1;
    minP -= extra;
    maxP += extra;
  }
  const range = maxP - minP || 1;

  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;

  const stepX =
    data.length > 1 ? innerWidth / (data.length - 1) : innerWidth;

  const points = data
    .map((d, i) => {
      const x = paddingLeft + i * stepX;
      const y =
        paddingTop +
        (1 - (d.price - minP) / range) * innerHeight;
      return `${x},${y}`;
    })
    .join(" ");

  // Y 轴刻度（例如 4 个）
  const ticksCount = 4;
  const yTicks = [];
  for (let i = 0; i <= ticksCount; i++) {
    const t = i / ticksCount; // 0 -> max, 1 -> min
    const priceVal = maxP - t * range;
    const y = paddingTop + t * innerHeight;
    yTicks.push({ y, value: priceVal });
  }

  return (
    <svg
      width={width}
      height={height}
      style={{
        background: "#f9fafb",
        borderRadius: "12px",
        border: "1px solid #e5e7eb",
      }}
    >
      {/* Y 轴 + 网格线 */}
      <line
        x1={paddingLeft}
        y1={paddingTop}
        x2={paddingLeft}
        y2={paddingTop + innerHeight}
        stroke="#d1d5db"
        strokeWidth="1"
      />
      {yTicks.map((tick, idx) => (
        <g key={idx}>
          <line
            x1={paddingLeft}
            y1={tick.y}
            x2={width - paddingRight}
            y2={tick.y}
            stroke="#e5e7eb"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <text
            x={paddingLeft - 6}
            y={tick.y + 3}
            textAnchor="end"
            fontSize="10"
            fill="#6b7280"
          >
            €{tick.value.toFixed(0)}
          </text>
        </g>
      ))}

      {/* 折线 */}
      <polyline
        fill="none"
        stroke="#111827"
        strokeWidth="2"
        points={points}
      />
      {/* 拐点圆点 */}
      {data.map((d, i) => {
        const x = paddingLeft + i * stepX;
        const y =
          paddingTop +
          (1 - (d.price - minP) / range) * innerHeight;
        return <circle key={i} cx={x} cy={y} r={3} fill="#111827" />;
      })}

      {/* X 轴回合号（简单标 round1, roundN） */}
      {data.map((d, i) => {
        const x = paddingLeft + i * stepX;
        const y = paddingTop + innerHeight;
        const label =
          i === 0
            ? `R${d.round}`
            : i === data.length - 1
            ? `R${d.round}`
            : "";
        if (!label) return null;
        return (
          <text
            key={i}
            x={x}
            y={y + 16}
            textAnchor="middle"
            fontSize="10"
            fill="#6b7280"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

function App() {
  const [role, setRole] = useState(null); // "host" | "player" | null
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);

  const [price, setPrice] = useState(100);
  const [lastChange, setLastChange] = useState(null); // { change, pct }

  const [status, setStatus] = useState("Disconnected");
  const [news, setNews] = useState("");
  const [players, setPlayers] = useState({});
  const [myChoice, setMyChoice] = useState(null);

  // round / timer
  const [round, setRound] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [roundActive, setRoundActive] = useState(false);

  // price history for chart
  const [priceHistory, setPriceHistory] = useState([]);

  // ---- socket listeners ----
  useEffect(() => {
    socket.on("connect", () => {
      setStatus("Connected");
    });

    socket.on("disconnect", () => {
      setStatus("Disconnected");
      setJoined(false);
      setRole(null);
    });

    socket.on("host_confirmed", () => {
      setJoined(true);
    });

    socket.on("player_confirmed", () => {
      setJoined(true);
    });

    socket.on("update_players", (playersObj) => {
      setPlayers(playersObj || {});
    });

    // payload: { text, price, change, pct }
    socket.on("news_update", (payload) => {
      if (!payload) return;
      setNews(payload.text || "");

      if (typeof payload.price === "number") {
        setPrice(payload.price);

        // 记录价格历史
        setPriceHistory((prev) => {
          const nextRound = prev.length + 1;
          return [...prev, { round: nextRound, price: payload.price }];
        });
      }

      if (
        typeof payload.change === "number" &&
        typeof payload.pct === "number"
      ) {
        setLastChange({
          change: payload.change,
          pct: payload.pct,
        });
      } else {
        setLastChange(null);
      }
    });

    socket.on("host_left", () => {
      alert("Host left the game. Room is closed.");
      setJoined(false);
      setRole(null);
      setPlayers({});
      setNews("");
      setRound(0);
      setTimeLeft(0);
      setRoundActive(false);
      setLastChange(null);
      setPriceHistory([]);
    });

    // { round, duration }
    socket.on("round_started", ({ round, duration }) => {
      setRound(round);
      setTimeLeft(duration);
      setRoundActive(true);
      setMyChoice(null);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("host_confirmed");
      socket.off("player_confirmed");
      socket.off("update_players");
      socket.off("news_update");
      socket.off("host_left");
      socket.off("round_started");
    };
  }, []);

  // ---- countdown effect ----
  useEffect(() => {
    if (!roundActive) return;
    if (timeLeft <= 0) {
      setRoundActive(false);
      return;
    }
    const id = setTimeout(() => {
      setTimeLeft((t) => t - 1);
    }, 1000);
    return () => clearTimeout(id);
  }, [roundActive, timeLeft]);

  // ---- actions ----
  const selectHost = () => {
    setRole("host");
    socket.emit("join_as_host");
  };

  const selectPlayer = () => {
    setRole("player");
  };

  const joinAsPlayer = () => {
    if (!name.trim()) {
      alert("Please enter your name");
      return;
    }
    socket.emit("join_as_player", name);
  };

  const triggerRandomNews = () => {
    socket.emit("random_news");
  };

  // 默认 30 秒
  const startRound = (duration = 30) => {
    socket.emit("start_round", duration);
  };

  const choose = (choice) => {
    setMyChoice(choice);
    socket.emit("player_choice", choice);
  };

  // ===================== RENDER =====================

  // 1) role not selected yet
  if (!role) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <header style={{ marginBottom: "24px" }}>
            <h1 style={{ margin: 0, fontSize: "32px" }}>Market Panic Game</h1>
            <p style={{ marginTop: "4px", color: "#6b7280" }}>
              Simultaneous-move game: students choose Buy / Hold / Sell on their
              phones, teacher triggers news and settles each round.
            </p>
          </header>

          <div style={cardStyle}>
            <p style={{ marginBottom: "12px", color: "#6b7280" }}>
              Status: <strong>{status}</strong>
            </p>
            <p style={{ marginBottom: "16px" }}>Choose your role:</p>
            <button style={tabButton(false)} onClick={selectHost}>
              I am the Host (teacher)
            </button>
            <button style={tabButton(false)} onClick={selectPlayer}>
              I am a Player (student)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2) Host view
  if (role === "host") {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
          {/* top bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <h1 style={{ margin: 0 }}>Market Panic Game</h1>
            <div>
              <button style={tabButton(true)}>Host</button>
              <button style={tabButton(false)}>Client</button>
            </div>
          </div>

          {/* grid layout: left (rounds & players) / right (news) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1.2fr",
              gap: "20px",
            }}
          >
            {/* left: rounds & players */}
            <div style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <h2 style={{ margin: 0 }}>Rounds</h2>
                  <p style={{ margin: 0, color: "#6b7280" }}>
                    Round {round || 1} · Price €{price.toFixed(2)}
                    {lastChange && (
                      <>
                        {" ("}
                        {lastChange.change >= 0 ? "+" : ""}
                        {lastChange.change.toFixed(2)}€
                        {", "}
                        {lastChange.pct >= 0 ? "+" : ""}
                        {lastChange.pct.toFixed(1)}%
                        {")"}
                      </>
                    )}
                    {roundActive && timeLeft > 0
                      ? ` · Time left: ${timeLeft}s`
                      : ""}
                  </p>
                </div>
                <div>
                  <button
                    style={{ ...ghostButton, marginRight: "8px" }}
                    onClick={() => startRound(30)}
                  >
                    Start 30s round
                  </button>
                  <button style={ghostButton} onClick={triggerRandomNews}>
                    Random news
                  </button>
                </div>
              </div>

              <hr style={{ border: 0, borderTop: "1px solid #e5e7eb" }} />

              <h3>Players (host view)</h3>
              {Object.keys(players).length === 0 && (
                <p style={{ color: "#9ca3af" }}>
                  No players yet. Ask students to join as{" "}
                  <strong>Client</strong> on their phones.
                </p>
              )}
              <ul>
                {Object.entries(players).map(([id, p]) => (
                  <li key={id}>
                    <strong>{p.name}</strong> — balance:{" "}
                    {p.balance.toFixed(2)} — choice:{" "}
                    {p.choice || (
                      <span style={{ color: "#9ca3af" }}>none yet</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* right: news & controls（Host 这里是不带红绿的） */}
            <div style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>News & controls</h2>
              <p style={{ color: "#6b7280" }}>
                Click <strong>Random news</strong> to draw a scenario, then
                start a timed round. Students choose Buy / Hold / Sell on their
                phones.
              </p>

              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  borderRadius: "12px",
                  background: "#f9fafb",
                  minHeight: "70px",
                  border: "1px solid #e5e7eb",
                }}
              >
                {news ? (
                  <span>{news}</span>
                ) : (
                  <span style={{ color: "#9ca3af" }}>
                    No news yet. Click “Random news” to generate one.
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3) Player view
  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
        {/* top bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h1 style={{ margin: 0 }}>Market Panic Game</h1>
          <div>
            <button style={tabButton(false)}>Host</button>
            <button style={tabButton(true)}>Client</button>
          </div>
        </div>

        <div style={cardStyle}>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            Status: <strong>{status}</strong>
          </p>

          {!joined ? (
            <>
              <p>Enter your name to join the game:</p>
              <input
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  marginRight: "8px",
                }}
              />
              <button style={primaryButton} onClick={joinAsPlayer}>
                Join as player
              </button>
            </>
          ) : (
            <>
              <p style={{ marginBottom: "4px" }}>
                Joined as <strong>{name}</strong>
              </p>

              {/* 玩家自己的余额 */}
              <p
                style={{
                  marginTop: "0",
                  marginBottom: "16px",
                  color: "#374151",
                }}
              >
                Balance:{" "}
                <strong>
                  €
                  {players[socket.id]?.balance !== undefined
                    ? players[socket.id].balance.toFixed(2)
                    : "0.00"}
                </strong>
              </p>

              {/* 彩色新闻 + 回合信息 */}
              {(() => {
                let bg = "#f3f4f6";
                let textColor = "#111827";

                if (
                  lastChange &&
                  typeof lastChange.change === "number"
                ) {
                  if (lastChange.change > 0) {
                    bg = "#d1fae5"; // light green
                    textColor = "#065f46";
                  } else if (lastChange.change < 0) {
                    bg = "#fee2e2"; // light red
                    textColor = "#991b1b";
                  }
                }

                return (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: "10px",
                      background: bg,
                      marginBottom: "16px",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <div style={{ marginBottom: "4px", color: textColor }}>
                      <strong>
                        Round {round || 1} · Price €{price.toFixed(2)}
                        {lastChange && (
                          <>
                            {" ("}
                            {lastChange.change >= 0 ? "+" : ""}
                            {lastChange.change.toFixed(2)}€
                            {", "}
                            {lastChange.pct >= 0 ? "+" : ""}
                            {lastChange.pct.toFixed(1)}%
                            {")"}
                          </>
                        )}
                        {roundActive && timeLeft > 0
                          ? ` · Time left: ${timeLeft}s`
                          : ""}
                      </strong>
                    </div>
                    <div style={{ color: textColor }}>
                      {news || "Waiting for the host to send news..."}
                    </div>
                  </div>
                );
              })()}

              {/* 价格走势图 */}
              {priceHistory.length > 1 && (
                <div style={{ marginBottom: "16px" }}>
                  <h3 style={{ margin: "0 0 8px 0" }}>Price history</h3>
                  <PriceChart data={priceHistory} />
                </div>
              )}

              <h3>Your action</h3>
              <p style={{ color: "#6b7280" }}>
                Choose one option. The selected button will be highlighted.
              </p>
              <div style={{ marginBottom: "12px" }}>
                <button
                  style={choiceButton(myChoice === "buy")}
                  onClick={() => choose("buy")}
                >
                  Buy
                </button>
                <button
                  style={choiceButton(myChoice === "hold")}
                  onClick={() => choose("hold")}
                >
                  Hold
                </button>
                <button
                  style={choiceButton(myChoice === "sell")}
                  onClick={() => choose("sell")}
                >
                  Sell
                </button>
              </div>
              {myChoice && (
                <p>
                  You selected: <strong>{myChoice.toUpperCase()}</strong>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
