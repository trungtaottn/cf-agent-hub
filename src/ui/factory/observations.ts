import type {Task,ObservationView} from '../../http/dto';
import {el,button,labeledControl} from '../dom';
import type {FactoryObservationView,FactoryObservationSlot} from './observation-reads';

export interface FactoryObservationOptions {
 state:FactoryObservationView;workspaceId:string;candidates:readonly Task[];
 onCompare:(id:string)=>void;onRemoveComparison:()=>void;onNext:(id:string)=>void;onRefresh:(id:string)=>void;
}
const paragraph=(text:string)=>el('p',text,{class:'observation-path'});
function section(id:string,title:string):HTMLElement {
 const node=el('section',undefined,{'data-testid':id,class:'factory-observations'});node.append(el('h3',title));return node;
}
function currentTask(slot:FactoryObservationSlot,workspaceId:string):Task|null {
 const read=slot.task.state;return read.status==='ready'&&read.data?.id===slot.id&&read.data.workspace_id===workspaceId?read.data:null;
}
function committed(slot:FactoryObservationSlot,workspaceId:string):ObservationView|null {
 const read=slot.observation.state;
 return currentTask(slot,workspaceId)&&slot.page!==null&&(read.status==='ready'||read.status==='empty')?read.data:null;
}
function availability(slot:FactoryObservationSlot):string {
 const read=slot.observation.state;
 if(read.errorCode==='VERSION_CONFLICT'||read.errorCode==='CURSOR_EXPIRED')return 'Reported observations conflict — refresh current observations explicitly.';
 if(read.status==='forbidden'||read.errorCode==='FORBIDDEN')return 'Reported observations forbidden.';
 if(read.status==='disconnected')return 'Reported observations disconnected.';
 if(read.status==='error')return 'Reported observations read failed.';
 if(read.status==='unavailable')return 'Reported observations unavailable.';
 return 'Waiting for a successful committed page';
}
function coverage(view:ObservationView):string {
 return 'Coverage completeness: unknown · Reported loss: '+(view.coverage?.reported_loss?'yes':'no')+' · Truncated: '+(view.truncated?'yes':'no');
}
/** Pure bounded presentation; all authorization and read scheduling belong to the caller. */
export function FactoryObservationSurfaces(options:FactoryObservationOptions):{overview:HTMLElement;workstation:HTMLElement;evidence:HTMLElement} {
 const {workspaceId}=options,slots=options.state.slots.slice(0,2);
 const overview=section('factory-observation-overview','Reported observation selection');
 const workstation=section('factory-observation-workstation','Reported path map');
 const evidence=section('factory-observation-evidence','Reported observation provenance');
 overview.append(paragraph('Choose at most two tasks explicitly. Comparison choices are currently authorized loaded tasks, not a workspace search.'));
 workstation.append(paragraph('Reported activity only — not execution or runtime presence. Configured checkout association — not filesystem location proof.'));
 evidence.append(paragraph('At most 50 records per selected task, current page only. Separate pages and tasks are not an atomic snapshot. Adapter version: Unavailable in this read.'));
 const select=el('select',undefined,{'data-focus-key':'factory-observation-compare'});
 select.append(el('option','Choose a comparison task',{value:''}));
 const choices=new Map(options.candidates.filter(task=>task.workspace_id===workspaceId&&task.id!==slots[0]?.id).map(task=>[task.id,task]));
 for(const task of choices.values())select.append(el('option',task.title,{value:task.id}));
 select.value='';if(!slots.length)select.setAttribute('disabled','');
 select.addEventListener('change',()=>{if(slots.length&&choices.has(select.value))options.onCompare(select.value);});
 overview.append(labeledControl('Compare reported paths',select));
 if(slots.length===2)overview.append(button('Remove comparison',options.onRemoveComparison,{'data-focus-key':'factory-observation-remove',class:'secondary'}));
 if(!slots.length)workstation.append(paragraph('Select a task to read reported observations.'));
 slots.forEach((slot,index)=>{
  const ordinal=index+1,task=currentTask(slot,workspaceId),view=committed(slot,workspaceId);
  const map=section('factory-observation-map-'+ordinal,'Selected report '+ordinal),proof=section('factory-observation-evidence-'+ordinal,'Selected report evidence '+ordinal);
  workstation.append(map);evidence.append(proof);
  if(!task){const message='Selected task unavailable — report details withheld.';overview.append(paragraph(message));map.append(paragraph(message));proof.append(paragraph(message));return;}
  overview.append(paragraph(task.title+' — '+(view?'Successful committed report page':availability(slot))));
  map.append(paragraph(task.title),paragraph('Task: '+task.id),paragraph('Declared project: '+(task.project_id??'Unspecified')),paragraph('Declared work role: '+(task.work_role_id??'Unspecified')),paragraph('Assigned logical agent: '+(task.assigned_agent_id??'Unassigned')));
  const run=slot.run.state;
  if(run.status==='ready'&&run.data?.id===task.latest_run_id&&run.data.task_id===task.id&&run.data.workspace_id===workspaceId)map.append(paragraph('Independently read latest run: '+run.data.id+' · State: '+run.data.status));
  else map.append(paragraph('Latest run read: Unavailable'));
  const next=button('Next reported page ('+ordinal+')',()=>options.onNext(slot.id),{'data-focus-key':'factory-observation-next-'+ordinal,class:'secondary'});
  if(!view||!slot.page?.has_more||!slot.page.next_cursor||!slot.expectedSessionId||slot.requiresExplicitRefresh)next.setAttribute('disabled','');
  proof.append(next,button('Refresh current observations ('+ordinal+')',()=>options.onRefresh(slot.id),{'data-focus-key':'factory-observation-refresh-'+ordinal,class:'secondary'}));
  if(!view){map.append(paragraph(availability(slot)));proof.append(paragraph(availability(slot)));if(slot.requiresExplicitRefresh)proof.append(paragraph('Explicit refresh required before reading current observations.'));return;}
  proof.append(paragraph('Source: /v2/workspaces/'+encodeURIComponent(workspaceId)+'/tasks/'+encodeURIComponent(task.id)+'/observations'),paragraph('Request ID: '+(slot.observation.state.requestId??'Unavailable')),paragraph('Browser received time: '+(slot.observation.state.observedAt??'Unavailable')),paragraph('Server read time: '+view.read_at),paragraph('Page '+slot.pageNumber+' — '+(slot.page!.has_more?'Partial traversal; another page is available.':'End of this read; not complete external activity.')));
  if(view.status==='no_retained_data'){const message='No retained observation data in this read. External activity and prior execution are unknown.';map.append(paragraph(message));proof.append(paragraph(message));return;}
  const binding=view.binding;
  if(binding){
   map.append(paragraph('Configured repository: '+binding.repository_id),paragraph('Configured checkout: '+binding.checkout_slot_id),paragraph((task.latest_run_id!==null&&task.latest_run_id!==binding.run_id?'Historical report run: ':'Report run: ')+binding.run_id+' — retained attribution, not current ownership'),paragraph('Report agent: '+binding.agent_id+' · Report runtime: '+binding.runtime_instance_id),paragraph('Report fence: '+binding.fence+' · Report session: '+binding.session_id+' · Session epoch: '+binding.session_epoch));
  }
  map.append(paragraph(coverage(view)));proof.append(paragraph(coverage(view)),paragraph('Configured events: '+(view.coverage?.configured_events.join(', ')??'Unavailable')),paragraph('Retained sequence range: '+(view.retained_range?view.retained_range.first_sequence+'–'+view.retained_range.last_sequence:'Unavailable')+' — this retained session only'));
  if(!view.records.length){map.append(paragraph('No retained records on this page'));proof.append(paragraph('No retained records on this page'));}
  const paths=new Map<string,typeof view.records>();
  for(const record of view.records){const rows=paths.get(record.reported.relative_path)??[];rows.push(record);paths.set(record.reported.relative_path,rows);}
  const list=el('ul',undefined,{'aria-label':'Reported paths ('+ordinal+')',class:'records'});
  for(const [path,rows] of paths){const item=el('li',undefined,{class:'observation-path'});item.append(paragraph(path),paragraph('Reported activities: '+[...new Set(rows.map(row=>row.reported.activity))].join(', ')+' · Page-local sequences: '+rows.map(row=>row.sequence).join(', ')));list.append(item);}map.append(list);
  const records=el('ol',undefined,{'aria-label':'Reported evidence rows ('+ordinal+')',class:'records'});
  for(const row of view.records){const item=el('li',undefined,{class:'observation-path'});item.append(paragraph(row.reported.relative_path),paragraph('Sequence: '+row.sequence+' · Reported activity: '+row.reported.activity),paragraph('Producer-reported observed time: '+row.reported.observed_at),paragraph('Server received time: '+row.server_received_at),paragraph('Claimed source OID: '+(row.reported.source_oid??'Unavailable')));if(row.reported.label!==undefined)item.append(paragraph('Reported label: '+row.reported.label));records.append(item);}proof.append(records);
 });
 if(slots.length===2){
  const comparison=section('factory-observation-comparison','Reported path comparison'),a=committed(slots[0]!,workspaceId),b=committed(slots[1]!,workspaceId);workstation.append(comparison);
  if(!a?.binding||!b?.binding){comparison.append(paragraph('Comparison coverage unavailable'));}
  else {
   comparison.append(paragraph('Only these two retained pages; coverage unknown. Separate snapshots, not an atomic view.'),paragraph('Selected report 1: '+coverage(a)),paragraph('Selected report 2: '+coverage(b)),...slots.map((slot,index)=>paragraph('Selected report '+(index+1)+' page: '+(slot.page!.has_more?'partial traversal':'end of this read')+' — not complete external activity.')));
   if(a.binding.repository_id!==b.binding.repository_id)comparison.append(paragraph('Pages refer to different configured repositories; overlap not compared'));
   else {
    const other=new Set(b.records.map(row=>row.reported.relative_path)),shared=[...new Set(a.records.map(row=>row.reported.relative_path))].filter(path=>other.has(path));
    if(!shared.length)comparison.append(paragraph('No shared paths on these two retained pages; coverage unknown'));
    else {comparison.append(paragraph(a.binding.checkout_slot_id===b.binding.checkout_slot_id?'Reported shared-checkout overlap — not write-enforced; check configured mapping':'Potential integration overlap across separate configured checkouts — not a filesystem conflict'));const paths=el('ul',undefined,{'aria-label':'Shared reported paths'});for(const path of shared)paths.append(el('li',path,{class:'observation-path'}));comparison.append(paths);}
   }
  }
 }
 return {overview,workstation,evidence};
}
