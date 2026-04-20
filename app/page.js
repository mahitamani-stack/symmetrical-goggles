"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Image as DreiImage, Environment } from "@react-three/drei";
import * as THREE from "three";

// ── URLs ─────────────────────────────────────────────────────────────
const CLOUD = "dyazh2nxk";
const lo = i => `https://res.cloudinary.com/${CLOUD}/image/upload/w_200,q_30,f_auto/img${String(i).padStart(5,"0")}.jpg`;
const hi = i => `https://res.cloudinary.com/${CLOUD}/image/upload/q_auto,f_auto/img${String(i).padStart(5,"0")}.jpg`;

// ── Planet data ───────────────────────────────────────────────────────
const RANGES = [[0,64],[65,129],[130,194],[195,259],[260,324],[325,389],[390,454],[455,520]];
const N_PREV   = 30;    // images shown in system view per sphere
const R_SYS    = 4.0;   // system sphere radius (before scale)
const R_DETAIL = 7.0;   // detail sphere radius
const ZOOM_D   = 16;    // camera distance from planet center when zoomed in
const DWELL_MS = 1400;  // ms to hold hand over planet to enter it
const DWELL_RAD = 0.15; // screen-fraction radius for hand dwell detection

const LAYOUT = [
  { pos:[-22, 9,-6], scale:0.85 },
  { pos:[ 5, 14, 4], scale:1.05 },
  { pos:[ 27,  6,-9], scale:0.72 },
  { pos:[-13, -9, 5], scale:1.12 },
  { pos:[ 11,-13,-2], scale:0.90 },
  { pos:[ 28,-10, 8], scale:0.75 },
  { pos:[-28,  2, 3], scale:0.92 },
  { pos:[ -1,  1,10], scale:1.28 },
];

const PLANETS = RANGES.map(([s,e], i) => {
  const all  = Array.from({length: e-s+1}, (_,j) => s+j);
  const step = Math.max(1, Math.floor(all.length / N_PREV));
  const prev = all.filter((_,j) => j%step===0).slice(0,N_PREV);
  return { id:i, posArr:LAYOUT[i].pos, scale:LAYOUT[i].scale, prevUrls:prev.map(lo), fullUrls:all.map(hi) };
});

// ── Fibonacci sphere positions ────────────────────────────────────────
function fib(n, r) {
  const phi = Math.PI*(3-Math.sqrt(5));
  return Array.from({length:n}, (_,i) => {
    const y  = (i*2/n - 1) + 1/n;
    const rr = Math.sqrt(Math.max(0, 1-y*y));
    const t  = i*phi;
    return [Math.cos(t)*rr*r, y*r, Math.sin(t)*rr*r];
  });
}
const SYS_POS  = PLANETS.map(p => fib(N_PREV, R_SYS*p.scale));
const DET_POS  = PLANETS.map(p => fib(p.fullUrls.length, R_DETAIL));

// ── Hand landmarker connections ───────────────────────────────────────
const HC=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

// ────────────────────────────────────────────────────────────────────
// TILE — THE KEY FIX FOR SPHERE SHAPE
// Each tile's parent group IS the planet group, centered in world space.
// getWorldPosition(parent) → the planet's center in world space.
// lookAt(center) makes the tile face OUTWARD from that center —
// identical to how the original single sphere used lookAt(0,0,0).
// ────────────────────────────────────────────────────────────────────
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
      ref={ref}
      url={url}
      position={pos}
      scale={sc}
      transparent
      opacity={opacity}
      toneMapped={false}
      onClick={e => { e.stopPropagation(); onClick?.(); }}
      onError={() => {}}
    />
  );
}

// ── Camera: lerps toward target refs ─────────────────────────────────
function CamRig({ camRef, lookRef, fovRef }) {
  const { camera } = useThree();
  const _p = useRef(new THREE.Vector3(0,0,65));
  const _l = useRef(new THREE.Vector3(0,0,0));

  useFrame(() => {
    _p.current.lerp(camRef.current,  0.055);
    _l.current.lerp(lookRef.current, 0.055);
    camera.position.copy(_p.current);
    camera.lookAt(_l.current);
    if (Math.abs(camera.fov - fovRef.current) > 0.08) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, fovRef.current, 0.05);
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

// ── Main scene ────────────────────────────────────────────────────────
function Scene({ mouseRef, selectedPlanet, mode, onSelect, onImageClick }) {
  const { camera }  = useThree();
  const sysRef      = useRef();
  const pRefs       = useRef([]);          // planet group refs
  const spins       = useRef(PLANETS.map((_,i) => i*0.5)); // self-spin offsets
  const anchor      = useRef(null);        // drag anchor — captured in useFrame
  const wasDown     = useRef(false);
  const prevSel     = useRef(selectedPlanet);
  const dwell       = useRef({id:-1, t:0});
  const _pw         = useRef(new THREE.Vector3());

  // Reset anchor on selection change
  if (prevSel.current !== selectedPlanet) {
    anchor.current = null;
    prevSel.current = selectedPlanet;
    // Sync spin offset so auto-spin continues seamlessly
    if (selectedPlanet !== null) {
      spins.current[selectedPlanet] = pRefs.current[selectedPlanet]?.rotation.y ?? 0;
    }
  }

  useFrame((_, dt) => {
    if (!sysRef.current) return;
    const m   = mouseRef.current;
    const sel = selectedPlanet;
    const justDown = m.down && !wasDown.current;
    wasDown.current = m.down;

    // ── THE FIX FOR DRAG SNAP ──────────────────────────────────────
    // Anchor is captured in useFrame (first frame after mousedown),
    // NOT in the event listener. This way we always capture the
    // mesh's ACTUAL current rotation at the moment of press.
    // Every subsequent frame: target = anchorRot + (mouse - anchorMouse) * sens
    // On mouseup there's nothing to reset — next press recaptures.
    if (justDown) {
      if (sel === null) {
        anchor.current = {
          sx: m.x, sy: m.y,
          rx: sysRef.current.rotation.x,
          ry: sysRef.current.rotation.y,
        };
      } else if (pRefs.current[sel]) {
        anchor.current = {
          sx: m.x, sy: m.y,
          rx: pRefs.current[sel].rotation.x,
          ry: pRefs.current[sel].rotation.y,
        };
      }
    }

    // ── System group rotation ──────────────────────────────────────
    if (sel === null) {
      if (m.down && m.dragging && anchor.current) {
        const tx = Math.max(-0.7, Math.min(0.7, anchor.current.rx + (m.y - anchor.current.sy)*2.8));
        const ty = anchor.current.ry + (m.x - anchor.current.sx)*4.5;
        sysRef.current.rotation.x = THREE.MathUtils.lerp(sysRef.current.rotation.x, tx, 0.15);
        sysRef.current.rotation.y = THREE.MathUtils.lerp(sysRef.current.rotation.y, ty, 0.15);
      } else {
        // Gentle auto-drift — just increment; no snapping to a fixed target
        sysRef.current.rotation.y += dt * 0.018;
        sysRef.current.rotation.x = THREE.MathUtils.lerp(sysRef.current.rotation.x, 0, 0.012);
      }
    }

    // ── Per-planet self-spin ───────────────────────────────────────
    PLANETS.forEach((_, i) => {
      const pg = pRefs.current[i];
      if (!pg) return;
      if (i !== sel) {
        spins.current[i] += dt * (0.025 + i*0.005);
        pg.rotation.y = spins.current[i];
        pg.rotation.x = THREE.MathUtils.lerp(pg.rotation.x, 0, 0.05);
      } else {
        if (m.down && m.dragging && anchor.current) {
          const tx = Math.max(-1.2, Math.min(1.2, anchor.current.rx + (m.y-anchor.current.sy)*4.0));
          const ty = anchor.current.ry + (m.x-anchor.current.sx)*6.0;
          pg.rotation.x = THREE.MathUtils.lerp(pg.rotation.x, tx, 0.15);
          pg.rotation.y = THREE.MathUtils.lerp(pg.rotation.y, ty, 0.15);
          spins.current[i] = pg.rotation.y; // keep spin in sync
        } else {
          spins.current[i] += dt * 0.04;
          pg.rotation.y = THREE.MathUtils.lerp(pg.rotation.y, spins.current[i], 0.05);
          pg.rotation.x = THREE.MathUtils.lerp(pg.rotation.x, 0, 0.02);
        }
      }
    });

    // ── Hand dwell: system view → select planet ────────────────────
    if (mode === "hand" && sel === null) {
      let bestId = -1, bestDist = Infinity;
      PLANETS.forEach((_, i) => {
        const pg = pRefs.current[i];
        if (!pg) return;
        pg.getWorldPosition(_pw.current);
        const proj = _pw.current.clone().project(camera);
        // proj.x, proj.y in NDC [-1,1]; convert to screen [0,1]
        const sx   = (proj.x + 1) / 2;
        const sy   = (1 - proj.y) / 2;
        const dist = Math.hypot(sx - m.x, sy - m.y);
        if (dist < bestDist) { bestDist = dist; bestId = i; }
      });
      if (bestDist < DWELL_RAD) {
        if (dwell.current.id === bestId) {
          if (Date.now() - dwell.current.t > DWELL_MS) {
            onSelect(bestId);
            dwell.current = { id: -1, t: 0 };
          }
        } else {
          dwell.current = { id: bestId, t: Date.now() };
        }
      } else {
        dwell.current = { id: -1, t: 0 };
      }
    }

    // ── Hand dwell: detail view → fullscreen frontmost tile ────────
    if (mode === "hand" && sel !== null) {
      const pg = pRefs.current[sel];
      if (pg) {
        // Check if hand has been "stable" for DWELL_MS
        const stableKey = `${Math.round(m.x*10)},${Math.round(m.y*10)}`;
        if (dwell.current.id !== stableKey) {
          dwell.current = { id: stableKey, t: Date.now() };
        } else if (Date.now() - dwell.current.t > DWELL_MS) {
          // Find tile whose world pos is closest to camera
          const camDir = camera.position.clone()
            .sub(new THREE.Vector3(...PLANETS[sel].posArr)).normalize();
          let bestDot = -Infinity, bestIdx = 0;
          DET_POS[sel].forEach((lp, j) => {
            const wp = new THREE.Vector3(...lp).applyMatrix4(pg.matrixWorld);
            const dot = wp.clone().sub(new THREE.Vector3(...PLANETS[sel].posArr))
              .normalize().dot(camDir);
            if (dot > bestDot) { bestDot = dot; bestIdx = j; }
          });
          onImageClick(PLANETS[sel].fullUrls[bestIdx]);
          dwell.current = { id: null, t: Date.now() + 10000 };
        }
      }
    }
  });

  return (
    <group ref={sysRef}>
      {PLANETS.map((p, i) => {
        const isSel = selectedPlanet === i;
        const isAny = selectedPlanet !== null;
        const urls  = isSel ? p.fullUrls    : p.prevUrls;
        const fpos  = isSel ? DET_POS[i]    : SYS_POS[i];
        const sc    = isSel ? [1.6, 2.24,1] : [1.25, 1.75, 1];
        const op    = isAny && !isSel ? 0.05 : (isSel ? 1.0 : 0.88);

        return (
          <group
            key={i}
            ref={el => { pRefs.current[i] = el; }}
            position={p.posArr}
          >
            {urls.map((url, j) => (
              <Tile
                key={`${i}-${j}-${isSel?"hi":"lo"}`}
                pos={fpos[j]}
                url={url}
                opacity={op}
                sc={sc}
                onClick={
                  !isAny
                    ? () => { if (!mouseRef.current.dragging) onSelect(i); }
                    : isSel
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

// ── Main component ────────────────────────────────────────────────────
export default function Home() {
  const videoRef        = useRef(null);
  const cameraCanvasRef = useRef(null);
  const smoothRef       = useRef({ distance:0.1, x:0.5, y:0.5 });

  // Single unified input ref — read in useFrame, never triggers re-renders
  // x,y: normalised [0,1] screen position
  // down: is mouse/hand pressing
  // dragging: has moved > 8px since press (so single clicks still work)
  const mouseRef = useRef({ down:false, x:0.5, y:0.5, dragging:false });
  const downPx   = useRef({ x:0, y:0 });

  const [cameraReady,    setCameraReady]    = useState(false);
  const [fullscreen,     setFullscreen]     = useState(null);
  const [mode,           setMode]           = useState("mouse");
  const [selectedPlanet, setSelectedPlanet] = useState(null);

  // Camera target refs — mutated directly, no re-renders
  const camRef  = useRef(new THREE.Vector3(0,0,65));
  const lookRef = useRef(new THREE.Vector3(0,0,0));
  const fovRef  = useRef(50);

  const handleSelect = idx => {
    setSelectedPlanet(idx);
    mouseRef.current = { down:false, x:0.5, y:0.5, dragging:false };
    // Fly camera toward that planet
    const p   = PLANETS[idx];
    const dir = new THREE.Vector3(...p.posArr).normalize();
    camRef.current.copy(new THREE.Vector3(...p.posArr)).addScaledVector(dir, ZOOM_D);
    lookRef.current.set(...p.posArr);
    fovRef.current = 38;
  };

  const handleBack = () => {
    setSelectedPlanet(null);
    mouseRef.current = { down:false, x:0.5, y:0.5, dragging:false };
    camRef.current.set(0,0,65);
    lookRef.current.set(0,0,0);
    fovRef.current = 50;
  };

  // ── Mouse / wheel ─────────────────────────────────────────────────
  useEffect(() => {
    const dn = e => {
      downPx.current = { x:e.clientX, y:e.clientY };
      mouseRef.current = {
        down:true,
        x: e.clientX/window.innerWidth,
        y: e.clientY/window.innerHeight,
        dragging: false,
      };
    };
    const mv = e => {
      if (!mouseRef.current.down || mode !== "mouse") return;
      const dx = e.clientX - downPx.current.x;
      const dy = e.clientY - downPx.current.y;
      if (Math.hypot(dx,dy) > 8) mouseRef.current.dragging = true;
      mouseRef.current.x = e.clientX/window.innerWidth;
      mouseRef.current.y = e.clientY/window.innerHeight;
    };
    const up  = () => { mouseRef.current.down = false; mouseRef.current.dragging = false; };
    const wh  = e => {
      if (mode !== "mouse") return;
      smoothRef.current.distance = Math.max(0.04, Math.min(0.4,
        smoothRef.current.distance - e.deltaY*0.0003));
    };
    window.addEventListener("mousedown", dn);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup",   up);
    window.addEventListener("wheel",     wh, { passive:true });
    return () => {
      window.removeEventListener("mousedown", dn);
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup",   up);
      window.removeEventListener("wheel",     wh);
    };
  }, [mode]);

  // ── Hand tracking ─────────────────────────────────────────────────
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
            modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate:"GPU"
          },
          runningMode:"VIDEO", numHands:1,
        });
        stream = await navigator.mediaDevices.getUserMedia(
          { video:{width:240,height:135,facingMode:"user"} });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        const cvs = cameraCanvasRef.current;
        const ctx = cvs.getContext("2d");
        let lastTime = -1;
        function detect() {
          animId = requestAnimationFrame(detect);
          const v = videoRef.current;
          if (!v || v.currentTime === lastTime) return;
          lastTime = v.currentTime;
          ctx.save(); ctx.translate(240,0); ctx.scale(-1,1);
          ctx.drawImage(v,0,0,240,135); ctx.restore();
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
              ctx.beginPath(); ctx.arc(p.x*240, p.y*135, 2.5,0,Math.PI*2);
              ctx.fillStyle="#fff"; ctx.fill();
              ctx.strokeStyle="#000"; ctx.lineWidth=1; ctx.stroke();
            });
            const pinch = Math.hypot(lm[4].x-lm[8].x, lm[4].y-lm[8].y);
            const z = 0.4;
            smoothRef.current.distance += (pinch - smoothRef.current.distance)*z;
            smoothRef.current.x += (lm[9].x - smoothRef.current.x)*z;
            smoothRef.current.y += (lm[9].y - smoothRef.current.y)*z;
            // Mirror to mouseRef so Scene receives hand position
            mouseRef.current.x = 1 - smoothRef.current.x;
            mouseRef.current.y = smoothRef.current.y;
          } else {
            smoothRef.current.x += (0.5 - smoothRef.current.x)*0.05;
            smoothRef.current.y += (0.5 - smoothRef.current.y)*0.05;
          }
        }
        detect();
      } catch(e) { console.warn("Hand tracking unavailable:", e); }
    }
    init();
    return () => {
      if (animId) cancelAnimationFrame(animId);
      stream?.getTracks().forEach(t => t.stop());
      setCameraReady(false);
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
          camera={{position:[0,0,65], fov:50}}
          gl={{antialias:true, alpha:true, powerPreference:"high-performance"}}
          dpr={[1,2]}
        >
          <color attach="background" args={["#ffffff"]} />
          <fog attach="fog" args={["#ffffff",55,140]} />
          <ambientLight intensity={2} />
          <directionalLight position={[10,20,20]} intensity={2.5} />
          <Suspense fallback={null}>
            <CamRig camRef={camRef} lookRef={lookRef} fovRef={fovRef} />
            <Scene
              mouseRef={mouseRef}
              selectedPlanet={selectedPlanet}
              mode={mode}
              onSelect={handleSelect}
              onImageClick={setFullscreen}
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

      {/* Back button */}
      {selectedPlanet !== null && (
        <div style={{position:"fixed",top:24,left:24,zIndex:10}}>
          <button onClick={handleBack} style={btn}>← ALL SPHERES</button>
        </div>
      )}

      {/* Hint */}
      <div style={{position:"absolute",top:24,left:selectedPlanet!==null?180:24,zIndex:10}}>
        <p style={{paddingLeft:8,fontSize:10,fontWeight:700,letterSpacing:"0.1em",
          color:"rgb(163,163,163)",textTransform:"uppercase",fontFamily:"Inter,system-ui,sans-serif"}}>
          {selectedPlanet !== null
            ? mode==="hand"
              ? "Hold hand over image to fullscreen"
              : "Drag to rotate · Click image to open"
            : mode==="hand"
              ? "Hold hand over sphere to enter it"
              : "Drag · Click a sphere to enter · Scroll to zoom"
          }
        </p>
      </div>

      {/* Camera preview */}
      {mode === "hand" && (
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
          width:240,height:135,borderRadius:"1.8rem",overflow:"hidden",
          boxShadow:"0 20px 40px -10px rgba(0,0,0,0.1)",border:"5px solid white",
          background:"white",opacity:cameraReady?1:0.3,transition:"opacity 0.5s",zIndex:10}}>
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
