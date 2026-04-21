"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Image as DreiImage, Environment } from "@react-three/drei";
import * as THREE from "three";

const CLOUD = "dyazh2nxk";
const urlLo = i => `https://res.cloudinary.com/${CLOUD}/image/upload/w_180,q_25,f_auto/img${String(i).padStart(5,"0")}.jpg`;
const urlHi = i => `https://res.cloudinary.com/${CLOUD}/image/upload/q_auto,f_auto/img${String(i).padStart(5,"0")}.jpg`;

const RANGES = [[0,64],[65,129],[130,194],[195,259],[260,324],[325,389],[390,454],[455,520]];
const SYS_PREV  = 20;
const BASE_R    = 3.8;
const DETAIL_R  = 7;
const ZOOM_DIST = 14;

const LAYOUT = [
  { pos: [-22,  9, -6], scale: 0.85 },
  { pos: [  5, 14,  4], scale: 1.05 },
  { pos: [ 27,  6, -9], scale: 0.72 },
  { pos: [-13, -9,  5], scale: 1.12 },
  { pos: [ 11,-13, -2], scale: 0.90 },
  { pos: [ 28,-10,  8], scale: 0.75 },
  { pos: [-28,  2,  3], scale: 0.92 },
  { pos: [ -1,  1, 10], scale: 1.28 },
];

const PLANETS = RANGES.map(([s, e], i) => {
  const indices = Array.from({ length: e - s + 1 }, (_, j) => s + j);
  const step = Math.max(1, Math.floor(indices.length / SYS_PREV));
  const previewIdxs = indices.filter((_, j) => j % step === 0).slice(0, SYS_PREV);
  return {
    id: i,
    pos: new THREE.Vector3(...LAYOUT[i].pos),
    scale: LAYOUT[i].scale,
    previewUrls: previewIdxs.map(urlLo),
    fullUrls: indices.map(urlHi),
  };
});

function fib(n, r) {
  const phi = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = (i * 2 / n - 1) + 1 / n;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const t = i * phi;
    return [Math.cos(t) * rr * r, y * r, Math.sin(t) * rr * r];
  });
}

const SYS_FPOS  = PLANETS.map(p => fib(SYS_PREV, BASE_R * p.scale));
const DETL_FPOS = PLANETS.map(p => fib(p.fullUrls.length, DETAIL_R));

const HC = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],
  [9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20]];

// ── THE FIX FOR SPHERE SHAPE ──────────────────────────────────────
// Each tile looks at its OWN planet's world-space center every frame.
// This is what made the original single sphere look beautiful.
// Using getWorldPosition handles system group rotation correctly.
function PhotoTile({ pos, url, opacity, tileScale, onClick }) {
  const ref     = useRef();
  const _center = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!ref.current?.parent) return;
    // Get planet center in world space (accounts for all parent rotations)
    ref.current.parent.getWorldPosition(_center.current);
    ref.current.lookAt(_center.current);
  });

  return (
    <DreiImage
      ref={ref}
      url={url}
      position={pos}
      scale={tileScale ?? [1.6, 2.24, 1]}
      transparent
      opacity={opacity ?? 1}
      toneMapped={false}
      onClick={e => { e.stopPropagation(); onClick?.(); }}
      onError={() => {}}
    />
  );
}

// ── CAMERA TRAVELS TO PLANET ──────────────────────────────────────
// Camera lerps its position AND its lookAt target — feels like flying in.
function CameraRig({ camTarget, lookTarget, fovTarget }) {
  const { camera } = useThree();
  const _look = useRef(new THREE.Vector3());

  useFrame(() => {
    camera.position.lerp(camTarget, 0.04);
    _look.current.lerp(lookTarget, 0.04);
    camera.lookAt(_look.current);
    if (Math.abs(camera.fov - fovTarget) > 0.1) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, fovTarget, 0.05);
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

// ── THE FIX FOR DRAG SNAP ─────────────────────────────────────────
// anchor stores the rotation AT the moment the drag started.
// Every frame: targetRot = anchorRot + (currentMouse - anchorMouse) * sens
// On mouseup: fold current mesh rotation into base so next drag starts there.
// No snap ever because we always start from real current rotation.
function Scene({ mouseRef, selectedPlanet, onSelect, didDragRef, onImageClick }) {
  const sysGrp     = useRef();
  const planetRefs = useRef([]);

  // Base rotations (updated when drag ends)
  const sysBase    = useRef({ x: 0, y: 0 });
  const detailBase = useRef({ x: 0, y: 0 });
  const selfSpin   = useRef(PLANETS.map(() => 0));

  // Track mousedown state across frames
  const wasDown    = useRef(false);
  const prevSel    = useRef(selectedPlanet);

  // When selected planet changes, reset detail base
  if (prevSel.current !== selectedPlanet) {
    detailBase.current = { x: 0, y: 0 };
    prevSel.current = selectedPlanet;
  }

  useFrame((_, dt) => {
    if (!sysGrp.current) return;
    const m   = mouseRef.current;
    const sel = selectedPlanet;

    // ── Detect drag end: fold mesh rotation into base ──────────
    if (wasDown.current && !m.down) {
      if (sel === null) {
        sysBase.current.x = sysGrp.current.rotation.x;
        sysBase.current.y = sysGrp.current.rotation.y;
      } else if (planetRefs.current[sel]) {
        detailBase.current.x = planetRefs.current[sel].rotation.x;
        detailBase.current.y = planetRefs.current[sel].rotation.y;
      }
    }
    wasDown.current = m.down;

    // ── System group rotation ───────────────────────────────────
    if (sel === null) {
      let tx = sysBase.current.x;
      let ty = sysBase.current.y + (m.down ? 0 : dt * 0.018); // auto-drift

      if (!m.down) sysBase.current.y += dt * 0.018; // accumulate drift into base

      if (m.down && m.anchor) {
        tx = Math.max(-0.7, Math.min(0.7,
          m.anchor.rotX + (m.y - m.anchor.y) * 2.5));
        ty = m.anchor.rotY + (m.x - m.anchor.x) * 3.5;
      }

      sysGrp.current.rotation.x = THREE.MathUtils.lerp(sysGrp.current.rotation.x, tx, 0.12);
      sysGrp.current.rotation.y = THREE.MathUtils.lerp(sysGrp.current.rotation.y, ty, 0.12);
    }
    // When zoomed: freeze system group (let camera move to planet)

    // ── Per-planet self-spin (all except selected) ──────────────
    PLANETS.forEach((_, i) => {
      if (planetRefs.current[i] && i !== sel) {
        selfSpin.current[i] += dt * (0.025 + i * 0.006);
        planetRefs.current[i].rotation.y = selfSpin.current[i];
        planetRefs.current[i].rotation.x = 0;
      }
    });

    // ── Selected planet: user controls its rotation ─────────────
    if (sel !== null && planetRefs.current[sel]) {
      const pg = planetRefs.current[sel];
      if (!m.down) {
        detailBase.current.y += dt * 0.05;
      }
      let tx = detailBase.current.x;
      let ty = detailBase.current.y;
      if (m.down && m.anchor) {
        tx = Math.max(-1.2, Math.min(1.2,
          m.anchor.rotX + (m.y - m.anchor.y) * 3.5));
        ty = m.anchor.rotY + (m.x - m.anchor.x) * 5;
      }
      pg.rotation.x = THREE.MathUtils.lerp(pg.rotation.x, tx, 0.12);
      pg.rotation.y = THREE.MathUtils.lerp(pg.rotation.y, ty, 0.12);
    }
  });

  return (
    <group ref={sysGrp}>
      {PLANETS.map((p, i) => {
        const isSel  = selectedPlanet === i;
        const isSys  = selectedPlanet === null;
        const urls   = isSel ? p.fullUrls    : p.previewUrls;
        const fpos   = isSel ? DETL_FPOS[i]  : SYS_FPOS[i];
        const sc     = isSel ? [1.6, 2.24, 1] : [1.3, 1.82, 1];
        const op     = isSys ? 0.90 : (isSel ? 1 : 0.12);

        return (
          <group key={i} ref={el => { planetRefs.current[i] = el; }} position={p.pos}>
            {urls.map((url, j) => (
              <PhotoTile
                key={`${i}-${j}-${isSel}`}
                pos={fpos[j]}
                url={url}
                opacity={op}
                tileScale={sc}
                onClick={
                  isSys  ? (() => { if (!didDragRef.current) onSelect(i); }) :
                  isSel  ? (() => onImageClick(url)) :
                  undefined
                }
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}

export default function Home() {
  const videoRef        = useRef(null);
  const cameraCanvasRef = useRef(null);
  const handDataRef     = useRef({ present: false, distance: 0.1, position: { x: 0.5, y: 0.5 } });
  const smoothRef       = useRef({ distance: 0.1, x: 0.5, y: 0.5 });

  // Unified mouse state — read in useFrame, no re-renders
  const mouseRef       = useRef({ down: false, x: 0.5, y: 0.5, anchor: null });
  const didDragRef     = useRef(false);
  const mouseDownPxRef = useRef({ x: 0, y: 0 });

  // Keep a ref to current system/detail base rotations for anchor capture
  // These are written by Scene via callbacks below
  const captureRotRef = useRef({ x: 0, y: 0 });

  const [cameraReady,   setCameraReady]   = useState(false);
  const [fullscreen,    setFullscreen]    = useState(null);
  const [mode,          setMode]          = useState("mouse");
  const [selectedPlanet, setSelected]     = useState(null);

  // Camera targets
  const camTarget  = useRef(new THREE.Vector3(0, 0, 65));
  const lookTarget = useRef(new THREE.Vector3(0, 0, 0));
  const fovTarget  = useRef(50);

  // Update camera targets when selection changes
  useEffect(() => {
    if (selectedPlanet === null) {
      camTarget.current.set(0, 0, 65);
      lookTarget.current.set(0, 0, 0);
      fovTarget.current = 50;
    } else {
      const p   = PLANETS[selectedPlanet];
      const dir = p.pos.clone().normalize();
      camTarget.current.copy(p.pos).add(dir.multiplyScalar(ZOOM_DIST));
      lookTarget.current.copy(p.pos);
      fovTarget.current = 38;
    }
  }, [selectedPlanet]);

  const handleSelect = idx => {
    setSelected(idx);
    mouseRef.current = { down: false, x: 0.5, y: 0.5, anchor: null };
    didDragRef.current = false;
  };

  const handleBack = () => {
    setSelected(null);
    mouseRef.current = { down: false, x: 0.5, y: 0.5, anchor: null };
    didDragRef.current = false;
  };

  // ── Mouse controls ──────────────────────────────────────────────
  useEffect(() => {
    const onDown = e => {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      mouseDownPxRef.current = { x: e.clientX, y: e.clientY };
      didDragRef.current = false;
      // anchor.rotX/rotY will be set by Scene on first frame (needsInit flag)
      mouseRef.current = {
        down: true, x, y,
        anchor: { x, y, rotX: captureRotRef.current.x, rotY: captureRotRef.current.y },
      };
    };

    const onMove = e => {
      if (!mouseRef.current.down || mode !== "mouse") return;
      const x   = e.clientX / window.innerWidth;
      const y   = e.clientY / window.innerHeight;
      const dpx = e.clientX - mouseDownPxRef.current.x;
      const dpy = e.clientY - mouseDownPxRef.current.y;
      if (Math.sqrt(dpx*dpx + dpy*dpy) > 6) didDragRef.current = true;
      mouseRef.current.x = x;
      mouseRef.current.y = y;
    };

    const onUp = () => {
      mouseRef.current.down   = false;
      mouseRef.current.anchor = null;
    };

    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [mode]);

  // ── Hand tracking ────────────────────────────────────────────────
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
            delegate: "GPU"
          },
          runningMode: "VIDEO", numHands: 1,
        });
        stream = await navigator.mediaDevices.getUserMedia(
          { video: { width: 240, height: 135, facingMode: "user" } });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        const cvs = cameraCanvasRef.current;
        const ctx = cvs.getContext("2d");
        let lastTime = -1;
        function detect() {
          animId = requestAnimationFrame(detect);
          const video = videoRef.current;
          if (!video || video.currentTime === lastTime) return;
          lastTime = video.currentTime;
          ctx.save(); ctx.translate(240, 0); ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, 240, 135); ctx.restore();
          const results = hl.detectForVideo(video, performance.now());
          if (results.landmarks?.length > 0) {
            const lm = results.landmarks[0];
            const mir = lm.map(p => ({ ...p, x: 1 - p.x }));
            ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
            HC.forEach(([a, b]) => {
              ctx.beginPath();
              ctx.moveTo(mir[a].x*240, mir[a].y*135);
              ctx.lineTo(mir[b].x*240, mir[b].y*135);
              ctx.stroke();
            });
            mir.forEach(p => {
              ctx.beginPath(); ctx.arc(p.x*240, p.y*135, 2.5, 0, Math.PI*2);
              ctx.fillStyle = "#fff"; ctx.fill();
              ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
            });
            const pinch = Math.sqrt(
              Math.pow(lm[4].x-lm[8].x,2)+Math.pow(lm[4].y-lm[8].y,2));
            const z = 0.4;
            smoothRef.current.distance += (pinch - smoothRef.current.distance)*z;
            smoothRef.current.x += (lm[9].x - smoothRef.current.x)*z;
            smoothRef.current.y += (lm[9].y - smoothRef.current.y)*z;
            handDataRef.current = {
              present: true,
              distance: smoothRef.current.distance,
              position: { x: 1-smoothRef.current.x, y: smoothRef.current.y }
            };
            // Mirror hand to mouseRef for unified control
            mouseRef.current.x = smoothRef.current.x;
            mouseRef.current.y = smoothRef.current.y;
          } else {
            smoothRef.current.distance += (0.1-smoothRef.current.distance)*0.08;
            smoothRef.current.x += (0.5-smoothRef.current.x)*0.05;
            smoothRef.current.y += (0.5-smoothRef.current.y)*0.05;
            handDataRef.current = { present: false, distance: smoothRef.current.distance,
              position: { x:1-smoothRef.current.x, y:smoothRef.current.y } };
          }
        }
        detect();
      } catch(err) { console.warn("Hand tracking unavailable:", err); }
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
    <div style={{ position:"relative", width:"100vw", height:"100vh", background:"#fff", overflow:"hidden" }}>
      <div style={{ position:"absolute", inset:0 }}>
        <Canvas camera={{ position:[0,0,65], fov:50 }}
          gl={{ antialias:true, alpha:true, powerPreference:"high-performance" }} dpr={[1,2]}>
          <color attach="background" args={["#ffffff"]} />
          <fog attach="fog" args={["#ffffff", 50, 140]} />
          <ambientLight intensity={2} />
          <directionalLight position={[10,20,20]} intensity={2.5} />
          <Suspense fallback={null}>
            <CameraRig
              camTarget={camTarget.current}
              lookTarget={lookTarget.current}
              fovTarget={fovTarget.current}
            />
            <Scene
              mouseRef={mouseRef}
              selectedPlanet={selectedPlanet}
              onSelect={handleSelect}
              didDragRef={didDragRef}
              onImageClick={setFullscreen}
            />
            <Environment preset="studio" />
          </Suspense>
        </Canvas>
      </div>

      {/* Mode toggle */}
      <div style={{ position:"fixed", top:24, right:24, zIndex:10 }}>
        <button onClick={() => setMode(m => m==="mouse"?"hand":"mouse")} style={btn}>
          <span style={{fontSize:16}}>{mode==="mouse"?"🖱️":"✋"}</span>
          {mode==="mouse"?"MOUSE MODE":"HAND MODE"}
        </button>
      </div>

      {/* Back */}
      {selectedPlanet !== null && (
        <div style={{ position:"fixed", top:24, left:24, zIndex:10 }}>
          <button onClick={handleBack} style={btn}>← ALL SPHERES</button>
        </div>
      )}

      {/* Hint */}
      <div style={{ position:"absolute", top:24, left: selectedPlanet!==null ? 180 : 24, zIndex:10 }}>
        <p style={{ paddingLeft:8, fontSize:10, fontWeight:700, letterSpacing:"0.1em",
          color:"rgb(163,163,163)", textTransform:"uppercase", fontFamily:"Inter,system-ui,sans-serif" }}>
          {selectedPlanet !== null
            ? "Drag to rotate · Click image to open · ← to go back"
            : "Drag to rotate · Click a sphere to explore"}
        </p>
      </div>

      {/* Camera preview */}
      {mode === "hand" && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          width:240, height:135, borderRadius:"1.8rem", overflow:"hidden",
          boxShadow:"0 20px 40px -10px rgba(0,0,0,0.1)", border:"5px solid white",
          background:"white", opacity:cameraReady?1:0.3, transition:"opacity 0.5s", zIndex:10 }}>
          <video ref={videoRef} playsInline muted style={{display:"none"}} width={240} height={135}/>
          <canvas ref={cameraCanvasRef} width={240} height={135}
            style={{width:"100%",height:"100%",objectFit:"cover"}}/>
        </div>
      )}

      {/* Fullscreen modal */}
      {fullscreen && (
        <div onClick={() => setFullscreen(null)} style={{
          position:"fixed", inset:0, background:"rgba(255,255,255,0.97)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:999, cursor:"zoom-out",
          animation:"zoomIn 0.2s cubic-bezier(0.34,1.56,0.64,1)" }}>
          <style>{`@keyframes zoomIn{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}`}</style>
          <img src={fullscreen} alt="" style={{maxWidth:"88vw",maxHeight:"88vh",objectFit:"contain"}}/>
        </div>
      )}
    </div>
  );
}
