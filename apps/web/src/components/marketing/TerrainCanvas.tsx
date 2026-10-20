import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * The hero terrain: one wireframe elevation mesh in mint, drawn over the
 * photo, breathing slowly at rest, tilting a degree or two toward the cursor,
 * brightening where the pointer passes, and lifting away on the first scroll.
 *
 * Loaded lazily by HeroSection and only when terrainGate allows it. The
 * static SVG ridge underneath stays in the DOM the whole time, so if this
 * module fails to load or WebGL dies mid-session the hero still has its
 * silhouette.
 */

const ROWS = 48;
const COLS = 160;
const PLANE_WIDTH = 24;
const PLANE_DEPTH = 10;
const MAX_DPR = 1.5;
const MINT = new THREE.Color('#9CB0A4');

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec2 uPointer;
  attribute float aDepth;
  varying float vAlpha;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    v += 0.55 * noise(p);
    v += 0.30 * noise(p * 2.1 + 7.3);
    v += 0.15 * noise(p * 4.3 + 19.1);
    return v;
  }

  void main() {
    vec3 p = position;
    float t = uTime * 0.04;
    float relief = fbm(vec2(p.x * 0.28 + t, p.y * 0.42 - t * 0.5)) - 0.5;
    float nearness = aDepth;
    float height = relief * (0.35 + nearness * 2.2);
    p.z += height + uProgress * 1.6;

    float d = distance(p.xy, uPointer);
    float glow = smoothstep(2.4, 0.0, d) * 0.45;
    vAlpha = (0.1 + nearness * 0.5 + glow) * (1.0 - uProgress);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
  }
`;

function buildRidgeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const depths: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < ROWS; r++) {
    const t = r / (ROWS - 1);
    const y = -PLANE_DEPTH / 2 + t * PLANE_DEPTH;
    for (let c = 0; c < COLS; c++) {
      const x = -PLANE_WIDTH / 2 + (c / (COLS - 1)) * PLANE_WIDTH;
      positions.push(x, y, 0);
      depths.push(t);
      if (c > 0) {
        const i = r * COLS + c;
        indices.push(i - 1, i);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  return geometry;
}

export default function TerrainCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, -9.5, 4.2);
    camera.rotation.set(THREE.MathUtils.degToRad(68), 0, THREE.MathUtils.degToRad(2));

    const uniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uPointer: { value: new THREE.Vector2(100, 100) },
      uColor: { value: MINT },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });

    const geometry = buildRidgeGeometry();
    const lines = new THREE.LineSegments(geometry, material);
    scene.add(lines);

    const baseRotation = camera.rotation.clone();
    const targetTilt = new THREE.Vector2(0, 0);
    const currentTilt = new THREE.Vector2(0, 0);
    const targetPointer = new THREE.Vector2(100, 100);
    let visible = true;
    let frame = 0;
    const startedAt = performance.now();

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const hero = host.parentElement ?? host;
    const onPointerMove = (event: PointerEvent) => {
      const rect = hero.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      const ny = (event.clientY - rect.top) / rect.height - 0.5;
      targetTilt.set(nx, ny);
      targetPointer.set(nx * PLANE_WIDTH, -(ny - 0.3) * PLANE_DEPTH);
    };
    const onPointerLeave = () => {
      targetTilt.set(0, 0);
      targetPointer.set(100, 100);
    };
    hero.addEventListener('pointermove', onPointerMove);
    hero.addEventListener('pointerleave', onPointerLeave);

    const onScroll = () => {
      const progress = Math.min(1, Math.max(0, window.scrollY / window.innerHeight));
      uniforms.uProgress.value = progress;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const visibility = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !frame) frame = requestAnimationFrame(tick);
      },
      { threshold: 0 },
    );
    visibility.observe(host);

    function tick() {
      frame = 0;
      if (!visible) return;
      uniforms.uTime.value = (performance.now() - startedAt) / 1000;
      currentTilt.lerp(targetTilt, 0.06);
      uniforms.uPointer.value.lerp(targetPointer, 0.08);
      camera.rotation.x = baseRotation.x + THREE.MathUtils.degToRad(-1.5) * currentTilt.y;
      camera.rotation.y = THREE.MathUtils.degToRad(1.5) * currentTilt.x;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      visibility.disconnect();
      observer.disconnect();
      hero.removeEventListener('pointermove', onPointerMove);
      hero.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', onScroll);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} className="lp-hero__terrain" aria-hidden="true" data-testid="hero-terrain" />;
}
