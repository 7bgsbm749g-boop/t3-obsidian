interface Machine {environmentId:string;workspaceRoot:string}
/** Managed T3 Connect routes can open in any order. Prefer the desktop's path
 * platform so a fast remote Windows route cannot capture a Linux device log. */
export function diagnosticMachine(machines:Machine[],vaultPath?:string,localEnvironmentId?:string){
  if(localEnvironmentId)return localEnvironmentId;
  if(vaultPath){
    const windows=(path:string)=>/^[a-z]:[\\/]/i.test(path)||path.startsWith('\\\\');
    return machines.find(machine=>windows(machine.workspaceRoot)===windows(vaultPath))?.environmentId;
  }
  return machines[0]?.environmentId;
}
