import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { ArchitecturalSpace } from './ArchitecturalSpace';
import { CinematicCamera } from './CinematicCamera';

interface ReconstructionCanvasProps {
  scrollProgress: number;
  provenanceMode: boolean;
  fix2BuildOffset: number;
  ablationStep: number;
  activeLayer: 'all' | 'observed' | 'inferred' | 'points';
  isInteractiveOrbit: boolean;
  mousePos: { x: number; y: number };
}

export const ReconstructionCanvas: React.FC<ReconstructionCanvasProps> = ({
  scrollProgress,
  provenanceMode,
  fix2BuildOffset,
  ablationStep,
  activeLayer,
  isInteractiveOrbit,
  mousePos,
}) => {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-auto">
      <Canvas
        shadows
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          alpha: false,
        }}
        camera={{
          position: [0, 14.5, 0.01],
          fov: 36,
          near: 0.1,
          far: 60,
        }}
        style={{ background: '#11110F' }}
      >
        <Suspense fallback={null}>
          {/* Subtle architectural atmosphere fog */}
          <fog attach="fog" args={['#11110F', 8, 38]} />

          {/* Balanced studio / architectural daylighting */}
          <ambientLight intensity={0.55} color="#E9E2D0" />
          
          <directionalLight
            position={[8, 14, 6]}
            intensity={1.15}
            color="#FFF7ED"
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
            shadow-camera-near={0.5}
            shadow-camera-far={35}
            shadow-camera-left={-10}
            shadow-camera-right={10}
            shadow-camera-top={10}
            shadow-camera-bottom={-10}
            shadow-bias={-0.0005}
          />

          {/* Soft fill light from opposing angle */}
          <directionalLight
            position={[-7, 8, -6]}
            intensity={0.35}
            color="#3F7C78"
          />

          {/* Soft contact ground shadow for realistic architectural grounding */}
          <ContactShadows
            position={[0, 0.002, 0]}
            opacity={0.65}
            scale={22}
            blur={1.8}
            far={4.5}
            color="#0A0A08"
          />

          {/* Camera Storytelling System */}
          <CinematicCamera
            scrollProgress={scrollProgress}
            isInteractiveOrbit={isInteractiveOrbit}
            mousePos={mousePos}
          />

          {/* Interactive Inspection Mode */}
          {isInteractiveOrbit && (
            <OrbitControls
              enablePan={true}
              enableZoom={true}
              enableRotate={true}
              maxPolarAngle={Math.PI / 2 - 0.02}
              minDistance={1.5}
              maxDistance={25}
            />
          )}

          {/* Physical Architectural Model */}
          <ArchitecturalSpace
            scrollProgress={scrollProgress}
            provenanceMode={provenanceMode}
            fix2BuildOffset={fix2BuildOffset}
            ablationStep={ablationStep}
            activeLayer={activeLayer}
          />
        </Suspense>
      </Canvas>
    </div>
  );
};
