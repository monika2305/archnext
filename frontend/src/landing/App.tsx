import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ReconstructionCanvas } from './components/canvas/ReconstructionCanvas';
import { BlueprintOverlay } from './components/blueprint/BlueprintOverlay';
import { Navbar } from './components/ui/Navbar';
import { ScrollStoryOverlay } from './components/ui/ScrollStoryOverlay';
import { ExploreModal } from './components/ui/ExploreModal';
import './landing.css';

interface LandingAppProps {
  onNavigate?: (route: string) => void;
}

export const App: React.FC<LandingAppProps> = ({ onNavigate }) => {
  // Global Reconstruction Engine State
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [provenanceMode, setProvenanceMode] = useState<boolean>(false);
  const [fix2BuildOffset, setFix2BuildOffset] = useState<number>(0.28);
  const [ablationStep, setAblationStep] = useState<number>(3); // 3 = full pipeline
  const [activeLayer, setActiveLayer] = useState<'all' | 'observed' | 'inferred' | 'points'>('all');
  const [isInteractiveOrbit, setIsInteractiveOrbit] = useState<boolean>(false);
  const [exploreModalOpen, setExploreModalOpen] = useState<boolean>(false);
  const [selectedExploreMode, setSelectedExploreMode] = useState<'a' | 'b' | undefined>(undefined);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const ticking = useRef<boolean>(false);

  // Compute active section name based on progress
  const activeSection = 
    scrollProgress < 0.20 ? 'hero' :
    scrollProgress < 0.32 ? 'reconstruction' :
    scrollProgress < 0.52 ? 'mode-a' :
    scrollProgress < 0.76 ? 'mode-b' :
    scrollProgress < 0.90 ? 'research' : 'final';

  // Handle Scroll Progress smoothly
  const handleScroll = useCallback(() => {
    if (!ticking.current) {
      window.requestAnimationFrame(() => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? Math.min(1, Math.max(0, scrollTop / docHeight)) : 0;
        setScrollProgress(progress);
        ticking.current = false;
      });
      ticking.current = true;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Handle Mouse Coordinates for subtle physical parallax
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const normX = (e.clientX / window.innerWidth) * 2 - 1;
      const normY = -(e.clientY / window.innerHeight) * 2 + 1;
      setMousePos({ x: normX, y: normY });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Jump to specific scroll progress smoothly
  const jumpToProgress = (target: number) => {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const targetY = target * docHeight;
    window.scrollTo({
      top: targetY,
      behavior: 'smooth',
    });
  };

  // Open Explore Modal
  const handleOpenExploreModal = (mode?: 'a' | 'b') => {
    setSelectedExploreMode(mode);
    setExploreModalOpen(true);
  };

  return (
    <div ref={containerRef} className="archnext-landing relative min-h-screen bg-[#11110F] text-[#E9E2D0] selection:bg-[#C56A45] selection:text-[#11110F]">
      {/* Fixed Sticky Architectural 3D Reconstruction Canvas */}
      <div className="fixed inset-0 w-full h-screen z-0 pointer-events-auto">
        <ReconstructionCanvas
          scrollProgress={scrollProgress}
          provenanceMode={provenanceMode}
          fix2BuildOffset={fix2BuildOffset}
          ablationStep={ablationStep}
          activeLayer={activeLayer}
          isInteractiveOrbit={isInteractiveOrbit}
          mousePos={mousePos}
        />
      </div>

      {/* Seamless Left Ambient Falloff (Zero boxes — ensures text is 100% visible against any 3D angle) */}
      <div className="fixed inset-0 pointer-events-none z-10 bg-gradient-to-r from-[#11110F]/90 via-[#11110F]/45 to-transparent w-full lg:w-2/3" />

      {/* 2D Architectural Blueprint Drafting Layer */}
      <BlueprintOverlay
        scrollProgress={scrollProgress}
        fix2BuildOffset={fix2BuildOffset}
        onFix2BuildChange={setFix2BuildOffset}
      />

      {/* Top Architectural Navigation Bar with Minimal Controls */}
      <Navbar
        onJumpToSection={jumpToProgress}
        activeSection={activeSection}
        provenanceMode={provenanceMode}
        onToggleProvenance={() => setProvenanceMode(prev => !prev)}
        isInteractiveOrbit={isInteractiveOrbit}
        onToggleOrbit={() => setIsInteractiveOrbit(prev => !prev)}
        onOpenExplore={() => handleOpenExploreModal()}
        onNavigate={onNavigate}
      />

      {/* Continuous Scroll Narrative Storyline */}
      <main className="relative z-20 pointer-events-none">
        <ScrollStoryOverlay
          scrollProgress={scrollProgress}
          fix2BuildOffset={fix2BuildOffset}
          onFix2BuildChange={setFix2BuildOffset}
          ablationStep={ablationStep}
          onAblationStepChange={setAblationStep}
          onOpenExploreModal={handleOpenExploreModal}
          onScrollToProgress={jumpToProgress}
        />
      </main>

      {/* Routes Gateway Modal (/mode-a & /mode-b) */}
      <ExploreModal
        isOpen={exploreModalOpen}
        onClose={() => setExploreModalOpen(false)}
        selectedMode={selectedExploreMode}
        onNavigate={onNavigate}
      />
    </div>
  );
};

export default App;
