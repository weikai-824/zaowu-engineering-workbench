import {readFileSync} from 'node:fs';
import {agentToolInvocationSchema,agentToolResultSchema,toolNameSchema} from '../lib/agent-tool-contract.ts';
import {boundDesignRegionPath,MAX_DESIGN_REGION_POINTS} from '../lib/region-path.ts';

const fixture=JSON.parse(readFileSync(new URL('../contracts/repair-tool-v1.fixture.json',import.meta.url),'utf8')) as unknown;
const envelope=fixture as {invocation:unknown;result:unknown};
agentToolInvocationSchema.parse(envelope.invocation);
agentToolResultSchema.parse(envelope.result);

const expected=['apply_design_change','create_cad_job','start_cad_execution','poll_cad_execution','attach_cad_result','verify_revision','apply_visual_edit','verify_visual_revision'];
if(JSON.stringify(toolNameSchema.options)!==JSON.stringify(expected))throw Error('TypeScript Tool Gateway allow-list changed without a contract update.');

const denseRegion=Array.from({length:513},(_value,index)=>[index/512,(index%17)/16] as [number,number]);
const boundedRegion=boundDesignRegionPath(denseRegion);
if(boundedRegion.length!==MAX_DESIGN_REGION_POINTS)throw Error('Dense design regions must be bounded to the contract maximum.');
if(boundedRegion[0]?.[0]!==0||boundedRegion.at(-1)?.[0]!==denseRegion[Math.floor(((MAX_DESIGN_REGION_POINTS-1)*denseRegion.length)/MAX_DESIGN_REGION_POINTS)]?.[0])throw Error('Region bounding must preserve deterministic point order.');

console.log(JSON.stringify({schema:'repair-tool-v1',toolCount:expected.length,fixture:'valid',passed:true}));
