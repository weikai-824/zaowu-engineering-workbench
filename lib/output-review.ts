export type ReviewDecision='pending'|'approved'|'revise';
export type PartReview={partId:string;printability:ReviewDecision;loadAndAssembly:ReviewDecision;note:string};
export type OutputReviewSnapshot={id:string;projectId:string;revision:number;fingerprint:string;updatedAt:string;items:PartReview[];scope:'human_review_only';physicalValidation:'not_run';productionReady:false};
export type OutputExport={id:string;revision:number;createdAt:string;bytes:number;sha256:string;reviewId:string;stale:boolean};
