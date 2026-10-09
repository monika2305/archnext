import React from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';

interface ScrollStoryOverlayProps {
  scrollProgress: number;
  fix2BuildOffset: number;
  onFix2BuildChange: (val: number) => void;
  ablationStep: number;
  onAblationStepChange: (step: number) => void;
  onOpenExploreModal: (mode?: 'a' | 'b') => void;
  onScrollToProgress: (target: number) => void;
}

export const ScrollStoryOverlay: React.FC<ScrollStoryOverlayProps> = ({
  scrollProgress,
  onOpenExploreModal,
  onScrollToProgress,
}) => {
  return (
    <div className="relative z-20 pointer-events-none w-full">
      {/* =========================================================================
          SECTION 1: HERO VIEWPORT (0.00 - 0.15)
          ========================================================================= */}
      <section className="min-h-screen flex flex-col justify-between p-6 sm:p-12 md:p-16 text-left">
        <div className="pt-16" />

        {/* Pure Floating Typography — ZERO Boxes */}
        <div className="max-w-4xl pointer-events-auto [text-shadow:_0_3px_18px_rgba(0,0,0,0.9)]">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-2.5 h-2.5 bg-[#C56A45] rounded-full" />
            <span className="text-xs font-unbounded text-[#FFFFFF] tracking-widest uppercase">
              ARCHNEXT
            </span>
          </div>

          <h1 className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl tracking-tight text-[#FFFFFF] leading-[0.88] uppercase mb-6">
            <span className="font-syne font-extrabold block drop-shadow-xl">RECONSTRUCT</span>
            <span className="block mt-1">
              <span className="font-serif italic font-normal text-[#C56A45] lowercase text-6xl sm:text-8xl md:text-9xl mr-4 drop-shadow-xl">
                the
              </span>
              <span className="font-bricolage font-black text-[#FFFFFF] drop-shadow-xl">
                SPACE.
              </span>
            </span>
          </h1>

          <p className="text-base sm:text-2xl font-sans text-[#FFFFFF] max-w-xl leading-relaxed mb-6 font-light drop-shadow-lg">
            “Don’t just reconstruct the space. <span className="font-bold text-[#FFFFFF]">Know what you can trust.</span>”
          </p>

          <div className="flex items-center gap-4 text-xs font-mono tracking-widest text-[#FFFFFF]">
            <span className="text-[#3F7C78] font-bold">OBSERVE</span>
            <span className="text-[#A9A397]">/</span>
            <span className="text-[#FFFFFF] font-bold">RECONSTRUCT</span>
            <span className="text-[#A9A397]">/</span>
            <span className="text-[#C56A45] font-bold">VERIFY</span>
          </div>
        </div>

        {/* Minimal Scroll Prompt */}
        <div className="flex justify-between items-center text-xs font-mono text-[#FFFFFF] pointer-events-auto pb-4 [text-shadow:_0_2px_8px_rgba(0,0,0,0.9)]">
          <span className="tracking-wider">SCROLL TO COMMENCE RECONSTRUCTION</span>
          <button
            onClick={() => onScrollToProgress(0.22)}
            className="flex items-center gap-2 text-[#FFFFFF] hover:text-[#C56A45] transition-colors font-bricolage font-bold"
          >
            <span>SCROLL</span>
            <ArrowDown className="w-4 h-4 animate-bounce" />
          </button>
        </div>
      </section>

      {/* =========================================================================
          SECTION 2: WALLS EXTRUDE UPWARD (0.15 - 0.30)
          ========================================================================= */}
      <section className="min-h-screen flex items-center justify-start p-6 sm:p-12 md:p-16 text-left">
        <div className="max-w-lg pointer-events-auto [text-shadow:_0_3px_18px_rgba(0,0,0,0.9)]">
          <div className="text-xs font-mono text-[#3F7C78] tracking-widest uppercase mb-2 font-bold">
            01 / PHYSICAL EXTRUSION
          </div>
          <h2 className="text-4xl sm:text-7xl font-syne font-bold text-[#FFFFFF] tracking-tight leading-none mb-4 drop-shadow-xl">
            WALLS <span className="font-serif italic font-normal text-[#C56A45]">rise</span> UPWARD.
          </h2>
          <p className="text-base sm:text-lg font-sans text-[#FFFFFF] leading-relaxed max-w-md font-light drop-shadow-md">
            2D blueprint boundaries extrude into physical 0.20m metric walls, corner miters, and real door openings.
          </p>
          <div className="mt-5">
            <button
              onClick={() => onOpenExploreModal('a')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#E9E2D0] text-[#11110F] text-xs font-mono font-bold hover:bg-[#D7C9A8] transition-colors cursor-pointer shadow-lg"
            >
              <span>EXPLORE MODE A (BLUEPRINT → 3D)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 3: SCALE & TOPOLOGY (0.30 - 0.44)
          ========================================================================= */}
      <section className="min-h-screen flex items-center justify-start p-6 sm:p-12 md:p-16 text-left">
        <div className="max-w-lg pointer-events-auto [text-shadow:_0_3px_18px_rgba(0,0,0,0.9)]">
          <div className="text-xs font-mono text-[#FFFFFF] tracking-widest uppercase mb-2 font-bold">
            SCALELOCK & TOPOLOGY
          </div>
          <h2 className="text-4xl sm:text-7xl font-bricolage font-black text-[#FFFFFF] tracking-tight leading-none mb-4 drop-shadow-xl">
            SCALE <span className="font-serif italic font-normal text-[#3F7C78]">locked.</span>
            <br />
            TOPOLOGY <span className="text-[#3F7C78]">VERIFIED.</span>
          </h2>
          <p className="text-base sm:text-lg font-sans text-[#FFFFFF] leading-relaxed max-w-md font-light drop-shadow-md">
            Dimension lines rotate from the 2D drafting plane and anchor directly onto physical 3D walls: <span className="font-mono font-bold text-[#3F7C78]">4.82m × 3.64m</span>.
          </p>
        </div>
      </section>

      {/* =========================================================================
          SECTION 4: TRUST & PROVENANCE (0.44 - 0.56)
          ========================================================================= */}
      <section className="min-h-screen flex items-center justify-start p-6 sm:p-12 md:p-16 text-left">
        <div className="max-w-2xl pointer-events-auto [text-shadow:_0_3px_18px_rgba(0,0,0,0.9)]">
          <div className="text-xs font-mono text-[#C56A45] tracking-widest uppercase mb-3 font-bold">
            EVIDENTIARY TRACEABILITY
          </div>
          <h2 className="text-4xl sm:text-7xl font-syne font-bold text-[#FFFFFF] tracking-tight leading-tight mb-4 drop-shadow-xl">
            RECONSTRUCTION IS EASY.
            <br />
            <span className="font-serif italic font-normal text-[#C56A45]">Trust is harder.</span>
          </h2>
          <p className="text-base sm:text-lg font-sans text-[#FFFFFF] max-w-md mb-8 font-light drop-shadow-md">
            ArchNext explicitly distinguishes what it directly captured from what it inferred through structural priors.
          </p>

          <div className="flex items-center gap-8 font-mono text-left">
            <div>
              <div className="text-3xl sm:text-4xl font-unbounded font-bold text-[#FFFFFF] drop-shadow-lg">87%</div>
              <div className="text-[10px] text-[#A9A397] mt-1 tracking-wider">OBSERVED</div>
            </div>
            <div className="text-[#A9A397] text-2xl font-light">/</div>
            <div>
              <div className="text-3xl sm:text-4xl font-unbounded font-bold text-[#C56A45] drop-shadow-lg">10%</div>
              <div className="text-[10px] text-[#C56A45] mt-1 tracking-wider">INFERRED</div>
            </div>
            <div className="text-[#A9A397] text-2xl font-light">/</div>
            <div>
              <div className="text-3xl sm:text-4xl font-unbounded font-bold text-[#85785C] drop-shadow-lg">3%</div>
              <div className="text-[10px] text-[#A9A397] mt-1 tracking-wider">UNCERTAIN</div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 5: VIDEO → 3D POINT CLOUD (0.56 - 0.72)
          ========================================================================= */}
      <section className="min-h-screen flex items-center justify-start p-6 sm:p-12 md:p-16 text-left">
        <div className="max-w-lg pointer-events-auto [text-shadow:_0_3px_18px_rgba(0,0,0,0.9)]">
          <div className="text-xs font-mono text-[#C56A45] tracking-widest uppercase mb-2 font-bold">
            02 / VIDEO → 3D
          </div>
          <h2 className="text-4xl sm:text-7xl font-syne font-bold text-[#FFFFFF] tracking-tight leading-none mb-4 drop-shadow-xl">
            WALKTHROUGH <span className="font-serif italic font-normal text-[#FFFFFF]">to</span>
            <br />
            <span className="text-[#C56A45]">NAVIGABLE 3D.</span>
          </h2>
          <p className="text-base sm:text-lg font-sans text-[#FFFFFF] leading-relaxed max-w-md font-light drop-shadow-md">
            Casual walkthrough frames track 6-DOF camera poses, densifying 14,000+ spatial points on real walls and surfaces.
          </p>
          <div className="mt-5">
            <button
              onClick={() => onOpenExploreModal('b')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#C56A45] text-[#11110F] text-xs font-mono font-bold hover:bg-[#D7C9A8] transition-colors cursor-pointer shadow-lg"
            >
              <span>EXPLORE MODE B (VIDEO → 3D)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 6: UNSEEN OCCLUDED REGION (0.72 - 0.84)
          ========================================================================= */}
      <section className="min-h-screen flex items-center justify-start p-6 sm:p-12 md:p-16 text-left">
        <div className="max-w-lg pointer-events-auto [text-shadow:_0_3px_18px_rgba(0,0,0,0.9)]">
          <div className="text-xs font-mono text-[#C56A45] tracking-widest uppercase mb-2 font-bold">
            OCCLUSION COMPLETION
          </div>
          <h2 className="text-4xl sm:text-7xl font-bricolage font-black text-[#FFFFFF] tracking-tight leading-none mb-4 drop-shadow-xl">
            OBSERVE EVIDENCE.
            <br />
            <span className="font-serif italic font-normal text-[#C56A45]">Infer the rest.</span>
          </h2>
          <p className="text-base sm:text-lg font-sans text-[#FFFFFF] leading-relaxed max-w-md font-light drop-shadow-md">
            When camera visibility ends, unseen rooms are completed using structural priors — rendered in oxidized copper so you always know the difference.
          </p>
        </div>
      </section>

      {/* =========================================================================
          SECTION 7: CONVERGENCE & RIGOR (0.84 - 0.93)
          ========================================================================= */}
      <section className="min-h-screen flex items-center justify-start p-6 sm:p-12 md:p-16 text-left">
        <div className="max-w-xl pointer-events-auto [text-shadow:_0_3px_18px_rgba(0,0,0,0.9)]">
          <div className="text-xs font-mono text-[#3F7C78] tracking-widest uppercase mb-2 font-bold">
            MULTIMODAL CONVERGENCE & RIGOR
          </div>
          <h2 className="text-4xl sm:text-7xl font-syne font-bold text-[#FFFFFF] tracking-tight leading-none mb-4 drop-shadow-xl">
            TWO INPUTS. <span className="font-serif italic font-normal text-[#C56A45]">one space.</span>
          </h2>
          <p className="text-base sm:text-lg font-sans text-[#FFFFFF] leading-relaxed font-light drop-shadow-md">
            Blueprint structural priors and video photometric observations converge into one singular validated model.
          </p>
        </div>
      </section>

      {/* =========================================================================
          SECTION 8: FINAL ROOM & CALL TO ACTION (0.93 - 1.00)
          ========================================================================= */}
      <section className="min-h-screen flex flex-col justify-between p-6 sm:p-12 md:p-16 text-left">
        <div className="pt-16" />

        <div className="max-w-3xl pointer-events-auto [text-shadow:_0_3px_18px_rgba(0,0,0,0.9)]">
          <div className="text-xs font-mono text-[#3F7C78] tracking-widest uppercase mb-3 font-bold">
            FINAL RECONSTRUCTED SPACE
          </div>

          <h2 className="text-5xl sm:text-7xl md:text-8xl tracking-tight leading-[0.92] uppercase mb-5 text-[#FFFFFF]">
            <span className="font-syne font-extrabold text-[#FFFFFF] block drop-shadow-xl">DESCRIBE A SPACE.</span>
            <span className="font-serif italic font-normal text-[#C56A45] lowercase block text-6xl sm:text-8xl drop-shadow-xl">
              we'll show you
            </span>
            <span className="font-bricolage font-black text-[#FFFFFF] block drop-shadow-xl">WHAT WE KNOW.</span>
          </h2>

          <p className="text-base sm:text-xl font-sans text-[#FFFFFF] max-w-lg leading-relaxed mb-8 font-light drop-shadow-md">
            Deploy calibrated 3D spatial reconstruction with auditable causal provenance.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => onOpenExploreModal()}
              className="px-8 py-4 text-xs font-bricolage font-bold tracking-widest uppercase text-[#11110F] bg-[#FFFFFF] hover:bg-[#E9E2D0] transition-all flex items-center gap-2 group shadow-2xl"
            >
              <span>EXPLORE ARCHNEXT</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => onScrollToProgress(0.01)}
              className="px-6 py-4 text-xs font-mono tracking-widest uppercase border border-[#FFFFFF]/40 hover:border-[#FFFFFF] text-[#FFFFFF] transition-colors"
            >
              REPLAY RECONSTRUCTION ↻
            </button>
          </div>
        </div>

        <div className="flex justify-between items-center text-[10px] font-mono text-[#FFFFFF] pointer-events-auto pb-4 [text-shadow:_0_2px_8px_rgba(0,0,0,0.9)]">
          <span className="tracking-widest">ARCHNEXT RESEARCH PLATFORM</span>
          <span className="text-[#3F7C78] tracking-widest">VERIFIED PIPELINE</span>
        </div>
      </section>
    </div>
  );
};
