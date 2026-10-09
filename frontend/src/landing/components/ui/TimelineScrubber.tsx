import React from 'react';
import { Eye, Compass, Layers, CheckCircle } from 'lucide-react';

interface TimelineScrubberProps {
  progress: number;
  onProgressChange: (val: number) => void;
  isInteractiveOrbit: boolean;
  onToggleOrbit: () => void;
  activeLayer: 'all' | 'observed' | 'inferred' | 'points';
  onLayerChange: (layer: 'all' | 'observed' | 'inferred' | 'points') => void;
  provenanceMode: boolean;
  onToggleProvenance: () => void;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  progress,
  onProgressChange,
  isInteractiveOrbit,
  onToggleOrbit,
  activeLayer,
  onLayerChange,
  provenanceMode,
  onToggleProvenance,
}) => {
  const phases = [
    { label: '01 HERO BLUEPRINT', min: 0.0, max: 0.15, jump: 0.05 },
    { label: '02 3D WALL RISE', min: 0.15, max: 0.30, jump: 0.22 },
    { label: '03 SCALELOCK', min: 0.30, max: 0.42, jump: 0.36 },
    { label: '04 TRUST PROVENANCE', min: 0.42, max: 0.55, jump: 0.48 },
    { label: '05 VIDEO CLOUD', min: 0.55, max: 0.70, jump: 0.62 },
    { label: '06 INFERRED SPACE', min: 0.70, max: 0.82, jump: 0.76 },
    { label: '07 CONVERGENCE', min: 0.82, max: 0.92, jump: 0.86 },
    { label: '08 FINAL SCENE', min: 0.92, max: 1.0, jump: 0.96 },
  ];

  const currentPhase = phases.find(p => progress >= p.min && progress <= p.max) || phases[0];

  return (
    <aside aria-label="Reconstruction controls and telemetry" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-11/12 max-w-4xl bg-[#161513]/90 border border-[#3A3832] backdrop-blur-md p-3 md:p-4 text-xs font-mono">
      {/* Top Telemetry & Mode Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#3A3832]/60 text-[11px]">
        {/* Left Phase indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[#E9E2D0] font-semibold">
            <span className="w-2 h-2 rounded-full bg-[#3F7C78] animate-pulse" />
            <span>{currentPhase.label}</span>
          </div>
          <span className="text-[#A9A397] hidden sm:inline">
            {(progress * 100).toFixed(0)}% TIMELINE
          </span>
        </div>

        {/* Layer & Mode Toggle Actions */}
        <div className="flex items-center gap-2">
          {/* Provenance Mode Toggle */}
          <button
            onClick={onToggleProvenance}
            className={`px-2.5 py-1 border transition-colors flex items-center gap-1.5 ${
              provenanceMode
                ? 'border-[#C56A45] bg-[#C56A45]/20 text-[#E9E2D0]'
                : 'border-[#3A3832] text-[#A9A397] hover:text-[#E9E2D0]'
            }`}
          >
            <Layers className="w-3 h-3 text-[#C56A45]" />
            <span className="hidden sm:inline">PROVENANCE VIEW</span>
            <span className="sm:hidden">TRUST</span>
          </button>

          {/* Orbit / Free Inspect Mode Toggle */}
          <button
            onClick={onToggleOrbit}
            className={`px-2.5 py-1 border transition-colors flex items-center gap-1.5 ${
              isInteractiveOrbit
                ? 'border-[#3F7C78] bg-[#3F7C78]/20 text-[#E9E2D0]'
                : 'border-[#3A3832] text-[#A9A397] hover:text-[#E9E2D0]'
            }`}
          >
            <Compass className="w-3 h-3 text-[#3F7C78]" />
            <span className="hidden sm:inline">
              {isInteractiveOrbit ? 'ORBIT ACTIVE' : 'INSPECT 3D'}
            </span>
            <span className="sm:hidden">ORBIT</span>
          </button>
        </div>
      </div>

      {/* Scrub Bar Timeline */}
      <div className="pt-3">
        <div className="relative flex items-center mb-2">
          <input
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={progress}
            onChange={(e) => onProgressChange(parseFloat(e.target.value))}
            aria-label="Reconstruction timeline scrub position"
            className="w-full accent-[#E9E2D0] bg-[#3A3832] h-1.5 rounded-none cursor-pointer"
          />
        </div>

        {/* Phase Jump Pills */}
        <div className="hidden md:grid grid-cols-8 gap-1 text-[9px] text-center text-[#A9A397]">
          {phases.map((p, idx) => (
            <button
              key={idx}
              onClick={() => onProgressChange(p.jump)}
              className={`py-1 px-1 border transition-colors truncate ${
                progress >= p.min && progress <= p.max
                  ? 'border-[#E9E2D0] text-[#E9E2D0] font-bold bg-[#3A3832]/40'
                  : 'border-transparent hover:border-[#3A3832]'
              }`}
            >
              {p.label.split(' ')[1]}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};
