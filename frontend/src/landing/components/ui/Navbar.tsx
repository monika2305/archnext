import React from 'react';
import { Layers, Compass, ArrowRight } from 'lucide-react';

interface NavbarProps {
  onJumpToSection: (progress: number) => void;
  activeSection: string;
  provenanceMode: boolean;
  onToggleProvenance: () => void;
  isInteractiveOrbit: boolean;
  onToggleOrbit: () => void;
  onOpenExplore?: () => void;
  onNavigate?: (route: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onJumpToSection,
  activeSection,
  provenanceMode,
  onToggleProvenance,
  isInteractiveOrbit,
  onToggleOrbit,
  onOpenExplore,
  onNavigate,
}) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 pointer-events-none px-5 py-4 md:px-10 flex justify-between items-center border-b border-[#3A3832]/25 backdrop-blur-md bg-[#11110F]/70">
      {/* Brand logo & tagline */}
      <div className="pointer-events-auto flex items-center gap-3">
        <button
          onClick={() => onJumpToSection(0)}
          className="text-left group flex items-center gap-2.5 focus:outline-none"
        >
          <div className="w-6 h-6 border-2 border-[#E9E2D0] flex items-center justify-center transition-transform group-hover:rotate-45 duration-300">
            <div className="w-2 h-2 bg-[#C56A45]" />
          </div>
          <span className="font-unbounded font-black tracking-wider text-base md:text-lg text-[#E9E2D0]">
            ARCHNEXT
          </span>
        </button>
        <span className="hidden lg:inline text-[10px] font-mono tracking-widest text-[#A9A397] pl-3 border-l border-[#3A3832]">
          SPATIAL RECONSTRUCTION PLATFORM
        </span>
      </div>

      {/* Navigation Links with Fun Dynamic Fonts */}
      <nav className="pointer-events-auto hidden md:flex items-center gap-7 text-xs font-mono tracking-widest text-[#A9A397]">
        <button
          onClick={() => onJumpToSection(0.20)}
          className={`transition-colors hover:text-[#E9E2D0] ${
            activeSection === 'reconstruction' ? 'text-[#E9E2D0] font-bold underline underline-offset-4' : ''
          }`}
        >
          RECONSTRUCTION
        </button>
        <button
          onClick={() => onJumpToSection(0.32)}
          className={`transition-colors hover:text-[#E9E2D0] ${
            activeSection === 'mode-a' ? 'text-[#E9E2D0] font-bold underline underline-offset-4' : ''
          }`}
        >
          01 / BLUEPRINT
        </button>
        <button
          onClick={() => onJumpToSection(0.58)}
          className={`transition-colors hover:text-[#E9E2D0] ${
            activeSection === 'mode-b' ? 'text-[#E9E2D0] font-bold underline underline-offset-4' : ''
          }`}
        >
          02 / VIDEO
        </button>
        <button
          onClick={() => onJumpToSection(0.85)}
          className={`transition-colors hover:text-[#E9E2D0] ${
            activeSection === 'research' ? 'text-[#E9E2D0] font-bold underline underline-offset-4' : ''
          }`}
        >
          RESEARCH
        </button>
      </nav>

      {/* Right Actions: Minimal Clean Controls + Explore */}
      <div className="pointer-events-auto flex items-center gap-2 md:gap-3">
        {/* Minimal Provenance Toggle */}
        <button
          onClick={onToggleProvenance}
          title="Toggle Observed vs Inferred view"
          className={`px-3 py-1.5 border text-[11px] font-mono transition-colors flex items-center gap-1.5 ${
            provenanceMode
              ? 'border-[#C56A45] bg-[#C56A45]/20 text-[#E9E2D0] font-semibold'
              : 'border-[#3A3832] text-[#A9A397] hover:text-[#E9E2D0]'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-[#C56A45]" />
          <span className="hidden sm:inline">TRUST</span>
        </button>

        {/* Minimal 3D Orbit Toggle */}
        <button
          onClick={onToggleOrbit}
          title="Toggle free 3D camera orbit"
          className={`px-3 py-1.5 border text-[11px] font-mono transition-colors flex items-center gap-1.5 ${
            isInteractiveOrbit
              ? 'border-[#3F7C78] bg-[#3F7C78]/20 text-[#E9E2D0] font-semibold'
              : 'border-[#3A3832] text-[#A9A397] hover:text-[#E9E2D0]'
          }`}
        >
          <Compass className="w-3.5 h-3.5 text-[#3F7C78]" />
          <span className="hidden sm:inline">
            {isInteractiveOrbit ? 'ORBIT' : '3D'}
          </span>
        </button>

        {/* Explore Button */}
        <button
          onClick={() => (onOpenExplore ? onOpenExplore() : onJumpToSection(0.96))}
          className="px-4 py-1.5 text-xs font-bricolage font-bold tracking-wider uppercase text-[#11110F] bg-[#E9E2D0] hover:bg-[#D7C9A8] transition-all duration-200 group flex items-center gap-1.5 cursor-pointer"
        >
          <span>EXPLORE</span>
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </header>
  );
};
