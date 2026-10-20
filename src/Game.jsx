import { useEffect, useRef, useState, useCallback } from "react";
import Matter from "matter-js";
const { Engine, World, Bodies, Body, Constraint, Query } = Matter;

const W = 800, H = 450;
const g = (...pts) => ({ t: "g", pts });
const b = (...pts) => ({ t: "b", pts });
const STAGES = [
  { end: 4200, sky: ["#0f6fd0", "#6cc4f2"], track: [
    g([-400,300],[700,300],[1300,190]), g([1460,190],[1800,190]),
    b([1800,190],[2150,250],[2500,200]), g([2500,200],[3100,40],[3700,180],[4500,180]) ] },
  { end: 4900, sky: ["#1f5fb8", "#f2b27a"], track: [
    g([-400,300],[700,300],[1100,230],[1500,300]), g([1650,300],[2100,300],[2600,200]),
    b([2600,200],[2950,270],[3300,200]), g([3300,200],[3800,200],[4400,120],[5200,200]) ] },
  { end: 5000, sky: ["#2a3f9a", "#e58fb0"], track: [
    g([-400,300],[600,300],[900,220],[1200,300],[1500,220],[1800,300],[2100,220]),
    b([2250,220],[2500,260],[2750,220]), g([2900,220],[3400,320],[3900,200],[4400,300],[5300,300]) ] },
  { end: 5800, sky: ["#0b2a66", "#4a8fd8"], track: [
    g([-400,300],[800,300],[1400,160]), g([1560,160],[1900,160],[2200,260]),
    b([2200,260],[2600,330],[3000,260]), g([3150,260],[3600,120],[4200,260]),
    b([4350,260],[4700,300],[5050,260]), g([5200,260],[6000,260]) ] },
  { end: 6900, sky: ["#14143a", "#3b5fa8"], track: [
    g([-400,300],[700,300],[1300,120],[1700,120]), g([1860,140],[2300,300]),
    b([2300,300],[2700,360],[3100,300]), g([3250,300],[3800,140],[4300,300],[4700,160]),
    g([4860,160],[5300,260]), b([5300,260],[5700,330],[6100,260]), g([6250,260],[7100,180]) ] },
];
const groundY = (track, x) => {
  for (const t of track) for (let i = 1; i < t.pts.length; i++) {
    const [x0,y0] = t.pts[i-1], [x1,y1] = t.pts[i];
    if (x >= x0 && x <= x1) return y0 + ((y1-y0) * (x-x0)) / (x1-x0);
  }
  return 200;
};
const buildSegments = (pts) =>
  pts.slice(1).map((p, i) => {
    const a = pts[i], dx = p[0]-a[0], dy = p[1]-a[1];
    return Bodies.rectangle(a[0]+dx/2, a[1]+dy/2+10, Math.hypot(dx,dy), 20,
      { isStatic: true, angle: Math.atan2(dy,dx), friction: 1, label: "ground" });
  });

function createWorld(n) {
  const engine = Engine.create({ gravity: { y: 1 } });
  const ground = STAGES[n].track.flatMap((t) => buildSegments(t.pts));
  World.add(engine.world, ground);
  const g = Body.nextGroup(true);
  const chassis = Bodies.rectangle(150, 200, 90, 20, { collisionFilter: { group: g }, density: 0.004 });
  const mk = (x) => Bodies.circle(x, 220, 16, { collisionFilter: { group: g }, friction: 1, density: 0.002 });
  const wb = mk(120), wf = mk(180);
  const link = (w, x) => Constraint.create({ bodyA: chassis, pointA: { x, y: 14 }, bodyB: w, stiffness: 0.35, damping: 0.1, length: 0 });
  World.add(engine.world, [chassis, wb, wf, link(wb,-30), link(wf,30)]);
  return { engine, chassis, wb, wf, ground, since: 99, jumpAt: 0 };
}

function makeAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC(), osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  osc.type = "sawtooth"; filter.type = "lowpass"; filter.frequency.value = 400; gain.gain.value = 0;
  osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination); osc.start();
  return { ctx, osc, filter, gain };
}
function blip(ctx, f0, f1, dur, type = "square", vol = 0.08) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur);
}
function crash(ctx) {
  const len = ctx.sampleRate * 0.5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; g.gain.value = 0.25; src.connect(g); g.connect(ctx.destination); src.start();
}

export default function Game() {
  const sim = useRef(null);
  const keys = useRef({ left:false, right:false, up:false, down:false });
  const flipped = useRef(0);
  const raf = useRef(0);
  const [snap, setSnap] = useState(null);
  const [status, setStatus] = useState("playing"); // playing | paused | failed | won
  const [muted, setMuted] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const stageRef = useRef(0);
  const [stage, setStage] = useState(0);
  const goTo = useCallback((i) => {
    const n = (i + STAGES.length) % STAGES.length;
    stageRef.current = n; setStage(n);
    sim.current = createWorld(n);
    flipped.current = 0;
    setStatus("playing");
  }, []);
  const reset = useCallback(() => goTo(stageRef.current), [goTo]);

  useEffect(() => { reset(); }, [reset]);

  const audio = useRef(null);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  const ensureAudio = useCallback(() => {
    if (!audio.current) audio.current = makeAudio();
    if (audio.current?.ctx.state === "suspended") audio.current.ctx.resume();
  }, []);

  const jump = useCallback(() => {
    const s = sim.current, now = performance.now();
    if (!s || statusRef.current !== "playing" || s.since > 8 || now - s.jumpAt < 350) return;
    [s.chassis, s.wb, s.wf].forEach((b) => Body.setVelocity(b, { x: b.velocity.x, y: -5.5 }));
    s.since = 99; s.jumpAt = now;
    if (audio.current && !mutedRef.current) blip(audio.current.ctx, 220, 520, 0.14);
  }, []);

  const audioTick = (active, k, speed) => {
    const a = audio.current; if (!a) return;
    const t = a.ctx.currentTime, on = active && !mutedRef.current, gas = k.right || k.left;
    a.osc.frequency.setTargetAtTime(50 + speed * 1.6 + (gas ? 35 : 0), t, 0.08);
    a.filter.frequency.setTargetAtTime(350 + speed * 8 + (gas ? 400 : 0), t, 0.1);
    a.gain.gain.setTargetAtTime(on ? (gas ? 0.09 : 0.04) : 0, t, 0.08);
  };

  useEffect(() => {
    if (!audio.current || mutedRef.current) return;
    if (status === "failed") crash(audio.current.ctx);
    if (status === "won") blip(audio.current.ctx, 400, 900, 0.4, "triangle", 0.12);
  }, [status]);

  // keyboard
  useEffect(() => {
    const map = { ArrowRight:"right", KeyD:"right", ArrowLeft:"left", KeyA:"left", ArrowUp:"up", KeyW:"up", ArrowDown:"down", KeyS:"down" };
    const onKey = (v) => (e) => {
      if (v) ensureAudio();
      const name = map[e.code];
      if (name) {
        keys.current[name] = v; e.preventDefault();
        if (name === "up" && v && !e.repeat) jump();
        return;
      }
      if (!v) return;
      if (e.code === "Space") {
        e.preventDefault();
        setStatus((st) => st === "playing" ? "paused" : st === "paused" ? "playing" : st);
      }
      if (e.code === "Enter" && statusRef.current === "failed") { e.preventDefault(); reset(); }
      if (e.code === "Enter" && statusRef.current === "won") { e.preventDefault(); goTo(stageRef.current + 1); }
      if (e.code === "KeyR") reset();
    };
    const clear = () => { Object.keys(keys.current).forEach((k) => (keys.current[k] = false)); };
    const dn = onKey(true), up = onKey(false);
    const blurFocus = () => document.activeElement?.blur?.(); // buttons never steal keys
    window.addEventListener("keydown", dn); window.addEventListener("keyup", up);
    window.addEventListener("blur", clear); document.addEventListener("visibilitychange", clear);
    window.addEventListener("pointerup", blurFocus);
    return () => {
      window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("pointerup", blurFocus);
    };
  }, [reset, goTo, jump, ensureAudio]);

  // game loop
  useEffect(() => {
    let last = performance.now(), acc = 0;
    const loop = (t) => {
      raf.current = requestAnimationFrame(loop);
      const s = sim.current; if (!s) return;
      acc += Math.min(t - last, 50); last = t;
      if (statusRef.current === "playing") {
        while (acc >= 1000/60) {
          acc -= 1000/60;
          const k = keys.current, { chassis, wb, wf, engine } = s;
          const drive = (w) => {
            let av = w.angularVelocity;
            if (k.right) av = Math.min(av + 0.03, 0.45);
            else if (k.left) av = Math.max(av - 0.03, -0.3);
            else av *= 0.98;
            Body.setAngularVelocity(w, av);
          };
          drive(wb); drive(wf);
          if (k.down) Body.setAngularVelocity(chassis, Math.min(chassis.angularVelocity + 0.004, 0.06));
          Engine.update(engine, 1000/60);
          s.since = [wb, wf].some((w) => Query.collides(w, s.ground).length > 0) ? 0 : s.since + 1;
          const a = ((chassis.angle % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
          flipped.current = a > 2.3 && a < 3.98 ? flipped.current + 1 : 0;
          if (chassis.position.y > 700 || flipped.current > 90) setStatus("failed");
          else if (chassis.position.x > STAGES[stageRef.current].end) setStatus("won");
        }
      } else acc = 0;
      const { chassis, wb, wf } = s;
      audioTick(statusRef.current === "playing", keys.current, Math.hypot(chassis.velocity.x, chassis.velocity.y) * 3.6);
      setSnap({
        c: { x: chassis.position.x, y: chassis.position.y, a: chassis.angle },
        w: [wb, wf].map((w) => ({ x: w.position.x, y: w.position.y, a: w.angle })),
        speed: Math.round(Math.hypot(chassis.velocity.x, chassis.velocity.y) * 3.6),
      });
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const hold = (name) => ({
    onPointerDown: () => { ensureAudio(); keys.current[name] = true; if (name === "up") jump(); },
    onPointerUp: () => (keys.current[name] = false),
    onPointerLeave: () => (keys.current[name] = false),
    onPointerCancel: () => (keys.current[name] = false),
    onContextMenu: (e) => e.preventDefault(),
  });

  if (!snap) return null;
  const st = STAGES[stage];
  const cx = snap.c.x - W/3, cy = Math.min(snap.c.y - H/2 - 20, 400);
  const dist = Math.max(0, Math.round((snap.c.x - 150) / 10));
  
  return (
    <div className="game">
      <svg className="scene" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={st.sky[0]}/><stop offset="1" stopColor={st.sky[1]}/></linearGradient>
          <g id="cloud" fill="#fff"><circle cx="0" cy="0" r="26"/><circle cx="30" cy="-14" r="32"/><circle cx="66" cy="-4" r="28"/><circle cx="96" cy="6" r="20"/><rect x="-26" y="0" width="122" height="26" rx="13"/></g>
          <g id="mtn"><path d="M0,260 L120,40 L240,260Z" fill="#59657a"/><path d="M120,40 L240,260 L150,260 L132,120Z" fill="#3c4760"/><path d="M120,40 L82,108 L104,96 L120,118 L140,96 L158,112Z" fill="#fff"/></g>
          <g id="pine"><path d="M0,0 L14,-34 L28,0Z M3,-22 L14,-58 L25,-22Z" fill="#14502f"/></g>
        </defs>
        <rect width={W} height={H} fill="url(#sky)" />
        <g transform={`translate(${-cx*0.08},0)`}>
          {[0,330,640,950,1260,1570].map((x,i) => <use key={x} href="#cloud" x={x+40} y={60+(i%2)*40} />)}
        </g>
        <g transform={`translate(${-cx*0.15 % 600 - 100},100)`}>
          {[0,300,600,900,1200].map((x) => <use key={x} href="#mtn" x={x} y="0" />)}
        </g>
        <g transform={`translate(${-cx*0.3 % 160},0)`}>
          <path d={`M-200,440 Q100,320 400,400 T1000,390 L1000,500 L-200,500Z`} fill="#0f3d2a" />
          {Array.from({length:12},(_,i)=><use key={i} href="#pine" x={i*80-60} y={400+(i%3)*14} />)}
        </g>
        <rect y="410" width={W} height="60" fill="#0c3322" />
        <g transform={`translate(${-cx},${-cy})`}>
          {st.track.map((t, i) => {
            const d = "M" + t.pts.map((p) => p.join(",")).join(" L");
            return t.t === "g" ? (
              <g key={i} fill="none" strokeLinejoin="round">
                <path d={d} transform="translate(0,10)" stroke="#3f6b14" strokeWidth="22" />
                <path d={d} transform="translate(0,4)" stroke="#86b82d" strokeWidth="9" />
              </g>
            ) : (
              <g key={i} fill="none">
                <path d={d} transform="translate(0,10)" stroke="#5a3118" strokeWidth="20" />
                <path d={d} transform="translate(0,10)" stroke="#9a5a2b" strokeWidth="16" strokeDasharray="5 9" />
              </g>
            );
          })}
          <g transform={`translate(${st.end},${groundY(st.track, st.end)})`}><rect y="-90" width="5" height="90" fill="#fff"/><path d="M5,-90 L45,-78 L5,-66Z" fill="#ff4d4d"/></g>
          {snap.w.map((w, i) => (
            <g key={i} transform={`translate(${w.x},${w.y}) rotate(${w.a*180/Math.PI})`}>
              <circle r="16" fill="#1b1b1b" /><circle r="9" fill="#d9dde3" /><circle r="3" fill="#555" /><line x1="-9" x2="9" stroke="#888" strokeWidth="2" />
            </g>
          ))}
          <g transform={`translate(${snap.c.x},${snap.c.y}) rotate(${snap.c.a*180/Math.PI})`}>
            <rect x="-62" y="-12" width="24" height="22" rx="3" fill="#e8742a" stroke="#a84a14" strokeWidth="2" />
            <path d="M-46,10 L-46,-4 Q-40,-12 -26,-14 Q-16,-34 6,-32 Q26,-30 32,-12 L44,-8 Q50,-2 48,10Z" fill="#2f8ff0" />
            <path d="M-20,-14 Q-12,-27 4,-26 L4,-14Z M10,-14 L10,-26 Q22,-25 27,-14Z" fill="#d7efff" />
            <circle cx="44" cy="-1" r="4" fill="#ffe27a" />
          </g>
        </g>
      </svg>

      <div className="chip start"><b/>START {stage + 1} / {STAGES.length}</div>
      <div className="hud">
        <small>DISTANCE</small><small>SPEED</small><strong>{dist} m</strong><strong>{snap.speed} km/h</strong>
        <div className="bar"><i style={{ width: `${Math.min(100, (snap.c.x/st.end)*100)}%` }} /></div>
      </div>

      <div className="toolbar">
        <button onClick={() => setStatus(status === "paused" ? "playing" : "paused")}>{status === "paused" ? "Resume" : "Pause"}</button>
        <button onClick={() => goTo(stage - 1)}>◀ Stage</button>
        <button onClick={reset}>Restart</button>
        <button onClick={() => goTo(stage + 1)}>Stage ▶</button>
        <button onClick={() => { ensureAudio(); setMuted(!muted); }}>{muted ? "Unmute" : "Mute"}</button>
        <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
      </div>
      <button className="pad left" {...hold("left")}>◀</button>
      <button className="pad right" {...hold("right")}>▶</button>
      <button className="pad tl" {...hold("up")}>⤒</button>
      <button className="pad tr" {...hold("down")}>↻</button>

      {(status === "failed" || status === "won") && (
        <div className="overlay">
          <div className={`modal ${status}`}>
            <small>{status === "failed" ? "ACCIDENT DETECTED" : "FINISH LINE REACHED"}</small>
            <h2>{status === "failed" ? `STAGE ${stage + 1} FAILED`
              : stage === STAGES.length - 1 ? "ALL STAGES CLEARED" : `STAGE ${stage + 1} COMPLETE`}</h2>
            <p>{status === "failed" ? "Your car crashed or fell. Try again to beat your distance." : `You drove ${dist} m. Nice run.`}</p>
            <button onClick={() => (status === "failed" ? reset() : goTo(stage + 1))}>
              {status === "failed" ? `RESTART STAGE ${stage + 1} (ENTER)`
                : stage === STAGES.length - 1 ? "PLAY AGAIN (ENTER)" : "NEXT STAGE (ENTER)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
