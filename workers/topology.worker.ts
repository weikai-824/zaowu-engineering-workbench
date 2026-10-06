import {analyzeTriangles,type TriangleInput} from '../lib/topology';
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<TriangleInput>)=>void;postMessage:(value:unknown)=>void};
scope.onmessage=async event=>{try{scope.postMessage({report:await analyzeTriangles(event.data)});}catch(error){scope.postMessage({error:error instanceof Error?error.message:'网格检查未完成。'});}};
