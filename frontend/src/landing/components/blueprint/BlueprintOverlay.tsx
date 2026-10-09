import React from 'react';

interface BlueprintOverlayProps {
  scrollProgress: number; // 0 to 1
  fix2BuildOffset: number;
  onFix2BuildChange?: (offset: number) => void;
  interactiveFixMode?: boolean;
}

export const BlueprintOverlay: React.FC<BlueprintOverlayProps> = ({
  scrollProgress,
  interactiveFixMode = false,
}) => {
  const isHero = scrollProgress < 0.20;
  const opacity = isHero
    ? Math.max(0, 1 - scrollProgress * 4.5)
    : 0;

  if (opacity <= 0.01 && !interactiveFixMode) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300"
      style={{ opacity }}
    >
      <div className="relative w-full max-w-5xl h-[70vh] p-6 md:p-8 flex flex-col justify-between">
        {/* Corner Registration Marks */}
        <div className="absolute top-2 left-2 text-[#E9E2D0]/40 text-[10px] font-mono">+ 0,0</div>
        <div className="absolute top-2 right-2 text-[#E9E2D0]/40 text-[10px] font-mono">+ 10,0</div>
        <div className="absolute bottom-2 left-2 text-[#E9E2D0]/40 text-[10px] font-mono">+ 0,8</div>
        <div className="absolute bottom-2 right-2 text-[#E9E2D0]/40 text-[10px] font-mono">+ 10,8</div>

        {/* Blueprint Top Bar */}
        <div className="flex justify-between items-center text-[10px] font-mono tracking-widest text-[#A9A397]">
          <span className="text-[#E9E2D0] font-unbounded text-[10px]">AN-09 · 1:50 METRIC</span>
          <span className="text-[#3F7C78]">PLANAR GRAPH ENFORCED</span>
        </div>

        {/* Floating Room Labels */}
        <div className="relative flex-1 flex items-center justify-center">
          <div className="grid grid-cols-3 gap-8 w-full max-w-3xl text-center">
            {/* Bedroom */}
            <div>
              <div className="text-sm font-syne font-bold tracking-wider text-[#E9E2D0]">BEDROOM</div>
              <div className="text-[10px] font-mono text-[#A9A397] mt-0.5">3.8m × 3.4m</div>
              <div className="text-[9px] font-mono text-[#3F7C78] tracking-widest uppercase mt-1">PARQUET / 2.80m CLG</div>
            </div>

            {/* Living room */}
            <div>
              <div className="text-base font-bricolage font-black tracking-wide text-[#E9E2D0]">LIVING ROOM</div>
              <div className="text-[11px] font-mono text-[#A9A397] mt-0.5">4.8m × 3.6m</div>
              <div className="text-[9px] font-mono text-[#3F7C78] tracking-widest uppercase mt-1">SCALE LOCKED</div>
            </div>

            {/* Kitchen */}
            <div>
              <div className="text-sm font-syne font-bold tracking-wider text-[#E9E2D0]">KITCHEN</div>
              <div className="text-[10px] font-mono text-[#A9A397] mt-0.5">3.2m × 2.7m</div>
              <div className="text-[9px] font-mono text-[#C56A45] tracking-widest uppercase mt-1">INFERRED PANTRY</div>
            </div>
          </div>
        </div>

        {/* Blueprint Bottom Bar */}
        <div className="flex justify-between items-center text-[10px] font-mono text-[#A9A397]/70">
          <span className="text-[#E9E2D0]">ARCHNEXT CV LAB</span>
          <span className="text-[#3F7C78]">TOLERANCE ±0.01m</span>
        </div>
      </div>
    </div>
  );
};
