import type {Project} from '../app/bridge';

export interface ProjectGroup {label:string;shared:boolean;projects:Project[]}
const machine=(project:Project)=>project.environmentId??project.connectionId??'local';
export const projectRepositoryKey=(project:Project)=>project.repositoryIdentity?.origin?.canonicalKey??project.repositoryIdentity?.canonicalKey;

/** Repository identity, never a matching title or path, joins checkouts. Keep
 * each physical target so choosing a group cannot silently change machines. */
export function projectGroups(projects:Project[]):ProjectGroup[]{
  const repositories=new Map<string,Project[]>(),machines=new Map<string,ProjectGroup>();
  for(const project of projects){const key=projectRepositoryKey(project);if(key){const group=repositories.get(key)??[];group.push(project);repositories.set(key,group);}}
  const shared=[...repositories.values()].filter(group=>new Set(group.map(machine)).size>1);
  const sharedProjects=new Set(shared.flat());
  for(const project of projects)if(!sharedProjects.has(project)){
    const key=machine(project),group=machines.get(key)??{label:project.connectionName??'This machine',shared:false,projects:[]};
    group.projects.push(project);machines.set(key,group);
  }
  const sort=(a:Project,b:Project)=>a.title.localeCompare(b.title)||machine(a).localeCompare(machine(b));
  return [...(shared.length?[{label:'Shared projects',shared:true,projects:shared.flat().sort(sort)}]:[]),...[...machines.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(group=>({...group,projects:group.projects.sort(sort)}))];
}
export function groupedProjectLabel(project:Project,projects:Project[]){
  const group=projectGroups(projects).find(group=>group.projects.some(item=>item.id===project.id&&(item.connectionId===project.connectionId||!!project.environmentId&&item.environmentId===project.environmentId)));
  return group?.shared?`${project.title} · Shared · ${project.connectionName??'This machine'}`:`${project.title} · ${group?.label??project.connectionName??'This machine'}`;
}
