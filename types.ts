// Shared media-provider contracts. Every provider has a real path (when its API
// key is set) and a deterministic mock path so the pipeline runs offline.
export interface MediaArtifact { uri: string; durationS?: number; costUsd: number; license?: string; meta?: Record<string, unknown> }
export interface ProviderInfo { readonly name: string; readonly live: boolean }
