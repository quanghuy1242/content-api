import type { ContentDelegationClass, ContentPermissionKey } from "@/domain/iam/content-permission";

export type ContentPermissionProps = {
  key: ContentPermissionKey;
  description: string;
  delegationClass: ContentDelegationClass;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateContentPermissionProps = Omit<ContentPermissionProps, "createdAt" | "updatedAt">;

export class ContentPermission {
  private constructor(private props: ContentPermissionProps) {}

  static create(input: CreateContentPermissionProps) {
    const now = new Date();
    return new ContentPermission({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: ContentPermissionProps) {
    return new ContentPermission({ ...props });
  }

  get key() { return this.props.key; }
  get description() { return this.props.description; }
  get delegationClass() { return this.props.delegationClass; }
  get enabled() { return this.props.enabled; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  toSnapshot(): ContentPermissionProps {
    return { ...this.props };
  }
}
