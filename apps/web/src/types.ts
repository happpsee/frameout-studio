import type { ProviderId } from '@frameout/shared';

export type Provider = ProviderId;
export interface AIConfig {
  provider: Provider;
  baseUrl: string;
  key: string;
  imageModel: string;
  videoModel: string;
  imageSize: string;
  duration: number;
  videoRatio: string;
  resolution: string;
  transport: 'proxy' | 'direct';
}
export interface VideoJob {
  id: string;
  provider: Provider;
  status: string;
  error?: string;
  prompt: string;
  config: Omit<AIConfig, 'key'>;
  duration?: number;
  startedAt?: number;
  progress?: number;
}
export interface Card {
  id: string;
  x: number;
  y: number;
  name: string;
  src: string;
  kind: 'image' | 'video';
  crop?: string;
  tone?: string;
  motion?: boolean;
  label?: string;
  size?: string;
  ratio?: string;
  provider?: string;
  duration?: number;
  poster?: string;
  mediaId?: string;
  missingMedia?: boolean;
  sessionOnly?: boolean;
  remoteTemporary?: boolean;
  job?: VideoJob;
  /** Full prompt the card was generated from. */
  prompt?: string;
  /** Generated video: id of the image card used as the first frame; '' for text-to-video. */
  sourceId?: string;
  model?: string;
  mimeType?: string;
  requestId?: string;
  generatedAt?: string;
}
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export interface Shot {
  id: string;
  cardId: string;
  duration: number;
}
export interface WorkspaceSnapshot {
  version: 1;
  title: string;
  camera: Camera;
  selected: string | null;
  cards: Card[];
  sequence: Shot[];
}
export interface ProjectCheckpoint {
  id: string;
  name: string;
  createdAt: number;
  state: WorkspaceSnapshot;
}
export type StepStatus = 'queued' | 'running' | 'paused' | 'failed' | 'succeeded' | 'cancelled';
export interface WorkflowStep {
  id: string;
  prompt: string;
  mode: GenerationMode;
  status: StepStatus;
  dependsOn?: string;
  outputCardId?: string;
  error?: string;
}
export interface WorkflowEvent {
  id: string;
  at: number;
  message: string;
  stepId?: string;
}
export interface Workflow {
  id: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  createdAt: number;
  steps: WorkflowStep[];
  events: WorkflowEvent[];
  config: Omit<AIConfig, 'key'>;
  checkpointId?: string;
  origin?: { x: number; y: number };
}
/** Kept across shots: notes appended to every prompt, and image cards sent as references. */
export interface Consistency {
  notes: string;
  references: string[];
}
export interface ProjectState extends WorkspaceSnapshot {
  workflow?: Workflow;
  checkpoints?: ProjectCheckpoint[];
  consistency?: Consistency;
}
export type UpdateProject = (recipe: (draft: ProjectState) => void, record?: boolean) => void;
export type GenerationMode = 'image' | 'video';
