import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stack the Tide — Tap-to-Stack Arcade Game" },
      {
        name: "description",
        content:
          "Stack the Tide is a one-tap stacking game for phone and desktop. Time each drop, chain perfect stacks and beat your best score.",
      },
      { property: "og:title", content: "Stack the Tide — Tap-to-Stack Arcade Game" },
      {
        property: "og:description",
        content:
          "Time each drop, chain perfect stacks and beat your best score in this one-tap arcade game.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "theme-color", content: "#FDF2E9" },
    ],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }],
  }),
  component: Game,
});

type Block = { x: number; w: number; c: string };
type Piece = { x: number; w: number; i: number; c: string; y: number; vy: number };
type Overlay =
  | { kind: "ready"; best: number }
  | { kind: "over"; score: number; best: number; canRevive: boolean }
  | null;

const BH = 28;
const BASE_W = 150;
const GROUND = 560;
const col = (i: number) => `hsl(${(i * 14 + 340) % 360},70%,80%)`;

function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlay, setOverlay] = useState<Overlay>({ kind: "ready", best: 0 });
  const apiRef = useRef<{
    begin: () => void;
    playAgain: () => void;
    revive: () => void;
  } | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let dpr = 1;
    let stack: Block[] = [];
    let cur: { x: number; w: number; i: number; c: string } = { x: 0, w: BASE_W, i: 0, c: col(0) };
    let dir = 1;
    let score = 0;
    let combo = 0;
    let cam = 0;
    let pieces: Piece[] = [];
    let state: "ready" | "play" | "over" = "ready";
    let revived = false;
    let flash: { t: number; txt: string } | null = null;
    let bgH = 30;
    let tgtH = 30;
    let best = 0;
    let raf = 0;
    try {
      best = Number(localStorage.getItem("stt_best")) || 0;
    } catch {
      /* storage unavailable */
    }

    let ac: AudioContext | null = null;
    const beep = (f: number, d = 0.08, type: OscillatorType = "sine", v = 0.12) => {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ac = ac ?? new AC();
        if (ac.state === "suspended") void ac.resume();
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type;
        o.frequency.value = f;
        g.gain.setValueAtTime(v, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + d);
        o.connect(g);
        g.connect(ac.destination);
        o.start();
        o.stop(ac.currentTime + d);
      } catch {
        /* audio unavailable */
      }
    };
    const buzz = (ms: number) => {
      try {
        navigator.vibrate?.(ms);
      } catch {
        /* vibration unavailable */
      }
    };

    const fit = () => {
      dpr = window.devicePixelRatio || 1;
      cv.width = Math.floor(window.innerWidth * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);

    const spawn = () => {
      const top = stack[stack.length - 1]!;
      const i = stack.length;
      dir = i % 2 ? 1 : -1;
      cur = { x: dir > 0 ? -top.w : 360, w: top.w, i, c: col(i) };
    };
    const reset = () => {
      stack = [{ x: (360 - BASE_W) / 2, w: BASE_W, c: col(0) }];
      score = 0;
      combo = 0;
      cam = 0;
      pieces = [];
      revived = false;
      flash = null;
      tgtH = 30;
      spawn();
    };
    const speed = () => 2.2 + Math.min(score * 0.06, 4);

    const over = () => {
      state = "over";
      beep(120, 0.35, "sawtooth");
      buzz(60);
      if (score > best) {
        best = score;
        try {
          localStorage.setItem("stt_best", String(best));
        } catch {
          /* storage unavailable */
        }
      }
      setOverlay({ kind: "over", score, best, canRevive: !revived && score >= 5 });
    };

    const drop = () => {
      const top = stack[stack.length - 1]!;
      const dx = cur.x - top.x;
      if (Math.abs(dx) <= 6) {
        cur.x = top.x;
        combo++;
        if (combo >= 3 && cur.w < BASE_W) {
          cur.w = Math.min(BASE_W, cur.w + 6);
          cur.x -= 3;
        }
        flash = { t: 40, txt: combo > 1 ? "PERFECT x" + combo : "PERFECT" };
        beep(480 + combo * 50, 0.14, "triangle");
        buzz(15);
      } else {
        const ovl = cur.w - Math.abs(dx);
        if (ovl <= 0) {
          pieces.push({ x: cur.x, w: cur.w, i: cur.i, c: cur.c, y: 0, vy: 0 });
          over();
          return;
        }
        if (dx > 0) {
          pieces.push({ x: top.x + top.w, w: dx, i: cur.i, c: cur.c, y: 0, vy: 0 });
          cur.w = ovl;
        } else {
          pieces.push({ x: cur.x, w: -dx, i: cur.i, c: cur.c, y: 0, vy: 0 });
          cur.x = top.x;
          cur.w = ovl;
        }
        combo = 0;
        beep(220, 0.07);
      }
      stack.push({ x: cur.x, w: cur.w, c: cur.c });
      score++;
      tgtH = Math.floor(score / 10) * 40 + 30;
      spawn();
    };

    const home = () => {
      reset();
      state = "ready";
      setOverlay({ kind: "ready", best });
    };

    apiRef.current = {
      begin: () => {
        setOverlay(null);
        state = "play";
      },
      playAgain: () => {
        reset();
        setOverlay(null);
        state = "play";
      },
      revive: () => {
        revived = true;
        combo = 0;
        setOverlay(null);
        spawn();
        state = "play";
      },
    };

    const tap = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest("button")) return;
      if (state === "ready") apiRef.current?.begin();
      else if (state === "play") drop();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (state === "ready") apiRef.current?.begin();
      else if (state === "play") drop();
    };
    window.addEventListener("pointerdown", tap);
    window.addEventListener("keydown", key);

    const rr = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h - 2, 4);
      ctx.fill();
    };

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, now - last) / 16.67;
      last = now;
      if (state === "play") {
        cur.x += dir * speed() * dt;
        if (dir > 0 && cur.x > 360 - cur.w * 0.5) dir = -1;
        else if (dir < 0 && cur.x < -cur.w * 0.5) dir = 1;
      }
      for (const p of pieces) {
        p.vy += 0.5 * dt;
        p.y += p.vy * dt;
      }
      pieces = pieces.filter((p) => p.y < 900);
      cam += (Math.max(0, (stack.length - 9) * BH) - cam) * 0.1;
      bgH += (tgtH - bgH) * 0.04;

      const w = window.innerWidth;
      const h = window.innerHeight;
      const s = Math.min(w / 360, h / 640);
      const ox = (w - 360 * s) / 2;
      const oy = (h - 640 * s) / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `hsl(${bgH},70%,94%)`;
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);

      ctx.save();
      ctx.translate(0, cam);
      stack.forEach((b, i) => rr(b.x, GROUND - i * BH, b.w, BH, b.c));
      if (state === "play") rr(cur.x, GROUND - cur.i * BH, cur.w, BH, cur.c);
      pieces.forEach((p) => rr(p.x, GROUND - p.i * BH + p.y, p.w, BH, p.c));
      ctx.restore();

      ctx.fillStyle = "rgba(120,170,220,.38)";
      ctx.beginPath();
      ctx.moveTo(-400, 2000);
      for (let x = -400; x <= 760; x += 20) ctx.lineTo(x, 604 + Math.sin(x / 40 + now / 500) * 5);
      ctx.lineTo(760, 2000);
      ctx.fill();

      ctx.textAlign = "center";
      ctx.fillStyle = "#3B3346";
      ctx.font = 'bold 56px "Trebuchet MS",sans-serif';
      ctx.fillText(String(score), 180, 84);
      ctx.font = '13px "Trebuchet MS",sans-serif';
      ctx.fillStyle = "#7A6F66";
      ctx.fillText("BEST " + best, 180, 106);
      if (flash && flash.t > 0) {
        ctx.globalAlpha = flash.t / 40;
        ctx.fillStyle = "#C0486A";
        ctx.font = 'bold 18px "Trebuchet MS",sans-serif';
        ctx.fillText(flash.txt, 180, 140 - (40 - flash.t) * 0.5);
        ctx.globalAlpha = 1;
        flash.t -= dt;
      }
      raf = requestAnimationFrame(frame);
    };

    home();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      window.removeEventListener("pointerdown", tap);
      window.removeEventListener("keydown", key);
      apiRef.current = null;
    };
  }, []);

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" />
      <div className="game-overlay">
        {overlay?.kind === "ready" && (
          <>
            <h1>Stack the Tide</h1>
            <p>
              Tap to drop each block.
              <br />
              Line it up for a perfect stack.
            </p>
            <p>Best {overlay.best}</p>
            <button onClick={() => apiRef.current?.begin()}>Tap to play</button>
          </>
        )}
        {overlay?.kind === "over" && (
          <>
            <h1>{overlay.score}</h1>
            <p>Best {overlay.best}</p>
            {overlay.canRevive && (
              <button className="alt" onClick={() => apiRef.current?.revive()}>
                Continue
              </button>
            )}
            <button onClick={() => apiRef.current?.playAgain()}>Play again</button>
          </>
        )}
      </div>
    </div>
  );
}
