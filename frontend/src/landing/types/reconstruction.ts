export type ProvenanceType = 'observed' | 'inferred' | 'uncertain';

export interface RoomData {
  id: string;
  name: string;
  dimensions: string; // e.g. "4.8m × 3.6m"
  area: string;       // e.g. "17.3 m²"
  x: number;          // center X in meters
  z: number;          // center Z in meters
  width: number;      // dimension along X
  depth: number;      // dimension along Z
  floorMaterial?: 'limestone' | 'parquet' | 'concrete';
  provenance: ProvenanceType;
}

export interface WallSegment {
  id: string;
  roomId: string;
  start: [number, number]; // [x, z] in meters
  end: [number, number];   // [x, z] in meters
  height: number;          // nominal 2.8m
  thickness: number;       // nominal 0.20m
  openings?: WallOpening[];
  provenance: ProvenanceType;
  uncertaintyOffset?: number; // for topology/misalignment demo
}

export interface WallOpening {
  id: string;
  type: 'door' | 'window';
  positionAlongWall: number; // 0 to 1 along wall length
  width: number;             // e.g. 0.9m or 1.4m
  height: number;            // e.g. 2.1m or 1.2m
  sillHeight: number;        // 0 for door, 0.9m for window
}

export interface DimensionAnnotation {
  id: string;
  label2D: string;   // e.g. "WIDTH / 482 px"
  label3D: string;   // e.g. "4.82 m"
  start: [number, number, number]; // [x, y, z]
  end: [number, number, number];
  orientation: 'horizontal' | 'vertical';
  type: 'wall' | 'room' | 'door';
}

export interface CameraKeyframe {
  scrollProgress: number; // 0.0 to 1.0
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  label: string;
}

export interface VideoFrameSample {
  id: string;
  frameIndex: number;
  frameLabel: string;
  timestamp: string;
  position: [number, number, number];
  rotation: [number, number, number];
  focalLength: string;
}

export interface ResearchMetric {
  name: string;
  category: 'accuracy' | 'geometry' | 'topology';
  dataset: string;
  baseline: string;
  archnext: string;
  status: string;
  description: string;
}
