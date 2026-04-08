/**
 * PersonaTypes - Type definitions for Agent Recall persona system
 */

export type ProfileType = 'agent_soul' | 'user' | 'style' | 'workflow';
export type ProfileScope = 'global' | string; // 'global' or project name

export interface AgentSoulProfile {
  name?: string;
  running_environment?: string;
  channels?: string;
  self_description?: string;
  core_values?: string[];
  vibe?: string;
  boundaries?: string[];
}

export interface UserProfile {
  name?: string;
  role?: string;
  language?: string;
  timezone?: string;
  profession?: string;
  background?: string;
}

export interface StyleProfile {
  tone?: string;
  brevity?: string;
  formatting?: string;
  output_structure?: string;
  disliked_phrasing?: string[];
}

export interface WorkflowProfile {
  preferred_role?: string;
  decision_style?: string;
  recurring_tasks?: string[];
  template_needs?: string[];
}

export interface AgentProfileRow {
  id: number;
  scope: string;
  profile_type: string;
  content_json: string;
  created_at: string;
  created_at_epoch: number;
  updated_at: string | null;
  updated_at_epoch: number | null;
}

export interface MergedPersona {
  agent_soul: AgentSoulProfile;
  user: UserProfile;
  style: StyleProfile;
  workflow: WorkflowProfile;
}

export interface BootstrapStateRow {
  id: number;
  scope: string;
  status: string;
  round: number;
  started_at: string | null;
  completed_at: string | null;
  metadata_json: string | null;
}

export interface ActiveTaskRow {
  id: number;
  project: string;
  task_name: string;
  status: string;
  progress: string | null;
  next_step: string | null;
  context_json: string | null;
  interrupted_tasks_json: string | null;
  started_at: string;
  started_at_epoch: number;
  updated_at: string | null;
  updated_at_epoch: number | null;
}

export interface TaskCheckpoint {
  name: string;
  status: 'pending' | 'in_progress' | 'completed';
  completed_at?: string;
}

export interface PersonaConflict {
  profile_type: ProfileType;
  field: string;
  global_value: any;
  project_value: any;
}

export type ConflictResolution = 'keep_global' | 'keep_project' | 'custom';
