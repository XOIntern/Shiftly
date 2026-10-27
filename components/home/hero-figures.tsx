// Line illustrations of outsourced jobs, in the spirit of Notion's drawn
// product row: one 2.5px ink line, round caps, flat tinted fills for props.
// Every figure shares the same head, torso, and legs so the set reads as one
// family; each adds only its own hat, arms, and prop. Decorative: the
// parent figcaption names the job, so the SVGs are aria-hidden. Colors come
// from design tokens through classes (ink stroke, brand blue and teal
// fills), never raw hex.

const INK = "stroke-foreground";
const PAPER = "fill-background";
const BLUE = "fill-primary";
const BLUE_SOFT = "fill-primary/15";
const TEAL = "fill-accent-teal-500";
const TEAL_SOFT = "fill-accent-teal-500/20";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 -6 160 166"
      fill="none"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"h-48 w-auto " + INK}
    >
      {children}
    </svg>
  );
}

// Shared body: neck, torso, legs, and the face. Hats and arms are drawn by
// each figure on top of it.
function Legs() {
  return (
    <>
      <path d="M67 102 L65 142 M93 102 L95 142" />
      <path d="M58 142 H69 M91 142 H102" />
    </>
  );
}

function Torso({ fill = PAPER }: { fill?: string }) {
  return (
    <>
      <path d="M80 48 V54" />
      <path
        d="M62 58 Q62 53 70 53 H90 Q98 53 98 58 L101 102 H59 Z"
        className={fill}
      />
    </>
  );
}

function Face() {
  return (
    <>
      <circle cx="80" cy="34" r="14" className={PAPER} />
      <circle cx="75" cy="35" r="1.2" className="fill-foreground" />
      <circle cx="85" cy="35" r="1.2" className="fill-foreground" />
      <path d="M75.5 40.5 Q80 44.5 84.5 40.5" />
    </>
  );
}

export function CleaningFigure() {
  return (
    <Frame>
      {/* bucket */}
      <path d="M14 112 H44 L41 142 H17 Z" className={TEAL_SOFT} />
      <path d="M17 112 Q29 94 41 112" />
      <Legs />
      <Torso />
      {/* apron */}
      <path d="M67 72 H93 L95 102 H65 Z" className={BLUE_SOFT} />
      <Face />
      {/* hair bun and fringe */}
      <circle cx="80" cy="16" r="5" className="fill-foreground" />
      <path d="M66 31 Q68 19 80 20 Q92 19 94 31" />
      {/* arms */}
      <path d="M62 60 Q54 80 52 98" />
      <path d="M98 60 Q110 72 116 84" />
      {/* mop */}
      <path d="M122 34 L112 128" />
      <path d="M100 128 H124 L126 136 H98 Z" className={TEAL} />
      <path d="M101 136 L99 144 M107 136 L106 144 M113 136 L113 144 M119 136 L120 144 M125 136 L127 144" />
    </Frame>
  );
}

export function CateringFigure() {
  return (
    <Frame>
      <Legs />
      <Torso />
      {/* jacket collar and buttons */}
      <path d="M73 53 L80 63 L87 53" />
      <circle cx="80" cy="74" r="1.6" className="fill-foreground" />
      <circle cx="80" cy="86" r="1.6" className="fill-foreground" />
      <Face />
      {/* chef hat */}
      <path
        d="M66 24 V20 C56 20 56 6 68 7 C72 -2 88 -2 92 7 C104 6 104 20 94 20 V24 Z"
        className={PAPER}
      />
      <path d="M66 20 H94" />
      {/* arms */}
      <path d="M62 60 Q54 80 54 98" />
      <path d="M98 60 Q92 82 105 93" />
      {/* pot, lid, handles */}
      <path
        d="M112 88 H146 V112 Q146 118 140 118 H118 Q112 118 112 112 Z"
        className={BLUE}
      />
      <path d="M112 94 H146" />
      <path d="M112 98 H104 M146 98 H154" />
      <path d="M126 88 V84 H132 V88" />
      {/* steam */}
      <path d="M120 78 q-4 -5 0 -9 t0 -9 M138 78 q-4 -5 0 -9 t0 -9" />
    </Frame>
  );
}

export function SecurityFigure() {
  return (
    <Frame>
      <Legs />
      <Torso />
      {/* collar, belt, and badge */}
      <path d="M73 53 L80 62 L87 53" />
      <path d="M60 94 H100" />
      <rect x="76" y="90" width="8" height="8" rx="1" className={PAPER} />
      <path
        d="M65 63 H77 V72 Q71 79 65 72 Z"
        className={TEAL}
      />
      <Face />
      {/* cap: crown, peak, and badge */}
      <path d="M65 28 C65 12 95 12 95 28 Z" className={BLUE} />
      <path
        d="M60 28 H100 Q100 33 94 33 H66 Q60 33 60 28 Z"
        className={BLUE}
      />
      <circle cx="80" cy="21" r="2.5" className={TEAL} />
      {/* arms */}
      <path d="M62 60 Q54 80 54 98" />
      <path d="M98 60 Q108 70 110 84" />
      {/* radio */}
      <path d="M105 66 H117 V88 H105 Z" className={PAPER} />
      <path d="M114 66 V54" />
      <path d="M108 72 H114 M108 77 H114" />
    </Frame>
  );
}

export function ProductionFigure() {
  return (
    <Frame>
      <Legs />
      <Torso />
      {/* reflective vest bands */}
      <path d="M61 64 H99 V69 H61 Z" className={TEAL} />
      <path d="M60 76 H100 V81 H60 Z" className={TEAL} />
      <Face />
      {/* hard hat: crown, ridge, brim */}
      <path d="M64 28 C64 8 96 8 96 28 Z" className={TEAL} />
      <path d="M80 10 V28" />
      <path d="M59 28 H101 Q101 32 97 32 H63 Q59 32 59 28 Z" className={TEAL} />
      {/* arms reaching to the box */}
      <path d="M62 60 L56 82 L66 97" />
      <path d="M98 60 L104 82 L94 97" />
      {/* carton with tape */}
      <path d="M56 96 H104 V128 H56 Z" className={PAPER} />
      <path d="M80 96 V110" />
      <path d="M56 110 H104" />
      {/* gloves */}
      <circle cx="68" cy="98" r="4.5" className={BLUE} />
      <circle cx="92" cy="98" r="4.5" className={BLUE} />
    </Frame>
  );
}
