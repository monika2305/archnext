import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ROOMS, WALL_SEGMENTS, DIMENSION_ANNOTATIONS, VIDEO_FRAMES, GENERATED_SURFACE_POINTS } from '../../data/architecturalFloorPlan';
import type { ProvenanceType } from '../../types/reconstruction';

interface ArchitecturalSpaceProps {
  scrollProgress: number; // 0 to 1
  provenanceMode: boolean; // whether trust overlay is active
  fix2BuildOffset: number; // interactive adjustment of uncertain wall
  ablationStep: number;    // 0: Baseline, 1: +Topology, 2: +Scale, 3: Full Pipeline
  activeLayer: 'all' | 'observed' | 'inferred' | 'points';
}

export const ArchitecturalSpace: React.FC<ArchitecturalSpaceProps> = ({
  scrollProgress,
  provenanceMode,
  fix2BuildOffset,
  ablationStep,
  activeLayer,
}) => {
  // References
  const pointsRef = useRef<THREE.Points>(null);
  const trajectoryLineRef = useRef<THREE.Line>(null);
  const wallGroupRef = useRef<THREE.Group>(null);

  // Phases derived continuously from scroll progress
  // 0.00 - 0.15: Blueprint drafting phase
  // 0.15 - 0.32: Wall extrusion phase (0.0 to 1.0)
  // 0.32 - 0.44: ScaleLock & Topology phase
  // 0.44 - 0.56: Trust / Provenance inspection
  // 0.56 - 0.72: Video Trajectory & Point Cloud
  // 0.72 - 0.84: Inferred Unseen Room Completion
  // 0.84 - 0.93: Convergence
  // 0.93 - 1.00: Final architectural interior

  const wallExtrusionProgress = useMemo(() => {
    if (scrollProgress < 0.12) return 0.04;
    if (scrollProgress < 0.30) {
      const p = (scrollProgress - 0.12) / (0.30 - 0.12);
      return Math.min(1, Math.max(0.04, p));
    }
    return 1.0;
  }, [scrollProgress]);

  const floorSolidifyProgress = useMemo(() => {
    if (scrollProgress < 0.18) return 0.2;
    if (scrollProgress < 0.30) return (scrollProgress - 0.18) / (0.30 - 0.18);
    return 1.0;
  }, [scrollProgress]);

  const doorWindowProgress = useMemo(() => {
    if (scrollProgress < 0.24) return 0;
    if (scrollProgress < 0.34) return (scrollProgress - 0.24) / (0.34 - 0.24);
    return 1.0;
  }, [scrollProgress]);

  const scaleLockProgress = useMemo(() => {
    // scale rotates upright between 0.28 and 0.42
    if (scrollProgress < 0.28) return 0;
    if (scrollProgress < 0.42) return (scrollProgress - 0.28) / (0.42 - 0.28);
    return 1.0;
  }, [scrollProgress]);

  const topologySnapProgress = useMemo(() => {
    // topology corrects between 0.34 and 0.44
    if (ablationStep === 0) return 0; // baseline has error
    if (ablationStep >= 1) return 1.0;
    if (scrollProgress < 0.33) return 0;
    if (scrollProgress < 0.44) return (scrollProgress - 0.33) / (0.44 - 0.33);
    return 1.0;
  }, [scrollProgress, ablationStep]);

  const videoCloudProgress = useMemo(() => {
    // point cloud active between 0.54 and 0.76
    if (scrollProgress < 0.52) return 0;
    if (scrollProgress < 0.76) {
      return (scrollProgress - 0.52) / (0.76 - 0.52);
    }
    if (scrollProgress < 0.88) {
      return 1.0 - (scrollProgress - 0.76) / (0.88 - 0.76);
    }
    return 0;
  }, [scrollProgress]);

  const inferredRoomProgress = useMemo(() => {
    // inferred pantry room emerges progressively in Mode B / trust
    if (scrollProgress < 0.42) return 0.3;
    if (scrollProgress < 0.72) return 0.6;
    if (scrollProgress < 0.84) return 0.6 + 0.4 * ((scrollProgress - 0.72) / (0.84 - 0.72));
    return 1.0;
  }, [scrollProgress]);

  // Materials palette (Believable architectural finishes)
  const materials = useMemo(() => {
    return {
      limestonePlaster: new THREE.MeshStandardMaterial({
        color: '#D7C9A8',
        roughness: 0.88,
        metalness: 0.05,
      }),
      architecturalWall: new THREE.MeshStandardMaterial({
        color: '#E9E2D0',
        roughness: 0.85,
        metalness: 0.02,
      }),
      darkWallCore: new THREE.MeshStandardMaterial({
        color: '#2A2824',
        roughness: 0.9,
      }),
      woodParquet: new THREE.MeshStandardMaterial({
        color: '#8A6D4B',
        roughness: 0.65,
        metalness: 0.05,
      }),
      concreteFloor: new THREE.MeshStandardMaterial({
        color: '#524F47',
        roughness: 0.92,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: '#E2E8F0',
        transparent: true,
        opacity: 0.4,
        roughness: 0.1,
        transmission: 0.9,
        thickness: 0.5,
      }),
      doorWood: new THREE.MeshStandardMaterial({
        color: '#5C4431',
        roughness: 0.7,
      }),
      // Provenance materials
      observedMaterial: new THREE.MeshStandardMaterial({
        color: '#E9E2D0',
        roughness: 0.75,
        metalness: 0.1,
      }),
      inferredMaterial: new THREE.MeshStandardMaterial({
        color: '#C56A45', // Oxidized Copper
        roughness: 0.45,
        metalness: 0.25,
        transparent: true,
        opacity: 0.82,
      }),
      uncertainMaterial: new THREE.MeshStandardMaterial({
        color: '#85785C',
        roughness: 0.85,
        transparent: true,
        opacity: 0.7,
      }),
      wireframeBlueprint: new THREE.LineBasicMaterial({
        color: '#A9A397',
        linewidth: 1,
        transparent: true,
        opacity: 0.45,
      }),
      tealAccent: new THREE.LineBasicMaterial({
        color: '#3F7C78',
        linewidth: 2,
      }),
      copperAccent: new THREE.LineBasicMaterial({
        color: '#C56A45',
        linewidth: 2,
      }),
    };
  }, []);

  // Geometry for Point Cloud
  const pointCloudGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(GENERATED_SURFACE_POINTS.length * 3);
    const colors = new Float32Array(GENERATED_SURFACE_POINTS.length * 3);
    const cObserved = new THREE.Color('#3F7C78');
    const cHighlight = new THREE.Color('#E9E2D0');

    GENERATED_SURFACE_POINTS.forEach((pt, i) => {
      positions[i * 3] = pt[0];
      positions[i * 3 + 1] = pt[1];
      positions[i * 3 + 2] = pt[2];

      const mix = Math.random() > 0.8 ? cHighlight : cObserved;
      colors[i * 3] = mix.r;
      colors[i * 3 + 1] = mix.g;
      colors[i * 3 + 2] = mix.b;
    });

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
  }, []);

  // Video Trajectory Spline Curve
  const trajectoryPoints = useMemo(() => {
    const pts = VIDEO_FRAMES.map(f => new THREE.Vector3(...f.position));
    const curve = new THREE.CatmullRomCurve3(pts);
    return curve.getPoints(50);
  }, []);

  const trajectoryGeometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(trajectoryPoints);
  }, [trajectoryPoints]);


  return (
    <group>
      {/* 2D Blueprint Drafting Plane on Ground (y = -0.01) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[22, 16]} />
        <meshStandardMaterial
          color="#161513"
          roughness={0.98}
          metalness={0.0}
        />
      </mesh>

      {/* Blueprint Grid Lines & Drafting Annotations */}
      <gridHelper
        args={[22, 44, '#3A3832', '#1E1D1A']}
        position={[0, 0.005, 0]}
      />

      {/* Room Floors */}
      {ROOMS.map((room) => {
        // Skip inferred room if not in that layer
        if (activeLayer === 'observed' && room.provenance !== 'observed') return null;
        if (activeLayer === 'inferred' && room.provenance !== 'inferred') return null;

        const isRoomInferred = room.provenance === 'inferred';
        const opacity = isRoomInferred ? inferredRoomProgress : floorSolidifyProgress;

        let mat = materials.limestonePlaster;
        if (room.floorMaterial === 'parquet') mat = materials.woodParquet;
        if (room.floorMaterial === 'concrete') mat = materials.concreteFloor;
        if (provenanceMode) {
          if (room.provenance === 'inferred') mat = materials.inferredMaterial;
          else if (room.provenance === 'uncertain') mat = materials.uncertainMaterial;
          else mat = materials.observedMaterial;
        }

        return (
          <group key={room.id} position={[room.x, 0.01, room.z]}>
            {/* Floor Slab with Thickness */}
            <mesh receiveShadow position={[0, 0.02, 0]}>
              <boxGeometry args={[room.width, 0.04, room.depth]} />
              <primitive object={mat} attach="material" transparent opacity={opacity} />
            </mesh>

            {/* Perimeter Blueprint Boundary Lines in 2D */}
            <lineSegments position={[0, 0.045, 0]}>
              <edgesGeometry args={[new THREE.BoxGeometry(room.width, 0.01, room.depth)]} />
              <lineBasicMaterial
                color={room.provenance === 'inferred' ? '#C56A45' : '#D7C9A8'}
                transparent
                opacity={0.65}
              />
            </lineSegments>
          </group>
        );
      })}

      {/* Walls Extruding Vertically */}
      <group ref={wallGroupRef}>
        {WALL_SEGMENTS.map((wall) => {
          if (activeLayer === 'observed' && wall.provenance !== 'observed') return null;
          if (activeLayer === 'inferred' && wall.provenance !== 'inferred') return null;

          const isUncertainAlcove = wall.roomId === 'uncertain_alcove';
          const isPantryInferred = wall.roomId === 'inferred_pantry';

          // Apply TopologyGuard snap or Fix2Build offset
          let effectiveStartX = wall.start[0];
          let effectiveStartZ = wall.start[1];
          let effectiveEndX = wall.end[0];
          let effectiveEndZ = wall.end[1];

          if (isUncertainAlcove && wall.uncertaintyOffset) {
            // Misalignment exists in baseline (ablationStep 0) or unverified scroll
            const offset = (1 - topologySnapProgress) * wall.uncertaintyOffset + fix2BuildOffset;
            effectiveStartZ += offset;
            effectiveEndZ += offset;
          }

          // Calculate wall length and angle
          const dx = effectiveEndX - effectiveStartX;
          const dz = effectiveEndZ - effectiveStartZ;
          const length = Math.sqrt(dx * dx + dz * dz);
          const angle = Math.atan2(dz, dx);
          const centerX = (effectiveStartX + effectiveEndX) / 2;
          const centerZ = (effectiveStartZ + effectiveEndZ) / 2;

          // Wall height extrudes with scroll
          const nominalHeight = wall.height;
          const currentHeight = Math.max(0.08, nominalHeight * wallExtrusionProgress);
          const yPos = currentHeight / 2;

          // Select material based on provenance mode
          let wallMat = materials.architecturalWall;
          if (provenanceMode) {
            if (wall.provenance === 'inferred') wallMat = materials.inferredMaterial;
            else if (wall.provenance === 'uncertain') wallMat = materials.uncertainMaterial;
            else wallMat = materials.observedMaterial;
          } else if (isPantryInferred) {
            wallMat = materials.inferredMaterial;
          }

          return (
            <group
              key={wall.id}
              position={[centerX, yPos, centerZ]}
              rotation={[0, -angle, 0]}
            >
              {/* Main Solid Wall Body with Openings */}
              {(!wall.openings || wall.openings.length === 0) ? (
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[length, currentHeight, wall.thickness]} />
                  <primitive object={wallMat} attach="material" />
                </mesh>
              ) : (
                // Wall with Door or Window cutout
                <group>
                  {wall.openings.map((op) => {
                    const openingOffset = (op.positionAlongWall - 0.5) * length;
                    const halfLeft = (length - op.width) / 2;
                    const leftCenterX = -length / 2 + halfLeft / 2;
                    const rightCenterX = length / 2 - halfLeft / 2;

                    return (
                      <group key={op.id}>
                        {/* Left wall segment */}
                        <mesh position={[leftCenterX, 0, 0]} castShadow receiveShadow>
                          <boxGeometry args={[halfLeft, currentHeight, wall.thickness]} />
                          <primitive object={wallMat} attach="material" />
                        </mesh>

                        {/* Right wall segment */}
                        <mesh position={[rightCenterX, 0, 0]} castShadow receiveShadow>
                          <boxGeometry args={[halfLeft, currentHeight, wall.thickness]} />
                          <primitive object={wallMat} attach="material" />
                        </mesh>

                        {/* Lintel / Header above opening */}
                        {currentHeight > op.height && (
                          <mesh
                            position={[
                              openingOffset,
                              currentHeight / 2 - (currentHeight - op.height) / 2,
                              0,
                            ]}
                            castShadow
                            receiveShadow
                          >
                            <boxGeometry
                              args={[op.width, currentHeight - op.height, wall.thickness]}
                            />
                            <primitive object={wallMat} attach="material" />
                          </mesh>
                        )}

                        {/* Window Sill underneath window */}
                        {op.type === 'window' && (
                          <mesh
                            position={[
                              openingOffset,
                              -currentHeight / 2 + (op.sillHeight * wallExtrusionProgress) / 2,
                              0,
                            ]}
                            castShadow
                            receiveShadow
                          >
                            <boxGeometry
                              args={[op.width, op.sillHeight * wallExtrusionProgress, wall.thickness]}
                            />
                            <primitive object={wallMat} attach="material" />
                          </mesh>
                        )}

                        {/* Physical Door Panel Emerging at Phase 5 */}
                        {op.type === 'door' && doorWindowProgress > 0 && (
                          <mesh
                            position={[
                              openingOffset + (op.width * 0.35 * doorWindowProgress),
                              -currentHeight / 2 + (op.height * 0.5),
                              wall.thickness * 0.15,
                            ]}
                            rotation={[0, 0.45 * doorWindowProgress, 0]}
                            castShadow
                          >
                            <boxGeometry args={[op.width * 0.96, op.height * 0.98, 0.05]} />
                            <primitive object={materials.doorWood} attach="material" />
                          </mesh>
                        )}

                        {/* Physical Glass Window Pane at Phase 6 */}
                        {op.type === 'window' && doorWindowProgress > 0 && (
                          <mesh
                            position={[
                              openingOffset,
                              -currentHeight / 2 + (op.sillHeight + op.height * 0.5),
                              0,
                            ]}
                          >
                            <boxGeometry args={[op.width * 0.98, op.height * 0.95, 0.03]} />
                            <primitive object={materials.glass} attach="material" />
                          </mesh>
                        )}
                      </group>
                    );
                  })}
                </group>
              )}

              {/* Precise Architectural Corner Edge Outlines */}
              <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(length, currentHeight, wall.thickness)]} />
                <lineBasicMaterial
                  color={
                    wall.provenance === 'inferred'
                      ? '#C56A45'
                      : wall.provenance === 'uncertain'
                      ? '#D7C9A8'
                      : '#3A3832'
                  }
                  transparent
                  opacity={0.4}
                />
              </lineSegments>
            </group>
          );
        })}
      </group>

      {/* Metric Dimension Annotations (ScaleLock in 3D) */}
      {DIMENSION_ANNOTATIONS.map((dim) => {
        // Dimension lines rotate upright from floor to vertical wall plane
        const rotationX = scaleLockProgress * (Math.PI / 2);
        const yHeight = scaleLockProgress * (dim.end[1] || 1.4);

        const p1 = new THREE.Vector3(dim.start[0], dim.start[1], dim.start[2]);
        const p2 = new THREE.Vector3(dim.end[0], yHeight, dim.end[2]);
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const length = p1.distanceTo(p2);

        return (
          <group key={dim.id}>
            {/* Visual dimension line connecting points */}
            <line>
              <bufferGeometry
                attach="geometry"
                {...new THREE.BufferGeometry().setFromPoints([p1, p2])}
              />
              <lineBasicMaterial
                color={scaleLockProgress > 0.6 ? '#3F7C78' : '#A9A397'}
                linewidth={1.5}
              />
            </line>

            {/* Dimension End Tick Marks */}
            <mesh position={[p1.x, p1.y, p1.z]}>
              <sphereGeometry args={[0.035, 12, 12]} />
              <meshBasicMaterial color="#3F7C78" />
            </mesh>
            <mesh position={[p2.x, p2.y, p2.z]}>
              <sphereGeometry args={[0.035, 12, 12]} />
              <meshBasicMaterial color="#3F7C78" />
            </mesh>
          </group>
        );
      })}

      {/* Mode B: Walkthrough Video Camera Trajectory Spline & Frustums */}
      {videoCloudProgress > 0.05 && (
        <group>
          {/* Smooth camera path trajectory curve */}
          <primitive object={new THREE.Line(trajectoryGeometry, materials.copperAccent)} />

          {/* Keyframe Frustums for FRAME 001, 017, 032, 048 */}
          {VIDEO_FRAMES.map((kf, i) => (
            <group key={kf.id} position={kf.position} rotation={kf.rotation}>
              {/* Camera sensor body */}
              <mesh>
                <boxGeometry args={[0.16, 0.1, 0.22]} />
                <meshStandardMaterial color="#3A3832" roughness={0.5} />
              </mesh>
              {/* Lens cone frustum projecting outward */}
              <mesh position={[0, 0, -0.22]} rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.18, 0.32, 4]} />
                <meshBasicMaterial
                  color="#C56A45"
                  wireframe
                  transparent
                  opacity={0.6 + i * 0.1}
                />
              </mesh>
            </group>
          ))}

          {/* Spatial Point Cloud (Computer Vision surface samples) */}
          <points ref={pointsRef} geometry={pointCloudGeometry}>
            <pointsMaterial
              size={0.045}
              vertexColors
              transparent
              opacity={Math.min(1, videoCloudProgress * 1.5)}
              sizeAttenuation
            />
          </points>
        </group>
      )}

      {/* Inferred Unseen Region Volume (Oxidized Copper Holographic Box) */}
      {provenanceMode && (
        <group position={[4.0, 1.4, -1.8]}>
          <mesh>
            <boxGeometry args={[2.4, 2.78, 1.8]} />
            <meshStandardMaterial
              color="#C56A45"
              transparent
              opacity={0.18}
              roughness={0.2}
            />
          </mesh>
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(2.4, 2.78, 1.8)]} />
            <lineBasicMaterial color="#C56A45" transparent opacity={0.6} />
          </lineSegments>
        </group>
      )}
    </group>
  );
};
