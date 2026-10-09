import React from 'react';
import { X, FileText, Video, ArrowRight, ShieldCheck, Cpu } from 'lucide-react';

interface ExploreModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMode?: 'a' | 'b';
  onNavigate?: (route: string) => void;
}

export const ExploreModal: React.FC<ExploreModalProps> = ({
  isOpen,
  onClose,
  selectedMode,
  onNavigate,
}) => {
  if (!isOpen) return null;

  const handleNav = (route: string) => {
    onClose();
    if (onNavigate) onNavigate(route);
    else window.location.href = route;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#11110F]/85 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-[#161513] border border-[#3A3832] p-6 md:p-8 text-left font-mono text-xs shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-[#A9A397] hover:text-[#E9E2D0] transition-colors p-1"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="border-b border-[#3A3832] pb-4 mb-6">
          <div className="text-[10px] text-[#3F7C78] tracking-widest uppercase mb-1">
            RESEARCH PIPELINE GATEWAY
          </div>
          <h3 className="text-2xl font-sans font-bold text-[#E9E2D0] tracking-tight">
            EXPLORE ARCHNEXT RECONSTRUCTION
          </h3>
          <p className="text-[11px] text-[#A9A397] mt-1 font-sans">
            Choose a reconstruction pipeline mode to initialize workspace environment.
          </p>
        </div>

        {/* Two Modes Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Mode A Card */}
          <div className="border border-[#3A3832] p-5 bg-[#11110F]/60 flex flex-col justify-between hover:border-[#E9E2D0] transition-colors group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <FileText className="w-5 h-5 text-[#E9E2D0]" />
                <span className="text-[9px] text-[#3F7C78] border border-[#3F7C78]/40 px-2 py-0.5">
                  /mode-a
                </span>
              </div>
              <div className="text-sm font-bold text-[#E9E2D0] font-sans mb-1">
                MODE A / BLUEPRINT → 3D
              </div>
              <p className="text-[10px] text-[#A9A397] leading-relaxed mb-4">
                Structured floor plans to metric, manifold 3D models with ScaleLock constraint solver and Fix2Build co-editing.
              </p>
            </div>
            <div className="border-t border-[#3A3832]/60 pt-3">
              <div className="text-[9px] text-[#A9A397] mb-2">INPUT: CAD DWG / SVG / PDF / RASTER</div>
              <a
                href="/mode-a"
                onClick={(e) => {
                  e.preventDefault();
                  handleNav('/mode-a');
                }}
                className="w-full py-2 bg-[#E9E2D0] text-[#11110F] font-bold text-center flex items-center justify-center gap-2 hover:bg-[#D7C9A8] transition-colors cursor-pointer"
              >
                <span>OPEN MODE A (BLUEPRINT → 3D)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Mode B Card */}
          <div className="border border-[#3A3832] p-5 bg-[#11110F]/60 flex flex-col justify-between hover:border-[#C56A45] transition-colors group">
            <div>
              <div className="flex items-center justify-between mb-3">
                <Video className="w-5 h-5 text-[#C56A45]" />
                <span className="text-[9px] text-[#C56A45] border border-[#C56A45]/40 px-2 py-0.5">
                  /mode-b
                </span>
              </div>
              <div className="text-sm font-bold text-[#E9E2D0] font-sans mb-1">
                MODE B / VIDEO → 3D
              </div>
              <p className="text-[10px] text-[#A9A397] leading-relaxed mb-4">
                Handheld room walkthrough video to navigable 3D space with continuous SLAM and explicit observed vs. inferred labeling.
              </p>
            </div>
            <div className="border-t border-[#3A3832]/60 pt-3">
              <div className="text-[9px] text-[#A9A397] mb-2">INPUT: MP4 / MOV / 4K MONOCULAR</div>
              <a
                href="/mode-b"
                onClick={(e) => {
                  e.preventDefault();
                  handleNav('/mode-b');
                }}
                className="w-full py-2 bg-[#C56A45] text-[#11110F] font-bold text-center flex items-center justify-center gap-2 hover:bg-[#D7C9A8] transition-colors cursor-pointer"
              >
                <span>OPEN MODE B (VIDEO → 3D)</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Audit Footer */}
        <div className="flex items-center justify-between text-[9px] text-[#A9A397] border-t border-[#3A3832] pt-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#3F7C78]" />
            <span>GROUND TRUTH CALIBRATED PIPELINE</span>
          </div>
          <span className="text-[#E9E2D0]">CONFIDENCE / 0.94</span>
        </div>
      </div>
    </div>
  );
};
