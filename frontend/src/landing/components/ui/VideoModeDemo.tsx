import React, { useState } from 'react';
import { VIDEO_FRAMES } from '../../data/architecturalFloorPlan';
import { Camera } from 'lucide-react';

export const VideoModeDemo: React.FC = () => {
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const activeFrame = VIDEO_FRAMES[activeFrameIndex];

  return (
    <div className="bg-[#161513]/85 border border-[#3A3832]/60 p-4 backdrop-blur-md max-w-sm w-full text-left font-mono text-xs">
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#3A3832]/50">
        <span className="font-bricolage font-bold text-xs tracking-wider text-[#E9E2D0]">
          WALKTHROUGH SLAM
        </span>
        <span className="font-hand text-[#C56A45] text-xs rotate-[-2deg]">
          6-DOF tracked 📹
        </span>
      </div>

      {/* Frame Strip */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {VIDEO_FRAMES.map((f, idx) => (
          <button
            key={f.id}
            onClick={() => setActiveFrameIndex(idx)}
            className={`border p-1.5 text-center transition-colors ${
              activeFrameIndex === idx
                ? 'border-[#C56A45] bg-[#C56A45]/20 text-[#E9E2D0] font-bold'
                : 'border-[#3A3832] text-[#A9A397] hover:border-[#A9A397]'
            }`}
          >
            <div className="font-syne text-[10px]">{f.frameLabel.replace('FRAME ', 'F-')}</div>
            <div className="text-[8px] text-[#A9A397] mt-0.5">{f.timestamp}</div>
          </button>
        ))}
      </div>

      {/* Telemetry info */}
      <div className="flex justify-between items-center text-[10px] text-[#A9A397] border-t border-[#3A3832]/50 pt-2">
        <div className="flex items-center gap-1.5">
          <Camera className="w-3 h-3 text-[#3F7C78]" />
          <span className="text-[#E9E2D0] font-bold">{activeFrame.frameLabel}</span>
        </div>
        <span>{activeFrame.focalLength}</span>
        <span className="text-[#3F7C78] font-bold">14.2k PTS</span>
      </div>
    </div>
  );
};
