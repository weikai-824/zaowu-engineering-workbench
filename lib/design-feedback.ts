import {z} from 'zod';
import {randomUuid} from './crypto-portable';
import {boundDesignRegionPath} from './region-path';

const vector3=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);

const anchorSchema=z.object({
 partId:z.string().uuid(),
 objectId:z.string().min(1).max(240),
 location:z.object({
  world:vector3,
  local:vector3,
  faceIndex:z.number().int().nonnegative().nullable(),
  normal:vector3.nullable(),
 }).strict(),
 view:z.object({
  mode:z.enum(['manufacturing','visual','compare','exploded']),
  preset:z.enum(['hero','45','front','side','back']),
  cameraPosition:vector3,
  target:vector3,
 }).strict(),
}).strict();

const feedbackBase=z.object({
 id:z.string().uuid(),
 projectId:z.string().uuid(),
 projectRevision:z.number().int().nonnegative(),
 userFeedback:z.string().min(1).max(8000),
 createdAt:z.string().datetime(),
});

export const point2=z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]);

export const pointFeedbackSchema=feedbackBase.extend({
 schema:z.literal('design-feedback-v1'),
 ...anchorSchema.shape,
}).strict();

export const regionFeedbackSchema=feedbackBase.extend({
 schema:z.literal('design-feedback-region-v1'),
 ...anchorSchema.shape,
 region:z.object({path:z.array(point2).min(6).max(128),worldPath:z.array(vector3).min(6).max(128).optional(),coordinateSystem:z.literal('normalized_viewport')}).strict().refine(value=>!value.worldPath||value.worldPath.length===value.path.length,'三维圈选路径与屏幕路径数量不一致。'),
 annotationImageAssetId:z.string().uuid(),
}).strict();

export const designFeedbackSchema=z.discriminatedUnion('schema',[pointFeedbackSchema,regionFeedbackSchema]);

export type DesignFeedback=z.infer<typeof designFeedbackSchema>;
export type DesignFeedbackAnchor=z.infer<typeof anchorSchema>;

export function createDesignFeedback(input:{projectId:string;projectRevision:number;anchor:DesignFeedbackAnchor;userFeedback:string;createdAt?:string}):DesignFeedback{
 return designFeedbackSchema.parse({schema:'design-feedback-v1',id:randomUuid(),projectId:input.projectId,projectRevision:input.projectRevision,...input.anchor,userFeedback:input.userFeedback,createdAt:input.createdAt??new Date().toISOString()});
}

export function createRegionFeedback(input:{projectId:string;projectRevision:number;anchor:DesignFeedbackAnchor;path:[number,number][];worldPath?:[number,number,number][];annotationImageAssetId:string;userFeedback:string;createdAt?:string}):DesignFeedback{
 return regionFeedbackSchema.parse({schema:'design-feedback-region-v1',id:randomUuid(),projectId:input.projectId,projectRevision:input.projectRevision,...input.anchor,region:{path:boundDesignRegionPath(input.path),...(input.worldPath?{worldPath:input.worldPath}:{}),coordinateSystem:'normalized_viewport'},annotationImageAssetId:input.annotationImageAssetId,userFeedback:input.userFeedback,createdAt:input.createdAt??new Date().toISOString()});
}
