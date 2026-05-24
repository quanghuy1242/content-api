import type { ContentResourceType } from "@/domain/iam/content-permission";

export type ContentRoleProps = {
  id: string;
  namespaceId: string;
  key: string;
  name: string;
  assignableResourceType: ContentResourceType;
  builtIn: boolean;
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateContentRoleProps = Omit<ContentRoleProps, "id" | "createdAt" | "updatedAt" | "version">;

export class ContentRole {
  private constructor(private props: ContentRoleProps) {}

  static create(input: CreateContentRoleProps) {
    const now = new Date();
    return new ContentRole({
      ...input,
      id: crypto.randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: ContentRoleProps) {
    return new ContentRole({ ...props });
  }

  get id() { return this.props.id; }
  get namespaceId() { return this.props.namespaceId; }
  get key() { return this.props.key; }
  get name() { return this.props.name; }
  get assignableResourceType() { return this.props.assignableResourceType; }
  get builtIn() { return this.props.builtIn; }
  get enabled() { return this.props.enabled; }
  get version() { return this.props.version; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  disable() {
    this.props.enabled = false;
    this.props.version += 1;
    this.touch();
  }

  incrementVersion() {
    this.props.version += 1;
    this.touch();
  }

  toSnapshot(): ContentRoleProps {
    return { ...this.props };
  }

  private touch() {
    this.props.updatedAt = new Date();
  }
}
