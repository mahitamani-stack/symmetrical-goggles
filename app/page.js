"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Image as DreiImage, Environment } from "@react-three/drei";
import * as THREE from "three";

const CLOUD = "dyazh2nxk";
const TOTAL = 521;
const PLANET_COUNT = 8;
const IMAGES_PER_PLANET = 65;
const PREVIEW_COUNT = 20;
const PLANET_RADIUS = 7;
const ORBIT_RADIUS = 20;

const allUrls = Array.from({ length: TOTAL }, (_, i) =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/q_auto,f_auto/img${i.toString().padStart(5,"0")}.jpg`
);

function getPlanetImages(planetIndex, fullRes = false) {
  const start = planetIndex * IMAGES_PER_PLANET;
  const end = Math.min(start + IMAGES_PER_PLANET, TOTAL);
  const urls = allUrls.slice(start, end);
  
  if (fullRes) return urls;
  
  const step = Math.max(1, Math.floor(urls.length / PREVIEW_COUNT));
  return urls.filter((_, i) => i % step === 0).slice(0, PREVIEW_COUNT);
}

function buildFibonacciSphere(count, radius) {
  const positions = [];
  const offset = 2 / count;
  const increment = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = ((i * offset) - 1) + offset / 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * increment;
    positions.push([Math.cos(phi) * r * radius, y * radius, Math.sin(phi) * r * radius]);
  }
  return positions;
}

function PhotoTile({ item, onImageClick }) {
  const ref = useRef();
  useFrame(() => { if (ref.current) ref.current.lookAt(0, 0, 0); });
  return (
    <group position={item.position}>
      <DreiImage
        ref={ref}
        url={item.url}
        transparent
        opacity={1}
        scale={[1.6, 2.24, 1]}
        toneMapped={false}
        onClick={(e) => { e.stopPropagation(); onImageClick(item.url); }}
        onError={() => {}}
      />
    </group>
  );
}

function PlanetSphere({ images, position, rotation, onImageClick, isVisible = true }) {
  const groupRef = useRef();
  const planetRotRef = useRef();
  
  useFrame((_, delta) => {
    if (planetRotRef.current) {
      planetRotRef.current.rotation.y += delta * 0.15;
    }
  });

  if (!isVisible) return null;

  const spherePositions = buildFibonacciSphere(images.length, PLANET_RADIUS);
  const items = images.map((url, i) => ({ id: `img-${i}`, url, position: spherePositions[i] }));

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <group ref={planetRotRef}>
        {items.map(item => <PhotoTile key={item.id} item={item} onImageClick={onImageClick} />)}
      </group>
    </group>
  );
}

function SolarSystem({ handDataRef, selectedPlanet, onSelectPlanet, onImageClick }) {
  const systemGroupRef = useRef();
  const planetGroupsRef = useRef([]);

  useFrame((_, delta) => {
    if (!systemGroupRef.current) return;
    const hand = handDataRef.current;
    const lerpFactor = 0.12;

    if (hand.present) {
      const targetScale = 0.4 + Math.min(Math.max((hand.distance - 0.04) / 0.36, 0), 1) * 29.6;
      const s = THREE.MathUtils.lerp(systemGroupRef.current.scale.x, targetScale, lerpFactor);
      systemGroupRef.current.scale.set(s, s, s);
      systemGroupRef.current.rotation.x = THREE.MathUtils.lerp(systemGroupRef.current.rotation.x, (hand.position.y - 0.5) * Math.PI * 3.5, lerpFactor);
      systemGroupRef.current.rotation.y = THREE.MathUtils.lerp(systemGroupRef.current.rotation.y, (hand.position.x - 0.5) * Math.PI * 3.5, lerpFactor);
    } else {
      systemGroupRef.current.rotation.y += delta * 0.05;
      const s = THREE.MathUtils.lerp(systemGroupRef.current.scale.x, 0.8, 0.05);
      systemGroupRef.current.scale.set(s, s, s);
      systemGroupRef.current.rotation.x = THREE.MathUtils.lerp(systemGroupRef.current.rotation.x, 0, 0.03);
    }
  });

  return (
    <group ref={systemGroupRef}>
      {Array.from({ length: PLANET_COUNT }).map((_, i) => {
        const angle = (i / PLANET_COUNT) * Math.PI * 2;
        const x = Math.cos(angle) * ORBIT_RADIUS;
        const z = Math.sin(angle) * ORBIT_RADIUS;
        const images = getPlanetImages(i, selectedPlanet === i);
        
        return (
          <group 
            key={i}
            ref={(ref) => { if (ref) planetGroupsRef.current[i] = ref; }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectPlanet(i);
            }}
          >
            <PlanetSphere
              images={images}
              position={[x, 0, z]}
              rotation={[0, 0, 0]}
              onImageClick={onImageClick}
              isVisible={true}
            />
          </group>
        );
      })}
    </group>
  );
}

function Scene({ handDataRef, selectedPlanet, onSelectPlanet, onImageClick, sceneMode }) {
  const groupRef = useRef();
  
  useFrame((_, delta) => {
    if (!groupRef.current || sceneMode !== "planet") return;
    const hand = handDataRef.current;
    const lerpFactor = 0.12;
    if (hand.present) {
      const targetScale = 0.4 + Math.min(Math.max((hand.distance - 0.04) / 0.36, 0), 1) * 29.6;
      const s = THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, lerpFactor);
      groupRef.current.scale.set(s, s, s);
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, (hand.position.y - 0.5) * Math.PI * 3.5, lerpFactor);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, (hand.position.x - 0.5) * Math.PI * 3.5, lerpFactor);
    } else {
      groupRef.current.rotation.y += delta * 0.05;
      const s = THREE.MathUtils.lerp(groupRef.current.scale.x, 0.8, 0.05);
      groupRef.current.scale.set(s, s, s);
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, 0.03);
    }
  });
  
  if (sceneMode === "planet" && selectedPlanet !== null) {
    const images = getPlanetImages(selectedPlanet, true);
    const spherePositions = buildFibonacciSphere(images.length, PLANET_RADIUS);
    const items = images.map((url, i) => ({ id: `img-${i}`, url, position: spherePositions[i] }));
    
    return (
      <group ref={groupRef}>
        {items.map(item => <PhotoTile key={item.id} item={item} onImageClick={onImageClick} />)}
      </group>
    );
  }

  return (
    <SolarSystem
      handDataRef={handDataRef}
      selectedPlanet={selectedPlanet}
      onSelectPlanet={onSelectPlanet}
      onImageClick={onImageClick}
    />
  );
}

const HAND_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

export default function Home() {
  const videoRef = useRef(null);
  const cameraCanvasRef = useRef(null);
  const handDataRef = useRef({ present: false, distance: 0.1, position: { x: 0.5, y: 0.5 } });
  const smoothRef = useRef({ distance: 0.1, x: 0.5, y: 0.5 });
  const [cameraReady, setCameraReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(null);
  const [mode, setMode] = useState("mouse");
  const [selectedPlanet, setSelectedPlanet] = useState(null);
  const [sceneMode, setSceneMode] = useState("system");
  const mouseRef = useRef({ down: false, lastX: 0, lastY: 0 });

  const handleSelectPlanet = (planetIndex) => {
    setSelectedPlanet(planetIndex);
    setSceneMode("planet");
  };

  const handleBackToSystem = () => {
    setSelectedPlanet(null);
    setSceneMode("system");
  };

  // Mouse controls
  useEffect(() => {
    const onDown = (e) => {
      if (sceneMode === "planet" && e.target === e.currentTarget) {
        handleBackToSystem();
        return;
      }
      mouseRef.current.down = true;
      mouseRef.current.lastX = e.clientX / window.innerWidth;
      mouseRef.current.lastY = e.clientY / window.innerHeight;
    };
    const onMove = (e) => {
      if (!mouseRef.current.down || mode !== "mouse") return;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      handDataRef.current = { present: true, distance: handDataRef.current.distance, position: { x: 1 - x, y } };
      mouseRef.current.lastX = x;
      mouseRef.current.lastY = y;
    };
    const onUp = () => {
      mouseRef.current.down = false;
      if (mode === "mouse") handDataRef.current = { ...handDataRef.current, present: false };
    };
    const onWheel = (e) => {
      if (mode !== "mouse") return;
      const cur = handDataRef.current.distance;
      handDataRef.current = { ...handDataRef.current, distance: Math.max(0.04, Math.min(0.4, cur - e.deltaY * 0.0003)) };
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
  }, [mode, sceneMode]);

  // Hand tracking
  useEffect(() => {
    if (mode !== "hand") return;
    let animId, stream;
    async function init() {
      try {
        const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const fs = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        const hl = await HandLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" },
          runningMode: "VIDEO", numHands: 1,
        });
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 240, height: 135, facingMode: "user" } });
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
          ctx.drawImage(video, 0, 0, 240, 135);
          ctx.restore();
          const results = hl.detectForVideo(video, performance.now());
          if (results.landmarks?.length > 0) {
            const lm = results.landmarks[0];
            const mirrored = lm.map(p => ({ ...p, x: 1 - p.x }));
            ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
            HAND_CONNECTIONS.forEach(([a, b]) => {
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
            const pinch = Math.sqrt(Math.pow(lm[4].x - lm[8].x, 2) + Math.pow(lm[4].y - lm[8].y, 2));
            const z = 0.4;
            smoothRef.current.distance += (pinch - smoothRef.current.distance) * z;
            smoothRef.current.x += (lm[9].x - smoothRef.current.x) * z;
            smoothRef.current.y += (lm[9].y - smoothRef.current.y) * z;
            handDataRef.current = { present: true, distance: smoothRef.current.distance, position: { x: 1 - smoothRef.current.x, y: smoothRef.current.y } };
          } else {
            smoothRef.current.distance += (0.1 - smoothRef.current.distance) * 0.08;
            smoothRef.current.x += (0.5 - smoothRef.current.x) * 0.05;
            smoothRef.current.y += (0.5 - smoothRef.current.y) * 0.05;
            handDataRef.current = { present: false, distance: smoothRef.current.distance, position: { x: 1 - smoothRef.current.x, y: smoothRef.current.y } };
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

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "#fff", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0, background: "#fff" }}>
        <Canvas camera={{ position: [0, 0, 22], fov: 38 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }} dpr={[1, 2]}>
          <color attach="background" args={["#ffffff"]} />
          <fog attach="fog" args={["#ffffff", 25, 40]} />
          <ambientLight intensity={2} />
          <directionalLight position={[10, 20, 20]} intensity={2.5} color="#ffffff" />
          <Suspense fallback={null}>
            <Scene 
              handDataRef={handDataRef} 
              selectedPlanet={selectedPlanet}
              onSelectPlanet={handleSelectPlanet}
              onImageClick={setFullscreen}
              sceneMode={sceneMode}
            />
            <Environment preset="studio" />
          </Suspense>
        </Canvas>
      </div>

      {/* Mode toggle button */}
      <div style={{ position: "fixed", top: 24, right: 24, zIndex: 10 }}>
        <button
          onClick={() => setMode(m => m === "mouse" ? "hand" : "mouse")}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 20px",
            background: "rgba(255,255,255,0.9)",
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: "1rem",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
            cursor: "pointer", fontSize: 12,
            fontWeight: 600, fontFamily: "Inter, system-ui, sans-serif",
            color: "#333", letterSpacing: "0.05em",
          }}
        >
          <span style={{ fontSize: 16 }}>{mode === "mouse" ? "🖱️" : "✋"}</span>
          {mode === "mouse" ? "MOUSE MODE" : "HAND MODE"}
        </button>
      </div>

      {/* Back button (planet mode only) */}
      {sceneMode === "planet" && (
        <div style={{ position: "fixed", top: 24, left: 24, zIndex: 10 }}>
          <button
            onClick={handleBackToSystem}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 20px",
              background: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(0,0,0,0.1)",
              borderRadius: "1rem",
              boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
              cursor: "pointer", fontSize: 12,
              fontWeight: 600, fontFamily: "Inter, system-ui, sans-serif",
              color: "#333", letterSpacing: "0.05em",
            }}
          >
            ← BACK
          </button>
        </div>
      )}

      {/* Hint */}
      <div style={{ position: "absolute", top: 24, left: sceneMode === "planet" ? 130 : 24, zIndex: 10 }}>
        <p style={{ paddingLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "rgb(163,163,163)", textTransform: "uppercase", fontFamily: "Inter, system-ui, sans-serif" }}>
          {sceneMode === "planet" 
            ? (mode === "mouse" ? "Drag to rotate · Scroll to zoom · Click image" : "Pinch to zoom · Move to rotate · Click image")
            : (mode === "mouse" ? "Drag to rotate · Scroll to zoom · Click planet" : "Pinch to zoom · Move to rotate · Click planet")
          }
        </p>
      </div>

      {/* Camera preview — only in hand mode */}
      {mode === "hand" && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", width: 240, height: 135, borderRadius: "1.8rem", overflow: "hidden", boxShadow: "0 20px 40px -10px rgba(0,0,0,0.1)", border: "5px solid white", background: "white", opacity: cameraReady ? 1 : 0.3, transition: "opacity 0.5s", zIndex: 10 }}>
          <video ref={videoRef} playsInline muted style={{ display: "none" }} width={240} height={135} />
          <canvas ref={cameraCanvasRef} width={240} height={135} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", border: "1px solid rgba(0,0,0,0.05)", borderRadius: "1.4rem" }} />
        </div>
      )}

      {/* Fullscreen */}
      {fullscreen && (
        <div onClick={() => setFullscreen(null)} style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.97)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, cursor: "zoom-out", animation: "zoomIn 0.2s cubic-bezier(0.34,1.56,0.64,1)" }}>
          <style>{`@keyframes zoomIn{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}`}</style>
          <img src={fullscreen} alt="Full resolution image" style={{ maxWidth: "88vw", maxHeight: "88vh", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}
