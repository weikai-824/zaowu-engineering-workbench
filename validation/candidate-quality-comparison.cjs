/* eslint-disable @typescript-eslint/no-require-imports */
// Comparison-shape regression only. No provider/network calls and no synthetic candidate result.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const site=path.resolve(__dirname,'..'),req=createRequire(path.join(site,'package.json')),esbuild=req('esbuild'),out=path.join(site,'work/validation/candidate-quality-comparison');fs.mkdirSync(out,{recursive:true});
const bundle=path.join(out,'candidate-quality-comparison.cjs');
esbuild.buildSync({stdin:{contents:"export {compareCandidateQuality} from './lib/candidate-quality-comparison';",resolveDir:site,sourcefile:'readonly-candidate-quality-comparison.ts',loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'cjs',tsconfig:path.join(site,'tsconfig.json'),logLevel:'silent'});
const {compareCandidateQuality}=require(bundle);
const comparison=compareCandidateQuality(null,null);
const result={name:'missing_high_quality_candidate_is_not_run',golden:comparison.candidates.golden,highQuality:comparison.candidates.highQuality,metrics:comparison.metrics,topologyVerdict:comparison.topologyVerdict,stageGate:comparison.stageGate,passed:comparison.schema==='candidate-quality-comparison-v1'&&comparison.candidates.golden.status==='not_run'&&comparison.candidates.highQuality.status==='not_run'&&comparison.metrics.triangles.status==='not_run'&&comparison.metrics.dimensionsMm.status==='not_run'&&comparison.topologyVerdict.status==='not_run'&&comparison.stageGate.status==='not_run'};
const report={executedAt:new Date().toISOString(),scope:'Comparison structure only; no Candidate result is fabricated and no Tripo API request.',result};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!result.passed)process.exitCode=1;
