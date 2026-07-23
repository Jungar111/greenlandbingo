"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

/* ------------------------------------------------------------------ *
 * Types & constants
 * ------------------------------------------------------------------ */

type ToastKind = "win" | "lose";
type Toast = { text: string; kind: ToastKind };
type Cell = { n: number; bg: string; fg: string; border: string };

const MAX_NUMBER = 90;
const MOBILE_BREAKPOINT = 860;

const FONT_HEADING = "var(--font-space-grotesk), sans-serif";
const FONT_BODY = "var(--font-manrope), sans-serif";

// Shared colours (oklch), lifted from the design.
const RED = "oklch(0.52 0.19 25)";
const GREEN = "oklch(0.6 0.15 145)";
const INK = "oklch(0.22 0.02 60)";
const MUTED = "oklch(0.5 0.02 60)";
const LINE = "oklch(0.9 0.01 60)";

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  color: MUTED,
};

type BingoCallerProps = {
  soundEnabled?: boolean;
  /** How many recent numbers to show (4–15). */
  historyCount?: number;
};

/* ------------------------------------------------------------------ *
 * Small presentational helpers
 * ------------------------------------------------------------------ */

/** A button whose hover styles are merged in via mouse events, since the
 *  design relies on inline styles (which CSS `:hover` can't override). */
function HoverButton({
  style,
  hoverStyle,
  disabled,
  onClick,
  children,
}: {
  style: CSSProperties;
  hoverStyle?: CSSProperties;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const merged: CSSProperties = {
    ...style,
    ...(hover && !disabled && hoverStyle ? hoverStyle : {}),
    ...(disabled ? { cursor: "not-allowed", opacity: 0.55 } : {}),
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={merged}
    >
      {children}
    </button>
  );
}

/** The 1–90 tally grid. */
function BoardGrid({
  cells,
  gap,
  radius,
  fontSize,
}: {
  cells: Cell[];
  gap: number;
  radius: number;
  fontSize: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(10, 1fr)",
        gap,
      }}
    >
      {cells.map((cell) => (
        <div
          key={cell.n}
          style={{
            aspectRatio: "1",
            borderRadius: radius,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT_HEADING,
            fontWeight: 700,
            fontSize,
            boxSizing: "border-box",
            background: cell.bg,
            color: cell.fg,
            border: cell.border,
          }}
        >
          {cell.n}
        </div>
      ))}
    </div>
  );
}

/** Compute the visual state of every board cell. */
function getCells(called: Set<number>, current: number | null): Cell[] {
  const cells: Cell[] = [];
  for (let n = 1; n <= MAX_NUMBER; n++) {
    const isCalled = called.has(n);
    const isCurrent = n === current;
    cells.push({
      n,
      bg: isCalled
        ? isCurrent
          ? RED
          : "oklch(0.9 0.06 25)"
        : "oklch(0.99 0.002 80)",
      fg: isCalled ? (isCurrent ? "white" : "oklch(0.4 0.15 25)") : "oklch(0.6 0.02 60)",
      border: isCalled ? "none" : `1px solid ${LINE}`,
    });
  }
  return cells;
}

/* ------------------------------------------------------------------ *
 * Main component
 * ------------------------------------------------------------------ */

export default function BingoCaller({
  soundEnabled = true,
  historyCount = 8,
}: BingoCallerProps) {
  const [calledNumbers, setCalledNumbers] = useState<number[]>([]);
  const [currentNumber, setCurrentNumber] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  // Default to the mobile layout so the server render and first client render
  // agree; the effect below corrects it after mount.
  const [isMobile, setIsMobile] = useState(true);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  /* --- lifecycle: responsive listener --- */
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      window.removeEventListener("resize", onResize);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  /* --- sound (Web Audio API) --- */
  const getCtx = () => {
    if (!audioCtx.current) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtx.current = new Ctor();
    }
    return audioCtx.current;
  };

  const playTone = (
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType,
    gainPeak: number,
  ) => {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  };

  const playWinSound = () => {
    if (!soundEnabled) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      playTone(f, i * 0.13, 0.35, "triangle", 0.28),
    );
  };

  const playLoseSound = () => {
    if (!soundEnabled) return;
    playTone(180, 0, 0.4, "sawtooth", 0.3);
    playTone(110, 0.05, 0.5, "sawtooth", 0.3);
  };

  /* --- toast --- */
  const showToast = (text: string, kind: ToastKind) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, kind });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  /* --- game actions --- */
  const onDraw = () => {
    if (calledNumbers.length >= MAX_NUMBER) return;
    const called = new Set(calledNumbers);
    const available: number[] = [];
    for (let n = 1; n <= MAX_NUMBER; n++) if (!called.has(n)) available.push(n);
    const pick = available[Math.floor(Math.random() * available.length)];
    setCalledNumbers((c) => [...c, pick]);
    setCurrentNumber(pick);
    setHistory((h) => [pick, ...h]);
  };

  const onNewGame = () => {
    if (
      calledNumbers.length > 0 &&
      !window.confirm("Start et nyt spil? Dette nulstiller alle trukne tal.")
    ) {
      return;
    }
    setCalledNumbers([]);
    setCurrentNumber(null);
    setHistory([]);
    setToast(null);
  };

  const onBingo = () => {
    playWinSound();
    showToast("BINGO! ✔ Vinder bekræftet", "win");
  };

  const onNoBingo = () => {
    playLoseSound();
    showToast("IKKE BINGO ✗ Krav afvist", "lose");
  };

  /* --- derived values --- */
  const cells = getCells(new Set(calledNumbers), currentNumber);
  const remaining = MAX_NUMBER - calledNumbers.length;
  const canDraw = remaining > 0;
  const drawLabel = remaining === 0 ? "Spillet er slut" : "Træk tal";
  const currentDisplay = currentNumber ?? "–";
  const remainingLabel =
    remaining === MAX_NUMBER
      ? "90 tal tilbage"
      : remaining === 0
        ? "Alle tal er trukket"
        : `${remaining} tal tilbage`;
  const historyItems = history.slice(0, historyCount);
  const historyEmpty = history.length === 0;
  const showDesktopBoard = !isMobile;
  const showOverlayBoard = isMobile && boardOpen;

  /* --- reused fragments --- */
  const confirmButtons = (
    <div style={{ display: "flex", gap: 12 }}>
      <HoverButton
        onClick={onBingo}
        style={{
          flex: 1,
          fontFamily: FONT_HEADING,
          fontSize: 18,
          fontWeight: 700,
          padding: 16,
          borderRadius: 14,
          border: "none",
          background: GREEN,
          color: "white",
          cursor: "pointer",
        }}
        hoverStyle={{ background: "oklch(0.55 0.15 145)" }}
      >
        BINGO
      </HoverButton>
      <HoverButton
        onClick={onNoBingo}
        style={{
          flex: 1,
          fontFamily: FONT_HEADING,
          fontSize: 18,
          fontWeight: 700,
          padding: 16,
          borderRadius: 14,
          border: "none",
          background: RED,
          color: "white",
          cursor: "pointer",
        }}
        hoverStyle={{ background: "oklch(0.45 0.19 25)" }}
      >
        IKKE BINGO
      </HoverButton>
    </div>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "oklch(0.985 0.004 80)",
        color: INK,
        boxSizing: "border-box",
        maxWidth: "100%",
        overflowX: "hidden",
      }}
    >
      {/* ---------------- Header ---------------- */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          justifyContent: "space-between",
          padding: "18px 28px",
          background: RED,
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          {/* Greenland-flag inspired mark */}
          <div
            style={{
              width: 48,
              height: 32,
              borderRadius: 6,
              overflow: "hidden",
              flexShrink: 0,
              position: "relative",
              background: `linear-gradient(to bottom, white 50%, ${RED} 50%)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 13,
                top: "50%",
                transform: "translateY(-50%)",
                width: 22,
                height: 22,
                borderRadius: 999,
                overflow: "hidden",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
              }}
            >
              <div style={{ width: "100%", height: "50%", background: RED }} />
              <div style={{ width: "100%", height: "50%", background: "white" }} />
            </div>
          </div>
          <div
            style={{
              fontFamily: FONT_HEADING,
              fontSize: "clamp(20px, 6vw, 26px)",
              fontWeight: 700,
              letterSpacing: "0.5px",
            }}
          >
            GRØNLANDSBINGO
          </div>
        </div>

        <HoverButton
          onClick={onNewGame}
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 700,
            fontSize: 15,
            padding: "10px 16px",
            borderRadius: 10,
            border: "none",
            background: "white",
            color: "oklch(0.45 0.19 25)",
            cursor: "pointer",
          }}
          hoverStyle={{ background: "oklch(0.93 0.01 60)" }}
        >
          Nyt spil
        </HoverButton>
      </header>

      {/* ---------------- Main view ---------------- */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          gap: 24,
          padding: "24px 28px 100px",
          flex: 1,
        }}
      >
        {/* Left column */}
        <div
          style={{
            flex: "1 1 260px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 20,
            maxWidth: 380,
          }}
        >
          {/* Current number */}
          <div
            style={{
              background: "white",
              borderRadius: 20,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              border: `1px solid ${LINE}`,
            }}
          >
            <div style={labelStyle}>Aktuelt tal</div>
            <div
              key={currentNumber ?? "none"}
              style={{
                width: "clamp(120px, 24vw, 180px)",
                height: "clamp(120px, 24vw, 180px)",
                borderRadius: 999,
                background: RED,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "pop 0.25s ease-out",
              }}
            >
              <div
                style={{
                  fontFamily: FONT_HEADING,
                  fontSize: "clamp(48px, 9vw, 72px)",
                  fontWeight: 700,
                  color: "white",
                }}
              >
                {currentDisplay}
              </div>
            </div>
            <HoverButton
              onClick={onDraw}
              disabled={!canDraw}
              style={{
                width: "100%",
                fontFamily: FONT_HEADING,
                fontSize: 20,
                fontWeight: 700,
                padding: 16,
                borderRadius: 14,
                border: "none",
                background: INK,
                color: "white",
                cursor: "pointer",
              }}
              hoverStyle={{ background: "oklch(0.3 0.02 60)" }}
            >
              {drawLabel}
            </HoverButton>
            <div style={{ fontSize: 14, fontWeight: 700, color: MUTED }}>
              {remainingLabel}
            </div>
          </div>

          {/* Recent numbers */}
          <div
            style={{
              background: "white",
              borderRadius: 20,
              padding: 20,
              border: `1px solid ${LINE}`,
              minWidth: 0,
            }}
          >
            <div style={{ ...labelStyle, marginBottom: 12 }}>Seneste tal</div>
            <div
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                paddingBottom: 4,
              }}
            >
              {historyItems.map((h, i) => (
                <div
                  key={`${h}-${i}`}
                  style={{
                    flexShrink: 0,
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    background: "oklch(0.94 0.03 220)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FONT_HEADING,
                    fontWeight: 700,
                    fontSize: 15,
                    color: "oklch(0.35 0.05 220)",
                  }}
                >
                  {h}
                </div>
              ))}
              {historyEmpty && (
                <div
                  style={{
                    fontSize: 14,
                    color: "oklch(0.6 0.02 60)",
                    padding: "10px 0",
                  }}
                >
                  Ingen tal trukket endnu.
                </div>
              )}
            </div>
          </div>

          {/* Mobile: open board sheet */}
          {isMobile && (
            <HoverButton
              onClick={() => setBoardOpen(true)}
              style={{
                width: "100%",
                fontFamily: FONT_HEADING,
                fontSize: 17,
                fontWeight: 700,
                padding: 16,
                borderRadius: 14,
                border: `2px solid ${RED}`,
                background: "white",
                color: RED,
                cursor: "pointer",
              }}
              hoverStyle={{ background: "oklch(0.97 0.02 25)" }}
            >
              Vis tavle &amp; bingo-tjek
            </HoverButton>
          )}
        </div>

        {/* Right column (desktop) */}
        {showDesktopBoard && (
          <div
            style={{
              flex: "3 1 460px",
              minWidth: 0,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              gap: 24,
            }}
          >
            <div
              style={{
                background: "white",
                borderRadius: 20,
                padding: 20,
                border: `1px solid ${LINE}`,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                flex: "1 1 100%",
              }}
            >
              <div style={labelStyle}>Bekræft bingo</div>
              {confirmButtons}
            </div>

            <div
              style={{
                flex: "1 1 100%",
                background: "white",
                borderRadius: 20,
                padding: 24,
                border: `1px solid ${LINE}`,
              }}
            >
              <div style={{ ...labelStyle, marginBottom: 16 }}>
                Tavle over trukne tal
              </div>
              <BoardGrid
                cells={cells}
                gap={6}
                radius={8}
                fontSize="clamp(11px, 1.6vw, 16px)"
              />
            </div>
          </div>
        )}
      </div>

      {/* ---------------- Mobile board overlay ---------------- */}
      {showOverlayBoard && (
        <div
          onClick={() => setBoardOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(30,10,10,0.5)",
            zIndex: 200,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "24px 24px 0 0",
              width: "100%",
              maxHeight: "86vh",
              overflowY: "auto",
              padding: "20px 20px 28px",
              boxSizing: "border-box",
              animation: "sheetUp 0.22s ease-out",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  color: MUTED,
                }}
              >
                Tavle &amp; bingo-tjek
              </div>
              <HoverButton
                onClick={() => setBoardOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  border: "none",
                  background: "oklch(0.94 0.01 60)",
                  fontSize: 18,
                  fontWeight: 700,
                  color: "oklch(0.3 0.02 60)",
                  cursor: "pointer",
                }}
                hoverStyle={{ background: "oklch(0.9 0.01 60)" }}
              >
                ✕
              </HoverButton>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div
                style={{
                  borderRadius: 16,
                  padding: 16,
                  border: `1px solid ${LINE}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={labelStyle}>Bekræft bingo</div>
                {confirmButtons}
              </div>

              <div
                style={{
                  borderRadius: 16,
                  padding: 16,
                  border: `1px solid ${LINE}`,
                }}
              >
                <div style={{ ...labelStyle, marginBottom: 12 }}>
                  Tavle over trukne tal
                </div>
                <BoardGrid
                  cells={cells}
                  gap={5}
                  radius={7}
                  fontSize="clamp(10px, 3vw, 14px)"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Toast ---------------- */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            background: toast.kind === "win" ? "oklch(0.55 0.15 145)" : "oklch(0.45 0.19 25)",
            color: "white",
            padding: "18px 32px",
            borderRadius: 14,
            fontFamily: FONT_HEADING,
            fontSize: 20,
            fontWeight: 700,
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            animation: "toastIn 0.25s ease-out",
            zIndex: 100,
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
