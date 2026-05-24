import { Book, type BookProps } from "@/domain/books/book.entity";
import { PolicyBinding, type PolicyBindingProps } from "@/domain/iam/policy-binding.entity";
import { PolicyEvent, type PolicyEventProps } from "@/domain/iam/policy-event.entity";

export function serializeBookCreation(book: Book, ownerBinding: PolicyBinding, event: PolicyEvent) {
  return JSON.stringify({
    book: book.toSnapshot(),
    ownerBinding: ownerBinding.toSnapshot(),
    event: event.toSnapshot(),
  });
}

export function deserializeBookCreation(value: string) {
  const snapshot = JSON.parse(value) as {
    book: SerializedBookProps;
    ownerBinding: SerializedBindingProps;
    event: SerializedEventProps;
  };
  return {
    book: Book.reconstitute({
      ...snapshot.book,
      createdAt: new Date(snapshot.book.createdAt),
      updatedAt: new Date(snapshot.book.updatedAt),
    }),
    ownerBinding: PolicyBinding.reconstitute({
      ...snapshot.ownerBinding,
      expiresAt: snapshot.ownerBinding.expiresAt ? new Date(snapshot.ownerBinding.expiresAt) : null,
      createdAt: new Date(snapshot.ownerBinding.createdAt),
    }),
    event: PolicyEvent.reconstitute({
      ...snapshot.event,
      createdAt: new Date(snapshot.event.createdAt),
    }),
  };
}

type SerializedBookProps = Omit<BookProps, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type SerializedBindingProps = Omit<PolicyBindingProps, "expiresAt" | "createdAt"> & {
  expiresAt: string | null;
  createdAt: string;
};

type SerializedEventProps = Omit<PolicyEventProps, "createdAt"> & {
  createdAt: string;
};
