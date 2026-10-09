import React from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

interface Fix2BuildDemoProps {
  offset: number;
  onOffsetChange: (val: number) => void;
}

export const Fix2BuildDemo: React.FC<Fix2BuildDemoProps> = ({ offset, onOffsetChange }) => {
  const isAligned = Math.abs(offset) < 0.02;

  return (
    <div className="bg-[#161513]/90 border border-[#3A3832]/60 p-4 backdrop-blur-md max-w-sm w-full text-left font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#3A3832]/50">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#C56A45]" />
          <span className="font-bricolage font-bold tracking-wide text-[#E9E2D0] text-sm">
            FIX2BUILD AUDIT
          </span>
        </div>
        <span className="font-hand text-[#C56A45] text-sm rotate-[-2deg]">
          {isAligned ? 'snapped! ✓' : 'nudge in 2D 👈'}
        </span>
      </div>

      {/* Status banner */}
      <div className={`p-2.5 mb-3 border flex items-center justify-between transition-colors ${
        isAligned
          ? 'border-[#3F7C78]/50 bg-[#3F7C78]/10 text-[#E9E2D0]'
          : 'border-[#C56A45]/50 bg-[#C56A45]/10 text-[#E9E2D0]'
      }`}>
        <div className="flex items-center gap-2">
          {isAligned ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-[#3F7C78]" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-[#C56A45]" />
          )}
          <span className="font-syne font-bold text-xs tracking-wider">
            {isAligned ? 'TOPOLOGY VERIFIED' : 'UNCERTAIN WALL'}
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#A9A397]">
          {offset > 0 ? `+${(offset * 100).toFixed(0)}cm` : `${(offset * 100).toFixed(0)}cm`}
        </span>
      </div>

      {/* Slider */}
      <input
        type="range"
        min="-0.4"
        max="0.4"
        step="0.01"
        value={offset}
        onChange={(e) => onOffsetChange(parseFloat(e.target.value))}
        className="w-full accent-[#C56A45] bg-[#3A3832] h-1.5 cursor-pointer mb-3"
      />

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onOffsetChange(0)}
          className={`flex-1 py-1.5 text-center text-xs font-bricolage font-bold transition-colors ${
            isAligned
              ? 'bg-[#3F7C78] text-[#11110F]'
              : 'bg-[#E9E2D0] hover:bg-[#D7C9A8] text-[#11110F]'
          }`}
        >
          {isAligned ? 'SNAP LOCKED ✓' : 'SNAP IN 2D'}
        </button>
        <button
          onClick={() => onOffsetChange(0.28)}
          className="p-1.5 border border-[#3A3832] text-[#A9A397] hover:text-[#E9E2D0]"
          title="Reset"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
