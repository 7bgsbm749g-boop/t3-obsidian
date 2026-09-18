export interface OrchestrationSettings {
  waitForOtherThreads: boolean;
}

export const WAIT_FOR_OTHER_THREADS_INSTRUCTION =
  'Before starting work on the task below, wait for all other active T3 Code threads in this project to finish. ' +
  'Exclude this thread and threads in other projects. Check their status periodically, and begin work only when no other threads in this project are active. ' +
  'If you cannot check thread status, ask the user before proceeding.';

export function applyOrchestration(markdown: string, settings: OrchestrationSettings): string {
  return settings.waitForOtherThreads
    ? `${WAIT_FOR_OTHER_THREADS_INSTRUCTION}\n\n${markdown}`
    : markdown;
}
