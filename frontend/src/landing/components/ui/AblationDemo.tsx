import React from 'react';

interface AblationDemoProps {
  ablationStep: number;
  onAblationStepChange: (step: number) => void;
}

export const AblationDemo: React.FC<AblationDemoProps> = ({
  ablationStep,
  onAblationStepChange,
}) => {
  const steps = [
    { id: 0, title: 'BASELINE', subtitle: 'Raw prior' },
    { id: 1, title: '+ TOPOLOGY', subtitle: 'Manifold snap' },
    { id: 2, title: '+ SCALE', subtitle: 'Metric lock' },
    { id: 3, title: 'FULL PIPELINE', subtitle: 'ArchNext verified' },
  ];

  return (
    <div className="bg-[#161513]/85 border border-[#3A3832]/60 p-4 backdrop-blur-md max-w-lg w-full text-left">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#3A3832]/50">
        <span className="font-bricolage font-bold text-xs tracking-wider text-[#E9E2D0]">
          ABLATION INSPECTION
        </span>
        <span className="font-hand text-xs text-[#3F7C78] rotate-[-2deg]">
          tap to switch 3D stage ✨
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {steps.map((st) => (
          <button
            key={st.id}
            onClick={() => onAblationStepChange(st.id)}
            className={`p-2 border text-left transition-all ${
              ablationStep === st.id
                ? 'border-[#E9E2D0] bg-[#E9E2D0] text-[#11110F]'
                : 'border-[#3A3832] text-[#A9A397] hover:border-[#A9A397]'
            }`}
          >
            <div className="font-syne font-bold text-[11px] leading-tight">{st.title}</div>
            <div className={`text-[9px] font-mono mt-0.5 ${ablationStep === st.id ? 'text-[#11110F]/70' : 'text-[#A9A397]/70'}`}>
              {st.subtitle}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
