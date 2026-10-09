import React from 'react';
import { RESEARCH_METRICS } from '../../data/architecturalFloorPlan';

export const ResearchMetrics: React.FC = () => {
  return (
    <div className="w-full max-w-5xl mx-auto py-8 px-4 md:px-8 text-left font-mono">
      {/* Header */}
      <div className="border-b border-[#3A3832]/60 pb-4 mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-mono text-[#3F7C78] tracking-widest uppercase mb-1">
            03 / EMPIRICAL RIGOR
          </div>
          <h2 className="text-2xl md:text-4xl font-syne font-bold text-[#E9E2D0] tracking-tight">
            NOT JUST A MODEL. <span className="font-serif italic font-normal text-[#A9A397]">A measurable pipeline.</span>
          </h2>
        </div>
        <div className="font-hand text-[#C56A45] text-base rotate-[-1deg]">
          rigorously evaluated on held-out benchmarks 🔬
        </div>
      </div>

      {/* Provenance Stack Bar */}
      <div className="bg-[#161513]/80 border border-[#3A3832] p-4 mb-6">
        <div className="flex justify-between items-center text-xs mb-2">
          <span className="font-bricolage font-bold text-[#E9E2D0]">PROVENANCE SPLIT</span>
          <div className="flex gap-4 text-[11px] font-mono">
            <span className="text-[#E9E2D0]">87% OBSERVED</span>
            <span className="text-[#C56A45]">10% INFERRED</span>
            <span className="text-[#85785C]">3% UNCERTAIN</span>
          </div>
        </div>
        <div className="h-2.5 w-full flex border border-[#3A3832]/80 overflow-hidden">
          <div style={{ width: '87%' }} className="bg-[#E9E2D0]" />
          <div style={{ width: '10%' }} className="bg-[#C56A45]" />
          <div style={{ width: '3%' }} className="bg-[#85785C]" />
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {RESEARCH_METRICS.slice(0, 6).map((m, i) => (
          <div
            key={i}
            className="border border-[#3A3832] bg-[#161513]/70 p-3.5 flex flex-col justify-between"
          >
            <div>
              <div className="text-[9px] text-[#3F7C78] uppercase tracking-wider">{m.name}</div>
              <div className="text-[10px] text-[#A9A397] truncate mt-0.5">{m.status}</div>
            </div>
            <div className="flex items-baseline justify-between mt-3 pt-2 border-t border-[#3A3832]/50">
              <span className="text-[10px] text-[#A9A397] line-through">{m.baseline}</span>
              <span className="text-base font-unbounded font-bold text-[#E9E2D0]">{m.archnext}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
