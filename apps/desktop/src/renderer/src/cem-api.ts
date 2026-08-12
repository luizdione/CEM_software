import type {
  AgentMetadata,
  AuditEntry,
  BackupRecord,
  CemAppConfig,
  CemManifest,
  HostInfo,
  McpServerDefinition,
  Profile,
  ProfileSelection,
  ScanResult,
  SkillMetadata,
} from '@cem/core';
import type { CreateProfileInput } from '@cem/profiles';
import type { EnvironmentDiagnosis, Remediation, RemediationResult } from '@cem/diagnostics';
import type { TokenReport } from '@cem/markdown';
import type { BackupResult } from '@cem/backup';
import type { VerifyResult, RestorePlanItem, RestoreResult } from '@cem/restore';
import type { SyncStatus, SyncResult } from '@cem/sync';
import type { UsageReport, UsageWindow } from '@cem/usage';
import type { Inventory, CollectOptions } from '@cem/server-inventory';

export interface BackupRequest {
  outDir?: string;
  fileName?: string;
  password?: string;
  notes?: string;
  includeProjectHistory?: boolean;
  discoverProjects?: boolean;
  profilesIncluded?: string[];
}

export interface RestoreRequestOptions {
  home?: string;
  kinds?: string[];
  archivePaths?: string[];
  overwrite?: boolean;
  dryRun?: boolean;
  projectBaseDir?: string;
  externalBaseDir?: string;
}

export interface UpdateStatus {
  state: 'dev' | 'checking' | 'available' | 'none' | 'backing-up' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
  preUpdateBackup?: string;
}

export interface McpActionResult {
  ok: boolean;
  reason?: string;
  path?: string;
  into?: string;
  count?: number;
  added?: number;
  updated?: number;
  skipped?: number;
}

export interface VerifyResponse {
  manifest: CemManifest;
  verification: VerifyResult;
}

export interface RestorePlanResponse extends VerifyResponse {
  plan: RestorePlanItem[];
}

export interface RestoreResponse {
  verification: VerifyResult;
  result: RestoreResult;
}

/** The API bridged from the main process via the preload script. */
export interface CemApi {
  scan(options?: Record<string, unknown>): Promise<ScanResult>;
  diagnose(options?: Record<string, unknown>): Promise<EnvironmentDiagnosis>;
  remediationPropose(options?: Record<string, unknown>): Promise<Remediation[]>;
  remediationApply(remediation: Remediation): Promise<RemediationResult>;
  listMcp(options?: Record<string, unknown>): Promise<McpServerDefinition[]>;
  mcpExport(options?: Record<string, unknown>): Promise<McpActionResult>;
  mcpImport(): Promise<McpActionResult>;
  mcpToggle(args: { sourcePath: string; name: string; disabled: boolean }): Promise<{ ok: boolean; reason?: string }>;
  mcpRemove(args: { sourcePath: string; name: string }): Promise<{ ok: boolean; reason?: string }>;
  listSkills(options?: Record<string, unknown>): Promise<SkillMetadata[]>;
  listAgents(options?: Record<string, unknown>): Promise<AgentMetadata[]>;
  tokens(options?: Record<string, unknown>): Promise<TokenReport>;
  usageReport(args?: { window?: UsageWindow }): Promise<UsageReport>;
  planExport(request: {
    title: string;
    body: string;
    suggestedName?: string;
    targetDir?: string;
    launch?: boolean;
  }): Promise<{ ok: boolean; path?: string; launched: boolean; message: string }>;
  listProfiles(): Promise<Profile[]>;
  createProfile(input: CreateProfileInput): Promise<Profile>;
  deleteProfile(id: string): Promise<boolean>;
  profileTemplates(): Promise<CreateProfileInput[]>;
  backup(options?: BackupRequest): Promise<BackupResult>;
  readManifest(path: string): Promise<CemManifest>;
  verify(args: { path: string; password?: string }): Promise<VerifyResponse>;
  restorePlan(args: {
    path: string;
    password?: string;
    options?: RestoreRequestOptions;
  }): Promise<RestorePlanResponse>;
  restore(args: {
    path: string;
    password?: string;
    options?: RestoreRequestOptions;
  }): Promise<RestoreResponse>;
  pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
  getConfig(): Promise<CemAppConfig>;
  saveConfig(config: CemAppConfig): Promise<void>;
  platformInfo(): Promise<{ host: HostInfo; cemVersion: string }>;
  openExternal(url: string): Promise<void>;
  listHistory(): Promise<BackupRecord[]>;
  auditLog(limit?: number): Promise<AuditEntry[]>;
  updateCheck(): Promise<UpdateStatus>;
  updateDownload(): Promise<UpdateStatus>;
  updateInstall(): Promise<{ ok: boolean }>;
  updatePreBackup(): Promise<{ path?: string }>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  syncStatus(): Promise<SyncStatus>;
  syncInit(remote?: string): Promise<SyncResult>;
  syncPush(args: { message?: string; push?: boolean }): Promise<SyncResult>;
  syncPull(): Promise<SyncResult>;
  inventoryLoad(): Promise<Inventory | null>;
  inventoryCollect(options?: CollectOptions): Promise<Inventory>;
  inventoryLoadFile(): Promise<{ ok: boolean; inventory?: Inventory; reason?: string }>;
}

declare global {
  interface Window {
    cem: CemApi;
  }
}

export const cem: CemApi = window.cem;

export type { ProfileSelection };
