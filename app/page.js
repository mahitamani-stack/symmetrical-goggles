"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Image as DreiImage, Environment } from "@react-three/drei";
import * as THREE from "three";

const CLOUD = "dyazh2nxk";
const lo = i => `https://res.cloudinary.com/${CLOUD}/image/upload/w_220,q_35,f_auto/img${String(i).padStart(5,"0")}.jpg`;
const hi = i => `https://res.cloudinary.com/${CLOUD}/image/upload/q_auto,f_auto/img${String(i).padStart(5,"0")}.jpg`;

const RANGES = [[0,64],[65,129],[130,194],[195,259],[260,324],[325,389],[390,454],[455,520]];
const N_PREV = 50; // tiles in system view

// Dramatic solar system — big planets, deep Z variation, reference image 2 scale
const LAYOUT = [
  { pos:[-55, 18,-15], r:7.5 },
  { pos:[ 12, 38, 10], r:9.0 },
  { pos:[ 62, 12,-22], r:5.0 },
  { pos:[-30,-36,  8], r:10.0 },
  { pos:[ 25,-32, -8], r:6.5 },
  { pos:[ 65,-22, 18], r:4.2 },
  { pos:[-65,  8,  6], r:7.0 },
  { pos:[ -5,  2, 28], r:8.5 },
];

const PLANETS = RANGES.map(([s,e], i) => {
  const all  = Array.from({length:e-s+1}, (_,j) => s+j);
  const step = Math.max(1, Math.floor(all.length / N_PREV));
  const prev = all.filter((_,j) => j%step===0).slice(0, N_PREV);
  return { id:i, pos:LAYOUT[i].pos, r:LAYOUT[i].r, prevUrls:prev.map(lo), fullUrls:all.map(hi) };
});

function fib(n, r) {
  const phi = Math.PI*(3-Math.sqrt(5));
  return Array.from({length:n}, (_,i) => {
    const y=(i*2/n-1)+1/n, rr=Math.sqrt(Math.max(0,1-y*y)), t=i*phi;
    return [Math.cos(t)*rr*r, y*r, Math.sin(t)*rr*r];
  });
}
const SYS_POS = PLANETS.map(p => fib(N_PREV, p.r));
const DET_POS = PLANETS.map(p => fib(p.fullUrls.length, 7.0));

const HC=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

// ── TILE: lookAt planet center in WORLD SPACE ─────────────────────────
// parent.getWorldPosition() accounts for system group rotation correctly
// This is what creates the concave inward-facing sphere effect
function Tile({ pos, url, opacity, sc, onClick }) {
  const ref = useRef();
  const _c  = useRef(new THREE.Vector3());
  useFrame(() => {
    if (!ref.current?.parent) return;
    ref.current.parent.getWorldPosition(_c.current);
    ref.current.lookAt(_c.current);
  });
  return (
    <DreiImage
      ref={ref} url={url} position={pos} scale={sc}
      transparent opacity={opacity} toneMapped={false}
      onClick={e => { e.stopPropagation(); onClick?.(); }}
      onError={() => {}}
    />
  );
}

// ── OCCLUDER: white sphere to block see-through to back planets ───────
// FrontSide → renders near hemisphere facing camera
// Writes depth → blocks distant planets from showing through tile gaps
// Near hemisphere appears white (same as white background) = invisible seam

// ── CAMERA RIG: lerps position + lookAt toward targets ────────────────
function CamRig({ camRef, lookRef, fovRef }) {
  const { camera } = useThree();
  const cPos = useRef(new THREE.Vector3(0,0,120));
  const cLook = useRef(new THREE.Vector3(0,0,0));
  useFrame(() => {
    cPos.current.lerp(camRef.current, 0.048);
    cLook.current.lerp(lookRef.current, 0.048);
    camera.position.copy(cPos.current);
    camera.lookAt(cLook.current);
    if (Math.abs(camera.fov - fovRef.current) > 0.08) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, fovRef.current, 0.04);
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

// ── SCENE: all 3D logic ───────────────────────────────────────────────
function Scene({ inputRef, selRef, stageRef, selState, stage, mode, onSelect, onDeepen, onImageClick, camRef, lookRef, fovRef }) {  const sysRef  = useRef();
  const pRefs   = useRef([]);
  const spins   = useRef(PLANETS.map((_,i) => i*0.4));
  // Anchor: captured inside useFrame on justDown — ALWAYS has correct mesh rotation
  const anchor    = useRef(null);
  const wasDown   = useRef(false);
  const frozenRot = useRef({ x:0, y:0 });
  const _pw  = useRef(new THREE.Vector3());
  const _dir = useRef(new THREE.Vector3());
  // Hand dwell
  const dwellId  = useRef(null);
  const dwellT   = useRef(0);
  const prevHand = useRef({ x:0.5, y:0.5 });

  useFrame((state, dt) => {
    if (!sysRef.current) return;
    const inp = inputRef.current;
    const sel = selRef.current;

    // ── justDown: first frame mousedown is detected ────────────────
    const justDown = inp.down && !wasDown.current;
    wasDown.current = inp.down;

    // ── ANCHOR captured in useFrame — correct rotation values ──────
    // If captured in event listener, mesh rotation may be stale
    if (justDown && mode === "mouse") {
      if (sel === -1) {
        anchor.current = {
          sx:inp.x, sy:inp.y,
          rx:sysRef.current.rotation.x,
          ry:sysRef.current.rotation.y
        };
      } else if (pRefs.current[sel]) {
        anchor.current = {
          sx:inp.x, sy:inp.y,
          rx:pRefs.current[sel].rotation.x,
          ry:pRefs.current[sel].rotation.y
        };
      }
    }
    if (!inp.down) anchor.current = null;

    // ── SYSTEM GROUP rotation ──────────────────────────────────────
    if (sel === -1) {
      if (mode === "mouse" && inp.down && inp.dragging && anchor.current) {
        const tx = Math.max(-0.65, Math.min(0.65,
          anchor.current.rx + (inp.y - anchor.current.sy) * 3.0));
        const ty = anchor.current.ry + (inp.x - anchor.current.sx) * 5.0;
        sysRef.current.rotation.x = THREE.MathUtils.lerp(sysRef.current.rotation.x, tx, 0.14);
        sysRef.current.rotation.y = THREE.MathUtils.lerp(sysRef.current.rotation.y, ty, 0.14);
      } else if (mode === "hand" && inp.handPresent) {
        // Hand: direct delta from previous position → smooth continuous rotation
        const dx = inp.x - prevHand.current.x;
        const dy = inp.y - prevHand.current.y;
        sysRef.current.rotation.y += dx * 4.5;
        sysRef.current.rotation.x = Math.max(-0.65, Math.min(0.65,
          sysRef.current.rotation.x + dy * 3.0));
      } else {
        // Auto drift when idle
        sysRef.current.rotation.y += dt * 0.015;
        sysRef.current.rotation.x = THREE.MathUtils.lerp(sysRef.current.rotation.x, 0, 0.01);
      }
      // Save frozen position for when we zoom into a planet
      frozenRot.current.x = sysRef.current.rotation.x;
      frozenRot.current.y = sysRef.current.rotation.y;
    } else {
      // FREEZE system when planet selected — no drift, stays put
      sysRef.current.rotation.x = THREE.MathUtils.lerp(sysRef.current.rotation.x, frozenRot.current.x, 0.12);
      sysRef.current.rotation.y = THREE.MathUtils.lerp(sysRef.current.rotation.y, frozenRot.current.y, 0.12);
    }

    if (mode === "hand") prevHand.current = { x:inp.x, y:inp.y };

    // ── PLANET self-spin + selected planet rotation ─────────────────
    PLANETS.forEach((_, i) => {
      const pg = pRefs.current[i];
      if (!pg) return;
      if (i !== sel) {
        spins.current[i] += dt * (0.02 + i * 0.004);
        pg.rotation.y = spins.current[i];
        pg.rotation.x = THREE.MathUtils.lerp(pg.rotation.x, 0, 0.04);
      } else {
        // Selected: user controls rotation
        if (mode === "mouse" && inp.down && inp.dragging && anchor.current) {
          const tx = Math.max(-1.2, Math.min(1.2,
            anchor.current.rx + (inp.y - anchor.current.sy) * 4.5));
          const ty = anchor.current.ry + (inp.x - anchor.current.sx) * 6.5;
          pg.rotation.x = THREE.MathUtils.lerp(pg.rotation.x, tx, 0.14);
          pg.rotation.y = THREE.MathUtils.lerp(pg.rotation.y, ty, 0.14);
          spins.current[i] = pg.rotation.y;
        } else if (mode === "hand" && inp.handPresent) {
          const dx = inp.x - prevHand.current.x;
          const dy = inp.y - prevHand.current.y;
          pg.rotation.y += dx * 5.5;
          pg.rotation.x = Math.max(-1.2, Math.min(1.2, pg.rotation.x + dy * 4.0));
          spins.current[i] = pg.rotation.y;
        } else {
          spins.current[i] += dt * 0.04;
          pg.rotation.y = THREE.MathUtils.lerp(pg.rotation.y, spins.current[i], 0.05);
          pg.rotation.x = THREE.MathUtils.lerp(pg.rotation.x, 0, 0.02);
        }
      }
    });

    // ── CAMERA TARGET: computed from WORLD POSITION every frame ────
    // This is the key fix — world position accounts for system group rotation
    // Camera always flies to where the planet ACTUALLY IS, not where it started
   if (sel !== -1 && pRefs.current[sel]) {
  pRefs.current[sel].getWorldPosition(_pw.current);
  _dir.current.copy(_pw.current).normalize();
  if (_dir.current.lengthSq() < 0.001) _dir.current.set(0, 0, 1);
  const pr = PLANETS[sel].r;
  if (stageRef.current === 1) {
    // Stage 2: outside planet, see whole sphere
    camRef.current.copy(_pw.current).addScaledVector(_dir.current, pr * 3.0);
    fovRef.current = 40;
  } else {
    // Stage 3: close in, images fill screen like planetarium
    camRef.current.copy(_pw.current).addScaledVector(_dir.current, pr * 1.15);
    fovRef.current = 65;
  }
  lookRef.current.copy(_pw.current);
} else {
  camRef.current.set(0, 0, 120);
  lookRef.current.set(0, 0, 0);
  fovRef.current = 60;
}

    // ── HAND DWELL: hold hand over planet to enter it ──────────────
    if (mode === "hand" && sel === -1 && inp.handPresent) {
      let bestId = -1, bestD = Infinity;
      PLANETS.forEach((_, i) => {
        const pg = pRefs.current[i];
        if (!pg) return;
        pg.getWorldPosition(_pw.current);
        const ndc = _pw.current.clone().project(state.camera);
        const d = Math.hypot((ndc.x + 1) / 2 - inp.x, (1 - ndc.y) / 2 - inp.y);
        if (d < bestD) { bestD = d; bestId = i; }
      });
      if (bestD < 0.14) {
        if (dwellId.current === bestId) {
          if (Date.now() - dwellT.current > 1500) {
            onSelect(bestId);
            dwellId.current = null;
          }
        } else {
          dwellId.current = bestId;
          dwellT.current = Date.now();
        }
      } else {
        dwellId.current = null;
      }
    }

    // ── HAND DWELL: hold hand still in planet view to fullscreen ───
    if (mode === "hand" && sel !== -1 && inp.handPresent) {
      const d = Math.hypot(inp.x - 0.5, inp.y - 0.5);
      if (d < 0.12) {
        if (dwellId.current === "img") {
          if (Date.now() - dwellT.current > 1500) {
            // Fullscreen the tile closest to camera view direction
            const pg = pRefs.current[sel];
            if (pg) {
              pg.getWorldPosition(_pw.current);
              const viewDir = _pw.current.clone().sub(state.camera.position).normalize();
              let bestDot = -Infinity, bestIdx = 0;
              DET_POS[sel].forEach((lp, j) => {
                const wp = new THREE.Vector3(...lp).applyMatrix4(pg.matrixWorld);
                const td = wp.clone().sub(state.camera.position).normalize();
                if (td.dot(viewDir) > bestDot) { bestDot = td.dot(viewDir); bestIdx = j; }
              });
              onImageClick(PLANETS[sel].fullUrls[bestIdx]);
            }
            dwellId.current = "cooldown";
            dwellT.current = Date.now() + 2500;
          }
        } else if (dwellId.current !== "cooldown" || Date.now() > dwellT.current) {
          dwellId.current = "img";
          dwellT.current = Date.now();
        }
      } else {
        if (dwellId.current === "img") dwellId.current = null;
      }
    }
  });

  return (
    <group ref={sysRef}>
      {PLANETS.map((p, i) => {
        const isSel  = selState === i;
        const anysel = selState !== -1;
        const urls   = isSel ? p.fullUrls  : p.prevUrls;
        const fpos   = isSel ? DET_POS[i]  : SYS_POS[i];
        // Tile scale: proportional to planet radius in system view, standard in detail
        const tsc    = isSel
          ? [1.6, 2.24, 1]
          : [(p.r / 4.5) * 1.32, (p.r / 4.5) * 1.85, 1];
        // Opacity: full when selected, near-invisible when another is selected, 90% in system
        const op     = anysel && !isSel ? 0.04 : (isSel ? 1.0 : 0.9);
        return (
          <group
            key={i}
            ref={el => { pRefs.current[i] = el; }}
            position={p.pos}
          >
          
            {urls.map((url, j) => (
              <Tile
                key={`${i}-${j}-${isSel ? "hi" : "lo"}`}
                pos={fpos[j]} url={url} opacity={op} sc={tsc}
                onClick={
  !anysel
    ? () => { if (!inputRef.current.dragging) onSelect(i); }
    : isSel && stage === 1
    ? () => { if (!inputRef.current.dragging) onDeepen(); }
    : isSel && stage === 2
    ? () => onImageClick(url)
    : undefined
}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}

// ── HOME ──────────────────────────────────────────────────────────────
export default function Home() {
  const videoRef        = useRef(null);
  const cameraCanvasRef = useRef(null);
  const smoothRef       = useRef({ x: 0.5, y: 0.5 });

  // Unified input state — mutated directly, read in useFrame
  const inputRef = useRef({ down:false, x:0.5, y:0.5, dragging:false, handPresent:false });
  const downPx   = useRef({ x:0, y:0 });

  // selRef for useFrame logic (no closure staleness)
  // selState for React rendering (triggers re-render)
  const selRef   = useRef(-1);
const stageRef = useRef(0); // 0=system 1=planet-overview 2=inside
const [selState, setSelState] = useState(-1);
const [stage,    setStage]    = useState(0);

  const [fullscreen, setFullscreen] = useState(null);
  const [mode,       setMode]       = useState("mouse");
  const [camReady,   setCamReady]   = useState(false);

 const camRef  = useRef(new THREE.Vector3(0, 0, 120));
const lookRef = useRef(new THREE.Vector3(0, 0, 0));
const fovRef  = useRef(60);

  const handleSelect = idx => {
  selRef.current  = idx;
  stageRef.current = 1;
  setSelState(idx);
  setStage(1);
  inputRef.current = { ...inputRef.current, down:false, dragging:false };
};

const handleDeepen = () => {
  stageRef.current = 2;
  setStage(2);
  inputRef.current = { ...inputRef.current, down:false, dragging:false };
};

const handleBack = () => {
  if (stageRef.current === 2) {
    stageRef.current = 1;
    setStage(1);
  } else {
    selRef.current   = -1;
    stageRef.current = 0;
    setSelState(-1);
    setStage(0);
  }
  inputRef.current = { ...inputRef.current, down:false, dragging:false };
};

  // ── Mouse events ───────────────────────────────────────────────────
  useEffect(() => {
    const dn = e => {
      downPx.current = { x:e.clientX, y:e.clientY };
      inputRef.current = {
        ...inputRef.current,
        down:true,
        x:e.clientX/window.innerWidth,
        y:e.clientY/window.innerHeight,
        dragging:false,
      };
    };
    const mv = e => {
      if (!inputRef.current.down || mode !== "mouse") return;
      const dx = e.clientX - downPx.current.x;
      const dy = e.clientY - downPx.current.y;
      inputRef.current = {
        ...inputRef.current,
        x: e.clientX/window.innerWidth,
        y: e.clientY/window.innerHeight,
        dragging: inputRef.current.dragging || Math.hypot(dx, dy) > 8,
      };
    };
    const up = () => {
      inputRef.current = { ...inputRef.current, down:false, dragging:false };
    };
    window.addEventListener("mousedown", dn);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup",   up);
    return () => {
      window.removeEventListener("mousedown", dn);
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup",   up);
    };
  }, [mode]);

  // ── Hand tracking ──────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "hand") return;
    let animId, stream;
    async function init() {
      try {
        const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const fs = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        const hl = await HandLandmarker.createFromOptions(fs, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO", numHands: 1,
        });
        stream = await navigator.mediaDevices.getUserMedia(
          { video:{ width:240, height:135, facingMode:"user" } });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamReady(true);
        const ctx = cameraCanvasRef.current.getContext("2d");
        let lastTime = -1;
        function detect() {
          animId = requestAnimationFrame(detect);
          const v = videoRef.current;
          if (!v || v.currentTime === lastTime) return;
          lastTime = v.currentTime;
          ctx.save(); ctx.translate(240, 0); ctx.scale(-1, 1);
          ctx.drawImage(v, 0, 0, 240, 135); ctx.restore();
          const R = hl.detectForVideo(v, performance.now());
          if (R.landmarks?.length > 0) {
            const lm  = R.landmarks[0];
            const mir = lm.map(p => ({...p, x:1-p.x}));
            ctx.strokeStyle="#000"; ctx.lineWidth=2;
            HC.forEach(([a,b]) => {
              ctx.beginPath();
              ctx.moveTo(mir[a].x*240, mir[a].y*135);
              ctx.lineTo(mir[b].x*240, mir[b].y*135);
              ctx.stroke();
            });
            mir.forEach(p => {
              ctx.beginPath(); ctx.arc(p.x*240, p.y*135, 2.5, 0, Math.PI*2);
              ctx.fillStyle="#fff"; ctx.fill();
              ctx.strokeStyle="#000"; ctx.lineWidth=1; ctx.stroke();
            });
            // Palm (landmark 9) for position — smooth it
            const z = 0.32;
            smoothRef.current.x += (mir[9].x - smoothRef.current.x) * z;
            smoothRef.current.y += (mir[9].y - smoothRef.current.y) * z;
            inputRef.current = {
              ...inputRef.current,
              x: smoothRef.current.x,
              y: smoothRef.current.y,
              handPresent: true,
            };
          } else {
            smoothRef.current.x += (0.5 - smoothRef.current.x) * 0.06;
            smoothRef.current.y += (0.5 - smoothRef.current.y) * 0.06;
            inputRef.current = { ...inputRef.current, handPresent:false };
          }
        }
        detect();
      } catch(e) { console.warn("Hand tracking unavailable:", e); }
    }
    init();
    return () => {
      if (animId) cancelAnimationFrame(animId);
      stream?.getTracks().forEach(t => t.stop());
      setCamReady(false);
    };
  }, [mode]);

  const btn = {
    display:"flex", alignItems:"center", gap:8, padding:"10px 20px",
    background:"rgba(255,255,255,0.92)", border:"1px solid rgba(0,0,0,0.1)",
    borderRadius:"1rem", boxShadow:"0 1px 4px rgba(0,0,0,0.08)",
    cursor:"pointer", fontSize:12, fontWeight:600,
    fontFamily:"Inter,system-ui,sans-serif", color:"#333", letterSpacing:"0.05em",
  };

  return (
    <div style={{position:"relative",width:"100vw",height:"100vh",background:"#fff",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0}}>
        <Canvas
          camera={{ position:[0,0,120], fov:60 }}
          gl={{ antialias:true, alpha:true, powerPreference:"high-performance" }}
          dpr={[1, 2]}
        >
          <color attach="background" args={["#ffffff"]} />
          <fog attach="fog" args={["#ffffff", 100, 260]} />
          <ambientLight intensity={2} />
          <directionalLight position={[10,20,20]} intensity={2.5} />
          <Suspense fallback={null}>
            <CamRig camRef={camRef} lookRef={lookRef} fovRef={fovRef} />
            <Scene
  inputRef={inputRef}
  selRef={selRef}
  stageRef={stageRef}
  selState={selState}
  stage={stage}
  mode={mode}
  onSelect={handleSelect}
  onDeepen={handleDeepen}
  onImageClick={setFullscreen}
  camRef={camRef}
  lookRef={lookRef}
  fovRef={fovRef}
/>
            <Environment preset="studio" />
          </Suspense>
        </Canvas>
      </div>

      {/* Mode toggle */}
      <div style={{position:"fixed",top:24,right:24,zIndex:10}}>
        <button onClick={() => setMode(m => m==="mouse"?"hand":"mouse")} style={btn}>
          <span style={{fontSize:16}}>{mode==="mouse"?"🖱️":"✋"}</span>
          {mode==="mouse"?"MOUSE MODE":"HAND MODE"}
        </button>
      </div>

      {/* Back */}
      {stage > 0 && (
  <div style={{position:"fixed",top:24,left:24,zIndex:10}}>
    <button onClick={handleBack} style={btn}>
      {stage === 2 ? "← PLANET VIEW" : "← ALL PLANETS"}
    </button>
  </div>
)}

      {/* Hint */}
      <div style={{position:"absolute",top:24,left:selState!==-1?180:24,zIndex:10}}>
        <p style={{paddingLeft:8,fontSize:10,fontWeight:700,letterSpacing:"0.1em",
          color:"rgb(163,163,163)",textTransform:"uppercase",fontFamily:"Inter,system-ui,sans-serif"}}>
         {stage === 2
  ? "Drag to rotate · Click image to open"
  : stage === 1
  ? "Click sphere to fly inside · Drag to rotate"
  : mode==="hand"
  ? "Move hand to rotate · Hold over planet to enter"
  : "Drag to rotate · Click planet to enter"
}
        </p>
      </div>

      {/* Camera preview */}
      {mode === "hand" && (
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
          width:240,height:135,borderRadius:"1.8rem",overflow:"hidden",
          boxShadow:"0 20px 40px -10px rgba(0,0,0,0.1)",border:"5px solid white",
          background:"white",opacity:camReady?1:0.3,transition:"opacity 0.5s",zIndex:10}}>
          <video ref={videoRef} playsInline muted style={{display:"none"}} width={240} height={135}/>
          <canvas ref={cameraCanvasRef} width={240} height={135}
            style={{width:"100%",height:"100%",objectFit:"cover"}}/>
        </div>
      )}

      {/* Fullscreen modal */}
      {fullscreen && (
        <div onClick={() => setFullscreen(null)} style={{
          position:"fixed",inset:0,background:"rgba(255,255,255,0.97)",
          display:"flex",alignItems:"center",justifyContent:"center",
          zIndex:999,cursor:"zoom-out",
          animation:"zoomIn 0.2s cubic-bezier(0.34,1.56,0.64,1)"}}>
          <style>{`@keyframes zoomIn{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}`}</style>
          <img src={fullscreen} alt=""
            style={{maxWidth:"88vw",maxHeight:"88vh",objectFit:"contain"}}/>
        </div>
      )}
    </div>
  );
}
