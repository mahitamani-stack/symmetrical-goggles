"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Image as DreiImage, Environment } from "@react-three/drei";
import * as THREE from "three";

// ── Image URL builders ──────────────────────────────────────────────
const CLOUD = "dyazh2nxk";

function urlLo(i) {
  // Low-res for system view — small, blurry, loads fast
  return `https://res.cloudinary.com/${CLOUD}/image/upload/w_120,q_20,f_auto/img${String(i).padStart(5,"0")}.jpg`;
}
function urlHi(i) {
  // Full quality for detail view
  return `https://res.cloudinary.com/${CLOUD}/image/upload/q_auto,f_auto/img${String(i).padStart(5,"0")}.jpg`;
}

// ── Planet definitions — explicit image ranges ──────────────────────
const RANGES = [
  [0,   64],   // Planet 0
  [65,  129],  // Planet 1
  [130, 194],  // Planet 2
  [195, 259],  // Planet 3
  [260, 324],  // Planet 4
  [325, 389],  // Planet 5
  [390, 454],  // Planet 6
  [455, 520],  // Planet 7
];

const SYS_PREV = 20;  // preview tiles in system view
const BASE_R   = 5.5; // sphere radius for system previews
const DETAIL_R = 7;   // sphere radius for detail view

// Organic scatter: varied X, Y, Z and scale for depth
const LAYOUT = [
  { pos: [-22,  9, -6], scale: 0.82 },
  { pos: [  5, 14,  4], scale: 1.05 },
  { pos: [ 27,  6, -9], scale: 0.70 },
  { pos: [-13, -9,  5], scale: 1.14 },
  { pos: [ 11,-13, -2], scale: 0.88 },
  { pos: [ 28,-10,  8], scale: 0.74 },
  { pos: [-28,  2,  3], scale: 0.92 },
  { pos: [ -1,  1, 10], scale: 1.30 },
];

// Pre-build planet data
const PLANETS = RANGES.map(([s, e], i) => {
  const indices = Array.from({ length: e - s + 1 }, (_, j) => s + j); // [s..e]
  // Evenly spaced preview indices
  const step = Math.max(1, Math.floor(indices.length / SYS_PREV));
  const previewIdxs = indices.filter((_, j) => j % step === 0).slice(0, SYS_PREV);
  return {
    id: i,
    pos: LAYOUT[i].pos,
    scale: LAYOUT[i].scale,
    previewUrls: previewIdxs.map(urlLo),   // low-res
    fullUrls:    indices.map(urlHi),        // full-res, all of them
  };
});

// ── Fibonacci sphere positions ───────────────────────────────────────
function fib(n, r) {
  const phi = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y  = (i * 2 / n - 1) + 1 / n;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const t  = i * phi;
    return [Math.cos(t) * rr * r, y * r, Math.sin(t) * rr * r];
  });
}

// Pre-computed local positions for each planet
const SYS_FPOS  = PLANETS.map(p => fib(SYS_PREV, BASE_R * p.scale));
const DETL_FPOS = PLANETS.map(p => fib(p.fullUrls.length, DETAIL_R));

// ── Hand connections ────────────────────────────────────────────────
const HC = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],
  [9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20]
];

// ── PhotoTile — always faces camera ────────────────────────────────
function PhotoTile({ pos, url, opacity = 1, scale = [1.6, 2.24, 1], onClick }) {
  const ref = useRef();
  useFrame(({ camera }) => {
    if (ref.current) ref.current.lookAt(camera.position);
  });
  return (
    <DreiImage
      ref={ref}
      url={url}
      position={pos}
      scale={scale}
      transparent
      opacity={opacity}
      toneMapped={false}
      onClick={e => { e.stopPropagation(); onClick(); }}
      onError={() => {}}
    />
  );
}

// ── Camera rig — lerps between system (z=65) and detail (z=22) ─────
function CameraRig({ targetZ, targetFov }) {
  const { camera } = useThree();
  useFrame(() => {
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.05);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, 0, 0.05);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0, 0.05);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.05);
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

// ── System view rotation controller ────────────────────────────────
function useSystemRotation(groupRef, handDataRef) {
  const prevPos = useRef({ x: 0.5, y: 0.5 });
  const vel     = useRef({ x: 0, y: 0 });

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    const h = handDataRef.current;
    const px = prevPos.current.x;
    const py = prevPos.current.y;
    prevPos.current = { x: h.position.x, y: h.position.y };

    if (h.present) {
      const dx = h.position.x - px;
      const dy = h.position.y - py;
      vel.current.x = dx * 6;
      vel.current.y = dy * 4;
      groupRef.current.rotation.y += vel.current.x;
      groupRef.current.rotation.x = Math.max(-1, Math.min(1,
        groupRef.current.rotation.x + vel.current.y));
      const ts = 0.85 + Math.min(Math.max((h.distance - 0.1) / 0.3, 0), 1) * 0.4;
      const s  = THREE.MathUtils.lerp(groupRef.current.scale.x, ts, 0.08);
      groupRef.current.scale.set(s, s, s);
    } else {
      vel.current.x *= 0.93;
      vel.current.y *= 0.93;
      groupRef.current.rotation.y += vel.current.x + dt * 0.018;
      groupRef.current.rotation.x = Math.max(-0.6, Math.min(0.6,
        groupRef.current.rotation.x + vel.current.y));
      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        groupRef.current.rotation.x, 0, 0.02);
      const s = THREE.MathUtils.lerp(groupRef.current.scale.x, 1, 0.04);
      groupRef.current.scale.set(s, s, s);
    }
  });
}

// ── One planet in system view ───────────────────────────────────────
function PlanetSys({ planet, idx, onSelect, didDragRef }) {
  const grp  = useRef();
  const spin = 0.025 + idx * 0.006;

  useFrame((_, dt) => {
    if (grp.current) grp.current.rotation.y += dt * spin;
  });

  const handleClick = () => {
    if (!didDragRef.current) onSelect(idx);
  };

  return (
    <group ref={grp} position={planet.pos}>
      {planet.previewUrls.map((url, i) => (
        <PhotoTile
          key={i}
          pos={SYS_FPOS[idx][i]}
          url={url}
          opacity={0.82}          // slightly faded in system view
          onClick={handleClick}
        />
      ))}
    </group>
  );
}

// ── System view: all 8 spheres ──────────────────────────────────────
function SystemView({ handDataRef, onSelect, didDragRef }) {
  const grp = useRef();
  useSystemRotation(grp, handDataRef);

  return (
    <group ref={grp}>
      {PLANETS.map((p, i) => (
        <PlanetSys key={i} planet={p} idx={i} onSelect={onSelect} didDragRef={didDragRef} />
      ))}
    </group>
  );
}

// ── Detail view: single sphere, full-res, fully opaque ─────────────
function DetailView({ planetId, handDataRef, onImageClick }) {
  const grp     = useRef();
  const prevPos = useRef({ x: 0.5, y: 0.5 });
  const vel     = useRef({ x: 0, y: 0 });
  const planet  = PLANETS[planetId];

  useFrame((_, dt) => {
    if (!grp.current) return;
    const h  = handDataRef.current;
    const px = prevPos.current.x;
    const py = prevPos.current.y;
    prevPos.current = { x: h.position.x, y: h.position.y };

    if (h.present) {
      const dx = h.position.x - px;
      const dy = h.position.y - py;
      vel.current.x = dx * 8;
      vel.current.y = dy * 5;
      grp.current.rotation.y += vel.current.x;
      grp.current.rotation.x = Math.max(-1.2, Math.min(1.2,
        grp.current.rotation.x + vel.current.y));
      const ts = 0.4 + Math.min(Math.max((h.distance - 0.04) / 0.36, 0), 1) * 29.6;
      const s  = THREE.MathUtils.lerp(grp.current.scale.x, ts, 0.12);
      grp.current.scale.set(s, s, s);
    } else {
      vel.current.x *= 0.93;
      vel.current.y *= 0.93;
      grp.current.rotation.y += vel.current.x + dt * 0.05;
      grp.current.rotation.x = Math.max(-1.2, Math.min(1.2,
        grp.current.rotation.x + vel.current.y));
      grp.current.rotation.x = THREE.MathUtils.lerp(grp.current.rotation.x, 0, 0.02);
      const s = THREE.MathUtils.lerp(grp.current.scale.x, 0.8, 0.05);
      grp.current.scale.set(s, s, s);
    }
  });

  return (
    <group ref={grp}>
      {planet.fullUrls.map((url, i) => (
        <PhotoTile
          key={i}
          pos={DETL_FPOS[planetId][i]}
          url={url}
          opacity={1}             // full opacity in detail
          onClick={() => onImageClick(url)}
        />
      ))}
    </group>
  );
}

// ── Main ────────────────────────────────────────────────────────────
export default function Home() {
  const videoRef        = useRef(null);
  const cameraCanvasRef = useRef(null);
  const handDataRef     = useRef({ present: false, distance: 0.1, position: { x: 0.5, y: 0.5 } });
  const smoothRef       = useRef({ distance: 0.1, x: 0.5, y: 0.5 });
  const didDragRef      = useRef(false);
  const mouseDownRef    = useRef(false);
  const lastMouseRef    = useRef({ x: 0.5, y: 0.5 });

  const [cameraReady, setCameraReady]       = useState(false);
  const [fullscreen, setFullscreen]         = useState(null);
  const [mode, setMode]                     = useState("mouse");
  const [selectedPlanet, setSelectedPlanet] = useState(null);
  const [sceneMode, setSceneMode]           = useState("system");

  const handleSelectPlanet = idx => {
    setSelectedPlanet(idx);
    setSceneMode("detail");
    handDataRef.current = { ...handDataRef.current, present: false };
  };

  const handleBack = () => {
    setSelectedPlanet(null);
    setSceneMode("system");
    handDataRef.current = { ...handDataRef.current, present: false };
  };

  // Mouse / wheel controls
  useEffect(() => {
    const onDown = e => {
      mouseDownRef.current = true;
      didDragRef.current   = false;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      lastMouseRef.current = { x, y };
      if (mode === "mouse")
        handDataRef.current = { ...handDataRef.current, present: true,
          position: { x: 1 - x, y } };
    };
    const onMove = e => {
      if (!mouseDownRef.current || mode !== "mouse") return;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      if (Math.abs(x - lastMouseRef.current.x) > 0.004 ||
          Math.abs(y - lastMouseRef.current.y) > 0.004) {
        didDragRef.current = true;
      }
      handDataRef.current = { ...handDataRef.current, present: true,
        position: { x: 1 - x, y } };
    };
    const onUp = () => {
      mouseDownRef.current = false;
      if (mode === "mouse")
        handDataRef.current = { ...handDataRef.current, present: false };
    };
    const onWheel = e => {
      if (mode !== "mouse") return;
      const cur = handDataRef.current.distance;
      handDataRef.current = { ...handDataRef.current,
        distance: Math.max(0.04, Math.min(0.4, cur - e.deltaY * 0.0003)) };
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("wheel", onWheel);
    };
  }, [mode]);

  // Hand tracking
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
            const lm       = results.landmarks[0];
            const mirrored = lm.map(p => ({ ...p, x: 1 - p.x }));
            ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
            HC.forEach(([a, b]) => {
              ctx.beginPath();
              ctx.moveTo(mirrored[a].x * 240, mirrored[a].y * 135);
              ctx.lineTo(mirrored[b].x * 240, mirrored[b].y * 135);
              ctx.stroke();
            });
            mirrored.forEach(p => {
              ctx.beginPath(); ctx.arc(p.x * 240, p.y * 135, 2.5, 0, Math.PI * 2);
              ctx.fillStyle = "#fff"; ctx.fill();
              ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
            });
            const pinch = Math.sqrt(
              Math.pow(lm[4].x - lm[8].x, 2) + Math.pow(lm[4].y - lm[8].y, 2));
            const z = 0.4;
            smoothRef.current.distance += (pinch - smoothRef.current.distance) * z;
            smoothRef.current.x += (lm[9].x - smoothRef.current.x) * z;
            smoothRef.current.y += (lm[9].y - smoothRef.current.y) * z;
            handDataRef.current = {
              present: true,
              distance: smoothRef.current.distance,
              position: { x: 1 - smoothRef.current.x, y: smoothRef.current.y }
            };
          } else {
            smoothRef.current.distance += (0.1 - smoothRef.current.distance) * 0.08;
            smoothRef.current.x += (0.5 - smoothRef.current.x) * 0.05;
            smoothRef.current.y += (0.5 - smoothRef.current.y) * 0.05;
            handDataRef.current = {
              present: false,
              distance: smoothRef.current.distance,
              position: { x: 1 - smoothRef.current.x, y: smoothRef.current.y }
            };
          }
        }
        detect();
      } catch (err) { console.warn("Hand tracking unavailable:", err); }
    }
    init();
    return () => {
      if (animId) cancelAnimationFrame(animId);
      stream?.getTracks().forEach(t => t.stop());
      setCameraReady(false);
    };
  }, [mode]);

  const btnStyle = {
    display:"flex", alignItems:"center", gap:8,
    padding:"10px 20px",
    background:"rgba(255,255,255,0.9)",
    border:"1px solid rgba(0,0,0,0.1)",
    borderRadius:"1rem",
    boxShadow:"0 1px 4px rgba(0,0,0,0.08)",
    cursor:"pointer", fontSize:12,
    fontWeight:600, fontFamily:"Inter, system-ui, sans-serif",
    color:"#333", letterSpacing:"0.05em",
  };

  return (
    <div style={{ position:"relative", width:"100vw", height:"100vh",
                  background:"#fff", overflow:"hidden" }}>

      <div style={{ position:"absolute", inset:0 }}>
        <Canvas
          camera={{ position:[0, 0, 65], fov:50 }}
          gl={{ antialias:true, alpha:true, powerPreference:"high-performance" }}
          dpr={[1, 2]}
        >
          <color attach="background" args={["#ffffff"]} />
          <fog attach="fog" args={["#ffffff", 50, 140]} />
          <ambientLight intensity={2} />
          <directionalLight position={[10, 20, 20]} intensity={2.5} />
          <Suspense fallback={null}>
            <CameraRig
              targetZ={sceneMode === "system" ? 65 : 22}
              targetFov={sceneMode === "system" ? 50 : 38}
            />
            {sceneMode === "system" ? (
              <SystemView
                handDataRef={handDataRef}
                onSelect={handleSelectPlanet}
                didDragRef={didDragRef}
              />
            ) : (
              <DetailView
                planetId={selectedPlanet}
                handDataRef={handDataRef}
                onImageClick={setFullscreen}
              />
            )}
            <Environment preset="studio" />
          </Suspense>
        </Canvas>
      </div>

      {/* Mode toggle */}
      <div style={{ position:"fixed", top:24, right:24, zIndex:10 }}>
        <button onClick={() => setMode(m => m === "mouse" ? "hand" : "mouse")} style={btnStyle}>
          <span style={{ fontSize:16 }}>{mode === "mouse" ? "🖱️" : "✋"}</span>
          {mode === "mouse" ? "MOUSE MODE" : "HAND MODE"}
        </button>
      </div>

      {/* Back — detail only */}
      {sceneMode === "detail" && (
        <div style={{ position:"fixed", top:24, left:24, zIndex:10 }}>
          <button onClick={handleBack} style={btnStyle}>← ALL SPHERES</button>
        </div>
      )}

      {/* Hint */}
      <div style={{ position:"absolute", top:24,
                    left: sceneMode === "detail" ? 180 : 24, zIndex:10 }}>
        <p style={{ paddingLeft:8, fontSize:10, fontWeight:700,
                    letterSpacing:"0.1em", color:"rgb(163,163,163)",
                    textTransform:"uppercase",
                    fontFamily:"Inter, system-ui, sans-serif" }}>
          {sceneMode === "detail"
            ? (mode === "mouse"
                ? "Drag · Scroll to zoom · Click image to open"
                : "Pinch to zoom · Move to rotate · Click image")
            : (mode === "mouse"
                ? "Drag · Scroll to zoom · Click a sphere"
                : "Pinch to zoom · Move to rotate · Click a sphere")
          }
        </p>
      </div>

      {/* Camera preview — hand mode */}
      {mode === "hand" && (
        <div style={{
          position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          width:240, height:135, borderRadius:"1.8rem", overflow:"hidden",
          boxShadow:"0 20px 40px -10px rgba(0,0,0,0.1)",
          border:"5px solid white", background:"white",
          opacity: cameraReady ? 1 : 0.3, transition:"opacity 0.5s", zIndex:10
        }}>
          <video ref={videoRef} playsInline muted
            style={{ display:"none" }} width={240} height={135} />
          <canvas ref={cameraCanvasRef} width={240} height={135}
            style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        </div>
      )}

      {/* Fullscreen modal */}
      {fullscreen && (
        <div
          onClick={() => setFullscreen(null)}
          style={{
            position:"fixed", inset:0,
            background:"rgba(255,255,255,0.97)",
            display:"flex", alignItems:"center", justifyContent:"center",
            zIndex:999, cursor:"zoom-out",
            animation:"zoomIn 0.2s cubic-bezier(0.34,1.56,0.64,1)"
          }}
        >
          <style>{`@keyframes zoomIn{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}`}</style>
          <img src={fullscreen} alt=""
            style={{ maxWidth:"88vw", maxHeight:"88vh", objectFit:"contain" }} />
        </div>
      )}
    </div>
  );
}
