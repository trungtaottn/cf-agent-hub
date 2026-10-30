/** Trusted deployment binding only. A product caller never chooses the bucket.
 * Opaque R2 handles do not expose bucket names: declared-name separation is checked
 * by verify:artifact-bindings; direct runtime handle aliasing also fails closed. */
export function productArtifactBucket(environment:{ARTIFACT_BUCKET?:R2Bucket;RECOVERY_BUCKET:R2Bucket}):R2Bucket|undefined {
 const product=environment.ARTIFACT_BUCKET;
 return product&&environment.RECOVERY_BUCKET&&product!==environment.RECOVERY_BUCKET?product:undefined;
}
