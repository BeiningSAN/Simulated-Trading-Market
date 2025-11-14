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
    });

    // { round, duration }
    socket.on("round_started", ({ round, duration }) => {
      setRound(round);
      setTimeLeft(duration);
      setRoundActive(true);
      setMyChoice(null);
      // reset local choices visually, server也已经清空choice
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

  const startRound = (duration = 10) => {
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
                    onClick={() => startRound(10)}
                  >
                    Start 10s round
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

            {/* right: news & controls */}
            <div style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>News & controls</h2>
              <p style={{ color: "#6b7280" }}>
                Click <strong>Random news</strong> to draw a scenario, then start
                a timed round. Students choose Buy / Hold / Sell on their
                phones.
              </p>
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  borderRadius: "12px",
                  background: "#f9fafb",
                  minHeight: "70px",
                  border: "1px dashed #e5e7eb",
                }}
              >
                {news ? (
                  <span>{news}</span>
                ) : (
                  <span style={{ color: "#9ca3af" }}>
                    No news yet. Click &ldquo;Random news&rdquo; to generate one.
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
              <p style={{ marginBottom: "12px" }}>
                Joined as <strong>{name}</strong>
              </p>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "#f9fafb",
                  marginBottom: "16px",
                }}
              >
                <div style={{ marginBottom: "4px" }}>
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
                <div style={{ color: "#6b7280" }}>
                  {news || "Waiting for the host to send news..."}
                </div>
              </div>

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
