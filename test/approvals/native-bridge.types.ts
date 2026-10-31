import type {HttpDTOMap} from '../../src/http/dto';
import type {Native,NativeSchema,NativeInvoker,ResponseFor} from '../../packages/client/src/native-types';
import type {NativeClient,ArtifactDownloadResult} from '../../packages/client/src/types';
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Assert<T extends true>=T;
type Canonical={ [K in NativeSchema]:Assert<Equal<Native<K>,HttpDTOMap[K]>> };
type SameCall=Assert<Equal<NativeInvoker['invoke'],NativeClient['call']>>;
type Binary=Assert<Equal<ResponseFor<'downloadArtifactContent'>,ArtifactDownloadResult>>;
const valid:Native<'ApprovalDecisionRequest'>={expected_version:3,expected_proposal_version:2,expected_approval_version:1,reason:'Exact proposal'};
// @ts-expect-error camelCase is not the canonical wire field
const camel:Native<'ApprovalDecisionRequest'>={expectedVersion:3,expected_proposal_version:2,expected_approval_version:1,reason:'No'};
// @ts-expect-error current task version is mandatory
const noTask:Native<'ApprovalDecisionRequest'>={expected_proposal_version:2,expected_approval_version:1,reason:'No'};
// @ts-expect-error proposal version is mandatory
const noProposal:Native<'ApprovalDecisionRequest'>={expected_version:3,expected_approval_version:1,reason:'No'};
// @ts-expect-error approval version is mandatory
const noApproval:Native<'ApprovalDecisionRequest'>={expected_version:3,expected_proposal_version:2,reason:'No'};
// @ts-expect-error session identity is never public decision input
const session:Native<'ApprovalDecisionRequest'>={...valid,sessionId:'caller'};
// @ts-expect-error actor identity is never public decision input
const actor:Native<'ApprovalDecisionRequest'>={...valid,actor_id:'caller'};
// @ts-expect-error caller grants are never public decision input
const grant:Native<'ApprovalDecisionRequest'>={...valid,grant:{}};
// @ts-expect-error route availability is not granted by a schema alias
const unavailable:Parameters<NativeInvoker['invoke']>[0]='approveApproval';
void [valid,camel,noTask,noProposal,noApproval,session,actor,grant,unavailable];
