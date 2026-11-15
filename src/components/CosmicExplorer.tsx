"use client";

import * as THREE from "three";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Atom, Compass, Crosshair,
  ExternalLink, Expand, Gamepad2, Globe2, Info, Keyboard, Layers3, LoaderCircle,
  MapPin, Pause, Play, Radio, RotateCcw, ScanLine, ShieldCheck, Sparkles,
  Telescope, Volume2, Zap, ZoomIn, ZoomOut,
} from "lucide-react";

type EnvironmentId = "deep-space" | "nebula" | "stellar" | "planetary" | "galactic";
type Fact = { label: string; value: string; source: string; sourceName: string; note?: string };
type Destination = {
  id: string;
  name: string;
  shortName: string;
  environment: EnvironmentId;
  classification: string;
  description: string;
  color: string;
  position: [number, number, number];
  raDeg: number | null;
  decDeg: number | null;
  facts: Fact[];
  sources: { name: string; url: string }[];
  procedural: boolean;
};

const NASA_M31 = "https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31/";
const NASA_M31_COORDS = "https://science.nasa.gov/asset/hubble/compass-and-scale-image-of-m31/";
const NASA_M31_SIZE = "https://science.nasa.gov/missions/hubble/hubble-zooms-into-the-rosy-tendrils-of-andromeda/";
const NASA_M42 = "https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-42/";
const NASA_M42_POSITION = "https://science.nasa.gov/asset/hubble/location-of-the-orion-nebula-details/";
const NASA_M45 = "https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-45/";
const NASA_M45_POSITION = "https://science.nasa.gov/asset/hubble/annotated-image-of-the-pleiades-and-hst-field-of-view/";
const noFacts: Fact[] = [];

const DESTINATIONS: Destination[] = [
  {
    id: "deep-field", name: "Deep Space Waypoint", shortName: "Deep Field", environment: "deep-space",
    classification: "Procedural navigation environment", description: "A quiet sector for learning the flight controls and reading the starship instruments.",
    color: "#78dff4", position: [0, 30, -680], raDeg: null, decDeg: null, facts: noFacts, sources: [], procedural: true,
  },
  {
    id: "m42", name: "Orion Nebula · M42", shortName: "M42 · Orion", environment: "nebula",
    classification: "Star-forming nebula", description: "A nearby stellar nursery. The scene is an original procedural illustration, not an image of M42.",
    color: "#ff9bcb", position: [-360, 120, -1480], raDeg: 83.820833, decDeg: -5.391108,
    facts: [
      { label: "Object class", value: "Nebula", source: NASA_M42, sourceName: "NASA Science · Messier 42" },
      { label: "Scientific context", value: "A nearby stellar nursery and a large star-forming region", source: NASA_M42, sourceName: "NASA Science · Messier 42" },
      { label: "Constellation", value: "Orion", source: NASA_M42_POSITION, sourceName: "NASA Hubble · Orion Nebula position" },
      { label: "Sky position", value: "RA 05h 35m 17.0s · Dec −05° 23′ 27.99″", source: NASA_M42_POSITION, sourceName: "NASA Hubble · Orion Nebula position", note: "Coordinate epoch is not specified in the NASA asset record." },
      { label: "Distance from Earth", value: "1,500 light-years", source: NASA_M42, sourceName: "NASA Science · Messier 42", note: "Rounded contextual value; the source page does not provide a per-value uncertainty." },
      { label: "Apparent magnitude", value: "4.0", source: NASA_M42, sourceName: "NASA Science · Messier 42", note: "The source page does not provide a per-value uncertainty." },
    ],
    sources: [{ name: "NASA Science · Messier 42", url: NASA_M42 }, { name: "NASA Hubble · Orion Nebula position", url: NASA_M42_POSITION }], procedural: false,
  },
  {
    id: "m45", name: "Pleiades · M45", shortName: "M45 · Pleiades", environment: "stellar",
    classification: "Open star cluster", description: "An open cluster commonly known as the Seven Sisters. The starscape here is procedural, not an observation.",
    color: "#8ecbff", position: [530, 220, -2220], raDeg: 56.75, decDeg: 24.1167,
    facts: [
      { label: "Object class", value: "Open cluster", source: NASA_M45, sourceName: "NASA Science · Messier 45" },
      { label: "Common name", value: "The Seven Sisters", source: NASA_M45, sourceName: "NASA Science · Messier 45" },
      { label: "Constellation", value: "Taurus", source: NASA_M45, sourceName: "NASA Science · Messier 45" },
      { label: "Sky position", value: "RA 03h 46m 59.99s · Dec +24° 07′ 00.0″", source: NASA_M45_POSITION, sourceName: "NASA Hubble · Pleiades position", note: "Coordinate epoch is not specified in the NASA asset record." },
      { label: "Distance from Earth", value: "445 light-years", source: NASA_M45, sourceName: "NASA Science · Messier 45", note: "Rounded contextual value; the source page does not provide a per-value uncertainty." },
      { label: "Apparent magnitude", value: "1.6", source: NASA_M45, sourceName: "NASA Science · Messier 45", note: "The source page does not provide a per-value uncertainty." },
      { label: "Cluster membership", value: "Over 1,000 stars", source: NASA_M45, sourceName: "NASA Science · Messier 45" },
    ],
    sources: [{ name: "NASA Science · Messier 45", url: NASA_M45 }, { name: "NASA Hubble · Pleiades position", url: NASA_M45_POSITION }], procedural: false,
  },
  {
    id: "m31", name: "Andromeda Galaxy · M31", shortName: "M31 · Andromeda", environment: "galactic",
    classification: "Spiral galaxy", description: "The nearest major galaxy to the Milky Way. Its grand spiral structure is recreated here for navigation and scale, not reconstructed from telescope pixels.",
    color: "#c7a0ff", position: [360, -80, -4680], raDeg: 10.683333, decDeg: 41.269164,
    facts: [
      { label: "Object class", value: "Spiral galaxy", source: NASA_M31, sourceName: "NASA Science · Messier 31" },
      { label: "Relation to the Milky Way", value: "Nearest major galaxy", source: NASA_M31, sourceName: "NASA Science · Messier 31" },
      { label: "Distance from Earth", value: "2.5 million light-years", source: NASA_M31, sourceName: "NASA Science · Messier 31", note: "Rounded contextual value; the source page does not provide a per-value uncertainty." },
      { label: "Apparent magnitude", value: "3.1", source: NASA_M31, sourceName: "NASA Science · Messier 31", note: "The source page does not provide a per-value uncertainty." },
      { label: "Sky position", value: "RA 00h 42m 44.0s · Dec +41° 16′ 08.99″", source: NASA_M31_COORDS, sourceName: "NASA Hubble · M31 compass and scale" , note: "Shown in the NASA asset record; its coordinate epoch is not specified there." },
      { label: "Approximate diameter", value: "152,000 light-years", source: NASA_M31_SIZE, sourceName: "NASA Hubble · Andromeda overview", note: "Approximate published value; the source page does not provide a measurement uncertainty." },
    ],
    sources: [
      { name: "NASA Science · Messier 31", url: NASA_M31 },
      { name: "NASA Hubble · M31 position", url: NASA_M31_COORDS },
      { name: "NASA Hubble · Andromeda overview", url: NASA_M31_SIZE },
    ], procedural: false,
  },
  {
    id: "stellar-sequence", name: "Stellar Sequence Simulator", shortName: "Stellar Sequence", environment: "stellar",
    classification: "Educational procedural scene", description: "Compare visual forms inspired by red dwarfs, Sun-like stars, blue stars and evolved giants. These are illustrative classes, not individually identified stars.",
    color: "#ffd28c", position: [-700, -110, -1180], raDeg: null, decDeg: null, facts: noFacts, sources: [], procedural: true,
  },
  {
    id: "planetary-atlas", name: "Planetary Systems Atlas", shortName: "Planetary Atlas", environment: "planetary",
    classification: "Schematic planetary environment", description: "An explorable arrangement of planets and rings for orientation practice. It is not a real system, ephemeris, scale model, or planetary image.",
    color: "#65d9db", position: [180, -110, -1040], raDeg: null, decDeg: null, facts: noFacts, sources: [], procedural: true,
  },
];

const ENVIRONMENTS: { id: EnvironmentId; label: string; icon: typeof Globe2; subtitle: string }[] = [
  { id: "deep-space", label: "Deep space", icon: Globe2, subtitle: "Open navigation" },
  { id: "nebula", label: "Nebula", icon: Sparkles, subtitle: "Star-forming regions" },
  { id: "stellar", label: "Stellar", icon: Atom, subtitle: "Clusters & stellar classes" },
  { id: "planetary", label: "Planetary", icon: Layers3, subtitle: "Schematic systems" },
  { id: "galactic", label: "Galactic", icon: Compass, subtitle: "Galaxy-scale structure" },
];

const MISSION_LIST = [
  { id: "deep-initiation", number: "01", title: "Deep Space Initiation", description: "Travel 500 flight units and learn the helm.", ready: (p: Progress) => p.travelUnits >= 500, progress: (p: Progress) => `${Math.min(500, Math.round(p.travelUnits))} / 500 units` },
  { id: "stellar-investigation", number: "02", title: "Stellar Investigation", description: "Reach and scan the stellar sequence simulator.", ready: (p: Progress) => p.scanned.includes("stellar-sequence"), progress: (p: Progress) => p.scanned.includes("stellar-sequence") ? "Sequence scanned" : "Awaiting arrival & scan" },
  { id: "nebula-expedition", number: "03", title: "Nebula Expedition", description: "Reach and scan the Orion Nebula destination.", ready: (p: Progress) => p.scanned.includes("m42"), progress: (p: Progress) => p.scanned.includes("m42") ? "M42 scanned" : "Awaiting arrival & scan" },
  { id: "galactic-discovery", number: "04", title: "Galactic Discovery", description: "Reach and scan the Andromeda destination.", ready: (p: Progress) => p.scanned.includes("m31"), progress: (p: Progress) => p.scanned.includes("m31") ? "M31 scanned" : "Awaiting arrival & scan" },
  { id: "research-link", number: "05", title: "Astronomical Research", description: "Open a catalogued destination in the scientific investigator.", ready: (p: Progress) => p.researched.length > 0, progress: (p: Progress) => p.researched.length ? "Research page opened" : "Awaiting research handoff" },
];

type Progress = { travelUnits: number; scanned: string[]; researched: string[] };
const DEFAULT_PROGRESS: Progress = { travelUnits: 0, scanned: [], researched: [] };
const PROGRESS_KEY = "ascentra.cosmic-explorer.progress.v1";
type Quality = "balanced" | "low";

function destinationLockReason(destinationId: string, progress: Progress) {
  if (destinationId === "m45" && progress.travelUnits < 500) return "Unlock after traveling 500 flight units.";
  if (destinationId === "m31" && !progress.scanned.includes("m42")) return "Unlock after scanning the Orion Nebula destination.";
  return "";
}

function rand(seed: number) {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

function addStars(parent: THREE.Group, count: number, radius: number, seed: number) {
  const random = rand(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = [new THREE.Color("#dceaff"), new THREE.Color("#94dfff"), new THREE.Color("#ffd6a0"), new THREE.Color("#d7c3ff")];
  for (let i = 0; i < count; i++) {
    const r = radius * (0.15 + random() * 0.85);
    const theta = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const ring = Math.sqrt(1 - z * z);
    positions[i * 3] = Math.cos(theta) * ring * r;
    positions[i * 3 + 1] = z * r;
    positions[i * 3 + 2] = Math.sin(theta) * ring * r;
    const color = palette[Math.floor(random() * palette.length)].clone().multiplyScalar(0.45 + random() * 0.75);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 2.3, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.88, depthWrite: false });
  parent.add(new THREE.Points(geometry, material));
}

function addNebula(parent: THREE.Group, seed: number, spread = 240, count = 5600) {
  const random = rand(seed);
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const palette = [new THREE.Color("#f584bb"), new THREE.Color("#785fd0"), new THREE.Color("#3c9fc2"), new THREE.Color("#ffb274")];
  for (let i = 0; i < count; i++) {
    const arm = i % 4;
    const angle = random() * Math.PI * 2 + arm * Math.PI / 2;
    const radius = spread * Math.sqrt(random()) * (0.35 + random() * 0.65);
    positions[i * 3] = Math.cos(angle) * radius + (random() - 0.5) * spread * 0.2;
    positions[i * 3 + 1] = Math.sin(angle) * radius * 0.56 + (random() - 0.5) * spread * 0.34;
    positions[i * 3 + 2] = (random() - 0.5) * spread * 0.85;
    const color = palette[arm].clone().multiplyScalar(0.24 + random() * 0.56);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 8, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false });
  parent.add(new THREE.Points(geometry, material));
}

function addGalaxy(parent: THREE.Group, seed: number, count = 4700) {
  const random = rand(seed), positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const colorset = [new THREE.Color("#8fc9ff"), new THREE.Color("#e4c9ff"), new THREE.Color("#ffc98c")];
  for (let i = 0; i < count; i++) {
    const arm = i % 3;
    const radius = 26 + Math.pow(random(), 0.7) * 260;
    const angle = arm * Math.PI * 2 / 3 + radius * 0.018 + (random() - 0.5) * 0.42;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.sin(angle) * radius * 0.55;
    positions[i * 3 + 2] = (random() - 0.5) * (10 + radius * 0.12);
    const color = colorset[arm].clone().multiplyScalar(0.28 + random() * 0.7);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  parent.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: 3, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false })));
  const core = new THREE.Mesh(new THREE.SphereGeometry(24, 20, 16), new THREE.MeshBasicMaterial({ color: "#fff0d5" }));
  parent.add(core);
}

function addStar(parent: THREE.Group, color: string, size: number) {
  const core = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 16), new THREE.MeshBasicMaterial({ color }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(size * 2.6, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.11, side: THREE.BackSide, depthWrite: false }));
  parent.add(core, glow);
}

function createDestinationVisual(destination: Destination, quality: Quality) {
  const group = new THREE.Group();
  const color = destination.color;
  if (destination.id === "m31") {
    addGalaxy(group, 31031, quality === "low" ? 2100 : 5000);
    group.rotation.x = 0.32;
  } else if (destination.id === "m42") {
    addNebula(group, 42042, 260, quality === "low" ? 2400 : 6000);
    addStar(group, "#ffe0bd", 7);
  } else if (destination.id === "m45") {
    addStars(group, quality === "low" ? 420 : 1000, 190, 45045);
    addStar(group, "#c4e8ff", 8);
  } else if (destination.id === "stellar-sequence") {
    addStar(group, "#ff8e72", 28);
    const sun = new THREE.Group(); sun.position.set(125, 30, -40); addStar(sun, "#ffe0a2", 38); group.add(sun);
    const blue = new THREE.Group(); blue.position.set(-120, -16, -55); addStar(blue, "#9dcaff", 46); group.add(blue);
    const giant = new THREE.Group(); giant.position.set(5, 125, -90); addStar(giant, "#ffb187", 63); group.add(giant);
    addStars(group, quality === "low" ? 220 : 600, 390, 15015);
  } else if (destination.id === "planetary-atlas") {
    const planetData = [["#63a6d6", 56, -150], ["#c98367", 34, 20], ["#d8bf9a", 76, 190]] as const;
    planetData.forEach(([planetColor, size, x], index) => {
      const planet = new THREE.Mesh(new THREE.SphereGeometry(size, 28, 20), new THREE.MeshStandardMaterial({ color: planetColor, roughness: 0.88, metalness: 0.02, emissive: planetColor, emissiveIntensity: 0.06 }));
      planet.position.set(x, index === 1 ? 72 : 0, -45 - index * 12); group.add(planet);
      if (index === 2) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(size * 1.2, size * 1.82, 64), new THREE.MeshBasicMaterial({ color: "#e6d4aa", side: THREE.DoubleSide, transparent: true, opacity: 0.46, depthWrite: false }));
        ring.rotation.x = Math.PI * 0.37; ring.position.copy(planet.position); group.add(ring);
      }
    });
    addStars(group, quality === "low" ? 180 : 400, 570, 22990);
  } else {
    addStars(group, quality === "low" ? 500 : 1200, 460, 77001);
  }

  const locator = new THREE.Mesh(new THREE.SphereGeometry(54, 14, 12), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.4 }));
  locator.userData.destinationId = destination.id;
  group.add(locator);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(72, 1.2, 6, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.68 }));
  halo.userData.destinationId = destination.id; group.add(halo);
  group.traverse((node) => { if (node instanceof THREE.Mesh && node !== locator && node !== halo) node.userData.destinationId = destination.id; });
  group.position.set(...destination.position);
  return { group, locator };
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
    else mesh.material?.dispose?.();
  });
}

function coordinateLabel(ra: number | null, dec: number | null, researchTarget: boolean) {
  if (ra == null || dec == null) return "Coordinates unavailable";
  return `${ra.toFixed(4)}°, ${dec >= 0 ? "+" : ""}${dec.toFixed(4)}° · ${researchTarget ? "research handoff coordinates" : "NASA page coordinates"}`;
}

export function CosmicExplorer() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const factsPanelRef = useRef<HTMLElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const cameraSnapshotRef = useRef<{ position: [number, number, number]; rotation: [number, number, number]; rotationOrder: THREE.EulerOrder; fov: number } | null>(null);
  const destinationsRef = useRef(new Map<string, THREE.Group>());
  const keysRef = useRef(new Set<string>());
  const lastArrivedRef = useRef("");
  const stateRef = useRef({ environment: "deep-space" as EnvironmentId, selected: "deep-field", autopilot: false, paused: false, quality: "balanced" as Quality });
  const selectDestinationRef = useRef<(id: string, route?: boolean) => void>(() => undefined);
  const [environment, setEnvironment] = useState<EnvironmentId>("deep-space");
  const [selectedId, setSelectedId] = useState("deep-field");
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const [autopilot, setAutopilot] = useState(false);
  const [paused, setPaused] = useState(false);
  const [quality, setQuality] = useState<Quality>("balanced");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [loadingScene, setLoadingScene] = useState(true);
  const [sceneError, setSceneError] = useState("");
  const [activeTab, setActiveTab] = useState<"nav" | "missions" | "systems">("nav");
  const [distance, setDistance] = useState(0);
  const [heading, setHeading] = useState(0);
  const [energy, setEnergy] = useState(100);
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [customDestination, setCustomDestination] = useState<Destination | null>(null);
  const destinations = useMemo(() => customDestination ? [...DESTINATIONS, customDestination] : DESTINATIONS, [customDestination]);
  const selected = destinations.find((item) => item.id === selectedId) ?? DESTINATIONS[0];
  const nearbyDestinations = useMemo(() => destinations.filter((item) => item.environment === environment), [destinations, environment]);
  const completedCount = MISSION_LIST.filter((mission) => mission.ready(progress)).length;
  const selectedLockReason = destinationLockReason(selectedId, progress);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Progress>;
        setProgress({ travelUnits: Math.max(0, Number(parsed.travelUnits) || 0), scanned: Array.isArray(parsed.scanned) ? parsed.scanned.filter((id): id is string => typeof id === "string") : [], researched: Array.isArray(parsed.researched) ? parsed.researched.filter((id): id is string => typeof id === "string") : [] });
      }
    } catch { /* A malformed local save starts a fresh local mission log. */ }
    setProgressLoaded(true);
    const params = new URLSearchParams(window.location.search);
    const ra = Number(params.get("ra")), dec = Number(params.get("dec")), target = params.get("target");
    if (Number.isFinite(ra) && ra >= 0 && ra < 360 && Number.isFinite(dec) && dec >= -90 && dec <= 90) {
      const matching = DESTINATIONS.find((item) => item.raDeg != null && Math.abs(item.raDeg - ra) < 0.002 && Math.abs((item.decDeg ?? 0) - dec) < 0.002);
      if (matching) { setEnvironment(matching.environment); setSelectedId(matching.id); setArrivedId(null); }
      else if (target) {
        const custom: Destination = { id: "research-target", name: target, shortName: target.slice(0, 22), environment: "deep-space", classification: "Research target · catalogue context supplied by the scientific module", description: "A research coordinate passed from ASCENTRA. The surrounding stars are a procedural navigation scene, not a photograph or measured 3D position.", color: "#f3d08b", position: [120, 40, -1250], raDeg: ra, decDeg: dec, facts: [], sources: [], procedural: true };
        setCustomDestination(custom); setEnvironment("deep-space"); setSelectedId(custom.id);
      }
    }
  }, []);

  useEffect(() => {
    if (progressLoaded) {
      try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Private browsing may disable storage. */ }
    }
  }, [progress, progressLoaded]);

  useEffect(() => { stateRef.current = { environment, selected: selectedId, autopilot, paused, quality }; }, [environment, selectedId, autopilot, paused, quality]);

  const selectDestination = useCallback((id: string, route = false) => {
    const destination = customDestination?.id === id ? customDestination : DESTINATIONS.find((item) => item.id === id);
    if (!destination) return;
    stateRef.current.selected = id;
    stateRef.current.environment = destination.environment;
    stateRef.current.autopilot = route;
    setSelectedId(id);
    setEnvironment(destination.environment);
    setArrivedId(null);
    lastArrivedRef.current = "";
    setScanMessage("");
    setAutopilot(route);
  }, [customDestination]);
  useEffect(() => { selectDestinationRef.current = selectDestination; }, [selectDestination]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: quality !== "low", alpha: false, powerPreference: "high-performance" });
    } catch {
      setSceneError("This browser could not create a WebGL view. Use the navigation panel to continue with the accessible flight map.");
      setLoadingScene(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "low" ? 1 : 1.65));
    renderer.setSize(host.clientWidth || 900, host.clientHeight || 620);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor("#030611", 1);
    renderer.domElement.className = "cosmic-webgl-canvas";
    renderer.domElement.setAttribute("aria-label", "Procedural three-dimensional starship flight view. Select a visible marker or use navigation controls.");
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#030611");
    scene.fog = new THREE.FogExp2("#030611", 0.000033);
    const camera = new THREE.PerspectiveCamera(70, Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight), 0.1, 26000);
    camera.position.set(0, 0, 0);
    const cameraSnapshot = cameraSnapshotRef.current;
    if (cameraSnapshot) {
      camera.position.set(...cameraSnapshot.position);
      camera.rotation.order = cameraSnapshot.rotationOrder;
      camera.rotation.set(...cameraSnapshot.rotation);
      camera.fov = cameraSnapshot.fov;
      camera.updateProjectionMatrix();
      cameraSnapshotRef.current = null;
    }
    cameraRef.current = camera;
    scene.add(new THREE.AmbientLight("#7fa3cc", 0.55));
    const rimLight = new THREE.PointLight("#92deff", 280, 3600); rimLight.position.set(0, 80, -200); scene.add(rimLight);
    const starGroup = new THREE.Group(); addStars(starGroup, quality === "low" ? 1800 : 5400, 10500, 20261114); scene.add(starGroup);
    const environmentGroup = new THREE.Group(); scene.add(environmentGroup);
    const targetMeshList: THREE.Object3D[] = [];
    const destinationGroups = destinationsRef.current;
    let currentEnvironment: EnvironmentId | null = null;
    let frame = 0;
    let lastHud = 0;
    let lastTime = 0;
    let totalTravel = 0;
    let currentEnergy = 100;
    let pointerDown: { x: number; y: number; lastX: number; lastY: number; moved: number } | null = null;
    const raycaster = new THREE.Raycaster(); raycaster.params.Points!.threshold = 24;
    const pointer = new THREE.Vector2();
    const keySet = keysRef.current;

    const rebuildEnvironment = (id: EnvironmentId) => {
      disposeTree(environmentGroup);
      environmentGroup.clear(); destinationGroups.clear(); targetMeshList.length = 0;
      const tint = id === "nebula" ? "#32162f" : id === "galactic" ? "#1c1735" : id === "planetary" ? "#0a2430" : id === "stellar" ? "#10243b" : "#030611";
      scene.fog = new THREE.FogExp2(tint, id === "nebula" ? 0.00012 : 0.000033);
      if (id === "nebula") addNebula(environmentGroup, 420, 1500, quality === "low" ? 1500 : 3800);
      if (id === "galactic") {
        const glow = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 18), new THREE.MeshBasicMaterial({ color: "#713cae", transparent: true, opacity: 0.045, side: THREE.BackSide, depthWrite: false }));
        glow.position.set(0, 0, -1200); environmentGroup.add(glow);
      }
      if (id === "planetary") {
        const distant = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 18), new THREE.MeshBasicMaterial({ color: "#1d536a", transparent: true, opacity: 0.09, side: THREE.BackSide, depthWrite: false }));
        distant.position.set(0, 0, -1800); environmentGroup.add(distant);
      }
      for (const destination of destinations) {
        const { group, locator } = createDestinationVisual(destination, quality);
        environmentGroup.add(group); destinationGroups.set(destination.id, group); targetMeshList.push(locator);
      }
      currentEnvironment = id;
    };
    rebuildEnvironment(stateRef.current.environment);
    setLoadingScene(false);

    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height; camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, stateRef.current.quality === "low" ? 1 : 1.65));
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize); observer.observe(host);

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: 0 };
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerDown || stateRef.current.paused) return;
      const dx = event.clientX - pointerDown.lastX, dy = event.clientY - pointerDown.lastY;
      pointerDown.moved += Math.abs(dx) + Math.abs(dy);
      pointerDown.lastX = event.clientX; pointerDown.lastY = event.clientY;
      camera.rotation.order = "YXZ";
      camera.rotation.y -= dx * 0.0026;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dy * 0.0022, -1.42, 1.42);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDown) return;
      const click = pointerDown.moved < 7;
      const rect = renderer.domElement.getBoundingClientRect();
      if (click) {
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(targetMeshList, false);
        const targetId = hits[0]?.object.userData.destinationId;
        if (typeof targetId === "string") selectDestinationRef.current(targetId, true);
      }
      pointerDown = null;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + (event.deltaY < 0 ? -5 : 5), 36, 85);
      camera.updateProjectionMatrix();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift"].includes(key)) { keySet.add(key); event.preventDefault(); }
    };
    const onKeyUp = (event: KeyboardEvent) => keySet.delete(event.key.toLowerCase());
    const onBlur = () => keySet.clear();
    window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp); window.addEventListener("blur", onBlur);

    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
      lastTime = time;
      const state = stateRef.current;
      if (state.environment !== currentEnvironment) rebuildEnvironment(state.environment);
      const selectedGroup = destinationGroups.get(state.selected);
      const targetPosition = selectedGroup?.position;
      if (!state.paused && delta > 0) {
        starGroup.rotation.y += delta * 0.004;
        const gamepads = navigator.getGamepads?.() ?? [];
        const pad = gamepads[0];
        if (pad) {
          if (Math.abs(pad.axes[2] ?? 0) > 0.12) camera.rotation.y -= pad.axes[2] * delta * 1.5;
          if (Math.abs(pad.axes[3] ?? 0) > 0.12) camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - pad.axes[3] * delta * 1.3, -1.42, 1.42);
          if (Math.abs(pad.axes[1] ?? 0) > 0.12) { const velocity = (pad.axes[1] as number) * delta * 180; camera.translateZ(velocity); totalTravel += Math.abs(velocity); }
          if (Math.abs(pad.axes[0] ?? 0) > 0.12) { const velocity = (pad.axes[0] as number) * delta * 140; camera.translateX(velocity); totalTravel += Math.abs(velocity); }
        }
        const boosting = keySet.has("shift") || keySet.has(" ") || Boolean(pad?.buttons?.[0]?.pressed);
        const speed = boosting ? 520 : 175;
        if (keySet.has("w") || keySet.has("arrowup")) { camera.translateZ(-speed * delta); totalTravel += speed * delta; }
        if (keySet.has("s") || keySet.has("arrowdown")) { camera.translateZ(speed * delta); totalTravel += speed * delta; }
        if (keySet.has("a")) { camera.translateX(-speed * delta * 0.72); totalTravel += speed * delta * 0.72; }
        if (keySet.has("d")) { camera.translateX(speed * delta * 0.72); totalTravel += speed * delta * 0.72; }
        if (keySet.has("q")) { camera.translateY(-speed * delta * 0.6); totalTravel += speed * delta * 0.6; }
        if (keySet.has("e")) { camera.translateY(speed * delta * 0.6); totalTravel += speed * delta * 0.6; }
        if (keySet.has("arrowleft")) camera.rotation.y += delta * 0.8;
        if (keySet.has("arrowright")) camera.rotation.y -= delta * 0.8;

        if (state.autopilot && targetPosition) {
          const vector = targetPosition.clone().sub(camera.position);
          const distanceToTarget = vector.length();
          if (distanceToTarget <= 112) {
            stateRef.current.autopilot = false; setAutopilot(false);
            if (lastArrivedRef.current !== state.selected) { lastArrivedRef.current = state.selected; setArrivedId(state.selected); setActiveTab("nav"); }
          } else {
            vector.normalize();
            const desiredQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), vector);
            camera.quaternion.slerp(desiredQuaternion, Math.min(1, delta * 1.6));
            const step = Math.min(distanceToTarget - 106, 480 * delta);
            camera.position.addScaledVector(vector, step); totalTravel += step;
          }
        }
        const distanceToTarget = targetPosition ? camera.position.distanceTo(targetPosition) : 0;
        if (targetPosition && distanceToTarget <= 112 && lastArrivedRef.current !== state.selected) {
          lastArrivedRef.current = state.selected; stateRef.current.autopilot = false; setAutopilot(false); setArrivedId(state.selected); setActiveTab("nav");
        }
        const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const nextHeading = (THREE.MathUtils.radToDeg(Math.atan2(facing.x, -facing.z)) + 360) % 360;
        if (time - lastHud > 240) {
          lastHud = time;
          setDistance(targetPosition ? camera.position.distanceTo(targetPosition) : 0);
          setHeading(nextHeading);
          setProgress((previous) => {
            const nextTravelUnits = Math.max(previous.travelUnits, totalTravel);
            return nextTravelUnits === previous.travelUnits ? previous : { ...previous, travelUnits: nextTravelUnits };
          });
          currentEnergy = Math.max(8, Math.min(100, currentEnergy + (boosting ? -delta * 2.8 : delta * 0.35)));
          setEnergy(currentEnergy);
          setGamepadConnected(Boolean(pad));
        }
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", onBlur);
      if (cameraRef.current) {
        const activeCamera = cameraRef.current;
        cameraSnapshotRef.current = {
          position: [activeCamera.position.x, activeCamera.position.y, activeCamera.position.z],
          rotation: [activeCamera.rotation.x, activeCamera.rotation.y, activeCamera.rotation.z],
          rotationOrder: activeCamera.rotation.order,
          fov: activeCamera.fov,
        };
      }
      disposeTree(scene); renderer.dispose(); renderer.domElement.remove(); cameraRef.current = null; destinationGroups.clear();
    };
  }, [quality, destinations]);

  const routeToSelected = () => { if (!selectedLockReason) selectDestination(selectedId, true); };
  const togglePause = () => { const next = !paused; stateRef.current.paused = next; setPaused(next); if (!next) keysRef.current.clear(); };
  const resetFlight = () => {
    if (!cameraRef.current) return;
    cameraRef.current.position.set(0, 0, 0); cameraRef.current.rotation.set(0, 0, 0); cameraRef.current.fov = 70; cameraRef.current.updateProjectionMatrix();
    stateRef.current.autopilot = false; setAutopilot(false); setArrivedId(null); lastArrivedRef.current = ""; setDistance(0); setEnergy(100);
  };
  const zoomBy = (delta: number) => {
    if (!cameraRef.current) return;
    cameraRef.current.fov = THREE.MathUtils.clamp(cameraRef.current.fov + delta, 36, 85);
    cameraRef.current.updateProjectionMatrix();
  };
  const scanDestination = () => {
    if (arrivedId !== selectedId) return;
    setProgress((previous) => ({ ...previous, scanned: previous.scanned.includes(selectedId) ? previous.scanned : [...previous.scanned, selectedId] }));
    setScanMessage(`${selected.shortName} added to the local discovery log.`);
  };
  const researchHref = selected.raDeg == null || selected.decDeg == null ? null : `/investigate?ra=${encodeURIComponent(selected.raDeg)}&dec=${encodeURIComponent(selected.decDeg)}&target=${encodeURIComponent(selected.name)}`;
  const openResearch = () => {
    if (!researchHref) return;
    setProgress((previous) => ({ ...previous, researched: previous.researched.includes(selectedId) ? previous.researched : [...previous.researched, selectedId] }));
  };
  const resetMissionLog = () => {
    setProgress(DEFAULT_PROGRESS);
    try { localStorage.removeItem(PROGRESS_KEY); } catch { /* A blocked save does not block a local reset. */ }
    setScanMessage("Local mission log cleared.");
  };
  const moveNudge = (direction: "forward" | "back" | "left" | "right" | "up" | "down") => {
    const camera = cameraRef.current; if (!camera) return;
    const amount = 90;
    if (direction === "forward") camera.translateZ(-amount);
    if (direction === "back") camera.translateZ(amount);
    if (direction === "left") camera.translateX(-amount);
    if (direction === "right") camera.translateX(amount);
    if (direction === "up") camera.translateY(amount);
    if (direction === "down") camera.translateY(-amount);
    setProgress((previous) => ({ ...previous, travelUnits: previous.travelUnits + 90 }));
  };
  const changeEnvironment = (id: EnvironmentId) => {
    setEnvironment(id); stateRef.current.environment = id;
    const first = destinations.find((item) => item.environment === id);
    if (first) selectDestination(first.id, false);
  };
  const toggleFullscreen = async () => {
    if (!viewportRef.current) return;
    try {
      if (!document.fullscreenElement) await viewportRef.current.requestFullscreen(); else await document.exitFullscreen();
    } catch { setSceneError("Fullscreen is unavailable in this browser."); }
  };
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change); return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  useEffect(() => {
    if (arrivedId !== selectedId || activeTab !== "nav" || !factsPanelRef.current) return;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    factsPanelRef.current.scrollIntoView({ behavior, block: "start" });
  }, [arrivedId, selectedId, activeTab]);

  return <div className="cosmic-shell">
    <header className="cosmic-local-nav">
      <div className="cosmic-local-brand"><span className="cosmic-emblem"><Globe2 size={18} /></span><div><b>COSMIC EXPLORER</b><small>BEYOND THE OBSERVABLE HORIZON</small></div></div>
      <nav aria-label="Cosmic Explorer navigation" className="cosmic-local-links">
        <a href="#flight-deck" className="active">Flight deck</a><button type="button" onClick={() => setActiveTab("missions")}>Mission log</button><Link href="/research#observatory">Scientific research <ArrowRight size={12} /></Link>
      </nav>
      <div className="cosmic-save-status"><span /> FLIGHT LOG SAVED LOCALLY</div>
    </header>

    <main className="cosmic-main" id="flight-deck">
      <div className="cosmic-page-heading"><div><span className="cosmic-overline"><span /> ASCENTRA · EXPLORATION MODE</span><h1>Command the <span>unknown.</span></h1><p>Travel through procedural space scenes, then open the sourced facts when you arrive at a catalogued destination.</p></div><div className="cosmic-heading-actions"><button className={`cosmic-mode-toggle ${advancedMode ? "selected" : ""}`} onClick={() => setAdvancedMode(!advancedMode)}><Info size={14} /> {advancedMode ? "Advanced mode" : "Beginner mode"}</button><button className="cosmic-quality" onClick={() => setQuality(quality === "balanced" ? "low" : "balanced")}><Activity size={13} /> {quality === "balanced" ? "Balanced graphics" : "Low graphics"}</button></div></div>

      <div className="cosmic-environment-strip" aria-label="Select exploration environment">
        {ENVIRONMENTS.map(({ id, label, icon: Icon, subtitle }) => <button key={id} className={environment === id ? "selected" : ""} onClick={() => changeEnvironment(id)} aria-pressed={environment === id}><Icon size={15} /><span>{label}<small>{subtitle}</small></span></button>)}
      </div>

      <section className="cosmic-cockpit" aria-label="Interactive starship flight deck">
        <div className="cosmic-view-screen" ref={viewportRef}>
          <div className="cosmic-canvas-host" ref={canvasHostRef} />
          {loadingScene && <div className="cosmic-loading"><LoaderCircle className="spin" size={22} /><span>Spooling navigation array</span></div>}
          {sceneError && <div className="cosmic-scene-notice" role="status"><Info size={15} />{sceneError}</div>}
          <div className="cosmic-screen-top"><div className="cosmic-live-tag"><span /> {autopilot ? "AUTOPILOT · EN ROUTE" : paused ? "FLIGHT PAUSED" : "FLIGHT SYSTEMS ONLINE"}</div><div className="cosmic-simulation-tag"><Sparkles size={12} /> PROCEDURAL 3D SCENE · NOT A TELESCOPE IMAGE</div></div>
          <div className="cosmic-screen-target"><span className="reticle-line horizontal" /><span className="reticle-line vertical" /><span className="reticle-center" /></div>
          <div className="cosmic-hud-left"><span>SECTOR</span><b>{ENVIRONMENTS.find((item) => item.id === environment)?.label.toUpperCase()}</b><span>HEADING</span><b>{heading.toFixed(0).padStart(3, "0")}°</b><span>LOCAL RANGE · SIM</span><b>{distance < 1000 ? `${distance.toFixed(0)} SU` : `${(distance / 1000).toFixed(1)} kSU`}</b></div>
          <div className="cosmic-target-tag"><Crosshair size={13} /><span>{selected.shortName}</span>{arrivedId === selectedId && <b>ARRIVED</b>}</div>
          {arrivedId === selectedId && <div className="cosmic-arrival-toast"><ScanLine size={14} /><div><b>DESTINATION REACHED</b><span>Reference facts are now available in the mission console.</span></div></div>}
          <div className="cosmic-viewport-controls"><button title="Reset flight position and zoom" aria-label="Reset flight position and zoom" onClick={resetFlight}><RotateCcw size={14} /></button><button title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(-5)}><ZoomIn size={14} /></button><button title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(5)}><ZoomOut size={14} /></button><button title={paused ? "Resume flight" : "Pause flight"} aria-label={paused ? "Resume flight" : "Pause flight"} onClick={togglePause}>{paused ? <Play size={14} /> : <Pause size={14} />}</button><button title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}><Expand size={14} /></button></div>
          <div className="cosmic-flight-controls" aria-label="Touch flight controls">
            <button onClick={() => moveNudge("up")} aria-label="Move up"><ArrowUp size={15} /></button>
            <div><button onClick={() => moveNudge("left")} aria-label="Strafe left"><ArrowLeft size={15} /></button><button className="forward" onClick={() => moveNudge("forward")} aria-label="Move forward"><ArrowUp size={17} /></button><button onClick={() => moveNudge("right")} aria-label="Strafe right"><ArrowRight size={15} /></button></div>
            <button onClick={() => moveNudge("down")} aria-label="Move down"><ArrowDown size={15} /></button>
          </div>
          <div className="cosmic-screen-bottom"><span><Keyboard size={12} /> WASD MOVE · Q/E ALTITUDE · DRAG TO LOOK</span><span><Gamepad2 size={13} /> {gamepadConnected ? "CONTROLLER CONNECTED" : "GAMEPAD READY"}</span></div>
        </div>

        <aside className="cosmic-console" aria-label="Navigation and mission console">
          <div className="cosmic-console-tabs" role="tablist" aria-label="Flight console">
            <button role="tab" aria-selected={activeTab === "nav"} className={activeTab === "nav" ? "selected" : ""} onClick={() => setActiveTab("nav")}><Compass size={13} /> Nav</button>
            <button role="tab" aria-selected={activeTab === "missions"} className={activeTab === "missions" ? "selected" : ""} onClick={() => setActiveTab("missions")}><Radio size={13} /> Missions <i>{completedCount}</i></button>
            <button role="tab" aria-selected={activeTab === "systems"} className={activeTab === "systems" ? "selected" : ""} onClick={() => setActiveTab("systems")}><Activity size={13} /> Systems</button>
          </div>

          {activeTab === "nav" && <div className="cosmic-console-body">
            <div className="cosmic-console-heading"><div><span className="cosmic-console-kicker">NAVIGATION ARRAY</span><h2>Destination</h2></div><span className="cosmic-coordinate-icon"><MapPin size={15} /></span></div>
            <label className="cosmic-select-label">DESTINATION<select value={selectedId} onChange={(event) => selectDestination(event.target.value, false)}>{nearbyDestinations.map((item) => <option key={item.id} value={item.id} disabled={Boolean(destinationLockReason(item.id, progress))}>{item.name}{destinationLockReason(item.id, progress) ? " · locked" : ""}</option>)}</select></label>
            <div className="cosmic-destination-brief"><span className="cosmic-object-type">{selected.classification}</span><h3>{selected.name}</h3><p>{selected.description}</p><div className="cosmic-coordinates"><Crosshair size={12} /><span>{coordinateLabel(selected.raDeg, selected.decDeg, selected.id === "research-target")}</span></div>
              <div className="cosmic-range-readout"><span>RANGE TO WAYPOINT</span><b>{distance < 1000 ? `${distance.toFixed(0)} <small>SU</small>` : `${(distance / 1000).toFixed(2)} <small>kSU</small>`}</b></div>
              {selectedLockReason ? <div className="cosmic-lock-notice"><ShieldCheck size={13} /><span>{selectedLockReason}</span></div> : arrivedId === selectedId ? <div className="cosmic-arrived-status"><span /> ARRIVAL LOCKED · BRIEFING OPEN</div> : <button className="cosmic-route-button" onClick={routeToSelected} disabled={paused}><Telescope size={14} /> {autopilot ? "Adjust course" : "Set course"}<ArrowRight size={13} /></button>}
            </div>

            {arrivedId === selectedId && <section ref={factsPanelRef} className="cosmic-facts-panel" aria-live="polite">
              <div className="cosmic-facts-heading"><span className="cosmic-console-kicker">DESTINATION BRIEF · NASA SOURCES</span><ShieldCheck size={14} /></div>
              {selected.facts.length ? <>
                <div className="cosmic-fact-list">{selected.facts.map((fact) => <div className="cosmic-fact" key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong><a href={fact.source} target="_blank" rel="noreferrer">{fact.sourceName}<ExternalLink size={10} /></a>{fact.note && <small>{fact.note}</small>}</div>)}</div>
                <p className="cosmic-facts-caveat">These are reference facts from linked NASA pages, not measurements made by this simulation. Missing values such as temperature or a published uncertainty are not inferred.</p>
                <div className="cosmic-source-links">{selected.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name}<ExternalLink size={10} /></a>)}</div>
              </> : <div className="cosmic-no-facts"><Info size={14} /><p>This waypoint is an educational procedural environment, not a named astronomical object. No NASA object facts are attached.</p></div>}
              <div className="cosmic-representation-note"><Sparkles size={12} /><span>3D environment: generated for exploration. It is not a direct image, scale model, or live position reconstruction.</span></div>
              <button className="cosmic-scan-button" onClick={scanDestination}><ScanLine size={13} /> {progress.scanned.includes(selectedId) ? "Recorded in discovery log" : "Scan & add to discovery log"}</button>
              {researchHref ? <Link href={researchHref} onClick={openResearch} className="cosmic-research-link"><Telescope size={13} /> Investigate scientifically <ArrowRight size={12} /></Link> : <span className="cosmic-research-unavailable">Scientific handoff unavailable: no catalogued coordinates for this simulator scene.</span>}
              {scanMessage && <p className="cosmic-scan-message" role="status">{scanMessage}</p>}
            </section>}

            {!arrivedId && advancedMode && <div className="cosmic-advanced-readout"><span>REFERENCE DISTANCE</span><strong>{selected.facts.find((fact) => fact.label.includes("Distance"))?.value ?? "Not reported"}</strong><small>Only shown after reaching catalogued destinations.</small></div>}
          </div>}

          {activeTab === "missions" && <div className="cosmic-console-body" id="mission-control"><div className="cosmic-console-heading"><div><span className="cosmic-console-kicker">EXPLORATION LOG</span><h2>Missions &amp; discoveries</h2></div><span className="cosmic-mission-count">{completedCount}/{MISSION_LIST.length}</span></div><p className="cosmic-mission-intro">Objectives reward exploring the interface. They do not represent scientific discoveries.</p><div className="cosmic-mission-list">{MISSION_LIST.map((mission) => { const done = mission.ready(progress); return <article className={`cosmic-mission-card ${done ? "done" : ""}`} key={mission.id}><span className="cosmic-mission-number">{done ? <ShieldCheck size={14} /> : mission.number}</span><div><h3>{mission.title}</h3><p>{mission.description}</p><small>{mission.progress(progress)}</small></div><span className="cosmic-mission-state">{done ? "COMPLETE" : "ACTIVE"}</span></article>; })}</div><button className="cosmic-console-action" onClick={() => selectDestination("deep-field", true)}><Compass size={14} /> Begin deep space initiation <ArrowRight size={12} /></button><button className="cosmic-reset-log" onClick={resetMissionLog}>Reset local mission log</button></div>}

          {activeTab === "systems" && <div className="cosmic-console-body"><div className="cosmic-console-heading"><div><span className="cosmic-console-kicker">STARSHIP STATUS</span><h2>Ship systems</h2></div><span className="cosmic-coordinate-icon"><Activity size={15} /></span></div><div className="cosmic-system-list"><div className="cosmic-system-row"><span><Zap size={13} /> Flight energy <small>gameplay indicator</small></span><b>{energy.toFixed(0)}%</b></div><div className="cosmic-energy-bar"><i style={{ width: `${energy}%` }} /></div><div className="cosmic-system-row"><span><Compass size={13} /> Navigation</span><b className="online">ONLINE</b></div><div className="cosmic-system-row"><span><Radio size={13} /> Science relay</span><b className="online">READY</b></div><div className="cosmic-system-row"><span><Gamepad2 size={13} /> Controller</span><b>{gamepadConnected ? "CONNECTED" : "STANDBY"}</b></div><div className="cosmic-system-row"><span><Volume2 size={13} /> Audio systems</span><b className="offline">NOT INSTALLED</b></div></div><div className="cosmic-system-note"><ShieldCheck size={14} /><p>Ship readouts are game interface indicators. They do not describe real spacecraft telemetry or astronomical measurements.</p></div><div className="cosmic-control-guide"><b>FLIGHT CONTROLS</b><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move · <kbd>Q</kbd>/<kbd>E</kbd> altitude</span><span><kbd>Shift</kbd> or <kbd>Space</kbd> boost · drag to look · click a marker to set course</span><span>Controller: left stick moves, right stick looks, A boosts</span></div></div>}
        </aside>
      </section>

      <section className="cosmic-destination-rail"><div className="cosmic-rail-title"><div><span className="cosmic-console-kicker">KNOWN WAYPOINTS</span><h2>Choose your next horizon</h2></div><span>{destinations.length} DESTINATIONS</span></div><div className="cosmic-destination-cards">{nearbyDestinations.map((destination) => { const locked = destinationLockReason(destination.id, progress); return <button key={destination.id} onClick={() => !locked && selectDestination(destination.id, true)} className={`${selectedId === destination.id ? "selected" : ""} ${locked ? "locked" : ""}`} disabled={Boolean(locked)} title={locked || destination.classification}><span className="cosmic-destination-dot" style={{ backgroundColor: destination.color, boxShadow: `0 0 15px ${destination.color}` }} /><span><b>{destination.shortName}</b><small>{locked || destination.classification}</small></span>{locked ? <ShieldCheck size={13} /> : <ArrowRight size={13} />}</button>; })}</div></section>

      <div className="cosmic-lower-grid"><section className="cosmic-guide-card"><div className="cosmic-guide-icon"><Keyboard size={17} /></div><div><span className="cosmic-console-kicker">HOW TO FLY</span><h2>Take the helm</h2><p>Drag inside the starfield to look around. Use WASD to move, Q/E for altitude and Shift or Space for boost. Select a waypoint or click its marker to set an assisted course. Touch controls move in short steps.</p></div><button onClick={() => setActiveTab("systems")}>View controls <ArrowRight size={12} /></button></section><section className="cosmic-science-card"><div className="cosmic-guide-icon violet"><Telescope size={17} /></div><div><span className="cosmic-console-kicker">SCIENCE STAYS SEPARATE</span><h2>From simulation to observation</h2><p>Catalogued destinations pass their sky coordinates into the existing SPHEREx research flow. Generated scenery is never presented as a NASA observation.</p></div><Link href="/investigate">Open Object Investigator <ArrowRight size={12} /></Link></section></div>
      <footer className="cosmic-footnote"><span><ShieldCheck size={13} /> DESTINATION FACTS LINK TO NASA SCIENCE REFERENCES</span><span>Navigation space, ship motion, and scenery are simulated. Flight log stays in this browser.</span></footer>
    </main>
  </div>;
}
