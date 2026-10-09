import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface CinematicCameraProps {
  scrollProgress: number; // 0.0 to 1.0
  isInteractiveOrbit: boolean;
  mousePos?: { x: number; y: number };
}

// Architectural camera narrative keyframes
// Stably oriented along world axes
const CAMERA_WAYPOINTS = [
  { progress: 0.00, pos: [0.0, 14.5, 0.0], target: [0, 0, 0], fov: 36 },
  { progress: 0.12, pos: [0.0, 13.0, 1.0], target: [0, 0, 0], fov: 38 },
  { progress: 0.24, pos: [-1.2, 4.2, 7.8], target: [-0.5, 0.8, 0], fov: 42 },
  { progress: 0.38, pos: [-3.8, 3.4, 5.6], target: [-1.2, 1.1, -0.4], fov: 45 },
  { progress: 0.50, pos: [4.6, 3.8, 5.2], target: [1.2, 1.2, -0.2], fov: 46 },
  { progress: 0.64, pos: [-1.4, 1.65, 1.2], target: [1.2, 1.5, -0.5], fov: 52 },
  { progress: 0.76, pos: [2.2, 1.65, 0.2], target: [4.0, 1.5, -1.8], fov: 54 },
  { progress: 0.88, pos: [-0.2, 5.2, 8.4], target: [0, 1.2, 0], fov: 44 },
  { progress: 1.00, pos: [-0.6, 1.62, 1.4], target: [0.4, 1.55, -1.2], fov: 50 },
];

export const CinematicCamera: React.FC<CinematicCameraProps> = ({
  scrollProgress,
  isInteractiveOrbit,
}) => {
  const { camera } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 14.5, 0.0));
  const currentTarget = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    if (isInteractiveOrbit) {
      // In interactive orbit mode, OrbitControls manages the camera
      return;
    }

    const clamped = Math.max(0, Math.min(1, scrollProgress));

    // Find segment between waypoints
    let p0 = CAMERA_WAYPOINTS[0];
    let p1 = CAMERA_WAYPOINTS[1];

    for (let i = 0; i < CAMERA_WAYPOINTS.length - 1; i++) {
      if (clamped >= CAMERA_WAYPOINTS[i].progress && clamped <= CAMERA_WAYPOINTS[i + 1].progress) {
        p0 = CAMERA_WAYPOINTS[i];
        p1 = CAMERA_WAYPOINTS[i + 1];
        break;
      }
    }

    const span = p1.progress - p0.progress;
    const localT = span > 0 ? (clamped - p0.progress) / span : 0;
    // Smooth cinematic easing
    const easedT = localT * localT * (3 - 2 * localT);

    // Precise stable position interpolation (NO cursor parallax to avoid unwanted spinning/rotation)
    const targetX = p0.pos[0] + (p1.pos[0] - p0.pos[0]) * easedT;
    const targetY = p0.pos[1] + (p1.pos[1] - p0.pos[1]) * easedT;
    const targetZ = p0.pos[2] + (p1.pos[2] - p0.pos[2]) * easedT;
    const desiredPos = new THREE.Vector3(targetX, targetY, targetZ);

    const lookX = p0.target[0] + (p1.target[0] - p0.target[0]) * easedT;
    const lookY = p0.target[1] + (p1.target[1] - p0.target[1]) * easedT;
    const lookZ = p0.target[2] + (p1.target[2] - p0.target[2]) * easedT;
    const desiredTarget = new THREE.Vector3(lookX, lookY, lookZ);

    // Smooth camera damping
    const dampFactor = Math.min(1, delta * 4.5);
    currentPos.current.lerp(desiredPos, dampFactor);
    currentTarget.current.lerp(desiredTarget, dampFactor);

    // Camera up-vector blend:
    // Top-down (clamped < 0.15) must use (0, 0, -1) to prevent gimbal lock along the Y axis.
    // Perspective (clamped >= 0.22) smoothly transitions to standard (0, 1, 0).
    const upBlend = Math.min(1, Math.max(0, (clamped - 0.08) / 0.14));
    const targetUp = new THREE.Vector3(0, upBlend, -(1 - upBlend)).normalize();
    camera.up.copy(targetUp);

    camera.position.copy(currentPos.current);
    camera.lookAt(currentTarget.current);

    // Interpolate field of view
    const targetFov = p0.fov + (p1.fov - p0.fov) * easedT;
    if ((camera as THREE.PerspectiveCamera).fov) {
      const pCam = camera as THREE.PerspectiveCamera;
      pCam.fov = THREE.MathUtils.lerp(pCam.fov, targetFov, dampFactor);
      pCam.updateProjectionMatrix();
    }
  });

  return null;
};
