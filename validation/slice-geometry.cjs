const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const site=path.resolve(__dirname,'..'),req=createRequire(path.join(site,'package.json')),esbuild=req('esbuild'),JSZip=req('jszip');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),ab=b=>Uint8Array.from(b).buffer;
const files=['lib/three-mf-geometry.ts','lib/xml-events.ts','lib/mesh-identity.ts','lib/slice-result.ts'];
const observations=[],inputDir=path.join(__dirname,'fixtures/slice-100mm'),model='3D/Objects/object_1.model',root='3D/3dmodel.model',settings='Metadata/model_settings.config';
const hashes=()=>Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(path.join(site,f)))]));
const scratch=path.join(site,'work/validation/slice-geometry');fs.mkdirSync(scratch,{recursive:true});
let api,original,manifest,manifestHash,input;
async function changeXml(z,name,fn){const old=await z.file(name).async('string'),next=fn(old);assert.notEqual(old,next,'fixture transformation made no change');z.file(name,next);}
async function mutate(fn){const outer=await JSZip.loadAsync(original),inner=await JSZip.loadAsync(await outer.file('sliced.3mf').async('nodebuffer'));await fn(inner);const result=await inner.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),report=JSON.parse(await outer.file('report.json').async('string'));report.files['sliced.3mf']={sha256:sha(result),bytes:result.length};outer.file('sliced.3mf',result);outer.file('report.json',JSON.stringify(report));return outer.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
async function inspect(name,expected,fn){let result;try{result=await api.verifySliceResult(ab(fn?await mutate(fn):original),manifest,manifestHash,ab(input));observations.push({name,expected,accepted:true,passed:expected==='accept',geometryProof:result.geometryProof,faces:result.geometryComparison?.matchedTriangles,physicalValidation:result.physicalValidation,productionReady:result.productionReady});}catch(e){observations.push({name,expected,accepted:false,passed:expected==='reject',message:e.message});}console.log(JSON.stringify(observations.at(-1)));}
function addPartMeta(key,value){return z=>changeXml(z,settings,s=>s.replace('</part>',`<metadata key="${key}" value="${value}"/></part>`));}
function addObjectMeta(key,value){return z=>changeXml(z,settings,s=>s.replace('<part ',`<metadata key="${key}" value="${value}"/><part `));}
(async()=>{
 const before=hashes(),bundle=path.join(scratch,'slice-geometry.bundle.cjs');
 await esbuild.build({stdin:{contents:"export {verifySliceResult} from './lib/slice-result';",resolveDir:site,loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'cjs',tsconfig:path.join(site,'tsconfig.json'),logLevel:'silent'});api=require(bundle);
 const task=await JSZip.loadAsync(fs.readFileSync(path.join(inputDir,'100mm底座-离线任务.zip'))),json=await task.file('manifest.json').async('string');manifest=JSON.parse(json);manifestHash=sha(json);input=await task.file('input.stl').async('nodebuffer');original=fs.readFileSync(path.join(inputDir,'100mm底座-离线结果.zip'));
 await inspect('B01_actual_100mm_base','accept');
 await inspect('B02_component_path_missing','reject',z=>changeXml(z,root,s=>s.replace('p:path="/3D/Objects/object_1.model"','p:path="/3D/Objects/missing.model"')));
 await inspect('B03_plate_identify_mismatch','reject',z=>changeXml(z,settings,s=>s.replace('key="identify_id" value="15"','key="identify_id" value="16"')));
 await inspect('B04_hidden_build_instance','reject',z=>changeXml(z,root,s=>s.replace('printable="1"','printable="0"')));
 await inspect('B05_negative_subtype','reject',z=>changeXml(z,settings,s=>s.replace('subtype="normal_part"','subtype="negative_part"')));
 await inspect('B06_metadata_part_type_negative','reject',addPartMeta('part_type','negative_part'));
 await inspect('B07_metadata_volume_type_modifier','reject',addPartMeta('volume_type','modifier_part'));
 await inspect('B08_part_print_override_wall_loops','reject',addPartMeta('wall_loops','15'));
 await inspect('B09_object_print_override_sparse_infill','reject',addObjectMeta('sparse_infill_density','0%'));
 await inspect('B10_part_mesh_shared_unknown_reference','reject',addPartMeta('mesh_shared','999'));
 await inspect('B11_duplicate_vertices_empty_last','reject',z=>changeXml(z,model,s=>s.replace('</vertices>','</vertices><vertices/>')));
 await inspect('B12_duplicate_triangles_split_groups','reject',z=>changeXml(z,model,s=>s.replace(/(<triangle\s[^>]+\/>)/,'$1</triangles><triangles>')));
 await inspect('B13_duplicate_components_empty_last','reject',z=>changeXml(z,root,s=>s.replace('</components>','</components><components/>')));
 await inspect('B14_duplicate_build_empty_last','reject',z=>changeXml(z,root,s=>s.replace('</build>','</build><build/>')));
 await inspect('B15_hex_vertex_equivalent_in_JS_only','reject',z=>changeXml(z,model,s=>s.replace('x="50"','x="0x32"')));
 await inspect('B16_prefixed_core_tags_unreadable_by_fixed_Bambu','reject',z=>changeXml(z,model,s=>s.replace('<model ','<model xmlns:c="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ').replace(/<(\/?)(model|resources|object|mesh|vertices|vertex|triangles|triangle|build)(?=[\s/>])/g,'<$1c:$2')));
 await inspect('B17_renamed_production_path_prefix','reject',z=>changeXml(z,root,s=>s.replaceAll('xmlns:p=','xmlns:q=').replaceAll('p:','q:').replace('requiredextensions="p"','requiredextensions="q"')));
 await inspect('B18_paint_supports','reject',z=>changeXml(z,model,s=>s.replace(/(<triangle\s[^>]+)\/>/,'$1 paint_supports="4"/>')));
 await inspect('B19_paint_color','reject',z=>changeXml(z,model,s=>s.replace(/(<triangle\s[^>]+)\/>/,'$1 paint_color="4"/>')));
 await inspect('B20_paint_fuzzy_skin','reject',z=>changeXml(z,model,s=>s.replace(/(<triangle\s[^>]+)\/>/,'$1 paint_fuzzy_skin="4"/>')));
 await inspect('B21_triangle_index_out_of_bounds','reject',z=>changeXml(z,model,s=>s.replace(/(<triangle\s+)v1="\d+"/,'$1v1="999999"')));
 await inspect('B22_component_rotation','reject',z=>changeXml(z,root,s=>s.replace('transform="1 0 0 0 1 0 0 0 1 0 0 5"','transform="0 1 0 -1 0 0 0 0 1 0 0 5"')));
 await inspect('B23_fake_namespace_element','reject',z=>changeXml(z,model,s=>s.replace('<vertices>','<vertices xmlns="urn:unsupported" >')));
 await inspect('B24_extra_unreferenced_object','reject',z=>changeXml(z,model,s=>s.replace('</resources>','<object id="3" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>')));
 await inspect('B25_missing_plate_instance','reject',z=>changeXml(z,settings,s=>s.replace(/<model_instance>[\s\S]*?<\/model_instance>/,'')));
 await inspect('B26_changed_metadata_source_matrix_no_core_geometry_change','accept',z=>changeXml(z,settings,s=>s.replace('value="1 0 0 0 0 1 0 0 0 0 1 5 0 0 0 1"','value="1 0 0 0 0 1 0 0 0 0 1 25 0 0 0 1"')));
 await inspect('B27_wrapped_part_type_override','reject',z=>changeXml(z,settings,s=>s.replace('</part>','<x><metadata key="part_type" value="negative_part"/></x></part>')));
 await inspect('B28_nested_metadata_override','reject',z=>changeXml(z,settings,s=>s.replace(/(<metadata key="matrix" value="[^"]+")\/>/,'$1><metadata key="part_type" value="negative_part"/></metadata>')));
 await inspect('B29_legacy_volume_extra','reject',z=>changeXml(z,settings,s=>s.replace('</object>','<volume id="1" subtype="negative_part"/></object>')));
 await inspect('B30_plate_spiral_mode_override','reject',z=>changeXml(z,settings,s=>s.replace('<model_instance>','<metadata key="spiral_mode" value="true"/><model_instance>')));
 await inspect('B31_plate_print_sequence_override','reject',z=>changeXml(z,settings,s=>s.replace('<model_instance>','<metadata key="print_sequence" value="by object"/><model_instance>')));
 await inspect('B32_hex_instance_object_id','reject',z=>changeXml(z,settings,s=>s.replace('key="object_id" value="2"','key="object_id" value="0x2"')));
 await inspect('B33_invalid_xml_encoding_declaration','reject',z=>changeXml(z,model,s=>s.replace('encoding="UTF-8"','encoding="UTF-16"')));
 await inspect('B34_inner_hole_changed_same_bbox_faces','reject',z=>changeXml(z,model,s=>s.replace('x="-2.5"','x="-3.5"')));
 await inspect('B35_one_face_reversed','reject',z=>changeXml(z,model,s=>s.replace(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/,(_,a,b,c)=>`<triangle v1="${a}" v2="${c}" v3="${b}"/>`)));
 await inspect('B36_one_face_missing_another_duplicated','reject',z=>changeXml(z,model,s=>{const faces=[...s.matchAll(/<triangle\s[^>]+\/>/g)];return s.slice(0,faces[1].index)+faces[0][0]+s.slice(faces[1].index+faces[1][0].length);}));
 await inspect('B37_face_order_and_cyclic_corners_changed','accept',z=>changeXml(z,model,s=>{const faces=[...s.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map(([,a,b,c])=>`<triangle v1="${b}" v2="${c}" v3="${a}"/>`).reverse();return s.replace(/<triangles>[\s\S]*?<\/triangles>/,'<triangles>'+faces.join('\n')+'</triangles>');}));
 await inspect('B38_global_build_translation','accept',z=>changeXml(z,root,s=>s.replace('127.99999 128 0','137.99999 128 0')));
 await inspect('B39_decimal_change_within_stated_tolerance','accept',z=>changeXml(z,model,s=>s.replace('x="-2.5"','x="-2.500001"')));
 const after=hashes(),label=process.argv[2]??'current',out={date:new Date().toISOString(),scope:'Independent tests of actual compiled full verifier, existing actual 100mm result; mutations recompute outer report hashes. No new Bambu execution, printing, or G-code derivation proof.',sourceHashes:before,sourceUnchangedDuringTests:JSON.stringify(before)===JSON.stringify(after),observations,passed:observations.filter(x=>x.passed).length,total:observations.length};
 fs.writeFileSync(path.join(scratch,`results-${label}.json`),JSON.stringify(out,null,2));console.log(JSON.stringify({passed:out.passed,total:out.total,sourceUnchangedDuringTests:out.sourceUnchangedDuringTests}));if(out.passed!==out.total||!out.sourceUnchangedDuringTests)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
