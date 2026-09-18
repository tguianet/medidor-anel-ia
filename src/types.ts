export type Stage = "intro" | "camera" | "review" | "hand-camera" | "hand-review";
export type MeasurePhase = "card" | "finger";
export type DragTarget = "left" | "right" | "height" | "card-base-left" | "card-base-right" | "card-base-y" | "card-corner-0" | "card-corner-1" | "card-corner-2" | "card-corner-3" | "pan" | "showcase-ring" | "showcase-left" | "showcase-right" | null;
export type RingMetal = "gold" | "silver" | "rose" | "black";
export type RingStyle = "classic" | "textured" | "matte" | "grooved" | "stone" | "solitaire";
export type MeasurementMode = "finger" | "anelimetro";
export type FingerMeasureStep = "rest" | "joint" | "complete";

export const RING_MODELS: { id: RingStyle; label: string }[] = [
  { id: "classic", label: "Lisa" },
  { id: "textured", label: "Diamantada" },
  { id: "matte", label: "Fosca" },
  { id: "grooved", label: "Com friso" },
  { id: "stone", label: "Com pedra" },
  { id: "solitaire", label: "Solitária" },
];

export const ringImage = (style: RingStyle) => `/rings/${style}.svg?v=20260913-2`;
export const wearableRingImage = (style: RingStyle) => `/rings-wear/${style}.svg?v=20260913-2`;
