import type { ContentResourceType } from "@/domain/iam/content-permission";

export type ContentResourceAncestor = {
  readonly type: ContentResourceType;
  readonly id: string;
};

export type ContentResourceRef = {
  readonly type: ContentResourceType;
  readonly id: string;
  readonly orgId: string;
  readonly ancestors: readonly ContentResourceAncestor[];
};

export type ResourceBindingRef = {
  readonly type: ContentResourceType;
  readonly id: string;
  readonly direct: boolean;
};

export function bindingRefsForResource(resource: ContentResourceRef): ResourceBindingRef[] {
  return [
    { type: resource.type, id: resource.id, direct: true },
    ...resource.ancestors.map((ancestor) => ({ type: ancestor.type, id: ancestor.id, direct: false })),
  ];
}
