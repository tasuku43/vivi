import { createContext, useContext, type ReactNode } from "react";

export type DraftReviewCommentDeleteHandler = (
  id: string,
) => void | Promise<void>;

const DraftReviewCommentDeleteContext = createContext<
  DraftReviewCommentDeleteHandler | undefined
>(undefined);

const PublishedCommentDeleteContext = createContext<
  DraftReviewCommentDeleteHandler | undefined
>(undefined);

export function usePublishedCommentDelete() {
  return useContext(PublishedCommentDeleteContext);
}

export function DraftReviewCommentActionsProvider({
  children,
  onDeleteDraft,
  onDeletePublished,
}: {
  children: ReactNode;
  onDeleteDraft?: DraftReviewCommentDeleteHandler;
  onDeletePublished?: DraftReviewCommentDeleteHandler;
}) {
  return (
    <DraftReviewCommentDeleteContext.Provider value={onDeleteDraft}>
      <PublishedCommentDeleteContext.Provider value={onDeletePublished}>
        {children}
      </PublishedCommentDeleteContext.Provider>
    </DraftReviewCommentDeleteContext.Provider>
  );
}

export function useDraftReviewCommentDelete() {
  return useContext(DraftReviewCommentDeleteContext);
}
